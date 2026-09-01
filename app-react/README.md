# MFA 模块 · React + MUI 前端（app-react/）

`app/`（纯静态三页）的 React 重写版：**Vite + React 18 + TypeScript + MUI v7 + react-router**。
视觉风格学习 Google 账号认证页（宽版双栏认证卡、分步登录流、账户设置页），主题沿用品牌深蓝
`#1a3c6e` 并支持明暗切换（仿 MUI 官方 templates 的 `shared-theme` 模式）。

业务逻辑与 `app/` 三页 100% 对齐（登录 / 注册 / 绑定闭环，含 Conditional UI、fail-closed
域名预检、错误字典与静默纪律）。旧版 `app/` 原样保留作对照与回退。

## 页面结构（4 路由）

| 路由 | 页面 | 风格参照 |
|---|---|---|
| `/login` | 分步登录流：输入邮箱 → 选择登录方式（密码 / 通行密钥）→ 验证身份（密码 + 提示横幅 + 显示密码勾选）。已登录访问自动跳 `/security` | Google 宽版双栏认证卡 |
| `/register` | 域名预检注册（宽版双栏卡）+ 手机 OTP 预留折叠区（Accordion） | 同上 |
| `/enroll` | 通行密钥管理页：返回箭头 + 说明 + 「创建通行密钥」药丸 + 设备凭据列表卡（未登录跳 `/login`） | Google 通行密钥管理页 |
| `/security` | 安全中心（登录后首页）：安全状态卡 + 登录选项列表（通行密钥/邮箱密码/手机号预留）+ 您的账号（邮箱 / 退出） | Google 安全性与登录账户页 |

登录/注册页共用 `AuthShell`（左栏 Logo + 大标题 + 邮箱药丸，右栏交互区 + 右下角「下一步」药丸，
页脚 帮助/隐私权/条款）；`/enroll` 与 `/security` 共用 `AccountShell`（顶栏品牌 + 头像菜单，
左侧彩色圆标导航——手机号绑定 / 恢复码为预留禁用项，对应端点未实现）。

## 文件结构

```
app-react/
├── package.json / vite.config.ts / tsconfig.json / index.html
└── src/
    ├── main.tsx                     # 路由入口：/login /register /enroll /security
    ├── theme.ts                     # 品牌深蓝 + FIDO 绿；浅蓝灰底 #f0f4f9；明暗两套
    ├── shared-theme/
    │   ├── AppTheme.tsx             # ThemeProvider（cssVariables + system 跟随）
    │   └── ColorModeIconDropdown.tsx# 明暗切换（浅→深→跟随系统，MUI 持久化 localStorage）
    ├── api/
    │   └── mfaClient.ts             # L1 SDK 的 TS 移植（自 app/js/mfa-client.js）
    ├── components/
    │   ├── AuthShell.tsx            # 宽版双栏认证壳 + AuthActions（左次操作/右主操作）
    │   ├── AccountShell.tsx         # 账户页壳：顶栏 + 侧边栏导航 + 头像菜单
    │   ├── EmailPill.tsx            # Google 式邮箱药丸（可选下拉「使用其他账号」）
    │   └── ToastHost.tsx            # 监听 `mfa:toast` 事件 → MUI Snackbar
    └── pages/
        ├── LoginPage.tsx            # 分步登录流 + Conditional UI 常驻仪式
        ├── RegisterPage.tsx         # 域名预检 + 注册 + 手机 OTP 预留区块
        ├── EnrollPage.tsx           # 通行密钥管理页（创建/再绑/凭据列表）
        └── SecurityPage.tsx         # 安全中心（状态卡 + 登录选项 + 账号信息）
```

## 与旧版（app/）的差异

| 项 | 旧版 app/ | app-react/ |
|---|---|---|
| 架构 | 零构建 MPA，`.html` 跳转 | Vite SPA，react-router |
| WebAuthn 依赖 | self-host UMD（vendor/） | npm `@simplewebauthn/browser@^13`（与 server ^13 配对） |
| Toast | SDK 注入 DOM + 手写 CSS | SDK 派发 `mfa:toast` CustomEvent → MUI Snackbar |
| L1 SDK | `mfa-client.js`（ESM） | `mfaClient.ts`（签名与错误字典一致） |

三条移植时保住的硬约束：

1. **Conditional UI 输入框属性**：邮箱框保持 `autoComplete="username webauthn"`（webauthn 在最后），
   经 MUI `slotProps={{ htmlInput: {...} }}` 传入；
2. **SDK 契约不变**：错误码字典、`{ code, message, silent }` 抛错结构、`CEREMONY_ABORTED` 静默纪律原样保留；
3. **会话存储**：仍为 `localStorage` 的 `mfa.session`，与旧版页面互通（同一浏览器里旧版登录态对新版有效）。

## 启动

前置（后端三件套）同 `app/README.md`：

```bash
cd ~/Documents/2fa_safemodule_dev
supabase start
supabase functions serve --env-file supabase/.env   # 若未长驻
```

前端：

```bash
cd app-react
npm install
npm run dev        # http://localhost:5173/login
```

> 端口 5173 已在 `supabase/functions/_shared/mfa.config.js` 的 `corsAllowOrigins` 白名单内。
> 注意白名单里是 `http://localhost:5173`（及 127.0.0.1 变体），换端口需同步补白名单。

## 完整流程测试（2026-09-01 实测通过）

| 步骤 | 操作 | 预期（实测结果） |
|---|---|---|
| 1 注册拦截 | /register 填 `gmail.com` 邮箱提交 | 红色 Toast「请使用学校邮箱注册」✅ |
| 2 注册 | 合法 `@isawuhan.com` 提交 | Toast 成功 → 自动跳 /enroll（管理页空状态）✅ |
| 3 绑定 | /enroll「创建通行密钥」 | 服务端 options 正常返回，等待指纹（IAB 无认证器则静默）✅ |
| 4 登录分步流 | 退出 → /login：邮箱 → 下一步 → 选择方式 → 密码 → 下一步 | 跳转 /security ✅ |
| 5 安全中心 | /security | 状态卡 + 未绑定 Chip + 侧边栏导航 ✅ |
| 6 会话守卫 | 未登录直接开 /enroll 或 /security | replace 回 /login；已登录开 /login 跳 /security ✅ |
| 7 头像菜单退出 | 顶栏头像 → 退出登录 | Toast + 回登录页 ✅ |
| 8 明暗切换 | 右上角按钮循环 浅→深→跟随系统 | 认证卡 / 管理页 / 安全中心两套主题渲染正常 ✅ |

Conditional UI / Touch ID 仪式需在真实浏览器（Chrome/Safari + 已录入指纹）中验证；
In-app Browser 无平台认证器，仪式会静默降级——与设计一致（机会型体验铁律）。

## 部署到生产（备忘）

1. `src/api/mfaClient.ts` 顶部 `SUPABASE_URL` / `ANON_KEY` 换生产值；
2. `npm run build` 产出 `dist/` 静态资源（SPA 需将所有路径 fallback 到 index.html）；
   构建有单 chunk >500kB 警告，如在意可按路由做 `React.lazy` 代码分割；
3. 生产 rpID/origin 回落 `mfa.config.js` 定值；`corsAllowOrigins` 收敛为业务域；
4. 路由为 history 模式，若部署在子路径需给 `BrowserRouter` 加 `basename`。
