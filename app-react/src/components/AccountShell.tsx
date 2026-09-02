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
import KeyRoundedIcon from '@mui/icons-material/KeyRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import SmsRoundedIcon from '@mui/icons-material/SmsRounded';
import FingerprintRoundedIcon from '@mui/icons-material/FingerprintRounded';
import Tooltip from '@mui/material/Tooltip';
import { Link as RouterLink } from 'react-router-dom';
import ColorModeIconDropdown from '../shared-theme/ColorModeIconDropdown';
import type { MfaUser } from '../api/mfaClient';

interface AccountShellProps {
  active: 'security' | 'passkeys' | 'phone';
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

const NAV_ITEMS: NavItem[] = [
  { key: 'security', label: '安全性与登录', icon: <LockRoundedIcon sx={{ fontSize: 18 }} />, variant: 'primary', to: '/security' },
  { key: 'passkeys', label: '通行密钥', icon: <FingerprintRoundedIcon sx={{ fontSize: 18 }} />, variant: 'success', to: '/enroll' },
  { key: 'phone', label: '手机号绑定', icon: <SmsRoundedIcon sx={{ fontSize: 18 }} />, variant: 'warning', to: '/phone' },
  { key: 'recovery', label: '恢复码', icon: <KeyRoundedIcon sx={{ fontSize: 18 }} />, variant: 'info', disabled: true },
];

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
 * 右侧主内容列。预留项（只有恢复码，端点 9/10/12 未实现）禁用并标注「预留」。
 */
export default function AccountShell({ active, user, onLogout, children }: AccountShellProps) {
  const theme = useTheme();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const initial = (user.email ?? '？').slice(0, 1).toUpperCase();

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
      {/* 顶栏 */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: { xs: 2, sm: 3 },
          py: 1.5,
        }}
      >
        <Typography sx={{ fontSize: 20, fontWeight: 500 }}>
          isaSpectrum <Box component="span" sx={{ color: 'text.secondary' }}>账号</Box>
        </Typography>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <ColorModeIconDropdown />
          <IconButton onClick={(e) => setAnchorEl(e.currentTarget)} size="small" aria-label="账号菜单">
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
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>当前登录账号</Typography>
          </Stack>
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            onLogout();
          }}
        >
          退出登录
        </MenuItem>
      </Menu>

      <Box sx={{ flex: 1, display: 'flex', alignItems: 'flex-start' }}>
        {/* 左侧导航（窄屏隐藏） */}
        <Stack
          component="nav"
          spacing={0.5}
          sx={{ display: { xs: 'none', md: 'flex' }, width: 240, px: 2, pt: 3, position: 'sticky', top: 24, flexShrink: 0 }}
        >
          {NAV_ITEMS.map((item) => {
            const isActive = item.key === active;
            const rowSx = {
              borderRadius: 999,
              py: 1,
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
                <Typography variant="body2" sx={{ fontWeight: isActive ? 600 : 400, flex: 1 }}>
                  {item.label}
                </Typography>
                {item.disabled && <Chip label="预留" size="small" variant="outlined" sx={{ height: 20, fontSize: 11 }} />}
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
              <Tooltip key={item.key} title="恢复码功能即将上线，敬请期待" placement="right">
                <Box>{row}</Box>
              </Tooltip>
            ) : (
              <React.Fragment key={item.key}>{row}</React.Fragment>
            );
          })}
          <Box sx={{ px: 2.5, pt: 6 }}>
            <Stack direction="row" spacing={2}>
              {['隐私权', '条款'].map((t) => (
                <Typography key={t} variant="caption" sx={{ color: 'text.secondary' }}>
                  {t}
                </Typography>
              ))}
            </Stack>
          </Box>
        </Stack>

        {/* 主内容列 */}
        <Box sx={{ flex: 1, display: 'flex', justifyContent: 'center', px: { xs: 2, sm: 4 }, py: { xs: 1, sm: 3 } }}>
          <Stack spacing={3} sx={{ width: '100%', maxWidth: 820 }}>{children}</Stack>
        </Box>
      </Box>
    </Box>
  );
}
