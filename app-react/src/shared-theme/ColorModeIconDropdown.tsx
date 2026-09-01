import * as React from 'react';
import { useColorScheme } from '@mui/material/styles';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';
import SettingsBrightnessOutlinedIcon from '@mui/icons-material/SettingsBrightnessOutlined';

/** 明暗切换：浅色 → 深色 → 跟随系统 循环（MUI 自动持久化到 localStorage）。 */
export default function ColorModeIconDropdown() {
  const { mode, systemMode, setMode } = useColorScheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null; // SSR/首帧避免 hydration 图标闪烁

  const current = mode === 'system' ? (systemMode ?? 'light') : (mode ?? 'light');
  // 循环基于 mode 本身（light → dark → system → light）；
  // 若基于解析后的 current，mode=system 时会 setMode('system') 空转
  const next = mode === 'light' ? 'dark' : mode === 'dark' ? 'system' : 'light';
  const label = current === 'light' ? '深色模式' : current === 'dark' ? '跟随系统' : '浅色模式';

  return (
    <Tooltip title={label}>
      <IconButton
        onClick={() => setMode(next)}
        size="small"
        aria-label={label}
        sx={{ border: '1px solid', borderColor: 'divider' }}
      >
        {current === 'light' ? (
          <LightModeOutlinedIcon fontSize="small" />
        ) : current === 'dark' ? (
          <DarkModeOutlinedIcon fontSize="small" />
        ) : (
          <SettingsBrightnessOutlinedIcon fontSize="small" />
        )}
      </IconButton>
    </Tooltip>
  );
}
