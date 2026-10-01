import { app, dialog, net } from 'electron'
import { createWriteStream } from 'node:fs'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { upsertDownloadedTrack, type LibraryTrack } from './library'

export const SC_SCHEME = 'equip-sc'

const API_ROOT = 'https://api-v2.soundcloud.com'
const MAX_STREAM_AGE_MS = 20 * 60 * 1000

/**
 * SoundCloud stopped issuing new API keys, so this client uses the same
 * unauthenticated `client_id` that soundcloud.com's own web app bakes into its
 * bundles. It is public but unofficial and can stop working at any time — the
 * value lives in the settings file and can be replaced from Settings → SoundCloud.
 */
const DEFAULT_CLIENT_ID = '3S7oLyCj5BwyR9w2KU2LQQGDwRda5EZ0'

export interface RemoteTrack {
  scId: number
  title: string
  artist: string
  album: string
  durationSeconds: number
  artworkUrl: string | null
  permalinkUrl: string | null
  streamable: boolean
}

export interface ScSet {
  id: number
  title: string
  creator: string
  tracks: RemoteTrack[]
}

export interface ScSettings {
  clientId: string
  offlineDir: string
}

export type ScResolveResult =
  | { kind: 'track'; track: RemoteTrack }
  | { kind: 'set'; set: ScSet }

export interface DownloadProgress {
  scId: number
  received: number
  total: number
  phase: 'connecting' | 'downloading' | 'done'
}

interface TrackJson {
  id: number
  title: string
  user?: { username?: string }
  label_name?: string | null
  duration?: number
  artwork_url?: string | null
  permalink_url?: string
  streamable?: boolean
  track_authorization?: string
  media?: {
    transcodings?: Array<{
      url: string
      format?: { protocol?: string; mime_type?: string }
      preset?: string
    }>
  }
}

interface PlaylistJson {
  id: number
  title: string
  user?: { username?: string }
  tracks?: TrackJson[]
  track_count?: number
}

interface TranscodingJson {
  url: string
  format?: { protocol?: string; mime_type?: string }
  preset?: string
}

function settingsFile(): string {
  return join(app.getPath('userData'), 'soundcloud.json')
}

async function loadSettings(): Promise<ScSettings> {
  try {
    if (existsSync(settingsFile())) {
      const parsed = JSON.parse(await readFile(settingsFile(), 'utf-8')) as Partial<ScSettings>
      return {
        clientId: parsed.clientId?.trim() || DEFAULT_CLIENT_ID,
        offlineDir: parsed.offlineDir?.trim() || defaultOfflineDir()
      }
    }
  } catch {
    // Fall through to defaults — corrupted settings should not block the app.
  }
  return { clientId: DEFAULT_CLIENT_ID, offlineDir: defaultOfflineDir() }
}

async function saveSettings(settings: ScSettings): Promise<void> {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await writeFile(settingsFile(), JSON.stringify(settings), 'utf-8')
}

export async function getSettings(): Promise<ScSettings> {
  return loadSettings()
}

export async function setSettings(patch: Partial<ScSettings>): Promise<ScSettings> {
  const next = { ...(await loadSettings()), ...patch }
  if (next.clientId?.trim()) next.clientId = next.clientId.trim()
  await saveSettings(next)
  return next
}

export async function pickOfflineFolder(): Promise<string> {
  const result = await dialog.showOpenDialog({
    title: 'Where should downloaded SoundCloud tracks be saved?',
    properties: ['openDirectory', 'createDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return (await loadSettings()).offlineDir
  const offlineDir = result.filePaths[0]
  await saveSettings({ ...(await loadSettings()), offlineDir })
  return offlineDir
}

function defaultOfflineDir(): string {
  try {
    return join(app.getPath('music'), 'Equip Downloads')
  } catch {
    return join(app.getPath('userData'), 'Downloads')
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await net.fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`SoundCloud request failed (${response.status}) — the client ID may be out of date. Open Settings → SoundCloud to update it.`)
  }
  const text = await response.text()
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('SoundCloud returned malformed data — the API may have changed.')
  }
}

async function apiGet<T>(path: string): Promise<T> {
  const clientId = (await loadSettings()).clientId
  const separator = path.includes('?') ? '&' : '?'
  return fetchJson<T>(`${API_ROOT}${path}${separator}client_id=${encodeURIComponent(clientId)}`)
}

function toRemoteTrack(json: TrackJson): RemoteTrack {
  // Any track the app ever maps (search, trending, resolved link, stream) is
  // remembered so the equip-sc://artwork proxy can serve its thumbnail later.
  artworkCache.set(json.id, json.artwork_url ?? null)
  return {
    scId: json.id,
    title: (json.title || 'Untitled track').trim(),
    artist: json.user?.username?.trim() || 'Unknown artist',
    album: json.label_name?.trim() || 'SoundCloud',
    durationSeconds: Math.max(1, Math.round((json.duration ?? 0) / 1000)),
    artworkUrl: json.artwork_url || null,
    permalinkUrl: json.permalink_url || null,
    streamable: json.streamable !== false
  }
}

/** Trending/most-played chart from SoundCloud's own charts endpoint. */
export async function trending(limit = 30): Promise<RemoteTrack[]> {
  const data = await apiGet<{ collection?: Array<{ track?: TrackJson }> }>(
    `/charts?kind=trending&genre=soundcloud:genres:all-music&limit=${limit}`
  )
  return (data.collection ?? [])
    .map((item) => (item.track ? toRemoteTrack(item.track) : null))
    .filter((track): track is RemoteTrack => Boolean(track))
    .slice(0, limit)
}

export async function searchTracks(query: string, limit = 30): Promise<RemoteTrack[]> {
  const q = query.trim()
  if (!q) return trending(limit)
  const data = await apiGet<{ collection?: TrackJson[] }>(
    `/search/tracks?q=${encodeURIComponent(q)}&limit=${limit}`
  )
  return (data.collection ?? []).map(toRemoteTrack).slice(0, limit)
}

/** Resolves a soundcloud.com track or set URL pasted by the user. */
export async function resolveUrl(rawUrl: string): Promise<ScResolveResult | null> {
  const target = rawUrl.includes('://') ? rawUrl : `https://soundcloud.com/${rawUrl}`
  if (!/^https:\/\/(www\.)?soundcloud\.com\//i.test(target)) return null
  const data = await apiGet<unknown>(`/resolve?url=${encodeURIComponent(target)}`)
  const item = data as { kind?: string } & Partial<TrackJson> & Partial<PlaylistJson>
  if (item.kind === 'track' || (item.media && typeof item.id === 'number')) {
    return { kind: 'track', track: toRemoteTrack(item as TrackJson) }
  }
  if (item.kind === 'playlist' || Array.isArray(item.tracks)) {
    if (!Array.isArray(item.tracks) || item.tracks.length === 0) {
      return null
    }
    return {
      kind: 'set',
      set: {
        id: item.id ?? 0,
        title: item.title || 'SoundCloud set',
        creator: item.user?.username?.trim() || 'Unknown artist',
        tracks: item.tracks.map(toRemoteTrack)
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Stream resolution and artwork, plus the small caches the equip-sc://
// protocol leans on so the renderer never needs an API key.
// ---------------------------------------------------------------------------

const trackCache = new Map<number, TrackJson>()
const streamCache = new Map<number, { url: string; expiresAt: number }>()
const artworkCache = new Map<number, string | null>()

async function fetchTrack(scId: number): Promise<TrackJson> {
  const cached = trackCache.get(scId)
  if (cached) return cached
  const track = await apiGet<TrackJson>(`/tracks/${scId}`)
  trackCache.set(scId, track)
  artworkCache.set(scId, track.artwork_url ?? null)
  return track
}

function pickProgressive(transcodings: TranscodingJson[]): TranscodingJson | null {
  const progressive = transcodings.filter(
    (item) => item.format?.protocol === 'progressive' && item.format?.mime_type?.startsWith('audio/mpeg')
  )
  if (progressive.length === 0) return null
  // Prefer the transcoding whose preset advertises the highest bitrate
  // (mp3_0_1 / mp3_standard / mp3_1_0). Last is usually the best.
  const bitrate = (item: TranscodingJson): number => Number.parseInt((item.preset ?? '').replace(/\D/g, ''), 10) || 0
  return [...progressive].sort((a, b) => bitrate(a) - bitrate(b)).pop() ?? progressive[0]
}

/** Returns the signed playable URL for a track, cached for a few minutes. */
export async function resolveStreamUrl(scId: number): Promise<string> {
  const cached = streamCache.get(scId)
  if (cached && cached.expiresAt > Date.now()) return cached.url

  const track = await fetchTrack(scId)
  const transcoding = pickProgressive(track.media?.transcodings ?? [])
  if (!transcoding) throw new Error('This track has no streamable MP3 transcoding on SoundCloud.')

  const clientId = (await loadSettings()).clientId
  const separator = transcoding.url.includes('?') ? '&' : '?'
  const authorization = track.track_authorization ? `&track_authorization=${encodeURIComponent(track.track_authorization)}` : ''
  const media = await fetchJson<{ url?: string }>(
    `${transcoding.url}${separator}client_id=${encodeURIComponent(clientId)}${authorization}`
  )
  if (!media.url) throw new Error('SoundCloud could not produce a stream for this track.')

  streamCache.set(scId, { url: media.url, expiresAt: Date.now() + MAX_STREAM_AGE_MS })
  return media.url
}

export function getArtworkUrl(scId: number): string | null {
  return artworkCache.get(scId) ?? null
}

/** Like getArtworkUrl, but resolves the track once if the artwork was never
 * seen (e.g. a stream-only library track on a fresh launch). */
export async function resolveArtworkUrl(scId: number): Promise<string | null> {
  const known = getArtworkUrl(scId)
  if (known) return known
  try {
    const track = await fetchTrack(scId)
    return track.artwork_url ?? null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Offline downloads
// ---------------------------------------------------------------------------

function sanitizeFileName(name: string): string {
  const cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim()
  return cleaned.slice(0, 140) || 'track'
}

async function uniquePath(dir: string, artist: string, title: string): Promise<string> {
  const base = join(dir, `${sanitizeFileName(artist)} - ${sanitizeFileName(title)}`)
  if (!existsSync(`${base}.mp3`)) return `${base}.mp3`
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${base} (${index}).mp3`
    if (!existsSync(candidate)) return candidate
  }
  return `${base} ${Date.now()}.mp3`
}

/**
 * Streams a SoundCloud track to disk as an MP3 (~128 kbps — the best
 * unauthenticated quality SoundCloud offers as a single file). The renderer
 * is told the receiving library so it can keep its copy in sync.
 */
export async function downloadTrack(
  scId: number,
  onProgress: (progress: DownloadProgress) => void
): Promise<{ library: LibraryTrack[]; filePath: string; title: string; artist: string }> {
  const track = await fetchTrack(scId)
  if (!track.streamable) throw new Error('This track is not streamable.')
  const remote = toRemoteTrack(track)

  const settings = await loadSettings()
  if (!existsSync(settings.offlineDir)) await mkdir(settings.offlineDir, { recursive: true })
  const finalPath = await uniquePath(settings.offlineDir, remote.artist, remote.title)
  const tempPath = `${finalPath}.part`

  onProgress({ scId, received: 0, total: 0, phase: 'connecting' })
  const signed = await resolveStreamUrl(scId)
  const response = await net.fetch(signed)
  if (!response.ok || !response.body) {
    throw new Error(`SoundCloud stream failed (${response.status}).`)
  }
  const total = Number(response.headers.get('content-length')) || 0

  const out = createWriteStream(tempPath, { flags: 'w' })
  const reader = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream<Uint8Array>)
  let received = 0
  let lastTick = 0
  reader.on('data', (chunk: Buffer) => {
    received += chunk.length
    const now = Date.now()
    if (now - lastTick > 120) {
      lastTick = now
      onProgress({ scId, received, total, phase: 'downloading' })
    }
  })
  try {
    await pipeline(reader, out)
  } catch (error) {
    out.destroy()
    await unlink(tempPath).catch(() => undefined)
    throw new Error(`Download failed while writing to ${tempPath}: ${(error as Error).message}`)
  }
  await rename(tempPath, finalPath)

  const library = await upsertDownloadedTrack(
    {
      scId: remote.scId,
      title: remote.title,
      artist: remote.artist,
      album: remote.album,
      durationSeconds: remote.durationSeconds,
      permalinkUrl: remote.permalinkUrl ?? undefined,
      artworkUrl: remote.artworkUrl ?? undefined
    },
    finalPath
  )
  onProgress({ scId, received, total, phase: 'done' })
  return { library, filePath: finalPath, title: remote.title, artist: remote.artist }
}

// ---------------------------------------------------------------------------
// Remote (stream-only) track records for the library
// ---------------------------------------------------------------------------

export function remoteToLibraryTrack(remote: RemoteTrack): LibraryTrack {
  return {
    id: scTrackId(remote.scId),
    path: '',
    url: `${SC_SCHEME}://stream/${remote.scId}`,
    title: remote.title,
    artist: remote.artist,
    album: remote.album || 'SoundCloud',
    durationSeconds: remote.durationSeconds,
    artworkDataUrl: remote.artworkUrl ? `${SC_SCHEME}://artwork/${remote.scId}` : null,
    addedAt: Date.now(),
    remote: {
      provider: 'soundcloud',
      scId: remote.scId,
      permalinkUrl: remote.permalinkUrl ?? undefined,
      artworkUrl: remote.artworkUrl ?? undefined
    }
  }
}

export function scTrackId(scId: number): string {
  return `sc${scId}`
}

/** Returns true when a fresh API round-trip succeeds; used by Settings → Test. */
export async function testConnection(): Promise<{ ok: boolean; detail: string }> {
  try {
    const tracks = await searchTracks('soundcloud', 1)
    if (tracks.length > 0) return { ok: true, detail: `Connected — API responds (e.g. "${tracks[0].title}")` }
    return { ok: true, detail: 'Connected — API responded with an empty result set.' }
  } catch (error) {
    return { ok: false, detail: (error as Error).message }
  }
}