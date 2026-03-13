import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Code splitting - separate vendor chunks
    rollupOptions: {
      output: {
        manualChunks: {
          // React core in separate chunk (cached longer)
          'react-vendor': ['react', 'react-dom'],
          // Router in separate chunk
          router: ['react-router-dom'],
          // Markdown rendering (heavy)
          markdown: ['react-markdown', 'rehype-sanitize'],
        },
      },
    },
    // Minification
    minify: 'esbuild',
    // Target modern browsers
    target: 'es2020',
    // Generate smaller chunks
    chunkSizeWarningLimit: 500,
  },
  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'axios'],
  },
  server: {
    // No aggressive caching in dev mode
  },
})
