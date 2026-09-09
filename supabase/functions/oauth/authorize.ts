// ============================================================================
// GET /oauth/authorize —— Authorization Code + PKCE + OIDC nonce 入口
//
// 流程：严格校验 client/redirect_uri（精确匹配）/response_type/scope/
// PKCE S256/state/nonce/acr_values → 创建服务端 transaction（AUTH_REQUIRED，
// TTL 10 分钟）→ 302 到 Provider 前端授权页（?tx=…）。
//
// 前端登录（Password / Passkey / Recovery / OTP 复用现有页面与端点，零改动）
// 完成后调 POST /oauth/complete 推进 transaction 并出码；本端点自身不做任何
// 身份认证、不复制 WebAuthn/Recovery 逻辑。
//
// 错误：client/redirect_uri 不可信 → 直接 400（无法安全回跳）；其余 →
// redirect_uri?error=…&state=…（RFC 6749 §4.1.2.1）。
// ============================================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  acrSatisfies,
  oauthConfig,
  pickRequestedAcr,
  SUPPORTED_ACR_VALUES,
} from './_shared/config.ts';
import { hashNonce, hashState } from './_shared/crypto.ts';
import { loadClient, redirectUriAllowed, validateScope } from './_shared/clients.ts';
import {
  authorizeDirectError,
  authorizeRedirectError,
  NO_STORE_HEADERS,
  oauthLog,
} from './_shared/errors.ts';
import { clientIp, oauthRateLimited } from './_shared/http.ts';

type AdminClient = SupabaseClient;

const MAX_PARAM_LEN = 2048;

export async function handleAuthorize(req: Request, admin: AdminClient): Promise<Response> {
  const url = new URL(req.url);
  const q = url.searchParams;
  const response_type = q.get('response_type');
  const client_id = q.get('client_id') ?? '';
  const redirect_uri = q.get('redirect_uri') ?? '';
  const scopeParam = q.get('scope');
  const state = q.get('state');
  const nonce = q.get('nonce');
  const code_challenge = q.get('code_challenge');
  const code_challenge_method = q.get('code_challenge_method');
  const acr_values = q.get('acr_values');
  const prompt = q.get('prompt');
  const max_age = q.get('max_age');

  // ── 限速：client + IP（client 未知时按 unknown 计数，防枚举放大前先限流）──
  try {
    if (await oauthRateLimited(admin, `oauth_authorize:${client_id || 'unknown'}:${clientIp(req)}`, '10 minutes', 60)) {
      oauthLog('authorize_rate_limited', { client_id: client_id || 'unknown' });
      return authorizeDirectError(429, 'temporarily_unavailable');
    }
  } catch (e) {
    console.error('[oauth/authorize] rate limit failed:', e);
    return authorizeDirectError(503, 'temporarily_unavailable');
  }

  // ── 1. client 必须存在且 enabled（否则无法信任任何 redirect）──
  let client = null;
  try {
    client = client_id ? await loadClient(admin, client_id) : null;
  } catch (e) {
    console.error('[oauth/authorize] loadClient failed:', e);
    return authorizeDirectError(500, 'server_error');
  }
  if (!client || !client.enabled) {
    oauthLog('authorize_unknown_client', { client_id: client_id || 'missing' });
    return authorizeDirectError(400, 'unauthorized_client');
  }

  // ── 2. redirect_uri 精确匹配（失败则直接 400，绝不回跳到不可信地址）──
  if (!redirect_uri || !redirectUriAllowed(client, redirect_uri)) {
    oauthLog('authorize_bad_redirect', { client_id: client.client_id });
    return authorizeDirectError(400, 'invalid_request');
  }
  const err = (error: string, description?: string) =>
    authorizeRedirectError(redirect_uri, error, state, description);

  // ── 3. response_type 只支持 code ──
  if (response_type !== 'code') {
    oauthLog('authorize_bad_response_type', { client_id: client.client_id });
    return err('unsupported_response_type', 'only code is supported');
  }

  // ── 4. scope（必须 openid；已登记子集）──
  const scopeCheck = validateScope(client, scopeParam);
  if ('error' in scopeCheck) {
    oauthLog('authorize_bad_scope', { client_id: client.client_id, error: scopeCheck.error });
    return err(scopeCheck.error, scopeCheck.description);
  }

  // ── 5. PKCE 强制 S256（缺失 / plain / 超长一律拒绝）──
  if (!code_challenge || code_challenge.length > MAX_PARAM_LEN) {
    oauthLog('authorize_pkce_missing', { client_id: client.client_id });
    return err('invalid_request', 'code_challenge is required');
  }
  if (code_challenge_method !== 'S256') {
    oauthLog('authorize_pkce_method', { client_id: client.client_id });
    return err('invalid_request', 'only S256 is supported');
  }

  // ── 6. state 长度上限（原文透传回跳，服务端只存 hash）──
  if (state !== null && (state.length === 0 || state.length > MAX_PARAM_LEN)) {
    return err('invalid_request', 'bad state');
  }

  // ── 7. nonce：openid 下强制（与最终 ID Token 绑定）──
  if (!nonce || nonce.length === 0 || nonce.length > MAX_PARAM_LEN) {
    oauthLog('authorize_nonce_missing', { client_id: client.client_id });
    return err('invalid_request', 'nonce is required');
  }

  // ── 8. acr_values：只接受已文档化的 loa 值 ──
  if (acr_values !== null) {
    const recognized = pickRequestedAcr(acr_values);
    const anySupported = acr_values.split(/\s+/).filter(Boolean)
      .some((v) => (SUPPORTED_ACR_VALUES as readonly string[]).includes(v));
    if (!anySupported) {
      return err('invalid_request', 'unsupported acr_values');
    }
    void recognized;
  }
  const requested_acr = pickRequestedAcr(acr_values);
  void acrSatisfies;

  // ── 9. 本阶段不支持的参数：prompt / max_age / request object（无法兑现的不默许）──
  if (prompt !== null || max_age !== null || q.get('request') !== null || q.get('request_uri') !== null) {
    return err('invalid_request', 'unsupported parameter');
  }

  // ── 10. 创建 transaction（服务端掌握状态；浏览器只拿到高熵 id）──
  try {
    const { data, error } = await admin
      .from('oauth_authorization_transactions')
      .insert({
        client_id: client.client_id,
        redirect_uri,
        response_type: 'code',
        scope: scopeCheck.scope,
        state_hash: state ? await hashState(state) : null,
        nonce,
        nonce_hash: await hashNonce(nonce),
        code_challenge,
        code_challenge_method: 'S256',
        requested_acr,
        status: 'AUTH_REQUIRED',
        expires_at: new Date(Date.now() + oauthConfig.transactionTtl * 1000).toISOString(),
      })
      .select('id')
      .single();
    if (error) throw error;
    const txId = (data as { id: string }).id;
    oauthLog('transaction_created', { transaction_id: txId, client_id: client.client_id });
    // state 原文不进 transaction 表（只存 hash）；经 302 带到 Provider 前端，
    // 由前端在 complete 时原样交回，服务端验 hash 后才透传回业务 callback。
    // state 不是身份凭据，但验 hash 可防前端篡改/混淆。
    const loginBase = oauthConfig.loginUrl.replace(/\/+$/, '');
    const front = new URL(`${loginBase}/oauth/authorize`);
    front.searchParams.set('tx', txId);
    if (state) front.searchParams.set('state', state);
    return new Response(null, { status: 302, headers: { Location: front.toString(), ...NO_STORE_HEADERS } });
  } catch (e) {
    console.error('[oauth/authorize] insert tx failed:', e);
    return err('server_error');
  }
}
