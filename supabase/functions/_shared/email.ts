// 邮箱工具（account/* 端点组复用）：归一化、摘要、掩码、邮箱 OTP 核销。
// 数据最小化：仅存 SHA-256(pepper‖邮箱) 摘要（subject/email_hash），明文不落库。
// 邮箱这里无域名限制（第二辅助邮箱放开）；格式校验用 EMAIL_RE（与注册一致）。

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { getPepper, sha256Hex } from './crypto.ts';

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 归一化邮箱（trim + 小写 + 形状校验）；非法返回 null */
export function normalizeEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const e = input.trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

/** 邮箱永久摘要（subject / secondary_emails.email_hash 用 hex 文本，落库转 bytea） */
export async function emailHash(normalizedEmail: string): Promise<string> {
  return sha256Hex(`${getPepper()}:email:${normalizedEmail}`);
}

/** 邮箱 OTP 验证码摘要（绑定邮箱，防跨主体哈希移植） */
export async function emailOtpSecretHash(normalizedEmail: string, code: string): Promise<string> {
  return sha256Hex(`${getPepper()}:email-otp:${normalizedEmail}:${code}`);
}

/** 展示掩码：保留本地部分首字符 + 域名（如 a***@example.com）；无本地部分 → ***@domain */
export function emailMask(normalizedEmail: string): string {
  const at = normalizedEmail.indexOf('@');
  if (at <= 0) return '***';
  const local = normalizedEmail.slice(0, at);
  const domain = normalizedEmail.slice(at + 1);
  if (!domain.includes('.')) return '***';
  const visible = local[0];
  return `${visible}${'*'.repeat(local.length - 1)}@${domain}`;
}

/**
 * 核销 6 位邮箱验证码：比对未消费未过期 otp_tokens 行（purpose='email_otp',
 * subject=邮箱hash），哈希命中后原子认领（单次有效）。失败一律 null（防枚举）。
 */
export async function claimEmailOtp(
  admin: SupabaseClient,
  normalizedEmail: string,
  code: string,
): Promise<string | null> {
  const hash = await emailHash(normalizedEmail);
  const expected = `\\x${await emailOtpSecretHash(normalizedEmail, code)}`;
  const { data: tokens, error: selErr } = await admin
    .from('otp_tokens')
    .select('id, secret_hash')
    .eq('subject', hash)
    .eq('purpose', 'email_otp')
    .eq('consumed', false)
    .gt('expires_at', new Date().toISOString());
  if (selErr) throw selErr;

  const match = (tokens ?? []).find((t) => t.secret_hash === expected);
  if (!match) return null;

  const { data: claimed, error: updErr } = await admin
    .from('otp_tokens')
    .update({ consumed: true })
    .eq('id', match.id)
    .eq('consumed', false)
    .select('id');
  if (updErr) throw updErr;
  return claimed && claimed.length > 0 ? match.id : null;
}