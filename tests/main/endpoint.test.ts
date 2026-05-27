import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { writeEndpointFile, generateToken, type EndpointInfo } from '../../src/main/endpoint'

const dirs: string[] = []
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'deskpet-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('generateToken', () => {
  it('produces a non-empty unique-ish token', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a.length).toBeGreaterThanOrEqual(16)
    expect(a).not.toBe(b)
  })
})

describe('writeEndpointFile', () => {
  it('writes endpoint.json with port and token', () => {
    const dir = tempDir()
    const info: EndpointInfo = { port: 8765, token: 'tok123' }
    const path = writeEndpointFile(dir, info)
    expect(existsSync(path)).toBe(true)
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ port: 8765, token: 'tok123' })
  })
})
