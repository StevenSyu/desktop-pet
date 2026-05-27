import { defineConfig } from 'electron-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: 'src/main/index.ts' } },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: 'src/preload/index.ts' },
        // 強制 CommonJS + .cjs：sandbox 預設下 preload 必須是 CJS，
        // 否則 electron-vite 在 type:module 會輸出 .mjs 而載入失敗。
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: { input: { index: 'src/renderer/index.html' } },
    },
  },
})
