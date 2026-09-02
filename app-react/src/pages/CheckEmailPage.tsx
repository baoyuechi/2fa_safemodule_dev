import * as React from 'react';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import AuthShell, { AuthActions } from '../components/AuthShell';
import EmailPill from '../components/EmailPill';
import { confirmEmailWithCode, getSession, handleError, resendEmail, saveSession, toast } from '../api/mfaClient';

interface CheckEmailState {
  email?: string;
}

/** 注册第二步：邮箱验证（GoTrue signup OTP——输入邮件里的 6 位验证码）。 */
export default function CheckEmailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // 邮箱优先取 location.state（RegisterPage 传递）；刷新后 state 丢失 → 回退 sessionStorage，
  // 避免用户被弹回注册页重填。
  const [email] = React.useState(
    () => (location.state as CheckEmailState | null)?.email?.trim().toLowerCase() ?? sessionStorage.getItem('mfa.pendingEmail') ?? '',
  );
  const [code, setCode] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const [sending, setSending] = React.useState(false);

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
      toast('验证邮件已重新发送', 'success');
    } catch (e) {
      handleError(e);
    } finally {
      setSending(false);
    }
  }

  // 邮箱验证：输入邮件中的 6 位验证码 → 换标准会话 → 手机号绑定
  async function handleVerify() {
    if (!/^\d{6}$/.test(code.trim())) return toast('请输入 6 位验证码', 'error');
    setBusy(true);
    try {
      saveSession(await confirmEmailWithCode(email, code.trim()));
      toast('邮箱验证成功', 'success');
      navigate('/register/phone', { replace: true });
    } catch (e) {
      handleError(e); // 码错误/过期 → 提示重新获取
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="验证您的邮箱"
      subtitle="创建账号需依次完成：邮箱验证 → 手机号绑定（一次性）→ 指纹绑定"
      leftExtra={email.trim() ? <EmailPill email={email} /> : undefined}
      transitionKey="check-email"
      actions={
        <AuthActions
          secondary={
            <Button variant="text" onClick={handleResend} disabled={sending}>
              {sending ? '发送中…' : '重新发送验证邮件'}
            </Button>
          }
          primary={
            <Button variant="contained" size="large" onClick={handleVerify} disabled={busy}>
              {busy ? '验证中…' : '验证'}
            </Button>
          }
        />
      }
    >
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        我们已向{' '}
        <Typography component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
          {email.trim() || '您的邮箱'}
        </Typography>{' '}
        发送了一封验证邮件，请把邮件中的 6 位验证码填在下方。
      </Typography>

      <TextField
        label="6 位验证码"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
        slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}
      />

      <Typography variant="caption" sx={{ color: 'text.secondary' }}>
        本地开发：验证邮件在本地邮箱面板查看 → http://127.0.0.1:54324（Mailpit）。若点击了邮件内的验证链接，页面会自动继续，无需再输码。
      </Typography>
      <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
        <Link component={RouterLink} to="/register" underline="hover">
          邮箱填写有误？返回上一步
        </Link>
      </Typography>
    </AuthShell>
  );
}