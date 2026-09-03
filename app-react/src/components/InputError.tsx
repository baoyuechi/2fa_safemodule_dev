import * as React from 'react';
import Collapse from '@mui/material/Collapse';
import Typography from '@mui/material/Typography';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';

interface InputErrorProps {
  /** 错误文案；null/undefined = 收起（带退出动画） */
  message?: string | null;
}

/**
 * Google 式行内错误：输入框下方一行小红字（带图标），出现/消失为高度展开动画。
 * 用法：放在 TextField 正下方，配合 TextField 的 error 属性（红边）；message 由页面状态控制。
 * 退出动画期间保留最后一条文案（记录 display），避免内容瞬间消失。
 */
export default function InputError({ message }: InputErrorProps) {
  const [display, setDisplay] = React.useState<string | null>(message ?? null);
  React.useEffect(() => {
    if (message) setDisplay(message);
  }, [message]);

  return (
    <Collapse
      in={Boolean(message)}
      timeout={{ enter: 240, exit: 160 }}
      easing={{ enter: 'cubic-bezier(0.2, 0, 0, 1)', exit: 'ease-out' }}
      onExited={() => setDisplay(null)}
    >
      <Typography
        variant="caption"
        sx={{ mt: 0.75, display: 'flex', alignItems: 'center', gap: 0.5, color: 'error.main' }}
        role="alert"
      >
        <ErrorOutlineRoundedIcon sx={{ fontSize: 15, flexShrink: 0 }} />
        {display}
      </Typography>
    </Collapse>
  );
}
