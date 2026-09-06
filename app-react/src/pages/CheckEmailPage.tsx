import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import AuthShell, { AuthActions } from '../components/AuthShell';
import EmailPill from '../components/EmailPill';
import InputError from '../components/InputError';
import type { InputErrorInfo } from '../components/InputError';
import { useI18n } from '../i18n/LocaleContext';
import { confirmEmailWithCode, getSession, handleError, resendEmail, saveSession, toast } from '../api/mfaClient';

interface CheckEmailState {
  email?: string;
}

/** 注册第二步：邮箱验证（GoTrue signup OTP——输入邮件里的 6 位验证码）。 */
export default function CheckEmailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const { t } = useI18n();
  // 邮箱优先取 location.state（RegisterPage 传递）；刷新后 state 丢失 → 回退 sessionStorage，
  // 避免用户被弹回注册页重填。
  const [email] = React.useState(
    () => (location.state as CheckEmailState | null)?.email?.trim().toLowerCase() ?? sessionStorage.getItem('mfa.pendingEmail') ?? '',
  );
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  // 行内字段错误（InputError 红字），输入即清除
  const [codeError, setCodeError] = React.useState<InputErrorInfo | null>(null);

  // 会话已存在（本浏览器已完成邮箱验证）→ 直达手机号绑定；否则无邮箱 → 回注册
  React.useEffect(() => {
    if (getSession()?.access_token) {
      navigate('/register/phone', { replace: true });
      return;
    }
    if (!email) {
      navigate('/register', { replace: true });
    }
  }, [email, navigate]);

  async function handleResend() {
    if (!email) return;
    setSending(true);
    try {
      await resendEmail(email);
      toast(t('checkEmail.resent'), 'success');
    } catch (e) {
      handleError(e);
    } finally {
      setSending(false);
    }
  }

  // 邮箱验证：输入邮件中的 6 位验证码 → 换标准会话 → 手机号绑定。
  // 码相关错误在验证码框下方行内提示（Google 式），其余仍走 Toast。
  async function handleVerify() {
    if (!/^\d{6}$/.test(code.trim())) return setCodeError({ key: 'checkEmail.codeInvalid' });
    setBusy(true);
    try {
      saveSession(await confirmEmailWithCode(email, code.trim()));
      toast(t('checkEmail.verified'), 'success');
      navigate('/register/phone', { replace: true });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code === 'OTP_EXPIRED') setCodeError({ key: 'error.otpExpired' });
      else setCodeError({ key: 'checkEmail.codeWrong' }); // 防枚举：码错误统一文案
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={t('checkEmail.title')}
      subtitle={t('checkEmail.subtitle')}
      leftExtra={email.trim() ? <EmailPill email={email} /> : undefined}
      transitionKey="check-email"
      actions={
        <AuthActions
          secondary={
            <Button variant="text" onClick={handleResend} disabled={sending}>
              {sending ? t('checkEmail.sending') : t('checkEmail.resend')}
            </Button>
          }
          primary={
            <Button variant="contained" size="large" onClick={handleVerify} disabled={busy}>
              {busy ? t('checkEmail.verifying') : t('checkEmail.verify')}
            </Button>
          }
        />
      }
    >
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        {t('checkEmail.introPrefix')}{' '}
        <Typography component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
          {email.trim() || t('checkEmail.yourEmail')}
        </Typography>{' '}
        {t('checkEmail.introSuffix')}
      </Typography>

      <Box>
        <TextField
          label={t('checkEmail.codeLabel')}
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setCodeError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
          slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}
          error={Boolean(codeError)}
        />
        <InputError error={codeError} />
      </Box>

      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        {t('checkEmail.localDev')}
      </Typography>
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
        <Link component={RouterLink} to="/register" underline="hover">
          {t('checkEmail.goBack')}
        </Link>
      </Typography>
    </AuthShell>
  );
}