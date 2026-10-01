import { create } from 'zustand'
import { WebAudioBackend } from '../audio/WebAudioBackend'
import type { AudioBackend, PlaybackSnapshot } from '../audio/types'
import type { LibraryTrack } from '../types/library'

export type RepeatMode = 'off' | 'all' | 'one'
export type SortKey = 'artist' | 'title' | 'album' | 'added'

export interface Playlist {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
}

interface PlayerState {
  backend: AudioBackend
  library: LibraryTrack[]
  playlists: Playlist[]
  queue: string[]
  currentIndex: number
  snapshot: PlaybackSnapshot
  crossfadeSeconds: number
  shuffle: boolean
  repeat: RepeatMode
  scanning: boolean
  error: string | null
  loadLibrary: () => Promise<void>
  loadPlaylists: () => Promise<void>
  addFolder: () => Promise<void>
  addPaths: (paths: string[]) => Promise<LibraryTrack[]>
  rescan: () => Promise<void>
  clearLibrary: () => Promise<void>
  createPlaylist: (name: string, trackId?: string) => Promise<string>
  renamePlaylist: (id: string, name: string) => Promise<void>
  deletePlaylist: (id: string) => Promise<void>
  addToPlaylist: (playlistId: string, trackId: string) => Promise<void>
  removeFromPlaylist: (playlistId: string, trackId: string) => Promise<void>
  playTrack: (trackId: string, contextIds?: string[]) => Promise<void>
  playAt: (index: number) => Promise<void>
  togglePlay: () => Promise<void>
  next: () => Promise<void>
  previous: () => Promise<void>
  seek: (seconds: number) => void
  setVolume: (volume: number) => void
  stop: () => void
  toggleMute: () => void
  setCrossfade: (seconds: number) => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  currentTrack: () => LibraryTrack | null
}

const backend = new WebAudioBackend()

function trackById(library: LibraryTrack[], id: string | null): LibraryTrack | null {
  if (!id) return null
  return library.find((track) => track.id === id) ?? null
}

export const usePlayerStore = create<PlayerState>((set, get) => {
  backend.subscribe((snapshot) => {
    set({ snapshot })
    if (snapshot.state === 'ended') void get().next()
  })

  const primeNext = (): void => {
    const { queue, currentIndex, repeat, library } = get()
    if (queue.length === 0) return
    let nextIndex = currentIndex + 1
    if (nextIndex >= queue.length) nextIndex = repeat === 'all' ? 0 : -1
    if (repeat === 'one') nextIndex = currentIndex
    const nextTrack = nextIndex >= 0 ? trackById(library, queue[nextIndex]) : null
    void backend.queue(
      nextTrack ? { id: nextTrack.id, source: nextTrack.url, duration: nextTrack.durationSeconds } : null
    )
  }

  const startIndex = async (index: number): Promise<void> => {
    const { queue, library } = get()
    const track = trackById(library, queue[index])
    if (!track) return
    set({ currentIndex: index, error: null })
    try {
      await backend.load({ id: track.id, source: track.url, duration: track.durationSeconds })
      await backend.play()
      primeNext()
    } catch (error) {
      set({ error: `Could not play “${track.title}”. The file may be missing or unsupported.` })
      console.error('[player]', error)
    }
  }

  return {
    backend,
    library: [],
    playlists: [],
    queue: [],
    currentIndex: -1,
    snapshot: {
      state: 'idle',
      position: 0,
      duration: 0,
      volume: 1,
      muted: false,
      trackId: null
    },
    crossfadeSeconds: 0,
    shuffle: false,
    repeat: 'off',
    scanning: false,
    error: null,

    loadLibrary: async () => {
      set({ library: await window.equip.library.get() })
    },

    loadPlaylists: async () => {
      set({ playlists: await window.equip.playlists.get() })
    },

    addFolder: async () => {
      set({ scanning: true, error: null })
      try {
        const library = await window.equip.library.addFolder()
        if (library) set({ library })
      } finally {
        set({ scanning: false })
      }
    },

    addPaths: async (paths) => {
      set({ scanning: true, error: null })
      try {
        const library = await window.equip.library.addPaths(paths)
        set({ library })
        return library
      } catch (error) {
        set({ error: 'Could not read the files you dropped.' })
        console.error('[library]', error)
        return get().library
      } finally {
        set({ scanning: false })
      }
    },

    rescan: async () => {
      set({ scanning: true, error: null })
      try {
        set({ library: await window.equip.library.rescan() })
      } finally {
        set({ scanning: false })
      }
    },

    clearLibrary: async () => {
      set({ scanning: true })
      try {
        const library = await window.equip.library.clear()
        set({ library, queue: [], currentIndex: -1 })
        backend.stop()
      } finally {
        set({ scanning: false })
      }
    },

    createPlaylist: async (name, trackId) => {
      const playlist: Playlist = {
        id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`,
        name: name.trim() || 'New Playlist',
        trackIds: trackId ? [trackId] : [],
        createdAt: Date.now()
      }
      const playlists = [...get().playlists, playlist]
      set({ playlists })
      await window.equip.playlists.save(playlists)
      return playlist.id
    },

    renamePlaylist: async (id, name) => {
      const playlists = get().playlists.map((playlist) =>
        playlist.id === id ? { ...playlist, name: name.trim() || playlist.name } : playlist
      )
      set({ playlists })
      await window.equip.playlists.save(playlists)
    },

    deletePlaylist: async (id) => {
      const playlists = get().playlists.filter((playlist) => playlist.id !== id)
      set({ playlists })
      await window.equip.playlists.save(playlists)
    },

    addToPlaylist: async (playlistId, trackId) => {
      const playlists = get().playlists.map((playlist) =>
        playlist.id === playlistId && !playlist.trackIds.includes(trackId)
          ? { ...playlist, trackIds: [...playlist.trackIds, trackId] }
          : playlist
      )
      set({ playlists })
      await window.equip.playlists.save(playlists)
    },

    removeFromPlaylist: async (playlistId, trackId) => {
      const playlists = get().playlists.map((playlist) =>
        playlist.id === playlistId
          ? { ...playlist, trackIds: playlist.trackIds.filter((id) => id !== trackId) }
          : playlist
      )
      set({ playlists })
      await window.equip.playlists.save(playlists)
    },

    playTrack: async (trackId, contextIds) => {
      const { library, shuffle } = get()
      let ids = contextIds ?? library.map((track) => track.id)
      if (shuffle) {
        const rest = ids.filter((id) => id !== trackId)
        for (let i = rest.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1))
          ;[rest[i], rest[j]] = [rest[j], rest[i]]
        }
        ids = [trackId, ...rest]
      }
      const index = ids.indexOf(trackId)
      set({ queue: ids })
      await startIndex(index === -1 ? 0 : index)
    },

    playAt: async (index) => {
      const { queue } = get()
      if (index < 0 || index >= queue.length) return
      await startIndex(index)
    },

    togglePlay: async () => {
      const { snapshot, queue, library } = get()
      if (snapshot.state === 'playing') {
        backend.pause()
      } else if (snapshot.trackId) {
        await backend.play()
      } else if (queue.length > 0 || library.length > 0) {
        const ids = queue.length > 0 ? queue : library.map((track) => track.id)
        if (queue.length === 0) set({ queue: ids })
        await startIndex(0)
      }
    },

    next: async () => {
      const { currentIndex, queue, repeat } = get()
      if (queue.length === 0) return
      let nextIndex = currentIndex + 1
      if (nextIndex >= queue.length) {
        if (repeat === 'off') {
          backend.stop()
          return
        }
        nextIndex = 0
      }
      await startIndex(repeat === 'one' ? currentIndex : nextIndex)
    },

    previous: async () => {
      const { currentIndex, snapshot } = get()
      if (snapshot.position > 3) {
        backend.seek(0)
        return
      }
      await startIndex(Math.max(0, currentIndex - 1))
    },

    seek: (seconds) => backend.seek(seconds),

    stop: () => {
      backend.stop()
      set({ queue: [], currentIndex: -1 })
    },

    setVolume: (volume) => backend.setVolume(volume),

    toggleMute: () => backend.setMuted(!get().snapshot.muted),

    setCrossfade: (seconds) => {
      const clamped = Math.max(0, Math.min(15, seconds))
      backend.setCrossfade(clamped)
      set({ crossfadeSeconds: clamped })
      primeNext()
    },

    toggleShuffle: () => set((state) => ({ shuffle: !state.shuffle })),

    cycleRepeat: () =>
      set((state) => ({
        repeat: state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off'
      })),

    currentTrack: () => trackById(get().library, get().snapshot.trackId)
  }
})

export function sortTracks(tracks: LibraryTrack[], key: SortKey): LibraryTrack[] {
  const collate = (a: LibraryTrack, b: LibraryTrack): number =>
    a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  switch (key) {
    case 'title':
      return [...tracks].sort(collate)
    case 'album':
      return [...tracks].sort(
        (a, b) =>
          a.album.localeCompare(b.album, undefined, { sensitivity: 'base' }) || collate(a, b)
      )
    case 'added':
      return [...tracks].sort((a, b) => b.addedAt - a.addedAt)
    case 'artist':
    default:
      return [...tracks].sort(
        (a, b) =>
          a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }) ||
          a.album.localeCompare(b.album, undefined, { sensitivity: 'base' }) ||
          collate(a, b)
      )
  }
}
