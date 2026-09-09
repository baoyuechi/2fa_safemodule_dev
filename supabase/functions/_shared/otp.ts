// 一次性票据通用工具（account/* 端点组复用；phone OTP 沿用 _shared/phone.ts 的 claimOtp）。
//
// burnOtpTicket：核销一次性票据（= verify 后的 otp_tokens 行 id）。select 校验
// 归属（subject）、用途（purpose）、未过期后原子 DELETE——删除成功即单次使用，
// 并发/重放只有一个能删到（同 phone/bind 纪律）。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

type AdminClient = SupabaseClient; // 与 _shared/phone.ts 同款宽类型，避免 createClient 泛型不兼容

/** 6 位随机验证码（CSPRNG；与 phone/send-otp 同款生成方式） */
export function generateOtpCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
}

/** 核销一次性票据：仅当该行属于给定 subject+purpose 且未过期时删除；成功 true，否则 false。
 * tokenId 非合法 uuid → false（防 PostgREST 对 uuid 列的非法输入 500）。
 * 行消耗顺序：先 uniqueness check（select 命中）再删除竞态守卫（delete 无行返回 false）。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function burnOtpTicket(
  admin: AdminClient,
  tokenId: string,
  subject: string,
  purpose: 'phone_otp' | 'email_otp',
): Promise<boolean> {
  if (!UUID_RE.test(tokenId)) return false;
  const { data: tokens, error: selErr } = await admin
    .from('otp_tokens')
    .select('id')
    .eq('id', tokenId)
    .eq('purpose', purpose)
    .eq('subject', subject)
    .gt('expires_at', new Date().toISOString());
  if (selErr) throw selErr;
  if (!tokens || tokens.length === 0) return false;

  const { data: burned, error: delErr } = await admin
    .from('otp_tokens')
    .delete()
    .eq('id', tokens[0].id)
    .select('id');
  if (delErr) throw delErr;
  return Array.isArray(burned) && burned.length > 0;
}