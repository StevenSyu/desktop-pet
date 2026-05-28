import { EventEmitter } from 'node:events'

// main 端的小型事件匯流排，解耦「右鍵選單」與「開啟通知中心」
export const bus = new EventEmitter()
