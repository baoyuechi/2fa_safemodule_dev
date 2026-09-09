-- ============================================================================
-- M2 数据层 · 第六批迁移：recovery_codes（备用安全码）
--
-- 依据：design/05-数据库与API契约.md §一④（10条/批·决策D·只存hash·FR-6.4）、
--       §三 端点 6/9/10（register-verify 发首批码、recovery/use 消费、
--       recovery/regenerate 换批）。
--
-- 安全原则：RLS 全拒（无任何 policy）——读写仅限 service_role 经
-- Edge Functions（审计 H-2 教训：不存在"默认放行"）。明文码永不落库，
-- 仅存 SHA-256(pepper‖code) 摘要（pepper 见 _shared/crypto.ts，fail-loud）。
-- ============================================================================

-- ④ 恢复码（10条/批·决策D·只存hash·FR-6.4）
create table public.recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash bytea not null,                        -- SHA-256(pepper‖code)，pepper 来自 MFA_HASH_PEPPER
  batch integer not null,                          -- 对齐 mfa_enrollments.recovery_batch（当前有效批次）
  used_at timestamptz,                             -- 非空=已消费（一次性，消费后不可复用）
  created_at timestamptz not null default now()
);
create index on public.recovery_codes (user_id, batch);

comment on table public.recovery_codes is
  '备用安全码（10条/批·只存哈希·一次性）。regenerate 时批次号+1，旧批自然失效。全拒 RLS，仅 service_role 经 recovery/* 端点触达。';

-- RLS：全拒（无任何 policy = 对 anon 与普通用户全部拒绝）
alter table public.recovery_codes enable row level security;
