// 手机号规范化与哈希（FR-2）。send-otp / verify-otp / phone-bind 共用。
// 统一归一为 +86XXXXXXXXXXX（中国大陆校园场景），哈希绑定 pepper 与用途前缀，
// 防止同一明文在不同用途下的摘要互撞/互相移植。

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
