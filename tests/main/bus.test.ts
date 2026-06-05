import { describe, it, expect, vi } from 'vitest'
import { busEmit, busOn } from '../../src/main/bus'

describe('bus（main 內部事件匯流排契約）', () => {
  it('emit 帶 args 送達 listener', () => {
    const seen = vi.fn()
    const off = busOn('pet-moved', seen)
    busEmit('pet-moved', 'ch-1', { x: 1, y: 2, width: 3, height: 4 })
    expect(seen).toHaveBeenCalledWith('ch-1', { x: 1, y: 2, width: 3, height: 4 })
    off()
  })

  it('busOn 回傳 unsubscribe：呼叫後不再收到事件', () => {
    const seen = vi.fn()
    const off = busOn('open-settings', seen)
    busEmit('open-settings')
    off()
    busEmit('open-settings')
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('多 listener 同事件各自收到', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = busOn('close-pet', a)
    const offB = busOn('close-pet', b)
    busEmit('close-pet', 'ch-9')
    expect(a).toHaveBeenCalledWith('ch-9')
    expect(b).toHaveBeenCalledWith('ch-9')
    offA()
    offB()
  })

  it('unsubscribe 只移除自己，不影響其他 listener', () => {
    const a = vi.fn()
    const b = vi.fn()
    const offA = busOn('open-channels', a)
    const offB = busOn('open-channels', b)
    offA()
    busEmit('open-channels')
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledTimes(1)
    offB()
  })
})
