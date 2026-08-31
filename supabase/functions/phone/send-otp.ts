// ============================================================================
// L0 端点 2/12 · phone/send-otp（处理器，由 phone/index.ts 路由分发）
//
// 契约（design/05-数据库与API契约.md §三）：POST · 无认证+Turnstile · {phone} → {ok}
//   同一手机号 24h ≤5 条（rate_limits 共享计数表）；号已绑定→PHONE_TAKEN（FR-2.2）。
//
// 当前阶段模拟发送（M0 短信凭据未就绪）：生成 6 位随机码，打印到服务端日志，
// 哈希后暂存 otp_tokens（TTL 300s）。真实短信通道接入时仅替换"发送"一节。
//
// 响应：
//   200 {ok:true}                       已发送（模拟）
//   200 {ok:false, code:'PHONE_TAKEN'}  手机号已被其他账号绑定（FR-2.2）
//   429 {ok:false, code:'RATE_LIMITED'} 24h 内超过 5 条
//   400/403/405/503 {ok:false, code:'FALLBACK'}  统一守卫与参数校验
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { config } from '../_shared/mfa.config.js';
import { json } from '../_shared/http.ts';
import { normalizePhone, otpSecretHash, phoneHash } from '../_shared/phone.ts';

export async function handleSendOtp(req: Request): Promise<Response> {
  // TODO(M2): Turnstile 人机校验（契约"无认证+Turnstile"）——待站主提供 CF site key/secret 后接入。

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const phone = normalizePhone((body as { phone?: unknown })?.phone);
  if (!phone) {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    const hash = await phoneHash(phone);

    // 限速：同一手机号 24h ≤5 条（原子计数落 Postgres 共享表，多实例安全）
    const { data: sent, error: rlErr } = await admin.rpc('rate_limit_check', {
      p_key: `send_otp:${hash}`,
      p_window: '24 hours',
    });
    if (rlErr) throw rlErr;
    if ((sent ?? 0) > config.rateLimits.sendOtpPerPhonePerDay) {
      return json(req, { ok: false, code: 'RATE_LIMITED' }, 429);
    }

    // FR-2.2 一号一户：手机号已绑定其他账号 → PHONE_TAKEN
    const { data: bound, error: bErr } = await admin
      .from('phone_bindings')
      .select('user_id')
      .eq('phone_hash', `\\x${hash}`)
      .maybeSingle();
    if (bErr) throw bErr;
    if (bound) {
      return json(req, { ok: false, code: 'PHONE_TAKEN' });
    }

    // 生成 6 位随机码 → 哈希暂存 otp_tokens（TTL 300s，单次有效）
    const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
    const secretHash = await otpSecretHash(phone, code);
    const { error: insErr } = await admin.from('otp_tokens').insert({
      purpose: 'phone_otp',
      subject: hash,
      secret_hash: `\\x${secretHash}`,
    });
    if (insErr) throw insErr;

    // 模拟短信：真实通道接入时，此行为替换为短信服务商 API 调用
    console.log(`[OTP] ${code} for ${phone}`);

    return json(req, { ok: true });
  } catch (e) {
    console.error('[phone/send-otp]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}
