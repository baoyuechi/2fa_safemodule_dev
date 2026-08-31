// ============================================================================
// L0 端点 5/12 · webauthn/register-options（处理器，由 webauthn/index.ts 分发）
//
// 契约（design/05-数据库与API契约.md §三）：POST · 会话 · {purpose:'enroll'|'rebind'} → {optionsJSON}
//   G7: timeout 300000ms；excludeCredentials 自动注入（防同认证器重复绑定）；
//   challenge 入 webauthn_challenges 暂存（TTL 300s，verify 端点比对后置 consumed）。
//   userVerification:'required'（指纹底线·Part 3 定值）。
//
// 认证：端点默认 verify_jwt=true；本处理器再经 anon 客户端 + Bearer JWT 识别用户
//   （supabase 官方模式），识别失败一律 401 FALLBACK。
//
// 响应：
//   200 {ok:true, optionsJSON}        PublicKeyCredentialCreationOptionsJSON（v13 已序列化）
//   400 {ok:false, code:'FALLBACK'}   purpose 非法
//   401 {ok:false, code:'FALLBACK'}   缺失/无效 JWT
//   403/405/503 {ok:false, code:'FALLBACK'}  统一守卫
// ============================================================================

import { generateRegistrationOptions } from 'jsr:@simplewebauthn/server@^13.0.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { config } from '../_shared/mfa.config.js';
import { guard, json } from '../_shared/http.ts';

const PURPOSES = new Set(['enroll', 'rebind']);

export async function handleRegisterOptions(req: Request): Promise<Response> {
  // ── 1. JWT 用户识别（端点 verify_jwt=true 已验签，这里取用户上下文）──
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
    console.warn('[webauthn/register-options] invalid JWT:', userErr?.message);
    return json(req, { ok: false, code: 'FALLBACK' }, 401);
  }
  const user = userData.user;

  // ── 2. purpose（契约参数，缺省 enroll）──
  let purpose = 'enroll';
  try {
    const body = (await req.json()) as { purpose?: unknown };
    if (body?.purpose !== undefined) {
      if (typeof body.purpose !== 'string' || !PURPOSES.has(body.purpose)) {
        return json(req, { ok: false, code: 'FALLBACK' }, 400);
      }
      purpose = body.purpose;
    }
  } catch {
    // 空/非 JSON 体：按缺省 purpose='enroll' 处理
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    // ── 3. 防重复绑定：已绑凭据（含 suspended——认证器里的私钥仍在，必须排除）──
    const { data: creds, error: cErr } = await admin
      .from('webauthn_credentials')
      .select('id, transports')
      .eq('user_id', user.id);
    if (cErr) throw cErr;
    const excludeCredentials = (creds ?? []).map((c) => ({
      id: c.id,
      transports: c.transports ? String(c.transports).split(',').filter(Boolean) : [],
    }));

    // ── 4. 生成注册选项（Part 3 定值）──
    // user handle：省略 userID，由库按次注册生成随机值——与契约约束
    // UNIQUE(webauthn_user_id, user_id)（Part 5 §一）一致，即 handle 逐凭据独立。
    // 注：规范 §1.2 "同一用户 handle 应一致"为 SHOULD；若未来改为每用户恒定
    // handle，需同步把约束改为 UNIQUE(webauthn_user_id)（属文档级决策，勿擅改）。
    const userName = user.email ?? user.id;
    const options = await generateRegistrationOptions({
      rpName: config.rpID, // L3 已弃用 rp.name 显示语义，安全起见填 rpID 同值
      rpID: config.rpID,
      userName,
      userDisplayName: userName, // 与 userName 同值，规避 Chrome displayName 空 bug（tech 清单 §1.6）
      attestationType: config.webauthn.attestation,
      excludeCredentials,
      authenticatorSelection: {
        residentKey: config.webauthn.residentKey,
        userVerification: 'required', // 指纹底线
        authenticatorAttachment: config.webauthn.authenticatorAttachment,
      },
      timeout: config.timeoutMs, // G7: 300000
    });

    // ── 5. challenge + 整包 options 暂存（expires_at 表默认 now()+300s）──
    const { error: insErr } = await admin.from('webauthn_challenges').insert({
      user_id: user.id,
      purpose,
      challenge: options.challenge,
      options,
    });
    if (insErr) throw insErr;

    return json(req, { ok: true, optionsJSON: options });
  } catch (e) {
    console.error('[webauthn/register-options]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}
