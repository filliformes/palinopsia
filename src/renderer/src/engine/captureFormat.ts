// A camera's capture format, per camera (by its name, as its mirror) : the
// resolution and frame rate asked of it. The lag of a live camera is mostly
// there : at its highest resolution many webcams fall to a low frame rate (or
// a compressed format the computer must decode), and each frame then waits
// longer. Applied to an open camera at once (no reopening).

export type CaptureRes = 'auto' | '2160' | '1080' | '720' | '480'
export interface CaptureFormat { res: CaptureRes; fps: number }

export const CAPTURE_DEFAULT: CaptureFormat = { res: 'auto', fps: 0 }
export const CAPTURE_RES: CaptureRes[] = ['auto', '2160', '1080', '720', '480']
export const CAPTURE_FPS = [0, 24, 25, 30, 50, 60, 120]

const KEY = 'opsia.cameraFormat'
const SIZE: Record<Exclude<CaptureRes, 'auto'>, [number, number]> = {
  2160: [3840, 2160], 1080: [1920, 1080], 720: [1280, 720], 480: [640, 480]
}

/** A camera's key (the default camera; another by its name, as picked) : null
 *  for what is not a camera here (a screen, NDI, a USB input on the Mac). */
export function cameraKey(spec: string, name: string): string | null {
  if (spec === 'webcam') return 'webcam'
  if (spec.startsWith('device:') && !spec.startsWith('device:avf:')) return `device:${name || spec.slice(7)}`
  return null
}

function readAll(): Record<string, CaptureFormat> {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return v && typeof v === 'object' ? (v as Record<string, CaptureFormat>) : {}
  } catch {
    return {}
  }
}

export function captureFormat(key: string | null): CaptureFormat {
  if (!key) return { ...CAPTURE_DEFAULT }
  const f = readAll()[key]
  return {
    res: f && CAPTURE_RES.includes(f.res) ? f.res : 'auto',
    fps: f && CAPTURE_FPS.includes(f.fps) ? f.fps : 0
  }
}

const listeners = new Set<(key: string, f: CaptureFormat) => void>()

export function setCaptureFormat(key: string, f: CaptureFormat): void {
  try {
    const all = readAll()
    all[key] = f
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch { /* storage blocked : this time only */ }
  for (const fn of listeners) fn(key, f)
}

export function onCaptureFormat(fn: (key: string, f: CaptureFormat) => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** The video constraints for a format. `auto` : a picked device at its highest
 *  resolution (as it always opened), the default camera at the system's own. */
export function videoConstraints(f: CaptureFormat, device: boolean): MediaTrackConstraints {
  const c: MediaTrackConstraints = {}
  if (f.res !== 'auto') {
    const [w, h] = SIZE[f.res]
    c.width = { ideal: w }
    c.height = { ideal: h }
  } else if (device) {
    c.width = { ideal: 3840 }
    c.height = { ideal: 2160 }
  }
  if (f.fps) c.frameRate = { ideal: f.fps }
  return c
}

// The open cameras, to show what each really gives
export interface CaptureStatus { w: number; h: number; fps: number }
const live = new Map<object, { key: string; status: () => CaptureStatus | null }>()

export function registerCapture(owner: object, key: string, status: () => CaptureStatus | null): void {
  live.set(owner, { key, status })
}

export function unregisterCapture(owner: object): void {
  live.delete(owner)
}

/** What an open camera of this key delivers now (null : none open). */
export function captureStatus(key: string | null): CaptureStatus | null {
  if (!key) return null
  for (const v of live.values()) if (v.key === key) return v.status()
  return null
}

export const resLabel = (r: CaptureRes): string => (r === 'auto' ? 'auto' : r === '2160' ? '4K' : `${r}p`)
