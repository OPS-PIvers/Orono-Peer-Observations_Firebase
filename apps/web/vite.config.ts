import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { devAuthProxy } from './vite-dev-auth-proxy';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    // Same-origin proxy for /dev-sign-in to scripts/dev-auth-server.mjs.
    devAuthProxy(
      loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), 'VITE_')[
        'VITE_DEV_AUTH_SERVER'
      ] ?? 'http://127.0.0.1:8787',
    ),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
}));
