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

/**
 * 读取 COSE_Key（CBOR map）的 alg（label 3，用于 G8 白名单断言）。
 * 最小 CBOR 子集遍历（整数/字节串/文本/数组/map/tag/simple）；任何结构异常、
 * 截断、非整数 alg 一律返回 null —— 调用方 fail-closed 拒绝。
 */
export function readCoseAlg(keyBytes: Uint8Array): number | null {
  try {
    let pos = 0;
    const need = (n: number) => {
      if (pos + n > keyBytes.length) throw new Error('cose oob');
    };
    const readLen = (ai: number): number | null => {
      if (ai < 24) return ai;
      if (ai === 24) { need(1); return keyBytes[pos++]; }
      if (ai === 25) { need(2); const v = (keyBytes[pos] << 8) | keyBytes[pos + 1]; pos += 2; return v; }
      if (ai === 26) {
        need(4);
        const v = keyBytes[pos] * 2 ** 24 + (keyBytes[pos + 1] << 16) + (keyBytes[pos + 2] << 8) + keyBytes[pos + 3];
        pos += 4;
        return v;
      }
      return null; // 64 位长度 / 不定长：不支持 → fail-closed
    };
    const readInt = (): number | null => {
      need(1);
      const ib = keyBytes[pos++];
      const mt = ib >> 5;
      const u = readLen(ib & 31);
      if (u === null) return null;
      if (mt === 0) return u;
      if (mt === 1) return -1 - u;
      return null; // 非整数标量
    };
    const skip = (): boolean => {
      need(1);
      const ib = keyBytes[pos++];
      const mt = ib >> 5;
      const ai = ib & 31;
      if (mt === 7) { // simple / float
        if (ai < 24) return true;
        const n = ai === 24 ? 1 : ai === 25 ? 2 : ai === 26 ? 4 : 8;
        need(n);
        pos += n;
        return true;
      }
      if (mt === 6) { // tag：跳过 tag 号再跳内容
        if (readLen(ai) === null) return false;
        return skip();
      }
      if (mt <= 1) { // uint / nint：标量值在头字节（长参数已由 readLen 消费），无内容可跳
        return readLen(ai) !== null;
      }
      if (mt <= 3) { // bytes / text：跳过 len 字节内容
        const len = readLen(ai);
        if (len === null) return false;
        need(len);
        pos += len;
        return true;
      }
      const len = readLen(ai); // array(4) / map(5)：递归跳元素
      if (len === null) return false;
      const items = mt === 4 ? len : len * 2;
      for (let i = 0; i < items; i++) if (!skip()) return false;
      return true;
    };
    need(1);
    const first = keyBytes[pos++];
    if (first >> 5 !== 5) return null; // 顶层必须是 map
    const n = readLen(first & 31);
    if (n === null) return null;
    for (let i = 0; i < n; i++) {
      const k = readInt();
      if (k === null) return null;
      if (k === 3) return readInt(); // alg（可正可负）
      if (!skip()) return null;
    }
    return null; // 无 alg 项
  } catch {
    return null;
  }
}
