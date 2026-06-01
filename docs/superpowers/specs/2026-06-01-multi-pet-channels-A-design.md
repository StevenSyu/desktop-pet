# 多寵物 — 子專案 A：Channel（群組）基礎 設計文件

- 日期：2026-06-01
- 狀態：設計定案（待使用者最終審閱 → writing-plans）
- 範圍代號：多寵物 子專案 A（B = 每 channel 一隻寵物視窗，另案）

---

## 1. 定位與動機

把通知依「來源」分成可重疊的**群組（channel）**，為「多寵物」鋪底。**子專案 A 只做資料模型 + 通知中心分頁 + 頻道管理視窗 + 自動偵測**，**不長新寵物**（仍只有「全部」那一隻）。B 再依 channel 長出多隻寵物。拆開降風險、A 本身即可用（中心能依專案/類別分頁、各自未讀）。

session 是事件驅動發現、且 `session_id` 每次執行都不同，故**分組一律看事件的 `source`（kind/name），不看 sessionId**（sessionId 僅顯示用）。`hooks/payload.mjs` 已把專案名放進 `source.name`（`basename(cwd)`）、kind=`claude-code`；其他整接（如打卡）帶自己的 `source.kind`。

## 2. 範圍

**目標（A）**
- Channel（群組）資料模型 + 持久化（`prefs.channels`）。
- core 純函式：`matchingChannels` / `filterByChannel` / `unreadByChannel` / channel 驗證。
- 自動偵測新來源 → 自動建「停用」channel 建議。
- 通知中心：`全部` + 各**啟用** channel 分頁（各自未讀），renderer 端即時過濾。
- 獨立「頻道管理」視窗（Preact + signals）：列出/啟停/刪除/編輯/手動新增 channel、選 skin。
- 右鍵選單新增「頻道…」入口。

**非目標（A，留給 B 或之後）**
- 每 channel 長一隻寵物視窗、每寵物未讀紅點、寵物定位（**B**）。
- 一則訊息符合多個有寵物的 group 時的「寵物去重」（**B**）。
- session 層級分組、cwd 完整路徑消歧義。

## 3. 群組模型（重點：可重疊、不分割）

- **「全部」channel**：特殊隱含 channel（`id='all'`），**永遠含所有訊息**、寵物常駐、skin = `prefs.skin`、不可刪/停。不存在 `prefs.channels` 陣列裡。
- **group channel** = 一個過濾條件（matcher）。訊息符合就**出現在該 group**，且**仍在「全部」裡**（不會被移出）。
- **多對多**：一個 source 可符合多個 group（matcher 重疊時）；一則訊息可同時出現在多個 group。沒有「未捕捉/剩餘」的概念——「全部」本來就含全部。

### 型別
```ts
export interface SourceMatch { kind?: string; name?: string } // 至少一欄；皆比相等
export interface Channel {
  id: string          // main 產生的 opaque id
  name: string        // 顯示名
  skin: string        // 該 group 寵物造型（B 用；A 在管理 UI 可選）
  enabled: boolean     // 是否成為分頁(A) / 寵物(B)；group 預設 false
  members: SourceMatch[] // 成員清單（OR）；source 屬於此 channel = members.some(matchesSource)
}
```
- **group = 成員集合**（非單一規則）。把來源拖進 channel = 把 `{kind,name}` 加進 `members`。
- **跨專案同一隻** = 多個來源加進同一 channel；**整個 kind** = members 放一條 `{kind:'claude-code'}`。
- **已知來源池** `prefs.knownSources: SourceMatch[]`：main 收到新來源時收集（沿用 64 上限），供管理 UI 左欄拖曳。

## 4. core 純函式（TDD）`src/core/channel.ts`

```ts
matchesSource(match: SourceMatch, source: { kind: string; name?: string }): boolean
// match.kind 指定則須等 source.kind；match.name 指定則須等 source.name；兩者皆未指定 → false（空 matcher 不命中）

channelMatches(channel, source): boolean   // channel.members.some(matchesSource)
matchingChannels(source, channels: Channel[]): string[]
// 回所有「enabled 且 channelMatches」的 channel id。'all' 不在此清單（隱含含全部）。

filterByChannel(messages, channelId, channels): Message[]
// channelId==='all' → 全部；否則 → channelMatches 命中該 channel 的訊息（忽略 enabled）

unreadByChannel(messages, channels): Record<string, number>
// 回 { all: <總未讀>, [channelId]: <該 channel 未讀> }（只算 enabled channel + all）

needsAutoChannel(source, channels): boolean
// 沒有任何既有 channel（含停用）的 members 命中此 source → true（自動建）

sanitizeChannels(raw: unknown): Channel[]
// 驗證陣列：id/name 字串、skin 字串、enabled boolean、members 為 SourceMatch[]（每項至少一有效欄、空清單丟棄）；壞的丟棄
```
- 重疊語意：`matchingChannels` 回清單（多屬）。分頁過濾用 `filterByChannel`。
- 平台中立、可注入；不碰 electron/node。

## 5. 自動偵測建立（main, ingest）

收到事件（`onEvent`）時，對 `event.source`：
- **加入已知來源池**：若 `{kind,name}` 不在 `prefs.knownSources` → 加入（供管理 UI 左欄）。
- **自動建 channel**：若 `needsAutoChannel(source, channels)`（沒有任何既有 channel 的 members 命中此來源）→ 新增一個 `{ id: <main 產生>, name: source.name || source.kind, skin: <快取 default skin>, enabled: false, members: [{ kind, name }]（name 缺則只 kind） }`（右欄預設已含自己）。經 `updatePrefs` 寫入 + 推 `channels-updated`。
- 廣域 channel（members 含 `{kind:'claude-code'}`）已命中的來源不再另建。
- 上限 `MAX_AUTO_CHANNELS=64`；`source.kind/name` 於 `normalizePayload` 夾 200 字（防放大）。

## 6. 狀態 / 持久化 / IPC

- **main 是 `prefs.channels` 唯一寫入者**。`prefs` 加 `channels: Channel[]`；`loadPrefs` 預設 `[]` + `sanitizeChannels`；舊 `prefs.json` 無 channels 照常載入。`prefs.skin` 續為「全部」寵物造型。
- **prefs.json 併發**：`window.ts`（autoWalk/dnd/walk/skin）與 `index.ts`（channels）皆寫同一檔。一律走新 helper `updatePrefs(userDataDir, partial)`（讀最新→合併→寫），各自只更新負責欄位，避免互相覆蓋。`window.ts` 的 Prefs literal 同步補 `channels: []`（channels 變必填）。
- **channel id 由 main 指派**：`channel-upsert` 收到空 id → main 產生 opaque id（新建）；非空 → 依 id 覆蓋。renderer 不產 id。
- IPC（`src/ipc/contract.ts`）：
  - Command `channel-upsert`：`Channel`（新增或依 id 覆蓋）
  - Command `channel-delete`：`{ id: string }`
  - Query `get-channels`：`{ args: void; result: Channel[] }`
  - Query `get-known-sources`：`{ args: void; result: SourceMatch[] }`（左欄來源池）
  - Push `channels-updated`：`Channel[]`（推給通知中心 + 頻道管理視窗）
  - Push `known-sources-updated`：`SourceMatch[]`（推給頻道管理視窗）
  - （沿用既有 `get-skins`）
- main handlers：upsert/delete → 套用到記憶體 channels → `savePrefs` → `channels-updated` 廣播。`get-channels` 回目前清單。
- 編輯/刪除/啟停 → 因 `matchingChannels` 是即時計算，**過去訊息立即回溯歸位**（分頁重新分類）。

## 7. 通知中心分頁（`src/renderer/center.ts`，維持 vanilla）

- center 取得 channels：`petBridge.getChannels()` + `petBridge.onChannelsUpdated(cb)`（preload/api.d.ts 補）。
- 分頁列 = `全部` + 各**啟用** channel；每個分頁顯示未讀數（`unreadByChannel`）。
- 切換分頁 → 用 `filterByChannel(all, tabId, channels)` 過濾列表（renderer 直接 import core）。`全部` = 所有訊息。
- 與既有「列表↔詳情」「狀態 chips 篩選」相容：分頁是上層維度（先選 channel 再套 chips/詳情）。
- **A 不動寵物**：唯一的「全部」寵物紅點維持「總未讀」；點它開中心預設 `全部` 分頁。停用的自動建 channel **不出現分頁**（只在管理視窗）。

## 8. 頻道管理視窗（新，Preact + signals）

- 新 renderer `src/renderer/channels.html` + `channels.tsx` + `channels.css`；新 main 工廠 `src/main/channels-window.ts`（frameless/transparent/floating/skipTaskbar，比照其他工具視窗，可關閉）。
- 右鍵選單加「頻道…」→ `bus.emit('open-channels')` → `index.ts` 開窗（單例、blur 或 Esc 關）。
- 窄版 preload `src/preload/channels.ts` 暴露 `channelsBridge`：`getChannels` / `getKnownSources` / `upsertChannel` / `deleteChannel` / `onChannelsUpdated` / `onKnownSourcesUpdated` / `getSkins`（直接走 ipcRenderer，比照 card preload）。
- UI（Preact + `@preact/signals`）：
  - 上半：channel 清單（含自動建停用項），每列：名稱、skin、enable/disable、刪除、選取（選哪個 channel 來編輯成員）。
  - 下半（選取的 channel）：**左右兩欄成員編輯** —— 左 = 已知來源池（`getKnownSources`，扣掉已是成員的）；右 = 此 channel 的 `members`。**拖拽或點擊**把左邊來源加入右邊（append `{kind,name}` 到 members）；點右邊成員 ✕ 或拖回移除。HTML5 drag + 點擊雙模式。
  - 「手動新增 channel」：本地草稿命名 → 建立（id 空 → main 指派；members 可空，建立後再加來源）。
  - 「全部」channel 不在此管理（特殊）。
- 所有變更 → `channelsBridge.upsertChannel/deleteChannel` → main 寫入 + 廣播 → 本視窗與中心都收 `channels-updated` 即時更新。

## 9. 技術棧（Preact，隔離在 channels 視窗）

- 新依賴（devDep）：`preact`、`@preact/signals`、`@preact/preset-vite`。
- `electron.vite.config.ts`：renderer 段 `plugins: [preact()]`；renderer input 加 `channels: 'src/renderer/channels.html'`；preload input 加 `channels: 'src/preload/channels.ts'`。
- `tsconfig.web.json`：加 `"jsx": "react-jsx"`、`"jsxImportSource": "preact"`（只影響 `.tsx`；既有 vanilla `.ts` renderer 不受影響）。
- CSP：channels.html 用 `default-src 'self'; style-src 'self' 'unsafe-inline'`（Preact/signals 無 eval，安全）。
- **隔離**：Preact 只出現在 `channels.tsx`/`channels.html` 這一個 bundle；index/card/center/settings/skins 維持 vanilla 不動。
- 實作前以 context7 再確認 `@preact/preset-vite` 在 electron-vite renderer 的掛法（已查：tsconfig 用 react-jsx + jsxImportSource preact、plugin 掛 renderer.plugins）。

## 10. 既有程式調整 / 檔案清單

**新增**
- `src/core/channel.ts`（+ `tests/core/channel.test.ts`）
- `src/main/channels-window.ts`
- `src/preload/channels.ts`
- `src/renderer/channels.html` / `channels.tsx` / `channels.css`

**修改**
- `src/main/prefs.ts`：`Prefs.channels` + `loadPrefs`/`savePrefs` + `sanitizeChannels`
- `src/main/index.ts`：channels 狀態、`get-channels`/`channel-upsert`/`channel-delete` handlers、ingest 自動偵測建立、`channels-updated` 廣播、`open-channels` 開窗
- `src/main/window.ts`：右鍵選單加「頻道…」
- `src/ipc/contract.ts`：channel-upsert / channel-delete / get-channels / channels-updated
- `src/preload/index.ts` + `api.d.ts`：petBridge 加 `getChannels` / `onChannelsUpdated`（給中心）
- `src/renderer/center.ts`：分頁列 + `filterByChannel`/`unreadByChannel` 過濾
- `src/renderer/center.css`：分頁列樣式
- `electron.vite.config.ts`：channels renderer/preload 入口 + preact plugin
- `tsconfig.web.json`：jsx 設定
- `package.json`：preact 相依

## 11. 測試策略

**core TDD（`channel.test.ts`）**
- `matchesSource`：kind 命中 / name 命中 / 兩者皆要 / 空 matcher → false / kind 對 name 不對 → false。
- `matchingChannels`：多 group 重疊 → 回多個 id；停用 group 不回；無命中 → 空。
- `filterByChannel`：`all` → 全部；group → 命中者；過去訊息回溯。
- `unreadByChannel`：all 總未讀 + 各 group 未讀（只算 enabled）。
- `sanitizeChannels`：壞欄位丟棄、match 至少一欄。

**整合 / 手動**
1. 發不同 source（CC 兩專案 + 打卡 kind）→ 自動建對應停用 channel（管理視窗看得到、去重不重複）。
2. 管理視窗啟用某 group → 中心多一個分頁、該分頁只含命中訊息、未讀數正確；「全部」仍含全部。
3. 編輯 match（name↔kind）/ 刪除 → 中心分頁即時回溯重分類。
4. 手動新增尚未出現的來源（預建打卡）→ 之後該類訊息進該分頁。
5. 重疊：建兩個 matcher 都命中同一 source 的 group → 該訊息兩個分頁都出現。
6. 重啟 → channels 持久化還在；舊 prefs.json（無 channels）不壞。
7. e2e：既有鏈路（卡片/詳情/pet://）不壞；channels 視窗開得起來。

## 12. B 預告（不在 A）
每 channel 一隻寵物視窗（各自 skin、定位、未讀紅點）；`enabled` 控制寵物顯示；一則訊息符合多個有寵物 group 的去重策略；點某寵物開中心對應分頁。建立在 A 的模型 + IPC 上。
