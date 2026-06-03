// main 側 typed IPC 包裝。對 contract 三張表做型別檢查。
import { ipcMain, type BrowserWindow } from 'electron'
import type { Commands, Queries, Pushes } from './contract'

export type PushArgs<K extends keyof Pushes> = Pushes[K] extends void ? [] : [Pushes[K]]

/** 註冊 renderer → main 單向命令 handler。void payload 的 handler 不收引數。 */
export function handleCommand<K extends keyof Commands>(
  channel: K,
  handler: Commands[K] extends void ? () => void : (payload: Commands[K]) => void,
): void {
  ipcMain.on(channel, (_e, payload) => (handler as (p?: unknown) => void)(payload))
}

/** 註冊 renderer → main 往返查詢 handler。回傳值（或 Promise）型別需符合 contract。 */
export function handleQuery<K extends keyof Queries>(
  channel: K,
  handler: Queries[K]['args'] extends void
    ? () => Queries[K]['result'] | Promise<Queries[K]['result']>
    : (args: Queries[K]['args']) => Queries[K]['result'] | Promise<Queries[K]['result']>,
): void {
  ipcMain.handle(channel, (_e, args) => (handler as (a?: unknown) => unknown)(args))
}

/**
 * main → renderer 推播。集中 `win && !win.isDestroyed()` 的存在性守衛——
 * 窗已關 / null 時靜默 no-op，呼叫端不必再各自檢查。
 */
export function pushTo<K extends keyof Pushes>(
  win: BrowserWindow | null | undefined,
  channel: K,
  ...args: PushArgs<K>
): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send(channel, ...args)
}
