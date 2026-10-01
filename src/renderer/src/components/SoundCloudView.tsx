import { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from '../state/playerStore'
import { useSoundCloudStore } from '../state/soundcloudStore'
import { formatTime } from '../util/format'
import { AddToPlaylistMenu } from './AddToPlaylistMenu'
import { Icon, icons } from './Icon'
import type { RemoteTrack } from '../../../preload'
import type { LibraryTrack } from '../types/library'

const QUICK_SEARCHES = ['lofi', 'synthwave', 'downtempo', 'house', 'jazz', 'ambient']

const scIdOf = (track: RemoteTrack): string => `sc${track.scId}`

/** Renders SoundCloud artwork through the loopback media server. */
function ScThumb({ scId }: { scId: number }): React.JSX.Element {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void window.equip.media.httpUrl(`equip-sc://artwork/${scId}`).then((url) => {
      if (alive) setSrc(url)
    })
    return () => {
      alive = false
    }
  }, [scId])
  return src ? <img src={src} alt="" /> : <span className="mini-art" />
}

export function SoundCloudView(): React.JSX.Element {
  const section = useSoundCloudStore((state) => state.section)
  const headline = useSoundCloudStore((state) => state.headline)
  const tracks = useSoundCloudStore((state) => state.tracks)
  const loading = useSoundCloudStore((state) => state.loading)
  const error = useSoundCloudStore((state) => state.error)
  const downloads = useSoundCloudStore((state) => state.downloads)
  const { loadTrending, loadSearch, loadLink, updateDownload, clearDownload, clearError } = useSoundCloudStore()
  const library = usePlayerStore((state) => state.library)
  const playTrack = usePlayerStore((state) => state.playTrack)

  const [queryInput, setQueryInput] = useState('')
  const [linkInput, setLinkInput] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)
  const noticeTimer = useRef<number | null>(null)

  useEffect(() => {
    void loadTrending()
  }, [loadTrending])

  useEffect(() => {
    const unsubscribe = window.equip.soundcloud.onProgress((progress) => updateDownload(progress))
    return () => {
      unsubscribe()
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
      if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    }
  }, [updateDownload])

  const showNotice = (message: string): void => {
    setNotice(message)
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 5200)
  }

  const onQueryChange = (value: string): void => {
    setQueryInput(value)
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => void loadSearch(value), 450)
  }

  /** Makes sure the given SoundCloud tracks exist in the library, then plays. */
  const ensureInLibrary = async (remoteTracks: RemoteTrack[]): Promise<LibraryTrack[]> => {
    const library = await window.equip.soundcloud.add(remoteTracks)
    usePlayerStore.setState({ library })
    return library
  }

  const playRemote = async (track: RemoteTrack): Promise<void> => {
    const ids = tracks.map(scIdOf)
    await ensureInLibrary(tracks.filter((item) => item.streamable))
    await playTrack(scIdOf(track), ids)
  }

  const downloadRemote = async (track: RemoteTrack): Promise<void> => {
    try {
      const result = await window.equip.soundcloud.download(track.scId)
      usePlayerStore.setState({ library: result.library })
      showNotice(`Saved “${result.title}” — ${result.artist} (128 kbps MP3, offline)`)
    } catch (cause) {
      clearDownload(track.scId)
      showNotice(`Download failed: ${(cause as Error).message}`)
    }
  }

  const openInBrowser = (track: RemoteTrack): void => {
    if (track.permalinkUrl) window.equip.shell.open(track.permalinkUrl)
  }

  const isSavedLocally = (track: RemoteTrack): boolean => {
    const row = library.find((item) => item.id === scIdOf(track))
    return Boolean(row && row.path)
  }

  return (
    <section className="library soundcloud">
      <div className="section-heading">
        <div>
          <p className="eyebrow">SOUNDCLOUD · STREAMING</p>
          <h1>SoundCloud</h1>
        </div>
        <div className="library-tools">
          <input
            className="search sc-search"
            placeholder="Search SoundCloud (title, artist)"
            value={queryInput}
            onChange={(event) => onQueryChange(event.target.value)}
            aria-label="Search SoundCloud"
          />
          <input
            className="search sc-link"
            placeholder="Paste a soundcloud.com track / set link"
            value={linkInput}
            onChange={(event) => setLinkInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && linkInput.trim()) {
                void loadLink(linkInput.trim())
                setLinkInput('')
              }
            }}
            aria-label="Resolve a SoundCloud link"
          />
          <button
            className="round-button"
            aria-label="Reload trending"
            title="Reload trending"
            disabled={loading}
            onClick={() => void loadTrending()}
          >
            <Icon path={icons.refresh} size={18} />
          </button>
        </div>
      </div>

      {section !== 'search' && (
        <div className="sc-chips">
          {QUICK_SEARCHES.map((term) => (
            <button key={term} className="chip" onClick={() => void loadSearch(term)}>
              {term}
            </button>
          ))}
        </div>
      )}

      <div className="sc-headline">
        <p className="eyebrow">{section.toUpperCase()} · ONLINE</p>
        <span>{headline}</span>
      </div>

      {error && (
        <div className="sc-error">
          {error}
          <button aria-label="Dismiss" onClick={clearError}>
            <Icon path="M6 6l12 12M18 6L6 18" size={14} />
          </button>
        </div>
      )}

      {loading && <div className="sc-loading">Finding tracks on SoundCloud…</div>}

      {!loading && tracks.length === 0 && !error && (
        <div className="empty-library">
          <h2>No results</h2>
          <p>Try another search, or let the trending chart fill this page.</p>
        </div>
      )}

      {tracks.length > 0 && (
        <div className="sc-list">
          {tracks.map((track, index) => {
            const active = usePlayerStore.getState().currentTrack()?.id === scIdOf(track)
            const download = downloads[String(track.scId)]
            const saved = isSavedLocally(track)
            const progress = download && download.total > 0 ? download.received / download.total : 0
            return (
              <div className={`sc-row ${active ? 'active' : ''}`} key={track.scId}>
                <span className="index">
                  <button
                    className="play-cell"
                    aria-label={`Play ${track.title}`}
                    onClick={() => void playRemote(track)}
                  >
                    <Icon path={icons.play} size={14} fill />
                  </button>
                  <em>{index + 1}</em>
                </span>
                <div className="title-cell">
                  {track.artworkUrl ? <ScThumb scId={track.scId} /> : <span className="mini-art" />}
                  <span className="title-text">
                    <strong>{track.title}</strong>
                    <em>{track.artist}</em>
                  </span>
                </div>
                <span className="sc-quality">
                  <span className="pill">128k MP3</span>
                  <em>{formatTime(track.durationSeconds)}</em>
                </span>
                <span className="row-actions">
                  {download ? (
                    <div className="sc-download" role="progressbar" aria-label="Downloading">
                      <i style={{ width: `${Math.max(2, progress * 100)}%` }} />
                      <span>{Math.round(progress * 100)}%</span>
                    </div>
                  ) : saved ? (
                    <span className="pill saved">SAVED OFFLINE</span>
                  ) : (
                    <button
                      className="play-cell"
                      aria-label={`Download ${track.title}`}
                      title="Download for offline playback"
                      onClick={() => void downloadRemote(track)}
                    >
                      <Icon path={icons.download} size={15} />
                    </button>
                  )}
                  <AddToPlaylistMenu
                    trackId={scIdOf(track)}
                    ensure={() => ensureInLibrary([track])}
                  />
                  <button
                    className="play-cell"
                    aria-label={`Open on SoundCloud`}
                    title="Open on soundcloud.com"
                    onClick={() => openInBrowser(track)}
                  >
                    <Icon path={icons.popout} size={14} />
                  </button>
                  <em className="dur">{formatTime(track.durationSeconds)}</em>
                </span>
              </div>
            )
          })}
        </div>
      )}

      {notice && (
        <div className="toast success" role="status">
          {notice}
          <button aria-label="Dismiss" onClick={() => setNotice(null)}>
            <Icon path="M6 6l12 12M18 6L6 18" size={14} />
          </button>
        </div>
      )}
    </section>
  )
}