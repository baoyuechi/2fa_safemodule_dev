// ============================================================================
// account/change-password（处理器）—— 登录后修改邮箱密码
//
// 契约：POST · JWT 会话 · {new_password, proof} → {ok}
//   proof 三种广播证明（用户修正#1：仅密码不算本人验证，必须走既有通道之一）：
//     {type:'phone', phone, otpToken}   持旧手机：码先经 reauth-phone-send 发到
//                                       与已绑手机比对一致的号码，票 subject=其 hash
//     {type:'email', otpToken}          主邮箱：票 subject=emailHash(主邮箱)
//     {type:'recovery', code}           恢复码：校验当前批 + 未消费，成功后**消费**
//                                       （用户修正#1：任何输入并正确的恢复码即作废），
//                                       密码更新成功后才标记 used_at
//   票据均原子核销（单次有效）；恢复码尝试限速 5 次/15min/用户。
//   改密落库走 admin.updateUserById（service_role；不要求近期重认证），成功即 ok；
//   当前会话保持有效（与 GoTrue secure_password_change=false 一致）。
//
// 响应：
//   200 {ok:true}                    已修改
//   200 {ok:false, code:'OTP_EXPIRED'}      phone/email 票据缺失/已核销/过期/不对应
//   200 {ok:false, code:'PHONE_MISMATCH'}   phone 票不对应当前绑定
//   200 {ok:false, code:'EMAIL_NOT_AVAILABLE'}  账号无主邮箱走不了 email 证明
//   200 {ok:false, code:'RECOVERY_INVALID'} 恢复码错/已用/无有效批次
//   429 {ok:false, code:'RATE_LIMITED'}     恢复码尝试超限
//   400/401/403/405/503 {ok:false, code:'FALLBACK'}
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { config } from '../_shared/mfa.config.js';
import { json } from '../_shared/http.ts';
import { requireSession } from '../_shared/session.ts';
import { normalizePhone, phoneHash } from '../_shared/phone.ts';
import { emailHash } from '../_shared/email.ts';
import { hashRecoveryCode, normalizeRecoveryCode } from '../_shared/recovery.ts';
import { burnOtpTicket } from '../_shared/otp.ts';

const MIN_PASSWORD_LENGTH = 6; // 与 GoTrue 默认密码策略对齐；强度掌上由前端 zxcvbn 把关

type Proof =
  | { type: 'phone'; phone?: unknown; otpToken?: unknown }
  | { type: 'email'; otpToken?: unknown }
  | { type: 'recovery'; code?: unknown };

export async function handleChangePassword(req: Request): Promise<Response> {
  const s = await requireSession(req);
  if (!s) return json(req, { ok: false, code: 'FALLBACK' }, 401);

  let body: { new_password?: unknown; proof?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const newPassword = typeof body?.new_password === 'string' ? body.new_password : '';
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const proof = (body?.proof ?? null) as Proof | null;
  if (!proof || typeof proof !== 'object' || typeof proof.type !== 'string') {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    // ── 1. 广播证明核验（各自核销对应一次性票据/恢复码）──
    if (proof.type === 'phone') {
      const { phone: phoneInput, otpToken: tokenId } = proof as { phone?: unknown; otpToken?: unknown };
      const phone = normalizePhone(phoneInput);
      if (!phone || typeof tokenId !== 'string' || !tokenId.trim()) {
        return json(req, { ok: false, code: 'FALLBACK' }, 400);
      }
      const hash = await phoneHash(phone);
      if (!(await burnOtpTicket(admin, tokenId.trim(), hash, 'phone_otp'))) {
        return json(req, { ok: false, code: 'OTP_EXPIRED' });
      }
      // 防御性再查：票对应当前绑定
      const { data: bound } = await admin
        .from('phone_bindings')
        .select('phone_hash')
        .eq('user_id', s.user.id)
        .maybeSingle();
      if (!bound || bound.phone_hash !== `\\x${hash}`) {
        return json(req, { ok: false, code: 'PHONE_MISMATCH' });
      }
    } else if (proof.type === 'email') {
      const { otpToken: tokenId } = proof as { otpToken?: unknown };
      const email = (s.user.email ?? '').trim().toLowerCase();
      if (!email || typeof tokenId !== 'string' || !tokenId.trim()) {
        return json(req, { ok: false, code: 'EMAIL_NOT_AVAILABLE' });
      }
      const hash = await emailHash(email);
      if (!(await burnOtpTicket(admin, tokenId.trim(), hash, 'email_otp'))) {
        return json(req, { ok: false, code: 'OTP_EXPIRED' });
      }
    } else if (proof.type === 'recovery') {
      const { code } = proof as { code?: unknown };
      if (typeof code !== 'string' || normalizeRecoveryCode(code).length !== 8) {
        return json(req, { ok: false, code: 'FALLBACK' }, 400);
      }
      // 限速：防穷举（正确码仍会被消费，故限额兜误输）
      const { data: attempts, error: rlErr } = await admin.rpc('rate_limit_check', {
        p_key: `recovery_reauth:${s.user.id}`,
        p_window: '15 minutes',
      });
      if (rlErr) throw rlErr;
      if ((attempts ?? 0) > config.rateLimits.recoveryReauthAttemptsPer15Min) {
        return json(req, { ok: false, code: 'RATE_LIMITED' }, 429);
      }

      const { data: enroll } = await admin
        .from('mfa_enrollments')
        .select('recovery_batch')
        .eq('user_id', s.user.id)
        .maybeSingle();
      const batch = (enroll as { recovery_batch?: number } | null)?.recovery_batch ?? 0;
      if (!batch) return json(req, { ok: false, code: 'RECOVERY_INVALID' });

      const codeHash = await hashRecoveryCode(code);
      const { data: rows } = await admin
        .from('recovery_codes')
        .select('id')
        .eq('user_id', s.user.id)
        .eq('batch', batch)
        .eq('code_hash', codeHash)
        .is('used_at', null)
        .limit(1);
      const row = (rows as Array<{ id: string }> | null)?.[0];
      if (!row) return json(req, { ok: false, code: 'RECOVERY_INVALID' });

      // 先改密后消费：更新失败则不烧码（用户不会丢了恢复码还改不了密码）
      const { error: pwErr } = await admin.auth.admin.updateUserById(s.user.id, { password: newPassword });
      if (pwErr) {
        console.error('[account/change-password] updateUserById failed:', pwErr.message);
        return json(req, { ok: false, code: 'FALLBACK' }, 500);
      }
      const { data: consumed, error: consumeErr } = await admin
        .from('recovery_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('id', row.id)
        .is('used_at', null)
        .select('id');
      if (consumeErr) throw consumeErr;
      if (!consumed || consumed.length === 0) {
        // 竞态（码已被并发消耗）：属正常防护，仍返回成功
        console.warn('[account/change-password] recovery code consumed by race (code reused)');
      }

      await logRisk(admin, s.user.id, 'recovery_code_reauth');
      return json(req, { ok: true });
    } else {
      return json(req, { ok: false, code: 'FALLBACK' }, 400);
    }

    // ── 2（phone/email 路径）改密落库 + 风控事件 ──
    const { error: pwErr } = await admin.auth.admin.updateUserById(s.user.id, { password: newPassword });
    if (pwErr) {
      console.error('[account/change-password] updateUserById failed:', pwErr.message);
      return json(req, { ok: false, code: 'FALLBACK' }, 500);
    }
    await logRisk(admin, s.user.id, 'password_changed');
    return json(req, { ok: true });
  } catch (e) {
    console.error('[account/change-password]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}

async function logRisk(admin: SupabaseClient, userId: string, signal: string): Promise<void> {
  const { error } = await admin.from('risk_events').insert({
    user_id: userId,
    signals: [signal],
    level: 'high',
    channel: 'account',
    action_taken: 'pass',
  });
  if (error) console.error('[account/change-password] risk event failed:', error.message);
}