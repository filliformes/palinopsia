// USB input (macOS) : shared by the preload's capture (src/preload/avcapture.ts)
// and the page's picker and readout.

export interface AvfDevice {
  id: string
  name: string
  model: string
  /** Sound and picture in one (an iPhone's screen, a DV camera) : Chromium skips these. */
  muxed: boolean
}

/** What a device is doing, for the Inspector's readout. */
export interface AvfStatus {
  state: 'starting' | 'running' | 'missing' | 'denied' | 'failed' | 'gone' | 'unavailable'
  w: number
  h: number
  srcW: number
  srcH: number
  fps: number
  error: string
}
