import { useRef } from 'react'
import { usePlayerStore } from '../state/playerStore'
import { useUiStore } from '../state/uiStore'
import { formatTime } from '../util/format'
import { Icon, icons } from './Icon'

export function PlayerBar(): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null)
  const snapshot = usePlayerStore((state) => state.snapshot)
  const shuffle = usePlayerStore((state) => state.shuffle)
  const repeat = usePlayerStore((state) => state.repeat)
  const crossfade = usePlayerStore((state) => state.crossfadeSeconds)
  const current = usePlayerStore((state) => state.currentTrack())
  const { togglePlay, next, previous, seek, setVolume, toggleMute, toggleShuffle, cycleRepeat } =
    usePlayerStore()

  const visualizerEnabled = useUiStore((state) => state.visualizerEnabled)
  const setVisualizerEnabled = useUiStore((state) => state.setVisualizerEnabled)
  const queueOpen = useUiStore((state) => state.queueOpen)
  const toggleQueue = useUiStore((state) => state.toggleQueue)

  const progress = snapshot.duration > 0 ? snapshot.position / snapshot.duration : 0
  const playing = snapshot.state === 'playing'
  const buffering = snapshot.state === 'loading'

  const handleSeek = (event: React.MouseEvent<HTMLDivElement>): void => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || snapshot.duration === 0) return
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width))
    seek(ratio * snapshot.duration)
  }

  return (
    <footer className="player-bar">
      <div className="track-info">
        {current?.artworkDataUrl ? (
          <img className="artwork" src={current.artworkDataUrl} alt="" />
        ) : (
          <div className="artwork-placeholder" />
        )}
        <div className="track-text">
          <strong>{current?.title ?? 'Nothing playing'}</strong>
          <span>{current?.artist ?? 'Pick a track from your library'}</span>
        </div>
        <button
          className="icon-button pop"
          aria-label="Pop out now playing"
          title="Pop out now playing"
          onClick={() => window.equip.mini.open()}
        >
          <Icon path={icons.popout} size={16} />
        </button>
      </div>

      <div className="transport">
        <div className="transport-buttons">
          <button
            className={`icon-button ${shuffle ? 'active' : ''}`}
            aria-label="Shuffle"
            aria-pressed={shuffle}
            onClick={toggleShuffle}
          >
            <Icon path={icons.shuffle} size={16} />
          </button>
          <button className="icon-button" aria-label="Previous" onClick={() => void previous()}>
            <Icon path={icons.prev} size={21} />
          </button>
          <button
            className="play-button"
            aria-label={playing ? 'Pause' : 'Play'}
            onClick={() => void togglePlay()}
          >
            <Icon path={playing ? icons.pause : icons.play} size={22} fill />
          </button>
          <button className="icon-button" aria-label="Next" onClick={() => void next()}>
            <Icon path={icons.next} size={21} />
          </button>
          <button
            className={`icon-button ${repeat !== 'off' ? 'active' : ''}`}
            aria-label="Repeat"
            aria-pressed={repeat !== 'off'}
            onClick={cycleRepeat}
          >
            <Icon path={repeat === 'one' ? icons.repeatOne : icons.repeat} size={16} />
          </button>
        </div>
        <div className="timeline">
          <span>{formatTime(snapshot.position)}</span>
          <div className="track" ref={trackRef} onClick={handleSeek} role="presentation">
            <i style={{ width: `${progress * 100}%` }} />
          </div>
          <span>{formatTime(snapshot.duration)}</span>
        </div>
      </div>

      <div className="player-actions">
        {crossfade > 0 && (
          <span className="pill" title={`Crossfade ${crossfade.toFixed(1)} seconds`}>
            XFADE {crossfade.toFixed(1)}s
          </span>
        )}
        <button
          className={`icon-button ${visualizerEnabled ? 'active' : ''}`}
          aria-label="Toggle visualizer"
          aria-pressed={visualizerEnabled}
          onClick={() => setVisualizerEnabled(!visualizerEnabled)}
        >
          <Icon path={icons.visualizer} />
        </button>
        <button
          className={`icon-button ${queueOpen ? 'active' : ''}`}
          aria-label="Queue"
          aria-pressed={queueOpen}
          onClick={toggleQueue}
        >
          <Icon path={icons.queue} />
        </button>
        <button
          className="icon-button"
          aria-label={snapshot.muted ? 'Unmute' : 'Mute'}
          onClick={toggleMute}
        >
          <Icon path={snapshot.muted ? icons.mute : icons.volume} />
        </button>
        <input
          className="volume-slider"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={snapshot.muted ? 0 : snapshot.volume}
          onChange={(event) => setVolume(Number(event.target.value))}
          aria-label="Volume"
        />
        {buffering && <span className="pill">LOADING</span>}
      </div>
    </footer>
  )
}
