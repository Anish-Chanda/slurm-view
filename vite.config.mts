import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],

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
