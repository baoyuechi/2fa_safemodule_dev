// ============================================================================
// account/reauth-email-send + account/email-verify（处理器）
//
// 契约：
//   reauth-email-send：POST · JWT 会话 · {email} → {ok}
//     用户修正#2 的邮箱侧：必须先补全邮箱，与该账号主邮箱比对一致**才**发码；
//     不一致 → EMAIL_MISMATCH 且不发码。发到主邮箱的码属重认证专用。
//   email-verify：POST · JWT 会话 · {email, code} → {ok, otpToken}
//     通用邮箱码核销（重认证主邮箱 / 第二辅助邮箱共用；subject=邮箱hash），
//     一次性票据 otpToken 交 account/change-password / account/secondary-email-verify 核销。
//
// 响应统一：OTP_EXPIRED（码错/过期/已用/无码，防枚举）；RATE_LIMITED(429)。
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { config } from '../_shared/mfa.config.js';
import { json } from '../_shared/http.ts';
import { requireSession } from '../_shared/session.ts';
import { claimEmailOtp, emailHash, emailOtpSecretHash, normalizeEmail } from '../_shared/email.ts';
import { generateOtpCode } from '../_shared/otp.ts';

const CODE_SHAPE = /^\d{6}$/;

export async function handleReauthEmailSend(req: Request): Promise<Response> {
  const s = await requireSession(req);
  if (!s) return json(req, { ok: false, code: 'FALLBACK' }, 401);

  let body: { email?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const email = normalizeEmail(body?.email);
  if (!email) return json(req, { ok: false, code: 'FALLBACK' }, 400);
  if (email !== (s.user.email ?? '').trim().toLowerCase()) {
    return json(req, { ok: false, code: 'EMAIL_MISMATCH' });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const { data: sent, error: rlErr } = await admin.rpc('rate_limit_check', {
      p_key: `reauth_email_send:${s.user.id}`,
      p_window: '24 hours',
    });
    if (rlErr) throw rlErr;
    if ((sent ?? 0) > config.rateLimits.emailOtpSendPerDay) {
      return json(req, { ok: false, code: 'RATE_LIMITED' }, 429);
    }

    const hash = await emailHash(email);
    const code = generateOtpCode();
    const secretHash = await emailOtpSecretHash(email, code);
    const { error: insErr } = await admin.from('otp_tokens').insert({
      purpose: 'email_otp',
      subject: hash,
      secret_hash: `\\x${secretHash}`,
    });
    if (insErr) throw insErr;
    console.log(`[EMAIL-OTP] ${code} for ${email}`); // 模拟发送：真实邮件网关接入时替换此节

    return json(req, { ok: true });
  } catch (e) {
    console.error('[account/reauth-email-send]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}

export async function handleEmailVerify(req: Request): Promise<Response> {
  const s = await requireSession(req);
  if (!s) return json(req, { ok: false, code: 'FALLBACK' }, 401);

  let body: { email?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const email = normalizeEmail(body?.email);
  const code = typeof body?.code === 'string' ? body.code.trim() : '';
  if (!email || !CODE_SHAPE.test(code)) {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const hash = await emailHash(email);
    const { data: attempts, error: rlErr } = await admin.rpc('rate_limit_check', {
      p_key: `email_verify:${hash}`,
      p_window: '5 minutes',
    });
    if (rlErr) throw rlErr;
    if ((attempts ?? 0) > config.rateLimits.accountOtpVerifyAttemptsPer5Min) {
      return json(req, { ok: false, code: 'RATE_LIMITED' }, 429);
    }

    const otpToken = await claimEmailOtp(admin, email, code);
    if (!otpToken) return json(req, { ok: false, code: 'OTP_EXPIRED' });

    return json(req, { ok: true, otpToken });
  } catch (e) {
    console.error('[account/email-verify]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}