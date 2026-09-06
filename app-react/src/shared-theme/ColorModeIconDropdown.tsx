import * as React from 'react';
import { useColorScheme } from '@mui/material/styles';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import Check from '@mui/icons-material/Check';
import Tooltip from '@mui/material/Tooltip';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import SettingsBrightnessOutlinedIcon from '@mui/icons-material/SettingsBrightnessOutlined';
import { useI18n } from '../i18n/LocaleContext';
import type { MessageKey } from '../i18n/messages';

type ModeOption = 'light' | 'dark' | 'system';

const OPTIONS: { value: ModeOption; labelKey: MessageKey }[] = [
  { value: 'light', labelKey: 'mode.light' },
  { value: 'dark', labelKey: 'mode.dark' },
  { value: 'system', labelKey: 'mode.system' },
];

const MODE_ICONS: Record<ModeOption, React.ReactNode> = {
  light: <LightModeOutlinedIcon fontSize="small" />,
  dark: <DarkModeOutlinedIcon fontSize="small" />,
  system: <SettingsBrightnessOutlinedIcon fontSize="small" />,
};

const MODE_LABEL_KEYS: Record<ModeOption, MessageKey> = {
  light: 'mode.light',
  dark: 'mode.dark',
  system: 'mode.system',
};

/**
 * 明暗模式选择器：按钮显示当前解析后的模式图标，点开菜单可在
 * 浅色 / 深色 / 跟随系统 三种模式间直接选择（当前项打勾）。
 * 「跟随系统」是可持久保持的模式，不再是循环切换的过渡态。
 */
export default function ColorModeIconDropdown() {
  const { mode, setMode } = useColorScheme();
  const { t } = useI18n();
  const [mounted, setMounted] = React.useState(false);
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null; // 首帧避免模式图标闪烁

  const current: ModeOption = mode === 'light' || mode === 'dark' ? mode : 'system';

  return (
    <>
      <Tooltip title={t(MODE_LABEL_KEYS[current])}>
        <IconButton
          onClick={(e) => setAnchorEl(e.currentTarget)}
          size="small"
          aria-label={t(MODE_LABEL_KEYS[current])}
          aria-haspopup="menu"
          sx={{ border: '1px solid', borderColor: 'divider' }}
        >
          {MODE_ICONS[current]}
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {OPTIONS.map((option) => (
          <MenuItem
            key={option.value}
            selected={option.value === current}
            onClick={() => {
              setMode(option.value);
              setAnchorEl(null);
            }}
          >
            <ListItemIcon>{MODE_ICONS[option.value]}</ListItemIcon>
            {t(option.labelKey)}
            {option.value === current && <Check fontSize="small" sx={{ ml: 'auto' }} />}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
