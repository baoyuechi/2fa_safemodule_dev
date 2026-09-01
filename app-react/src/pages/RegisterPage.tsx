import * as React from 'react';
import Accordion from '@mui/material/Accordion';
import AccordionDetails from '@mui/material/AccordionDetails';
import AccordionSummary from '@mui/material/AccordionSummary';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import AuthShell, { AuthActions } from '../components/AuthShell';
import EmailPill from '../components/EmailPill';
import { checkEmailDomain, handleError, saveSession, sendOtp, signUp, toast, verifyOtp } from '../api/mfaClient';

const PHONE_RE = /^1[3-9]\d{9}$/;

/** 注册页：宽版双栏卡 + Google 式「下一步」主操作；手机号绑定保留为预留折叠区。 */
export default function RegisterPage() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [password2, setPassword2] = React.useState('');
  const [busy, setBusy] = React.useState(false);

  // ---- 手机验证预留接口（端点 2/3 已通，端点 4 phone/bind 待接入）----
  const [phone, setPhone] = React.useState('');
  const [otpCode, setOtpCode] = React.useState('');
  const [countdown, setCountdown] = React.useState(0);
  const [verifying, setVerifying] = React.useState(false);

  React.useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown((n) => n - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  // 注册：域名预检（fail-closed）→ GoTrue 注册 → 自动会话 → 跳转绑定引导
  async function handleRegister() {
    const mail = email.trim().toLowerCase();
    if (password.length < 6) return toast('密码至少 6 位', 'error');
    if (password !== password2) return toast('两次输入的密码不一致', 'error');
    setBusy(true);
    try {
      await checkEmailDomain({ email: mail }); // DOMAIN_NOT_ALLOWED → 字典文案"请使用学校邮箱注册"
      saveSession(await signUp(mail, password));
      toast('注册成功，正在前往指纹绑定…', 'success');
      setTimeout(() => navigate('/enroll', { replace: true }), 600);
    } catch (e) {
      handleError(e);
      setBusy(false);
    }
  }

  async function handleSendOtp() {
    const normalized = phone.replace(/[\s-]/g, '');
    if (!PHONE_RE.test(normalized)) return toast('请输入正确的手机号', 'error');
    try {
      await sendOtp(normalized);
      toast('验证码已发送（模拟短信，见下方提示查看日志）', 'success');
      setCountdown(60);
    } catch (e) {
      handleError(e); // PHONE_TAKEN / RATE_LIMITED 字典文案
    }
  }

  async function handleVerifyOtp() {
    const normalized = phone.replace(/[\s-]/g, '');
    if (!/^\d{6}$/.test(otpCode.trim())) return toast('请输入 6 位验证码', 'error');
    setVerifying(true);
    try {
      await verifyOtp(normalized, otpCode.trim());
      toast('验证成功（绑定接口 phone/bind 待接入，一次性票据已预留）', 'success');
    } catch (e) {
      handleError(e); // OTP_EXPIRED（含码错误，防枚举统一文案）
    } finally {
      setVerifying(false);
    }
  }

  return (
    <AuthShell
      title="创建您的账号"
      subtitle="仅限学校邮箱；注册后将引导你完成指纹绑定（约 30 秒）"
      leftExtra={email.trim() ? <EmailPill email={email.trim().toLowerCase()} /> : undefined}
    >
      <Stack
        component="form"
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
          helperText="提交前会经服务端校验邮箱域名白名单（FR-1.2）"
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

        <AuthActions
          secondary={
            <Link component={RouterLink} to="/login" underline="hover">
              已有账号？直接登录
            </Link>
          }
          primary={
            <Button type="submit" variant="contained" size="large" disabled={busy}>
              {busy ? '注册中…' : '下一步'}
            </Button>
          }
        />
      </Stack>

      {/* 手机号绑定：预留接口（FR-2）。发送/验证走真实模拟端点，暂不阻塞注册流程；
           正式接入需端点 4 phone/bind（持 otpToken 完成绑定写库）。 */}
      <Accordion
        disableGutters
        elevation={0}
        sx={{
          border: '1px dashed',
          borderColor: 'divider',
          borderRadius: '12px !important',
          bgcolor: 'transparent',
          '&:before': { display: 'none' },
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreRoundedIcon />}>
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            手机号绑定（预留功能 · 选填，不影响注册）
          </Typography>
        </AccordionSummary>
        <AccordionDetails>
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
              />
              <Button
                variant="outlined"
                onClick={handleSendOtp}
                disabled={countdown > 0}
                sx={{ whiteSpace: 'nowrap', mt: 0.5 }}
              >
                {countdown > 0 ? `${countdown}s 后重发` : '发送验证码'}
              </Button>
            </Stack>
            <Stack direction="row" justifyContent="flex-end">
              <Button variant="outlined" onClick={handleVerifyOtp} disabled={verifying}>
                {verifying ? '验证中…' : '验证'}
              </Button>
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              当前为模拟短信：验证码打印在 edge 日志（docker logs supabase_edge_runtime_2fa_safemodule_dev | grep
              '[OTP]'）。同一手机号 24h 内限 5 条。
            </Typography>
          </Stack>
        </AccordionDetails>
      </Accordion>
    </AuthShell>
  );
}
