// ============================================================================
// PasswordPage —— 修改邮箱密码（安全中心 · 独立功能页，登录页风格）
//
// 流程：重认证渠道选择（绑定手机 / 学校邮箱 / 备用安全码 / 通行密钥）
//   → 渠道验证 → 新密码（沿用注册强度：zxcvbn ≥2 + 确认一致）→ 提交。
// 壳复用 Login 的 AuthShell（Google 双栏卡片）——「单一功能新页面」视觉。
// 契约：仅密码不算本人验证（用户修正#1）；手机/邮箱走 account/reauth-*-send
//   发码 → claim 后 change-password 核销票据；安全码一经正确使用即消耗；
//   通行密钥路径做真实 WebAuthn 登录（新会话）→ PUT /user 改密。
// 需会话：无会话/会话失效 → /login；成功 → 回 /security。
// ============================================================================
import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AlternateEmailRoundedIcon from '@mui/icons-material/AlternateEmailRounded';
import FingerprintRoundedIcon from '@mui/icons-material/FingerprintRounded';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import SmsRoundedIcon from '@mui/icons-material/SmsRounded';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import AuthShell, { AuthActions } from '../components/AuthShell';
import InputError from '../components/InputError';
import type { InputErrorInfo } from '../components/InputError';
import OtpResendRow from '../components/OtpResendRow';
import PasswordStrengthMeter from '../components/PasswordStrengthMeter';
import { scorePasswordSync } from '../lib/passwordStrength';
import { useI18n } from '../i18n/LocaleContext';
import {
  changePassword,
  changePasswordWithPasskey,
  clearSession,
  emailVerify,
  fetchSessionUser,
  getAccountSecurityStatus,
  getSession,
  handleError,
  reauthEmailSend,
  reauthPhoneSend,
  toast,
  verifyOtp,
} from '../api/mfaClient';
import type { ChangePasswordProof } from '../api/mfaClient';

const PHONE_RE = /^1[3-9]\d{9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RECOVERY_RE = /^[A-HJ-NP-Z2-9]{8}$/i;

type Method = 'phone' | 'email' | 'recovery' | 'passkey';
type Step = 'choose' | 'verify' | 'newPassword';
type ClaimedProof = Exclude<ChangePasswordProof, { type: 'recovery' }>;

export default function PasswordPage() {
  const navigate = useNavigate();
  const { t, locale } = useI18n();
  const [checking, setChecking] = React.useState(true);
  const [userEmail, setUserEmail] = React.useState('');
  const [status, setStatus] = React.useState<{ hasPhone: boolean; phoneLast4: string | null; hasRecoveryCodes: boolean; hasPasskeys: boolean } | null>(null);

  const [step, setStep] = React.useState<Step>('choose');
  const [method, setMethod] = React.useState<Method | null>(null);

  const [phone, setPhone] = React.useState('');
  const [emailInput, setEmailInput] = React.useState('');
  const [code, setCode] = React.useState('');
  const [recoveryInput, setRecoveryInput] = React.useState('');
  const [claimed, setClaimed] = React.useState<ClaimedProof | null>(null);

  const [password, setPassword] = React.useState('');
  const [password2, setPassword2] = React.useState('');

  const [countdown, setCountdown] = React.useState(0);
  const [sending, setSending] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [targetError, setTargetError] = React.useState<InputErrorInfo | null>(null);
  const [codeError, setCodeError] = React.useState<InputErrorInfo | null>(null);
  const [passwordError, setPasswordError] = React.useState<InputErrorInfo | null>(null);
  const [confirmError, setConfirmError] = React.useState<InputErrorInfo | null>(null);

  React.useEffect(() => {
    void (async () => {
      const session = getSession();
      if (!session?.access_token) {
        navigate('/login', { replace: true });
        return;
      }
      try {
        const u = await fetchSessionUser(session.access_token);
        const mail = (u.email ?? '').trim().toLowerCase();
        setUserEmail(mail);
        setEmailInput(mail);
        setStatus(await getAccountSecurityStatus(session.access_token));
      } catch {
        clearSession();
        navigate('/login', { replace: true });
      } finally {
        setChecking(false);
      }
    })();
  }, [navigate]);

  React.useEffect(() => {
    if (countdown <= 0) return;
    const timer = setInterval(() => setCountdown((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [countdown]);

  if (checking) {
    return (
      <AuthShell title={t('changePassword.title')} subtitle={t('changePassword.reauthDesc')}>
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress size={28} />
        </Box>
      </AuthShell>
    );
  }

  const options: Array<{ key: Method; title: string; desc: string; icon: React.ReactNode }> = [];
  if (status?.hasPhone) options.push({ key: 'phone', title: t('changePassword.methodPhone'), desc: t('changePassword.methodPhoneDesc'), icon: <SmsRoundedIcon sx={{ mr: 2.5, color: 'primary.main' }} /> });
  options.push({ key: 'email', title: t('changePassword.methodEmail'), desc: t('changePassword.methodEmailDesc'), icon: <AlternateEmailRoundedIcon sx={{ mr: 2.5, color: 'primary.main' }} /> });
  if (status?.hasRecoveryCodes) options.push({ key: 'recovery', title: t('changePassword.methodRecovery'), desc: t('changePassword.methodRecoveryDesc'), icon: <KeyRoundedIcon sx={{ mr: 2.5, color: 'primary.main' }} /> });
  if (status?.hasPasskeys) options.push({ key: 'passkey', title: t('changePassword.methodPasskey'), desc: t('changePassword.methodPasskeyDesc'), icon: <FingerprintRoundedIcon sx={{ mr: 2.5, color: 'primary.main' }} /> });

  const subtitle =
    step === 'choose'
      ? t('changePassword.reauthDesc')
      : step === 'verify'
        ? method === 'phone'
          ? t('changePassword.otpSentPhone')
          : t('changePassword.otpSentEmail')
        : t('changePassword.reauthDesc');

  function chooseMethod(m: Method) {
    setMethod(m);
    setTargetError(null);
    setCodeError(null);
    if (m === 'passkey' || m === 'recovery') setStep('newPassword');
    else setStep('verify');
  }

  async function handleSendCode() {
    const session = getSession();
    if (!session?.access_token || !method) return;
    const normalized = phone.replace(/[\s-]/g, '');
    if (method === 'phone' && !PHONE_RE.test(normalized)) return setTargetError({ key: 'phoneBind.phoneInvalid' });
    if (method === 'email') {
      const mail = emailInput.trim().toLowerCase();
      if (!EMAIL_RE.test(mail)) return setTargetError({ key: 'forgot.emailInvalid' });
    }
    setSending(true);
    try {
      if (method === 'phone') await reauthPhoneSend(session.access_token, normalized);
      else await reauthEmailSend(session.access_token, emailInput.trim().toLowerCase());
      toast(t('phoneBind.otpSent'), 'success');
      setCountdown(60);
    } catch (e) {
      const err = e as { code?: string };
      if (err?.code === 'PHONE_MISMATCH') setTargetError({ key: 'error.phoneMismatch' });
      if (err?.code === 'EMAIL_MISMATCH') setTargetError({ key: 'error.emailMismatch' });
      handleError(e);
    } finally {
      setSending(false);
    }
  }

  async function handleVerifyCode() {
    const session = getSession();
    if (!session?.access_token || !method) return;
    if (!/^\d{6}$/.test(code.trim())) return setCodeError({ key: 'forgot.codeInvalid' });
    setBusy(true);
    try {
      if (method === 'phone') {
        const { otpToken } = await verifyOtp(phone.replace(/[\s-]/g, ''), code.trim());
        if (!otpToken) throw new Error(t('phoneBind.missingToken'));
        setClaimed({ type: 'phone', phone: phone.replace(/[\s-]/g, ''), otpToken });
      } else {
        const { otpToken } = await emailVerify(session.access_token, emailInput.trim().toLowerCase(), code.trim());
        if (!otpToken) throw new Error(t('phoneBind.missingToken'));
        setClaimed({ type: 'email', otpToken });
      }
      setStep('newPassword');
    } catch (e) {
      const err = e as { code?: string };
      if (err?.code === 'OTP_EXPIRED') setCodeError({ key: 'error.otpExpired' });
      else handleError(e);
    } finally {
      setBusy(false);
    }
  }

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

  async function handleSubmit() {
    const session = getSession();
    if (!session?.access_token || !method) return;
    if (!validatePasswords()) return;
    if (method === 'passkey') {
      setBusy(true);
      try {
        await changePasswordWithPasskey(userEmail, password);
        toast(t('changePassword.success'), 'success');
        navigate('/security', { replace: true });
      } catch (e) {
        handleError(e);
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      let proof: ChangePasswordProof;
      if (method === 'recovery') {
        const normalized = recoveryInput.replace(/[-\s]/g, '').toUpperCase();
        if (!RECOVERY_RE.test(normalized)) {
          setCodeError({ key: 'forgot.codeInvalid' });
          setBusy(false);
          return;
        }
        proof = { type: 'recovery', code: normalized };
      } else {
        if (!claimed) throw new Error(t('phoneBind.missingToken'));
        proof = claimed;
      }
      await changePassword(session.access_token, password, proof);
      toast(t('changePassword.success'), 'success');
      navigate('/security', { replace: true });
    } catch (e) {
      const err = e as { code?: string };
      if (err?.code === 'RECOVERY_INVALID') setCodeError({ key: 'error.recoveryInvalid' });
      if (err?.code === 'OTP_EXPIRED') setCodeError({ key: 'error.otpExpired' });
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title={t('changePassword.title')}
      subtitle={subtitle}
      transitionKey={step}
      actions={
        step === 'choose' ? undefined : (
          <AuthActions
            secondary={
              <Button
                variant="text"
                onClick={() => setStep(method === 'passkey' || method === 'recovery' ? 'choose' : 'verify')}
                disabled={busy || sending}
              >
                {t('changePassword.back')}
              </Button>
            }
            primary={
              step === 'verify' ? (
                <Button variant="contained" size="large" onClick={() => void handleVerifyCode()} disabled={busy || sending}>
                  {busy ? t('changePassword.verifying') : t('changePassword.verify')}
                </Button>
              ) : (
                <Button variant="contained" size="large" onClick={() => void handleSubmit()} disabled={busy || sending}>
                  {busy ? t('changePassword.changing') : t('changePassword.change')}
                </Button>
              )
            }
          />
        )
      }
    >
      {step === 'choose' && (
        <>
          {options.length === 0 && <Typography sx={{ color: 'text.secondary' }}>{t('changePassword.noOptions')}</Typography>}
          <List disablePadding>
            {options.map((opt) => (
              <React.Fragment key={opt.key}>
                <ListItemButton onClick={() => chooseMethod(opt.key)} sx={{ py: 1.75, px: 0.5, borderRadius: 0 }}>
                  {opt.icon}
                  <Box>
                    <Typography>{opt.title}</Typography>
                    <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                      {opt.desc}
                    </Typography>
                  </Box>
                </ListItemButton>
                <Divider />
              </React.Fragment>
            ))}
          </List>
          <Link component={RouterLink} to="/security" underline="hover" variant="body2" sx={{ alignSelf: 'flex-start' }}>
            {t('common.backToSecurity')}
          </Link>
        </>
      )}

      {step === 'verify' && method && (
        <>
          {method === 'phone' && (
            <Box>
              <TextField
                label={t('phoneRebind.oldPhoneLabel')}
                type="tel"
                autoFocus
                fullWidth
                placeholder="13x xxxx xxxx"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setTargetError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && void handleSendCode()}
                slotProps={{ htmlInput: { maxLength: 13 } }}
                error={Boolean(targetError)}
              />
              <InputError error={targetError} />
              {status?.phoneLast4 && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  {t('phoneRebind.oldNote')} · · · · · ·{status.phoneLast4}
                </Typography>
              )}
            </Box>
          )}
          {method === 'email' && (
            <Box>
              <TextField
                label={t('common.emailLabel')}
                type="email"
                fullWidth
                disabled
                value={userEmail}
                onChange={(e) => {
                  setEmailInput(e.target.value);
                  setTargetError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && void handleSendCode()}
                slotProps={{ htmlInput: { autoComplete: 'email' } }}
                error={Boolean(targetError)}
              />
              <InputError error={targetError} />
            </Box>
          )}
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
            sendLabel={t('changePassword.send')}
            sendingLabel={t('changePassword.sending')}
            resendIn={(n) => t('changePassword.resendIn', { countdown: n })}
            onSend={() => void handleSendCode()}
          />
        </>
      )}

      {step === 'newPassword' && method && (
        <>
          {method === 'recovery' && (
            <Box>
              <TextField
                label={t('changePassword.recoveryLabel')}
                autoFocus
                fullWidth
                placeholder={t('changePassword.recoveryPlaceholder')}
                value={recoveryInput}
                onChange={(e) => {
                  setRecoveryInput(e.target.value);
                  setCodeError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && void handleSubmit()}
                slotProps={{ htmlInput: { maxLength: 9 } }}
                error={Boolean(codeError)}
              />
              <InputError error={codeError} />
            </Box>
          )}
          <Box>
            <TextField
              label={t('changePassword.newPasswordLabel')}
              type="password"
              autoFocus={method !== 'recovery'}
              fullWidth
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
              label={t('changePassword.confirmLabel')}
              type="password"
              fullWidth
              value={password2}
              onChange={(e) => {
                setPassword2(e.target.value);
                setConfirmError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && void handleSubmit()}
              slotProps={{ htmlInput: { autoComplete: 'new-password', minLength: 6 } }}
              error={Boolean(confirmError)}
            />
            <InputError error={confirmError} />
          </Box>
          {method === 'passkey' && (
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('changePassword.methodPasskeyDesc')}
            </Typography>
          )}
        </>
      )}
    </AuthShell>
  );
}