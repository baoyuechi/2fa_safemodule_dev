// ============================================================================
// OAuth Provider · 错误与日志（独立协议层，不复用 MFA 的 {ok} 信封）
//
//   /oauth/authorize（GET）：失败若 redirect_uri 可信 → 302 回业务 callback
//     带 ?error=…&state=…；client/redirect_uri 本身不可信 → 直接 400 页面。
//   /oauth/token 等 server 端点：OAuth JSON {error, error_description} + 正确
//     HTTP 状态（401 附 WWW-Authenticate），Cache-Control: no-store。
//
// 日志纪律：只输出 transaction id / client id / user id / error 类别 / 时间；
// password/OTP/恢复码/token/code 原文/client_secret/verifier/私钥/state/nonce
// 一律禁日志（关联用 hash 指纹）。
// ============================================================================

export const NO_STORE = 'no-store';
export const NO_STORE_HEADERS = {
  'Cache-Control': NO_STORE,
  'Pragma': 'no-cache',
};

export function oauthLog(event: string, fields: Record<string, unknown>): void {
  const safe: Record<string, unknown> = { event, ts: new Date().toISOString() };
  for (const k of ['transaction_id', 'client_id', 'user_id', 'error', 'code_fp', 'status']) {
    if (fields[k] !== undefined) safe[k] = fields[k];
  }
  console.log(`[oauth] ${event}`, JSON.stringify(safe));
}

/** HTML 转义（直接错误页用）。 */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** authorize 直接错误（client/redirect_uri 不可信，无法安全回跳）：400 页面。 */
export function authorizeDirectError(status: number, error: string): Response {
  oauthLog('authorize_direct_error', { error });
  const html =
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>授权失败</title></head>` +
    `<body><h1>授权请求无效</h1><p>error: ${esc(error)}</p></body></html>`;
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', ...NO_STORE_HEADERS },
  });
}

/**
 * authorize 回跳错误（redirect_uri 已通过精确匹配校验）：
 * redirect_uri?error=…&error_description=…&state=…
 */
export function authorizeRedirectError(
  redirectUri: string,
  error: string,
  state: string | null,
  description?: string,
): Response {
  const url = new URL(redirectUri);
  url.searchParams.set('error', error);
  if (description) url.searchParams.set('error_description', description);
  if (state) url.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), ...NO_STORE_HEADERS },
  });
}

/** 成功回跳：redirect_uri?code=…&state=… */
export function authorizeRedirectSuccess(
  redirectUri: string,
  code: string,
  state: string | null,
): Response {
  const url = new URL(redirectUri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  return new Response(null, {
    status: 302,
    headers: { Location: url.toString(), ...NO_STORE_HEADERS },
  });
}

/** token/userinfo/revoke 的 OAuth JSON 错误。 */
export function oauthJsonError(
  req: Request,
  status: number,
  error: string,
  description: string,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...NO_STORE_HEADERS,
      ...extraHeaders,
    },
  });
}

/** Provider 内部端点（complete/consent/transaction 查询）的 JSON 错误。 */
export function internalJson(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE_HEADERS },
  });
}
