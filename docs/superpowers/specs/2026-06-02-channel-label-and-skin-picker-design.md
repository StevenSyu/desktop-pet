# 寵物名稱標籤 + 頻道造型設定整合 設計文件

- 日期：2026-06-02
- 狀態：設計定案（自走：直接進 writing-plans）
- 範圍：兩個相關但獨立的打磨 —— Part 1（名稱標籤）/ Part 2+3（造型設定整合）

---

## 1. 動機

多寵物（B1/B2）後桌面可能同時多隻寵物，使用者反映兩個痛點：
1. **認不出哪隻是哪個 channel** → 加可選的 channel 名稱標籤。
2. **頻道頁用下拉選造型看不到長相**、且「全部」寵物造型只能從右鍵「更換造型…」設、與頻道頁分裂 → 把造型設定統一到「外開造型選擇頁（縮圖）」，並把「全部」納入頻道頁。

## 2. 範圍

**Part 1 — 寵物 channel 名稱標籤**
- 寵物腳邊一個半透明 pill 顯示該寵物的 channel 名稱（「全部」寵物顯示「全部」）。
- 三態全域設定 `channelLabelMode`：`hidden`（預設）/ `hover`（滑過寵物才顯示）/ `always`（常態顯示）。
- 右鍵選單子選單切換，即時套用所有寵物、免重啟。

**Part 2 — 造型選擇視窗「認 channel」**
- 造型視窗可為「指定 channel」選造型（沿用 `?c=` 模式），選完寫回該 channel 的造型並即時套用到該寵物。
- 右鍵「更換造型…」改成對「被右鍵的那隻寵物」開。

**Part 3 — 頻道頁面 UI**
- 每列的造型 `<select>` 下拉 → 「造型：<目前造型名稱> ⚙」按鈕，點了外開造型視窗（target=該 channel）。
- 「全部」列也加同款按鈕（target=`'all'`，造型＝`prefs.skin`），把「全部」寵物造型一併收進頻道頁；其餘維持鎖定（不可改名/刪/編成員）。

**非目標**
- 造型視窗多開並存（維持單例、再開換 target）。
- per-channel 名稱標籤設定（全域單一）、標籤樣式自訂、「全部」隱藏其標籤。
- 改動造型視窗縮圖排版本身。

## 3. Part 1 設計

### 3.1 資料
`Prefs` 新增 `channelLabelMode: 'hidden' | 'hover' | 'always'`，預設 `'hidden'`。
- `prefs.ts`：`Prefs` 介面 + `DEFAULTS` + `loadPrefs` 三個 return 路徑（檔不存在 / 正常解析 / catch）都帶該欄位。
- sanitize：解析時值不在三者內 → `'hidden'`（純函式 `sanitizeLabelMode(raw)`，見 3.2）。

### 3.2 純函式（core，TDD）
新檔 `src/core/channel-label.ts`：
- `type ChannelLabelMode = 'hidden' | 'hover' | 'always'`
- `sanitizeLabelMode(raw: unknown): ChannelLabelMode` — 不合法 → `'hidden'`
- `shouldShowLabel(mode: ChannelLabelMode, hovering: boolean): boolean`
  - `hidden` → `false`；`always` → `true`；`hover` → `hovering`

### 3.3 渲染（renderer，不動視窗尺寸/定位）
- `index.html`：`<div id="pet">` 同層加 `<div id="channel-label" hidden></div>`。
- `styles.css`：`#channel-label` 絕對定位、底部置中、疊在寵物腳邊；半透明深色底 + 白字、圓角 pill、`pointer-events:none`（不影響點擊穿透與既有 hover/drag 互動）、不換行省略。
- `main.ts`：
  - 名稱：啟動 `window.petBridge.getChannels()` 找 `myChannel` 的 `name`（`myChannel==='all'` → 「全部」；找不到對應 channel 時 fallback「全部」/channelId）；訂 `onChannelsUpdated` 更新名稱（改名即時反映）。
  - 模式：`window.petBridge.getPrefs()` 取 `channelLabelMode`；訂 `onPrefsChanged` 更新（菜單改設定即時反映）。
  - hover：沿用既有 `petEl` 的 `mouseenter`/`mouseleave`，維護 `hovering` 旗標。
  - 每次名稱/模式/hover 變動 → `applyLabel()`：`#channel-label.textContent=name`、`hidden = !shouldShowLabel(mode, hovering)`。

### 3.4 設定入口（window.ts `show-context-menu`）
在「更換造型…」附近加子選單：
```
{ label: '名稱標籤', submenu: [
  { label: '隱藏',       type: 'radio', checked: prefs.channelLabelMode==='hidden', click: () => setLabelMode('hidden') },
  { label: '滑過時顯示', type: 'radio', checked: prefs.channelLabelMode==='hover',  click: () => setLabelMode('hover') },
  { label: '常態顯示',   type: 'radio', checked: prefs.channelLabelMode==='always', click: () => setLabelMode('always') },
]}
```
`setLabelMode(mode)`：`prefs = updatePrefs(dir, { channelLabelMode: mode })` → 廣播 `prefs-changed` 給**所有** pet 視窗（`for (const id of petChannelIds()) pushTo(getPetWindow(id), 'prefs-changed', prefs)`）。

### 3.5 IPC 既有可重用
- `petBridge.getChannels()` / `onChannelsUpdated`：已存在。
- `getPrefs()` / `onPrefsChanged`：已存在但型別只 `{autoWalk, walk}` → **擴成回完整 `Prefs`**（或至少含 `channelLabelMode`）；對應 `api.d.ts`、window.ts `get-prefs` handler 已 `return prefs`（全量），只需改型別。`prefs-changed` push 型別已是 `Prefs`。

## 4. Part 2 設計：造型視窗認 channel

### 4.1 模組邊界（關鍵決策）
`get-skins` / `select-skin` 的 handler 目前在 `window.ts`，但 window.ts **沒有 channels 狀態**（channels 在 `index.ts`）。要認 channel 必須能讀/寫 channel 造型 + reconcile。

**決策：把 `get-skins` / `select-skin` 兩個 handler 從 `window.ts` 移到 `index.ts`**（那裡有 `channels`、`skinFor(channelId)`、reconcile、`getPetWindow`，並可 `import { scanSkins } from './skin-registry'`、`builtinRoot` 由 window.ts 匯出或共用）。window.ts 移除這兩個 handler 註冊。

### 4.2 contract 變更
```ts
// Queries
'get-skins': { args: { channelId: string }; result: { skins: DiscoveredSkin[]; requestedId: string; effectiveId: string } }
'select-skin': { args: { channelId: string; id: string }; result: { ok: boolean; effectiveId: string } }
```

### 4.3 handler（index.ts）
- `get-skins({channelId})`：`scanSkins` 取 `{skins, sheetPaths}`；`requestedId = skinFor(channelId)`；`effectiveId = sheetPaths.has(requestedId) ? requestedId : DEFAULT_SKIN_ID`。
- `select-skin({channelId, id})`：`id` 無效（不在 sheetPaths）→ `{ok:false, effectiveId: 現值}`。有效：
  - `channelId==='all'`：`prefs = updatePrefs(dir,{skin:id})`；`pushTo(getPetWindow('all'),'set-skin',id)`；另推 `prefs-changed`（給標籤/設定同步）+ 通知 channels 視窗（見 5.3 預設造型同步）。
  - 其他：在 `channels` 找該 channel、`skin=id` 更新（走既有 channel-upsert 等價邏輯：更新 `channels`、`broadcastChannels`、`pushTo(getPetWindow(channelId),'set-skin',id)`、必要時 reconcile）。
  - 回 `{ok:true, effectiveId:id}`。

### 4.4 造型視窗 + renderer
- `skin-window.ts`：`createSkinWindow(channelId)` → 載入 `skins.html?c=<channelId>`（dev URL 帶 query；prod `loadFile(..., { query: { c: channelId } })`）。
- `index.ts` `bus.on('open-skins', (channelId='all') => …)`：開窗帶 channelId；單例若已開 → focus（簡化：直接關掉重開以換 target，或記錄 target 重載；採「已開則關閉再開」確保 target 正確）。
- `skins.ts`：`const myChannel = new URLSearchParams(location.search).get('c') ?? 'all'`；`getSkins(myChannel)`、`selectSkin(myChannel, id)`。
- `preload/index.ts`（petBridge）：`getSkins: (channelId) => invokeQuery('get-skins', { channelId })`、`selectSkin: (channelId, id) => invokeQuery('select-skin', { channelId, id })`。
- `api.d.ts`：`getSkins(channelId: string)`、`selectSkin(channelId: string, id: string)`。

### 4.5 右鍵「更換造型…」per-pet
`window.ts` `show-context-menu({channelId})`：`{ label:'更換造型…', click: () => bus.emit('open-skins', channelId) }`（帶被右鍵那隻的 channelId）。

## 5. Part 3 設計：頻道頁 UI

### 5.1 channel 列：下拉 → 按鈕
`channels.tsx` `ChannelRow`：移除 `<select class="skin">`，換：
```tsx
<button class="skin-pick" onClick={(e) => { stop(e); window.channelsBridge.openSkinPicker(ch.id) }}>
  造型：{skinName(ch.skin)} ⚙
</button>
```
`skinName(id)` = `skins.value.find(s => s.id===id)?.displayName ?? id`。

### 5.2 「全部」列加按鈕
「全部」列（`crow all`）加同款按鈕，target=`'all'`、顯示 `skinName(defaultSkin.value)`：
```tsx
<button class="skin-pick" onClick={() => window.channelsBridge.openSkinPicker('all')}>造型：{skinName(defaultSkin.value)} ⚙</button>
```

### 5.3 頻道頁取得「全部」造型（prefs.skin）+ 即時同步
- `channelsBridge` 新增 `getDefaultSkin(): Promise<string>`（main 回 `prefs.skin`）；signal `defaultSkin`，啟動載入。
- 「全部」造型改變後即時更新頻道頁：`select-skin('all')` 後 main 推一個 channels 視窗可收的訊息 → 重查 defaultSkin。**重用既有 `channels-updated`**？該 push 只帶 channels、不含 prefs.skin。最小作法：新增 push `default-skin-updated: string`，`select-skin('all')` 成功後 `pushTo(channelsWindow, 'default-skin-updated', id)`；channelsBridge `onDefaultSkinUpdated`。channel 列造型改變則靠既有 `channels-updated`（channel.skin 已在 Channel 內）即時反映。

### 5.4 openSkinPicker
- `channelsBridge.openSkinPicker(channelId)` → `ipcRenderer.send('open-skin-picker', { channelId })`。
- main 新增 command `open-skin-picker: { channelId: string }` → `bus.emit('open-skins', channelId)`。
- contract `Commands` 加 `'open-skin-picker': { channelId: string }`；preload/channels.ts + api.d.ts 同步。

## 6. 檔案清單

**新增**
- `src/core/channel-label.ts`（純函式）
- `tests/core/channel-label.test.ts`

**修改**
- `src/main/prefs.ts`（Prefs + DEFAULTS + loadPrefs 帶 channelLabelMode、sanitize）
- `src/renderer/index.html`（加 `#channel-label`）
- `src/renderer/styles.css`（pill 樣式）
- `src/renderer/main.ts`（名稱 + 模式 + hover → applyLabel）
- `src/main/window.ts`（選單加「名稱標籤」子選單 + setLabelMode 廣播；「更換造型…」帶 channelId；**移除** get-skins/select-skin handler）
- `src/main/index.ts`（**接收** get-skins/select-skin channel-aware handler；`open-skins` 帶 channelId；`open-skin-picker` command；`default-skin-updated` 推播；get-prefs 型別全量）
- `src/main/skin-window.ts`（`createSkinWindow(channelId)` 帶 `?c=`）
- `src/renderer/skins.ts`（讀 `?c=`、getSkins/selectSkin 帶 channelId）
- `src/renderer/channels.tsx`（造型按鈕、「全部」列按鈕、defaultSkin signal、skinName）
- `src/ipc/contract.ts`（get-skins/select-skin args 加 channelId；`open-skin-picker` command；`default-skin-updated` push）
- `src/preload/index.ts`（getSkins/selectSkin 帶 channelId；getPrefs 全量型別）
- `src/preload/channels.ts`（openSkinPicker、getDefaultSkin、onDefaultSkinUpdated）
- `src/preload/api.d.ts`（同步上述簽名）

## 7. 測試策略

**核心 / 單元（TDD）**：`channel-label`（sanitizeLabelMode 三值 + 非法→hidden；shouldShowLabel 三模式 × hover 真假）。
**整合 / 探針（Playwright `_electron`）**：
1. Part1：切三態（隱藏/hover/常態），各截寵物截圖驗證 pill 顯示/隱藏；改 channel 名稱即時更新。
2. Part2：對 channel 寵物開造型視窗（`?c=cA`），選一造型 → 該寵物 set-skin 即時換、`prefs.json` 的 `channels[cA].skin` 更新；對 `'all'` 同理寫 `prefs.skin`。
3. Part3：頻道頁造型按鈕顯示目前造型名稱、點開造型視窗帶正確 target；「全部」列按鈕顯示 prefs.skin 名稱、改後即時更新。
4. e2e：既有單寵物鏈路（SMOKE）不壞（注意先確保 `allEnabled=true`）。

## 8. 風險 / 註記
- 移動 get-skins/select-skin handler 到 index.ts：要確認 `scanSkins`/`builtinRoot`/`DEFAULT_SKIN_ID` 可取得（window.ts 已匯出 `builtinRoot` 或共用 skin-registry）。window.ts `did-finish-load` 推初始 skin 的邏輯不動（用 `skinFor`）。
- 造型視窗單例換 target：採「已開則關閉再開」最單純，避免 target 殘留。
- pill `pointer-events:none` 確保不破壞點擊穿透 / hover / drag。
- `channelLabelMode` 為全域：所有寵物（含「全部」）統一行為。
