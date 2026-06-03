import { describe, expect, it } from 'vitest'
import { buildCodexPayload } from '../../hooks/codex-payload.mjs'

type CodexPayload = {
  type: string
  body: string
}

function buildPayload(type: string): CodexPayload {
  return buildCodexPayload(type, { session_id: 's1', cwd: '/Users/x/work/my-proj' })
}

describe('codex-notify', () => {
  it.each([
    ['done', '這一輪完成了'],
    ['attention', '需要你回覆或授權'],
    ['error', '回應失敗（API 錯誤）'],
    ['review', '請看一下'],
    ['working', '處理中…'],
    ['info', ''],
  ])('uses Claude Code matching Chinese fallback body for %s', (type, expectedBody) => {
    expect(buildPayload(type)).toMatchObject({
      type,
      body: expectedBody,
    })
  })
})
