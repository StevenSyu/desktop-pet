import { defineConfig } from 'electron-vite'
import preact from '@preact/preset-vite'

export default defineConfig({
  main: {
    build: {
      rollupOptions: { input: { index: 'src/main/index.ts' } },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: { index: 'src/preload/index.ts', card: 'src/preload/card.ts', channels: 'src/preload/channels.ts' },
        // 強制 CommonJS + .cjs：sandbox 預設下 preload 必須是 CJS，
        // 否則 electron-vite 在 type:module 會輸出 .mjs 而載入失敗。
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    plugins: [preact()],
    build: {
      rollupOptions: {
        input: {
          index: 'src/renderer/index.html',
          center: 'src/renderer/center.html',
          settings: 'src/renderer/settings.html',
          skins: 'src/renderer/skins.html',
          card: 'src/renderer/card.html',
          channels: 'src/renderer/channels.html',
        },
      },
    },
  },
})
