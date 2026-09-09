// 手机号规范化与哈希（FR-2）。send-otp / verify-otp / bind / reset-password 共用。
// 统一归一为 +86XXXXXXXXXXX（中国大陆校园场景），哈希绑定 pepper 与用途前缀，
// 防止同一明文在不同用途下的摘要互撞/互相移植。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getPepper, sha256Hex } from './crypto.ts';

// 大陆手机号：可带 +86/86 前缀，11 位、1 开头第二位 3-9；允许空格/连字符分隔
const CN_MOBILE = /^(?:\+?86)?1[3-9]\d{9}$/;

/** 归一化手机号；非法返回 null */
export function normalizePhone(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const stripped = input.replace(/[\s-]/g, '');
  if (!CN_MOBILE.test(stripped)) return null;
  return `+86${stripped.replace(/^\+?86/, '')}`;
}

/** 手机号永久摘要（phone_bindings.phone_hash 存 hex 文本对应的 bytea） */
export async function phoneHash(normalizedPhone: string): Promise<string> {
  return sha256Hex(`${getPepper()}:phone:${normalizedPhone}`);
}

/** OTP 验证码摘要（绑定手机号，防跨主体哈希移植） */
export async function otpSecretHash(normalizedPhone: string, code: string): Promise<string> {
  return sha256Hex(`${getPepper()}:otp:${normalizedPhone}:${code}`);
}

/** 尾四位摘要展示（FR-2.3 脱敏） */
export function phoneLast4(normalizedPhone: string): string {
  return normalizedPhone.slice(-4);
}

/** 首三位（11 位号码的第 1-3 位）：配合尾四位组成 "138****1234" 式掩码，
 *  供换绑页「补全中段 4 位」的持有者自证提示。prefix 敏感度低（运营商号段），
 *  仅展示给登录后的号码持有者本人。 */
export function phonePrefix(normalizedPhone: string): string {
  return normalizedPhone.replace(/^\+86/, '').slice(0, 3);
}

/**
 * 核销 6 位验证码：比对未消费未过期的 otp_tokens 行，原子认领（单次有效）。
 * 成功返回该行 id（=一次性票据）；码错误/过期/已用/并发竞态一律返回 null，
 * 不可区分（防用户枚举）。verify-otp 与 reset-password 共用。
 */
export async function claimOtp(
  admin: SupabaseClient,
  normalizedPhone: string,
  code: string,
): Promise<string | null> {
  const hash = await phoneHash(normalizedPhone);
  const expected = `\\x${await otpSecretHash(normalizedPhone, code)}`;
  const { data: tokens, error: selErr } = await admin
    .from('otp_tokens')
    .select('id, secret_hash')
    .eq('subject', hash)
    .eq('purpose', 'phone_otp')
    .eq('consumed', false)
    .gt('expires_at', new Date().toISOString());
  if (selErr) throw selErr;

  const match = (tokens ?? []).find((t) => t.secret_hash === expected);
  if (!match) return null;

  // 原子认领：并发验证同一码时只有一个请求能成功（防重放竞态）
  const { data: claimed, error: updErr } = await admin
    .from('otp_tokens')
    .update({ consumed: true })
    .eq('id', match.id)
    .eq('consumed', false)
    .select('id');
  if (updErr) throw updErr;
  return claimed && claimed.length > 0 ? match.id : null;
}
