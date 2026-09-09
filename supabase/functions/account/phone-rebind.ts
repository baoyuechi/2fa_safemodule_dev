// ============================================================================
// account/phone-rebind-send-new（处理器）—— 换绑第一步之二：新手机号发验证码
//
// 契约：POST · JWT 会话 · {phone} → {ok}
//   新号发送前检查一号一户：已绑其他账号 → PHONE_TAKEN（FR-2.2）；已绑本账号
//   （重复绑定同一号）→ 允许继续（票据照常核销，幂等）。
//   验证码交 phone/verify-otp 领取 otpToken，再送 account/phone-rebind 核销。
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { config } from '../_shared/mfa.config.js';
import { json } from '../_shared/http.ts';
import { requireSession } from '../_shared/session.ts';
import { normalizePhone, otpSecretHash, phoneHash } from '../_shared/phone.ts';
import { generateOtpCode } from '../_shared/otp.ts';

export async function handlePhoneRebindSendNew(req: Request): Promise<Response> {
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

    const { data: sent, error: rlErr } = await admin.rpc('rate_limit_check', {
      p_key: `rebind_new_send:${s.user.id}`,
      p_window: '24 hours',
    });
    if (rlErr) throw rlErr;
    if ((sent ?? 0) > config.rateLimits.rebindNewSendPerDay) {
      return json(req, { ok: false, code: 'RATE_LIMITED' }, 429);
    }

    // 一号一户：被其他账号绑定 → PHONE_TAKEN；本账号已绑 → 幂等放行
    const { data: bound, error: bErr } = await admin
      .from('phone_bindings')
      .select('user_id')
      .eq('phone_hash', `\\x${hash}`)
      .maybeSingle();
    if (bErr) throw bErr;
    if (bound && bound.user_id !== s.user.id) {
      return json(req, { ok: false, code: 'PHONE_TAKEN' }, 409);
    }

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
    console.error('[account/phone-rebind-send-new]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}

// ============================================================================
// account/phone-rebind（处理器）—— 双码齐验后原子换绑
//
// 契约：POST · JWT 会话 · {oldPhone, oldOtpToken, newPhone, newOtpToken} → {ok}
//   old 票：subject=phoneHash(oldPhone)（唯老号码经 reauth-phone-send 比对一致后才
//          发散码，故票即"持旧手机"证明）+ 再核当前绑定仍为 oldPhone；
//   new 票：subject=phoneHash(newPhone)；两票均原子删除核销（单次有效）；
//   新号被他人绑定 → PHONE_TAKEN；oldPhone==newPhone → 幂等 ok。
//   全部通过后删旧行插新行（phone_bindings PK=user_id，唯一索引保一号一户）。
// ============================================================================

import { phoneLast4, phonePrefix } from '../_shared/phone.ts';
import { burnOtpTicket } from '../_shared/otp.ts';

export async function handlePhoneRebind(req: Request): Promise<Response> {
  const s = await requireSession(req);
  if (!s) return json(req, { ok: false, code: 'FALLBACK' }, 401);

  let body: { oldPhone?: unknown; oldOtpToken?: unknown; newPhone?: unknown; newOtpToken?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const oldPhone = normalizePhone(body?.oldPhone);
  const newPhone = normalizePhone(body?.newPhone);
  const oldToken = typeof body?.oldOtpToken === 'string' && body.oldOtpToken.trim() ? body.oldOtpToken.trim() : null;
  const newToken = typeof body?.newOtpToken === 'string' && body.newOtpToken.trim() ? body.newOtpToken.trim() : null;
  if (!oldPhone || !newPhone || !oldToken || !newToken) {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const oldHash = await phoneHash(oldPhone);
    const newHash = await phoneHash(newPhone);

    // 1) 核销旧票（票 subject=oldHash ⇒ 该码确实发给了 oldPhone=已绑手机）
    if (!(await burnOtpTicket(admin, oldToken, oldHash, 'phone_otp'))) {
      return json(req, { ok: false, code: 'OTP_EXPIRED' });
    }
    // 2) 当前绑定仍等于 oldPhone（重认证至提交间可能已换绑）
    const { data: bound, error: bErr } = await admin
      .from('phone_bindings')
      .select('phone_hash, phone_last4')
      .eq('user_id', s.user.id)
      .maybeSingle();
    if (bErr) throw bErr;
    if (!bound || bound.phone_hash !== `\\x${oldHash}`) {
      return json(req, { ok: false, code: 'PHONE_MISMATCH' });
    }

    // 3) 核销新票
    if (!(await burnOtpTicket(admin, newToken, newHash, 'phone_otp'))) {
      return json(req, { ok: false, code: 'OTP_EXPIRED' });
    }

    // 4) 同号幂等：号码没换 → 票据已核销，直接成功
    if (oldHash === newHash) {
      return json(req, { ok: true });
    }

    // 5) 新号他人绑定检查（含并发竞态：insert 唯一的唯一索引兜底）
    const { data: taken, error: tErr } = await admin
      .from('phone_bindings')
      .select('user_id')
      .eq('phone_hash', `\\x${newHash}`)
      .maybeSingle();
    if (tErr) throw tErr;
    if (taken) {
      return json(req, { ok: false, code: 'PHONE_TAKEN' }, 409);
    }

    // 6) 删旧插新（同一用户行替换；唯一索引防并发重复写入）
    const { error: delErr } = await admin.from('phone_bindings').delete().eq('user_id', s.user.id);
    if (delErr) throw delErr;
    const { error: insErr } = await admin.from('phone_bindings').insert({
      user_id: s.user.id,
      phone_hash: `\\x${newHash}`,
      phone_last4: phoneLast4(newPhone),
      phone_prefix: phonePrefix(newPhone),
      verified_via: 'sms',
    });
    if (insErr) {
      if (insErr.code === '23505') return json(req, { ok: false, code: 'PHONE_TAKEN' }, 409);
      throw insErr;
    }

    const { error: riskErr } = await admin.from('risk_events').insert({
      user_id: s.user.id,
      signals: ['phone_rebound'],
      level: 'high',
      channel: 'account',
      action_taken: 'pass',
    });
    if (riskErr) throw riskErr;

    return json(req, { ok: true });
  } catch (e) {
    console.error('[account/phone-rebind]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}