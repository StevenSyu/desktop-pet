import { contextBridge } from 'electron'
import type { AppEvent } from '../core/events'
import type { StoredMessage } from '../core/message-store'
import type { WalkBounds } from '../core/walk-planner'
import type { Prefs } from '../main/prefs'
import type { CardView } from '../core/card-view'
import type { Channel } from '../core/channel'
import type { PomodoroPrefs, PomodoroSnapshot } from '../core/pomodoro-timer'
import { sendCommand, invokeQuery, subscribePush } from '../ipc/preload-helpers'

contextBridge.exposeInMainWorld('petBridge', {
  onPetEvent: (cb: (event: AppEvent) => void) => subscribePush('pet-event', cb),
  setInteractive: (channelId: string, interactive: boolean) => sendCommand('set-interactive', { channelId, interactive }),
  setScale: (channelId: string, scale: number) => sendCommand('set-scale', { channelId, scale }),
  showContextMenu: (channelId: string) => sendCommand('show-context-menu', { channelId }),
  openCenter: (channelId: string) => sendCommand('open-center', { channelId }),
  onSetSkin: (cb: (id: string) => void) => subscribePush('set-skin', cb),
  onSetScale: (cb: (scale: number) => void) => subscribePush('set-scale', cb),
  onUnreadCount: (cb: (n: number) => void) => subscribePush('unread-count', cb),
  markRead: (id: string) => sendCommand('mark-read', id),
  dragStart: (channelId: string, sx: number, sy: number) => sendCommand('drag-start', { channelId, sx, sy }),
  dragMove: (channelId: string, sx: number, sy: number) => sendCommand('drag-move', { channelId, sx, sy }),
  dragEnd: (channelId: string) => sendCommand('drag-end', { channelId }),
  walkStart: (channelId: string, req: { direction: 'left' | 'right'; distance: number; duration: number }) =>
    sendCommand('walk-start', { channelId, ...req }),
  walkCancel: (channelId: string) => sendCommand('walk-cancel', { channelId }),
  onWalkEnded: (cb: () => void) => subscribePush('walk-ended', cb),
  onWalkDirection: (cb: (direction: 'left' | 'right') => void) => subscribePush('walk-direction', cb),
  getAutoWalk: () => invokeQuery('get-auto-walk'),
  onAutoWalkChanged: (cb: (enabled: boolean) => void) => subscribePush('auto-walk-changed', cb),
  getPrefs: () => invokeQuery('get-prefs'),
  getSkins: (channelId: string) => invokeQuery('get-skins', { channelId }),
  selectSkin: (channelId: string, id: string) => invokeQuery('select-skin', { channelId, id }),
  openPetsFolder: () => sendCommand('open-pets-folder'),
  setWalkBounds: (bounds: Partial<WalkBounds>) => sendCommand('set-walk-bounds', bounds),
  pomodoroStart: () => sendCommand('pomodoro-start'),
  pomodoroPause: () => sendCommand('pomodoro-pause'),
  pomodoroResume: () => sendCommand('pomodoro-resume'),
  pomodoroStop: () => sendCommand('pomodoro-stop'),
  setPomodoroPrefs: (p: Partial<PomodoroPrefs>) => sendCommand('set-pomodoro-prefs', p),
  getPomodoro: () => invokeQuery('get-pomodoro'),
  onPomodoroChanged: (cb: (s: PomodoroSnapshot) => void) => subscribePush('pomodoro-changed', cb),
  onPrefsChanged: (cb: (prefs: Prefs) => void) => subscribePush('prefs-changed', cb),
  setDnd: (enabled: boolean) => sendCommand('set-dnd', enabled),
  getDnd: () => invokeQuery('get-dnd'),
  onDndOn: (cb: () => void) => subscribePush('dnd-on', cb),
  onDndChanged: (cb: (enabled: boolean) => void) => subscribePush('dnd-changed', cb),
  getMessages: () => invokeQuery('get-messages'),
  markReadIds: (ids: string[]) => sendCommand('mark-read-ids', ids),
  clearMessages: (ids: string[]) => sendCommand('clear-messages', ids),
  onMessagesUpdated: (cb: (msgs: StoredMessage[]) => void) => subscribePush('messages-updated', cb),
  showCard: (channelId: string, view: CardView) => sendCommand('show-card', { channelId, view }),
  hideCard: (channelId: string) => sendCommand('hide-card', { channelId }),
  onCardDismissed: (cb: (p: { id: string }) => void) => subscribePush('card-dismissed', cb),
  getPendingDetail: () => invokeQuery('get-pending-detail'),
  onOpenDetail: (cb: () => void) => subscribePush('open-detail', cb),
  getPendingChannelTab: () => invokeQuery('get-pending-channel-tab'),
  onOpenChannelTab: (cb: () => void) => subscribePush('open-channel-tab', cb),
  getChannels: () => invokeQuery('get-channels'),
  onChannelsUpdated: (cb: (channels: Channel[]) => void) => subscribePush('channels-updated', cb),
})
