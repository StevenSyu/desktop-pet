// 蕃茄鐘 main 端 driver：setInterval 驅動 core reducer，phase 結束以 transient card 提醒。
// 蕃茄鐘是內建即時通知——繞過 ingest/MessageStore，不進通知中心（spec：訊息二分法）。

import {
  pomodoroReducer,
  initialPomodoroState,
  toSnapshot,
  type PomodoroState,
  type PomodoroEffect,
  type PomodoroAction,
} from '../core/pomodoro-timer'
import type { CardView } from '../core/card-view'
import { getPrefs, updatePrefsStore, subscribePrefs } from './prefs-store'
import { broadcastToPets, getPetWindow } from './window'
import { handleCommand } from '../ipc/main-helpers'

interface PomodoroDeps {
  /** 顯示一張卡片（index.ts 的 ensureCard + dispatchCard 包裝）。 */
  showCard: (channelId: string, view: CardView) => void
}

let state: PomodoroState
let timer: ReturnType<typeof setInterval> | null = null
let cardSeq = 0

function targets(): string[] {
  const p = getPrefs()
  const ids: string[] = []
  if (p.pomodoro.showOnAll && p.allEnabled) ids.push('all')
  for (const ch of p.channels) if (ch.pomodoroEnabled && ch.enabled && ch.showPet) ids.push(ch.id)
  return ids.filter((id) => getPetWindow(id) !== undefined)
}

function showInternal(deps: PomodoroDeps, view: Omit<CardView, 'id'>): void {
  if (getPrefs().dnd) return // 勿擾：與外部通知一致，吞掉（timer 照走）
  const id = `pomo-${++cardSeq}-${Date.now()}`
  for (const cid of targets()) deps.showCard(cid, { ...view, id })
}

function handleEffect(deps: PomodoroDeps, effect: PomodoroEffect): void {
  if (effect.type === 'notify-work-end') {
    showInternal(deps, {
      type: 'done',
      label: '🍅 休息一下！',
      body: '工作時間結束，好好休息。',
      source: '蕃茄鐘',
      hasMore: false,
      transient: { dismissMs: 5000 },
    })
  } else if (effect.type === 'notify-break-end') {
    showInternal(deps, {
      type: 'attention',
      label: '⏰ 繼續工作！',
      body: '休息結束，下一個蕃茄開始。',
      source: '蕃茄鐘',
      hasMore: false,
      transient: { dismissMs: 5000 },
    })
  }
}

function dispatch(deps: PomodoroDeps, action: PomodoroAction): void {
  const prev = state
  const r = pomodoroReducer(state, action)
  state = r.state
  handleEffect(deps, r.effect)
  // phase/paused/startedAt 任一變化 → 推快照（TICK 未達邊界回同參照，不會誤推）
  if (prev !== state) broadcastToPets('pomodoro-changed', toSnapshot(state))
}

function startInterval(deps: PomodoroDeps): void {
  if (timer) return
  timer = setInterval(() => dispatch(deps, { type: 'TICK', now: Date.now() }), 1000)
}

function stopInterval(): void {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

export function initPomodoro(deps: PomodoroDeps): void {
  state = initialPomodoroState(getPrefs().pomodoro)
  if (getPrefs().pomodoro.enabled) startInterval(deps)

  handleCommand('pomodoro-start', () => dispatch(deps, { type: 'START', now: Date.now() }))
  handleCommand('pomodoro-pause', () => dispatch(deps, { type: 'PAUSE', now: Date.now() }))
  handleCommand('pomodoro-resume', () => dispatch(deps, { type: 'RESUME', now: Date.now() }))
  handleCommand('pomodoro-stop', () => dispatch(deps, { type: 'STOP' }))
  handleCommand('set-pomodoro-prefs', (partial) => {
    const next = { ...getPrefs().pomodoro, ...partial }
    updatePrefsStore({ pomodoro: next }) // prefs-changed broadcast 由 subscribePrefs 統一處理
  })

  subscribePrefs((p, changed) => {
    if (!changed.has('pomodoro')) return
    if (p.pomodoro.enabled) {
      startInterval(deps)
      dispatch(deps, { type: 'CONFIGURE', prefs: { workMs: p.pomodoro.workMs, breakMs: p.pomodoro.breakMs, afterBreak: p.pomodoro.afterBreak } })
    } else {
      // 行為決策：關全域開關 → 立即停止回 idle
      dispatch(deps, { type: 'STOP' })
      stopInterval()
    }
  })
}
