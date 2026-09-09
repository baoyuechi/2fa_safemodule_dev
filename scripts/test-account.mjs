#!/usr/bin/env node
// ============================================================================
// 安全中心三功能 E2E 测试（后端）：重认证改密 / 手机换绑 / 第二辅助邮箱
//
// 用法：
//   node scripts/test-account.mjs <service_role_key> <anon_key>
//
// 流程（一次性账号，不动 bob 等现有账号）：
//   1. admin 建号（email_confirm:true）→ 登录拿 JWT
//   2. 负路径守卫：无会话/邮箱不匹配/伪造票据/恢复码无效(无批次)/第二邮箱=主邮箱
//   3. 第二邮箱全闭环（send → 日志取码 → email-verify 领票 → verify 落库）
//   4. 改密-邮箱证明全闭环（reauth-email-send → 领票 → change-password → 新密码重登）
//   5. 手机绑定走通后：reauth-phone-send(旧) + phone-rebind-send-new(新) →
//      双票 → phone-rebind 换绑成功 → 改密-手机证明(新号) 全闭环 → 新密码重登
//
// 邮箱 OTP 码：docker 日志 [EMAIL-OTP]；手机 OTP 码：[OTP]。
// ============================================================================

import { execSync } from 'node:child_process';

const BASE = 'http://127.0.0.1:54321';
const FUNCTION = `${BASE}/functions/v1`;
const ANON = process.argv[3];
const SVC = process.argv[2];
const EDGE = 'supabase_edge_runtime_2fa_safemodule_dev';

let fails = 0;

function assert(cond, label, detail = '') {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    fails += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

async function api(route, body, { token = null, expect = 200 } = {}) {
  const headers = { apikey: ANON, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${FUNCTION}/${route}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const okRes = res.status === expect;
  return { status: res.status, okRes, json };
}

/** 从 edge runtime 容器日志取最近一条指定类型的 OTP 码 */
function getCode(kind) {
  const out = execSync(
    `docker logs ${EDGE} --since 30s 2>&1`,
    { encoding: 'utf8', timeout: 15000 },
  );
  const re = kind === 'EMAIL-OTP'
    ? /\[EMAIL-OTP\] (\d{6}) for (.+)$/gm
    : /\[OTP\] (\d{6}) for (.+)$/gm;
  const all = [...out.matchAll(re)];
  if (all.length === 0) return null;
  const last = all[all.length - 1];
  return { code: last[1], target: last[2] };
}

/** 密码换 JWT（本地 captcha 开着，用 always-passes 模拟 token 顶格） */
async function signIn(email, password) {
  const res = await fetch(`${BASE}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, gotrue_meta_security: { captcha_token: 'dummy' } }),
  });
  const json = await res.json();
  return { ok: res.ok, json };
}

async function main() {
  const suffix = Date.now().toString(36);
  const email = `acct-${suffix}@isawuhan.com`;
  const pw1 = 'Suite123!';
  const pw2 = 'Suite456!';
  const pw3 = 'Suite999!';
  const oldPhone = `138${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  const newPhone = `139${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  console.log(`测试账号: ${email}`);

  // ── 1. 建号 + 登录 ──
  let res = await fetch(`${BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: pw1, email_confirm: true }),
  });
  if (!res.ok) throw new Error(`admin 建号失败: ${res.status} ${await res.text()}`);
  const userId = (await res.json()).id;

  const login = await signIn(email, pw1);
  const loginJson = login.json;
  const token = loginJson.access_token;
  assert(login.ok && !!token, `登录成功（JWT 就绪）`);
  if (!token) throw new Error('拿不到 token');

  // ── 2. 负路径守卫 ──
  let r = await api('account/verify-options', {}, { expect: 401 });
  assert(r.okRes && r.json.code === 'FALLBACK', '无会话 → 401 FALLBACK');

  r = await api('account/reauth-email-send', { email: 'other@isawuhan.com' }, { token });
  assert(r.json.code === 'EMAIL_MISMATCH', '主邮箱不匹配 → EMAIL_MISMATCH（用户修正#2，不发码）');

  r = await api('account/change-password', { new_password: pw2, proof: { bogus: 1 } }, { token, expect: 400 });
  assert(r.okRes && r.json.code === 'FALLBACK', '非法 proof 形状 → 400 FALLBACK');

  r = await api('account/change-password', { new_password: pw2, proof: { type: 'recovery', code: 'AAAA-BBBB' } }, { token });
  assert(r.json.code === 'RECOVERY_INVALID', '无恢复码批次 → RECOVERY_INVALID');

  r = await api('account/change-password', { new_password: pw2, proof: { type: 'phone', phone: oldPhone, otpToken: 'fake' } }, { token });
  assert(r.json.code === 'OTP_EXPIRED', '手机证明伪造票据 → OTP_EXPIRED');

  r = await api('account/phone-rebind', { oldPhone, oldOtpToken: 'a', newPhone, newOtpToken: 'b' }, { token });
  assert(r.json.code === 'OTP_EXPIRED', '换绑伪造票据 → OTP_EXPIRED');

  r = await api('account/secondary-email-send', { email }, { token });
  assert(r.json.code === 'SE_IS_PRIMARY', '第二邮箱=主邮箱 → SE_IS_PRIMARY');

  r = await api('account/secondary-email-verify', { email: 'ghost@isawuhan.com', otpToken: 'fake' }, { token });
  assert(r.json.code === 'OTP_EXPIRED', '第二邮箱伪造票据 → OTP_EXPIRED', JSON.stringify(r.json));

  // ── 3. 第二辅助邮箱全闭环（无域名限制：outlook.com） ──
  const secEmail = `sec-${suffix}@outlook.com`;
  r = await api('account/secondary-email-send', { email: secEmail }, { token });
  assert(r.json.ok, '第二邮箱发码 → ok');
  let got = getCode('EMAIL-OTP');
  assert(got != null && got.target === secEmail, `[日志取到第二邮箱码] ${got?.target ?? '(无)'}`, JSON.stringify(got));
  r = await api('account/email-verify', { email: secEmail, code: got.code }, { token });
  assert(r.json.ok && !!r.json.otpToken, 'email-verify 领票 → otpToken');
  const secToken = r.json.otpToken;
  r = await api('account/secondary-email-verify', { email: secEmail, otpToken: secToken }, { token });
  assert(r.json.ok, 'secondary-email-verify 落库 → ok');

  let dbRow = await fetch(`${BASE}/rest/v1/secondary_emails?user_id=eq.${userId}&select=email_mask`, {
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}` },
  });
  dbRow = await dbRow.json();
  assert(Array.isArray(dbRow) && dbRow.length === 1, 'DB 只有一条第二邮箱记录');

  // 防重：同一邮箱再发 → SE_ALREADY_SET
  r = await api('account/secondary-email-send', { email: secEmail }, { token });
  assert(r.json.code === 'SE_ALREADY_SET', '已设置后再发 → SE_ALREADY_SET');

  // ── 4. 改密——邮箱证明全闭环 ──
  r = await api('account/reauth-email-send', { email }, { token });
  assert(r.json.ok, '主邮箱重认证发码 → ok');
  got = getCode('EMAIL-OTP');
  assert(got != null && got.target === email, `[日志取到主邮箱重认证码] ${got?.target ?? '(无)'}`);
  r = await api('account/email-verify', { email, code: got.code }, { token });
  assert(r.json.ok && !!r.json.otpToken, 'email-verify 领重认证票');
  r = await api('account/change-password', { new_password: pw2, proof: { type: 'email', otpToken: r.json.otpToken } }, { token });
  assert(r.json.ok, '改密（邮箱证明）→ ok');

  const login2 = await signIn(email, pw2);
  assert(login2.ok && !!login2.json.access_token, '新密码可登录（pw2）');
  if (!login2.json.access_token) throw new Error('新密码登录失败');
  const token2 = login2.json.access_token;

  // 票单次有效：重放/伪造 → OTP_EXPIRED（不消耗密码）
  r = await api('account/change-password', { new_password: pw3, proof: { type: 'phone', phone: newPhone, otpToken: 'replay' } }, { token: token2 });
  assert(r.json.code === 'OTP_EXPIRED', '重放/伪造 → OTP_EXPIRED（不消耗密码）');

  // ── 5. 手机：绑定 → 换绑（双票） → 手机证明改密 ──
  r = await api('phone/send-otp', { phone: oldPhone, captcha_token: 'dummy' });
  assert(r.json.ok, 'phone/send-otp(绑定) → ok');
  got = getCode('OTP');
  r = await api('phone/verify-otp', { phone: oldPhone, code: got.code });
  assert(r.json.ok && !!r.json.otpToken, 'verify-otp 领绑定票');
  r = await api('phone/bind', { phone: oldPhone, otpToken: r.json.otpToken }, { token: token2 });
  assert(r.json.ok, `phone/bind 绑定 ${oldPhone} → ok`);

  r = await api('account/reauth-phone-send', { phone: oldPhone }, { token: token2 });
  assert(r.json.ok, 'reauth-phone-send(旧号发码) → ok');
  got = getCode('OTP');
  assert(got != null && got.target === `+86${oldPhone}`, `[日志取到旧号码] ${got?.target ?? '(无)'}`);
  r = await api('phone/verify-otp', { phone: oldPhone, code: got.code });
  assert(r.json.ok && !!r.json.otpToken, 'verify-otp 领旧号票');
  const oldToken = r.json.otpToken;

  r = await api('account/reauth-phone-send', { phone: newPhone }, { token: token2 });
  assert(r.json.code === 'PHONE_MISMATCH', '旧号通道填新号 → PHONE_MISMATCH（用户修正#2，不发码）');

  r = await api('account/phone-rebind-send-new', { phone: newPhone }, { token: token2 });
  assert(r.json.ok, 'phone-rebind-send-new(新号发码) → ok');
  got = getCode('OTP');
  assert(got != null && got.target === `+86${newPhone}`, `[日志取到新号码] ${got?.target ?? '(无)'}`);
  r = await api('phone/verify-otp', { phone: newPhone, code: got.code });
  assert(r.json.ok && !!r.json.otpToken, 'verify-otp 领新号票');
  const newToken = r.json.otpToken;

  r = await api('account/phone-rebind', { oldPhone, oldOtpToken: oldToken, newPhone, newOtpToken: newToken }, { token: token2 });
  assert(r.json.ok, 'phone-rebind 双票换绑 → ok');

  dbRow = await fetch(`${BASE}/rest/v1/phone_bindings?user_id=eq.${userId}&select=phone_last4`, {
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}` },
  });
  dbRow = await dbRow.json();
  assert(Array.isArray(dbRow) && dbRow[0]?.phone_last4 === newPhone.slice(-4), `DB 新绑定末四位 ${newPhone.slice(-4)}（实际 ${dbRow[0]?.phone_last4}）`);

  // 旧票重放 → OTP_EXPIRED
  r = await api('account/phone-rebind', { oldPhone, oldOtpToken: oldToken, newPhone, newOtpToken: newToken }, { token: token2 });
  assert(r.json.code === 'OTP_EXPIRED', '换绑票据重放 → OTP_EXPIRED');

  // 新号手机证明改密全闭环
  r = await api('account/reauth-phone-send', { phone: newPhone }, { token: token2 });
  assert(r.json.ok, 'reauth-phone-send(新号发码) → ok');
  got = getCode('OTP');
  r = await api('phone/verify-otp', { phone: newPhone, code: got.code });
  assert(r.json.ok && !!r.json.otpToken, 'verify-otp 领新号改密票');
  r = await api('account/change-password', { new_password: pw3, proof: { type: 'phone', phone: newPhone, otpToken: r.json.otpToken } }, { token: token2 });
  assert(r.json.ok, '改密（手机证明）→ ok');

  const login3 = await signIn(email, pw3);
  assert(login3.ok && !!login3.json.access_token, '新密码可登录（pw3）');
  const token3 = login3.json.access_token;

  // 删除第二邮箱 → ok
  r = await api('account/secondary-email-remove', {}, { token: token3 });
  assert(r.json.ok, 'secondary-email-remove → ok', JSON.stringify(r.json));

  console.log(fails === 0 ? '\n=== 全部通过 ===' : `\n=== ${fails} 项失败 ===`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});