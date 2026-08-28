# WebAuthn MFA 技术实现要点清单

> **依据文档**（2026-08-27 实读）：
> 1. @simplewebauthn/server 官方文档（当前版本 ^13.0.0）
> 2. @simplewebauthn/browser 官方文档（当前版本 ^13.0.0）
> 3. @vc1023/passkey-2fa npm 包文档（v0.3.0）
> **性质**：技术参考资料，供 Part 5/Part 7 编码阶段执行时对照；不是需求变更，不推翻 Part 1–3 任何结论。

---

## 一、前端模块（来源：@simplewebauthn/browser 文档）

### 1.1 纯 HTML 环境的引入方式（对本项目最关键）

- 无构建工具时用 **UMD bundle**：`<script src="https://unpkg.com/@simplewebauthn/browser/dist/bundle/index.umd.min.js"></script>`，方法挂在全局对象 **`SimpleWebAuthnBrowser`** 上（解构取 `startRegistration` / `startAuthentication`）。
- 仅支持现代浏览器时用 ES2021 版；需在 IE11/Edge Legacy 做能力探测提示才用 ES5 版。
- **生产环境必须加 SRI 校验**（subresource integrity）：先解析重定向拿到精确版本 URL，再用 SRI Hash Generator 生成带 checksum 的 script 标签，防止 CDN 篡改。→ 落地到本项目：mfa.js 引入前先固化版本 + SRI。

### 1.2 注册流程调用序列（startRegistration）

1. `fetch('/generate-registration-options')` 从服务端拿 optionsJSON；
2. `startRegistration({ optionsJSON })` 交给认证器（Touch ID 弹窗）；
3. `fetch('/verify-registration', {method:'POST', body: JSON.stringify(attResp)})` 提交响应，等待 `{verified:true/false}`。
- 错误分支：`InvalidStateError` = 该认证器已被注册过（提示"已绑定"而不是报错堆栈）。
- **v11+ 签名变更**：参数必须包成 `{ optionsJSON, ... }` 对象传入，直接传 options 会报 `Cannot read properties of undefined (reading 'challenge')`。

### 1.3 登录流程调用序列（startAuthentication）

与注册对称：GET options → `startAuthentication({ optionsJSON })` → POST `/verify-authentication` → 按 `verified` 展示结果。

### 1.4 Conditional UI（免输入刷指纹直登）★本项目常态体验的核心

- 前置条件：页面必须存在带 **`autocomplete="webauthn"`** 的 `<input>`；找不到该输入框 `startAuthentication()` 直接报错。合法组合：`"webauthn"`、`"username webauthn"`、`"current-password webauthn"`（**webauthn 必须放最后**，否则跨浏览器不稳定）。
- 调用方式：`startAuthentication({ optionsJSON, useBrowserAutofill: true })`；若输入框确定存在于 shadow DOM 等位置可用 `verifyBrowserAutofillInput: false` 跳过元素检查。
- **必须在 `<head>` 里尽早初始化**：平台方指引"越早启动，浏览器越来得及向认证器查询可展示的通行证清单"。对本项目 → login-fido.html 把 conditional UI 初始化放进 `<head>` 内联小脚本，而不是 onload。
- 待处理的 conditional 请求会在下一次 `startAuthentication()` 调用时被自动取消（点击按钮走传统弹窗体验不会冲突）。
- 能力探测三件套：
  - `browserSupportsWebAuthn()` → 不支持则隐藏指纹入口、显示密码兜底文案；
  - `browserSupportsWebAuthnAutofill()` → 探测 conditional UI 支持；
  - `platformAuthenticatorIsAvailable()` → 异步判断 Touch ID/Windows Hello 是否可用，决定引导文案里说"刷指纹"还是"插入安全钥匙"。

### 1.5 机会型自动注册（Auto Register，加分项）

- 密码登录成功后的落地页调用 `startRegistration({ optionsJSON, useAutoRegister: true })`，浏览器可**静默**创建通行证（无弹窗）——正好实现我们"密码兜底登录后顺势引导绑定"的 FR-4.1。
- ⚠️ 该路径响应的 `up`（用户在场位）可能为 false：服务端 verify 时必须传 **`requireUserPresence: false`**，否则验证必失败。

### 1.6 其他前端要点

- 错误甄别用 `WebAuthnError`（`instanceof` 检查，看 `name/message/code/cause`）；`ERROR_CEREMONY_ABORTED`（用户取消/被取消）应当静默忽略。
- SPA 场景离开页面需手动 `WebAuthnAbortService.cancelCeremony()`；本项目是传统多页站点，靠"下一次调用自动取消"即可。
- 已知浏览器坑：Chrome ≤127 下 `user.displayName` 为空字符串会导致 QR 跨设备注册报 `NotAllowedError`——生成 options 时 `userDisplayName` 与 `userName` 填同值规避。

## 二、服务端模块（来源：@simplewebauthn/server 文档）

### 2.1 Deno/Edge 环境支持（官方一等公民）

- Deno v1.43+：`deno add jsr:@simplewebauthn/server`（JSR 分发）→ **Supabase Edge Functions 可直接用**，无需 Node 垫片。
- 类型直接可 import：`WebAuthnCredential`（v11+ 取代旧的 `AuthenticatorDevice`/`credentialID/credentialPublicKey` 命名）。

### 2.2 RP 三常量（服务端全局配置）

```js
const rpName = '…';                    // 人类可读站点名
const rpID   = 'celestivast.com';      // 不带协议不带斜杠；localhost 仅限本地开发
const origin = `https://${rpID}`;      // 注册/登录必须发生的来源，末尾不带 /
```
- `expectedOrigin` 与 `expectedRPID` 均支持**传数组**（多来源场景）；本项目固定单值。
- 与 Part 3 决策一致：rpID 锁裸域，子域名自动覆盖。

### 2.3 注册两端点（options 生成 + 响应验证）

**端点 A（GET）generateRegistrationOptions：**
- 必传 `rpName, rpID, userName`；`attestationType:'none'`（不做设备型号背书，UX 最顺）。
- `excludeCredentials: [已绑凭证 id+transports]` —— 防止同一认证器重复绑定。
- `authenticatorSelection`（本项目定值）：
  - `residentKey:'preferred'`（Android 上必然产出同步通行证；不消耗即代表不生成）；
  - **`userVerification:'required'`**（我们的策略需要强制生物识别位——文档原文：required=永远提供 MFA，代价是部分用户可能被要求输本地登录密码；'preferred' 则可能跳过 Touch ID 直接用登录密码放行，不符合"指纹底线"原则）；
  - `authenticatorAttachment:'platform'`（指向本机 Touch ID）；注意 `preferredAuthenticatorType` 一旦设置会**覆盖** attachment。
- 生成后必须**为该用户暂存 options**（含 challenge），供端点 B 比对。

**端点 B（POST）verifyRegistrationResponse：**
```js
verifyRegistrationResponse({
  response: body,
  expectedChallenge: 暂存的options.challenge,   // 单次有效，用后即弃
  expectedOrigin: origin,
  expectedRPID: rpID,
})
```
- 成功后从 `verification.registrationInfo` 取 `credential / credentialDeviceType / credentialBackedUp`，连同 `options.user.id`（webAuthnUserID）整体入库（字段清单见第三节）。
- 排障记忆点：环境报 Ed25519(-8) 相关错误（`Unrecognized name` / `kty OKP not supported`）时，`supportedAlgorithmIDs: [-7, -257]` 排除 Ed25519 并要求用户重新绑定。

### 2.4 登录两端点

**端点 A（GET）generateAuthenticationOptions：**
- `rpID` + `allowCredentials:[该用户已绑凭证]`（限定必须用已注册认证器）；支持自定义 challenge 传入。
- 同样要**暂存 options.challenge** 待验证比对。

**端点 B（POST）verifyAuthenticationResponse：**
```js
verifyAuthenticationResponse({
  response: body,
  expectedChallenge, expectedOrigin, expectedRPID,
  credential: { id, publicKey, counter, transports },   // ← v11+ 参数名是 credential
})
```
- 先按 `body.id` 查库取该用户的 passkey；查不到直接抛错（"Could not find passkey …"）——这是"凭证被吊销后立即失效"的落点。

### 2.5 counter（签名计数器）检查逻辑与 Touch ID 特例 ★

- 原则：counter 只增不减。**若库中已存 counter>0，而新响应 counter ≤ 旧值 → 该认证器疑似克隆/被攻破，应拒绝并告警。** 库负责更新：`authenticationInfo.newCounter` 写回。
- **官方明示特例：macOS Touch ID 永远返回 counter=0。** 此时无法用 counter 检测克隆， RP 只需存 0 并正常放行。
- → 对本项目：counter 检查逻辑照实现（`IF stored > 0 AND new <= stored THEN reject`），但对 macOS 平台认证器天然不触发；防克隆价值主要在未来出现的安全钥匙/Windows 设备上。

### 2.6 attestation 格式

`attestationType:'direct'` 才会返回设备背书声明，支持 packed/TPM/Android-Key/SafetyNet/Apple/U2F/none 全格式；文档明确"这是高级概念，不关心设备型号可忽略" → 本项目维持 `'none'`。

## 三、数据库模块（来源：server 文档 Passkey 数据结构 + passkey-2fa 迁移文件模式）

### 3.1 官方建议的凭证表结构（v13 Passkey 型）

| 字段 | SQL 类型建议 | 说明 |
|---|---|---|
| `id` | TEXT，加索引 | 凭证唯一 ID（base64url 字符串） |
| `publicKey` | BYTEA/BLOB 原始字节 | 供后续验签；⚠️ Node ORM 可能映射成 Buffer，读出后转回 Uint8Array |
| `user`（FK） | 外键指向用户模型 | 文档强烈建议**凭证单独建表**，勿塞用户表 |
| `webauthnUserID` | TEXT；对 (webAuthnUserID+user) 建 UNIQUE | 隐私增强：对外暴露的 WebAuthn 用户句柄与内部用户 ID 解耦 |
| `counter` | BIGINT | 某些认证器返回原子时间戳当 counter，必须用大整型 |
| `deviceType` | VARCHAR(32)，现值最长 12 字符 | `singleDevice` / `multiDevice` |
| `backedUp` | BOOL | 是否已同步备份（iCloud 钥匙串判据——对应我们"同步来源标记"设计） |
| `transports` | VARCHAR(255) 存 CSV | `['ble','cable','hybrid','internal','nfc','smart-card','usb']` |

### 3.2 暂存挑战的存储

options/challenge 需在"GET options → POST verify"之间存活且**一次性**（两份文档均明确要求服务端自行暂存与销毁）。落地：独立 `webauthn_challenges` 表或带 TTL 的临时表，绑定 user+purpose+过期时间。

### 3.3 passkey-2fa 的迁移文件佐证

该包自带 `migrations/0001_passkey_tables.sql`（结构未在本页展开，但其表清单=passkey 表 + 挑战表），与我们 Part 5 计划的 `webauthn_credentials` 表字段族一致，可作为建表 SQL 的旁路参照。

## 四、会话管理模块（重点来源：@vc1023/passkey-2fa 文档）

### 4.1 该包的 Supabase 集成模式（原样归纳）

- 定位：**Next.js App Router 专用**（route-handler 工厂 + Edge middleware + client helpers），不是通用库；`runtime="nodejs"`（AAL2 token 用 `node:crypto`）。→ **包本身不能搬进我们的 Supabase Edge Functions + 纯 HTML 栈**，但其**模式清单**全部可移植。
- 因子分层：邮箱密码 = 第一因子（**Supabase Auth 原生，AAL1**）；passkey = 强制第二因子（自管 WebAuthn，**AAL2**，服务端强制）；TOTP = 可选备用因子（走 **Supabase 原生 MFA**，0.3.0 起与 passkey 铸造同一 AAL2 会话）。
- **会话桥接核心机制（与 Part 3 §4 桥接方案并行的第二种业界实现）**：验证通过后签发**会话绑定的 AAL2 cookie**——
  - AAL2 token **绑定到 Supabase session id，fail-closed**：偷来的 AAL2 cookie 无法给别的会话提权（换会话即失效）；
  - 中间件按路由强制 AAL2（`requireAal2()` 不满足则跳登录页）；
  - Supabase 侧需要关闭邮箱确认，才能让注册-绑定在同一次流程内完成（对本项目不适用：我们必须保留邮箱确认，作为未成年人场景的额外校验，绑定延后到首次登录引导）。

### 4.2 值得移植进本项目的四项工程纪律

1. **单次性挑战 + 过期**（single-use expiring challenges）→ 我们 `webauthn_challenges` 表设计已对齐。
2. **重放防护 counter**（replay-protected counter）→ §2.5 逻辑。
3. **每路由限速**（per-route rate limiting）：包默认内存固定窗口仅适用单实例，serverless 多实例需注入分布式滑动窗口限速器（示例 Upstash Redis）。→ 本项目 Edge Functions 天然多实例：限速须落在**共享存储**（Postgres 计数表）而非函数内存，这是 Part 5 必须修正的一个实现细节。
4. **fail-loud 配置校验**：生产环境缺 `WEBAUTHN_ORIGIN/RP_ID/RP_NAME/AUTH_MFA_SECRET` 或 origin 非 https / RP-ID 与 origin host 不符时**启动即失败**。→ 我们的 Edge Functions 应在冷启动做同等断言，避免"静默降级成不安全配置"。

### 4.3 两套桥接模式的对照结论（写入 Part 3 备注，不改其决策）

| | 我们的方案（Part 3 §4，方案A） | passkey-2fa 的方案 |
|---|---|---|
| 凭证形态 | 兑换成 **Supabase 标准 JWT 会话**（verifyOtp 桥接） | 自签 **AAL2 cookie** 叠加在 Supabase 会话旁 |
| RLS 兼容 | 原生全兼容（JWT 即会话） | 依赖其服务端路由逐点检查 AAL2 |
| 适配我们"静态站+RLS"架构 | ✅ 正确 | ❌ 其 AAL2 检查点在 Next 服务端渲染层，我们没有这一层 |
| 可借鉴 | — | 会话绑定/fail-closed 思想 → 落为"桥接票据仅签发给发起验证的同一会话上下文" |

### 4.4 客户端 helper 语义参考

`signUp→enrollPasskey` / `signIn→challengePasskey` / `signOut` / `browserSupportsPasskeys`，统一返回 `{ok:true} | {ok:false, reason:"cancelled"|"unsupported"|"error"}` —— 这个**三态返回契约**与我们 Part 2 §5 `ISAMFA.login()` 的返回设计一致，照此细化。

---

## 五、落地核对速查（编码阶段逐条打钩）

- [ ] 前端 UMD 引入 + SRI 固定版本
- [ ] login-fido.html `<head>` 早期启动 conditional UI；`autocomplete="username webauthn"`
- [ ] `userVerification:'required'` + `attestationType:'none'` + `residentKey:'preferred'`
- [ ] excludeCredentials/allowCredentials 传 id+transports
- [ ] challenge 服务端暂存、单次销毁
- [ ] verify 参数用 `credential`（非旧版 `authenticator`）；browser 参数包 `{optionsJSON}`
- [ ] counter：`stored>0 且 new<=stored` 拒绝；Touch ID 恒 0 需豁免分支
- [ ] 凭证表按 §3.1 建列（含 deviceType/backedUp/transports CSV）
- [ ] 限速用 Postgres 共享计数（勿用函数内存）
- [ ] Edge Function 冷启动 fail-loud 配置断言
- [ ] 桥接票据绑定当前会话上下文（借鉴 fail-closed）
- [ ] Ed25519 排除位 `-8` 预案（`supportedAlgorithmIDs:[-7,-257]`）
