/// <reference path="../preload/api.d.ts" />

import { SPRITE_FORMAT } from '../core/sprite-format'
import { PetController } from '../core/pet-fsm'
import { DEFAULT_SKIN_ID } from '../core/skins'
import { resolveAnimation, type AnimationContext } from '../core/anim-resolver'
import { initialWalkEngineState, walkEngineReduce, type WalkCommand, type WalkEngineEvent } from '../core/walk-engine'
import { stripMarkdown } from '../core/markdown-strip'
import { sanitizeLabelMode, shouldShowLabel, type ChannelLabelMode } from '../core/channel-label'
import { clampScale, scaleFromDrag } from '../core/pet-scale'
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
import { liveQuery } from '../core/live-query'

const myChannel = new URLSearchParams(location.search).get('c') ?? 'all'
const DISPLAY_SCALE = 0.7
const BASE_W = 135
const BASE_H = 146
// 狀態以文字標籤＋色彩（CSS 依 data-type 上色）呈現，不用 emoji
const LABEL: Record<NotifyType, string> = {
  done: '完成', attention: '需要注意', error: '錯誤', review: '請檢視', working: '工作中', info: '通知',
}

const shellEl = document.querySelector<HTMLDivElement>('#pet-shell')!
const petEl = document.querySelector<HTMLDivElement>('#pet')!
petEl.style.width = `${SPRITE_FORMAT.frameWidth * DISPLAY_SCALE}px`
petEl.style.height = `${SPRITE_FORMAT.frameHeight * DISPLAY_SCALE}px`
petEl.style.backgroundSize = `${SPRITE_FORMAT.sheetWidth * DISPLAY_SCALE}px ${SPRITE_FORMAT.sheetHeight * DISPLAY_SCALE}px`
const handleEl = document.querySelector<HTMLDivElement>('#resize-handle')!
const pomoBarEl = document.querySelector<HTMLDivElement>('#pomodoro-bar')!
const pomoTimeEl = document.querySelector<HTMLSpanElement>('#pomo-time')!
const pomoToggleEl = document.querySelector<HTMLButtonElement>('#pomo-toggle')!
const pomoStopEl = document.querySelector<HTMLButtonElement>('#pomo-stop')!
let scale = 1
function applyScale(): void { shellEl.style.transform = `scale(${scale})` }
window.petBridge.onSetScale((s) => { scale = clampScale(s); applyScale() })

// ===== 蕃茄鐘 hover bar 狀態 =====
type PomoSnapshot = { phase: 'idle' | 'work' | 'break'; paused: boolean; startedAt: number; durationMs: number; elapsedMs: number }
let pomoSnap: PomoSnapshot = { phase: 'idle', paused: false, startedAt: 0, durationMs: 0, elapsedMs: 0 }
let pomoEnabledGlobal = false  // prefs.pomodoro.enabled
let pomoShowOnAll = true       // prefs.pomodoro.showOnAll
let pomoChannelOn = false      // 此 channel 的 pomodoroEnabled（自訂 channel 用）
let pomoHovering = false
let pomoTickTimer: ReturnType<typeof setInterval> | null = null

function pomoVisible(): boolean {
  if (!pomoEnabledGlobal) return false
  return myChannel === 'all' ? pomoShowOnAll : pomoChannelOn
}

function pomoRemainingMs(): number {
  if (pomoSnap.phase === 'idle') return 0
  const run = pomoSnap.paused ? 0 : Date.now() - pomoSnap.startedAt
  return Math.max(0, pomoSnap.durationMs - pomoSnap.elapsedMs - run)
}

function fmtMmSs(ms: number): string {
  const s = Math.ceil(ms / 1000)
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

function renderPomoBar(): void {
  pomoBarEl.hidden = !(pomoVisible() && pomoHovering)
  if (pomoBarEl.hidden) return
  pomoBarEl.dataset.phase = pomoSnap.phase
  pomoBarEl.dataset.paused = String(pomoSnap.paused)
  if (pomoSnap.phase === 'idle') {
    pomoTimeEl.textContent = '--:--'
    pomoToggleEl.textContent = '▶'
    pomoToggleEl.title = '開始'
    pomoStopEl.disabled = true
  } else {
    pomoTimeEl.textContent = fmtMmSs(pomoRemainingMs())
    pomoToggleEl.textContent = pomoSnap.paused ? '▶' : '⏸'
    pomoToggleEl.title = pomoSnap.paused ? '繼續' : '暫停'
    pomoStopEl.disabled = false
  }
}

function syncPomoTicker(): void {
  const need = pomoVisible() && pomoHovering && pomoSnap.phase !== 'idle' && !pomoSnap.paused
  if (need && !pomoTickTimer) pomoTickTimer = setInterval(renderPomoBar, 1000)
  if (!need && pomoTickTimer) {
    clearInterval(pomoTickTimer)
    pomoTickTimer = null
  }
}

const labelEl = document.querySelector<HTMLDivElement>('#channel-label')!
let labelMode: ChannelLabelMode = 'hidden'
let labelHovering = false
let channelName = myChannel === 'all' ? '全部' : myChannel

function applyLabel(): void {
  labelEl.textContent = channelName
  labelEl.hidden = !shouldShowLabel(labelMode, labelHovering)
}

void liveQuery(
  () => window.petBridge.getChannels(),
  (cb) => window.petBridge.onChannelsUpdated(cb),
  (cs) => {
    if (myChannel !== 'all') {
      const ch = cs.find((c) => c.id === myChannel)
      if (ch) channelName = ch.name
    }
    applyLabel()
  },
)
void liveQuery(
  () => window.petBridge.getPrefs(),
  (cb) => window.petBridge.onPrefsChanged(cb),
  (p) => {
    labelMode = sanitizeLabelMode(p.channelLabelMode)
    applyLabel()
  },
)

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
    window.petBridge.dragMove(myChannel, pendingDragMove.sx, pendingDragMove.sy)
    pendingDragMove = null
  }
}

function applyEffect(eff: InteractionEffect): void {
  switch (eff.type) {
    case 'ipcDragStart':
      window.petBridge.dragStart(myChannel, eff.sx, eff.sy)
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
      window.petBridge.dragEnd(myChannel)
      break
    case 'openCenter':
      window.petBridge.openCenter(myChannel)
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
  walkDispatch({ kind: 'interrupt' }) // 走動中收到通知 → 立即停
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
  // 反應事件優先級高於本地互動 → 通知 reducer 清互動動畫與待觸發點擊
  dispatch({ kind: 'externalEvent' })
  currentEvent = event
  window.petBridge.showCard(myChannel, buildCardView(event))
  startReplay(event)
  refreshBadge()
})

// 勿擾開啟瞬間：清當前卡片與 replay，避免殘留卡片繼續 5 秒抽動畫
window.petBridge?.onDndOn?.(() => {
  currentEvent = null
  stopReplay()
  window.petBridge.hideCard(myChannel)
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

// ===== 自走狀態機（core walk-engine）：adapter 只轉事件、執行 start/cancel 指令 =====
let walkState = initialWalkEngineState(Math.random, performance.now())

function applyWalkCommand(cmd: WalkCommand): void {
  if (cmd.type === 'start') {
    window.petBridge.walkStart(myChannel, { direction: cmd.direction, distance: cmd.distance, duration: cmd.duration })
  } else {
    window.petBridge.walkCancel(myChannel)
  }
}

function walkDispatch(event: WalkEngineEvent, now = performance.now()): void {
  const r = walkEngineReduce(walkState, event, { now, rng: Math.random })
  walkState = r.state
  for (const cmd of r.commands) applyWalkCommand(cmd)
}

void liveQuery(
  () => window.petBridge.getPrefs(),
  (cb) => window.petBridge.onPrefsChanged(cb),
  (p) => walkDispatch({ kind: 'prefs', autoWalk: p.autoWalk, bounds: p.walk }),
)
window.petBridge.onAutoWalkChanged((enabled) => walkDispatch({ kind: 'autoWalk', enabled }))
window.petBridge?.onWalkEnded?.(() => walkDispatch({ kind: 'walkEnded' }))
// main 端方向反轉（撞牆 → 改向對面）時同步 direction
window.petBridge?.onWalkDirection?.((direction) => walkDispatch({ kind: 'direction', direction }))

// ===== 動畫驅動：setInterval 輪詢 FSM + 互動 reducer，切 #pet[data-anim] =====
let currentAnim: string | null = null

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
    walking: walkState.walking,
    walkDirection: walkState.direction,
  }
  setAnim(resolveAnimation(ctx))

  // 自走觸發（條件齊備時 engine 回傳 start 指令；有卡片時暫停自走）
  walkDispatch({ kind: 'tick', animation: view.animation, hidden: document.hidden, hasCard: !!currentEvent }, now)
}

let tickTimer: ReturnType<typeof setInterval> | null = setInterval(tick, 100)

document.addEventListener('visibilitychange', () => {
  petEl.removeAttribute('data-paused')
  if (!tickTimer) tickTimer = setInterval(tick, 100)
  walkDispatch({ kind: document.hidden ? 'hidden' : 'visible' })
})

function bindHover(): void {
  const enableInteractive = () => window.petBridge.setInteractive(myChannel, true)
  const disableInteractive = () => window.petBridge.setInteractive(myChannel, false)

  // hover 偵測綁在涵蓋整個視窗的 body（非 #pet）：把手（pointer-events:auto）疊在 #pet 右下角，
  // 若綁 #pet，滑鼠移到把手會觸發 #pet mouseleave → 隱藏把手 → 又落回 #pet mouseenter → 無限閃爍。
  // body 是 #pet/把手/名稱標籤的共同祖先，子元素間移動不會觸發 body 的 mouseleave。
  shellEl.addEventListener('mouseenter', () => {
    labelHovering = true
    applyLabel()
    handleEl.hidden = false
    enableInteractive()
    walkDispatch({ kind: 'interrupt' }) // 走動中被 hover → 立即停
    dispatch({ kind: 'hover' }) // 拖動中／反應中 reducer 自會略過
    pomoHovering = true
    syncPomoTicker()
    renderPomoBar()
  })
  shellEl.addEventListener('mouseleave', () => {
    labelHovering = false
    applyLabel()
    if (!resizing) {
      handleEl.hidden = true
      disableInteractive()
    }
    pomoHovering = false
    syncPomoTicker()
    renderPomoBar()
  })
}

bindHover()

let resizing = false
handleEl.addEventListener('pointerdown', (e) => {
  e.preventDefault(); e.stopPropagation()
  resizing = true
  handleEl.setPointerCapture(e.pointerId)
  window.petBridge.setInteractive(myChannel, true)
  const startScale = scale
  const startX = e.screenX, startY = e.screenY
  let raf = 0
  const onMove = (ev: PointerEvent) => {
    const next = scaleFromDrag(startScale, ev.screenX - startX, ev.screenY - startY, BASE_W, BASE_H)
    scale = next; applyScale()
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; window.petBridge.setScale(myChannel, scale) })
  }
  const onUp = () => {
    handleEl.releasePointerCapture(e.pointerId)
    handleEl.removeEventListener('pointermove', onMove)
    handleEl.removeEventListener('pointerup', onUp)
    resizing = false
    window.petBridge.setScale(myChannel, scale)
    if (!shellEl.matches(':hover')) {
      handleEl.hidden = true
      window.petBridge.setInteractive(myChannel, false)
    }
  }
  handleEl.addEventListener('pointermove', onMove)
  handleEl.addEventListener('pointerup', onUp)
})

// 拖動／點擊：pointer 事件轉成 reducer input；DOM pointer capture 留在 adapter
shellEl.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return // 只接左鍵；右鍵留給 contextmenu
  if (e.target === handleEl) return
  shellEl.setPointerCapture(e.pointerId)
  dispatch({ kind: 'pointerDown', sx: e.screenX, sy: e.screenY, button: e.button })
})

shellEl.addEventListener('pointermove', (e) => {
  if (!interactionState.drag) return
  dispatch({ kind: 'pointerMove', sx: e.screenX, sy: e.screenY })
})

function endDrag(e: PointerEvent): void {
  if (!interactionState.drag) return
  try {
    shellEl.releasePointerCapture(e.pointerId)
  } catch {
    /* 已釋放 */
  }
  dispatch({ kind: e.type === 'pointercancel' ? 'pointerCancel' : 'pointerUp' })
}
shellEl.addEventListener('pointerup', endDrag)
shellEl.addEventListener('pointercancel', endDrag)

// 右鍵叫出原生選單（結束 may／通知中心）
shellEl.addEventListener('contextmenu', (e) => {
  e.preventDefault()
  window.petBridge?.showContextMenu?.(myChannel)
})

// 未讀徽章：訂閱 main 推送的未讀數，點擊開啟通知中心
// 邏輯：總未讀 - 螢幕上正在顯示的卡片（=1）= 有效未讀數；為 0 時紅點隱藏
const badgeEl = document.querySelector<HTMLDivElement>('#badge')!
badgeEl.addEventListener('click', () => window.petBridge.openCenter(myChannel))
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

// ===== 蕃茄鐘 hover bar 事件接線 =====
void window.petBridge.getPomodoro().then((s) => {
  pomoSnap = s
  syncPomoTicker()
  renderPomoBar()
})
window.petBridge.onPomodoroChanged((s) => {
  pomoSnap = s
  syncPomoTicker()
  renderPomoBar()
})

// prefs（pomodoro key 在 PET_PREFS_KEYS，enabled/showOnAll 變化會推）
const applyPomoPrefs = (p: { pomodoro: { enabled: boolean; showOnAll: boolean }; allEnabled: boolean }): void => {
  pomoEnabledGlobal = p.pomodoro.enabled
  pomoShowOnAll = p.pomodoro.showOnAll && p.allEnabled
  syncPomoTicker()
  renderPomoBar()
}
void window.petBridge.getPrefs().then(applyPomoPrefs)
window.petBridge.onPrefsChanged(applyPomoPrefs)

// channels（per-channel pomodoroEnabled；broadcastChannels 修好後 pets 會收到）
const applyPomoChannels = (chs: { id: string; enabled: boolean; pomodoroEnabled: boolean }[]): void => {
  pomoChannelOn = chs.some((c) => c.id === myChannel && c.enabled && c.pomodoroEnabled)
  syncPomoTicker()
  renderPomoBar()
}
void window.petBridge.getChannels().then(applyPomoChannels)
window.petBridge.onChannelsUpdated(applyPomoChannels)

pomoBarEl.addEventListener('pointerdown', (e) => e.stopPropagation())

pomoToggleEl.addEventListener('click', (e) => {
  e.stopPropagation()
  if (pomoSnap.phase === 'idle') window.petBridge.pomodoroStart()
  else if (pomoSnap.paused) window.petBridge.pomodoroResume()
  else window.petBridge.pomodoroPause()
})
pomoStopEl.addEventListener('click', (e) => {
  e.stopPropagation()
  window.petBridge.pomodoroStop()
})
