import * as React from 'react';
import Box from '@mui/material/Box';
import Collapse from '@mui/material/Collapse';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useI18n } from '../i18n/LocaleContext';
import { scorePassword } from '../lib/passwordStrength';
import type { PasswordStrengthResult } from '../lib/passwordStrength';

/** 各档位色：0 弱（红）→ 1（橙）→ 2 一般（琥珀）→ 3 强（黄绿）→ 4 很强（绿） */
const SCORE_COLORS = ['#dc2626', '#ea7317', '#eab308', '#65a30d', '#16a34a'];
const SCORE_LABEL_KEYS = ['meter.weak', 'meter.weak', 'meter.fair', 'meter.strong', 'meter.veryStrong'] as const;

interface PasswordStrengthMeterProps {
  password: string;
}

/**
 * Google 式密码强度条：四段色条 + 档位文字 + zxcvbn 动态改进建议。
 * 密码为空时整块收起；打分防抖 150ms，库懒加载（首输密码时才拉取独立 chunk）。
 */
export default function PasswordStrengthMeter({ password }: PasswordStrengthMeterProps) {
  const { locale, t } = useI18n();
  const [strength, setStrength] = React.useState<PasswordStrengthResult | null>(null);

  React.useEffect(() => {
    if (!password) {
      setStrength(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void scorePassword(password, locale).then((result) => {
        if (!cancelled) setStrength(result);
      });
    }, 150);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [password, locale]);

  const visible = Boolean(password) && strength !== null;
  const score = strength?.score ?? 0;
  const color = SCORE_COLORS[score];

  // 建议区：强度未到「强」时展示警告与最多 2 条建议
  const adviceVisible = visible && score < 3;

  return (
    <Collapse in={visible} timeout={{ enter: 240, exit: 160 }} easing={{ enter: 'cubic-bezier(0.2, 0, 0, 1)', exit: 'ease-out' }}>
      <Box sx={{ mt: 1 }}>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          {[0, 1, 2, 3].map((segment) => (
            <Box
              key={segment}
              sx={{
                flex: 1,
                height: 4,
                borderRadius: 2,
                bgcolor: segment <= score ? color : 'action.hover',
                transition: 'background-color .3s ease',
              }}
            />
          ))}
          <Typography
            variant="caption"
            sx={{ color, fontWeight: 600, minWidth: 34, textAlign: 'right', whiteSpace: 'nowrap' }}
          >
            {t(SCORE_LABEL_KEYS[score])}
          </Typography>
        </Box>

        <Collapse in={adviceVisible} timeout={{ enter: 240, exit: 160 }}>
          <Stack spacing={0.25} sx={{ mt: 0.75 }}>
            {strength?.warning && (
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                {`• ${strength.warning}`}
              </Typography>
            )}
            {(strength?.suggestions ?? []).slice(0, 2).map((suggestion) => (
              <Typography key={suggestion} variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                {`• ${suggestion}`}
              </Typography>
            ))}
          </Stack>
        </Collapse>
      </Box>
    </Collapse>
  );
}
