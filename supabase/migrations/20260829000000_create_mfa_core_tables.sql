-- ============================================================================
-- M1 数据层 · 第一批迁移：mfa_enrollments + webauthn_credentials
--
-- 依据：
--   design/05-数据库与API契约.md              §一（表结构草案）、§二（RLS 草案）
--   design/spec-webauthn-核心概念与实现要点.md §5.2（规范缺口 G1/G3/G4 落位）
--   design/tech-webauthn-实现要点清单.md      §3.1（simplewebauthn 凭证表字段建议）
--
-- 本批范围：M1 前两张核心表。其余五表（webauthn_challenges / recovery_codes /
-- phone_bindings / otp_tokens / risk_events）与 rate_limits 由后续迁移按同一契约补齐。
--
-- 安全原则（审计 H-2 教训：不存在"默认放行"）：
--   RLS 必须随建表同批启用——Supabase 默认将 public 表全部权限授予
--   anon/authenticated，未开 RLS 的表对 anon key 立即全开放。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ① 用户 MFA 状态（一人一行·互动门槛与风控的判定核心）
-- ---------------------------------------------------------------------------
create table public.mfa_enrollments (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,          -- FR-8 门槛判据：首个凭证 verify 成功后置 true
  restricted_until timestamptz,                    -- FR-9.5 密码兜底后 24h 受限模式截止时间
  suspended boolean not null default false,        -- FR-6.3 一键挂起（冻结全部凭据+会话失效）
  suspended_at timestamptz,                        -- 挂起发生时间（管理员复核解冻 FR-7 的依据）
  recovery_batch integer not null default 0,       -- 当前有效恢复码批次号（对齐 recovery_codes.batch，该表后续迁移建）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()    -- 由 trg_mfa_enrollments_set_updated_at 触发器在每次 UPDATE 时自动刷新
);

comment on table public.mfa_enrollments is
  '用户 MFA 状态（一人一行）。写入仅限 Edge Functions（service_role）；RLS 仅放行本人 SELECT（interactionStatus 数据源）。';

-- ---------------------------------------------------------------------------
-- ② WebAuthn 凭证（一人多凭据·W3C L3 credential record 全字段，G1/G3/G4 落位）
-- ---------------------------------------------------------------------------
create table public.webauthn_credentials (
  id text primary key,                             -- credential ID(base64url)·G4:≤1023字节在 Edge Function 校验（DB 层无法可靠校验 base64url 解码长度）+全局唯一由主键保证
  user_id uuid not null references auth.users(id) on delete cascade,
  webauthn_user_id text not null,                  -- user handle(≤64B·禁含PII)·与内部 user_id 解耦·同一用户所有凭据 handle 一致
  public_key bytea not null,                       -- COSE 公钥原始字节·供登录断言验签
  counter bigint not null default 0 check (counter >= 0),
                                                   -- 签名计数器·Touch ID 恒 0 → 服务端"stored>0 才比较"分支
                                                   -- 必须 bigint：个别认证器回传原子时间戳当 counter
  transports text not null default '',             -- CSV: internal,hybrid,...（getTransports() 序列化·回填后续 allowCredentials）
  device_type varchar(32) not null check (device_type in ('singleDevice','multiDevice')),
                                                   -- simplewebauthn credentialDeviceType（现值最长 12 字符）
  uv_initialized boolean not null default false,   -- G1: UV 位信任状态·false→true 跃迁需等价于 WebAuthn UV 的额外因子授权
  backup_eligible boolean not null default false,  -- G3: BE 创建时定死不可变（登录时须与记录值一致）
  backup_state boolean not null default false,     -- G3: BS 随备份状态漂移·1→0 变化触发安全中心提示
  device_label text,                               -- 学生可读昵称（"我的MacBook"）
  is_sync_source boolean not null default false,   -- iCloud 同步来源标记（Part 3 决策）
  suspended boolean not null default false,        -- 单凭据停用（区别于账号级 mfa_enrollments.suspended）
  created_at timestamptz not null default now(),
  last_used_at timestamptz,                        -- login-verify 成功时更新
  unique (webauthn_user_id, user_id)
);

-- 安全中心"设备列表"按 user_id 查询；login-verify 按 id 查凭证由主键覆盖
create index webauthn_credentials_user_id_idx on public.webauthn_credentials (user_id);

comment on table public.webauthn_credentials is
  'WebAuthn 凭证（一人多凭据）。W3C L3 credential record 字段族 + 项目策略列。写入仅限 Edge Functions（service_role）；RLS 仅放行本人 SELECT（设备列表摘要）。';

-- ---------------------------------------------------------------------------
-- ③ RLS（Part 5 §二·策略显性化随仓库归档）
--    只建 SELECT 策略：无 insert/update/delete 策略 = 对 anon 与普通用户全部拒绝，
--    写入仅 service_role 经 Edge Functions（该角色自带 bypassrls）。
-- ---------------------------------------------------------------------------
alter table public.mfa_enrollments enable row level security;
create policy "read own status" on public.mfa_enrollments
  for select using (auth.uid() = user_id);

alter table public.webauthn_credentials enable row level security;
-- 原则：凭据表用户不可直接读写——全部经 Edge Functions(service_role) 操作
-- 唯一例外：用户读自己的"设备列表摘要"供安全中心展示
create policy "read own device list" on public.webauthn_credentials
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- ④ updated_at 自动维护（mfa_enrollments 专用触发器）
-- ---------------------------------------------------------------------------
create function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger trg_mfa_enrollments_set_updated_at
  before update on public.mfa_enrollments
  for each row
  execute function public.tg_set_updated_at();
