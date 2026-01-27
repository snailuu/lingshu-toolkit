import path from 'node:path';
import { defineConfig } from 'rspress/config';

export default defineConfig({
  base: '/lingshu-toolkit/',
  root: path.resolve(__dirname, 'src'),
  title: 'lingshu',
  route: {
    exclude: ['**/*.test.{ts,tsx,js,jsx}', '**/*.{ts,tsx,js,jsx}'],
  },
  themeConfig: {
    outlineTitle: '目录',
    prevPageText: '上一页',
    nextPageText: '下一页',
  },
  markdown: {
    showLineNumbers: true,
  },
});
