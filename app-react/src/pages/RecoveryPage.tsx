import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import RecoveryCodesPanel from '../components/RecoveryCodesPanel';
import { useI18n } from '../i18n/LocaleContext';
import {
  getSession,
  handleError,
  recoveryStatus,
  regenerateRecoveryCodes,
} from '../api/mfaClient';

/** 恢复码管理页：余量展示 + 重新生成（二次确认）+ 新码仅显示一次。 */
export default function RecoveryPage() {
  const { t } = useI18n();
  const [status, setStatus] = React.useState<{ remaining: number; batch: number } | null>(null);
  const [freshCodes, setFreshCodes] = React.useState<string[] | null>(null);
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

  const refreshStatus = React.useCallback(async () => {
    const session = getSession();
    if (!session?.access_token) return;
    try {
      setStatus(await recoveryStatus(session.access_token));
    } catch (e) {
      handleError(e);
    }
  }, []);

  // 会话守卫与档案由布局路由承担：本页只取余量
  React.useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  // 重新生成：批次+1 · 旧批作废 · 明文仅此一次展示
  async function handleRegenerate() {
    const session = getSession();
    if (!session?.access_token) return;
    setBusy(true);
    try {
      const { recoveryCodes } = await regenerateRecoveryCodes(session.access_token);
      setFreshCodes(recoveryCodes);
      setConfirmOpen(false);
    } catch (e) {
      handleError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Typography variant="h1">{t('nav.recovery')}</Typography>
      <Typography sx={{ color: 'text.secondary', maxWidth: 720 }}>
        {t('recovery.lead')}
      </Typography>

      {freshCodes ? (
        <RecoveryCodesPanel
          title={t('nav.recovery')}
          codes={freshCodes}
          onSaved={() => {
            setFreshCodes(null); // 丢弃明文：服务端不再返回
            void refreshStatus();
          }}
        />
      ) : !status ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress size={28} />
        </Box>
      ) : status.batch === 0 ? (
        <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 3 }}>
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <KeyRoundedIcon sx={{ fontSize: 36, color: 'text.secondary' }} />
            <Stack spacing={1}>
              <Typography variant="h2">{t('recovery.emptyTitle')}</Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                {t('recovery.emptyDesc')}
              </Typography>
              <Button
                variant="contained"
                onClick={() => void handleRegenerate()}
                disabled={busy}
                sx={{ borderRadius: 999, alignSelf: 'flex-start', mt: 1 }}
              >
                {t('recovery.generate')}
              </Button>
            </Stack>
          </Stack>
        </Card>
      ) : (
        <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 3 }}>
          <Stack direction="row" spacing={2} alignItems="flex-start">
            <KeyRoundedIcon sx={{ fontSize: 36, color: 'text.secondary' }} />
            <Stack spacing={1}>
              <Typography variant="h2">{t('recovery.remaining', { n: status.remaining })}</Typography>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ pt: 1 }}>
                <Button
                  variant="outlined"
                  onClick={() => setConfirmOpen(true)}
                  disabled={busy}
                  sx={{ borderRadius: 999 }}
                >
                  {t('recovery.regenerate')}
                </Button>
              </Stack>
            </Stack>
          </Stack>
        </Card>
      )}

      {/* 重新生成二次确认：旧码作废不可逆 */}
      <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
        <DialogTitle>{t('recovery.confirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t('recovery.confirmDesc')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={() => void handleRegenerate()} disabled={busy}>
            {t('common.confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
