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
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { existsSync, mkdirSync, statSync } from 'fs'
import { join } from 'path'

let ffmpegPath: string | null | undefined // undefined = not probed yet

function resolveFfmpeg(): string | null {
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
    let err = ''
    child.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      err += s
      if (err.length > 65536) err = err.slice(-32768)
      onStderr?.(s)
    })
    child.on('error', (e) => reject(e))
    child.on('close', (code) => resolve({ code: code ?? -1, err }))
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
  needsConvert: boolean
  ffmpegAvailable: boolean
  error?: string
}

async function probe(path: string): Promise<VideoProbeResult> {
  try {
    // `ffmpeg -i <file>` exits non-zero (no output requested) but prints the
    // stream info we need on stderr : codec name + duration.
    const { err } = await runFfmpeg(['-hide_banner', '-i', path])
    const codec = err.match(/Video:\s*([a-z0-9_]+)/i)?.[1]?.toLowerCase() ?? null
    const durationSec = parseClock(err.match(/Duration:\s*([\d:.]+)/)?.[1] ?? '')
    return {
      ok: codec !== null,
      codec,
      durationSec,
      needsConvert: codec !== null && CONVERT_CODECS.test(codec),
      ffmpegAvailable: true
    }
  } catch (e) {
    // ffmpeg missing entirely : the renderer falls back to trying <video> as-is.
    return { ok: false, codec: null, durationSec: 0, needsConvert: false, ffmpegAvailable: false, error: (e as Error).message }
  }
}

function cachePathFor(src: string): string {
  const st = statSync(src)
  const key = createHash('sha1').update(`${src}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 20)
  const dir = join(app.getPath('userData'), 'video-cache')
  mkdirSync(dir, { recursive: true })
  return join(dir, `${key}.mp4`)
}

export function registerVideoConvert(): void {
  ipcMain.handle('video:probe', async (_e, path: string) => {
    try {
      return await probe(path)
    } catch (e) {
      return { ok: false, codec: null, durationSec: 0, needsConvert: false, ffmpegAvailable: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('video:convert', async (e, path: string) => {
    try {
      const out = cachePathFor(path)
      if (existsSync(out) && statSync(out).size > 0) return { ok: true, path: out, cached: true }
      const p = await probe(path)
      if (!p.ffmpegAvailable) return { ok: false, error: 'ffmpeg not found : set OPSIA_FFMPEG, install ffmpeg-static, or add ffmpeg to PATH' }
      const dur = Math.max(p.durationSec, 0.001)
      const sender = e.sender
      const { code, err } = await runFfmpeg(
        [
          '-hide_banner', '-y', '-i', path,
          '-an', // clips are visual sources : no audio track in the cache
          '-c:v', 'libx264', '-g', '1', '-bf', '0', // ALL-INTRA : every frame a keyframe
          '-crf', '16', '-preset', 'fast', '-pix_fmt', 'yuv420p',
          '-movflags', '+faststart',
          out
        ],
        (chunk) => {
          const t = chunk.match(/time=([\d:.]+)/)?.[1]
          if (t && !sender.isDestroyed()) {
            sender.send('video:convertProgress', { path, pct: Math.min(0.99, parseClock(t) / dur) })
          }
        }
      )
      if (code !== 0 || !existsSync(out)) {
        return { ok: false, error: `ffmpeg exited ${code}: ${err.slice(-400)}` }
      }
      if (!e.sender.isDestroyed()) e.sender.send('video:convertProgress', { path, pct: 1 })
      return { ok: true, path: out, cached: false }
    } catch (err2) {
      return { ok: false, error: (err2 as Error).message }
    }
  })
}
