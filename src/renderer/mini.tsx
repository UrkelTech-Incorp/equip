import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Icon, icons } from './src/components/Icon'
import type { MiniPlaybackState, PlaybackCommand } from '../preload'
import './src/mini.css'

function MiniPlayer(): React.JSX.Element {
  const [state, setState] = useState<MiniPlaybackState>({
    title: 'Nothing playing',
    artist: '',
    artworkDataUrl: null,
    playing: false
  })

  useEffect(() => {
    // Pull the latest state after mounting: the main process pushes on every
    // change, but a push that arrives before this listener exists is lost.
    void window.equip.mini.getState().then((replay) => {
      if (replay) setState(replay)
    })
    return window.equip.mini.onPlayback(setState)
  }, [])

  const command = (name: PlaybackCommand): void => window.equip.mini.sendCommand(name)

  return (
    <div className="mini">
      {state.artworkDataUrl ? (
        <img className="mini-art" src={state.artworkDataUrl} alt="" />
      ) : (
        <div className="mini-art placeholder" />
      )}
      <div className="mini-info">
        <strong>{state.title}</strong>
        <span>{state.artist}</span>
        <div className="mini-controls">
          <button aria-label="Previous" onClick={() => command('previous')}>
            <Icon path={icons.prev} size={17} />
          </button>
          <button className="mini-play" aria-label={state.playing ? 'Pause' : 'Play'} onClick={() => command('togglePlay')}>
            <Icon path={state.playing ? icons.pause : icons.play} size={18} fill />
          </button>
          <button aria-label="Next" onClick={() => command('next')}>
            <Icon path={icons.next} size={17} />
          </button>
        </div>
      </div>
      <button className="mini-dock" aria-label="Dock" onClick={() => window.equip.mini.close()}>
        <Icon path="M6 6l12 12M18 6L6 18" size={14} />
      </button>
    </div>
  )
}

createRoot(document.getElementById('mini-root')!).render(
  <StrictMode>
    <MiniPlayer />
  </StrictMode>
)
