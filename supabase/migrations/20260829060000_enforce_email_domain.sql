-- ============================================================================
-- M1 数据层补洞 · FR-1.2 服务端强制学校邮箱域名
--
-- 背景：域名白名单此前仅由前端在注册前调 check-email-domain 预检，直打
-- GoTrue /signup 可绕过。本迁移把强制点搬进数据库：auth.users INSERT 触发
-- 器，非白名单域直接拒绝建号（FR-1.2"拒绝必须在服务端执行"）。
--
-- 白名单存数据表（改域/增教师域只需 DML，无需改代码重部署）：
--   public.allowed_email_domains(domain)
-- 触发器函数 SECURITY DEFINER，失败抛异常 → GoTrue 返回 500，攻击路径专用；
-- 正常用户走前端预检，几乎触达不到本错误。
-- ============================================================================

-- 白名单表（FR-1.3：域名为配置项，不写死）
create table public.allowed_email_domains (
  domain text primary key,                         -- 存小写裸域，如 isawuhan.com
  note text not null default '',
  created_at timestamptz not null default now()
);

comment on table public.allowed_email_domains is
  '注册/登录允许的邮箱域名白名单（FR-1.2/FR-1.3）。auth.users 插入触发器强制；增改教师域直接 DML。';

-- 种子：与 mfa.config.js allowedEmailDomains 保持一致（双源以本表为准执行）
insert into public.allowed_email_domains (domain, note) values
  ('isawuhan.com', '学校主域（与 mfa.config.js 对齐）');

-- RLS：全拒（无任何 policy）——仅 service_role/触发器触达，前端不可读（防枚举可注册域）
alter table public.allowed_email_domains enable row level security;

-- 强制函数：NEW.email 取 @ 后 [...] 内域名 → 小写比对白名单
create or replace function public.reject_nonschool_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_domain text;
begin
  v_domain := lower(split_part(NEW.email, '@', 2));
  if v_domain is null or v_domain = '' or not exists (
    select 1 from public.allowed_email_domains where domain = v_domain
  ) then
    raise exception 'email domain not allowed: %', v_domain
      using errcode = 'raise_exception';
  end if;
  return NEW;
end;
$$;

comment on function public.reject_nonschool_email() is
  'FR-1.2 服务端强制：auth.users 建号域名白名单校验（before insert trigger 调用）。';

-- 挂载到 auth.users（Supabase 允许在 auth 表建触发器；GoTrue 建号必经此路径，
-- 含 admin API——管理员后台建号同样受约束，如需特批请先加白名单）
drop trigger if exists trg_reject_nonschool_email on auth.users;
create trigger trg_reject_nonschool_email
  before insert on auth.users
  for each row
  execute function public.reject_nonschool_email();
