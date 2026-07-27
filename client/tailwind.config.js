/** Tailwind CSS 配置 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // 使用 class 策略：通过在 <html> 上切换 .dark 类实现主题切换
  // 配合 prefers-color-scheme 媒体查询做系统偏好检测
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // 主色调：简洁的蓝灰色系
        primary: {
          50: '#f0f5ff',
          100: '#e0ebff',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
      },
    },
  },
  plugins: [],
};
