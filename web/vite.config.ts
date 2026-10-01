import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In production, Vercel proxies /api/* to the API (see vercel.json), so the
// browser only ever talks to the site's own origin - no CORS, and the API's
// plain-HTTP address never appears in the page. `npm run dev` does the same
// with Vite's proxy. It defaults to the production API, which is read-only
// for everything this site calls; set EDGAR_API_URL to use a local one.
const apiTarget = process.env.EDGAR_API_URL ?? 'http://80.225.253.10:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    restoreMocks: true,
  },
});
