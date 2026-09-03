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
  const [checking, setChecking] = React.useState(true);
  const [step, setStep] = React.useState<Step>('email');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [showPassword, setShowPassword] = React.useState(false);
  const [busyPasskey, setBusyPasskey] = React.useState(false);
  const [busyPassword, setBusyPassword] = React.useState(false);
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
      toast('登录成功', 'success');
      navigate('/security', { replace: true });
    },
    [navigate],
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
  function handleEmailNext() {
    const mail = email.trim();
    if (!mail) return toast('请输入学校邮箱', 'error');
    if (!EMAIL_RE.test(mail)) return toast('请输入有效的邮箱地址', 'error');
    setStep('choose');
  }

  // 选择登录方式步：通行密钥仪式（填了邮箱则限定 allowCredentials）
  async function handlePasskey() {
    setBusyPasskey(true);
    try {
      const mail = email.trim().toLowerCase() || null;
      const { optionsJSON } = await loginOptions(mail ? { email: mail } : {});
      const assertion = await startPasskeyAuthentication(optionsJSON);
      await finishPasskeyLogin(assertion, mail);
    } catch (e) {
      handleError(e); // 用户取消仪式静默
    } finally {
      setBusyPasskey(false);
    }
  }

  // 密码步：邮箱密码登录
  async function handlePasswordLogin() {
    setBusyPassword(true);
    try {
      saveSession(await signInWithPassword(email.trim().toLowerCase(), password));
      toast('登录成功', 'success');
      navigate('/security', { replace: true });
    } catch (e) {
      handleError(e);
    } finally {
      setBusyPassword(false);
    }
  }

  if (checking) {
    return (
      <AuthShell title="登录" subtitle="使用你的学校邮箱账号继续">
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
          label: '使用其他账号',
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
      title={step === 'email' ? '登录' : '欢迎回来'}
      subtitle={step === 'email' ? '使用你的学校邮箱账号继续' : undefined}
      leftExtra={step === 'email' ? undefined : emailPill}
      transitionKey={step}
      actions={
        step === 'email' ? (
          <AuthActions
            secondary={
              <Link component={RouterLink} to="/register" underline="hover">
                创建账号
              </Link>
            }
            primary={
              <Button variant="contained" size="large" onClick={handleEmailNext}>
                下一步
              </Button>
            }
          />
        ) : step === 'password' ? (
          <AuthActions
            secondary={
              <Button variant="text" onClick={() => setStep('choose')}>
                试试其他方式
              </Button>
            }
            primary={
              <Button variant="contained" size="large" onClick={handlePasswordLogin} disabled={busyPassword}>
                {busyPassword ? '登录中…' : '下一步'}
              </Button>
            }
          />
        ) : undefined
      }
    >
      {step === 'email' && (
        <TextField
          label="学校邮箱"
          type="email"
          autoFocus
          fullWidth
          placeholder="you@isawuhan.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleEmailNext()}
          // autocomplete="username webauthn"：同一输入框承接 Conditional UI
          // （webauthn 必须排在最后，tech 清单 §1.4）。页面加载后自动发起
          // conditional 仪式——输入框聚焦时浏览器直接弹出本机通行证。
          slotProps={{ htmlInput: { autoComplete: 'username webauthn' } }}
        />
      )}

      {step === 'choose' && (
        <>
          <Typography variant="h2">选择您想要使用的登录方式：</Typography>
          {/* Google 式：无描边卡片，整行分隔线列表撑满右栏 */}
          <List disablePadding>
            <ListItemButton
              onClick={() => setStep('password')}
              disabled={busyPasskey}
              sx={{ py: 1.75, px: 0.5, borderRadius: 0 }}
            >
              <LockRoundedIcon sx={{ mr: 2.5, color: 'primary.main' }} />
              <Typography>输入您的密码</Typography>
            </ListItemButton>
            {passkeySupported && (
              <>
                <Divider component="li" />
                <ListItemButton onClick={handlePasskey} disabled={busyPasskey} sx={{ py: 1.75, px: 0.5, borderRadius: 0 }}>
                  <FingerprintRoundedIcon sx={{ mr: 2.5, color: 'primary.main' }} />
                  <Typography>{busyPasskey ? '等待指纹验证…' : '使用您的通行密钥'}</Typography>
                </ListItemButton>
              </>
            )}
          </List>
          {passkeySupported && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              推荐：Touch ID / Windows Hello 一触即达，无需输入密码
            </Typography>
          )}
        </>
      )}

      {step === 'password' && (
        <>
          <Alert severity="info" icon={<FingerprintRoundedIcon fontSize="inherit" />}>
            不妨选择「使用您的通行密钥」，更轻松更安全地登录
          </Alert>
          <TextField
            label="输入您的密码"
            type={showPassword ? 'text' : 'password'}
            autoFocus
            fullWidth
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handlePasswordLogin()}
            slotProps={{ htmlInput: { autoComplete: 'current-password' } }}
          />
          <FormControlLabel
            control={<Checkbox checked={showPassword} onChange={(e) => setShowPassword(e.target.checked)} />}
            label={<Typography variant="body2">显示密码</Typography>}
            sx={{ alignSelf: 'flex-start' }}
          />
        </>
      )}
    </AuthShell>
  );
}
