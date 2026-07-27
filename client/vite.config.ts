import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Vite 配置：
// - dev server 代理 /api 到后端 Express（默认 3000 端口）
// - PWA：自动生成 manifest + Service Worker（离线缓存 + 可安装）
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '学习资料下载器',
        short_name: '下载器',
        description: '个人专用的 YouTube 学习资料下载工具',
        theme_color: '#2563eb',
        background_color: '#f9fafb',
        display: 'standalone',
        orientation: 'portrait-primary',
        scope: '/',
        start_url: '/',
        lang: 'zh-CN',
        icons: [
          {
            src: '/icon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
        ],
      },
      workbox: {
        // 预缓存应用 shell
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        // 运行时缓存：API 请求采用 NetworkFirst（优先网络，离线回退缓存）
        runtimeCaching: [
          {
            urlPattern: /^\/api\/(health|queue|history)/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5, // 5 分钟
              },
            },
          },
        ],
      },
      devOptions: {
        // 开发环境也启用 SW，便于调试
        enabled: true,
        type: 'module',
      },
    }),
  ],
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
