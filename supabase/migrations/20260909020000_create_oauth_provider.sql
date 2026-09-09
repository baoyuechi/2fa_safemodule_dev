-- ============================================================================
-- OAuth2 / OIDC Provider · 数据层迁移
--
-- 依据：OAuth 2.0 Authorization Code Flow + PKCE（RFC 6749 / RFC 7636）、
--       OpenID Connect Core 1.0（authorization code + nonce）。
--
-- 本 Provider 的信任链（与现有 MFA 链路解耦、不重写 WebAuthn/Recovery）：
--   Password / WebAuthn / Recovery / OTP（现有端点，零改动）
--     → Authentication Context（user_id + auth_time + amr + acr，由服务端
--        证据推导：risk_events 新鲜事件 + Provider 会话新鲜度，见 oauth
--        Edge Function 注释；浏览器自称的 amr 永不采信）
--     → oauth_authorization_transactions（服务端掌握 transaction 状态）
--     → oauth_authorization_codes（仅存 code hash，一次性 + 多维绑定）
--     → token endpoint（PKCE + client 认证）→ access / ID / refresh token
--
-- 安全原则（沿用本仓库既有纪律）：
--   - 六表全部 enable RLS 且不建任何 policy = 对 anon/authenticated 全拒；
--     状态变更只经 Edge Functions（service_role，自带 bypassrls）。
--   - authorization code / refresh token / client_secret 明文永不落库，
--     只存 SHA-256(pepper‖域分隔‖明文) 摘要（pepper 见 _shared/crypto.ts）。
--   - sub 统一为 auth.users.id（稳定 UUID）；email 仅作 claim，可变。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ① OAuth 客户端注册（第一阶段：数据库人工注册，无动态注册端点）
-- ---------------------------------------------------------------------------
create table public.oauth_clients (
  id uuid primary key default gen_random_uuid(),
  client_id text not null unique,                 -- 公开标识（人工颁发，如 cli_xxx）
  client_name text not null,                      -- 展示名（consent / 授权页用）
  client_type text not null
    check (client_type in ('public', 'confidential')),
  -- confidential client 的 secret 摘要；public client 必须为 NULL（绝不要求 secret）
  client_secret_hash text,
  redirect_uris text[] not null,                  -- 精确匹配登记值，禁止 wildcard/前缀匹配
  allowed_scopes text[] not null
    default array['openid', 'profile', 'email'],
  require_consent boolean not null default false, -- true=每次授权需用户显式同意
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (client_type = 'public' and client_secret_hash is null)
    or (client_type = 'confidential' and client_secret_hash is not null)
  )
);

comment on table public.oauth_clients is
  'OAuth2/OIDC 客户端注册（人工登记）。redirect_uri 精确匹配；secret 只存摘要。全拒 RLS，仅 service_role 经 oauth/* 触达。';

-- ---------------------------------------------------------------------------
-- ② Authorization transaction（一次 /oauth/authorize 请求的服务端状态机）
--
-- 状态机：INIT → CLIENT_VALIDATED → TRANSACTION_CREATED → AUTH_REQUIRED
--   → PRIMARY_AUTHENTICATED → MFA_REQUIRED → MFA_AUTHENTICATED
--   → CONSENT_REQUIRED(如需) → AUTHORIZED → CODE_ISSUED → REDIRECTED
-- 失败态：DENIED / EXPIRED / CANCELLED / ERROR。
-- 状态只由服务端（service_role）推进，浏览器不可写。
-- ---------------------------------------------------------------------------
create table public.oauth_authorization_transactions (
  id uuid primary key default gen_random_uuid(),
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade, -- 认证完成前为 NULL
  redirect_uri text not null,
  response_type text not null default 'code',
  scope text not null default 'openid',           -- 空格分隔的已批准 scope 子集
  state_hash text,                                -- state 的 SHA-256 hex（关联日志用，不存原文）
  nonce text,                                     -- OIDC nonce 原文（签发 ID Token 需要回填）
  nonce_hash text,                                -- nonce 的 SHA-256 hex（日志关联，避免原文进日志）
  code_challenge text not null,                   -- PKCE S256 challenge（强制）
  code_challenge_method text not null default 'S256',
  requested_acr text,                             -- 业务请求的 assurance（如 urn:example:loa:2）
  status text not null default 'AUTH_REQUIRED'
    check (status in (
      'INIT', 'CLIENT_VALIDATED', 'TRANSACTION_CREATED', 'AUTH_REQUIRED',
      'PRIMARY_AUTHENTICATED', 'MFA_REQUIRED', 'MFA_AUTHENTICATED',
      'CONSENT_REQUIRED', 'AUTHORIZED', 'CODE_ISSUED', 'REDIRECTED',
      'DENIED', 'EXPIRED', 'CANCELLED', 'ERROR'
    )),
  auth_methods text[] not null default '{}',      -- 已完成的认证方式（服务端证据追加，如 {pwd,webauthn}）
  auth_time timestamptz,                          -- 最近一次有效认证时间
  amr text[] not null default '{}',               -- Authentication Methods References
  acr text,                                       -- Assurance（如 urn:example:loa:1/2）
  consent_granted boolean not null default false,
  expires_at timestamptz not null
    default now() + interval '10 minutes',        -- transaction 短 TTL（10 分钟）
  consumed_at timestamptz,                        -- code 签发后置位（防同一 transaction 重复出码）
  created_at timestamptz not null default now()
);

create index oauth_transactions_client_created_idx
  on public.oauth_authorization_transactions (client_id, created_at);
create index oauth_transactions_expires_idx
  on public.oauth_authorization_transactions (expires_at);
create index oauth_transactions_user_created_idx
  on public.oauth_authorization_transactions (user_id, created_at);

comment on table public.oauth_authorization_transactions is
  'OAuth authorization transaction（服务端状态机）。浏览器只持有 id（高熵 UUID），状态只由 service_role 推进。全拒 RLS。';

-- ---------------------------------------------------------------------------
-- ③ Authorization codes（仅存 hash；一次性；多维绑定）
-- ---------------------------------------------------------------------------
create table public.oauth_authorization_codes (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,                 -- SHA-256 hex(code 明文)，明文永不落库
  transaction_id uuid not null
    references public.oauth_authorization_transactions(id) on delete cascade,
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  redirect_uri text not null,                     -- 兑换时必须精确一致
  scope text not null default 'openid',
  nonce text,                                     -- 回填 ID Token nonce（原文，service_role 可见即可）
  auth_time timestamptz not null,
  amr text[] not null default '{}',
  acr text,
  code_challenge text not null,                   -- 兑换时重算比对
  code_challenge_method text not null default 'S256',
  expires_at timestamptz not null
    default now() + interval '5 minutes',         -- 短 TTL（5 分钟）
  used_at timestamptz,                            -- 原子置位；非空=已消费（重放/并发兑换只认第一人）
  created_at timestamptz not null default now()
);

create index oauth_codes_expires_idx
  on public.oauth_authorization_codes (expires_at);

comment on table public.oauth_authorization_codes is
  'Authorization code（仅存 hash，一次性，绑定 client/redirect_uri/PKCE/user/scope/nonce）。全拒 RLS，仅 service_role。';

-- ---------------------------------------------------------------------------
-- ④ Refresh tokens（opaque；rotation + reuse detection + revocation）
--
-- 注意：绝不把 Supabase(GoTrue) refresh token 直接发给业务网站；
-- 此处是 OAuth Provider 自己签发的 opaque token（仅存 hash）。
-- ---------------------------------------------------------------------------
create table public.oauth_refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,                -- SHA-256 hex(token 明文)
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null default 'openid',
  amr text[] not null default '{}',
  acr text,
  expires_at timestamptz not null
    default now() + interval '30 days',
  revoked_at timestamptz,                         -- 非空=已吊销/已轮换作废
  replaced_by uuid references public.oauth_refresh_tokens(id) on delete set null,
  rotation_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index oauth_refresh_user_client_idx
  on public.oauth_refresh_tokens (user_id, client_id);
create index oauth_refresh_expires_idx
  on public.oauth_refresh_tokens (expires_at);

comment on table public.oauth_refresh_tokens is
  'OAuth refresh token（opaque，只存 hash；rotation + reuse detection：旧 token 复用即整链吊销）。全拒 RLS，仅 service_role。';

-- ---------------------------------------------------------------------------
-- ⑤ Consents（用户对 client 的 scope 授权记录）
-- ---------------------------------------------------------------------------
create table public.oauth_consents (
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  granted_scopes text[] not null default '{openid}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, client_id)
);

comment on table public.oauth_consents is
  '用户对业务 client 的授权记录（trusted first-party 可免显式 consent，见 require_consent）。全拒 RLS，仅 service_role。';

-- ---------------------------------------------------------------------------
-- ⑥ Signing keys（非对称签名密钥元数据；私钥不出库、不进 git、不进日志）
--
-- active key 用于签发；previous key 在 rotation grace 期内仍保留公钥供验证。
-- 私钥以 JWK 形式存 private_jwk（仅 service_role 可读；生产建议迁移到 Vault/KMS，
-- 本表届时只保留 kid→公钥与引用）。首个 active key 由 oauth Edge Function
-- 首次启动时自动生成并持久化（WebCrypto RS256-2048），绝不提交进仓库。
-- ---------------------------------------------------------------------------
create table public.oauth_signing_keys (
  kid text primary key,                           -- JWT header kid / JWKS kid
  alg text not null default 'RS256' check (alg in ('RS256', 'ES256')),
  public_jwk jsonb not null,                      -- 公钥 JWK（进 JWKS）
  private_jwk jsonb not null,                     -- 私钥 JWK（仅 service_role；禁日志/禁前端）
  status text not null default 'active'
    check (status in ('active', 'previous', 'retired')),
  created_at timestamptz not null default now(),
  retired_at timestamptz
);

comment on table public.oauth_signing_keys is
  'OAuth/OIDC JWT 签名密钥（RS256/ES256）。私钥仅 service_role 可读，绝不进 git/日志/前端。全拒 RLS。';

-- ---------------------------------------------------------------------------
-- ⑦ RLS：六表全拒（无任何 policy = 对 anon 与普通用户全部拒绝）
-- ---------------------------------------------------------------------------
alter table public.oauth_clients enable row level security;
alter table public.oauth_authorization_transactions enable row level security;
alter table public.oauth_authorization_codes enable row level security;
alter table public.oauth_refresh_tokens enable row level security;
alter table public.oauth_consents enable row level security;
alter table public.oauth_signing_keys enable row level security;

-- ---------------------------------------------------------------------------
-- ⑧ 本地开发 seed：public 测试 client（无 secret，可提交；生产 client 人工登记）
-- ---------------------------------------------------------------------------
insert into public.oauth_clients
  (client_id, client_name, client_type, redirect_uris, allowed_scopes, require_consent, enabled)
values
  ('dev-local-spa', 'Local Dev SPA', 'public',
   array['http://localhost:5173/oauth/callback', 'http://localhost:3000/auth/callback'],
   array['openid', 'profile', 'email', 'offline_access'],
   false, true)
on conflict (client_id) do nothing;
