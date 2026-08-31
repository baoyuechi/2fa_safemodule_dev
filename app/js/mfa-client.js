// ============================================================================
// L1 · 客户端 SDK（mfa-client.js）—— headless、UI 无关（design/09-模块化演进）
//
// 页面层（L2）只调用这里导出的方法；错误码 → 用户文案统一在此翻译
// （Part 5 §四 统一错误字典 + 本项目新增端点码）。无框架、无构建：
// ESM + fetch；WebAuthn 浏览器侧依赖 self-host 的 @simplewebauthn/browser
// UMD 包（app/js/vendor/，与 server 端 ^13 配对；生产改 CDN + SRI，见 README）。
//
// 统一响应信封（Part 5 §三）：{ ok:boolean, data?/..., code?:string }
// 本 SDK 约定：业务失败（ok:false）与网络/非 200 一律 throw { code, message,
// silent }，silent=true 时调用方应跳过 toast（CEREMONY_ABORTED 静默）。
// ============================================================================

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
// 统一错误字典（Part 5 §四 + 本项目新增码）
// ---------------------------------------------------------------------------
const ERRORS = {
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
export function translate(code) {
  const msg = ERRORS[code];
  return msg === undefined ? ERRORS.FALLBACK : msg;
}

function mfaError(code, raw) {
  // 用户文案保持纯净（Part 5 §四：raw 进 console，不进 UI）；FALLBACK 额外留原始日志
  if (raw) console.error(`[mfa] ${code}:`, raw);
  const err = new Error(translate(code) ?? ERRORS.FALLBACK);
  err.code = code;
  err.raw = raw; // 调试用原始信息（e.raw 供页面诊断留痕，永不进 Toast）
  err.silent = translate(code) === null;
  return err;
}

// ---------------------------------------------------------------------------
// Toast（统一消息条；样式与宿主 DOM 由本模块注入，全页面共享）
// ---------------------------------------------------------------------------
export function toast(message, type = 'info') {
  const host = ensureToastHost();
  const el = document.createElement('div');
  el.className = `mfa-toast mfa-toast-${type}`;
  el.setAttribute('role', 'status');
  el.textContent = message;
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('mfa-toast-show'));
  setTimeout(() => {
    el.classList.remove('mfa-toast-show');
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

/** 统一错误处理：静默码跳过，其余 toast */
export function handleError(e) {
  if (e?.silent) return;
  toast(e?.message ?? ERRORS.FALLBACK, 'error');
}

function ensureToastHost() {
  if (!document.getElementById('mfa-toast-host')) {
    const style = document.createElement('style');
    style.textContent = `
      #mfa-toast-host{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;display:flex;flex-direction:column;gap:8px;align-items:center}
      .mfa-toast{padding:10px 18px;border-radius:8px;font-size:14px;color:#fff;background:#333;box-shadow:0 4px 14px rgba(0,0,0,.25);opacity:0;transform:translateY(-8px);transition:all .25s ease;max-width:80vw}
      .mfa-toast-show{opacity:1;transform:translateY(0)}
      .mfa-toast-error{background:#c0392b}
      .mfa-toast-success{background:#1e8449}
      .mfa-toast-info{background:#2c3e50}`;
    document.head.appendChild(style);
    const host = document.createElement('div');
    host.id = 'mfa-toast-host';
    document.body.appendChild(host);
  }
  return document.getElementById('mfa-toast-host');
}

// ---------------------------------------------------------------------------
// HTTP 底层：Edge Functions 统一信封 + GoTrue 原生端点
// ---------------------------------------------------------------------------
async function apiCall(path, body, { token } = {}) {
  let res;
  let json;
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
    json = await res.json();
  } catch (e) {
    throw mfaError('FALLBACK', `network ${path}: ${e}`);
  }
  if (json && json.ok === false) throw mfaError(json.code ?? 'FALLBACK');
  if (!res.ok) throw mfaError('FALLBACK', `HTTP ${res.status} ${path}`);
  return json;
}

async function authCall(path, { method = 'POST', body, token } = {}) {
  let res;
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
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = json?.msg ?? json?.error_description ?? json?.error ?? '';
    let code = 'FALLBACK';
    if (res.status === 400 && /invalid_grant|Invalid login|invalid credentials/i.test(reason)) code = 'INVALID_CREDENTIALS';
    if (/already.*registered|已经?注册|User already/i.test(reason)) code = 'EMAIL_TAKEN';
    throw mfaError(code, `HTTP ${res.status} ${path} ${reason}`);
  }
  return json;
}

// ---------------------------------------------------------------------------
// 会话（localStorage 持久化，跨页面导航；结构 = GoTrue 会话对象）
// ---------------------------------------------------------------------------
export function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}
export function getSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}
export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}

/** 校验会话有效性并返回用户（失败=会话过期，调用方应 clearSession） */
export async function fetchSessionUser(token) {
  const user = await authCall('/user', { method: 'GET', token });
  if (!user?.id) throw mfaError('FALLBACK', 'session user missing');
  return user;
}

// ---------------------------------------------------------------------------
// GoTrue 账号 API（邮箱密码为第一因子，AAL1）
// ---------------------------------------------------------------------------
/** 注册（本地 enable_confirmations=false → 返回即含会话） */
export async function signUp(email, password) {
  return authCall('/signup', { body: { email, password } });
}
export async function signInWithPassword(email, password) {
  return authCall('/token?grant_type=password', { body: { email, password } });
}
export async function signOut(token) {
  return authCall('/logout', { method: 'POST', token });
}
/** 通行密钥登录的桥接终点：一次性 token_hash → 标准会话 */
export async function exchangeTokenHash(tokenHash) {
  const session = await authCall('/verify', { body: { type: 'magiclink', token_hash: tokenHash } });
  if (!session?.access_token) throw mfaError('FALLBACK', 'verify returned no session');
  return session;
}

// ---------------------------------------------------------------------------
// L0 端点封装（Part 5 §三；已交付端点全覆盖，供后续页面复用）
// ---------------------------------------------------------------------------
/** 端点 1 · check-email-domain：{email} → {ok, domain}（FR-1.2 预检） */
export const checkEmailDomain = (body) => apiCall('/check-email-domain', body);
/** 端点 2 · phone/send-otp：{phone} → {ok}（码在服务端日志，模拟短信） */
export const sendOtp = (phone) => apiCall('/phone/send-otp', { phone });
/** 端点 3 · phone/verify-otp：{phone, code} → {ok, otpToken} */
export const verifyOtp = (phone, code) => apiCall('/phone/verify-otp', { phone, code });

/** 端点 5 · webauthn/register-options（需会话）：{purpose} → {optionsJSON} */
export const registerOptions = (token, purpose = 'enroll') =>
  apiCall('/webauthn/register-options', { purpose }, { token });
/** 端点 6 · webauthn/register-verify（需会话）：{response} → {ok, credentialId} */
export const registerVerify = (token, response) =>
  apiCall('/webauthn/register-verify', { response }, { token });
/** 端点 7 · webauthn/login-options（无认证）：{email?} → {optionsJSON}，空体=discovery */
export const loginOptions = (body = {}) => apiCall('/webauthn/login-options', body);
/** 端点 8 · webauthn/login-verify（无认证）：{email?, response} → {token_hash} */
export const loginVerify = (body) => apiCall('/webauthn/login-verify', body);

// ---------------------------------------------------------------------------
// WebAuthn 仪式封装（浏览器侧；错误归一为 mfa 错误码）
// ---------------------------------------------------------------------------
function browserLib() {
  const lib = window.SimpleWebAuthnBrowser;
  if (!lib) throw mfaError('FALLBACK', 'SimpleWebAuthnBrowser 未加载（vendor 脚本缺失？）');
  return lib;
}

/** 条件式调解能力探测（L3 conditionalGet） */
export function browserSupportsWebAuthn() {
  try {
    return browserLib().browserSupportsWebAuthn();
  } catch {
    return false;
  }
}
export async function browserSupportsWebAuthnAutofill() {
  try {
    return await browserLib().browserSupportsWebAuthnAutofill();
  } catch {
    return false;
  }
}

/**
 * 注册仪式：options（服务端）→ startRegistration → attResponse。
 * InvalidStateError = 同认证器已注册（tech 清单 §1.2）→ CREDENTIAL_EXISTS。
 */
export async function startPasskeyRegistration(token, purpose = 'enroll') {
  const { optionsJSON } = await registerOptions(token, purpose);
  try {
    const attestation = await browserLib().startRegistration({ optionsJSON });
    return { attestation, optionsJSON };
  } catch (e) {
    throw normalizeWebAuthnError(e);
  }
}
export async function submitPasskeyRegistration(token, attestation) {
  return registerVerify(token, attestation);
}

/**
 * 登录仪式：options（服务端）→ startAuthentication → assertion。
 * useBrowserAutofill=true 走 Conditional UI（输入框须带 autocomplete="webauthn"）。
 */
export async function startPasskeyAuthentication(optionsJSON, { useBrowserAutofill = false } = {}) {
  try {
    return await browserLib().startAuthentication({ optionsJSON, useBrowserAutofill });
  } catch (e) {
    throw normalizeWebAuthnError(e);
  }
}

function normalizeWebAuthnError(e) {
  console.warn('[mfa] webauthn ceremony error:', e?.name, e?.message);
  // 用户取消 / 仪式被新仪式顶掉（页面常驻 conditional 仪式在按钮发起新仪式时
  // 必被自动取消，其 rejection 走到这里）——按 tech 清单 §1.6 ERROR_CEREMONY_ABORTED
  // 纪律一律静默，绝不弹"系统开小差了"
  if (
    e?.name === 'NotAllowedError' ||
    e?.name === 'AbortError' ||
    e?.code === 'ERROR_CEREMONY_ABORTED' ||
    /abort|cancel/i.test(String(e?.message ?? ''))
  ) {
    return mfaError('CEREMONY_ABORTED', e?.message);
  }
  if (e?.name === 'InvalidStateError') return mfaError('CREDENTIAL_EXISTS', e.message);
  if (e?.name === 'SecurityError') return mfaError('INVALID_RESPONSE', e.message);
  return mfaError('FALLBACK', e?.message ?? String(e));
}

// ---------------------------------------------------------------------------
// MFA 绑定状态（RLS：仅本人可读 mfa_enrollments，Part 5 §二）
// ---------------------------------------------------------------------------
/** 返回 enabled；无行 = 未注册过 MFA → false */
export async function getEnrollment(token) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/mfa_enrollments?select=enabled&limit=1`, {
      headers: { apikey: ANON_KEY, Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const rows = await res.json();
    return rows?.[0]?.enabled ?? false;
  } catch {
    return false;
  }
}
