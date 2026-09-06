import * as React from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { toastIn } from '../shared-theme/motion';
import { useI18n } from '../i18n/LocaleContext';

export interface ToastDetail {
  message: string;
  type: 'info' | 'success' | 'error';
}

interface ToastItem extends ToastDetail {
  key: number;
}

const severityOf = (t: ToastDetail['type']) => (t === 'error' ? 'error' : t === 'success' ? 'success' : 'info');

/**
 * 监听 L1 SDK 派发的 `mfa:toast` 事件，用顶部堆叠消息列渲染统一消息条。
 * 连续消息各自成条上下排列（仿旧版堆叠），不再被后一条顶替；各自倒计时关闭。
 */
export default function ToastHost() {
  const { t } = useI18n();
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  const dismiss = React.useCallback((key: number) => {
    setToasts((prev) => prev.filter((t) => t.key !== key));
  }, []);

  // 每条独立的倒计时：到点即移除该条
  React.useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dismiss(t.key), 4000));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dismiss]);

  React.useEffect(() => {
    let key = 0;
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      key += 1;
      setToasts((prev) => [...prev, { ...detail, key }].slice(-5)); // 同屏最多 5 条，防溢出
    };
    window.addEventListener('mfa:toast', onToast);
    return () => window.removeEventListener('mfa:toast', onToast);
  }, []);

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1400,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        pointerEvents: 'none',
        width: { xs: 'calc(100% - 32px)', sm: 'auto' },
      }}
    >
      {toasts.map((item) => (
        <Alert
          key={item.key}
          severity={severityOf(item.type)}
          variant="filled"
          onClose={() => dismiss(item.key)}
          action={
            <IconButton size="small" aria-label={t('common.close')} onClick={() => dismiss(item.key)} sx={{ color: 'inherit' }}>
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          }
          sx={{ pointerEvents: 'auto', boxShadow: 3, ...toastIn }}
        >
          {item.message}
        </Alert>
      ))}
    </Box>
  );
}