# 寵物名稱標籤 + 頻道造型整合 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development 或 superpowers:executing-plans 逐任務實作。步驟用 `- [ ]` 追蹤。

**Goal:** 寵物加可選 channel 名稱標籤（三態全域）；造型選擇視窗改「認 channel」並讓頻道頁外開它、把「全部」納入頻道頁造型設定。

**Architecture:** Part1 純 renderer + 一個 prefs 欄位 + 右鍵子選單；Part2/3 把 `get-skins`/`select-skin` handler 從 window.ts 移到 index.ts 並 channel 化（沿用 `?c=` 與 channel-upsert/推播機制），頻道頁下拉改外開造型視窗按鈕。

**Tech Stack:** Electron + electron-vite、TypeScript、Preact（僅 channels.tsx）、Vitest（純函式 TDD）、Playwright `_electron`（探針）。

設計依據：`docs/superpowers/specs/2026-06-02-channel-label-and-skin-picker-design.md`

---

### Task 1: core 純函式 `channel-label`（TDD）

**Files:**
- Create: `src/core/channel-label.ts`
- Test: `tests/core/channel-label.test.ts`

- [ ] **Step 1: 寫失敗測試**

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeLabelMode, shouldShowLabel } from '../../src/core/channel-label'

describe('sanitizeLabelMode', () => {
  it('合法值原樣', () => {
    expect(sanitizeLabelMode('hidden')).toBe('hidden')
    expect(sanitizeLabelMode('hover')).toBe('hover')
    expect(sanitizeLabelMode('always')).toBe('always')
  })
  it('非法值 → hidden', () => {
    expect(sanitizeLabelMode('x')).toBe('hidden')
    expect(sanitizeLabelMode(undefined)).toBe('hidden')
    expect(sanitizeLabelMode(123)).toBe('hidden')
  })
})

describe('shouldShowLabel', () => {
  it('hidden 永不顯示', () => {
    expect(shouldShowLabel('hidden', true)).toBe(false)
    expect(shouldShowLabel('hidden', false)).toBe(false)
  })
  it('always 永遠顯示', () => {
    expect(shouldShowLabel('always', false)).toBe(true)
    expect(shouldShowLabel('always', true)).toBe(true)
  })
  it('hover 只在 hovering 時顯示', () => {
    expect(shouldShowLabel('hover', true)).toBe(true)
    expect(shouldShowLabel('hover', false)).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗** — `npm test -- channel-label`（Expected: FAIL，模組不存在）

- [ ] **Step 3: 實作**

```ts
export type ChannelLabelMode = 'hidden' | 'hover' | 'always'

const MODES: ChannelLabelMode[] = ['hidden', 'hover', 'always']

export function sanitizeLabelMode(raw: unknown): ChannelLabelMode {
  return typeof raw === 'string' && (MODES as string[]).includes(raw)
    ? (raw as ChannelLabelMode)
    : 'hidden'
}

export function shouldShowLabel(mode: ChannelLabelMode, hovering: boolean): boolean {
  if (mode === 'always') return true
  if (mode === 'hover') return hovering
  return false
}
```

- [ ] **Step 4: 跑測試確認通過** — `npm test -- channel-label`（Expected: PASS）

- [ ] **Step 5: Commit** — `feat(core): channel-label 純函式（sanitize + shouldShow）`

---

### Task 2: prefs 加 `channelLabelMode`

**Files:** Modify `src/main/prefs.ts`

- [ ] **Step 1:** import：`import { sanitizeLabelMode, type ChannelLabelMode } from '../core/channel-label'`
- [ ] **Step 2:** `Prefs` 介面加 `channelLabelMode: ChannelLabelMode`
- [ ] **Step 3:** `DEFAULTS` 加 `channelLabelMode: 'hidden'`
- [ ] **Step 4:** `loadPrefs` 三個 return 都帶該欄位：
  - 檔不存在 / catch 兩個 fallback：補 `channelLabelMode: 'hidden'`
  - 正常解析：`channelLabelMode: sanitizeLabelMode(parsed.channelLabelMode)`
- [ ] **Step 5:** 跑 `npm run typecheck` 確認通過（會帶出後續任務要補的型別，先確認 prefs 本身編譯過）
- [ ] **Step 6: Commit** — `feat(prefs): 新增 channelLabelMode（預設 hidden）`

---

### Task 3: Part1 renderer — 名稱標籤 pill

**Files:** Modify `src/renderer/index.html`、`src/renderer/styles.css`、`src/renderer/main.ts`

- [ ] **Step 1: index.html** — `<div id="pet"></div>` 後加 `<div id="channel-label" hidden></div>`

- [ ] **Step 2: styles.css** — 加：

```css
#channel-label {
  position: absolute;
  left: 50%;
  bottom: 6px;
  transform: translateX(-50%);
  max-width: 90%;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(30, 30, 30, 0.72);
  color: #fff;
  font: 600 11px/1.4 -apple-system, 'SF Pro Rounded', system-ui, sans-serif;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  pointer-events: none;
  user-select: none;
}
#channel-label[hidden] { display: none; }
```

- [ ] **Step 3: main.ts** — 加標籤邏輯（放在既有 `petEl`、`myChannel` 取得之後；hover 旗標與既有 `mouseenter/mouseleave` 整合）：

```ts
import { sanitizeLabelMode, shouldShowLabel, type ChannelLabelMode } from '../core/channel-label'

const labelEl = document.querySelector<HTMLDivElement>('#channel-label')!
let labelMode: ChannelLabelMode = 'hidden'
let labelHovering = false
let channelName = myChannel === 'all' ? '全部' : myChannel

function applyLabel(): void {
  labelEl.textContent = channelName
  labelEl.hidden = !shouldShowLabel(labelMode, labelHovering)
}

// 名稱：查 channels 找 myChannel 的 name
window.petBridge.getChannels().then((cs) => {
  if (myChannel !== 'all') {
    const ch = cs.find((c) => c.id === myChannel)
    if (ch) channelName = ch.name
  }
  applyLabel()
})
window.petBridge.onChannelsUpdated((cs) => {
  if (myChannel !== 'all') {
    const ch = cs.find((c) => c.id === myChannel)
    if (ch) channelName = ch.name
  }
  applyLabel()
})

// 模式：讀 prefs + 訂閱變更
window.petBridge.getPrefs().then((p) => { labelMode = sanitizeLabelMode(p.channelLabelMode); applyLabel() })
window.petBridge.onPrefsChanged((p) => { labelMode = sanitizeLabelMode(p.channelLabelMode); applyLabel() })
```

在既有的 `petEl.addEventListener('mouseenter', …)` body 內加 `labelHovering = true; applyLabel()`；`mouseleave` 內加 `labelHovering = false; applyLabel()`。（不要改動既有 hover 互動邏輯，只附加這兩行。）

> 註：`getPrefs()` / `onPrefsChanged` 的型別在 Task 5 擴成含 `channelLabelMode`。本任務先寫呼叫，型別補上後 typecheck 才綠 —— Task 5 完成後一起驗。

- [ ] **Step 4: Commit** — `feat(pet): channel 名稱標籤 pill（hidden/hover/always）`

---

### Task 4: Part1 menu — 名稱標籤子選單 + 廣播

**Files:** Modify `src/main/window.ts`

- [ ] **Step 1:** `show-context-menu` 模板在「更換造型…」後、「頻道…」前插入子選單：

```ts
{
  label: '名稱標籤',
  submenu: [
    { label: '隱藏',       type: 'radio', checked: prefs.channelLabelMode === 'hidden', click: () => setLabelMode('hidden') },
    { label: '滑過時顯示', type: 'radio', checked: prefs.channelLabelMode === 'hover',  click: () => setLabelMode('hover') },
    { label: '常態顯示',   type: 'radio', checked: prefs.channelLabelMode === 'always', click: () => setLabelMode('always') },
  ],
},
```

- [ ] **Step 2:** 在 window.ts 適當位置（與其他 `applyDnd` 等 helper 同層）加：

```ts
function setLabelMode(mode: ChannelLabelMode): void {
  prefs = updatePrefs(app.getPath('userData'), { channelLabelMode: mode })
  for (const id of petChannelIds()) pushTo(getPetWindow(id), 'prefs-changed', prefs)
}
```
import：`import { type ChannelLabelMode } from '../core/channel-label'`（`petChannelIds` 已在本檔匯出/可用）。

- [ ] **Step 3:** 跑 `npm run typecheck`（此時 Task3 的 getPrefs 型別仍待 Task5；本步先確認 window.ts 本身無誤，型別整體綠留待 Task5）
- [ ] **Step 4: Commit** — `feat(menu): 名稱標籤三態子選單 + 廣播 prefs-changed`

---

### Task 5: Part2/3 contract + preload 介面

**Files:** Modify `src/ipc/contract.ts`、`src/preload/index.ts`、`src/preload/channels.ts`、`src/preload/api.d.ts`

- [ ] **Step 1: contract.ts**
  - `Commands` 加：`'open-skin-picker': { channelId: string }`
  - `Queries` 改：
    ```ts
    'get-skins': { args: { channelId: string }; result: { skins: DiscoveredSkin[]; requestedId: string; effectiveId: string } }
    'select-skin': { args: { channelId: string; id: string }; result: { ok: boolean; effectiveId: string } }
    'get-default-skin': { args: void; result: string }
    ```
  - `Pushes` 加：`'default-skin-updated': string`

- [ ] **Step 2: preload/index.ts**（petBridge）
  - `getSkins: (channelId: string) => invokeQuery('get-skins', { channelId })`
  - `selectSkin: (channelId: string, id: string) => invokeQuery('select-skin', { channelId, id })`
  - `getPrefs` 維持 `invokeQuery('get-prefs')`（型別在 api.d.ts 擴）

- [ ] **Step 3: preload/channels.ts**（channelsBridge）加：
  ```ts
  openSkinPicker: (channelId: string) => ipcRenderer.send('open-skin-picker', { channelId }),
  getDefaultSkin: (): Promise<string> => ipcRenderer.invoke('get-default-skin'),
  onDefaultSkinUpdated: (cb: (id: string) => void) => ipcRenderer.on('default-skin-updated', (_e, id: string) => cb(id)),
  ```

- [ ] **Step 4: api.d.ts**
  - petBridge：`getSkins: (channelId: string) => Promise<{ skins: DiscoveredSkin[]; requestedId: string; effectiveId: string }>`、`selectSkin: (channelId: string, id: string) => Promise<{ ok: boolean; effectiveId: string }>`
  - petBridge：`getPrefs: () => Promise<Prefs>`、`onPrefsChanged: (cb: (prefs: Prefs) => void) => void`（import `type { Prefs } from '../main/prefs'`；若有循環依賴疑慮，改為 inline `{ autoWalk: boolean; walk: WalkBounds; channelLabelMode: 'hidden'|'hover'|'always' }` 等必要欄位）
  - channelsBridge：補 `openSkinPicker`、`getDefaultSkin`、`onDefaultSkinUpdated` 型別

- [ ] **Step 5: Commit** — `feat(ipc): 造型命令 channel 化 + open-skin-picker / default-skin`

---

### Task 6: Part2 handler 搬移 + channel 化

**Files:** Modify `src/main/index.ts`、`src/main/window.ts`、`src/main/skin-window.ts`、`src/renderer/skins.ts`

- [ ] **Step 1: window.ts** — 移除 `handleQuery('get-skins', …)` 與 `handleQuery('select-skin', …)` 兩段（連同僅供其用、移走後無用的 import 若有）。`did-finish-load` 內推初始 skin 的邏輯（用 `skinFor`/`effectiveId`）**保留不動**。
- [ ] **Step 2: window.ts** — 「更換造型…」改：`{ label: '更換造型…', click: () => bus.emit('open-skins', channelId) }`（`channelId` 來自 `show-context-menu` 參數）。
- [ ] **Step 3: skin-window.ts** — `createSkinWindow(channelId: string)`：
  ```ts
  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/skins.html?c=${encodeURIComponent(channelId)}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/skins.html'), { query: { c: channelId } })
  }
  ```
- [ ] **Step 4: index.ts** — `import { scanSkins } from './skin-registry'`、`import { DEFAULT_SKIN_ID } from '../core/skins'`（若未 import），`builtinRoot` 用 window.ts 既有匯出或共用來源。註冊 channel-aware handler：
  ```ts
  handleQuery('get-skins', ({ channelId }) => {
    const { skins, sheetPaths } = scanSkins(app.getPath('userData'), builtinRoot())
    const requestedId = skinFor(channelId)
    return { skins, requestedId, effectiveId: sheetPaths.has(requestedId) ? requestedId : DEFAULT_SKIN_ID }
  })
  handleQuery('select-skin', ({ channelId, id }) => {
    const { sheetPaths } = scanSkins(app.getPath('userData'), builtinRoot())
    if (!sheetPaths.has(id)) {
      const cur = skinFor(channelId)
      return { ok: false, effectiveId: sheetPaths.has(cur) ? cur : DEFAULT_SKIN_ID }
    }
    if (channelId === 'all') {
      prefs = updatePrefs(app.getPath('userData'), { skin: id })
      pushTo(getPetWindow('all'), 'set-skin', id)
      pushTo(channelsWindow, 'default-skin-updated', id)
    } else {
      const ch = channels.find((c) => c.id === channelId)
      if (ch) {
        channels = channels.map((c) => (c.id === channelId ? { ...c, skin: id } : c))
        savePrefs(app.getPath('userData'), { ...loadPrefs(app.getPath('userData')), channels })
        broadcastChannels()
        pushTo(getPetWindow(channelId), 'set-skin', id)
      }
    }
    return { ok: true, effectiveId: id }
  })
  handleCommand('get-default-skin' /* 若以 query 實作則用 handleQuery */, ...)
  ```
  > 註：`get-default-skin` 用 `handleQuery('get-default-skin', () => prefs.skin)`。channels 寫入請沿用本檔既有 channel-upsert handler 的寫法（同一套 `savePrefs`/`broadcastChannels`/reconcile）；若既有 upsert 有抽出 helper，select-skin 重用之以保持單一寫入路徑。
- [ ] **Step 5: index.ts** — `bus.on('open-skins', (channelId: string = 'all') => …)`：開造型視窗帶 channelId（單例已開則先 `close()` 再開，確保 target 正確）；新增 `handleCommand('open-skin-picker', ({ channelId }) => bus.emit('open-skins', channelId))`。
- [ ] **Step 6: skins.ts** — 頂部 `const myChannel = new URLSearchParams(location.search).get('c') ?? 'all'`；`render()` 內 `window.petBridge.getSkins(myChannel)`；選擇鈕 `window.petBridge.selectSkin(myChannel, skin.id)`。
- [ ] **Step 7:** 跑 `npm run typecheck`（此時 Part1+Part2 型別應整體綠）+ `npm test`
- [ ] **Step 8: Commit** — `feat(skin): 造型視窗認 channel（handler 移 index.ts + ?c= + 右鍵 per-pet）`

---

### Task 7: Part3 頻道頁 UI

**Files:** Modify `src/renderer/channels.tsx`、`src/renderer/channels.css`（若樣式分離；否則內聯/沿用既有 class 檔）

- [ ] **Step 1: channels.tsx** — 加 `defaultSkin` signal + skinName + 載入/訂閱：
  ```tsx
  const defaultSkin = signal<string>('')
  window.channelsBridge.getDefaultSkin().then((id) => (defaultSkin.value = id))
  window.channelsBridge.onDefaultSkinUpdated((id) => (defaultSkin.value = id))
  const skinName = (id: string): string => skins.value.find((s) => s.id === id)?.displayName ?? id
  ```
- [ ] **Step 2: ChannelRow** — 移除 `<select class="skin">…</select>`，換按鈕：
  ```tsx
  <button class="skin-pick" onClick={(e) => { stop(e); window.channelsBridge.openSkinPicker(ch.id) }}>造型：{skinName(ch.skin)} ⚙</button>
  ```
- [ ] **Step 3:「全部」列** — `crow all` 內（`all-note` 後、`count` 前）加：
  ```tsx
  <button class="skin-pick" onClick={() => window.channelsBridge.openSkinPicker('all')}>造型：{skinName(defaultSkin.value)} ⚙</button>
  ```
- [ ] **Step 4: 樣式** — 為 `.skin-pick` 加簡潔按鈕樣式（沿用既有 `.skin` 下拉的視覺尺寸/邊距，改為按鈕外觀）。
- [ ] **Step 5:** 跑 `npm run typecheck` + `npm run build` 確認 channels 視窗編譯/打包過。
- [ ] **Step 6: Commit** — `feat(channels): 造型下拉改外開造型頁按鈕 + 全部列造型 + 顯示名稱`

---

## 驗證（全部任務後，Claude 負責）
- `npm run typecheck && npm test`（含 channel-label 新測試）全綠。
- `npm run build`、`npm run e2e`（先確保 `allEnabled=true`）SMOKE PASS。
- Playwright `_electron` 探針：
  1. 名稱標籤三態切換各截圖（hidden 無 pill、always 有 pill、hover 進出切換）；改 channel 名稱即時更新。
  2. 對 `?c=cA` 造型視窗選造型 → `prefs.json` `channels[cA].skin` 變 + 寵物 set-skin；對 `'all'` → `prefs.skin` 變。
  3. 頻道頁造型按鈕顯示名稱、開窗 target 正確；「全部」列改造型後即時更新顯示。

## Self-Review 註記
- 型別跨任務一致：`channelLabelMode`、`ChannelLabelMode`、`get-skins`/`select-skin` args `{channelId}` / `{channelId,id}` 全程一致。
- 單一寫入路徑：channel.skin 更新沿用既有 channel-upsert 寫法（`updatePrefs`/`savePrefs` + `broadcastChannels`），勿另起第二寫入路徑（避免 A 子專案修過的 dual-writer clobber 重演）。
- 無 placeholder：所有 code step 附實際 code；少數「沿用既有 helper」處明確指向既有實作。
