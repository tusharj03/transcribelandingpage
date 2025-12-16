import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    proxy: {
      '/api/llm': {
        target: 'https://toolkit.rork.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/llm/, '/text/llm/'),
        configure: (proxy, _options) => {
          proxy.on('proxyReq', (proxyReq, _req, _res) => {
            proxyReq.setHeader('Origin', 'https://toolkit.rork.com');
            proxyReq.setHeader('Referer', 'https://toolkit.rork.com/');
            proxyReq.setHeader('User-Agent', 'resonote/1.2.0');
          });
        },
      },
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        secure: false,
      },
    },
  },
})
