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
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import CircularProgress from '@mui/material/CircularProgress';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import AuthShell, { AuthActions } from '../components/AuthShell';
import EmailPill from '../components/EmailPill';
import InputError from '../components/InputError';
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
  loginOptions,
  loginVerify,
  saveSession,
  signInWithPassword,
  startPasskeyAuthentication,
  toast,
} from '../api/mfaClient';
import type { AuthenticationResponseJSON } from '../api/mfaClient';

// Conditional UI 挂起的仪式用组件级 ref 记账：新一帧挂载（含从别页返回）时重置为 false，
// 从而每次进入登录页都会重新挂起常驻仪式；StrictMode 同一挂载的双调 useEffect 由
// conditionalRef 哑元二次跳过（避免重复 start）。卸载时调用 WebAuthnAbortService.cancelCeremony()
// 取消在途仪式，避免「幽灵登录」——用户中途转去注册/别页，conditional 仍存活完成指纹
// 并强拽跳/security。

type Step = 'email' | 'choose' | 'password';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Google 分步登录流（图 3/4/5 风格）：输入邮箱 → 选择登录方式 → 验证身份。 */
export default function LoginPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [checking, setChecking] = React.useState(true);
  const [step, setStep] = React.useState<Step>('email');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [busyPasskey, setBusyPasskey] = React.useState(false);
  const [busyPassword, setBusyPassword] = React.useState(false);
  // 行内字段错误（InputError 红字），输入即清除。存 i18n 键而非译文：语言切换后自动重译。
  const [emailError, setEmailError] = React.useState<InputErrorInfo | null>(null);
  const [passwordError, setPasswordError] = React.useState<InputErrorInfo | null>(null);
  const [passkeyError, setPasskeyError] = React.useState<InputErrorInfo | null>(null);
  // WebAuthn 能力探测：不支持时隐藏「使用您的通行密钥」入口
  const [passkeySupported, setPasskeySupported] = React.useState(true);
  React.useEffect(() => {
    setPasskeySupported(browserSupportsWebAuthnSafe());
  }, []);

  // 已有有效会话 → 直接进安全中心
  React.useEffect(() => {
    void (async () => {
      const session = getSession();
      if (session?.access_token) {
        try {
          await fetchSessionUser(session.access_token);
          navigate('/security', { replace: true });
          return;
        } catch {
          clearSession();
        }
      }
      setChecking(false);
    })();
  }, [navigate]);

  /** 通行密钥登录共用终点：assertion → login-verify → token_hash → 会话 → 安全中心 */
  const finishPasskeyLogin = React.useCallback(
    async (assertion: AuthenticationResponseJSON, mail: string | null) => {
      const { token_hash } = await loginVerify({ ...(mail ? { email: mail } : {}), response: assertion });
      saveSession(await exchangeTokenHash(token_hash));
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

  // 邮箱步：下一步 → 选择登录方式。邮箱必填且须为合法格式；
  // 通行密钥 discovery 直登由 Conditional UI 路径承担，此处不做留空放行。
  // 字段级错误走行内红字（InputError），不再弹 Toast。
  function handleEmailNext() {
    const mail = email.trim();
    if (!mail) return setEmailError({ key: 'login.emailEmpty' });
    if (!EMAIL_RE.test(mail)) return setEmailError({ key: 'login.emailInvalid' });
    setStep('choose');
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
    setBusyPassword(true);
    try {
      saveSession(await signInWithPassword(email.trim().toLowerCase(), password));
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
      setBusyPassword(false);
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
          },
        },
      ]}
    />
  );

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
              <Button variant="contained" size="large" onClick={handleEmailNext}>
                {t('common.next')}
              </Button>
            }
          />
        ) : step === 'password' ? (
          <AuthActions
            secondary={
              <Button variant="text" onClick={() => setStep('choose')}>
                {t('login.tryAnotherWay')}
              </Button>
            }
            primary={
              <Button variant="contained" size="large" onClick={handlePasswordLogin} disabled={busyPassword}>
                {busyPassword ? t('login.signingIn') : t('common.next')}
              </Button>
            }
          />
        ) : undefined
      }
    >
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
          {/* Google 式：无描边卡片，整行分隔线列表撑满右栏 */}
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
            {passkeySupported && (
              <>
                <Divider component="li" />
                <ListItemButton onClick={handlePasskey} disabled={busyPasskey} sx={{ py: 1.75, px: 0.5, borderRadius: 0 }}>
                  <FingerprintRoundedIcon sx={{ mr: 2.5, color: 'primary.main' }} />
                  <Typography>{busyPasskey ? t('login.passwordWaiting') : t('login.passkeyOption')}</Typography>
                </ListItemButton>
              </>
            )}
          </List>
          {passkeySupported && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('login.passkeyRecommended')}
            </Typography>
          )}
          <InputError error={passkeyError} />
        </>
      )}

      {step === 'password' && (
        <>
          <Alert severity="info" icon={<FingerprintRoundedIcon fontSize="inherit" />}>
            {t('login.passkeyHint')}
          </Alert>
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
          </Box>
          <FormControlLabel
            control={<Checkbox checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />}
            label={<Typography variant="body2">{t('login.showPassword')}</Typography>}
            sx={{ alignSelf: 'flex-start' }}
          />
        </>
      )}
    </AuthShell>
  );
}
