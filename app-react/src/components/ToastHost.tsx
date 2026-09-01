import * as React from 'react';
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';

export interface ToastDetail {
  message: string;
  type: 'info' | 'success' | 'error';
}

/** 监听 L1 SDK 派发的 `mfa:toast` 事件，用 MUI Snackbar 渲染统一消息条。 */
export default function ToastHost() {
  const [snack, setSnack] = React.useState<(ToastDetail & { key: number }) | null>(null);

  React.useEffect(() => {
    let key = 0;
    const onToast = (e: Event) => {
      const detail = (e as CustomEvent<ToastDetail>).detail;
      key += 1;
      setSnack({ ...detail, key });
    };
    window.addEventListener('mfa:toast', onToast);
    return () => window.removeEventListener('mfa:toast', onToast);
  }, []);

  const severity = snack?.type === 'error' ? 'error' : snack?.type === 'success' ? 'success' : 'info';

  return (
    <Snackbar
      key={snack?.key}
      open={Boolean(snack)}
      autoHideDuration={4000}
      onClose={() => setSnack(null)}
      anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
    >
      <Alert severity={severity} variant="filled" onClose={() => setSnack(null)} sx={{ width: '100%' }}>
        {snack?.message}
      </Alert>
    </Snackbar>
  );
}
