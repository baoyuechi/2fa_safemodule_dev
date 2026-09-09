// ============================================================================
// SecondaryEmailPage —— 第二辅助邮箱管理（安全中心 · 独立功能页，登录页风格）
//
// 流程：展示当前掩码（第一次可看清）→ 添加：发码（secondary-email-send，
//   排除主邮箱/全局唯一）→ 输码（email-verify 领票）→ secondary-email-verify
//   核销入表；移除：secondary-email-remove 删行。
// 验证码模拟发送（服务器日志取码），无真实邮件系统。
// 壳复用 Login 的 AuthShell（Google 双栏卡片）。需会话：失效 → /login。
// ============================================================================
import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import AuthShell, { AuthActions } from '../components/AuthShell';
import InputError from '../components/InputError';
import type { InputErrorInfo } from '../components/InputError';
import OtpResendRow from '../components/OtpResendRow';
import { useI18n } from '../i18n/LocaleContext';
import {
  clearSession,
  emailVerify,
  fetchSessionUser,
  getAccountSecurityStatus,
  getSession,
  handleError,
  secondaryEmailRemove,
  secondaryEmailSend,
  secondaryEmailVerify,
  toast,
} from '../api/mfaClient';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SecondaryEmailPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [checking, setChecking] = React.useState(true);
  const [hasSecondary, setHasSecondary] = React.useState(false);
  const [mask, setMask] = React.useState<string | null>(null);

  const [email, setEmail] = React.useState('');
  const [code, setCode] = React.useState('');

  const [countdown, setCountdown] = React.useState(0);
  const [sending, setSending] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [emailError, setEmailError] = React.useState<InputErrorInfo | null>(null);
  const [codeError, setCodeError] = React.useState<InputErrorInfo | null>(null);

  const loadStatus = React.useCallback(async (token: string) => {
    const st = await getAccountSecurityStatus(token);
    setHasSecondary(st.hasSecondaryEmail);
    setMask(st.secondaryEmailMask);
  }, []);

  React.useEffect(() => {
    void (async () => {
      const session = getSession();
      if (!session?.access_token) {
        navigate('/login', { replace: true });
        return;
      }
      try {
        await fetchSessionUser(session.access_token);
        await loadStatus(session.access_token);
      } catch {
        clearSession();
        navigate('/login', { replace: true });
      } finally {
        setChecking(false);
      }
    })();
  }, [navigate, loadStatus]);

  React.useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  if (checking) {
    return (
      <AuthShell title={t('secondaryEmail.title')} subtitle={t('secondaryEmail.desc')}>
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress size={28} />
        </Box>
      </AuthShell>
    );
  }

  async function handleSend() {
    const session = getSession();
    if (!session?.access_token) return;
    const mail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(mail)) return setEmailError({ key: 'secondaryEmail.emailInvalid' });
    setSending(true);
    try {
      await secondaryEmailSend(session.access_token, mail);
      toast(t('secondaryEmail.codeSent', { email: mail }), 'success');
      setCountdown(60);
    } catch (e) {
      const err = e as { code?: string };
      if (err?.code === 'SE_IS_PRIMARY') setEmailError({ key: 'error.secondaryIsPrimary' });
      else if (err?.code === 'SE_ALREADY_SET') setEmailError({ key: 'error.secondaryAlreadySet' });
      else if (err?.code === 'EMAIL_TAKEN') setEmailError({ key: 'error.emailTaken' });
      else handleError(e);
    } finally {
      setSending(false);
    }
  }

  async function handleVerify() {
    const session = getSession();
    if (!session?.access_token) return;
    const mail = email.trim().toLowerCase();
    if (!/^\d{6}$/.test(code.trim())) return setCodeError({ key: 'forgot.codeInvalid' });
    setBusy(true);
    try {
      const { otpToken } = await emailVerify(session.access_token, mail, code.trim());
      if (!otpToken) throw new Error(t('phoneBind.missingToken'));
      await secondaryEmailVerify(session.access_token, mail, otpToken);
      toast(t('secondaryEmail.successAdd'), 'success');
      setEmail('');
      setCode('');
      await loadStatus(session.access_token);
    } catch (e) {
      const err = e as { code?: string };
      if (err?.code === 'OTP_EXPIRED') setCodeError({ key: 'error.otpExpired' });
      else handleError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    const session = getSession();
    if (!session?.access_token) return;
    setBusy(true);
    try {
      await secondaryEmailRemove(session.access_token);
      toast(t('secondaryEmail.successRemove'), 'success');
      setEmail('');
      setCode('');
      setCountdown(0);
      await loadStatus(session.access_token);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={t('secondaryEmail.title')}
      subtitle={t('secondaryEmail.desc')}
      actions={
        <AuthActions
          secondary={
            <Button variant="text" component={RouterLink} to="/security" disabled={busy}>
              {t('common.backToSecurity')}
            </Button>
          }
          primary={
            <Button variant="contained" size="large" onClick={() => void handleVerify()} disabled={busy || sending}>
              {busy ? t('secondaryEmail.adding') : t('secondaryEmail.verifyButton')}
            </Button>
          }
        />
      }
    >
      <Stack spacing={1}>
        <Typography variant="h2" sx={{ fontSize: '0.8125rem', fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
          {t('secondaryEmail.current')}
        </Typography>
        <Box>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {hasSecondary && mask ? `${t('secondaryEmail.set')}：${mask}` : t('secondaryEmail.none')}
          </Typography>
          {hasSecondary && (
            <Button variant="outlined" color="error" size="small" sx={{ mt: 1 }} onClick={() => void handleRemove()} disabled={busy}>
              {t('secondaryEmail.remove')}
            </Button>
          )}
        </Box>

        <Divider />

        <Typography variant="h2" sx={{ fontSize: '0.8125rem', fontWeight: 600, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.02em' }}>
          {t('secondaryEmail.addLabel')}
        </Typography>
        <Box>
          <TextField
            label={t('secondaryEmail.emailLabel')}
            type="email"
            fullWidth
            placeholder={t('secondaryEmail.emailPlaceholder')}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
            }}
            onKeyDown={(e) => e.key === 'Enter' && void handleSend()}
            slotProps={{ htmlInput: { autoComplete: 'email' } }}
            error={Boolean(emailError)}
          />
          <InputError error={emailError} />
        </Box>
        <OtpResendRow
          label={t('changePassword.codeLabel')}
          value={code}
          onChange={(v) => {
            setCode(v);
            setCodeError(null);
          }}
          error={codeError}
          busy={busy}
          sending={sending}
          countdown={countdown}
          sendLabel={t('secondaryEmail.add')}
          sendingLabel={t('secondaryEmail.adding')}
          resendIn={(n) => t('phoneRebind.resendIn', { countdown: n })}
          onSend={() => void handleSend()}
        />
      </Stack>
    </AuthShell>
  );
}