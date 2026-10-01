import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'

export interface LibraryTrack {
  id: string
  path: string
  url: string
  title: string
  artist: string
  album: string
  durationSeconds: number
  artworkDataUrl: string | null
  addedAt: number
  /** Present on tracks that came from a streaming provider rather than a local file. */
  remote?: {
    provider: 'soundcloud'
    scId: number
    permalinkUrl?: string
    artworkUrl?: string
  }
}

export interface Playlist {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
}

export interface MiniPlaybackState {
  title: string
  artist: string
  artworkDataUrl: string | null
  playing: boolean
}

export type PlaybackCommand = 'togglePlay' | 'next' | 'previous' | 'stop'

export interface RemoteTrack {
  scId: number
  title: string
  artist: string
  album: string
  durationSeconds: number
  artworkUrl: string | null
  permalinkUrl: string | null
  streamable: boolean
}

export interface ScSet {
  id: number
  title: string
  creator: string
  tracks: RemoteTrack[]
}

export type ScResolveResult =
  | { kind: 'track'; track: RemoteTrack }
  | { kind: 'set'; set: ScSet }

export interface ScSettings {
  clientId: string
  offlineDir: string
}

export interface DownloadProgress {
  scId: number
  received: number
  total: number
  phase: 'connecting' | 'downloading' | 'done'
}

export interface DownloadResult {
  library: LibraryTrack[]
  filePath: string
  title: string
  artist: string
}

const equip = {
  minimize: (): void => ipcRenderer.send('window:minimize'),
  maximize: (): void => ipcRenderer.send('window:maximize'),
  close: (): void => ipcRenderer.send('window:close'),
  library: {
    get: (): Promise<LibraryTrack[]> => ipcRenderer.invoke('library:get'),
    addFolder: (): Promise<LibraryTrack[] | null> => ipcRenderer.invoke('library:addFolder'),
    addPaths: (paths: string[]): Promise<LibraryTrack[]> => ipcRenderer.invoke('library:addPaths', paths),
    rescan: (): Promise<LibraryTrack[]> => ipcRenderer.invoke('library:rescan'),
    clear: (): Promise<LibraryTrack[]> => ipcRenderer.invoke('library:clear')
  },
  playlists: {
    get: (): Promise<Playlist[]> => ipcRenderer.invoke('playlists:get'),
    save: (playlists: Playlist[]): Promise<Playlist[]> => ipcRenderer.invoke('playlists:save', playlists)
  },
  media: {
    /** Base URL of the loopback media server, e.g. http://127.0.0.1:52903. */
    base: (): Promise<string> => ipcRenderer.invoke('media:base'),
    /** Maps a logical equip-media:/equip-sc: URL to the loopback HTTP URL. */
    httpUrl: (url: string): Promise<string> => ipcRenderer.invoke('media:httpUrl', url)
  },
  mini: {
    open: (): void => ipcRenderer.send('mini:open'),
    close: (): void => ipcRenderer.send('mini:close'),
    isOpen: (): Promise<boolean> => ipcRenderer.invoke('mini:isOpen'),
    sendPlayback: (state: MiniPlaybackState): void => ipcRenderer.send('playback:update', state),
    /** Latest known now-playing state; null when nothing has played yet. */
    getState: (): Promise<MiniPlaybackState | null> => ipcRenderer.invoke('playback:getState'),
    onPlayback: (callback: (state: MiniPlaybackState) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, state: MiniPlaybackState): void => callback(state)
      ipcRenderer.on('playback:state', handler)
      return () => ipcRenderer.removeListener('playback:state', handler)
    },
    sendCommand: (command: PlaybackCommand): void => ipcRenderer.send('playback:command', command),
    onCommand: (callback: (command: PlaybackCommand) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, command: PlaybackCommand): void => callback(command)
      ipcRenderer.on('playback:command', handler)
      return () => ipcRenderer.removeListener('playback:command', handler)
    },
    onVisibility: (callback: (open: boolean) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, open: boolean): void => callback(open)
      ipcRenderer.on('mini:visibility', handler)
      return () => ipcRenderer.removeListener('mini:visibility', handler)
    }
  },
  soundcloud: {
    search: (query: string, limit?: number): Promise<RemoteTrack[]> =>
      ipcRenderer.invoke('sc:search', query, limit),
    trending: (limit?: number): Promise<RemoteTrack[]> => ipcRenderer.invoke('sc:trending', limit),
    resolve: (url: string): Promise<ScResolveResult | null> => ipcRenderer.invoke('sc:resolve', url),
    /** Persists stream-only tracks into the library; resolves to the full library. */
    add: (tracks: RemoteTrack[]): Promise<LibraryTrack[]> => ipcRenderer.invoke('sc:add', tracks),
    download: (scId: number): Promise<DownloadResult> => ipcRenderer.invoke('sc:download', scId),
    settingsGet: (): Promise<ScSettings> => ipcRenderer.invoke('sc:settings/get'),
    settingsSet: (patch: Partial<ScSettings>): Promise<ScSettings> =>
      ipcRenderer.invoke('sc:settings/set', patch),
    pickOfflineFolder: (): Promise<string> => ipcRenderer.invoke('sc:settings/pickFolder'),
    openFolder: (folderPath: string): Promise<void> => ipcRenderer.invoke('sc:settings/openFolder', folderPath),
    test: (): Promise<{ ok: boolean; detail: string }> => ipcRenderer.invoke('sc:test'),
    onProgress: (callback: (progress: DownloadProgress) => void): (() => void) => {
      const handler = (_event: IpcRendererEvent, progress: DownloadProgress): void => callback(progress)
      ipcRenderer.on('sc:progress', handler)
      return () => ipcRenderer.removeListener('sc:progress', handler)
    }
  },
  shell: {
    open: (url: string): void => ipcRenderer.send('shell:open', url)
  },
  trayUpdate: (playing: boolean): void => ipcRenderer.send('tray:update', playing),
  /** Resolves the real filesystem path of a dropped File/Item. Empty if unavailable. */
  pathForFile: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  }
}

export type EquipApi = typeof equip

contextBridge.exposeInMainWorld('equip', equip)