// 共享 HTTP 工具：CORS 预检 + 统一响应信封。
// 信封契约（design/05-数据库与API契约.md §三）：{ ok:boolean, data?:…, code?:string }，
// code 走统一错误字典（§四，ISAMFA.errors.translate 在前端翻译）。

import { config } from './mfa.config.js';

/** Origin 是否放行：无 Origin 且 allowNoOrigin=true（curl/服务端直调）→ 放行；在白名单 → 放行 */
export function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return config.allowNoOrigin;
  return config.corsAllowOrigins.includes(origin);
}

/** CORS 响应头：仅对白名单 Origin 回显 Allow-Origin */
export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && config.corsAllowOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/** OPTIONS 预检统一处理 */
export function handleOptions(req: Request): Response {
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/**
 * 端点统一前置守卫：方法 / Origin / 总开关。
 * 返回 null 表示放行，否则直接返回拦截响应。全部端点复用。
 */
export function guard(req: Request): Response | null {
  if (req.method === 'OPTIONS') return handleOptions(req);
  if (req.method !== 'POST') {
    return json(req, { ok: false, code: 'FALLBACK' }, 405);
  }
  if (!originAllowed(req)) {
    console.warn(`[${new URL(req.url).pathname}] origin rejected:`, req.headers.get('origin'));
    return json(req, { ok: false, code: 'FALLBACK' }, 403);
  }
  if (!config.enabled) {
    return json(req, { ok: false, code: 'FALLBACK' }, 503);
  }
  return null;
}

/** JSON 响应（自动附带 CORS 头） */
export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}
