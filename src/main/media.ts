// opsia-media:// : a range-capable local-file protocol for video sources.
//
// Object URLs die on reload, so a saved session can't restore its clips. Instead
// we address clips by absolute path through this custom scheme:
//   opsia-media://local/<url-encoded-absolute-path>
// which persists in the session and streams the file with HTTP range support so
// the transport's constant seeking stays smooth (no loading the whole clip into
// memory). The renderer resolves a picked file's path via webUtils.getPathForFile.

import { protocol } from 'electron'
import { createReadStream, statSync } from 'fs'
import { isAbsolute } from 'path'
import { Readable } from 'stream'

export const MEDIA_SCHEME = 'opsia-media'

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  ogv: 'video/ogg',
  dxv: 'video/quicktime' // DXV3 clips are MOV containers (converted on import)
}
const extOf = (path: string): string => path.split('.').pop()?.toLowerCase() ?? ''
const mimeFor = (path: string): string => MIME[extOf(path)] ?? 'video/mp4'
// Only these extensions may be streamed. The scheme addresses clips by absolute
// path, so without this any renderer request could read an arbitrary file
// (~/.ssh/id_rsa, .env, …); restricting to known video containers keeps the
// blast radius to video files, which is all this scheme is ever asked to serve.
const ALLOWED_EXT = new Set(Object.keys(MIME))
// CORS : the Collage, Assemble and the Sonify Collage voice load their films with
// crossOrigin='anonymous' (a WebGL upload or an audio graph needs an untainted
// element). Since Electron 44 (Chromium 152) a CORS request to a custom scheme
// only succeeds when the scheme is corsEnabled AND the response allows the
// origin; without both, the element sat at readyState 0 forever and every
// Collage stood still. Sent on every response, errors included, so a missing
// file reads as a 404 rather than as a CORS failure.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Length'
}
const reply = (body: BodyInit | null, status: number, headers: Record<string, string> = {}): Response =>
  new Response(body, { status, headers: { ...CORS, ...headers } })

/** Must run BEFORE app ready : registers the scheme as a privileged, streaming,
 *  standard scheme so <video> can seek it via range requests. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
  ])
}

/** Must run AFTER app ready : serves files with 200 / 206 (range) responses. */
export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    if (request.method === 'OPTIONS') {
      return reply(null, 204, { 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': 'Range' })
    }
    let filePath: string
    try {
      filePath = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
    } catch {
      return reply('bad url', 400)
    }
    // The scheme addresses clips the user picked, which can live anywhere, so we
    // can't confine to a base dir the way opsia-asset:// does. Instead the guards
    // are: an absolute path only (no relative/scheme tricks), no NUL byte, and a
    // known video extension (ALLOWED_EXT) — so the blast radius stays video files.
    if (!filePath || filePath.includes('\0') || !isAbsolute(filePath)) {
      return reply('forbidden', 403)
    }
    if (!ALLOWED_EXT.has(extOf(filePath))) {
      return reply('forbidden', 403)
    }
    let size: number
    try {
      const st = statSync(filePath)
      if (!st.isFile()) return reply('not found', 404)
      size = st.size
    } catch {
      return reply('not found', 404)
    }
    const type = mimeFor(filePath)
    const range = request.headers.get('range')
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range)
      if (m) {
        const start = parseInt(m[1], 10)
        const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
        if (start >= size || start > end) {
          return reply(null, 416, { 'Content-Range': `bytes */${size}` })
        }
        const body = Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ReadableStream
        return reply(body, 206, {
          'Content-Type': type,
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Content-Length': String(end - start + 1)
        })
      }
    }
    const body = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream
    return reply(body, 200, { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(size) })
  })
}
