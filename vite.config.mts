import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],

  root: 'src/client',

  // Relative asset paths so the built client works from the nested
  // /react/ route, locally and under an OOD base path.
  base: './',

  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },

  build: {
    outDir: '../../dist/client',
    emptyOutDir: true,
  },
})
