// ============================================================================
// L1 · 客户端 SDK（mfaClient.ts）—— headless、UI 无关（design/09-模块化演进）
//
// 自 app/js/mfa-client.js 的 TypeScript 移植，导出方法签名与错误码字典保持一致。
// 与旧版的唯一差异：toast() 不再注入 DOM，而是派发 `mfa:toast` CustomEvent，
// 由 React 侧 ToastHost（MUI Snackbar）监听渲染——保持本层无 DOM 依赖。
//
// 统一响应信封（Part 5 §三）：{ ok:boolean, data?/..., code?:string }
// 约定：业务失败（ok:false）与网络/非 200 一律 throw { code, message, silent }，
// silent=true 时调用方应跳过 toast（CEREMONY_ABORTED 静默）。
// ============================================================================
import {
  browserSupportsWebAuthn,
  browserSupportsWebAuthnAutofill,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export type { AuthenticationResponseJSON };

// ---------------------------------------------------------------------------
// 配置（本地开发定值；生产切换见 app/README.md）
// ---------------------------------------------------------------------------
const SUPABASE_URL = 'http://127.0.0.1:54321';
const ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const FUNCTIONS_BASE = `${SUPABASE_URL}/functions/v1`;
const AUTH_BASE = `${SUPABASE_URL}/auth/v1`;
const SESSION_KEY = 'mfa.session';

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------
/** GoTrue 会话对象（原样存取，仅约束关键键） */
export interface MfaSession {
  access_token: string;
  [key: string]: unknown;
}
/** GoTrue 用户对象 */
export interface MfaUser {
  id: string;
  email?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// 统一错误字典（Part 5 §四 + 本项目新增码）
// ---------------------------------------------------------------------------
const ERRORS: Record<string, string | null> = {
  // 契约字典
  DOMAIN_NOT_ALLOWED: '请使用学校邮箱注册',
  PHONE_TAKEN: '该手机号已被其他账号使用',
  OTP_EXPIRED: '验证码已过期，请重新获取',
  CHALLENGE_EXPIRED: '操作超时，请重试',
  NO_PASSKEY: '这台设备还没有绑定通行证',
  UV_REQUIRED: '需要指纹验证才能继续',
  CREDENTIAL_SUSPENDED: '账号已挂起，请联系管理员',
  RATE_LIMITED: '尝试次数过多，请稍后再试',
  CEREMONY_ABORTED: null, // 静默·不展示（用户取消仪式）
  FALLBACK: '系统开小差了，请稍后重试',
  // 服务端细化码（register/login-verify 新增）→ 归并到字典语义
  INVALID_CHALLENGE: '操作超时，请重试',
  INVALID_RESPONSE: '验证失败，请重试',
  INVALID_SIGNATURE: '指纹验证失败，请重试',
  CREDENTIAL_NOT_FOUND: '这台设备的通行密钥已失效，请重新绑定',
  CREDENTIAL_EXISTS: '这台设备已经绑定过通行密钥',
  // 前端本地码（GoTrue 交互）
  INVALID_CREDENTIALS: '邮箱或密码不正确',
  EMAIL_TAKEN: '该邮箱已被注册，请直接登录',
};

/** 错误码 → 用户文案；返回 null 表示静默（CEREMONY_ABORTED） */
export function translate(code: string): string | null {
  const msg = ERRORS[code];
  return msg === undefined ? ERRORS.FALLBACK : msg;
}

function mfaError(code: string, raw?: unknown): Error & { code: string; raw?: unknown; silent: boolean } {
  // 用户文案保持纯净（Part 5 §四：raw 进 console，不进 UI）；FALLBACK 额外留原始日志
  if (raw) console.error(`[mfa] ${code}:`, raw);
  const text = translate(code) ?? ERRORS.FALLBACK!;
  const err = new Error(text) as Error & { code: string; raw?: unknown; silent: boolean };
  err.code = code;
  err.raw = raw; // 调试用原始信息（e.raw 供页面诊断留痕，永不进 Toast）
  err.silent = translate(code) === null;
  return err;
}

// ---------------------------------------------------------------------------
// Toast（统一消息条；本层只派发事件，样式与渲染归 UI 层 ToastHost）
// ---------------------------------------------------------------------------
export type ToastType = 'info' | 'success' | 'error';

export function toast(message: string, type: ToastType = 'info'): void {
  window.dispatchEvent(new CustomEvent('mfa:toast', { detail: { message, type } }));
}

/** 统一错误处理：静默码跳过，其余 toast */
export function handleError(e: unknown): void {
  const err = e as { silent?: boolean; message?: string } | null;
  if (err?.silent) return;
  toast(err?.message ?? ERRORS.FALLBACK!, 'error');
}

// ---------------------------------------------------------------------------
// HTTP 底层：Edge Functions 统一信封 + GoTrue 原生端点
// ---------------------------------------------------------------------------
async function apiCall<T = Record<string, unknown>>(
  path: string,
  body?: unknown,
  { token }: { token?: string } = {},
): Promise<T> {
  let res: Response;
  let json: Record<string, unknown> | null;
  try {
    res = await fetch(`${FUNCTIONS_BASE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });
    json = (await res.json()) as Record<string, unknown>;
  } catch (e) {
    throw mfaError('FALLBACK', `network ${path}: ${e}`);
  }
  if (json && json.ok === false) throw mfaError((json.code as string) ?? 'FALLBACK');
  if (!res.ok) throw mfaError('FALLBACK', `HTTP ${res.status} ${path}`);
  return json as T;
}

interface AuthErrorBody {
  msg?: string;
  error_description?: string;
  error?: string;
}

async function authCall<T = Record<string, unknown>>(
  path: string,
  { method = 'POST', body, token }: { method?: string; body?: unknown; token?: string } = {},
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${AUTH_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        apikey: ANON_KEY,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch (e) {
    throw mfaError('FALLBACK', `network ${path}: ${e}`);
  }
  const json = (await res.json().catch(() => ({}))) as AuthErrorBody & Record<string, unknown>;
  if (!res.ok) {
    const reason = json?.msg ?? json?.error_description ?? json?.error ?? '';
    let code = 'FALLBACK';
    if (res.status === 400 && /invalid_grant|Invalid login|invalid credentials/i.test(String(reason)))
      code = 'INVALID_CREDENTIALS';
    if (/already.*registered|已经?注册|User already/i.test(String(reason))) code = 'EMAIL_TAKEN';
    throw mfaError(code, `HTTP ${res.status} ${path} ${reason}`);
  }
  return json as T;
}

// ---------------------------------------------------------------------------
// 会话（localStorage 持久化，跨页面导航；结构 = GoTrue 会话对象）
// ---------------------------------------------------------------------------
export function saveSession(session: MfaSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
export function getSession(): MfaSession | null {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) ?? '') as MfaSession;
  } catch {
    return null;
  }
}
export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

/** 校验会话有效性并返回用户（失败=会话过期，调用方应 clearSession） */
export async function fetchSessionUser(token: string): Promise<MfaUser> {
  const user = await authCall<MfaUser>('/user', { method: 'GET', token });
  if (!user?.id) throw mfaError('FALLBACK', 'session user missing');
  return user;
}

// ---------------------------------------------------------------------------
// GoTrue 账号 API（邮箱密码为第一因子，AAL1）
// ---------------------------------------------------------------------------
/** 注册（本地 enable_confirmations=false → 返回即含会话） */
export async function signUp(email: string, password: string): Promise<MfaSession> {
  return authCall<MfaSession>('/signup', { body: { email, password } });
}
export async function signInWithPassword(email: string, password: string): Promise<MfaSession> {
  return authCall<MfaSession>('/token?grant_type=password', { body: { email, password } });
}
export async function signOut(token: string): Promise<void> {
  await authCall('/logout', { method: 'POST', token });
}
/** 通行密钥登录的桥接终点：一次性 token_hash → 标准会话 */
export async function exchangeTokenHash(tokenHash: string): Promise<MfaSession> {
  const session = await authCall<MfaSession>('/verify', { body: { type: 'magiclink', token_hash: tokenHash } });
  if (!session?.access_token) throw mfaError('FALLBACK', 'verify returned no session');
  return session;
}

// ---------------------------------------------------------------------------
// L0 端点封装（Part 5 §三；已交付端点全覆盖，供后续页面复用）
// ---------------------------------------------------------------------------
/** 端点 1 · check-email-domain：{email} → {ok, domain}（FR-1.2 预检） */
export const checkEmailDomain = (body: { email: string }) =>
  apiCall<{ ok: boolean; domain: string }>('/check-email-domain', body);
/** 端点 2 · phone/send-otp：{phone} → {ok}（码在服务端日志，模拟短信） */
export const sendOtp = (phone: string) => apiCall('/phone/send-otp', { phone });
/** 端点 3 · phone/verify-otp：{phone, code} → {ok, otpToken} */
export const verifyOtp = (phone: string, code: string) =>
  apiCall<{ ok: boolean; otpToken?: string }>('/phone/verify-otp', { phone, code });

/** 端点 5 · webauthn/register-options（需会话）：{purpose} → {optionsJSON} */
export const registerOptions = (token: string, purpose = 'enroll') =>
  apiCall<{ optionsJSON: PublicKeyCredentialCreationOptionsJSON }>('/webauthn/register-options', { purpose }, { token });
/** 端点 6 · webauthn/register-verify（需会话）：{response} → {ok, credentialId} */
export const registerVerify = (token: string, response: RegistrationResponseJSON) =>
  apiCall<{ ok: boolean; credentialId: string }>('/webauthn/register-verify', { response }, { token });
/** 端点 7 · webauthn/login-options（无认证）：{email?} → {optionsJSON}，空体=discovery */
export const loginOptions = (body: { email?: string } = {}) =>
  apiCall<{ optionsJSON: PublicKeyCredentialCreationOptionsJSON }>('/webauthn/login-options', body);
/** 端点 8 · webauthn/login-verify（无认证）：{email?, response} → {token_hash} */
export const loginVerify = (body: { email?: string; response: AuthenticationResponseJSON }) =>
  apiCall<{ token_hash: string }>('/webauthn/login-verify', body);

// ---------------------------------------------------------------------------
// WebAuthn 仪式封装（浏览器侧；错误归一为 mfa 错误码）
// ---------------------------------------------------------------------------
/** 条件式调解能力探测（L3 conditionalGet） */
export function browserSupportsWebAuthnSafe(): boolean {
  try {
    return browserSupportsWebAuthn();
  } catch {
    return false;
  }
}
export async function browserSupportsWebAuthnAutofillSafe(): Promise<boolean> {
  try {
    return await browserSupportsWebAuthnAutofill();
  } catch {
    return false;
  }
}

/**
 * 注册仪式：options（服务端）→ startRegistration → attResponse。
 * InvalidStateError = 同认证器已注册（tech 清单 §1.2）→ CREDENTIAL_EXISTS。
 */
export async function startPasskeyRegistration(token: string, purpose = 'enroll') {
  const { optionsJSON } = await registerOptions(token, purpose);
  try {
    const attestation = await startRegistration({ optionsJSON });
    return { attestation, optionsJSON };
  } catch (e) {
    throw normalizeWebAuthnError(e);
  }
}
export async function submitPasskeyRegistration(token: string, attestation: RegistrationResponseJSON) {
  return registerVerify(token, attestation);
}

/**
 * 登录仪式：options（服务端）→ startAuthentication → assertion。
 * useBrowserAutofill=true 走 Conditional UI（输入框须带 autocomplete="webauthn"）。
 */
export async function startPasskeyAuthentication(
  optionsJSON: PublicKeyCredentialCreationOptionsJSON,
  { useBrowserAutofill = false }: { useBrowserAutofill?: boolean } = {},
): Promise<AuthenticationResponseJSON> {
  try {
    return await startAuthentication({ optionsJSON, useBrowserAutofill });
  } catch (e) {
    throw normalizeWebAuthnError(e);
  }
}

function normalizeWebAuthnError(e: unknown) {
  const err = e as { name?: string; message?: string; code?: string };
  console.warn('[mfa] webauthn ceremony error:', err?.name, err?.message);
  // 用户取消 / 仪式被新仪式顶掉（页面常驻 conditional 仪式在按钮发起新仪式时
  // 必被自动取消，其 rejection 走到这里）——按 tech 清单 §1.6 ERROR_CEREMONY_ABORTED
  // 纪律一律静默，绝不弹"系统开小差了"
  if (
    err?.name === 'NotAllowedError' ||
    err?.name === 'AbortError' ||
    err?.code === 'ERROR_CEREMONY_ABORTED' ||
    /abort|cancel/i.test(String(err?.message ?? ''))
  ) {
    return mfaError('CEREMONY_ABORTED', err?.message);
  }
  if (err?.name === 'InvalidStateError') return mfaError('CREDENTIAL_EXISTS', err.message);
  if (err?.name === 'SecurityError') return mfaError('INVALID_RESPONSE', err.message);
  return mfaError('FALLBACK', err?.message ?? String(err));
}

// ---------------------------------------------------------------------------
// MFA 绑定状态（RLS：仅本人可读 mfa_enrollments，Part 5 §二）
// ---------------------------------------------------------------------------
/** 返回 enabled；无行 = 未注册过 MFA → false */
export async function getEnrollment(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/mfa_enrollments?select=enabled&limit=1`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const rows = (await res.json()) as Array<{ enabled?: boolean }>;
    return rows?.[0]?.enabled ?? false;
  } catch {
    return false;
  }
}
