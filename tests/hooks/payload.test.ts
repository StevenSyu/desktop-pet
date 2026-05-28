import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildHookPayload } from '../../hooks/payload.mjs'

const dirs: string[] = []
function tempTranscript(content: string): string {
  const d = mkdtempSync(join(tmpdir(), 'deskpet-payload-'))
  dirs.push(d)
  const p = join(d, 't.jsonl')
  writeFileSync(p, content, 'utf8')
  return p
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('buildHookPayload', () => {
  it('maps a known type and derives source.name from cwd basename', () => {
    const body = buildHookPayload('done', { session_id: 's1', cwd: '/Users/x/work/my-proj' })
    expect(body).toEqual({
      source: { kind: 'claude-code', name: 'my-proj' },
      sessionId: 's1',
      type: 'done',
      title: 'Claude Code · my-proj',
      body: '這一輪完成了',
    })
  })

  it('falls back to info for an unknown type', () => {
    const body = buildHookPayload('wat', { session_id: 's1', cwd: '/a/b' })
    expect(body.type).toBe('info')
  })

  it('uses defaults when cwd / session_id are missing', () => {
    const body = buildHookPayload('attention', {})
    expect(body.source).toEqual({ kind: 'claude-code', name: 'claude-code' })
    expect(body.sessionId).toBe('default')
    expect(body.type).toBe('attention')
  })

  it('has a distinct body for error', () => {
    expect(buildHookPayload('error', { cwd: '/a/b' }).body).toBe('回應失敗（API 錯誤）')
  })

  it('done：有 transcript_path 時 body 用 Claude 最後一段文字', () => {
    const p = tempTranscript(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: '已修完 race condition，請覆查' }] },
      }),
    )
    const body = buildHookPayload('done', { cwd: '/x/proj', transcript_path: p })
    expect(body.body).toBe('已修完 race condition，請覆查')
  })

  it('done：transcript 抓不到 → 退回固定字串', () => {
    const body = buildHookPayload('done', { cwd: '/x/proj', transcript_path: '/nope/x.jsonl' })
    expect(body.body).toBe('這一輪完成了')
  })

  it('非 done 不會去讀 transcript', () => {
    const p = tempTranscript(
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'should not appear' }] },
      }),
    )
    const body = buildHookPayload('attention', { cwd: '/x/proj', transcript_path: p })
    expect(body.body).toBe('需要你回覆或授權')
  })
})
