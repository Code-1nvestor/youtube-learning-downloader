/** Tailwind CSS 配置 */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
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
