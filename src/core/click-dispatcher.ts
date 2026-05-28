export const DEFAULT_DOUBLE_CLICK_MS = 300

/**
 * 給定「前次 click 時間」與「本次 click 時間」，回是 single 還是 double。
 *
 * 上層 caller 通常的用法：
 * - single：排一個 doubleClickMs 後 fire 的 timer；同時記下 lastClickAt = curr
 * - double：取消已排的 single timer；重置 lastClickAt = null；fire 雙擊行為
 *
 * 純函式：不持有狀態、不操作 timer。
 */
export function classifyClick(
  prevClickAt: number | null,
  currentAt: number,
  doubleClickMs: number = DEFAULT_DOUBLE_CLICK_MS,
): 'single' | 'double' {
  if (prevClickAt !== null && currentAt - prevClickAt <= doubleClickMs) {
    return 'double'
  }
  return 'single'
}
