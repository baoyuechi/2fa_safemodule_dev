import * as React from 'react';
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
  active: 'security' | 'passkeys';
  user: MfaUser;
  onLogout: () => void;
  children: React.ReactNode;
}

interface NavItem {
  key: string;
  label: string;
  icon: React.ReactNode;
  /** 彩色圆标底色（Google 式 pastel） */
  bg: string;
  to?: string;
  disabled?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { key: 'security', label: '安全性与登录', icon: <LockRoundedIcon sx={{ fontSize: 18 }} />, bg: '#d3e3fd', to: '/security' },
  { key: 'passkeys', label: '通行密钥', icon: <FingerprintRoundedIcon sx={{ fontSize: 18 }} />, bg: '#c4eed0', to: '/enroll' },
  { key: 'phone', label: '手机号绑定', icon: <SmsRoundedIcon sx={{ fontSize: 18 }} />, bg: '#f8d8c8', disabled: true },
  { key: 'recovery', label: '恢复码', icon: <KeyRoundedIcon sx={{ fontSize: 18 }} />, bg: '#ffe08c', disabled: true },
];

/**
 * 账户页共用壳（图 1 风格）：顶栏品牌 + 头像菜单；左侧彩色圆标导航；
 * 右侧主内容列。预留项（端点 4/9-12 未实现）禁用并标注「预留」。
 */
export default function AccountShell({ active, user, onLogout, children }: AccountShellProps) {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const initial = (user.email ?? '？').slice(0, 1).toUpperCase();

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
              ...(isActive ? { bgcolor: 'rgba(26, 60, 110, 0.10)', '&:hover': { bgcolor: 'rgba(26, 60, 110, 0.14)' } } : {}),
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
                    bgcolor: item.bg,
                    color: 'rgba(0,0,0,.72)',
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
              <Tooltip key={item.key} title="对应端点尚未实现（phone/bind、recovery），接入后开放" placement="right">
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
