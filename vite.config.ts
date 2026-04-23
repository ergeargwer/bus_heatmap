import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/tdx-auth': {
        target: 'https://tdx.transportdata.tw',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tdx-auth/, ''),
      },
      '/tdx-api': {
        target: 'https://tdx.transportdata.tw',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/tdx-api/, ''),
      },
    },
  },
})
