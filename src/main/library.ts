import { app, dialog } from 'electron'
import { readdir, readFile, stat, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, resolve } from 'node:path'
import { parseFile } from 'music-metadata'

export interface LibraryTrack {
  id: string
  path: string
  url: string
  title: string
  artist: string
  album: string
  durationSeconds: number
  artworkDataUrl: string | null
  addedAt: number
  /** Present on tracks that came from a streaming provider rather than a local file. */
  remote?: {
    provider: 'soundcloud'
    scId: number
    permalinkUrl?: string
    artworkUrl?: string
  }
}

interface LibraryFile {
  version: 2
  folders: string[]
  tracks: LibraryTrack[]
}

const SUPPORTED = new Set(['.flac', '.alac', '.m4a', '.mp3', '.wav', '.aiff', '.aif', '.ogg', '.opus', '.wma'])
const MAX_DEPTH = 8
const MAX_ARTWORK_BYTES = 512 * 1024

export const MEDIA_SCHEME = 'equip-media'

function libraryFile(): string {
  return join(app.getPath('userData'), 'library.json')
}

function toMediaUrl(filePath: string): string {
  return `${MEDIA_SCHEME}://local/${encodeURIComponent(filePath)}`
}

export function decodeMediaUrl(url: string): string {
  const encoded = url.slice(`${MEDIA_SCHEME}://local/`.length)
  return decodeURIComponent(encoded)
}

function makeId(filePath: string): string {
  let hash = 0
  for (let index = 0; index < filePath.length; index += 1) {
    hash = (hash << 5) - hash + filePath.charCodeAt(index)
    hash |= 0
  }
  return `t${(hash >>> 0).toString(36)}`
}

function isAudioFile(filePath: string): boolean {
  return SUPPORTED.has(extname(filePath).toLowerCase())
}

async function collectFiles(root: string, depth = 0): Promise<string[]> {
  if (depth > MAX_DEPTH) return []
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = join(root, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(full, depth + 1)))
    } else if (isAudioFile(full)) {
      files.push(full)
    }
  }
  return files
}

async function toTrack(filePath: string): Promise<LibraryTrack | null> {
  try {
    const [meta, stats] = await Promise.all([parseFile(filePath, { duration: true }), stat(filePath)])
    const picture = meta.common.picture?.[0]
    // Oversized scans are dropped rather than truncated: a partial image would
    // render broken, and base64 art for a large library is megabytes of JSON.
    const rawArtwork = picture ? Buffer.from(picture.data) : null
    const artwork =
      rawArtwork && rawArtwork.length <= MAX_ARTWORK_BYTES
        ? `data:${picture?.format ?? 'image/jpeg'};base64,${rawArtwork.toString('base64')}`
        : null
    const fallbackTitle = filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') ?? 'Unknown title'
    return {
      id: makeId(filePath),
      path: filePath,
      url: toMediaUrl(filePath),
      title: meta.common.title?.trim() || fallbackTitle,
      artist: meta.common.artist?.trim() || 'Unknown artist',
      album: meta.common.album?.trim() || 'Unknown album',
      durationSeconds: Math.round(meta.format.duration ?? 0),
      artworkDataUrl: artwork,
      addedAt: stats.mtimeMs
    }
  } catch {
    return null
  }
}

async function readLibraryFile(): Promise<LibraryFile> {
  const file = libraryFile()
  if (!existsSync(file)) return { version: 2, folders: [], tracks: [] }
  try {
    const parsed = JSON.parse(await readFile(file, 'utf-8')) as LibraryFile | LibraryTrack[]
    if (Array.isArray(parsed)) {
      // Library format v1 stored a bare track array with no folder list.
      return { version: 2, folders: [...new Set(parsed.map((track) => track.path.replace(/[\\/][^\\/]+$/, '')))], tracks: parsed }
    }
    return { version: 2, folders: parsed.folders ?? [], tracks: parsed.tracks ?? [] }
  } catch {
    return { version: 2, folders: [], tracks: [] }
  }
}

async function writeLibraryFile(data: LibraryFile): Promise<void> {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await writeFile(libraryFile(), JSON.stringify(data), 'utf-8')
}

export async function pickFolders(): Promise<string[]> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory', 'multiSelections'] })
  if (result.canceled || result.filePaths.length === 0) return []
  return result.filePaths
}

async function scanPath(target: string): Promise<{ folders: string[]; files: string[] }> {
  const absolute = resolve(target)
  let info: import('node:fs').Stats
  try {
    info = await stat(absolute)
  } catch {
    return { folders: [], files: [] }
  }
  if (info.isDirectory()) return { folders: [absolute], files: await collectFiles(absolute) }
  if (isAudioFile(absolute)) return { folders: [], files: [absolute] }
  return { folders: [], files: [] }
}

/** Adds folders or loose audio files from drag-and-drop or the folder picker. */
export async function addPaths(paths: string[]): Promise<LibraryTrack[]> {
  const data = await readLibraryFile()
  const files: string[] = []
  for (const target of paths) {
    const scanned = await scanPath(target)
    data.folders.push(...scanned.folders)
    files.push(...scanned.files)
  }
  data.folders = [...new Set(data.folders)]
  const tracks = await Promise.all(files.map(toTrack))
  const map = new Map(data.tracks.map((track) => [track.id, track]))
  for (const track of tracks) {
    if (track) map.set(track.id, track)
  }
  data.tracks = sortTracks([...map.values()])
  await writeLibraryFile(data)
  return data.tracks
}

/** Re-reads every known folder so newly added or edited files appear. */
export async function rescanLibrary(): Promise<LibraryTrack[]> {
  const data = await readLibraryFile()
  const existing = new Map(data.tracks.map((track) => [track.path, track]))
  const files: string[] = []
  for (const folder of data.folders) files.push(...(await collectFiles(folder)))
  const tracks = await Promise.all(files.map(toTrack))
  const map = new Map<string, LibraryTrack>()
  for (const track of tracks) if (track) map.set(track.path, track)
  for (const [filePath, track] of existing) {
    if (!map.has(filePath) && existsSync(filePath)) map.set(filePath, track)
  }
  // Stream-only tracks (Downloaded ones have a real path above) belong to no
  // folder, so fold them back in explicitly — otherwise a rescan would drop
  // every SoundCloud track from the library.
  const all = [...map.values()]
  for (const track of data.tracks) {
    if (track.remote && !all.some((item) => item.id === track.id)) all.push(track)
  }
  data.tracks = sortTracks(all)
  await writeLibraryFile(data)
  return data.tracks
}

/**
 * Inserts (or replaces) tracks in the persisted library by id and returns the
 * full library. Used by the SoundCloud integration for stream-only entries and
 * offline downloads; safe to reuse for any provider in the future.
 */
export async function upsertTracks(input: LibraryTrack[]): Promise<LibraryTrack[]> {
  const data = await readLibraryFile()
  for (const track of input) {
    data.tracks = data.tracks.filter((item) => item.id !== track.id)
    data.tracks.push(track)
  }
  data.tracks = sortTracks(data.tracks)
  await writeLibraryFile(data)
  return data.tracks
}

/** Turns a finished offline download into a library track and persists it. */
export async function upsertDownloadedTrack(
  meta: {
    scId: number
    title: string
    artist: string
    album: string
    durationSeconds: number
    permalinkUrl?: string
    artworkUrl?: string
  },
  filePath: string
): Promise<LibraryTrack[]> {
  const track: LibraryTrack = {
    id: `sc${meta.scId}`,
    path: filePath,
    url: `${MEDIA_SCHEME}://local/${encodeURIComponent(filePath)}`,
    title: meta.title,
    artist: meta.artist,
    album: meta.album || 'SoundCloud',
    durationSeconds: Math.max(1, Math.round(meta.durationSeconds)),
    artworkDataUrl: meta.artworkUrl ? `equip-sc://artwork/${meta.scId}` : null,
    addedAt: Date.now(),
    remote: {
      provider: 'soundcloud',
      scId: meta.scId,
      permalinkUrl: meta.permalinkUrl,
      artworkUrl: meta.artworkUrl
    }
  }
  return upsertTracks([track])
}

export async function loadLibrary(): Promise<LibraryTrack[]> {
  return (await readLibraryFile()).tracks
}

export async function clearLibrary(): Promise<LibraryTrack[]> {
  await writeLibraryFile({ version: 2, folders: [], tracks: [] })
  return []
}

function sortTracks(tracks: LibraryTrack[]): LibraryTrack[] {
  return tracks.sort(
    (a, b) =>
      a.artist.localeCompare(b.artist, undefined, { sensitivity: 'base' }) ||
      a.album.localeCompare(b.album, undefined, { sensitivity: 'base' }) ||
      a.title.localeCompare(b.title, undefined, { sensitivity: 'base' })
  )
}
