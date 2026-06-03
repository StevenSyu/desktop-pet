import { execFileSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function generatedCodexHooks(): Record<string, unknown> {
  const output = execFileSync(process.execPath, ['hooks/print-codex-config.mjs'], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  return JSON.parse(output).hooks
}

describe('print-codex-config', () => {
  it('omits prompt-submitted working notifications', () => {
    expect(generatedCodexHooks()).not.toHaveProperty('UserPromptSubmit')
  })

  it('omits session-start notifications', () => {
    expect(generatedCodexHooks()).not.toHaveProperty('SessionStart')
  })

  it('keeps only actionable Codex lifecycle notifications', () => {
    expect(Object.keys(generatedCodexHooks()).sort()).toEqual([
      'PermissionRequest',
      'Stop',
    ])
  })
})
