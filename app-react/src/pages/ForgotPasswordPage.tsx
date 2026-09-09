// ============================================================================
// ForgotPasswordPage —— 找回密码（邮箱 / 手机双路径，复用 6 位验证码技术栈）
//
// 邮箱路径（与主站 reset 流同构，GoTrue 原生）：
//   recover（Turnstile）→ 邮件 6 位码 → /verify type=recovery 换会话 → PUT /user 改密
// 手机路径（模块自有端点，GoTrue 无手机 recovery 会话语义）：
//   send-otp purpose=recovery（Turnstile）→ 6 位码 + 新密码一并提交
//   → phone/reset-password（服务端核销 OTP + admin 改密）
//
// 人机验证：发送前各需一个 Turnstile token（一次性，发送后重置挑战）。
// ============================================================================
import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AlternateEmailRoundedIcon from '@mui/icons-material/AlternateEmailRounded';
import SmartphoneRoundedIcon from '@mui/icons-material/SmartphoneRounded';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import AuthShell, { AuthActions } from '../components/AuthShell';
import InputError from '../components/InputError';
import type { InputErrorInfo } from '../components/InputError';
import PasswordStrengthMeter from '../components/PasswordStrengthMeter';
import Turnstile from '../components/Turnstile';
import type { TurnstileHandle } from '../components/Turnstile';
import { scorePasswordSync } from '../lib/passwordStrength';
import { useI18n } from '../i18n/LocaleContext';
import {
  clearSession,
  getSession,
  handleError,
  requestPasswordRecovery,
  resetPasswordByPhone,
  sendOtp,
  toast,
  updatePassword,
  verifyRecoveryCode,
} from '../api/mfaClient';
import type { MfaSession } from '../api/mfaClient';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^1[3-9]\d{9}$/;

type Method = 'email' | 'phone';
type Step = 'choose' | 'target' | 'code' | 'newPassword';

/** 找回密码：选方式 → 输入邮箱/手机号（Turnstile）→ 6 位码 →（手机路径同屏）设置新密码。 */
export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t, locale } = useI18n();
  const [step, setStep] = React.useState<Step>('choose');
  const [method, setMethod] = React.useState<Method>('email');
  // LoginPage 带 state 跳入时预填邮箱
  const prefillEmail = (location.state as { email?: string } | null)?.email ?? '';
  const [email, setEmail] = React.useState(prefillEmail);
  const [phone, setPhone] = React.useState('');
  const [code, setCode] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [password2, setPassword2] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // recovery 会话（邮箱路径 verify 成功后持有，用于 PUT /user 改密）
  const [recoverySession, setRecoverySession] = React.useState<MfaSession | null>(null);
  // 行内字段错误：存 i18n 键，语言切换后自动重译
  const [targetError, setTargetError] = React.useState<InputErrorInfo | null>(null);
  const [codeError, setCodeError] = React.useState<InputErrorInfo | null>(null);
  const [passwordError, setPasswordError] = React.useState<InputErrorInfo | null>(null);
  const [confirmError, setConfirmError] = React.useState<InputErrorInfo | null>(null);
  // Turnstile：每个"发送"动作消费一个 token，用后重置
  const [captchaToken, setCaptchaToken] = React.useState('');
  const turnstileRef = React.useRef<TurnstileHandle>(null);

  const title = t('forgot.title');

  /** 发送验证码（两种路径共用；Turnstile token 必须已就绪） */
  async function handleSendCode() {
    if (method === 'email') {
      const mail = email.trim().toLowerCase();
      if (!mail) return setTargetError({ key: 'login.emailEmpty' });
      if (!EMAIL_RE.test(mail)) return setTargetError({ key: 'forgot.emailInvalid' });
    } else {
      const normalized = phone.replace(/[\s-]/g, '');
      if (!PHONE_RE.test(normalized)) return setTargetError({ key: 'forgot.phoneInvalid' });
    }
    if (!captchaToken) return setTargetError({ key: 'error.captchaRequired' });
    setBusy(true);
    try {
      if (method === 'email') {
        await requestPasswordRecovery(email.trim().toLowerCase(), captchaToken);
      } else {
        await sendOtp(phone.replace(/[\s-]/g, ''), captchaToken, 'recovery');
      }
      setCode('');
      setStep('code');
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code === 'PHONE_NOT_BOUND') setTargetError({ key: 'error.phoneNotBound' });
      else handleError(e);
    } finally {
      setCaptchaToken('');
      turnstileRef.current?.reset();
      setBusy(false);
    }
  }

  /** 邮箱路径：6 位码 → recovery 会话 → 进入设置新密码步 */
  async function handleVerifyCode() {
    if (!/^\d{6}$/.test(code.trim())) return setCodeError({ key: 'forgot.codeInvalid' });
    setBusy(true);
    try {
      const session = await verifyRecoveryCode(email.trim().toLowerCase(), code.trim());
      setRecoverySession(session);
      setStep('newPassword');
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code === 'FALLBACK') handleError(e);
      else setCodeError({ key: 'error.otpExpired' }); // 码错/过期不可区分（防枚举）
    } finally {
      setBusy(false);
    }
  }

  /** 密码校验（两路径共用）：长度 → 强度 → 一致 */
  function validatePasswords(): boolean {
    if (password.length < 6) {
      setPasswordError({ key: 'forgot.passwordShort' });
      return false;
    }
    const score = scorePasswordSync(password, locale);
    if (score !== null && score < 2) {
      setPasswordError({ key: 'forgot.tooWeak' });
      return false;
    }
    if (password !== password2) {
      setConfirmError({ key: 'forgot.passwordMismatch' });
      return false;
    }
    return true;
  }

  /** 邮箱路径：持 recovery 会话改密（GoTrue PUT /user） */
  async function handleResetWithEmail() {
    if (!validatePasswords() || !recoverySession) return;
    setBusy(true);
    try {
      await updatePassword(recoverySession, password);
      clearSession(); // recovery 会话仅用于改密，不作为登录态留存
      toast(t('forgot.success'), 'success');
      navigate('/login', { replace: true });
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  /** 手机路径：码 + 新密码一并提交，服务端核销 OTP 并 admin 改密 */
  async function handleResetWithPhone() {
    if (!/^\d{6}$/.test(code.trim())) return setCodeError({ key: 'forgot.codeInvalid' });
    if (!validatePasswords()) return;
    setBusy(true);
    try {
      await resetPasswordByPhone({ phone: phone.replace(/[\s-]/g, ''), code: code.trim(), new_password: password });
      toast(t('forgot.success'), 'success');
      navigate('/login', { replace: true });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code === 'OTP_EXPIRED') setCodeError({ key: 'error.otpExpired' });
      else handleError(e);
    } finally {
      setBusy(false);
    }
  }

  // 已有会话的用户一般不需要找回；但 recovery 流要求干净状态，不做强制跳转（与主站一致）
  React.useEffect(() => {
    getSession()?.access_token && clearSession();
  }, []);

  const targetLabel = method === 'email' ? email.trim().toLowerCase() : phone.replace(/[\s-]/g, '');

  // —— 各步主/次操作 ——
  const actions =
    step === 'choose' ? (
      <AuthActions
        secondary={
          <Link component={RouterLink} to="/login" underline="hover">
            {t('forgot.backToLogin')}
          </Link>
        }
        primary={null}
      />
    ) : step === 'target' ? (
      <AuthActions
        secondary={
          <Button variant="text" onClick={() => setStep('choose')}>
            {t('forgot.backToLogin')}
          </Button>
        }
        primary={
          <Button variant="contained" size="large" onClick={handleSendCode} disabled={busy}>
            {busy ? t('forgot.sending') : t('forgot.sendCode')}
          </Button>
        }
      />
    ) : step === 'code' && method === 'email' ? (
      <AuthActions
        secondary={
          <Button variant="text" onClick={() => setStep('target')}>
            {t('forgot.goBack')}
          </Button>
        }
        primary={
          <Button variant="contained" size="large" onClick={handleVerifyCode} disabled={busy}>
            {busy ? t('forgot.verifying') : t('forgot.verify')}
          </Button>
        }
      />
    ) : (
      <AuthActions
        secondary={
          <Button variant="text" onClick={() => setStep('target')}>
            {t('forgot.goBack')}
          </Button>
        }
        primary={
          <Button
            variant="contained"
            size="large"
            onClick={method === 'email' ? handleResetWithEmail : handleResetWithPhone}
            disabled={busy}
          >
            {busy ? t('forgot.resetting') : t('forgot.reset')}
          </Button>
        }
      />
    );

  return (
    <AuthShell
      title={title}
      subtitle={step === 'choose' ? t('forgot.subtitle') : undefined}
      transitionKey={`${method}:${step}`}
      actions={actions}
    >
      {step === 'choose' && (
        <>
          <Typography variant="h2">{t('forgot.subtitle')}</Typography>
          <List disablePadding>
            <ListItemButton
              onClick={() => {
                setMethod('email');
                setTargetError(null);
                setStep('target');
              }}
              sx={{ py: 1.75, px: 0.5, borderRadius: 0 }}
            >
              <AlternateEmailRoundedIcon sx={{ mr: 2.5, color: 'primary.main' }} />
              <Box>
                <Typography>{t('forgot.methodEmail')}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {t('forgot.methodEmailDesc')}
                </Typography>
              </Box>
            </ListItemButton>
            <ListItemButton
              onClick={() => {
                setMethod('phone');
                setTargetError(null);
                setStep('target');
              }}
              sx={{ py: 1.75, px: 0.5, borderRadius: 0 }}
            >
              <SmartphoneRoundedIcon sx={{ mr: 2.5, color: 'primary.main' }} />
              <Box>
                <Typography>{t('forgot.methodPhone')}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {t('forgot.methodPhoneDesc')}
                </Typography>
              </Box>
            </ListItemButton>
          </List>
        </>
      )}

      {step === 'target' && (
        <Stack spacing={2}>
          {method === 'email' ? (
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
                  setTargetError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                slotProps={{ htmlInput: { autoComplete: 'email' } }}
                error={Boolean(targetError)}
              />
              <InputError error={targetError} />
            </Box>
          ) : (
            <Box>
              <TextField
                label={t('phoneBind.phoneLabel')}
                type="tel"
                autoFocus
                fullWidth
                placeholder="13x xxxx xxxx"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setTargetError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && handleSendCode()}
                slotProps={{ htmlInput: { maxLength: 13 } }}
                error={Boolean(targetError)}
              />
              <InputError error={targetError} />
            </Box>
          )}
          {/* 发送前人机验证（每条验证码消耗一个 token） */}
          <Turnstile ref={turnstileRef} onToken={setCaptchaToken} onExpire={() => setCaptchaToken('')} />
        </Stack>
      )}

      {step === 'code' && method === 'email' && (
        <Stack spacing={2}>
          <Typography variant="h2">
            {t('forgot.introPrefix')} {email.trim().toLowerCase()} {t('forgot.introSuffix')}
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('forgot.emailLocalDev')}
          </Typography>
          <Box>
            <TextField
              label={t('forgot.codeLabel')}
              autoFocus
              value={code}
              onChange={(e) => {
                setCode(e.target.value);
                setCodeError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && handleVerifyCode()}
              slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}
              error={Boolean(codeError)}
            />
            <InputError error={codeError} />
          </Box>
        </Stack>
      )}

      {/* 邮箱路径：verify 成功后的独立改密步；手机路径：码 + 新密码同屏一次提交 */}
      {((step === 'newPassword' && method === 'email') || (step === 'code' && method === 'phone')) && (
        <Stack spacing={2}>
          {method === 'phone' && (
            <>
              <Typography variant="h2">
                {t('forgot.introPrefix')} {targetLabel} {t('forgot.introSuffix')}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('forgot.phoneSimNote')}
              </Typography>
              <Box>
                <TextField
                  label={t('forgot.codeLabel')}
                  autoFocus
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setCodeError(null);
                  }}
                  slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}
                  error={Boolean(codeError)}
                />
                <InputError error={codeError} />
              </Box>
            </>
          )}
          <Box>
            <TextField
              label={t('forgot.newPasswordLabel')}
              type="password"
              autoFocus={method === 'email'}
              fullWidth
              placeholder={t('forgot.newPasswordPlaceholder')}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setPasswordError(null);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                if (method === 'email') void handleResetWithEmail();
                else void handleResetWithPhone();
              }}
              slotProps={{ htmlInput: { autoComplete: 'new-password', minLength: 6 } }}
              error={Boolean(passwordError)}
            />
            <InputError error={passwordError} />
            <PasswordStrengthMeter password={password} />
          </Box>
          <Box>
            <TextField
              label={t('forgot.confirmLabel')}
              type="password"
              fullWidth
              placeholder={t('forgot.confirmPlaceholder')}
              value={password2}
              onChange={(e) => {
                setPassword2(e.target.value);
                setConfirmError(null);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                if (method === 'email') void handleResetWithEmail();
                else void handleResetWithPhone();
              }}
              slotProps={{ htmlInput: { autoComplete: 'new-password', minLength: 6 } }}
              error={Boolean(confirmError)}
            />
            <InputError error={confirmError} />
          </Box>
        </Stack>
      )}
    </AuthShell>
  );
}
