import { app, BrowserWindow } from 'electron'
import { createPetWindow } from './window'
import { findFreePort, generateToken, writeEndpointFile } from './endpoint'
import { startIngestServer } from './ingest'
import type { AppEvent } from '../core/events'

app.whenReady().then(async () => {
  const win = createPetWindow()

  const port = await findFreePort()
  const token = generateToken()
  writeEndpointFile(app.getPath('userData'), { port, token })

  startIngestServer({
    port,
    token,
    onEvent: (event: AppEvent) => {
      if (!win.isDestroyed()) win.webContents.send('pet-event', event)
    },
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
