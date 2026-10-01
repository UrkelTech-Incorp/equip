import { create } from 'zustand'
import type { VisualizerMode } from '../components/Visualizer'
import type { SortKey } from './playerStore'

export type ViewId = 'library' | 'playlists' | 'discover' | 'soundcloud'
export type Density = 'comfortable' | 'compact'

const EQ_BANDS = 10
export const OUTPUT_RATES = [0, 44100, 48000, 96000, 192000] as const

export interface EqualizerPreset {
  id: string
  name: string
  gains: number[]
}

export const EQUALIZER_PRESETS: EqualizerPreset[] = [
  { id: 'flat', name: 'Flat', gains: new Array(EQ_BANDS).fill(0) },
  { id: 'bass', name: 'Bass boost', gains: [6, 5, 3, 1, 0, 0, 0, 0, 0, 0] },
  { id: 'vocal', name: 'Vocal', gains: [-3, -2, 0, 2, 4, 3, 1, 0, -1, -1] },
  { id: 'treble', name: 'Treble', gains: [0, 0, 0, 0, 0, 1, 3, 5, 6, 6] },
  { id: 'loudness', name: 'Loudness', gains: [5, 4, 1, 0, -1, -1, 0, 2, 4, 5] }
]

interface UiState {
  view: ViewId
  selectedPlaylistId: string | null
  sortKey: SortKey
  accent: string
  panelOpacity: number
  blur: number
  density: Density
  visualizerEnabled: boolean
  visualizerMode: VisualizerMode
  visualizerOpacity: number
  equalizerEnabled: boolean
  equalizerGains: number[]
  outputSampleRate: number
  queueOpen: boolean
  settingsOpen: boolean
  setView: (view: ViewId, playlistId?: string | null) => void
  setSortKey: (sortKey: SortKey) => void
  setAccent: (accent: string) => void
  setPanelOpacity: (value: number) => void
  setBlur: (value: number) => void
  setDensity: (value: Density) => void
  setVisualizerEnabled: (value: boolean) => void
  setVisualizerMode: (mode: VisualizerMode) => void
  setVisualizerOpacity: (value: number) => void
  setEqualizerEnabled: (value: boolean) => void
  setEqualizerGains: (gains: number[]) => void
  applyEqualizerPreset: (presetId: string) => void
  setOutputSampleRate: (rate: number) => void
  toggleQueue: () => void
  toggleSettings: () => void
  closeOverlays: () => void
}

const STORAGE_KEY = 'equip.ui'

interface PersistedUi {
  accent: string
  panelOpacity: number
  blur: number
  density: Density
  sortKey: SortKey
  visualizerEnabled: boolean
  visualizerMode: VisualizerMode
  visualizerOpacity: number
  equalizerEnabled: boolean
  equalizerGains: number[]
  outputSampleRate: number
}

const defaults: PersistedUi = {
  accent: '#9b7cff',
  panelOpacity: 0.9,
  blur: 26,
  density: 'comfortable',
  sortKey: 'artist',
  visualizerEnabled: true,
  visualizerMode: 'bars',
  visualizerOpacity: 0.5,
  equalizerEnabled: true,
  equalizerGains: new Array(EQ_BANDS).fill(0),
  outputSampleRate: 0
}

function clampGains(gains: unknown): number[] {
  const list = Array.isArray(gains) ? gains : []
  return new Array(EQ_BANDS).fill(0).map((fallback, index) => {
    const value = Number(list[index])
    if (!Number.isFinite(value)) return fallback
    return Math.max(-12, Math.min(12, value))
  })
}

function loadPersisted(): PersistedUi {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return defaults
    const parsed = JSON.parse(raw) as Partial<PersistedUi>
    return {
      ...defaults,
      ...parsed,
      equalizerGains: clampGains(parsed.equalizerGains)
    }
  } catch {
    return defaults
  }
}

function accentVariants(hex: string): { accent: string; bright: string } {
  const value = hex.replace('#', '')
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value
  const int = Number.parseInt(full, 16)
  if (!Number.isFinite(int)) return { accent: defaults.accent, bright: '#b79fff' }
  const r = (int >> 16) & 255
  const g = (int >> 8) & 255
  const b = int & 255
  const lift = (channel: number): number => Math.min(255, Math.round(channel + (255 - channel) * 0.28))
  const bright = `#${[lift(r), lift(g), lift(b)]
    .map((c) => c.toString(16).padStart(2, '0'))
    .join('')}`
  return { accent: hex, bright }
}

export function applyTheme(state: PersistedUi): void {
  const root = document.documentElement
  const { accent, bright } = accentVariants(state.accent)
  root.style.setProperty('--accent', accent)
  root.style.setProperty('--accent-bright', bright)
  root.style.setProperty('--panel', `rgba(16, 15, 22, ${state.panelOpacity})`)
  root.style.setProperty('--panel-raised', `rgba(28, 26, 37, ${Math.min(1, state.panelOpacity + 0.05)})`)
  root.style.setProperty('--blur', `${state.blur}px`)
  root.style.setProperty('--viz-opacity', String(state.visualizerOpacity))
  root.style.setProperty('--row-pad', state.density === 'compact' ? '4px 12px' : '7px 12px')
}

function persist(state: UiState): void {
  const snapshot: PersistedUi = {
    accent: state.accent,
    panelOpacity: state.panelOpacity,
    blur: state.blur,
    density: state.density,
    sortKey: state.sortKey,
    visualizerEnabled: state.visualizerEnabled,
    visualizerMode: state.visualizerMode,
    visualizerOpacity: state.visualizerOpacity,
    equalizerEnabled: state.equalizerEnabled,
    equalizerGains: state.equalizerGains,
    outputSampleRate: state.outputSampleRate
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
  } catch {
    // Private mode or a full profile: the theme still applies for this session.
  }
  applyTheme(snapshot)
}

const initial = loadPersisted()

export const useUiStore = create<UiState>((set, get) => ({
  view: 'library',
  selectedPlaylistId: null,
  ...initial,
  queueOpen: false,
  settingsOpen: false,

  setView: (view, playlistId = null) => set({ view, selectedPlaylistId: playlistId }),
  setSortKey: (sortKey) => {
    set({ sortKey })
    persist(get())
  },
  setAccent: (accent) => {
    set({ accent })
    persist(get())
  },
  setPanelOpacity: (panelOpacity) => {
    set({ panelOpacity })
    persist(get())
  },
  setBlur: (blur) => {
    set({ blur })
    persist(get())
  },
  setDensity: (density) => {
    set({ density })
    persist(get())
  },
  setVisualizerEnabled: (visualizerEnabled) => {
    set({ visualizerEnabled })
    persist(get())
  },
  setVisualizerMode: (visualizerMode) => {
    set({ visualizerMode })
    persist(get())
  },
  setVisualizerOpacity: (visualizerOpacity) => {
    set({ visualizerOpacity })
    persist(get())
  },
  setEqualizerEnabled: (equalizerEnabled) => {
    set({ equalizerEnabled })
    persist(get())
  },
  setEqualizerGains: (gains) => {
    set({ equalizerGains: clampGains(gains) })
    persist(get())
  },
  applyEqualizerPreset: (presetId) => {
    const preset = EQUALIZER_PRESETS.find((item) => item.id === presetId)
    if (!preset) return
    set({ equalizerGains: [...preset.gains], equalizerEnabled: true })
    persist(get())
  },
  setOutputSampleRate: (outputSampleRate) => {
    set({ outputSampleRate })
    persist(get())
  },
  toggleQueue: () => set((state) => ({ queueOpen: !state.queueOpen, settingsOpen: false })),
  toggleSettings: () => set((state) => ({ settingsOpen: !state.settingsOpen, queueOpen: false })),
  closeOverlays: () => set({ queueOpen: false, settingsOpen: false })
}))

applyTheme(initial)
