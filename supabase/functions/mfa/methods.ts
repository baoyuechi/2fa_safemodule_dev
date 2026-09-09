// ============================================================================
// L0 端点组增补 · mfa/methods（处理器，由 mfa/index.ts 分发）
//
// 契约：POST · 无认证 ·
//   {email} → {ok, hasPasskeys, hasRecoveryCodes}（布尔字段，无敏感材料）
//
// 用途：登录页「选择登录方式」步按邮箱判断是否展示「使用您的通行密钥」与
//   「使用安全码」入口；未绑定/未生成 → false → 前端直接隐藏对应入口
//   （Google 式：仅列出可用方式，而不是给出一个必然失败的选择）。
//
// 反枚举纪律（对齐 login-options 的 decoy 与 recovery/use 的统一无效口径）：
//   - 形状非法 / 域外（allowedEmailDomains）/ 查无用户 → 一律返回全 false，
//     响应不可区分——不对"域内有此人"提供额外探测差异；
//   - 域外直接短路不查库（也免去限速计数，省 DB 开销）；
//   - 邮箱存在性泄露与本项目既有取舍一致（webauthn/login-options 头部注释
//     已声明为契约已知取舍）；本端点只多暴露两个布尔值，且封闭校域风险可控。
//
// 限速：同一邮箱 1h ≤ N 次（N 见 mfa.config.js rateLimits.methodsPerEmailPerHour），
//   防定向骚扰/刷新风暴，超限 429 RATE_LIMITED。
//
// 响应：
//   200 {ok:true, hasPasskeys, hasRecoveryCodes}
//   429 {ok:false, code:'RATE_LIMITED'}
//   400/403/405/503 {ok:false, code:'FALLBACK'}  守卫
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { config } from '../_shared/mfa.config.js';
import { json } from '../_shared/http.ts';
import { getPepper, sha256Hex } from '../_shared/crypto.ts';

// 与 webauthn/login-options 相同的轻量形状校验：不合法 → 全 false（无泄露差异）
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function handleMethods(req: Request): Promise<Response> {
  let body: { email?: unknown } | null;
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }

  // ── 1. 入参归一；形状非法 → 全 false 直接返回（统一口径，不查库）──
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!email || !EMAIL_SHAPE.test(email)) {
    return json(req, { ok: true, hasPasskeys: false, hasRecoveryCodes: false });
  }

  // ── 2. 域外邮箱直接短路：系统内不可能存在 → 全 false（免 DB / 免限速）──
  const domain = email.slice(email.indexOf('@') + 1).toLowerCase();
  if (!config.allowedEmailDomains.includes(domain)) {
    return json(req, { ok: true, hasPasskeys: false, hasRecoveryCodes: false });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    // ── 3. 限速：同一邮箱 1h ≤ N 次（原子计数落共享表，多实例安全）──
    const rateKey = `methods:${await sha256Hex(getPepper() + email)}`;
    const { data: attempts, error: rlErr } = await admin.rpc('rate_limit_check', {
      p_key: rateKey,
      p_window: '1 hour',
    });
    if (rlErr) throw rlErr;
    if ((attempts ?? 0) > config.rateLimits.methodsPerEmailPerHour) {
      return json(req, { ok: false, code: 'RATE_LIMITED' }, 429);
    }

    // ── 4. 邮箱定位用户；无匹配 → 全 false（统一口径，不泄露存在性）──
    const { data: userId, error: rpcErr } = await admin.rpc('find_auth_user_id_by_email', {
      p_email: email,
    });
    if (rpcErr) throw rpcErr;
    if (!userId) {
      return json(req, { ok: true, hasPasskeys: false, hasRecoveryCodes: false });
    }

    // ── 5. 是否有可用（未挂起）通行密钥 ──
    const { data: creds, error: cErr } = await admin
      .from('webauthn_credentials')
      .select('id')
      .eq('user_id', userId)
      .eq('suspended', false)
      .limit(1);
    if (cErr) throw cErr;
    const hasPasskeys = Array.isArray(creds) && creds.length > 0;

    // ── 6. 当前批次是否还有未消费恢复码（对齐 use.ts：仅认当前批）──
    let hasRecoveryCodes = false;
    const { data: enroll } = await admin
      .from('mfa_enrollments')
      .select('recovery_batch')
      .eq('user_id', userId)
      .maybeSingle();
    const batch = (enroll as { recovery_batch?: number } | null)?.recovery_batch ?? 0;
    if (batch) {
      const { data: codes, error: rcErr } = await admin
        .from('recovery_codes')
        .select('id')
        .eq('user_id', userId)
        .eq('batch', batch)
        .is('used_at', null)
        .limit(1);
      if (rcErr) throw rcErr;
      hasRecoveryCodes = Array.isArray(codes) && codes.length > 0;
    }

    return json(req, { ok: true, hasPasskeys, hasRecoveryCodes });
  } catch (e) {
    console.error('[mfa/methods]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}

// 本地测试（supabase start 后）：
//   有四态可验：有凭据/有恢复码用户 → 双 true；仅有密码 → 双 false；
//   域外邮箱 → 双 false（不查库）；未注册域内邮箱 → 双 false。
//   curl -s -X POST http://127.0.0.1:54321/functions/v1/mfa/methods \
//     -H 'Content-Type: application/json' -d '{"email":"you@isawuhan.com"}'