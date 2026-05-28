# 寵物互動深度 — 設計文件

- 日期：2026-05-28
- 狀態：設計定案（待使用者最終審閱 → 進入實作計畫）
- 範圍代號：Spec ④（前為 ③ 動畫與效能）

---

## 1. 定位與動機

現在 may 只在「外部事件來」時演動畫（hook reaction / idle 自走）。使用者直接跟寵物互動沒有反饋——點、雙擊、拖、hover 都沒有 sprite 變化，像是個靜物。本 spec 給寵物「對使用者有反應」的能力。

四個互動：

1. **單擊**：寵物隨機播一個反應動畫
2. **雙擊**：開通知中心（不必點徽角紅圈）
3. **拖曳**：sprite 跟著拖動方向走；中途反向會切方向
4. **Hover**：滑鼠進入寵物時揮手一次

## 2. 範圍

**目標（v1）**
- 上述 4 種互動的 sprite 切換
- 與既有 FSM reaction / walk / drag IPC 不衝突
- 純函式優先級決策（可獨立 TDD）

**非目標（v1，延後）**
- 寵物會跟著滑鼠視線轉動（使用者主動否決）
- 反應/雙擊配音效（另開 spec）
- 拖動結束後寵物會「站穩」/「踉蹌」過場（YAGNI）

## 3. 動畫優先級

tick()（既有 100ms 輪詢）每次決定 `#pet[data-anim]` 的值，依下表由高到低取第一個 match：

| 級 | 來源 | 觸發條件 | sprite |
|---:|---|---|---|
| 1 | FSM reaction | `pet.advance(now).animation !== 'idle'` | FSM 給的（jumping / waving / failed / review / waiting / running） |
| 2 | drag override | `dragState.moved === true` | 依 `dragDirection`：`running-right` / `running-left`；剛開始（無方向）→ `jumping` |
| 3 | user interaction | `userAnim` 未過期 | click 反應（隨機 waving / jumping / review）或 hover（waving） |
| 4 | walking | `walking === true` | `running-{walkDirection}`（main 端推送的方向） |
| 5 | idle | （以上都不成立） | `idle` |

優先級從 1 到 5 嚴格遞減：外部訊號優先於本地互動；主動操作（drag）優先於被動互動（click/hover）；走動只在「閒到沒事」時才發生。

## 4. Click / Double-Click 拆解

只用既有 pointerdown/move/up，新增「**沒移動才當 click**」分支。雙擊用「2 次 click 間隔 ≤ 300ms」自家邏輯，不靠 DOM `dblclick`（避免 pointercapture 干擾）。

```
pointerdown(button=0):
  既有：dragState = { startSx, startSy, moved: false }
  既有：setPointerCapture(pointerId)

pointermove:
  既有：超 DRAG_THRESHOLD(3px) → moved=true、IPC dragMove
  [新]：同時更新 dragDirection（見 §5）

pointerup:
  既有：releasePointerCapture
  若 moved:
    既有：IPC dragEnd；dragDirection=null
    [新]：justDragged=true，60ms 後清除（避免被 click handler 誤判）
  若 !moved:
    [新]：進入 click 路徑

click 路徑：
  if (justDragged) return
  if (pendingClick) {
    clearTimeout(pendingClick); pendingClick = null
    openCenter()                       # 第 2 次 click = 雙擊
  } else {
    pendingClick = setTimeout(() => {
      pendingClick = null
      triggerClickReaction()           # 等 300ms 沒第 2 下就單擊
    }, 300)
  }

triggerClickReaction:
  pool = ['waving', 'jumping', 'review']
  pick = pool[Math.floor(rng() * pool.length)]
  userAnim = { name: pick, expiresAt: now + animDuration[pick] }
```

**animDuration**（依 `src/core/sprite-format.ts`）：

| 動畫 | frames | fps | 一輪 ms |
|---|---:|---:|---:|
| waving | 4 | 4 | 1000 |
| jumping | 5 | 5 | 1000 |
| review | 7 | 4 | 1750 |

**邊角狀況**

- 反應動畫播一半再被點 → 覆寫 `userAnim`（新 pick 取代舊）
- 反應動畫播一半 hook 事件來 → level 1 > 3，FSM 蓋過去
- 反應動畫期間使用者拖動 → level 2 > 3，drag 蓋過去；放開後若沒過期回來播

## 5. Drag 方向追蹤

`pointermove` 每次用「**累計位移**」判方向（不是瞬時 velocity）：

```ts
const dx = e.screenX - dragState.startSx
const DIR_THRESHOLD = 8  // 累計位移 > 8px 才開始判方向（避免抖動）

if (Math.abs(dx) > DIR_THRESHOLD) {
  dragDirection = dx > 0 ? 'right' : 'left'
}
```

**狀態進程：**
1. pointerdown：dragState 建立但 moved=false、dragDirection=null
2. 微小移動（< 3px）：moved 仍 false → tick() 還在 level 4/5（不到 drag override）
3. 跨 DRAG_THRESHOLD(3px)：moved=true、IPC dragMove；但 dragDirection 還是 null → sprite = `jumping`（「被抬起來」感）
4. 累計 > DIR_THRESHOLD(8px)：dragDirection = 'right' 或 'left' → sprite = `running-{dir}`
5. 中途反向（dx 跨 0 且超過 8px）：dragDirection 翻轉，sprite 即時切

累計位移而非瞬時的好處：手抖不會忽左忽右；翻轉時很乾脆。

## 6. Hover 行為

既有 `petEl` 上的 `mouseenter / mouseleave`（用於 `setInteractive`）擴充：

```ts
petEl.addEventListener('mouseenter', () => {
  setInteractive(true)                                # 既有
  if (!dragState && !userAnim) {
    userAnim = { name: 'waving', expiresAt: performance.now() + 1000 }
  }
})

petEl.addEventListener('mouseleave', () => {
  setInteractive(false)                               # 既有
  # 不額外做事；waving 自然 1 秒後過期回 idle
})
```

**設計選擇：**
- Hover 進入時播一輪 waving（不持續循環）。避免滑鼠停在寵物上 sprite 一直揮手很煩
- 1 秒過期後 tick() 自動退回 walking / idle
- 拖動中（dragState）或 click 反應中（userAnim）不會被 hover 打斷

## 7. 與既有系統整合

**走動：**
- `walking === true` 時 sprite = `running-{walk_direction}`（level 4）
- 使用者開始拖動 → 呼叫 `walkCancel()`（既有）→ `walking → false`
- 接著進入 level 2 drag override，dragDirection 決定 sprite
- 使用者放開 → 級別退回 5 (idle)，下次 nextWalkAt 到再走

**FSM reaction：**
- Hook 來新事件：FSM 進入 reaction，level 1 蓋過所有
- 既有 onPetEvent 內 `if (walking) walkCancel()` 路徑保留
- [新] 同時清 `userAnim = null`、`dragState = null`（hook 事件比互動重要）
- FSM hold 結束（3 秒）回 idle，互動才能再生效

**IPC 邊界（不變）：**
- drag 方向只在 renderer 影響 sprite，**不傳給 main**（main 仍只收 `dragMove(sx,sy)` 計算新位置）
- `walkStart / walkCancel / walkEnded / walkDirection` 走動 IPC 不變
- `openCenter` 通知中心 IPC 既有

**Replay timer 相容：**
- 卡片在的 5 秒重播會呼叫 `pet.onEvent(...)`，把 FSM 重新塞回 reaction
- 期間使用者點寵物：userAnim 設好，但 FSM 仍非 idle（reaction 在 hold 內），level 1 蓋掉 → 互動動畫看不到
- 這是合理行為（hook 訊息優先）

## 8. 架構與檔案

**新增：**
- `src/core/anim-resolver.ts`：純函式 `resolveAnimation(ctx)`，接收 5 個 source 狀態回傳最終 sprite name
- `src/core/click-dispatcher.ts`：純函式邏輯處理「click 事件時間序列 → single / double 分派」（給定 timestamps 陣列回傳 fire decisions）

**修改：**
- `src/renderer/main.ts`：
  - 新狀態變數：`userAnim`、`dragDirection`、`justDragged`、`pendingClick`
  - tick() 改用 `resolveAnimation` 決定 sprite，刪除既有 if/else 鏈
  - pointermove：加 dragDirection 累計判方向
  - pointerup：moved=false 進 click 路徑
  - click 路徑：用 click-dispatcher 邏輯
  - hover：mouseenter 設 userAnim=waving
  - onPetEvent：清 userAnim、justDragged 等本地互動狀態

## 9. 測試策略

**核心 TDD**（新增 2 個純函式）：

`tests/core/anim-resolver.test.ts`：
- 5 條優先級各自單獨命中（FSM reaction、drag、userAnim、walking、idle）
- 多 source 同時 active 時優先級正確
- dragMoved=true 但 dragDirection=null → 回 jumping
- dragMoved=true 且 dragDirection='right' → 回 running-right
- 所有 source 都 idle → 回 idle

`tests/core/click-dispatcher.test.ts`：
- 一個 click 在 300ms 內無第二下 → fire single
- 兩個 click 間隔 < 300ms → fire double（取消 single）
- 兩個 click 間隔 > 300ms → fire single 兩次

**Renderer 整合**（既有 Playwright e2e 擴充 1-2 case）：
- 程式化模擬 mouseenter → 100ms 後查 `getComputedStyle(#pet).backgroundPositionY` 對到 waving row
- 程式化模擬 pointerdown + screen 位移 → 查 sprite 對到 running 行
- 不在 e2e 測雙擊（時序敏感），由純函式涵蓋

**手動驗收：**
1. Hover may → waving 揮手約 1 秒
2. 點 may（不拖）→ 隨機反應動畫一輪
3. 連點 2 下（< 300ms）→ 通知中心開
4. 拖 may 往右 → sprite 切右跑；放開回 idle 或 walking
5. 拖 may 中途反向（左→右→左）→ sprite 翻轉
6. 反應動畫播一半被 hook done 蓋過 → 看到 jumping
7. Walking 中點寵物 → sprite 切到反應動畫；放開後若 walking 仍 active 回 running

## 10. v1 範圍 vs 之後

**v1**：上述 4 種互動 + 優先級層 + 2 個純函式測試。

**之後可能**：
- 反應動畫池可在進階設定調整（哪幾個動畫進池、機率權重）
- 雙擊以外的 hotkey（例如 cmd+click 開設定）
- Hover 動畫依當前 skin 不同（may 揮手、丸子伸懶腰、企鵝點頭）——需要 sprite 表擴充
- 拖動感配「咻」音效

## 11. 待確認/未決

- click 反應隨機池 `['waving', 'jumping', 'review']` 三個夠不夠？要不要加 `running`（向前跑）？v1 先 3 個
- DIR_THRESHOLD 8px、雙擊 300ms 是否要做成可調設定？v1 先 hardcoded、實機調合適即可
