import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import LinearProgress from '@mui/material/LinearProgress';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import FingerprintRoundedIcon from '@mui/icons-material/FingerprintRounded';
import { useEffect } from 'react';
import { Link as RouterLink, useNavigate } from 'react-router-dom';
import AuthShell from '../components/AuthShell';
import EmailPill from '../components/EmailPill';
import PageLoader from '../components/PageLoader';
import { useI18n } from '../i18n/LocaleContext';
import { clearSession, fetchSessionUser, getSession } from '../api/mfaClient';
import type { MfaUser } from '../api/mfaClient';

const AUTO_REDIRECT_SECONDS = 15;

/** 注册完成成功页：邮箱验证 + 手机绑定均已完成，引导通行密钥（可选），15 秒后自动返回登录。 */
export default function VerificationSuccessPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [user, setUser] = React.useState<MfaUser | null>(null);
  const [countdown, setCountdown] = React.useState(AUTO_REDIRECT_SECONDS);

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
      } catch {
        clearSession();
        navigate('/login', { replace: true });
      }
    })();
  }, [navigate]);

  // 15 秒倒计时自动返回登录页
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => setCountdown((n) => n - 1), 1000);
    return () => clearInterval(timer);
  }, [user]);

  useEffect(() => {
    if (user && countdown <= 0) navigate('/login', { replace: true });
  }, [user, countdown, navigate]);

  if (!user) return <PageLoader />; // 守卫跳转中：统一加载占位

  return (
    <AuthShell
      title={t('verified.done')}
      subtitle={t('verified.subtitle')}
      leftExtra={user.email ? <EmailPill email={user.email} /> : undefined}
      transitionKey="verified"
    >
      <Stack spacing={2} alignItems="center" sx={{ py: 1 }}>
        <CheckCircleRoundedIcon color="success" sx={{ fontSize: 64 }} />
        <Typography sx={{ color: 'text.secondary', textAlign: 'center' }}>
          {t('verified.accountReady')}
        </Typography>
      </Stack>

      {/* 通行密钥引导（可选） */}
      <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 2.5 }}>
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <FingerprintRoundedIcon sx={{ fontSize: 32, color: 'success.main' }} />
          <Box sx={{ flex: 1 }}>
            <Typography>{t('verified.passkeyTitle')}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {t('verified.passkeyDesc')}
            </Typography>
          </Box>
        </Stack>
        <Button
          component={RouterLink}
          to="/enroll"
          variant="outlined"
          size="small"
          startIcon={<FingerprintRoundedIcon />}
          sx={{ mt: 1.5, borderRadius: 999 }}
        >
          {t('verified.passkeyCta')}
        </Button>
      </Card>

      {/* 返回登录 + 15 秒倒计时 */}
      <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
        <Button component={RouterLink} to="/login" variant="contained" size="large" fullWidth>
          {t('verified.backLogin')}
        </Button>
        <Box sx={{ width: '100%' }}>
          <LinearProgress
            variant="determinate"
            value={((AUTO_REDIRECT_SECONDS - countdown) / AUTO_REDIRECT_SECONDS) * 100}
            sx={{ height: 4, borderRadius: 2 }}
          />
          <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', color: 'text.secondary', mt: 0.5 }}>
            {t('verified.autoRedirect', { countdown })}
          </Typography>
        </Box>
      </Stack>
    </AuthShell>
  );
}
