// ============================================================================
// account/verify-options（处理器）
//
// 契约：POST · JWT 会话 · {} → {
//   ok, hasPasskeys, hasRecoveryCodes, hasPhone, phoneLast4, phoneFirst3,
//   hasSecondaryEmail, secondaryEmailMask
// }
//
// 用途：安全中心「修改密码」重认证渠道选择器 + 「手机号换绑/第二邮箱」状态展示。
// 服务端只回可用性布尔与脱敏摘要，绝不回手机号/邮箱明文（数据最小化）；
// phoneFirst3 为低敏号段前缀，配合尾四位组成 "138****1234" 式掩码。
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/http.ts';
import { requireSession } from '../_shared/session.ts';

export async function handleVerifyOptions(req: Request): Promise<Response> {
  const s = await requireSession(req);
  if (!s) return json(req, { ok: false, code: 'FALLBACK' }, 401);

  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );

  try {
    // 1) 可用通行密钥（未挂起）
    const { data: creds } = await admin
      .from('webauthn_credentials')
      .select('id')
      .eq('user_id', s.user.id)
      .eq('suspended', false)
      .limit(1);
    const hasPasskeys = Array.isArray(creds) && creds.length > 0;

    // 2) 当前批次是否还有未消费恢复码
    let hasRecoveryCodes = false;
    const { data: enroll } = await admin
      .from('mfa_enrollments')
      .select('recovery_batch')
      .eq('user_id', s.user.id)
      .maybeSingle();
    const batch = (enroll as { recovery_batch?: number } | null)?.recovery_batch ?? 0;
    if (batch) {
      const { data: codes } = await admin
        .from('recovery_codes')
        .select('id')
        .eq('user_id', s.user.id)
        .eq('batch', batch)
        .is('used_at', null)
        .limit(1);
      hasRecoveryCodes = Array.isArray(codes) && codes.length > 0;
    }

    // 3) 绑定手机（脱敏提示：尾四位 + 首三位号段；仅两者齐全才视为可换绑/可重认证）
    let hasPhone = false;
    let phoneLast4: string | null = null;
    let phoneFirst3: string | null = null;
    const { data: ph } = await admin
      .from('phone_bindings')
      .select('phone_last4, phone_prefix')
      .eq('user_id', s.user.id)
      .maybeSingle();
    if (ph) {
      const row = ph as { phone_last4?: string | null; phone_prefix?: string | null };
      hasPhone = Boolean(row.phone_last4 && row.phone_prefix);
      phoneLast4 = row.phone_last4 ?? null;
      phoneFirst3 = row.phone_prefix ?? null;
    }

    // 4) 第二辅助邮箱（掩码）
    let hasSecondaryEmail = false;
    let secondaryEmailMask: string | null = null;
    const { data: sec } = await admin
      .from('secondary_emails')
      .select('email_mask')
      .eq('user_id', s.user.id)
      .maybeSingle();
    if (sec) {
      hasSecondaryEmail = true;
      secondaryEmailMask = (sec as { email_mask?: string | null }).email_mask ?? null;
    }

    return json(req, {
      ok: true,
      hasPasskeys,
      hasRecoveryCodes,
      hasPhone,
      phoneLast4,
      phoneFirst3,
      hasSecondaryEmail,
      secondaryEmailMask,
    });
  } catch (e) {
    console.error('[account/verify-options]', e);
    return json(req, { ok: false, code: 'FALLBACK' }, 500);
  }
}