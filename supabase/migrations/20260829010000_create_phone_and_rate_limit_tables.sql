-- ============================================================================
-- M1 数据层 · 第二批迁移：phone_bindings + otp_tokens + rate_limits
--
-- 依据：design/05-数据库与API契约.md §一（⑤手机号绑定、⑥一次性票据）、
--       §三 统一要求（限速全部落 Postgres 共享计数表——Passkey-2fa 教训：
--       函数内存限速在多实例下失效）
--
-- 本批范围：phone/send-otp、phone/verify-otp 两端点所需。
-- webauthn_challenges / recovery_codes / risk_events 由后续迁移补齐。
--
-- 安全原则：三表 RLS 全拒（无任何 policy）——读写仅限 service_role 经
-- Edge Functions（审计 H-2 教训：不存在"默认放行"）。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- ⑤ 手机号绑定（一次性验证·FR-2）
--    写入方是后续端点 phone/bind；send-otp 以 phone_hash 查询实现
--    "号已绑定→PHONE_TAKEN"（FR-2.2 一号一户）。
-- ---------------------------------------------------------------------------
create table public.phone_bindings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_hash bytea not null,                       -- 只存 hash（SHA-256(pepper‖手机号)，pepper 来自 MFA_HASH_PEPPER）·展示尾四位另存
  phone_last4 varchar(4) not null,
  verified_via text not null default 'sms',        -- sms / admin_manual(FR-2.4)
  verified_at timestamptz not null default now()
);
create unique index phone_bindings_phone_hash_key on public.phone_bindings (phone_hash); -- FR-2.2 一号一户

comment on table public.phone_bindings is
  '手机号绑定（一人一号·一号一户）。基表全拒（RLS 无 policy），用户可读的尾四位摘要视图待 M3 安全中心落地；写入仅 service_role。';

-- ---------------------------------------------------------------------------
-- ⑥ 短信/恢复码等一次性票据与验证码
--    phone/send-otp 写入 purpose='phone_otp'；phone/verify-otp 比对
--    secret_hash 并置 consumed=true（单次有效）。TTL 300s 由默认值保证。
-- ---------------------------------------------------------------------------
create table public.otp_tokens (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('phone_otp','email_confirm_action')),
  subject text not null,                           -- 手机号hash（hex 文本）或 user_id
  secret_hash bytea not null,                      -- SHA-256(pepper‖subject‖code)
  expires_at timestamptz not null default now() + interval '300 seconds',
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.otp_tokens is
  '一次性验证码与票据（单次有效·TTL 300s）。验证成功后 consumed=true，且该行 id 作为 otpToken 一次性票据供 phone/bind 在 expires_at 前使用。全拒 RLS，仅 service_role。';

-- ---------------------------------------------------------------------------
-- 限速共享计数表（Part 5 §三 统一要求）
-- ---------------------------------------------------------------------------
create table public.rate_limits (
  key text primary key,                            -- 形如 send_otp:{phoneHash} / verify_otp:{phoneHash}
  window_start timestamptz not null default now(),
  count integer not null default 0
);

comment on table public.rate_limits is
  'Postgres 共享固定窗口计数器（12 端点共用）。经 rate_limit_check() 原子自增；全拒 RLS，仅 service_role。';

-- ---------------------------------------------------------------------------
-- 限速原子计数函数：单条 upsert 完成"窗口未过期则累加、过期则重置"，
-- 返回当前窗口计数，由调用方与上限比对。12 端点统一复用。
-- ---------------------------------------------------------------------------
create or replace function public.rate_limit_check(p_key text, p_window interval)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.rate_limits (key, window_start, count)
  values (p_key, now(), 1)
  on conflict (key) do update
    set count = case when rate_limits.window_start > now() - p_window
                     then rate_limits.count + 1 else 1 end,
        window_start = case when rate_limits.window_start > now() - p_window
                     then rate_limits.window_start else now() end
  returning count into v_count;
  return v_count;
end;
$$;

comment on function public.rate_limit_check(text, interval) is
  '限速原子计数（共享固定窗口）。返回当前窗口累计次数；仅 service_role 可执行。';

-- 仅 Edge Functions（service_role）可调用；anon/authenticated 禁止——
-- 否则任何人可预烧任意 key 的计数实现限速投毒
revoke execute on function public.rate_limit_check(text, interval) from anon, authenticated;

-- RLS：三表全拒（无任何 policy = 对 anon 与普通用户全部拒绝）
alter table public.phone_bindings enable row level security;
alter table public.otp_tokens     enable row level security;
alter table public.rate_limits    enable row level security;
