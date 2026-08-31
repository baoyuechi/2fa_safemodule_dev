// 共享哈希工具（NFR-2 数据最小化：手机号/验证码只存摘要）。
// pepper 来自环境变量 MFA_HASH_PEPPER（本地 supabase/.env，生产 supabase secrets），
// 缺失时 fail-loud 拒绝处理——绝不静默降级为无盐哈希（手机号全域仅 10^11，无 pepper 可被穷举还原）。

export function getPepper(): string {
  const pepper = Deno.env.get('MFA_HASH_PEPPER');
  if (!pepper || pepper.length < 16) {
    console.error('[mfa] MFA_HASH_PEPPER 未配置或长度不足 16——拒绝处理（fail-loud）');
    throw new Error('hash pepper not configured');
  }
  return pepper;
}

export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** 字节转 hex 文本（PostgREST bytea 入参用 `\x` + hex） */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** base64url 解码（v13 起 ISO 工具移至 @simplewebauthn/server/helpers 子路径，此处自实现） */
export function base64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** hex 文本（含 PostgREST bytea 的 `\x` 前缀）转字节 */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('\\x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}
