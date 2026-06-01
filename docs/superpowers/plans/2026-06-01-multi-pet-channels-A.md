# 多寵物 子專案 A：Channel 群組基礎 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把通知依 `source`（kind/name）分成可重疊的「channel（群組）」：core 純函式 + prefs 持久化 + 自動偵測建停用 channel + 通知中心分頁 + 獨立頻道管理視窗（Preact）。**A 不長新寵物**（仍只有「全部」那隻）。

**Architecture:** core 純函式 `channel.ts` 做分組邏輯（可測）；main 為 `prefs.channels` 唯一寫入者（細粒度 upsert/delete + ingest 自動建）；通知中心 vanilla 加分頁；頻道管理為獨立 `channels.html`（Preact + signals，隔離在單一 bundle）。

**Tech Stack:** Electron + electron-vite、TypeScript、typed IPC、Vitest；新增 Preact + @preact/signals（僅頻道管理視窗）。

**依據 spec：** `docs/superpowers/specs/2026-06-01-multi-pet-channels-A-design.md`

**群組語意（全程一致）：** 「全部」= `id:'all'`、隱含、含所有訊息、skin=`prefs.skin`、不可刪停、不在 `prefs.channels`。group channel 可重疊（一 source 可符合多個）。`matchingChannels` 只回 **enabled** 的 id（不含 'all'）。

---

## File Structure

**新增**
- `src/core/channel.ts`（+ `tests/core/channel.test.ts`）— 型別 + 純函式（matchesSource / matchingChannels / filterByChannel / unreadByChannel / sanitizeChannels）
- `src/main/channels-window.ts` — 頻道管理視窗工廠
- `src/preload/channels.ts` — 窄版 channelsBridge
- `src/renderer/channels.html` / `channels.tsx` / `channels.css` — Preact 頻道管理 UI

**修改**
- `src/main/prefs.ts`、`src/main/index.ts`、`src/main/window.ts`
- `src/ipc/contract.ts`、`src/preload/index.ts`、`src/preload/api.d.ts`
- `src/renderer/center.ts`、`src/renderer/center.css`、`src/renderer/center.html`
- `electron.vite.config.ts`、`tsconfig.web.json`、`package.json`

---

## Task 1: core `channel.ts` 純函式（TDD）

> 純函式，可派 codex TDD、Claude review。worktree EPERM 用 `npx vitest run --configLoader runner <path>`。

**Files:**
- Create: `src/core/channel.ts`
- Test: `tests/core/channel.test.ts`

- [ ] **Step 1: 寫失敗測試**

`tests/core/channel.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import {
  matchesSource,
  matchingChannels,
  filterByChannel,
  unreadByChannel,
  sanitizeChannels,
  type Channel,
} from '../../src/core/channel'

const ch = (id: string, match: Channel['match'], enabled = true): Channel => ({
  id, name: id, skin: 'may', enabled, match,
})
const msg = (kind: string, name: string | undefined, read: boolean) => ({
  source: { kind, name }, read,
})

describe('matchesSource', () => {
  it('kind 命中', () => expect(matchesSource({ kind: 'claude-code' }, { kind: 'claude-code', name: 'x' })).toBe(true))
  it('name 命中', () => expect(matchesSource({ name: 'desktop-notify' }, { kind: 'claude-code', name: 'desktop-notify' })).toBe(true))
  it('兩者皆要、其一不符 → false', () => expect(matchesSource({ kind: 'claude-code', name: 'a' }, { kind: 'claude-code', name: 'b' })).toBe(false))
  it('空 matcher → false', () => expect(matchesSource({}, { kind: 'x', name: 'y' })).toBe(false))
  it('match.name 指定但 source.name 缺 → false', () => expect(matchesSource({ name: 'a' }, { kind: 'x' })).toBe(false))
})

describe('matchingChannels（只回 enabled、可多屬）', () => {
  const channels = [
    ch('c1', { kind: 'claude-code' }),
    ch('c2', { name: 'desktop-notify' }),
    ch('c3', { kind: 'attendance' }, false), // 停用
  ]
  it('重疊 → 回多個', () => {
    expect(matchingChannels({ kind: 'claude-code', name: 'desktop-notify' }, channels).sort()).toEqual(['c1', 'c2'])
  })
  it('停用不回', () => {
    expect(matchingChannels({ kind: 'attendance', name: '打卡' }, channels)).toEqual([])
  })
  it('無命中 → 空', () => {
    expect(matchingChannels({ kind: 'curl', name: 'z' }, channels)).toEqual([])
  })
})

describe('filterByChannel', () => {
  const channels = [ch('c1', { kind: 'claude-code' })]
  const msgs = [msg('claude-code', 'a', false), msg('attendance', '打卡', true)]
  it("'all' → 全部", () => expect(filterByChannel(msgs, 'all', channels)).toHaveLength(2))
  it('group → 命中者', () => expect(filterByChannel(msgs, 'c1', channels)).toHaveLength(1))
  it('找不到 channel → 空', () => expect(filterByChannel(msgs, 'nope', channels)).toEqual([]))
})

describe('unreadByChannel', () => {
  it('all 總未讀 + 各 enabled group 未讀', () => {
    const channels = [ch('c1', { kind: 'claude-code' }), ch('c2', { kind: 'attendance' }, false)]
    const msgs = [msg('claude-code', 'a', false), msg('claude-code', 'b', true), msg('attendance', 'x', false)]
    expect(unreadByChannel(msgs, channels)).toEqual({ all: 2, c1: 1 }) // c2 停用不列
  })
})

describe('sanitizeChannels', () => {
  it('丟棄壞欄位 / match 至少一欄', () => {
    const raw = [
      { id: 'c1', name: 'A', skin: 'may', enabled: true, match: { kind: 'claude-code' } },
      { id: 'c2', name: 'B', match: {} }, // match 空 → 丟
      { name: 'no-id', match: { kind: 'x' } }, // 無 id → 丟
      'garbage',
    ]
    expect(sanitizeChannels(raw)).toEqual([
      { id: 'c1', name: 'A', skin: 'may', enabled: true, match: { kind: 'claude-code' } },
    ])
  })
  it('非陣列 → []', () => expect(sanitizeChannels(null)).toEqual([]))
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/channel.test.ts`
Expected: FAIL — 找不到模組 `channel`。

- [ ] **Step 3: 實作**

`src/core/channel.ts`：

```ts
import type { NotifySource } from './events'

export interface SourceMatch {
  kind?: string
  name?: string
}

export interface Channel {
  id: string
  name: string
  skin: string
  enabled: boolean
  match: SourceMatch
}

/** match 至少一欄；指定的欄位都須與 source 相等。空 matcher 不命中。 */
export function matchesSource(match: SourceMatch, source: NotifySource): boolean {
  if (match.kind == null && match.name == null) return false
  if (match.kind != null && match.kind !== source.kind) return false
  if (match.name != null && match.name !== source.name) return false
  return true
}

/** 回所有「enabled 且命中」的 channel id（不含隱含的 'all'）。可多屬（重疊）。 */
export function matchingChannels(source: NotifySource, channels: Channel[]): string[] {
  return channels.filter((c) => c.enabled && matchesSource(c.match, source)).map((c) => c.id)
}

/** 'all' → 全部；否則回命中該 channel 的訊息（忽略 enabled，供分頁/預覽）。 */
export function filterByChannel<T extends { source: NotifySource }>(
  messages: T[],
  channelId: string,
  channels: Channel[],
): T[] {
  if (channelId === 'all') return messages
  const ch = channels.find((c) => c.id === channelId)
  if (!ch) return []
  return messages.filter((m) => matchesSource(ch.match, m.source))
}

/** { all: 總未讀, [id]: 該 enabled channel 未讀 }。 */
export function unreadByChannel(
  messages: { source: NotifySource; read: boolean }[],
  channels: Channel[],
): Record<string, number> {
  const out: Record<string, number> = { all: messages.filter((m) => !m.read).length }
  for (const c of channels) {
    if (!c.enabled) continue
    out[c.id] = messages.filter((m) => !m.read && matchesSource(c.match, m.source)).length
  }
  return out
}

/** 驗證持久化讀入的 channels：壞的丟棄、match 至少一有效欄。 */
export function sanitizeChannels(raw: unknown): Channel[] {
  if (!Array.isArray(raw)) return []
  const out: Channel[] = []
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue
    const o = r as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : null
    const name = typeof o.name === 'string' ? o.name : null
    const skin = typeof o.skin === 'string' ? o.skin : ''
    const enabled = typeof o.enabled === 'boolean' ? o.enabled : false
    const mraw = (typeof o.match === 'object' && o.match !== null ? o.match : {}) as Record<string, unknown>
    const match: SourceMatch = {}
    if (typeof mraw.kind === 'string' && mraw.kind) match.kind = mraw.kind
    if (typeof mraw.name === 'string' && mraw.name) match.name = mraw.name
    if (!id || !name || (match.kind == null && match.name == null)) continue
    out.push({ id, name, skin, enabled, match })
  }
  return out
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/core/channel.test.ts`
Expected: PASS（全案例）。

- [ ] **Step 5: commit**

```bash
git add src/core/channel.ts tests/core/channel.test.ts
git commit -m "feat(core): channel 群組純函式（matchesSource/matchingChannels/filterByChannel/unreadByChannel/sanitize）"
```

---

## Task 2: prefs 加 `channels`

**Files:**
- Modify: `src/main/prefs.ts`

- [ ] **Step 1: 加入 channels 欄位 + sanitize**

`src/main/prefs.ts`：

頂部 import 加：

```ts
import { sanitizeChannels, type Channel } from '../core/channel'
```

`Prefs` 介面加 `channels`：

```ts
export interface Prefs {
  autoWalk: boolean
  walk: WalkBounds
  skin: string
  dnd: boolean
  channels: Channel[]
}
```

`DEFAULTS` 加 `channels: []`；`loadPrefs` 的「無檔」與「解析錯」回傳、以及正常解析都帶上 channels。把三處 return 改為包含 channels；正常解析的 return 改成：

```ts
    return {
      autoWalk: typeof parsed.autoWalk === 'boolean' ? parsed.autoWalk : DEFAULTS.autoWalk,
      walk: sanitizeWalkBounds(walkRaw as Partial<WalkBounds>),
      skin: isValidSkinId(parsed.skin) ? (parsed.skin as string) : DEFAULTS.skin,
      dnd: typeof parsed.dnd === 'boolean' ? parsed.dnd : DEFAULTS.dnd,
      channels: sanitizeChannels(parsed.channels),
    }
```

兩個 fallback return（無檔 / catch）改為：

```ts
    return { autoWalk: DEFAULTS.autoWalk, walk: { ...DEFAULTS.walk }, skin: DEFAULTS.skin, dnd: DEFAULTS.dnd, channels: [] }
```

並把 `DEFAULTS` 物件加 `channels: []`。

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: commit**

```bash
git add src/main/prefs.ts
git commit -m "feat(prefs): Prefs.channels + sanitizeChannels（向後相容，舊檔無 channels → []）"
```

---

## Task 3: IPC contract + petBridge（給中心）

**Files:**
- Modify: `src/ipc/contract.ts`、`src/preload/index.ts`、`src/preload/api.d.ts`

- [ ] **Step 1: contract 加 channel channels**

`src/ipc/contract.ts`：頂部 import 加 `import type { Channel } from '../core/channel'`。

`Commands` 加：

```ts
  'channel-upsert': Channel
  'channel-delete': { id: string }
```

`Queries` 加：

```ts
  'get-channels': { args: void; result: Channel[] }
```

`Pushes` 加：

```ts
  'channels-updated': Channel[]
```

- [ ] **Step 2: petBridge 暴露（中心用）**

`src/preload/index.ts`：頂部 import 加 `import type { Channel } from '../core/channel'`；在物件內加：

```ts
  getChannels: () => invokeQuery('get-channels'),
  onChannelsUpdated: (cb: (channels: Channel[]) => void) => subscribePush('channels-updated', cb),
```

`src/preload/api.d.ts`：頂部 import 加 `import type { Channel } from '../core/channel'`；`petBridge` 型別內加：

```ts
      getChannels: () => Promise<Channel[]>
      onChannelsUpdated: (cb: (channels: Channel[]) => void) => void
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: commit**

```bash
git add src/ipc/contract.ts src/preload/index.ts src/preload/api.d.ts
git commit -m "feat(ipc): channel-upsert/channel-delete/get-channels/channels-updated + petBridge getChannels/onChannelsUpdated"
```

---

## Task 4: main — channels 狀態、handlers、自動偵測、開窗

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: import + 狀態 + id 產生器**

`src/main/index.ts`：頂部 import 加：

```ts
import { matchingChannels, matchesSource, type Channel } from '../core/channel'
import { createChannelsWindow } from './channels-window'
```

在模組狀態區（`let dndEnabled` 附近）加：

```ts
let channels: Channel[] = []
let channelsWindow: BrowserWindow | null = null
let channelSeq = 0
function nextChannelId(): string {
  channelSeq += 1
  return `ch-${Date.now().toString(36)}-${channelSeq.toString(36)}`
}
```

- [ ] **Step 2: 載入 channels + 廣播 helper**

在 `app.whenReady().then(async () => {` 內，`dndEnabled = loadPrefs(...)` 那段附近加載入：

```ts
  channels = loadPrefs(app.getPath('userData')).channels
```

在 `broadcastMessages` 附近加廣播 helper：

```ts
function broadcastChannels(): void {
  pushTo(centerWindow, 'channels-updated', channels)
  pushTo(channelsWindow, 'channels-updated', channels)
}
function persistChannels(): void {
  const p = loadPrefs(app.getPath('userData'))
  savePrefs(app.getPath('userData'), { ...p, channels })
}
```

（`savePrefs`/`loadPrefs` 已 import；若無則補 `import { loadPrefs, savePrefs } from './prefs'`。）

- [ ] **Step 3: query + upsert/delete handlers**

在 whenReady 內、`handleQuery('get-messages', ...)` 之後加：

```ts
  handleQuery('get-channels', () => channels)
  handleCommand('channel-upsert', (ch) => {
    const i = channels.findIndex((c) => c.id === ch.id)
    if (i >= 0) channels[i] = ch
    else channels = [...channels, ch]
    persistChannels()
    broadcastChannels()
    broadcastMessages() // 讓中心分頁重算
  })
  handleCommand('channel-delete', ({ id }) => {
    channels = channels.filter((c) => c.id !== id)
    persistChannels()
    broadcastChannels()
    broadcastMessages()
  })
```

- [ ] **Step 4: ingest 自動偵測建停用 channel**

在 `startIngestServer({ ... onEvent: (event) => { ... } })` 的 onEvent 內，`store.push(event)` 之後加：

```ts
      autoDetectChannel(event.source)
```

並在 whenReady 外層（模組層）或 index.ts 內定義：

```ts
function autoDetectChannel(source: { kind: string; name?: string }): void {
  // (a) 沒有任何啟用 channel 命中 且 (b) 沒有 match 完全等於 {kind,name} 的既有 channel
  if (matchingChannels(source, channels).length > 0) return
  const exists = channels.some(
    (c) => c.match.kind === source.kind && (c.match.name ?? undefined) === (source.name ?? undefined),
  )
  if (exists) return
  const match: { kind?: string; name?: string } = { kind: source.kind }
  if (source.name) match.name = source.name
  channels = [
    ...channels,
    {
      id: nextChannelId(),
      name: source.name || source.kind,
      skin: loadPrefs(app.getPath('userData')).skin,
      enabled: false,
      match,
    },
  ]
  persistChannels()
  broadcastChannels()
}
```

（注意：`exists` 比對用 `{kind,name}`；auto 建的 match 一律含 kind + 有 name 才加 name，與比對一致。）

- [ ] **Step 5: open-channels 開窗（bus）**

在 `bus.on('open-skins', ...)` 附近加：

```ts
  bus.on('open-channels', () => {
    if (channelsWindow && !channelsWindow.isDestroyed()) {
      channelsWindow.focus()
      return
    }
    channelsWindow = createChannelsWindow()
    channelsWindow.on('closed', () => {
      channelsWindow = null
    })
  })
```

- [ ] **Step 6: typecheck（會因 channels-window 未建而失敗 → Task 8 補；本步先確認其餘無誤可暫緩 commit 到 Task 8）**

> 註：`createChannelsWindow` 於 Task 8 建立。為保持每任務可編譯，**將 Task 8（channels-window.ts + preload）排在本任務「之後、commit 之前」依賴**：實作順序上先做 Task 7（建置）→ Task 8（視窗/preload）→ 回來補 Task 4 的 import 並 commit。或在本步先以 `// eslint-disable` 占位再於 Task 8 接上。
>
> **建議實作順序：Task 1→2→3→5→6→7→8→4→9→10**（Task 4 的 `createChannelsWindow` 依賴 Task 8）。下方仍以邏輯分組編號。

- [ ] **Step 7: commit（待 Task 8 完成後）**

```bash
git add src/main/index.ts
git commit -m "feat(main): channels 狀態/handlers + ingest 自動偵測建停用 channel + open-channels 開窗"
```

---

## Task 5: 右鍵選單「頻道…」

**Files:**
- Modify: `src/main/window.ts`

- [ ] **Step 1: 選單加項**

`src/main/window.ts` 的 `show-context-menu` template 內，`{ label: '更換造型…', click: () => bus.emit('open-skins') }` 之後加：

```ts
        { label: '頻道…', click: () => bus.emit('open-channels') },
```

- [ ] **Step 2: typecheck + commit**

Run: `npm run typecheck`（bus 已 import）
```bash
git add src/main/window.ts
git commit -m "feat(menu): 右鍵選單加「頻道…」開頻道管理"
```

---

## Task 6: 通知中心分頁

**Files:**
- Modify: `src/renderer/center.html`、`src/renderer/center.ts`、`src/renderer/center.css`

- [ ] **Step 1: center.html 加分頁列**

`src/renderer/center.html`：在 `<div id="chips"></div>` 之前加：

```html
    <div id="channel-tabs"></div>
```

- [ ] **Step 2: center.ts — channels 狀態 + 分頁渲染 + 過濾**

`src/renderer/center.ts`：

import 加：

```ts
import { filterByChannel, unreadByChannel, type Channel } from '../core/channel'
```

狀態加（`let filter` 附近）：

```ts
let channels: Channel[] = []
let channelTab = 'all'
```

元素加（`chipsEl` 附近）：

```ts
const tabsEl = document.querySelector<HTMLDivElement>('#channel-tabs')!
```

新增 `renderTabs()`，並在 `renderList()` 開頭呼叫；分頁 = `全部` + 啟用 channel，含未讀數：

```ts
function renderTabs(): void {
  const counts = unreadByChannel(all, channels)
  const tabs: { id: string; name: string }[] = [
    { id: 'all', name: '全部' },
    ...channels.filter((c) => c.enabled).map((c) => ({ id: c.id, name: c.name })),
  ]
  // 目前分頁若指向已停用/刪除的 channel → 退回 all
  if (channelTab !== 'all' && !tabs.some((t) => t.id === channelTab)) channelTab = 'all'
  tabsEl.replaceChildren(
    ...tabs.map((t) => {
      const el = document.createElement('span')
      const n = counts[t.id] ?? 0
      el.className = 'ctab' + (channelTab === t.id ? ' active' : '')
      el.textContent = n > 0 ? `${t.name} (${n})` : t.name
      el.addEventListener('click', () => {
        channelTab = t.id
        render()
      })
      return el
    }),
  )
}
```

把 `renderList()` 內取 items 的那行改為先依分頁過濾、再套既有 type chip：

```ts
function renderList(): void {
  renderTabs()
  renderChips()
  const now = Date.now()
  const byChannel = filterByChannel(all, channelTab, channels)
  const items = filter === 'all' ? byChannel : byChannel.filter((m) => m.type === filter)
  const unread = all.filter((m) => !m.read).length
  unreadEl.textContent = unread > 0 ? `${unread} 則未讀` : ''
  // …（以下 listEl.replaceChildren / group / buildItem 不變）
```

（其餘 renderList 主體不動。）

在 `renderDetail()` 開頭，於 `chipsEl.replaceChildren()` 旁加 `tabsEl.replaceChildren()`（詳情時清掉分頁列；回列表 renderTabs 重建）。

- [ ] **Step 3: center.ts — 取得 channels**

把檔尾 `getMessages().then` 區塊改為同時拉 channels，並訂閱更新：

```ts
window.petBridge.getChannels().then((cs) => {
  channels = cs
  render()
})
window.petBridge.onChannelsUpdated((cs) => {
  channels = cs
  render()
})
```

（放在既有 `getMessages().then(...)` 之後即可。）

- [ ] **Step 4: center.css 分頁列樣式**

`src/renderer/center.css` 檔尾加：

```css
#channel-tabs { display: flex; gap: 6px; padding: 6px 14px 0; flex-wrap: wrap; }
.ctab {
  font-size: 11px;
  font-weight: 700;
  padding: 3px 10px;
  border-radius: 11px 11px 0 0;
  cursor: pointer;
  color: #5a5247;
  background: #efe9df;
}
.ctab.active { background: #2a2622; color: #fff; }
```

- [ ] **Step 5: typecheck + commit**

Run: `npm run typecheck`
```bash
git add src/renderer/center.html src/renderer/center.ts src/renderer/center.css
git commit -m "feat(center): channel 分頁（全部 + 啟用 group，各自未讀，filterByChannel 即時過濾）"
```

---

## Task 7: 技術棧 — 加 Preact + 建置設定

> 實作前已用 context7 查證：tsconfig 用 `jsx: react-jsx` + `jsxImportSource: preact`；vite 用 `@preact/preset-vite`。

**Files:**
- Modify: `package.json`（裝依賴）、`electron.vite.config.ts`、`tsconfig.web.json`

- [ ] **Step 1: 裝依賴（需連網，由 Claude 跑）**

```bash
npm install -D preact @preact/signals @preact/preset-vite
```
Expected: `package.json` devDependencies 出現三者。

- [ ] **Step 2: electron.vite.config.ts — preact plugin + 入口**

`electron.vite.config.ts`：頂部加 `import preact from '@preact/preset-vite'`。

`preload.build.rollupOptions.input` 加 `channels`：

```ts
        input: { index: 'src/preload/index.ts', card: 'src/preload/card.ts', channels: 'src/preload/channels.ts' },
```

`renderer` 段加 `plugins` 與 `channels` 入口：

```ts
  renderer: {
    root: 'src/renderer',
    plugins: [preact()],
    build: {
      rollupOptions: {
        input: {
          index: 'src/renderer/index.html',
          center: 'src/renderer/center.html',
          settings: 'src/renderer/settings.html',
          skins: 'src/renderer/skins.html',
          card: 'src/renderer/card.html',
          channels: 'src/renderer/channels.html',
        },
      },
    },
  },
```

- [ ] **Step 3: tsconfig.web.json — jsx 設定**

`tsconfig.web.json` 的 `compilerOptions` 加：

```json
    "jsx": "react-jsx",
    "jsxImportSource": "preact",
```

（只影響 `.tsx`；既有 vanilla `.ts` renderer 不受影響。）

- [ ] **Step 4: typecheck（此時 channels.tsx 尚未建，typecheck 仍應過——尚無 .tsx 檔）**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add package.json package-lock.json electron.vite.config.ts tsconfig.web.json
git commit -m "build: 加 Preact + @preact/signals + preset-vite，channels renderer/preload 入口 + tsconfig jsx"
```

---

## Task 8: 頻道管理視窗工廠 + 窄版 preload

**Files:**
- Create: `src/main/channels-window.ts`、`src/preload/channels.ts`
- Modify: `src/preload/api.d.ts`

- [ ] **Step 1: channels-window.ts**

`src/main/channels-window.ts`（比照 skin-window，置中、blur 不關以便操作；Esc 由 renderer 關）：

```ts
import { BrowserWindow, screen } from 'electron'
import { join } from 'node:path'

const W = 420
const H = 520

export function createChannelsWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.workArea

  const win = new BrowserWindow({
    width: W,
    height: H,
    x: x + Math.max(0, Math.floor((width - W) / 2)),
    y: y + Math.max(0, Math.floor((height - H) / 2)),
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, '../preload/channels.cjs'),
    },
  })

  win.setAlwaysOnTop(true, 'floating')

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/channels.html`)
  } else {
    win.loadFile(join(__dirname, '../renderer/channels.html'))
  }
  return win
}
```

- [ ] **Step 2: 窄版 preload（直接用 ipcRenderer，避免共用 chunk）**

`src/preload/channels.ts`：

```ts
import { contextBridge, ipcRenderer } from 'electron'
import type { Channel } from '../core/channel'
import type { DiscoveredSkin } from '../core/skin-scan'

contextBridge.exposeInMainWorld('channelsBridge', {
  getChannels: (): Promise<Channel[]> => ipcRenderer.invoke('get-channels'),
  upsertChannel: (ch: Channel) => ipcRenderer.send('channel-upsert', ch),
  deleteChannel: (id: string) => ipcRenderer.send('channel-delete', { id }),
  onChannelsUpdated: (cb: (channels: Channel[]) => void) =>
    ipcRenderer.on('channels-updated', (_e, channels: Channel[]) => cb(channels)),
  getSkins: (): Promise<{ skins: DiscoveredSkin[]; requestedId: string; effectiveId: string }> =>
    ipcRenderer.invoke('get-skins'),
})
```

- [ ] **Step 3: api.d.ts — channelsBridge 型別**

`src/preload/api.d.ts`：`interface Window` 內、`cardBridge` 之後加：

```ts
    channelsBridge: {
      getChannels: () => Promise<Channel[]>
      upsertChannel: (ch: Channel) => void
      deleteChannel: (id: string) => void
      onChannelsUpdated: (cb: (channels: Channel[]) => void) => void
      getSkins: () => Promise<{ skins: import('../core/skin-scan').DiscoveredSkin[]; requestedId: string; effectiveId: string }>
    }
```

- [ ] **Step 4: typecheck（現在 Task 4 的 createChannelsWindow import 可解析）**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: commit（連同 Task 4 的 index.ts）**

```bash
git add src/main/channels-window.ts src/preload/channels.ts src/preload/api.d.ts src/main/index.ts
git commit -m "feat(main): channels-window 工廠 + 窄版 channelsBridge preload（接上 main handlers/自動偵測）"
```

---

## Task 9: 頻道管理 UI（Preact + signals）

**Files:**
- Create: `src/renderer/channels.html`、`src/renderer/channels.tsx`、`src/renderer/channels.css`

- [ ] **Step 1: channels.html**

`src/renderer/channels.html`：

```html
<!doctype html>
<html lang="zh-Hant">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: pet:; style-src 'self' 'unsafe-inline'" />
    <title>頻道</title>
    <link rel="stylesheet" href="./channels.css" />
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="./channels.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: channels.tsx（Preact + signals）**

`src/renderer/channels.tsx`：

```tsx
/// <reference path="../preload/api.d.ts" />
import { render } from 'preact'
import { signal } from '@preact/signals'
import type { Channel } from '../core/channel'
import type { DiscoveredSkin } from '../core/skin-scan'

const channels = signal<Channel[]>([])
const skins = signal<DiscoveredSkin[]>([])

window.channelsBridge.getChannels().then((cs) => (channels.value = cs))
window.channelsBridge.onChannelsUpdated((cs) => (channels.value = cs))
window.channelsBridge.getSkins().then((r) => (skins.value = r.skins))

function newId(): string {
  return `ch-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`
}

function upsert(ch: Channel): void {
  window.channelsBridge.upsertChannel(ch)
}

function Row({ ch }: { ch: Channel }): preact.JSX.Element {
  const matchBy = ch.match.name != null ? 'name' : 'kind'
  const matchVal = ch.match.name ?? ch.match.kind ?? ''
  return (
    <div class="row" data-enabled={String(ch.enabled)}>
      <input
        class="name"
        value={ch.name}
        onInput={(e) => upsert({ ...ch, name: (e.target as HTMLInputElement).value })}
      />
      <select
        class="skin"
        value={ch.skin}
        onChange={(e) => upsert({ ...ch, skin: (e.target as HTMLSelectElement).value })}
      >
        {skins.value.filter((s) => s.valid).map((s) => (
          <option value={s.id}>{s.displayName}</option>
        ))}
      </select>
      <select
        class="by"
        value={matchBy}
        onChange={(e) => {
          const by = (e.target as HTMLSelectElement).value
          upsert({ ...ch, match: by === 'name' ? { name: matchVal } : { kind: matchVal } })
        }}
      >
        <option value="name">專案名</option>
        <option value="kind">類別</option>
      </select>
      <input
        class="val"
        value={matchVal}
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value
          upsert({ ...ch, match: matchBy === 'name' ? { name: v } : { kind: v } })
        }}
      />
      <button
        class={'toggle' + (ch.enabled ? ' on' : '')}
        onClick={() => upsert({ ...ch, enabled: !ch.enabled })}
      >
        {ch.enabled ? '啟用中' : '停用'}
      </button>
      <button class="del" onClick={() => window.channelsBridge.deleteChannel(ch.id)}>
        ✕
      </button>
    </div>
  )
}

function App(): preact.JSX.Element {
  return (
    <div class="panel">
      <header>
        <div class="title">頻道</div>
        <button class="close" onClick={() => window.close()}>
          ×
        </button>
      </header>
      <div class="hint">啟用某頻道 → 通知中心多一個分頁（B 階段會長自己的寵物）。自動偵測到的新來源會以「停用」加入。</div>
      <div class="list">
        {channels.value.map((ch) => (
          <Row ch={ch} key={ch.id} />
        ))}
        {channels.value.length === 0 && <div class="empty">尚無頻道（發一則通知即會自動偵測）</div>}
      </div>
      <button
        class="add"
        onClick={() =>
          upsert({ id: newId(), name: '新頻道', skin: skins.value[0]?.id ?? 'may', enabled: false, match: { name: '' } })
        }
      >
        ＋ 手動新增
      </button>
    </div>
  )
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close()
})

render(<App />, document.querySelector('#app')!)
```

（註：手動新增預設 match `{name:''}`，使用者改值；空字串 match 在 main 端不會命中、core sanitize 也容許暫存編輯中的狀態——upsert 後使用者填值即生效。`DiscoveredSkin` 的 `displayName` 欄位若不存在則退回 id。）

- [ ] **Step 3: channels.css**

`src/renderer/channels.css`：

```css
html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; }
.panel {
  display: flex; flex-direction: column; height: 100vh; box-sizing: border-box;
  background: #fffdf8; border-radius: 14px; box-shadow: 0 12px 34px rgba(46, 33, 18, .3);
  font-family: ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif; color: #2a2622; overflow: hidden;
}
header { display: flex; justify-content: space-between; align-items: center; padding: 11px 14px 8px; }
.title { font-weight: 800; font-size: 14px; }
.close { border: none; background: none; font-size: 16px; color: #8a7f70; cursor: pointer; width: 22px; height: 22px; border-radius: 50%; }
.close:hover { background: #efe9df; color: #d6453d; }
.hint { font-size: 11px; color: #ad9f8c; padding: 0 14px 8px; }
.list { flex: 1; overflow-y: auto; padding: 0 10px; }
.row { display: flex; gap: 6px; align-items: center; padding: 5px 4px; border-bottom: 1px solid #efe9df; }
.row[data-enabled="false"] { opacity: .6; }
.row .name { width: 88px; }
.row .val { width: 92px; }
.row input, .row select {
  font: 600 11px ui-rounded, system-ui, sans-serif; padding: 3px 5px; border: 1px solid #e3dccf;
  border-radius: 6px; background: #fff; color: #2a2622; min-width: 0;
}
.row .toggle { border: none; border-radius: 6px; padding: 3px 8px; font: 700 11px ui-rounded, system-ui, sans-serif; cursor: pointer; background: #efe9df; color: #8a7f70; }
.row .toggle.on { background: #2e9e6b; color: #fff; }
.row .del { border: none; background: none; color: #b3a692; cursor: pointer; font-size: 13px; }
.row .del:hover { color: #d6453d; }
.empty { text-align: center; color: #a89c8b; font-size: 12px; padding: 30px 0; }
.add { margin: 8px 14px 14px; padding: 7px; border: none; border-radius: 8px; background: #2a2622; color: #fff; font: 700 12px ui-rounded, system-ui, sans-serif; cursor: pointer; }
```

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: PASS（`channels.tsx` 用 preact jsx，tsconfig.web 已設）。

- [ ] **Step 5: commit**

```bash
git add src/renderer/channels.html src/renderer/channels.tsx src/renderer/channels.css
git commit -m "feat(renderer): 頻道管理 UI（Preact + signals）：啟停/刪/編輯 match/skin/手動新增"
```

---

## Task 10: 整合驗證 + 手動驗收

- [ ] **Step 1: 全量 typecheck + 單元測試**

Run: `npm run typecheck && npm test`
Expected: PASS（含 `channel` 測試）。

- [ ] **Step 2: build（驗證 channels 入口 + preact 產出）**

Run: `npm run build`
Expected: 成功；`out/renderer/channels.html`、`out/preload/channels.cjs` 存在。

- [ ] **Step 3: e2e**

Run: `npm run e2e`
Expected: SMOKE_RESULT: PASS（既有鏈路不壞）。

- [ ] **Step 4: 手動驗收（`npm run dev`，對照 spec §11）**

1. 發不同 source（CC 兩專案 + curl 帶 `source.kind=attendance`）→ 右鍵「頻道…」管理視窗看到自動建的**停用** channel（去重不重複）。
2. 啟用某 group → 通知中心多一個分頁、該分頁只含命中訊息、未讀數正確；「全部」仍含全部。
3. 編輯 match（name↔kind）/ 改名 / 換 skin / 刪除 → 中心分頁即時回溯重分類。
4. 手動新增、填 match 值（預建尚未出現的來源）→ 之後該類訊息進該分頁。
5. 重疊：兩個 matcher 都命中同一 source 的 group → 該訊息兩分頁都出現。
6. 重啟 → channels 持久化還在；舊 prefs.json（無 channels）不壞。
7. 確認 **A 沒有長出新寵物**（仍只有「全部」那隻）。

- [ ] **Step 5: 交付使用者測試後再 merge**

請使用者實機驗收（自動偵測、啟停分頁、編輯回溯、重疊、持久化）。OK 後才合併到 main。

---

## Self-Review

**1. Spec coverage：**
- §3 模型（Channel/SourceMatch、全部隱含）→ Task 1（型別）+ Task 6（全部分頁）✓。
- §4 core 純函式 → Task 1 ✓（matchingChannels 僅 enabled、filterByChannel all→全部、unreadByChannel、sanitize）。
- §5 自動偵測（(a)未被啟用命中 +(b)無相同 match）→ Task 4 Step 4 ✓。
- §6 main 唯一寫入 + upsert/delete/get-channels/channels-updated + prefs 持久化/sanitize → Task 2/3/4 ✓。
- §7 通知中心分頁（全部+啟用 group、filterByChannel/unreadByChannel、回溯、停用不出現分頁）→ Task 6 ✓。
- §8 頻道管理視窗（獨立、Preact+signals、列出全部含停用、啟停/刪/編輯/手動新增/skin）→ Task 8/9 ✓。
- §9 技術棧（preact/signals/preset-vite、tsconfig jsx、隔離）→ Task 7/9 ✓。
- §10 檔案清單 → Tasks 對應 ✓。

**2. Placeholder scan：** 無 TBD。Task 4 有「實作順序」說明（createChannelsWindow 依賴 Task 8）非占位、是依賴排序指引；建議順序 1→2→3→5→6→7→8→4→9→10。

**3. Type consistency：**
- `Channel{id,name,skin,enabled,match}` / `SourceMatch{kind?,name?}`：Task 1 定義；Task 2(prefs)、3(contract/preload)、4(main)、6(center)、8(preload/window)、9(tsx) 一致引用。
- channel：`channel-upsert(Channel)` / `channel-delete({id})` / `get-channels(→Channel[])` / `channels-updated(Channel[])`：Task 3 定義；Task 4 handlers、Task 6/8 preload、Task 9 UI 一致。
- 純函式簽名 `matchingChannels(source,channels)`、`filterByChannel(messages,channelId,channels)`、`unreadByChannel(messages,channels)`、`sanitizeChannels(raw)`：Task 1 定義；Task 4(main)/6(center) 使用一致。
- `channelsBridge`（Task 8）與 `petBridge.getChannels/onChannelsUpdated`（Task 3）分屬頻道視窗 / 中心，channel 名共用、payload 一致。
