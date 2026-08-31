// ============================================================================
// MFA 模块服务端配置（Edge Functions 侧·单一事实来源）
//
// 对应 design/05-数据库与API契约.md §五（mfa.config.js 定值）与 §三 统一要求。
// Edge Runtime 只挂载 supabase/functions/ 目录，故服务端配置放 _shared/ 下；
// 前端侧 mfa.config.js 属 M3 交付物，届时须与本文件保持同步，防止漂移。
//
// fail-loud 纪律（tech-webauthn 实现要点清单 §4.2.4）：配置非法时冷启动即抛错，
// 绝不静默降级成不安全配置。
// ============================================================================

/** @type {{ allowedEmailDomains: string[], corsAllowOrigins: string[], allowNoOrigin: boolean, rpID: string, origin: string, timeoutMs: number, recoveryCodes: number, webauthn: { authenticatorAttachment: string, residentKey: string, attestation: string }, rateLimits: { sendOtpPerPhonePerDay: number, verifyOtpAttemptsPer5Min: number }, enabled: boolean }} */

// WebAuthn RP 常量：生产定值（Part 5 §五）；本地开发经 .env 覆盖为 localhost
// （tech 清单 §4.2.4：RP_ID/ORIGIN 走环境变量 + fail-loud 校验）
const rpID = Deno.env.get('WEB_AUTHN_RP_ID') ?? 'celestivast.com';
const origin = Deno.env.get('WEB_AUTHN_ORIGIN') ?? 'https://celestivast.com';

const mfaConfig = {
  // FR-1.2 服务端强制：仅允许该域名邮箱注册/登录（站主当前指定 isawuhan.com）
  allowedEmailDomains: ['isawuhan.com'],

  // Origin 白名单（Part 5 §三 统一要求；09-L0：白名单进 config）
  // 开发期 wrangler pages dev(8788)/Vite(5173)/serve(3000)/Live Server(5500)；生产收敛为业务域
  corsAllowOrigins: [
    'http://localhost:8788',
    'http://127.0.0.1:8788',
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://localhost:5500',
    'http://127.0.0.1:5500',
  ],
  // 无 Origin 头的请求（curl/服务端直调）放行；浏览器 POST 必带 Origin，受白名单约束
  allowNoOrigin: true,

  // WebAuthn RP（rpID/origin 见文件头：生产定值 + .env 覆盖）
  rpID,
  origin,

  // WebAuthn 注册定值（Part 3 §2.3 / tech 清单 §2.3）
  webauthn: {
    authenticatorAttachment: 'platform', // 指向本机 Touch ID
    residentKey: 'preferred',            // Android 必产出同步通行证
    attestation: 'none',                 // 不做设备型号背书
  },

  // L3 §15.1 挑战 TTL 与前端 timeout 一致（G7）
  timeoutMs: 300000,
  // 决策 D：每批恢复码 10 条
  recoveryCodes: 10,

  // 限速参数（计数落 Postgres rate_limits 共享表，经 rate_limit_check() 原子自增）
  rateLimits: {
    // 契约：同一手机号 24h ≤5 条
    sendOtpPerPhonePerDay: 5,
    // 防穷举：6 位码 + 5min TTL，验证尝试 10 次/5min/手机号
    verifyOtpAttemptsPer5Min: 10,
  },

  // NFR-3 总开关：false 时端点一律 503，用于"全站原行为"回退演练（交付标准 7）
  enabled: true,
};

// ---- fail-loud 冷启动断言 ----
const assert = (cond, msg) => {
  if (!cond) throw new Error(`[mfa.config] ${msg}`);
};

assert(Array.isArray(mfaConfig.allowedEmailDomains) && mfaConfig.allowedEmailDomains.length > 0,
  'allowedEmailDomains 不能为空');
for (const d of mfaConfig.allowedEmailDomains) {
  assert(typeof d === 'string' && /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d), `非法域名: ${d}`);
}
assert(Array.isArray(mfaConfig.corsAllowOrigins), 'corsAllowOrigins 必须是数组');
for (const o of mfaConfig.corsAllowOrigins) {
  assert(typeof o === 'string' && /^https?:\/\//.test(o), `非法 Origin: ${o}`);
}
assert(mfaConfig.origin === `https://${mfaConfig.rpID}` ||
    (new URL(mfaConfig.origin).hostname === mfaConfig.rpID &&
      ['localhost', '127.0.0.1'].includes(mfaConfig.rpID)),
  `origin(${mfaConfig.origin}) 与 rpID(${mfaConfig.rpID}) 不一致`);
// scheme 必须 https；localhost/127.0.0.1 例外（L3 §4：secure context 的本地开发豁免）
assert(mfaConfig.origin.startsWith('https://') ||
    ['localhost', '127.0.0.1'].includes(new URL(mfaConfig.origin).hostname),
  `origin 必须为 https（本地豁免除外）: ${mfaConfig.origin}`);
assert(Number.isInteger(mfaConfig.rateLimits.sendOtpPerPhonePerDay) && mfaConfig.rateLimits.sendOtpPerPhonePerDay > 0,
  'rateLimits.sendOtpPerPhonePerDay 必须是正整数');
assert(Number.isInteger(mfaConfig.rateLimits.verifyOtpAttemptsPer5Min) && mfaConfig.rateLimits.verifyOtpAttemptsPer5Min > 0,
  'rateLimits.verifyOtpAttemptsPer5Min 必须是正整数');

export const config = Object.freeze({ ...mfaConfig });
export default mfaConfig;
