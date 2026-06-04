import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock electron：handleCommand 用 ipcMain；card-manager 本身不直接 import electron（型別除外）
const ipcMain = { on: vi.fn(), handle: vi.fn() }
vi.mock('electron', () => ({
  get ipcMain() {
    return ipcMain
  },
}))

import { initCardManager, type CardManagerDeps } from '../../src/main/card-manager'
import { busEmit } from '../../src/main/bus'
import type { CardView } from '../../src/core/card-view'
import { CARD_SPEC } from '../../src/core/card-layout'

// ===== fake BrowserWindow：只實作 card-manager 用到的面 =====
interface FakeWin {
  webContents: { once: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> }
  on: ReturnType<typeof vi.fn>
  isDestroyed: () => boolean
  isVisible: () => boolean
  showInactive: ReturnType<typeof vi.fn>
  hide: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  getBounds: () => { x: number; y: number; width: number; height: number }
  moveTop: ReturnType<typeof vi.fn>
  /** 測試手柄：觸發 did-finish-load */
  fireLoaded: () => void
  bounds: { x: number; y: number; width: number; height: number }
  visible: boolean
}

function fakeWin(): FakeWin {
  let loadedCb: (() => void) | null = null
  const w: FakeWin = {
    bounds: { x: 0, y: 0, width: CARD_SPEC.width, height: CARD_SPEC.height },
    visible: false,
    webContents: {
      once: vi.fn((ev: string, cb: () => void) => {
        if (ev === 'did-finish-load') loadedCb = cb
      }),
      send: vi.fn(),
    },
    on: vi.fn(),
    isDestroyed: () => false,
    isVisible: () => w.visible,
    showInactive: vi.fn(() => {
      w.visible = true
    }),
    hide: vi.fn(() => {
      w.visible = false
    }),
    close: vi.fn(),
    setBounds: vi.fn((b) => {
      w.bounds = b
    }),
    getBounds: () => w.bounds,
    moveTop: vi.fn(),
    fireLoaded: () => loadedCb?.(),
  }
  return w
}

function fakePet(x = 100, y = 100): FakeWin {
  const p = fakeWin()
  p.bounds = { x, y, width: 135, height: 146 }
  return p
}

const WORK_AREA = { x: 0, y: 0, width: 1440, height: 900 }

const view = (id: string): CardView => ({ id, type: 'done', label: '完成', body: 'b', source: 's', hasMore: false })

interface Setup {
  deps: CardManagerDeps
  cards: Map<string, FakeWin>
  pets: Map<string, FakeWin>
  onMore: ReturnType<typeof vi.fn>
  /** 取得已註冊的 IPC handler（模擬 renderer 端 command） */
  ipcHandler: (channel: string) => (payload: unknown) => void
}

function setup(petIds: string[] = ['all']): Setup & { manager: ReturnType<typeof initCardManager> } {
  ipcMain.on.mockClear()
  const cards = new Map<string, FakeWin>()
  const pets = new Map(petIds.map((id) => [id, fakePet()]))
  const onMore = vi.fn()
  const deps: CardManagerDeps = {
    createWindow: (channelId) => {
      const w = fakeWin()
      cards.set(channelId, w)
      return w as never
    },
    getPetWindow: (channelId) => pets.get(channelId) as never,
    workAreaFor: () => WORK_AREA,
    onDisplayChange: () => {},
    onMore,
  }
  const manager = initCardManager(deps)
  const ipcHandler = (channel: string) => {
    const entry = ipcMain.on.mock.calls.find((c) => c[0] === channel)
    if (!entry) throw new Error(`no handler for ${channel}`)
    const h = entry[1] as (e: unknown, payload: unknown) => void
    return (payload: unknown) => h({}, payload)
  }
  return { manager, deps, cards, pets, onMore, ipcHandler }
}

beforeEach(() => {
  ipcMain.on.mockClear()
})

describe('card-manager', () => {
  it('show 於未載入 → pending；did-finish-load 後 flush（card-data push + showInactive + 定位）', () => {
    const { manager, cards } = setup()
    manager.show('all', view('m1'))
    const w = cards.get('all')!
    expect(w.webContents.send).not.toHaveBeenCalled() // 未 loaded 不 flush
    w.fireLoaded()
    expect(w.webContents.send).toHaveBeenCalledWith('card-data', view('m1'))
    expect(w.showInactive).toHaveBeenCalled()
    expect(w.setBounds).toHaveBeenCalled() // reposition
  })

  it('dismissById 關掉所有顯示同 id 的卡片並通知各自寵物標已讀', () => {
    const { manager, cards, pets } = setup(['all', 'ch-1'])
    manager.show('all', view('m1'))
    manager.show('ch-1', view('m1'))
    cards.get('all')!.fireLoaded()
    cards.get('ch-1')!.fireLoaded()

    manager.dismissById('m1')

    for (const cid of ['all', 'ch-1']) {
      expect(cards.get(cid)!.hide).toHaveBeenCalled()
      expect(pets.get(cid)!.webContents.send).toHaveBeenCalledWith('card-dismissed', { id: 'm1' })
    }
  })

  it('dismissById 不同 id → 卡片不動（id 比對在 cardReduce）', () => {
    const { manager, cards } = setup()
    manager.show('all', view('m1'))
    cards.get('all')!.fireLoaded()
    manager.dismissById('other')
    expect(cards.get('all')!.hide).not.toHaveBeenCalled()
  })

  it('寵物拖動：drag-start 捕捉偏移 → pet-moved 以偏移直貼 → drag-end 後回翻轉定位', () => {
    const { manager, cards, pets } = setup()
    manager.show('all', view('m1'))
    const card = cards.get('all')!
    card.fireLoaded()
    const pet = pets.get('all')!

    // 卡片現位置與寵物的偏移
    busEmit('pet-drag-start', 'all')
    const offset = { x: card.bounds.x - pet.bounds.x, y: card.bounds.y - pet.bounds.y }

    // 拖動中：卡片 = 寵物新位置 + 偏移（直貼，無翻轉重算）
    busEmit('pet-moved', 'all', { x: 500, y: 300, width: 135, height: 146 })
    const dragged = card.setBounds.mock.calls.at(-1)![0]
    expect(dragged.x).toBe(500 + offset.x)
    expect(dragged.y).toBe(300 + offset.y)

    busEmit('pet-drag-end', 'all')
    busEmit('pet-moved', 'all', { x: 600, y: 300, width: 135, height: 146 })
    const after = card.setBounds.mock.calls.at(-1)![0]
    // offset 已清：回到 cardWindowBounds 翻轉定位（不等於直貼值）
    expect(after.x).not.toBe(600 + offset.x)
  })

  it('closeFor 關閉頻道卡片視窗', () => {
    const { manager, cards } = setup()
    manager.show('all', view('m1'))
    manager.closeFor('all')
    expect(cards.get('all')!.close).toHaveBeenCalled()
  })

  it('IPC card-clicked → dismiss；card-more → dismiss + onMore(channelId, id)', () => {
    const { manager, cards, onMore, ipcHandler } = setup()
    manager.show('all', view('m1'))
    cards.get('all')!.fireLoaded()

    ipcHandler('card-clicked')({ id: 'm1' })
    expect(cards.get('all')!.hide).toHaveBeenCalled()

    manager.show('all', view('m2'))
    ipcHandler('card-more')({ channelId: 'all', id: 'm2' })
    expect(onMore).toHaveBeenCalledWith('all', 'm2')
  })

  it('IPC show-card / hide-card 走同一生命週期', () => {
    const { cards, ipcHandler } = setup()
    ipcHandler('show-card')({ channelId: 'all', view: view('m9') })
    const w = cards.get('all')!
    w.fireLoaded()
    expect(w.webContents.send).toHaveBeenCalledWith('card-data', view('m9'))
    ipcHandler('hide-card')({ channelId: 'all' })
    expect(w.hide).toHaveBeenCalled()
  })
})
