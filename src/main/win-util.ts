import type { BrowserWindow } from 'electron'

export const isMac = process.platform === 'darwin'
export const isWindows = process.platform === 'win32'

type ToolWindowOptions = {
  title: string
}

/**
 * 桌面寵物相關視窗的「置頂」行為，依平台走不同 code，集中在此一處：
 * - macOS：`floating` 視窗層級；`allSpaces` 時跨所有 Spaces / 全螢幕可見（mac 專屬概念）。
 * - Windows / Linux：一般 `alwaysOnTop`（無 Spaces 概念，`floating` 層級與 setVisibleOnAllWorkspaces
 *   的 mac 語意不適用）。
 *
 * 把 mac 專屬呼叫收斂在此，避免散落各視窗、到非 mac 平台才出錯。
 */
export function pinWindow(win: BrowserWindow, allSpaces = false): void {
  if (isMac) {
    win.setAlwaysOnTop(true, 'floating')
    if (allSpaces) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } else {
    win.setAlwaysOnTop(true)
  }
}

export function toolWindowChrome({ title }: ToolWindowOptions): {
  title: string
  frame: boolean
  transparent: boolean
  resizable: boolean
  skipTaskbar: boolean
  hasShadow: boolean
  useContentSize?: boolean
} {
  if (isWindows) {
    return {
      title,
      frame: false,
      transparent: true,
      resizable: false,
      skipTaskbar: true,
      hasShadow: true,
    }
  }
  return {
    title,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: true,
  }
}
