import * as React from 'react';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useNavigate } from 'react-router-dom';
import AuthShell, { AuthActions } from '../components/AuthShell';
import EmailPill from '../components/EmailPill';
import PageLoader from '../components/PageLoader';
import {
  clearSession,
  fetchSessionUser,
  getSession,
  handleError,
  phoneBind,
  sendOtp,
  toast,
  verifyOtp,
} from '../api/mfaClient';
import type { MfaUser } from '../api/mfaClient';

const PHONE_RE = /^1[3-9]\d{9}$/;

/** 注册第三步（必选·FR-2）：邮箱验证通过后强制完成一次性手机号绑定。 */
export default function PhoneBindPage() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<MfaUser | null>(null);
  const [phone, setPhone] = React.useState('');
  const [otpCode, setOtpCode] = React.useState('');
  const [countdown, setCountdown] = React.useState(0);
  const [sendingOtp, setSendingOtp] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  // 会话守卫：未确认邮箱 / 会话失效 → 回登录页（邮箱验证成功才有会话）
  React.useEffect(() => {
    void (async () => {
      const session = getSession();
      if (!session?.access_token) {
        navigate('/login', { replace: true });
        return;
      }
      try {
        setUser(await fetchSessionUser(session.access_token));
      } catch {
        clearSession();
        navigate('/login', { replace: true });
      }
    })();
  }, [navigate]);

  React.useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown((n) => n - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  async function handleSendOtp() {
    const normalized = phone.replace(/[\s-]/g, '');
    if (!PHONE_RE.test(normalized)) return toast('请输入正确的手机号', 'error');
    if (sendingOtp || countdown > 0) return; // 请求飞行中禁用，防双击双发耗 24h 限 5 条配额
    setSendingOtp(true);
    try {
      await sendOtp(normalized);
      toast('验证码已发送（模拟短信，码在 edge 日志）', 'success');
      setCountdown(60);
    } catch (e) {
      handleError(e); // PHONE_TAKEN / RATE_LIMITED 字典文案
    } finally {
      setSendingOtp(false);
    }
  }

  // 验证 + 一次性绑定：verify-otp 签发票据 → phone/bind 核销并写库 → 前往指纹绑定
  async function handleVerifyAndBind() {
    const normalized = phone.replace(/[\s-]/g, '');
    if (!PHONE_RE.test(normalized)) return toast('请输入正确的手机号', 'error');
    if (!/^\d{6}$/.test(otpCode.trim())) return toast('请输入 6 位验证码', 'error');
    const session = getSession();
    if (!session?.access_token) return;
    setBusy(true);
    try {
      const { otpToken } = await verifyOtp(normalized, otpCode.trim());
      if (!otpToken) throw new Error('缺少一次性票据');
      await phoneBind(session.access_token, otpToken, normalized);
      toast('手机号绑定成功', 'success');
      navigate('/enroll', { replace: true });
    } catch (e) {
      handleError(e); // OTP_EXPIRED / PHONE_TAKEN / RATE_LIMITED
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <PageLoader />; // 守卫跳转中：统一加载占位，避免白屏闪现

  return (
    <AuthShell
      title="绑定手机号"
      subtitle="注册必选步骤。手机号仅用于账号恢复与备用验证，不参与日常登录。"
      leftExtra={user?.email ? <EmailPill email={user.email} /> : undefined}
      transitionKey="phone-bind"
      actions={
        <AuthActions
          secondary={
            <Link
              component="button"
              underline="hover"
              onClick={() => {
                clearSession();
                navigate('/register', { replace: true });
              }}
            >
              退出，换一个邮箱注册
            </Link>
          }
          primary={
            <Button variant="contained" size="large" onClick={handleVerifyAndBind} disabled={busy}>
              {busy ? '验证绑定中…' : '验证并绑定'}
            </Button>
          }
        />
      }
    >
      <Stack spacing={2}>
        <TextField
          label="手机号"
          type="tel"
          placeholder="13x xxxx xxxx"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          slotProps={{ htmlInput: { maxLength: 13 } }}
        />
        <Stack direction="row" spacing={1} alignItems="flex-start">
          <TextField
            label="6 位验证码"
            value={otpCode}
            onChange={(e) => setOtpCode(e.target.value)}
            slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}
            sx={{ flex: 1 }}
          />
          <Button
            variant="outlined"
            onClick={handleSendOtp}
            disabled={sendingOtp || countdown > 0}
            sx={{ whiteSpace: 'nowrap', mt: 0.5 }}
          >
            {sendingOtp ? '发送中…' : countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}
          </Button>
        </Stack>
      </Stack>

      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        当前为模拟短信：验证码打印在 edge 日志（docker logs supabase_edge_runtime_2fa_safemodule_dev | grep
        '[OTP]'）。同一手机号 24h 内限 5 条。
      </Typography>
    </AuthShell>
  );
}