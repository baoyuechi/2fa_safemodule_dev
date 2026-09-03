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
  // 行内字段错误（InputError 红字），输入即清除
  const [emailError, setEmailError] = React.useState<string | null>(null);
  const [passwordError, setPasswordError] = React.useState<string | null>(null);
  const [confirmError, setConfirmError] = React.useState<string | null>(null);

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
    if (!EMAIL_RE.test(mail)) return setEmailError('请输入有效的学校邮箱地址');
    if (password.length < 6) return setPasswordError('密码至少需要 6 位');
    if (password !== password2) return setConfirmError('两次输入的密码不一致，请重新输入');
    setBusy(true);
    try {
      await checkEmailDomain({ email: mail });
      await signUp(mail, password);
      // 邮箱持久化：state 刷新即丢，写入 sessionStorage 供 CheckEmail 刷新后回退
      sessionStorage.setItem('mfa.pendingEmail', mail);
      toast('注册成功，验证邮件已发送', 'success');
      navigate('/register/check-email', { state: { email: mail }, replace: true });
    } catch (e) {
      const err = e as { code?: string; message?: string };
      if (err?.code === 'DOMAIN_NOT_ALLOWED' || err?.code === 'EMAIL_TAKEN') {
        setEmailError(err.message ?? '该邮箱无法使用');
        setBusy(false);
      } else {
        handleError(e);
        setBusy(false);
      }
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
        {/* Box 包裹：避免 InputError 成为 Stack 直接子元素而被 spacing 撑开间距 */}
        <Box>
          <TextField
            label="学校邮箱"
            type="email"
            required
            autoFocus
            placeholder="you@isawuhan.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
            }}
            slotProps={{ htmlInput: { autoComplete: 'email' } }}
            error={Boolean(emailError)}
          />
          {emailError ? (
            <InputError message={emailError} />
          ) : (
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', mt: 0.25 }}>
              仅支持学校邮箱（@isawuhan.com）
            </Typography>
          )}
        </Box>
        <Box>
          <TextField
            label="设置密码"
            type="password"
            required
            placeholder="至少 6 位"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setPasswordError(null);
            }}
            slotProps={{ htmlInput: { autoComplete: 'new-password', minLength: 6 } }}
            error={Boolean(passwordError)}
          />
          <InputError message={passwordError} />
        </Box>
        <Box>
          <TextField
            label="确认密码"
            type="password"
            required
            placeholder="再次输入密码"
            value={password2}
            onChange={(e) => {
              setPassword2(e.target.value);
              setConfirmError(null);
            }}
            slotProps={{ htmlInput: { autoComplete: 'new-password', minLength: 6 } }}
            error={Boolean(confirmError)}
          />
          <InputError message={confirmError} />
        </Box>
      </Stack>
    </AuthShell>
  );
}