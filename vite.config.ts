import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  // 使用相对资源路径，兼容 GitHub Pages 的仓库子路径。
  base: './',
});
