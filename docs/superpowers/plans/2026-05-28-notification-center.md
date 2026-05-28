# 通知中心 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增通知中心——所有事件進入訊息庫（歷史、已讀/未讀、容量上限），寵物顯示未讀徽章，右鍵選單開啟一個獨立面板視窗瀏覽/篩選/標記，長訊息可截斷展開；保留現有單張即時卡片。

**Architecture:** 核心 `MessageStore`（純 TS、可測）住在 main 行程當單一真實來源；ingest 事件 push 進庫並廣播未讀數給寵物視窗、廣播清單給通知中心視窗；通知中心是獨立 BrowserWindow（第二 renderer 入口 `center.html`），透過 IPC 取清單/標已讀/清空；右鍵選單以 main 端 event bus 觸發開窗。

**Tech Stack:** TypeScript、Electron、electron-vite、Vitest、Playwright(_electron)。沿用既有 `src/core`、`src/main`、`src/renderer`、`src/preload`。

**設計來源：** `docs/superpowers/specs/2026-05-28-notification-center-design.md`

**前置：** 目前分支 feat/phase3-hookkit（含 Hook Kit、視窗/卡片功能）。本計畫接續其上。

**注意：**
- 所有 commit 訊息結尾附：`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`
- 需要網路/啟動 GUI 的步驟由 Claude 執行（Codex 沙箱無網路、無法啟動 GUI）。純邏輯 TDD 任務可由 Codex 完成。

---

## File Structure

```
desktop-notify/
├── src/core/
│   ├── message-store.ts        # 新：MessageStore（取代 notification-queue.ts）
│   └── time-format.ts          # 新：relativeTime / timeGroup（純函式）
├── src/main/
│   ├── index.ts                # 改：持有 store、ingest push、未讀/清單廣播、IPC、open-center
│   ├── window.ts               # 改：右鍵「通知中心」改為啟用 → bus.emit('open-center')
│   ├── center-window.ts        # 新：建立/定位/失焦關閉 通知中心視窗
│   └── bus.ts                  # 新：main 端 EventEmitter（選單 → 開窗 解耦）
├── src/preload/
│   ├── index.ts                # 改：加未讀/中心相關 API（兩視窗共用此 preload）
│   └── api.d.ts                # 改：型別
├── src/renderer/
│   ├── index.html              # 改：加未讀徽章元素 #badge
│   ├── main.ts                 # 改：未讀徽章、卡片點擊 markRead、body 截斷
│   ├── styles.css              # 改：徽章樣式、card-body 截斷
│   ├── center.html             # 新：通知中心視窗頁面
│   ├── center.ts               # 新：清單/篩選/時間分組/已讀未讀/動作/展開
│   └── center.css              # 新：通知中心面板樣式
├── tests/core/
│   ├── message-store.test.ts   # 新（取代 notification-queue.test.ts）
│   └── time-format.test.ts     # 新
└── electron.vite.config.ts     # 改：renderer 加入第二入口 center.html
```

移除：`src/core/notification-queue.ts`、`tests/core/notification-queue.test.ts`（ttl 模型已不用，App 也未引用）。

---

## Task 1：MessageStore（核心、TDD）

**Files:**
- Create: `src/core/message-store.ts`
- Test: `tests/core/message-store.test.ts`
- Delete: `src/core/notification-queue.ts`、`tests/core/notification-queue.test.ts`

- [ ] **Step 1: 移除舊的 notification-queue（已無人引用）**

Run:
```bash
git rm src/core/notification-queue.ts tests/core/notification-queue.test.ts
```
Expected: 兩檔移除。（renderer 先前已改用 currentEvent，不再 import 它。）

- [ ] **Step 2: 寫失敗測試**

Create `tests/core/message-store.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { MessageStore } from '../../src/core/message-store'
import { normalizePayload, type NotifyType } from '../../src/core/events'

function ev(type: NotifyType, id: string) {
  return normalizePayload({ id, type }, { now: () => 0, uuid: () => id })
}

describe('MessageStore', () => {
  it('push 標記未讀並設 receivedAt=now()', () => {
    let t = 1000
    const s = new MessageStore({ now: () => t })
    const m = s.push(ev('done', 'a'))
    expect(m.read).toBe(false)
    expect(m.receivedAt).toBe(1000)
    expect(s.unreadCount()).toBe(1)
  })

  it('list 由新到舊', () => {
    const s = new MessageStore({ now: () => 0 })
    s.push(ev('done', 'a'))
    s.push(ev('error', 'b'))
    expect(s.list().map((m) => m.id)).toEqual(['b', 'a'])
  })

  it('list 可依 type 過濾', () => {
    const s = new MessageStore({ now: () => 0 })
    s.push(ev('done', 'a'))
    s.push(ev('error', 'b'))
    s.push(ev('done', 'c'))
    expect(s.list({ type: 'done' }).map((m) => m.id)).toEqual(['c', 'a'])
  })

  it('markRead 與 markAllRead', () => {
    const s = new MessageStore({ now: () => 0 })
    s.push(ev('done', 'a'))
    s.push(ev('error', 'b'))
    s.markRead('a')
    expect(s.unreadCount()).toBe(1)
    s.markAllRead()
    expect(s.unreadCount()).toBe(0)
  })

  it('超過容量丟最舊', () => {
    const s = new MessageStore({ now: () => 0, capacity: 2 })
    s.push(ev('done', 'a'))
    s.push(ev('done', 'b'))
    s.push(ev('done', 'c'))
    expect(s.list().map((m) => m.id)).toEqual(['c', 'b'])
  })

  it('clear 清空', () => {
    const s = new MessageStore({ now: () => 0 })
    s.push(ev('done', 'a'))
    s.clear()
    expect(s.list()).toEqual([])
    expect(s.unreadCount()).toBe(0)
  })

  it('markRead 對不存在 id 不報錯', () => {
    const s = new MessageStore({ now: () => 0 })
    expect(() => s.markRead('nope')).not.toThrow()
  })
})
```

- [ ] **Step 3: 跑測試確認失敗**

Run: `npx vitest run tests/core/message-store.test.ts`
Expected: FAIL（無法解析 `../../src/core/message-store`）。

- [ ] **Step 4: 寫實作**

Create `src/core/message-store.ts`:
```ts
import type { AppEvent, NotifyType } from './events'

export interface StoredMessage extends AppEvent {
  read: boolean
  receivedAt: number
}

export interface MessageStoreOptions {
  now?: () => number
  capacity?: number
}

const DEFAULT_CAPACITY = 50

export class MessageStore {
  private items: StoredMessage[] = []
  private readonly now: () => number
  private readonly capacity: number

  constructor(options: MessageStoreOptions = {}) {
    this.now = options.now ?? (() => Date.now())
    this.capacity = options.capacity ?? DEFAULT_CAPACITY
  }

  /** 加入未讀訊息；超過容量移除最舊。 */
  push(event: AppEvent): StoredMessage {
    const msg: StoredMessage = { ...event, read: false, receivedAt: this.now() }
    this.items.push(msg)
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity)
    }
    return msg
  }

  markRead(id: string): void {
    const m = this.items.find((x) => x.id === id)
    if (m) m.read = true
  }

  markAllRead(): void {
    for (const m of this.items) m.read = true
  }

  /** 由新到舊；可依 type 過濾。 */
  list(filter: { type?: NotifyType } = {}): StoredMessage[] {
    const out = filter.type ? this.items.filter((m) => m.type === filter.type) : [...this.items]
    return out.reverse()
  }

  unreadCount(): number {
    return this.items.reduce((n, m) => (m.read ? n : n + 1), 0)
  }

  clear(): void {
    this.items = []
  }
}
```

- [ ] **Step 5: 跑測試確認通過**

Run: `npx vitest run tests/core/message-store.test.ts`
Expected: PASS（7 tests）。

- [ ] **Step 6: 全測試 + typecheck（確認移除舊檔無破壞）**

Run: `npm test && npm run typecheck`
Expected: 全綠（不再有 notification-queue 測試；無 import 殘留）。

- [ ] **Step 7: Commit**

```bash
git add src/core/message-store.ts tests/core/message-store.test.ts
git commit -m "feat(core): MessageStore 訊息庫（歷史/已讀未讀/容量），移除舊 notification-queue" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2：time-format 純函式（核心、TDD）

**Files:**
- Create: `src/core/time-format.ts`
- Test: `tests/core/time-format.test.ts`

- [ ] **Step 1: 寫失敗測試**

Create `tests/core/time-format.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { relativeTime, timeGroup } from '../../src/core/time-format'

describe('relativeTime', () => {
  it('一分鐘內 → 剛剛', () => {
    expect(relativeTime(1000, 1000 + 30_000)).toBe('剛剛')
  })
  it('數分鐘 → N 分鐘前', () => {
    expect(relativeTime(0, 5 * 60_000)).toBe('5 分鐘前')
  })
  it('超過一小時 → HH:mm 格式', () => {
    const ts = new Date(2026, 4, 28, 9, 5).getTime()
    const now = new Date(2026, 4, 28, 14, 0).getTime()
    expect(relativeTime(ts, now)).toMatch(/^\d{2}:\d{2}$/)
  })
})

describe('timeGroup', () => {
  it('一分鐘內 → now', () => {
    expect(timeGroup(1000, 1000 + 20_000)).toBe('now')
  })
  it('同日較早 → today', () => {
    const ts = new Date(2026, 4, 28, 9, 0).getTime()
    const now = new Date(2026, 4, 28, 14, 0).getTime()
    expect(timeGroup(ts, now)).toBe('today')
  })
  it('不同日 → earlier', () => {
    const ts = new Date(2026, 4, 27, 23, 0).getTime()
    const now = new Date(2026, 4, 28, 1, 0).getTime()
    expect(timeGroup(ts, now)).toBe('earlier')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/time-format.test.ts`
Expected: FAIL（無法解析模組）。

- [ ] **Step 3: 寫實作**

Create `src/core/time-format.ts`:
```ts
export function relativeTime(ts: number, now: number): string {
  const diff = now - ts
  if (diff < 60_000) return '剛剛'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`
  const d = new Date(ts)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

export type TimeGroup = 'now' | 'today' | 'earlier'

export function timeGroup(ts: number, now: number): TimeGroup {
  if (now - ts < 60_000) return 'now'
  const a = new Date(ts)
  const b = new Date(now)
  const sameDay =
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
  return sameDay ? 'today' : 'earlier'
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/core/time-format.test.ts`
Expected: PASS（6 tests）。

- [ ] **Step 5: Commit**

```bash
git add src/core/time-format.ts tests/core/time-format.test.ts
git commit -m "feat(core): time-format（relativeTime / timeGroup）純函式 + 測試" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：main 串接（store、ingest push、未讀/清單廣播、IPC、bus）

**Files:**
- Create: `src/main/bus.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: 建立 event bus**

Create `src/main/bus.ts`:
```ts
import { EventEmitter } from 'node:events'

// main 端的小型事件匯流排，解耦「右鍵選單」與「開啟通知中心」
export const bus = new EventEmitter()
```

- [ ] **Step 2: 改寫 index.ts**

Replace `src/main/index.ts` with:
```ts
import { app, BrowserWindow, ipcMain } from 'electron'
import { createPetWindow } from './window'
import { createCenterWindow } from './center-window'
import { findFreePort, generateToken, writeEndpointFile } from './endpoint'
import { startIngestServer } from './ingest'
import { MessageStore } from '../core/message-store'
import { bus } from './bus'
import type { AppEvent } from '../core/events'

const store = new MessageStore()
let petWindow: BrowserWindow | null = null
let centerWindow: BrowserWindow | null = null

function broadcastUnread(): void {
  if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('unread-count', store.unreadCount())
}
function broadcastMessages(): void {
  if (centerWindow && !centerWindow.isDestroyed()) centerWindow.webContents.send('messages-updated', store.list())
}

function openCenter(): void {
  if (centerWindow && !centerWindow.isDestroyed()) {
    centerWindow.focus()
    return
  }
  centerWindow = createCenterWindow()
  centerWindow.on('closed', () => {
    centerWindow = null
  })
  centerWindow.webContents.once('did-finish-load', () => broadcastMessages())
}

app.whenReady().then(async () => {
  petWindow = createPetWindow()

  const port = await findFreePort()
  const token = generateToken()
  writeEndpointFile(app.getPath('userData'), { port, token })

  startIngestServer({
    port,
    token,
    onEvent: (event: AppEvent) => {
      store.push(event)
      if (petWindow && !petWindow.isDestroyed()) petWindow.webContents.send('pet-event', event)
      broadcastUnread()
      broadcastMessages()
    },
  })

  ipcMain.on('mark-read', (_e, id: string) => {
    store.markRead(id)
    broadcastUnread()
    broadcastMessages()
  })
  ipcMain.on('mark-all-read', () => {
    store.markAllRead()
    broadcastUnread()
    broadcastMessages()
  })
  ipcMain.on('clear-messages', () => {
    store.clear()
    broadcastUnread()
    broadcastMessages()
  })
  ipcMain.handle('get-messages', () => store.list())

  bus.on('open-center', openCenter)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) petWindow = createPetWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
```

- [ ] **Step 3: typecheck（center-window 尚未建立，預期報錯）**

Run: `npm run typecheck`
Expected: 報 `Cannot find module './center-window'`（Task 5 才建立）。先繼續 Task 4/5，於 Task 5 後再整體 typecheck。

> 註：此任務與 Task 4、5 互相依賴（center-window、選單），三者完成後一起 build/啟動驗證。先各自寫好檔案。

- [ ] **Step 4: Commit（暫不 build，待 Task 5）**

```bash
git add src/main/bus.ts src/main/index.ts
git commit -m "feat(main): 持有 MessageStore、ingest push、未讀/清單廣播、IPC、open-center bus" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：寵物 renderer — 未讀徽章、卡片點擊標已讀、長訊息截斷

**Files:**
- Modify: `src/renderer/index.html`
- Modify: `src/renderer/main.ts`
- Modify: `src/renderer/styles.css`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/api.d.ts`

- [ ] **Step 1: index.html 加未讀徽章元素**

Modify `src/renderer/index.html` — 在 `<div id="pet"></div>` 之後加：
```html
    <div id="badge" hidden></div>
```

- [ ] **Step 2: preload 加 onUnreadCount 與 markRead**

Modify `src/preload/index.ts` — 在 exposeInMainWorld 物件加入：
```ts
  onUnreadCount: (cb: (n: number) => void) => {
    ipcRenderer.on('unread-count', (_e, n: number) => cb(n))
  },
  markRead: (id: string) => ipcRenderer.send('mark-read', id),
```

Modify `src/preload/api.d.ts` — 在 petBridge 型別加入：
```ts
      onUnreadCount: (cb: (n: number) => void) => void
      markRead: (id: string) => void
```

- [ ] **Step 3: main.ts — 卡片點擊標已讀、未讀徽章**

Modify `src/renderer/main.ts`：

(a) 卡片點擊時除了關閉，也通知 main 標為已讀。找到卡片的 click handler：
```ts
  card.addEventListener('click', () => {
    currentEvent = null
    renderCard()
  })
```
改為：
```ts
  const dismissId = e.id
  card.addEventListener('click', () => {
    window.petBridge?.markRead?.(dismissId)
    currentEvent = null
    renderCard()
  })
```

(b) 在檔案結尾（contextmenu 監聽之後）加入未讀徽章：
```ts
const badgeEl = document.querySelector<HTMLDivElement>('#badge')!
window.petBridge?.onUnreadCount?.((n) => {
  if (n > 0) {
    badgeEl.textContent = n > 99 ? '99+' : String(n)
    badgeEl.hidden = false
  } else {
    badgeEl.hidden = true
  }
})
```

- [ ] **Step 4: styles.css — 徽章樣式 + card-body 截斷**

Append to `src/renderer/styles.css`:
```css
#badge {
  position: absolute;
  right: 6px;
  bottom: 158px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #d6453d;
  color: #fff;
  font: 700 11px ui-rounded, system-ui, sans-serif;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 6px rgba(0, 0, 0, .35);
}
#badge[hidden] { display: none; }
```
並把 `.card-body` 改為最多 2 行截斷：
```css
.card-body {
  font-size: 14px;
  font-weight: 600;
  line-height: 1.36;
  margin-top: 2px;
  color: #2a2622;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
```

- [ ] **Step 5: typecheck（仍會因 center-window 缺失而報錯，Task 5 解決）**

Run: `npx tsc --noEmit -p tsconfig.web.json`
Expected: renderer/web 端通過（此 tsconfig 不含 src/main，故不受 center-window 影響）。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/index.html src/renderer/main.ts src/renderer/styles.css src/preload/index.ts src/preload/api.d.ts
git commit -m "feat(renderer): 未讀徽章、卡片點擊標已讀、長訊息 2 行截斷" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：通知中心視窗（main）+ 選單啟用

**Files:**
- Create: `src/main/center-window.ts`
- Modify: `src/main/window.ts`

- [ ] **Step 1: center-window.ts**

Create `src/main/center-window.ts`:
```ts
import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

const W = 300
const H = 440
const MARGIN = 24
const PET_RESERVE = 320 // 寵物視窗高度的預留，讓中心落在寵物上方

export function createCenterWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.workArea

  const win = new BrowserWindow({
    width: W,
    height: H,
    x: x + width - W - MARGIN,
    y: Math.max(y + 8, y + height - H - MARGIN - PET_RESERVE),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
    },
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/center.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/center.html'))
  }

  win.on('blur', () => {
    if (!win.isDestroyed()) win.close()
  })
  return win
}
```

- [ ] **Step 2: window.ts — 「通知中心」改為啟用、觸發 bus**

Modify `src/main/window.ts`：
(a) 頂端加 import：
```ts
import { bus } from './bus'
```
(b) 把選單中那個 disabled 佔位：
```ts
        { label: '通知中心（即將推出）', enabled: false }, // 未來：訊息佇列
```
改為：
```ts
        { label: '通知中心', click: () => bus.emit('open-center') },
```

- [ ] **Step 3: typecheck（main 端應通過了）**

Run: `npx tsc --noEmit -p tsconfig.node.json`
Expected: 通過（center-window 已建立）。注意：center.html 尚未建立，build 會缺 renderer 入口 → Task 6 補。

- [ ] **Step 4: Commit**

```bash
git add src/main/center-window.ts src/main/window.ts
git commit -m "feat(main): 通知中心視窗 + 右鍵選單啟用「通知中心」" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6：通知中心 renderer（清單/篩選/時間分組/已讀未讀/展開）

**Files:**
- Create: `src/renderer/center.html`
- Create: `src/renderer/center.css`
- Create: `src/renderer/center.ts`
- Modify: `electron.vite.config.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/api.d.ts`

- [ ] **Step 1: electron.vite.config.ts 加第二 renderer 入口**

Modify `electron.vite.config.ts` 的 renderer 區塊：
```ts
  renderer: {
    root: 'src/renderer',
    build: {
      rollupOptions: {
        input: {
          index: 'src/renderer/index.html',
          center: 'src/renderer/center.html',
        },
      },
    },
  },
```

- [ ] **Step 2: preload 加中心 API**

Modify `src/preload/index.ts` — 在 exposeInMainWorld 物件加入：
```ts
  getMessages: () => ipcRenderer.invoke('get-messages'),
  markAllRead: () => ipcRenderer.send('mark-all-read'),
  clearMessages: () => ipcRenderer.send('clear-messages'),
  onMessagesUpdated: (cb: (msgs: unknown[]) => void) => {
    ipcRenderer.on('messages-updated', (_e, msgs) => cb(msgs))
  },
```

Modify `src/preload/api.d.ts` — 先在頂端 import StoredMessage 型別並擴充 petBridge：
```ts
import type { AppEvent } from '../core/events'
import type { StoredMessage } from '../core/message-store'
```
在 petBridge 型別加入：
```ts
      getMessages: () => Promise<StoredMessage[]>
      markAllRead: () => void
      clearMessages: () => void
      onMessagesUpdated: (cb: (msgs: StoredMessage[]) => void) => void
```

- [ ] **Step 3: center.html**

Create `src/renderer/center.html`:
```html
<!doctype html>
<html>
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'" />
    <title>通知中心</title>
    <link rel="stylesheet" href="./center.css" />
  </head>
  <body>
    <header>
      <div class="title">通知中心 <span id="unread"></span></div>
      <div class="actions"><button id="mark-all">全部已讀</button><button id="clear">清空</button></div>
    </header>
    <div id="chips"></div>
    <div id="list"></div>
    <div id="empty" hidden>目前沒有通知</div>
    <script type="module" src="./center.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: center.css**

Create `src/renderer/center.css`:
```css
html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
body {
  font-family: ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif;
  color: #2a2622;
}
#app, body > * { box-sizing: border-box; }

body {
  display: flex; flex-direction: column;
  height: 100vh;
  background: #fffdf8;
  border-radius: 14px;
  box-shadow: 0 12px 34px rgba(46, 33, 18, .3);
  overflow: hidden;
}
header {
  display: flex; justify-content: space-between; align-items: center;
  padding: 11px 14px 8px;
}
.title { font-weight: 800; font-size: 14px; }
#unread { color: #d6453d; font-size: 11px; font-weight: 700; margin-left: 4px; }
.actions button {
  border: none; background: none; color: #8a7f70; font-size: 11px; cursor: pointer; padding: 2px 4px;
}
.actions button:hover { color: #2a2622; }

#chips { display: flex; gap: 6px; padding: 0 14px 9px; flex-wrap: wrap; }
.chip {
  font-size: 10.5px; border-radius: 11px; padding: 2px 9px; cursor: pointer;
  background: #efe9df; color: #5a5247;
}
.chip.active { background: #2a2622; color: #fff; }

#list { flex: 1; overflow-y: auto; }
.group { font-size: 10px; font-weight: 700; letter-spacing: .08em; color: #a89c8b; padding: 8px 14px 3px; }

.item {
  display: flex; gap: 9px; padding: 7px 14px; border-left: 3px solid transparent; cursor: pointer;
}
.item[data-type="done"]      { --accent: #2e9e6b; }
.item[data-type="attention"] { --accent: #e08a2b; }
.item[data-type="error"]     { --accent: #d6453d; }
.item[data-type="review"]    { --accent: #5b6ee0; }
.item[data-type="working"]   { --accent: #2e9e9e; }
.item[data-type="info"]      { --accent: #8a8175; }
.item.unread { border-left-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, transparent); }
.item.read { opacity: .72; }

.item .main { flex: 1; min-width: 0; }
.item .label { font-size: 11px; font-weight: 800; color: var(--accent); }
.item .body {
  font-size: 12.5px; margin-top: 1px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.item .body.expanded { -webkit-line-clamp: unset; }
.item .src { font-size: 10px; color: #ad9f8c; margin-top: 2px; }
.item .meta { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
.item .time { font-size: 10px; color: #ad9f8c; white-space: nowrap; }
.item .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--accent); }
.expand { font-size: 10px; color: #8a7f70; cursor: pointer; margin-top: 2px; }

#empty { text-align: center; color: #a89c8b; font-size: 12px; padding: 30px 0; }
#empty[hidden] { display: none; }
```

- [ ] **Step 5: center.ts**

Create `src/renderer/center.ts`:
```ts
/// <reference path="../preload/api.d.ts" />
import type { StoredMessage } from '../core/message-store'
import type { NotifyType } from '../core/events'
import { relativeTime, timeGroup, type TimeGroup } from '../core/time-format'

const LABEL: Record<NotifyType, string> = {
  done: '完成', attention: '需要注意', error: '錯誤', review: '請檢視', working: '工作中', info: '通知',
}
const CHIPS: { id: 'all' | NotifyType; name: string }[] = [
  { id: 'all', name: '全部' },
  { id: 'done', name: '完成' },
  { id: 'attention', name: '需要注意' },
  { id: 'error', name: '錯誤' },
]
const GROUP_LABEL: Record<TimeGroup, string> = { now: '剛剛', today: '今天稍早', earlier: '更早' }

let all: StoredMessage[] = []
let filter: 'all' | NotifyType = 'all'

const listEl = document.querySelector<HTMLDivElement>('#list')!
const emptyEl = document.querySelector<HTMLDivElement>('#empty')!
const unreadEl = document.querySelector<HTMLSpanElement>('#unread')!
const chipsEl = document.querySelector<HTMLDivElement>('#chips')!

function renderChips(): void {
  chipsEl.replaceChildren(
    ...CHIPS.map((c) => {
      const el = document.createElement('span')
      el.className = 'chip' + (filter === c.id ? ' active' : '')
      el.textContent = c.name
      el.addEventListener('click', () => {
        filter = c.id
        render()
      })
      return el
    }),
  )
}

function render(): void {
  renderChips()
  const now = Date.now()
  const items = filter === 'all' ? all : all.filter((m) => m.type === filter)
  const unread = all.filter((m) => !m.read).length
  unreadEl.textContent = unread > 0 ? `${unread} 則未讀` : ''

  listEl.replaceChildren()
  emptyEl.hidden = items.length > 0

  let lastGroup: TimeGroup | null = null
  for (const m of items) {
    const g = timeGroup(m.receivedAt, now)
    if (g !== lastGroup) {
      lastGroup = g
      const gh = document.createElement('div')
      gh.className = 'group'
      gh.textContent = GROUP_LABEL[g]
      listEl.appendChild(gh)
    }
    listEl.appendChild(buildItem(m, now))
  }
}

function buildItem(m: StoredMessage, now: number): HTMLDivElement {
  const item = document.createElement('div')
  item.className = `item ${m.read ? 'read' : 'unread'}`
  item.dataset.type = m.type
  item.addEventListener('click', () => {
    if (!m.read) window.petBridge.markRead(m.id) // main 會回推更新
  })

  const main = document.createElement('div')
  main.className = 'main'
  const label = document.createElement('div')
  label.className = 'label'
  label.textContent = LABEL[m.type]
  main.appendChild(label)

  if (m.body) {
    const body = document.createElement('div')
    body.className = 'body'
    body.textContent = m.body
    main.appendChild(body)
    // 截斷時提供展開
    const expand = document.createElement('div')
    expand.className = 'expand'
    expand.textContent = '展開'
    expand.hidden = true
    expand.addEventListener('click', (ev) => {
      ev.stopPropagation()
      body.classList.toggle('expanded')
      expand.textContent = body.classList.contains('expanded') ? '收合' : '展開'
    })
    main.appendChild(expand)
    // 內容溢出才顯示展開鈕（render 後檢查）
    requestAnimationFrame(() => {
      expand.hidden = body.scrollHeight <= body.clientHeight
    })
  }

  const src = m.title || m.source.name || m.source.kind
  if (src) {
    const s = document.createElement('div')
    s.className = 'src'
    s.textContent = src
    main.appendChild(s)
  }

  const meta = document.createElement('div')
  meta.className = 'meta'
  const time = document.createElement('div')
  time.className = 'time'
  time.textContent = relativeTime(m.receivedAt, now)
  meta.appendChild(time)
  if (!m.read) {
    const dot = document.createElement('div')
    dot.className = 'dot'
    meta.appendChild(dot)
  }

  item.appendChild(main)
  item.appendChild(meta)
  return item
}

document.querySelector('#mark-all')!.addEventListener('click', () => window.petBridge.markAllRead())
document.querySelector('#clear')!.addEventListener('click', () => window.petBridge.clearMessages())

window.petBridge.onMessagesUpdated((msgs) => {
  all = msgs
  render()
})

// 初次載入：主動拉一次（did-finish-load 後 main 也會推一次）
window.petBridge.getMessages().then((msgs) => {
  all = msgs
  render()
})
```

- [ ] **Step 6: typecheck + build（Claude 執行）**

Run: `npm run typecheck && npm run build`
Expected: 兩個 tsconfig 通過；build 產出 `out/renderer/index.html` 與 `out/renderer/center.html`。
> 若 `import ...time-format`／StoredMessage 型別有問題先修正；center.ts 使用 DOM 與既有 core，皆在 tsconfig.web 範圍內。

- [ ] **Step 7: Commit**

```bash
git add electron.vite.config.ts src/preload/index.ts src/preload/api.d.ts src/renderer/center.html src/renderer/center.css src/renderer/center.ts
git commit -m "feat(renderer): 通知中心視窗頁面（清單/篩選/時間分組/已讀未讀/展開）" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7：整合驗證（Claude 執行）

**Files:** 無（驗證）。

- [ ] **Step 1: 單元測試 + typecheck + build 全綠**

Run: `npm test && npm run typecheck && npm run build`
Expected: 全部通過；build 含 index.html 與 center.html。

- [ ] **Step 2: 端到端（Playwright _electron）— 未讀徽章與已讀**

寫一次性檢查（放 `scripts/notif-check.mjs`，驗後刪）：啟動 App → 用 endpoint.json POST 兩個事件（done, error）→ 檢查寵物視窗 `#badge` 文字為「2」→ 觸發即時卡片點擊（`#cards .card` click）→ 檢查 `#badge` 變「1」。Expected：徽章數正確隨已讀遞減。

- [ ] **Step 3: 端到端 — 開通知中心並渲染**

於上述 App，用 `app.evaluate` 取得 main 端 `bus` 不易；改以「第二視窗」驗證：透過 `app.evaluate` 直接 `require('electron').BrowserWindow` 找出或開啟中心視窗較複雜。故本步驟以**手動驗收為主**（Claude 啟動 App、右鍵寵物選「通知中心」、截圖中心視窗），確認：清單顯示兩則、未讀有底色+點、狀態 chips 可篩選、時間分組顯示、「全部已讀」後底色消失、「清空」後空狀態、長訊息顯示「展開」。

- [ ] **Step 4: 確認工作樹乾淨**

Run: `git status --short`
Expected: 空（臨時檢查腳本已刪）。

---

## 驗收標準（完成定義）

- `npm test` 全綠（含 MessageStore、time-format）。
- `npm run typecheck`、`npm run build`（含 center.html）通過。
- 事件進來 → 寵物未讀徽章 +1；點即時卡片 → 該則已讀、徽章 -1。
- 右鍵「通知中心」開啟面板：清單（新到舊）、狀態 chips 篩選、時間分組、相對時間、未讀/已讀視覺、全部已讀、清空、長訊息展開。
- 被替換而未點的訊息仍留在中心為未讀（零遺失）。
- 已涵蓋 spec：§3 互動/已讀未讀、§4 中心 UI、§5 MessageStore、§6 架構/IPC、§7 視窗、B3 長訊息截斷展開。

## 待後續（Spec ②/③ 與未來）

- 跨重啟持久化、搜尋、通知音、點訊息跳到 session。
- 中心視窗 e2e 自動化（目前部分手動驗收）。
