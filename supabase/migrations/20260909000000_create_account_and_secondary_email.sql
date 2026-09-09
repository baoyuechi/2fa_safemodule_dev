-- ============================================================================
-- M-ACCT 数据层 · 安全中心增强：加密钥修改 / 手机号换绑 / 第二辅助邮箱
--
-- 依据：security center 三功能（修改密码重认证、手机号换绑、第二辅助邮箱）。
-- 数据最小化沿用既有纪律：邮箱只存 SHA-256(pepper‖邮箱) 摘要 + 展示掩码，
-- 永不落库明文；手机号仍走 phone_bindings（本轮不加字段）。
--
-- 本批范围：
--   1) otp_tokens.purpose 扩为含 'email_otp'（(重认证/第二邮箱的邮箱 OTP，复用
--      一次性票据机制；'email_confirm_action' 为早期预留，不动）；
--   2) 新增 secondary_emails（一人至多一条，email_hash 全局唯一）。
--
-- 安全原则：新表 RLS 全拒（无 policy）——读写仅限 service_role 经 Edge Functions。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ① otp_tokens.purpose 扩为含 'email_otp'
-- ---------------------------------------------------------------------------
alter table public.otp_tokens drop constraint if exists otp_tokens_purpose_check;
alter table public.otp_tokens add constraint otp_tokens_purpose_check
  check (purpose in ('phone_otp', 'email_otp', 'email_confirm_action'));

comment on column public.otp_tokens.purpose is
  'phone_otp=手机号验证码；email_otp=邮箱验证码（重认证/第二辅助邮箱共用，subject=邮箱hash）；email_confirm_action=早期预留。';

-- ---------------------------------------------------------------------------
-- ② 第二辅助邮箱（一人至多一条；email_hash 全局唯一，杜绝跨账号重复）
-- ---------------------------------------------------------------------------
create table public.secondary_emails (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  email_hash   bytea not null,                       -- SHA-256(pepper‖邮箱)，永不落库明文
  email_mask   text not null,                        -- 展示掩码（如 a***@example.com）
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz not null default now()
);
create unique index secondary_emails_email_hash_key on public.secondary_emails (email_hash);

comment on table public.secondary_emails is
  '第二辅助邮箱（无域名限制，仅需格式合法、≠主邮箱、全局唯一）。基表全拒（RLS 无 policy），写入仅 service_role。';

alter table public.secondary_emails enable row level security;