import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

// The app is served by the node service in server/, which reads from dist/.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist', emptyOutDir: true },
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: {
    // `npm run dev` talks to a running daemon.
    proxy: {
      '/api': 'http://127.0.0.1:7676',
      '/events': 'http://127.0.0.1:7676',
    },
  },
});
