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

## Walk Engine（自走狀態機）

renderer 端自走的完整生命週期（何時走、走哪邊、何時取消、何時重排）集中在 `src/core/walk-engine.ts` 的 reducer：`walkEngineReduce(state, event, ctx) → { state, commands }`。adapter（`renderer/main.ts`）只把 DOM/IPC 事件轉成 `WalkEngineEvent`、把 `start`/`cancel` 指令轉成 `petBridge.walkStart/walkCancel`。

**取消語意**：engine 只發 `cancel` 指令，`walking` 不就地清掉——等 main 推 `walkEnded` 才轉 false，與位移實況（main 的 `walk-session`）保持單一事實來源。位移本身（clamp／step／撞牆反轉）仍在 main 的 per-channel `WalkSession`；邊界 clamp 用實際視窗寬（含 scale）。

## Prefs Store（單一寫入 seam）

main process 的 prefs 讀寫只走 `src/main/prefs-store.ts`：`getPrefs()`（首讀後常駐記憶體）＋ `updatePrefsStore(partial)`（合併寫檔＋通知訂閱者帶 changed keys）。`prefs-changed` 推播由 `window.ts` 的訂閱統一處理，且只在 renderer 在乎的欄位（`channelLabelMode`/`walk`/`skin`）變更時才推——`channels`/`knownSources` 高頻 persist 不推，避免洗掉 renderer 的走動排程。

**單一狀態源**：`index.ts` 沒有任何 prefs 欄位的鏡像 globals（channels／knownSources／allEnabled／dnd／defaultSkin 皆已移除）。讀走 `getPrefs()`、寫走 `updatePrefsStore`；頻道目錄的 persist＋broadcast 配對由 `index.ts` 的 `subscribePrefs` 依 changed keys 統一處理。

## Card Lifecycle（卡片生命週期狀態機）

單一卡片視窗的 show／loaded／hide／dismiss 時序決策在 `src/core/card-lifecycle.ts` 的 `cardReduce`：事件進、`flush`／`hide`／`notifyDismissed` 指令出。**dismiss 會一併清 pending**：載入中被關掉的卡片不得在 loaded 後復活（ghost card）。

## Card Manager（卡片視窗管理）

`cardReduce` 的 adapter：`src/main/card-manager.ts` 的 `initCardManager(deps) → { show, dismissById, hideFor, closeFor }`。持有 per-channel BrowserWindow 與狀態、執行指令副作用（顯示/隱藏/定位/通知已讀）、自訂閱 bus 拖動事件做卡片同步、自註冊 card domain 的 IPC handler（show-card／hide-card／card-clicked／card-more）。

- **Electron 能力以 deps 注入**（createWindow／getPetWindow／workAreaFor／onDisplayChange）——interface 即測試面，整合測試以 fake 視窗物件驅動。
- **center 耦合以 `onMore` callback 注入**：card-more 的「開通知中心詳情」是 center 概念，pendingDetailId 留在 index.ts。
- 幾何常數（CARD_W/H/GAP/SHADOW_PAD/CARD_SPEC）在 `src/core/card-layout.ts`（platform-neutral），manager 不依賴 window-factory。

## Bus Contract（main 內部事件匯流排）

main 端跨模組事件（右鍵選單開窗、寵物拖動/位移）走 `src/main/bus.ts`，與 IPC contract 同紀律：事件名與 payload 只在 `BusEvents` 表宣告一次（tuple 形），`busEmit`／`busOn` 對表做編譯期檢查。找消費者 grep `busOn('事件名'` 即可。

## Command 註冊歸屬

IPC command handler 歸 **domain owner** 註冊，不集中：寵物視窗類（drag／walk／scale／dnd／label）在 `window.ts`、訊息與頻道類在 `index.ts`、蕃茄鐘在 `pomodoro-driver.ts`、卡片在 `card-manager.ts`。新增 domain 時 handler 隨其 driver/manager module 自註冊（init 內），不回填 index.ts。

## Center State（通知中心狀態機）

通知中心的 list／detail 模式、頻道分頁、type／session 篩選、scroll／flash 還原全部在 `src/core/center-state.ts`：`centerReduce`（含**扶正**——分頁指向已停用頻道退回 all、session 消失退回 all、詳情訊息被清空 fallback 回列表）＋ `centerView`（純投影：tabs／items／unreadTotal）。adapter（`renderer/center.ts`）只 dispatch 事件、把 view 畫成 DOM。

## Pet Fleet（寵物艦隊差集）

「該存在哪些寵物」與現況差集是純函式：`src/core/pet-fleet.ts` 的 `desiredPetIds(channels, allEnabled)` 與 `diffFleet(current, desired) → { close, create[index] }`；`index.ts` 的 `reconcilePets` 只執行視窗開關副作用。推播給全部寵物用 `window.ts` 的 `broadcastToPets(channel, payload)`，不再各處手寫 loop。

## liveQuery（Query＋Push 訂閱 race 修補）

renderer「初查＋訂閱更新」一律走 `src/core/live-query.ts` 的 `liveQuery(query, subscribe, onData)`：訂閱先行、push 先到者勝（query 結果只在尚未收到 push 時套用）。回傳 query 完成的 promise 供初載後續動作（如 pending detail 消費）。

## 工具視窗工廠

通知中心／卡片／進階設定／造型挑選／寵物設定的視窗建立集中在 `src/main/window-factory.ts`；單例開窗（已開則 focus、或關舊開新）用 `makeOpener(create, { replace? })`，推播端以 `opener.current()` 取窗（未開 → null，`pushTo` 自 no-op）。
