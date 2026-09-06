import * as React from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded';
import LanguageRoundedIcon from '@mui/icons-material/LanguageRounded';
import { useI18n } from '../i18n/LocaleContext';
import type { Locale } from '../i18n/messages';

const LOCALES: { code: Locale; native: string }[] = [
  { code: 'zh', native: '简体中文' },
  { code: 'en', native: 'English' },
];

/** 语言切换按钮：页脚版（显示当前语言名 + 下拉箭头）或图标版（顶栏紧凑布局）。 */
export default function LocaleMenuButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const current = LOCALES.find((l) => l.code === locale) ?? LOCALES[0];

  const pick = (code: Locale) => {
    setAnchorEl(null);
    setLocale(code);
  };

  if (iconOnly) {
    return (
      <>
        <Tooltip title={t('common.language')}>
          <IconButton
            onClick={(e) => setAnchorEl(e.currentTarget)}
            size="small"
            aria-label={t('common.language')}
            sx={{ border: '1px solid', borderColor: 'divider', color: 'inherit' }}
          >
            <LanguageRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Menu
          anchorEl={anchorEl}
          open={open}
          onClose={() => setAnchorEl(null)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          {LOCALES.map((l) => (
            <MenuItem key={l.code} selected={l.code === locale} onClick={() => pick(l.code)}>
              {l.native}
            </MenuItem>
          ))}
        </Menu>
      </>
    );
  }

  return (
    <>
      <Button size="small" endIcon={<ArrowDropDownRoundedIcon />} onClick={(e) => setAnchorEl(e.currentTarget)}>
        {current.native}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'top', horizontal: 'left' }}
        transformOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        {LOCALES.map((l) => (
          <MenuItem key={l.code} selected={l.code === locale} onClick={() => pick(l.code)}>
            {l.native}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}