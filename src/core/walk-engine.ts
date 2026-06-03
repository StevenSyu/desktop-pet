import { pickWalk, DEFAULT_WALK_BOUNDS, type WalkBounds, type WalkDirection } from './walk-planner'
import { shouldWalkNow } from './walk-decider'

// renderer 端自走的完整狀態機：何時走、走哪邊、何時取消、何時重排下一次。
// adapter（renderer/main.ts）只負責把 DOM/IPC 事件轉成 WalkEngineEvent、
// 把回傳的 commands 轉成 petBridge.walkStart/walkCancel。
// 走動位移本身（session/step/clamp）在 main process 的 walk-session。

export interface WalkEngineState {
  autoWalkEnabled: boolean
  walking: boolean
  direction: WalkDirection | null
  nextWalkAt: number
  bounds: WalkBounds
}

export type WalkEngineEvent =
  | { kind: 'prefs'; autoWalk: boolean; bounds: WalkBounds } // getPrefs 初載 / prefs-changed
  | { kind: 'autoWalk'; enabled: boolean } // 右鍵選單「自動走動」
  | { kind: 'walkEnded' } // main 推播：走完 / 被取消
  | { kind: 'direction'; direction: WalkDirection } // main 撞牆反轉
  | { kind: 'hidden' } // 視窗不可見 → 走動中取消
  | { kind: 'visible' } // 回到可見 → 重排下一次
  | { kind: 'interrupt' } // hover / 通知抵達 → 走動中取消
  | { kind: 'tick'; animation: string; hidden: boolean; hasCard: boolean }

export type WalkCommand =
  | { type: 'start'; direction: WalkDirection; distance: number; duration: number }
  | { type: 'cancel' }

export interface WalkEngineContext {
  now: number
  rng: () => number
}

export function initialWalkEngineState(rng: () => number, now: number): WalkEngineState {
  const bounds = { ...DEFAULT_WALK_BOUNDS }
  return {
    autoWalkEnabled: true,
    walking: false,
    direction: null,
    nextWalkAt: pickWalk(rng, now, bounds).nextWalkAt,
    bounds,
  }
}

// 取消語意：只發 cancel 指令，walking 不就地清掉——等 main 推 walkEnded 才轉 false，
// 與視窗位移實況保持單一事實來源（main 的 session）。
export function walkEngineReduce(
  state: WalkEngineState,
  event: WalkEngineEvent,
  ctx: WalkEngineContext,
): { state: WalkEngineState; commands: WalkCommand[] } {
  const repick = (s: WalkEngineState): WalkEngineState => ({
    ...s,
    nextWalkAt: pickWalk(ctx.rng, ctx.now, s.bounds).nextWalkAt,
  })

  switch (event.kind) {
    case 'prefs':
      return { state: repick({ ...state, autoWalkEnabled: event.autoWalk, bounds: event.bounds }), commands: [] }
    case 'autoWalk': {
      let next: WalkEngineState = { ...state, autoWalkEnabled: event.enabled }
      const commands: WalkCommand[] = !event.enabled && state.walking ? [{ type: 'cancel' }] : []
      if (event.enabled) next = repick(next)
      return { state: next, commands }
    }
    case 'walkEnded':
      return { state: repick({ ...state, walking: false, direction: null }), commands: [] }
    case 'direction':
      return { state: state.walking ? { ...state, direction: event.direction } : state, commands: [] }
    case 'hidden':
      return { state, commands: state.walking ? [{ type: 'cancel' }] : [] }
    case 'visible':
      return { state: repick(state), commands: [] }
    case 'interrupt':
      return { state, commands: state.walking ? [{ type: 'cancel' }] : [] }
    case 'tick': {
      if (
        event.hasCard ||
        !shouldWalkNow({
          autoWalkEnabled: state.autoWalkEnabled,
          walking: state.walking,
          animation: event.animation,
          hidden: event.hidden,
          now: ctx.now,
          nextWalkAt: state.nextWalkAt,
        })
      ) {
        return { state, commands: [] }
      }
      const w = pickWalk(ctx.rng, ctx.now, state.bounds)
      return {
        state: { ...state, walking: true, direction: w.direction, nextWalkAt: w.nextWalkAt },
        commands: [{ type: 'start', direction: w.direction, distance: w.distance, duration: w.duration }],
      }
    }
  }
}
