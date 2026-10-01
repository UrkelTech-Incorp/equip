import { useEffect, useState } from 'react'
import { usePlayerStore } from '../state/playerStore'
import { EQUALIZER_PRESETS, OUTPUT_RATES, useUiStore } from '../state/uiStore'
import { EQ_LABELS } from '../audio/WebAudioBackend'
import type { VisualizerMode } from './Visualizer'
import type { ScSettings } from '../../../preload'
import { Icon } from './Icon'

const ACCENTS = ['#9b7cff', '#4fc3f7', '#37d39b', '#ffb347', '#ff6b8b', '#e0e0e0']
const RATE_LABELS: Record<number, string> = {
  0: 'Auto',
  44100: '44.1 kHz',
  48000: '48 kHz',
  96000: '96 kHz',
  192000: '192 kHz'
}

export function SettingsDrawer(): React.JSX.Element | null {
  const settingsOpen = useUiStore((state) => state.settingsOpen)
  const toggleSettings = useUiStore((state) => state.toggleSettings)
  const accent = useUiStore((state) => state.accent)
  const panelOpacity = useUiStore((state) => state.panelOpacity)
  const blur = useUiStore((state) => state.blur)
  const density = useUiStore((state) => state.density)
  const visualizerEnabled = useUiStore((state) => state.visualizerEnabled)
  const visualizerMode = useUiStore((state) => state.visualizerMode)
  const visualizerOpacity = useUiStore((state) => state.visualizerOpacity)
  const equalizerEnabled = useUiStore((state) => state.equalizerEnabled)
  const equalizerGains = useUiStore((state) => state.equalizerGains)
  const outputSampleRate = useUiStore((state) => state.outputSampleRate)
  const {
    setAccent,
    setPanelOpacity,
    setBlur,
    setDensity,
    setVisualizerEnabled,
    setVisualizerMode,
    setVisualizerOpacity,
    setEqualizerEnabled,
    setEqualizerGains,
    applyEqualizerPreset,
    setOutputSampleRate
  } = useUiStore()

  const crossfade = usePlayerStore((state) => state.crossfadeSeconds)
  const setCrossfade = usePlayerStore((state) => state.setCrossfade)
  const sampleRate = usePlayerStore((state) => state.backend.sampleRate)

  const [scSettings, setScSettings] = useState<ScSettings | null>(null)
  const [clientIdInput, setClientIdInput] = useState('')
  const [scTest, setScTest] = useState<{ ok: boolean; detail: string } | null>(null)
  const [scTesting, setScTesting] = useState(false)

  useEffect(() => {
    if (!settingsOpen) return
    void window.equip.soundcloud.settingsGet().then((settings) => {
      setScSettings(settings)
      setClientIdInput(settings.clientId)
    })
  }, [settingsOpen])

  const saveClientId = async (): Promise<void> => {
    const settings = await window.equip.soundcloud.settingsSet({ clientId: clientIdInput })
    setScSettings(settings)
    setClientIdInput(settings.clientId)
    setScTest(null)
  }

  const resetClientId = async (): Promise<void> => {
    setClientIdInput('')
    const settings = await window.equip.soundcloud.settingsSet({ clientId: '' })
    setScSettings(settings)
    setClientIdInput(settings.clientId)
    setScTest(null)
  }

  const testNow = async (): Promise<void> => {
    setScTesting(true)
    try {
      setScTest(await window.equip.soundcloud.test())
    } finally {
      setScTesting(false)
    }
  }

  const chooseFolder = async (): Promise<void> => {
    const offlineDir = await window.equip.soundcloud.pickOfflineFolder()
    setScSettings((current) => (current ? { ...current, offlineDir } : current))
  }

  if (!settingsOpen) return null

  const onGainChange = (index: number, value: number): void => {
    const gains = [...equalizerGains]
    gains[index] = value
    setEqualizerGains(gains)
  }

  return (
    <aside className="settings-drawer">
      <div className="drawer-head">
        <h3>Settings</h3>
        <button className="icon-button" aria-label="Close settings" onClick={toggleSettings}>
          <Icon path="M6 6l12 12M18 6L6 18" size={18} />
        </button>
      </div>

      <div className="setting">
        <label>
          Crossfade <strong>{crossfade === 0 ? 'Off' : `${crossfade.toFixed(1)}s`}</strong>
        </label>
        <input
          type="range"
          min={0}
          max={15}
          step={0.5}
          value={crossfade}
          onChange={(event) => setCrossfade(Number(event.target.value))}
        />
        <p>Overlaps the end and start of consecutive tracks, up to 15 seconds. 0 gives gapless playback.</p>
      </div>

      <div className="setting">
        <label>Equalizer</label>
        <div className="segmented">
          <button className={equalizerEnabled ? 'on' : ''} onClick={() => setEqualizerEnabled(true)}>
            On
          </button>
          <button className={!equalizerEnabled ? 'on' : ''} onClick={() => setEqualizerEnabled(false)}>
            Bypass
          </button>
        </div>
        <div className="eq-presets">
          {EQUALIZER_PRESETS.map((preset) => (
            <button key={preset.id} onClick={() => applyEqualizerPreset(preset.id)}>
              {preset.name}
            </button>
          ))}
        </div>
        <div className={`eq ${equalizerEnabled ? '' : 'bypassed'}`}>
          {equalizerGains.map((gain, index) => (
            <div className="eq-band" key={EQ_LABELS[index]}>
              <input
                type="range"
                min={-12}
                max={12}
                step={0.5}
                value={gain}
                aria-label={`${EQ_LABELS[index]} Hz`}
                onChange={(event) => onGainChange(index, Number(event.target.value))}
              />
              <span>{gain > 0 ? `+${gain.toFixed(1)}` : gain.toFixed(1)}</span>
              <em>{EQ_LABELS[index]}</em>
            </div>
          ))}
        </div>
      </div>

      <div className="setting">
        <label>
          Output sample rate <strong>{RATE_LABELS[outputSampleRate] ?? 'Auto'}</strong>
        </label>
        <div className="segmented modes">
          {OUTPUT_RATES.map((rate) => (
            <button
              key={rate}
              className={outputSampleRate === rate ? 'on' : ''}
              onClick={() => setOutputSampleRate(rate)}
            >
              {RATE_LABELS[rate]}
            </button>
          ))}
        </div>
        <p>
          Rendering at the source rate avoids a Windows resampling pass. Currently output at{' '}
          {(sampleRate / 1000).toFixed(1)} kHz.
        </p>
      </div>

      <div className="setting">
        <label>
          Output mode <strong>Shared</strong>
        </label>
        <p>
          Bit-perfect WASAPI exclusive and ASIO output are not implemented yet — they need a native
          audio module, which Web Audio cannot provide.
        </p>
      </div>

      <div className="setting">
        <label>SoundCloud</label>
        <div className="segmented modes">
          <button onClick={testNow} disabled={scTesting}>
            {scTesting ? 'Testing…' : 'Test connection'}
          </button>
          <button
            onClick={() => {
              useUiStore.getState().setView('soundcloud', null)
              useUiStore.getState().toggleSettings()
            }}
          >
            Open SoundCloud
          </button>
        </div>
        {scTest && (
          <p className={scTest.ok ? 'sc-test ok' : 'sc-test bad'}>
            {scTest.ok ? '✓' : '✗'} {scTest.detail}
          </p>
        )}
        <input
          className="sc-client-input"
          placeholder="client_id (SoundCloud web app)"
          value={clientIdInput}
          onChange={(event) => setClientIdInput(event.target.value)}
          aria-label="SoundCloud client id"
        />
        <div className="segmented modes">
          <button onClick={() => void saveClientId()}>Save client ID</button>
          <button onClick={() => void resetClientId()}>Reset to default</button>
        </div>
        <p>
          SoundCloud no longer issues official API keys. Equip uses the same public, unauthenticated{' '}
          <code>client_id</code> that soundcloud.com's web app embeds — replace it here if streaming
          ever stops working.
        </p>
      </div>

      <div className="setting">
        <label>Offline downloads</label>
        <p className="sc-dir" title={scSettings?.offlineDir ?? ''}>
          {scSettings?.offlineDir ?? 'Loading…'}
        </p>
        <div className="segmented modes">
          <button onClick={() => void chooseFolder()}>Choose folder</button>
          {scSettings && (
            <button
              onClick={() => window.equip.soundcloud.openFolder(
                scSettings.offlineDir.replace(/[\\/]+$/, '')
              )}
            >
              Open
            </button>
          )}
        </div>
        <p>
          Downloaded SoundCloud tracks are saved here as 128 kbps MP3s — the best single-file quality
          SoundCloud serves without an account — and become normal library tracks you can play offline.
        </p>
      </div>

      <div className="setting">
        <label>Accent color</label>
        <div className="swatches">
          {ACCENTS.map((color) => (
            <button
              key={color}
              className={`swatch ${accent === color ? 'on' : ''}`}
              style={{ background: color }}
              aria-label={`Accent ${color}`}
              onClick={() => setAccent(color)}
            />
          ))}
          <label className="swatch custom" style={{ background: accent }}>
            <input type="color" value={accent} onChange={(event) => setAccent(event.target.value)} />
          </label>
        </div>
      </div>

      <div className="setting">
        <label>
          Window transparency <strong>{Math.round((1 - panelOpacity) * 100)}%</strong>
        </label>
        <input
          type="range"
          min={0.4}
          max={1}
          step={0.02}
          value={panelOpacity}
          onChange={(event) => setPanelOpacity(Number(event.target.value))}
        />
        <p>Let your desktop show through the player.</p>
      </div>

      <div className="setting">
        <label>
          Background blur <strong>{blur}px</strong>
        </label>
        <input
          type="range"
          min={0}
          max={50}
          step={1}
          value={blur}
          onChange={(event) => setBlur(Number(event.target.value))}
        />
      </div>

      <div className="setting">
        <label>Layout density</label>
        <div className="segmented">
          <button className={density === 'comfortable' ? 'on' : ''} onClick={() => setDensity('comfortable')}>
            Comfortable
          </button>
          <button className={density === 'compact' ? 'on' : ''} onClick={() => setDensity('compact')}>
            Compact
          </button>
        </div>
      </div>

      <div className="setting">
        <label>
          Visualizer <strong>{Math.round(visualizerOpacity * 100)}%</strong>
        </label>
        <div className="segmented">
          <button className={visualizerEnabled ? 'on' : ''} onClick={() => setVisualizerEnabled(true)}>
            On
          </button>
          <button className={!visualizerEnabled ? 'on' : ''} onClick={() => setVisualizerEnabled(false)}>
            Off
          </button>
        </div>
        <div className="segmented modes">
          {(['bars', 'wave', 'radial'] as VisualizerMode[]).map((mode) => (
            <button
              key={mode}
              className={visualizerMode === mode ? 'on' : ''}
              onClick={() => setVisualizerMode(mode)}
            >
              {mode}
            </button>
          ))}
        </div>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={visualizerOpacity}
          onChange={(event) => setVisualizerOpacity(Number(event.target.value))}
        />
      </div>
    </aside>
  )
}
