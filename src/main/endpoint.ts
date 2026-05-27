import { createServer } from 'node:net'
import { writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

export interface EndpointInfo {
  port: number
  token: string
}

export const DEFAULT_PORT = 8765

export function generateToken(): string {
  return randomBytes(16).toString('hex')
}

/** 從 startPort 起找一個可用的本機埠。 */
export function findFreePort(startPort = DEFAULT_PORT): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number): void => {
      const srv = createServer()
      srv.once('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE' && port < startPort + 50) {
          tryPort(port + 1)
        } else {
          reject(err)
        }
      })
      srv.once('listening', () => {
        srv.close(() => resolve(port))
      })
      srv.listen(port, '127.0.0.1')
    }
    tryPort(startPort)
  })
}

/** 寫 endpoint.json 到 userDataDir，回傳檔案路徑。
 * endpoint.json 含 token（憑證），以 owner-only(0600) 寫入；先移除舊檔，
 * 確保以 0600 重新建立（避免殘留寬鬆權限或被他人預先建立）。 */
export function writeEndpointFile(userDataDir: string, info: EndpointInfo): string {
  const path = join(userDataDir, 'endpoint.json')
  rmSync(path, { force: true })
  writeFileSync(path, JSON.stringify({ port: info.port, token: info.token }), { mode: 0o600 })
  return path
}
