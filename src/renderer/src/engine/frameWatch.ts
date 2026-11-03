// When a film's frame callbacks go quiet.
//
// The film sources (VideoSource, AssembleSource, the Collage's decks) upload a
// frame only when requestVideoFrameCallback says a new one was presented : an
// upload made mid-seek grabs the frame from before the seek. But Chromium calls
// back only while the page is being composited. Minimized or hidden, the control
// window gets about one callback a second while its films play on, and the
// engine runs on its timer (App's render loop) to keep the projector, NDI, Spout
// and the recordings fed : every film showed about one frame a second there
// (measured on the output : 1.4 different frames a second instead of 30).
//
// So while callbacks are quiet, a film uploads on the engine's own tick once its
// clock has moved on about a frame, and the element hands over its current frame
// (Chromium keeps rendering a hidden film's frames for exactly this). Quiet : the
// loop runs on its timer, or a callback is long overdue while the film ran on.

let painting = true

/** App's render loop : true on requestAnimationFrame (the window paints), false
 *  on its timer (minimized, hidden). */
export function setPainting(on: boolean): void {
  painting = on
}

// A composited page calls back at every new frame, a slow-motion film included
// (one every ~0.7 s at 1/16 x) : no callback for this long while the film's clock
// moved this far means none are coming.
const OVERDUE_MS = 400
const OVERDUE_FILM_SEC = 0.25
// Until a callback has told it, a film is taken for 30 frames a second.
const PERIOD_DEFAULT = 1 / 30

/** One element's frame callbacks and uploads. */
export class FrameWatch {
  private cbAt = performance.now() // when the last callback came
  private cbT = -1 // the film's time then
  private upT = -1 // the film's time at the last upload
  // The film's frame period (film seconds), learned from the callbacks : a quiet
  // film uploads about once a frame, not on every tick (a 4K film uploaded 60
  // times a second for its 30 frames cost the minimized loop 7 frames a second).
  private period = PERIOD_DEFAULT
  private mediaT = -1
  private frames = -1

  /** A frame callback (with its metadata), or a completed seek (without) : a
   *  frame was presented. */
  presented(el: HTMLVideoElement, md?: VideoFrameCallbackMetadata): void {
    this.cbAt = performance.now()
    this.cbT = el.currentTime
    if (!md) {
      this.frames = -1 // a seek : no frame pair across it
      return
    }
    // Two frames in a row (none dropped, no seek between) are one frame apart.
    const d = md.mediaTime - this.mediaT
    if (md.presentedFrames === this.frames + 1 && d > 0.004 && d < 0.1) this.period += (d - this.period) * 0.2
    this.mediaT = md.mediaTime
    this.frames = md.presentedFrames
  }

  /** Upload this tick although no callback came : callbacks are quiet, the film
   *  plays (not mid-seek) and has moved on about a frame since the last upload. */
  due(el: HTMLVideoElement): boolean {
    if (el.paused || el.seeking || el.readyState < 2) return false
    const t = el.currentTime
    if (Math.abs(t - this.upT) < this.period * 0.75) return false
    return !painting || (performance.now() - this.cbAt > OVERDUE_MS && Math.abs(t - this.cbT) > OVERDUE_FILM_SEC)
  }

  /** The element's frame went to the texture (whatever asked for it). */
  uploaded(el: HTMLVideoElement): void {
    this.upT = el.currentTime
  }

  /** A new file : nothing presented or uploaded yet (its first callback is not
   *  overdue before OVERDUE_MS), its frame rate unknown. */
  reset(): void {
    this.cbAt = performance.now()
    this.cbT = -1
    this.upT = -1
    this.period = PERIOD_DEFAULT
    this.mediaT = -1
    this.frames = -1
  }
}
