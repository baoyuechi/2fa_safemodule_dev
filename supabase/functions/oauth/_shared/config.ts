// ============================================================================
// OAuth2 / OIDC Provider · 配置（Edge Function 侧·单一事实来源）
//
// 全部经环境变量覆盖（生产走 `supabase secrets`，绝不写进源码）：
//   OAUTH_ISSUER            签发者（如 https://auth.example.com；本地缺省派生）
//   OAUTH_LOGIN_URL         Provider 前端根地址（缺省 http://localhost:5173）
//   OAUTH_ALLOWED_ORIGINS   追加 CORS Origin（逗号分隔，与 mfa.config 合并）
//   OAUTH_ACCESS_TOKEN_TTL  秒（缺省 3600）
//   OAUTH_ID_TOKEN_TTL      秒（缺省 3600）
//   OAUTH_AUTH_CODE_TTL     秒（缺省 300）
//   OAUTH_REFRESH_TOKEN_TTL 秒（缺省 30 天）
//   OAUTH_TRANSACTION_TTL   秒（缺省 600）
//
// WebAuthn 配置（WEB_AUTHN_RP_ID / WEB_AUTHN_ORIGIN）不受影响，见 mfa.config.js。
// ============================================================================

import { config as mfaConfig } from '../../_shared/mfa.config.js';

export const LOA1 = 'urn:example:loa:1';
export const LOA2 = 'urn:example:loa:2';

export const SUPPORTED_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;
export const SUPPORTED_RESPONSE_TYPES = ['code'];
export const SUPPORTED_GRANT_TYPES = ['authorization_code', 'refresh_token'];
export const SUPPORTED_CODE_CHALLENGE_METHODS = ['S256'];
export const SUPPORTED_ACR_VALUES = [LOA1, LOA2];
export const SUPPORTED_TOKEN_AUTH_METHODS = ['client_secret_basic', 'client_secret_post', 'none'];

function numEnv(name: string, def: number): number {
  const raw = Deno.env.get(name);
  if (raw === undefined || raw === '') return def;
  const v = Number(raw);
  if (!Number.isInteger(v) || v <= 0) {
    throw new Error(`[oauth.config] ${name} 必须为正整数: ${raw}`);
  }
  return v;
}

export const oauthConfig = {
  get loginUrl(): string {
    return Deno.env.get('OAUTH_LOGIN_URL') ?? 'http://localhost:5173';
  },
  get accessTokenTtl(): number {
    return numEnv('OAUTH_ACCESS_TOKEN_TTL', 3600);
  },
  get idTokenTtl(): number {
    return numEnv('OAUTH_ID_TOKEN_TTL', 3600);
  },
  get authCodeTtl(): number {
    return numEnv('OAUTH_AUTH_CODE_TTL', 300);
  },
  get refreshTokenTtl(): number {
    return numEnv('OAUTH_REFRESH_TOKEN_TTL', 30 * 24 * 3600);
  },
  get transactionTtl(): number {
    return numEnv('OAUTH_TRANSACTION_TTL', 600);
  },
  /** 允许的浏览器 Origin = MFA 白名单 + OAUTH 追加（业务站回调页/测试页） */
  get allowedOrigins(): string[] {
    const extra = (Deno.env.get('OAUTH_ALLOWED_ORIGINS') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return [...new Set([...mfaConfig.corsAllowOrigins, ...extra])];
  },
  get allowNoOrigin(): boolean {
    return mfaConfig.allowNoOrigin;
  },
  /** NFR-3 总开关：mfa enabled=false 时 OAuth 同停 */
  get enabled(): boolean {
    return mfaConfig.enabled;
  },
};

/**
 * issuer：显式 OAUTH_ISSUER 优先（生产与本地开发都应在 .env / secrets 中配置，
 * 如 http://127.0.0.1:54321/functions/v1/oauth）；缺省时尽力从请求派生。
 *
 * Kong 网关会剥离 /functions/v1 前缀再转发给 Edge Runtime，因此 req.url 里的
 * path 仅含 /oauth/… 后缀；x-forwarded-host 携带客户端看到的主机名。
 *
 * 本地开发时 Kong 会丢失端口号（127.0.0.1 而非 127.0.0.1:54321），
 * 这里统一回补54321端口。生产环境务必显式配置 OAUTH_ISSUER。
 */
export function issuerFor(req: Request): string {
  const explicit = Deno.env.get('OAUTH_ISSUER');
  if (explicit) return explicit.replace(/\/+$/, '');

  const fwdHost = req.headers.get('x-forwarded-host');
  const fwdProto = req.headers.get('x-forwarded-proto') ?? 'https';

  const url = new URL(req.url);
  const idx = url.pathname.indexOf('/oauth');
  const base = idx >= 0 ? url.pathname.slice(0, idx + '/oauth'.length) : '/oauth';

  if (fwdHost) {
    // fwdHost 无端口 = 本地开发 Kong 透传丢失；回补默认 API 端口 + 完整路径前缀
    if (!fwdHost.includes(':')) {
      if (/^(localhost|127\.0\.0\.1)$/i.test(fwdHost)) {
        return `${fwdProto}://127.0.0.1:54321/functions/v1/oauth`;
      }
      // 生产环境无端口：以 fwdHost 为准（operator 应显式设 OAUTH_ISSUER）
      return `${fwdProto}://${fwdHost}${base}`;
    }
    return `${fwdProto}://${fwdHost}${base}`;
  }

  // 无 x-forwarded-host（直连 edge runtime）：从 req.url origin 取主机名。
  // Deno edge runtime 中 req.url 通常仅含 path，origin 回落为 http://localhost。
  const origin = url.origin;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
    return `${fwdProto}://127.0.0.1:54321/functions/v1/oauth`;
  }
  return `${origin}${base}`;
}

export function endpointUrls(req: Request): {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  jwks_uri: string;
  revocation_endpoint: string;
} {
  const issuer = issuerFor(req);
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    userinfo_endpoint: `${issuer}/userinfo`,
    jwks_uri: `${issuer}/.well-known/jwks.json`,
    revocation_endpoint: `${issuer}/revoke`,
  };
}

/** amr → acr：表达最终 assurance，不简单复制 amr。 */
export function acrForAmr(amr: string[]): string | null {
  const s = new Set(amr);
  if (s.has('webauthn')) return LOA2; // 钓鱼抗性强的单因子即达 LoA2
  if (s.has('pwd') && (s.has('recovery') || s.has('otp'))) return LOA2;
  if (s.has('pwd')) return LOA1;
  if (s.has('recovery')) return LOA1; // 单独恢复码：弱单因子
  if (s.has('otp')) return LOA1;
  return null;
}

function acrRank(acr: string | null | undefined): number {
  if (acr === LOA2) return 2;
  if (acr === LOA1) return 1;
  return 0;
}

/** achieved 是否满足 requested（requested 为空 = 无要求）。 */
export function acrSatisfies(
  achieved: string | null | undefined,
  requested: string | null | undefined,
): boolean {
  if (!requested) return true;
  return acrRank(achieved) >= acrRank(requested) && acrRank(achieved) > 0;
}

/** acr_values（空格分隔，偏好有序）→ 取最强的受支持值；都不支持返回 null。 */
export function pickRequestedAcr(acrValues: string | null): string | null {
  if (!acrValues) return null;
  const parts = acrValues.split(/\s+/).filter(Boolean);
  let best: string | null = null;
  for (const p of parts) {
    if ((SUPPORTED_ACR_VALUES as readonly string[]).includes(p)) {
      if (acrRank(p) > acrRank(best)) best = p;
    }
  }
  return best;
}
