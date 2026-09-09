// ============================================================================
// OAuth Provider · client 校验（严格精确匹配）
//
//   - client_id 必须存在且 enabled。
//   - redirect_uri 必须与登记值精确（字符串全等）匹配：禁止 wildcard、
//     startsWith、域名子串、动态注册、路径后缀追加。
//   - scope 必须是已登记 allowed_scopes 与全站支持 scope 的子集，且第一阶段
//     要求包含 openid（本 Provider 只做 OIDC）。
//   - CORS 白名单绝不当 client 认证；认证只认 client_secret（confidential）
//     与 PKCE（public / 全部）。
// ============================================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { SUPPORTED_SCOPES } from './config.ts';
import { hashClientSecret, timingSafeEqual } from './crypto.ts';

export interface OAuthClient {
  id: string;
  client_id: string;
  client_name: string;
  client_type: 'public' | 'confidential';
  client_secret_hash: string | null;
  redirect_uris: string[];
  allowed_scopes: string[];
  require_consent: boolean;
  enabled: boolean;
}

export async function loadClient(
  admin: SupabaseClient,
  clientId: string,
): Promise<OAuthClient | null> {
  const { data, error } = await admin
    .from('oauth_clients')
    .select(
      'id, client_id, client_name, client_type, client_secret_hash, redirect_uris, allowed_scopes, require_consent, enabled',
    )
    .eq('client_id', clientId)
    .maybeSingle();
  if (error) throw error;
  return (data as OAuthClient | null) ?? null;
}

/** redirect_uri 精确匹配（全等，逐项比对）。 */
export function redirectUriAllowed(client: OAuthClient, redirectUri: string): boolean {
  if (typeof redirectUri !== 'string' || !redirectUri) return false;
  return (client.redirect_uris ?? []).some((registered) => timingSafeEqual(registered, redirectUri));
}

export function parseScope(scope: unknown): string[] | null {
  if (typeof scope !== 'string') return null;
  const parts = scope.split(/\s+/).filter(Boolean);
  return [...new Set(parts)];
}

/**
 * scope 校验：非空、包含 openid、全站支持、client 已登记。
 * 返回规范化 scope 字符串（去重保序）或错误码。
 */
export function validateScope(
  client: OAuthClient,
  scope: unknown,
): { scope: string } | { error: 'invalid_scope'; description: string } {
  const parts = parseScope(scope);
  if (!parts || parts.length === 0) {
    return { error: 'invalid_scope', description: 'scope is required' };
  }
  if (!parts.includes('openid')) {
    return { error: 'invalid_scope', description: 'openid scope is required' };
  }
  for (const s of parts) {
    if (!(SUPPORTED_SCOPES as readonly string[]).includes(s)) {
      return { error: 'invalid_scope', description: `unsupported scope: ${s}` };
    }
    if (!(client.allowed_scopes ?? []).includes(s)) {
      return { error: 'invalid_scope', description: `scope not allowed for this client: ${s}` };
    }
  }
  return { scope: parts.join(' ') };
}

function parseBasicAuth(req: Request): { id: string; secret: string } | null {
  const header = req.headers.get('authorization');
  if (!header || !header.toLowerCase().startsWith('basic ')) return null;
  try {
    const decoded = atob(header.slice(6).trim());
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    return { id: decoded.slice(0, idx), secret: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

export interface ClientAuth {
  client: OAuthClient;
  method: 'client_secret_basic' | 'client_secret_post' | 'none';
}

/**
 * token/revoke 端点的 client 认证：
 *   confidential → 必须 secret（Basic 优先，其次 body），hash 常量时间比对；
 *   public → 不要求 secret（即使误带也忽略，不做认证）。
 */
export async function authenticateClient(
  req: Request,
  admin: SupabaseClient,
  body: Record<string, unknown>,
): Promise<{ auth: ClientAuth } | { error: 'invalid_client'; description: string }> {
  const basic = parseBasicAuth(req);
  const bodyId = typeof body['client_id'] === 'string' ? (body['client_id'] as string) : '';
  const bodySecret = typeof body['client_secret'] === 'string' ? (body['client_secret'] as string) : '';
  const clientId = basic?.id || bodyId;
  if (!clientId) return { error: 'invalid_client', description: 'client_id is required' };

  const client = await loadClient(admin, clientId);
  if (!client || !client.enabled) {
    return { error: 'invalid_client', description: 'unknown or disabled client' };
  }
  if (client.client_type === 'public') {
    return { auth: { client, method: 'none' } };
  }
  const secret = basic?.secret || bodySecret;
  if (!secret) return { error: 'invalid_client', description: 'client_secret is required' };
  const presented = await hashClientSecret(secret);
  if (!client.client_secret_hash || !timingSafeEqual(presented, client.client_secret_hash)) {
    return { error: 'invalid_client', description: 'client authentication failed' };
  }
  return { auth: { client, method: basic ? 'client_secret_basic' : 'client_secret_post' } };
}
