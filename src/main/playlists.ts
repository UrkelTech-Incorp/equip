import { app } from 'electron'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface Playlist {
  id: string
  name: string
  trackIds: string[]
  createdAt: number
}

function playlistFile(): string {
  return join(app.getPath('userData'), 'playlists.json')
}

export async function loadPlaylists(): Promise<Playlist[]> {
  const file = playlistFile()
  if (!existsSync(file)) return []
  try {
    return JSON.parse(await readFile(file, 'utf-8')) as Playlist[]
  } catch {
    return []
  }
}

export async function savePlaylists(playlists: Playlist[]): Promise<void> {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) await mkdir(dir, { recursive: true })
  await writeFile(playlistFile(), JSON.stringify(playlists), 'utf-8')
}
