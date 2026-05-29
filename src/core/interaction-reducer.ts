// ============================================================================
// 寵物互動狀態機（純函式 reducer）
// ============================================================================
//
// 把原本散在 renderer pointer handlers + onPetEvent 裡的互動 ordering/timing 規則
// 收進一個可測純函式：drag vs click 判定、拖動方向、double-click、justDragged
// 抑制、hover/click 觸發反應動畫、reaction 生命週期。
//
// 關鍵手法：所有計時（單擊等待雙擊的 300ms、拖動後抑制點擊的 60ms、reaction
// 過期）都以「時間戳 + tick 輪詢」表達，不用 setTimeout/setInterval——reducer
// 因此是純函式，注入 now / rng，完全可測。
//
// reduce(state, input, deps) → { state, effects }
//   - state：下一個互動狀態（不可變，回新物件）
//   - effects：要由 adapter（renderer）執行的副作用（IPC 呼叫）

export interface InteractionConfig {
  dragThreshold: number // px：超過才算拖動，否則視為點擊
  dirThreshold: number // px：累計位移超過才判定方向，避免抖動
  doubleClickMs: number // 兩次點擊間隔 <= 此值視為雙擊
  justDraggedMs: number // 拖動結束後此毫秒內的點擊一律忽略
  reactionPool: readonly string[] // 點擊／hover 隨機反應動畫池
  reactionDurationMs: Record<string, number> // 各反應動畫一輪時長
}

export const DEFAULT_INTERACTION_CONFIG: InteractionConfig = {
  dragThreshold: 3,
  dirThreshold: 8,
  doubleClickMs: 300,
  justDraggedMs: 60,
  reactionPool: ['waving', 'jumping', 'review'],
  reactionDurationMs: { waving: 1000, jumping: 1000, review: 1750 },
}

export interface UserAnim {
  name: string
  expiresAt: number
}

export interface DragState {
  startSx: number
  startSy: number
  moved: boolean
  direction: 'left' | 'right' | null
}

export interface InteractionState {
  userAnim: UserAnim | null
  drag: DragState | null
  pendingClickAt: number | null // 單擊等待雙擊視窗中；到期未等到第二擊則觸發反應
  suppressClickUntil: number // 拖動結束後的點擊抑制窗（時間戳）
}

export function initialInteractionState(): InteractionState {
  return { userAnim: null, drag: null, pendingClickAt: null, suppressClickUntil: 0 }
}

export type InteractionInput =
  | { kind: 'pointerDown'; sx: number; sy: number; button: number }
  | { kind: 'pointerMove'; sx: number; sy: number }
  | { kind: 'pointerUp' }
  | { kind: 'pointerCancel' }
  | { kind: 'hover' }
  | { kind: 'externalEvent' } // 收到 pet-event：FSM 反應接管，清互動動畫與待觸發點擊
  | { kind: 'tick' }

export type InteractionEffect =
  | { type: 'ipcDragStart'; sx: number; sy: number }
  | { type: 'ipcDragMove'; sx: number; sy: number }
  | { type: 'ipcDragEnd' }
  | { type: 'openCenter' }

export interface ReduceDeps {
  now: number
  rng: () => number
  config: InteractionConfig
}

export interface ReduceResult {
  state: InteractionState
  effects: InteractionEffect[]
}

function pickReaction(state: InteractionState, deps: ReduceDeps): InteractionState {
  const { rng, config, now } = deps
  const pool = config.reactionPool
  const name = pool[Math.floor(rng() * pool.length)]
  const duration = config.reactionDurationMs[name] ?? 1000
  return { ...state, userAnim: { name, expiresAt: now + duration } }
}

export function reduce(
  state: InteractionState,
  input: InteractionInput,
  deps: ReduceDeps,
): ReduceResult {
  const { now, config } = deps
  const noEffects: InteractionEffect[] = []

  switch (input.kind) {
    case 'pointerDown': {
      if (input.button !== 0) return { state, effects: noEffects } // 只接左鍵
      return {
        state: { ...state, drag: { startSx: input.sx, startSy: input.sy, moved: false, direction: null } },
        effects: [{ type: 'ipcDragStart', sx: input.sx, sy: input.sy }],
      }
    }

    case 'pointerMove': {
      const drag = state.drag
      if (!drag) return { state, effects: noEffects }
      let moved = drag.moved
      if (!moved) {
        const dx = Math.abs(input.sx - drag.startSx)
        const dy = Math.abs(input.sy - drag.startSy)
        if (dx < config.dragThreshold && dy < config.dragThreshold) {
          return { state, effects: noEffects } // 未達拖動閾值
        }
        moved = true
      }
      // 累計位移判方向
      let direction = drag.direction
      const cumDx = input.sx - drag.startSx
      if (Math.abs(cumDx) > config.dirThreshold) {
        direction = cumDx > 0 ? 'right' : 'left'
      }
      return {
        state: { ...state, drag: { ...drag, moved, direction } },
        effects: [{ type: 'ipcDragMove', sx: input.sx, sy: input.sy }],
      }
    }

    case 'pointerUp':
    case 'pointerCancel': {
      const drag = state.drag
      if (!drag) return { state, effects: noEffects }
      if (drag.moved) {
        // 真的拖動了 → 結束拖動 + 設定點擊抑制窗
        return {
          state: { ...state, drag: null, suppressClickUntil: now + config.justDraggedMs },
          effects: [{ type: 'ipcDragEnd' }],
        }
      }
      // 沒移動 → 視為點擊
      const cleared: InteractionState = { ...state, drag: null }
      if (now < state.suppressClickUntil) {
        return { state: cleared, effects: noEffects } // 剛拖完的殘餘點擊，忽略
      }
      const isDouble = state.pendingClickAt !== null && now - state.pendingClickAt <= config.doubleClickMs
      if (isDouble) {
        return {
          state: { ...cleared, pendingClickAt: null },
          effects: [{ type: 'openCenter' }],
        }
      }
      // 單擊：開始等待雙擊視窗（反應在 tick 到期時觸發）
      return { state: { ...cleared, pendingClickAt: now }, effects: noEffects }
    }

    case 'hover': {
      // 拖動中或反應中不打斷
      if (state.drag || state.userAnim) return { state, effects: noEffects }
      return { state: pickReaction(state, deps), effects: noEffects }
    }

    case 'externalEvent': {
      // FSM 反應優先，清掉本地互動動畫與待觸發點擊
      return { state: { ...state, userAnim: null, pendingClickAt: null }, effects: noEffects }
    }

    case 'tick': {
      let next = state
      // userAnim 過期清除
      if (next.userAnim && now >= next.userAnim.expiresAt) {
        next = { ...next, userAnim: null }
      }
      // 單擊等待視窗到期且未等到第二擊 → 觸發反應
      if (next.pendingClickAt !== null && now - next.pendingClickAt >= config.doubleClickMs) {
        next = pickReaction({ ...next, pendingClickAt: null }, deps)
      }
      return { state: next, effects: noEffects }
    }
  }
}
