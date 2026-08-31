-- ============================================================================
-- M1 数据层 · 第三批迁移：webauthn_challenges
--
-- 依据：design/05-数据库与API契约.md §一（③挑战暂存：单次有效·TTL 300s·G7）、
--       §二（RLS：enable 且不建 policy——全拒，仅 service_role 触达）
--
-- 本批范围：webauthn/register-options、后续 register/login-verify 比对挑战所需。
-- recovery_codes / risk_events 由后续迁移补齐。
-- ============================================================================

create table public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade, -- 注册前可为空(discovery 登录)
  purpose text not null check (purpose in ('enroll','login','rebind')),
  challenge text not null,                         -- base64url
  options jsonb not null,                          -- 整包暂存供 verify 端点比对
  expires_at timestamptz not null default now() + interval '300 seconds', -- G7: 与 timeout=300000ms 一致
  consumed boolean not null default false
);

create index webauthn_challenges_expires_at_idx on public.webauthn_challenges (expires_at); -- 定时清理

comment on table public.webauthn_challenges is
  'WebAuthn 挑战暂存（单次有效·TTL 300s·服务端生成·G7）。verify 端点比对后置 consumed=true；全拒 RLS，仅 service_role。';

alter table public.webauthn_challenges enable row level security;
