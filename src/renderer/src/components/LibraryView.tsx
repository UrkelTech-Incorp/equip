import { useMemo, useState } from 'react'
import { sortTracks, usePlayerStore, type SortKey } from '../state/playerStore'
import { useUiStore } from '../state/uiStore'
import { Icon, icons } from './Icon'
import { TrackList } from './TrackList'

const SORTS: Array<{ id: SortKey; label: string }> = [
  { id: 'artist', label: 'Artist' },
  { id: 'title', label: 'Title' },
  { id: 'album', label: 'Album' },
  { id: 'added', label: 'Date added' }
]

export function LibraryView(): React.JSX.Element {
  const library = usePlayerStore((state) => state.library)
  const scanning = usePlayerStore((state) => state.scanning)
  const addFolder = usePlayerStore((state) => state.addFolder)
  const rescan = usePlayerStore((state) => state.rescan)
  const clearLibrary = usePlayerStore((state) => state.clearLibrary)
  const sortKey = useUiStore((state) => state.sortKey)
  const setSortKey = useUiStore((state) => state.setSortKey)
  const [search, setSearch] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase()
    const matched = term
      ? library.filter((track) =>
          `${track.title} ${track.artist} ${track.album}`.toLowerCase().includes(term)
        )
      : library
    return sortTracks(matched, sortKey)
  }, [library, search, sortKey])

  const totalSeconds = useMemo(
    () => library.reduce((sum, track) => sum + track.durationSeconds, 0),
    [library]
  )

  if (library.length === 0) {
    return (
      <section className="library">
        <div className="empty-library">
          <div className="empty-disc">
            <span />
          </div>
          <h2>Your music, elevated.</h2>
          <p>Add a folder — or drag files onto the window — to build your high-fidelity library.</p>
          <button className="primary-button" onClick={() => void addFolder()} disabled={scanning}>
            {scanning ? 'Scanning…' : 'Choose music folder'}
          </button>
        </div>
      </section>
    )
  }

  return (
    <section className="library">
      <div className="section-heading">
        <div>
          <p className="eyebrow">
            {library.length} TRACKS · {formatHours(totalSeconds)}
          </p>
          <h1>Library</h1>
        </div>
        <div className="library-tools">
          <input
            className="search"
            placeholder="Search title, artist, album"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            aria-label="Search library"
          />
          <label className="select">
            <span>Sort</span>
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
              {SORTS.map((sort) => (
                <option key={sort.id} value={sort.id}>
                  {sort.label}
                </option>
              ))}
            </select>
          </label>
          <button
            className="round-button"
            aria-label="Rescan folders"
            title="Rescan folders"
            disabled={scanning}
            onClick={() => void rescan()}
          >
            <Icon path={icons.refresh} size={18} />
          </button>
          <button className="round-button" aria-label="Add folder" onClick={() => void addFolder()}>
            <Icon path={icons.add} size={20} />
          </button>
          <div className={`more-menu ${menuOpen ? 'open' : ''}`}>
            <button
              className="round-button"
              aria-label="More library actions"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon path={icons.more} size={18} />
            </button>
            {menuOpen && (
              <div className="more-dropdown">
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    void rescan()
                  }}
                >
                  Rescan folders
                </button>
                <button
                  className="danger"
                  onClick={() => {
                    setMenuOpen(false)
                    if (window.confirm('Remove every track from the library? Your files are not deleted.')) {
                      void clearLibrary()
                    }
                  }}
                >
                  Clear library
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      <TrackList tracks={filtered} />
    </section>
  )
}

function formatHours(seconds: number): string {
  const hours = seconds / 3600
  if (hours < 1) return `${Math.round(seconds / 60)} MIN`
  return `${hours.toFixed(hours < 10 ? 1 : 0)} HRS`
}
