import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages 部署在 <user>.github.io/<repo>/ 子路徑時需要，
  // 用 VITE_BASE_PATH 覆寫；Netlify / Cloudflare Pages 根路徑留空即可。
  base: process.env.VITE_BASE_PATH || '/',
})
