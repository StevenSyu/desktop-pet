import type { BrowserWindow } from 'electron'
import { cardReduce, initialCardState, type CardEvent, type CardCommand, type CardLifecycleState } from '../core/card-lifecycle'
import { cardWindowBounds, CARD_SPEC } from '../core/card-layout'
import type { CardView } from '../core/card-view'
import type { Rect } from '../core/card-position'
import { busOn, type PetBounds } from './bus'
import { handleCommand, pushTo } from '../ipc/main-helpers'

// 卡片視窗管理（Card Manager）：core 的 cardReduce 管 show/loaded/hide/dismiss 時序決策，
// 這裡持有 BrowserWindow 與 per-channel 狀態、執行指令副作用（顯示/隱藏/定位/通知已讀），
// 並自訂閱 bus 的寵物拖動事件做卡片同步。Electron 能力以 deps 注入（測試面）。

export interface CardManagerDeps {
  /** 建立卡片視窗（window-factory 的 createCardWindow）。 */
  createWindow: (channelId: string) => BrowserWindow
  /** 取對應寵物視窗（不存在 → undefined；pushTo 對 null 自 no-op）。 */
  getPetWindow: (channelId: string) => BrowserWindow | undefined
  /** 取包含指定 bounds 的螢幕工作區（screen.getDisplayMatching(...).workArea）。 */
  workAreaFor: (bounds: Rect) => Rect
  /** 訂閱顯示器配置變更（解析度/排列），觸發全卡片重定位。 */
  onDisplayChange: (cb: () => void) => void
  /** 「更多」點擊：開通知中心詳情（center 概念，由 index.ts 注入）。 */
  onMore: (channelId: string, id: string) => void
}

export interface CardManager {
  /** 顯示一張卡片（未載入完成 → reducer 暫存 pending，loaded 事件補 flush）。 */
  show: (channelId: string, view: CardView) => void
  /** 關閉指定頻道卡片視窗（頻道寵物收掉時連帶收卡片）。 */
  closeFor: (channelId: string) => void
}

interface CardState {
  win: BrowserWindow
  state: CardLifecycleState // show/loaded/hide/dismiss 時序決策在 core 的 cardReduce
  dragOffset: { x: number; y: number } | null
}

export function initCardManager(deps: CardManagerDeps): CardManager {
  const cards = new Map<string, CardState>()

  function ensure(channelId: string): CardState {
    const existing = cards.get(channelId)
    if (existing && !existing.win.isDestroyed()) return existing
    const win = deps.createWindow(channelId)
    const cs: CardState = { win, state: { ...initialCardState }, dragOffset: null }
    cards.set(channelId, cs)
    win.webContents.once('did-finish-load', () => dispatch(channelId, { kind: 'loaded' }))
    win.on('closed', () => {
      if (cards.get(channelId) === cs) cards.delete(channelId)
    })
    return cs
  }

  function exec(channelId: string, cs: CardState, cmd: CardCommand): void {
    switch (cmd.type) {
      case 'flush':
        if (cs.win.isDestroyed()) return
        pushTo(cs.win, 'card-data', cmd.view)
        cs.win.showInactive() // 顯示但不搶焦點
        reposition(channelId)
        break
      case 'hide':
        if (!cs.win.isDestroyed()) cs.win.hide()
        break
      case 'notifyDismissed':
        pushTo(deps.getPetWindow(channelId), 'card-dismissed', { id: cmd.id })
        break
    }
  }

  function dispatch(channelId: string, event: CardEvent): void {
    const cs = cards.get(channelId)
    if (!cs) return
    const r = cardReduce(cs.state, event)
    cs.state = r.state
    for (const cmd of r.commands) exec(channelId, cs, cmd)
  }

  // 若卡片可見，依寵物 bounds 重新定位卡片並置頂（兩窗同為 floating，需 moveTop 保證在寵物上）
  function reposition(channelId: string, bringToFront = true, movedBounds?: PetBounds): void {
    const cs = cards.get(channelId)
    const pet = deps.getPetWindow(channelId)
    if (!cs || cs.win.isDestroyed() || !cs.win.isVisible() || !pet) return
    const petBounds = movedBounds ?? pet.getBounds()
    // 幾何決策在 core 的 cardWindowBounds（drag 同步偏移 / 可見卡翻轉 + 陰影外擴）
    cs.win.setBounds(cardWindowBounds(petBounds, deps.workAreaFor(petBounds), CARD_SPEC, cs.dragOffset))
    if (!cs.dragOffset && bringToFront) cs.win.moveTop()
  }

  function startDragSync(channelId: string): void {
    const cs = cards.get(channelId)
    const pet = deps.getPetWindow(channelId)
    if (!cs || cs.win.isDestroyed() || !cs.win.isVisible() || !pet) return
    reposition(channelId, false)
    const cardBounds = cs.win.getBounds()
    const petBounds = pet.getBounds()
    cs.dragOffset = { x: cardBounds.x - petBounds.x, y: cardBounds.y - petBounds.y }
  }

  function endDragSync(channelId: string): void {
    const cs = cards.get(channelId)
    if (cs) cs.dragOffset = null
  }

  function dismissById(id: string): void {
    // 同訊息可能在多隻寵物各彈一張：點關一張即連帶關掉其餘同 id 的（id 比對在 cardReduce）
    for (const cid of cards.keys()) dispatch(cid, { kind: 'dismiss', id })
  }

  // ===== IPC：卡片 domain 的 command handler 歸本 module 註冊 =====
  handleCommand('show-card', ({ channelId, view }) => {
    ensure(channelId)
    dispatch(channelId, { kind: 'show', view })
  })
  handleCommand('hide-card', ({ channelId }) => dispatch(channelId, { kind: 'hide' }))
  handleCommand('card-clicked', ({ id }) => dismissById(id))
  handleCommand('card-more', ({ channelId, id }) => {
    dismissById(id) // 開詳情前先關掉所有同 id 卡片
    deps.onMore(channelId, id)
  })

  // ===== bus：寵物拖動 / 位移 → 卡片同步 =====
  busOn('pet-drag-start', (channelId) => startDragSync(channelId))
  busOn('pet-drag-end', (channelId) => endDragSync(channelId))
  busOn('pet-moved', (channelId, bounds) => reposition(channelId, false, bounds)) // 拖動 / display-removed 重吸附後同步
  deps.onDisplayChange(() => {
    for (const id of cards.keys()) reposition(id) // 解析度 / 排列變更
  })

  return {
    show: (channelId, view) => {
      ensure(channelId)
      dispatch(channelId, { kind: 'show', view })
    },
    closeFor: (channelId) => {
      const cs = cards.get(channelId)
      if (cs && !cs.win.isDestroyed()) cs.win.close()
    },
  }
}
