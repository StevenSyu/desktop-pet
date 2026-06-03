import { app } from 'electron'
import { loadPrefs, updatePrefs, type Prefs } from './prefs'

// prefs 的單一寫入 seam：main process 內所有讀寫都走這裡。
// - 讀：getPrefs()（首次讀檔後常駐記憶體，消除各處 loadPrefs 的 stale cache）
// - 寫：updatePrefsStore(partial)（合併寫檔 + 通知訂閱者帶 changed keys）
// 訂閱者依 changed keys 決定副作用（例：window.ts 只在 renderer 在乎的欄位變更時
// broadcast 'prefs-changed'，避免 channels/knownSources 高頻 persist 洗掉 renderer 狀態）。

type PrefsListener = (prefs: Prefs, changed: ReadonlySet<keyof Prefs>) => void

let cached: Prefs | null = null
const listeners: PrefsListener[] = []

export function getPrefs(): Prefs {
  if (!cached) cached = loadPrefs(app.getPath('userData'))
  return cached
}

export function updatePrefsStore(partial: Partial<Prefs>): Prefs {
  cached = updatePrefs(app.getPath('userData'), partial)
  const changed = new Set(Object.keys(partial) as (keyof Prefs)[])
  for (const l of listeners) l(cached, changed)
  return cached
}

export function subscribePrefs(l: PrefsListener): void {
  listeners.push(l)
}
