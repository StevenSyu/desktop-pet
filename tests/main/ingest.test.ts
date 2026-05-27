import { describe, it, expect } from 'vitest'
import { handleNotifyBody } from '../../src/main/ingest'

const TOKEN = 'secret'
const deps = { now: () => 1000, uuid: () => 'id-1' }

describe('handleNotifyBody', () => {
  it('rejects a wrong token with 401', () => {
    const res = handleNotifyBody('{}', { 'x-token': 'nope' }, TOKEN, deps)
    expect(res.status).toBe(401)
    expect(res.event).toBeUndefined()
  })

  it('rejects malformed JSON with 400', () => {
    const res = handleNotifyBody('not json', { 'x-token': TOKEN }, TOKEN, deps)
    expect(res.status).toBe(400)
    expect(res.event).toBeUndefined()
  })

  it('accepts a valid payload and returns a normalized event', () => {
    const res = handleNotifyBody(
      JSON.stringify({ type: 'done', title: 'Claude Code', body: '完成', source: 'claude-code' }),
      { 'x-token': TOKEN },
      TOKEN,
      deps,
    )
    expect(res.status).toBe(200)
    expect(res.event).toMatchObject({
      id: 'id-1',
      type: 'done',
      title: 'Claude Code',
      body: '完成',
      source: { kind: 'claude-code' },
      timestamp: 1000,
    })
  })
})
