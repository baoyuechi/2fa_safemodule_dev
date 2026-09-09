// ============================================================================
// OAuth2/OIDC · Provider 前端辅助（oauthClient.ts）
//
// 约定（§十六渐进式迁移第一阶段：保持内部兼容）：
//   - Provider 会话仍复用 mfa.session（GoTrue 会话，不扩大暴露面）；
//   - OAuth access/ID/refresh token 永不落 localStorage：complete 只返回
//     redirect_to（前端直接导航），token 兑换是业务后端 server-to-server 的事，
//     浏览器不经手任何 OAuth token；
//   - state 由业务前端持有：本页只透传（经服务端 hash 校验），不做凭据使用。
// ============================================================================

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const OAUTH_BASE = `${SUPABASE_URL}/functions/v1/oauth`;

export const OAUTH_TX_KEY = 'mfa.oauthTx';

export interface OAuthTransactionInfo {
  ok: boolean;
  client_name: string;
  client_id: string;
  scopes: string[];
  requested_acr: string | null;
  require_consent: boolean;
  status: string;
  has_state: boolean;
}

export type CompleteResult =
  | { ok: true; status: 'redirect'; redirect_to: string }
  | { ok: true; status: 'consent_required'; client_name: string; scopes: string[] }
  | { ok: false; code: string; amr?: string[]; acr?: string | null; requested_acr?: string | null };

async function oauthCall<T>(path: string, init: RequestInit, token?: string): Promise<T> {
  const res = await fetch(`${OAUTH_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      apikey: ANON_KEY,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const json = (await res.json().catch(() => ({}))) as T;
  if (!res.ok && (json as Record<string, unknown>)['ok'] === undefined) {
    throw new Error(`oauth ${path} HTTP ${res.status}`);
  }
  return json;
}

/** 读取 transaction 展示信息（id 即高熵能力，无需会话）。 */
export function getOAuthTransaction(id: string): Promise<OAuthTransactionInfo> {
  return oauthCall<OAuthTransactionInfo>(`/transaction?id=${encodeURIComponent(id)}`, { method: 'GET' });
}

/**
 * 推进 transaction：服务端从现有登录证据推导 Authentication Context，
 * 政策满足即出码（返回 redirect_to，调用方直接导航）。
 */
export function completeOAuthTransaction(
  token: string,
  transactionId: string,
  state: string | null,
): Promise<CompleteResult> {
  return oauthCall<CompleteResult>(
    '/complete',
    { method: 'POST', body: JSON.stringify({ transaction_id: transactionId, state }) },
    token,
  );
}

/** 用户授权确认（require_consent 的 client）。 */
export function consentOAuthTransaction(
  token: string,
  transactionId: string,
  approve: boolean,
): Promise<{ ok: boolean; status?: string; redirect_to?: string }> {
  return oauthCall('/consent', {
    method: 'POST',
    body: JSON.stringify({ transaction_id: transactionId, approve }),
  }, token);
}

/** 待续的 OAuth transaction（登录页成功后回到授权页继续）。 */
export function savePendingOAuthTx(tx: string, state: string | null): void {
  try {
    sessionStorage.setItem(OAUTH_TX_KEY, JSON.stringify({ tx, state }));
  } catch { /* ignore */ }
}

export function readPendingOAuthTx(): { tx: string; state: string | null } | null {
  try {
    const raw = sessionStorage.getItem(OAUTH_TX_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { tx?: unknown; state?: unknown };
    if (typeof p.tx !== 'string' || !p.tx) return null;
    return { tx: p.tx, state: typeof p.state === 'string' ? p.state : null };
  } catch {
    return null;
  }
}

export function clearPendingOAuthTx(): void {
  try {
    sessionStorage.removeItem(OAUTH_TX_KEY);
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// 业务网站（RP）开发联调用：PKCE 参数生成（业务前端实现参考，与本页无关）
// ---------------------------------------------------------------------------

/** 生成 code_verifier（43~128 字符，RFC 7636 字符集）。 */
export function generateCodeVerifier(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64Url(bytes);
}

/** S256 challenge = BASE64URL(SHA256(verifier))。 */
export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function base64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
