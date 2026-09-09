// ============================================================================
// OAuth Provider · transaction 与 Authentication Context
//
// 核心原则（§十一）：OAuth 层绝不重新验 WebAuthn signature / OTP / 恢复码，
// 也不让业务网站碰 MFA；OAuth transaction 只关心"用户以什么 assurance
// level 完成了认证"，证据全部来自服务端：
//
//   - WebAuthn 成功：risk_events[channel=webauthn, webauthn_login] 新鲜行
//     （由 webauthn/login-verify 在验签成功后写入，RLS 全拒，浏览器伪造不了）
//   - Recovery 成功：risk_events[channel=recovery, recovery_code_used] 新鲜行
//   - Password 成功：Provider 会话（GoTrue JWT，经 auth.getUser 校验过签名）
//     的 iat 新鲜度（会话在 transaction 创建之后签发 = 口令刚验过）
//
// "新鲜" = 证据时间 >= transaction.created_at（把认证绑定到本次授权事务，
// 陈旧会话/陈旧事件只能落到 SSO 基线）。
//
// SSO 基线：会话有效但无新鲜证据 → amr=[pwd]（loa1，auth_time=会话 iat）。
// 注意 passkey 登录同样会产生新鲜会话，但只要存在新鲜 webauthn 证据就只记
// [webauthn]（会话新鲜度不单独加 pwd，避免把 passkey 登录虚增为 pwd+双因子）；
// 多次 complete 调用做并集合并，支持"密码→再补 passkey"的 step-up。
//
// 状态机（服务端推进，浏览器只读）：
//   AUTH_REQUIRED → PRIMARY_AUTHENTICATED → MFA_REQUIRED → MFA_AUTHENTICATED
//   → CONSENT_REQUIRED → AUTHORIZED → CODE_ISSUED → REDIRECTED
//   失败：DENIED / EXPIRED / CANCELLED / ERROR
// ============================================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { acrForAmr } from './config.ts';

type AdminClient = SupabaseClient;

export interface OAuthTransaction {
  id: string;
  client_id: string;
  user_id: string | null;
  redirect_uri: string;
  response_type: string;
  scope: string;
  state_hash: string | null;
  nonce: string | null;
  nonce_hash: string | null;
  code_challenge: string;
  code_challenge_method: string;
  requested_acr: string | null;
  status: string;
  auth_methods: string[];
  auth_time: string | null;
  amr: string[];
  acr: string | null;
  consent_granted: boolean;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

const TERMINAL = new Set(['CODE_ISSUED', 'REDIRECTED', 'DENIED', 'EXPIRED', 'CANCELLED', 'ERROR']);

/** 允许的状态跃迁表（非法跃迁直接抛错，绝不静默推进）。 */
const TRANSITIONS: Record<string, string[]> = {
  INIT: ['CLIENT_VALIDATED', 'ERROR'],
  CLIENT_VALIDATED: ['TRANSACTION_CREATED', 'ERROR'],
  TRANSACTION_CREATED: ['AUTH_REQUIRED', 'ERROR'],
  AUTH_REQUIRED: ['PRIMARY_AUTHENTICATED', 'MFA_AUTHENTICATED', 'DENIED', 'CANCELLED', 'EXPIRED', 'ERROR'],
  PRIMARY_AUTHENTICATED: ['MFA_REQUIRED', 'MFA_AUTHENTICATED', 'CONSENT_REQUIRED', 'AUTHORIZED', 'DENIED', 'CANCELLED', 'EXPIRED', 'ERROR'],
  MFA_REQUIRED: ['MFA_AUTHENTICATED', 'DENIED', 'CANCELLED', 'EXPIRED', 'ERROR'],
  MFA_AUTHENTICATED: ['CONSENT_REQUIRED', 'AUTHORIZED', 'DENIED', 'CANCELLED', 'EXPIRED', 'ERROR'],
  CONSENT_REQUIRED: ['AUTHORIZED', 'DENIED', 'CANCELLED', 'EXPIRED', 'ERROR'],
  AUTHORIZED: ['CODE_ISSUED', 'DENIED', 'CANCELLED', 'EXPIRED', 'ERROR'],
  CODE_ISSUED: ['REDIRECTED', 'ERROR'],
  REDIRECTED: [],
  DENIED: [],
  EXPIRED: [],
  CANCELLED: [],
  ERROR: [],
};

export async function loadTransaction(
  admin: AdminClient,
  id: string,
): Promise<OAuthTransaction | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data, error } = await admin
    .from('oauth_authorization_transactions')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as OAuthTransaction | null) ?? null;
}

export function txExpired(tx: OAuthTransaction): boolean {
  return Date.parse(tx.expires_at) <= Date.now() || TERMINAL.has(tx.status) && false;
}

export async function markExpired(admin: AdminClient, tx: OAuthTransaction): Promise<void> {
  await admin
    .from('oauth_authorization_transactions')
    .update({ status: 'EXPIRED' })
    .eq('id', tx.id)
    .not('status', 'in', '(CODE_ISSUED,REDIRECTED)');
}

export async function setTxStatus(
  admin: AdminClient,
  tx: OAuthTransaction,
  next: string,
): Promise<void> {
  const allowed = TRANSITIONS[tx.status] ?? [];
  if (!allowed.includes(next)) {
    throw new Error(`illegal oauth tx transition ${tx.status} -> ${next}`);
  }
  const { error } = await admin
    .from('oauth_authorization_transactions')
    .update({ status: next })
    .eq('id', tx.id);
  if (error) throw error;
  tx.status = next;
}

/** 解 GoTrue JWT 载荷（调用方已用 auth.getUser 验过签名，此处只读 iat/exp）。 */
export function decodeProviderJwtPayload(token: string): { iat?: number; exp?: number } {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded)) as { iat?: number; exp?: number };
  } catch {
    return {};
  }
}

async function freshRiskEvidence(
  admin: AdminClient,
  userId: string,
  channel: string,
  signal: string,
  sinceIso: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from('risk_events')
    .select('created_at')
    .eq('user_id', userId)
    .eq('channel', channel)
    .contains('signals', [signal])
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = ((data as Array<{ created_at: string }> | null) ?? [])[0];
  return row?.created_at ?? null;
}

export interface AuthContext {
  amr: string[];
  acr: string | null;
  auth_time: string; // ISO
}

/**
 * 从服务端证据推导 Authentication Context，并与 transaction 已有 amr 合并。
 * providerTokenIat：已校验会话 JWT 的 iat（秒）；传 0 表示无可用会话新鲜度。
 */
export async function deriveAuthContext(
  admin: AdminClient,
  userId: string,
  tx: OAuthTransaction,
  providerTokenIat: number,
): Promise<AuthContext> {
  const since = tx.created_at;
  const [webauthnAt, recoveryAt] = await Promise.all([
    freshRiskEvidence(admin, userId, 'webauthn', 'webauthn_login', since),
    freshRiskEvidence(admin, userId, 'recovery', 'recovery_code_used', since),
  ]);

  const fresh = new Set<string>();
  let authTimeMs = tx.auth_time ? Date.parse(tx.auth_time) : 0;
  if (webauthnAt) {
    fresh.add('webauthn');
    authTimeMs = Math.max(authTimeMs, Date.parse(webauthnAt));
  }
  if (recoveryAt) {
    fresh.add('recovery');
    authTimeMs = Math.max(authTimeMs, Date.parse(recoveryAt));
  }
  const txCreatedMs = Date.parse(tx.created_at);
  // 口令证据：会话签发于本次 transaction 之后；若已有更强的新鲜证据则不叠加 pwd
  //（passkey/recovery 登录同样产生新鲜会话，不能虚增为密码双因子）。
  if (fresh.size === 0 && providerTokenIat * 1000 >= txCreatedMs) {
    fresh.add('pwd');
    authTimeMs = Math.max(authTimeMs, providerTokenIat * 1000);
  }

  const merged = [...new Set([...(tx.amr ?? []), ...fresh])];
  let acr = acrForAmr(merged);
  let authTimeIso: string;
  if (merged.length === 0) {
    // SSO 基线：会话有效但本次事务内无新鲜认证 → pwd/loa1，auth_time 取会话 iat
    //（若调用方连 iat 都没有，则沿用 transaction 创建时间，绝不伪造更新鲜的值）。
    merged.push('pwd');
    acr = acrForAmr(merged);
    authTimeIso = providerTokenIat > 0
      ? new Date(providerTokenIat * 1000).toISOString()
      : tx.created_at;
  } else {
    authTimeIso = new Date(authTimeMs || Date.now()).toISOString();
  }
  return { amr: merged, acr, auth_time: authTimeIso };
}
