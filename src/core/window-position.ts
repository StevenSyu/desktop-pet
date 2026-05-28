export interface DisplayInfo {
  id: number
  workArea: { x: number; y: number; width: number; height: number }
}

export interface WindowState {
  displayId: number
  x: number
  y: number
}

export interface WinSize {
  width: number
  height: number
}

export interface Point {
  x: number
  y: number
}

/** 給定 display 的工作區與視窗尺寸，回傳右下角座標。 */
export function defaultPosition(primary: DisplayInfo, win: WinSize, margin: number): Point {
  const { x, y, width, height } = primary.workArea
  return {
    x: x + width - win.width - margin,
    y: y + height - win.height - margin,
  }
}

/**
 * 若已儲存座標仍位於某 display 工作區內 → 回該座標；否則回 primary 預設。
 */
export function clampToValidPosition(
  saved: WindowState | null,
  displays: DisplayInfo[],
  primary: DisplayInfo,
  win: WinSize,
  margin: number,
): Point {
  if (!saved) return defaultPosition(primary, win, margin)
  const d = displays.find((x) => x.id === saved.displayId)
  if (!d) return defaultPosition(primary, win, margin)
  const wa = d.workArea
  const fitsX = saved.x >= wa.x && saved.x + win.width <= wa.x + wa.width
  const fitsY = saved.y >= wa.y && saved.y + win.height <= wa.y + wa.height
  if (!fitsX || !fitsY) return defaultPosition(primary, win, margin)
  return { x: saved.x, y: saved.y }
}
