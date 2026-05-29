import { contextBridge, ipcRenderer } from 'electron'
import type { CardView } from '../core/card-view'

// 卡片視窗專用、最小權限 bridge：只收卡片資料、只回報點擊。不暴露 walk/prefs/skin 等。
// 直接用 ipcRenderer（不 import ipc/preload-helpers）：避免兩個 preload 入口共用該模組
// 被 rollup 抽成 chunks/*.cjs，導致 sandbox 化 preload 無法 require 而載入失敗。
contextBridge.exposeInMainWorld('cardBridge', {
  onCardData: (cb: (view: CardView) => void) =>
    ipcRenderer.on('card-data', (_e, view: CardView) => cb(view)),
  cardClicked: (id: string) => ipcRenderer.send('card-clicked', { id }),
  cardMore: (id: string) => ipcRenderer.send('card-more', { id }),
})
