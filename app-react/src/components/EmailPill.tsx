import * as React from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ArrowDropDownRoundedIcon from '@mui/icons-material/ArrowDropDownRounded';

export interface EmailPillItem {
  label: string;
  onClick: () => void;
}

/** Google 式账号药丸：描边圆角胶囊 + 邮箱 + 下拉箭头；items 提供时点击弹菜单。 */
export default function EmailPill({ email, items }: { email: string; items?: EmailPillItem[] }) {
  const [anchorEl, setAnchorEl] = React.useState<HTMLElement | null>(null);

  if (!items?.length) {
    return (
      <Box
        sx={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.5,
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 999,
          px: 2,
          py: 0.75,
          bgcolor: 'background.paper',
          maxWidth: '100%',
        }}
      >
        <Box component="span" sx={{ fontSize: 14, overflowWrap: 'anywhere' }}>
          {email}
        </Box>
        <ArrowDropDownRoundedIcon fontSize="small" sx={{ color: 'text.secondary' }} />
      </Box>
    );
  }

  return (
    <>
      <Button
        variant="outlined"
        endIcon={<ArrowDropDownRoundedIcon />}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        sx={{
          borderRadius: 999,
          borderColor: 'divider',
          color: 'text.primary',
          px: 2,
          py: 0.75,
          minWidth: 0,
          maxWidth: '100%',
          alignSelf: 'flex-start',
          '& .MuiButton-endIcon': { mr: 0 },
        }}
      >
        <Box component="span" sx={{ fontSize: 14, overflowWrap: 'anywhere' }}>
          {email}
        </Box>
      </Button>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {items.map((item) => (
          <MenuItem
            key={item.label}
            onClick={() => {
              setAnchorEl(null);
              item.onClick();
            }}
          >
            {item.label}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
