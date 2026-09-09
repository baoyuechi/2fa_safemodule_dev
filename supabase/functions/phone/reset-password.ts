// ============================================================================
// L0 端点 4b · phone/reset-password（处理器，由 phone/index.ts 路由分发）
//
// 契约（design/05 §三 扩展）：POST · 无认证（Turnstile 前置于 send-otp recovery）
//   {phone, code, new_password} → {ok}
//   手机找回密码的第二步：核销 6 位码（claimOtp 共享逻辑，单次有效）后，
//   按 phone_bindings 定位唯一账号，用 service role admin API 直接改密
//   （手机通道无 GoTrue recovery 会话，admin 改密是等价服务端路径）。
//   改密后该账号全部现存会话登出（updateUserById 默认使刷新令牌失效）。
//
// 响应：
//   200 {ok:true}                       改密成功（需用新密码重新登录）
//   200 {ok:false, code:'OTP_EXPIRED'}  码错误/已过期/已使用（不可区分，防穷举）
//   429 {ok:false, code:'RATE_LIMITED'} 5min 内验证尝试超限
//   400/403/405/503 {ok:false, code:'FALLBACK'}  统一守卫与参数校验
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { config } from '../_shared/mfa.config.js';
import { json } from '../_shared/http.ts';
import { claimOtp, normalizePhone, phoneHash } from '../_shared/phone.ts';

const CODE_SHAPE = /^\d{6}$/;
// 与主站/注册页一致的密码下限（≥8 位含字母+数字的前端强校验在 UI 层；服务端守底线）
const PASSWORD_MIN = 6;

export async function handleResetPassword(req: Request): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const b = body as { phone?: unknown; code?: unknown; new_password?: unknown };
  const phone = normalizePhone(b?.phone);
  const code = typeof b?.code === 'string' ? b.code.trim() : '';
  const newPassword = typeof b?.new_password === 'string' ? b.new_password : '';
  if (!phone || !CODE_SHAPE.test(code) || newPassword.length < PASSWORD_MIN) {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const hash = await phoneHash(phone);

    // 防穷举：与 verify-otp 同额度（10 次/5min/手机号）
    const { data: attempts, error: rlErr } = await admin.rpc('rate_limit_check', {
      p_key: `verify_otp:${hash}`,
      p_window: '5 minutes',
    });
    if (rlErr) throw rlErr;
    if ((attempts ?? 0) > config.rateLimits.verifyOtpAttemptsPer5Min) {
      return json(req, { ok: false, code: 'RATE_LIMITED' }, 429);
    }

    // 核销验证码（原子认领，失败不可区分）
    const claimed = await claimOtp(admin, phone, code);
    if (!claimed) {
      return json(req, { ok: false, code: 'OTP_EXPIRED' });
    }

    // 手机绑定 → 唯一账号（send-otp recovery 已保证绑定存在；仍兜底防空档）
    const { data: binding, error: bindErr } = await admin
      .from('phone_bindings')
      .select('user_id')
      .eq('phone_hash', `\\x${hash}`)
      .maybeSingle();
    if (bindErr) throw bindErr;
    if (!binding?.user_id) {
      return json(req, { ok: false, code: 'OTP_EXPIRED' });
    }

    // admin 改密（服务端路径；GoTrue 会吊销该用户现存刷新令牌）
    const { error: updErr } = await admin.auth.admin.updateUserById(binding.user_id, {
      password: newPassword,
    });
    if (updErr) throw updErr;

    return json(req, { ok: true });
  } catch (e) {
    console.error('[phone/reset-password]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}
