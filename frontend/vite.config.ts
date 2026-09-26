import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// data/ holds the CC BY-NC licensed ASL-LEX extract and lives outside this
// package on purpose, so the licence boundary stays visible. Allow the dev
// server to read it.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    fs: { allow: ['..'] },
    proxy: {
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
      '/ws': { target: 'ws://127.0.0.1:8000', ws: true },
    },
  },
})
