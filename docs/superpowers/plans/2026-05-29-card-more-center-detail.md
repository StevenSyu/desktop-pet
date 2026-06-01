# 點「更多」看全文 + 通知中心強化（Spec ⑧）Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 即時卡片內文精簡 + 右下「更多」入口 → 開通知中心單則詳情面板（Markdown 安全渲染 + 完整 metadata）；通知中心改開在寵物所在螢幕那側。

**Architecture:** 兩個 core 純函式（`cardSummary` 精簡首段、`renderMarkdown` escape-first 安全渲染）+ 擴充 `cardPosition`（y 夾）；卡片加「更多」走新 IPC `card-more`（共用既有 `card-dismissed` 清理）；main 以 `pendingDetailId` + 一次性 query `get-pending-detail` + void push `open-detail` 統一「新開/已開」中心；通知中心新增列表↔詳情兩態，詳情用 `innerHTML = renderMarkdown(body)`。

**Tech Stack:** Electron + electron-vite、TypeScript、typed IPC contract（`src/ipc`）、Vitest（純函式 TDD）。

**依據 spec：** `docs/superpowers/specs/2026-05-29-card-more-center-detail-design.md`

**尺寸/常數：** `CARD_SUMMARY_MAX = 60`（首段長度上限）；`CENTER_W = 300`、`CENTER_H = 440`（沿用現值，改為具名匯出）；中心定位 gap = 8。

---

## File Structure

**新增**
- `src/core/card-summary.ts` — `cardSummary(plain) → {text,hasMore}`，卡片首段精簡（純函式）
- `src/core/markdown-render.ts` — `renderMarkdown(raw) → string`，escape-first 安全 Markdown→HTML（純函式）
- `tests/core/card-summary.test.ts`、`tests/core/markdown-render.test.ts`

**修改**
- `src/core/card-position.ts` — `cardPosition` 加 y 夾（+1 測試）
- `src/core/card-view.ts` — `CardView` 加 `hasMore`
- `src/renderer/main.ts` — `buildCardView` 用 `cardSummary`
- `src/renderer/card.ts` / `card.css` — 「更多」連結
- `src/preload/card.ts` — `cardMore`
- `src/preload/index.ts` / `api.d.ts` — `getPendingDetail` / `onOpenDetail`（petBridge）+ cardBridge `cardMore`
- `src/ipc/contract.ts` — `card-more` / `get-pending-detail` / `open-detail`
- `src/main/index.ts` — `pendingDetailId`、`card-more` handler、`get-pending-detail` query、`openCenter` 用 `cardPosition` 定位
- `src/main/center-window.ts` — 匯出 `CENTER_W/CENTER_H`、`createCenterWindow(pos?)`
- `src/renderer/center.ts` / `center.css` — 列表↔詳情面板

---

## Task 1: `cardSummary` 純函式（TDD）

> 純函式，可派 codex TDD、Claude review。worktree 內遇 EPERM 用 `npx vitest run --configLoader runner <path>`。

**Files:**
- Create: `src/core/card-summary.ts`
- Test: `tests/core/card-summary.test.ts`

- [ ] **Step 1: 寫失敗測試**

`tests/core/card-summary.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { cardSummary } from '../../src/core/card-summary'

describe('cardSummary', () => {
  it('單行短內容 → 原文、hasMore=false', () => {
    expect(cardSummary('完成任務')).toEqual({ text: '完成任務', hasMore: false })
  })
  it('多行 → 取第一非空行、hasMore=true', () => {
    expect(cardSummary('第一行\n第二行')).toEqual({ text: '第一行', hasMore: true })
  })
  it('純空白/只有換行 → 空字串、hasMore=false', () => {
    expect(cardSummary('   \n  ')).toEqual({ text: '', hasMore: false })
  })
  it('首行超長無句號 → 硬切 60 + …、hasMore=true', () => {
    const long = 'a'.repeat(80)
    const r = cardSummary(long)
    expect(r.text).toBe('a'.repeat(60) + '…')
    expect(r.hasMore).toBe(true)
  })
  it('首行超長含句號（句號在 60 內）→ 切到句號、hasMore=true', () => {
    const body = 'x'.repeat(40) + '。' + 'y'.repeat(40)
    const r = cardSummary(body)
    expect(r.text).toBe('x'.repeat(40) + '。')
    expect(r.hasMore).toBe(true)
  })
  it('正規化 CRLF', () => {
    expect(cardSummary('一\r\n二')).toEqual({ text: '一', hasMore: true })
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/card-summary.test.ts`
Expected: FAIL — 找不到模組 `card-summary`。

- [ ] **Step 3: 實作**

`src/core/card-summary.ts`：

```ts
export interface CardSummary {
  text: string
  hasMore: boolean
}

const MAX = 60

/** 卡片首段精簡。輸入須為已 stripMarkdown 的純文字。 */
export function cardSummary(plain: string): CardSummary {
  const normalizedFull = plain.replace(/\r\n?/g, '\n').trim()
  if (normalizedFull === '') return { text: '', hasMore: false }

  const firstLine = (normalizedFull.split('\n').find((l) => l.trim() !== '') ?? '').trim()
  let text = firstLine
  if (text.length > MAX) {
    const period = text.indexOf('。')
    if (period >= 0 && period + 1 <= MAX) {
      text = text.slice(0, period + 1)
    } else {
      text = text.slice(0, MAX) + '…'
    }
  }
  return { text, hasMore: text !== normalizedFull }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/core/card-summary.test.ts`
Expected: PASS（6 案例）。

- [ ] **Step 5: commit**

```bash
git add src/core/card-summary.ts tests/core/card-summary.test.ts
git commit -m "feat(core): cardSummary 卡片首段精簡（換行/句號切分 + hasMore）"
```

---

## Task 2: `renderMarkdown` 安全渲染純函式（TDD）⚠️ 安全關鍵

> 純函式，可派 codex TDD、Claude review。XSS 測試務必齊全。

**Files:**
- Create: `src/core/markdown-render.ts`
- Test: `tests/core/markdown-render.test.ts`

- [ ] **Step 1: 寫失敗測試**

`tests/core/markdown-render.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '../../src/core/markdown-render'

describe('renderMarkdown — 安全跳脫', () => {
  it('HTML 特殊字元被跳脫', () => {
    expect(renderMarkdown('<b>&"\'')).toBe('<p>&lt;b&gt;&amp;&quot;&#39;</p>')
  })
  it('<script> 不可執行', () => {
    expect(renderMarkdown('<script>alert(1)</script>')).toBe(
      '<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>',
    )
  })
  it('img onerror 被中和為純文字', () => {
    expect(renderMarkdown('<img src=x onerror=alert(1)>')).toBe(
      '<p>&lt;img src=x onerror=alert(1)&gt;</p>',
    )
  })
  it('連結語法不產生 <a>（不支援連結）', () => {
    expect(renderMarkdown('[x](javascript:alert(1))')).toBe('<p>[x](javascript:alert(1))</p>')
  })
})

describe('renderMarkdown — 語法', () => {
  it('粗體', () => {
    expect(renderMarkdown('**hi**')).toBe('<p><strong>hi</strong></p>')
  })
  it('行內 code 內容仍跳脫', () => {
    expect(renderMarkdown('`<b>`')).toBe('<p><code>&lt;b&gt;</code></p>')
  })
  it('清單', () => {
    expect(renderMarkdown('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>')
  })
  it('段落內換行 → <br>', () => {
    expect(renderMarkdown('a\nb')).toBe('<p>a<br>b</p>')
  })
  it('fenced code：內部 ** 不被轉、內容跳脫', () => {
    expect(renderMarkdown('```\n<b>**x**\n```')).toBe('<pre><code>&lt;b&gt;**x**</code></pre>')
  })
  it('長輸入不卡死（ReDoS 防護）', () => {
    expect(renderMarkdown('a'.repeat(50000)).startsWith('<p>')).toBe(true)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/markdown-render.test.ts`
Expected: FAIL — 找不到模組。

- [ ] **Step 3: 實作**

`src/core/markdown-render.ts`：

```ts
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// 在「已跳脫」字串上套行內語法（` 與 * 不受跳脫影響，故安全）。
function inline(escaped: string): string {
  return escaped
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

/**
 * 安全 Markdown→HTML。body 是外部不可信內容：先 escape，再套最小語法白名單。
 * 只產生無屬性標籤 <p><br><ul><li><strong><code><pre>；不支援連結/圖片/raw HTML。
 * 行為基礎 parser，正則皆 bounded，避免 ReDoS。
 */
export function renderMarkdown(raw: string): string {
  const lines = raw.replace(/\r\n?/g, '\n').split('\n')
  const html: string[] = []
  let para: string[] = []
  let list: string[] = []

  const flushPara = (): void => {
    if (para.length) {
      html.push('<p>' + para.join('<br>') + '</p>')
      para = []
    }
  }
  const flushList = (): void => {
    if (list.length) {
      html.push('<ul>' + list.map((li) => '<li>' + li + '</li>').join('') + '</ul>')
      list = []
    }
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trimStart().startsWith('```')) {
      flushPara()
      flushList()
      const code: string[] = []
      i++
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        code.push(lines[i])
        i++
      }
      i++ // 跳過收尾 ```
      html.push('<pre><code>' + escapeHtml(code.join('\n')) + '</code></pre>')
      continue
    }
    const m = /^\s*[-*]\s+(.*)$/.exec(line)
    if (m) {
      flushPara()
      list.push(inline(escapeHtml(m[1])))
      i++
      continue
    }
    if (line.trim() === '') {
      flushPara()
      flushList()
      i++
      continue
    }
    flushList()
    para.push(inline(escapeHtml(line)))
    i++
  }
  flushPara()
  flushList()
  return html.join('')
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/core/markdown-render.test.ts`
Expected: PASS（全案例，含 XSS）。

- [ ] **Step 5: commit**

```bash
git add src/core/markdown-render.ts tests/core/markdown-render.test.ts
git commit -m "feat(core): renderMarkdown 安全 Markdown 渲染（escape-first + 標籤白名單 + XSS 防護）"
```

---

## Task 3: `cardPosition` 加 y 夾（TDD）

**Files:**
- Modify: `src/core/card-position.ts`
- Test: `tests/core/card-position.test.ts`

- [ ] **Step 1: 加一個失敗測試**

在 `tests/core/card-position.test.ts` 的 `describe('cardPosition', ...)` 內新增（檔尾 `})` 前）：

```ts
  it('翻到下方會超出底部 → y 夾回工作區', () => {
    const shortWa: Rect = { x: 0, y: 0, width: 1440, height: 400 }
    const tall = { width: 264, height: 380 }
    const pet: Rect = { x: 1136, y: 0, width: 135, height: 146 }
    // x = 1136+135-264 = 1007（夾入 [0,1176] 仍 1007）
    // y：上方 = 0-380-8 < 0 → 下方 = 0+146+8 = 154；夾上限 = 400-380 = 20 → 20
    expect(cardPosition(pet, tall, shortWa, 8)).toEqual({ x: 1007, y: 20 })
  })
```

- [ ] **Step 2: 跑測試確認新案例失敗、舊 5 案例仍過**

Run: `npx vitest run tests/core/card-position.test.ts`
Expected: 新案例 FAIL（目前 y=154 未夾），其餘 5 PASS。

- [ ] **Step 3: 加 y 夾**

`src/core/card-position.ts`，把 `cardPosition` 結尾的 y 計算改為夾入 workArea：

```ts
  const aboveY = pet.y - card.height - gap
  const rawY = aboveY >= workArea.y ? aboveY : pet.y + pet.height + gap
  const y = clamp(rawY, workArea.y, workArea.y + workArea.height - card.height)

  return { x, y }
```

（`clamp` 已存在於檔內；x 計算不變。）

- [ ] **Step 4: 跑測試確認全過**

Run: `npx vitest run tests/core/card-position.test.ts`
Expected: PASS（6 案例）。

- [ ] **Step 5: commit**

```bash
git add src/core/card-position.ts tests/core/card-position.test.ts
git commit -m "feat(core): cardPosition 加 y 夾（供較高的通知中心視窗定位）"
```

---

## Task 4: `CardView.hasMore` + `buildCardView` 用 `cardSummary`

**Files:**
- Modify: `src/core/card-view.ts`
- Modify: `src/renderer/main.ts`

- [ ] **Step 1: CardView 加 hasMore**

`src/core/card-view.ts`，在 `source` 欄位後加：

```ts
  /** 來源 + session 短碼組合字串；無則為空字串。 */
  source: string
  /** 內文是否被精簡（截斷/多行）→ 卡片顯示「更多」入口。 */
  hasMore: boolean
}
```

- [ ] **Step 2: buildCardView 改用 cardSummary**

`src/renderer/main.ts`：頂部 import 區加：

```ts
import { cardSummary } from '../core/card-summary'
```

把 `buildCardView` 整個函式替換為：

```ts
function buildCardView(e: AppEvent): CardView {
  const sourceText = e.title || e.source.name || e.source.kind
  const sessionTag =
    e.sessionId && e.sessionId !== 'default' ? `#${e.sessionId.slice(0, 6)}` : ''
  const source = [sourceText, sessionTag].filter(Boolean).join(' · ')
  const s = cardSummary(e.body ? stripMarkdown(e.body) : '')
  return {
    id: e.id,
    type: e.type,
    label: LABEL[e.type],
    body: s.text,
    source,
    hasMore: s.hasMore,
  }
}
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: commit**

```bash
git add src/core/card-view.ts src/renderer/main.ts
git commit -m "feat(card): CardView 加 hasMore，卡片內文改用 cardSummary 精簡"
```

---

## Task 5: IPC contract 三個 channel

**Files:**
- Modify: `src/ipc/contract.ts`

- [ ] **Step 1: 加入 channel**

`src/ipc/contract.ts`：

`Commands` 介面尾端（`'card-clicked'` 那行之後）加：

```ts
  'card-more': { id: string }
```

`Queries` 介面尾端（`'select-skin'` 之後）加：

```ts
  'get-pending-detail': { args: void; result: { id: string | null } }
```

`Pushes` 介面尾端（`'card-dismissed'` 之後）加：

```ts
  'open-detail': void
```

- [ ] **Step 2: typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 3: commit**

```bash
git add src/ipc/contract.ts
git commit -m "feat(ipc): card-more / get-pending-detail / open-detail channel"
```

---

## Task 6: preload — cardBridge.cardMore + petBridge.getPendingDetail/onOpenDetail

**Files:**
- Modify: `src/preload/card.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/preload/api.d.ts`

- [ ] **Step 1: card preload 加 cardMore**

`src/preload/card.ts`，在 `exposeInMainWorld('cardBridge', {...})` 內加（`cardClicked` 那行後）：

```ts
  cardMore: (id: string) => ipcRenderer.send('card-more', { id }),
```

- [ ] **Step 2: pet preload 加查詢/訂閱**

`src/preload/index.ts`，在 `onCardDismissed` 那行之後加：

```ts
  getPendingDetail: () => invokeQuery('get-pending-detail'),
  onOpenDetail: (cb: () => void) => subscribePush('open-detail', cb),
```

- [ ] **Step 3: 型別宣告**

`src/preload/api.d.ts`：

`petBridge` 物件型別內，`onCardDismissed` 那行之後加：

```ts
      getPendingDetail: () => Promise<{ id: string | null }>
      onOpenDetail: (cb: () => void) => void
```

`cardBridge` 物件型別內，`cardClicked` 那行之後加：

```ts
      cardMore: (id: string) => void
```

- [ ] **Step 4: typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 5: commit**

```bash
git add src/preload/card.ts src/preload/index.ts src/preload/api.d.ts
git commit -m "feat(preload): cardBridge.cardMore + petBridge.getPendingDetail/onOpenDetail"
```

---

## Task 7: 卡片「更多」連結

**Files:**
- Modify: `src/renderer/card.ts`
- Modify: `src/renderer/card.css`

- [ ] **Step 1: card.ts 渲染「更多」**

`src/renderer/card.ts`，在 `render` 函式內 `source` 區塊之後、函式結尾前加：

```ts
  if (view.hasMore) {
    const more = document.createElement('button')
    more.className = 'card-more'
    more.textContent = '更多'
    more.addEventListener('click', (e) => {
      e.stopPropagation() // 不要觸發卡片本體的關閉
      if (currentId) window.cardBridge.cardMore(currentId)
    })
    root.appendChild(more)
  }
```

- [ ] **Step 2: card.css 加樣式**

`src/renderer/card.css` 檔尾加：

```css
.card-more {
  display: block;
  margin-left: auto;
  margin-top: 4px;
  border: none;
  background: none;
  color: #8a7f70;
  font: 700 11px ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
  cursor: pointer;
  padding: 1px 2px;
}
.card-more:hover { color: #2a2622; text-decoration: underline; }
```

- [ ] **Step 3: typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 4: commit**

```bash
git add src/renderer/card.ts src/renderer/card.css
git commit -m "feat(card): hasMore 時右下顯示「更多」連結（stopPropagation 不觸發關閉）"
```

---

## Task 8: main — card-more handler + get-pending-detail + 中心定位

**Files:**
- Modify: `src/main/center-window.ts`
- Modify: `src/main/index.ts`

- [ ] **Step 1: center-window 匯出尺寸 + 接座標**

`src/main/center-window.ts`：把 `const W = 300` / `const H = 440` 改為具名匯出，並讓 `createCenterWindow` 接受可選座標：

```ts
export const CENTER_W = 300
export const CENTER_H = 440
const MARGIN = 24
const PET_RESERVE = 320

export function createCenterWindow(pos?: { x: number; y: number }): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.workArea

  const win = new BrowserWindow({
    width: CENTER_W,
    height: CENTER_H,
    x: pos?.x ?? x + width - CENTER_W - MARGIN,
    y: pos?.y ?? Math.max(y + 8, y + height - CENTER_H - MARGIN - PET_RESERVE),
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
```

（其餘 `win.setAlwaysOnTop` / `setVisibleOnAllWorkspaces` / `loadURL`/`loadFile` / `blur` 關閉 / `return win` 不變。原本檔內凡用到 `W`/`H` 的地方一律改成 `CENTER_W`/`CENTER_H`。）

- [ ] **Step 2: index.ts import + 狀態**

`src/main/index.ts`：把 center-window 的 import 改成同時引入尺寸：

```ts
import { createCenterWindow, CENTER_W, CENTER_H } from './center-window'
```

在 `let pendingCard ...` / `let activeCardId ...` 附近加：

```ts
let pendingDetailId: string | null = null
```

（`cardPosition`、`screen` 已於 ⑦ 引入；若未引入則補 `import { cardPosition } from '../core/card-position'`。）

- [ ] **Step 3: openCenter 改用 cardPosition 定位**

`src/main/index.ts`，把 `openCenter()` 函式替換為：

```ts
function computeCenterPos(): { x: number; y: number } | undefined {
  if (!petWindow || petWindow.isDestroyed()) return undefined
  const pet = petWindow.getBounds()
  const display = screen.getDisplayMatching(pet)
  return cardPosition(pet, { width: CENTER_W, height: CENTER_H }, display.workArea, 8)
}

function openCenter(): void {
  const pos = computeCenterPos()
  if (centerWindow && !centerWindow.isDestroyed()) {
    if (pos) centerWindow.setPosition(pos.x, pos.y)
    centerWindow.focus()
    return
  }
  centerWindow = createCenterWindow(pos)
  centerWindow.on('closed', () => {
    centerWindow = null
  })
  centerWindow.webContents.once('did-finish-load', () => broadcastMessages())
}
```

- [ ] **Step 4: card-more handler + get-pending-detail query**

`src/main/index.ts`，在 `card-clicked` handler 之後加：

```ts
  handleCommand('card-more', ({ id }) => {
    if (id !== activeCardId) return
    activeCardId = null
    if (cardWindow && !cardWindow.isDestroyed()) cardWindow.hide()
    pushTo(petWindow, 'card-dismissed', { id }) // pet renderer 照常 markRead + 清理
    pendingDetailId = id
    openCenter()
    pushTo(centerWindow, 'open-detail') // 已開窗 → 觸發重查；新開窗靠載入時 query
  })
  handleQuery('get-pending-detail', () => {
    const id = pendingDetailId
    pendingDetailId = null
    return { id }
  })
```

- [ ] **Step 5: typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 6: commit**

```bash
git add src/main/center-window.ts src/main/index.ts
git commit -m "feat(main): card-more 開中心詳情（共用 dismiss + pendingDetailId）；中心改開在寵物所在螢幕（cardPosition）"
```

---

## Task 9: 通知中心 — 列表↔詳情面板

**Files:**
- Modify: `src/renderer/center.ts`
- Modify: `src/renderer/center.css`

- [ ] **Step 1: center.ts — import + 狀態**

`src/renderer/center.ts`：頂部 import 區加：

```ts
import { renderMarkdown } from '../core/markdown-render'
```

在 `let filter ...` 之後加：

```ts
let detailId: string | null = null
let savedScrollTop = 0
let flashId: string | null = null
```

- [ ] **Step 2: 列表項點擊 → 開詳情**

`src/renderer/center.ts`，把 `buildItem` 內的 click handler：

```ts
  item.addEventListener('click', () => {
    if (!m.read) window.petBridge.markRead(m.id) // main 會回推更新
  })
```

替換為：

```ts
  item.addEventListener('click', () => {
    savedScrollTop = listEl.scrollTop
    detailId = m.id
    render()
  })
```

- [ ] **Step 3: render 改為列表/詳情分派 + 抽出 renderList**

`src/renderer/center.ts`，把現有 `function render(): void { ... }` 整段替換為：

```ts
function render(): void {
  const msg = detailId ? all.find((m) => m.id === detailId) : null
  if (detailId && !msg) detailId = null // 該則已被清空/淘汰 → fallback 回列表
  if (msg) {
    renderDetail(msg)
    return
  }
  renderList()
}

function renderList(): void {
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
    const el = buildItem(m, now)
    if (m.id === flashId) el.classList.add('flash')
    listEl.appendChild(el)
  }
  listEl.scrollTop = savedScrollTop
  flashId = null
}

function renderDetail(m: StoredMessage): void {
  if (!m.read) window.petBridge.markRead(m.id) // 進詳情才標已讀（未讀才送，避免重複 broadcast）
  chipsEl.replaceChildren() // 詳情時清掉 chips（回列表時 renderChips 會重建）
  emptyEl.hidden = true

  const wrap = document.createElement('div')
  wrap.className = 'detail'
  wrap.dataset.type = m.type

  const back = document.createElement('button')
  back.className = 'back'
  back.textContent = '← 返回'
  back.addEventListener('click', () => {
    flashId = m.id
    detailId = null
    render()
  })
  wrap.appendChild(back)

  const label = document.createElement('div')
  label.className = 'detail-label'
  label.textContent = LABEL[m.type]
  wrap.appendChild(label)

  if (m.body) {
    const body = document.createElement('div')
    body.className = 'detail-body'
    // 安全：renderMarkdown escape-first + 無屬性標籤白名單（見 markdown-render 測試）
    body.innerHTML = renderMarkdown(m.body)
    wrap.appendChild(body)
  }

  const meta = document.createElement('div')
  meta.className = 'detail-meta'
  const src = m.title || m.source.name || m.source.kind
  const rows: [string, string][] = [
    ['來源', src],
    ['session', m.sessionId],
    ['時間', new Date(m.timestamp).toLocaleString()],
    ['收到', new Date(m.receivedAt).toLocaleString()],
  ]
  for (const [k, v] of rows) {
    const row = document.createElement('div')
    row.className = 'detail-row'
    const key = document.createElement('span')
    key.className = 'k'
    key.textContent = k
    const val = document.createElement('span')
    val.className = 'v'
    val.textContent = v
    row.appendChild(key)
    row.appendChild(val)
    meta.appendChild(row)
  }
  wrap.appendChild(meta)

  listEl.replaceChildren(wrap)
}
```

- [ ] **Step 4: Esc 合併兩段式**

`src/renderer/center.ts`，把現有：

```ts
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.close()
})
```

替換為：

```ts
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return
  if (detailId) {
    flashId = detailId
    detailId = null
    render()
  } else {
    window.close()
  }
})
```

- [ ] **Step 5: 載入時 query pending detail + onOpenDetail**

`src/renderer/center.ts`，把檔尾：

```ts
window.petBridge.getMessages().then((msgs) => {
  all = msgs
  render()
})
```

替換為：

```ts
function consumePendingDetail(): void {
  window.petBridge.getPendingDetail().then(({ id }) => {
    if (id) {
      detailId = id
      render()
    }
  })
}

window.petBridge.getMessages().then((msgs) => {
  all = msgs
  render()
  consumePendingDetail() // 新開窗：載入後取 pending
})
window.petBridge.onOpenDetail(consumePendingDetail) // 已開窗：被 main 觸發重查
```

- [ ] **Step 6: center.css 詳情面板樣式**

`src/renderer/center.css` 檔尾加：

```css
.detail { padding: 6px 14px 14px; overflow-y: auto; flex: 1; }
.detail[data-type="done"]      { --accent: #2e9e6b; }
.detail[data-type="attention"] { --accent: #e08a2b; }
.detail[data-type="error"]     { --accent: #d6453d; }
.detail[data-type="review"]    { --accent: #5b6ee0; }
.detail[data-type="working"]   { --accent: #2e9e9e; }
.detail[data-type="info"]      { --accent: #8a8175; }
.back {
  border: none;
  background: none;
  color: #8a7f70;
  font: 600 12px ui-rounded, "SF Pro Rounded", system-ui, sans-serif;
  cursor: pointer;
  padding: 4px 0;
}
.back:hover { color: #2a2622; }
.detail-label { font-size: 12px; font-weight: 800; color: var(--accent); margin-top: 4px; }
.detail-body { font-size: 13px; line-height: 1.5; margin-top: 6px; word-break: break-word; }
.detail-body p { margin: 0 0 8px; }
.detail-body ul { margin: 0 0 8px; padding-left: 18px; }
.detail-body li { margin: 1px 0; }
.detail-body strong { font-weight: 800; }
.detail-body code {
  background: #efe9df;
  padding: 1px 4px;
  border-radius: 4px;
  font-size: 12px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.detail-body pre {
  background: #efe9df;
  padding: 8px 10px;
  border-radius: 8px;
  overflow-x: auto;
  margin: 0 0 8px;
}
.detail-body pre code { background: none; padding: 0; }
.detail-meta {
  margin-top: 10px;
  padding-top: 8px;
  border-top: 1px solid #efe9df;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.detail-row { display: flex; gap: 8px; font-size: 11px; }
.detail-row .k { color: #ad9f8c; min-width: 44px; }
.detail-row .v { color: #5a5247; word-break: break-all; }
.item.flash { animation: flash 1.1s ease-out; }
@keyframes flash {
  from { background: color-mix(in srgb, var(--accent) 26%, transparent); }
  to { background: transparent; }
}
```

- [ ] **Step 7: typecheck**

Run: `npm run typecheck`
Expected: PASS。

- [ ] **Step 8: commit**

```bash
git add src/renderer/center.ts src/renderer/center.css
git commit -m "feat(center): 列表↔單則詳情面板（markdown 渲染 + 完整 metadata + Esc 兩段式 + 失效 fallback + scroll/highlight）"
```

---

## Task 10: 整合驗證 + 手動驗收

**Files:**（不改碼，必要時微調樣式）

- [ ] **Step 1: 全量 typecheck + 單元測試**

Run: `npm run typecheck && npm test`
Expected: PASS（含 card-summary / markdown-render / card-position 與既有測試全綠）。

- [ ] **Step 2: e2e smoke**

Run: `npm run e2e`
Expected: SMOKE_RESULT: PASS（既有卡片鏈路不壞）。

- [ ] **Step 3: build**

Run: `npm run build`
Expected: 成功。

- [ ] **Step 4: 手動驗收（`npm run dev`，對照 spec §9）**

1. 短內文卡片無「更多」；長/多行內文卡片右下出現「更多」。
2. 點卡片本體 → 關閉 + 標已讀（不變）。
3. 點「更多」→ 卡片關、通知中心開並直接顯示該則詳情；徽章更新。
4. 通知中心已開時再點「更多」→ 中心切到該則詳情（focus）。
5. 詳情 Markdown 正確（清單/粗體/程式碼/換行）、metadata 完整；含 `<script>` 之類內文不會執行（顯示為純文字）。
6. Esc：詳情→列表→關窗兩段式；列表點任一則進詳情。
7. 詳情中該則被「清空」→ 自動 fallback 回列表。
8. 返回列表後 scroll 位置還原 + 該則 highlight 閃一下。
9. **通知中心定位**：把寵物拖到副螢幕 → 開中心/點「更多」→ 中心出現在副螢幕、靠寵物那側。

- [ ] **Step 5: 交付使用者測試後再 merge**

請使用者實機驗收（卡片更多→詳情、markdown 呈現、多螢幕中心定位、Esc 兩段式）。OK 後才合併到 main。

---

## Self-Review

**1. Spec coverage：**
- §2 卡片更多 opt-in → Task 4/7 ✓；卡片內文精簡 → Task 1/4 ✓；列表↔詳情 → Task 9 ✓；詳情 markdown+metadata → Task 2/9 ✓；最小安全 markdown → Task 2 ✓；中心定位跟寵物 → Task 3/8 ✓。
- §4 cardSummary（輸入 stripMarkdown 後）→ Task 1 + Task 4（`cardSummary(stripMarkdown(body))`）✓。
- §5 renderMarkdown escape-first/白名單/fenced 先處理/僅 detail 用 → Task 2 + Task 9 ✓；列表維持 textContent ✓（Task 9 未動 buildItem 的 body textContent）。
- §6 detailId/驗證 fallback/未讀才 markRead/Esc 合併/scroll+highlight → Task 9 ✓。
- §7 IPC（card-more cmd、get-pending-detail query、open-detail void push）→ Task 5/6/8 ✓；card-more 共用 card-dismissed → Task 8 ✓；統一兩路徑 → Task 8（query）+ Task 9（consumePendingDetail on load + onOpenDetail）✓。
- §7.5 cardPosition y 夾 + openCenter 定位 → Task 3/8 ✓。

**2. Placeholder scan：** 無 TBD。Task 9 Step 3 內對 `renderDetail` 首行有一個「手誤占位」的明確修正說明（要求只保留 `chipsEl.replaceChildren()`）——為避免混淆，實作時直接照修正版（不要 `renderChips()` 那行）。其餘步驟皆含完整程式。

**3. Type consistency：**
- `CardView`{id,type,label,body,source,hasMore}：Task 4 定義，Task 7（讀 view.hasMore）、Task 4 buildCardView 一致。
- `cardSummary(plain) → {text,hasMore}`：Task 1 定義、Task 4 使用一致。
- `renderMarkdown(raw) → string`：Task 2 定義、Task 9 使用一致。
- channel：`card-more`{id}（Task 5 contract、Task 6 cardBridge.cardMore、Task 8 handler）；`get-pending-detail`→{id:string|null}（Task 5、Task 6 getPendingDetail、Task 8 query、Task 9 consume）；`open-detail` void（Task 5、Task 6 onOpenDetail、Task 8 pushTo、Task 9 onOpenDetail）——一致。
- `CENTER_W/CENTER_H`：Task 8 center-window 匯出、index.ts 引用一致；`cardPosition(pet, {width,height}, workArea, gap)` 簽名與 Task 3 一致。
