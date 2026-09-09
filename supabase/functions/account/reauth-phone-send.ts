// ============================================================================
// account/reauth-phone-send（处理器）
//
// 契约：POST · JWT 会话 · {phone} → {ok}
//   安全设计的关节（用户修正#2）：必须先由用户补全手机号，服务端与该账号已绑
//   手机号比对一致，**才**发送验证码；不一致（输错/改号/试探他人）一律
//   PHONE_MISMATCH 且绝不发码。既是本人操作证明的门槛，也让"旧手机号"在换绑
//   场景下可被真实核验。
//
//   复用 phone/verify-otp 领取 otpToken 作为一次性票据，再交由
//   account/change-password / account/phone-rebind 核销。
//
// 响应：
//   200 {ok:true}                        已发送（模拟）
//   200 {ok:false, code:'PHONE_NOT_BOUND'}  该账号未绑定任何手机（走不到此渠道）
//   200 {ok:false, code:'PHONE_MISMATCH'}   补全的号码与已绑手机不一致（不发码）
//   429 {ok:false, code:'RATE_LIMITED'}  24h 内发送超限
//   400/401/403/405/503 {ok:false, code:'FALLBACK'}
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { config } from '../_shared/mfa.config.js';
import { json } from '../_shared/http.ts';
import { requireSession } from '../_shared/session.ts';
import { normalizePhone, otpSecretHash, phoneHash } from '../_shared/phone.ts';
import { generateOtpCode } from '../_shared/otp.ts';

export async function handleReauthPhoneSend(req: Request): Promise<Response> {
  const s = await requireSession(req);
  if (!s) return json(req, { ok: false, code: 'FALLBACK' }, 401);

  let body: { phone?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const phone = normalizePhone(body?.phone);
  if (!phone) return json(req, { ok: false, code: 'FALLBACK' }, 400);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const hash = await phoneHash(phone);

    // 限速：按用户计（重认证与换绑旧机共用同一发送路径）
    const { data: sent, error: rlErr } = await admin.rpc('rate_limit_check', {
      p_key: `bound_phone_send:${s.user.id}`,
      p_window: '24 hours',
    });
    if (rlErr) throw rlErr;
    if ((sent ?? 0) > config.rateLimits.boundPhoneSendPerDay) {
      return json(req, { ok: false, code: 'RATE_LIMITED' }, 429);
    }

    // 已绑手机比对：未绑定 → PHONE_NOT_BOUND；不一致 → PHONE_MISMATCH（不发码）
    const { data: bound, error: bErr } = await admin
      .from('phone_bindings')
      .select('phone_hash')
      .eq('user_id', s.user.id)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!bound) return json(req, { ok: false, code: 'PHONE_NOT_BOUND' });
    if (bound.phone_hash !== `\\x${hash}`) {
      return json(req, { ok: false, code: 'PHONE_MISMATCH' });
    }

    // 生成 + 暂存 + 模拟发送（真实通道接入时仅替换发送一节）
    const code = generateOtpCode();
    const secretHash = await otpSecretHash(phone, code);
    const { error: insErr } = await admin.from('otp_tokens').insert({
      purpose: 'phone_otp',
      subject: hash,
      secret_hash: `\\x${secretHash}`,
    });
    if (insErr) throw insErr;
    console.log(`[OTP] ${code} for ${phone}`);

    return json(req, { ok: true });
  } catch (e) {
    console.error('[account/reauth-phone-send]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}