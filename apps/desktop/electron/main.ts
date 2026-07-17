import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const DEV_SERVER_URL = 'http://localhost:5173'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

function createMainWindow() {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 760,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (app.isPackaged) {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  } else {
    mainWindow.loadURL(DEV_SERVER_URL)
  }
}

ipcMain.handle('app:get-version', () => {
  return app.getVersion()
})
ipcMain.handle('system:get-info', () => {
  return {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
  }
})
app.whenReady().then(() => {
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})