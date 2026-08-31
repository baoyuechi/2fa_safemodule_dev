#!/usr/bin/env node
// ============================================================================
// 虚拟认证器 · WebAuthn 登录闭环测试（register → login-options → login-verify
// → token_hash 兑换真实会话）
//
// 断言签名：ECDSA(ES256，DER 编码) over authData ‖ SHA-256(clientDataJSON)，
// 私钥来自注册阶段（craftRegistrationResponse 返回 privateKeyJwk）——这是真实
// WebAuthn 签名，与浏览器行为同构。
//
// 直接运行（注册 + discovery 登录 + 会话兑换 + 重放/email 路径/冒用）：
//   node scripts/test-webauthn-login.mjs <anon_key> [email] [password]
// ============================================================================

import crypto from 'node:crypto';
import {
  b64u,
  craftRegistrationResponse,
  getJwt,
  registerOptions,
  registerVerify,
} from './test-webauthn-register.mjs';

const BASE = 'http://127.0.0.1:54321';
const ORIGIN = 'http://localhost:8788'; // 与 .env 的 WEB_AUTHN_ORIGIN 一致
const RP_ID = 'localhost';              // 与 .env 的 WEB_AUTHN_RP_ID 一致

/** 获取登录选项（无认证端点） */
export async function loginOptions(anonKey, body = {}) {
  const res = await fetch(`${BASE}/functions/v1/webauthn/login-options`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`login-options 失败: ${JSON.stringify(json)}`);
  return json.optionsJSON;
}

/** 提交登录断言验证 */
export async function loginVerify(anonKey, body) {
  const res = await fetch(`${BASE}/functions/v1/webauthn/login-verify`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

/**
 * 构造认证断言（虚拟认证器·真签名）。
 * flags 默认 UP|UV|BE|BS(0x1D)：BE 必须与注册时锁定值一致（G3 不可变）；
 * signCount 可控——用于 counter 防克隆测试。
 */
export function craftAssertionResponse({
  challenge,
  credIdB64u,
  privateKeyJwk,
  userHandle = null,
  signCount = 0,
  flags = 0x01 | 0x04 | 0x08 | 0x10,
  origin = ORIGIN,
  rpId = RP_ID,
} = {}) {
  if (!challenge || !credIdB64u || !privateKeyJwk) {
    throw new Error('craftAssertionResponse 需要 challenge / credIdB64u / privateKeyJwk');
  }
  const rawClientData = Buffer.from(
    JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }),
    'utf8',
  );
  const rpIdHash = crypto.createHash('sha256').update(rpId).digest();
  const sc = Buffer.alloc(4);
  sc.writeUInt32BE(signCount);
  const authData = Buffer.concat([rpIdHash, Buffer.from([flags]), sc]);

  // 签名对象 = authenticatorData ‖ SHA-256(clientDataJSON)
  const sigInput = Buffer.concat([authData, crypto.createHash('sha256').update(rawClientData).digest()]);
  const privateKey = crypto.createPrivateKey({ key: privateKeyJwk, format: 'jwk' });
  const signature = crypto.sign('sha256', sigInput, privateKey); // ECDSA DER

  return {
    id: credIdB64u,
    rawId: credIdB64u,
    type: 'public-key',
    clientExtensionResults: {},
    authenticatorAttachment: 'platform',
    response: {
      clientDataJSON: b64u(rawClientData),
      authenticatorData: b64u(authData),
      signature: b64u(signature),
      userHandle,
    },
  };
}

async function main() {
  const anonKey = process.argv[2];
  const email = process.argv[3] ?? 'mfa-test@isawuhan.com';
  const password = process.argv[4] ?? 'Test123456!';
  if (!anonKey) {
    console.error('用法: node scripts/test-webauthn-login.mjs <anon_key> [email] [password]');
    process.exit(1);
  }

  // ① 注册（虚拟认证器保留私钥；handle 取自注册 options.user.id）
  const token = await getJwt(anonKey, email, password);
  const regOptions = await registerOptions(anonKey, token);
  const { response: regResponse, privateKeyJwk } = craftRegistrationResponse({ challenge: regOptions.challenge });
  const reg = await registerVerify(anonKey, token, regResponse);
  if (!reg.body.ok) {
    console.error('注册失败:', JSON.stringify(reg.body));
    process.exit(1);
  }
  const userHandle = regOptions.user.id; // discovery 断言必须回传注册时 handle
  console.log('① 注册 OK | credentialId:', reg.body.credentialId);

  // ② discovery 登录（断言带 userHandle 定位账户——W3C §7.2-6 ②）
  const loginOpts = await loginOptions(anonKey, {});
  const assertion1 = craftAssertionResponse({
    challenge: loginOpts.challenge,
    credIdB64u: reg.body.credentialId,
    privateKeyJwk,
    userHandle,
    signCount: 1,
  });
  const v1 = await loginVerify(anonKey, { response: assertion1 });
  console.log(`② discovery 登录 → ${JSON.stringify(v1.body)} [${v1.status}]`);
  if (!v1.body.ok) process.exit(1);

  // ③ token_hash 兑换真实会话（桥接闭环：GoTrue /verify，哈希票据流用 token_hash 字段）
  const sess = await fetch(`${BASE}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: v1.body.token_hash }),
  });
  const sessJson = await sess.json();
  const headers = { apikey: anonKey, Authorization: `Bearer ${sessJson.access_token ?? ''}` };
  const meJson = sessJson.access_token
    ? await fetch(`${BASE}/auth/v1/user`, { headers }).then((r) => r.json())
    : {};
  const tokenUserJson = await fetch(`${BASE}/auth/v1/user`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const sessionOk = Boolean(sessJson.access_token) && meJson.id === tokenUserJson.id;
  console.log(`③ token 兑换会话 → ${sessionOk ? 'OK（会话用户与注册用户一致）' : `FAIL: ${JSON.stringify(sessJson)}`}`);

  // ④ 重放同一断言（挑战已消费 → 拒绝）
  const v2 = await loginVerify(anonKey, { response: assertion1 });
  console.log(`④ 重放 → ${JSON.stringify(v2.body)} [${v2.status}]（期望 INVALID_CHALLENGE）`);

  // ⑤ email 路径（email 与凭据属主一致 → OK）
  const loginOpts2 = await loginOptions(anonKey, { email });
  const assertion2 = craftAssertionResponse({
    challenge: loginOpts2.challenge,
    credIdB64u: reg.body.credentialId,
    privateKeyJwk,
    userHandle,
    signCount: 2,
  });
  const v3 = await loginVerify(anonKey, { email, response: assertion2 });
  console.log(`⑤ email 路径 → ${JSON.stringify(v3.body)} [${v3.status}]（期望 ok）`);

  // ⑥ email 冒用（与凭据属主不符 → 无泄露差异拒绝）
  const loginOpts3 = await loginOptions(anonKey, {});
  const assertion3 = craftAssertionResponse({
    challenge: loginOpts3.challenge,
    credIdB64u: reg.body.credentialId,
    privateKeyJwk,
    userHandle,
    signCount: 3,
  });
  const v4 = await loginVerify(anonKey, { email: 'ghost@isawuhan.com', response: assertion3 });
  console.log(`⑥ email 冒用 → ${JSON.stringify(v4.body)} [${v4.status}]（期望 CREDENTIAL_NOT_FOUND）`);

  const pass =
    v1.body.ok &&
    sessionOk &&
    v2.body.code === 'INVALID_CHALLENGE' &&
    v3.body.ok &&
    v4.body.code === 'CREDENTIAL_NOT_FOUND';
  console.log(pass ? '✅ 登录闭环全流程通过' : '❌ 流程未达预期');
  if (!pass) process.exit(1);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  await main();
}
