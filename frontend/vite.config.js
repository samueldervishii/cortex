import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'react-vendor': ['react', 'react-dom'],
          router: ['react-router-dom'],
          markdown: ['react-markdown', 'rehype-sanitize', 'remark-gfm'],
        },
      },
    },
    minify: 'esbuild',
    target: 'es2020',
    chunkSizeWarningLimit: 500,
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'axios'],
  },
})
