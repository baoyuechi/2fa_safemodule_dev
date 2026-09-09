import * as React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Fab from '@mui/material/Fab';
import Fade from '@mui/material/Fade';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import { useNavigate } from 'react-router-dom';
import IconButton from '@mui/material/IconButton';
import ColorModeIconDropdown from '../shared-theme/ColorModeIconDropdown';
import BrandLogo from '../components/BrandLogo';
import LocaleMenuButton from '../components/LocaleMenuButton';
import { useI18n } from '../i18n/LocaleContext';
import { termsContent } from '../i18n/terms';
import { animatedScrollTo, cascadeUp } from '../shared-theme/motion';

/** 服务条款文档页：公开路由（/terms），四语内容，随当前语言切换。
 *  入场动效：标题 → 简介 → 各节按序瀑布式向下铺开（stagger 70ms）。 */
export default function TermsPage() {
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const content = termsContent[locale] ?? termsContent.en;
  // 回到顶部按钮：滚过一屏后出现
  const [showTop, setShowTop] = React.useState(false);
  React.useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 480);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <Box sx={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: { xs: 2, sm: 3 },
          py: 1.5,
          position: 'sticky',
          top: 0,
          bgcolor: 'background.default',
          zIndex: 10,
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <IconButton size="small" onClick={() => navigate(-1)} aria-label="back">
            <ArrowBackRoundedIcon fontSize="small" />
          </IconButton>
          <BrandLogo size={26} />
          <Typography sx={{ fontWeight: 700 }}>isaSpectrum</Typography>
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <LocaleMenuButton iconOnly />
          <ColorModeIconDropdown />
        </Stack>
      </Box>

      <Container maxWidth="sm" sx={{ py: { xs: 3, sm: 5 }, flex: 1 }}>
        <Box sx={cascadeUp(0)}>
          <Typography variant="h1">{t('terms.title')}</Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
            {`${t('terms.updated')}: ${content.updated}`}
          </Typography>
        </Box>
        <Box sx={{ ...cascadeUp(0.08), mt: 2 }}>
          <Typography variant="body1" sx={{ color: 'text.secondary', whiteSpace: 'pre-line', lineHeight: 1.9 }}>
            {content.intro}
          </Typography>
        </Box>

        {content.sections.map((section, index) => (
          <Box key={section.title} component="section" sx={{ ...cascadeUp(0.18 + index * 0.07), mt: 4 }}>
            <Typography variant="h2">{section.title}</Typography>
            {section.paragraphs.map((paragraph, pIndex) => (
              <Typography key={pIndex} variant="body1" sx={{ mt: 1.5, whiteSpace: 'pre-line', lineHeight: 1.9 }}>
                {paragraph}
              </Typography>
            ))}
          </Box>
        ))}

        <Box sx={cascadeUp(0.18 + content.sections.length * 0.07)}>
          <Divider sx={{ mt: 5, mb: 2 }} />
          <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', textAlign: 'center' }}>
            isaSpectrum · {t('auth.brandAccount')}
          </Typography>
        </Box>
      </Container>

      {/* 回到顶部：点击后加速（先慢后快）滚回顶部 */}
      <Fade in={showTop}>
        <Fab
          size="medium"
          color="primary"
          aria-label={t('terms.backToTop')}
          onClick={() => animatedScrollTo(0, 1000)}
          sx={{ position: 'fixed', right: { xs: 16, sm: 24 }, bottom: { xs: 16, sm: 24 }, zIndex: 20 }}
        >
          <KeyboardArrowUpRoundedIcon />
        </Fab>
      </Fade>
    </Box>
  );
}
