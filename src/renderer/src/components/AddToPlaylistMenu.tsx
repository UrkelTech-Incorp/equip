import { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from '../state/playerStore'
import { Icon, icons } from './Icon'

interface AddToPlaylistMenuProps {
  trackId: string
  /** Optional async work to run before the menu opens (e.g. materialize a
   * stream-only SoundCloud track into the library so the id resolves). */
  ensure?: () => Promise<unknown>
}

export function AddToPlaylistMenu({ trackId, ensure }: AddToPlaylistMenuProps): React.JSX.Element {
  const playlists = usePlayerStore((state) => state.playlists)
  const { addToPlaylist, createPlaylist } = usePlayerStore()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
        setCreating(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const submitNew = async (): Promise<void> => {
    await createPlaylist(name, trackId)
    setName('')
    setCreating(false)
    setOpen(false)
  }

  const openMenu = async (): Promise<void> => {
    if (open || busy) return
    setBusy(true)
    try {
      if (ensure) await ensure()
      setOpen(true)
    } catch {
      // The track could not be materialized; leave the menu closed.
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="add-menu" ref={ref}>
      <button
        className="play-cell add-trigger"
        aria-label="Add to playlist"
        onClick={(event) => {
          event.stopPropagation()
          void openMenu()
        }}
      >
        <Icon path={icons.plusCircle} size={16} />
      </button>
      {open && (
        <div className="add-dropdown" onClick={(event) => event.stopPropagation()}>
          {creating ? (
            <div className="add-create">
              <input
                autoFocus
                placeholder="Playlist name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submitNew()
                  if (event.key === 'Escape') setCreating(false)
                }}
              />
              <button onClick={() => void submitNew()}>Create</button>
            </div>
          ) : (
            <>
              <button className="add-new" onClick={() => setCreating(true)}>
                <Icon path={icons.add} size={14} /> New playlist
              </button>
              {playlists.length > 0 && <div className="add-divider" />}
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  onClick={() => {
                    void addToPlaylist(playlist.id, trackId)
                    setOpen(false)
                  }}
                >
                  {playlist.name}
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
