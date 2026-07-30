// Assemble — corpus analysis (main process).
//
// One ffmpeg pass per file produces a tiny raw-RGB "strip" (64² at 8 fps); every
// descriptor in shared/assemble.ts is computed on that strip as it streams, so a
// folder of films is reduced to a point cloud without ever decoding at full res
// and without holding a whole movie in memory. Results are cached per file by
// path+size+mtime (the videoConvert.ts convention), so re-opening a corpus is
// instant and only new/changed files are re-swept.
//
// Segmentation follows the user's choice : detect real shot boundaries from the
// motion signal, then subdivide anything still longer than `maxUnit`. A single
// long take has no cuts to find, so it falls through to that subdivision — the
// grid fallback comes free from the same code path.

import { app, dialog, ipcMain } from 'electron'
import { spawn } from 'child_process'
import { createHash } from 'crypto'
import {
  existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync
} from 'fs'
import { dirname, join } from 'path'
import {
  aggregate,
  ANALYSIS_FPS,
  corpusStats,
  frameDiff,
  frameStats,
  GRID,
  THUMB,
  type AssembleClip,
  type AssembleCorpus,
  type AssembleUnit,
  type FrameStats
} from '@shared/assemble'
import { children, resolveFfmpeg } from './videoConvert'

// Bump when the descriptor set or segmentation changes : old caches are then
// ignored rather than silently mixing incompatible vectors into one corpus.
// v2 : VIVO warmness + saturation dispersion + signed drift axes, and per-unit
// head/tail vectors for Schödl's successor-based join cost.
const CACHE_VERSION = 2

const VIDEO_EXTS = /\.(mp4|m4v|mov|dxv|webm|mkv|avi|mpg|mpeg|mxf|m2v)$/i
const FRAME_BYTES = GRID * GRID * 3
// Keep roughly one thumbnail per second of footage.
const THUMB_STRIDE = ANALYSIS_FPS
// Per-file ceiling for the analysis pass : a stalled ffmpeg is killed, that
// file is skipped, and the sweep carries on.
const ANALYZE_TIMEOUT_MS = 5 * 60_000

export interface AnalyzeOptions {
  minUnit: number // shortest kept segment, seconds
  maxUnit: number // longest kept segment — longer ones subdivide (grid fallback)
  sensitivity: number // 0..1 cut-detection eagerness
}

export const DEFAULT_ANALYZE: AnalyzeOptions = { minUnit: 0.4, maxUnit: 5, sensitivity: 0.5 }

function cacheDir(): string {
  const dir = join(app.getPath('userData'), 'assemble-cache')
  mkdirSync(dir, { recursive: true })
  return dir
}

function cacheKey(src: string, opts: AnalyzeOptions): string {
  const st = statSync(src)
  return createHash('sha1')
    .update(`${CACHE_VERSION}|${src}|${st.size}|${st.mtimeMs}|${opts.minUnit}|${opts.maxUnit}|${opts.sensitivity}`)
    .digest('hex')
    .slice(0, 20)
}

/**
 * Stream one file through ffmpeg and reduce it to per-frame stats.
 *
 * ffmpeg hands us rawvideo in arbitrary chunk sizes, so bytes are accumulated
 * into exact FRAME_BYTES frames. Two luminance buffers ping-pong because
 * frameStats() writes into the one it's given and the next frame needs the
 * previous one intact to difference against.
 */
function stripStats(path: string): Promise<{ frames: FrameStats[]; diffs: number[]; thumbs: Uint8Array[] }> {
  return new Promise((resolve, reject) => {
    const bin = resolveFfmpeg()
    if (!bin) return reject(new Error('ffmpeg not found'))
    const child = spawn(
      bin,
      [
        '-hide_banner',
        '-nostdin',
        '-i',
        path,
        '-an',
        '-sn',
        '-vf',
        `fps=${ANALYSIS_FPS},scale=${GRID}:${GRID}:flags=bilinear`,
        '-pix_fmt',
        'rgb24',
        '-f',
        'rawvideo',
        '-'
      ],
      { windowsHide: true }
    )
    children.add(child)

    const frames: FrameStats[] = []
    const diffs: number[] = []
    // One thumb per THUMB_STRIDE frames, not per frame. Only ONE thumb per unit
    // is ever read, but unit boundaries aren't known until the stream ends —
    // keeping every frame's chip cost ~44 MB on a 30-minute file and ~180 MB on
    // a two-hour one, which flatly contradicted this module's memory claim.
    const thumbs: Uint8Array[] = []
    let grayA = new Float32Array(GRID * GRID)
    let grayB = new Float32Array(GRID * GRID)
    let have = 0
    const buf = Buffer.allocUnsafe(FRAME_BYTES)
    let err = ''

    child.stdout.on('data', (chunk: Buffer) => {
      let off = 0
      while (off < chunk.length) {
        const need = FRAME_BYTES - have
        const take = Math.min(need, chunk.length - off)
        chunk.copy(buf, have, off, off + take)
        have += take
        off += take
        if (have < FRAME_BYTES) break
        have = 0
        const rgb = new Uint8Array(buf.buffer, buf.byteOffset, FRAME_BYTES)
        const st = frameStats(rgb, grayA)
        // grayA now holds THIS frame, grayB the previous one. Difference, then
        // swap so the next frame writes the other buffer and this one survives.
        if (frames.length > 0) diffs.push(frameDiff(grayA, grayB))
        const t = grayA
        grayA = grayB
        grayB = t
        frames.push(st)
        if (frames.length % THUMB_STRIDE === 1) thumbs.push(downsampleThumb(rgb))
      }
    })
    child.stderr.on('data', (d: Buffer) => {
      err += d.toString()
      if (err.length > 32768) err = err.slice(-16384)
    })
    // An EPIPE on either pipe (most likely when killAllConverts reaps this child
    // on quit) arrives as an unhandled 'error' event, which THROWS in main.
    child.stdout.on('error', () => {})
    child.stderr.on('error', () => {})
    // Without this, one ffmpeg stalling on a corrupt or network-mounted file
    // hangs analyzeFolder's sequential await forever — no progress, no way out
    // but quitting the app.
    const guard = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* already gone */
      }
    }, ANALYZE_TIMEOUT_MS)
    child.on('error', (e) => {
      clearTimeout(guard)
      children.delete(child)
      reject(e)
    })
    child.on('close', () => {
      clearTimeout(guard)
      children.delete(child)
      if (frames.length === 0) return reject(new Error(err.split('\n').slice(-4).join(' ').trim() || 'no frames'))
      resolve({ frames, diffs, thumbs })
    })
  })
}

/** Box-downsample the GRID² analysis frame to a THUMB² RGB chip for the UI. */
function downsampleThumb(rgb: Uint8Array): Uint8Array {
  const out = new Uint8Array(THUMB * THUMB * 3)
  const step = GRID / THUMB
  for (let y = 0; y < THUMB; y++) {
    for (let x = 0; x < THUMB; x++) {
      let r = 0
      let g = 0
      let b = 0
      let n = 0
      for (let sy = 0; sy < step; sy++) {
        for (let sx = 0; sx < step; sx++) {
          const p = (((y * step) | 0) + sy) * GRID * 3 + ((((x * step) | 0) + sx) * 3)
          r += rgb[p]
          g += rgb[p + 1]
          b += rgb[p + 2]
          n++
        }
      }
      const o = (y * THUMB + x) * 3
      out[o] = (r / n) | 0
      out[o + 1] = (g / n) | 0
      out[o + 2] = (b / n) | 0
    }
  }
  return out
}

/**
 * Find shot boundaries in the motion signal.
 *
 * A global threshold fails across a mixed corpus — a locked-off studio take and
 * a handheld street shot have wildly different baselines. So each frame is
 * compared against the MEDIAN of its neighbourhood: a cut is a spike relative to
 * how much this passage was already moving.
 */
function detectCuts(diffs: number[], sensitivity: number): number[] {
  const cuts: number[] = []
  if (diffs.length < 3) return cuts
  const W = 12
  // Eager at sensitivity 1 (ratio 2.2), conservative at 0 (ratio 7).
  const ratio = 7 - sensitivity * 4.8
  const absMin = 0.10 - sensitivity * 0.07
  const win: number[] = []
  for (let i = 0; i < diffs.length; i++) {
    const lo = Math.max(0, i - W)
    const hi = Math.min(diffs.length, i + W + 1)
    win.length = 0
    for (let k = lo; k < hi; k++) if (k !== i) win.push(diffs[k]);
    win.sort((a, b) => a - b)
    const med = win.length ? win[win.length >> 1] : 0
    if (diffs[i] > absMin && diffs[i] > Math.max(1e-4, med) * ratio) cuts.push(i + 1)
  }
  return cuts
}

function analyzeFile(path: string, fileName: string, opts: AnalyzeOptions): Promise<AssembleUnit[]> {
  return stripStats(path).then(({ frames, diffs, thumbs }) => {
    const dt = 1 / ANALYSIS_FPS
    const cuts = detectCuts(diffs, opts.sensitivity)
    // Segment boundaries in FRAME indices, always closed at both ends.
    const bounds = [0, ...cuts, frames.length]
    const minF = Math.max(2, Math.round(opts.minUnit / dt))
    const maxF = Math.max(minF + 1, Math.round(opts.maxUnit / dt))
    const units: AssembleUnit[] = []

    for (let s = 0; s < bounds.length - 1; s++) {
      const a = bounds[s]
      const b = bounds[s + 1]
      if (b - a < minF) continue // a flash between two cuts : not a shot
      // Subdivide anything over maxUnit into equal pieces. This is also the
      // grid fallback : a file with no detected cuts is one long segment.
      const pieces = Math.max(1, Math.ceil((b - a) / maxF))
      const len = (b - a) / pieces
      for (let p = 0; p < pieces; p++) {
        const fa = Math.round(a + p * len)
        const fb = Math.round(a + (p + 1) * len)
        if (fb - fa < minF) continue
        const slice = frames.slice(fa, fb)
        // diffs[i] is the change FROM frame i TO frame i+1, so the transitions
        // strictly inside segment [fa,fb) are diffs[fa .. fb-2], and the cut
        // spike itself is correctly excluded from both neighbours.
        const dslice = diffs.slice(Math.max(0, fa), Math.max(0, fb - 1))
        const mid = (fa + fb) >> 1
        // Head / tail thirds for the join cost (Schödl's successor rule).
        // At least two frames each, so the temporal axes stay meaningful.
        const third = Math.max(2, Math.round((fb - fa) / 3))
        const hEnd = Math.min(fb, fa + third)
        const tStart = Math.max(fa, fb - third)
        units.push({
          id: `${cacheKeySafe(path)}:${fa}`,
          file: path,
          fileName,
          start: fa * dt,
          dur: (fb - fa) * dt,
          fileDur: frames.length * dt,
          desc: aggregate(slice, dslice),
          head: aggregate(frames.slice(fa, hEnd), diffs.slice(fa, Math.max(fa, hEnd - 1))),
          tail: aggregate(frames.slice(tStart, fb), diffs.slice(tStart, Math.max(tStart, fb - 1))),
          thumb: Buffer.from(
            thumbs[Math.max(0, Math.min((mid / THUMB_STRIDE) | 0, thumbs.length - 1))] ??
              new Uint8Array(THUMB * THUMB * 3)
          ).toString('base64')
        })
      }
    }
    return units
  })
}

const cacheKeySafe = (p: string): string => createHash('sha1').update(p).digest('hex').slice(0, 10)

/** Analyse a whole folder, reusing per-file caches. Reports progress per file. */
export async function analyzeFolder(
  folder: string,
  opts: AnalyzeOptions,
  onProgress: (p: { file: string; index: number; total: number; units: number; done: boolean }) => void
): Promise<AssembleCorpus> {
  let names: string[] = []
  try {
    names = readdirSync(folder).filter((f) => VIDEO_EXTS.test(f)).sort()
  } catch (e) {
    throw new Error(`cannot read folder : ${(e as Error).message}`)
  }
  const units: AssembleUnit[] = []
  let files = 0

  for (let i = 0; i < names.length; i++) {
    const name = names[i]
    const path = join(folder, name)
    onProgress({ file: name, index: i, total: names.length, units: units.length, done: false })
    try {
      const cf = join(cacheDir(), `${cacheKey(path, opts)}.json`)
      let mine: AssembleUnit[] | null = null
      if (existsSync(cf)) {
        try {
          mine = JSON.parse(readFileSync(cf, 'utf8')) as AssembleUnit[]
        } catch {
          mine = null // corrupt cache : just re-analyse
        }
      }
      if (!mine) {
        mine = await analyzeFile(path, name, opts)
        try {
          writeFileSync(cf, JSON.stringify(mine))
        } catch {
          /* cache is an optimization, not a requirement */
        }
      }
      units.push(...mine)
      files++
    } catch (e) {
      // One unreadable file must not abandon the sweep.
      console.warn(`[assemble] skipped ${name}:`, (e as Error).message)
    }
  }

  const { mean, std } = corpusStats(units)
  onProgress({ file: '', index: names.length, total: names.length, units: units.length, done: true })
  return { folder, units, mean, std, files, analyzedAt: Date.now() }
}

// ── Export : render an edit to a real file ───────────────────────────────

// Clips per ffmpeg invocation. Every clip is a separate INPUT (that's what
// makes the `-ss` input seek cheap), but ffmpeg OPENS AND PROBES every input
// before emitting a frame — so a 400-clip edit as one command means 400
// simultaneous demuxers and decoder contexts, minutes pinned at 0%, and
// gigabytes of RSS. Batching caps that at a constant cost.
const EXPORT_BATCH = 40

/** Run one ffmpeg, reporting `time=` progress through `onSec`. */
function runExport(
  bin: string,
  args: string[],
  onSec: (secs: number) => void
): Promise<{ code: number; err: string }> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { windowsHide: true })
    children.add(child)
    let err = ''
    child.stdout?.on('error', () => {})
    child.stderr.on('error', () => {})
    child.stderr.on('data', (d: Buffer) => {
      const t = d.toString()
      err += t
      if (err.length > 32768) err = err.slice(-16384)
      const m = t.match(/time=(\d+):(\d+):(\d+(?:\.\d+)?)/)
      if (m) onSec(Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]))
    })
    child.on('error', (e) => {
      children.delete(child)
      resolve({ code: -1, err: (e as Error).message })
    })
    child.on('close', (code) => {
      children.delete(child)
      resolve({ code: code ?? -1, err })
    })
  })
}

/** Encode one batch of clips into a single intermediate segment. */
async function exportBatch(
  bin: string,
  clips: AssembleClip[],
  out: string,
  onSec: (secs: number) => void
): Promise<string | null> {
  const args: string[] = ['-hide_banner', '-y']
  const parts: string[] = []
  const labels: string[] = []
  clips.forEach((c, i) => {
    // Clamp : these clips can come back from localStorage, and a speed of 0
    // would format to 0.0000 and divide by zero inside setpts.
    const speed = Math.min(8, Math.max(0.1, Number.isFinite(c.speed) ? c.speed : 1))
    const inSec = Math.max(0, Number.isFinite(c.inSec) ? c.inSec : 0)
    const consumed = Math.max(0.02, Math.max(0.02, c.durSec || 0.02) * speed)
    args.push('-ss', inSec.toFixed(3), '-t', consumed.toFixed(3), '-i', c.file)
    // setpts divides by speed : `consumed` source seconds play in `durSec` of
    // output. scale/pad/setsar/fps make every piece concat-compatible.
    parts.push(
      `[${i}:v]setpts=(PTS-STARTPTS)/${speed.toFixed(4)},` +
        `scale=1920:1080:force_original_aspect_ratio=decrease,` +
        `pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30[v${i}]`
    )
    labels.push(`[v${i}]`)
  })
  const graph = `${parts.join(';')};${labels.join('')}concat=n=${clips.length}:v=1:a=0[out]`
  // A long filtergraph blows past the Windows command-line limit, so it goes
  // to a script file.
  const scriptPath = `${out}.graph.txt`
  writeFileSync(scriptPath, graph)
  args.push('-filter_complex_script', scriptPath, '-map', '[out]')
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p')
  args.push(out)
  const { code, err } = await runExport(bin, args, onSec)
  try {
    unlinkSync(scriptPath)
  } catch {
    /* best effort */
  }
  if (code === 0 && existsSync(out)) return null
  return err.split('\n').filter(Boolean).slice(-3).join(' ').trim() || `ffmpeg exited ${code}`
}

/**
 * Flatten an assemblage into one video.
 *
 * Batches of EXPORT_BATCH clips are encoded to intermediate segments, then the
 * segments are joined with the concat DEMUXER and `-c copy` — so the footage is
 * encoded exactly once and the join costs nothing.
 */
async function exportEdl(
  clips: AssembleClip[],
  name: string,
  onPct: (pct: number) => void
): Promise<{ ok: boolean; path?: string; error?: string }> {
  const bin = resolveFfmpeg()
  if (!bin) return { ok: false, error: 'ffmpeg not found' }
  if (!clips.length) return { ok: false, error: 'nothing to export' }

  const dir = recordedFolder()
  mkdirSync(dir, { recursive: true })
  const safe = (name || 'assemblage').replace(/[^\w\-. ]+/g, '_').slice(0, 60).trim() || 'assemblage'
  // 14 digits = yyyymmddhhmmss; slice(0,15) kept the '.' before the fractional
  // seconds and produced 'name-20260730041508..mp4'.
  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const out = join(dir, `${safe}-${stamp}.mp4`)

  const total = clips.reduce((s, c) => s + Math.max(0.02, c.durSec || 0.02), 0)
  const tmp: string[] = []
  const scrub = (): void => {
    for (const f of tmp) {
      try {
        unlinkSync(f)
      } catch {
        /* best effort */
      }
    }
  }

  try {
    let done = 0 // output seconds finished in previous batches
    for (let i = 0; i < clips.length; i += EXPORT_BATCH) {
      const batch = clips.slice(i, i + EXPORT_BATCH)
      const seg = join(cacheDir(), `seg-${stamp}-${(i / EXPORT_BATCH) | 0}.mp4`)
      tmp.push(seg)
      const base = done
      const fail = await exportBatch(bin, batch, seg, (secs) => {
        if (total > 0) onPct(Math.min(99, Math.round(((base + secs) / total) * 100)))
      })
      if (fail) {
        scrub()
        return { ok: false, error: fail }
      }
      done += batch.reduce((s, c) => s + Math.max(0.02, c.durSec || 0.02), 0)
    }

    // One segment : it IS the export, no concat pass needed.
    if (tmp.length === 1) {
      renameSync(tmp[0], out)
      onPct(100)
      return { ok: true, path: out }
    }

    // concat demuxer + stream copy : no re-encode, so no generation loss.
    const listPath = join(cacheDir(), `concat-${stamp}.txt`)
    // concat-demuxer quoting : a literal ' inside a '…' path is written '\''.
    const esc = (f: string): string => f.split("'").join("'\\''")
    writeFileSync(listPath, tmp.map((f) => `file '${esc(f)}'`).join('\n'))
    const { code, err } = await runExport(
      bin,
      ['-hide_banner', '-y', '-f', 'concat', '-safe', '0', '-i', listPath,
       '-c', 'copy', '-movflags', '+faststart', out],
      () => {}
    )
    try {
      unlinkSync(listPath)
    } catch {
      /* best effort */
    }
    scrub()
    if (code === 0 && existsSync(out)) {
      onPct(100)
      return { ok: true, path: out }
    }
    return {
      ok: false,
      error: err.split('\n').filter(Boolean).slice(-3).join(' ').trim() || `concat exited ${code}`
    }
  } catch (e) {
    scrub()
    return { ok: false, error: (e as Error).message }
  }
}

/** Same destination the output recorder writes to : next to the app in a
 *  packaged build, the project root in dev, userData as the fallback. */
function recordedFolder(): string {
  const base = app.isPackaged ? dirname(app.getPath('exe')) : process.cwd()
  const dir = join(base, 'Recorded')
  try {
    mkdirSync(dir, { recursive: true })
    return dir
  } catch {
    return join(app.getPath('userData'), 'Recorded')
  }
}

/** Test seam : the export path is otherwise reachable only over IPC. */
export const __exportEdlForTest = exportEdl

export function registerAssemble(): void {
  ipcMain.handle('assemble:pickFolder', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Choose a video folder to analyse',
      properties: ['openDirectory']
    })
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
  })

  ipcMain.handle('assemble:analyze', async (e, folder: string, opts?: Partial<AnalyzeOptions>) => {
    try {
      const o = { ...DEFAULT_ANALYZE, ...(opts ?? {}) }
      const corpus = await analyzeFolder(folder, o, (p) => {
        if (!e.sender.isDestroyed()) e.sender.send('assemble:progress', p)
      })
      return { ok: true, corpus }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })

  ipcMain.handle('assemble:export', async (e, clips: AssembleClip[], name: string) => {
    try {
      return await exportEdl(clips, name, (pct) => {
        if (!e.sender.isDestroyed()) e.sender.send('assemble:exportProgress', { pct })
      })
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}
