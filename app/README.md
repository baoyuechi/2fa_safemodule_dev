# MFA 模块 · 前端页面（app/）

纯 HTML/CSS/JS，无框架、无构建。对应 M3 里程碑（mfa 页面集）。

## 文件结构

```
app/
├── login.html                        登录页（通行密钥 + 邮箱密码，Conditional UI）
├── register.html                     注册页（域名预检 + 邮箱密码注册 + 手机验证码预留区块）
├── enroll.html                       指纹绑定引导页（注册完成后自动跳转至此）
├── css/
│   └── style.css                     三页共享样式
└── js/
    ├── mfa-client.js                 L1 SDK：端点封装 + 错误字典 + Toast + 会话管理
    └── vendor/
        └── simplewebauthn.browser.umd.min.js   @simplewebauthn/browser@13.3.0（self-host）
```

## 启动

### 前置（后端三件套）

```bash
cd ~/Documents/2fa_safemodule_dev
supabase start                                  # 栈（Docker）
supabase functions serve --env-file supabase/.env   # 注入 MFA_HASH_PEPPER / WEB_AUTHN_RP_ID（长驻）
```

### 静态页面服务（三选一，端口须在 CORS 白名单内）

```bash
# 方式 A：npx serve（Node）
npx serve app -l 8788

# 方式 B：python3（零依赖）
python3 -m http.server 8788 --directory app

# 方式 C：VS Code Live Server（右键 login.html → Open with Live Server，端口 5500 已入白名单）
```

打开 http://localhost:8788/login.html 。

> 端口白名单见 `supabase/functions/_shared/mfa.config.js` 的 `corsAllowOrigins`
> （8788 / 5173 / 3000 / 5500 及其 127.0.0.1 变体）。换端口需同步补白名单。

## 完整流程测试

| 步骤 | 操作 | 预期 |
|---|---|---|
| 1 注册 | login.html → 「注册新账号」→ 填邮箱 + 密码×2 → 「注册并继续」 | gmail 等非白名单域名被拦截（"请使用学校邮箱注册"）；合法 `@isawuhan.com` 注册成功并**自动跳转 enroll.html** |
| 2 绑定 | enroll.html → 「🔐 立即绑定」 | Touch ID / Windows Hello 弹窗 → 验证 → "✅ 绑定成功"面板（显示 credential ID）；服务端已写 `webauthn_credentials` + `mfa_enrollments.enabled=true` |
| 3 登录-密码 | 退出 → login.html 邮箱密码登录 | Toast「登录成功」，顶部"当前用户：xxx"+ 绿色"已绑定通行密钥"徽标（经 RLS 读 `mfa_enrollments`） |
| 4 登录-通行密钥 | 「🔐 使用通行密钥登录」 | 同上；邮箱框留空走 discovery，填了邮箱按 allowCredentials 限定 |
| 5 Conditional UI | 页面加载后直接点邮箱输入框 | 浏览器自动弹出本机通行证，免输入直登（不支持时静默跳过） |
| 6 手机验证码（预留） | register.html → 展开「手机号绑定」→ 发送/验证 | 接真实模拟端点；验证码在 `docker logs supabase_edge_runtime_2fa_safemodule_dev \| grep '\[OTP\]'`；同一手机号 24h 限 5 条 |

> 手机绑定的落库（端点 4 `phone/bind`，持 verify-otp 返回的 otpToken）尚未实现，
> 当前为预留接口，不阻塞注册。邮箱域名校验为 fail-closed：预检请求失败同样不放行。

## 部署到生产（备忘）

1. `js/mfa-client.js` 顶部 `SUPABASE_URL` / `ANON_KEY` 换生产值；
2. vendor UMD 包改 unpkg CDN 并加 SRI（tech 清单 §1.1）：先解析重定向取精确版本 URL，再生成 checksum 的 `<script>` 标签；
3. 生产 rpID/origin 回落 `mfa.config.js` 定值（不设 `WEB_AUTHN_RP_ID/WEB_AUTHN_ORIGIN` 环境变量即可）；
4. `corsAllowOrigins` 收敛为业务域。

## 已对接端点（Part 5 §三）

| 端点 | 状态 | mfa-client 方法 |
|---|---|---|
| 1 check-email-domain | ✅ | `checkEmailDomain`（register.html 预检） |
| 2 phone/send-otp | ✅ | `sendOtp`（模拟短信：码在 edge 容器日志） |
| 3 phone/verify-otp | ✅ | `verifyOtp`（register.html 预留区块） |
| 4 phone/bind | ⏳ 未实现 | — |
| 5 webauthn/register-options | ✅ | `startPasskeyRegistration` 内部调用 |
| 6 webauthn/register-verify | ✅ | `submitPasskeyRegistration`（enroll.html） |
| 7 webauthn/login-options | ✅ | `loginOptions` |
| 8 webauthn/login-verify | ✅ | `loginVerify`（经 `exchangeTokenHash` 兑换会话） |
| 9-12 recovery / security | ⏳ 未实现 | — |

账号 API（GoTrue）：`signUp` / `signInWithPassword` / `signOut` / `exchangeTokenHash` / `fetchSessionUser`。
