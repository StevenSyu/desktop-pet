import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// prefs-store 有 module-level 狀態（cached、listeners）→ 每個測試 resetModules 重新 import
let userDataDir = ''
vi.mock('electron', () => ({
  app: { getPath: () => userDataDir },
}))

type Store = typeof import('../../src/main/prefs-store')

async function freshStore(): Promise<Store> {
  vi.resetModules()
  return import('../../src/main/prefs-store')
}

beforeEach(() => {
  userDataDir = mkdtempSync(join(tmpdir(), 'deskpet-prefs-store-'))
})

afterEach(() => {
  rmSync(userDataDir, { recursive: true, force: true })
})

describe('prefs-store（單一寫入 seam 契約）', () => {
  it('getPrefs 首讀後快取：同 instance 回同參照', async () => {
    const s = await freshStore()
    expect(s.getPrefs()).toBe(s.getPrefs())
  })

  it('updatePrefsStore 合併寫檔並更新快取', async () => {
    const s = await freshStore()
    s.updatePrefsStore({ dnd: true })
    expect(s.getPrefs().dnd).toBe(true)
    const onDisk = JSON.parse(readFileSync(join(userDataDir, 'prefs.json'), 'utf8'))
    expect(onDisk.dnd).toBe(true)
  })

  it('訂閱者收到新 prefs ＋ 正確 changed keys（只含本次 partial 的鍵）', async () => {
    const s = await freshStore()
    const seen: Array<{ dnd: boolean; changed: string[] }> = []
    s.subscribePrefs((p, changed) => seen.push({ dnd: p.dnd, changed: [...changed].sort() }))
    s.updatePrefsStore({ dnd: true, soundEnabled: false })
    expect(seen).toEqual([{ dnd: true, changed: ['dnd', 'soundEnabled'] }])
    s.updatePrefsStore({ allEnabled: false })
    expect(seen[1].changed).toEqual(['allEnabled'])
  })

  it('多個訂閱者都收到通知', async () => {
    const s = await freshStore()
    const a = vi.fn()
    const b = vi.fn()
    s.subscribePrefs(a)
    s.subscribePrefs(b)
    s.updatePrefsStore({ dnd: true })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
  })

  it('updatePrefsStore 回傳更新後的完整 prefs', async () => {
    const s = await freshStore()
    const next = s.updatePrefsStore({ soundEnabled: false })
    expect(next.soundEnabled).toBe(false)
    expect(next).toBe(s.getPrefs())
  })
})
