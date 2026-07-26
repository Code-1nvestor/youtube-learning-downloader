import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 配置：dev server 代理 /api 到后端 Express（默认 3000 端口）
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
