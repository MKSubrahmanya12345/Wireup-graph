import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The SPA proxies /api to the Express backend in development. In production
// (Vercel) the backend is a serverless function mounted at /api, so the
// relative path still works.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_PROXY ?? 'http://localhost:8080',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
});
