import { useMemo } from 'react'
import { usePlayerStore } from '../state/playerStore'
import { formatTime } from '../util/format'
import { Icon, icons } from './Icon'
import { AddToPlaylistMenu } from './AddToPlaylistMenu'
import type { LibraryTrack } from '../types/library'

interface TrackListProps {
  tracks: LibraryTrack[]
  onRemove?: (trackId: string) => void
  emptyLabel?: string
}

export function TrackList({ tracks, onRemove, emptyLabel }: TrackListProps): React.JSX.Element {
  const currentId = usePlayerStore((state) => state.snapshot.trackId)
  const playingState = usePlayerStore((state) => state.snapshot.state)
  const playTrack = usePlayerStore((state) => state.playTrack)
  const contextIds = useMemo(() => tracks.map((track) => track.id), [tracks])

  if (tracks.length === 0) {
    return (
      <div className="track-list">
        <p className="queue-empty">{emptyLabel ?? 'Nothing here yet.'}</p>
      </div>
    )
  }

  return (
    <div className="track-list">
      <div className="track-row header">
        <span>#</span>
        <span>Title</span>
        <span>Album</span>
        <span className="duration">
          <Icon path="M12 6v6l4 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z" size={15} />
        </span>
      </div>
      {tracks.map((track, index) => {
        const active = track.id === currentId
        return (
          <div
            key={track.id}
            className={`track-row ${active ? 'active' : ''}`}
            onDoubleClick={() => void playTrack(track.id, contextIds)}
          >
            <span className="index">
              <button
                className="play-cell"
                aria-label={`Play ${track.title}`}
                onClick={() => void playTrack(track.id, contextIds)}
              >
                <Icon path={active && playingState === 'playing' ? icons.pause : icons.play} size={14} fill />
              </button>
              <em>{index + 1}</em>
            </span>
            <span className="title-cell">
              {track.artworkDataUrl ? (
                <img src={track.artworkDataUrl} alt="" />
              ) : (
                <span className="mini-art" />
              )}
              <span className="title-text">
                <strong>{track.title}</strong>
                <em>{track.artist}</em>
              </span>
            </span>
            <span className="album-cell">{track.album}</span>
            <span className="row-actions">
              <AddToPlaylistMenu trackId={track.id} />
              {onRemove && (
                <button
                  className="play-cell"
                  aria-label={`Remove ${track.title} from this playlist`}
                  onClick={() => onRemove(track.id)}
                >
                  <Icon path="M6 6l12 12M18 6L6 18" size={15} />
                </button>
              )}
              <em className="dur">{formatTime(track.durationSeconds)}</em>
            </span>
          </div>
        )
      })}
    </div>
  )
}
