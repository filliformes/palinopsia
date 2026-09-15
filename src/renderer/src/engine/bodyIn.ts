// Body ingest bus (the FORWARD path : the room plays back). The MediaPipe tracker
// (engine/bodyTracker.ts) reads a dedicated webcam, reduces hand + pose landmarks
// to a handful of normalised control features each frame, and writes them here.
// Those feed `body` modulators (bind a hand or the whole body to any parameter),
// and discrete gestures (pinch / clap / cross / hands-up) are queued as one-shot
// onsets that App drains and routes to actions.
//
// Same discipline as the audio + vision buses (engine/audioIn.ts, visionIn.ts) :
// never touches the React store, read per-frame by the modulation engine. Values
// are raw 0..1 ; the modulation engine's `case 'body'` does the one-pole smoothing
// (so `smooth` behaves exactly like the audio / vision cases).

import type { BodyFeature, BodyGesture } from '@shared/types'
import { BODY_FEATURES } from '@shared/types'

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

// Neutral rest values : centred axes sit at 0.5, magnitudes at 0. When tracking
// drops (nobody in frame) the tracker eases features back toward these so a lost
// body doesn't freeze a parameter at a random spot.
const REST: Record<BodyFeature, number> = {
  handLeftHeight: 0, handRightHeight: 0, handLeftX: 0.5, handRightX: 0.5,
  handLeftOpen: 0, handRightOpen: 0, handsApart: 0, handsHeight: 0,
  bodyMotion: 0, bodyLean: 0.5, bodySway: 0.5, armSpan: 0, bodyHeight: 0.5, handsUp: 0, weightLR: 0.5,
  faceJawOpen: 0, faceSmile: 0, faceBrowUp: 0, faceBlink: 0, faceMouthPucker: 0,
  faceHeadYaw: 0.5, faceHeadPitch: 0.5, faceHeadRoll: 0.5,
  bodyPresent: 0, handsPresent: 0, facePresent: 0
}

class BodyBus {
  private f: Record<BodyFeature, number> = { ...REST }
  private ready = false
  private gestureQueue: BodyGesture[] = []
  // Liveness for the status pip : whether each tracker is producing detections.
  private live = { hands: false, pose: false, face: false, at: 0 }

  /** Tracker writes a batch of feature values (only the ones it computed). */
  update(vals: Partial<Record<BodyFeature, number>>): void {
    for (const k in vals) {
      const v = vals[k as BodyFeature]
      if (typeof v === 'number' && Number.isFinite(v)) this.f[k as BodyFeature] = clamp01(v)
    }
    this.ready = true
  }

  /** Ease every feature toward its neutral rest value (used when detection is
   *  lost, so a parameter relaxes instead of sticking). `k` in 0..1 per call. */
  relax(k: number): void {
    const a = clamp01(k)
    for (const name of BODY_FEATURES) this.f[name] += (REST[name] - this.f[name]) * a
  }

  /** Enqueue a discrete gesture onset (App drains it once per frame). */
  fireGesture(g: BodyGesture): void {
    // Cap the queue : a frame hitch must never let onsets pile into a burst.
    if (this.gestureQueue.length < 8) this.gestureQueue.push(g)
  }
  /** App pulls the frame's gesture onsets and routes them to actions. */
  drainGestures(): BodyGesture[] {
    if (this.gestureQueue.length === 0) return EMPTY
    const out = this.gestureQueue
    this.gestureQueue = []
    return out
  }

  setLive(hands: boolean, pose: boolean, face: boolean): void {
    this.live = { hands, pose, face, at: performance.now() }
  }
  /** For the status pip : are detections fresh (within ~500ms)? */
  status(): { hands: boolean; pose: boolean; face: boolean } {
    const fresh = performance.now() - this.live.at < 500
    return { hands: fresh && this.live.hands, pose: fresh && this.live.pose, face: fresh && this.live.face }
  }

  feature(name: BodyFeature): number {
    return this.f[name] ?? 0
  }
  hasData(): boolean {
    return this.ready
  }
  /** Full snapshot for the feature-monitor UI (read-only copy is unnecessary :
   *  the monitor only reads). */
  all(): Record<BodyFeature, number> {
    return this.f
  }
}

const EMPTY: BodyGesture[] = []

// One bus per renderer : the tracker fills it, the modulation engine + App read it.
export const bodyBus = new BodyBus()
