import { describe, it, expect } from 'vitest'
import { cardReduce, initialCardState, type CardLifecycleState } from '../../src/core/card-lifecycle'
import type { CardView } from '../../src/core/card-view'

const view = (id: string): CardView => ({ id, type: 'done', label: '完成', body: 'b', source: 's', hasMore: false })

describe('cardReduce: show / loaded 時序', () => {
  it('已載入 → show 立即 flush', () => {
    const s: CardLifecycleState = { ...initialCardState, loaded: true }
    const r = cardReduce(s, { kind: 'show', view: view('m1') })
    expect(r.commands).toEqual([{ type: 'flush', view: view('m1') }])
    expect(r.state.activeId).toBe('m1')
    expect(r.state.pending).toBeNull()
  })
  it('未載入 → show 暫存 pending；loaded 補 flush 一次', () => {
    const r1 = cardReduce(initialCardState, { kind: 'show', view: view('m1') })
    expect(r1.commands).toEqual([])
    expect(r1.state.pending).toEqual(view('m1'))
    const r2 = cardReduce(r1.state, { kind: 'loaded' })
    expect(r2.commands).toEqual([{ type: 'flush', view: view('m1') }])
    expect(r2.state).toEqual({ loaded: true, pending: null, activeId: 'm1' })
  })
  it('載入前連續 show → 後者覆蓋 pending（只 flush 最新）', () => {
    const r1 = cardReduce(initialCardState, { kind: 'show', view: view('m1') })
    const r2 = cardReduce(r1.state, { kind: 'show', view: view('m2') })
    const r3 = cardReduce(r2.state, { kind: 'loaded' })
    expect(r3.commands).toEqual([{ type: 'flush', view: view('m2') }])
  })
})

describe('cardReduce: dismiss', () => {
  it('同 id → hide + notifyDismissed', () => {
    const s: CardLifecycleState = { loaded: true, pending: null, activeId: 'm1' }
    const r = cardReduce(s, { kind: 'dismiss', id: 'm1' })
    expect(r.commands).toEqual([{ type: 'hide' }, { type: 'notifyDismissed', id: 'm1' }])
    expect(r.state.activeId).toBeNull()
  })
  it('不同 id → no-op（防舊卡片誤關）', () => {
    const s: CardLifecycleState = { loaded: true, pending: null, activeId: 'm1' }
    const r = cardReduce(s, { kind: 'dismiss', id: 'other' })
    expect(r.commands).toEqual([])
    expect(r.state.activeId).toBe('m1')
  })
  it('載入中被 dismiss → loaded 後不得復活（ghost card regression）', () => {
    const r1 = cardReduce(initialCardState, { kind: 'show', view: view('m1') })
    const r2 = cardReduce(r1.state, { kind: 'dismiss', id: 'm1' })
    expect(r2.state.pending).toBeNull()
    const r3 = cardReduce(r2.state, { kind: 'loaded' })
    expect(r3.commands).toEqual([]) // 不 flush
  })
})

describe('cardReduce: hide', () => {
  it('清 pending/activeId + hide 指令', () => {
    const s: CardLifecycleState = { loaded: false, pending: view('m1'), activeId: 'm1' }
    const r = cardReduce(s, { kind: 'hide' })
    expect(r.state).toEqual({ loaded: false, pending: null, activeId: null })
    expect(r.commands).toEqual([{ type: 'hide' }])
  })
})
