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
import { useAccount } from '../components/AccountLayout';
import RecoveryCodesPanel from '../components/RecoveryCodesPanel';
import { useI18n } from '../i18n/LocaleContext';
import {
  getEnrollment,
  getSession,
  handleError,
  startPasskeyRegistration,
  submitPasskeyRegistration,
  toast,
} from '../api/mfaClient';

/** 通行密钥管理页（图 2 风格）：返回箭头 + 说明 + 「创建通行密钥」药丸 + 凭据列表卡。 */
export default function EnrollPage() {
  const navigate = useNavigate();
  const { user } = useAccount();
  const { t } = useI18n();
  const [enrolled, setEnrolled] = React.useState(false);
  const [lastCredentialId, setLastCredentialId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [status, setStatus] = React.useState('');
  // 首绑服务端附带首批恢复码明文（仅此一次、仅存内存）：展示后即丢弃，重进/重登不再出现
  const [freshCodes, setFreshCodes] = React.useState<string[] | null>(null);

  // 会话守卫与头像档案由布局路由承担；本页只取绑定状态
  React.useEffect(() => {
    const session = getSession();
    if (!session?.access_token) return;
    void getEnrollment(session.access_token)
      .then(setEnrolled)
      .catch((e) => handleError(e));
  }, []);

  // 绑定仪式：register-options → 浏览器弹指纹 → register-verify → 入库 + enabled=true
  async function handleCreate() {
    const session = getSession();
    if (!session?.access_token) return;
    setBusy(true);
    setStatus(t('enroll.waitingFingerprint'));
    try {
      const { attestation } = await startPasskeyRegistration(session.access_token, 'enroll');
      setStatus(t('enroll.serverVerifying'));
      const { credentialId, recoveryCodes } = await submitPasskeyRegistration(session.access_token, attestation);
      // 成功（服务端已置 mfa_enrollments.enabled=true）
      setLastCredentialId(credentialId);
      setEnrolled(true);
      if (recoveryCodes?.length) setFreshCodes(recoveryCodes);
      setStatus('');
      toast(t('enroll.success'), 'success');
    } catch (e) {
      handleError(e); // 用户取消静默；CREDENTIAL_EXISTS/UV_REQUIRED 等按字典提示
      setStatus('');
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null; // 布局守卫加载中（秒级），不出半截内容

  return (
    <>
      {/* 内容头：返回 + 标题 */}
      <Stack direction="row" spacing={1.5} alignItems="center">
        <IconButton component="button" onClick={() => navigate('/security')} aria-label={t('enroll.backAria')}>
          <ArrowBackRoundedIcon />
        </IconButton>
        <Typography variant="h1">{t('enroll.title')}</Typography>
      </Stack>

      <Typography sx={{ color: 'text.secondary', maxWidth: 720 }}>
        {t('enroll.lead1')}
      </Typography>
      <Typography sx={{ color: 'text.secondary', maxWidth: 720 }}>
        {t('enroll.lead2')}
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
          {busy ? t('enroll.creating') : t('enroll.create')}
        </Button>
        {status && (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {status}
          </Typography>
        )}
      </Stack>

      {/* 首批恢复码（仅显示一次）：重绑不重复签发；明文仅存本次挂载内存，重进/重登不再出现 */}
      {freshCodes && (
        <RecoveryCodesPanel
          title={t('enroll.recoveryTitle')}
          codes={freshCodes}
          onSaved={() => setFreshCodes(null)}
        />
      )}

      {/* 凭据列表卡 */}
      <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 3 }}>
        <Typography variant="h2">{t('enroll.listTitle')}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          {t('enroll.listHint')}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2, mb: 1 }}>
          {t('enroll.yourDevices')}
        </Typography>

        {enrolled ? (
          <Stack spacing={2}>
            <Stack direction="row" spacing={2} alignItems="center">
              <FingerprintRoundedIcon sx={{ fontSize: 34, color: 'text.secondary' }} />
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography>{t('enroll.thisDevice')}{lastCredentialId ? t('enroll.newBinding') : ''}</Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  {lastCredentialId
                    ? t('enroll.createdLinked', { email: user.email?.toString() ?? '' })
                    : t('enroll.linkedAccount')}
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
                {t('enroll.addDevice')}
              </Button>
              <Button component="button" onClick={() => navigate('/security')} variant="text" sx={{ borderRadius: 999 }}>
                {t('enroll.backSecurity')}
              </Button>
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {t('enroll.multiTip')}
            </Typography>
          </Stack>
        ) : (
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            {t('enroll.noneYet')}
          </Typography>
        )}
      </Card>
    </>
  );
}
