// ============================================================================
// PhoneRebindPage —— 更换绑定手机号（安全中心 · 独立功能页，登录页风格）
//
// 有先后顺序的三步（持有者自证 + 双验证码，缺一不可换）：
//   ① 补全旧手机：掩码 "138****1234" 只露号段+尾四位，用户补中段 4 位
//      → reauth-phone-send（号与绑定不符 → PHONE_MISMATCH，不发码）
//   ② 验证旧手机：6 位码 → verify-otp 领旧票
//   ③ 验证新手机：输新号 → phone-rebind-send-new 发码 → 领新票 → phone-rebind
//     核销双票换绑。
// 未绑定手机 → 空态提示。壳复用 Login 的 AuthShell。无会话/失效 → /login。
// ============================================================================
import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Step from '@mui/material/Step';
import StepLabel from '@mui/material/StepLabel';
import Stepper from '@mui/material/Stepper';
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
  fetchSessionUser,
  getAccountSecurityStatus,
  getSession,
  handleError,
  phoneRebind,
  phoneRebindSendNew,
  reauthPhoneSend,
  toast,
  verifyOtp,
} from '../api/mfaClient';

const PHONE_RE = /^1[3-9]\d{9}$/;
const PAD_RE = /^\d{4}$/;
const CODE_RE = /^\d{6}$/;

type StepId = 'pad' | 'oldCode' | 'new';

export default function PhoneRebindPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [checking, setChecking] = React.useState(true);
  const [hasPhone, setHasPhone] = React.useState<boolean | null>(null);
  const [phoneFirst3, setPhoneFirst3] = React.useState<string | null>(null);
  const [phoneLast4, setPhoneLast4] = React.useState<string | null>(null);

  const [step, setStep] = React.useState<StepId>('pad');
  const [padDigits, setPadDigits] = React.useState('');
  const [oldPhone, setOldPhone] = React.useState('');
  const [oldCode, setOldCode] = React.useState('');
  const [oldOtpToken, setOldOtpToken] = React.useState('');
  const [newPhone, setNewPhone] = React.useState('');
  const [newCode, setNewCode] = React.useState('');

  const [oldCountdown, setOldCountdown] = React.useState(0);
  const [newCountdown, setNewCountdown] = React.useState(0);
  const [sendingOld, setSendingOld] = React.useState(false);
  const [sendingNew, setSendingNew] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const [padError, setPadError] = React.useState<InputErrorInfo | null>(null);
  const [oldCodeError, setOldCodeError] = React.useState<InputErrorInfo | null>(null);
  const [newPhoneError, setNewPhoneError] = React.useState<InputErrorInfo | null>(null);
  const [newCodeError, setNewCodeError] = React.useState<InputErrorInfo | null>(null);

  React.useEffect(() => {
    void (async () => {
      const session = getSession();
      if (!session?.access_token) {
        navigate('/login', { replace: true });
        return;
      }
      try {
        await fetchSessionUser(session.access_token);
        const status = await getAccountSecurityStatus(session.access_token);
        setHasPhone(status.hasPhone);
        setPhoneFirst3(status.phoneFirst3);
        setPhoneLast4(status.phoneLast4);
      } catch {
        clearSession();
        navigate('/login', { replace: true });
      } finally {
        setChecking(false);
      }
    })();
  }, [navigate]);

  React.useEffect(() => {
    if (oldCountdown <= 0) return;
    const timer = setInterval(() => setOldCountdown((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [oldCountdown]);
  React.useEffect(() => {
    if (newCountdown <= 0) return;
    const timer = setInterval(() => setNewCountdown((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [newCountdown]);

  if (checking) {
    return (
      <AuthShell title={t('phoneRebind.title')}>
        <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
          <CircularProgress size={28} />
        </Box>
      </AuthShell>
    );
  }

  const mask = phoneFirst3 && phoneLast4 ? `${phoneFirst3}****${phoneLast4}` : '';

  async function handlePadNext() {
    const session = getSession();
    if (!session?.access_token || !mask) return;
    const digits = padDigits.trim();
    if (!PAD_RE.test(digits)) return setPadError({ key: 'phoneRebind.padDigitsInvalid' });
    const fullOld = `${phoneFirst3}${digits}${phoneLast4}`;
    if (!PHONE_RE.test(fullOld)) return setPadError({ key: 'phoneRebind.padDigitsInvalid' });
    setSendingOld(true);
    try {
      await reauthPhoneSend(session.access_token, fullOld);
      setOldPhone(fullOld);
      toast(t('phoneBind.otpSent'), 'success');
      setOldCountdown(60);
      setStep('oldCode');
    } catch (e) {
      const err = e as { code?: string };
      if (err?.code === 'PHONE_MISMATCH') setPadError({ key: 'error.phoneMismatch' });
      else handleError(e);
    } finally {
      setSendingOld(false);
    }
  }

  async function handleVerifyOld() {
    const session = getSession();
    if (!session?.access_token || !oldPhone) return;
    if (!CODE_RE.test(oldCode.trim())) return setOldCodeError({ key: 'forgot.codeInvalid' });
    setBusy(true);
    try {
      const { otpToken } = await verifyOtp(oldPhone, oldCode.trim());
      if (!otpToken) throw new Error(t('phoneBind.missingToken'));
      setOldOtpToken(otpToken);
      setStep('new');
    } catch (e) {
      const err = e as { code?: string };
      if (err?.code === 'OTP_EXPIRED') setOldCodeError({ key: 'error.otpExpired' });
      else handleError(e);
    } finally {
      setBusy(false);
    }
  }

  async function handleResendOld() {
    const session = getSession();
    if (!session?.access_token || !oldPhone) return;
    setSendingOld(true);
    try {
      await reauthPhoneSend(session.access_token, oldPhone);
      toast(t('phoneBind.otpSent'), 'success');
      setOldCountdown(60);
    } catch (e) {
      const err = e as { code?: string };
      if (err?.code === 'PHONE_MISMATCH') setPadError({ key: 'error.phoneMismatch' });
      else handleError(e);
    } finally {
      setSendingOld(false);
    }
  }

  async function handleSendNew() {
    const session = getSession();
    if (!session?.access_token) return;
    const normalized = newPhone.replace(/[\s-]/g, '');
    if (!PHONE_RE.test(normalized)) return setNewPhoneError({ key: 'phoneBind.phoneInvalid' });
    if (normalized === oldPhone) return setNewPhoneError({ key: 'phoneRebind.oldStepHint' });
    setSendingNew(true);
    try {
      await phoneRebindSendNew(session.access_token, normalized);
      toast(t('phoneBind.otpSent'), 'success');
      setNewCountdown(60);
    } catch (e) {
      const err = e as { code?: string };
      if (err?.code === 'PHONE_TAKEN') setNewPhoneError({ key: 'phoneBind.phoneTaken' });
      else handleError(e);
    } finally {
      setSendingNew(false);
    }
  }

  async function handleSubmit() {
    const session = getSession();
    if (!session?.access_token || !oldPhone || !oldOtpToken) return;
    if (!CODE_RE.test(newCode.trim())) return setNewCodeError({ key: 'forgot.codeInvalid' });
    setBusy(true);
    try {
      const { otpToken: newOtpToken } = await verifyOtp(newPhone.trim(), newCode.trim());
      if (!newOtpToken) throw new Error(t('phoneBind.missingToken'));
      await phoneRebind(session.access_token, { oldPhone, oldOtpToken, newPhone: newPhone.trim(), newOtpToken });
      toast(t('phoneRebind.success'), 'success');
      navigate('/security', { replace: true });
    } catch (e) {
      const err = e as { code?: string };
      if (err?.code === 'OTP_EXPIRED') setNewCodeError({ key: 'error.otpExpired' });
      else handleError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!hasPhone) {
    return (
      <AuthShell title={t('phoneRebind.title')} subtitle={t('phoneRebind.notBoundTitle')}>
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          {t('phoneRebind.notBoundDesc')}
        </Typography>
        <Link component={RouterLink} to="/security" underline="hover" variant="body2" sx={{ alignSelf: 'flex-start' }}>
          {t('common.backToSecurity')}
        </Link>
      </AuthShell>
    );
  }

  const activeStep = step === 'pad' ? 0 : step === 'oldCode' ? 1 : 2;
  const stepLabels = [t('phoneRebind.stepPad'), t('phoneRebind.oldTitle').replace(/^\d+\s*·\s*/, ''), t('phoneRebind.newTitle').replace(/^\d+\s*·\s*/, '')];
  const subtitle =
    step === 'pad'
      ? t('phoneRebind.oldNote')
      : step === 'oldCode'
        ? t('phoneRebind.codeSentTo', { mask })
        : t('phoneRebind.newNote');

  return (
    <AuthShell
      title={t('phoneRebind.title')}
      subtitle={subtitle}
      transitionKey={step}
      actions={
        <AuthActions
          secondary={
            step === 'pad' ? (
              <Button variant="text" component={RouterLink} to="/security" disabled={busy}>
                {t('common.backToSecurity')}
              </Button>
            ) : (
              <Button
                variant="text"
                onClick={() => setStep(step === 'new' ? 'oldCode' : 'pad')}
                disabled={busy || sendingOld || sendingNew}
              >
                {t('changePassword.back')}
              </Button>
            )
          }
          primary={
            step === 'new' ? (
              <Button variant="contained" size="large" onClick={() => void handleSubmit()} disabled={busy || sendingNew}>
                {busy ? t('phoneRebind.submitting') : t('phoneRebind.submit')}
              </Button>
            ) : (
              <Button
                variant="contained"
                size="large"
                onClick={() => void (step === 'pad' ? handlePadNext() : handleVerifyOld())}
                disabled={busy || sendingOld}
              >
                {busy ? t('changePassword.verifying') : t('common.next')}
              </Button>
            )
          }
        />
      }
    >
      <Stepper activeStep={activeStep} alternativeLabel sx={{ width: '100%', mb: 1 }}>
        {stepLabels.map((label) => (
          <Step key={label}>
            <StepLabel sx={{ '& .MuiStepLabel-label': { fontSize: '0.8125rem', color: 'text.secondary' } }}>{label}</StepLabel>
          </Step>
        ))}
      </Stepper>

      {step === 'pad' && (
        <>
          <Typography variant="body1" sx={{ fontWeight: 500 }}>
            {t('phoneRebind.padOldHint', { mask })}
          </Typography>
          <Box>
            <TextField
              autoFocus
              inputMode="numeric"
              value={padDigits}
              onChange={(e) => {
                setPadDigits(e.target.value.replace(/\D/g, ''));
                setPadError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && void handlePadNext()}
              placeholder="••••"
              label={t('phoneRebind.padDigitsLabel')}
              error={Boolean(padError)}
              slotProps={{
                htmlInput: {
                  maxLength: 4,
                  style: { textAlign: 'center', fontSize: '1.25rem', letterSpacing: '0.5em' },
                },
              }}
              sx={{ width: 168 }}
            />
            <InputError error={padError} />
          </Box>
        </>
      )}

      {step === 'oldCode' && (
        <OtpResendRow
          label={t('changePassword.codeLabel')}
          value={oldCode}
          onChange={(v) => {
            setOldCode(v);
            setOldCodeError(null);
          }}
          error={oldCodeError}
          busy={busy}
          sending={sendingOld}
          countdown={oldCountdown}
          sendLabel={t('phoneRebind.send')}
          sendingLabel={t('phoneRebind.sending')}
          resendIn={(n) => t('phoneRebind.resendIn', { countdown: n })}
          onSend={() => void handleResendOld()}
        />
      )}

      {step === 'new' && (
        <>
          <Box>
            <TextField
              label={t('phoneRebind.newPhoneLabel')}
              type="tel"
              autoFocus
              fullWidth
              placeholder="13x xxxx xxxx"
              value={newPhone}
              onChange={(e) => {
                setNewPhone(e.target.value);
                setNewPhoneError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && void handleSendNew()}
              slotProps={{ htmlInput: { maxLength: 13 } }}
              error={Boolean(newPhoneError)}
            />
            <InputError error={newPhoneError} />
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {t('phoneRebind.oldStepHint')}
          </Typography>
          <OtpResendRow
            label={t('changePassword.codeLabel')}
            value={newCode}
            onChange={(v) => {
              setNewCode(v);
              setNewCodeError(null);
            }}
            error={newCodeError}
            busy={busy}
            sending={sendingNew}
            countdown={newCountdown}
            sendLabel={t('phoneRebind.send')}
            sendingLabel={t('phoneRebind.sending')}
            resendIn={(n) => t('phoneRebind.resendIn', { countdown: n })}
            onSend={() => void handleSendNew()}
          />
        </>
      )}
    </AuthShell>
  );
}