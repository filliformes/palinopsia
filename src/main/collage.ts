// Collage — folder → playable clip pool (main process).
//
// The cheap counterpart to assemble.ts : no strip decode, no descriptors, no
// cache. Every top-level video file in the folder becomes ONE clip, described
// by what `ffmpeg -i` already prints (duration + frame size), so a scan costs
// one probe per file.
//
// The one piece of real work is the CODEC BRIDGE, which is also the reason this
// scan exists at all rather than the renderer just listing the folder. The same
// walk doubles as the OPTIMISE pass, which force-transcodes the whole folder
// into the seek-friendly Collage profile — see convertForCollage.

import { dialog, ipcMain } from 'electron'
import { createHash } from 'crypto'
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { CollageClip, CollageScanResult } from '@shared/collage'
import { collageCacheFor, convertForCollage, convertToCache, probe } from './videoConvert'

const VIDEO_EXTS = /\.(mp4|m4v|mov|dxv|webm|mkv|avi|mpg|mpeg|mxf|m2v)$/i

/** Clip identity, on the videoConvert.ts convention : path + size + mtime. The
 *  key is stable across scans, so a pool can be persisted and re-matched. */
function clipId(src: string): string {
  const st = statSync(src)
  return createHash('sha1').update(`${src}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 20)
}

/** Read one folder (top level only) into a clip pool. Reports progress per file.
 *  In OPTIMISE mode every file is force-transcoded into the lean 720p all-intra
 *  Collage profile instead of only the codecs Chromium cannot decode : it is the
 *  SEEK cost, not the codec, that stutters a wall of 50 pieces. Costly once per
 *  file, then cached forever. */
async function scanFolder(
  folder: string,
  onProgress: (p: { done: number; total: number; file: string }) => void,
  optimise = false
): Promise<CollageScanResult> {
  let names: string[] = []
  try {
    names = readdirSync(folder).filter((f) => VIDEO_EXTS.test(f)).sort()
  } catch (e) {
    return { ok: false, clips: [], skipped: [], error: `cannot read folder : ${(e as Error).message}` }
  }

  const clips: CollageClip[] = []
  const skipped: string[] = []

  for (const name of names) {
    const path = join(folder, name)
    try {
      const pr = await probe(path)
      if (!pr.ok || pr.durationSec <= 0) throw new Error(pr.error ?? 'no readable video stream')
      // Either way the clip carries the CACHE path when it was transcoded, while
      // `fileName` keeps the original's name for the UI.
      let file = path
      let width = pr.width
      let height = pr.height
      if (optimise) {
        // A transcode is minutes, not milliseconds : announce the file BEFORE
        // starting it so the counter isn't frozen on the one being worked on.
        onProgress({ done: clips.length + skipped.length, total: names.length, file: name })
        const conv = await convertForCollage(path)
        if (!conv.ok || !conv.path) throw new Error(conv.error ?? 'optimise failed')
        file = conv.path
        // The optimise profile DOWNSCALES, and the renderer cover-crops each
        // piece from these numbers : a stale 4K size would mis-frame every piece
        // on the wall. Re-probe the output; if that comes back empty, fall back
        // to the source aspect at the profile's height (kept even, as the
        // encoder's yuv420p demands).
        const op = await probe(conv.path)
        if (op.ok && op.width > 0 && op.height > 0) {
          width = op.width
          height = op.height
        } else if (pr.width > 0 && pr.height > 0) {
          height = Math.min(720, pr.height) & ~1
          width = Math.max(2, Math.round(((pr.width / pr.height) * height) / 2) * 2)
        }
      } else if (collageCacheFor(path)) {
        // Already optimised on an earlier pass : prefer it. A re-scan must not
        // quietly hand playback back to the long-GOP original.
        const hit = collageCacheFor(path)!
        file = hit
        const op = await probe(hit)
        if (op.ok && op.width > 0 && op.height > 0) {
          width = op.width
          height = op.height
        }
      } else if (pr.needsConvert) {
        // Playback runs through Chromium <video>, which cannot decode DXV / HAP /
        // ProRes / DNxHD / MJPEG / MPEG-2… — exactly the codecs a VJ folder is
        // full of. ffmpeg PROBES them happily, so without this bridge the pool
        // would look perfectly healthy and play BLACK. Same all-intra H.264 cache
        // the single-clip import uses (deduped + cached per source file : the
        // transcode happens once, ever).
        const conv = await convertToCache(path)
        if (!conv.ok || !conv.path) throw new Error(conv.error ?? 'conversion failed')
        file = conv.path
      }
      clips.push({
        id: clipId(path),
        file,
        fileName: name,
        durSec: pr.durationSec,
        width,
        height
      })
    } catch (e) {
      // One unusable file must not abandon the scan : name it and carry on.
      skipped.push(name)
      console.warn(`[collage] skipped ${name}:`, (e as Error).message)
    }
    onProgress({ done: clips.length + skipped.length, total: names.length, file: name })
  }

  return { ok: true, clips, skipped }
}

export function registerCollage(): void {
  ipcMain.handle('collage:pickFolder', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Choose a video folder to analyse',
      properties: ['openDirectory']
    })
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
  })

  ipcMain.handle('collage:scan', async (e, folder: string) => {
    try {
      return await scanFolder(folder, (p) => {
        if (!e.sender.isDestroyed()) e.sender.send('collage:progress', p)
      })
    } catch (err) {
      return { ok: false, clips: [], skipped: [], error: (err as Error).message }
    }
  })

  // Same walk, same result shape — the renderer swaps its pool with this exactly
  // as it does a scan's — but every file is re-encoded to the seek-friendly
  // profile on the way through, so the wall stops stuttering on its own seeks.
  ipcMain.handle('collage:optimise', async (e, folder: string) => {
    try {
      return await scanFolder(
        folder,
        (p) => {
          if (!e.sender.isDestroyed()) e.sender.send('collage:progress', p)
        },
        true
      )
    } catch (err) {
      return { ok: false, clips: [], skipped: [], error: (err as Error).message }
    }
  })
}
