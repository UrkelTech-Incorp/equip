import { usePlayerStore } from '../state/playerStore'
import { useUiStore } from '../state/uiStore'
import { Icon, icons } from './Icon'

export function QueuePanel(): React.JSX.Element | null {
  const queueOpen = useUiStore((state) => state.queueOpen)
  const toggleQueue = useUiStore((state) => state.toggleQueue)
  const queue = usePlayerStore((state) => state.queue)
  const currentIndex = usePlayerStore((state) => state.currentIndex)
  const library = usePlayerStore((state) => state.library)
  const playAt = usePlayerStore((state) => state.playAt)

  if (!queueOpen) return null

  const rows = queue
    .map((id, index) => ({ track: library.find((item) => item.id === id), index }))
    .filter((row): row is { track: NonNullable<typeof row.track>; index: number } => Boolean(row.track))

  return (
    <div className="queue-panel">
      <div className="drawer-head">
        <h3>Queue</h3>
        <button className="icon-button" aria-label="Close queue" onClick={toggleQueue}>
          <Icon path="M6 6l12 12M18 6L6 18" size={18} />
        </button>
      </div>
      <div className="queue-list">
        {rows.length === 0 && <p className="queue-empty">Nothing queued.</p>}
        {rows.map(({ track, index }) => (
          <button
            key={`${track.id}-${index}`}
            className={`queue-row ${index === currentIndex ? 'active' : ''}`}
            onClick={() => void playAt(index)}
          >
            {track.artworkDataUrl ? <img src={track.artworkDataUrl} alt="" /> : <span className="mini-art" />}
            <span className="queue-text">
              <strong>{track.title}</strong>
              <em>{track.artist}</em>
            </span>
            {index === currentIndex && <Icon path={icons.visualizer} size={14} />}
          </button>
        ))}
      </div>
    </div>
  )
}
