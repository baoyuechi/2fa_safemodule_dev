// ============================================================================
// supporting 端点 · recovery/status（处理器，由 recovery/index.ts 分发）
//
// 管理页展示用：POST · 会话 · {} → {remaining, batch}。
// 仅返回当前有效批次中未消费码的数量，不返回任何码明文/哈希。
//
// 认证：需有效 JWT 会话（同 regenerate）。
//
// 响应：
//   200 {ok:true, remaining, batch}
//   401/403/405/503 {ok:false, code:'FALLBACK'}  鉴权/守卫
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/http.ts';

export async function handleStatus(req: Request): Promise<Response> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json(req, { ok: false, code: 'FALLBACK' }, 401);
  }
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData.user) {
    console.warn('[recovery/status] invalid JWT:', userErr?.message);
    return json(req, { ok: false, code: 'FALLBACK' }, 401);
  }
  const user = userData.user;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const { data: enroll } = await admin
      .from('mfa_enrollments')
      .select('recovery_batch')
      .eq('user_id', user.id)
      .maybeSingle();
    const batch = (enroll as { recovery_batch?: number } | null)?.recovery_batch ?? 0;
    if (!batch) {
      return json(req, { ok: true, remaining: 0, batch: 0 });
    }
    const { data: rows, error: selErr } = await admin
      .from('recovery_codes')
      .select('id')
      .eq('user_id', user.id)
      .eq('batch', batch)
      .is('used_at', null);
    if (selErr) throw selErr;
    return json(req, { ok: true, remaining: (rows as Array<unknown> | null)?.length ?? 0, batch });
  } catch (e) {
    console.error('[recovery/status]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}
