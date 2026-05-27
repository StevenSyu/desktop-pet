import { describe, it, expect } from 'vitest'
import { buildHookPayload } from '../../hooks/payload.mjs'

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
})
