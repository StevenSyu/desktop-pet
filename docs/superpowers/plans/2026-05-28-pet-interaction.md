# Pet Interaction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 讓 may 對使用者互動（click / dblclick / drag / hover）有 sprite 反應。

**Architecture:** Renderer 加優先層：FSM reaction > drag > userAnim > walking > idle。抽兩個純函式 `resolveAnimation`、`classifyClick` 到 `src/core/`，可獨立 TDD；renderer/main.ts 把既有 tick() if/else 換成 resolver，pointer 事件加 hover / click / dblclick / drag direction。FSM、走動、IPC 都不動。

**Tech Stack:** TypeScript, Vitest, electron-vite renderer, DOM PointerEvents。

**分支建議：** `feat/pet-interaction`

---

## File Structure

**新增：**
- `src/core/anim-resolver.ts` — `resolveAnimation(ctx) -> string`，5 層優先級
- `src/core/click-dispatcher.ts` — `classifyClick(prev, curr, threshold) -> 'single' | 'double'`
- `tests/core/anim-resolver.test.ts`
- `tests/core/click-dispatcher.test.ts`

**修改：**
- `src/renderer/main.ts` — 加狀態變數（userAnim, dragDirection, walkDirection, lastClickAt, pendingClick, justDragged）；tick() 改用 resolveAnimation；pointer 處理擴充

---

### Task 0: 開分支

- [ ] **Step 1：建分支**

```bash
git checkout -b feat/pet-interaction
git status
```

Expected: `On branch feat/pet-interaction`

---

### Task 1：`anim-resolver` 純函式 + TDD

**Files:**
- Create: `src/core/anim-resolver.ts`
- Create: `tests/core/anim-resolver.test.ts`

- [ ] **Step 1：寫失敗測試**

```ts
// tests/core/anim-resolver.test.ts
import { describe, it, expect } from 'vitest'
import { resolveAnimation, type AnimationContext } from '../../src/core/anim-resolver'

function ctx(overrides: Partial<AnimationContext> = {}): AnimationContext {
  return {
    fsmAnimation: 'idle',
    dragMoved: false,
    dragDirection: null,
    userAnim: null,
    walking: false,
    walkDirection: null,
    ...overrides,
  }
}

describe('resolveAnimation 優先級', () => {
  it('全部 idle → 回 idle', () => {
    expect(resolveAnimation(ctx())).toBe('idle')
  })

  it('FSM reaction 最高優先', () => {
    expect(
      resolveAnimation(
        ctx({
          fsmAnimation: 'jumping',
          dragMoved: true,
          dragDirection: 'right',
          userAnim: 'waving',
          walking: true,
          walkDirection: 'left',
        }),
      ),
    ).toBe('jumping')
  })

  it('drag 蓋過 user/walking/idle', () => {
    expect(
      resolveAnimation(
        ctx({
          dragMoved: true,
          dragDirection: 'right',
          userAnim: 'waving',
          walking: true,
          walkDirection: 'left',
        }),
      ),
    ).toBe('running-right')
  })

  it('drag 中無方向 → jumping', () => {
    expect(resolveAnimation(ctx({ dragMoved: true, dragDirection: null }))).toBe('jumping')
  })

  it('drag 中往左 → running-left', () => {
    expect(resolveAnimation(ctx({ dragMoved: true, dragDirection: 'left' }))).toBe('running-left')
  })

  it('userAnim 蓋過 walking/idle', () => {
    expect(
      resolveAnimation(ctx({ userAnim: 'waving', walking: true, walkDirection: 'right' })),
    ).toBe('waving')
  })

  it('walking 但無方向 → idle（保護性）', () => {
    expect(resolveAnimation(ctx({ walking: true, walkDirection: null }))).toBe('idle')
  })

  it('walking + direction → running-{dir}', () => {
    expect(resolveAnimation(ctx({ walking: true, walkDirection: 'right' }))).toBe('running-right')
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

```bash
npm test -- tests/core/anim-resolver.test.ts
```

Expected：FAIL，「Cannot find module」之類。

- [ ] **Step 3：實作 `src/core/anim-resolver.ts`**

```ts
export interface AnimationContext {
  fsmAnimation: string
  dragMoved: boolean
  dragDirection: 'left' | 'right' | null
  userAnim: string | null
  walking: boolean
  walkDirection: 'left' | 'right' | null
}

/**
 * 決定當前 sprite。優先級由高到低：
 *   1. FSM reaction（非 idle）
 *   2. drag override
 *   3. userAnim（hover / click 反應）
 *   4. walking
 *   5. idle
 */
export function resolveAnimation(ctx: AnimationContext): string {
  if (ctx.fsmAnimation !== 'idle') return ctx.fsmAnimation
  if (ctx.dragMoved) return ctx.dragDirection ? `running-${ctx.dragDirection}` : 'jumping'
  if (ctx.userAnim) return ctx.userAnim
  if (ctx.walking && ctx.walkDirection) return `running-${ctx.walkDirection}`
  return 'idle'
}
```

- [ ] **Step 4：跑測試確認通過**

```bash
npm test -- tests/core/anim-resolver.test.ts
```

Expected：8 tests passed。

- [ ] **Step 5：Commit**

```bash
git add src/core/anim-resolver.ts tests/core/anim-resolver.test.ts
git commit -m "feat(core): anim-resolver 純函式 + 8 測試（5 層優先級）"
```

---

### Task 2：`click-dispatcher` 純函式 + TDD

**Files:**
- Create: `src/core/click-dispatcher.ts`
- Create: `tests/core/click-dispatcher.test.ts`

- [ ] **Step 1：寫失敗測試**

```ts
// tests/core/click-dispatcher.test.ts
import { describe, it, expect } from 'vitest'
import { classifyClick, DEFAULT_DOUBLE_CLICK_MS } from '../../src/core/click-dispatcher'

describe('classifyClick', () => {
  it('沒有前次 click → 視為 single', () => {
    expect(classifyClick(null, 1000)).toBe('single')
  })

  it('與前次 click 間隔 < threshold → double', () => {
    expect(classifyClick(1000, 1200)).toBe('double') // 200ms < 300
  })

  it('與前次 click 間隔 = threshold → double（邊界含）', () => {
    expect(classifyClick(1000, 1300)).toBe('double') // 300ms == 300
  })

  it('與前次 click 間隔 > threshold → single', () => {
    expect(classifyClick(1000, 1350)).toBe('single') // 350ms > 300
  })

  it('自訂 threshold', () => {
    expect(classifyClick(1000, 1100, 50)).toBe('single') // 100ms > 50
    expect(classifyClick(1000, 1040, 50)).toBe('double') // 40ms < 50
  })

  it('DEFAULT_DOUBLE_CLICK_MS = 300', () => {
    expect(DEFAULT_DOUBLE_CLICK_MS).toBe(300)
  })
})
```

- [ ] **Step 2：跑測試確認失敗**

```bash
npm test -- tests/core/click-dispatcher.test.ts
```

Expected：FAIL。

- [ ] **Step 3：實作 `src/core/click-dispatcher.ts`**

```ts
export const DEFAULT_DOUBLE_CLICK_MS = 300

/**
 * 給定「前次 click 時間」與「本次 click 時間」，回是 single 還是 double。
 *
 * 上層 caller 通常的用法：
 * - single：排一個 doubleClickMs 後 fire 的 timer；同時記下 lastClickAt = curr
 * - double：取消已排的 single timer；重置 lastClickAt = null；fire 雙擊行為
 *
 * 純函式：不持有狀態、不操作 timer。
 */
export function classifyClick(
  prevClickAt: number | null,
  currentAt: number,
  doubleClickMs: number = DEFAULT_DOUBLE_CLICK_MS,
): 'single' | 'double' {
  if (prevClickAt !== null && currentAt - prevClickAt <= doubleClickMs) {
    return 'double'
  }
  return 'single'
}
```

- [ ] **Step 4：跑測試確認通過**

```bash
npm test -- tests/core/click-dispatcher.test.ts
```

Expected：6 tests passed。

- [ ] **Step 5：Commit**

```bash
git add src/core/click-dispatcher.ts tests/core/click-dispatcher.test.ts
git commit -m "feat(core): click-dispatcher 純函式 classifyClick + 6 測試"
```

---

### Task 3：renderer tick() 改用 resolveAnimation + 引入 walkDirection state

**Files:**
- Modify: `src/renderer/main.ts`

- [ ] **Step 1：在既有 import 區加入新模組**

`src/renderer/main.ts` 既有 `import { pickWalk, DEFAULT_WALK_BOUNDS, type WalkBounds } from '../core/walk-planner'` 之後加：

```ts
import { resolveAnimation, type AnimationContext } from '../core/anim-resolver'
```

- [ ] **Step 2：在既有 `let walking = false` 附近加 walkDirection 狀態**

找到既有：

```ts
let currentAnim: string | null = null
let walking = false
let autoWalkEnabled = true
let walkBounds: WalkBounds = { ...DEFAULT_WALK_BOUNDS }
let nextWalkAt = pickWalk(Math.random, performance.now(), walkBounds).nextWalkAt
```

在下面加：

```ts
// 新：互動狀態
let walkDirection: 'left' | 'right' | null = null
let userAnim: { name: string; expiresAt: number } | null = null
let dragDirection: 'left' | 'right' | null = null
```

- [ ] **Step 3：tick() 改用 resolveAnimation**

找到既有 tick：

```ts
function tick(): void {
  const now = performance.now()
  const view = pet.advance(now)
  if (walking) {
    if (view.animation !== 'idle') setAnim(view.animation)
  } else {
    setAnim(view.animation)
  }
  if (autoWalkEnabled && !walking && view.animation === 'idle' && !document.hidden && now >= nextWalkAt) {
    const w = pickWalk(Math.random, now, walkBounds)
    nextWalkAt = w.nextWalkAt
    walking = true
    setAnim(w.direction === 'right' ? 'running-right' : 'running-left')
    window.petBridge.walkStart({ direction: w.direction, distance: w.distance, duration: w.duration })
  }
}
```

整段換成：

```ts
function tick(): void {
  const now = performance.now()
  const view = pet.advance(now)

  // 過期清除 userAnim
  if (userAnim && now >= userAnim.expiresAt) userAnim = null

  const ctx: AnimationContext = {
    fsmAnimation: view.animation,
    dragMoved: dragState !== null && dragState.moved,
    dragDirection,
    userAnim: userAnim?.name ?? null,
    walking,
    walkDirection,
  }
  setAnim(resolveAnimation(ctx))

  // 自走觸發（既有條件）
  if (autoWalkEnabled && !walking && view.animation === 'idle' && !document.hidden && now >= nextWalkAt) {
    const w = pickWalk(Math.random, now, walkBounds)
    nextWalkAt = w.nextWalkAt
    walking = true
    walkDirection = w.direction
    window.petBridge.walkStart({ direction: w.direction, distance: w.distance, duration: w.duration })
  }
}
```

注意：原本 `setAnim(w.direction === 'right' ? 'running-right' : 'running-left')` 被刪掉了——現在由 resolveAnimation 依 walkDirection 決定。

- [ ] **Step 4：walkEnded handler 也要清 walkDirection**

找到既有：

```ts
window.petBridge?.onWalkEnded?.(() => {
  walking = false
  nextWalkAt = pickWalk(Math.random, performance.now(), walkBounds).nextWalkAt
})
```

改成：

```ts
window.petBridge?.onWalkEnded?.(() => {
  walking = false
  walkDirection = null
  nextWalkAt = pickWalk(Math.random, performance.now(), walkBounds).nextWalkAt
})
```

- [ ] **Step 5：walkDirection handler 同步 walkDirection 變數**

找到既有：

```ts
window.petBridge?.onWalkDirection?.((direction) => {
  if (walking) setAnim(direction === 'right' ? 'running-right' : 'running-left')
})
```

改成：

```ts
window.petBridge?.onWalkDirection?.((direction) => {
  if (walking) walkDirection = direction
})
```

- [ ] **Step 6：typecheck + build + smoke**

```bash
npm run typecheck && npm run build
perl -e 'alarm 8; exec @ARGV' ./node_modules/.bin/electron . >/tmp/deskpet-task3.log 2>&1; echo rc=$?
pkill -f "desktop-notify/node_modules/electron" 2>/dev/null; :
```

Expected：typecheck 通過、build 成功、smoke rc=142、log 無 uncaught error。

- [ ] **Step 7：Commit**

```bash
git add src/renderer/main.ts
git commit -m "refactor(renderer): tick() 改用 resolveAnimation + 引入 walkDirection state"
```

---

### Task 4：Hover → waving

**Files:**
- Modify: `src/renderer/main.ts`

- [ ] **Step 1：找到既有 bindHover()**

既有：

```ts
function bindHover(): void {
  const enableInteractive = () => window.petBridge.setInteractive(true)
  const disableInteractive = () => window.petBridge.setInteractive(false)
  const badge = document.querySelector<HTMLDivElement>('#badge')!

  petEl.addEventListener('mouseenter', enableInteractive)
  petEl.addEventListener('mouseleave', disableInteractive)
  cardsEl.addEventListener('mouseenter', enableInteractive)
  cardsEl.addEventListener('mouseleave', disableInteractive)
  badge.addEventListener('mouseenter', enableInteractive)
  badge.addEventListener('mouseleave', disableInteractive)
}
```

把 petEl 的 mouseenter 改成觸發 hover anim：

```ts
function bindHover(): void {
  const enableInteractive = () => window.petBridge.setInteractive(true)
  const disableInteractive = () => window.petBridge.setInteractive(false)
  const badge = document.querySelector<HTMLDivElement>('#badge')!

  petEl.addEventListener('mouseenter', () => {
    enableInteractive()
    // 拖動中或 click 反應中不打斷
    if (!dragState && !userAnim) {
      userAnim = { name: 'waving', expiresAt: performance.now() + 1000 }
    }
  })
  petEl.addEventListener('mouseleave', disableInteractive)
  cardsEl.addEventListener('mouseenter', enableInteractive)
  cardsEl.addEventListener('mouseleave', disableInteractive)
  badge.addEventListener('mouseenter', enableInteractive)
  badge.addEventListener('mouseleave', disableInteractive)
}
```

- [ ] **Step 2：build + smoke**

```bash
npm run typecheck && npm run build
perl -e 'alarm 8; exec @ARGV' ./node_modules/.bin/electron . >/tmp/deskpet-task4.log 2>&1; echo rc=$?
pkill -f "desktop-notify/node_modules/electron" 2>/dev/null; :
```

Expected：通過。

- [ ] **Step 3：Commit**

```bash
git add src/renderer/main.ts
git commit -m "feat(renderer): hover 寵物時播 waving 1 秒"
```

---

### Task 5：Click / Double-click

**Files:**
- Modify: `src/renderer/main.ts`

- [ ] **Step 1：在既有 import 加 click-dispatcher**

```ts
import { classifyClick, DEFAULT_DOUBLE_CLICK_MS } from '../core/click-dispatcher'
```

- [ ] **Step 2：新增 click 狀態變數**

在現有 `let userAnim ...` 附近加：

```ts
let lastClickAt: number | null = null
let pendingClickTimer: ReturnType<typeof setTimeout> | null = null
let justDragged = false
const REACTION_POOL = ['waving', 'jumping', 'review'] as const
const REACTION_DURATION_MS: Record<string, number> = {
  waving: 1000,
  jumping: 1000,
  review: 1750,
}

function triggerClickReaction(): void {
  const pick = REACTION_POOL[Math.floor(Math.random() * REACTION_POOL.length)]
  userAnim = { name: pick, expiresAt: performance.now() + REACTION_DURATION_MS[pick] }
}
```

- [ ] **Step 3：在 endDrag 結尾標記 justDragged**

找到既有：

```ts
function endDrag(e: PointerEvent): void {
  if (!dragState) return
  try {
    petEl.releasePointerCapture(e.pointerId)
  } catch {
    /* 已釋放 */
  }
  if (dragState.moved) {
    if (dragMoveRaf) {
      cancelAnimationFrame(dragMoveRaf)
      flushDragMove()
    }
    window.petBridge.dragEnd()
  }
  dragState = null
}
```

改成：

```ts
function endDrag(e: PointerEvent): void {
  if (!dragState) return
  try {
    petEl.releasePointerCapture(e.pointerId)
  } catch {
    /* 已釋放 */
  }
  if (dragState.moved) {
    if (dragMoveRaf) {
      cancelAnimationFrame(dragMoveRaf)
      flushDragMove()
    }
    window.petBridge.dragEnd()
    dragDirection = null
    justDragged = true
    setTimeout(() => { justDragged = false }, 60)
  } else {
    // 沒移動就放開 → click 路徑
    handleClick(performance.now())
  }
  dragState = null
}

function handleClick(now: number): void {
  if (justDragged) return
  const kind = classifyClick(lastClickAt, now)
  if (kind === 'double') {
    if (pendingClickTimer) {
      clearTimeout(pendingClickTimer)
      pendingClickTimer = null
    }
    lastClickAt = null
    window.petBridge.openCenter()
  } else {
    if (pendingClickTimer) clearTimeout(pendingClickTimer)
    lastClickAt = now
    pendingClickTimer = setTimeout(() => {
      pendingClickTimer = null
      lastClickAt = null
      triggerClickReaction()
    }, DEFAULT_DOUBLE_CLICK_MS)
  }
}
```

- [ ] **Step 4：build + smoke**

```bash
npm run typecheck && npm run build
perl -e 'alarm 8; exec @ARGV' ./node_modules/.bin/electron . >/tmp/deskpet-task5.log 2>&1; echo rc=$?
pkill -f "desktop-notify/node_modules/electron" 2>/dev/null; :
```

Expected：通過。

- [ ] **Step 5：Commit**

```bash
git add src/renderer/main.ts
git commit -m "feat(renderer): 單擊寵物隨機反應動畫、雙擊開通知中心"
```

---

### Task 6：Drag 方向追蹤

**Files:**
- Modify: `src/renderer/main.ts`

- [ ] **Step 1：在現有常數區加 DIR_THRESHOLD**

既有有 `const DRAG_THRESHOLD = 3`，在它附近加：

```ts
const DRAG_DIRECTION_THRESHOLD = 8 // 累計位移 > 8px 才開始判方向，避免抖動
```

- [ ] **Step 2：pointermove handler 加 dragDirection 更新**

找到既有 pointermove：

```ts
petEl.addEventListener('pointermove', (e) => {
  if (!dragState) return
  if (!dragState.moved) {
    const dx = Math.abs(e.screenX - dragState.startSx)
    const dy = Math.abs(e.screenY - dragState.startSy)
    if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return
    dragState.moved = true
  }
  pendingDragMove = { sx: e.screenX, sy: e.screenY }
  if (!dragMoveRaf) dragMoveRaf = requestAnimationFrame(flushDragMove)
})
```

整段改成：

```ts
petEl.addEventListener('pointermove', (e) => {
  if (!dragState) return
  if (!dragState.moved) {
    const dx = Math.abs(e.screenX - dragState.startSx)
    const dy = Math.abs(e.screenY - dragState.startSy)
    if (dx < DRAG_THRESHOLD && dy < DRAG_THRESHOLD) return
    dragState.moved = true
  }
  // 累計位移判方向（向右為正、向左為負）
  const cumDx = e.screenX - dragState.startSx
  if (Math.abs(cumDx) > DRAG_DIRECTION_THRESHOLD) {
    dragDirection = cumDx > 0 ? 'right' : 'left'
  }
  pendingDragMove = { sx: e.screenX, sy: e.screenY }
  if (!dragMoveRaf) dragMoveRaf = requestAnimationFrame(flushDragMove)
})
```

- [ ] **Step 3：build + smoke**

```bash
npm run typecheck && npm run build
perl -e 'alarm 8; exec @ARGV' ./node_modules/.bin/electron . >/tmp/deskpet-task6.log 2>&1; echo rc=$?
pkill -f "desktop-notify/node_modules/electron" 2>/dev/null; :
```

Expected：通過。

- [ ] **Step 4：Commit**

```bash
git add src/renderer/main.ts
git commit -m "feat(renderer): 拖動寵物時 sprite 依方向切 running-{left,right}"
```

---

### Task 7：FSM 反應事件清本地互動狀態

**Files:**
- Modify: `src/renderer/main.ts`

- [ ] **Step 1：找到 onPetEvent handler**

既有：

```ts
window.petBridge?.onPetEvent?.((event: AppEvent) => {
  applyEvent(event)
  currentEvent = event
  renderCard()
  startReplay(event)
  refreshBadge()
})
```

改成：

```ts
window.petBridge?.onPetEvent?.((event: AppEvent) => {
  applyEvent(event)
  currentEvent = event
  renderCard()
  startReplay(event)
  refreshBadge()
  // 反應事件比本地互動重要：清掉互動狀態以免覆蓋 sprite
  userAnim = null
  if (pendingClickTimer) {
    clearTimeout(pendingClickTimer)
    pendingClickTimer = null
    lastClickAt = null
  }
})
```

- [ ] **Step 2：build + smoke**

```bash
npm run typecheck && npm run build
perl -e 'alarm 8; exec @ARGV' ./node_modules/.bin/electron . >/tmp/deskpet-task7.log 2>&1; echo rc=$?
pkill -f "desktop-notify/node_modules/electron" 2>/dev/null; :
```

Expected：通過。

- [ ] **Step 3：Commit**

```bash
git add src/renderer/main.ts
git commit -m "feat(renderer): hook 反應事件時清除本地互動狀態（avoid sprite 互蓋）"
```

---

### Task 8：整合驗證 + README/CHANGELOG + 合併

- [ ] **Step 1：全套自動驗證**

```bash
npm test && npm run typecheck && npm run build
```

Expected：所有測試通過（既有 + 新增的 anim-resolver 8、click-dispatcher 6 = 14 條新測試）；typecheck/build 通過。

- [ ] **Step 2：Playwright e2e smoke**

```bash
npm run e2e
```

Expected：`SMOKE_RESULT: PASS`，idle 動畫變動偵測到、卡片彈出正常。

- [ ] **Step 3：手動驗收（請使用者跑 npm run dev 對下面 7 項）**

1. Hover may → waving 揮手約 1 秒、之後回 idle
2. 點 may（不拖）→ 隨機反應動畫（waving / jumping / review）一輪後回 idle
3. 連點 may 2 下（< 300ms）→ 通知中心開
4. 拖 may 往右 ≥ 8px → sprite 切右跑；放開回 idle
5. 拖 may 中途反向（左→右→左）→ sprite 翻轉
6. 卡片接到 hook done → 反應動畫 jumping；期間 hover 不會打斷
7. Walking 中點寵物（不拖）→ 走動 sprite 被 click 反應覆蓋；反應結束若 walking 仍 active 回 running

- [ ] **Step 4：使用者確認後 README/CHANGELOG 更新**

更新 `README.md` 特色段落加：「寵物對 hover / click / dblclick / drag 都有 sprite 反應」。

更新 `CHANGELOG.md` `[Unreleased]` `### Added` 加：

```markdown
- **寵物互動 sprite 反應**（Spec ④）：hover 寵物時揮手一輪；單擊隨機反應動畫（waving / jumping / review）；雙擊（< 300ms）直接開通知中心；拖動寵物時 sprite 依累計位移方向（DIR_THRESHOLD=8px）切 `running-left`/`running-right`，剛拖起無方向時為 jumping。動畫優先級由純函式 `resolveAnimation` 仲裁：FSM reaction > drag > userAnim > walking > idle。
```

- [ ] **Step 5：Commit docs + 合併**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: README/CHANGELOG 反映 Spec ④ 寵物互動"
git checkout main
git merge feat/pet-interaction
git branch -d feat/pet-interaction
git log --oneline -10
```

Expected：合併乾淨、所有 commit 在 main、分支刪除成功。

---

## 風險與回退

- **resolveAnimation 邏輯漏洞**：純函式測試覆蓋 5 層×多場景 = 8 條 case，應夠。萬一有 edge case 就補測再修。
- **Click vs drag 誤判**：3px DRAG_THRESHOLD + justDragged 60ms 都是經驗值。手動驗收時若手抖被誤判為 drag，調 threshold。
- **dblclick 間隔 300ms 太短**：手動驗收時若雙擊很容易變單擊，調 DEFAULT_DOUBLE_CLICK_MS（或做成 prefs.json 設定）。
- **互動 vs hook 衝突太頻繁**：若 hook 事件密集（debug 期間），互動動畫一直被蓋。可接受——hook 訊息本來就最重要。

---

## Self-Review

**1. Spec coverage**

| Spec 段落 | 對應 Task |
|---|---|
| §3 五層優先級 | Task 1（純函式）+ Task 3（tick refactor）|
| §4 click/dblclick | Task 2（純函式）+ Task 5（renderer）|
| §5 drag direction | Task 6 |
| §6 hover | Task 4 |
| §7 walk/FSM/IPC 整合 | Task 3 + Task 7 |
| §8 新增/修改檔案 | 全部 |
| §9 測試策略 | Task 1+2（純函式 TDD）+ Task 8（e2e + 手動）|

✓ 全 cover。

**2. Placeholder scan**

- 無 TBD / TODO
- 每個 Step 都有具體程式碼或命令
- 「Add appropriate error handling」之類的 vague step 沒有

✓

**3. Type consistency**

- `AnimationContext` 欄位名一致：`fsmAnimation`, `dragMoved`, `dragDirection`, `userAnim`, `walking`, `walkDirection`
- `classifyClick` 三參數順序一致：`prevClickAt`, `currentAt`, `doubleClickMs`
- `userAnim` 內部結構 `{ name: string; expiresAt: number }` 一致
- `dragDirection`/`walkDirection` 型別 `'left' | 'right' | null` 一致

✓
