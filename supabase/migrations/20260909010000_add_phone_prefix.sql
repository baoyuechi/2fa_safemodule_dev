-- 手机号首三位（换绑页「补全 **** 中段」持有者自证用）：仅存号段前缀，敏感度低，
-- 与既有尾四位一起组成 "138****1234" 式掩码。前缀无法从哈希回推，存量行保持 NULL。
alter table public.phone_bindings
  add column phone_prefix text;

comment on column public.phone_bindings.phone_prefix is
  '11 位号码的首三位（归属地号段）；配合 phone_last4 组成校验掩码展示。存量行因仅存哈希无法回填';