import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'

// `npm run build:single` → dist-single/index.html 한 파일로 번들 (아티팩트 게시용)
export default defineConfig(({ mode }) => ({
  base: './', // GitHub Pages 하위 경로(/human-3dsim/)에서도 동작하도록 상대 경로
  plugins: mode === 'single' ? [react(), viteSingleFile()] : [react()],
  build: mode === 'single'
    ? { outDir: 'dist-single', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 4000 }
    : { chunkSizeWarningLimit: 2000 },
}))
