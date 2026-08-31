// ============================================================================
// L0 端点组 · webauthn/*（Part 5 §三：5 register-options、6 register-verify、
// 7 login-options、8 login-verify，均归入此组）
//
// 说明：CLI 函数名不支持斜杠，契约路径由本函数按 pathname 后缀还原分发
// （同 phone 端点组）。本组端点契约要求"会话"认证 → 保持默认 verify_jwt=true
// （config.toml 无需单独配置），处理器内再做 JWT 用户识别。
// ============================================================================

import { guard, json } from '../_shared/http.ts';
import { handleLoginOptions } from './login-options.ts';
import { handleLoginVerify } from './login-verify.ts';
import { handleRegisterOptions } from './register-options.ts';
import { handleRegisterVerify } from './register-verify.ts';

Deno.serve(async (req) => {
  const denied = guard(req);
  if (denied) return denied;

  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  if (path.endsWith('/webauthn/register-options')) return handleRegisterOptions(req);
  if (path.endsWith('/webauthn/register-verify')) return handleRegisterVerify(req);
  if (path.endsWith('/webauthn/login-options')) return handleLoginOptions(req);
  if (path.endsWith('/webauthn/login-verify')) return handleLoginVerify(req);

  return json(req, { ok: false, code: 'FALLBACK' }, 404);
});
