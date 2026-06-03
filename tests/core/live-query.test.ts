import { describe, it, expect } from 'vitest'
import { liveQuery } from '../../src/core/live-query'

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => (resolve = r))
  return { promise, resolve }
}

describe('liveQuery', () => {
  it('一般情況：query 結果套用、之後 push 持續更新', async () => {
    const d = deferred<number>()
    let push!: (v: number) => void
    const got: number[] = []
    const done = liveQuery(() => d.promise, (cb) => (push = cb), (v) => got.push(v))
    d.resolve(1)
    await done
    expect(got).toEqual([1])
    push(2)
    expect(got).toEqual([1, 2])
  })

  it('push 先到 → 較舊的 query 結果被丟棄（不覆蓋新資料）', async () => {
    const d = deferred<number>()
    let push!: (v: number) => void
    const got: number[] = []
    const done = liveQuery(() => d.promise, (cb) => (push = cb), (v) => got.push(v))
    push(99) // query 完成前 push 先到
    d.resolve(1) // 較舊的初查結果
    await done
    expect(got).toEqual([99]) // 1 被丟棄
  })

  it('訂閱先行：query 進行中抵達的 push 不漏接', async () => {
    const d = deferred<number>()
    let push: ((v: number) => void) | null = null
    const got: number[] = []
    void liveQuery(() => d.promise, (cb) => (push = cb), (v) => got.push(v))
    expect(push).not.toBeNull() // subscribe 同步先掛好
    push!(7)
    expect(got).toEqual([7])
  })
})
