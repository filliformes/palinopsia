// opsia-asset:// : a read-only local scheme for BUNDLED static assets that a
// library must fetch at runtime. Today it serves the MediaPipe wasm + landmark
// models for embodied control (engine/bodyTracker.ts).
//
// Why a scheme and not a relative URL : the packaged renderer runs from file://,
// where Chromium blocks fetch()/importScripts of file:// resources — and that is
// exactly how MediaPipe's FilesetResolver loads its wasm and how it fetches a
// model's .task. A privileged, secure, fetch-capable standard scheme sidesteps
// that block and behaves identically in dev and packaged, so the same URLs work
// in both and nothing ever reaches out to Google's CDN (offline / kiosk-safe).
//
//   opsia-asset://local/wasm/vision_wasm_internal.js
//   opsia-asset://local/models/hand_landmarker.task
//
// The host segment ("local") is ignored; the pathname is resolved under the
// bundled mediapipe/ dir. Read-only, extension-allowlisted, traversal-guarded.

import { app, protocol } from 'electron'
import { createReadStream, statSync } from 'fs'
import { join, normalize, sep } from 'path'
import { Readable } from 'stream'

export const ASSET_SCHEME = 'opsia-asset'

const MIME: Record<string, string> = {
  js: 'text/javascript',
  wasm: 'application/wasm',
  task: 'application/octet-stream',
  data: 'application/octet-stream',
  bin: 'application/octet-stream',
  json: 'application/json'
}
const extOf = (path: string): string => path.split('.').pop()?.toLowerCase() ?? ''
// Only these may be served : the scheme resolves under one bundled dir, but the
// allowlist keeps a malformed request from ever coughing up an unexpected file.
const ALLOWED_EXT = new Set(Object.keys(MIME))

/** The bundled mediapipe/ base : extraResources → resources/mediapipe when
 *  packaged; the repo's resources/mediapipe in dev (same seam as windowIcon). */
function mediapipeBase(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'mediapipe')
    : join(app.getAppPath(), 'resources', 'mediapipe')
}

/** Must run BEFORE app ready : privileged + secure + fetch-capable so MediaPipe's
 *  internal fetch / wasm instantiation works from the packaged file:// renderer. */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } }
  ])
}

/** Must run AFTER app ready : serve the requested file from the mediapipe base. */
export function handleAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    let rel: string
    try {
      rel = decodeURIComponent(new URL(request.url).pathname.replace(/^\//, ''))
    } catch {
      return new Response('bad url', { status: 400 })
    }
    if (!ALLOWED_EXT.has(extOf(rel))) return new Response('forbidden', { status: 403 })
    const base = mediapipeBase()
    // Resolve under base and refuse anything that escapes it (path traversal).
    const filePath = normalize(join(base, rel))
    if (filePath !== base && !filePath.startsWith(base + sep)) {
      return new Response('forbidden', { status: 403 })
    }
    let size: number
    try {
      const st = statSync(filePath)
      if (!st.isFile()) return new Response('not found', { status: 404 })
      size = st.size
    } catch {
      return new Response('not found', { status: 404 })
    }
    const body = Readable.toWeb(createReadStream(filePath)) as unknown as ReadableStream
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': MIME[extOf(rel)] ?? 'application/octet-stream',
        'Content-Length': String(size),
        // The graph runner may issue a range probe; advertise none (whole-file).
        'Cache-Control': 'no-cache'
      }
    })
  })
}
