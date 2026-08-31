// ============================================================================
// L0 端点 3/12 · phone/verify-otp（处理器，由 phone/index.ts 路由分发）
//
// 契约（design/05-数据库与API契约.md §三）：POST · 无认证 · {phone, code} → {ok, otpToken}
//   比对用户输入与 otp_tokens.secret_hash；成功后标记 consumed（单次有效），
//   返回的 otpToken = 该行 id，作为一次性票据供 phone/bind 在 expires_at 前使用
//   （票据 5min 有效 = 验证码原始 TTL；手机验证仅在首次注册时进行一次，FR-2）。
//
// 失败统一返回 OTP_EXPIRED：验证码错误/已过期/已使用/不存在不可区分
// （防用户枚举，同 W3C §14.6.2 思路），前端统一引导"重新获取"。
//
// 响应：
//   200 {ok:true, otpToken}             验证成功，票据供 phone/bind 使用
//   200 {ok:false, code:'OTP_EXPIRED'}  码错误/已过期/已使用/不存在
//   429 {ok:false, code:'RATE_LIMITED'} 5min 内验证尝试超限（防 6 位码穷举）
//   400/403/405/503 {ok:false, code:'FALLBACK'}  统一守卫与参数校验
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { config } from '../_shared/mfa.config.js';
import { json } from '../_shared/http.ts';
import { normalizePhone, otpSecretHash, phoneHash } from '../_shared/phone.ts';

const CODE_SHAPE = /^\d{6}$/;

export async function handleVerifyOtp(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const b = body as { phone?: unknown; code?: unknown };
  const phone = normalizePhone(b?.phone);
  const code = typeof b?.code === 'string' ? b.code.trim() : '';
  if (!phone || !CODE_SHAPE.test(code)) {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const hash = await phoneHash(phone);

    // 防穷举：验证尝试计数（含失败），10 次/5min/手机号
    const { data: attempts, error: rlErr } = await admin.rpc('rate_limit_check', {
      p_key: `verify_otp:${hash}`,
      p_window: '5 minutes',
    });
    if (rlErr) throw rlErr;
    if ((attempts ?? 0) > config.rateLimits.verifyOtpAttemptsPer5Min) {
      return json(req, { ok: false, code: 'RATE_LIMITED' }, 429);
    }

    // 取该手机号全部未消费且未过期的码，逐一哈希比对
    const expected = `\\x${await otpSecretHash(phone, code)}`;
    const { data: tokens, error: selErr } = await admin
      .from('otp_tokens')
      .select('id, secret_hash')
      .eq('subject', hash)
      .eq('purpose', 'phone_otp')
      .eq('consumed', false)
      .gt('expires_at', new Date().toISOString());
    if (selErr) throw selErr;

    const match = (tokens ?? []).find((t) => t.secret_hash === expected);
    if (!match) {
      return json(req, { ok: false, code: 'OTP_EXPIRED' });
    }

    // 原子认领：并发验证同一码时只有一个请求能成功（防重放竞态）
    const { data: claimed, error: updErr } = await admin
      .from('otp_tokens')
      .update({ consumed: true })
      .eq('id', match.id)
      .eq('consumed', false)
      .select('id');
    if (updErr) throw updErr;
    if (!claimed || claimed.length === 0) {
      return json(req, { ok: false, code: 'OTP_EXPIRED' });
    }

    return json(req, { ok: true, otpToken: match.id });
  } catch (e) {
    console.error('[phone/verify-otp]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}
