// Output recording + screenshots → the "Recorded" folder next to the app
// (project root in dev, install dir when packaged; falls back to <userData>).
//
// Pipeline: the renderer records the output canvas with MediaRecorder at a HIGH
// bitrate using a hardware-accelerated codec (H.264 where available) into a
// temporary intermediate file, streamed here chunk-by-chunk. On stop we hand it
// to ffmpeg (ffmpeg-static) to produce the chosen delivery format : a fast
// stream-copy remux when the codecs already match (no re-encode, no quality
// loss), or a real transcode for ProRes / FFV1 / uncompressed / H.265 / VP9.
// No ffmpeg on PATH → we just keep the intermediate as-is.

import { app } from 'electron'
import { createWriteStream, existsSync, promises as fs, type WriteStream } from 'fs'
import { execFile } from 'child_process'
import { join, dirname } from 'path'
import { userFilesBase } from './paths'
import { children } from './videoConvert'

// ffmpeg-static ships a per-platform binary; unpack it from the asar when packaged.
function ffmpegPath(): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const p = require('ffmpeg-static') as string | null
    if (!p) return null
    return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p
  } catch {
    return null
  }
}

export function ffmpegAvailable(): boolean {
  const p = ffmpegPath()
  return !!p && existsSync(p)
}

// Delivery formats. `args(src,out,srcCodec)` returns the ffmpeg argument list.
// A null entry = passthrough (keep the intermediate container, no ffmpeg).
type Fmt = {
  id: string
  label: string
  ext: string
  needsFfmpeg: boolean
  args?: (src: string, out: string, srcCodec: string) => string[]
}

const FORMATS: Fmt[] = [
  {
    id: 'source',
    label: 'Fast · no re-encode',
    ext: 'mkv',
    needsFfmpeg: false
  },
  {
    id: 'mp4-h264',
    label: 'MP4 · H.264 (high quality)',
    ext: 'mp4',
    needsFfmpeg: true,
    // Codecs already match → stream-copy remux (instant, lossless). Else x264.
    args: (src, out, c) =>
      c === 'h264'
        ? ['-i', src, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out]
        : ['-i', src, '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', out]
  },
  {
    id: 'mp4-h265',
    label: 'MP4 · H.265 / HEVC',
    ext: 'mp4',
    needsFfmpeg: true,
    args: (src, out) => ['-i', src, '-c:v', 'libx265', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-c:a', 'aac', '-b:a', '256k', out]
  },
  {
    id: 'mov-prores',
    label: 'MOV · ProRes 422 HQ',
    ext: 'mov',
    needsFfmpeg: true,
    args: (src, out) => ['-i', src, '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s16le', out]
  },
  {
    id: 'mkv-ffv1',
    label: 'MKV · FFV1 (lossless)',
    ext: 'mkv',
    needsFfmpeg: true,
    args: (src, out) => ['-i', src, '-c:v', 'ffv1', '-level', '3', '-g', '1', '-c:a', 'copy', out]
  },
  {
    id: 'avi-raw',
    label: 'AVI · uncompressed (raw)',
    ext: 'avi',
    needsFfmpeg: true,
    args: (src, out) => ['-i', src, '-c:v', 'rawvideo', '-pix_fmt', 'bgr24', '-c:a', 'pcm_s16le', out]
  },
  {
    id: 'webm-vp9',
    label: 'WebM · VP9',
    ext: 'webm',
    needsFfmpeg: true,
    args: (src, out, c) =>
      c === 'vp9'
        ? ['-i', src, '-c', 'copy', out]
        : ['-i', src, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '20', '-row-mt', '1', '-c:a', 'copy', out]
  }
]

/** The delivery formats offered to the renderer (ffmpeg ones only when present). */
export function recordingFormats(): Array<{ id: string; label: string }> {
  const hasFf = ffmpegAvailable()
  return FORMATS.filter((f) => !f.needsFfmpeg || hasFf).map((f) => ({ id: f.id, label: f.label }))
}

function recordedFolder(): string {
  return join(userFilesBase(), 'Recorded')
}

async function ensureFolder(): Promise<string> {
  let dir = recordedFolder()
  try {
    if (!existsSync(dir)) await fs.mkdir(dir, { recursive: true })
  } catch {
    dir = join(app.getPath('userData'), 'Recorded')
    if (!existsSync(dir)) await fs.mkdir(dir, { recursive: true })
  }
  return dir
}

// yyyymmdd-hhmmss (local) for sortable, collision-resistant filenames.
function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

let stream: WriteStream | null = null
let tmpPath: string | null = null
let srcCodec = 'h264' // intermediate codec, told to us at start (for remux decisions)

/** Open a new intermediate recording file. `intermediateExt`/`codec` describe
 *  what the renderer's MediaRecorder is producing. Returns ok. */
export async function recordingStart(intermediateExt: string, codec: string): Promise<boolean> {
  try {
    if (stream) {
      // Starting a new take while one is still recording. End the old stream
      // and, once its handle is closed, delete its intermediate — otherwise the
      // orphaned .opsia-rec-* file lingers in Recorded/ forever. Best-effort:
      // Windows can't unlink a still-open handle, hence the end() callback.
      const oldStream = stream
      const oldPath = tmpPath
      oldStream.end(() => {
        if (oldPath) fs.rm(oldPath).catch(() => {})
      })
    }
    const dir = await ensureFolder()
    const safeExt = /^[a-z0-9]+$/i.test(intermediateExt) ? intermediateExt : 'mkv'
    srcCodec = /^[a-z0-9]+$/i.test(codec) ? codec : 'h264'
    tmpPath = join(dir, `.opsia-rec-${stamp()}.${safeExt}`)
    stream = createWriteStream(tmpPath)
    return true
  } catch (e) {
    console.error('[recording] start failed:', (e as Error).message)
    stream = null
    tmpPath = null
    return false
  }
}

export function recordingChunk(data: Uint8Array): void {
  if (!stream) return
  stream.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const bin = ffmpegPath()
    if (!bin) return reject(new Error('ffmpeg unavailable'))
    const child = execFile(
      bin,
      ['-y', '-hide_banner', '-loglevel', 'error', ...args],
      { windowsHide: true },
      (err) => {
        children.delete(child)
        err ? reject(err) : resolve()
      }
    )
    // Track in the shared reap set so quitting mid-transcode (killAllConverts on
    // before-quit) kills this ffmpeg instead of orphaning it (Windows).
    children.add(child)
  })
}

/** Close the intermediate, then produce the chosen delivery format. Returns the
 *  finished clip's path (falls back to the raw intermediate if ffmpeg fails). */
export async function recordingStop(formatId: string): Promise<string | null> {
  const src = tmpPath
  await new Promise<void>((resolve) => {
    if (!stream) return resolve()
    stream.end(() => resolve())
  })
  stream = null
  tmpPath = null
  if (!src || !existsSync(src)) return null

  const fmt = FORMATS.find((f) => f.id === formatId) ?? FORMATS[0]
  const dir = dirname(src)
  const finalPath = join(dir, `opsia-${stamp()}.${fmt.ext}`)

  // Passthrough (or no ffmpeg): just rename the intermediate into place.
  if (!fmt.args || !ffmpegAvailable()) {
    try {
      await fs.rename(src, finalPath)
      return finalPath
    } catch {
      return src // leave the temp file rather than losing the take
    }
  }
  // Transcode / remux, then delete the intermediate.
  try {
    await runFfmpeg(fmt.args(src, finalPath, srcCodec))
    await fs.rm(src).catch(() => {})
    return finalPath
  } catch (e) {
    console.error('[recording] ffmpeg failed, keeping intermediate:', (e as Error).message)
    // Keep the intermediate (renamed to a visible name) so the take isn't lost.
    const fallback = join(dir, `opsia-${stamp()}.mkv`)
    await fs.rename(src, fallback).catch(() => {})
    return existsSync(fallback) ? fallback : src
  }
}

/** Write a one-shot PNG screenshot into Recorded/; returns its path. */
export async function saveScreenshot(data: Uint8Array): Promise<string | null> {
  try {
    const dir = await ensureFolder()
    const path = join(dir, `opsia-${stamp()}.png`)
    await fs.writeFile(path, Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    return path
  } catch (e) {
    console.error('[recording] screenshot failed:', (e as Error).message)
    return null
  }
}
