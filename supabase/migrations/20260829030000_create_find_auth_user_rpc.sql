-- ============================================================================
-- M1/M2 · 第四批迁移：按邮箱定位认证用户的 RPC
--
-- 依据：design/05-数据库与API契约.md §三 端点 7（webauthn/login-options 需以
--       email 定位用户）；auth schema 不经 PostgREST 暴露，Edge Functions 以
--       service_role 经此 RPC 查询。
--
-- 安全：SECURITY DEFINER（owner=postgres 具 auth 读取权）；仅返回 user id，
--       不泄露邮箱以外的任何字段；revoke anon/authenticated——禁止前端直调
--       （否则可被用作账号存在性枚举器；反枚举由 login-options 的 decoy 逻辑负责）。
-- ============================================================================

create or replace function public.find_auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id
  from auth.users
  where lower(email) = lower(p_email)
  limit 1;
$$;

comment on function public.find_auth_user_id_by_email(text) is
  '按邮箱定位 auth.users 的 id（login-options 专用）。仅 service_role 可执行；无匹配返回 NULL。';

revoke execute on function public.find_auth_user_id_by_email(text) from anon, authenticated;
