import { describe, expect, it } from 'vitest'

type CodexPayload = {
  type: string
  body: string
}

type CodexNotifyModule = {
  buildCodexPayload?: (type: string, input?: Record<string, unknown>) => CodexPayload
}

async function buildPayload(type: string): Promise<CodexPayload> {
  const mod = await import('../../hooks/codex-notify.mjs') as CodexNotifyModule
  expect(typeof mod.buildCodexPayload).toBe('function')
  return mod.buildCodexPayload!(type, { session_id: 's1', cwd: '/Users/x/work/my-proj' })
}

describe('codex-notify', () => {
  it.each([
    ['done', '這一輪完成了'],
    ['attention', '需要你回覆或授權'],
    ['error', '回應失敗（API 錯誤）'],
    ['review', '請看一下'],
    ['working', '處理中…'],
    ['info', ''],
  ])('uses Claude Code matching Chinese fallback body for %s', async (type, expectedBody) => {
    await expect(buildPayload(type)).resolves.toMatchObject({
      type,
      body: expectedBody,
    })
  })
})
