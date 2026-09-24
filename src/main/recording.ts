// Output recording + screenshots → the "Recorded" folder next to the app
// (project root in dev, install dir when packaged; falls back to <userData>),
// or the folder the player chose (see "The recording folder" below).
//
// Two kinds of format :
//   · REAL-TIME (DXV3) : the renderer compresses on the GPU and its preload
//     writes the file as it goes (src/preload/recWriter.ts); main only names it
//     (takePath). No size limit from a video encoder : the full dome records.
//   · ENCODER formats, below.
//
// Encoder pipeline: the renderer records the output canvas with MediaRecorder at a HIGH
// bitrate using a hardware-accelerated codec (H.264 where available) into a
// temporary intermediate file, streamed here chunk-by-chunk. On stop we hand it
// to ffmpeg (ffmpeg-static) to produce the chosen delivery format : a fast
// stream-copy remux when the codecs already match (no re-encode, no quality
// loss), or a real transcode for ProRes / FFV1 / uncompressed / H.265 / VP9.
// No ffmpeg on PATH → we just keep the intermediate as-is.

import { app, dialog, type BrowserWindow } from 'electron'
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync, promises as fs, type WriteStream } from 'fs'
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
  kind: 'realtime' | 'encoder'
  needsFfmpeg: boolean
  args?: (src: string, out: string, srcCodec: string) => string[]
}

const FORMATS: Fmt[] = [
  {
    // Resolume's GPU codec, written in real time (see the header) : plays back
    // smoothly in Resolume with no conversion, at any size up to 4096.
    id: 'dxv3',
    label: 'DXV3 · Resolume (real time, full size)',
    ext: 'mov',
    kind: 'realtime',
    needsFfmpeg: false
  },
  {
    // What Chromium's hardware encoder wrote, untouched : H.264 in Matroska,
    // variable frame rate, no seek index. Instant, but editors and Resolume
    // prefer the MP4 below (also instant : the same video, remuxed).
    id: 'source',
    label: 'MKV · H.264 as captured (instant)',
    ext: 'mkv',
    kind: 'encoder',
    needsFfmpeg: false
  },
  {
    id: 'mp4-h264',
    label: 'MP4 · H.264 (high quality)',
    ext: 'mp4',
    kind: 'encoder',
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
    kind: 'encoder',
    needsFfmpeg: true,
    args: (src, out) => ['-i', src, '-c:v', 'libx265', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-c:a', 'aac', '-b:a', '256k', out]
  },
  {
    id: 'mov-prores',
    label: 'MOV · ProRes 422 HQ',
    ext: 'mov',
    kind: 'encoder',
    needsFfmpeg: true,
    args: (src, out) => ['-i', src, '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s16le', out]
  },
  {
    id: 'mkv-ffv1',
    label: 'MKV · FFV1 (lossless)',
    ext: 'mkv',
    kind: 'encoder',
    needsFfmpeg: true,
    args: (src, out) => ['-i', src, '-c:v', 'ffv1', '-level', '3', '-g', '1', '-c:a', 'copy', out]
  },
  {
    id: 'avi-raw',
    label: 'AVI · uncompressed (raw)',
    ext: 'avi',
    kind: 'encoder',
    needsFfmpeg: true,
    args: (src, out) => ['-i', src, '-c:v', 'rawvideo', '-pix_fmt', 'bgr24', '-c:a', 'pcm_s16le', out]
  },
  {
    id: 'webm-vp9',
    label: 'WebM · VP9',
    ext: 'webm',
    kind: 'encoder',
    needsFfmpeg: true,
    args: (src, out, c) =>
      c === 'vp9'
        ? ['-i', src, '-c', 'copy', out]
        : ['-i', src, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '20', '-row-mt', '1', '-c:a', 'copy', out]
  }
]

/** The delivery formats offered to the renderer (ffmpeg ones only when present). */
export function recordingFormats(): Array<{ id: string; label: string; kind: 'realtime' | 'encoder' }> {
  const hasFf = ffmpegAvailable()
  return FORMATS.filter((f) => !f.needsFfmpeg || hasFf).map((f) => ({ id: f.id, label: f.label, kind: f.kind }))
}

// ── The recording folder ─────────────────────────────────────────────────
// Recorded/ next to the app by default, or a folder the player chose (Output →
// Record → location), remembered per machine in <userData>/recording.json. Takes,
// screenshots and Assemble exports all land there. A chosen folder that is gone
// (an unplugged drive) falls back to the default rather than losing the take.

export interface RecordingFolder {
  path: string // where the next take goes
  chosen: string | null // the player's folder, null = the default
  defaultPath: string
  available: boolean // false : the chosen folder can't be reached (the default is used)
  error?: string
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'recording.json')
}

function chosenFolder(): string | null {
  try {
    const j = JSON.parse(readFileSync(settingsPath(), 'utf8')) as { folder?: unknown }
    return typeof j.folder === 'string' && j.folder.trim() ? j.folder : null
  } catch {
    return null
  }
}

function defaultFolder(): string {
  return join(userFilesBase(), 'Recorded')
}

/** Where the next take goes, created if needed. */
export function outputFolder(): string {
  const chosen = chosenFolder()
  if (chosen) {
    try {
      mkdirSync(chosen, { recursive: true })
      return chosen
    } catch {
      console.warn(`[recording] ${chosen} can't be reached : recording to the default folder`)
    }
  }
  const dir = defaultFolder()
  try {
    mkdirSync(dir, { recursive: true })
    return dir
  } catch {
    const fallback = join(app.getPath('userData'), 'Recorded')
    mkdirSync(fallback, { recursive: true })
    return fallback
  }
}

export function recordingFolderInfo(): RecordingFolder {
  const chosen = chosenFolder()
  // Reachable = it exists, or its parent does (it will simply be recreated).
  const available = !chosen || existsSync(chosen) || existsSync(dirname(chosen))
  return { path: chosen && available ? chosen : defaultFolder(), chosen, defaultPath: defaultFolder(), available }
}

function setChosenFolder(folder: string | null): void {
  writeFileSync(settingsPath(), JSON.stringify({ folder }, null, 2))
}

/** Ask for a folder; keep it only if we can actually write there. */
export async function chooseRecordingFolder(parent: BrowserWindow | null): Promise<RecordingFolder> {
  const cur = recordingFolderInfo()
  const opts = {
    title: 'Where should recordings and screenshots go?',
    defaultPath: cur.path,
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>
  }
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
  if (r.canceled || !r.filePaths.length) return cur
  const folder = r.filePaths[0]
  const probe = join(folder, `.opsia-write-test-${process.pid}`)
  try {
    await fs.writeFile(probe, '')
    await fs.rm(probe)
  } catch {
    return { ...cur, error: `Palinopsia can't write to ${folder}` }
  }
  setChosenFolder(folder)
  return recordingFolderInfo()
}

/** Back to Recorded/ next to the app. */
export function resetRecordingFolder(): RecordingFolder {
  setChosenFolder(null)
  return recordingFolderInfo()
}

/** A fresh file path in the recording folder for a real-time take (its preload writes it). */
export async function takePath(ext: string): Promise<string | null> {
  try {
    const dir = await ensureFolder()
    return join(dir, `opsia-${stamp()}.${/^[a-z0-9]+$/i.test(ext) ? ext : 'mov'}`)
  } catch (e) {
    console.error('[recording] no folder:', (e as Error).message)
    return null
  }
}

async function ensureFolder(): Promise<string> {
  return outputFolder()
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
  // A take the encoder never fed (e.g. it refused the frame size) : don't leave
  // an empty file behind under a real clip's name.
  if ((await fs.stat(src).catch(() => null))?.size === 0) {
    await fs.rm(src).catch(() => {})
    return null
  }

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
