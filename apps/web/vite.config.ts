import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/v1': process.env.API_URL ?? 'http://localhost:8080', '/health': process.env.API_URL ?? 'http://localhost:8080' } },
  preview: { port: 4173, proxy: { '/v1': process.env.API_URL ?? 'http://localhost:8080' } },
  build: { outDir: 'dist', sourcemap: true },
  test: { include: ['test/**/*.test.ts'] },
} as never);
