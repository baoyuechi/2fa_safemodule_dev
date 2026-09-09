// ============================================================================
// GET /.well-known/openid-configuration —— OIDC Discovery
// 不要虚构未实现的 endpoint：只声明本函数实际路由的地址。
// ============================================================================

import { endpointUrls } from './_shared/config.ts';
import {
  SUPPORTED_ACR_VALUES,
  SUPPORTED_CODE_CHALLENGE_METHODS,
  SUPPORTED_GRANT_TYPES,
  SUPPORTED_RESPONSE_TYPES,
  SUPPORTED_SCOPES,
  SUPPORTED_TOKEN_AUTH_METHODS,
} from './_shared/config.ts';
import { publicCors } from './_shared/http.ts';

export async function handleDiscovery(req: Request): Promise<Response> {
  const ep = endpointUrls(req);
  const body = {
    issuer: ep.issuer,
    authorization_endpoint: ep.authorization_endpoint,
    token_endpoint: ep.token_endpoint,
    userinfo_endpoint: ep.userinfo_endpoint,
    jwks_uri: ep.jwks_uri,
    revocation_endpoint: ep.revocation_endpoint,
    response_types_supported: SUPPORTED_RESPONSE_TYPES,
    grant_types_supported: SUPPORTED_GRANT_TYPES,
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256', 'ES256'],
    scopes_supported: SUPPORTED_SCOPES,
    token_endpoint_auth_methods_supported: SUPPORTED_TOKEN_AUTH_METHODS,
    claims_supported: [
      'sub',
      'iss',
      'aud',
      'exp',
      'iat',
      'auth_time',
      'nonce',
      'amr',
      'acr',
      'email',
      'email_verified',
      'preferred_username',
    ],
    code_challenge_methods_supported: SUPPORTED_CODE_CHALLENGE_METHODS,
    acr_values_supported: SUPPORTED_ACR_VALUES,
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...publicCors() },
  });
}
