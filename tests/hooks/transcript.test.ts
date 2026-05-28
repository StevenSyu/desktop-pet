import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  extractLastAssistantText,
  extractLastAssistantTextWithRetry,
} from '../../hooks/transcript.mjs'

const dirs: string[] = []
function tempFile(content: string): string {
  const d = mkdtempSync(join(tmpdir(), 'deskpet-transcript-'))
  dirs.push(d)
  const p = join(d, 'transcript.jsonl')
  writeFileSync(p, content, 'utf8')
  return p
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const A = (text: string): string =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } })
const U = (text: string): string =>
  JSON.stringify({ type: 'user', message: { content: text } })
const TOOL = (name: string): string =>
  JSON.stringify({
    type: 'assistant',
    message: { content: [{ type: 'tool_use', name, input: {} }] },
  })
const THINK = (): string =>
  JSON.stringify({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '...' }] } })
const TOOL_RESULT = (): string =>
  JSON.stringify({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
  })
const A_SIDE = (text: string): string =>
  JSON.stringify({
    type: 'assistant',
    isSidechain: true,
    message: { content: [{ type: 'text', text }] },
  })

describe('extractLastAssistantText', () => {
  it('檔案不存在 → 空字串', () => {
    expect(extractLastAssistantText('/nope/nowhere.jsonl')).toBe('')
    expect(extractLastAssistantText(undefined)).toBe('')
  })

  it('空檔 → 空字串', () => {
    expect(extractLastAssistantText(tempFile(''))).toBe('')
  })

  it('沒有 assistant 訊息 → 空字串', () => {
    expect(extractLastAssistantText(tempFile([U('hi'), U('?')].join('\n')))).toBe('')
  })

  it('回最後一筆 assistant 文字', () => {
    const file = tempFile([U('hi'), A('first reply'), U('ok'), A('final words')].join('\n'))
    expect(extractLastAssistantText(file)).toBe('final words')
  })

  it('當輪最後是 tool_use（無 text wrap-up）→ 仍只回該輪的 text', () => {
    const file = tempFile(
      [A('hello'), U('do it'), A('working'), TOOL('Bash'), TOOL('Read')].join('\n'),
    )
    // 不能回 "hello"（上一輪），只能是當輪的 "working"
    expect(extractLastAssistantText(file)).toBe('working')
  })

  it('當輪全是 thinking + tool_use（無 text）→ 不跨輪、回空字串', () => {
    const file = tempFile(
      [A('previous turn reply'), U('do something'), THINK(), TOOL('Bash')].join('\n'),
    )
    // 不應該回 "previous turn reply"（跨輪錯誤）；無 text 就退回空字串讓 caller 用 default
    expect(extractLastAssistantText(file)).toBe('')
  })

  it('多 entry 當輪：只回最後一個帶 text 的 entry（給卡片用的是 wrap-up，不是中間步驟）', () => {
    const file = tempFile(
      [
        U('do it'),
        THINK(),
        A('starting'),
        TOOL('Bash'),
        TOOL_RESULT(),
        A('finished, here is the summary'),
      ].join('\n'),
    )
    expect(extractLastAssistantText(file)).toBe('finished, here is the summary')
  })

  it('當輪最後是 tool_use（無 wrap-up 文字）→ 退一格找 text，但不跨輪', () => {
    const file = tempFile(
      [U('do it'), A('starting'), TOOL('Bash'), TOOL_RESULT(), A('mid step'), TOOL('Read')].join('\n'),
    )
    expect(extractLastAssistantText(file)).toBe('mid step')
  })

  it('tool_result（type=user 但 content 是 tool_result）不算輪邊界', () => {
    const file = tempFile([U('do it'), A('working'), TOOL_RESULT(), A('result is X')].join('\n'))
    expect(extractLastAssistantText(file)).toBe('result is X')
  })

  it('sidechain（Task 子代理）的 assistant 不會被當主對話收進來', () => {
    const file = tempFile(
      [U('main task'), A('on it'), A_SIDE('subagent here'), A('done')].join('\n'),
    )
    expect(extractLastAssistantText(file)).toBe('done')
  })

  it('壞行被略過', () => {
    const file = tempFile(['not json', A('valid'), 'still not json'].join('\n'))
    expect(extractLastAssistantText(file)).toBe('valid')
  })

  it('多個 text block 用 \\n 串接', () => {
    const file = tempFile(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: 'first paragraph' },
            { type: 'tool_use', name: 'X' },
            { type: 'text', text: 'second paragraph' },
          ],
        },
      }),
    )
    expect(extractLastAssistantText(file)).toBe('first paragraph\nsecond paragraph')
  })

  it('文字前後 trim', () => {
    const file = tempFile(A('  hello  '))
    expect(extractLastAssistantText(file)).toBe('hello')
  })
})

describe('extractLastAssistantTextWithRetry', () => {
  const fast = { initialWaitMs: 20, settleWaitMs: 30, emptyRetries: 3, emptyRetryMs: 20 }

  it('一開始就抓得到 → 經過 settle 後回該文字（不被空覆蓋）', async () => {
    const file = tempFile([U('q'), A('answer')].join('\n'))
    const text = await extractLastAssistantTextWithRetry(file, fast)
    expect(text).toBe('answer')
  })

  it('檔案延遲寫入 → retry 等到出現後抓到', async () => {
    const file = tempFile(U('q'))
    // 在 initialWait + 1 個 retry 之間追加（fast: ~40ms 內出現）
    setTimeout(() => appendFileSync(file, '\n' + A('delayed answer')), 30)
    const text = await extractLastAssistantTextWithRetry(file, fast)
    expect(text).toBe('delayed answer')
  })

  it('抓到後仍被「更新版」蓋過 → 回最新版（避免回 penultimate）', async () => {
    const file = tempFile([U('q'), A('penultimate')].join('\n'))
    // initialWait 後讀到 'penultimate'；在 settleWait 期間追加 final
    setTimeout(() => appendFileSync(file, '\n' + A('final wrap-up')), 35)
    const text = await extractLastAssistantTextWithRetry(file, fast)
    expect(text).toBe('final wrap-up')
  })

  it('全程都抓不到（當輪只有 thinking）→ 回空', async () => {
    const file = tempFile([U('q'), THINK()].join('\n'))
    const text = await extractLastAssistantTextWithRetry(file, fast)
    expect(text).toBe('')
  })
})
