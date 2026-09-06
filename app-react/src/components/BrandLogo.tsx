import Box from '@mui/material/Box';
import { useColorScheme } from '@mui/material/styles';
import logoUrl from '../assets/isa-logo.png';

interface BrandLogoProps {
  /** 高度（px），宽度按原图比例自适应 */
  size?: number;
}

/**
 * isaSpectrum 品牌 Logo（透明底 PNG）。
 * 暗色背景下反相为白色剪影以保证可见性；浅色下使用原图配色。
 */
export default function BrandLogo({ size = 44 }: BrandLogoProps) {
  const { mode, systemMode } = useColorScheme();
  const resolved = mode === 'system' ? (systemMode ?? 'light') : (mode ?? 'light');
  const invert = resolved === 'dark';

  return (
    <Box
      component="img"
      src={logoUrl}
      alt="isaSpectrum"
      sx={{
        height: size,
        width: 'auto',
        alignSelf: 'flex-start', // 防止被纵向 Stack 的默认 stretch 拉满列宽
        display: 'block',
        filter: invert ? 'brightness(0) invert(1)' : 'none',
        transition: 'filter .3s ease',
      }}
    />
  );
}
