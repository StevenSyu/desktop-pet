import { contextBridge } from 'electron'
import type { CardView } from '../core/card-view'
import { sendCommand, subscribePush } from '../ipc/preload-helpers'

// 卡片視窗專用、最小權限 bridge：只收卡片資料、只回報點擊。不暴露 walk/prefs/skin 等。
contextBridge.exposeInMainWorld('cardBridge', {
  onCardData: (cb: (view: CardView) => void) => subscribePush('card-data', cb),
  cardClicked: (id: string) => sendCommand('card-clicked', { id }),
})
