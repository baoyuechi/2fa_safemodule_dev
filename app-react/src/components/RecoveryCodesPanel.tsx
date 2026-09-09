// ============================================================================
// RecoveryCodesPanel.tsx —— 恢复码"仅显示一次"面板（Google 备用码同款）
//
// 服务端签发/换批后明文只返回这一次：警告条 + 等宽码表 + 一键复制/下载 +
// "我已保存"确认。调用方在 onSaved 后丢弃明文（不再向服务端索取明文）。
// ============================================================================
import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useI18n } from '../i18n/LocaleContext';
import { toast } from '../api/mfaClient';

interface RecoveryCodesPanelProps {
  title: React.ReactNode;
  codes: string[];
  /** 用户确认已保存：调用方关闭面板并丢弃明文 */
  onSaved: () => void;
}

export default function RecoveryCodesPanel({ title, codes, onSaved }: RecoveryCodesPanelProps) {
  const { t } = useI18n();

  async function copyAll() {
    const text = codes.join('\n');
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 剪贴板不可用（非安全上下文等）时降级为选取复制
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    toast(t('recovery.copied'), 'success');
  }

  function download() {
    const blob = new Blob(
      [`isaSpectrum recovery codes\n${new Date().toISOString()}\n\n${codes.join('\n')}\n`],
      { type: 'text/plain;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'isaspectrum-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card variant="outlined" sx={{ px: { xs: 2.5, sm: 4 }, py: 3 }}>
      <Typography variant="h2">{title}</Typography>
      <Alert severity="warning" sx={{ mt: 1.5 }}>
        {t('recovery.showOnce')}
      </Alert>
      <Box
        sx={{
          mt: 2,
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
          gap: 1,
        }}
      >
        {codes.map((code) => (
          <Box
            key={code}
            sx={{
              px: 2,
              py: 1.25,
              borderRadius: 2,
              bgcolor: 'action.hover',
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: '1.05rem',
              letterSpacing: '0.08em',
              textAlign: 'center',
              userSelect: 'all',
            }}
          >
            {code}
          </Box>
        ))}
      </Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mt: 2.5 }}>
        <Button variant="outlined" onClick={copyAll} sx={{ borderRadius: 999 }}>
          {t('recovery.copyAll')}
        </Button>
        <Button variant="outlined" onClick={download} sx={{ borderRadius: 999 }}>
          {t('recovery.download')}
        </Button>
        <Button variant="contained" onClick={onSaved} sx={{ borderRadius: 999 }}>
          {t('recovery.savedOk')}
        </Button>
      </Stack>
    </Card>
  );
}
