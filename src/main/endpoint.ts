import { createServer } from 'node:net'
import { writeFileSync } from 'node:fs'
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

/** 寫 endpoint.json 到 userDataDir，回傳檔案路徑。 */
export function writeEndpointFile(userDataDir: string, info: EndpointInfo): string {
  const path = join(userDataDir, 'endpoint.json')
  writeFileSync(path, JSON.stringify({ port: info.port, token: info.token }), 'utf8')
  return path
}
