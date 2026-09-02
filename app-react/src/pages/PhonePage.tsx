import * as React from 'react';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import SmsRoundedIcon from '@mui/icons-material/SmsRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import { useNavigate } from 'react-router-dom';
import AccountShell from '../components/AccountShell';
import PageLoader from '../components/PageLoader';
import {
  clearSession,
  fetchSessionUser,
  getSession,
  signOut,
  toast,
} from '../api/mfaClient';
import type { MfaUser } from '../api/mfaClient';

/** 手机号绑定信息页：说明注册时已一次性绑定（FR-2），不参与日常登录。 */
export default function PhonePage() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<MfaUser | null>(null);

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

  async function doLogout() {
    const session = getSession();
    try {
      if (session?.access_token) await signOut(session.access_token);
    } catch {
      /* 登出失败也照常清本地 */
    } finally {
      clearSession();
      toast('已退出登录', 'info');
      navigate('/login', { replace: true });
    }
  }

  if (!user) return <PageLoader />; // 守卫跳转中：统一加载占位，避免白屏闪现

  return (
    <AccountShell active="phone" user={user} onLogout={doLogout}>
      <Typography variant="h1">手机号绑定</Typography>

      <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 3 }}>
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <SmsRoundedIcon sx={{ fontSize: 36, color: 'success.main' }} />
          <Stack spacing={1}>
            <Typography variant="h2">注册时已完成一次性绑定</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              你的手机号在注册时经短信验证码完成绑定，仅用于账号恢复与备用验证，不参与日常登录，也不在页面显示完整号码。
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <CheckCircleRoundedIcon color="success" sx={{ fontSize: 18 }} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                已绑定 · 验证码 5 分钟内有效，每个手机号每天最多接收 5 条
              </Typography>
            </Stack>
          </Stack>
        </Stack>
      </Card>
    </AccountShell>
  );
}