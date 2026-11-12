// Spout / Syphon input : another program's picture on THIS computer (Spout on
// Windows, Syphon on macOS) as a layer source. Shared by the preload's
// receivers (src/preload/shareIn.ts), the macOS client in main
// (src/main/syphonIn.ts) and the page's picker, readout and engine.
//
// A slot's mediaId is `spout:<sender name>` on Windows and `syphon:<server
// name>` on macOS. Either prefix opens on either system : a session made on
// one computer finds a sender of the same name on the other.

export const SHARE_IN_PREFIXES = ['spout:', 'syphon:'] as const

/** The sender's name in a `spout:` / `syphon:` spec, or null for any other spec. */
export function shareInName(spec: string | null | undefined): string | null {
  if (!spec) return null
  for (const p of SHARE_IN_PREFIXES) if (spec.startsWith(p)) return spec.slice(p.length)
  return null
}

/** The spec this computer writes for a sender's name. */
export function shareInSpec(name: string, platform: string): string {
  return `${platform === 'darwin' ? 'syphon' : 'spout'}:${name}`
}

/** 'Spout' on Windows, 'Syphon' on macOS, null elsewhere (neither exists). */
export function shareInKind(platform: string): 'Spout' | 'Syphon' | null {
  return platform === 'win32' ? 'Spout' : platform === 'darwin' ? 'Syphon' : null
}

export interface ShareInSender {
  name: string
  /** 0 when the system does not say (Syphon lists names only). */
  w: number
  h: number
}

export interface ShareInList {
  ok: boolean
  senders: ShareInSender[]
  message: string
}

/** What a receiver is doing, for the Inspector's readout. */
export interface ShareInStatus {
  /** waiting : no sender by that name (yet, or it closed); live : frames;
   *  unsupported : a pixel format it cannot carry; other-gpu : the sender draws
   *  on a graphics card this route cannot read (the copy route takes over);
   *  failed / unavailable : no module or no device on this computer. */
  state: 'waiting' | 'live' | 'unsupported' | 'other-gpu' | 'failed' | 'unavailable'
  w: number
  h: number
  /** The sender's own frame rate, when it says (0 otherwise). */
  fps: number
  /** gpu : shared on the graphics card, no copy; cpu : copied through memory. */
  route: 'gpu' | 'cpu' | ''
  error: string
}

/** A frame handed to the page on the GPU route : a VideoFrame over the shared
 *  texture (closed by the page once uploaded). */
export interface ShareInGpuFrame {
  vf: VideoFrame
  seq: number
  w: number
  h: number
  /** When the receiver had it ready (ms since the epoch, this computer's clock). */
  stamp: number
}
