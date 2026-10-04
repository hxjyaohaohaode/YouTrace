import { defineConfig } from 'vite'
import { execFileSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const isDevelopment = mode === 'development'
  let revision = 'unknown'
  try {
    revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], { encoding: 'utf8' }).trim()
    if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) revision += '-working-tree'
  } catch { /* exported source may not include Git metadata */ }

  const apiProxy = {
    '/api': {
      target: process.env.VITE_DEV_PROXY_TARGET || 'http://localhost:3000',
      changeOrigin: true,
    },
  }

  return {
    plugins: [react(), tailwindcss()],
    define: { __BUILD_REVISION__: JSON.stringify(revision) },
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
