// ============================================================================
// L0 端点组 · mfa/*（Part 5 §三 12 端点之外的方法状态查询补充组）
//
// 说明：CLI 函数名不支持斜杠，契约路径由本函数按 pathname 后缀还原分发
// （同 phone/webauthn/recovery 端点组）。组级 verify_jwt=false（config.toml），
// 由各处理器自行决定是否强制会话。
//
// 端点：
//   mfa/methods（无认证）：{email} → {hasPasskeys, hasRecoveryCodes}
//     —— 登录页「选择登录方式」步按邮箱查询可用方式，隐藏不可用入口；
//        反枚举纪律见 methods.ts。后续方法级状态查询在本组归口复用。
// ============================================================================

import { guard, json } from '../_shared/http.ts';
import { handleMethods } from './methods.ts';

Deno.serve(async (req) => {
  const denied = guard(req);
  if (denied) return denied;

  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  if (path.endsWith('/mfa/methods')) return handleMethods(req);

  return json(req, { ok: false, code: 'FALLBACK' }, 404);
});