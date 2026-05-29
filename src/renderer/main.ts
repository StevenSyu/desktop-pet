/// <reference path="../preload/api.d.ts" />

import { SPRITE_FORMAT } from '../core/sprite-format'
import { PetController } from '../core/pet-fsm'
import { DEFAULT_SKIN_ID } from '../core/skins'
import { pickWalk, DEFAULT_WALK_BOUNDS, type WalkBounds } from '../core/walk-planner'
import { resolveAnimation, type AnimationContext } from '../core/anim-resolver'
import { shouldWalkNow } from '../core/walk-decider'
import { stripMarkdown } from '../core/markdown-strip'
import {
  reduce,
  initialInteractionState,
  DEFAULT_INTERACTION_CONFIG,
  type InteractionInput,
  type InteractionEffect,
} from '../core/interaction-reducer'
import type { AppEvent, NotifyType } from '../core/events'
import type { CardView } from '../core/card-view'
import { cardSummary } from '../core/card-summary'

const DISPLAY_SCALE = 0.7
// 狀態以文字標籤＋色彩（CSS 依 data-type 上色）呈現，不用 emoji
const LABEL: Record<NotifyType, string> = {
  done: '完成', attention: '需要注意', error: '錯誤', review: '請檢視', working: '工作中', info: '通知',
}

const petEl = document.querySelector<HTMLDivElement>('#pet')!
petEl.style.width = `${SPRITE_FORMAT.frameWidth * DISPLAY_SCALE}px`
petEl.style.height = `${SPRITE_FORMAT.frameHeight * DISPLAY_SCALE}px`
petEl.style.backgroundSize = `${SPRITE_FORMAT.sheetWidth * DISPLAY_SCALE}px ${SPRITE_FORMAT.sheetHeight * DISPLAY_SCALE}px`

function setSkin(id: string): void {
  petEl.style.backgroundImage = `url(pet://${id}/sheet)`
}
setSkin(DEFAULT_SKIN_ID)

// 右鍵選單選擇造型 → 切換背景圖（所有造型共用同精靈格式，只換圖）
window.petBridge?.onSetSkin?.((id) => setSkin(id))

const pet = new PetController()

// ===== 互動狀態機（純函式 reducer）：drag / click / hover / reaction =====
// adapter 持有狀態、把 DOM/IPC 事件 dispatch 給 reducer，再執行回傳的 effects。
let interactionState = initialInteractionState()
let pendingDragMove: { sx: number; sy: number } | null = null
let dragMoveRaf = 0

function flushDragMove(): void {
  dragMoveRaf = 0
  if (pendingDragMove) {
    window.petBridge.dragMove(pendingDragMove.sx, pendingDragMove.sy)
    pendingDragMove = null
  }
}

function applyEffect(eff: InteractionEffect): void {
  switch (eff.type) {
    case 'ipcDragStart':
      window.petBridge.dragStart(eff.sx, eff.sy)
      break
    case 'ipcDragMove':
      // 以 rAF 合併位置更新，避免每次 pointermove 都打 IPC
      pendingDragMove = { sx: eff.sx, sy: eff.sy }
      if (!dragMoveRaf) dragMoveRaf = requestAnimationFrame(flushDragMove)
      break
    case 'ipcDragEnd':
      if (dragMoveRaf) {
        cancelAnimationFrame(dragMoveRaf)
        flushDragMove()
      }
      window.petBridge.dragEnd()
      break
    case 'openCenter':
      window.petBridge.openCenter()
      break
  }
}

function dispatch(input: InteractionInput, now = performance.now()): void {
  const r = reduce(interactionState, input, { now, rng: Math.random, config: DEFAULT_INTERACTION_CONFIG })
  interactionState = r.state
  for (const eff of r.effects) applyEffect(eff)
}

// 目前顯示的訊息：持久顯示、不自動消失。新訊息會替換，使用者點一下卡片才關閉。
let currentEvent: AppEvent | null = null

// 卡片仍在時每隔 REPLAY_INTERVAL_MS 重播一次對應動畫，提高遠處發現率。
// info（→ idle）不重播；視窗不可見也跳過。
const REPLAY_INTERVAL_MS = 5_000
let replayTimer: ReturnType<typeof setInterval> | null = null

function stopReplay(): void {
  if (replayTimer) {
    clearInterval(replayTimer)
    replayTimer = null
  }
}

function applyEvent(event: AppEvent): void {
  pet.onEvent(event, performance.now())
  if (walking) window.petBridge.walkCancel()
}

function startReplay(event: AppEvent): void {
  stopReplay()
  if (event.type === 'info') return
  replayTimer = setInterval(() => {
    if (document.hidden) return
    if (currentEvent) applyEvent(currentEvent)
  }, REPLAY_INTERVAL_MS)
}

// optional-chaining 防護：即使 preload 載入失敗，idle 動畫迴圈仍會啟動
window.petBridge?.onPetEvent?.((event: AppEvent) => {
  applyEvent(event)
  currentEvent = event
  window.petBridge.showCard(buildCardView(event))
  startReplay(event)
  refreshBadge()
  // 反應事件優先級高於本地互動 → 通知 reducer 清互動動畫與待觸發點擊
  dispatch({ kind: 'externalEvent' })
})

// 勿擾開啟瞬間：清當前卡片與 replay，避免殘留卡片繼續 5 秒抽動畫
window.petBridge?.onDndOn?.(() => {
  currentEvent = null
  stopReplay()
  window.petBridge.hideCard()
  refreshBadge()
})

// 卡片被點 → main 已關卡片視窗，這裡只清狀態 + 標已讀（id 比對防舊卡片誤清）
window.petBridge?.onCardDismissed?.(({ id }) => {
  if (!currentEvent || currentEvent.id !== id) return
  window.petBridge.markRead(id)
  currentEvent = null
  stopReplay()
  refreshBadge()
})

function buildCardView(e: AppEvent): CardView {
  const sourceText = e.title || e.source.name || e.source.kind
  const sessionTag =
    e.sessionId && e.sessionId !== 'default' ? `#${e.sessionId.slice(0, 6)}` : ''
  const source = [sourceText, sessionTag].filter(Boolean).join(' · ')
  const s = cardSummary(e.body ? stripMarkdown(e.body) : '')
  return {
    id: e.id,
    type: e.type,
    label: LABEL[e.type],
    body: s.text,
    source,
    hasMore: s.hasMore,
  }
}

// ===== 動畫驅動：setInterval 輪詢 FSM + 互動 reducer，切 #pet[data-anim] =====
let currentAnim: string | null = null
let walking = false
let autoWalkEnabled = true
let walkBounds: WalkBounds = { ...DEFAULT_WALK_BOUNDS }
let nextWalkAt = pickWalk(Math.random, performance.now(), walkBounds).nextWalkAt
let walkDirection: 'left' | 'right' | null = null

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
  dispatch({ kind: 'tick' }, now) // 過期清 userAnim、單擊等待到期觸發反應
  const view = pet.advance(now)

  const ctx: AnimationContext = {
    fsmAnimation: view.animation,
    dragMoved: interactionState.drag?.moved ?? false,
    dragDirection: interactionState.drag?.direction ?? null,
    userAnim: interactionState.userAnim?.name ?? null,
    walking,
    walkDirection,
  }
  setAnim(resolveAnimation(ctx))

  // 自走觸發（idle 且未走動、未隱藏、自動走動開啟、到時間；有卡片時暫停自走）
  if (
    !currentEvent &&
    shouldWalkNow({ autoWalkEnabled, walking, animation: view.animation, hidden: document.hidden, now, nextWalkAt })
  ) {
    const w = pickWalk(Math.random, now, walkBounds)
    nextWalkAt = w.nextWalkAt
    walking = true
    walkDirection = w.direction
    window.petBridge.walkStart({ direction: w.direction, distance: w.distance, duration: w.duration })
  }
}

window.petBridge?.onWalkEnded?.(() => {
  walking = false
  walkDirection = null
  nextWalkAt = pickWalk(Math.random, performance.now(), walkBounds).nextWalkAt
})

// main 端方向反轉（撞牆 → 改向對面）時同步 walkDirection
window.petBridge?.onWalkDirection?.((direction) => {
  if (walking) walkDirection = direction
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

  petEl.addEventListener('mouseenter', () => {
    enableInteractive()
    if (walking) window.petBridge.walkCancel() // 走動中被 hover → 立即停
    dispatch({ kind: 'hover' }) // 拖動中／反應中 reducer 自會略過
  })
  petEl.addEventListener('mouseleave', disableInteractive)
  badge.addEventListener('mouseenter', enableInteractive)
  badge.addEventListener('mouseleave', disableInteractive)
}

bindHover()

// 拖動／點擊：pointer 事件轉成 reducer input；DOM pointer capture 留在 adapter
petEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return // 只接左鍵；右鍵留給 contextmenu
  petEl.setPointerCapture(e.pointerId)
  dispatch({ kind: 'pointerDown', sx: e.screenX, sy: e.screenY, button: e.button })
})

petEl.addEventListener('pointermove', (e) => {
  if (!interactionState.drag) return
  dispatch({ kind: 'pointerMove', sx: e.screenX, sy: e.screenY })
})

function endDrag(e: PointerEvent): void {
  if (!interactionState.drag) return
  try {
    petEl.releasePointerCapture(e.pointerId)
  } catch {
    /* 已釋放 */
  }
  dispatch({ kind: e.type === 'pointercancel' ? 'pointerCancel' : 'pointerUp' })
}
petEl.addEventListener('pointerup', endDrag)
petEl.addEventListener('pointercancel', endDrag)

// 右鍵叫出原生選單（結束 may／通知中心）
document.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.petBridge?.showContextMenu?.()
})

// 未讀徽章：訂閱 main 推送的未讀數，點擊開啟通知中心
// 邏輯：總未讀 - 螢幕上正在顯示的卡片（=1）= 有效未讀數；為 0 時紅點隱藏
const badgeEl = document.querySelector<HTMLDivElement>('#badge')!
badgeEl.addEventListener('click', () => window.petBridge.openCenter())
let lastUnreadCount = 0
function refreshBadge(): void {
  const visibleAndUnread = currentEvent ? 1 : 0
  const effective = Math.max(0, lastUnreadCount - visibleAndUnread)
  badgeEl.hidden = effective === 0
}
window.petBridge?.onUnreadCount?.((n) => {
  lastUnreadCount = n
  refreshBadge()
})
