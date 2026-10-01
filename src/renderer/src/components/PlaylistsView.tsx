import { useMemo, useState } from 'react'
import { usePlayerStore } from '../state/playerStore'
import { useUiStore } from '../state/uiStore'
import { Icon, icons } from './Icon'
import { TrackList } from './TrackList'

export function PlaylistsView(): React.JSX.Element {
  const playlists = usePlayerStore((state) => state.playlists)
  const library = usePlayerStore((state) => state.library)
  const { createPlaylist, deletePlaylist, renamePlaylist, removeFromPlaylist, playTrack } = usePlayerStore()
  const selectedId = useUiStore((state) => state.selectedPlaylistId)
  const setView = useUiStore((state) => state.setView)
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  const selected = playlists.find((playlist) => playlist.id === selectedId) ?? null

  const tracks = useMemo(() => {
    if (!selected) return []
    return selected.trackIds
      .map((id) => library.find((track) => track.id === id))
      .filter((track): track is NonNullable<typeof track> => Boolean(track))
  }, [selected, library])

  if (!selected) {
    return (
      <section className="library">
        <div className="section-heading">
          <div>
            <p className="eyebrow">COLLECTIONS</p>
            <h1>Playlists</h1>
          </div>
          <button className="round-button" aria-label="New playlist" onClick={() => void createPlaylist('New Playlist')}>
            <Icon path={icons.add} size={20} />
          </button>
        </div>
        {playlists.length === 0 ? (
          <div className="empty-library">
            <h2>No playlists yet</h2>
            <p>Create one, or use the + on any track to start a collection.</p>
            <button className="primary-button" onClick={() => void createPlaylist('New Playlist')}>
              Create playlist
            </button>
          </div>
        ) : (
          <div className="playlist-grid">
            {playlists.map((playlist) => {
              const art = playlist.trackIds
                .map((id) => library.find((track) => track.id === id)?.artworkDataUrl)
                .find(Boolean)
              return (
                <button key={playlist.id} className="playlist-card" onClick={() => setView('playlists', playlist.id)}>
                  <div className="playlist-cover">
                    {art ? <img src={art} alt="" /> : <Icon path={icons.playlist} size={30} />}
                  </div>
                  <strong>{playlist.name}</strong>
                  <span>{playlist.trackIds.length} tracks</span>
                </button>
              )
            })}
          </div>
        )}
      </section>
    )
  }

  return (
    <section className="library">
      <div className="section-heading">
        <div className="playlist-head">
          <button className="back-button" aria-label="Back" onClick={() => setView('playlists', null)}>
            <Icon path="M15 6l-6 6 6 6" size={20} />
          </button>
          <div>
            <p className="eyebrow">PLAYLIST · {tracks.length} TRACKS</p>
            {renaming ? (
              <input
                className="rename-input"
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                onBlur={() => {
                  void renamePlaylist(selected.id, renameValue)
                  setRenaming(false)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void renamePlaylist(selected.id, renameValue)
                    setRenaming(false)
                  }
                }}
              />
            ) : (
              <h1
                onDoubleClick={() => {
                  setRenameValue(selected.name)
                  setRenaming(true)
                }}
              >
                {selected.name}
              </h1>
            )}
          </div>
        </div>
        <div className="library-tools">
          <button
            className="primary-button"
            disabled={tracks.length === 0}
            onClick={() => tracks[0] && void playTrack(tracks[0].id, tracks.map((track) => track.id))}
          >
            Play
          </button>
          <button
            className="round-button"
            aria-label="Delete playlist"
            onClick={() => {
              void deletePlaylist(selected.id)
              setView('playlists', null)
            }}
          >
            <Icon path="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13" size={18} />
          </button>
        </div>
      </div>
      {tracks.length === 0 ? (
        <div className="empty-library">
          <p>This playlist is empty. Add tracks with the + on any song.</p>
        </div>
      ) : (
        <TrackList tracks={tracks} onRemove={(trackId) => void removeFromPlaylist(selected.id, trackId)} />
      )}
    </section>
  )
}
