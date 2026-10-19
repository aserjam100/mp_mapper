import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `--mode static` builds the read-only site (pnpm site:build) into dist-static, with the files in static/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  publicDir: mode === 'static' ? 'static' : 'public',
  build: mode === 'static' ? { outDir: 'dist-static' } : {},
  server: {
    port: 5173,
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 3001}` },
  },
}));
