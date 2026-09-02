// ============================================================================
// L0 端点组 · phone/*（Part 5 §三：2 phone/send-otp、3 phone/verify-otp、
// 4 phone/bind 归入此组）
//
// 说明：Supabase CLI 函数名仅允许 [A-Za-z0-9_-]（不支持斜杠），故契约路径
// phone/send-otp、phone/verify-otp、phone/bind 由本函数按 pathname 后缀还原分发；
// 处理器分文件维护，与契约表格逐一对应，L0 对外路径不变。
// ============================================================================

import { guard, json } from '../_shared/http.ts';
import { handleSendOtp } from './send-otp.ts';
import { handleVerifyOtp } from './verify-otp.ts';
import { handleBind } from './bind.ts';

Deno.serve(async (req) => {
  const denied = guard(req);
  if (denied) return denied;

  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  if (path.endsWith('/phone/send-otp')) return handleSendOtp(req);
  if (path.endsWith('/phone/verify-otp')) return handleVerifyOtp(req);
  if (path.endsWith('/phone/bind')) return handleBind(req);

  return json(req, { ok: false, code: 'FALLBACK' }, 404);
});

// 本地测试（supabase start 后；验证码打印在 edge runtime 日志）：
//   发送：
//   curl -s -X POST http://127.0.0.1:54321/functions/v1/phone/send-otp \
//     -H 'Content-Type: application/json' -d '{"phone":"13812345678"}'
//   docker logs supabase_edge_runtime_2fa_safemodule_dev 2>&1 | grep '\[OTP\]' | tail -1
//   验证（把 123456 换成日志里的码）：
//   curl -s -X POST http://127.0.0.1:54321/functions/v1/phone/verify-otp \
//     -H 'Content-Type: application/json' -d '{"phone":"13812345678","code":"123456"}'
