import * as React from 'react';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import AuthShell, { AuthActions } from '../components/AuthShell';
import EmailPill from '../components/EmailPill';
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

/** 注册第一步：邮箱 + 密码。成功 → 即刻进入邮箱验证（第二步见 CheckEmailPage）。 */
export default function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [password2, setPassword2] = React.useState('');
  const [busy, setBusy] = React.useState(false);

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
  // 邮箱验证通过后才有会话 → 手机号绑定 → 指纹绑定
  async function handleRegister() {
    const mail = email.trim().toLowerCase();
    if (!EMAIL_RE.test(mail)) return toast('请输入有效的邮箱地址', 'error');
    if (password.length < 6) return toast('密码至少 6 位', 'error');
    if (password !== password2) return toast('两次输入的密码不一致', 'error');
    setBusy(true);
    try {
      await checkEmailDomain({ email: mail }); // DOMAIN_NOT_ALLOWED → 字典文案"请使用学校邮箱注册"
      await signUp(mail, password);
      // 邮箱持久化：state 刷新即丢，写入 sessionStorage 供 CheckEmail 刷新后回退
      sessionStorage.setItem('mfa.pendingEmail', mail);
      toast('注册成功，验证邮件已发送', 'success');
      navigate('/register/check-email', { state: { email: mail }, replace: true });
    } catch (e) {
      handleError(e);
      setBusy(false);
    }
  }

  return (
    <AuthShell
      title="创建您的账号"
      subtitle="仅限学校邮箱。注册后将依次完成邮箱验证、手机号绑定与指纹绑定（约 1 分钟）。"
      leftExtra={email.trim() ? <EmailPill email={email.trim().toLowerCase()} /> : undefined}
      transitionKey="register"
      actions={
        <AuthActions
          secondary={
            <Link component={RouterLink} to="/login" underline="hover">
              已有账号？直接登录
            </Link>
          }
          primary={
            <Button type="submit" form="register-form" variant="contained" size="large" disabled={busy}>
              {busy ? '注册中…' : '下一步'}
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
        <TextField
          label="学校邮箱"
          type="email"
          required
          autoFocus
          placeholder="you@isawuhan.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          slotProps={{ htmlInput: { autoComplete: 'email' } }}
          helperText="仅支持学校邮箱（@isawuhan.com）"
        />
        <TextField
          label="设置密码"
          type="password"
          required
          placeholder="至少 6 位"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          slotProps={{ htmlInput: { autoComplete: 'new-password', minLength: 6 } }}
        />
        <TextField
          label="确认密码"
          type="password"
          required
          placeholder="再次输入密码"
          value={password2}
          onChange={(e) => setPassword2(e.target.value)}
          slotProps={{ htmlInput: { autoComplete: 'new-password', minLength: 6 } }}
        />
      </Stack>
    </AuthShell>
  );
}