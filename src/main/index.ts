import { app, BrowserWindow, screen } from 'electron'
import { createPetWindow, getSkinSheetPath } from './window'
import { createCenterWindow } from './center-window'
import { createCardWindow, CARD_W, CARD_H, CARD_GAP } from './card-window'
import { createSettingsWindow } from './settings-window'
import { createSkinWindow } from './skin-window'
import { cardPosition } from '../core/card-position'
import type { CardView } from '../core/card-view'
import { registerPetScheme, registerPetProtocol } from './pet-protocol'
import { findFreePort, generateToken, writeEndpointFile } from './endpoint'
import { startIngestServer } from './ingest'
import { MessageStore } from '../core/message-store'
import { bus } from './bus'
import { loadPrefs } from './prefs'
import { handleCommand, handleQuery, pushTo } from '../ipc/main-helpers'
import type { AppEvent } from '../core/events'

// pet: scheme 必須在 app ready 前註冊（一次）
registerPetScheme()

const store = new MessageStore()
let petWindow: BrowserWindow | null = null
let centerWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let skinWindow: BrowserWindow | null = null
let cardWindow: BrowserWindow | null = null
let cardLoaded = false
let pendingCard: CardView | null = null
let activeCardId: string | null = null
let dndEnabled = false

function broadcastUnread(): void {
  pushTo(petWindow, 'unread-count', store.unreadCount())
}
function broadcastMessages(): void {
  pushTo(centerWindow, 'messages-updated', store.list())
}

function openCenter(): void {
  if (centerWindow && !centerWindow.isDestroyed()) {
    centerWindow.focus()
    return
  }
  centerWindow = createCenterWindow()
  centerWindow.on('closed', () => {
    centerWindow = null
  })
  centerWindow.webContents.once('did-finish-load', () => broadcastMessages())
}

function ensureCardWindow(): BrowserWindow {
  if (cardWindow && !cardWindow.isDestroyed()) return cardWindow
  cardLoaded = false
  cardWindow = createCardWindow()
  cardWindow.webContents.once('did-finish-load', () => {
    cardLoaded = true
    flushCard()
  })
  cardWindow.on('closed', () => {
    cardWindow = null
    cardLoaded = false
  })
  return cardWindow
}

// 若卡片可見，依寵物 bounds 重新定位卡片並置頂（兩窗同為 floating，需 moveTop 保證在寵物上）
function repositionCard(): void {
  if (!cardWindow || cardWindow.isDestroyed() || !cardWindow.isVisible()) return
  if (!petWindow || petWindow.isDestroyed()) return
  const pet = petWindow.getBounds()
  const display = screen.getDisplayMatching(pet)
  const pos = cardPosition(pet, { width: CARD_W, height: CARD_H }, display.workArea, CARD_GAP)
  cardWindow.setPosition(pos.x, pos.y)
  cardWindow.moveTop()
}

function flushCard(): void {
  if (!pendingCard || !cardWindow || cardWindow.isDestroyed()) return
  pushTo(cardWindow, 'card-data', pendingCard)
  cardWindow.showInactive() // 顯示但不搶焦點
  repositionCard()
  pendingCard = null
}

app.whenReady().then(async () => {
  registerPetProtocol(getSkinSheetPath) // 在任何載入 pet: 的視窗前
  petWindow = createPetWindow()
  petWindow.on('closed', () => {
    if (cardWindow && !cardWindow.isDestroyed()) cardWindow.close()
  })

  dndEnabled = loadPrefs(app.getPath('userData')).dnd
  bus.on('dnd-changed', (enabled: boolean) => {
    dndEnabled = enabled
  })

  const port = await findFreePort()
  const token = generateToken()
  writeEndpointFile(app.getPath('userData'), { port, token })

  startIngestServer({
    port,
    token,
    onEvent: (event: AppEvent) => {
      store.push(event)
      broadcastUnread()
      broadcastMessages()
      if (dndEnabled) return // 勿擾模式：不彈卡片、不演反應動畫
      pushTo(petWindow, 'pet-event', event)
    },
  })

  handleCommand('mark-read', (id) => {
    store.markRead(id)
    broadcastUnread()
    broadcastMessages()
  })
  handleCommand('mark-all-read', () => {
    store.markAllRead()
    broadcastUnread()
    broadcastMessages()
  })
  handleCommand('clear-messages', () => {
    store.clear()
    broadcastUnread()
    broadcastMessages()
  })
  handleQuery('get-messages', () => store.list())

  handleCommand('show-card', (view) => {
    activeCardId = view.id
    pendingCard = view
    ensureCardWindow()
    if (cardLoaded) flushCard()
    // 未載入完成則由 did-finish-load → flushCard 處理
  })
  handleCommand('hide-card', () => {
    activeCardId = null
    pendingCard = null
    if (cardWindow && !cardWindow.isDestroyed()) cardWindow.hide()
  })
  handleCommand('card-clicked', ({ id }) => {
    if (id !== activeCardId) return // 舊卡片殘留點擊：忽略
    activeCardId = null
    if (cardWindow && !cardWindow.isDestroyed()) cardWindow.hide()
    pushTo(petWindow, 'card-dismissed', { id })
  })

  bus.on('pet-moved', repositionCard) // 拖動 / display-removed 重吸附後同步卡片
  screen.on('display-metrics-changed', repositionCard) // 解析度 / 排列變更

  bus.on('open-center', openCenter)
  bus.on('open-settings', () => {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.focus()
      return
    }
    settingsWindow = createSettingsWindow()
    settingsWindow.on('closed', () => {
      settingsWindow = null
    })
  })
  bus.on('open-skins', () => {
    if (skinWindow && !skinWindow.isDestroyed()) {
      skinWindow.focus()
      return
    }
    skinWindow = createSkinWindow()
    skinWindow.on('closed', () => {
      skinWindow = null
    })
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) petWindow = createPetWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
