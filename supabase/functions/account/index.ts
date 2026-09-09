// ============================================================================
// L0 端点组增补 · account/* —— 安全中心三功能（M-ACCT）
//
// 说明：CLI 函数名不支持斜杠，契约路径由本函数按 pathname 后缀还原分发
// （同 phone/webauthn/recovery/mfa 端点组）。组级 verify_jwt=false（config.toml），
// 除只读的 verify-options 外一律在处理器内强制会话（requireSession，缺失/无效 401）。
//
// 端点（全部 POST + JWT 会话）：
//   account/verify-options            {} → 可用验证渠道 + 手机尾号 + 第二邮箱状态
//   account/reauth-phone-send         {phone} → 与已绑手机比对一致后发 OTP（重认证/换绑旧机共用）
//   account/phone-rebind-send-new     {phone} → 新手机发 OTP（号被他人绑→ PHONE_TAKEN）
//   account/phone-rebind              {oldPhone, oldOtpToken, newPhone, newOtpToken} → 原子换绑
//   account/reauth-email-send         {email} → 与主邮箱比对一致后发 OTP
//   account/email-verify              {email, code} → 核销 → {otpToken}（重认证邮箱/第二邮箱共用）
//   account/change-password           {new_password, proof} → 校验广播证明 → GoTrue 改密
//   account/secondary-email-send      {email} → 发 OTP（无域名限制；≠主邮箱；全局唯一）
//   account/secondary-email-verify    {email, otpToken} → 落库
//   account/secondary-email-remove    {} → 解绑
//
// 反枚举/防爆破纪律与既有端点组一致：OTP 失败统一 OTP_EXPIRED；票据独占核销；
// 限速全部落 Postgres rate_limits（rate_limit_check）。
// ============================================================================

import { guard, json } from '../_shared/http.ts';
import { handleVerifyOptions } from './verify-options.ts';
import { handleReauthPhoneSend } from './reauth-phone-send.ts';
import { handlePhoneRebindSendNew, handlePhoneRebind } from './phone-rebind.ts';
import { handleReauthEmailSend, handleEmailVerify } from './reauth-email.ts';
import { handleChangePassword } from './change-password.ts';
import { handleSecondaryEmailSend, handleSecondaryEmailVerify, handleSecondaryEmailRemove } from './secondary-email.ts';

Deno.serve(async (req) => {
  const denied = guard(req);
  if (denied) return denied;

  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  if (path.endsWith('/account/verify-options')) return handleVerifyOptions(req);
  if (path.endsWith('/account/reauth-phone-send')) return handleReauthPhoneSend(req);
  if (path.endsWith('/account/phone-rebind-send-new')) return handlePhoneRebindSendNew(req);
  if (path.endsWith('/account/phone-rebind')) return handlePhoneRebind(req);
  if (path.endsWith('/account/reauth-email-send')) return handleReauthEmailSend(req);
  if (path.endsWith('/account/email-verify')) return handleEmailVerify(req);
  if (path.endsWith('/account/change-password')) return handleChangePassword(req);
  if (path.endsWith('/account/secondary-email-send')) return handleSecondaryEmailSend(req);
  if (path.endsWith('/account/secondary-email-verify')) return handleSecondaryEmailVerify(req);
  if (path.endsWith('/account/secondary-email-remove')) return handleSecondaryEmailRemove(req);

  return json(req, { ok: false, code: 'FALLBACK' }, 404);
});