// preload 側 typed IPC 包裝。對 contract 三張表做型別檢查。
import { ipcRenderer } from 'electron'
import type { Commands, Queries, Pushes } from './contract'

// payload 為 void 的 channel → 呼叫時不帶引數；否則需帶對應型別的單一引數。
type CommandArgs<K extends keyof Commands> = Commands[K] extends void ? [] : [Commands[K]]
type QueryArgs<K extends keyof Queries> = Queries[K]['args'] extends void ? [] : [Queries[K]['args']]

/** renderer → main 單向命令。 */
export function sendCommand<K extends keyof Commands>(channel: K, ...args: CommandArgs<K>): void {
  ipcRenderer.send(channel, ...args)
}

/** renderer → main 往返查詢，回 Promise<result>。 */
export function invokeQuery<K extends keyof Queries>(
  channel: K,
  ...args: QueryArgs<K>
): Promise<Queries[K]['result']> {
  return ipcRenderer.invoke(channel, ...args) as Promise<Queries[K]['result']>
}

/** 訂閱 main → renderer 推播。void payload 的 callback 不收引數。 */
export function subscribePush<K extends keyof Pushes>(
  channel: K,
  cb: Pushes[K] extends void ? () => void : (payload: Pushes[K]) => void,
): void {
  ipcRenderer.on(channel, (_e, payload) => (cb as (p?: unknown) => void)(payload))
}
