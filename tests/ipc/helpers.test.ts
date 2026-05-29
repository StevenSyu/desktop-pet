import { describe, it, expect, vi, beforeEach } from 'vitest'

// mock electron（preload-helpers 用 ipcRenderer；main-helpers 用 ipcMain）
const ipcRenderer = { send: vi.fn(), invoke: vi.fn(), on: vi.fn() }
const ipcMain = { on: vi.fn(), handle: vi.fn() }
vi.mock('electron', () => ({
  get ipcRenderer() {
    return ipcRenderer
  },
  get ipcMain() {
    return ipcMain
  },
}))

import { sendCommand, invokeQuery, subscribePush } from '../../src/ipc/preload-helpers'
import { handleCommand, handleQuery, pushTo } from '../../src/ipc/main-helpers'

beforeEach(() => {
  ipcRenderer.send.mockReset()
  ipcRenderer.invoke.mockReset()
  ipcRenderer.on.mockReset()
  ipcMain.on.mockReset()
  ipcMain.handle.mockReset()
})

describe('sendCommand', () => {
  it('帶 payload 的 channel → ipcRenderer.send(channel, payload)', () => {
    sendCommand('set-dnd', true)
    expect(ipcRenderer.send).toHaveBeenCalledWith('set-dnd', true)
  })
  it('void channel → ipcRenderer.send(channel) 不帶第二引數', () => {
    sendCommand('drag-end')
    expect(ipcRenderer.send).toHaveBeenCalledWith('drag-end')
  })
})

describe('invokeQuery', () => {
  it('轉發 ipcRenderer.invoke 並回傳其 promise', async () => {
    ipcRenderer.invoke.mockResolvedValue(true)
    const r = await invokeQuery('get-dnd')
    expect(ipcRenderer.invoke).toHaveBeenCalledWith('get-dnd')
    expect(r).toBe(true)
  })
})

describe('subscribePush', () => {
  it('註冊 ipcRenderer.on，事件觸發時把 payload 傳給 cb', () => {
    const cb = vi.fn()
    subscribePush('unread-count', cb)
    expect(ipcRenderer.on).toHaveBeenCalledWith('unread-count', expect.any(Function))
    // 模擬 main 推來事件
    const listener = ipcRenderer.on.mock.calls[0][1] as (e: unknown, p: unknown) => void
    listener({}, 7)
    expect(cb).toHaveBeenCalledWith(7)
  })
})

describe('handleCommand', () => {
  it('註冊 ipcMain.on，收到時把 payload 傳給 handler', () => {
    const fn = vi.fn()
    handleCommand('set-dnd', fn)
    expect(ipcMain.on).toHaveBeenCalledWith('set-dnd', expect.any(Function))
    const listener = ipcMain.on.mock.calls[0][1] as (e: unknown, p: unknown) => void
    listener({}, false)
    expect(fn).toHaveBeenCalledWith(false)
  })
})

describe('handleQuery', () => {
  it('註冊 ipcMain.handle', () => {
    handleQuery('get-dnd', () => true)
    expect(ipcMain.handle).toHaveBeenCalledWith('get-dnd', expect.any(Function))
  })
})

describe('pushTo', () => {
  function fakeWin(destroyed: boolean) {
    return {
      isDestroyed: () => destroyed,
      webContents: { send: vi.fn() },
    }
  }

  it('窗存在且未銷毀 → webContents.send(channel, payload)', () => {
    const win = fakeWin(false)
    // pushTo 型別要 BrowserWindow，測試用結構相容的 fake
    pushTo(win as never, 'unread-count', 3)
    expect(win.webContents.send).toHaveBeenCalledWith('unread-count', 3)
  })
  it('null → no-op', () => {
    expect(() => pushTo(null, 'unread-count', 3)).not.toThrow()
  })
  it('已銷毀 → 不送', () => {
    const win = fakeWin(true)
    pushTo(win as never, 'unread-count', 3)
    expect(win.webContents.send).not.toHaveBeenCalled()
  })
  it('void payload channel → 只送 channel', () => {
    const win = fakeWin(false)
    pushTo(win as never, 'dnd-on')
    expect(win.webContents.send).toHaveBeenCalledWith('dnd-on')
  })
})
