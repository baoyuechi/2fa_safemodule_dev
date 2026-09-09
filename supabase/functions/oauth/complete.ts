// ============================================================================
// POST /oauth/complete —— 把"现有登录"接入 authorization transaction（§十一）
//
// 本端点是整个 OAuth 接入最重要的粘合层，但它不复制任何 MFA 逻辑：
//   - 身份：Provider 会话（Authorization: Bearer <GoTrue access_token>，经
//     auth.getUser 验签名；沿用 _shared/session.ts 的 requireSession 纪律）。
//   - 认证强度：只读服务端证据（risk_events 新鲜行 + 会话新鲜度），见
//     _shared/transactions.ts deriveAuthContext；浏览器自称的 amr 永不采信。
//   - 现有 MFA 端点（webauthn/login-verify、recovery/use、GoTrue 口令）零改动。
//
// 成功且政策满足 → 签发一次性 authorization code（仅存 hash，多维绑定）并
// 返回 redirect_to（前端 navigates；code 走 URL 是标准行为，PKCE 保护兑换）。
// acr 未满足 → 403 ACR_NOT_SATISFIED（前端引导 step-up 后重试本端点）。
// client 要求 consent 且未授权 → 200 consent_required（前端走 /oauth/consent）。
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { acrSatisfies, oauthConfig } from './_shared/config.ts';
import { hashAuthCode, hashState, randomB64Url, shortFp, timingSafeEqual } from './_shared/crypto.ts';
import { loadClient } from './_shared/clients.ts';
import { internalJson, oauthLog } from './_shared/errors.ts';
import { clientIp, oauthRateLimited } from './_shared/http.ts';
import {
  decodeProviderJwtPayload,
  deriveAuthContext,
  loadTransaction,
  markExpired,
  setTxStatus,
} from './_shared/transactions.ts';

type AdminClient = SupabaseClient;

function adminClient(): AdminClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
}

async function requireProviderSession(req: Request): Promise<
  { user: { id: string }; tokenIat: number } | null
> {
  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: header } }, auth: { persistSession: false } },
  );
  const { data, error } = await anon.auth.getUser();
  if (error || !data.user) return null;
  const token = header.slice('Bearer '.length);
  const { iat } = decodeProviderJwtPayload(token);
  return { user: { id: data.user.id }, tokenIat: typeof iat === 'number' ? iat : 0 };
}

export async function handleComplete(req: Request): Promise<Response> {
  let body: { transaction_id?: unknown; state?: unknown };
  try {
    body = await req.json();
  } catch {
    return internalJson(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const txId = typeof body?.transaction_id === 'string' ? body.transaction_id : '';
  const state = typeof body?.state === 'string' ? body.state
    : body?.state === null || body?.state === undefined ? null : '';
  if (!txId || state === '') return internalJson(req, { ok: false, code: 'FALLBACK' }, 400);

  const admin = adminClient();
  try {
    if (await oauthRateLimited(admin, `oauth_complete:${txId}:${clientIp(req)}`, '10 minutes', 30)) {
      return internalJson(req, { ok: false, code: 'RATE_LIMITED' }, 429);
    }
  } catch (e) {
    console.error('[oauth/complete] rate limit failed:', e);
    return internalJson(req, { ok: false, code: 'FALLBACK' }, 500);
  }

  // ── 1. Provider 会话（未登录 → 前端回登录页）──
  const session = await requireProviderSession(req);
  if (!session) {
    return internalJson(req, { ok: false, code: 'AUTH_REQUIRED' }, 401);
  }

  try {
    // ── 2. transaction 装载 + 过期/终态检查 ──
    const tx = await loadTransaction(admin, txId);
    if (!tx) return internalJson(req, { ok: false, code: 'TX_INVALID' }, 400);
    if (Date.parse(tx.expires_at) <= Date.now()) {
      await markExpired(admin, tx);
      oauthLog('transaction_expired', { transaction_id: tx.id, client_id: tx.client_id });
      return internalJson(req, { ok: false, code: 'TX_EXPIRED' }, 400);
    }
    if (tx.consumed_at || tx.status === 'CODE_ISSUED' || tx.status === 'REDIRECTED') {
      return internalJson(req, { ok: false, code: 'TX_CONSUMED' }, 400);
    }
    if (!['AUTH_REQUIRED', 'PRIMARY_AUTHENTICATED', 'MFA_REQUIRED', 'MFA_AUTHENTICATED', 'CONSENT_REQUIRED', 'AUTHORIZED'].includes(tx.status)) {
      return internalJson(req, { ok: false, code: 'TX_INVALID' }, 400);
    }

    const client = await loadClient(admin, tx.client_id);
    if (!client || !client.enabled) {
      await setTxStatus(admin, tx, 'DENIED').catch(() => {});
      return internalJson(req, { ok: false, code: 'CLIENT_DISABLED' }, 403);
    }

    // ── 3. 用户绑定（transaction 首次认证绑定用户，之后必须同一用户）──
    if (tx.user_id && tx.user_id !== session.user.id) {
      oauthLog('transaction_user_mismatch', { transaction_id: tx.id, client_id: tx.client_id, user_id: session.user.id });
      return internalJson(req, { ok: false, code: 'USER_MISMATCH' }, 403);
    }

    // ── 4. Authentication Context（服务端证据推导 + 并集合并）──
    const ctx = await deriveAuthContext(admin, session.user.id, tx, session.tokenIat);
    const { error: updErr } = await admin
      .from('oauth_authorization_transactions')
      .update({
        user_id: session.user.id,
        auth_methods: [...new Set([...(tx.auth_methods ?? []), ...ctx.amr])],
        amr: ctx.amr,
        acr: ctx.acr,
        auth_time: ctx.auth_time,
      })
      .eq('id', tx.id);
    if (updErr) throw updErr;
    tx.user_id = session.user.id;
    tx.amr = ctx.amr;
    tx.acr = ctx.acr;
    tx.auth_time = ctx.auth_time;

    // 状态推进：有 acr 且满足要求 → MFA_AUTHENTICATED；loa1 基线 → PRIMARY_AUTHENTICATED
    if (tx.status === 'AUTH_REQUIRED') {
      await setTxStatus(admin, tx, 'PRIMARY_AUTHENTICATED');
    }
    const satisfied = acrSatisfies(ctx.acr, tx.requested_acr);
    if (!satisfied) {
      if (tx.status === 'PRIMARY_AUTHENTICATED') await setTxStatus(admin, tx, 'MFA_REQUIRED');
      oauthLog('acr_not_satisfied', {
        transaction_id: tx.id,
        client_id: tx.client_id,
        user_id: session.user.id,
      });
      return internalJson(req, {
        ok: false,
        code: 'ACR_NOT_SATISFIED',
        amr: ctx.amr,
        acr: ctx.acr,
        requested_acr: tx.requested_acr,
      }, 403);
    }
    if (tx.status === 'PRIMARY_AUTHENTICATED' || tx.status === 'MFA_REQUIRED') {
      await setTxStatus(admin, tx, 'MFA_AUTHENTICATED');
    }

    // ── 5. consent（trusted first-party 可免；require_consent 的 client 必须显式同意）──
    if (client.require_consent && !tx.consent_granted) {
      const { data: consent } = await admin
        .from('oauth_consents')
        .select('granted_scopes')
        .eq('user_id', session.user.id)
        .eq('client_id', client.client_id)
        .maybeSingle();
      const granted = (consent as { granted_scopes?: string[] } | null)?.granted_scopes ?? [];
      const need = tx.scope.split(' ').filter(Boolean);
      const covered = need.every((s) => granted.includes(s));
      if (!covered) {
        if (tx.status === 'MFA_AUTHENTICATED') await setTxStatus(admin, tx, 'CONSENT_REQUIRED');
        return internalJson(req, {
          ok: true,
          status: 'consent_required',
          client_name: client.client_name,
          scopes: need,
        });
      }
      await admin.from('oauth_authorization_transactions')
        .update({ consent_granted: true })
        .eq('id', tx.id);
    }
    if (tx.status === 'MFA_AUTHENTICATED' || tx.status === 'CONSENT_REQUIRED') {
      await setTxStatus(admin, tx, 'AUTHORIZED');
    }

    // ── 6. 签发 authorization code（高熵随机；服务端只存 hash；一次性）──
    const code = randomB64Url(32);
    const code_hash = await hashAuthCode(code);
    const { error: codeErr } = await admin.from('oauth_authorization_codes').insert({
      code_hash,
      transaction_id: tx.id,
      client_id: client.client_id,
      user_id: session.user.id,
      redirect_uri: tx.redirect_uri,
      scope: tx.scope,
      nonce: tx.nonce,
      auth_time: ctx.auth_time,
      amr: ctx.amr,
      acr: ctx.acr,
      code_challenge: tx.code_challenge,
      code_challenge_method: tx.code_challenge_method,
      expires_at: new Date(Date.now() + oauthConfig.authCodeTtl * 1000).toISOString(),
    });
    if (codeErr) throw codeErr;
    await admin.from('oauth_authorization_transactions')
      .update({ consumed_at: new Date().toISOString() })
      .eq('id', tx.id);
    await setTxStatus(admin, tx, 'CODE_ISSUED');

    const back = new URL(tx.redirect_uri);
    // code 明文只走这一次 URL（标准行为），绝不落库、不进日志。
    back.searchParams.set('code', code);
    // state 透传：必须与 transaction 的 state_hash 一致（防篡改/混淆）；
    // Provider 不依赖 state 做身份凭据，它只属于业务 client 的 CSRF 保护。
    if (tx.state_hash) {
      if (!state || !timingSafeEqual(await hashState(state), tx.state_hash)) {
        await setTxStatus(admin, tx, 'ERROR').catch(() => {});
        oauthLog('complete_state_mismatch', { transaction_id: tx.id, client_id: client.client_id });
        return internalJson(req, { ok: false, code: 'STATE_MISMATCH' }, 400);
      }
      back.searchParams.set('state', state);
    } else if (state) {
      await setTxStatus(admin, tx, 'ERROR').catch(() => {});
      return internalJson(req, { ok: false, code: 'STATE_MISMATCH' }, 400);
    }
    oauthLog('code_issued', {
      transaction_id: tx.id,
      client_id: client.client_id,
      user_id: session.user.id,
      code_fp: shortFp(code_hash),
    });
    return internalJson(req, {
      ok: true,
      status: 'redirect',
      redirect_to: back.toString(),
    });
  } catch (e) {
    console.error('[oauth/complete]', e);
    return internalJson(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}
