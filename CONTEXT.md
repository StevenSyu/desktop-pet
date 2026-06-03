# desktop-pet — 架構詞彙

本檔記錄專案中跨模組的關鍵概念，供未來開發與架構審視參照。

## IPC Contract

main / preload / renderer 之間所有 IPC channel 的**單一型別來源**，定義於 `src/ipc/contract.ts`。channel 名與 payload 型別只在此宣告一次；各端的 typed helper 對它做編譯期檢查，channel 打錯或 payload 型別不符在 `tsc` 階段就擋下。

三種方向各一張表（map）：

- **Command** — renderer → main，單向（fire-and-forget）。表的 value 是 payload 型別。
  - preload：`sendCommand(channel, payload?)`（`src/ipc/preload-helpers.ts`）
  - main：`handleCommand(channel, handler)`（`src/ipc/main-helpers.ts`）
- **Query** — renderer → main，往返（request/response）。表的 value 是 `{ args, result }`。
  - preload：`invokeQuery(channel, args?) → Promise<result>`
  - main：`handleQuery(channel, handler)`
- **Push** — main → renderer，單向。表的 value 是 payload 型別。
  - main：`pushTo(win, channel, payload?)`（集中 `win && !win.isDestroyed()` 守衛）
  - preload：`subscribePush(channel, cb)`

payload 為 `void` 表示該 channel 不帶資料；helper 的型別會讓對應呼叫不需帶引數。

新增一個 channel = 在 contract 對應的表加一行，再於 preload 暴露方法、main 註冊 handler——三處仍各改一次，但任何不一致都是編譯錯誤，不會是執行期無聲失敗。

`window.petBridge`（renderer 看到的 API）的方法名與 channel 名**刻意脫鉤**（例如 `setDnd` → `'set-dnd'`），renderer 只依賴 `src/preload/api.d.ts` 宣告的介面，不直接碰 channel 字串或 contract。

## 頻道目錄（Channel Registry）

頻道與已知來源的**決策邏輯**集中在 `src/core/channel.ts` 的純函式，main / renderer 只當 thin adapter 執行副作用（persist／broadcast／reconcile／upsert）：

- `applySourceEvent(state, source, opts) → { state, flags }` — 一筆來源事件的全部影響：已知來源補登（精確項＋kind 整類項）、自動建「啟用」精確頻道（新來源跳專屬寵物）、死角兜底（無顯示寵物能接時啟用命中頻道）。呼叫端依 `knownChanged`／`channelsChanged`／`petsChanged` flags 執行副作用。
- `absorbMember(members, toAdd)` — 來源加入頻道成員的規則：整類項吸收同 kind 精確成員；已存在回 `null`。
- `sourcePool(known, channel)` — 成員編輯左欄的池：排除已涵蓋來源、依 kind 分組、整類項排組首當 group header。
- `healKnownKinds` / `healSkins` — 啟動 self-heal（補缺整類項／失效造型回正），無變回 `null`。

**整類項**＝member 只有 `kind`、無 `name` 的來源（UI 顯示「全部來源」），命中該 kind 全部來源（含未來新專案）。

同樣模式的純化：卡片視窗幾何在 `src/core/card-layout.ts`（`cardWindowBounds`：drag 偏移／可見卡翻轉＋陰影外擴），通知中心開窗位置在 `src/core/center-pos.ts`（`resolveCenterPos`：記住的位置失效時退回寵物旁）。
