import { app, BrowserWindow } from 'electron'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

/**
 * Headless verification pass. `npm run smoke` builds the app, launches it with
 * EQUIP_SMOKE=1 and drives the real renderer through its own store and IPC
 * bridge: it mounts the UI, scans a generated WAV, plays it, exercises the EQ
 * and crossfade engine, persists a playlist, opens the pop-out window, and
 * checks the SoundCloud surface (bridge, CSP, settings — all offline).
 * With `npm run smoke:live` it additionally streams and downloads a real
 * SoundCloud track. Exits non-zero if any check fails.
 */

type Step = { name: string; ok: boolean; detail: string }

const steps: Step[] = []
const active = process.env.EQUIP_SMOKE === '1'

let profileDir = ''

/**
 * Points the Electron profile at a throwaway directory. The run scans, edits
 * and clears library and playlist files as part of its checks, so it must never
 * resolve `userData` to the real profile. Call before anything reads it.
 */
export function prepareSmokeProfile(): void {
  profileDir = mkdtempSync(join(tmpdir(), 'equip-smoke-profile-'))
  app.setPath('userData', profileDir)
  app.setPath('sessionData', join(profileDir, 'session'))
}

function cleanupSmokeProfile(): void {
  if (!profileDir) return
  // Chromium can still hold locks on the session directory at this point, so
  // the removal is best-effort: tmp cleaners handle the rest.
  try {
    rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
  } catch {
    // Ignored — the directory is under the OS temp root.
  }
  profileDir = ''
}


function record(name: string, ok: boolean, detail: string): void {
  steps.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  [${detail}]` : ''}`)
}

function probe<T>(window: BrowserWindow, script: string): Promise<T> {
  return window.webContents.executeJavaScript(script, true) as Promise<T>
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function whenLoaded(window: BrowserWindow): Promise<void> {
  if (window.webContents.isLoading()) {
    await new Promise<void>((resolve) => window.webContents.once('did-finish-load', () => resolve()))
  }
}

/** Minimal 16-bit PCM WAV: fills a tone at 440 Hz for `seconds`. */
function buildToneWav(seconds: number, sampleRate: number): Buffer {
  const frames = Math.floor(seconds * sampleRate)
  const dataBytes = frames * 2
  const buffer = Buffer.alloc(44 + dataBytes)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataBytes, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataBytes, 40)
  for (let frame = 0; frame < frames; frame += 1) {
    const value = Math.sin((2 * Math.PI * 440 * frame) / sampleRate) * 0.35
    buffer.writeInt16LE(Math.round(value * 32767), 44 + frame * 2)
  }
  return buffer
}

/**
 * Networked SoundCloud verification, enabled with `npm run smoke:live`.
 * Searches the real API, streams the first result through the equip-sc://
 * protocol and the real renderer, and writes an offline download into the
 * scratch dir. Skipped by the default smoke so CI stays offline-deterministic.
 */
async function runLiveSoundCloudChecks(window: BrowserWindow, scratch: string): Promise<void> {
  // The surface check above stores a fake client id; restore the working
  // default and point downloads at the throwaway scratch dir.
  await probe(
    window,
    `window.equip.soundcloud.settingsSet({ clientId: '', offlineDir: ${JSON.stringify(scratch)} })`
  )

  const found = await probe<{ count: number; first: { id: number; title: string } | null }>(
    window,
    `window.equip.soundcloud.search('ambient', 8).then((tracks) => ({
      count: tracks.length,
      first: tracks[0] ? { id: tracks[0].scId, title: tracks[0].title } : null
    }))`
  )
  record('soundcloud search returns tracks', found.count > 0 && Boolean(found.first), `${found.count} result(s)`)
  if (!found.first) return

  const id = found.first.id
  // Materialize the results into the real library AND the live store, exactly
  // like the SoundCloud view does when a track is played.
  const injected = await probe<{ added: boolean; url: string; title: string }>(
    window,
    `(async () => {
      const primary = await window.equip.soundcloud.search('ambient', 8)
      const library = await window.equip.soundcloud.add(primary)
      window.__equipStore.setState({ library })
      const track = library.find((t) => t.id === 'sc' + ${id})
      return { added: Boolean(track), url: track?.url ?? 'none', title: track?.title ?? '' }
    })()`
  )
  record('soundcloud track enters the library', injected.added, `id=sc${id} (${injected.title})`)

  const streamed = await probe<{ ok: boolean; bytes: number; type: string }>(
    window,
    `fetch('equip-sc://stream/' + ${id}).then((r) =>
      r.arrayBuffer().then((buf) => ({ ok: r.ok, bytes: buf.byteLength, type: r.headers.get('content-type') ?? '' }))
    ).catch((e) => ({ ok: false, bytes: 0, type: String(e) }))`
  )
  record(
    'stream serves audio over equip-sc://',
    streamed.ok && streamed.bytes > 4096,
    `${streamed.bytes} bytes, ${streamed.type}`
  )

  const art = await probe<{ ok: boolean; type: string; bytes: number }>(
    window,
    `fetch('equip-sc://artwork/' + ${id}).then((r) =>
      r.arrayBuffer().then((buf) => ({ ok: r.ok, type: r.headers.get('content-type') ?? '', bytes: buf.byteLength }))
    ).catch((e) => ({ ok: false, type: String(e), bytes: 0 }))`
  )
  record('artwork serves through equip-sc://', art.ok && art.type.startsWith('image/'), `${art.bytes} bytes, ${art.type}`)

  const played = await probe<{ state: string; position: number }>(
    window,
    `(async () => {
      const store = window.__equipStore
      const track = store.getState().library.find((t) => t.id === 'sc' + ${id})
      if (!track) return { state: 'missing', position: 0 }
      await store.getState().playTrack(track.id, [track.id])
      await new Promise((r) => setTimeout(r, 2500))
      const s = store.getState().snapshot
      return { state: s.state, position: s.position }
    })()`
  )
  record('soundcloud track streams in the player', played.state === 'playing' && played.position > 0, `state=${played.state} pos=${played.position.toFixed(1)}s`)

  const downloaded = await probe<{ done: boolean; saved: boolean; path: string }>(
    window,
    `window.equip.soundcloud.download(${id}).then((result) => {
      const saved = result.library.some((t) => t.id === 'sc' + ${id} && t.path)
      return { done: true, saved, path: result.filePath }
    }).catch((e) => ({ done: false, saved: false, path: String(e) }))`
  )
  record(
    'soundcloud download saves an offline file',
    downloaded.done && downloaded.saved,
    downloaded.path.slice(-60)
  )

  // Paste-a-link path: a permalink from the track we already have resolves back
  // to a playable track through the same resolve API the link box uses.
  const resolved = await probe<{ kind: string; id: number | null }>(
    window,
    `(async () => {
      const track = window.__equipStore.getState().library.find((t) => t.id === 'sc' + ${id})
      if (!track || !track.remote?.permalinkUrl) return { kind: 'none', id: null }
      const result = await window.equip.soundcloud.resolve(track.remote.permalinkUrl)
      return { kind: result?.kind ?? 'none', id: result?.kind === 'track' ? result.track.scId : null }
    })()`
  )
  record(
    'a pasted soundcloud.com link resolves to the same track',
    resolved.kind === 'track' && resolved.id === id,
    `kind=${resolved.kind} id=${resolved.id}`
  )
}

export function runSmokeTest(
  getWindow: () => BrowserWindow,
  openMiniWindow: () => void,
  getMiniWindow: () => BrowserWindow | null
): void {
  if (!active) return
  const startedAt = Date.now()

  app.whenReady().then(async () => {
    const window = getWindow()
    const scratch = await mkdtemp(join(tmpdir(), 'equip-smoke-'))

    try {
      await whenLoaded(window)
      await wait(1200)

      const ui = await probe<{
        shell: boolean
        title: string
        hasBridge: boolean
        accent: string
        csp: string | null
        storeReady: boolean
      }>(window, `(() => {
        const store = window.__equipStore
        return {
          shell: Boolean(document.querySelector('.app-shell')),
          title: document.title,
          hasBridge: typeof window.equip === 'object' && typeof window.equip.library?.get === 'function',
          accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
          csp: document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null,
          storeReady: Boolean(store && typeof store.getState === 'function')
        }
      })()`)

      record('renderer mounts the app shell', ui.shell, `title="${ui.title}"`)
      record('preload bridge is exposed', ui.hasBridge, 'window.equip.library.get')
      record('player store is reachable', ui.storeReady, 'window.__equipStore')
      record('theme variables are applied', ui.accent.startsWith('#'), `--accent=${ui.accent}`)
      record('content security policy is present', Boolean(ui.csp), ui.csp ? `${ui.csp.slice(0, 40)}…` : 'missing')

      const wav = join(scratch, 'Smoke Tone.wav')
      // Long enough that the tone is still playing when the pop-out window
      // opens at the end of the run — a 2.5 s fixture used to hit 'ended' and
      // make the last check race-dependent.
      await writeFile(wav, buildToneWav(45, 44100))

      const scan = await probe<{ count: number; title: string; url: string; rows: number }>(
        window,
        `(async () => {
          const store = window.__equipStore
          const library = await store.getState().addPaths([${JSON.stringify(wav)}])
          // The list renders through React; give the commit a moment to land.
          await new Promise((r) => setTimeout(r, 700))
          return {
            count: library.length,
            title: library[0]?.title ?? 'none',
            url: library[0]?.url ?? 'none',
            rows: document.querySelectorAll('.track-row').length - 1
          }
        })()`
      )
      record('library scan finds the file', scan.count >= 1, `${scan.count} track(s), title="${scan.title}"`)
      record('track is served over equip-media://', scan.url.startsWith('equip-media://'), scan.url.slice(0, 30))
      record('track list renders the track', scan.rows >= 1, `${scan.rows} row(s)`)

      const playback = await probe<{
        state: string
        first: number
        second: number
        sampleRate: number
        contextState: string
      }>(
        window,
        `(async () => {
          const store = window.__equipStore
          const track = store.getState().library[0]
          await store.getState().playTrack(track.id, [track.id])
          await new Promise((r) => setTimeout(r, 800))
          const first = store.getState().snapshot.position
          await new Promise((r) => setTimeout(r, 800))
          const snapshot = store.getState().snapshot
          return {
            state: snapshot.state,
            first,
            second: snapshot.position,
            sampleRate: store.getState().backend.sampleRate,
            contextState: store.getState().backend.contextState
          }
        })()`
      )
      record('audio context is running', playback.contextState === 'running', `${playback.contextState} @ ${playback.sampleRate} Hz`)
      record('playback reaches the playing state', playback.state === 'playing', `state=${playback.state}`)
      record(
        'playback position advances',
        playback.second > playback.first && playback.second > 0,
        `${playback.first.toFixed(2)}s -> ${playback.second.toFixed(2)}s`
      )

      const dsp = await probe<{ gains: number[]; crossfade: number; before: number; after: number; restored: number; state: string }>(
        window,
        `(async () => {
          const store = window.__equipStore
          const backend = store.getState().backend
          backend.setEqualizer([6, 4, 2, 0, -2, 0, 2, 4, 6, 6])
          const before = backend.sampleRate
          await backend.setOutputSampleRate(96000)
          const after = backend.sampleRate
          await backend.setOutputSampleRate(0)
          store.getState().setCrossfade(15)
          return {
            gains: backend.equalizerGains,
            crossfade: store.getState().crossfadeSeconds,
            before,
            after,
            restored: backend.sampleRate,
            state: store.getState().snapshot.state
          }
        })()`
      )
      record('equalizer applies all 10 bands', dsp.gains.length === 10 && dsp.gains[0] === 6 && dsp.gains[4] === -2, `gains=[${dsp.gains.join(', ')}]`)
      record('crossfade accepts the 15 second maximum', dsp.crossfade === 15, `${dsp.crossfade}s`)
      record(
        'output sample rate switches to 96 kHz',
        dsp.after === 96000,
        `${dsp.before} Hz -> ${dsp.after} Hz`
      )
      record(
        'switching back to auto restores the device rate and keeps playing',
        dsp.restored === dsp.before && dsp.state === 'playing',
        `restored ${dsp.restored} Hz, state=${dsp.state}`
      )

      const playlist = await probe<{ name: string; saved: number }>(
        window,
        `(async () => {
          const store = window.__equipStore
          const track = store.getState().library[0]
          const id = await store.getState().createPlaylist('Smoke Test', track.id)
          await store.getState().addToPlaylist(id, track.id)
          const stored = await window.equip.playlists.get()
          const found = stored.find((p) => p.id === id)
          return { name: found?.name ?? 'missing', saved: found?.trackIds.length ?? 0 }
        })()`
      )
      record('playlist persists to disk', playlist.name === 'Smoke Test' && playlist.saved === 1, `"${playlist.name}" with ${playlist.saved} track`)

      openMiniWindow()
      await wait(1600)
      const mini = getMiniWindow()
      let miniTitle = 'no window'
      let mainHeld: string | null = 'unreachable'
      let miniPull: string | null = 'unreachable'
      if (mini) {
        await whenLoaded(mini)
        await wait(400)
        // The mini mounts, pulls the latest state and re-renders; poll briefly
        // so a slow first commit does not flake the assertion.
        for (let attempt = 0; attempt < 10; attempt += 1) {
          miniTitle = await probe<string>(
            mini,
            `document.querySelector('.mini-info strong')?.textContent ?? 'none'`
          )
          if (miniTitle.includes('Smoke Tone')) break
          await wait(250)
        }
        miniPull = await probe<string | null>(
          mini,
          `window.equip.mini.getState().then((s) => (s ? s.title : null))`
        )
      }
      mainHeld = await probe<string | null>(
        window,
        `window.equip.mini.getState().then((s) => (s ? s.title : null))`
      )
      record(
        'pop-out window opens and mirrors now playing',
        Boolean(mini) && miniTitle.includes('Smoke Tone'),
        `title="${miniTitle}" (main holds "${mainHeld}", mini pulls "${miniPull}")`
      )
      mini?.close()

      // ---- SoundCloud surface (no network required) -----------------------
      const scSurface = await probe<{ api: boolean; csp: string | null; settings: string }>(
        window,
        `(async () => {
          const api = Boolean(
            window.equip.soundcloud &&
            typeof window.equip.soundcloud.search === 'function' &&
            typeof window.equip.soundcloud.add === 'function' &&
            typeof window.equip.soundcloud.download === 'function' &&
            typeof window.equip.soundcloud.settingsGet === 'function' &&
            typeof window.equip.soundcloud.onProgress === 'function'
          )
          const csp = document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.content ?? null
          const before = await window.equip.soundcloud.settingsGet()
          const after = await window.equip.soundcloud.settingsSet({ clientId: 'smoke-client-id' })
          const settings = after.clientId === 'smoke-client-id' ? 'round-trip ok' : 'round-trip failed'
          return { api, csp, settings }
        })()`
      )
      record('soundcloud bridge is exposed', scSurface.api, 'window.equip.soundcloud.search/add/download')
      record('CSP permits equip-sc: streams and artwork', Boolean(scSurface.csp?.includes('equip-sc:')), 'equip-sc: in img/media/connect-src')
      record('SoundCloud settings persist', scSurface.settings === 'round-trip ok', scSurface.settings)

      if (process.env.EQUIP_SC_LIVE === '1') {
        await runLiveSoundCloudChecks(window, scratch)
      }
    } catch (error) {
      record('smoke run completed without exceptions', false, (error as Error).message)
    } finally {
      try {
        await rm(scratch, { recursive: true, force: true })
      } catch {
        // Best effort — the scratch tone dir lives under the OS temp root.
      }
      cleanupSmokeProfile()
    }

    const passed = steps.filter((step) => step.ok).length
    console.log(`\nsmoke: ${passed}/${steps.length} checks passed in ${Date.now() - startedAt}ms`)
    app.exit(passed === steps.length ? 0 : 1)
  })
}
