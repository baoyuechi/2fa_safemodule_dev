import { createTheme } from '@mui/material/styles';

// 品牌色沿用旧版 app/css/style.css：主色深藏青 #1a3c6e，通行密钥按钮绿 #1e8449。
// 暗色采用 Google 深色方案：页面深灰 #1b1b1d、卡片纯黑（比页面更暗形成层次）、
// 浅蓝 #a8c7fa 主按钮配深色文字、提亮的文字灰阶——可读性优先。
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
        // 错误红加深一档（M3 #b3261e），行内红字不再刺眼
        error: { main: '#b3261e' },
        // Google 账号页浅蓝灰底 + 白卡片
        background: { default: '#f0f4f9', paper: '#ffffff' },
      },
    },
    dark: {
      palette: {
        primary: { main: '#a8c7fa', contrastText: '#062e6f' },
        success: { main: '#6dd58c', contrastText: '#062b12' },
        // 暗色错误用 M3 柔粉，降低刺眼度
        error: { main: '#f2b8b5' },
        // 页面深灰 + 卡片纯黑（卡片比页面更暗，Google 深色的层次反转）
        background: { default: '#1b1b1d', paper: '#0e0e0f' },
        text: { primary: '#e3e3e3', secondary: '#9aa0a6' },
        divider: '#444746',
      },
    },
  },
  shape: { borderRadius: RADIUS_CONTROL },
  typography: {
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif',
    h1: { fontSize: '2.125rem', fontWeight: 400, lineHeight: 1.35, letterSpacing: '-0.25px' },
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
          // 日语等长文案下按钮文字禁止折行（药丸内两行非常难看）
          whiteSpace: 'nowrap',
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
      // Google 提示横幅风格：圆角适中（非药丸）；暗色下 info 为蓝色填充白字
      styleOverrides: {
        root: ({ theme }) => ({
          borderRadius: 12,
          ...theme.applyStyles('dark', {
            '&.MuiAlert-standardInfo': {
              backgroundColor: '#1558c8',
              color: '#ffffff',
              '& .MuiAlert-icon': { color: '#ffffff' },
            },
          }),
        }),
      },
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
    MuiCssBaseline: {
      // 日语排版规则：假名紧排（palt）、严格禁则换行、收紧行高、标题平衡断行。
      // 解决日语假名句子偏长导致的松散行距与糟糕断句位置。
      styleOverrides: `
        html[lang="ja"] {
          font-feature-settings: "palt" 1;
        }
        html[lang="ja"] .MuiTypography-root {
          line-break: strict;
          word-break: normal;
        }
        html[lang="ja"] .MuiTypography-body1,
        html[lang="ja"] .MuiTypography-body2,
        html[lang="ja"] .MuiTypography-caption {
          line-height: 1.45;
        }
        html[lang="ja"] .MuiTypography-h1,
        html[lang="ja"] .MuiTypography-h2 {
          text-wrap: balance;
          line-height: 1.4;
        }
      `,
    },
  },
});

export default theme;
