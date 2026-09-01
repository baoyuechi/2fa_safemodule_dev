import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import FingerprintRoundedIcon from '@mui/icons-material/FingerprintRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import { useNavigate } from 'react-router-dom';
import AccountShell from '../components/AccountShell';
import PageLoader from '../components/PageLoader';
import {
  clearSession,
  fetchSessionUser,
  getEnrollment,
  getSession,
  handleError,
  signOut,
  startPasskeyRegistration,
  submitPasskeyRegistration,
  toast,
} from '../api/mfaClient';
import type { MfaUser } from '../api/mfaClient';

/** 通行密钥管理页（图 2 风格）：返回箭头 + 说明 + 「创建通行密钥」药丸 + 凭据列表卡。 */
export default function EnrollPage() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<MfaUser | null>(null);
  const [enrolled, setEnrolled] = React.useState(false);
  const [lastCredentialId, setLastCredentialId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');

  // 会话守卫：未登录 / 会话失效 → 回登录页
  React.useEffect(() => {
    void (async () => {
      const session = getSession();
      if (!session?.access_token) {
        navigate('/login', { replace: true });
        return;
      }
      try {
        setUser(await fetchSessionUser(session.access_token));
        setEnrolled(await getEnrollment(session.access_token));
      } catch {
        clearSession();
        navigate('/login', { replace: true });
      }
    })();
  }, [navigate]);

  async function doLogout() {
    const session = getSession();
    try {
      if (session?.access_token) await signOut(session.access_token);
    } catch {
      /* 照常清本地 */
    } finally {
      clearSession();
      navigate('/login', { replace: true });
    }
  }

  // 绑定仪式：register-options → 浏览器弹指纹 → register-verify → 入库 + enabled=true
  async function handleCreate() {
    const session = getSession();
    if (!session?.access_token) return;
    setBusy(true);
    setStatus('等待指纹验证…（若浏览器无响应请确认 Touch ID 已录入）');
    try {
      const { attestation } = await startPasskeyRegistration(session.access_token, 'enroll');
      setStatus('指纹采集完成，服务端验证中…');
      const { credentialId } = await submitPasskeyRegistration(session.access_token, attestation);
      // 成功（服务端已置 mfa_enrollments.enabled=true）
      setLastCredentialId(credentialId);
      setEnrolled(true);
      setStatus('');
      toast('绑定成功', 'success');
    } catch (e) {
      handleError(e); // 用户取消静默；CREDENTIAL_EXISTS/UV_REQUIRED 等按字典提示
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  if (!user) return <PageLoader />; // 守卫跳转中：统一加载占位，避免白屏闪现

  return (
    <AccountShell active="passkeys" user={user} onLogout={doLogout}>
      {/* 内容头：返回 + 标题 */}
      <Stack direction="row" spacing={1.5} alignItems="center">
        <IconButton component="button" onClick={() => navigate('/security')} aria-label="返回安全中心">
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h1">通行密钥和安全密钥</Typography>
      </Stack>

      <Typography sx={{ color: 'text.secondary', maxWidth: 720 }}>
        借助通行密钥，你仅凭指纹、面孔、屏幕解锁方式即可安全登录
        isaSpectrum。通行密钥还可以作为你使用密码登录时的第二重保障。请务必确保你的屏幕解锁方式不外泄，仅供你本人使用。
      </Typography>
      <Typography sx={{ color: 'text.secondary', maxWidth: 720 }}>
        你可以在你的设备上创建通行密钥。
      </Typography>

      {/* 创建入口 */}
      <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
        <Button
          variant="outlined"
          startIcon={<AddRoundedIcon />}
          onClick={handleCreate}
          disabled={busy}
          sx={{ borderRadius: 999, px: 2.5 }}
        >
          {busy ? '进行中…' : '创建通行密钥'}
        </Button>
        {status && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {status}
          </Typography>
        )}
      </Stack>

      {/* 凭据列表卡 */}
      <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 3 }}>
        <Typography variant="h2">通行密钥</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          你可以在设备上创建通行密钥，用 Touch ID / Windows Hello 一触即达。
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2, mb: 1 }}>
          您的设备
        </Typography>

        {enrolled ? (
          <Stack spacing={2}>
            <Stack direction="row" spacing={2} alignItems="center">
              <FingerprintRoundedIcon sx={{ fontSize: 34, color: 'text.secondary' }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography>本设备{lastCredentialId ? '（新绑定）' : ''}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {lastCredentialId
                    ? `由本设备创建，已与 ${user.email} 关联`
                    : '已与你的账号关联，可用于免密码直登'}
                </Typography>
                {lastCredentialId && (
                  <Typography
                    variant="caption"
                    title={lastCredentialId}
                    sx={{
                      display: 'block',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      color: 'text.secondary',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    credential ID: {lastCredentialId}
                  </Typography>
                )}
              </Box>
              <CheckCircleRoundedIcon color="success" />
            </Stack>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
              {/* 再绑一台设备：服务端 excludeCredentials 会排除已绑认证器（FR-6.2 多凭据） */}
              <Button variant="outlined" onClick={handleCreate} disabled={busy} sx={{ borderRadius: 999 }}>
                再绑一台设备
              </Button>
              <Button component="button" onClick={() => navigate('/security')} variant="text" sx={{ borderRadius: 999 }}>
                返回安全中心
              </Button>
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              建议至少绑定两台设备（FR-6.2）：单设备凭据不抗设备丢失。同一台设备重复绑定会被自动拒绝。
            </Typography>
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            尚未创建通行密钥。点击上方「创建通行密钥」完成绑定（约 30 秒），即可参与发言（FR-8 门槛解除）。
          </Typography>
        )}
      </Card>
    </AccountShell>
  );
}
