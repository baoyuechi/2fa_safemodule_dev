import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Divider from '@mui/material/Divider';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import FingerprintRoundedIcon from '@mui/icons-material/FingerprintRounded';
import { useNavigate } from 'react-router-dom';
import IconButton from '@mui/material/IconButton';
import ColorModeIconDropdown from '../shared-theme/ColorModeIconDropdown';
import LocaleMenuButton from '../components/LocaleMenuButton';
import { useI18n } from '../i18n/LocaleContext';
import { termsContent } from '../i18n/terms';

/** 服务条款文档页：公开路由（/terms），四语内容，随当前语言切换。 */
export default function TermsPage() {
  const navigate = useNavigate();
  const { locale, t } = useI18n();
  const content = termsContent[locale] ?? termsContent.en;

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
          <FingerprintRoundedIcon color="primary" sx={{ fontSize: 26 }} />
          <Typography sx={{ fontWeight: 700 }}>isaSpectrum</Typography>
        </Stack>
        <Stack direction="row" spacing={1.5} alignItems="center">
          <LocaleMenuButton iconOnly />
          <ColorModeIconDropdown />
        </Stack>
      </Box>

      <Container maxWidth="sm" sx={{ py: { xs: 3, sm: 5 }, flex: 1 }}>
        <Typography variant="h1">{t('terms.title')}</Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 0.5 }}>
          {`${t('terms.updated')}: ${content.updated}`}
        </Typography>
        <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2, whiteSpace: 'pre-line' }}>
          {content.intro}
        </Typography>

        {content.sections.map((section) => (
          <Box key={section.title} component="section" sx={{ mt: 4 }}>
            <Typography variant="h2">{section.title}</Typography>
            {section.paragraphs.map((paragraph, index) => (
              <Typography key={index} variant="body2" sx={{ mt: 1, whiteSpace: 'pre-line' }}>
                {paragraph}
              </Typography>
            ))}
          </Box>
        ))}

        <Divider sx={{ mt: 5, mb: 2 }} />
        <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', textAlign: 'center' }}>
          isaSpectrum · {t('auth.brandAccount')}
        </Typography>
      </Container>
    </Box>
  );
}
