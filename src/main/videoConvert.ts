// Video ingest conversion : ffmpeg-backed support for the codecs Chromium can't
// play — DXV3 (Resolume), HAP / HAP Alpha / HAP Q, ProRes, DNxHD… On import the
// renderer PROBES a file; if its codec needs conversion, CONVERT transcodes it
// once into an ALL-INTRA H.264 cache file (every frame a keyframe), which:
//   - plays in the existing <video> pipeline,
//   - scrubs / reverses smoothly (the all-intra fix), and
//   - gives the coming FrameStore (WebCodecs) perfect per-frame random access
//     for the modulatable playhead + video granulation.
// The cache lives in userData/video-cache keyed by path+size+mtime, so a clip
// converts once and is found instantly on every later import / session load.
//
// ffmpeg is resolved from (in order): the OPSIA_FFMPEG env var, the optional
// `ffmpeg-static` package (if installed), then `ffmpeg` on PATH.

import { app, ipcMain } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs'
import { join } from 'path'

// In-flight converts keyed by CACHE path : a second request for the same clip
// (source A+B on one file, warm sweep vs foreground import, multi-layer session
// load) awaits the same promise instead of spawning a second ffmpeg writing the
// same file (which corrupts the cache).
const inflight = new Map<string, Promise<{ ok: boolean; path?: string; cached?: boolean; error?: string }>>()
// Live ffmpeg children, killed on app quit so a long transcode never orphans.
// Exported so the Assemble analyser's streaming ffmpeg joins the same reaping.
export const children = new Set<ChildProcess>()
export function killAllConverts(): void {
  for (const c of children) {
    try { c.kill() } catch { /* already gone */ }
  }
  children.clear()
}

let ffmpegPath: string | null | undefined // undefined = not probed yet

export function resolveFfmpeg(): string | null {
  if (ffmpegPath !== undefined) return ffmpegPath
  if (process.env.OPSIA_FFMPEG && existsSync(process.env.OPSIA_FFMPEG)) {
    ffmpegPath = process.env.OPSIA_FFMPEG
    return ffmpegPath
  }
  try {
    // Optional dependency : present when `npm i ffmpeg-static` has been run.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let p = require('ffmpeg-static') as string | null
    // Packaged app : the binary lives in the asarUnpack'd copy (an exe can't be
    // spawned from inside app.asar) — electron-builder.yml unpacks ffmpeg-static.
    if (p) p = p.replace('app.asar', 'app.asar.unpacked')
    if (p && existsSync(p)) {
      ffmpegPath = p
      return ffmpegPath
    }
  } catch {
    /* not installed : fall through to PATH */
  }
  ffmpegPath = 'ffmpeg' // trust PATH; a failed spawn reports cleanly below
  return ffmpegPath
}

/** Run ffmpeg, resolving with its stderr text (ffmpeg logs info to stderr). */
function runFfmpeg(args: string[], onStderr?: (chunk: string) => void): Promise<{ code: number; err: string }> {
  return new Promise((resolve, reject) => {
    const bin = resolveFfmpeg()
    if (!bin) return reject(new Error('ffmpeg not found'))
    const child = spawn(bin, args, { windowsHide: true })
    children.add(child)
    let err = ''
    // An EPIPE on either pipe (most likely when killAllConverts reaps this
    // child on quit, mid-scan) arrives as an unhandled 'error' event, which
    // THROWS in main and takes the app with it.
    child.stdout?.on('error', () => {})
    child.stderr.on('error', () => {})
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      err += s
      if (err.length > 65536) err = err.slice(-32768)
      onStderr?.(s)
    })
    child.on('error', (e) => { children.delete(child); reject(e) })
    child.on('close', (code) => { children.delete(child); resolve({ code: code ?? -1, err }) })
  })
}

const parseClock = (s: string): number => {
  const m = s.match(/(\d+):(\d+):(\d+(?:\.\d+)?)/)
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0
}

// Codecs Chromium's <video> cannot decode : convert these. (h264/hevc/vp8/vp9/
// av1 in mp4/webm play natively and are left untouched.)
const CONVERT_CODECS = /\b(dxv|hap|prores|dnxhd|mpeg2video|mjpeg|cfhd|qtrle|rawvideo)\b/i

export interface VideoProbeResult {
  ok: boolean
  codec: string | null
  durationSec: number
  width: number
  height: number
  needsConvert: boolean
  ffmpegAvailable: boolean
  error?: string
}

export async function probe(path: string): Promise<VideoProbeResult> {
  try {
    // `ffmpeg -i <file>` exits non-zero (no output requested) but prints the
    // stream info we need on stderr : codec name + duration + frame size.
    const { err } = await runFfmpeg(['-hide_banner', '-i', path])
    const codec = err.match(/Video:\s*([a-z0-9_]+)/i)?.[1]?.toLowerCase() ?? null
    const durationSec = parseClock(err.match(/Duration:\s*([\d:.]+)/)?.[1] ?? '')
    // Frame size, from the Video: line only : the first `<W>x<H>` field after
    // the pixel format. Anchoring on `Video:` keeps an audio or data stream out
    // of it, and the `[SAR 1:1 DAR 16:9]` that follows on the same line is a
    // pair of RATIOS, not a size — the lazy match stops before it.
    const dim = err.match(/Video:.*?,\s*(\d+)x(\d+)/)
    return {
      ok: codec !== null,
      codec,
      durationSec,
      width: dim ? Number(dim[1]) : 0,
      height: dim ? Number(dim[2]) : 0,
      needsConvert: codec !== null && CONVERT_CODECS.test(codec),
      ffmpegAvailable: true
    }
  } catch (e) {
    // ffmpeg missing entirely : the renderer falls back to trying <video> as-is.
    return { ok: false, codec: null, durationSec: 0, width: 0, height: 0, needsConvert: false, ffmpegAvailable: false, error: (e as Error).message }
  }
}

/** Cache path for one source, under one ENCODE PROFILE. The profile joins both
 *  the identity hash and the file name, because the same source can be cached
 *  under more than one encode : without it, a clip already bridged by
 *  convertToCache (full-res, crf 16) would be found on disk by the Collage
 *  optimiser and handed back as if it were the lean 720p file it asked for.
 *  No profile = the original naming, whose files already exist on disk. */
function cachePathFor(src: string, profile?: { tag: string; suffix: string }): string {
  const st = statSync(src)
  const key = createHash('sha1')
    .update(`${src}|${st.size}|${st.mtimeMs}${profile ? `|${profile.tag}` : ''}`)
    .digest('hex')
    .slice(0, 20)
  const dir = join(app.getPath('userData'), 'video-cache')
  mkdirSync(dir, { recursive: true })
  return join(dir, `${key}${profile?.suffix ?? ''}.mp4`)
}

/** Convert one clip into the all-intra cache. ATOMIC (writes to .tmp, renames on
 *  success, unlinks on failure — a truncated cache file is never trusted) and
 *  DEDUPED (concurrent requests for the same clip share one ffmpeg). */
export function convertToCache(
  path: string,
  onProgress?: (pct: number) => void
): Promise<{ ok: boolean; path?: string; cached?: boolean; error?: string }> {
  let out: string
  try {
    out = cachePathFor(path)
  } catch (e) {
    return Promise.resolve({ ok: false, error: (e as Error).message })
  }
  if (existsSync(out) && statSync(out).size > 0) return Promise.resolve({ ok: true, path: out, cached: true })
  const running = inflight.get(out)
  if (running) return running
  const job = (async (): Promise<{ ok: boolean; path?: string; cached?: boolean; error?: string }> => {
    const tmp = `${out}.tmp`
    try {
      const p = await probe(path)
      if (!p.ffmpegAvailable) {
        return { ok: false, error: 'ffmpeg not found : set OPSIA_FFMPEG, install ffmpeg-static, or add ffmpeg to PATH' }
      }
      const dur = Math.max(p.durationSec, 0.001)
      const { code } = await runFfmpeg(
        [
          '-hide_banner', '-y', '-i', path,
          '-an', // clips are visual sources : no audio track in the cache
          '-c:v', 'libx264', '-g', '1', '-bf', '0', // ALL-INTRA : every frame a keyframe
          '-crf', '16', '-preset', 'fast', '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          '-f', 'mp4', tmp
        ],
        (chunk) => {
          const t = chunk.match(/time=([\d:.]+)/)?.[1]
          if (t) onProgress?.(Math.min(0.99, parseClock(t) / dur))
        }
      )
      if (code !== 0 || !existsSync(tmp) || statSync(tmp).size === 0) {
        try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* best effort */ }
        return { ok: false, error: `ffmpeg exited ${code}` }
      }
      renameSync(tmp, out) // atomic on the same volume : cache is whole or absent
      onProgress?.(1)
      return { ok: true, path: out, cached: false }
    } catch (e) {
      try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* best effort */ }
      return { ok: false, error: (e as Error).message }
    } finally {
      inflight.delete(out)
    }
  })()
  inflight.set(out, job)
  return job
}

// The Collage optimise profile. The wall SEEKS constantly — every window loop,
// every churn re-roll, every cut of an assemblage-fed piece — and on a long-GOP
// file each seek has to decode forward from the previous keyframe, which stutters
// a wall of 50 pieces. convertToCache above only bridges the codecs Chromium
// cannot decode AT ALL, so ordinary long-GOP H.264 / HEVC — exactly the case that
// stutters — passes through untouched. This profile converts EVERYTHING, and
// downscales while it is at it : a piece in a 50-cut wall is drawn into a
// 384–640 px square of an array layer, so every pixel above 720p is decoded and
// then thrown away. crf 20 rather than 16 : all-intra at 30 fps is already fat,
// and the pieces are seen postage-stamp sized.
const COLLAGE_PROFILE = { tag: 'collage720', suffix: '.c720' }

/** Force-convert one clip into the lean, seek-friendly Collage cache (720p max,
 *  30 fps, all-intra H.264, no audio) whatever its source codec. Same atomic +
 *  deduped contract as convertToCache, and a separate cache name (see
 *  cachePathFor) so the two encodes never stand in for each other. */
/** The optimised cache file for `src`, if one has already been made. Lets a
 *  plain re-scan KEEP an earlier optimise pass instead of silently reverting the
 *  pool to the original long-GOP files — the user would have no way to tell that
 *  their smooth wall had just been undone by a ↻. */
export function collageCacheFor(src: string): string | null {
  try {
    const out = cachePathFor(src, COLLAGE_PROFILE)
    return existsSync(out) && statSync(out).size > 0 ? out : null
  } catch {
    return null // unreadable source : the caller's probe will report it
  }
}

export function convertForCollage(
  path: string,
  onProgress?: (pct: number) => void
): Promise<{ ok: boolean; path?: string; cached?: boolean; error?: string }> {
  let out: string
  try {
    out = cachePathFor(path, COLLAGE_PROFILE)
  } catch (e) {
    return Promise.resolve({ ok: false, error: (e as Error).message })
  }
  if (existsSync(out) && statSync(out).size > 0) return Promise.resolve({ ok: true, path: out, cached: true })
  const running = inflight.get(out)
  if (running) return running
  const job = (async (): Promise<{ ok: boolean; path?: string; cached?: boolean; error?: string }> => {
    const tmp = `${out}.tmp`
    try {
      const p = await probe(path)
      if (!p.ffmpegAvailable) {
        return { ok: false, error: 'ffmpeg not found : set OPSIA_FFMPEG, install ffmpeg-static, or add ffmpeg to PATH' }
      }
      const dur = Math.max(p.durationSec, 0.001)
      const { code } = await runFfmpeg(
        [
          '-hide_banner', '-y', '-i', path,
          '-an', // clips are visual sources : no audio track in the cache
          // min(720,ih) so a 480p clip stays 480p instead of being blown up into
          // pixels it never had (an upscale would only make the decode dearer),
          // and trunc(…/2)*2 keeps the height EVEN, which yuv420p demands and an
          // odd-height source would otherwise break on. The single quotes are
          // ffmpeg's own : they keep the comma inside min() out of the filter
          // separator.
          '-vf', "scale=-2:'trunc(min(720,ih)/2)*2',fps=30",
          '-c:v', 'libx264', '-g', '1', '-bf', '0', // ALL-INTRA : every seek lands on a keyframe
          '-crf', '20', '-preset', 'fast', '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          '-f', 'mp4', tmp
        ],
        (chunk) => {
          const t = chunk.match(/time=([\d:.]+)/)?.[1]
          if (t) onProgress?.(Math.min(0.99, parseClock(t) / dur))
        }
      )
      if (code !== 0 || !existsSync(tmp) || statSync(tmp).size === 0) {
        try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* best effort */ }
        return { ok: false, error: `ffmpeg exited ${code}` }
      }
      renameSync(tmp, out) // atomic on the same volume : cache is whole or absent
      onProgress?.(1)
      return { ok: true, path: out, cached: false }
    } catch (e) {
      try { if (existsSync(tmp)) unlinkSync(tmp) } catch { /* best effort */ }
      return { ok: false, error: (e as Error).message }
    } finally {
      inflight.delete(out)
    }
  })()
  inflight.set(out, job)
  return job
}

// Warm every video file sitting next to a loaded session : probe each one and
// pre-convert the exotic codecs (DXV/HAP/ProRes…) into the all-intra cache in the
// BACKGROUND, sequentially (one ffmpeg at a time : no CPU spike), so by the time
// the performer reaches for a clip it imports instantly. Fire-and-forget.
const VIDEO_EXTS = /\.(mp4|m4v|mov|dxv|webm|mkv|avi|mpg|mpeg|mxf|m2v)$/i
let warming = false
export async function warmVideoFolder(dir: string): Promise<void> {
  if (warming) return // one warm sweep at a time
  warming = true
  try {
    const { readdirSync } = await import('fs')
    const files = readdirSync(dir)
      .filter((f) => VIDEO_EXTS.test(f))
      .map((f) => join(dir, f))
    for (const f of files) {
      try {
        const p = await probe(f)
        if (!p.ffmpegAvailable) return // no ffmpeg : nothing to warm
        if (!p.needsConvert) continue
        const res = await convertToCache(f) // deduped + atomic (shared with imports)
        if (res.ok && !res.cached) console.log(`[video] warmed ${f}`)
      } catch {
        /* one bad file must not stop the sweep */
      }
    }
  } catch {
    /* unreadable dir : ignore */
  } finally {
    warming = false
  }
}

export function registerVideoConvert(): void {
  ipcMain.handle('video:probe', async (_e, path: string) => {
    try {
      return await probe(path)
    } catch (e) {
      return { ok: false, codec: null, durationSec: 0, width: 0, height: 0, needsConvert: false, ffmpegAvailable: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('video:convert', async (e, path: string) => {
    try {
      const sender = e.sender
      return await convertToCache(path, (pct) => {
        if (!sender.isDestroyed()) sender.send('video:convertProgress', { path, pct })
      })
    } catch (err2) {
      return { ok: false, error: (err2 as Error).message }
    }
  })
}
