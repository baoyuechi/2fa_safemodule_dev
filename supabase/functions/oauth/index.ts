// ============================================================================
// OAuth2 / OIDC Provider · 函数入口（supabase/functions/oauth）
//
// CLI 函数名不支持 `/`，契约路径由本函数按 pathname 后缀还原分发
// （同 webauthn/phone/recovery 组模式）。本组自带独立 HTTP/CORS/限速层
// （_shared/http.ts），绝不复用 MFA 的 guard()（POST-only 语义不兼容
// authorize 的 GET 与 token 的表单编码），原 MFA Function routing 零影响。
//
// 路由：
//   GET  /.well-known/openid-configuration  discovery（公开）
//   GET  /.well-known/jwks.json             JWKS（公开）
//   GET  /oauth/authorize                   授权入口（302 到 Provider 前端）
//   GET  /oauth/transaction?id=             前端授权页读事务展示信息
//   POST /oauth/complete                    登录接入 transaction 并出码（需会话）
//   POST /oauth/consent                     用户授权确认（需会话）
//   POST /oauth/token                       code/refresh 兑换（server-to-server）
//   GET  /oauth/userinfo                     OIDC UserInfo（Bearer access token）
//   POST /oauth/revoke                       refresh 撤销（+ access 文档化 no-op）
// ============================================================================

import { config as mfaConfig } from '../_shared/mfa.config.js';
import { handleAuthorize } from './authorize.ts';
import { handleComplete } from './complete.ts';
import { handleConsent } from './consent.ts';
import { handleDiscovery } from './discovery.ts';
import { handleJwks } from './jwks.ts';
import { handleRevoke } from './revoke.ts';
import { handleToken } from './token.ts';
import { handleTransactionQuery } from './transaction.ts';
import { handleUserinfo } from './userinfo.ts';
import { handleOptions, oauthCors, originAllowed, publicCors } from './_shared/http.ts';
import { createClient } from 'npm:@supabase/supabase-js@2';

function json(req: Request, body: unknown, status = 200, pub = false): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
      ...(pub ? publicCors() : oauthCors(req)),
    },
  });
}

Deno.serve(async (req) => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  const isPublicGet = path.endsWith('/.well-known/openid-configuration') ||
    path.endsWith('/.well-known/jwks.json');

  if (req.method === 'OPTIONS') return handleOptions(req, isPublicGet);

  // NFR-3 总开关（与 MFA 共用）：false 时全组 503，原行为回退演练覆盖 OAuth。
  if (!mfaConfig.enabled) {
    return json(req, { error: 'temporarily_unavailable' }, 503);
  }

  // 公开端点不过 Origin 门；其余端点：坏 Origin 的浏览器请求直接 403，
  // 无 Origin（server-to-server / curl）按 allowNoOrigin 放行。
  if (!isPublicGet && !originAllowed(req)) {
    console.warn(`[oauth] origin rejected:`, req.headers.get('origin'));
    return json(req, { error: 'invalid_request' }, 403);
  }

  const admin = () =>
    createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } },
    );

  try {
    if (path.endsWith('/.well-known/openid-configuration') && req.method === 'GET') {
      return await handleDiscovery(req);
    }
    if (path.endsWith('/.well-known/jwks.json') && req.method === 'GET') {
      return await handleJwks(req);
    }
    if (path.endsWith('/oauth/authorize') && req.method === 'GET') {
      return await handleAuthorize(req, admin());
    }
    if (path.endsWith('/oauth/transaction') && req.method === 'GET') {
      return await handleTransactionQuery(req);
    }
    if (path.endsWith('/oauth/complete') && req.method === 'POST') {
      return await handleComplete(req);
    }
    if (path.endsWith('/oauth/consent') && req.method === 'POST') {
      return await handleConsent(req);
    }
    if (path.endsWith('/oauth/token') && req.method === 'POST') {
      return await handleToken(req);
    }
    if (path.endsWith('/oauth/userinfo') && req.method === 'GET') {
      return await handleUserinfo(req);
    }
    if (path.endsWith('/oauth/revoke') && req.method === 'POST') {
      return await handleRevoke(req);
    }
    if (
      path.endsWith('/oauth/authorize') || path.endsWith('/oauth/token') ||
      path.endsWith('/oauth/userinfo') || path.endsWith('/oauth/revoke') ||
      path.endsWith('/oauth/complete') || path.endsWith('/oauth/consent') ||
      path.endsWith('/oauth/transaction')
    ) {
      // 路径对但方法错：OAuth 语义（authorize=GET / token=POST）必须守住。
      return json(req, { error: 'invalid_request', error_description: 'method not allowed' }, 405);
    }
    return json(req, { error: 'not_found' }, 404);
  } catch (e) {
    console.error('[oauth]', e);
    return json(req, { error: 'server_error' }, 500);
  }
});
