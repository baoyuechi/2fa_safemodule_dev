// ============================================================================
// GET /oauth/userinfo —— OIDC UserInfo（建议实现）
// Bearer OAuth access token（本 Provider 签发的 JWT，非 GoTrue token）。
// 按 access token 的 scope 最小披露：sub 必返；email 需 email scope；
// preferred_username 需 profile scope。email 变更不影响 sub（sub=auth.users.id）。
// ============================================================================

import { createClient } from 'npm:@supabase/supabase-js@2';
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { NO_STORE_HEADERS, oauthLog } from './_shared/errors.ts';
import { clientIp, oauthCors, oauthRateLimited } from './_shared/http.ts';
import { fetchUserIdentity, verifyAccessToken } from './_shared/tokens.ts';

export async function handleUserinfo(req: Request): Promise<Response> {
  const cors = oauthCors(req);
  const admin: SupabaseClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
  const unauthorized = (description: string) =>
    new Response(JSON.stringify({ error: 'invalid_token', error_description: description }), {
      status: 401,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'WWW-Authenticate': 'Bearer error="invalid_token"',
        ...NO_STORE_HEADERS,
        ...cors,
      },
    });

  const header = req.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) return unauthorized('missing bearer token');
  try {
    if (await oauthRateLimited(admin, `oauth_userinfo:${clientIp(req)}`, '10 minutes', 300)) {
      return new Response(JSON.stringify({ error: 'temporarily_unavailable' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE_HEADERS, ...cors },
      });
    }
  } catch (e) {
    console.error('[oauth/userinfo] rate limit failed:', e);
    return unauthorized('temporarily unavailable');
  }

  try {
    const verified = await verifyAccessToken(req, admin, header.slice('Bearer '.length));
    const scopes = verified.scope.split(' ').filter(Boolean);
    const body: Record<string, unknown> = { sub: verified.user_id };
    if (scopes.includes('email') || scopes.includes('profile')) {
      const identity = await fetchUserIdentity(admin, verified.user_id);
      if (scopes.includes('email') && identity.email) {
        body['email'] = identity.email;
        body['email_verified'] = identity.email_verified;
      }
      if (scopes.includes('profile') && identity.email) {
        body['preferred_username'] = identity.email;
      }
    }
    oauthLog('userinfo', { client_id: verified.client_id, user_id: verified.user_id });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', ...NO_STORE_HEADERS, ...cors },
    });
  } catch (e) {
    oauthLog('userinfo_invalid', { error: (e as Error)?.message ?? 'invalid' });
    return unauthorized('invalid token');
  }
}
