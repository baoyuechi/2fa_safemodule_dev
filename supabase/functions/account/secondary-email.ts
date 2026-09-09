// ============================================================================
// account/secondary-email-send / secondary-email-verify / secondary-email-remove
//
// 契约（用户修正#3：第二邮箱无域名限制，仅 格式合法 + ≠主邮箱 + 全局唯一）：
//   send   ：POST · JWT · {email} → {ok}   向该地址发验证码（模拟发送，日志可见）
//   verify ：POST · JWT · {email, otpToken} → {ok}   核销票据后落库（可覆盖自身上一条）
//   remove ：POST · JWT · {} → {ok}
//
// 数据最小化：secondary_emails 仅存 email_hash（bytea）+ email_mask，明文不落库。
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { config } from '../_shared/mfa.config.js';
import { json } from '../_shared/http.ts';
import { requireSession } from '../_shared/session.ts';
import { emailHash, emailMask, emailOtpSecretHash, normalizeEmail } from '../_shared/email.ts';
import { burnOtpTicket, generateOtpCode } from '../_shared/otp.ts';

export async function handleSecondaryEmailSend(req: Request): Promise<Response> {
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
  if (email === (s.user.email ?? '').trim().toLowerCase()) {
    return json(req, { ok: false, code: 'SE_IS_PRIMARY' });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const hash = await emailHash(email);

    // 本人已设置 → SE_ALREADY_SET（覆盖须先 remove 或走 verify 的替换语义：这里直接拦截并输向导）
    const { data: mine } = await admin
      .from('secondary_emails')
      .select('user_id')
      .eq('user_id', s.user.id)
      .maybeSingle();
    if (mine) return json(req, { ok: false, code: 'SE_ALREADY_SET' });

    // 全局唯一：被他人占用 → EMAIL_TAKEN
    const { data: other } = await admin
      .from('secondary_emails')
      .select('user_id')
      .eq('email_hash', `\\x${hash}`)
      .maybeSingle();
    if (other && other.user_id !== s.user.id) return json(req, { ok: false, code: 'EMAIL_TAKEN' });

    const { data: sent, error: rlErr } = await admin.rpc('rate_limit_check', {
      p_key: `secondary_email_send:${s.user.id}`,
      p_window: '24 hours',
    });
    if (rlErr) throw rlErr;
    if ((sent ?? 0) > config.rateLimits.secondaryEmailSendPerDay) {
      return json(req, { ok: false, code: 'RATE_LIMITED' }, 429);
    }

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
    console.error('[account/secondary-email-send]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}

export async function handleSecondaryEmailVerify(req: Request): Promise<Response> {
  const s = await requireSession(req);
  if (!s) return json(req, { ok: false, code: 'FALLBACK' }, 401);

  let body: { email?: unknown; otpToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const email = normalizeEmail(body?.email);
  const tokenId = typeof body?.otpToken === 'string' && body.otpToken.trim() ? body.otpToken.trim() : null;
  if (!email || !tokenId) return json(req, { ok: false, code: 'FALLBACK' }, 400);
  if (email === (s.user.email ?? '').trim().toLowerCase()) {
    return json(req, { ok: false, code: 'SE_IS_PRIMARY' });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const hash = await emailHash(email);

    // 票据核销（subject=该第二邮箱 hash；消失/过期/已被用于他处 → OTP_EXPIRED）
    if (!(await burnOtpTicket(admin, tokenId, hash, 'email_otp'))) {
      return json(req, { ok: false, code: 'OTP_EXPIRED' });
    }

    // 落库校验（重查防提交间隙变故）
    const { data: other } = await admin
      .from('secondary_emails')
      .select('user_id')
      .eq('email_hash', `\\x${hash}`)
      .maybeSingle();
    if (other && other.user_id !== s.user.id) return json(req, { ok: false, code: 'EMAIL_TAKEN' });

    // 覆盖自身上一条（幂等：先删后插，同一 PK）
    const { error: delErr } = await admin.from('secondary_emails').delete().eq('user_id', s.user.id);
    if (delErr) throw delErr;
    const { error: insErr } = await admin.from('secondary_emails').insert({
      user_id: s.user.id,
      email_hash: `\\x${hash}`,
      email_mask: emailMask(email),
    });
    if (insErr) {
      if (insErr.code === '23505') return json(req, { ok: false, code: 'EMAIL_TAKEN' });
      throw insErr;
    }

    const { error: riskErr } = await admin.from('risk_events').insert({
      user_id: s.user.id,
      signals: ['secondary_email_set'],
      level: 'high',
      channel: 'account',
      action_taken: 'pass',
    });
    if (riskErr) throw riskErr;

    return json(req, { ok: true });
  } catch (e) {
    console.error('[account/secondary-email-verify]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}

export async function handleSecondaryEmailRemove(req: Request): Promise<Response> {
  const s = await requireSession(req);
  if (!s) return json(req, { ok: false, code: 'FALLBACK' }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const { error: delErr } = await admin.from('secondary_emails').delete().eq('user_id', s.user.id);
    if (delErr) throw delErr;
    return json(req, { ok: true });
  } catch (e) {
    console.error('[account/secondary-email-remove]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}