# Equip

A customizable, high-fidelity music player for Windows with a Vox-like look, real
local playback, a 15-second crossfade engine, an audio-reactive visualizer, a
pop-out now-playing window, a local "Discover" shelf built from your own
library — plus **SoundCloud streaming**: search, trending charts, pasted links,
streamed playback, and offline downloads.

Built with Electron 38 + React 19 + TypeScript (Vite), zustand for state, and
Web Audio for DSP. Your library stays on your disk; SoundCloud is opt-in from
its own view and never requires an account.

---

## Requirements

- Windows 10/11 (x64)
- Node.js 20+ (only needed to build or run from source)

## Run from source

```bash
npm install
npm run dev        # development server with hot reload
```

Production build:

```bash
npm run build
npm run preview
```

## Verify (end-to-end smoke test)

`npm run smoke` builds the app, launches the **real** renderer, generates a tone
WAV, scans it into the library, plays it over the loopback media server
(`http://127.0.0.1:<port>` serving local files and SoundCloud streams with
Range/206 and CORS support) and Web Audio, and then:

- checks that the UI shell, preload bridge, theme and CSP are live,
- exercises the 10-band EQ, the 15 s crossfade setting, and output sample-rate
  switching (44.1/48/96/192 kHz) while keeping playback running,
- persists a playlist to disk,
- opens the pop-out now-playing window and confirms it mirrors the track,
- checks the SoundCloud surface is present (bridge, `equip-sc:` CSP, settings
  round-trip) without touching the network.

```
smoke: 23/23 checks passed
```

With a network connection, `npm run smoke:live` additionally streams and
downloads a **real** SoundCloud track — search, library insert, the SoundCloud
stream proxy, artwork proxy, in-player playback, offline download,
and pasted-link resolution:

```
PASS  soundcloud search returns tracks            [8 result(s)]
PASS  soundcloud track enters the library         [id=sc2324995076]
PASS  stream serves audio over the media server   [2396247 bytes, audio/mpeg]
PASS  artwork serves through the media server     [6577 bytes, image/jpeg]
PASS  soundcloud track streams in the player      [state=playing pos=2.5s]
PASS  soundcloud download saves an offline file   [...mp3]
PASS  a pasted soundcloud.com link resolves       [kind=track id=2324995076]
smoke: 30/30 checks passed
```

Both runs use a throwaway Chromium profile, so they can never touch your real
library or playlists.

## Package an installer

```bash
npm run dist
```

Produces `dist/Equip Setup 0.1.0.exe` (NSIS) and an unpacked build under
`dist/win-unpacked`. Windows is the supported packaging target; the macOS and
Linux targets in `electron-builder.json` are not covered by CI or icons
(`icon.icns` is not shipped).

## Feature list

Verified by the smoke test above unless noted:

| Feature | How |
| --- | --- |
| Local library | Add folders (recursively scanned) or drag-and-drop files/folders. Reads FLAC, ALAC, M4A, MP3, WAV, AIFF, OGG, Opus, WMA via `music-metadata`. Artwork embedded in files is shown (oversized art is skipped). |
| Playback | Two <audio> decks with prime-ahead queuing; seek, volume, mute, shuffle, repeat (off/all/one). |
| Crossfade | Up to 15 s, equal-power exponential curves; 0 = gapless. |
| HD output | Output sample rate Auto/44.1/48/96/192 kHz; switching rebuilds the graph and restores position — avoids Windows' resampler when set to the source rate. |
| 10-band EQ | Low/high shelf + peaking filters, ±12 dB, presets (Flat, Bass boost, Vocal, Treble, Loudness). |
| Visualizer | Bars / wave / radial, live from the analyser, opacity control, sits behind every view. |
| Now-playing pop-out | Always-on-top mini window with dock-back, play/pause/next/prev, artwork; driven by the main window with a state-replay protocol that never shows a blank frame. |
| Discover | Local shelves — recently added, top artists, long cuts (8+ min) — played as playback contexts. |
| Playlists | Create/rename/delete, add-to-playlist from any row, persisted to disk. |
| UI options | 6 accent colors + custom picker, window transparency, background blur, layout density, visualizer mode. |
| Keyboard | Space/K play, ←/→ seek (±5 s, +Shift = 30 s), ↑/↓ volume, N/P next/prev, M mute, S shuffle, R repeat, Q queue, Esc close panels. |
| SoundCloud streaming | Search, "trending" chart, quick genre chips, paste-a-link (track or set), streamed playback over the local media server — seeks, crossfades, and feeds the visualizer like any local file. Stream-only tracks live in the library and work with playlists, the queue and the pop-out. |
| Offline downloads | Per-track download to a folder you choose (default `Music\Equip Downloads`) as 128 kbps MP3; downloaded tracks become normal local library tracks. Live download progress, per-track "saved offline" state. |
| System | Frameless transparent window, tray icon with play control, media keys, crash diagnostics. |

## SoundCloud — how it works, honestly

SoundCloud stopped issuing new **official API keys** years ago, so this player
uses the same public, unauthenticated `client_id` that soundcloud.com's own web
app bakes into its front-end bundles. That key is:

- **unofficial** — SoundCloud can change or invalidate it at any time,
- **replaceable** — Settings → SoundCloud lets you paste a fresh `client_id`
  (find one in the current soundcloud.com web bundles) and includes a "Test
  connection" button,
- **account-free** — no login, no likes/comments/reposts, and no
  Go+/subscriber quality. Streams top out at the public 128 kbps MP3 that
  SoundCloud serves unauthenticated.

All API calls, stream proxying and artwork proxying happen in the Electron main
process (renderer never sees the key) and are served to the renderer by a
loopback HTTP server on `http://127.0.0.1:<port>` with the same CORS/range
behavior for local files.

## Honest limitations

These are **not implemented**, and that is deliberate — they require resources
the project does not have:

- **SoundCloud social/account features.** Liking, commenting, following and
  download-quality streams require a signed-in SoundCloud account; Equip is
  deliberately anonymous.
- **Higher streaming tiers.** SoundCloud's unauthenticated single-file stream is
  128 kbps MP3. Offline downloads use that same quality. The HD output pipeline
  (Auto/44.1/48/96/192 kHz, no Windows resampler) applies to playback of any
  source, but it cannot add bits that the provider did not encode.
- **Bit-perfect WASAPI-exclusive and ASIO output.** Web Audio cannot do
  exclusive-mode or ASIO audio. The `AudioBackend` interface is designed so a
  native module (e.g. WASAPI via a Node addon) can be plugged in later; the
  Settings drawer says so and uses "Shared" mode today.
- **Mac/Linux packaging.** Not built or tested here.

## Architecture

```
src/main           Electron main: window lifecycle, IPC, tray, media keys,
                   loopback media server (http://127.0.0.1) serving local files
                   + proxying SoundCloud streams/artwork with Range + CORS,
                   legacy equip-media:// + equip-sc:// protocol fallbacks,
                   library v2 JSON persistence, SoundCloud client
                   (search/charts/resolve/stream/download), smoke runner
src/preload        sandboxed contextBridge surface (window.equip)
src/renderer/src
  audio/           AudioBackend interface + WebAudioBackend (decks, crossfade,
                   EQ graph, sample-rate rebuild) + honest NativeAudioBackend stub
  state/           zustand stores: playerStore (library, queue, playback),
                   uiStore (theme, EQ, output rate, sort — persisted),
                   soundcloudStore (trending/search/link results, live downloads)
  components/      Library, Playlists, Discover, SoundCloudView, PlayerBar,
                   Queue, Settings, TrackList, AddToPlaylistMenu, Visualizer
src/renderer/mini.tsx   the pop-out now-playing window (its own entry)
```

The main/pop-out windows exchange playback state over `playback:update` /
`playback:state`, with a `playback:getState` invocation so a freshly opened
mini-window always pulls the latest now-playing state on mount.

All audio and artwork reach the renderer through a loopback HTTP server
(main process, ephemeral port, `Access-Control-Allow-Origin: *`), so the Web
Audio analyser (visualizer/EQ) sees the real signal for remote and local
playback alike:

- `http://127.0.0.1:<port>/local/<url-encoded absolute path>` serves local
  files with Range/206 seeking.
- `http://127.0.0.1:<port>/sc/stream/<scId>` and
  `http://127.0.0.1:<port>/sc/artwork/<scId>` proxy SoundCloud streams
  (following the signed CDN redirect, preserving Range/206 seeks) and artwork
  through a 20-minute signed-URL cache.

Tracks are stored with logical URLs (`equip-media://local/...`,
`equip-sc://stream|artwork/<scId>`) in the library JSON; the main process maps
them to live loopback URLs at every IPC boundary. The custom protocols remain
registered as a fallback for direct navigation, but the renderer loads media
exclusively over loopback HTTP — plain loopback HTTP is immune to the
custom-scheme CORS load failures some OS/Chromium combinations produce.

## License

Private project — © 2026 BGS Studios.