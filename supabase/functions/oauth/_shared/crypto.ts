// ============================================================================
// OAuth Provider · 密码学原语（无外部依赖，WebCrypto 实现）
//
// 纪律：
//   - code / refresh_token / client_secret 明文永不落库，只存带域分隔的
//     SHA-256(pepper‖域‖明文) hex 摘要（pepper 复用 _shared/crypto.ts 的
//     fail-loud 机制，绝不降级无盐）。
//   - 日志只记录 hash 前缀/关联 id，原文（code/verifier/secret/token）禁日志。
// ============================================================================

import { getPepper, sha256Hex } from '../../_shared/crypto.ts';

const B64U = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** CSPRNG 高熵随机 → base64url（无 padding）。 */
export function randomB64Url(nBytes = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(nBytes));
  let out = '';
  // 3 字节 → 4 字符
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const n = (b0 << 16) | (b1 << 8) | b2;
    out += B64U[(n >> 18) & 63] + B64U[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64U[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64U[n & 63];
  }
  return out;
}

export function b64uEncode(input: Uint8Array | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64uDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

/** 近似常量时间比较（防时序侧信道；长度不同也走完全部比较）。 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const len = Math.max(ab.length, bb.length);
  let diff = ab.length ^ bb.length;
  for (let i = 0; i < len; i++) {
    diff |= (ab[i % ab.length] ?? 0) ^ (bb[i % bb.length] ?? 0);
  }
  return diff === 0;
}

/** SHA-256 hex（域分隔，防跨用途摘要移植）。 */
async function domainHash(domain: string, secret: string): Promise<string> {
  return sha256Hex(`${getPepper()}:oauth-${domain}:${secret}`);
}

export const hashAuthCode = (code: string) => domainHash('code', code);
export const hashRefreshToken = (token: string) => domainHash('refresh', token);
export const hashClientSecret = (secret: string) => domainHash('client-secret', secret);
export const hashState = (state: string) => domainHash('state', state);
export const hashNonce = (nonce: string) => domainHash('nonce', nonce);

/** 日志关联用短指纹（hash 前 12 hex），原文禁日志。 */
export function shortFp(hashHex: string): string {
  return hashHex.slice(0, 12);
}

// ---------------------------------------------------------------------------
// PKCE（RFC 7636）：只支持 S256，禁止 plain。
// ---------------------------------------------------------------------------

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

export function verifierShapeOk(verifier: unknown): verifier is string {
  return typeof verifier === 'string' && VERIFIER_RE.test(verifier);
}

export async function pkceChallengeForVerifier(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64uEncode(new Uint8Array(digest));
}

/** 重新计算 BASE64URL(SHA256(verifier)) 并与 challenge 常量时间比较。 */
export async function pkceVerify(verifier: string, challenge: string): Promise<boolean> {
  if (!verifierShapeOk(verifier)) return false;
  if (typeof challenge !== 'string' || !challenge) return false;
  const computed = await pkceChallengeForVerifier(verifier);
  return timingSafeEqual(computed, challenge);
}
