import * as React from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import ListItemButton from '@mui/material/ListItemButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import SmsRoundedIcon from '@mui/icons-material/SmsRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CableRoundedIcon from '@mui/icons-material/CableRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { Link as RouterLink } from 'react-router-dom';
import { useI18n } from '../i18n/LocaleContext';
import { getAccountSecurityStatus, getSession, handleError } from '../api/mfaClient';

/** 手机号绑定信息页：说明注册时已一次性绑定（FR-2）；尾部提供「更换手机号」入口。 */
export default function PhonePage() {
  const { t } = useI18n();
  const [loading, setLoading] = React.useState(true);
  const [phoneLast4, setPhoneLast4] = React.useState<string | null>(null);

  React.useEffect(() => {
    const session = getSession();
    if (!session?.access_token) return;
    void getAccountSecurityStatus(session.access_token)
      .then((status) => setPhoneLast4(status.phoneLast4))
      .catch((e) => handleError(e))
      .finally(() => setLoading(false));
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
      <Typography variant="h1">{t('phone.title')}</Typography>

      <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 3 }}>
        <Stack direction="row" spacing={2} alignItems="flex-start">
          <SmsRoundedIcon sx={{ fontSize: 36, color: 'success.main' }} />
          <Stack spacing={1}>
            <Typography variant="h2">{t('phone.boundTitle')}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {t('phone.boundDesc')}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center">
              <CheckCircleRoundedIcon color="success" sx={{ fontSize: 18 }} />
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('phone.linked')}
              </Typography>
            </Stack>
          </Stack>
        </Stack>
      </Card>

      <Card variant="outlined">
        <ListItemButton component={RouterLink} to="/security/phone/rebind" sx={{ py: 2, px: { xs: 2.5, sm: 4 }, borderRadius: 0 }}>
          <CableRoundedIcon sx={{ mr: 2.5, color: 'text.secondary' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography>{t('phoneRebind.title')}</Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {phoneLast4 ? `${t('phoneRebind.oldNote')} · · · · · ·${phoneLast4}` : t('phoneRebind.newNote')}
            </Typography>
          </Box>
          <Chip label={t('security.passwordManage')} size="small" variant="outlined" sx={{ mr: 1 }} />
          <ChevronRightRoundedIcon sx={{ color: 'text.secondary' }} />
        </ListItemButton>
      </Card>
    </>
  );
}