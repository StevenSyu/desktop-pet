import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractLastAssistantText } from '../../hooks/transcript.mjs'

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

  it('最後一筆是 tool_use → 找更前面的文字', () => {
    const file = tempFile(
      [A('hello'), U('do it'), A('working'), TOOL('Bash'), TOOL('Read')].join('\n'),
    )
    expect(extractLastAssistantText(file)).toBe('working')
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
