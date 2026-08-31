// ============================================================================
// L0 端点 1/12 · check-email-domain
//
// 契约（design/05-数据库与API契约.md §三）：POST · 无认证 · {email} → {ok, domain}
//   FR-1.2 邮箱域名白名单服务端强制；白名单来自 _shared/mfa.config.js。
//
// 响应：
//   200 {ok:true, domain}                      域名在白名单
//   200 {ok:false, code:'DOMAIN_NOT_ALLOWED'}  域名不在白名单（前端译为"请使用学校邮箱注册"）
//   400 {ok:false, code:'FALLBACK'}            请求体缺失/JSON 非法/email 形状非法
//   403 {ok:false, code:'FALLBACK'}            Origin 不在白名单
//   405 {ok:false, code:'FALLBACK'}            非 POST/OPTIONS
//   503 {ok:false, code:'FALLBACK'}            模块总开关关闭（NFR-3 回退演练）
//
// 限速：M2 落地 rate_limits 共享计数表后统一接入（Passkey-2fa 教训：函数内存限速多实例失效）。
//
// 本地测试（supabase start 后直接可用）：
//   curl -s -X POST http://127.0.0.1:54321/functions/v1/check-email-domain \
//     -H 'Content-Type: application/json' \
//     -d '{"email":"student@isawuhan.com"}'
//   curl -s -X POST http://127.0.0.1:54321/functions/v1/check-email-domain \
//     -H 'Content-Type: application/json' \
//     -d '{"email":"student@gmail.com"}'
// ============================================================================

import { config } from '../_shared/mfa.config.js';
import { guard, json } from '../_shared/http.ts';

// 轻量形状校验：本端点是注册前的引导性预检（FR-1.2），真正的邮箱合法性仍由 GoTrue 注册把关
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

Deno.serve(async (req) => {
  const denied = guard(req);
  if (denied) return denied;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }

  const rawEmail = (body as { email?: unknown })?.email;
  const email = typeof rawEmail === 'string' ? rawEmail.trim().toLowerCase() : '';
  if (!EMAIL_SHAPE.test(email)) {
    return json(req, { ok: false, code: 'FALLBACK' }, 400);
  }

  const domain = email.slice(email.lastIndexOf('@') + 1);
  if (!config.allowedEmailDomains.includes(domain)) {
    return json(req, { ok: false, code: 'DOMAIN_NOT_ALLOWED' });
  }
  return json(req, { ok: true, domain });
});
