# Part 5 · 数据库与 API 契约

> 状态：🚧 待项目负责人确认
> 前置阅读：[04-核心流程设计](./04-核心流程设计.md)（本文是其全部流程的数据与接口落地物）
> 读者提示：表结构对齐 W3C L3 credential record 要求与 simplewebauthn 存储建议；RLS 草案吸收旧站审计 H-2 的教训——**策略显性化、随仓库归档**。

---

## 一、新增数据表（7 张，SQL 草案）

```sql
-- ① 用户 MFA 状态（互动门槛与风控的判定核心）
create table public.mfa_enrollments (
  user_id uuid primary key references auth.users(id) on delete cascade,
  enabled boolean not null default false,          -- FR-8 门槛判据
  restricted_until timestamptz,                    -- FR-9.5 24h受限模式
  suspended boolean not null default false,        -- FR-6.3 一键挂起
  suspended_at timestamptz,
  recovery_batch integer not null default 0,       -- 当前有效恢复码批次号
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ② WebAuthn 凭证（W3C L3 credential record 全字段，G1/G3/G4 落位）
create table public.webauthn_credentials (
  id text primary key,                             -- credential ID(base64url)·G4:≤1023字节+全局唯一由主键保证
  user_id uuid not null references auth.users(id) on delete cascade,
  webauthn_user_id text not null,                  -- user handle(无PII·G规范要求)·(webauthn_user_id,user_id)唯一
  public_key bytea not null,                       -- 供验签
  counter bigint not null default 0,               -- Touch ID恒0→服务端"stored>0才比较"分支
  transports text not null default '',             -- CSV: internal,hybrid,...
  device_type varchar(32) not null,                -- singleDevice/multiDevice
  uv_initialized boolean not null default false,   -- G1: UV位信任状态
  backup_eligible boolean not null default false,  -- G3: BE创建时定死不可变
  backup_state boolean not null default false,     -- G3: BS可漂移·变化触发安全提示
  device_label text,                               -- 学生可读昵称("我的MacBook")
  is_sync_source boolean not null default false,   -- iCloud同步来源标记(Part3决策)
  suspended boolean not null default false,        -- 单凭据停用
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (webauthn_user_id, user_id)
);
create index on public.webauthn_credentials (user_id);

-- ③ 挑战暂存（单次有效·TTL 300s·G7）
create table public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade, -- 注册前可为空(discovery)
  purpose text not null check (purpose in ('enroll','login','rebind')),
  challenge text not null,                         -- base64url
  options jsonb not null,                          -- 整包暂存供verify比对
  expires_at timestamptz not null default now() + interval '300 seconds',
  consumed boolean not null default false
);
create index on public.webauthn_challenges (expires_at);  -- 定时清理

-- ④ 恢复码（10条/批·决策D·只存hash·FR-6.4）
create table public.recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code_hash bytea not null,                        -- SHA-256(salt‖code)
  batch integer not null,                          -- 对齐 mfa_enrollments.recovery_batch
  used_at timestamptz,                             -- 非空=已消费(一次性)
  created_at timestamptz not null default now()
);
create index on public.recovery_codes (user_id, batch);

-- ⑤ 手机号绑定（一次性验证·FR-2）
create table public.phone_bindings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  phone_hash bytea not null,                       -- 只存hash·展示尾四位另存
  phone_last4 varchar(4) not null,
  verified_via text not null default 'sms',        -- sms / admin_manual(FR-2.4)
  verified_at timestamptz not null default now()
);
create unique index on public.phone_bindings (phone_hash); -- FR-2.2 一号一户

-- ⑥ 短信/恢复码等一次性票据与验证码
create table public.otp_tokens (
  id uuid primary key default gen_random_uuid(),
  purpose text not null check (purpose in ('phone_otp','email_confirm_action')),
  subject text not null,                           -- 手机号hash或user_id
  secret_hash bytea not null,
  expires_at timestamptz not null default now() + interval '300 seconds',
  consumed boolean not null default false,
  created_at timestamptz not null default now()
);

-- ⑦ 风控事件（FR-9.4）
create table public.risk_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  signals jsonb not null,                          -- 命中的信号数组
  level text not null check (level in ('normal','medium','high')),
  channel text not null,                           -- webauthn / password_fallback / recovery
  action_taken text not null,                      -- pass / confirm_dialog / restricted_mode
  created_at timestamptz not null default now()
);
create index on public.risk_events (user_id, created_at);
```

**复用的既有表**：`notifications`（绑定/解绑/挂起/风控提示照现有 type 机制写入）、`logs`（管理员兜底操作与敏感事件追加 action 枚举值：`mfa_enroll`/`mfa_unbind`/`recovery_used`/`suspend`/`unsuspend`/`admin_*`）。

## 二、RLS 策略草案（显性化·随仓库归档）

```sql
alter table public.webauthn_credentials enable row level security;
-- 原则:凭据表用户不可直接读写——全部经 Edge Functions(service_role)操作
-- 唯一例外:用户读自己的"设备列表摘要"供安全中心展示
create policy "read own device list" on public.webauthn_credentials
  for select using (auth.uid() = user_id);
-- 无 insert/update/delete 策略 = 对anon与普通用户全部拒绝(H-2教训:不存在"默认放行")

alter table public.mfa_enrollments enable row level security;
create policy "read own status" on public.mfa_enrollments
  for select using (auth.uid() = user_id);        -- interactionStatus 数据源
-- 写入仅 service_role

-- recovery_codes / otp_tokens / webauthn_challenges / risk_events:
--   enable RLS 且不建任何 policy(全拒)——只允许 service_role 经 Edge Functions 触达
alter table public.recovery_codes    enable row level security;
alter table public.otp_tokens        enable row level security;
alter table public.webauthn_challenges enable row level security;
alter table public.risk_events       enable row level security;

-- phone_bindings:用户仅可读自己的尾四位摘要列(视图实现,基表全拒)
```

> 对照审计 H-2：这套策略本身入库管理，未来所有者可据此逐条实证（回应"口头保证"问题）。

## 三、Edge Functions API 契约（12 个端点）

统一响应信封：`{ ok:boolean, data?:…, code?:string }`；`code` 走统一错误字典（§五）。统一要求：HTTPS only、Origin 白名单校验、JWT/session 上下文绑定（fail-closed 票据）、**限速全部落 Postgres 共享计数表**（`rate_limits(key, window_start, count)`，Passkey-2fa 教训：函数内存限速在多实例下失效）。

| # | 端点 | 方法 | 认证 | 请求 → 响应（关键示例） |
|---|---|---|---|---|
| 1 | `check-email-domain` | POST | 无 | `{email}` → `{ok, domain}`；白名单来自 config；FR-1.2 服务端强制 |
| 2 | `phone/send-otp` | POST | 无+Turnstile | `{phone}` → `{ok}`；同一手机号 24h ≤5 条；号已绑定→`PHONE_TAKEN` |
| 3 | `phone/verify-otp` | POST | 无 | `{phone, code}` → `{ok, otpToken}`（一次性票据 5min） |
| 4 | `phone/bind` | POST | 注册会话+otpToken | `{otpToken}` → `{ok}`；写 phone_bindings |
| 5 | `webauthn/register-options` | POST | 会话 | `{purpose:'enroll'\|'rebind'}` → `{optionsJSON}`；excludeCredentials 自动注入；challenge 入暂存表 |
| 6 | `webauthn/register-verify` | POST | 会话 | `{response}` → `{verified, recoveryCodes:[10]}`；**G1:** UV 位必须=1→`uvInitialized=true`；**G2:** crossOrigin=true 拒；**G4:** id≤1023B+全局唯一；**G8:** alg∈列表；生成恢复码批 |
| 7 | `webauthn/login-options` | POST | 无 | `{}`（discovery）或 `{email}` → `{optionsJSON}`（可空 allowCredentials=通行证直登）；挑战暂存 |
| 8 | `webauthn/login-verify` | POST | 无 | `{response}` → `{token_hash, riskLevel}`；**userHandle↔credentialId 双重核对**；UV 位=1（底线）；counter 检查（Touch ID 豁免）；BE 校验；suspended 凭据拒；内部 risk/evaluate；service_role generate_link 出 token_hash；**fail-closed：票据绑定会话上下文** |
| 9 | `recovery/use` | POST | 无（邮箱链接会话） | `{code}` → `{ok, token_hash}`；hash 比对·标记 used_at·风控高事件 |
| 10 | `recovery/regenerate` | POST | 强验证会话 | `{}` → `{recoveryCodes}`；批次号+1·旧批作废·logs |
| 11 | `security/unbind` | POST | 强验证会话 | `{credentialId}` → `{ok}`；删行；前端随后调浏览器 signalUnknownCredential（G5） |
| 12 | `security/suspend` | POST | 邮箱链接确认 | `{}` → `{ok}`；全凭据 suspended+会话失效+双通道通知 |

内部端点（非前端调用）：`risk/evaluate`（信号采集与矩阵判定，见 4.6）、`rate_limit/check`。

## 四、前端契约补充：`ISAMFA.errors` 统一错误字典

```js
ISAMFA.errors.translate('DOMAIN_NOT_ALLOWED') // → "请使用学校邮箱注册"
// 内置映射(节选):
// DOMAIN_NOT_ALLOWED   请使用学校邮箱注册
// PHONE_TAKEN          该手机号已被其他账号使用
// OTP_EXPIRED          验证码已过期，请重新获取
// CHALLENGE_EXPIRED    操作超时，请重试
// NO_PASSKEY           这台设备还没有绑定通行证
// UV_REQUIRED          需要指纹验证才能继续
// CREDENTIAL_SUSPENDED 账号已挂起，请联系管理员
// RATE_LIMITED         尝试次数过多，请稍后再试
// CEREMONY_ABORTED     (静默·不展示)
// FALLBACK             系统开小差了，请稍后重试(raw 进 console)
```

宿主页面引用后，历史页面的英文报错问题一并收敛（线上问题 3 闭环）。

## 五、配置与响应头

```text
# _headers 追加(仅新增,不改旧行)——G6
/mfa/*
  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://unpkg.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://*.supabase.co https://challenges.cloudflare.com; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
```

`mfa.config.js` 定值：`rpID:'celestivast.com'`、`origin:'https://celestivast.com'`、`timeout:300000`（G7）、`recoveryCodes:10`（决策 D）、风控参数组、`ENABLED` 总开关（NFR-3）。

## 六、验收对照

- 表结构与 RLS：每张表可对照本文件逐条验证（H-2 的"看不见的防线"变为可见可测）。
- API：12 端点覆盖 Part 4 全部时序图的每一笔交互；错误码全覆盖 4.0 统一字典。
- 规范缺口 G1–G8 全部落位（各表注释与端点说明处标了 G#）。
