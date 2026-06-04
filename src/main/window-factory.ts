import { BrowserWindow, screen } from 'electron'
import { CARD_W, CARD_H } from '../core/card-layout'
import { join } from 'node:path'
import { pinWindow, toolWindowChrome } from './win-util'

// 工具視窗工廠：通知中心 / 卡片 / 進階設定 / 造型挑選 / 寵物設定 集中一處。
// 共同形狀：toolWindowChrome + 置中 + pinWindow + dev URL/檔案載入。

function centeredPos(w: number, h: number): { x: number; y: number } {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea
  return {
    x: x + Math.max(0, Math.floor((width - w) / 2)),
    y: y + Math.max(0, Math.floor((height - h) / 2)),
  }
}

function loadPage(win: BrowserWindow, page: string, query?: Record<string, string>): void {
  if (process.env.ELECTRON_RENDERER_URL) {
    const qs = query ? `?${new URLSearchParams(query)}` : ''
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/${page}${qs}`)
  } else {
    win.loadFile(join(__dirname, `../renderer/${page}`), query ? { query } : undefined)
  }
}

/**
 * 單例開窗器：已開則 focus（replace: true 改為關舊開新），關閉自動清引用。
 * current() 供推播端取得目前視窗（窗未開 → null，pushTo 自會 no-op）。
 */
export function makeOpener<A extends unknown[]>(
  create: (...args: A) => BrowserWindow,
  opts?: { replace?: boolean },
): { open: (...args: A) => BrowserWindow; current: () => BrowserWindow | null } {
  let win: BrowserWindow | null = null
  return {
    open(...args: A): BrowserWindow {
      if (win && !win.isDestroyed()) {
        if (!opts?.replace) {
          win.focus()
          return win
        }
        const old = win
        win = null
        old.close()
      }
      const w = create(...args)
      win = w
      w.on('closed', () => {
        if (win === w) win = null
      })
      return w
    },
    current(): BrowserWindow | null {
      return win && !win.isDestroyed() ? win : null
    },
  }
}

// ===== 通知中心 =====
export const CENTER_W = 360
export const CENTER_H = 480
const CENTER_MARGIN = 24
const PET_RESERVE = 320 // 寵物視窗高度的預留，讓中心落在寵物上方（fallback 用）

export function createCenterWindow(pos?: { x: number; y: number }): BrowserWindow {
  const { x, y, width, height } = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    ...toolWindowChrome({ title: '通知中心' }),
    width: CENTER_W,
    height: CENTER_H,
    x: pos?.x ?? x + width - CENTER_W - CENTER_MARGIN,
    y: pos?.y ?? Math.max(y + 8, y + height - CENTER_H - CENTER_MARGIN - PET_RESERVE),
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
    },
  })
  pinWindow(win, true)
  loadPage(win, 'center.html')
  // 失焦不自動關閉：避免點桌面卡片/寵物時連帶關掉通知中心（#4）。只由 ✕ / Esc 關。
  return win
}

// ===== 桌面卡片（無框透明，定位由 card-manager 控制；幾何常數在 core/card-layout）=====

export function createCardWindow(channelId: string): BrowserWindow {
  const { x, y } = screen.getPrimaryDisplay().workArea
  const win = new BrowserWindow({
    width: CARD_W,
    height: CARD_H,
    x, // 佔位座標，實際位置由 main 的 repositionCard() 設定
    y,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/card.cjs'),
    },
  })
  // 置頂 + 跨 Spaces / 全螢幕（mac）；非 mac 走一般 alwaysOnTop。建立時設一次避免閃爍
  pinWindow(win, true)
  loadPage(win, 'card.html', { c: channelId })
  return win
}

// ===== 進階設定 =====
const SETTINGS_W = 340
const SETTINGS_H = 620

export function createSettingsWindow(): BrowserWindow {
  // 矮螢幕 clamp 到工作區內；內容超出由 settings.html 的 .scroll 區捲動
  const h = Math.min(SETTINGS_H, screen.getPrimaryDisplay().workArea.height - 24)
  const win = new BrowserWindow({
    ...toolWindowChrome({ title: '進階設定' }),
    width: SETTINGS_W,
    height: h,
    ...centeredPos(SETTINGS_W, h),
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
    },
  })
  pinWindow(win)
  loadPage(win, 'settings.html')
  // 不在失焦時自動關閉（使用者可能要切回查看 may，避免誤關設定）。
  // 由視窗自身的「關閉」按鈕或 Esc 處理。
  return win
}

// ===== 造型挑選 =====
const SKIN_W = 480
const SKIN_H = 520

export function createSkinWindow(channelId: string): BrowserWindow {
  const win = new BrowserWindow({
    ...toolWindowChrome({ title: '更換造型' }),
    width: SKIN_W,
    height: SKIN_H,
    ...centeredPos(SKIN_W, SKIN_H),
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
    },
  })
  pinWindow(win)
  loadPage(win, 'skins.html', { c: channelId })
  return win
}

// ===== 寵物設定 =====
const CHANNELS_W = 480
const CHANNELS_H = 620

export function createChannelsWindow(): BrowserWindow {
  const win = new BrowserWindow({
    ...toolWindowChrome({ title: '寵物設定' }),
    width: CHANNELS_W,
    height: CHANNELS_H,
    ...centeredPos(CHANNELS_W, CHANNELS_H),
    alwaysOnTop: true,
    webPreferences: {
      preload: join(__dirname, '../preload/channels.cjs'),
    },
  })
  pinWindow(win)
  loadPage(win, 'channels.html')
  return win
}
