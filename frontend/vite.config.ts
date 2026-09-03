import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, 'src') },
  },
  server: {
    host: '0.0.0.0',
    // Port comes from the environment when set; if it is busy, vite walks to
    // the next free one (strictPort: false) instead of dying. Nothing here is
    // hard-coded — run `PORT=7788 pnpm dev` in the backend and this proxies
    // there automatically.
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: false,
    // Allow the sandbox / tunnel preview host.
    allowedHosts: true,
    proxy: {
      // Same-origin in dev, so the browser never needs CORS.
      '/api': {
        target: process.env.VITE_API_TARGET ?? `http://localhost:${process.env.PORT ?? 5000}`,
        changeOrigin: true,
      },
    },
  },
  preview: { host: '0.0.0.0', allowedHosts: true },
  build: { outDir: 'dist', sourcemap: true },
});