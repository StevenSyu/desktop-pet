/// <reference path="../preload/api.d.ts" />

import { SPRITE_FORMAT } from '../core/sprite-format'
import { PetController } from '../core/pet-fsm'
import { DEFAULT_SKIN_ID } from '../core/skins'
import { pickWalk, DEFAULT_WALK_BOUNDS, type WalkBounds } from '../core/walk-planner'
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
  if (walking) window.petBridge.walkCancel()
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

// ===== 動畫驅動：setInterval 輪詢 FSM 並切 #pet[data-anim]；影格動畫由 CSS @keyframes 負責 =====
let currentAnim: string | null = null
let walking = false
let autoWalkEnabled = true
let walkBounds: WalkBounds = { ...DEFAULT_WALK_BOUNDS }
let nextWalkAt = pickWalk(Math.random, performance.now(), walkBounds).nextWalkAt

window.petBridge.getPrefs().then((p) => {
  autoWalkEnabled = p.autoWalk
  walkBounds = p.walk
  nextWalkAt = pickWalk(Math.random, performance.now(), walkBounds).nextWalkAt
})
window.petBridge.onAutoWalkChanged((enabled) => {
  autoWalkEnabled = enabled
  if (!enabled && walking) window.petBridge.walkCancel()
  if (enabled) nextWalkAt = pickWalk(Math.random, performance.now(), walkBounds).nextWalkAt
})
window.petBridge.onPrefsChanged((p) => {
  autoWalkEnabled = p.autoWalk
  walkBounds = p.walk
  nextWalkAt = pickWalk(Math.random, performance.now(), walkBounds).nextWalkAt
})

function setAnim(name: string): void {
  if (currentAnim === name) return
  currentAnim = name
  petEl.setAttribute('data-anim', name)
}

function tick(): void {
  const now = performance.now()
  const view = pet.advance(now)
  // 走動期間：保持 running-{left,right}，僅當 FSM 進入非 idle 反應（事件中斷）時才覆寫
  if (walking) {
    if (view.animation !== 'idle') setAnim(view.animation)
  } else {
    setAnim(view.animation)
  }
  // 僅 idle 且未在走動、未被暫停、自動走動開啟時觸發走動
  if (autoWalkEnabled && !walking && view.animation === 'idle' && !document.hidden && now >= nextWalkAt) {
    const w = pickWalk(Math.random, now, walkBounds)
    nextWalkAt = w.nextWalkAt // 即便走不動，也排下次
    walking = true
    setAnim(w.direction === 'right' ? 'running-right' : 'running-left')
    window.petBridge.walkStart({ direction: w.direction, distance: w.distance, duration: w.duration })
  }
}

window.petBridge?.onWalkEnded?.(() => {
  walking = false
  nextWalkAt = pickWalk(Math.random, performance.now(), walkBounds).nextWalkAt
})

// main 端方向反轉（撞牆 → 改向對面）時同步 CSS anim
window.petBridge?.onWalkDirection?.((direction) => {
  if (walking) setAnim(direction === 'right' ? 'running-right' : 'running-left')
})

let tickTimer: ReturnType<typeof setInterval> | null = setInterval(tick, 100)

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    petEl.setAttribute('data-paused', 'true')
    if (tickTimer) {
      clearInterval(tickTimer)
      tickTimer = null
    }
    if (walking) window.petBridge.walkCancel()
  } else {
    petEl.removeAttribute('data-paused')
    if (!tickTimer) tickTimer = setInterval(tick, 100)
    nextWalkAt = pickWalk(Math.random, performance.now(), walkBounds).nextWalkAt
  }
})

function bindHover(): void {
  const enableInteractive = () => window.petBridge.setInteractive(true)
  const disableInteractive = () => window.petBridge.setInteractive(false)
  const badge = document.querySelector<HTMLDivElement>('#badge')!

  petEl.addEventListener('mouseenter', enableInteractive)
  petEl.addEventListener('mouseleave', disableInteractive)
  cardsEl.addEventListener('mouseenter', enableInteractive)
  cardsEl.addEventListener('mouseleave', disableInteractive)
  badge.addEventListener('mouseenter', enableInteractive)
  badge.addEventListener('mouseleave', disableInteractive)
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

// 未讀徽章：訂閱 main 推送的未讀數，點擊開啟通知中心
const badgeEl = document.querySelector<HTMLDivElement>('#badge')!
badgeEl.addEventListener('click', () => window.petBridge.openCenter())
window.petBridge?.onUnreadCount?.((n) => {
  if (n > 0) {
    badgeEl.textContent = n > 99 ? '99+' : String(n)
    badgeEl.hidden = false
  } else {
    badgeEl.hidden = true
  }
})
