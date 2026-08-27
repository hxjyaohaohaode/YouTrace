import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === 'development'

  const apiProxy = {
    '/api': {
      target: process.env.VITE_DEV_PROXY_TARGET || 'http://localhost:3000',
      changeOrigin: true,
    },
  }

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5180,
      proxy: isDevelopment ? apiProxy : undefined,
    },
    preview: {
      port: 4173,
      proxy: apiProxy,
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
    },
  }
})
