// ============================================================================
// OAuth Provider · token 签发（access / ID / refresh）
//
//   - OAuth access token 属于本 Provider：JWT（RS256/ES256，kid 指向 JWKS），
//     绝不复用 Supabase(GoTrue) access_token，也绝不把后者发给业务网站。
//   - sub 统一为 auth.users.id（稳定 UUID）；email 仅作 claim（scope=email 时）。
//   - ID Token 含 nonce（与 transaction 绑定）、auth_time、amr、acr。
//   - refresh token 为 opaque 随机串（仅存 hash），rotation + reuse detection。
// ============================================================================

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { issuerFor, oauthConfig } from './config.ts';
import { hashRefreshToken, randomB64Url, shortFp } from './crypto.ts';
import { oauthLog } from './errors.ts';
import { getActiveKey, signJwt, verifyJwtSignature } from './signing.ts';

type AdminClient = SupabaseClient;

export interface TokenIssueParams {
  client_id: string;
  user_id: string;
  scope: string;
  amr: string[];
  acr: string | null;
  auth_time: number; // epoch 秒
  nonce: string | null;
  email: string | null;
  email_verified: boolean;
}

export async function issueAccessToken(
  req: Request,
  admin: AdminClient,
  p: TokenIssueParams,
): Promise<{ token: string; expires_in: number; jti: string }> {
  const issuer = issuerFor(req);
  const now = Math.floor(Date.now() / 1000);
  const expires_in = oauthConfig.accessTokenTtl;
  const jti = randomB64Url(16);
  const payload: Record<string, unknown> = {
    iss: issuer,
    sub: p.user_id,
    aud: p.client_id,
    exp: now + expires_in,
    iat: now,
    scope: p.scope,
    jti,
    client_id: p.client_id,
    acr: p.acr,
    amr: p.amr,
  };
  const { jwt } = await signJwt(admin, payload);
  return { token: jwt, expires_in, jti };
}

export async function issueIdToken(
  req: Request,
  admin: AdminClient,
  p: TokenIssueParams,
): Promise<string> {
  const issuer = issuerFor(req);
  const now = Math.floor(Date.now() / 1000);
  const payload: Record<string, unknown> = {
    iss: issuer,
    sub: p.user_id,
    aud: p.client_id,
    exp: now + oauthConfig.idTokenTtl,
    iat: now,
    auth_time: p.auth_time,
    amr: p.amr,
    acr: p.acr,
  };
  if (p.nonce) payload['nonce'] = p.nonce;
  if (p.scope.split(' ').includes('email') && p.email) {
    payload['email'] = p.email;
    payload['email_verified'] = p.email_verified;
  }
  if (p.scope.split(' ').includes('profile') && p.email) {
    payload['preferred_username'] = p.email;
  }
  const { jwt } = await signJwt(admin, payload);
  return jwt;
}

/** 签发 opaque refresh token（仅 offline_access scope）。返回明文（仅此一次）。 */
export async function issueRefreshToken(
  admin: AdminClient,
  p: Pick<TokenIssueParams, 'client_id' | 'user_id' | 'scope' | 'amr' | 'acr'>,
): Promise<string> {
  const token = randomB64Url(32);
  const token_hash = await hashRefreshToken(token);
  const { error } = await admin.from('oauth_refresh_tokens').insert({
    token_hash,
    client_id: p.client_id,
    user_id: p.user_id,
    scope: p.scope,
    amr: p.amr,
    acr: p.acr,
    expires_at: new Date(Date.now() + oauthConfig.refreshTokenTtl * 1000).toISOString(),
  });
  if (error) throw error;
  oauthLog('refresh_issued', { client_id: p.client_id, user_id: p.user_id, code_fp: shortFp(token_hash) });
  return token;
}

export interface VerifiedAccessToken {
  user_id: string;
  client_id: string;
  scope: string;
  amr: string[];
  acr: string | null;
}

/** 校验 OAuth access token（签名 + iss + exp + aud/client 有效性）。 */
export async function verifyAccessToken(
  req: Request,
  admin: AdminClient,
  token: string,
): Promise<VerifiedAccessToken> {
  const issuer = issuerFor(req);
  const { payload } = await verifyJwtSignature(admin, token);
  const now = Math.floor(Date.now() / 1000);
  if (payload['iss'] !== issuer) throw new Error('issuer mismatch');
  if (typeof payload['exp'] !== 'number' || payload['exp'] <= now) throw new Error('token expired');
  if (typeof payload['sub'] !== 'string' || !payload['sub']) throw new Error('bad sub');
  if (typeof payload['aud'] !== 'string' || !payload['aud']) throw new Error('bad aud');
  const { data: client, error } = await admin
    .from('oauth_clients')
    .select('client_id, enabled')
    .eq('client_id', payload['aud'])
    .maybeSingle();
  if (error) throw error;
  if (!client || !(client as { enabled: boolean }).enabled) throw new Error('client disabled');
  return {
    user_id: payload['sub'] as string,
    client_id: payload['aud'] as string,
    scope: typeof payload['scope'] === 'string' ? (payload['scope'] as string) : '',
    amr: Array.isArray(payload['amr']) ? (payload['amr'] as string[]) : [],
    acr: typeof payload['acr'] === 'string' ? (payload['acr'] as string) : null,
  };
}

/** 取用户邮箱身份（ID Token / userinfo 的 email claim 源，sub 仍用 id）。 */
export async function fetchUserIdentity(
  admin: AdminClient,
  userId: string,
): Promise<{ email: string | null; email_verified: boolean }> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return { email: null, email_verified: false };
  return {
    email: data.user.email ?? null,
    email_verified: !!data.user.email_confirmed_at,
  };
}

/** 预热签名 key（discovery/JWKS 冷启动不断言失败，由调用方触发）。 */
export async function warmupKeys(admin: AdminClient): Promise<void> {
  await getActiveKey(admin);
}
