import { createTheme } from '@mui/material/styles';

// 品牌色沿用旧版 app/css/style.css：主色深藏青 #1a3c6e，通行密钥按钮绿 #1e8449。
// 暗色参考 Google 深色基调（#131314 页面 / #1e1f20 卡片），primary 提亮保证对比度。
const BRAND = '#1a3c6e';
const FIDO_GREEN = '#1e8449';

const theme = createTheme({
  cssVariables: { colorSchemeSelector: 'class' },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: BRAND, contrastText: '#ffffff' },
        success: { main: FIDO_GREEN, contrastText: '#ffffff' },
        // Google 账号页浅蓝灰底 + 白卡片
        background: { default: '#f0f4f9', paper: '#ffffff' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#9ec3f5', contrastText: '#0d2137' },
        success: { main: '#6dd58c', contrastText: '#062b12' },
        background: { default: '#131314', paper: '#1e1f20' },
      },
    },
  },
  shape: { borderRadius: 12 },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    h1: { fontSize: '1.6rem', fontWeight: 500, lineHeight: 1.3 },
    h2: { fontSize: '1.25rem', fontWeight: 500 },
    button: { textTransform: 'none' },
  },
  components: {
    // Google 账号页风格：药丸按钮 + 大圆角输入框 + 描边大圆角卡片（无重投影）
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { borderRadius: 999, paddingInline: 24, fontWeight: 500 },
        sizeLarge: { paddingBlock: 10 },
      },
    },
    MuiOutlinedInput: {
      // Google 式描边输入框：小圆角 + 缺口标签（notched outline）
      styleOverrides: { root: { borderRadius: 8 } },
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 28, boxShadow: 'none', backgroundImage: 'none' },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined', fullWidth: true },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: 999 } },
    },
    MuiAlert: {
      styleOverrides: { root: { borderRadius: 999 } },
    },
  },
});

export default theme;
