import { app, BrowserWindow, globalShortcut, ipcMain, Menu, net, protocol, shell, Tray } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { electronApp, is } from '@electron-toolkit/utils'
import {
  MEDIA_SCHEME,
  addPaths,
  clearLibrary,
  decodeMediaUrl,
  loadLibrary,
  pickFolders,
  rescanLibrary,
  type LibraryTrack
} from './library'
import { loadPlaylists, savePlaylists, type Playlist } from './playlists'
import { prepareSmokeProfile, runSmokeTest } from './smoke'
import {
  SC_SCHEME,
  downloadTrack,
  getSettings,
  pickOfflineFolder,
  remoteToLibraryTrack,
  resolveArtworkUrl,
  resolveStreamUrl,
  resolveUrl,
  searchTracks,
  setSettings,
  testConnection,
  trending,
  type DownloadProgress,
  type RemoteTrack
} from './soundcloud'
import { upsertTracks } from './library'

// Must run before any code resolves `userData`, so a verification pass can
// never read or overwrite the real library.
if (process.env.EQUIP_SMOKE === '1') prepareSmokeProfile()

let mainWindow: BrowserWindow | null = null
let miniWindow: BrowserWindow | null = null
let tray: Tray | null = null
let lastPlaybackState: unknown = null

protocol.registerSchemesAsPrivileged([
  {
    scheme: MEDIA_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  },
  {
    scheme: SC_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
  }
])

/** Adds a CORS header so Web Audio can analyse the media through
 * `createMediaElementSource` (the visualizer needs real signal data). */
function corsify(response: Response): Response {
  const headers = new Headers(response.headers)
  if (!headers.has('Access-Control-Allow-Origin')) headers.set('Access-Control-Allow-Origin', '*')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

/** The smoke runner drives the app through the store handle main.tsx publishes for `?smoke=1`. */
function entryFile(page: 'index' | 'mini'): { file: string; query?: Record<string, string> } {
  const file = join(__dirname, `../renderer/${page}.html`)
  return process.env.EQUIP_SMOKE === '1' ? { file, query: { smoke: '1' } } : { file }
}

function rendererEntry(page: 'index' | 'mini'): {
  url?: string
  file?: string
  query?: Record<string, string>
} {
  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    return {
      url:
        page === 'index'
          ? process.env.ELECTRON_RENDERER_URL
          : `${process.env.ELECTRON_RENDERER_URL}/mini.html`
    }
  }
  return entryFile(page)
}

function watchForFailures(window: BrowserWindow, label: string): void {
  window.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error(`[${label}] failed to load ${url} (${code}) ${description}`)
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[${label}] renderer gone: ${details.reason} (exit ${details.exitCode})`)
  })
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[${label}] preload error in ${preloadPath}: ${error.message}`)
  })
  window.webContents.on('unresponsive', () => console.warn(`[${label}] renderer is unresponsive`))
}

function createWindow(): void {
  const entry = rendererEntry('index')
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 520,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    title: 'Equip',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      backgroundThrottling: false
    }
  })

  watchForFailures(mainWindow, 'main')
  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => {
    mainWindow = null
    miniWindow?.close()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (entry.url) void mainWindow.loadURL(entry.url)
  else if (entry.file) void mainWindow.loadFile(entry.file, entry.query ? { query: entry.query } : undefined)
}

function createMiniWindow(): void {
  if (miniWindow) {
    if (miniWindow.isMinimized()) miniWindow.restore()
    miniWindow.focus()
    return
  }
  const entry = rendererEntry('mini')
  miniWindow = new BrowserWindow({
    width: 320,
    height: 132,
    resizable: false,
    show: false,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    roundedCorners: true,
    title: 'Equip — Now Playing',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  watchForFailures(miniWindow, 'mini')
  miniWindow.on('ready-to-show', () => {
    // Replay the last known state so a window opened mid-track is not blank.
    if (lastPlaybackState) miniWindow?.webContents.send('playback:state', lastPlaybackState)
    miniWindow?.show()
  })
  miniWindow.on('closed', () => {
    miniWindow = null
    mainWindow?.webContents.send('mini:visibility', false)
  })

  if (entry.url) void miniWindow.loadURL(entry.url)
  else if (entry.file) void miniWindow.loadFile(entry.file, entry.query ? { query: entry.query } : undefined)
}

function showMainWindow(): void {
  if (!mainWindow) {
    createWindow()
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function sendCommand(command: string): void {
  mainWindow?.webContents.send('playback:command', command)
}

function buildTrayMenu(playing: boolean): Menu {
  return Menu.buildFromTemplate([
    { label: playing ? 'Pause' : 'Play', click: () => sendCommand('togglePlay') },
    { label: 'Next', click: () => sendCommand('next') },
    { label: 'Previous', click: () => sendCommand('previous') },
    { type: 'separator' },
    { label: 'Show Equip', click: showMainWindow },
    {
      label: 'Now playing window',
      type: 'checkbox',
      checked: miniWindow !== null,
      click: (item) => (item.checked ? createMiniWindow() : miniWindow?.close())
    },
    { type: 'separator' },
    { label: 'Quit Equip', click: () => app.quit() }
  ])
}

function createTray(): void {
  const iconPath = is.dev
    ? join(__dirname, '../../resources/tray.png')
    : join(process.resourcesPath, 'resources/tray.png')
  if (!existsSync(iconPath)) {
    console.warn('[tray] resources/tray.png is missing — the tray icon is disabled')
    return
  }
  try {
    tray = new Tray(iconPath)
  } catch (error) {
    console.warn('[tray] could not create the tray icon:', (error as Error).message)
    return
  }
  tray.setToolTip('Equip')
  tray.setContextMenu(buildTrayMenu(false))
  tray.on('double-click', showMainWindow)

  ipcMain.on('tray:update', (_event, playing: boolean) => {
    tray?.setContextMenu(buildTrayMenu(playing))
  })
}

function registerMediaKeys(): void {
  const bindings: Array<[string, string]> = [
    ['MediaPlayPause', 'togglePlay'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'previous'],
    ['MediaStop', 'stop']
  ]
  for (const [accelerator, command] of bindings) {
    if (!globalShortcut.register(accelerator, () => sendCommand(command))) {
      console.warn(`[media-keys] ${accelerator} is already claimed by another application`)
    }
  }
}

function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const filePath = decodeMediaUrl(request.url)
      const response = await net.fetch(pathToFileURL(filePath).toString(), {
        headers: request.headers,
        bypassCustomProtocolHandlers: true
      })
      return corsify(response)
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

/**
 * The streaming/artwork side of SoundCloud. Handles
 *   equip-sc://stream/<scId>    → signed MP3 stream (proxied, ranges passed through)
 *   equip-sc://artwork/<scId>   → artwork image (SoundCloud is not allowed by CSP)
 */
function registerSoundCloudProtocol(): void {
  protocol.handle(SC_SCHEME, async (request) => {
    const [kind, idText] = request.url.slice(`${SC_SCHEME}://`.length).split('/')
    const scId = Number(idText)
    if (!Number.isFinite(scId)) return new Response('Not found', { status: 404 })
    try {
      if (kind === 'stream') {
        const signed = await resolveStreamUrl(scId)
        return corsify(
          await net.fetch(signed, { headers: request.headers, bypassCustomProtocolHandlers: true })
        )
      }
      if (kind === 'artwork') {
        const artworkUrl = await resolveArtworkUrl(scId)
        if (!artworkUrl) return new Response('Not found', { status: 404 })
        return corsify(await net.fetch(artworkUrl, { bypassCustomProtocolHandlers: true }))
      }
      return new Response('Not found', { status: 404 })
    } catch (error) {
      console.error('[soundcloud] proxy failed for', request.url, error)
      return new Response('Stream unavailable', { status: 502 })
    }
  })
}

function registerIpc(): void {
  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) mainWindow.unmaximize()
    else mainWindow?.maximize()
  })
  ipcMain.on('window:close', () => app.quit())

  ipcMain.handle('library:get', () => loadLibrary())
  ipcMain.handle('library:addFolder', async (): Promise<LibraryTrack[] | null> => {
    const picked = await pickFolders()
    if (picked.length === 0) return null
    return addPaths(picked)
  })
  ipcMain.handle('library:addPaths', (_event, paths: string[]) => addPaths(paths))
  ipcMain.handle('library:rescan', () => rescanLibrary())
  ipcMain.handle('library:clear', () => clearLibrary())

  ipcMain.handle('playlists:get', () => loadPlaylists())
  ipcMain.handle('playlists:save', async (_event, playlists: Playlist[]) => {
    await savePlaylists(playlists)
    return playlists
  })

  ipcMain.on('mini:open', () => createMiniWindow())
  ipcMain.on('mini:close', () => miniWindow?.close())
  ipcMain.handle('mini:isOpen', () => miniWindow !== null)
  ipcMain.on('playback:command', (event, command) => {
    // The pop-out window has no player of its own; it relays to the main window.
    if (mainWindow && event.sender.id !== mainWindow.webContents.id) {
      mainWindow.webContents.send('playback:command', command)
    }
  })
  ipcMain.on('playback:update', (_event, payload) => {
    lastPlaybackState = payload
    miniWindow?.webContents.send('playback:state', payload)
  })
  // The pop-out asks for the latest state once it is mounted, so the initial
  // frame is never blank — even when the window opened before any track change
  // or before its own listener was registered.
  ipcMain.handle('playback:getState', () => lastPlaybackState)

  ipcMain.handle('sc:search', (_event, query: string, limit?: number) => searchTracks(query, limit))
  ipcMain.handle('sc:trending', (_event, limit?: number) => trending(limit))
  ipcMain.handle('sc:resolve', (_event, url: string) => resolveUrl(url))
  // Persists stream-only SoundCloud tracks into the library so play, queue and
  // playlists can resolve them like any other track.
  ipcMain.handle('sc:add', async (_event, tracks: RemoteTrack[]) => upsertTracks(tracks.map(remoteToLibraryTrack)))
  ipcMain.handle('sc:download', async (event, scId: number) => {
    const onProgress = (progress: DownloadProgress): void => event.sender.send('sc:progress', progress)
    return downloadTrack(scId, onProgress)
  })
  ipcMain.handle('sc:settings/get', () => getSettings())
  ipcMain.handle('sc:settings/set', (_event, patch: Record<string, string>) => setSettings(patch))
  ipcMain.handle('sc:settings/pickFolder', () => pickOfflineFolder())
  ipcMain.handle('sc:settings/openFolder', (_event, folderPath: string) => shell.openPath(String(folderPath)))
  ipcMain.handle('sc:test', () => testConnection())
  ipcMain.on('shell:open', (_event, url: string) => {
    if (typeof url === 'string' && url.startsWith('https://')) void shell.openExternal(url)
  })
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.bgsstudios.equip')
  registerMediaProtocol()
  registerSoundCloudProtocol()
  registerIpc()
  createWindow()
  createTray()
  registerMediaKeys()
  runSmokeTest(
    () => mainWindow ?? createAndGetWindow(),
    createMiniWindow,
    () => miniWindow
  )

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

function createAndGetWindow(): BrowserWindow {
  createWindow()
  return mainWindow as BrowserWindow
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  tray?.destroy()
})

app.on('window-all-closed', () => {
  app.quit()
})
