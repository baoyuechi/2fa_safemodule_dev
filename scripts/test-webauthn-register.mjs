#!/usr/bin/env node
// ============================================================================
// 虚拟认证器 · WebAuthn 注册全流程测试（M6「虚拟认证器构造」的脚本化实现）
//
// 原理：fmt='none' 声明不含签名，可离线构造合法注册响应——
//   clientDataJSON(origin=WEB_AUTHN_ORIGIN) + authData(rpIdHash‖UP|UV|BE|BS‖
//   signCount‖AAGUID‖credId‖COSE-P256 公钥) + CBOR attestationObject。
//
// 直接运行（happy path + 重放拒绝）：
//   node scripts/test-webauthn-register.mjs <anon_key> [email] [password]
//   anon key 取自 `supabase status`。
//
// 也可 import 本文件的 getJwt / registerOptions / craftRegistrationResponse /
// registerVerify 组合负路径测试（过期挑战、重复凭据、userId 冒用）。
// ============================================================================

import crypto from 'node:crypto';

const BASE = 'http://127.0.0.1:54321';
const ORIGIN = 'http://localhost:8788'; // 与 .env 的 WEB_AUTHN_ORIGIN 一致
const RP_ID = 'localhost';              // 与 .env 的 WEB_AUTHN_RP_ID 一致

const b64u = (buf) => Buffer.from(buf).toString('base64url');
export { b64u };

/** 密码换 JWT */
export async function getJwt(anonKey, email, password) {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error(`取 JWT 失败: ${JSON.stringify(json)}`);
  return json.access_token;
}

/** 获取注册选项 */
export async function registerOptions(anonKey, token, purpose = 'enroll') {
  const res = await fetch(`${BASE}/functions/v1/webauthn/register-options`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ purpose }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`register-options 失败: ${JSON.stringify(json)}`);
  return json.optionsJSON;
}

/** 提交注册响应验证 */
export async function registerVerify(anonKey, token, response, extraBody = {}) {
  return fetch(`${BASE}/functions/v1/webauthn/register-verify`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ response, ...extraBody }),
  }).then(async (res) => ({ status: res.status, body: await res.json() }));
}

// ---- 最小 CBOR 编码（仅覆盖本测试所需形态）----
const cborInt = (v) =>
  v >= 0
    ? (v < 24 ? Buffer.from([v]) : Buffer.from([0x18, v]))
    : ((n) => (n < 24 ? Buffer.from([0b001_00000 | n]) : Buffer.from([0x38, n])))(-1 - v);
const cborBytes = (b) =>
  b.length < 24
    ? Buffer.concat([Buffer.from([0x40 | b.length]), b])
    : b.length < 256
      ? Buffer.concat([Buffer.from([0x58, b.length]), b])
      : Buffer.concat([Buffer.from([0x59, b.length >> 8, b.length & 0xff]), b]);
const cborText = (s) => {
  const b = Buffer.from(s, 'utf8');
  return b.length < 24
    ? Buffer.concat([Buffer.from([0x60 | b.length]), b])
    : Buffer.concat([Buffer.from([0x78, b.length]), b]);
};
const cborMap = (entries) =>
  Buffer.concat([Buffer.from([0xa0 | entries.length]), ...entries.flatMap(([k, v]) => [k, v])]);

/**
 * 构造 fmt=none 注册响应（虚拟认证器）。
 * flags 默认 UP|UV|AT|BE|BS(0x5D)=multiDevice 已备份；credId 可复用以测重复绑定。
 */
export function craftRegistrationResponse({
  challenge,
  origin = ORIGIN,
  rpId = RP_ID,
  credId = crypto.randomBytes(32),
  flags = 0x01 | 0x04 | 0x40 | 0x08 | 0x10,
} = {}) {
  if (!challenge) throw new Error('craftRegistrationResponse 需要 challenge');
  const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = kp.publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url');
  const y = Buffer.from(jwk.y, 'base64url');

  const coseKey = cborMap([
    [cborInt(1), cborInt(2)],    // kty: EC2
    [cborInt(3), cborInt(-7)],   // alg: ES256
    [cborInt(-1), cborInt(1)],   // crv: P-256
    [cborInt(-2), cborBytes(x)], // x
    [cborInt(-3), cborBytes(y)], // y
  ]);
  const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
  const signCount = Buffer.from([0, 0, 0, 0]);
  const aaguid = Buffer.alloc(16);
  const credIdLen = Buffer.from([credId.length >> 8, credId.length & 0xff]);
  const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), signCount, aaguid, credIdLen, credId, coseKey]);
  const attestationObject = cborMap([
    [cborText('fmt'), cborText('none')],
    [cborText('attStmt'), Buffer.from([0xa0])],
    [cborText('authData'), cborBytes(authData)],
  ]);
  const clientDataJSON = b64u(JSON.stringify({
    type: 'webauthn.create',
    challenge,
    origin,
    crossOrigin: false,
  }));

  return {
    response: {
      id: b64u(credId),
      rawId: b64u(credId),
      type: 'public-key',
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
      response: {
        clientDataJSON,
        attestationObject: b64u(attestationObject),
        transports: ['internal'],
      },
    },
    // 登录测试需要同一凭据私钥签断言（真实 ECDSA 签名，fmt=none 仅免去注册签名）
    privateKeyJwk: kp.privateKey.export({ format: 'jwk' }),
    credId: b64u(credId),
  };
}

/** 默认流程：options → 构造响应 → verify → 重放（应拒） */
async function main() {
  const anonKey = process.argv[2];
  const email = process.argv[3] ?? 'mfa-test@isawuhan.com';
  const password = process.argv[4] ?? 'Test123456!';
  if (!anonKey) {
    console.error('用法: node scripts/test-webauthn-register.mjs <anon_key> [email] [password]');
    process.exit(1);
  }

  const token = await getJwt(anonKey, email, password);
  console.log('① JWT OK');

  const options = await registerOptions(anonKey, token);
  console.log(`② options OK | rp=${options.rp.id} | challenge=${options.challenge.slice(0, 12)}…`);

  const { response: regResponse } = craftRegistrationResponse({ challenge: options.challenge });
  const verify = await registerVerify(anonKey, token, regResponse);
  console.log(`③ verify → ${JSON.stringify(verify.body)} [${verify.status}]`);

  const replay = await registerVerify(anonKey, token, regResponse);
  console.log(`④ 重放 → ${JSON.stringify(replay.body)} [${replay.status}]（期望 INVALID_CHALLENGE）`);

  if (verify.body.ok && replay.body.code === 'INVALID_CHALLENGE') {
    console.log('✅ 注册全流程通过 | credentialId:', verify.body.credentialId);
  } else {
    console.error('❌ 流程未达预期');
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  await main();
}
