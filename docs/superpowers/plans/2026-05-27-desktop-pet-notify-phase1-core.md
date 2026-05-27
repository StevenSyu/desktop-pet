# 桌面寵物通知工具 — Phase 1：核心邏輯庫 實作計畫

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立一個與 Electron 無關、100% 可單元測試的純 TypeScript 核心邏輯庫，承載事件正規化、共用精靈格式、通知佇列、寵物狀態機與寵物驗證。

**Architecture:** 所有模組放在 `src/core/`，無任何 Electron / DOM / Node-only IO 依賴（可在主行程與 renderer 共用）。時間與 UUID 以參數注入，確保測試可決定性。Phase 2 的 Electron 外殼將 import 這些模組。

**Tech Stack:** TypeScript（ESM、strict）、Vitest。

**設計來源：** `docs/superpowers/specs/2026-05-27-desktop-pet-notify-design.md`（§6 契約、§9 精靈格式、§11 狀態機、§10 驗證、§12 通知）。

**計畫系列：** 本檔為 Phase 1。Phase 2（Electron 外殼）、Phase 3（Hook Kit ＋整合）將於 Phase 1 完成後另行撰寫。

**注意：** 所有 commit 訊息結尾請附：
`Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

---

## File Structure

```
desktop-notify/
├── package.json              # 專案與 scripts（test / typecheck）
├── tsconfig.json             # TS strict 設定
├── vitest.config.ts          # 測試包含路徑
├── src/core/
│   ├── events.ts             # 事件型別、normalizePayload、typeToPriority
│   ├── sprite-format.ts      # 共用精靈格式常數、frameRect、animationForType、尺寸驗證
│   ├── notification-queue.ts # 卡片佇列：去重、ttl 過期、最近一則
│   ├── pet-fsm.ts            # PetController：idle↔reaction、依優先級插隊、播畢回 idle
│   └── pet-validation.ts     # validatePet：pet.json 欄位 + 精靈尺寸驗證
└── tests/core/
    ├── smoke.test.ts
    ├── events.test.ts
    ├── sprite-format.test.ts
    ├── notification-queue.test.ts
    ├── pet-fsm.test.ts
    └── pet-validation.test.ts
```

每個檔案單一職責；`events.ts` 與 `sprite-format.ts` 為其他模組的型別/常數來源，故先做。

---

## Task 1：專案骨架（TypeScript + Vitest）

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `tests/core/smoke.test.ts`

- [ ] **Step 1: 建立 package.json**

Create `package.json`:
```json
{
  "name": "desktop-notify",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: 安裝開發依賴**

Run:
```bash
npm install -D typescript vitest @types/node
```
Expected: `node_modules/` 建立、`package-lock.json` 產生，無錯誤。

- [ ] **Step 3: 建立 tsconfig.json**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "tests", "vitest.config.ts"]
}
```

- [ ] **Step 4: 建立 vitest.config.ts**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
```

- [ ] **Step 5: 寫一個 smoke 測試確認 runner 可動**

Create `tests/core/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('smoke', () => {
  it('test runner works', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 6: 跑測試確認通過**

Run: `npx vitest run tests/core/smoke.test.ts`
Expected: PASS（1 passed）。

- [ ] **Step 7: 確認型別檢查可動**

Run: `npx tsc --noEmit`
Expected: 無輸出、exit 0。

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts tests/core/smoke.test.ts
git commit -m "chore: 初始化 TypeScript + Vitest 專案骨架" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

> 註：`node_modules/` 已於現有 `.gitignore` 排除。

---

## Task 2：events.ts — 事件型別、優先級、normalizePayload

**Files:**
- Create: `src/core/events.ts`
- Test: `tests/core/events.test.ts`

對應 spec §6（契約與正規化規則）、§11（優先級 `error > attention > done > review > working > info`）。

- [ ] **Step 1: 寫失敗測試**

Create `tests/core/events.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { normalizePayload, typeToPriority } from '../../src/core/events'

describe('typeToPriority', () => {
  it('error > attention > done > review > working > info', () => {
    expect(typeToPriority('error')).toBeGreaterThan(typeToPriority('attention'))
    expect(typeToPriority('attention')).toBeGreaterThan(typeToPriority('done'))
    expect(typeToPriority('done')).toBeGreaterThan(typeToPriority('review'))
    expect(typeToPriority('review')).toBeGreaterThan(typeToPriority('working'))
    expect(typeToPriority('working')).toBeGreaterThan(typeToPriority('info'))
  })
})

describe('normalizePayload', () => {
  const deps = { now: () => 1000, uuid: () => 'fixed-id' }

  it('fills defaults for a minimal payload', () => {
    const e = normalizePayload({ type: 'done' }, deps)
    expect(e).toEqual({
      id: 'fixed-id',
      source: { kind: 'unknown' },
      sessionId: 'default',
      type: 'done',
      title: '',
      body: '',
      priority: typeToPriority('done'),
      timestamp: 1000,
      ttlMs: 5000,
      actions: [],
    })
  })

  it('maps an unknown type to info', () => {
    const e = normalizePayload({ type: 'wat' }, deps)
    expect(e.type).toBe('info')
    expect(e.priority).toBe(typeToPriority('info'))
  })

  it('accepts a string source as { kind }', () => {
    const e = normalizePayload({ type: 'info', source: 'claude-code' }, deps)
    expect(e.source).toEqual({ kind: 'claude-code' })
  })

  it('preserves an object source and explicit fields', () => {
    const e = normalizePayload(
      { type: 'attention', source: { kind: 'codex', name: 'my-proj' }, sessionId: 's1', priority: 99, ttlMs: 1234 },
      deps,
    )
    expect(e.source).toEqual({ kind: 'codex', name: 'my-proj' })
    expect(e.sessionId).toBe('s1')
    expect(e.priority).toBe(99)
    expect(e.ttlMs).toBe(1234)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/events.test.ts`
Expected: FAIL（無法解析 `../../src/core/events`）。

- [ ] **Step 3: 寫最小實作**

Create `src/core/events.ts`:
```ts
export type NotifyType = 'done' | 'attention' | 'error' | 'review' | 'working' | 'info'

const KNOWN_TYPES: NotifyType[] = ['done', 'attention', 'error', 'review', 'working', 'info']

export interface NotifySource {
  kind: string
  name?: string
}

/** 外部 POST /notify 的原始 payload（欄位多為選填）。 */
export interface NotifyPayload {
  id?: string
  source?: NotifySource | string
  sessionId?: string
  type?: string
  title?: string
  body?: string
  priority?: number | null
  timestamp?: number | null
  ttlMs?: number | null
  actions?: unknown[]
}

/** 正規化後的內部事件（所有欄位齊備）。 */
export interface AppEvent {
  id: string
  source: NotifySource
  sessionId: string
  type: NotifyType
  title: string
  body: string
  priority: number
  timestamp: number
  ttlMs: number
  actions: unknown[]
}

const PRIORITY: Record<NotifyType, number> = {
  error: 5,
  attention: 4,
  done: 3,
  review: 2,
  working: 1,
  info: 0,
}

export function typeToPriority(type: NotifyType): number {
  return PRIORITY[type]
}

export interface NormalizeDeps {
  now?: () => number
  uuid?: () => string
}

const DEFAULT_TTL_MS = 5000

// 中立的去重 id 產生器：不需密碼學強度，僅需在本行程內唯一。
// 不依賴 node:crypto 或 globalThis.crypto，使 core 保持平台中立。
let idCounter = 0
function fallbackId(): string {
  idCounter += 1
  return `${Date.now().toString(36)}-${idCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function normalizePayload(raw: NotifyPayload, deps: NormalizeDeps = {}): AppEvent {
  const now = deps.now ?? (() => Date.now())
  const uuid = deps.uuid ?? fallbackId

  const type: NotifyType = KNOWN_TYPES.includes(raw.type as NotifyType)
    ? (raw.type as NotifyType)
    : 'info'

  const source: NotifySource =
    typeof raw.source === 'string'
      ? { kind: raw.source }
      : raw.source ?? { kind: 'unknown' }

  return {
    id: raw.id ?? uuid(),
    source,
    sessionId: raw.sessionId ?? 'default',
    type,
    title: raw.title ?? '',
    body: raw.body ?? '',
    priority: raw.priority ?? typeToPriority(type),
    timestamp: raw.timestamp ?? now(),
    ttlMs: raw.ttlMs ?? DEFAULT_TTL_MS,
    actions: raw.actions ?? [],
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/core/events.test.ts`
Expected: PASS（全部通過）。

- [ ] **Step 5: Commit**

```bash
git add src/core/events.ts tests/core/events.test.ts
git commit -m "feat(core): 事件型別、優先級與 normalizePayload" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3：sprite-format.ts — 共用精靈格式

**Files:**
- Create: `src/core/sprite-format.ts`
- Test: `tests/core/sprite-format.test.ts`

對應 spec §9（1536×1872、8×9、每格 192×208、固定列序）與 §11（type→animation）。

- [ ] **Step 1: 寫失敗測試**

Create `tests/core/sprite-format.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  SPRITE_FORMAT,
  frameRect,
  validateSheetDimensions,
  animationForType,
} from '../../src/core/sprite-format'

describe('SPRITE_FORMAT', () => {
  it('has canonical sheet + frame geometry', () => {
    expect(SPRITE_FORMAT.sheetWidth).toBe(1536)
    expect(SPRITE_FORMAT.sheetHeight).toBe(1872)
    expect(SPRITE_FORMAT.cols).toBe(8)
    expect(SPRITE_FORMAT.rows).toBe(9)
    expect(SPRITE_FORMAT.frameWidth).toBe(192)
    expect(SPRITE_FORMAT.frameHeight).toBe(208)
  })

  it('defines 9 animations on rows 0..8 with the documented frame counts', () => {
    const a = SPRITE_FORMAT.animations
    expect(a.idle).toMatchObject({ row: 0, frames: 6 })
    expect(a['running-right']).toMatchObject({ row: 1, frames: 8 })
    expect(a['running-left']).toMatchObject({ row: 2, frames: 8 })
    expect(a.waving).toMatchObject({ row: 3, frames: 4 })
    expect(a.jumping).toMatchObject({ row: 4, frames: 5 })
    expect(a.failed).toMatchObject({ row: 5, frames: 8 })
    expect(a.waiting).toMatchObject({ row: 6, frames: 6 })
    expect(a.running).toMatchObject({ row: 7, frames: 6 })
    expect(a.review).toMatchObject({ row: 8, frames: 7 })

    const rows = Object.values(a).map((x) => x.row).sort((p, q) => p - q)
    expect(rows).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })
})

describe('frameRect', () => {
  it('computes pixel rect for a (row, col)', () => {
    expect(frameRect(0, 0)).toEqual({ x: 0, y: 0, w: 192, h: 208 })
    expect(frameRect(2, 3)).toEqual({ x: 3 * 192, y: 2 * 208, w: 192, h: 208 })
  })
})

describe('validateSheetDimensions', () => {
  it('accepts exact canonical size', () => {
    expect(validateSheetDimensions(1536, 1872)).toBe(true)
  })
  it('rejects anything else', () => {
    expect(validateSheetDimensions(1536, 1871)).toBe(false)
    expect(validateSheetDimensions(800, 600)).toBe(false)
  })
})

describe('animationForType', () => {
  it('maps event types to animations', () => {
    expect(animationForType('done')).toBe('jumping')
    expect(animationForType('attention')).toBe('waving')
    expect(animationForType('error')).toBe('failed')
    expect(animationForType('review')).toBe('review')
    expect(animationForType('working')).toBe('waiting')
    expect(animationForType('info')).toBe('idle')
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/sprite-format.test.ts`
Expected: FAIL（無法解析 `../../src/core/sprite-format`）。

- [ ] **Step 3: 寫最小實作**

Create `src/core/sprite-format.ts`:
```ts
import type { NotifyType } from './events'

export interface AnimationSpec {
  row: number
  frames: number
  fps: number
  loop: boolean
}

export const SPRITE_FORMAT = {
  sheetWidth: 1536,
  sheetHeight: 1872,
  cols: 8,
  rows: 9,
  frameWidth: 192,
  frameHeight: 208,
  animations: {
    idle: { row: 0, frames: 6, fps: 4, loop: true },
    'running-right': { row: 1, frames: 8, fps: 8, loop: true },
    'running-left': { row: 2, frames: 8, fps: 8, loop: true },
    waving: { row: 3, frames: 4, fps: 6, loop: false },
    jumping: { row: 4, frames: 5, fps: 8, loop: false },
    failed: { row: 5, frames: 8, fps: 8, loop: false },
    waiting: { row: 6, frames: 6, fps: 4, loop: true },
    running: { row: 7, frames: 6, fps: 8, loop: true },
    review: { row: 8, frames: 7, fps: 6, loop: false },
  },
} as const satisfies {
  sheetWidth: number
  sheetHeight: number
  cols: number
  rows: number
  frameWidth: number
  frameHeight: number
  animations: Record<string, AnimationSpec>
}

export type AnimationName = keyof typeof SPRITE_FORMAT.animations

export interface FrameRect {
  x: number
  y: number
  w: number
  h: number
}

export function frameRect(row: number, col: number): FrameRect {
  return {
    x: col * SPRITE_FORMAT.frameWidth,
    y: row * SPRITE_FORMAT.frameHeight,
    w: SPRITE_FORMAT.frameWidth,
    h: SPRITE_FORMAT.frameHeight,
  }
}

export function validateSheetDimensions(width: number, height: number): boolean {
  return width === SPRITE_FORMAT.sheetWidth && height === SPRITE_FORMAT.sheetHeight
}

const TYPE_ANIMATION: Record<NotifyType, AnimationName> = {
  done: 'jumping',
  attention: 'waving',
  error: 'failed',
  review: 'review',
  working: 'waiting',
  info: 'idle',
}

export function animationForType(type: NotifyType): AnimationName {
  return TYPE_ANIMATION[type]
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/core/sprite-format.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/core/sprite-format.ts tests/core/sprite-format.test.ts
git commit -m "feat(core): 共用精靈格式、frameRect 與 type→animation 對應" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4：notification-queue.ts — 卡片佇列

**Files:**
- Create: `src/core/notification-queue.ts`
- Test: `tests/core/notification-queue.test.ts`

對應 spec §12（去重、ttl 自動淡出、最近一則）。時鐘以注入方式測試。

- [ ] **Step 1: 寫失敗測試**

Create `tests/core/notification-queue.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { NotificationQueue } from '../../src/core/notification-queue'
import { normalizePayload } from '../../src/core/events'

function makeEvent(over: { id: string; timestamp: number; ttlMs?: number }) {
  return normalizePayload(
    { id: over.id, type: 'info', timestamp: over.timestamp, ttlMs: over.ttlMs ?? 5000 },
    { now: () => over.timestamp, uuid: () => over.id },
  )
}

describe('NotificationQueue', () => {
  it('keeps active events and drops expired ones by ttl', () => {
    let t = 0
    const q = new NotificationQueue({ now: () => t })
    q.push(makeEvent({ id: 'a', timestamp: 0, ttlMs: 5000 }))

    t = 4999
    expect(q.active().map((e) => e.id)).toEqual(['a'])

    t = 5000
    expect(q.active()).toEqual([]) // 到期淡出
  })

  it('dedupes by id (update in place, no duplicate)', () => {
    let t = 0
    const q = new NotificationQueue({ now: () => t })
    q.push(makeEvent({ id: 'a', timestamp: 0 }))
    q.push(makeEvent({ id: 'a', timestamp: 0 })) // 同 id 再送
    expect(q.active()).toHaveLength(1)
  })

  it('latest() returns the most recently pushed active event', () => {
    let t = 0
    const q = new NotificationQueue({ now: () => t })
    q.push(makeEvent({ id: 'a', timestamp: 0 }))
    q.push(makeEvent({ id: 'b', timestamp: 0 }))
    expect(q.latest()?.id).toBe('b')
  })

  it('latest() returns undefined when nothing active', () => {
    const q = new NotificationQueue({ now: () => 0 })
    expect(q.latest()).toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/notification-queue.test.ts`
Expected: FAIL（無法解析 `../../src/core/notification-queue`）。

- [ ] **Step 3: 寫最小實作**

Create `src/core/notification-queue.ts`:
```ts
import type { AppEvent } from './events'

export interface NotificationQueueOptions {
  now?: () => number
}

export class NotificationQueue {
  private items: AppEvent[] = []
  private readonly now: () => number

  constructor(options: NotificationQueueOptions = {}) {
    this.now = options.now ?? (() => Date.now())
  }

  /** 加入事件；同 id 則就地更新（去重）。 */
  push(event: AppEvent): void {
    const index = this.items.findIndex((e) => e.id === event.id)
    if (index >= 0) {
      this.items[index] = event
    } else {
      this.items.push(event)
    }
  }

  /** 回傳尚未到期的事件（順手清掉已到期者）。 */
  active(): AppEvent[] {
    const t = this.now()
    this.items = this.items.filter((e) => t - e.timestamp < e.ttlMs)
    return [...this.items]
  }

  /** 最近一則仍有效的事件，無則 undefined。 */
  latest(): AppEvent | undefined {
    const a = this.active()
    return a.length > 0 ? a[a.length - 1] : undefined
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/core/notification-queue.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/core/notification-queue.ts tests/core/notification-queue.test.ts
git commit -m "feat(core): 通知卡片佇列（去重 + ttl 過期 + 最近一則）" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5：pet-fsm.ts — 寵物狀態機

**Files:**
- Create: `src/core/pet-fsm.ts`
- Test: `tests/core/pet-fsm.test.ts`

對應 spec §11。規則：
- 預設 `idle`。
- 收到事件 → 若 `info`（animation 為 idle）不改變寵物；否則進入 `reaction` 播對應動畫。
- 非 loop 動畫（jumping/waving/failed/review）播放 `frames/fps` 秒後 `advance()` 自動回 idle。
- loop 動畫（waiting）持續，直到被新事件取代。
- 插隊：進行中的 reaction 僅能被**更高優先級**事件打斷；同級或更低 → 忽略（卡片仍由 NotificationQueue 排隊，動畫不插隊）。reaction 自然播畢後，較低優先級事件可再觸發。

- [ ] **Step 1: 寫失敗測試**

Create `tests/core/pet-fsm.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { PetController } from '../../src/core/pet-fsm'
import { normalizePayload, type NotifyType } from '../../src/core/events'

function ev(type: NotifyType, atMs = 0) {
  return normalizePayload({ type, timestamp: atMs }, { now: () => atMs, uuid: () => `${type}-${atMs}` })
}

describe('PetController', () => {
  it('starts idle', () => {
    const pet = new PetController()
    expect(pet.advance(0)).toEqual({ mode: 'idle', animation: 'idle' })
  })

  it('plays a one-shot reaction then returns to idle after its duration', () => {
    const pet = new PetController()
    pet.onEvent(ev('done', 0), 0) // jumping: 5 frames @ 8fps = 625ms
    expect(pet.advance(100)).toEqual({ mode: 'reaction', animation: 'jumping' })
    expect(pet.advance(624)).toEqual({ mode: 'reaction', animation: 'jumping' })
    expect(pet.advance(625)).toEqual({ mode: 'idle', animation: 'idle' })
  })

  it('info events do not change the pet (card-only)', () => {
    const pet = new PetController()
    pet.onEvent(ev('info', 0), 0)
    expect(pet.advance(0)).toEqual({ mode: 'idle', animation: 'idle' })
  })

  it('a higher-priority event interrupts an in-flight reaction', () => {
    const pet = new PetController()
    pet.onEvent(ev('done', 0), 0) // jumping
    pet.onEvent(ev('error', 100), 100) // error > done → interrupt to failed
    expect(pet.advance(120)).toEqual({ mode: 'reaction', animation: 'failed' })
  })

  it('a lower-or-equal-priority event does NOT interrupt an in-flight reaction', () => {
    const pet = new PetController()
    pet.onEvent(ev('error', 0), 0) // failed: 8 frames @ 8fps = 1000ms
    pet.onEvent(ev('done', 100), 100) // done < error → ignored
    expect(pet.advance(200)).toEqual({ mode: 'reaction', animation: 'failed' })
  })

  it('after a reaction finishes, a lower-priority event can play', () => {
    const pet = new PetController()
    pet.onEvent(ev('error', 0), 0) // failed ends at 1000ms
    expect(pet.advance(1000)).toEqual({ mode: 'idle', animation: 'idle' })
    pet.onEvent(ev('done', 1000), 1000)
    expect(pet.advance(1100)).toEqual({ mode: 'reaction', animation: 'jumping' })
  })

  it('a looped reaction (working→waiting) persists until replaced', () => {
    const pet = new PetController()
    pet.onEvent(ev('working', 0), 0) // waiting is loop:true
    expect(pet.advance(10_000)).toEqual({ mode: 'reaction', animation: 'waiting' })
    pet.onEvent(ev('error', 10_000), 10_000) // higher priority replaces
    expect(pet.advance(10_010)).toEqual({ mode: 'reaction', animation: 'failed' })
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/pet-fsm.test.ts`
Expected: FAIL（無法解析 `../../src/core/pet-fsm`）。

- [ ] **Step 3: 寫最小實作**

Create `src/core/pet-fsm.ts`:
```ts
import type { AppEvent } from './events'
import { SPRITE_FORMAT, animationForType, type AnimationName } from './sprite-format'

export type PetMode = 'idle' | 'reaction'

export interface PetView {
  mode: PetMode
  animation: AnimationName
}

const IDLE_VIEW: PetView = { mode: 'idle', animation: 'idle' }

function durationMs(animation: AnimationName): number {
  const spec = SPRITE_FORMAT.animations[animation]
  return (spec.frames / spec.fps) * 1000
}

export class PetController {
  private mode: PetMode = 'idle'
  private animation: AnimationName = 'idle'
  private currentPriority = -1
  private reactionEndsAt = 0

  /**
   * 餵入事件。只有比目前 reaction 更高優先級、或目前已回 idle 時才會改變動畫。
   * `info`（對應 idle 動畫）視為純卡片事件，不改變寵物。
   */
  onEvent(event: AppEvent, now: number): void {
    const animation = animationForType(event.type)
    if (animation === 'idle') return // info：卡片照顯示，寵物不動

    const inFlight = this.mode === 'reaction' && now < this.reactionEndsAt
    if (inFlight && event.priority <= this.currentPriority) return

    const spec = SPRITE_FORMAT.animations[animation]
    this.mode = 'reaction'
    this.animation = animation
    this.currentPriority = event.priority
    this.reactionEndsAt = spec.loop ? Number.POSITIVE_INFINITY : now + durationMs(animation)
  }

  /** 推進到時間 now，回傳當下應顯示的視圖。非 loop 動畫播畢自動回 idle。 */
  advance(now: number): PetView {
    if (this.mode === 'reaction' && now >= this.reactionEndsAt) {
      this.mode = 'idle'
      this.animation = 'idle'
      this.currentPriority = -1
      this.reactionEndsAt = 0
    }
    return this.mode === 'idle' ? { ...IDLE_VIEW } : { mode: this.mode, animation: this.animation }
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/core/pet-fsm.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/core/pet-fsm.ts tests/core/pet-fsm.test.ts
git commit -m "feat(core): 寵物狀態機（idle↔reaction、優先級插隊、播畢回 idle）" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6：pet-validation.ts — 寵物資料驗證

**Files:**
- Create: `src/core/pet-validation.ts`
- Test: `tests/core/pet-validation.test.ts`

對應 spec §10（pet.json 欄位 + §9 尺寸驗證；不符即拒絕）。本模組純驗證已解析好的資料；實際讀檔/解析 JSON 屬 Phase 2 的薄膠水。

- [ ] **Step 1: 寫失敗測試**

Create `tests/core/pet-validation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { validatePet } from '../../src/core/pet-validation'

const goodSheet = { width: 1536, height: 1872 }

describe('validatePet', () => {
  it('accepts a well-formed pet with a canonical sheet', () => {
    const result = validatePet(
      { id: 'may', displayName: 'may', description: 'a dog', spritesheetPath: 'spritesheet.webp' },
      goodSheet,
    )
    expect(result).toEqual({
      ok: true,
      pet: { id: 'may', displayName: 'may', description: 'a dog', spritesheetPath: 'spritesheet.webp' },
    })
  })

  it('defaults displayName to id and description to empty string', () => {
    const result = validatePet({ id: 'may', spritesheetPath: 'spritesheet.webp' }, goodSheet)
    expect(result).toEqual({
      ok: true,
      pet: { id: 'may', displayName: 'may', description: '', spritesheetPath: 'spritesheet.webp' },
    })
  })

  it('rejects a sheet with the wrong dimensions', () => {
    const result = validatePet(
      { id: 'may', spritesheetPath: 'spritesheet.webp' },
      { width: 800, height: 600 },
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.some((e) => e.includes('尺寸'))).toBe(true)
    }
  })

  it('rejects missing id / spritesheetPath', () => {
    const result = validatePet({ displayName: 'x' }, goodSheet)
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toContain('缺少 id')
      expect(result.errors).toContain('缺少 spritesheetPath')
    }
  })

  it('rejects non-object input', () => {
    const result = validatePet(null, goodSheet)
    expect(result.ok).toBe(false)
  })
})
```

- [ ] **Step 2: 跑測試確認失敗**

Run: `npx vitest run tests/core/pet-validation.test.ts`
Expected: FAIL（無法解析 `../../src/core/pet-validation`）。

- [ ] **Step 3: 寫最小實作**

Create `src/core/pet-validation.ts`:
```ts
import { validateSheetDimensions } from './sprite-format'

export interface PetManifest {
  id: string
  displayName: string
  description: string
  spritesheetPath: string
}

export type ValidationResult =
  | { ok: true; pet: PetManifest }
  | { ok: false; errors: string[] }

export interface SheetMeta {
  width: number
  height: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function validatePet(raw: unknown, sheet: SheetMeta): ValidationResult {
  const errors: string[] = []

  if (!isRecord(raw)) {
    return { ok: false, errors: ['pet.json 不是物件'] }
  }

  const id = raw.id
  const spritesheetPath = raw.spritesheetPath

  if (typeof id !== 'string' || id.length === 0) errors.push('缺少 id')
  if (typeof spritesheetPath !== 'string' || spritesheetPath.length === 0) {
    errors.push('缺少 spritesheetPath')
  }
  if (!validateSheetDimensions(sheet.width, sheet.height)) {
    errors.push(`精靈表尺寸不符（需 1536×1872，實際 ${sheet.width}×${sheet.height}）`)
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }

  return {
    ok: true,
    pet: {
      id: id as string,
      displayName: typeof raw.displayName === 'string' ? raw.displayName : (id as string),
      description: typeof raw.description === 'string' ? raw.description : '',
      spritesheetPath: spritesheetPath as string,
    },
  }
}
```

- [ ] **Step 4: 跑測試確認通過**

Run: `npx vitest run tests/core/pet-validation.test.ts`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add src/core/pet-validation.ts tests/core/pet-validation.test.ts
git commit -m "feat(core): 寵物資料驗證（欄位 + 精靈尺寸）" \
  -m "Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7：Phase 1 收尾驗證

**Files:** 無（僅驗證）

- [ ] **Step 1: 跑完整測試套件**

Run: `npm test`
Expected: 全部 5 個核心測試檔 + smoke 通過，0 failed。

- [ ] **Step 2: 全專案型別檢查**

Run: `npm run typecheck`
Expected: 無輸出、exit 0。

- [ ] **Step 3: 確認無未提交變更**

Run: `git status --short`
Expected: 空（所有檔案皆已提交）。

---

## 驗收標準（Phase 1 完成定義）

- `npm test` 全綠：events / sprite-format / notification-queue / pet-fsm / pet-validation 皆有測試且通過。
- `npm run typecheck` 通過。
- `src/core/` 內無任何 Electron / DOM / 檔案系統依賴（純邏輯，主行程與 renderer 皆可 import）。
- 已涵蓋 spec：§6 正規化、§9 精靈格式、§11 優先級＋狀態機、§12 通知佇列、§10 驗證。
