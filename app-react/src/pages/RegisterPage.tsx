import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import AuthShell, { AuthActions } from '../components/AuthShell';
import EmailPill from '../components/EmailPill';
import InputError from '../components/InputError';
import type { InputErrorInfo } from '../components/InputError';
import PasswordStrengthMeter from '../components/PasswordStrengthMeter';
import { scorePasswordSync } from '../lib/passwordStrength';
import { useI18n } from '../i18n/LocaleContext';
import {
  checkEmailDomain,
  clearSession,
  fetchSessionUser,
  getSession,
  handleError,
  signUp,
  toast,
} from '../api/mfaClient';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * 邮箱校验：空 → 提示输入；格式不合法 → 提示格式；非学校域名 → 提示域名；合法 → null。
 * 返回 i18n 消息键（存入错误 state，渲染时才取词，语言切换后自动重译）；
 * 域名判断大小写不敏感（与服务端语义一致）。
 */
function validateEmail(value: string): 'register.emailEmpty' | 'register.emailInvalid' | 'register.emailDomainOnly' | null {
  const mail = value.trim().toLowerCase();
  if (!mail) return 'register.emailEmpty';
  if (!EMAIL_RE.test(mail)) return 'register.emailInvalid';
  if (!mail.endsWith('@isawuhan.com')) return 'register.emailDomainOnly';
  return null;
}

/** 注册第一步：邮箱 + 密码。成功 → 即刻进入邮箱验证（第二步见 CheckEmailPage）。 */
export default function RegisterPage() {
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [password2, setPassword2] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // 行内字段错误（InputError 红字），输入即清除。存 i18n 键而非译文：语言切换后自动重译。
  const [emailError, setEmailError] = React.useState<InputErrorInfo | null>(null);
  const [passwordError, setPasswordError] = React.useState<InputErrorInfo | null>(null);
  const [confirmError, setConfirmError] = React.useState<InputErrorInfo | null>(null);

  // 邮箱「输入即校验」：停止输入 600ms 视为完成输入，自动校验合法性/完整性。
  // 字段为空时不催促（留到失焦/提交再报），已有错误且输入变得合法则由 onChange 即时清除。
  React.useEffect(() => {
    if (!email.trim()) {
      setEmailError(null);
      return;
    }
    const timer = setTimeout(() => {
      const key = validateEmail(email);
      setEmailError(key ? { key } : null);
    }, 600);
    return () => clearTimeout(timer);
  }, [email]);

  // 已登录守卫（与 /login 对称）：有效会话 → 回安全中心，避免已登录用户注册新账号
  // 静默覆盖现有 mfa.session（新用户在允许域名，signUp 会写入新会话）。
  const [checking, setChecking] = React.useState(true);
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
  if (checking) return null; // 守卫跳转中：留白，避免一闪而过的表单

  // 注册：邮箱格式 → 域名预检（fail-closed）→ GoTrue 注册 →
  // 邮箱验证通过后才有会话 → 手机号绑定 → 指纹绑定。
  // 字段级错误走行内红字（InputError），与字段无关的仍走 Toast。
  async function handleRegister() {
    const mail = email.trim().toLowerCase();
    const emailErr = validateEmail(email);
    if (emailErr) return setEmailError({ key: emailErr });
    if (password.length < 6) return setPasswordError({ key: 'register.passwordShort' });
    // 强度门槛：zxcvbn score ≥ 2（「一般」）才放行；库未加载完则不拦截（强度条随后跟进）
    const score = scorePasswordSync(password, locale);
    if (score !== null && score < 2) return setPasswordError({ key: 'register.tooWeak' });
    if (password !== password2) return setConfirmError({ key: 'register.passwordMismatch' });
    setBusy(true);
    try {
      await checkEmailDomain({ email: mail });
      await signUp(mail, password);
      // 邮箱持久化：state 刷新即丢，写入 sessionStorage 供 CheckEmail 刷新后回退
      sessionStorage.setItem('mfa.pendingEmail', mail);
      toast(t('register.success'), 'success');
      navigate('/register/check-email', { state: { email: mail }, replace: true });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code === 'DOMAIN_NOT_ALLOWED' || err?.code === 'EMAIL_TAKEN') {
        setEmailError({ key: err.code === 'EMAIL_TAKEN' ? 'error.emailTaken' : 'error.domainNotAllowed' });
        setBusy(false);
      } else {
        handleError(e);
        setBusy(false);
      }
    }
  }

  return (
    <AuthShell
      title={t('register.title')}
      subtitle={t('register.subtitle')}
      leftExtra={email.trim() ? <EmailPill email={email.trim().toLowerCase()} /> : undefined}
      transitionKey="register"
      actions={
        <AuthActions
          secondary={
            <Link component={RouterLink} to="/login" underline="hover">
              {t('register.signIn')}
            </Link>
          }
          primary={
            <Button type="submit" form="register-form" variant="contained" size="large" disabled={busy}>
              {busy ? t('register.registering') : t('common.next')}
            </Button>
          }
        />
      }
    >
      <Stack
        component="form"
        id="register-form"
        spacing={2}
        onSubmit={(e) => {
          e.preventDefault();
          void handleRegister();
        }}
        noValidate
      >
        {/* Box 包裹：避免 InputError 成为 Stack 直接子元素而被 spacing 撑开间距 */}
        <Box>
          <TextField
            label={t('common.emailLabel')}
            type="email"
            required
            autoFocus
            placeholder="you@isawuhan.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              // 已报错时边输边复检：一旦合法立刻收起红字（防抖校验兜底其余情况）
              if (emailError && !validateEmail(e.target.value)) setEmailError(null);
            }}
            onBlur={() => {
              const key = validateEmail(email);
              setEmailError(key ? { key } : null);
            }}
            slotProps={{ htmlInput: { autoComplete: 'email' } }}
            error={Boolean(emailError)}
          />
          <InputError error={emailError} />
          {!emailError && (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
              {t('register.emailDomainOnly')}
            </Typography>
          )}
        </Box>
        <Box>
          <TextField
            label={t('register.passwordLabel')}
            type="password"
            required
            placeholder={t('register.passwordPlaceholder')}
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError(null);
            }}
            slotProps={{ htmlInput: { autoComplete: 'new-password', minLength: 6 } }}
            error={Boolean(passwordError)}
          />
          <InputError error={passwordError} />
          <PasswordStrengthMeter password={password} />
        </Box>
        <Box>
          <TextField
            label={t('register.confirmLabel')}
            type="password"
            required
            placeholder={t('register.confirmPlaceholder')}
            value={password2}
            onChange={(e) => {
              setPassword2(e.target.value);
              setConfirmError(null);
            }}
            slotProps={{ htmlInput: { autoComplete: 'new-password', minLength: 6 } }}
            error={Boolean(confirmError)}
          />
          <InputError error={confirmError} />
        </Box>
      </Stack>
    </AuthShell>
  );
}