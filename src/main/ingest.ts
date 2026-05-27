import { createServer, type Server } from 'node:http'
import { normalizePayload, type AppEvent, type NormalizeDeps } from '../core/events'

export interface NotifyResult {
  status: 200 | 400 | 401
  event?: AppEvent
}

/** 純函式：依 token 與 body 決定結果，可單元測試。 */
export function handleNotifyBody(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  token: string,
  deps: NormalizeDeps = {},
): NotifyResult {
  const got = headers['x-token']
  if (got !== token) return { status: 401 }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    return { status: 400 }
  }
  if (typeof parsed !== 'object' || parsed === null) return { status: 400 }

  const event = normalizePayload(parsed as Record<string, unknown>, deps)
  return { status: 200, event }
}

export interface IngestOptions {
  port: number
  token: string
  onEvent: (event: AppEvent) => void
}

/** 啟動只綁 127.0.0.1 的 ingest server。 */
export function startIngestServer(opts: IngestOptions): Server {
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || req.url !== '/notify') {
      res.writeHead(404).end()
      return
    }
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c as Buffer))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      const result = handleNotifyBody(body, req.headers, opts.token)
      if (result.status === 200 && result.event) opts.onEvent(result.event)
      res.writeHead(result.status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(result.status === 200 ? { ok: true, id: result.event!.id } : { ok: false }))
    })
  })
  server.listen(opts.port, '127.0.0.1')
  return server
}
