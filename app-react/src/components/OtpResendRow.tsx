import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import InputError from './InputError';
import type { InputErrorInfo } from './InputError';

interface OtpResendRowProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: InputErrorInfo | null;
  /** 验证/提交请求在途（禁操作，但不禁发送计数） */
  busy?: boolean;
  /** 发送请求在途 */
  sending?: boolean;
  /** 发送倒计时（>0 时按钮禁用并显示 resendIn(countdown)） */
  countdown: number;
  sendLabel: string;
  sendingLabel: string;
  resendIn: (countdown: number) => string;
  onSend: () => void;
}

/** 验证码输入行 + 重发按钮（PhoneBindPage 内联版抽出，改密/换绑页复用）。 */
export default function OtpResendRow({
  label,
  value,
  onChange,
  error,
  busy,
  sending,
  countdown,
  sendLabel,
  sendingLabel,
  resendIn,
  onSend,
}: OtpResendRowProps) {
  return (
    <Box>
      <Stack direction="row" spacing={1} alignItems="center">
        <TextField
          label={label}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
          }}
          slotProps={{ htmlInput: { inputMode: 'numeric', maxLength: 6 } }}
          sx={{ flex: 1 }}
          error={Boolean(error)}
          disabled={busy}
        />
        <Button
          variant="outlined"
          onClick={onSend}
          disabled={sending || countdown > 0 || busy}
          sx={{ whiteSpace: 'nowrap' }}
        >
          {sending ? sendingLabel : countdown > 0 ? resendIn(countdown) : sendLabel}
        </Button>
      </Stack>
      <InputError error={error} />
    </Box>
  );
}