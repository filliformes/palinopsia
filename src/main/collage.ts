// Collage — folder → playable clip pool (main process).
//
// The cheap counterpart to assemble.ts : no strip decode, no descriptors, no
// cache. Every top-level video file in the folder becomes ONE clip, described
// by what `ffmpeg -i` already prints (duration + frame size), so a scan costs
// one probe per file.
//
// The one piece of real work is the CODEC BRIDGE, which is also the reason this
// scan exists at all rather than the renderer just listing the folder.

import { dialog, ipcMain } from 'electron'
import { createHash } from 'crypto'
import { readdirSync, statSync } from 'fs'
import { join } from 'path'
import type { CollageClip, CollageScanResult } from '@shared/collage'
import { convertToCache, probe } from './videoConvert'

const VIDEO_EXTS = /\.(mp4|m4v|mov|dxv|webm|mkv|avi|mpg|mpeg|mxf|m2v)$/i

/** Clip identity, on the videoConvert.ts convention : path + size + mtime. The
 *  key is stable across scans, so a pool can be persisted and re-matched. */
function clipId(src: string): string {
  const st = statSync(src)
  return createHash('sha1').update(`${src}|${st.size}|${st.mtimeMs}`).digest('hex').slice(0, 20)
}

/** Read one folder (top level only) into a clip pool. Reports progress per file. */
async function scanFolder(
  folder: string,
  onProgress: (p: { done: number; total: number; file: string }) => void
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
      // Playback runs through Chromium <video>, which cannot decode DXV / HAP /
      // ProRes / DNxHD / MJPEG / MPEG-2… — exactly the codecs a VJ folder is
      // full of. ffmpeg PROBES them happily, so without this bridge the pool
      // would look perfectly healthy and play BLACK. Needs-convert files are
      // routed through the same all-intra H.264 cache the single-clip import
      // uses (deduped + cached per source file : the transcode happens once,
      // ever), and the clip then carries the CACHE path while `fileName` keeps
      // the original's name for the UI.
      let file = path
      if (pr.needsConvert) {
        const conv = await convertToCache(path)
        if (!conv.ok || !conv.path) throw new Error(conv.error ?? 'conversion failed')
        file = conv.path
      }
      clips.push({
        id: clipId(path),
        file,
        fileName: name,
        durSec: pr.durationSec,
        width: pr.width,
        height: pr.height
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
}
