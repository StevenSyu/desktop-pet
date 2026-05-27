import { app, BrowserWindow } from 'electron'
import { createPetWindow } from './window'

app.whenReady().then(() => {
  createPetWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createPetWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
