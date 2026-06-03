import { describe, it, expect } from 'vitest'
import {
  absorbMember,
  sourcePool,
  applySourceEvent,
  healKnownKinds,
  healSkins,
  sourceKey,
  type Channel,
  type ChannelState,
  type SourceEventOpts,
  type SourceMatch,
} from '../../src/core/channel'

const ch = (id: string, members: SourceMatch[], enabled = true, showPet = true): Channel => ({
  id,
  name: id,
  skin: 'may',
  enabled,
  showPet,
  members,
})

describe('sourceKey', () => {
  it('精確項與整類項鍵不同', () => {
    expect(sourceKey({ kind: 'claude-code', name: 'projA' })).not.toBe(sourceKey({ kind: 'claude-code' }))
  })
})

describe('absorbMember', () => {
  it('已存在（同 key）→ null', () => {
    expect(absorbMember([{ kind: 'k', name: 'a' }], { kind: 'k', name: 'a' })).toBeNull()
    expect(absorbMember([{ kind: 'k' }], { kind: 'k' })).toBeNull()
  })
  it('整類項加入時吸收同 kind 精確成員', () => {
    expect(absorbMember([{ kind: 'k', name: 'a' }, { kind: 'k', name: 'b' }], { kind: 'k' })).toEqual([{ kind: 'k' }])
  })
  it('整類項不吸收其他 kind 的成員', () => {
    expect(absorbMember([{ kind: 'x', name: 'a' }], { kind: 'k' })).toEqual([{ kind: 'x', name: 'a' }, { kind: 'k' }])
  })
  it('精確項直接加入、不吸收', () => {
    expect(absorbMember([{ kind: 'k', name: 'a' }], { kind: 'k', name: 'b' })).toEqual([
      { kind: 'k', name: 'a' },
      { kind: 'k', name: 'b' },
    ])
  })
})

describe('sourcePool', () => {
  it('排除已是成員（精確命中）與被整類涵蓋的來源', () => {
    const known: SourceMatch[] = [{ kind: 'k', name: 'a' }, { kind: 'k', name: 'b' }, { kind: 'x', name: 'c' }]
    // 成員有 k 整類 → k 的精確項全被涵蓋，只剩 x
    expect(sourcePool(known, ch('c1', [{ kind: 'k' }]))).toEqual([{ kind: 'x', name: 'c' }])
  })
  it('整類項本身已是成員 → 不再出現在池', () => {
    expect(sourcePool([{ kind: 'k' }], ch('c1', [{ kind: 'k' }]))).toEqual([])
  })
  it('依 kind 分組、整類項排組首、精確項依名稱排序', () => {
    const known: SourceMatch[] = [
      { kind: 'k', name: 'zz' },
      { kind: 'x', name: 'c' },
      { kind: 'k' },
      { kind: 'k', name: 'aa' },
      { kind: 'x' },
    ]
    expect(sourcePool(known, ch('c1', [{ kind: 'other', name: 'o' }]))).toEqual([
      { kind: 'k' },
      { kind: 'k', name: 'aa' },
      { kind: 'k', name: 'zz' },
      { kind: 'x' },
      { kind: 'x', name: 'c' },
    ])
  })
})

describe('applySourceEvent', () => {
  let seq = 0
  const opts = (over: Partial<SourceEventOpts> = {}): SourceEventOpts => ({
    defaultSkin: 'may',
    nextId: () => `ch-${++seq}`,
    maxKnown: 50,
    maxAuto: 50,
    ...over,
  })
  const state = (channels: Channel[], knownSources: SourceMatch[], allEnabled: boolean): ChannelState => ({
    channels,
    knownSources,
    allEnabled,
  })

  it('全新 kind+name（allEnabled 開）：補登精確+整類、建啟用頻道、不觸發死角', () => {
    const r = applySourceEvent(state([], [], true), { kind: 'gemini', name: 'myapp' }, opts())
    expect(r.knownChanged).toBe(true)
    expect(r.state.knownSources).toEqual([{ kind: 'gemini', name: 'myapp' }, { kind: 'gemini' }])
    expect(r.channelsChanged).toBe(true)
    expect(r.petsChanged).toBe(true)
    expect(r.state.channels).toHaveLength(1)
    expect(r.state.channels[0]).toMatchObject({ name: 'myapp', enabled: true, showPet: true, members: [{ kind: 'gemini', name: 'myapp' }] })
  })

  it('同 kind 第二來源：整類項不重複、再建一個啟用頻道', () => {
    const first = applySourceEvent(state([], [], true), { kind: 'gemini', name: 'myapp' }, opts())
    const r = applySourceEvent(first.state, { kind: 'gemini', name: 'proj2' }, opts())
    expect(r.state.knownSources.filter((s) => s.kind === 'gemini' && s.name == null)).toHaveLength(1)
    expect(r.state.channels).toHaveLength(2)
    expect(r.channelsChanged).toBe(true)
  })

  it('已知來源再進來：全 no-op（flags 全 false、state 不變）', () => {
    const first = applySourceEvent(state([], [], true), { kind: 'gemini', name: 'myapp' }, opts())
    const r = applySourceEvent(first.state, { kind: 'gemini', name: 'myapp' }, opts())
    expect(r.knownChanged).toBe(false)
    expect(r.channelsChanged).toBe(false)
    expect(r.petsChanged).toBe(false)
    expect(r.state.channels).toEqual(first.state.channels)
    expect(r.state.knownSources).toEqual(first.state.knownSources)
  })

  it('無 name 來源：只補整類項、不自動建頻道', () => {
    const r = applySourceEvent(state([], [], true), { kind: 'curl' }, opts())
    expect(r.state.knownSources).toEqual([{ kind: 'curl' }])
    expect(r.state.channels).toEqual([])
    expect(r.channelsChanged).toBe(false)
  })

  it('死角兜底：all 關 + 無 name 來源命中既有「停用」頻道 → 啟用它', () => {
    const disabled = ch('c1', [{ kind: 'curl' }], false)
    const r = applySourceEvent(state([disabled], [{ kind: 'curl' }], false), { kind: 'curl' }, opts())
    expect(r.state.channels[0]).toMatchObject({ enabled: true, showPet: true })
    expect(r.channelsChanged).toBe(true)
    expect(r.petsChanged).toBe(true)
  })

  it('死角但無任何命中頻道 → 不動', () => {
    const r = applySourceEvent(state([ch('other', [{ kind: 'x' }])], [], false), { kind: 'curl' }, opts())
    expect(r.state.channels[0].members).toEqual([{ kind: 'x' }])
    expect(r.petsChanged).toBe(false)
  })

  it('all 關 + 有 name 新來源：建啟用頻道後已涵蓋、死角不再二次動作', () => {
    const r = applySourceEvent(state([], [], false), { kind: 'gemini', name: 'myapp' }, opts())
    expect(r.state.channels).toHaveLength(1)
    expect(r.state.channels[0].enabled).toBe(true)
  })

  it('maxAuto 滿 → 不建頻道（known 照補）', () => {
    const full = [ch('c1', [{ kind: 'x', name: 'x1' }])]
    const r = applySourceEvent(state(full, [], true), { kind: 'gemini', name: 'myapp' }, opts({ maxAuto: 1 }))
    expect(r.state.channels).toHaveLength(1)
    expect(r.knownChanged).toBe(true)
  })

  it('maxKnown 滿 → known 不補', () => {
    const known: SourceMatch[] = [{ kind: 'a', name: 'a1' }]
    const r = applySourceEvent(state([], known, true), { kind: 'gemini', name: 'myapp' }, opts({ maxKnown: 1 }))
    expect(r.knownChanged).toBe(false)
    expect(r.state.knownSources).toEqual(known)
  })

  it('被使用者建的 kind 整類「顯示」頻道涵蓋 → 不死角；但精確頻道仍照建（停用情境見死角測試）', () => {
    const kindCh = ch('ck', [{ kind: 'gemini' }], true, true)
    const r = applySourceEvent(state([kindCh], [{ kind: 'gemini' }], false), { kind: 'gemini', name: 'newp' }, opts())
    // 精確頻道照建（啟用）；kind 頻道已涵蓋故無死角二次啟用
    expect(r.state.channels).toHaveLength(2)
  })
})

describe('healKnownKinds', () => {
  it('缺整類項的 kind 補上', () => {
    expect(healKnownKinds([{ kind: 'punchline', name: 'PunchLine' }], 50)).toEqual([
      { kind: 'punchline', name: 'PunchLine' },
      { kind: 'punchline' },
    ])
  })
  it('全部 kind 已有整類項 → null（無變）', () => {
    expect(healKnownKinds([{ kind: 'k', name: 'a' }, { kind: 'k' }], 50)).toBeNull()
  })
  it('maxKnown 滿 → 不補', () => {
    expect(healKnownKinds([{ kind: 'k', name: 'a' }], 1)).toBeNull()
  })
})

describe('healSkins', () => {
  const valid = new Set(['may', 'maruko'])
  it('指向不存在造型 → 回正 fallback', () => {
    const out = healSkins([ch('c1', [{ kind: 'k' }]), { ...ch('c2', [{ kind: 'x' }]), skin: 'ghost' }], valid, 'may')
    expect(out).not.toBeNull()
    expect(out![1].skin).toBe('may')
    expect(out![0].skin).toBe('may')
  })
  it('全部有效 → null（無變）', () => {
    expect(healSkins([ch('c1', [{ kind: 'k' }])], valid, 'may')).toBeNull()
  })
})
