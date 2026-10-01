import { create } from 'zustand'
import type { DownloadProgress, RemoteTrack, ScSet } from '../../../preload'

export type ScSection = 'trending' | 'search' | 'set'

interface SoundCloudState {
  /** 'trending' | 'search' | 'set' — what the result list is showing. */
  section: ScSection
  /** Subtitle shown under the SoundCloud heading. */
  headline: string
  query: string
  tracks: RemoteTrack[]
  loading: boolean
  error: string | null
  /** Live download state per SoundCloud track id. */
  downloads: Record<string, DownloadProgress>
  loadTrending: () => Promise<void>
  loadSearch: (query: string) => Promise<void>
  loadLink: (url: string) => Promise<void>
  showSet: (set: ScSet) => void
  updateDownload: (progress: DownloadProgress) => void
  clearDownload: (scId: number) => void
  clearError: () => void
}

let requestSeq = 0

export const useSoundCloudStore = create<SoundCloudState>((set, get) => ({
  section: 'trending',
  headline: '',
  query: '',
  tracks: [],
  loading: false,
  error: null,
  downloads: {},

  clearError: () => set({ error: null }),

  loadTrending: async () => {
    const seq = ++requestSeq
    set({ loading: true, error: null, section: 'trending', headline: 'What people are listening to right now' })
    try {
      const tracks = await window.equip.soundcloud.trending(40)
      if (seq === requestSeq) set({ tracks, loading: false })
    } catch (error) {
      if (seq === requestSeq) set({ error: (error as Error).message, loading: false })
    }
  },

  loadSearch: async (query) => {
    const trimmed = query.trim()
    if (!trimmed) return get().loadTrending()
    const seq = ++requestSeq
    set({ loading: true, error: null, section: 'search', query: trimmed, headline: `Results for “${trimmed}”` })
    try {
      const tracks = await window.equip.soundcloud.search(trimmed, 40)
      if (seq === requestSeq) set({ tracks, loading: false })
    } catch (error) {
      if (seq === requestSeq) set({ error: (error as Error).message, loading: false })
    }
  },

  loadLink: async (url) => {
    const seq = ++requestSeq
    set({ loading: true, error: null, headline: 'Resolving link…' })
    try {
      const result = await window.equip.soundcloud.resolve(url)
      if (seq !== requestSeq) return
      if (!result) {
        set({ error: 'That does not look like a SoundCloud track or set link.', loading: false })
        return
      }
      if (result.kind === 'track') {
        set({
          section: 'search',
          query: result.track.title,
          tracks: [result.track],
          headline: `Resolved: ${result.track.title} — ${result.track.artist}`,
          loading: false
        })
      } else {
        set({
          section: 'set',
          tracks: result.set.tracks,
          headline: `${result.set.creator} · ${result.set.title} (${result.set.tracks.length} tracks)`,
          loading: false
        })
      }
    } catch (error) {
      if (seq === requestSeq) set({ error: (error as Error).message, loading: false })
    }
  },

  showSet: (value) => {
    requestSeq += 1
    set({
      section: 'set',
      tracks: value.tracks,
      headline: `${value.creator} · ${value.title} (${value.tracks.length} tracks)`,
      loading: false
    })
  },

  updateDownload: (progress) => {
    const downloads = { ...get().downloads }
    if (progress.phase === 'done') delete downloads[String(progress.scId)]
    else downloads[String(progress.scId)] = progress
    set({ downloads })
  },

  clearDownload: (scId) => {
    const downloads = { ...get().downloads }
    delete downloads[String(scId)]
    set({ downloads })
  }
}))