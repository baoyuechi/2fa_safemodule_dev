import * as React from 'react';
import Collapse from '@mui/material/Collapse';
import Typography from '@mui/material/Typography';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import { useI18n } from '../i18n/LocaleContext';
import type { MessageKey } from '../i18n/messages';

export interface InputErrorInfo {
  key: MessageKey;
  vars?: Record<string, string | number>;
}

interface InputErrorProps {
  /** 错误描述（i18n 键 + 变量）；null/undefined = 收起（带退出动画）。
   *  存键而非译文：渲染时才取词，语言切换后已显示的错误会自动重译。 */
  error?: InputErrorInfo | null;
}

/**
 * Google 式行内错误：输入框下方一行小红字（带图标），出现/消失为高度展开动画。
 * 用法：放在 TextField 正下方，配合 TextField 的 error 属性（红边）；error 由页面状态控制。
 * 退出动画期间保留最后一条文案（记录 display），避免内容瞬间消失。
 */
export default function InputError({ error }: InputErrorProps) {
  const { t } = useI18n();
  const [display, setDisplay] = React.useState<InputErrorInfo | null>(error ?? null);
  React.useEffect(() => {
    if (error) setDisplay(error);
  }, [error]);

  return (
    <Collapse
      in={Boolean(error)}
      timeout={{ enter: 240, exit: 160 }}
      easing={{ enter: 'cubic-bezier(0.2, 0, 0, 1)', exit: 'ease-out' }}
      onExited={() => setDisplay(null)}
    >
      <Typography
        variant="body2"
        sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.5, color: 'error.main' }}
        role="alert"
      >
        <ErrorOutlineRoundedIcon sx={{ fontSize: 15, flexShrink: 0 }} />
        {display ? t(display.key, display.vars) : ''}
      </Typography>
    </Collapse>
  );
}
