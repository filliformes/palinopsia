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
import { Readable } from 'stream'

export const MEDIA_SCHEME = 'opsia-media'

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  avi: 'video/x-msvideo',
  ogv: 'video/ogg'
}
const mimeFor = (path: string): string => MIME[path.split('.').pop()?.toLowerCase() ?? ''] ?? 'video/mp4'

/** Must run BEFORE app ready : registers the scheme as a privileged, streaming,
 *  standard scheme so <video> can seek it via range requests. */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
  ])
}

/** Must run AFTER app ready : serves files with 200 / 206 (range) responses. */
export function handleMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    let filePath: string
    try {
      filePath = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
    } catch {
      return new Response('bad url', { status: 400 })
    }
    let size: number
    try {
      size = statSync(filePath).size
    } catch {
      return new Response('not found', { status: 404 })
    }
    const type = mimeFor(filePath)
    const range = request.headers.get('range')
    if (range) {
      const m = /bytes=(\d+)-(\d*)/.exec(range)
      if (m) {
        const start = parseInt(m[1], 10)
        const end = m[2] ? Math.min(parseInt(m[2], 10), size - 1) : size - 1
        if (start >= size || start > end) {
          return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
        }
        const body = Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ReadableStream
        return new Response(body, {
          status: 206,
          headers: {
            'Content-Type': type,
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Content-Length': String(end - start + 1)
          }
        })
      }
    }
    const body = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': String(size) }
    })
  })
}
