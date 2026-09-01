import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 端口 5173 已在 supabase/functions/_shared/mfa.config.js 的 corsAllowOrigins 白名单内，
// 改端口需同步补白名单（见 app/README.md）。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
  },
});
