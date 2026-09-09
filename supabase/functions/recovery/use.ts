// ============================================================================
// L0 端点 9/12 · recovery/use（处理器，由 recovery/index.ts 分发）
//
// 契约（design/05-数据库与API契约.md §三）：POST · 无认证 ·
//   {email, code} → {ok, token_hash}；
//   hash 比对 · 标记 used_at · 风控高事件 · 仅消费该码（其余码继续有效）。
//
// Google 备用码语义：通行密钥/密码不可用时的救命通道。码一次性（used_at 非空
// 即作废），仅认当前批次（换批后旧码失效）。失败原因统一 RECOVERY_INVALID，
// 不区分"邮箱无此人/无有效批次/码错误/码已用过"（防枚举）。
// 只作废被使用的那一个：同批其余码保持有效（用户修正：不整批作废、不换批、
// 不强制重绑）。登录后走正常会话继续使用，剩余码数递减。
//
// 认证：端点组 verify_jwt=false；处理器内无 JWT，靠"邮箱+码"双因素定位用户。
// 穷举防护：同一邮箱 1h ≤ N 次尝试（N 见 mfa.config.js），超限 429 RATE_LIMITED。
//
// 响应：
//   200 {ok:true, token_hash}  消费成功（前端兑换会话继续）
//   400 {ok:false, code:'RECOVERY_INVALID'}  码无效/已用/过期批次/邮箱无码
//   429 {ok:false, code:'RATE_LIMITED'}      尝试过于频繁
//   401/403/405/503 {ok:false, code:'FALLBACK'}  鉴权/守卫
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { config } from '../_shared/mfa.config.js';
import { json } from '../_shared/http.ts';
import { getPepper, sha256Hex } from '../_shared/crypto.ts';
import { hashRecoveryCode, normalizeRecoveryCode } from '../_shared/recovery.ts';

export async function handleRecoveryUse(req: Request): Promise<Response> {
  let body: { email?: unknown; code?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const code = typeof body?.code === 'string' ? body.code : '';
  if (!email || !code || normalizeRecoveryCode(code).length !== 8) {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    // ── 1. 限速：同一邮箱 1h ≤ N 次（原子计数落共享表，多实例安全）──
    const rateKey = `recovery_use:${await sha256Hex(getPepper() + email)}`;
    const { data: attempts, error: rlErr } = await admin.rpc('rate_limit_check', {
      p_key: rateKey,
      p_window: '1 hour',
    });
    if (rlErr) throw rlErr;
    if ((attempts ?? 0) > config.rateLimits.recoveryUseAttemptsPerHour) {
      return json(req, { ok: false, code: 'RATE_LIMITED' }, 429);
    }

    // ── 2. 邮箱定位用户（无匹配 → 统一无效，不泄露存在性）──
    const { data: userId, error: rpcErr } = await admin.rpc('find_auth_user_id_by_email', {
      p_email: email,
    });
    if (rpcErr) throw rpcErr;
    if (!userId) {
      return json(req, { ok: false, code: 'RECOVERY_INVALID' });
    }

    // ── 3. 当前有效批次 ──
    const { data: enroll } = await admin
      .from('mfa_enrollments')
      .select('recovery_batch')
      .eq('user_id', userId)
      .maybeSingle();
    const batch = (enroll as { recovery_batch?: number } | null)?.recovery_batch ?? 0;
    if (!batch) {
      return json(req, { ok: false, code: 'RECOVERY_INVALID' });
    }

    // ── 4. 哈希比对：仅当前批 + 未消费 ──
    const codeHash = await hashRecoveryCode(code);
    const { data: rows } = await admin
      .from('recovery_codes')
      .select('id')
      .eq('user_id', userId)
      .eq('batch', batch)
      .eq('code_hash', codeHash)
      .is('used_at', null)
      .limit(1);
    const row = (rows as Array<{ id: string }> | null)?.[0];
    if (!row) {
      return json(req, { ok: false, code: 'RECOVERY_INVALID' });
    }

    // ── 5. 原子消费（used_at 为空才置位；并发复用只有一个成功）──
    const { data: consumed, error: consumeErr } = await admin
      .from('recovery_codes')
      .update({ used_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('used_at', null)
      .select('id');
    if (consumeErr) throw consumeErr;
    if (!consumed || (consumed as Array<unknown>).length === 0) {
      return json(req, { ok: false, code: 'RECOVERY_INVALID' });
    }

    // ── 6. 风控高事件（契约要求）──
    const { error: riskErr } = await admin.from('risk_events').insert({
      user_id: userId,
      signals: ['recovery_code_used'],
      level: 'high',
      channel: 'recovery',
      action_taken: 'pass',
    });
    if (riskErr) throw riskErr;

    // ── 7. 会话桥接：generateLink 签发一次性 token_hash（同 login-verify）──
    const { data: userData, error: uErr } = await admin.auth.admin.getUserById(userId as string);
    if (uErr || !userData.user?.email) {
      console.error('[recovery/use] getUserById failed:', uErr?.message);
      return json(req, { ok: false, code: 'FALLBACK' }, 500);
    }
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: userData.user.email,
    });
    if (linkErr || !link.properties?.hashed_token) {
      console.error('[recovery/use] generateLink failed:', linkErr?.message);
      return json(req, { ok: false, code: 'FALLBACK' }, 500);
    }

    // 注：仅消费该码（used_at 已置位），同批其余码继续有效（用户修正：不整批作废）。
    return json(req, { ok: true, token_hash: link.properties.hashed_token });
  } catch (e) {
    console.error('[recovery/use]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}
