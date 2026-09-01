import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import ListItemButton from '@mui/material/ListItemButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import FingerprintRoundedIcon from '@mui/icons-material/FingerprintRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import MailRoundedIcon from '@mui/icons-material/MailRounded';
import SmsRoundedIcon from '@mui/icons-material/SmsRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import AccountShell from '../components/AccountShell';
import {
  clearSession,
  fetchSessionUser,
  getEnrollment,
  getSession,
  signOut,
  toast,
} from '../api/mfaClient';
import type { MfaUser } from '../api/mfaClient';

/** 图 1 风格的「安全性与登录」账户页：登录选项分组卡 + 状态 Chip + 彩色圆标侧边栏。 */
export default function SecurityPage() {
  const navigate = useNavigate();
  const [user, setUser] = React.useState<MfaUser | null>(null);
  const [enrolled, setEnrolled] = React.useState(false);
  const [busyLogout, setBusyLogout] = React.useState(false);

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
    setBusyLogout(true);
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

  if (!user) return null; // 守卫跳转中

  return (
    <AccountShell active="security" user={user} onLogout={doLogout}>
      <Typography variant="h1">安全性与登录</Typography>

      {/* 安全状态卡 */}
      <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 3 }}>
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <VerifiedUserRoundedIcon sx={{ fontSize: 36, color: enrolled ? 'success.main' : 'text.secondary' }} />
          <Box>
            <Typography variant="h2">{enrolled ? '让您的账号安全无虞' : '完成一步，让您的账号安全无虞'}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {enrolled
                ? '通行密钥已绑定，发言门槛对你已解除。建议再绑定一台设备，防止单设备丢失。'
                : '绑定通行密钥（约 30 秒）后即可参与发言；未绑定账号只能浏览（FR-8 门槛）。'}
            </Typography>
            {!enrolled && (
              <Button component={RouterLink} to="/enroll" variant="contained" size="small" sx={{ mt: 1.5, borderRadius: 999 }}>
                去绑定通行密钥
              </Button>
            )}
          </Box>
        </Stack>
      </Card>

      {/* 登录选项 */}
      <Box>
        <Typography variant="h2">登录选项</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          请务必及时更新这些信息，确保始终都能访问自己的账号
        </Typography>
      </Box>
      <Card variant="outlined" sx={{ py: 0.5 }}>
        <ListItemButton
          component={RouterLink}
          to="/enroll"
          sx={{ py: 2, px: { xs: 2.5, sm: 4 }, borderRadius: 0 }}
        >
          <FingerprintRoundedIcon sx={{ mr: 2.5, color: 'text.secondary' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography>通行密钥</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {enrolled ? '已绑定，可用于免密码直登（Touch ID / Windows Hello）' : '尚未绑定。完成后即可参与发言（FR-8）'}
            </Typography>
          </Box>
          <Chip
            label={enrolled ? '已启用' : '未绑定'}
            color={enrolled ? 'success' : 'warning'}
            size="small"
            variant={enrolled ? 'filled' : 'outlined'}
            sx={{ mr: 1 }}
          />
          <ChevronRightRoundedIcon sx={{ color: 'text.secondary' }} />
        </ListItemButton>
        <Divider component="li" />
        <ListItemButton sx={{ py: 2, px: { xs: 2.5, sm: 4 }, borderRadius: 0, cursor: 'default' }}>
          <LockRoundedIcon sx={{ mr: 2.5, color: 'text.secondary' }} />
          <Box sx={{ flex: 1 }}>
            <Typography>邮箱密码</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              用于无指纹设备的兜底登录（第一因子，AAL1）
            </Typography>
          </Box>
          <Chip label="已设置" size="small" variant="outlined" sx={{ mr: 1 }} />
        </ListItemButton>
        <Divider component="li" />
        <ListItemButton sx={{ py: 2, px: { xs: 2.5, sm: 4 }, borderRadius: 0 }}>
          <SmsRoundedIcon sx={{ mr: 2.5, color: 'text.disabled' }} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ color: 'text.disabled' }}>用于两步验证的手机号</Typography>
            <Typography variant="body2" sx={{ color: 'text.disabled' }}>
              预留功能：待端点 phone/bind 接入后开放
            </Typography>
          </Box>
          <Chip label="预留" size="small" variant="outlined" sx={{ mr: 1, color: 'text.disabled' }} />
        </ListItemButton>
      </Card>

      {/* 您的账号 */}
      <Box>
        <Typography variant="h2">您的账号</Typography>
      </Box>
      <Card variant="outlined" sx={{ py: 0.5 }}>
        <ListItemButton sx={{ py: 2, px: { xs: 2.5, sm: 4 }, borderRadius: 0, cursor: 'default' }}>
          <MailRoundedIcon sx={{ mr: 2.5, color: 'text.secondary' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography>学校邮箱</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
              {user.email}
            </Typography>
          </Box>
        </ListItemButton>
        <Divider component="li" />
        <ListItemButton onClick={doLogout} disabled={busyLogout} sx={{ py: 2, px: { xs: 2.5, sm: 4 }, borderRadius: 0 }}>
          <Box sx={{ flex: 1 }}>
            <Typography>退出登录</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              清除本机会话并返回登录页
            </Typography>
          </Box>
        </ListItemButton>
      </Card>
    </AccountShell>
  );
}
