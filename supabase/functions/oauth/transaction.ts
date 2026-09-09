// ============================================================================
// GET /oauth/transaction?id=… —— Provider 前端授权页读取事务展示信息
//
// transaction id 本身是高熵能力（capability）：持有即代表授权请求链路的一方
// （业务前端刚被 302 过来）。只返回展示必需的最小集：client_name、scopes、
// requested_acr、status、是否需要登录由前端按会话自行判断。
// 绝不返回：state/nonce 原文、code_challenge 以外的绑定材料、user_id。
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { loadClient } from './_shared/clients.ts';
import { internalJson } from './_shared/errors.ts';
import { clientIp, oauthRateLimited } from './_shared/http.ts';
import { loadTransaction, markExpired } from './_shared/transactions.ts';

export async function handleTransactionQuery(req: Request): Promise<Response> {
  const id = new URL(req.url).searchParams.get('id') ?? '';
  const admin: SupabaseClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
  try {
    if (await oauthRateLimited(admin, `oauth_txq:${clientIp(req)}`, '10 minutes', 120)) {
      return internalJson(req, { ok: false, code: 'RATE_LIMITED' }, 429);
    }
  } catch (e) {
    console.error('[oauth/transaction] rate limit failed:', e);
    return internalJson(req, { ok: false, code: 'FALLBACK' }, 500);
  }

  try {
    const tx = await loadTransaction(admin, id);
    if (!tx) return internalJson(req, { ok: false, code: 'TX_INVALID' }, 404);
    if (Date.parse(tx.expires_at) <= Date.now()) {
      await markExpired(admin, tx);
      return internalJson(req, { ok: false, code: 'TX_EXPIRED' }, 400);
    }
    const client = await loadClient(admin, tx.client_id);
    if (!client || !client.enabled) {
      return internalJson(req, { ok: false, code: 'CLIENT_DISABLED' }, 400);
    }
    return internalJson(req, {
      ok: true,
      client_name: client.client_name,
      client_id: client.client_id,
      scopes: tx.scope.split(' ').filter(Boolean),
      requested_acr: tx.requested_acr,
      require_consent: client.require_consent,
      status: tx.status,
      has_state: !!tx.state_hash,
    });
  } catch (e) {
    console.error('[oauth/transaction]', e);
    return internalJson(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}
