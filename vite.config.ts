import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { autoUpdate } from './scripts/auto-update.ts';

// Fixed host + port: progress lives in localStorage, which is per-origin.
// Changing the port would make saved progress "disappear".
export const PORT = 5199;

export default defineConfig({
  plugins: [react(), autoUpdate()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // PGlite (Postgres in WASM) loads its .wasm/.data assets relative to its own module URL;
  // pre-bundling would break those URLs.
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  worker: {
    format: 'es',
  },
  server: {
    host: 'localhost',
    port: PORT,
    strictPort: true,
    watch: { ignored: ['**/.tools/**', '**/dist/**'] },
  },
  preview: {
    host: 'localhost',
    port: PORT,
    strictPort: true,
  },
});
