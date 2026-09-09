import * as React from 'react';
import { WebAuthnAbortService } from '@simplewebauthn/browser';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import Divider from '@mui/material/Divider';
import FormControlLabel from '@mui/material/FormControlLabel';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import FingerprintRoundedIcon from '@mui/icons-material/FingerprintRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import CircularProgress from '@mui/material/CircularProgress';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import AuthShell, { AuthActions } from '../components/AuthShell';
import EmailPill from '../components/EmailPill';
import InputError from '../components/InputError';
import Turnstile from '../components/Turnstile';
import type { TurnstileHandle } from '../components/Turnstile';
import type { InputErrorInfo } from '../components/InputError';
import { useI18n } from '../i18n/LocaleContext';
import { errorCodeToKey } from '../api/mfaClient';
import {
  browserSupportsWebAuthnAutofillSafe,
  browserSupportsWebAuthnSafe,
  clearSession,
  exchangeTokenHash,
  fetchSessionUser,
  getSession,
  handleError,
  loginMethods,
  loginOptions,
  loginVerify,
  saveSession,
  signInWithPassword,
  startPasskeyAuthentication,
  toast,
  useRecoveryCode,
} from '../api/mfaClient';
import { readPendingOAuthTx } from '../api/oauthClient';
import type { AuthenticationResponseJSON } from '../api/mfaClient';

/** OAuth 模式：登录成功后回到 Provider 授权页继续（而非进安全中心）。
 *  tx 来源：query ?oauth_tx=…（授权页跳转）或 sessionStorage（刷新/往返兜底）；
 *  state 同源透传。返回 true 表示已接管跳转。 */
function redirectIfOAuthPending(navigate: (to: string, opts?: object) => void): boolean {
  const queryTx = new URLSearchParams(window.location.search).get('oauth_tx');
  const pending = readPendingOAuthTx();
  const tx = queryTx ?? pending?.tx ?? null;
  if (!tx) return false;
  // state 优先 query（授权页 302 带来），否则用存储值；两者都没有则不带。
  const queryState = new URLSearchParams(window.location.search).get('oauth_state');
  const state = queryState ?? (pending?.tx === tx ? pending.state : null);
  const back = `/oauth/authorize?tx=${encodeURIComponent(tx)}` +
    (state ? `&state=${encodeURIComponent(state)}` : '');
  navigate(back, { replace: true });
  return true;
}

// Conditional UI 挂起的仪式用组件级 ref 记账：新一帧挂载（含从别页返回）时重置为 false，
// 从而每次进入登录页都会重新挂起常驻仪式；StrictMode 同一挂载的双调 useEffect 由
// conditionalRef 哑元二次跳过（避免重复 start）。卸载时调用 WebAuthnAbortService.cancelCeremony()
// 取消在途仪式，避免「幽灵登录」——用户中途转去注册/别页，conditional 仍存活完成指纹
// 并强拽跳/security。

type Step = 'email' | 'choose' | 'password' | 'recovery';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ── 登录流草稿（sessionStorage）──
// 中途点击「条款」等跳离 /login（AuthShell 页脚 RouterLink 会卸载本页、state 全丢），
// 返回时借草稿恢复到离开前的步骤与邮箱；密码/验证码不持久化（回到页面需重输）。
const LOGIN_DRAFT_KEY = 'mfa.loginDraft';
const DRAFT_STEPS: readonly string[] = ['choose', 'password', 'recovery'];

interface LoginDraft {
  step: Step;
  email: string;
}

/** 读取草稿：越出邮箱步才恢复步骤；仅在输过邮箱时恢复邮箱（邮箱步内也保留）。 */
function readLoginDraft(): LoginDraft | null {
  try {
    const raw = sessionStorage.getItem(LOGIN_DRAFT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LoginDraft>;
    if (typeof p.email !== 'string' || !p.email.trim()) return null;
    const step = DRAFT_STEPS.includes(p.step as string) ? (p.step as Step) : 'email';
    return { step, email: p.email.trim() };
  } catch {
    return null;
  }
}

function clearLoginDraft() {
  try {
    sessionStorage.removeItem(LOGIN_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}

/** Google 分步登录流（图 3/4/5 风格）：输入邮箱 → 选择登录方式 → 验证身份。 */
export default function LoginPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [checking, setChecking] = React.useState(true);
  // 惰性初始化还原上次离开前的登录步骤/邮箱（无闪跳）；密码等敏感值不还原
  const loginDraftRef = React.useRef(readLoginDraft());
  const [step, setStep] = React.useState<Step>(loginDraftRef.current?.step ?? 'email');
  const [email, setEmail] = React.useState(loginDraftRef.current?.email ?? '');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [busyPasskey, setBusyPasskey] = React.useState(false);
  const [emailBusy, setEmailBusy] = React.useState(false);
  const [busyPassword, setBusyPassword] = React.useState(false);
  const [busyRecovery, setBusyRecovery] = React.useState(false);
  // 行内字段错误（InputError 红字），输入即清除。存 i18n 键而非译文：语言切换后自动重译。
  const [emailError, setEmailError] = React.useState<InputErrorInfo | null>(null);
  const [passwordError, setPasswordError] = React.useState<InputErrorInfo | null>(null);
  const [passkeyError, setPasskeyError] = React.useState<InputErrorInfo | null>(null);
  const [recoveryCode, setRecoveryCode] = React.useState('');
  const [recoveryError, setRecoveryError] = React.useState<InputErrorInfo | null>(null);
  // Turnstile 人机验证：token 一次性，密码步提交前必须已通过挑战；
  // 每次提交（无论成败）都消费 token → 重置 widget 等待下一次挑战。
  const [captchaToken, setCaptchaToken] = React.useState('');
  const turnstileRef = React.useRef<TurnstileHandle>(null);
  // WebAuthn 能力探测：不支持时隐藏「使用您的通行密钥」入口
  const [passkeySupported, setPasskeySupported] = React.useState(true);
  React.useEffect(() => {
    setPasskeySupported(browserSupportsWebAuthnSafe());
  }, []);

  // 登录方式可用状态（按邮箱服务端查询）。三态：
  //   unknown = 查询中 → 渲染占据位（不出任何选项，避免「先全显后藏」的闪动）
  //   ok      = 查询成功 → 按 hasPasskeys/hasRecoveryCodes 裁剪入口
  //   failed  = 查询失败 → 放行全部（所有入口照显示，行为退回原状，绝不误伤合法用户）
  type MethodsState =
    | { status: 'unknown' }
    | { status: 'ok'; email: string; hasPasskeys: boolean; hasRecoveryCodes: boolean }
    | { status: 'failed' };
  const [methodsState, setMethodsState] = React.useState<MethodsState>({ status: 'unknown' });

// —— 登录方式可用性：按邮箱查可用登录方式，并做「直达/选择」分流 ——
// 反枚举与服务端统一口径见 supabase/functions/mfa/methods.ts；客户端只做展示裁剪。
// 仅剩密码一种方式时跳过选择页直达密码验证；有 ≥2 种方式才留在选择页让用户挑。
// 请求号正确性：StrictMode 开发期页首挂载会卸载旧实例再挂新实例，请求号保证只有
// 最后（当前实例）那次请求的结果被应用——不能再用「单飞锁+卸载取消」，否则结果
// 永远不落盘（「刷新后隐藏项复现」的根因）。
// 舒适度：同邮箱已有一份 ok 结果时保留它（重进不闪占位、不闪全显），后台静默刷新；
// 无可用结果时才显示占位等待首次请求。失败且无缓存 → failed 放行全部。
const methodsReqRef = React.useRef(0);
// 已由「邮箱步 → 下一步」即时解析过的邮箱：本次挂载内不再让 effect 重复请求，
// 直达分流已由 handleEmailNext 完成；仅刷新/草稿恢复着陆（非 email 步进）时 effect 兜底。
const resolvedByHandlerRef = React.useRef<string | null>(null);
React.useEffect(() => {
  if (step === 'email') return;
  const mail = email.trim().toLowerCase();
  if (!mail || resolvedByHandlerRef.current === mail) return;
  const req = ++methodsReqRef.current;
  setMethodsState((prev) =>
    prev.status === 'ok' && prev.email === mail ? prev : { status: 'unknown' },
  );
  void loginMethods(mail)
    .then((m) => {
      if (req !== methodsReqRef.current) return;
      setMethodsState({
        status: 'ok',
        email: mail,
        hasPasskeys: m.hasPasskeys,
        hasRecoveryCodes: m.hasRecoveryCodes,
      });
      // 仅剩密码一种方式 → 跳过选择页直达密码验证（在 choose 上才跳，避免误改草稿）
      const onlyPassword = (passkeySupported === false || !m.hasPasskeys) && !m.hasRecoveryCodes;
      if (step === 'choose' && onlyPassword) setStep('password');
    })
    .catch((e) => {
      console.warn('[mfa] loginMethods 失败（已放行全部入口）:', (e as Error)?.message);
      if (req !== methodsReqRef.current) return;
      // 有该邮箱的既有结果则保留（后台刷新失败不算全站故障），否则放行全部
      setMethodsState((prev) => (prev.status === 'ok' && prev.email === mail ? prev : { status: 'failed' }));
    });
}, [step, email]);

  // 已有有效会话 → OAuth 模式回授权页继续，否则直接进安全中心
  React.useEffect(() => {
    void (async () => {
      const session = getSession();
      if (session?.access_token) {
        try {
          await fetchSessionUser(session.access_token);
          clearLoginDraft(); // 已有会话直奔安全中心，丢弃未走完的草稿
          if (redirectIfOAuthPending(navigate)) return;
          navigate('/security', { replace: true });
          return;
        } catch {
          clearSession();
        }
      }
      setChecking(false);
    })();
  }, [navigate]);

  // 步骤/邮箱变更即写入草稿：中途跳离（条款/找回/注册）返回后能无缝续接
  React.useEffect(() => {
    try {
      sessionStorage.setItem(LOGIN_DRAFT_KEY, JSON.stringify({ step, email: email.trim() }));
    } catch {
      /* ignore */
    }
  }, [step, email]);

  /** 通行密钥登录共用终点：assertion → login-verify → token_hash → 会话 → 安全中心（OAuth 模式回授权页） */
  const finishPasskeyLogin = React.useCallback(
    async (assertion: AuthenticationResponseJSON, mail: string | null) => {
      const { token_hash } = await loginVerify({ ...(mail ? { email: mail } : {}), response: assertion });
      saveSession(await exchangeTokenHash(token_hash));
      clearLoginDraft();
      if (redirectIfOAuthPending(navigate)) return;
      toast(t('login.success'), 'success');
      navigate('/security', { replace: true });
    },
    [navigate, t],
  );

  // Conditional UI 早期尝试（Part 2 §4 常态体验）：能力探测通过即挂起一个
  // conditional 仪式，用户点邮箱输入框时浏览器直接弹出本机通行证。
  // 【机会型体验铁律】任何失败一律静默——只进 console，绝不 Toast 打扰用户。
  const conditionalRef = React.useRef(false);
  React.useEffect(() => {
    if (conditionalRef.current) return; // StrictMode 双调 / 重复触发：只起一个
    conditionalRef.current = true;
    void (async () => {
      if (!browserSupportsWebAuthnSafe() || !(await browserSupportsWebAuthnAutofillSafe())) return;
      try {
        const { optionsJSON } = await loginOptions({}); // 信封拆包：取 optionsJSON（discovery 空 allowCredentials）
        const assertion = await startPasskeyAuthentication(optionsJSON, { useBrowserAutofill: true });
        await finishPasskeyLogin(assertion, null); // 无 email → 服务端按 userHandle 定位账户
      } catch (e) {
        console.warn('[mfa] Conditional UI 不可用（已静默降级为按钮登录）:', (e as Error)?.name, (e as Error)?.message);
      }
    })();
    // 卸载 → 取消在途 conditional 仪式，防止 go to /register 途中完成指纹被幽灵登录拽走
    return () => {
      conditionalRef.current = false;
      WebAuthnAbortService.cancelCeremony();
    };
  }, [finishPasskeyLogin]);

  // 邮箱步：下一步 → 先解析该邮箱可用登录方式再分流——仅剩密码则直达密码验证、
  // 否则进选择页；查询失败 → failed 放行全部进选择页。全程停在邮箱步（按钮转圈），
  // 不进「中转」的 choose，避免 only-password 时闪一下选择界面。
  // email 必填且须为合法格式；通行密钥 discovery 直登由 Conditional UI 路径承担。
  // 字段级错误走行内红字（InputError），不再弹 Toast。
  const emailBusyRef = React.useRef(false);
  async function handleEmailNext() {
    const mail = email.trim();
    if (!mail) return setEmailError({ key: 'login.emailEmpty' });
    if (!EMAIL_RE.test(mail)) return setEmailError({ key: 'login.emailInvalid' });
    if (emailBusyRef.current) return;
    emailBusyRef.current = true;
    setEmailBusy(true);
    const m = mail.toLowerCase();
    try {
      const res = await loginMethods(m);
      resolvedByHandlerRef.current = m;
      setMethodsState({
        status: 'ok',
        email: m,
        hasPasskeys: res.hasPasskeys,
        hasRecoveryCodes: res.hasRecoveryCodes,
      });
      const onlyPassword = (passkeySupported === false || !res.hasPasskeys) && !res.hasRecoveryCodes;
      setStep(onlyPassword ? 'password' : 'choose');
    } catch (e) {
      console.warn('[mfa] loginMethods 失败（已放行全部入口）:', (e as Error)?.message);
      resolvedByHandlerRef.current = m;
      setMethodsState({ status: 'failed' });
      setStep('choose');
    } finally {
      emailBusyRef.current = false;
      setEmailBusy(false);
    }
  }

  // 选择登录方式步：通行密钥仪式（填了邮箱则限定 allowCredentials）
  async function handlePasskey() {
    setBusyPasskey(true);
    setPasskeyError(null);
    try {
      const mail = email.trim().toLowerCase() || null;
      const { optionsJSON } = await loginOptions(mail ? { email: mail } : {});
      const assertion = await startPasskeyAuthentication(optionsJSON);
      await finishPasskeyLogin(assertion, mail);
    } catch (e) {
      const err = e as { code?: string; message?: string; silent?: boolean };
      if (err?.silent) {
        // 用户取消仪式静默
      } else {
        setPasskeyError({ key: err?.code ? errorCodeToKey(err.code) : 'login.verifyFailed' });
      }
    } finally {
      setBusyPasskey(false);
    }
  }

  // 密码步：邮箱密码登录。凭据错误在密码框下方行内提示（Google 式），其余仍走 Toast。
  async function handlePasswordLogin() {
    if (!captchaToken) {
      setPasswordError({ key: 'error.captchaRequired' });
      return;
    }
    setBusyPassword(true);
    try {
      saveSession(await signInWithPassword(email.trim().toLowerCase(), password, captchaToken));
      clearLoginDraft();
      if (redirectIfOAuthPending(navigate)) return;
      toast(t('login.success'), 'success');
      navigate('/security', { replace: true });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code === 'INVALID_CREDENTIALS') {
        setPasswordError({ key: 'login.incorrectCredentials' });
        setPassword('');
      } else {
        handleError(e);
      }
    } finally {
      // token 已被 GoTrue 消费：无论成败都重置挑战，失败重试前需重新人机验证
      setCaptchaToken('');
      turnstileRef.current?.reset();
      setBusyPassword(false);
    }
  }

  // 恢复码步：备用码登录（Google 备用码同款）。码一次性，服务端只消费被使用的那
  // 一个，同批其余码继续有效 → 兑换会话后同密码登录一样直达安全中心。
  // 失败行内提示（RECOVERY_INVALID / RATE_LIMITED）。
  async function handleRecoveryLogin() {
    const code = recoveryCode.trim();
    if (!code) {
      setRecoveryError({ key: 'login.recoveryHint' });
      return;
    }
    setBusyRecovery(true);
    try {
      const { token_hash } = await useRecoveryCode(email.trim().toLowerCase(), code);
      saveSession(await exchangeTokenHash(token_hash));
      clearLoginDraft();
      if (redirectIfOAuthPending(navigate)) return;
      toast(t('login.success'), 'success');
      navigate('/security', { replace: true });
    } catch (e) {
      const err = e as { code?: string };
      setRecoveryError({ key: errorCodeToKey(err?.code) });
      setRecoveryCode('');
    } finally {
      setBusyRecovery(false);
    }
  }

  if (checking) {
    return (
      <AuthShell title={t('login.title')} subtitle={t('login.subtitle')}>
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress size={28} />
        </Box>
      </AuthShell>
    );
  }

  // 「使用其他账号」= 重置整个登录流（Google 行为）：清空邮箱/密码并回到输入邮箱步
  const emailPill = (
    <EmailPill
      email={email.trim().toLowerCase()}
      items={[
        {
          label: t('login.useAnotherAccount'),
          onClick: () => {
            setEmail('');
            setPassword('');
            setShowPassword(false);
            setStep('email');
            resolvedByHandlerRef.current = null; // 换账号 → 下一个邮箱等 handleEmailNext 实时解析
            setMethodsState({ status: 'unknown' }); // 换账号 → 清掉上一个邮箱的方法状态，重进时按新邮箱查询
          },
        },
      ]}
    />
  );

  // 仅剩密码一种方式时，密码步不再显示「试用其他方式」（没有别的方式可选）。
  // unknown（解析中/刷新刚落地）乐观显示，避免按钮闪出又消失；failed 放行显示。
  const hasAlternativeMethods =
    methodsState.status === 'failed' ||
    methodsState.status !== 'ok' ||
    ((passkeySupported && methodsState.hasPasskeys) || methodsState.hasRecoveryCodes);

  return (
    <AuthShell
      title={step === 'email' ? t('login.title') : t('login.welcomeBack')}
      subtitle={step === 'email' ? t('login.subtitle') : undefined}
      leftExtra={step === 'email' ? undefined : emailPill}
      transitionKey={step}
      actions={
        step === 'email' ? (
          <AuthActions
            secondary={
              <Link component={RouterLink} to="/register" underline="hover">
                {t('login.createAccount')}
              </Link>
            }
            primary={
              <Button variant="contained" size="large" onClick={handleEmailNext} disabled={emailBusy}>
                {emailBusy ? t('login.verifying') : t('common.next')}
              </Button>
            }
          />
        ) : step === 'password' ? (
          <AuthActions
            secondary={
              hasAlternativeMethods ? (
                <Button variant="text" onClick={() => setStep('choose')}>
                  {t('login.tryAnotherWay')}
                </Button>
              ) : undefined
            }
            primary={
              <Button
                variant="contained"
                size="large"
                onClick={handlePasswordLogin}
                disabled={busyPassword || !captchaToken}
              >
                {busyPassword ? t('login.signingIn') : !captchaToken ? t('login.verifying') : t('common.next')}
              </Button>
            }
          />
        ) : step === 'recovery' ? (
          <AuthActions
            secondary={
              <Button variant="text" onClick={() => setStep('choose')}>
                {t('login.tryAnotherWay')}
              </Button>
            }
            primary={
              <Button variant="contained" size="large" onClick={handleRecoveryLogin} disabled={busyRecovery}>
                {busyRecovery ? t('login.signingIn') : t('common.next')}
              </Button>
            }
          />
        ) : undefined
      }
    >
      {/* Turnstile 页面进场即挂载并渲染（覆盖全步骤常驻）：Safari ITP 等隐私机制下，
          尽早发出脚本请求、静默签发 token，让校验在用户触达提交前完成；
          仅 CF 风控要求交互时才在本容器内弹出勾选框（对交互框做视觉引导见密码步）。 */}
      <Turnstile ref={turnstileRef} onToken={setCaptchaToken} onExpire={() => setCaptchaToken('')} />

      {step === 'email' && (
        <Box>
          <TextField
            label={t('common.emailLabel')}
            type="email"
            autoFocus
            fullWidth
            placeholder="you@isawuhan.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && handleEmailNext()}
            error={Boolean(emailError)}
            // autocomplete="username webauthn"：同一输入框承接 Conditional UI
            // （webauthn 必须排在最后，tech 清单 §1.4）。页面加载后自动发起
            // conditional 仪式——输入框聚焦时浏览器直接弹出本机通行证。
            slotProps={{ htmlInput: { autoComplete: 'username webauthn' } }}
          />
          {/* Box 包裹：避免 InputError 成为 Stack 直接子元素而被 spacing 撑开间距 */}
          <InputError error={emailError} />
        </Box>
      )}

      {step === 'choose' && (
        <>
          <Typography variant="h2">{t('login.chooseTitle')}</Typography>
          {methodsState.status === 'unknown' ? (
            // 查询中：不渲染任何选项，给与页首会话检查一致的占位——避免「先全显后藏」的闪动
            <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
              <CircularProgress size={28} />
            </Box>
          ) : (
            <>
              {/* Google 式：无描边卡片，整行分隔线列表撑满右栏。
                  仅列出对该邮箱可用的登录方式：ok 状态下未绑定通行密钥/未生成恢复码的
                  入口直接隐藏；failed 状态放行全部（服务端口径见 mfa/methods 处理器）。 */}
              <List disablePadding>
                <ListItemButton
                  onClick={() => {
                    setPasskeyError(null);
                    setStep('password');
                  }}
                  disabled={busyPasskey}
                  sx={{ py: 1.75, px: 0.5, borderRadius: 0 }}
                >
                  <LockRoundedIcon sx={{ mr: 2.5, color: 'primary.main' }} />
                  <Typography>{t('login.passwordOption')}</Typography>
                </ListItemButton>
                {passkeySupported && (methodsState.status === 'failed' || methodsState.hasPasskeys) && (
                  <>
                    <Divider />
                    <ListItemButton onClick={handlePasskey} disabled={busyPasskey} sx={{ py: 1.75, px: 0.5, borderRadius: 0 }}>
                      <FingerprintRoundedIcon sx={{ mr: 2.5, color: 'primary.main' }} />
                      <Typography>{busyPasskey ? t('login.passwordWaiting') : t('login.passkeyOption')}</Typography>
                    </ListItemButton>
                  </>
                )}
                {(methodsState.status === 'failed' || methodsState.hasRecoveryCodes) && (
                  <>
                    <Divider />
                    <ListItemButton
                      onClick={() => {
                        setRecoveryError(null);
                        setStep('recovery');
                      }}
                      disabled={busyPasskey}
                      sx={{ py: 1.75, px: 0.5, borderRadius: 0 }}
                    >
                      <KeyRoundedIcon sx={{ mr: 2.5, color: 'primary.main' }} />
                      <Typography>{t('login.recoveryOption')}</Typography>
                    </ListItemButton>
                  </>
                )}
              </List>
              {passkeySupported && (methodsState.status === 'failed' || methodsState.hasPasskeys) && (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {t('login.passkeyRecommended')}
                </Typography>
              )}
              <InputError error={passkeyError} />
            </>
          )}
        </>
      )}

      {step === 'password' && (
        <>
          {/* 仅该邮箱确实有通行密钥时才推荐「用通行密钥登录」；确认没有（ok 且
              hasPasskeys=false）时整条 Alert 删掉。unknown/failed 乐观保留（避免
              刷新瞬间闪没）。 */}
          {passkeySupported &&
            (methodsState.status === 'failed' ||
              methodsState.status !== 'ok' ||
              methodsState.hasPasskeys) && (
              <Alert severity="info" icon={<FingerprintRoundedIcon fontSize="inherit" />}>
                {t('login.passkeyHint')}
              </Alert>
            )}
          <Box>
            <TextField
              label={t('login.passwordOption')}
              type={showPassword ? 'text' : 'password'}
              autoFocus
              fullWidth
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handlePasswordLogin()}
              error={Boolean(passwordError)}
              slotProps={{ htmlInput: { autoComplete: 'current-password' } }}
            />
            <InputError error={passwordError} />
            {/* 忘记密码入口：携带已输入邮箱，找回页可预填 */}
            <Link
              component={RouterLink}
              to="/forgot-password"
              state={{ email: email.trim().toLowerCase() }}
              underline="hover"
              variant="body2"
              sx={{ alignSelf: 'flex-start', display: 'inline-block', mt: 0.5 }}
            >
              {t('login.forgotPassword')}
            </Link>
          </Box>
          <FormControlLabel
            control={<Checkbox checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />}
            label={<Typography variant="body2">{t('login.showPassword')}</Typography>}
            sx={{ alignSelf: 'flex-start' }}
          />
          {/* token 未就绪时给出中性的验证中提示（不再红字报错）；就绪后自动消失 */}
          {!captchaToken && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('login.verifyingHint')}
            </Typography>
          )}
        </>
      )}

      {step === 'recovery' && (
        <>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('login.recoveryHint')}
          </Typography>
          <Box>
            <TextField
              label={t('login.recoveryCodeLabel')}
              autoFocus
              fullWidth
              placeholder="XXXX-XXXX"
              value={recoveryCode}
              onChange={(e) => {
                setRecoveryCode(e.target.value.toUpperCase());
                setRecoveryError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleRecoveryLogin()}
              error={Boolean(recoveryError)}
              slotProps={{
                htmlInput: {
                  autoComplete: 'off',
                  spellCheck: false,
                  style: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: '0.08em' },
                },
              }}
            />
            <InputError error={recoveryError} />
          </Box>
        </>
      )}
    </AuthShell>
  );
}
