// ============================================================================
// _shared/turnstile.ts —— Cloudflare Turnstile 服务端校验（siteverify）
//
// 契约：无认证端点防滥用，接入面与 token 来源同构（前端 Turnstile.tsx 产出）。
// ── siteverify 覆盖清单（唯一的服务端校验点，勿各自为政）──
//   · 登录/注册/邮箱找回：GoTrue [auth.captcha]（config.toml, provider=turnstile）
//     服务端统一校验 captcha_token，不经本模块；
//   · phone/send-otp：函数内调本模块（bind/recovery 两种 purpose 共用）；
//   · phone/reset-password：不改校验——契约是「Turnstile 前置于 send-otp
//     recovery」，第二步凭 send-otp 已核销的 OTP 改密，无需重复 token。
// token 一次性、5min 有效，由前端 widget 产出。
//
// secret 缺省时跳过校验（本地未配置场景兜底）；配置 CF 测试 secret
// （1x000...AA）时总是通过。生产：supabase secrets set TURNSTILE_SECRET=<正式值>。
// CF 后台 widget 模式须为 Managed（三档落点，见 Turnstile.tsx 头注释）——
// Invisible 永不弹框、Non-Interactive 常显 spinner，均不匹配"无感为主"。
// ============================================================================

interface SiteverifyResult {
  success: boolean;
  'error-codes'?: string[];
}

/** 校验 Turnstile token；通过返回 true。req 仅用于提取远端 IP（可选字段）。 */
export async function verifyTurnstileToken(req: Request, token: unknown): Promise<boolean> {
  const secret = Deno.env.get('TURNSTILE_SECRET');
  if (!secret) return true; // 本地未配置 → 跳过（生产必配，见 .env 注释）

  if (typeof token !== 'string' || token.length === 0) return false;

  const form = new FormData();
  form.append('secret', secret);
  form.append('response', token);
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (ip) form.append('remoteip', ip);

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      body: form,
    });
    const result = (await res.json()) as SiteverifyResult;
    if (!result.success) console.warn('[turnstile] siteverify failed:', result['error-codes']);
    return result.success;
  } catch (e) {
    // siteverify 不可达：fail-closed（防绕过），仅在 CF 故障时影响可用性
    console.error('[turnstile] siteverify unreachable:', e);
    return false;
  }
}
