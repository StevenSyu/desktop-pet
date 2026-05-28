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

  it('多個 assistant entry（thinking + text + tool_use）→ 串接該輪所有 text', () => {
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
    expect(extractLastAssistantText(file)).toBe('starting\nfinished, here is the summary')
  })

  it('tool_result（type=user 但 content 是 tool_result）不算輪邊界', () => {
    const file = tempFile([U('do it'), A('working'), TOOL_RESULT(), A('result is X')].join('\n'))
    expect(extractLastAssistantText(file)).toBe('working\nresult is X')
  })

  it('sidechain（Task 子代理）的 assistant 不會被當主對話收進來', () => {
    const file = tempFile(
      [U('main task'), A('on it'), A_SIDE('subagent here'), A('done')].join('\n'),
    )
    expect(extractLastAssistantText(file)).toBe('on it\ndone')
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
  it('一開始就抓得到 → 立刻回，不延遲', async () => {
    const file = tempFile([U('q'), A('answer')].join('\n'))
    const t0 = Date.now()
    const text = await extractLastAssistantTextWithRetry(file, { retries: 3, delayMs: 100 })
    expect(text).toBe('answer')
    expect(Date.now() - t0).toBeLessThan(50) // 不應該等
  })

  it('檔案延遲寫入 → 在第 N 次 retry 時抓到', async () => {
    const file = tempFile(U('q')) // 一開始只有 user，沒 assistant
    // 80ms 後追加 assistant 文字（落在第 1 次 retry 視窗內）
    setTimeout(() => appendFileSync(file, '\n' + A('delayed answer')), 80)
    const t0 = Date.now()
    const text = await extractLastAssistantTextWithRetry(file, { retries: 3, delayMs: 100 })
    const elapsed = Date.now() - t0
    expect(text).toBe('delayed answer')
    expect(elapsed).toBeGreaterThanOrEqual(100) // 至少跑過一次 delay
    expect(elapsed).toBeLessThan(400)
  })

  it('全程都抓不到 → retries 用完回空', async () => {
    const file = tempFile([U('q'), '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"..."}]}}'].join('\n'))
    const text = await extractLastAssistantTextWithRetry(file, { retries: 2, delayMs: 50 })
    expect(text).toBe('')
  })
})
