## 目标

在 /Users/Offline/Documents/2fa_safemodule_dev 中，为 isaSpectrum 校园留言板网站产出一套「可插拔 WebAuthn(MFA) 认证模块」的设计文档（本轮只做文档，不写业务代码），采取分 Part 汇报制：每完成一个 Part 即向用户讲解并等待确认后再继续下一 Part。全程不修改 reference/isaspectrum-main 中的任何文件。

## 已由用户确认的需求要点（写入 Part 1）

- 校园环境：高中生注册必须使用学校邮箱域（其余拒绝）；手机号仅在注册时验证一次，此后不用于登录（学生在校内不便用手机）。
- 登录体验：学生配专用带 Touch ID 的 MacBook；第二因子采用 WebAuthn 平台认证器（指纹）；采用风险自适应策略——常规情况仅指纹即可登录，风控判定可疑时补验密码。
- 引导策略（类 Steam 暂挂机制）：未启用 MFA 的账号只能浏览，不能发帖/回复等互动操作。
- 恢复策略：静态一次性恢复码，覆盖换机、设备丢失、盗号等场景。
- 用户背景：嵌入式出身、初次接触 Web 开发——所有文档用通俗语言，术语配类比解释。

## 工作步骤

1. 在 workspace 创建 design/ 目录与 README.md（进度总览 + 各 Part 状态表）。
2. 依次撰写以下文档，每份写完停下汇报：
   - Part 1 design/01-需求定义.md：角色、功能需求清单、非功能需求（隐私/合规考虑 minors 场景）、验收标准，并回显现状分析结论。
   - Part 2 design/02-架构与模块边界.md：现有静态站的集成挂载方式（mfa.js + 独立页面集 + 对 login/messages 的最小挂钩点说明，引用已探明的两个 signInWithPassword 调用点与页面守卫机制）、模块对外接口定义（可插拔性契约）。
   - Part 3 design/03-技术选型.md：论证 Supabase 内置 MFA 不支持 WebAuthn → 自建方案的构成（Supabase Edge Functions + @simplewebauthn/server 开源库）、WebAuthn/passkey 基础科普（面向嵌入式读者：证书与会话的安全边界类比）、rpID 与域名的匹配约束。
   - Part 4 design/04-核心流程设计.md：全部 Mermaid 时序图——注册+邮箱域名校验+一次性手机OTP；MFA 绑定（首次引导强制进门）；日常指纹直登（conditional mediation/passkey autofill UI）；风控升级为密码二次确认；恢复码生成/单次使用/重新生成；换机迁移流程；盗号处置流程。
   - Part 5 design/05-数据库与API契约.md：新增数据表（webauthn_credentials、mfa_enrollments、recovery_codes、otp_single_use、risk_events）建表草案、RLS 思路、Edge Function API 端点清单及请求/响应示例。
   - Part 6 design/06-威胁模型与安全清单.md：STRIDE 化简版逐项对策（钓鱼：rpID 绑定天然防跨域；共享设备；恢复码明文存储策略(哈希)会话固定、限速、审计日志复用现有 logs 表模式）。
   - Part 7 design/07-实施路线图.md：后续编码阶段的里程碑划分与依赖。
3. 每完成一个 Part：更新 README 进度表 → 输出该 Part 内容摘要并用通俗语言讲解关键决策点 → AskUserQuestion 或开放式询问收集修改意见，按反馈修订后再进入下一 Part。

## 交付边界

- 本轮仅产出 design/ 下文档，不创建任何业务代码文件。
- 不触碰 reference/ 目录。
- 语言全部为中文，术语首次出现时附嵌入式领域类比或一句话解释。