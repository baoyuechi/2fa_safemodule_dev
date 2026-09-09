// ============================================================================
// OAuth Provider · HTTP/CORS/限速（独立协议层，不复用 MFA guard()）
//
// 原因：/oauth/authorize 与 discovery/JWKS 是 GET；token 是 server-to-server
// POST（表单编码）；userinfo 是 Bearer GET。MFA 的 guard() 只放行 POST+JSON，
// 语义不兼容，故此处自建 OAuth 专用层，原 MFA Function routing 不受影响。
// ============================================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { oauthConfig } from './config.ts';

type AdminClient = SupabaseClient;

/** discovery/JWKS：公开 GET，CORS 直接 `*`（标准做法，便于 RP 校验）。 */
export function publicCors(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** 需认证/业务相关的端点：回显白名单 Origin；无 Origin（server-to-server/curl）放行。 */
export function oauthCors(req: Request): Record<string, string> {
  const origin = req.headers.get('origin');
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type, authorization, apikey, x-client-info',
    'Access-Control-Max-Age': '86400',
  };
  if (origin && oauthConfig.allowedOrigins.includes(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

export function originAllowed(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return oauthConfig.allowNoOrigin;
  return oauthConfig.allowedOrigins.includes(origin);
}

export function handleOptions(req: Request, pub = false): Response {
  return new Response(null, { status: 204, headers: pub ? publicCors() : oauthCors(req) });
}

export function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim().slice(0, 64);
  return req.headers.get('x-real-ip')?.slice(0, 64) ?? 'noip';
}

/**
 * OAuth 独立限速（复用 Postgres rate_limit_check 原子计数思想，key 命名空间
 * oauth_* 与现有 MFA key 隔离）。返回 true=已超限。
 */
export async function oauthRateLimited(
  admin: AdminClient,
  key: string,
  window: string,
  limit: number,
): Promise<boolean> {
  const { data, error } = await admin.rpc('rate_limit_check', { p_key: key, p_window: window });
  if (error) throw error;
  return (data ?? 0) > limit;
}
