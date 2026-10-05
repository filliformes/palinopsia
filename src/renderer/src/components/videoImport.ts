// Turning a video file on disk into a URL a video slot can play : probe it, and
// when Chromium can't decode its codec (DXV3, HAP, ProRes…) convert it once into
// the all-intra cache through ffmpeg. Shared by the layer picker's Import video…
// and the Inspector's folder browser, so both behave the same.

import { showToast } from './Toast'

/** The persistent opsia-media:// URL of a file on disk (survives a reload). */
export const mediaUrlForPath = (path: string): string => `opsia-media://local/${encodeURIComponent(path)}`

/** The on-disk path behind an opsia-media:// URL (null for blob / remote URLs). */
export function pathFromMediaUrl(url: string | undefined): string | null {
  const pfx = 'opsia-media://local/'
  if (!url || !url.startsWith(pfx)) return null
  try {
    return decodeURIComponent(url.slice(pfx.length))
  } catch {
    return null
  }
}

/** A playable URL for a clip on disk, or null when it can't be made playable
 *  (the reason is toasted). `onProgress` follows a conversion (0..1), then null. */
export async function playableVideoUrl(
  path: string,
  name: string,
  onProgress?: (pct: number | null) => void
): Promise<string | null> {
  try {
    const probe = await window.api.videoProbe(path)
    if (probe.needsConvert) {
      if (!probe.ffmpegAvailable) {
        showToast(
          `"${name}" is ${probe.codec ?? 'a codec'} the player can't read : install ffmpeg to import it (add to PATH, npm i ffmpeg-static, or set OPSIA_FFMPEG)`,
          'warn',
          0 // sticky : an install instruction shouldn't vanish on a timer
        )
        return null
      }
      onProgress?.(0)
      const off = window.api.onVideoConvertProgress((p) => {
        if (p.path === path) onProgress?.(p.pct)
      })
      try {
        const res = await window.api.videoConvert(path)
        if (!res.ok || !res.path) {
          showToast(`Conversion failed : ${res.error ?? 'unknown error'}`, 'warn', 6000)
          return null
        }
        return mediaUrlForPath(res.path)
      } catch (err) {
        // Convert rejected : surface it and stop : don't fall through to
        // direct-play a clip the probe already flagged as needing conversion.
        showToast(`Conversion failed : ${(err as Error)?.message ?? 'unknown error'}`, 'warn', 6000)
        return null
      } finally {
        off()
        onProgress?.(null)
      }
    }
  } catch {
    /* probe failed (no ffmpeg) : just try playing it directly */
  }
  return mediaUrlForPath(path)
}
