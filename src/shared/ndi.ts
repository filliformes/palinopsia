// NDI output : shared config + status (main ↔ preload sender ↔ renderer).
//
// NDI® is a registered trademark of Vizrt NDI AB (https://ndi.video).
//
// The sender lives in the main window's preload (src/preload/ndi.ts) and calls
// the NDI runtime directly through an FFI (koffi) : nothing is compiled against
// Electron. It sits in the renderer's own process because every route that
// moves a 4K frame to another process copies it far too slowly.

export type NdiFormat = 'uyvy' | 'rgbx'

export interface NdiConfig {
  enabled: boolean // also : start NDI with the app (a venue restart comes back live)
  name: string // the source name; receivers see "MACHINE (name)"
  groups: string // NDI groups, comma separated ('' = Public)
  fps: number // declared + paced frame rate : 25 · 29.97 · 30 · 50 · 59.94 · 60
  format: NdiFormat // uyvy : half the bytes, NDI's native format · rgbx : full RGB
  maxSize: number // longest edge cap in px (0 = native, never above NDI_MAX_EDGE)
  // Network (applied through Palinopsia's own ndi-config.v1.json; a change
  // restarts the sender) :
  discovery: string // NDI Discovery Server address(es), "ip[:port],…" ('' = mDNS)
  adapter: string // restrict NDI to these local IPs ("10.10.30.5,…", '' = all)
  extraIps: string // extra IPs to announce to (networks.ips), for routed networks
}

/** NDI receivers and the transport rarely go past 4K; an 8K dome master is
 *  scaled to this edge for the stream (the file / projector paths keep 8K). */
export const NDI_MAX_EDGE = 4096

export const NDI_FPS = [25, 29.97, 30, 50, 59.94, 60] as const

export function defaultNdiConfig(): NdiConfig {
  return {
    enabled: false,
    name: 'Palinopsia',
    groups: '',
    fps: 30,
    format: 'uyvy',
    maxSize: 0,
    discovery: '',
    adapter: '',
    extraIps: ''
  }
}

export function sanitizeNdiConfig(raw: unknown): NdiConfig {
  const d = defaultNdiConfig()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<NdiConfig>
  const str = (v: unknown, fb: string, max = 120): string => (typeof v === 'string' ? v.slice(0, max) : fb)
  const fps = Number(r.fps)
  return {
    enabled: !!r.enabled,
    name: str(r.name, d.name, 60).trim() || d.name,
    groups: str(r.groups, d.groups),
    fps: (NDI_FPS as readonly number[]).includes(fps) ? fps : d.fps,
    format: r.format === 'rgbx' ? 'rgbx' : 'uyvy',
    maxSize: [0, 1280, 1920, 2048, 3840, 4096].includes(Number(r.maxSize)) ? Number(r.maxSize) : d.maxSize,
    discovery: str(r.discovery, d.discovery, 200).trim(),
    adapter: str(r.adapter, d.adapter, 200).trim(),
    extraIps: str(r.extraIps, d.extraIps, 400).trim()
  }
}

/** NDI's rational frame rate for a nominal fps (29.97 → 30000/1001). */
export function ndiRate(fps: number): [number, number] {
  if (Math.abs(fps - 29.97) < 0.01) return [30000, 1001]
  if (Math.abs(fps - 59.94) < 0.01) return [60000, 1001]
  return [Math.round(fps) * 1000, 1000]
}

export type NdiState = 'off' | 'starting' | 'live' | 'no-runtime' | 'error'

export interface NdiStatus {
  state: NdiState
  message: string // human-readable detail for the UI
  source: string // the full NDI name receivers see ("MACHINE (Palinopsia)")
  runtime: string // path of the NDI library in use
  version: string // NDIlib_version()
  connections: number // NDI connections (one receiver may open several)
  program: boolean // tally : a receiver has us on program (on air)
  preview: boolean // tally : on preview
  fps: number // frames actually sent in the last second
  width: number
  height: number
  dropped: number // frames that could not be sent in the last second
}

export function idleNdiStatus(): NdiStatus {
  return {
    state: 'off', message: '', source: '', runtime: '', version: '',
    connections: 0, program: false, preview: false, fps: 0, width: 0, height: 0, dropped: 0
  }
}

/** Where to get the official runtime when none is found on the machine. */
export const NDI_RUNTIME_URL = 'https://ndi.video/tools/'
