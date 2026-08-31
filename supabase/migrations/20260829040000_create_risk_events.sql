-- ============================================================================
-- M1/M2 · 第五批迁移：risk_events（风控事件）
--
-- 依据：design/05-数据库与API契约.md §一（⑦风控事件·FR-9.4）、§二（RLS 全拒）
--
-- 本批范围：login-verify 记录登录事件所需。M5 落地 risk/evaluate 后，
-- signals（设备指纹首见/网络/时段/敏感事件）与 level 矩阵逐步丰富。
-- ============================================================================

create table public.risk_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  signals jsonb not null,                          -- 命中的信号数组
  level text not null check (level in ('normal','medium','high')),
  channel text not null,                           -- webauthn / password_fallback / recovery
  action_taken text not null,                      -- pass / confirm_dialog / restricted_mode
  created_at timestamptz not null default now()
);

create index risk_events_user_created_idx on public.risk_events (user_id, created_at);

comment on table public.risk_events is
  '风控事件（FR-9.4·每次风控判定留痕，供管理员复盘）。全拒 RLS，仅 service_role 经 Edge Functions 写入。';

alter table public.risk_events enable row level security;
