import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Fixed host + port: progress lives in localStorage, which is per-origin.
// Changing the port would make saved progress "disappear".
export const PORT = 5199;

export default defineConfig({
  plugins: [react()],
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
  },
  preview: {
    host: 'localhost',
    port: PORT,
    strictPort: true,
  },
});
