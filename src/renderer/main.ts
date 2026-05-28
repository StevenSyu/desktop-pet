/// <reference path="../preload/api.d.ts" />

import { SPRITE_FORMAT, frameRect, type AnimationName } from '../core/sprite-format'
import { PetController } from '../core/pet-fsm'
import { DEFAULT_SKIN_ID } from '../core/skins'
import type { AppEvent, NotifyType } from '../core/events'
import maySheet from '../../resources/pets/may/spritesheet.webp'
import marukoSheet from '../../resources/pets/maruko/spritesheet.webp'
import penguinSheet from '../../resources/pets/oil-king-penguin/spritesheet.webp'

const SHEET_URL: Record<string, string> = {
  'may': maySheet,
  'maruko': marukoSheet,
  'oil-king-penguin': penguinSheet,
}

const DISPLAY_SCALE = 0.7
// 狀態以文字標籤＋色彩（CSS 依 data-type 上色）呈現，不用 emoji
const LABEL: Record<NotifyType, string> = {
  done: '完成', attention: '需要注意', error: '錯誤', review: '請檢視', working: '工作中', info: '通知',
}

const petEl = document.querySelector<HTMLDivElement>('#pet')!
const cardsEl = document.querySelector<HTMLDivElement>('#cards')!
petEl.style.width = `${SPRITE_FORMAT.frameWidth * DISPLAY_SCALE}px`
petEl.style.height = `${SPRITE_FORMAT.frameHeight * DISPLAY_SCALE}px`
petEl.style.backgroundSize = `${SPRITE_FORMAT.sheetWidth * DISPLAY_SCALE}px ${SPRITE_FORMAT.sheetHeight * DISPLAY_SCALE}px`

function setSkin(id: string): void {
  petEl.style.backgroundImage = `url(${SHEET_URL[id] ?? SHEET_URL[DEFAULT_SKIN_ID]})`
}
setSkin(DEFAULT_SKIN_ID)

// 右鍵選單選擇造型 → 切換背景圖（所有造型共用同精靈格式，只換圖）
window.petBridge?.onSetSkin?.((id) => setSkin(id))

const pet = new PetController()

// 目前顯示的訊息：持久顯示、不自動消失。新訊息會替換，使用者點一下卡片才關閉。
let currentEvent: AppEvent | null = null

// optional-chaining 防護：即使 preload 載入失敗，idle 動畫迴圈仍會啟動
window.petBridge?.onPetEvent?.((event: AppEvent) => {
  pet.onEvent(event, performance.now())
  currentEvent = event
  renderCard()
})

function renderCard(): void {
  if (!currentEvent) {
    cardsEl.replaceChildren()
    return
  }
  const e = currentEvent
  // 用 textContent 安全建構，title/body 來自 POST，屬不可信內容。
  const card = document.createElement('div')
  card.className = 'card'
  card.dataset.type = e.type // CSS 依此上狀態色
  card.title = '點一下關閉'
  card.addEventListener('click', () => {
    window.petBridge?.markRead?.(e.id)
    currentEvent = null
    renderCard()
  })

  const label = document.createElement('div')
  label.className = 'card-label'
  label.textContent = LABEL[e.type]
  card.appendChild(label)

  if (e.body) {
    const body = document.createElement('div')
    body.className = 'card-body'
    body.textContent = e.body
    card.appendChild(body)
  }

  const sourceText = e.title || e.source.name || e.source.kind
  if (sourceText) {
    const source = document.createElement('div')
    source.className = 'card-source'
    source.textContent = sourceText
    card.appendChild(source)
  }

  cardsEl.replaceChildren(card)
}

function render(now: number): void {
  const view = pet.advance(now)
  const anim = SPRITE_FORMAT.animations[view.animation as AnimationName]
  // 所有動畫（含反應）持續循環輪播；反應由 FSM 維持約 3 秒後回 idle
  const frameIndex = Math.floor((now / 1000) * anim.fps) % anim.frames
  const rect = frameRect(anim.row, frameIndex)
  petEl.style.backgroundPosition = `-${rect.x * DISPLAY_SCALE}px -${rect.y * DISPLAY_SCALE}px`
  requestAnimationFrame(render)
}
requestAnimationFrame(render)

function bindHover(): void {
  const enableInteractive = () => window.petBridge.setInteractive(true)
  const disableInteractive = () => window.petBridge.setInteractive(false)

  petEl.addEventListener('mouseenter', enableInteractive)
  petEl.addEventListener('mouseleave', disableInteractive)
  cardsEl.addEventListener('mouseenter', enableInteractive)
  cardsEl.addEventListener('mouseleave', disableInteractive)
}

bindHover()

// 拖動寵物：自寫 pointer 處理（不用 -webkit-app-region: drag，避免破壞右鍵選單與 hover）
const DRAG_THRESHOLD = 3 // px：超過才算拖動，否則視為點擊（保留給未來互動）
let dragState: { startSx: number; startSy: number; moved: boolean } | null = null
let pendingDragMove: { sx: number; sy: number } | null = null
let dragMoveRaf = 0

function flushDragMove(): void {
  dragMoveRaf = 0
  if (pendingDragMove) {
    window.petBridge.dragMove(pendingDragMove.sx, pendingDragMove.sy)
    pendingDragMove = null
  }
}

petEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return // 只接左鍵；右鍵留給 contextmenu
  dragState = { startSx: e.screenX, startSy: e.screenY, moved: false }
  petEl.setPointerCapture(e.pointerId)
  window.petBridge.dragStart(e.screenX, e.screenY)
})

petEl.addEventListener('pointermove', (e) => {
  if (!dragState) return
  if (!dragState.moved) {
    const dx = Math.abs(e.screenX - dragState.startSx)
    const dy = Math.abs(e.screenY - dragState.startSy)
    if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return
    dragState.moved = true
  }
  pendingDragMove = { sx: e.screenX, sy: e.screenY }
  if (!dragMoveRaf) dragMoveRaf = requestAnimationFrame(flushDragMove)
})

function endDrag(e: PointerEvent): void {
  if (!dragState) return
  try {
    petEl.releasePointerCapture(e.pointerId)
  } catch {
    /* 已釋放 */
  }
  if (dragState.moved) {
    // 確保最後一次位置已送出
    if (dragMoveRaf) {
      cancelAnimationFrame(dragMoveRaf)
      flushDragMove()
    }
    window.petBridge.dragEnd()
  }
  dragState = null
}
petEl.addEventListener('pointerup', endDrag)
petEl.addEventListener('pointercancel', endDrag)

// 右鍵叫出原生選單（結束 may／未來通知中心）
document.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.petBridge?.showContextMenu?.()
})

// 未讀徽章：訂閱 main 推送的未讀數
const badgeEl = document.querySelector<HTMLDivElement>('#badge')!
window.petBridge?.onUnreadCount?.((n) => {
  if (n > 0) {
    badgeEl.textContent = n > 99 ? '99+' : String(n)
    badgeEl.hidden = false
  } else {
    badgeEl.hidden = true
  }
})
