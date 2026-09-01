import * as React from 'react';
import { useColorScheme } from '@mui/material/styles';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import DarkModeOutlinedIcon from '@mui/icons-material/DarkModeOutlined';
import LightModeOutlinedIcon from '@mui/icons-material/LightModeOutlined';

/**
 * 明暗切换：显式浅/深 ↔ 跟随系统。
 * 点击目标始终基于「解析后的当前模式」，保证任何状态下点击都有可见变化
 * （原实现按存储 mode 循环，在「跟随系统 + 系统浅色」时会 setMode('light') 空转）。
 */
export default function ColorModeIconDropdown() {
  const { mode, systemMode, setMode } = useColorScheme();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null; // SSR/首帧避免 hydration 图标闪烁

  // 解析后的当前模式（跟随系统时取系统实际值）
  const current = mode === 'system' ? (systemMode ?? 'light') : (mode ?? 'light');
  // 点击要切换到的显式模式：始终与当前解析值相反
  const target = current === 'light' ? 'dark' : 'light';

  function toggleMode() {
    if (mode === 'system') {
      setMode(target);
    } else {
      setMode('system');
    }
  }

  // 标签描述「点击后的状态」：跟随系统态 → 固化到目标显式模式；显式态 → 转跟随系统
  const label = mode === 'system' ? (target === 'dark' ? '深色模式' : '浅色模式') : '跟随系统';

  return (
    <Tooltip title={label}>
      <IconButton onClick={toggleMode} size="small" aria-label={label} sx={{ border: '1px solid', borderColor: 'divider' }}>
        {current === 'light' ? (
          <LightModeOutlinedIcon fontSize="small" />
        ) : (
          <DarkModeOutlinedIcon fontSize="small" />
        )}
      </IconButton>
    </Tooltip>
  );
}
