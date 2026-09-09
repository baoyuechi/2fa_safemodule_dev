// ============================================================================
// OAuth Provider · JWT 签名与 JWKS（RS256/ES256 非对称签名）
//
//   - 私钥只存 oauth_signing_keys.private_jwk（RLS 全拒，仅 service_role 可读），
//     永不进前端 / git / 日志；JWKS 只暴露公钥。
//   - 首个 active key 在首次需要签发时自动生成（WebCrypto RS256-2048）并持久化，
//     仓库与迁移中不携带任何私钥。
//   - rotation：新 key 插入为 active，旧 active 转 previous（grace 期内仍可验证，
//     JWKS 同时暴露）；previous → retired 后不再暴露。
//   - 禁止每次请求动态生成临时 key（kid 必须稳定可发现）。
// ============================================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { b64uDecode, b64uEncode, randomB64Url } from './crypto.ts';

export interface SigningKey {
  kid: string;
  alg: 'RS256' | 'ES256';
  public_jwk: JsonWebKey;
  private_jwk: JsonWebKey;
  status: 'active' | 'previous' | 'retired';
}

type AdminClient = SupabaseClient;

function subtleAlg(alg: string): AlgorithmIdentifier | EcdsaParams {
  if (alg === 'RS256') return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
  if (alg === 'ES256') return { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as EcdsaParams;
  throw new Error(`unsupported alg: ${alg}`);
}

async function generateKeypair(alg: 'RS256' | 'ES256' = 'RS256'): Promise<{
  publicJwk: JsonWebKey;
  privateJwk: JsonWebKey;
}> {
  const gen: RsaHashedKeyGenParams | EcKeyGenParams = alg === 'RS256'
    ? {
      name: 'RSASSA-PKCS1-v1_5',
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: 'SHA-256',
    }
    : { name: 'ECDSA', namedCurve: 'P-256' };
  const pair = await crypto.subtle.generateKey(gen, true, ['sign', 'verify']) as CryptoKeyPair;
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const privateJwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicJwk, privateJwk };
}

/** 取 active key；不存在则自动生成首个（仅一次，后续请求复用）。 */
export async function getActiveKey(admin: AdminClient): Promise<SigningKey> {
  const { data, error } = await admin
    .from('oauth_signing_keys')
    .select('kid, alg, public_jwk, private_jwk, status')
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = (data as SigningKey[] | null)?.[0];
  if (row) return row;

  // 自动装配首个 active key（并发下 kid 随机，冲突则重试一次后读回）。
  const kid = `k_${randomB64Url(12)}`;
  const { publicJwk, privateJwk } = await generateKeypair('RS256');
  const { error: insErr } = await admin.from('oauth_signing_keys').insert({
    kid,
    alg: 'RS256',
    public_jwk: publicJwk,
    private_jwk: privateJwk,
    status: 'active',
  });
  if (insErr) {
    const { data: retry } = await admin
      .from('oauth_signing_keys')
      .select('kid, alg, public_jwk, private_jwk, status')
      .eq('status', 'active')
      .order('created_at', { ascending: false })
      .limit(1);
    const winner = (retry as SigningKey[] | null)?.[0];
    if (winner) return winner;
    throw insErr;
  }
  console.log(JSON.stringify({ event: 'oauth_key_provisioned', kid, ts: new Date().toISOString() }));
  return { kid, alg: 'RS256', public_jwk: publicJwk, private_jwk: privateJwk, status: 'active' };
}

/** rotation：新 key 生效，旧 active 转 previous（保留验证能力）。 */
export async function rotateSigningKey(admin: AdminClient): Promise<SigningKey> {
  const current = await getActiveKey(admin);
  const kid = `k_${randomB64Url(12)}`;
  const { publicJwk, privateJwk } = await generateKeypair(current.alg);
  await admin.from('oauth_signing_keys').update({ status: 'previous' }).eq('kid', current.kid);
  const { error } = await admin.from('oauth_signing_keys').insert({
    kid,
    alg: current.alg,
    public_jwk: publicJwk,
    private_jwk: privateJwk,
    status: 'active',
  });
  if (error) throw error;
  console.log(JSON.stringify({ event: 'oauth_key_rotated', kid, ts: new Date().toISOString() }));
  return { kid, alg: current.alg, public_jwk: publicJwk, private_jwk: privateJwk, status: 'active' };
}

/** JWKS 公钥集合（active + previous，禁私钥）。 */
export async function listPublicJwks(admin: AdminClient): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await admin
    .from('oauth_signing_keys')
    .select('kid, alg, public_jwk')
    .in('status', ['active', 'previous']);
  if (error) throw error;
  const rows = (data as Array<{ kid: string; alg: string; public_jwk: JsonWebKey }> | null) ?? [];
  return rows.map((r) => ({ ...r.public_jwk, use: 'sig', kid: r.kid, alg: r.alg }));
}

async function importPrivate(key: SigningKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', key.private_jwk, subtleAlg(key.alg), false, ['sign']);
}

async function importPublic(
  alg: string,
  jwk: JsonWebKey,
): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, subtleAlg(alg), false, ['verify']);
}

/** 签发紧凑 JWT（header 必须带 kid）。 */
export async function signJwt(
  admin: AdminClient,
  payload: Record<string, unknown>,
): Promise<{ jwt: string; kid: string; alg: string }> {
  const key = await getActiveKey(admin);
  const header = { alg: key.alg, typ: 'JWT', kid: key.kid };
  const input = `${b64uEncode(JSON.stringify(header))}.${b64uEncode(JSON.stringify(payload))}`;
  const priv = await importPrivate(key);
  const sig = await crypto.subtle.sign(
    subtleAlg(key.alg),
    priv,
    new TextEncoder().encode(input),
  );
  return { jwt: `${input}.${b64uEncode(new Uint8Array(sig))}`, kid: key.kid, alg: key.alg };
}

export interface VerifiedJwt {
  header: { alg: string; kid: string; typ?: string };
  payload: Record<string, unknown>;
}

/** 验证签名 + kid 定位（active/previous 均可）；不校验 iss/aud/exp（调用方按用途校验）。 */
export async function verifyJwtSignature(
  admin: AdminClient,
  token: string,
): Promise<VerifiedJwt> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('malformed jwt');
  let header: { alg: string; kid: string };
  try {
    header = JSON.parse(new TextDecoder().decode(b64uDecode(parts[0])));
  } catch {
    throw new Error('malformed jwt header');
  }
  if (!header?.kid || (header.alg !== 'RS256' && header.alg !== 'ES256')) {
    throw new Error('unsupported jwt header');
  }
  const { data, error } = await admin
    .from('oauth_signing_keys')
    .select('kid, alg, public_jwk')
    .eq('kid', header.kid)
    .in('status', ['active', 'previous'])
    .maybeSingle();
  if (error) throw error;
  const row = data as { kid: string; alg: string; public_jwk: JsonWebKey } | null;
  if (!row || row.alg !== header.alg) throw new Error('unknown kid');
  const pub = await importPublic(row.alg, row.public_jwk);
  const ok = await crypto.subtle.verify(
    subtleAlg(row.alg),
    pub,
    b64uDecode(parts[2]),
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!ok) throw new Error('bad signature');
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64uDecode(parts[1])));
  } catch {
    throw new Error('malformed jwt payload');
  }
  return { header, payload };
}
