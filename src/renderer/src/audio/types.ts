export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'ended' | 'error'

export interface AudioTrack {
  id: string
  source: string
  duration?: number
}

export interface PlaybackSnapshot {
  state: PlaybackState
  position: number
  duration: number
  volume: number
  muted: boolean
  trackId: string | null
}

export interface AudioBackend {
  readonly mode: 'shared' | 'exclusive'
  readonly analyser: AnalyserNode | null
  /** Output rate in Hz, or 0 when the device default is used. */
  readonly sampleRate: number
  /** 'running' | 'suspended' | 'closed' — surfaced for the diagnostics panel. */
  readonly contextState: AudioContextState | 'unavailable'
  /** Current per-band EQ gains in dB, low band first. */
  readonly equalizerGains: readonly number[]
  load(track: AudioTrack): Promise<void>
  queue(track: AudioTrack | null): Promise<void>
  play(): Promise<void>
  pause(): void
  stop(): void
  seek(seconds: number): void
  setVolume(volume: number): void
  setMuted(muted: boolean): void
  setCrossfade(seconds: number): void
  /** Positional band gains in dB, low frequency first. Clamped to ±12 dB. */
  setEqualizer(gains: number[]): void
  /** Rebuilds the graph at a specific output rate. 0 restores the device default. */
  setOutputSampleRate(rate: number): Promise<void>
  subscribe(listener: (snapshot: PlaybackSnapshot) => void): () => void
  destroy(): void
}

/** Equal-power fade curves: cos/sin so the summed power stays constant. */
export function fadeCurves(steps: number): { fadeOut: Float32Array; fadeIn: Float32Array } {
  const fadeOut = new Float32Array(steps)
  const fadeIn = new Float32Array(steps)
  for (let index = 0; index < steps; index += 1) {
    const position = index / (steps - 1)
    fadeOut[index] = Math.cos(position * Math.PI * 0.5)
    fadeIn[index] = Math.sin(position * Math.PI * 0.5)
  }
  return { fadeOut, fadeIn }
}
