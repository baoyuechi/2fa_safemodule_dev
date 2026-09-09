// ============================================================================
// POST /oauth/revoke —— Token 撤销（RFC 7009 子集）
//
//   - refresh_token：校验归属 client 后标记 revoked（client 认证：confidential
//     必须 secret；public 凭 client_id 归属）。
//   - access_token（本 Provider 的短命 JWT，无服务端状态）：验证签名后返回 200
//    （文档化为 no-op，靠短 TTL 收敛；RFC 7009 要求未知/已失效 token 同样 200）。
//   - 未知 token 同样 200（不泄露 token 有效性）。
// 第一阶段不做 access token 黑名单、不做业务/RP 联动 logout（见任务书 §二十八）。
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { authenticateClient } from './_shared/clients.ts';
import { hashRefreshToken } from './_shared/crypto.ts';
import { NO_STORE_HEADERS, oauthLog } from './_shared/errors.ts';
import { clientIp, oauthCors, oauthRateLimited } from './_shared/http.ts';
import { verifyAccessToken } from './_shared/tokens.ts';

async function parseBody(req: Request): Promise<Record<string, unknown>> {
  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('application/x-www-form-urlencoded')) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of new URLSearchParams(await req.text())) out[k] = v;
    return out;
  }
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function handleRevoke(req: Request): Promise<Response> {
  const cors = oauthCors(req);
  const ok = () =>
    new Response(null, { status: 200, headers: { ...NO_STORE_HEADERS, ...cors } });
  const admin: SupabaseClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
  const body = await parseBody(req);
  const token = body['token'];
  if (typeof token !== 'string' || !token) return ok(); // RFC 7009：缺 token 也 200
  const hint = typeof body['token_type_hint'] === 'string' ? body['token_type_hint'] : '';

  try {
    if (await oauthRateLimited(admin, `oauth_revoke:${clientIp(req)}`, '10 minutes', 120)) {
      return ok();
    }
  } catch {
    return ok();
  }

  try {
    // 先试 refresh（opaque，需 client 归属校验）。
    const refreshHash = await hashRefreshToken(token);
    const { data: refresh } = await admin
      .from('oauth_refresh_tokens')
      .select('id, client_id, user_id, revoked_at')
      .eq('token_hash', refreshHash)
      .maybeSingle();
    if (refresh) {
      const r = refresh as { id: string; client_id: string; user_id: string; revoked_at: string | null };
      const authed = await authenticateClient(req, admin, body);
      if ('error' in authed || authed.auth.client.client_id !== r.client_id) {
        oauthLog('revoke_denied', { client_id: r.client_id });
        return ok();
      }
      if (!r.revoked_at) {
        await admin.from('oauth_refresh_tokens')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', r.id);
      }
      oauthLog('refresh_revoked', { client_id: r.client_id, user_id: r.user_id });
      return ok();
    }

    // 再试 access（JWT，只能验证；短命无状态，文档化 no-op）。
    if (hint === '' || hint === 'access_token') {
      try {
        const v = await verifyAccessToken(req, admin, token);
        oauthLog('access_revoke_noop', { client_id: v.client_id, user_id: v.user_id });
      } catch { /* 未知/失效 token 同样 200 */ }
    }
    return ok();
  } catch (e) {
    console.error('[oauth/revoke]', e);
    return ok();
  }
}
