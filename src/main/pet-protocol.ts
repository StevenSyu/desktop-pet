import { protocol, net } from 'electron'
import { pathToFileURL } from 'node:url'
import { isSafeSkinId } from '../core/skin-scan'

// app ready 前呼叫一次：把 pet: 註冊為 standard + secure scheme
export function registerPetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'pet', privileges: { standard: true, secure: true } },
  ])
}

// app.whenReady() 最前段呼叫（在任何載入 pet: 的視窗前）。
// getPath(id) 回傳該 id 的 spritesheet 絕對路徑（無則 undefined → 404）。
export function registerPetProtocol(getPath: (id: string) => string | undefined): void {
  protocol.handle('pet', (req) => {
    const url = new URL(req.url) // pet://<id>/sheet
    const id = url.hostname
    if (!isSafeSkinId(id) || url.pathname !== '/sheet') {
      return new Response(null, { status: 400 })
    }
    const path = getPath(id)
    if (!path) return new Response(null, { status: 404 })
    return net.fetch(pathToFileURL(path).toString(), { headers: { 'Content-Type': 'image/webp' } })
  })
}
