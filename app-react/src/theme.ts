import { createTheme } from '@mui/material/styles';

// 品牌色沿用旧版 app/css/style.css：主色深藏青 #1a3c6e，通行密钥按钮绿 #1e8449。
// 暗色参考 Google 深色基调（#131314 页面 / #1e1f20 卡片），primary 提亮保证对比度。
const BRAND = '#1a3c6e';
const FIDO_GREEN = '#1e8449';

// 圆角三档：卡片 28，控件 12，药丸 999
const RADIUS_CARD = 28;
const RADIUS_CONTROL = 12;
const RADIUS_PILL = 999;

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
  shape: { borderRadius: RADIUS_CONTROL },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    h1: { fontSize: '1.6rem', fontWeight: 500, lineHeight: 1.3 },
    h2: { fontSize: '1.25rem', fontWeight: 500 },
    button: { textTransform: 'none' },
  },
  components: {
    // Google 账号页风格：药丸按钮 + 描边输入框 + 大圆角卡片；卡片带轻量层叠阴影
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          borderRadius: RADIUS_PILL,
          paddingInline: 24,
          fontWeight: 500,
          transition:
            'background-color .2s ease, border-color .2s ease, color .2s ease, box-shadow .25s ease, transform .2s ease',
          '&:active': { transform: 'translateY(0) scale(0.98)' },
        },
        sizeLarge: { paddingBlock: 10 },
        // 主操作：悬浮轻抬 + 投影加深（质感层），按下回落
        contained: {
          '&:hover': {
            transform: 'translateY(-1px)',
            boxShadow: '0 2px 4px rgba(26,60,110,.16), 0 8px 20px rgba(26,60,110,.20)',
          },
        },
        outlined: {
          '&:hover': { transform: 'translateY(-1px)', boxShadow: '0 2px 8px rgba(60,64,67,.12)' },
        },
      },
    },
    MuiOutlinedInput: {
      // Google 式描边输入框：小圆角 + 缺口标签（notched outline）+ 聚焦柔光
      styleOverrides: {
        root: {
          borderRadius: 8,
          transition: 'box-shadow .2s ease',
          '&.Mui-focused': { boxShadow: '0 1px 6px rgba(26,60,110,.18)' },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: RADIUS_CARD,
          backgroundImage: 'none',
          overflow: 'hidden',
          // 两层柔和阴影：贴地 1px 锐影 + 大范围慢衰减，形成悬浮层级（暗色下同样成立）
          boxShadow: '0 1px 2px rgba(60,64,67,.12), 0 6px 24px rgba(60,64,67,.10)',
        },
      },
    },
    MuiTextField: {
      defaultProps: { variant: 'outlined', fullWidth: true },
    },
    MuiChip: {
      styleOverrides: { root: { borderRadius: RADIUS_PILL } },
    },
    MuiAlert: {
      // Google 顶部提示条风格：横幅式，圆角适中（非药丸）
      styleOverrides: { root: { borderRadius: 12 } },
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          border: '1px solid',
          borderColor: 'divider',
          '&:before': { display: 'none' },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 0,
          '&:hover': {
            backgroundColor: theme.vars.palette.action.hover,
          },
        }),
      },
    },
  },
});

export default theme;
