/**
 * Loopback HTTP media server.
 *
 * Renderer media (<audio> decks, artwork <img>) is loaded through this server
 * instead of the equip-media:/equip-sc: custom protocols. It serves the same
 * content (local files with Range/206 seeking, SoundCloud streams and artwork
 * proxied from the main process) but over plain http://127.0.0.1, which the
 * renderer network stack loads reliably in every environment — custom-scheme
 * CORS-mode subresource loading can be broken by certain OS/Chromium
 * combinations in a way that plain loopback HTTP never is.
 *
 * Routes:
 *   /local/<encoded absolute path>      → local file (Range → 206)
 *   /sc/stream/<scId>                   → proxied SoundCloud stream (Range passed)
 *   /sc/artwork/<scId>                  → proxied SoundCloud artwork
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { net } from 'electron'
import { MEDIA_SCHEME, type LibraryTrack } from './library'
import { SC_SCHEME, resolveArtworkUrl, resolveStreamUrl } from './soundcloud'

const PORT_HOST = '127.0.0.1'

let server: Server | null = null
let baseUrl = ''

export async function startMediaServer(): Promise<string> {
  if (server) return baseUrl
  server = createServer(handleRequest)
  await new Promise<void>((resolve, reject) => {
    server?.once('error', reject)
    server?.listen(0, PORT_HOST, () => resolve())
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : 0
  baseUrl = `http://${PORT_HOST}:${port}`
  return baseUrl
}

export function mediaBase(): string {
  return baseUrl
}

/** Converts a persisted logical URL (equip-media:/equip-sc:) into the loopback
 * HTTP URL the renderer actually loads. Other URLs pass through unchanged. */
export function wireUrl(url: string | null | undefined): string | null | undefined {
  if (!url) return url
  if (url.startsWith(`${MEDIA_SCHEME}://local/`)) {
    return `${baseUrl}/local/${url.slice(`${MEDIA_SCHEME}://local/`.length)}`
  }
  if (url.startsWith(`${SC_SCHEME}://stream/`)) {
    return `${baseUrl}/sc/stream/${url.slice(`${SC_SCHEME}://stream/`.length)}`
  }
  if (url.startsWith(`${SC_SCHEME}://artwork/`)) {
    return `${baseUrl}/sc/artwork/${url.slice(`${SC_SCHEME}://artwork/`.length)}`
  }
  return url
}

export function wireLibrary(tracks: LibraryTrack[]): LibraryTrack[] {
  return tracks.map((track) => ({
    ...track,
    url: wireUrl(track.url) ?? '',
    artworkDataUrl: wireUrl(track.artworkDataUrl) ?? null
  }))
}

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.webm': 'audio/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp'
}

function mimeFor(path: string): string {
  const dot = path.lastIndexOf('.')
  return dot >= 0 ? (MIME[path.slice(dot).toLowerCase()] ?? 'application/octet-stream') : 'application/octet-stream'
}

function send(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' })
  res.end(text)
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  // CORS for the renderer's crossOrigin media + the visualizer analyser.
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': 'Range, Authorization, Content-Type',
      'Access-Control-Max-Age': '86400'
    })
    res.end()
    return
  }

  const url = new URL(req.url ?? '/', 'http://placeholder')
  const segments = url.pathname.replace(/^\/+/, '').split('/')
  const [kind, second] = segments

  try {
    if (!kind) return send(res, 404, 'Not found')

    if (kind === 'local') {
      const filePath = decodeURIComponent(url.pathname.replace(/^\/local\//, ''))
      await serveLocalFile(req, res, filePath)
      return
    }

    if (kind === 'sc' && second === 'stream') {
      const scId = Number(segments[2])
      if (!Number.isFinite(scId)) return send(res, 404, 'Not found')
      await proxyStream(req, res, scId)
      return
    }

    if (kind === 'sc' && second === 'artwork') {
      const scId = Number(segments[2])
      if (!Number.isFinite(scId)) return send(res, 404, 'Not found')
      await proxyArtwork(res, scId)
      return
    }

    return send(res, 404, 'Not found')
  } catch (error) {
    console.error('[media-server]', url.pathname, error)
    if (!res.headersSent) return send(res, 502, 'Upstream unavailable')
    res.destroy()
  }
}

async function serveLocalFile(req: IncomingMessage, res: ServerResponse, filePath: string): Promise<void> {
  const info = await stat(filePath)
  if (!info.isFile()) return send(res, 404, 'Not found')

  const range = parseRange(req.headers.range, info.size)
  if (range) {
    const length = range.end - range.start + 1
    res.writeHead(206, {
      'Content-Type': mimeFor(filePath),
      'Content-Length': length,
      'Content-Range': `bytes ${range.start}-${range.end}/${info.size}`,
      'Accept-Ranges': 'bytes'
    })
    await pipeline(createReadStream(filePath, { start: range.start, end: range.end }), res)
  } else {
    res.writeHead(200, {
      'Content-Type': mimeFor(filePath),
      'Content-Length': info.size,
      'Accept-Ranges': 'bytes'
    })
    await pipeline(createReadStream(filePath), res)
  }
}

function parseRange(header: string | undefined, size: number): { start: number; end: number } | null {
  if (typeof header !== 'string') return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match) return null
  const [, startText, endText] = match
  const start = startText ? Number(startText) : size - (endText ? Number(endText) : 0)
  const end = endText ? Number(endText) : size - 1
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return null
  return { start: Math.max(0, start), end: Math.min(size - 1, end) }
}

/** Adapts a Web Response body into a Node Readable for piping. Electron's
 * fetch bodies are typed with the newer DOM ReadableStream generics that
 * don't line up with Node's stream types, so the cast is unavoidable. */
function toNodeReadable(stream: ReadableStream<Uint8Array>): Readable {
  return Readable.fromWeb(stream as unknown as Parameters<typeof Readable.fromWeb>[0])
}

async function proxyStream(req: IncomingMessage, res: ServerResponse, scId: number): Promise<void> {
  const signed = await resolveStreamUrl(scId)
  const upstreamRange = typeof req.headers.range === 'string' ? req.headers.range : undefined
  const upstream = await net.fetch(signed, {
    headers: upstreamRange ? { Range: upstreamRange } : undefined,
    bypassCustomProtocolHandlers: true
  })
  const headers: Record<string, string> = {}
  for (const key of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
    const value = upstream.headers.get(key)
    if (value) headers[key] = value
  }
  res.writeHead(upstream.status, headers)
  if (!upstream.body) {
    res.end()
    return
  }
  await pipeline(toNodeReadable(upstream.body), res)
}

async function proxyArtwork(res: ServerResponse, scId: number): Promise<void> {
  const artworkUrl = await resolveArtworkUrl(scId)
  if (!artworkUrl) return send(res, 404, 'Not found')
  const upstream = await net.fetch(artworkUrl, { bypassCustomProtocolHandlers: true })
  const headers: Record<string, string> = {
    'Content-Type': upstream.headers.get('content-type') ?? 'image/jpeg'
  }
  const length = upstream.headers.get('content-length')
  if (length) headers['Content-Length'] = length
  res.writeHead(upstream.status, headers)
  if (!upstream.body) {
    res.end()
    return
  }
  await pipeline(toNodeReadable(upstream.body), res)
}