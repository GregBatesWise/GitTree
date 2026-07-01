import { app, BrowserWindow, shell, session } from 'electron'
import { join } from 'node:path'
import { CH } from '../shared/channels'
import { registerIpc } from './ipc'

const isDev = !!process.env['ELECTRON_RENDERER_URL']

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 940,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#1b1e24',
    title: 'GitTree',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win.show())

  // Open external links in the system browser, never in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Ctrl/Cmd+R refreshes the repository instead of reloading the window.
  win.webContents.on('before-input-event', (event, input) => {
    const mod = input.control || input.meta
    if (
      input.type === 'keyDown' &&
      !input.isAutoRepeat &&
      mod &&
      !input.shift &&
      !input.alt &&
      input.key.toLowerCase() === 'r'
    ) {
      event.preventDefault()
      win.webContents.send(CH.appRefresh)
    }
  })

  if (isDev) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'] as string)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// Pin the app name BEFORE anything reads userData. app.getName() (which
// determines the userData folder holding repos.json / groups.json / settings)
// can otherwise resolve to different values (package "name" vs "productName")
// between dev and packaged builds, making saved repositories appear to vanish.
app.setName('GitTree')

// Only allow a single running instance. Overlapping instances (common during
// dev restarts) race on the JSON stores and can wipe them, and cause the
// "Unable to move the cache: Access is denied" errors.
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  app.whenReady().then(() => {
    // Harden production builds with a strict Content-Security-Policy. Skipped in
    // dev so Vite's HMR (websocket + fast refresh) keeps working.
    if (!isDev) {
      session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
        cb({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'"
            ]
          }
        })
      })
    }

    registerIpc()
    createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
