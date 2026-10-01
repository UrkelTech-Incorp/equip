import { useMemo } from 'react'
import { usePlayerStore } from '../state/playerStore'
import { formatTime } from '../util/format'
import { Icon, icons } from './Icon'
import type { LibraryTrack } from '../types/library'

interface Shelf {
  id: string
  title: string
  hint: string
  tracks: LibraryTrack[]
}

function coverFor(tracks: LibraryTrack[]): string | null {
  return tracks.map((track) => track.artworkDataUrl).find((art) => Boolean(art)) ?? null
}

/**
 * Discovery built entirely from the local library — no network, no placeholder
 * rows. Each shelf plays as a single context so the queue follows what you see.
 */
export function DiscoverView(): React.JSX.Element {
  const library = usePlayerStore((state) => state.library)
  const playTrack = usePlayerStore((state) => state.playTrack)
  const toggleShuffle = usePlayerStore((state) => state.toggleShuffle)
  const shuffle = usePlayerStore((state) => state.shuffle)

  const shelves = useMemo<Shelf[]>(() => {
    if (library.length === 0) return []

    const recent = [...library].sort((a, b) => b.addedAt - a.addedAt).slice(0, 12)

    const byArtist = new Map<string, LibraryTrack[]>()
    for (const track of library) {
      const bucket = byArtist.get(track.artist) ?? []
      bucket.push(track)
      byArtist.set(track.artist, bucket)
    }
    const topArtists = [...byArtist.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 8)
      .map(([, tracks]) => tracks)

    const longest = [...library].sort((a, b) => b.durationSeconds - a.durationSeconds).slice(0, 12)

    const build: Shelf[] = [{ id: 'recent', title: 'Recently added', hint: 'Newest files in your library', tracks: recent }]

    build.push(
      ...topArtists.map((tracks) => ({
        id: `artist-${tracks[0].artist}`,
        title: tracks[0].artist,
        hint: `${tracks.length} track${tracks.length === 1 ? '' : 's'}`,
        tracks
      }))
    )

    if (longest.some((track) => track.durationSeconds >= 480)) {
      build.push({ id: 'long', title: 'Long cuts', hint: 'Over eight minutes', tracks: longest.filter((t) => t.durationSeconds >= 480).slice(0, 12) })
    }

    return build
  }, [library])

  if (library.length === 0) {
    return (
      <section className="library">
        <div className="empty-library">
          <h2>Nothing to discover yet</h2>
          <p>Add a music folder and this page fills up with mixes from your own library.</p>
        </div>
      </section>
    )
  }

  const playShelf = (shelf: Shelf): void => {
    const first = shelf.tracks[0]
    if (first) void playTrack(first.id, shelf.tracks.map((track) => track.id))
  }

  return (
    <section className="library discover">
      <div className="section-heading">
        <div>
          <p className="eyebrow">FROM YOUR LIBRARY</p>
          <h1>Discover</h1>
        </div>
        <div className="library-tools">
          <button
            className="primary-button"
            onClick={() => {
              if (!shuffle) toggleShuffle()
              playShelf(shelves[0])
            }}
          >
            Play recently added
          </button>
          <button
            className="round-button"
            aria-label={shuffle ? 'Disable shuffle' : 'Shuffle the whole library'}
            title={shuffle ? 'Shuffle on' : 'Shuffle off'}
            onClick={toggleShuffle}
          >
            <Icon path={icons.shuffle} size={17} />
          </button>
        </div>
      </div>

      <div className="shelves">
        {shelves.map((shelf) => {
          const cover = coverFor(shelf.tracks)
          return (
            <div className="shelf" key={shelf.id}>
              <header>
                <div>
                  <h2>{shelf.title}</h2>
                  <p>{shelf.hint}</p>
                </div>
                <button className="link-button" onClick={() => playShelf(shelf)}>
                  Play
                </button>
              </header>
              <div className="shelf-grid">
                {shelf.tracks.slice(0, 8).map((track) => (
                  <button
                    className="tile"
                    key={`${shelf.id}-${track.id}`}
                    onClick={() => void playTrack(track.id, shelf.tracks.map((item) => item.id))}
                    title={`${track.title} — ${track.artist}`}
                  >
                    <div className="tile-art">
                      {cover ? <img src={cover} alt="" /> : <span className="mini-art" />}
                      <span className="tile-play">
                        <Icon path={icons.play} size={15} fill />
                      </span>
                    </div>
                    <strong>{track.title}</strong>
                    <em>{formatTime(track.durationSeconds)}</em>
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
