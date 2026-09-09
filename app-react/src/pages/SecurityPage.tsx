import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import ListItemButton from '@mui/material/ListItemButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import FingerprintRoundedIcon from '@mui/icons-material/FingerprintRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import MailRoundedIcon from '@mui/icons-material/MailRounded';
import SmsRoundedIcon from '@mui/icons-material/SmsRounded';
import AlternateEmailRoundedIcon from '@mui/icons-material/AlternateEmailRounded';
import VerifiedUserRoundedIcon from '@mui/icons-material/VerifiedUserRounded';
import { Link as RouterLink } from 'react-router-dom';
import { useAccount } from '../components/AccountLayout';
import { useI18n } from '../i18n/LocaleContext';
import { getAccountSecurityStatus, getEnrollment, getSession, handleError } from '../api/mfaClient';

/** 图 1 风格的「安全性与登录」账户页：登录选项分组卡 + 状态 Chip；内容仅本页数据，壳由布局路由常驻。 */
export default function SecurityPage() {
  const { user, logout } = useAccount();
  const { t } = useI18n();
  const [loading, setLoading] = React.useState(true);
  const [enrolled, setEnrolled] = React.useState(false);
  const [hasPhone, setHasPhone] = React.useState(false);
  const [hasSecondaryEmail, setHasSecondaryEmail] = React.useState(false);

  React.useEffect(() => {
    void (async () => {
      const session = getSession();
      try {
        if (session?.access_token) {
          setEnrolled(await getEnrollment(session.access_token));
          const status = await getAccountSecurityStatus(session.access_token);
          setHasPhone(status.hasPhone);
          setHasSecondaryEmail(status.hasSecondaryEmail);
        }
      } catch (e) {
        handleError(e);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
        <CircularProgress size={28} />
      </Box>
    );
  }

  return (
    <>
      <Typography variant="h1">{t('nav.security')}</Typography>

      {/* 安全状态卡 */}
      <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 3 }}>
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <VerifiedUserRoundedIcon sx={{ fontSize: 36, color: enrolled ? 'success.main' : 'text.secondary' }} />
          <Box>
            <Typography variant="h2">{enrolled ? t('security.protected') : t('security.protectOneStep')}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
              {enrolled ? t('security.enrolledDesc') : t('security.notEnrolledDesc')}
            </Typography>
            {!enrolled && (
              <Button component={RouterLink} to="/enroll" variant="contained" size="small" sx={{ mt: 1.5, borderRadius: 999 }}>
                {t('security.setupPasskey')}
              </Button>
            )}
          </Box>
        </Stack>
      </Card>

      {/* 登录选项 */}
      <Box>
        <Typography variant="h2">{t('security.signInOptions')}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          {t('security.keepUpdated')}
        </Typography>
      </Box>
      <Card variant="outlined">
        <ListItemButton
          component={RouterLink}
          to="/enroll"
          sx={{ py: 2, px: { xs: 2.5, sm: 4 }, borderRadius: 0 }}
        >
          <FingerprintRoundedIcon sx={{ mr: 2.5, color: 'text.secondary' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography>{t('security.passkeyName')}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {enrolled ? t('security.passkeyLinked') : t('security.passkeyNotLinked')}
            </Typography>
          </Box>
          <Chip
            label={enrolled ? t('security.enabled') : t('security.notLinked')}
            color={enrolled ? 'success' : 'warning'}
            size="small"
            variant={enrolled ? 'filled' : 'outlined'}
            sx={{ mr: 1 }}
          />
          <ChevronRightRoundedIcon sx={{ color: 'text.secondary' }} />
        </ListItemButton>
        <Divider />
        <ListItemButton component={RouterLink} to="/security/password" sx={{ py: 2, px: { xs: 2.5, sm: 4 }, borderRadius: 0 }}>
          <LockRoundedIcon sx={{ mr: 2.5, color: 'text.secondary' }} />
          <Box sx={{ flex: 1 }}>
            <Typography>{t('security.passwordName')}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('security.passwordDesc')}
            </Typography>
          </Box>
          <Chip label={t('security.passwordSet')} size="small" variant="outlined" sx={{ mr: 1 }} />
          <ChevronRightRoundedIcon sx={{ color: 'text.secondary' }} />
        </ListItemButton>
        <Divider />
        <ListItemButton
          component={RouterLink}
          to="/security/phone/rebind"
          sx={{ py: 2, px: { xs: 2.5, sm: 4 }, borderRadius: 0 }}
        >
          <SmsRoundedIcon sx={{ mr: 2.5, color: 'success.main' }} />
          <Box sx={{ flex: 1 }}>
            <Typography>{t('security.phoneName')}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('security.phoneDesc')}
            </Typography>
          </Box>
          <Chip
            label={hasPhone ? t('security.phoneLinked') : t('security.phoneNotLinked')}
            size="small"
            variant="outlined"
            sx={{ mr: 1 }}
          />
          <ChevronRightRoundedIcon sx={{ color: 'text.secondary' }} />
        </ListItemButton>
        <Divider />
        <ListItemButton
          component={RouterLink}
          to="/security/email"
          sx={{ py: 2, px: { xs: 2.5, sm: 4 }, borderRadius: 0 }}
        >
          <AlternateEmailRoundedIcon sx={{ mr: 2.5, color: 'text.secondary' }} />
          <Box sx={{ flex: 1 }}>
            <Typography>{t('security.secondaryEmailName')}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('security.secondaryEmailDesc')}
            </Typography>
          </Box>
          <Chip
            label={hasSecondaryEmail ? t('security.secondaryEmailSet') : t('security.secondaryEmailNone')}
            size="small"
            color={hasSecondaryEmail ? 'success' : 'warning'}
            variant={hasSecondaryEmail ? 'filled' : 'outlined'}
            sx={{ mr: 1 }}
          />
          <ChevronRightRoundedIcon sx={{ color: 'text.secondary' }} />
        </ListItemButton>
      </Card>

      {/* 您的账号 */}
      <Box>
        <Typography variant="h2">{t('security.yourAccount')}</Typography>
      </Box>
      <Card variant="outlined">
        <ListItemButton sx={{ py: 2, px: { xs: 2.5, sm: 4 }, borderRadius: 0, cursor: 'default' }}>
          <MailRoundedIcon sx={{ mr: 2.5, color: 'text.secondary' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography>{t('security.schoolEmail')}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', overflowWrap: 'anywhere' }}>
              {user.email}
            </Typography>
          </Box>
        </ListItemButton>
        <Divider />
        <ListItemButton onClick={logout} sx={{ py: 2, px: { xs: 2.5, sm: 4 }, borderRadius: 0 }}>
          <Box sx={{ flex: 1 }}>
            <Typography>{t('auth.signOut')}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('security.signOutDesc')}
            </Typography>
          </Box>
        </ListItemButton>
      </Card>
    </>
  );
}
