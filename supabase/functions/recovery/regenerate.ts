// ============================================================================
// L0 端点 10/12 · recovery/regenerate（处理器，由 recovery/index.ts 分发）
//
// 契约（design/05-数据库与API契约.md §三）：POST · 强验证会话 ·
//   {} → {recoveryCodes}；批次号+1 · 旧批作废 · 敏感事件记服务端日志。
//
// 认证：需有效 JWT 会话（同 register-verify，经 getUser() 识别用户）。
//
// 响应：
//   200 {ok:true, recoveryCodes:[10]}  新批次（明文仅此一次返回）
//   401/403/405/503 {ok:false, code:'FALLBACK'}  鉴权/守卫
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/http.ts';
import { issueRecoveryBatch } from '../_shared/recovery.ts';

export async function handleRegenerate(req: Request): Promise<Response> {
  // ── 1. JWT 用户识别（同 register-verify）──
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
    console.warn('[recovery/regenerate] invalid JWT:', userErr?.message);
    return json(req, { ok: false, code: 'FALLBACK' }, 401);
  }
  const user = userData.user;

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const recoveryCodes = await issueRecoveryBatch(admin, user.id);
    console.info(`[recovery/regenerate] user ${user.id} issued new batch`);
    return json(req, { ok: true, recoveryCodes });
  } catch (e) {
    console.error('[recovery/regenerate]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}
