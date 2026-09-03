import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Card from '@mui/material/Card';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded';
import FingerprintRoundedIcon from '@mui/icons-material/FingerprintRounded';
import ColorModeIconDropdown from '../shared-theme/ColorModeIconDropdown';
import { enterFadeUp, stepFadeUp } from '../shared-theme/motion';

interface AuthShellProps {
  /** 左栏大标题（登录 / 创建您的账号 / 欢迎回来…） */
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** 左栏附加内容（如邮箱药丸） */
  leftExtra?: React.ReactNode;
  /** 右栏内容（表单 / 方式列表等，顶对齐——与左栏标题区平齐） */
  children: React.ReactNode;
  /** 沉底的底部动作行（Google 式：内容在顶部，动作按钮在卡片底部） */
  actions?: React.ReactNode;
  /** 变化时触发 fade-up 过渡的键（如登录分步流的 step） */
  transitionKey?: React.Key;
}

/**
 * 认证页共用壳：Google 宽版双栏卡片（accounts.google.com 布局）。
 * 左栏：Logo + 大标题 + 副标题（顶对齐）；右栏：内容置顶 + 动作行沉底，
 * 中部留白是 Google 卡片的固定高度带来的呼吸感（md+ 卡片最小高 460）。
 * 卡片下方页脚：左侧语言选择，右侧 帮助/隐私权/条款。
 */
export default function AuthShell({ title, subtitle, leftExtra, children, actions, transitionKey }: AuthShellProps) {
  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ alignSelf: 'flex-end', px: { xs: 2, sm: 3 }, py: 1.5 }}>
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
        <Card variant="outlined" sx={{ width: '100%', maxWidth: 900, ...enterFadeUp }}>
          <Stack direction={{ xs: 'column', md: 'row' }} sx={{ alignItems: 'stretch', minHeight: { md: 400 } }}>
            {/* 左栏：品牌 + 标题（内容块垂直居中，与右栏输入框平齐，Google 式中部构图） */}
            <Box
              sx={{
                flex: 1,
                p: { xs: 3, sm: 5 },
                pr: { md: 2 },
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}
            >
              <Stack spacing={2.5}>
                <FingerprintRoundedIcon color="primary" sx={{ fontSize: 44 }} />
                <Typography variant="h1">{title}</Typography>
                {subtitle && <Typography sx={{ color: 'text.secondary' }}>{subtitle}</Typography>}
                {leftExtra}
              </Stack>
            </Box>

            {/* 右栏：内容块垂直居中（卡片中部）+ 动作行沉底 */}
            <Box
              key={transitionKey}
              sx={[
                {
                  flex: 1,
                  p: { xs: 3, sm: 5 },
                  pl: { md: 2 },
                  display: 'flex',
                  flexDirection: 'column',
                },
                ...(transitionKey ? [stepFadeUp] : []),
              ]}
            >
              <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                <Stack spacing={2.5} alignItems="stretch">
                  {children}
                </Stack>
              </Box>
              {actions && <Box sx={{ pt: 2 }}>{actions}</Box>}
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
          px: { xs: 2, sm: 3 },
          pb: 3,
          ...enterFadeUp,
          animationDelay: '0.1s',
        }}
      >
        <Button size="small" startIcon={<ArrowDropDownRoundedIcon />} disabled>
          简体中文
        </Button>
        <Stack direction="row" spacing={{ xs: 2, sm: 4 }}>
          {['帮助', '隐私权', '条款'].map((item) => (
            <Button key={item} size="small" disabled sx={{ minWidth: 0, p: 0 }}>
              {item}
            </Button>
          ))}
        </Stack>
      </Box>
    </Box>
  );
}

/** 底部动作行：左侧次操作（text），右侧主操作（filled 药丸） */
export function AuthActions({ secondary, primary }: { secondary?: React.ReactNode; primary: React.ReactNode }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
      {secondary}
      {primary}
    </Box>
  );
}
