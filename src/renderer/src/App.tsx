import { useEffect, useRef, useState } from 'react'
import { usePlayerStore } from './state/playerStore'
import { useUiStore } from './state/uiStore'
import { DiscoverView } from './components/DiscoverView'
import { LibraryView } from './components/LibraryView'
import { PlaylistsView } from './components/PlaylistsView'
import { PlayerBar } from './components/PlayerBar'
import { QueuePanel } from './components/QueuePanel'
import { SettingsDrawer } from './components/SettingsDrawer'
import { SoundCloudView } from './components/SoundCloudView'
import { Visualizer } from './components/Visualizer'
import { Icon, icons } from './components/Icon'

const NAV_ITEMS = [
  { id: 'library', label: 'Library', icon: icons.library },
  { id: 'playlists', label: 'Playlists', icon: icons.playlist },
  { id: 'soundcloud', label: 'SoundCloud', icon: icons.cloud },
  { id: 'discover', label: 'Discover', icon: icons.discover }
] as const

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
}

export default function App(): React.JSX.Element {
  const loadLibrary = usePlayerStore((state) => state.loadLibrary)
  const loadPlaylists = usePlayerStore((state) => state.loadPlaylists)
  const addPaths = usePlayerStore((state) => state.addPaths)
  const error = usePlayerStore((state) => state.error)
  const view = useUiStore((state) => state.view)
  const setView = useUiStore((state) => state.setView)
  const accent = useUiStore((state) => state.accent)
  const visualizerEnabled = useUiStore((state) => state.visualizerEnabled)
  const visualizerMode = useUiStore((state) => state.visualizerMode)
  const toggleSettings = useUiStore((state) => state.toggleSettings)
  const closeOverlays = useUiStore((state) => state.closeOverlays)
  const equalizerEnabled = useUiStore((state) => state.equalizerEnabled)
  const equalizerGains = useUiStore((state) => state.equalizerGains)
  const outputSampleRate = useUiStore((state) => state.outputSampleRate)

  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)

  useEffect(() => {
    void loadLibrary()
    void loadPlaylists()
  }, [loadLibrary, loadPlaylists])

  useEffect(() => {
    const backend = usePlayerStore.getState().backend
    backend.setEqualizer(equalizerEnabled ? equalizerGains : equalizerGains.map(() => 0))
  }, [equalizerEnabled, equalizerGains])

  useEffect(() => {
    const backend = usePlayerStore.getState().backend
    void backend.setOutputSampleRate(outputSampleRate).catch((error: unknown) => {
      console.error('[audio] output sample rate change failed', error)
    })
  }, [outputSampleRate])

  useEffect(
    () =>
      window.equip.mini.onCommand((command) => {
        const store = usePlayerStore.getState()
        if (command === 'togglePlay') void store.togglePlay()
        else if (command === 'next') void store.next()
        else if (command === 'previous') void store.previous()
        else if (command === 'stop') store.stop()
      }),
    []
  )

  useEffect(() => {
    let lastKey = ''
    let lastPlaying: boolean | null = null
    return usePlayerStore.subscribe((state) => {
      const track = state.currentTrack()
      const playing = state.snapshot.state === 'playing'
      const key = `${track?.id ?? ''}|${playing}`
      if (key !== lastKey) {
        lastKey = key
        window.equip.mini.sendPlayback({
          title: track?.title ?? 'Nothing playing',
          artist: track?.artist ?? '',
          artworkDataUrl: track?.artworkDataUrl ?? null,
          playing
        })
      }
      if (playing !== lastPlaying) {
        window.equip.trayUpdate(playing)
        lastPlaying = playing
      }
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closeOverlays()
        return
      }
      if (isTypingTarget(event.target)) return

      const store = usePlayerStore.getState()
      switch (event.key) {
        case ' ':
        case 'k':
          event.preventDefault()
          void store.togglePlay()
          break
        case 'ArrowRight':
          event.preventDefault()
          store.seek(Math.min(store.snapshot.duration, store.snapshot.position + (event.shiftKey ? 30 : 5)))
          break
        case 'ArrowLeft':
          event.preventDefault()
          store.seek(Math.max(0, store.snapshot.position - (event.shiftKey ? 30 : 5)))
          break
        case 'ArrowUp':
          event.preventDefault()
          store.setVolume(Math.min(1, store.snapshot.volume + 0.05))
          break
        case 'ArrowDown':
          event.preventDefault()
          store.setVolume(Math.max(0, store.snapshot.volume - 0.05))
          break
        case 'n':
          void store.next()
          break
        case 'p':
          void store.previous()
          break
        case 'm':
          store.toggleMute()
          break
        case 's':
          store.toggleShuffle()
          break
        case 'r':
          store.cycleRepeat()
          break
        case 'q':
          useUiStore.getState().toggleQueue()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeOverlays])

  const onDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    const paths = [...event.dataTransfer.files]
      .map((file) => window.equip.pathForFile(file))
      .filter((path) => path.length > 0)
    if (paths.length > 0) void addPaths(paths)
  }

  return (
    <main
      className="app-shell"
      onDragEnter={(event) => {
        event.preventDefault()
        dragDepth.current += 1
        setDragging(true)
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (dragDepth.current === 0) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <header className="titlebar">
        <div className="brand">
          <span className="brand-mark">E</span>
          <span>EQUIP</span>
        </div>
        <div className="window-controls">
          <button aria-label="Minimize" onClick={() => window.equip.minimize()}>
            —
          </button>
          <button aria-label="Maximize" onClick={() => window.equip.maximize()}>
            □
          </button>
          <button className="close" aria-label="Close" onClick={() => window.equip.close()}>
            ×
          </button>
        </div>
      </header>

      <section className="content">
        <aside className="sidebar">
          <nav>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.id}
                className={`nav-item ${view === item.id ? 'active' : ''}`}
                onClick={() => setView(item.id, null)}
              >
                <Icon path={item.icon} />
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <button className="nav-item settings-nav" onClick={toggleSettings}>
            <Icon path={icons.settings} />
            <span>Settings</span>
          </button>
        </aside>

        <div className="stage">
          {visualizerEnabled && (
            <Visualizer mode={visualizerMode} accent={accent} className="stage-visualizer" />
          )}
          {view === 'library' && <LibraryView />}
          {view === 'playlists' && <PlaylistsView />}
          {view === 'soundcloud' && <SoundCloudView />}
          {view === 'discover' && <DiscoverView />}
        </div>

        <QueuePanel />
        <SettingsDrawer />

        {dragging && (
          <div className="drop-overlay">
            <div className="drop-card">
              <Icon path={icons.add} size={26} />
              <strong>Drop music to add it</strong>
              <span>Folders are scanned recursively</span>
            </div>
          </div>
        )}
      </section>

      <PlayerBar />

      {error && (
        <div className="toast" role="status">
          {error}
          <button aria-label="Dismiss" onClick={() => usePlayerStore.setState({ error: null })}>
            <Icon path="M6 6l12 12M18 6L6 18" size={14} />
          </button>
        </div>
      )}
    </main>
  )
}
