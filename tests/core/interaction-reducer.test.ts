import { describe, it, expect } from 'vitest'
import {
  reduce,
  initialInteractionState,
  DEFAULT_INTERACTION_CONFIG,
  type InteractionState,
  type ReduceDeps,
} from '../../src/core/interaction-reducer'

// 固定 rng：永遠回 0 → 反應池第一個（waving）
function deps(now: number, rngValue = 0): ReduceDeps {
  return { now, rng: () => rngValue, config: DEFAULT_INTERACTION_CONFIG }
}

const S0 = initialInteractionState()

describe('pointerDown', () => {
  it('左鍵 → 建立 drag 狀態 + ipcDragStart effect', () => {
    const r = reduce(S0, { kind: 'pointerDown', sx: 100, sy: 50, button: 0 }, deps(0))
    expect(r.state.drag).toEqual({ startSx: 100, startSy: 50, moved: false, direction: null })
    expect(r.effects).toEqual([{ type: 'ipcDragStart', sx: 100, sy: 50 }])
  })
  it('非左鍵 → 不變、無 effect', () => {
    const r = reduce(S0, { kind: 'pointerDown', sx: 100, sy: 50, button: 2 }, deps(0))
    expect(r.state).toBe(S0)
    expect(r.effects).toEqual([])
  })
})

describe('pointerMove', () => {
  const downed = reduce(S0, { kind: 'pointerDown', sx: 100, sy: 50, button: 0 }, deps(0)).state

  it('未達拖動閾值 → 不算移動、無 effect', () => {
    const r = reduce(downed, { kind: 'pointerMove', sx: 102, sy: 51 }, deps(1))
    expect(r.state.drag?.moved).toBe(false)
    expect(r.effects).toEqual([])
  })
  it('超過拖動閾值 → moved=true + ipcDragMove', () => {
    const r = reduce(downed, { kind: 'pointerMove', sx: 105, sy: 50 }, deps(1))
    expect(r.state.drag?.moved).toBe(true)
    expect(r.effects).toEqual([{ type: 'ipcDragMove', sx: 105, sy: 50 }])
  })
  it('累計位移超過方向閾值 → 設定方向（右）', () => {
    const r = reduce(downed, { kind: 'pointerMove', sx: 120, sy: 50 }, deps(1))
    expect(r.state.drag?.direction).toBe('right')
  })
  it('往左拖 → direction=left', () => {
    const r = reduce(downed, { kind: 'pointerMove', sx: 80, sy: 50 }, deps(1))
    expect(r.state.drag?.direction).toBe('left')
  })
  it('沒有 drag 狀態時忽略', () => {
    const r = reduce(S0, { kind: 'pointerMove', sx: 200, sy: 50 }, deps(1))
    expect(r.state).toBe(S0)
    expect(r.effects).toEqual([])
  })
})

describe('pointerUp — 拖動結束', () => {
  it('有移動 → ipcDragEnd + 設定 suppressClickUntil + 清 drag', () => {
    let s = reduce(S0, { kind: 'pointerDown', sx: 100, sy: 50, button: 0 }, deps(0)).state
    s = reduce(s, { kind: 'pointerMove', sx: 130, sy: 50 }, deps(10)).state
    const r = reduce(s, { kind: 'pointerUp' }, deps(20))
    expect(r.effects).toEqual([{ type: 'ipcDragEnd' }])
    expect(r.state.drag).toBeNull()
    expect(r.state.suppressClickUntil).toBe(20 + DEFAULT_INTERACTION_CONFIG.justDraggedMs)
  })
})

describe('pointerUp — 點擊 / 雙擊', () => {
  function clickOnce(state: InteractionState, now: number) {
    const down = reduce(state, { kind: 'pointerDown', sx: 100, sy: 50, button: 0 }, deps(now)).state
    return reduce(down, { kind: 'pointerUp' }, deps(now))
  }

  it('單擊（無移動）→ 設 pendingClickAt、不開通知中心', () => {
    const r = clickOnce(S0, 1000)
    expect(r.state.pendingClickAt).toBe(1000)
    expect(r.effects).toEqual([])
  })

  it('300ms 內第二擊 → openCenter + 清 pendingClickAt', () => {
    const first = clickOnce(S0, 1000)
    const r = clickOnce(first.state, 1200) // 200ms 後
    expect(r.effects).toEqual([{ type: 'openCenter' }])
    expect(r.state.pendingClickAt).toBeNull()
  })

  it('超過 300ms 的第二擊 → 視為新的單擊', () => {
    const first = clickOnce(S0, 1000)
    const r = clickOnce(first.state, 1400) // 400ms 後
    expect(r.effects).toEqual([])
    expect(r.state.pendingClickAt).toBe(1400)
  })

  it('剛拖動完（suppressClickUntil 內）的點擊被忽略', () => {
    const suppressed: InteractionState = { ...S0, suppressClickUntil: 5000 }
    const r = clickOnce(suppressed, 4980) // < 5000
    expect(r.effects).toEqual([])
    expect(r.state.pendingClickAt).toBeNull()
  })
})

describe('hover', () => {
  it('idle 時 → 觸發 reaction（rng=0 → waving）', () => {
    const r = reduce(S0, { kind: 'hover' }, deps(500))
    expect(r.state.userAnim).toEqual({ name: 'waving', expiresAt: 500 + 1000 })
  })
  it('拖動中 → 不觸發', () => {
    const dragging = reduce(S0, { kind: 'pointerDown', sx: 1, sy: 1, button: 0 }, deps(0)).state
    const r = reduce(dragging, { kind: 'hover' }, deps(500))
    expect(r.state.userAnim).toBeNull()
  })
  it('反應進行中 → 不覆蓋', () => {
    const active: InteractionState = { ...S0, userAnim: { name: 'jumping', expiresAt: 9999 } }
    const r = reduce(active, { kind: 'hover' }, deps(500))
    expect(r.state.userAnim).toEqual({ name: 'jumping', expiresAt: 9999 })
  })
})

describe('externalEvent', () => {
  it('清掉 userAnim 與 pendingClickAt（FSM 反應接管）', () => {
    const s: InteractionState = {
      ...S0,
      userAnim: { name: 'waving', expiresAt: 9999 },
      pendingClickAt: 1000,
    }
    const r = reduce(s, { kind: 'externalEvent' }, deps(1100))
    expect(r.state.userAnim).toBeNull()
    expect(r.state.pendingClickAt).toBeNull()
  })
})

describe('tick', () => {
  it('userAnim 過期 → 清除', () => {
    const s: InteractionState = { ...S0, userAnim: { name: 'waving', expiresAt: 1000 } }
    expect(reduce(s, { kind: 'tick' }, deps(1000)).state.userAnim).toBeNull()
    expect(reduce(s, { kind: 'tick' }, deps(999)).state.userAnim).not.toBeNull()
  })
  it('單擊等待視窗到期 → 觸發反應並清 pendingClickAt', () => {
    const s: InteractionState = { ...S0, pendingClickAt: 1000 }
    const r = reduce(s, { kind: 'tick' }, deps(1300)) // 剛好 300ms
    expect(r.state.pendingClickAt).toBeNull()
    expect(r.state.userAnim).toEqual({ name: 'waving', expiresAt: 1300 + 1000 })
  })
  it('單擊等待視窗未到 → 不觸發', () => {
    const s: InteractionState = { ...S0, pendingClickAt: 1000 }
    const r = reduce(s, { kind: 'tick' }, deps(1200))
    expect(r.state.pendingClickAt).toBe(1000)
    expect(r.state.userAnim).toBeNull()
  })
})
