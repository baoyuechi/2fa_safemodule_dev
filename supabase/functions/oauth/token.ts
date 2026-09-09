// ============================================================================
// POST /oauth/token —— code 兑换 + refresh 轮换（server-to-server）
//
//   grant_type=authorization_code：code（hash 查）+ client 认证 + redirect_uri
//     精确一致 + PKCE 重算比对 → access（JWT）+ ID Token（+ refresh 当
//     scope 含 offline_access）。code 原子消费：并发兑换只有一个成功，
//     其余 invalid_grant；重放记风险事件。
//   grant_type=refresh_token：opaque refresh rotation；旧 token 复用 → 整链
//     吊销 + 高风险事件 + invalid_grant。
//
// 协议：application/x-www-form-urlencoded（标准，优先）或 JSON（兼容）；
// 错误一律 OAuth JSON {error,…} + 正确 HTTP 状态（invalid_client → 401 +
// WWW-Authenticate），Cache-Control: no-store。绝不返回 MFA 的 {ok} 信封。
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { SUPPORTED_GRANT_TYPES } from './_shared/config.ts';
import { authenticateClient } from './_shared/clients.ts';
import { hashAuthCode, hashRefreshToken, pkceVerify, shortFp, timingSafeEqual } from './_shared/crypto.ts';
import { NO_STORE_HEADERS, oauthJsonError, oauthLog } from './_shared/errors.ts';
import { clientIp, oauthRateLimited } from './_shared/http.ts';
import { fetchUserIdentity, issueAccessToken, issueIdToken, issueRefreshToken } from './_shared/tokens.ts';

type AdminClient = SupabaseClient;

interface CodeRow {
  id: string;
  code_hash: string;
  transaction_id: string;
  client_id: string;
  user_id: string;
  redirect_uri: string;
  scope: string;
  nonce: string | null;
  auth_time: string;
  amr: string[];
  acr: string | null;
  code_challenge: string;
  code_challenge_method: string;
  expires_at: string;
  used_at: string | null;
}

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    const text = await req.text();
    const out: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams(text)) out[k] = v;
    return out;
  }
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function tokenJson(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE_HEADERS },
  });
}

export async function handleToken(req: Request): Promise<Response> {
  const admin: AdminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
  const body = await parseBody(req);
  const grant_type = body['grant_type'];
  const provisionalId = typeof body['client_id'] === 'string' ? (body['client_id'] as string) : 'unknown';

  const bad = (status: number, error: string, description: string, headers: Record<string, string> = {}) =>
    oauthJsonError(req, status, error, description, headers);

  try {
    if (await oauthRateLimited(admin, `oauth_token:${provisionalId}:${clientIp(req)}`, '10 minutes', 120)) {
      return bad(429, 'temporarily_unavailable', 'rate limited');
    }
  } catch (e) {
    console.error('[oauth/token] rate limit failed:', e);
    return bad(503, 'temporarily_unavailable', 'rate limiter unavailable');
  }

  if (typeof grant_type !== 'string' || !(SUPPORTED_GRANT_TYPES as readonly string[]).includes(grant_type)) {
    if (grant_type === undefined) return bad(400, 'invalid_request', 'grant_type is required');
    return bad(400, 'unsupported_grant_type', 'unsupported grant_type');
  }

  try {
    // ── client 认证（失败单独计数 + 401；绝不拿 CORS 当认证）──
    const authed = await authenticateClient(req, admin, body);
    if ('error' in authed) {
      try {
        const fails = await admin.rpc('rate_limit_check', {
          p_key: `oauth_client_auth_fail:${provisionalId}`,
          p_window: '15 minutes',
        });
        if ((fails as number ?? 0) > 20) {
          oauthLog('client_auth_rate_limited', { client_id: provisionalId });
        }
      } catch { /* 计数失败不阻断主流程 */ }
      oauthLog('token_invalid_client', { client_id: provisionalId, error: authed.error });
      return bad(401, authed.error, authed.description, {
        'WWW-Authenticate': 'Basic realm="oauth"',
      });
    }
    const { client } = authed.auth;

    if (grant_type === 'authorization_code') return await exchangeCode(req, admin, client.client_id, body, bad);
    return await rotateRefresh(req, admin, client.client_id, body, bad);
  } catch (e) {
    console.error('[oauth/token]', e);
    return bad(500, 'server_error', 'internal error');
  }
}

type Bad = (status: number, error: string, description: string, headers?: Record<string, string>) => Response;

async function lookupCode(admin: AdminClient, code: string): Promise<CodeRow | null> {
  const code_hash = await hashAuthCode(code);
  const { data, error } = await admin
    .from('oauth_authorization_codes')
    .select('*')
    .eq('code_hash', code_hash)
    .maybeSingle();
  if (error) throw error;
  return (data as CodeRow | null) ?? null;
}

async function recordRisk(
  admin: AdminClient,
  userId: string,
  signals: string[],
  level: 'normal' | 'medium' | 'high',
  channel: string,
  actionTaken: string,
): Promise<void> {
  try {
    await admin.from('risk_events').insert({
      user_id: userId,
      signals,
      level,
      channel,
      action_taken: actionTaken,
    });
  } catch (e) {
    console.error('[oauth/token] risk insert failed:', e);
  }
}

async function exchangeCode(
  req: Request,
  admin: AdminClient,
  clientId: string,
  body: Record<string, unknown>,
  bad: Bad,
): Promise<Response> {
  const code = body['code'];
  const redirect_uri = body['redirect_uri'];
  const code_verifier = body['code_verifier'];
  if (typeof code !== 'string' || !code) return bad(400, 'invalid_request', 'code is required');
  if (typeof redirect_uri !== 'string' || !redirect_uri) {
    return bad(400, 'invalid_request', 'redirect_uri is required');
  }
  if (typeof code_verifier !== 'string' || !code_verifier) {
    return bad(400, 'invalid_request', 'code_verifier is required');
  }

  const row = await lookupCode(admin, code);
  // 不可区分：不存在/过期/已用/错绑一律 invalid_grant（时序差异不携带身份信息）。
  const invalid = async (reason: string, userId?: string) => {
    oauthLog('token_invalid_grant', { client_id: clientId, error: reason });
    if (userId) {
      await recordRisk(admin, userId, ['oauth_code_invalid', reason], 'medium', 'oauth', 'deny');
    }
    return bad(400, 'invalid_grant', 'invalid or expired code');
  };
  if (!row) return invalid('not_found');
  if (row.client_id !== clientId) return invalid('client_mismatch', row.user_id);
  if (!timingSafeEqual(row.redirect_uri, redirect_uri)) {
    return invalid('redirect_mismatch', row.user_id);
  }
  if (row.used_at || Date.parse(row.expires_at) <= Date.now()) {
    return invalid(row.used_at ? 'reused' : 'expired', row.user_id);
  }
  if (row.code_challenge_method !== 'S256' || !(await pkceVerify(code_verifier, row.code_challenge))) {
    return invalid('pkce_failed', row.user_id);
  }

  // 原子消费（used_at 为空才置位；并发兑换只有一个成功）。
  const { data: consumed, error: consumeErr } = await admin
    .from('oauth_authorization_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .select('id');
  if (consumeErr) throw consumeErr;
  if (!consumed || (consumed as unknown[]).length === 0) {
    return invalid('race_reused', row.user_id);
  }

  const identity = await fetchUserIdentity(admin, row.user_id);
  const authTimeSec = Math.floor(Date.parse(row.auth_time) / 1000);
  const params = {
    client_id: clientId,
    user_id: row.user_id,
    scope: row.scope,
    amr: row.amr ?? [],
    acr: row.acr,
    auth_time: authTimeSec,
    nonce: row.nonce,
    email: identity.email,
    email_verified: identity.email_verified,
  };
  const access = await issueAccessToken(req, admin, params);
  const id_token = await issueIdToken(req, admin, params);
  const resp: Record<string, unknown> = {
    access_token: access.token,
    token_type: 'Bearer',
    expires_in: access.expires_in,
    scope: row.scope,
    id_token,
  };
  if (row.scope.split(' ').includes('offline_access')) {
    resp['refresh_token'] = await issueRefreshToken(admin, {
      client_id: clientId,
      user_id: row.user_id,
      scope: row.scope,
      amr: row.amr ?? [],
      acr: row.acr,
    });
  }
  await recordRisk(admin, row.user_id, ['oauth_token_exchange'], 'normal', 'oauth', 'pass');
  oauthLog('token_issued', { client_id: clientId, user_id: row.user_id, transaction_id: row.transaction_id });
  // transaction 终态（尽力而为，不阻断发 token）。
  await admin.from('oauth_authorization_transactions')
    .update({ status: 'REDIRECTED' })
    .eq('id', row.transaction_id)
    .eq('status', 'CODE_ISSUED')
    .then(() => {}, () => {});
  return tokenJson(req, resp);
}

interface RefreshRow {
  id: string;
  token_hash: string;
  client_id: string;
  user_id: string;
  scope: string;
  amr: string[];
  acr: string | null;
  expires_at: string;
  revoked_at: string | null;
  rotation_count: number;
}

async function rotateRefresh(
  req: Request,
  admin: AdminClient,
  clientId: string,
  body: Record<string, unknown>,
  bad: Bad,
): Promise<Response> {
  const presented = body['refresh_token'];
  if (typeof presented !== 'string' || !presented) {
    return bad(400, 'invalid_request', 'refresh_token is required');
  }
  const token_hash = await hashRefreshToken(presented);
  const { data, error } = await admin
    .from('oauth_refresh_tokens')
    .select('*')
    .eq('token_hash', token_hash)
    .maybeSingle();
  if (error) throw error;
  const row = data as RefreshRow | null;
  const invalid = () => {
    oauthLog('refresh_invalid_grant', { client_id: clientId });
    return bad(400, 'invalid_grant', 'invalid or expired refresh token');
  };
  if (!row || row.client_id !== clientId) {
    // 复用已轮换的旧 token 也会落到这里（查不到有效行）→ 整链吊销在 rotation 时
    // 对"命中 revoked 行"的分支处理；完全未知的 token 直接拒绝。
    return invalid();
  }
  if (row.revoked_at || Date.parse(row.expires_at) <= Date.now()) {
    // ── reuse detection：已作废/过期 token 再次出现 → 整链吊销 + 高风险 ──
    if (row.revoked_at) {
      await admin.from('oauth_refresh_tokens')
        .update({ revoked_at: new Date().toISOString() })
        .eq('user_id', row.user_id)
        .eq('client_id', row.client_id)
        .is('revoked_at', null);
      await recordRisk(admin, row.user_id, ['oauth_refresh_reuse'], 'high', 'oauth', 'revoke_chain');
      oauthLog('refresh_reuse_detected', { client_id: clientId, user_id: row.user_id });
    }
    return invalid();
  }

  // rotation：旧 token 原子作废（并发刷新只有一个成功）。
  const { data: rotated, error: rotErr } = await admin
    .from('oauth_refresh_tokens')
    .update({ revoked_at: new Date().toISOString(), rotation_count: row.rotation_count + 1 })
    .eq('id', row.id)
    .is('revoked_at', null)
    .select('id');
  if (rotErr) throw rotErr;
  if (!rotated || (rotated as unknown[]).length === 0) {
    await admin.from('oauth_refresh_tokens')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', row.user_id)
      .eq('client_id', row.client_id)
      .is('revoked_at', null);
    await recordRisk(admin, row.user_id, ['oauth_refresh_reuse'], 'high', 'oauth', 'revoke_chain');
    return invalid();
  }

  const identity = await fetchUserIdentity(admin, row.user_id);
  const now = Math.floor(Date.now() / 1000);
  const params = {
    client_id: clientId,
    user_id: row.user_id,
    scope: row.scope,
    amr: row.amr ?? [],
    acr: row.acr,
    auth_time: now, // refresh 时无新鲜认证：auth_time 取当前（会话延续），amr/acr 继承
    nonce: null,
    email: identity.email,
    email_verified: identity.email_verified,
  };
  const access = await issueAccessToken(req, admin, params);
  const id_token = await issueIdToken(req, admin, params);
  const nextRefresh = await issueRefreshToken(admin, {
    client_id: clientId,
    user_id: row.user_id,
    scope: row.scope,
    amr: row.amr ?? [],
    acr: row.acr,
  });
  // 链接轮换链（审计用；失败不阻断）。
  const { data: newRow } = await admin
    .from('oauth_refresh_tokens')
    .select('id')
    .eq('token_hash', await hashRefreshToken(nextRefresh))
    .maybeSingle();
  if (newRow) {
    await admin.from('oauth_refresh_tokens')
      .update({ replaced_by: (newRow as { id: string }).id })
      .eq('id', row.id)
      .then(() => {}, () => {});
  }
  oauthLog('refresh_rotated', { client_id: clientId, user_id: row.user_id });
  return tokenJson(req, {
    access_token: access.token,
    token_type: 'Bearer',
    expires_in: access.expires_in,
    scope: row.scope,
    id_token,
    refresh_token: nextRefresh,
  });
}
