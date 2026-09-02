// ============================================================================
// L0 端点 4/12 · phone/bind（处理器，由 phone/index.ts 路由分发）
//
// 契约（design/05-数据库与API契约.md §三）：POST · 注册会话 · {otpToken, phone} → {ok}
//   注册流程强化的关键关节：邮箱认证通过后的必选一次性验证（FR-2.1）。
//   持 verify-otp 签发的一次性票据（otpToken = otp_tokens 行 id），本端点：
//     1) 校验票据归属（subject == phoneHash(phone)）、未过期、purpose='phone_otp'；
//     2) 原子删除票据行 → 单次使用（并发/重放只有一个成功）；
//     3) 号已绑他人 → PHONE_TAKEN（FR-2.2 一号一户）；
//     4) 写 phone_bindings（仅存 phone_hash + 尾四位，FR-2.3 脱敏）。
//   同用户重复绑定幂等返回 ok（票据照常核销）。
//
// 认证：端点默认 verify_jwt=false（配置为 phone 组级关闭），本处理器自行强制
//   会话——缺失/无效 JWT 一律 401（同 webauthn/register-* 纪律）。
//
// 响应：
//   200 {ok:true}                         绑定成功（或该用户已绑定，幂等）
//   200 {ok:false, code:'PHONE_TAKEN'}    手机号已绑定其他账号（FR-2.2）
//   400 {ok:false, code:'OTP_EXPIRED'}    票据缺失/已核销/过期/手机号不符（统一引导重新获取）
//   400/401/403/405/503 {ok:false, code:'FALLBACK'}  鉴权/守卫/参数校验
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/http.ts';
import { normalizePhone, phoneHash, phoneLast4 } from '../_shared/phone.ts';

export async function handleBind(req: Request): Promise<Response> {
  // ── 1. JWT 会话用户识别（强制；缺失/无效 → 401）──
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
    console.warn('[phone/bind] invalid JWT:', userErr?.message);
    return json(req, { ok: false, code: 'FALLBACK' }, 401);
  }
  const user = userData.user;

  // ── 2. 请求体：{ otpToken, phone } ──
  let b: unknown;
  try {
    b = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const body = b as { otpToken?: unknown; phone?: unknown };
  const tokenId = typeof body?.otpToken === 'string' && body.otpToken.trim()
    ? body.otpToken.trim()
    : null;
  const phone = normalizePhone(body?.phone);
  if (!tokenId || !phone) {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const hash = await phoneHash(phone);

    // ── 3. 票据存在性（首查→再删；删除即单次使用，同上）
    const { data: tokens, error: selErr } = await admin
      .from('otp_tokens')
      .select('id, subject')
      .eq('id', tokenId)
      .eq('purpose', 'phone_otp')
      .gt('expires_at', new Date().toISOString());
    if (selErr) throw selErr;
    const token = tokens?.[0];
    if (!token || token.subject !== hash) {
      // 缺失/已核销/过期/手机号与票据不符：与验证码错误同语义，防枚举统一提示
      return json(req, { ok: false, code: 'OTP_EXPIRED' });
    }

    // ── 4. 原子核销票据（单次有效；同票并发/重放只有一个能删到）──
    const { data: burned, error: delErr } = await admin
      .from('otp_tokens')
      .delete()
      .eq('id', token.id)
      .select('id');
    if (delErr) throw delErr;
    if (!burned || burned.length === 0) {
      return json(req, { ok: false, code: 'OTP_EXPIRED' }); // 首次与并发删间的竞态由删除守卫兜住
    }

    // ── 5. 一号一户（FR-2.2）：号已绑其他账号 → PHONE_TAKEN；已绑本账号 → 幂等 ok ──
    const { data: bound, error: bErr } = await admin
      .from('phone_bindings')
      .select('user_id')
      .eq('phone_hash', `\\x${hash}`)
      .maybeSingle();
    if (bErr) throw bErr;
    if (bound) {
      if (bound.user_id === user.id) {
        return json(req, { ok: true }); // 同一用户重放票据：票据已核销，绑定本就存在
      }
      return json(req, { ok: false, code: 'PHONE_TAKEN' }, 409);
    }

    // ── 6. 写绑定（仅存 hash + 尾四位，FR-2.3 脱敏；RLS 全拒，仅 service_role 可写）──
    const { error: insErr } = await admin.from('phone_bindings').insert({
      user_id: user.id,
      phone_hash: `\\x${hash}`,
      phone_last4: phoneLast4(phone),
      verified_via: 'sms',
    });
    if (insErr) throw insErr;

    return json(req, { ok: true });
  } catch (e) {
    console.error('[phone/bind]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}