import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

/** 账户页守卫期的统一加载占位：避免会话校验 / 跳转期间白屏闪现。 */
export default function PageLoader() {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
      <CircularProgress size={28} />
    </Box>
  );
}
