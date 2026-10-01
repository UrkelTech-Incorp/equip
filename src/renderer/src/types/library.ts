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
