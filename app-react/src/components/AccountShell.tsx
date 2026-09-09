import * as React from 'react';
import { alpha, useTheme } from '@mui/material/styles';
import Avatar from '@mui/material/Avatar';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import ListItemButton from '@mui/material/ListItemButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import PersonRoundedIcon from '@mui/icons-material/PersonRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';
import Tooltip from '@mui/material/Tooltip';
import { Link as RouterLink } from 'react-router-dom';
import BrandLogo from './BrandLogo';
import ColorModeIconDropdown from '../shared-theme/ColorModeIconDropdown';
import LocaleMenuButton from './LocaleMenuButton';
import { enterFadeUp } from '../shared-theme/motion';
import { useI18n } from '../i18n/LocaleContext';
import type { MfaUser } from '../api/mfaClient';

interface AccountShellProps {
  /** 用户中心三 Tab；安全子功能深链（passkeys/phone/recovery）高亮归到 security */
  active: 'profile' | 'settings' | 'security' | 'passkeys' | 'phone' | 'recovery';
  user: MfaUser;
  onLogout: () => void;
  children: React.ReactNode;
}

/** 导航项基础配置 */
interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** 色值标识：用于明暗模式自动适配底色 */
  variant: 'primary' | 'success' | 'warning' | 'info';
  to?: string;
  disabled?: boolean;
}

/** 明暗双套色值：浅色 pastel / 深色 subdued */
const NAV_BG_LIGHT: Record<string, string> = {
  primary: '#d3e3fd',
  success: '#c4eed0',
  warning: '#f8d8c8',
  info: '#ffe08c',
};
const NAV_BG_DARK: Record<string, string> = {
  primary: '#1a2d4a',
  success: '#1a3d2a',
  warning: '#3d2a1a',
  info: '#3d3a1a',
};

/**
 * 账户页共用壳（图 1 风格）：顶栏品牌 + 头像菜单；左侧彩色圆标导航；
 * 右侧主内容列。
 */
export default function AccountShell({ active, user, onLogout, children }: AccountShellProps) {
  const theme = useTheme();
  const { t, locale } = useI18n();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const [scrolled, setScrolled] = React.useState(false);
  const initial = (user.email ?? '？').slice(0, 1).toUpperCase();

  // 滚动检测：主体内容滚过顶栏高度后，顶栏背景变为毛玻璃透明（P4 修复）
  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 导航项：用户中心三 Tab（文案按当前语言取词；中英直写，其余语言回落英文）
  // 安全子功能（/enroll /phone /recovery）仍经 SecurityPage 内卡片进入，
  // 深链时左栏高亮归到 security（见 isActive 的归一）。
  const zh = locale === 'zh';
  const NAV_ITEMS: NavItem[] = [
    { key: 'profile', label: zh ? '个人主页' : locale === 'es' ? 'Inicio' : locale === 'ja' ? 'ホーム' : 'Profile', icon: <HomeRoundedIcon sx={{ fontSize: 18 }} />, variant: 'primary', to: '/profile' },
    { key: 'settings', label: zh ? '个人资料' : locale === 'es' ? 'Perfil' : locale === 'ja' ? 'プロフィール' : 'Settings', icon: <PersonRoundedIcon sx={{ fontSize: 18 }} />, variant: 'success', to: '/settings' },
    { key: 'security', label: t('nav.security'), icon: <ShieldRoundedIcon sx={{ fontSize: 18 }} />, variant: 'warning', to: '/security' },
  ];
  /** 安全子功能深链归一：passkeys/phone/recovery → security 高亮 */
  const activeKey = active === 'passkeys' || active === 'phone' || active === 'recovery' ? 'security' : active;
  const footerLinks = ['common.privacy', 'common.terms'] as const;

  /** 圆标底色：按当前明暗模式取对应色值 */
  const navBg = (variant: string) => (theme.palette.mode === 'dark' ? NAV_BG_DARK[variant] : NAV_BG_LIGHT[variant]);
  const navIconColor = theme.palette.mode === 'dark' ? 'rgba(255,255,255,.78)' : 'rgba(0,0,0,.72)';
  // 激活态高亮：primary 的 alpha，明暗两套（暗色下用提亮后的 primary）。
  // 注意用 theme.palette（解析后的 hex）而非 theme.vars（var() 字符串）——
  // alpha() 不接受 CSS 变量引用，会抛 "MUI: Unsupported var() color"。
  const activeBg = alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.18 : 0.1);
  const activeHoverBg = alpha(theme.palette.primary.main, theme.palette.mode === 'dark' ? 0.26 : 0.14);

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {/* 顶栏（完全固定：fixed 定位，不随任何滚动移动）
          滚动后背景变半透明毛玻璃，避免遮挡主体内容（P4 修复） */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: { xs: 2, sm: 3 },
          py: 1.5,
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 60,
          zIndex: 1100,
          bgcolor: scrolled ? 'rgba(255,255,255,0.72)' : 'background.default',
          backdropFilter: scrolled ? 'saturate(180%) blur(20px)' : 'none',
          WebkitBackdropFilter: scrolled ? 'saturate(180%) blur(20px)' : 'none',
          borderBottom: scrolled ? '1px solid' : '1px solid transparent',
          borderColor: scrolled ? 'divider' : 'transparent',
          transition: 'background-color .25s ease, border-color .25s ease, backdrop-filter .25s ease',
          ...theme.applyStyles('dark', {
            bgcolor: scrolled ? 'rgba(27,27,29,0.72)' : 'background.default',
          }),
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <BrandLogo size={26} />
          <Typography sx={{ fontSize: 20, fontWeight: 500 }}>
            isaSpectrum <Box component="span" sx={{ color: 'text.secondary' }}>{t('auth.brandAccount')}</Box>
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <LocaleMenuButton iconOnly />
          <ColorModeIconDropdown />
          <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small" aria-label={t('auth.menuLabel')}>
            <Avatar sx={{ width: 34, height: 34, bgcolor: 'primary.main', fontSize: 15 }}>{initial}</Avatar>
          </IconButton>
        </Stack>
      </Box>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem disabled sx={{ opacity: '1 !important' }}>
          <Stack>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{user.email}</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>{t('auth.signedInAsCurrent')}</Typography>
          </Stack>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            onLogout();
          }}
        >
          {t('auth.signOut')}
        </MenuItem>
      </Menu>

      <Box sx={{ flex: 1, display: 'flex', alignItems: 'flex-start', pt: '60px' }}>
        {/* 左侧导航（完全固定：fixed 定位；窄屏隐藏） */}
        <Stack
          component="nav"
          spacing={1}
          sx={{
            display: { xs: 'none', md: 'flex' },
            width: 240,
            px: 2,
            pt: 3,
            pb: 3,
            position: 'fixed',
            top: 60,
            left: 0,
            bottom: 0,
            overflowY: 'auto',
            flexShrink: 0,
          }}
        >
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === activeKey;
            const rowSx = {
              borderRadius: 999,
              py: 1.25,
              px: 1.5,
              // ListItemButton 自带 flex-grow: 1；侧栏 fixed 定高后会平分剩余空间把行撑高，
              // 这里锁死为内容高度。
              flexGrow: 0,
              bgcolor: isActive ? activeBg : 'transparent',
              '&:hover': {
                bgcolor: isActive ? activeHoverBg : 'action.hover',
              },
            };
            const rowContent = (
              <>
                <Box
                  sx={{
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    bgcolor: navBg(item.variant),
                    color: navIconColor,
                    mr: 1.5,
                    flexShrink: 0,
                  }}
                >
                  {item.icon}
                </Box>
                <Typography variant="body2" noWrap sx={{ fontWeight: isActive ? 600 : 400, flex: 1, minWidth: 0 }}>
                  {item.label}
                </Typography>
                {item.disabled && <Chip label={t('nav.upcoming')} size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />}
              </>
            );
            const row = item.to ? (
              <ListItemButton component={RouterLink} to={item.to} sx={rowSx}>
                {rowContent}
              </ListItemButton>
            ) : (
              <ListItemButton disabled sx={rowSx}>
                {rowContent}
              </ListItemButton>
            );
            return item.disabled ? (
              <Tooltip key={item.key} title={t('auth.recoverySoon')} placement="right">
                <Box>{row}</Box>
              </Tooltip>
            ) : (
              <React.Fragment key={item.key}>{row}</React.Fragment>
            );
          })}
          <Box sx={{ px: 2.5, pt: 6 }}>
            <Stack direction="row" spacing={2}>
              {footerLinks.map((key) =>
                key === 'common.terms' ? (
                  <Typography
                    key={key}
                    variant="caption"
                    component={RouterLink}
                    to="/terms"
                    sx={{ color: 'text.secondary', textDecoration: 'none' }}
                  >
                    {t(key)}
                  </Typography>
                ) : (
                  <Typography key={key} variant="caption" sx={{ color: 'text.secondary' }}>
                    {t(key)}
                  </Typography>
                ),
              )}
            </Stack>
          </Box>
        </Stack>

        {/* 主内容列（唯一滚动区：页面原生滚动；左侧 fixed 需让出 240px）。
            入场 fade-up 与 AuthShell 卡片一致：从改密/换绑/辅助邮箱等单一功能页
            返回时保持同一套丝滑过渡。 */}
        <Box
          sx={{
            flex: 1,
            ml: { md: '240px' },
            display: 'flex',
            justifyContent: 'center',
            px: { xs: 2, sm: 4 },
            py: { xs: 1, sm: 3 },
            ...enterFadeUp,
          }}
        >
          <Stack spacing={4} sx={{ width: '100%', maxWidth: 820 }}>{children}</Stack>
        </Box>
      </Box>
    </Box>
  );
}
