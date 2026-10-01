import type { AudioBackend, AudioTrack, PlaybackSnapshot } from './types'

const UNAVAILABLE =
  'Exclusive-mode WASAPI and ASIO output are not implemented yet. Ship a native audio module that satisfies AudioBackend to enable them.'

/**
 * Placeholder for the bit-perfect output path (WASAPI exclusive / ASIO).
 * Web Audio can only do shared-mode rendering, so this backend refuses to play
 * rather than silently degrading — the UI keeps the mode hidden until the
 * native module lands.
 */
export class NativeAudioBackend implements AudioBackend {
  readonly mode = 'exclusive' as const
  readonly analyser = null
  readonly sampleRate = 0
  readonly contextState = 'unavailable' as const
  readonly equalizerGains: readonly number[] = []

  private fail(): never {
    throw new Error(UNAVAILABLE)
  }

  load(_track: AudioTrack): Promise<void> {
    return Promise.reject(new Error(UNAVAILABLE))
  }
  queue(_track: AudioTrack | null): Promise<void> {
    return Promise.reject(new Error(UNAVAILABLE))
  }
  play(): Promise<void> {
    return Promise.reject(new Error(UNAVAILABLE))
  }
  pause(): void {
    this.fail()
  }
  stop(): void {
    this.fail()
  }
  seek(_seconds: number): void {
    this.fail()
  }
  setVolume(_volume: number): void {
    this.fail()
  }
  setMuted(_muted: boolean): void {
    this.fail()
  }
  setCrossfade(_seconds: number): void {
    this.fail()
  }
  setEqualizer(_gains: number[]): void {
    this.fail()
  }
  setOutputSampleRate(_rate: number): Promise<void> {
    return Promise.reject(new Error(UNAVAILABLE))
  }
  subscribe(_listener: (snapshot: PlaybackSnapshot) => void): () => void {
    return () => undefined
  }
  destroy(): void {}
}
