import { fadeCurves, type AudioBackend, type AudioTrack, type PlaybackSnapshot, type PlaybackState } from './types'

interface Deck {
  element: HTMLAudioElement
  gain: GainNode
  source: MediaElementAudioSourceNode
  track: AudioTrack | null
}

const EQ_FREQUENCIES = [60, 170, 310, 600, 1000, 3000, 6000, 12000, 14000, 16000]
const EQ_LABELS = ['60', '170', '310', '600', '1k', '3k', '6k', '12k', '14k', '16k']
const POSITION_TICK_MS = 90
const FADE_STEPS = 128

export { EQ_FREQUENCIES, EQ_LABELS }

interface OutputOptions {
  sampleRate: number
  latencyHint: AudioContextLatencyCategory
}

export class WebAudioBackend implements AudioBackend {
  readonly mode = 'shared' as const

  private context: AudioContext
  private analyserNode: AnalyserNode
  private decks: [Deck, Deck]
  private master: GainNode
  private eqBands: BiquadFilterNode[]
  private listeners = new Set<(snapshot: PlaybackSnapshot) => void>()
  private activeIndex = 0
  private queuedIndex: number | null = null
  private state: PlaybackState = 'idle'
  private volume = 1
  private muted = false
  private crossfadeSeconds = 0
  private transitionStarted = false
  private animationFrame = 0
  private lastEmit = 0
  private eqGains = EQ_FREQUENCIES.map(() => 0)
  private requestedSampleRate = 0

  constructor() {
    this.context = this.createContext({ sampleRate: 0, latencyHint: 'playback' })
    this.analyserNode = this.createAnalyser()
    this.master = this.context.createGain()
    this.eqBands = this.createEqBands()
    this.decks = [this.createDeck(), this.createDeck()]
    this.applyGraph()
    this.startPositionUpdates()
  }

  get analyser(): AnalyserNode {
    return this.analyserNode
  }

  get sampleRate(): number {
    return this.context.sampleRate
  }

  get contextState(): AudioContextState | 'unavailable' {
    return this.context.state
  }

  get equalizerGains(): readonly number[] {
    return this.eqGains
  }

  async load(track: AudioTrack): Promise<void> {
    this.stopDeck(this.decks[0])
    this.stopDeck(this.decks[1])
    this.activeIndex = 0
    this.queuedIndex = null
    this.transitionStarted = false
    this.state = 'loading'
    this.emit(true)
    await this.prepareDeck(this.decks[0], track)
    this.decks[0].gain.gain.value = 1
    this.state = 'paused'
    this.emit(true)
  }

  async queue(track: AudioTrack | null): Promise<void> {
    const index = this.activeIndex === 0 ? 1 : 0
    const deck = this.decks[index]
    this.stopDeck(deck)
    this.transitionStarted = false
    if (!track) {
      this.queuedIndex = null
      return
    }
    await this.prepareDeck(deck, track)
    deck.gain.gain.value = 0
    this.queuedIndex = index
  }

  async play(): Promise<void> {
    const active = this.activeDeck
    if (!active.track) return
    await this.context.resume()
    await active.element.play()
    this.state = 'playing'
    this.emit(true)
  }

  pause(): void {
    this.decks.forEach((deck) => deck.element.pause())
    this.state = 'paused'
    this.emit(true)
  }

  stop(): void {
    this.decks.forEach((deck) => this.stopDeck(deck))
    this.queuedIndex = null
    this.transitionStarted = false
    this.state = 'idle'
    this.emit(true)
  }

  seek(seconds: number): void {
    const active = this.activeDeck.element
    if (!Number.isFinite(active.duration)) return
    active.currentTime = Math.max(0, Math.min(seconds, active.duration))
    this.transitionStarted = false
    this.emit(true)
  }

  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
    this.applyMasterGain()
    this.emit(true)
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    this.applyMasterGain()
    this.emit(true)
  }

  setCrossfade(seconds: number): void {
    this.crossfadeSeconds = Math.max(0, Math.min(15, seconds))
  }

  setEqualizer(gains: number[]): void {
    this.eqGains = EQ_FREQUENCIES.map((_, index) =>
      Math.max(-12, Math.min(12, Number.isFinite(gains[index]) ? gains[index] : 0))
    )
    this.eqBands.forEach((filter, index) => {
      filter.gain.setTargetAtTime(this.eqGains[index], this.context.currentTime, 0.02)
    })
  }

  async setOutputSampleRate(rate: number): Promise<void> {
    const next = rate > 0 ? Math.round(rate) : 0
    if (next === this.requestedSampleRate) return
    const active = this.activeDeck
    const wasPlaying = this.state === 'playing'
    const position = active.element.currentTime
    const track = active.track

    this.requestedSampleRate = next
    const previous = this.context
    const previousDecks = this.decks

    this.context = this.createContext({ sampleRate: next, latencyHint: 'playback' })
    this.analyserNode = this.createAnalyser()
    this.master = this.context.createGain()
    this.eqBands = this.createEqBands()
    this.decks = [this.createDeck(), this.createDeck()]
    this.applyGraph()
    this.setEqualizer(this.eqGains)
    this.applyMasterGain()

    // The <audio> elements survive a graph rebuild only if they keep playing,
    // so pause them first, restore the track, then resume the old clock.
    previousDecks.forEach((deck) => deck.element.pause())
    void previous.close().catch(() => undefined)

    if (track) {
      try {
        await this.prepareDeck(this.decks[0], track)
        if (Number.isFinite(position) && position > 0) {
          this.decks[0].element.currentTime = Math.min(position, this.decks[0].element.duration || position)
        }
        if (wasPlaying) await this.play()
        else this.state = 'paused'
      } catch {
        this.state = 'error'
      }
    } else {
      this.state = wasPlaying ? 'paused' : this.state
    }
    this.queuedIndex = null
    this.transitionStarted = false
    this.emit(true)
  }

  subscribe(listener: (snapshot: PlaybackSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  destroy(): void {
    cancelAnimationFrame(this.animationFrame)
    this.decks.forEach((deck) => {
      this.stopDeck(deck)
      deck.source.disconnect()
      deck.gain.disconnect()
    })
    this.listeners.clear()
    void this.context.close()
  }

  private get activeDeck(): Deck {
    return this.decks[this.activeIndex]
  }

  private get snapshot(): PlaybackSnapshot {
    const element = this.activeDeck.element
    return {
      state: this.state,
      position: Number.isFinite(element.currentTime) ? element.currentTime : 0,
      duration: Number.isFinite(element.duration) ? element.duration : (this.activeDeck.track?.duration ?? 0),
      volume: this.volume,
      muted: this.muted,
      trackId: this.activeDeck.track?.id ?? null
    }
  }

  private createContext({ sampleRate, latencyHint }: OutputOptions): AudioContext {
    return sampleRate > 0
      ? new AudioContext({ sampleRate, latencyHint })
      : new AudioContext({ latencyHint })
  }

  private createAnalyser(): AnalyserNode {
    const analyser = this.context.createAnalyser()
    analyser.fftSize = 2048
    analyser.smoothingTimeConstant = 0.82
    return analyser
  }

  private createEqBands(): BiquadFilterNode[] {
    return EQ_FREQUENCIES.map((frequency, index) => {
      const filter = this.context.createBiquadFilter()
      filter.type =
        index === 0 ? 'lowshelf' : index === EQ_FREQUENCIES.length - 1 ? 'highshelf' : 'peaking'
      filter.frequency.value = frequency
      filter.Q.value = 1.25
      filter.gain.value = this.eqGains[index] ?? 0
      return filter
    })
  }

  private createDeck(): Deck {
    const element = new Audio()
    element.preload = 'auto'
    // The media is served through the equip-media:/equip-sc: protocols which
    // answer with Access-Control-Allow-Origin, so the analyser receives real
    // signal through createMediaElementSource (required for the visualizer).
    element.crossOrigin = 'anonymous'
    const source = this.context.createMediaElementSource(element)
    const gain = this.context.createGain()
    source.connect(gain)
    element.addEventListener('ended', () => this.handleEnded(element))
    element.addEventListener('error', () => {
      if (element === this.activeDeck.element && this.state !== 'idle') {
        this.state = 'error'
        this.emit(true)
      }
    })
    return { element, gain, source, track: null }
  }

  private applyGraph(): void {
    this.decks.forEach((deck) => deck.gain.connect(this.eqBands[0]))
    for (let index = 0; index < this.eqBands.length - 1; index += 1) {
      this.eqBands[index].connect(this.eqBands[index + 1])
    }
    this.eqBands[this.eqBands.length - 1].connect(this.master)
    this.master.connect(this.analyserNode)
    this.analyserNode.connect(this.context.destination)
  }

  private applyMasterGain(): void {
    this.master.gain.setTargetAtTime(
      this.muted ? 0 : this.volume,
      this.context.currentTime,
      0.015
    )
  }

  private prepareDeck(deck: Deck, track: AudioTrack): Promise<void> {
    deck.track = track
    deck.element.src = track.source
    deck.element.load()
    return new Promise((resolve, reject) => {
      const ready = (): void => {
        cleanup()
        resolve()
      }
      const failed = (): void => {
        cleanup()
        reject(new Error(`Unable to load ${track.source}`))
      }
      const cleanup = (): void => {
        deck.element.removeEventListener('canplay', ready)
        deck.element.removeEventListener('error', failed)
      }
      deck.element.addEventListener('canplay', ready, { once: true })
      deck.element.addEventListener('error', failed, { once: true })
    })
  }

  private stopDeck(deck: Deck): void {
    deck.element.pause()
    deck.element.removeAttribute('src')
    deck.element.load()
    deck.track = null
    deck.gain.gain.cancelScheduledValues(this.context.currentTime)
    deck.gain.gain.value = 0
  }

  private startPositionUpdates(): void {
    const update = (): void => {
      if (this.state === 'playing') {
        this.maybeStartTransition()
        this.emit(false)
      }
      this.animationFrame = requestAnimationFrame(update)
    }
    this.animationFrame = requestAnimationFrame(update)
  }

  private maybeStartTransition(): void {
    if (this.transitionStarted || this.queuedIndex === null) return
    const current = this.activeDeck.element
    if (!Number.isFinite(current.duration)) return
    const remaining = current.duration - current.currentTime
    const fadeDuration = Math.min(this.crossfadeSeconds, current.duration / 2)
    if (remaining > Math.max(0.08, fadeDuration)) return
    void this.transition(fadeDuration)
  }

  private async transition(duration: number): Promise<void> {
    if (this.queuedIndex === null) return
    this.transitionStarted = true
    const outgoing = this.activeDeck
    const incomingIndex = this.queuedIndex
    const incoming = this.decks[incomingIndex]

    incoming.element.currentTime = 0
    try {
      await incoming.element.play()
    } catch {
      this.transitionStarted = false
      this.queuedIndex = null
      return
    }

    // Schedule against the clock *after* play() resolves: awaiting it can take
    // several frames, and a start time in the past truncates the curve.
    const now = this.context.currentTime
    outgoing.gain.gain.cancelScheduledValues(now)
    incoming.gain.gain.cancelScheduledValues(now)

    if (duration > 0) {
      const { fadeOut, fadeIn } = fadeCurves(FADE_STEPS)
      outgoing.gain.gain.setValueCurveAtTime(fadeOut, now, duration)
      incoming.gain.gain.setValueCurveAtTime(fadeIn, now, duration)
    } else {
      outgoing.gain.gain.setValueAtTime(0, now)
      incoming.gain.gain.setValueAtTime(1, now)
    }

    this.activeIndex = incomingIndex
    this.queuedIndex = null
    this.state = 'playing'
    this.emit(true)
    window.setTimeout(
      () => {
        this.stopDeck(outgoing)
        this.transitionStarted = false
        this.emit(true)
      },
      duration * 1000 + 60
    )
  }

  private handleEnded(element: HTMLAudioElement): void {
    if (element !== this.activeDeck.element || this.transitionStarted) return
    if (this.queuedIndex !== null) {
      void this.transition(0)
      return
    }
    this.state = 'ended'
    this.emit(true)
  }

  private emit(force: boolean): void {
    const now = performance.now()
    if (!force && now - this.lastEmit < POSITION_TICK_MS) return
    this.lastEmit = now
    const snapshot = this.snapshot
    this.listeners.forEach((listener) => listener(snapshot))
  }
}
