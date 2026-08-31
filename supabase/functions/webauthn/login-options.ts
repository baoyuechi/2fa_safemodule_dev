// ============================================================================
// L0 端点 7/12 · webauthn/login-options（处理器，由 webauthn/index.ts 分发）
//
// 契约（design/05-数据库与API契约.md §三）：POST · 无认证 ·
//   {}（discovery，可空 allowCredentials=通行证直登）或 {email} → {optionsJSON}
//   userVerification:'required'（指纹底线）；挑战暂存 purpose='login'。
//
// 反枚举（W3C §14.6.2 / spec 文档 §5.1）：email 未命中用户或无可用品凭据时，
//   返回同形状的 decoy options（空 allowCredentials + 暂存 user_id 为空的挑战），
//   响应不可区分——由 login-verify 端自然失败；邮箱路径存在性泄露为契约已知取舍，
//   主路径是 discovery（本项目常态体验，Part 2 §4）。
//
// 响应：
//   200 {ok:true, optionsJSON}  两条路径同形状
//   403/405/503 {ok:false, code:'FALLBACK'}  统一守卫
//
// 给端点 8（login-verify）的实现约定：decoy 与 discovery 挑战行的 user_id 为空，
//   请以 clientDataJSON.challenge 精确匹配未消费 login 挑战行，勿按 user_id 查。
// ============================================================================

import { generateAuthenticationOptions } from 'jsr:@simplewebauthn/server@^13.0.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { config } from '../_shared/mfa.config.js';
import { guard, json } from '../_shared/http.ts';

// 轻量形状校验：不合法形状与"用户不存在"走同一条 decoy 路径（无泄露差异）
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleLoginOptions(req: Request): Promise<Response> {
  // ── 1. 请求体：{email}（可缺省 → discovery）──
  let email: string | null = null;
  try {
    const body = (await req.json()) as { email?: unknown } | null;
    if (body && typeof body.email === 'string') {
      const normalized = body.email.trim().toLowerCase();
      if (EMAIL_SHAPE.test(normalized)) email = normalized;
    }
  } catch {
    // 空/非 JSON 体 → discovery 路径
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    // ── 2. 按邮箱定位用户（RPC：仅返回 id，无泄露面）──
    let userId: string | null = null;
    if (email) {
      const { data: uid, error: rpcErr } = await admin.rpc('find_auth_user_id_by_email', {
        p_email: email,
      });
      if (rpcErr) throw rpcErr;
      userId = (uid as string | null) ?? null;
    }

    // ── 3. 已绑定凭据 → allowCredentials（排除 suspended：不邀请尝试死凭据；
    //      账号级挂起在 verify 端拒绝，避免本端点泄露挂起状态）──
    let allowCredentials: { id: string; transports: string[] }[] = [];
    if (userId) {
      const { data: creds, error: cErr } = await admin
        .from('webauthn_credentials')
        .select('id, transports')
        .eq('user_id', userId)
        .eq('suspended', false);
      if (cErr) throw cErr;
      allowCredentials = (creds ?? []).map((c) => ({
        id: c.id,
        transports: c.transports ? String(c.transports).split(',').filter(Boolean) : [],
      }));
    }

    // ── 4. 生成登录选项（G7 timeout 300000；UV 底线）──
    const options = await generateAuthenticationOptions({
      rpID: config.rpID,
      allowCredentials,
      userVerification: 'required',
      timeout: config.timeoutMs,
    });

    // ── 5. 挑战暂存 purpose='login'（decoy/discovery 行 user_id 为空——表允许）──
    const { error: insErr } = await admin.from('webauthn_challenges').insert({
      user_id: userId,
      purpose: 'login',
      challenge: options.challenge,
      options,
    });
    if (insErr) throw insErr;

    return json(req, { ok: true, optionsJSON: options });
  } catch (e) {
    console.error('[webauthn/login-options]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}
