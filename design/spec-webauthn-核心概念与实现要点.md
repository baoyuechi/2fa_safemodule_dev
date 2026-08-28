# WebAuthn 核心概念与实现要点（基于 W3C Level 2 / Level 3 规范）

> **依据文档**（2026-08-27 实读）：
> - W3C Web Authentication Level 2（https://www.w3.org/TR/webauthn-2/ ，REC 正式推荐标准，2021-04-08）
> - W3C Web Authentication Level 3（https://www.w3.org/TR/webauthn-3/ ，Candidate Recommendation Snapshot，2026-05-26）
> **性质**：技术参考资料。不推翻 Part 1–3 任何决策；第五节列出的"未覆盖项"是规范对我们设计的增量要求。

---

## 一、核心概念：术语精确定义（附校园场景类比）

> 全部定义出自 L2/L3 §4 Terminology 与 §1/§5/§6 相关章节。

### 1.1 三方角色

| 术语 | 规范定义（精要） | 校园类比 |
|---|---|---|
| **WebAuthn Relying Party (RP)** | 调用 WebAuthn API 注册和验证用户的实体；由"浏览器端脚本 + 服务端组件"构成，两者间通信 MUST 使用 HTTPS | 校墙网站本身。注意：RP ≠ 浏览器脚本，**服务端组件才是验签的那一方** |
| **WebAuthn Client** | 充当中介的实体（通常实现在用户代理里），负责编组输入、把认证器结果返回给调用方 | 学生的 Chrome/Safari 浏览器 |
| **Authenticator（认证器）** | 硬件或软件的密码学实体：能向 RP 注册用户、之后断言"持有已注册凭据"、并可选地验证用户 | MacBook 里的 Touch ID/Secure Enclave。**平台认证器**=焊死在设备里（Touch ID）；**漫游认证器**=可拔插（U 盾、手机跨设备） |
| **Ceremony（仪式）** | "带人类节点的网络协议"——注册仪式、登录仪式都有真人参与环节 | 整个流程算上"学生本人按下指纹"这个动作，才叫一次完整仪式 |

### 1.2 凭据本体

| 术语 | 规范定义 | 校园类比 |
|---|---|---|
| **Public Key Credential** | 上下文相关词：指①凭据源（credential source）、②（可能经过认证的）凭据公钥、③认证断言 三者之一 | 整套"学生证系统"的统称 |
| **Credential ID** | 认证器生成的概率唯一字节序列（≥16 字节、≥100 bit 熵；或加密的凭据源本体）；L3 明确上限 **1023 字节** | 学生证编号——由 Mac 生成，网站只存档 |
| **Credential Key Pair** | 认证器生成、**范围锁定到单个 RP** 的非对称密钥对。**私钥绑定管理认证器，永远不向任何一方暴露（连机主都不行）**；公钥在注册仪式时交给 RP | 私钥=刻在芯片里拿不出来的印章；公钥=交给教务处备案的印章拓样 |
| **User Handle（user.id）** | RP 指定的不透明字节序列，**≤64 字节、禁止含个人身份信息**（含邮箱哈希也不行，除非用 RP 私有盐）；L3：可发现凭据 MUST 返回它；同一用户所有凭据的 handle 应一致，且不应跨账号恒定 | 后勤处给学生编的随机学籍号——不是姓名不是手机号，纯粹用于把钥匙挂到对的柜子上 |
| **Discoverable Credential（通行证/passkey，旧称 resident key，已弃用）** | 存在认证器/客户端里的凭据源，RP 发**空 `allowCredentials`** 也能被找到——意味着用户无需先报名字 | 门禁系统自己认得"这台 Mac 上有哪个同学的通行证"，不用学生先自报姓名 |
| **Server-side Credential** | 必须由 RP 在 `allowCredentials` 里给出 credential ID 才能用；凭据本体加密后藏在 ID 里 | 老式门禁卡，必须刷卡报名 |

### 1.3 仪式与数据结构

| 术语 | 规范定义 | 要点 |
|---|---|---|
| **Challenge（挑战）** | RP 生成、被认证器签名的随机数。**§13.4.3：必须在 RP 信任的环境（服务端）生成；≥16 字节；RP 应临时存储到仪式完成；不比对即放弃安全性** | 防重放的根本机制：每次问的题都不一样 |
| **CollectedClientData** | 客户端数据：`type`（`webauthn.create`/`webauthn.get`，防签名混淆攻击）、`challenge`（base64url）、`origin`（完整来源）、`crossOrigin`；L3 新增 `topOrigin`（iframe 场景的顶层来源）。tokenBinding 在 L3 已 [RESERVED] | 被"签进"签名里的环境快照——验签时逐项核对 |
| **Authenticator Data（authData）** | 认证器写入的上下文绑定，≥37 字节：`rpIdHash`(32) + `flags`(1) + `signCount`(4) + 可选 attestedCredentialData + 可选 extensions。flags 位：**UP**(在场)/**UV**(已验证)/L3 的 **BE**(可备份)/**BS**(已备份)/AT/ED | 印章盖出来的防伪纹路：包含"是哪个域名的锁、有没有按指纹、计数器到几" |
| **Attestation（认证声明）** | 注册时对"认证器来源与属性"的见证（AAGUID=型号指纹）。类型：Basic（同批次共享证书）/Self（无独立认证密钥，用凭据私钥自签）/AttCA（TPM）/AnonCA（匿名 CA）/None。**声明格式**与**声明类型**是两个正交维度 | 出厂合格证。`none` 格式=不带证（Apple 设备天然只用匿名格式） |
| **Assertion（断言）** | 登录仪式的签名回应：`authenticatorData ‖ SHA-256(clientDataJSON)` 的整体签名，一次性使用 | "这道题是我用我的印章答的，题号也对得上" |
| **Attestation Trust Path** | 验证声明得到的 X.509 证书链（self/none 时为空）。RP 据此链到可信根（如 FIDO Metadata Service） | 沿合格证的签发单位一路查到"教育局" |
| **Test of User Presence (UP) vs User Verification (UV)** | UP=简单在场证明（碰一下）；UV=本地认证用户（指纹/PIN），**UV 发生在认证器内部，生物特征永不离开设备、永不发给 RP**——RP 只能看到签名里的 UV 位 | 在场=人在门口；验证=保安亲眼认出是你本人 |

### 1.4 Level 3 新增的核心概念（相对 L2 的实质变化，摘自 §18.1.1）

1. **Credential Record（凭据记录）**：正式定义 RP 服务端必须/建议存储的字段族：`type, id, publicKey, signCount, transports, uvInitialized, backupEligible, backupState`（+可选 `attestationObject, attestationClientDataJSON, rpId`）。
2. **BE/BS 备份状态标志**：BE 在创建时确定且永不变；BS 随备份状态漂移。组合语义：`00`=单设备凭据；`01`=非法；`10`=多设备未备份；`11`=多设备已备份。
3. **Conditional mediation（条件式调解）**：`get()` 的 `mediation:'conditional'`（autocomplete=webauthn 自动填充）与 L3 新增的 `create()` conditional（静默注册）；配套 `isConditionalMediationAvailable()` / `getClientCapabilities()`（`conditionalGet`/`conditionalCreate` 能力位）。
4. **Signal methods**：`signalUnknownCredential` / `signalAllAcceptedCredentials` / `signalCurrentUserDetails`——RP 向认证器反向同步"哪些凭据已被吊销/用户改名了"。
5. **Related Origins Requests**：RP ID 与调用源不同域时，靠 `https://rpID/.well-known/webauthn` JSON 清单（HTTPS、application/json、无凭据无 referrer 抓取）放行。
6. 其他：`hints`（security-key/client-device/hybrid）、`attestationFormats` 参数、`hybrid` 传输（手机扫码）、`prf` 扩展、compound attestation、`topOrigin`；弃用：`rp.name` 显示语义、android-safetynet 格式、tokenBinding、字段内嵌语言标签；测试向量（§16）可用于校验我们服务端实现。

---

## 二、注册流程

### 2.1 `navigator.credentials.create()` 完整参数（L3 §5.4）

```js
navigator.credentials.create({
  publicKey: {
    rp:        { id: 'celestivast.com', name: '…' },  // name 已弃用显示语义，安全起见可填=rp.id
    user:      { id: <userHandle ≤64B>, name: '…', displayName: '…' },  // 三者 REQUIRED；id 禁含 PII
    challenge: <服务端生成的随机数 ≥16B>,
    pubKeyCredParams: [ {type:'public-key', alg:-7}, … ],  // RP 支持的算法，按偏好排序；L3 建议至少含 -8/-7/-257；不建议 -9/-51/-52/-19
    timeout:   300000,                                     // 建议 300s（L3 §15.1：300000–600000ms）
    excludeCredentials: [ {type:'public-key', id, transports} ],  // 防同认证器重复绑定
    authenticatorSelection: {
      authenticatorAttachment: 'platform',   // 仅 create 有此参数；get() 没有
      residentKey: 'preferred' | 'required' | 'discouraged',
      requireResidentKey: false,             // 兼容 L1；仅当 residentKey=required 时置 true
      userVerification: 'required' | 'preferred' | 'discouraged'
    },
    attestation: 'none' | 'indirect' | 'direct' | 'enterprise',  // 默认 none；L3: none 时客户端把非自签声明替换为 none 格式（AAGUID 不再清零）
    attestationFormats: [],                  // L3 新增，advisory
    hints: ['client-device'],                // L3 新增，仅提示 UI 不构成要求
    extensions: { credProps: true, … }
  },
  signal: <AbortSignal>,                     // 可中断
  mediation: 'optional' | 'required' | 'conditional'   // L3 新增 conditional create
})
```

客户端返回 `PublicKeyCredential`：`id/rawId`（credential ID）、`response.clientDataJSON`、`response.attestationObject`、`response.getTransports()`（应存库并回填后续 allowCredentials）、`getClientExtensionResults()`。

### 2.2 服务端 verifyRegistrationResponse 必查字段（L3 §7.1 全 29 步中的安全关键项）

| # | 检查项 | 规范依据 |
|---|---|---|
| 1 | `C.type === 'webauthn.create'`（防签名混淆） | §7.1-7 |
| 2 | `C.challenge` === 之前签发并暂存的 challenge（base64url 精确相等，单次有效） | §7.1-8 + §13.4.3 |
| 3 | `C.origin` 是 RP 预期的 origin（§13.4.9：**默认精确字符串匹配 `https://rpID`**，不得放宽为"是其注册后缀即可"——子域可能承载不受信代码） | §7.1-9 + §13.4.8/9 |
| 4 | `C.crossOrigin===true` 时：确认 RP 预期 iframe 场景；`C.topOrigin` 存在时校验其为预期的被嵌入来源（L3 新增两步） | §7.1-10/11 |
| 5 | `authData.rpIdHash` === SHA-256(RP ID) | §7.1-14 |
| 6 | **UP 位必须为 1**（mediation=conditional 时可豁免）；**要求 UV 时 UV 位必须为 1** | §7.1-15/16 |
| 7 | BE=0 时 BS 必须为 0（组合 01 非法）；按策略评估 BE/BS 并存入凭据记录 | §7.1-17/18/19 |
| 8 | 凭据公钥的 `alg` ∈ pubKeyCredParams 所列 | §7.1-20 |
| 9 | attestation 格式：按 `fmt` 大小写敏感匹配已注册格式；执行该格式的验证流程；评估 trust path——none/自签=仅凭"策略接受"放行，否则 X.509 链必须链到可接受的根证书 | §7.1-21/22/24 |
| 10 | **credentialId ≤ 1023 字节**（L3 新增）且 **未被任何用户注册过**（重复 ID 应拒绝：防"抢注受害者凭据"攻击） | §7.1-25/26 |
| 11 | 构建 credential record 存库：signCount 初始化为 authData.signCount；uvInitialized=UV 位；backupEligible/backupState；transports | §7.1-27 |
| 12 | 扩展输出按策略处理（MUST 准备好"未请求的扩展出现"与"请求的扩展被忽略"两种情况） | §7.1-28 |

> counter 在注册时只做**初始化**（存 authData.signCount）；防克隆检查发生在登录时（见 §三）。

---

## 三、登录流程

### 3.1 `navigator.credentials.get()` 完整参数（L3 §5.5）

```js
navigator.credentials.get({
  publicKey: {
    challenge: <服务端生成 ≥16B>,
    timeout: 300000,
    rpId: 'celestivast.com',               // 省略则默认当前有效域
    allowCredentials: [ {type:'public-key', id, transports} ],  // 空=使用可发现凭据（用户可先不报名字）
    userVerification: 'required',          // required: 响应无 UV 位则整场仪式失败
    hints: [],                             // L3 新增
    extensions: {…}
  },
  signal, mediation: 'optional' | 'conditional' | 'required'
})
```

- **conditional mediation 的规范行为**（L3 §5.1.4.1）：`allowCredentials` 被强制清空（只有可发现凭据可参与）；lifetimeTimer=∞（页面生命周期内等待用户与 `autocomplete="webauthn"` 输入框交互）；依赖认证器 `silentCredentialDiscovery` 操作静默列出可用凭据。
- 返回 `AuthenticatorAssertionResponse`：`clientDataJSON / authenticatorData / signature / userHandle`（空 allowCredentials 时 userHandle MUST 返回）。

### 3.2 服务端 verifyAuthenticationResponse 必查字段（L3 §7.2 全 25 步中的安全关键项）

| # | 检查项 | 规范依据 |
|---|---|---|
| 1 | 若 allowCredentials 非空：`credential.id` 必须在列表内 | §7.2-5 |
| 2 | **userHandle/credentialId 匹配（身份归属双重核对）**：① 用户已识别（cookie/用户名）→ 验证该用户账户内存在 id 等于 `credential.rawId` 的凭据记录，且 `response.userHandle`（若存在）等于该账户 handle；② 用户未识别 → userHandle MUST 存在，由它定位账户，再验证其含此凭据记录 | §7.2-6 |
| 3 | `C.type === 'webauthn.get'`；challenge 精确比对 | §7.2-10/11 |
| 4 | origin 校验（同注册，§13.4.9）；crossOrigin/topOrigin 校验（L3） | §7.2-12/13/14 |
| 5 | `rpIdHash` === SHA-256(RP ID) | §7.2-15 |
| 6 | **UP 位必须为 1**；UV 策略：`userVerification==='required'` ⟺ 应要求 UV——**是则验 UV 位，否则忽略 UV 值** | §7.2-16/17 |
| 7 | BE/BS：BE=0 则 BS 必须为 0；BE 必须与凭据记录中注册时锁定的 backupEligible 一致（BE 永不可变） | §7.2-18/19 |
| 8 | **签名验证**：用凭据记录里的 publicKey 验 `authenticatorData ‖ SHA-256(clientDataJSON)` 整体签名（与 U2F 兼容） | §7.2-21 |
| 9 | **Counter 防克隆**：`signCount` 非零 **或** 存储值非零时执行比较——`new > stored` 合法并更新；`new ≤ stored` = 克隆警报/故障/乱序竞态。处置是 RP 策略问题（拒绝/风控降级均可），但 MUST 纳入风控评分 | §7.2-22 + §6.1.1 |
| 10 | 更新凭据记录：signCount、backupState；**uvInitialized=false→true 的跃迁 SHOULD 要求一个等价于 WebAuthn UV 的额外因子授权**（首个 UV 位尚无信任关系） | §7.2-24 |

> 规范细节：counter 恒 0 的认证器（Touch ID 恒 0）完全不触发第 9 步——这正是 simplewebauthn 文档所述特例的规范出处。

---

## 四、安全注意事项清单

| 主题 | 规范要求（出处） | 说明 |
|---|---|---|
| **RP ID 绑定** | RP ID = 有效域或其可注册后缀；scheme 必须 https（localhost+http 例外，L3 §4）；端口无关。凭据一旦绑定终身不可换根域 | 防钓鱼的物理根基：钓鱼域≠rpID → 设备拒绝签名 |
| **TLS** | RP 的浏览器脚本与服务端组件间 MUST HTTPS；WebAuthn API 仅在 secure context 暴露；`.well-known/webauthn` 抓取必须 https、无凭据、无 referrer、重定向全程 https | HTTPS 是整套体系的地面 |
| **防重放** | challenge 服务端生成、≥16 字节熵、单次有效、临时存储、TTL ≈ timeout 上限（L3 §13.4.3 显式要求） | 我们已对齐 |
| **Counter 单调性** | SHOULD 每凭据独立计数；RP 检测到非递增→纳入风控而非一律失败（可能是竞态）；恒 0 认证器（Touch ID）豁免 | §6.1.1 |
| **Origin 验证** | MUST 验证 clientData.origin；**默认精确匹配；不得放宽子域**（§13.4.8：rpID 范围内的子域上的注入代码可使全部安全保证失效） | |
| **代码注入（L3 新增 §13.4.8）** | 任何跑在 RP ID 范围 origin 上的恶意代码可作废 WebAuthn 全部保证 → **RP SHOULD 限制第三方脚本、SHOULD 用 CSP**；若允许子域 origin 则 MUST NOT 在其上提供不受信代码 | 对我们的直接推论：mfa 模块页面必须加 CSP |
| **嵌入使用** | 跨域 iframe 默认禁用（需 permissions policy `publickey-credentials-get/create` + iframe `allow`）；UI 遮挡（clickjacking）风险提示 | |
| **凭据丢失与恢复** | 规范不提供私钥备份协议；**SHOULD 鼓励注册多凭据**（excludeCredentials+user.id 保证绑到不同认证器）；单设备凭据(BE=0)不抗丢设备 → RP 应引导加第二凭据/恢复流程；BS 1→0（备份被关）应触发引导验证其他因子 | 与我们 FR-6 的规范互文 |
| **用户枚举**（§14.6.2）+ **unprotected account detection**（§13.4.7）+ **credential ID 泄漏**（§14.6.3） | 三个同源问题：allowCredentials 非空作第一步会泄露"哪些账号有 MFA/凭据 ID 长度特征"→ 建议先走认证步、或用可发现凭据（空 allowCredentials）、或返回虚构值；验证失败时"签名错"与"用户不存在"不可区分 | |
| **条件式 UI**（L3） | 使用前 MUST 用 `isConditionalMediationAvailable()` 或 `getClientCapabilities()['conditionalGet']` 探测；输入框 `autocomplete="webauthn"` 必须位于 input 上且 webauthn 排在最后；conditional 时 allowCredentials 被客户端强制清空 | |
| **Signal methods**（L3） | 吊销凭据后调用 `signalUnknownCredential`（未认证调用方安全，不泄凭据表）；登录后可 `signalAllAcceptedCredentials`/`signalCurrentUserDetails` 同步认证器端残影与改名 | |
| **Timeout**（L3 §15.1） | 推荐默认 300000ms、范围 300000–600000ms；无障碍可被客户端调整 | |

---

## 五、对照本项目（Part 1–3）的覆盖性核查

### 5.1 已覆盖（规范要求 ↔ 我们的设计）

| 规范要求 | 我们的位置 |
|---|---|
| RP ID 锁定裸域 + 子域不放宽 origin | Part 3 §2（rpID=celestivast.com）；expectedOrigin 精确单值 |
| challenge 服务端生成/暂存/单次/熵 | Part 3 §4 时序 + tech 清单 §2.2 |
| userVerification:'required'（指纹底线） | Part 3 §2.3 authenticatorSelection 定值 |
| excludeCredentials 防重复绑定 | Part 3 §2.3 |
| counter 防克隆 + Touch ID 恒 0 豁免 | tech 清单 §2.5 |
| credential record 字段族（transports/backedUp/deviceType 等） | tech 清单 §3.1（与 L3 credential record 高度重合） |
| user handle 禁 PII、webauthnUserID 解耦 | tech 清单 §3.1 |
| attestation=none | Part 3 §2.3 |
| 可发现凭据 + 空 allowCredentials（顺带满足 §14.6.3 枚举防护的最优解） | Part 2 §4 login-fido conditional UI |
| 恢复多凭据策略 | Part 1 FR-6.2 |

### 5.2 ❗未覆盖项（规范对设计的增量要求，建议纳入 Part 5/6 或修订 Part 3）

| # | 缺口 | 规范出处 | 建议动作 |
|---|---|---|---|
| G1 | **UV 位的服务端显式校验**未列入验收要点；且 **uvInitialized 生命周期策略**（false→true 需等价因子授权）完全未提及——这直接影响"指纹底线"能否被服务端强制 | §7.2-17/24 | Part 5 的 verify 端点检查表加入 UV 校验与 uvInitialized 字段；Part 4 流程图标注首次绑定即 uvInitialized=true 的授权路径 |
| G2 | **crossOrigin / topOrigin 拒绝策略未定义**：我们的页面无 iframe 嵌入计划，但规范要求显式决策"接受还是拒绝"，不能沉默跳过 | §7.1-10/11、§7.2-13/14、§13.4.9 | Part 6 安全清单定案：crossOrigin=true 一律拒绝（我们不嵌 iframe），topOrigin 存在即拒绝 |
| G3 | **BE/BS 备份状态漂移的处置流程缺失**：BS 1→0（iCloud 备份被关）时规范建议引导验证其他因子；BE=0 单设备凭据应触发"补注册/恢复"提示。我们只存了 backedUp 字段，没有消费它 | §6.1.3、§7.2-19 | Part 4 增加"备份状态变化→安全中心提示"分支；与 FR-6 联动 |
| G4 | **credentialId ≤1023 字节与全局唯一性检查**未列入服务端检查表 | §7.1-25/26 | 并入 Part 5 verify 检查清单（防凭据抢注攻击） |
| G5 | **L3 signal methods 未纳入设计**：学生解绑设备/管理员吊销后，认证器里的"残影"凭据仍会出现在 Conditional UI 选项里，选中即报错——典型体验事故；规范给出的正解就是 signalUnknownCredential | §5.1.10 | Part 2 §5 API 表新增内部调用；Part 4 解绑流程末尾追加 signalUnknownCredential |
| G6 | **模块页面缺 CSP**：L3 §13.4.8 明确"rpID 范围内的代码注入作废 WebAuthn 一切保证"，旧站审计（L-1）已证实全站无 CSP——我们的新页面绝不能继承这个状态 | §13.4.8 | Part 6 将"mfa/ 页面集 CSP 响应头"列为交付标准（_headers 按路径匹配） |
| G7 | **timeout 未定值**：规范推荐 300000ms（5 分钟），影响挑战 TTL 与用户体验一致性 | §15.1 | Part 5 配置项定值 300000 |
| G8 | **"alg 必须在 pubKeyCredParams 内"与"clientData type 字段核对"**两项库默认会做，但按规范属于 RP 义务，验收清单应显式可查 | §7.1-20、§7.2-10 | 并入 Part 5 检查清单 |

### 5.3 已评估、明确不采用的规范特性（记录备查）

- **Related Origin Requests**（§5.11）：单域名部署不需要；若未来为 App 增加独立域，启用 `.well-known/webauthn` 方案。
- **attestation 信任链校验 / enterprise attestation**：我们 attestation=none 且不校验设备型号（Part 3 已决策）；Self/None 的"仅策略放行"符合规范。
- **prf / largeBlob 扩展**：无对应需求。
- **tokenBinding**：L3 已 [RESERVED]，无需实现（L2 时代代码忽略之）。
- **conditional create（静默注册）**：作为可选增强跟随 simplewebauthn 的 useAutoRegister 支持，非首期必做。

---

## 六、一句话结论

规范层面我们此前的设计**主干正确**（挑战、RP ID、UV-required、counter、可发现凭据、恢复多凭据全对齐），但存在 **8 项规范明确要求而我们未写进文档的检查与策略**——其中 G1（UV/uvInitialized）、G5（signal methods）、G6（CSP）三条直接影响"指纹底线"在服务端是否真正可强制以及绑定后体验的正确性，建议优先并入 Part 5/6。
