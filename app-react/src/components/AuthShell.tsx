import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded';
import FingerprintRoundedIcon from '@mui/icons-material/FingerprintRounded';
import ColorModeIconDropdown from '../shared-theme/ColorModeIconDropdown';

interface AuthShellProps {
  /** 左栏大标题（登录 / 创建您的账号 / 欢迎回来…） */
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** 左栏附加内容（如邮箱药丸） */
  leftExtra?: React.ReactNode;
  /** 右栏交互区（表单 / 方式列表 + 底部动作行） */
  children: React.ReactNode;
}

/**
 * 认证页共用壳：Google 宽版双栏卡片（图 3/4/5 风格）。
 * 左栏：Logo + 大标题 + 副标题 + 附加内容；右栏：交互区。
 * 卡片下方页脚：左侧语言选择，右侧 帮助/隐私权/条款。
 */
export default function AuthShell({ title, subtitle, leftExtra, children }: AuthShellProps) {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ alignSelf: 'flex-end', p: 2 }}>
        <ColorModeIconDropdown />
      </Box>

      <Box
        sx={{
          flex: 1,
          width: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          px: { xs: 2, sm: 4 },
          py: 3,
        }}
      >
        <Card variant="outlined" sx={{ width: '100%', maxWidth: 900 }}>
          <Stack direction={{ xs: 'column', md: 'row' }}>
            {/* 左栏：品牌 + 标题 */}
            <Box sx={{ flex: 1, p: { xs: 3, sm: 5 }, pr: { md: 2 } }}>
              <Stack spacing={2.5} sx={{ pt: { md: 2 } }}>
                <FingerprintRoundedIcon color="primary" sx={{ fontSize: 44 }} />
                <Typography variant="h1">{title}</Typography>
                {subtitle && <Typography sx={{ color: 'text.secondary' }}>{subtitle}</Typography>}
                {leftExtra}
              </Stack>
            </Box>

            {/* 右栏：交互区 */}
            <Box sx={{ flex: 1, p: { xs: 3, sm: 5 }, pl: { md: 2 } }}>
              <Stack spacing={2.5} alignItems="stretch" sx={{ minHeight: { md: 280 } }}>
                {children}
              </Stack>
            </Box>
          </Stack>
        </Card>
      </Box>

      <Box
        component="footer"
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
          px: { xs: 3, sm: 6 },
          pb: 3,
        }}
      >
        <Button size="small" startIcon={<ArrowDropDownRoundedIcon />} sx={{ color: 'text.secondary' }}>
          简体中文
        </Button>
        <Stack direction="row" spacing={{ xs: 2, sm: 4 }}>
          {['帮助', '隐私权', '条款'].map((item) => (
            <Typography key={item} variant="body2" sx={{ color: 'text.secondary' }}>
              {item}
            </Typography>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

/** 右栏底部动作行：左侧次操作（text），右侧主操作（filled 药丸） */
export function AuthActions({ secondary, primary }: { secondary?: React.ReactNode; primary: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1, pt: 1, mt: 'auto' }}>
      {secondary}
      {primary}
    </Box>
  );
}
