// ============================================================================
// POST /oauth/consent —— 用户授权确认（Provider 内部端点，非标准 OAuth）
//
// 仅当 client.require_consent=true 且 transaction 处于 CONSENT_REQUIRED 时有效：
//   approve=true  → upsert oauth_consents（user+client+scopes），transaction
//                   标记 consent_granted，前端随后重试 /oauth/complete 出码。
//   approve=false → transaction CANCELLED，并返回带 access_denied 的回跳地址
//                  （前端 navigates，业务 callback 按标准错误处理）。
// 不能硬编码"全部自动授权"：是否跳 consent 由 client.require_consent 决定。
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { internalJson } from './_shared/errors.ts';
import { clientIp, oauthRateLimited } from './_shared/http.ts';
import { loadTransaction, markExpired, setTxStatus } from './_shared/transactions.ts';
import { loadClient } from './_shared/clients.ts';

type AdminClient = SupabaseClient;

export async function handleConsent(req: Request): Promise<Response> {
  let body: { transaction_id?: unknown; approve?: unknown };
  try {
    body = await req.json();
  } catch {
    return internalJson(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const txId = typeof body?.transaction_id === 'string' ? body.transaction_id : '';
  const approve = body?.approve === true;
  const deny = body?.approve === false;
  if (!txId || (!approve && !deny)) {
    return internalJson(req, { ok: false, code: 'FALLBACK' }, 400);
  }

  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return internalJson(req, { ok: false, code: 'AUTH_REQUIRED' }, 401);
  }
  const admin: AdminClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
  try {
    if (await oauthRateLimited(admin, `oauth_consent:${txId}:${clientIp(req)}`, '10 minutes', 30)) {
      return internalJson(req, { ok: false, code: 'RATE_LIMITED' }, 429);
    }
  } catch (e) {
    console.error('[oauth/consent] rate limit failed:', e);
    return internalJson(req, { ok: false, code: 'FALLBACK' }, 500);
  }

  const anon = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: header } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await anon.auth.getUser();
  if (userErr || !userData.user) {
    return internalJson(req, { ok: false, code: 'AUTH_REQUIRED' }, 401);
  }

  try {
    const tx = await loadTransaction(admin, txId);
    if (!tx) return internalJson(req, { ok: false, code: 'TX_INVALID' }, 400);
    if (Date.parse(tx.expires_at) <= Date.now()) {
      await markExpired(admin, tx);
      return internalJson(req, { ok: false, code: 'TX_EXPIRED' }, 400);
    }
    if (tx.user_id !== userData.user.id) {
      return internalJson(req, { ok: false, code: 'USER_MISMATCH' }, 403);
    }
    const client = await loadClient(admin, tx.client_id);
    if (!client || !client.enabled) {
      return internalJson(req, { ok: false, code: 'CLIENT_DISABLED' }, 403);
    }

    if (deny) {
      if (tx.status === 'CONSENT_REQUIRED') await setTxStatus(admin, tx, 'CANCELLED');
      const back = new URL(tx.redirect_uri);
      back.searchParams.set('error', 'access_denied');
      return internalJson(req, { ok: true, status: 'redirect', redirect_to: back.toString() });
    }

    // approve：仅在需要 consent 的事务上生效（trusted client 走不到这里也无害）。
    const scopes = tx.scope.split(' ').filter(Boolean);
    const { error: upErr } = await admin.from('oauth_consents').upsert(
      {
        user_id: userData.user.id,
        client_id: client.client_id,
        granted_scopes: scopes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,client_id' },
    );
    if (upErr) throw upErr;
    await admin.from('oauth_authorization_transactions')
      .update({ consent_granted: true })
      .eq('id', tx.id);
    return internalJson(req, { ok: true, status: 'consented' });
  } catch (e) {
    console.error('[oauth/consent]', e);
    return internalJson(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}
