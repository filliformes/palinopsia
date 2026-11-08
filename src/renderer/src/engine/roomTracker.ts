// The Room tracker : bodies the way a room holds them. MediaPipe's pose follows ONE
// person, within about 4 m, who shows their face (its model card's own limits);
// this one finds every person in the frame, near or far, back turned or not.
//
// RTMO (workers/poseWorker.ts, the model on the graphics card) gives each camera
// frame its people : a box and 17 body points. Here they become TRACKED people :
// each keeps an id from frame to frame (the best box overlap), its points eased a
// little, kept for a moment when the model misses it. One of them is the MAIN
// person, the nearest (the largest), kept until someone else is clearly nearer :
// its 17 points are laid out as MediaPipe's 33 (engine/bodyTracker.ts reads them
// unchanged), so every pose feature, gesture, movement quality and rule works on
// the main person. The crowd adds its own features (the Room group) and gestures
// (a person arriving or leaving).
//
// Runs only while the Body camera runs with Pose on and the tracker set to Room.

import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { BodyFeature, BodyGesture } from '@shared/types'
import PoseWorker from '../workers/poseWorker?worker&inline'

// RTMO-s : about 35 ms a frame on an RTX 4070 through WebGPU (RTMO-m took 48 ms
// for a little more precision, and twice the download : not shipped).
const MODEL = 's'

/** A tracked person : raw camera coordinates (0..1, not mirrored). */
export interface RoomPerson {
  id: number
  score: number
  box: [number, number, number, number] // x1 y1 x2 y2
  k: Float32Array // 17 x (x, y, score), COCO order
  seenAt: number // performance.now() of the last frame it was found in
}

const MATCH_IOU = 0.2 // a new box this much over an old one is the same person
const KEEP_MS = 700 // a person missed for longer is gone
const EASE = 0.55 // how far each frame moves a person's points toward the new ones (at EASE_HZ)
const EASE_HZ = 28 // the rate EASE was tuned at : a slower rate eases further per frame
// At most this many frames a second into the model. Its 35 ms on an idle card grew
// to 60-200 ms under a heavy picture, and every frame it ran took that much from
// the picture's own (a heavy picture at 60 fps fell to 45 with Room on, for 6
// frames a second of tracking anyway; capped at 12, to 50) : ten keep the people
// moving smoothly with the easing, and leave the card most of its time.
const MAX_HZ = 10
const SWITCH = 1.3 // someone must be this much larger than the main person to take over
const COUNT_MS = 400 // a change in the head count holds this long before arrive / leave fire
const THR = 0.35 // a detection's score must reach this

// COCO's 17 points as MediaPipe's 33 : each of the 33 takes the nearest COCO point
// (eye corners the eye, mouth the nose, hands the wrist, heels and toes the ankle);
// the hand points sit a little past the wrist, along the forearm.
const TO33 = [0, 1, 1, 1, 2, 2, 2, 3, 4, 0, 0, 5, 6, 7, 8, 9, 10, 9, 10, 9, 10, 9, 10, 11, 12, 13, 14, 15, 16, 15, 16, 15, 16]
const HAND_OF33: Record<number, [number, number]> = { 17: [9, 7], 18: [10, 8], 19: [9, 7], 20: [10, 8], 21: [9, 7], 22: [10, 8] }

const iou = (a: number[], b: number[]): number => {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1])
  const x2 = Math.min(a[2], b[2]), y2 = Math.min(a[3], b[3])
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1)
  const u = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
  return u > 0 ? inter / u : 0
}
const area = (b: number[]): number => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1])
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

class RoomTracker {
  private worker: Worker | null = null
  private ready = false
  private err: string | null = null
  private ep = ''
  private runMs = 0
  private inFlight = false
  private inFlightAt = 0
  private frameId = 0
  private lastUpdate = 0 // when the people last moved (the easing is per second)
  version = 0 // bumped each time the people move (the Body page's preview redraws)
  private people: RoomPerson[] = []
  private nextId = 1
  private mainId: number | null = null
  private count = 0 // the committed head count
  private countCand = 0
  private countSince = 0
  private events: BodyGesture[] = []
  private waiters: Array<(p: RoomPerson[]) => void> = []

  /** Start the tracker (nothing when it runs already). */
  start(): void {
    if (this.worker) return
    this.stop()
    this.err = null
    const w = new PoseWorker()
    this.worker = w
    w.onmessage = (e: MessageEvent): void => this.onMessage(w, e.data)
    w.onerror = (e): void => {
      this.err = e.message || 'the Room tracker stopped'
      this.inFlight = false
    }
    w.postMessage({ t: 'init', model: MODEL })
  }

  stop(): void {
    this.worker?.terminate()
    this.worker = null
    this.ready = false
    this.inFlight = false
    this.people = []
    this.lastUpdate = 0
    this.mainId = null
    this.count = this.countCand = 0
    this.events = []
  }

  running(): boolean {
    return !!this.worker
  }

  status(): { ready: boolean; error: string | null; ep: string; ms: number; people: number } {
    return { ready: this.ready, error: this.err, ep: this.ep, ms: this.runMs, people: this.people.length }
  }

  /** Hand the tracker a new camera frame (skipped while the last one is still in the model). */
  push(source: CanvasImageSource & { width?: number }): void {
    const w = this.worker
    if (!w || !this.ready) return
    const now = performance.now()
    if (this.inFlight && now - this.inFlightAt < 2000) return
    if (now - this.inFlightAt < 1000 / MAX_HZ) return
    this.inFlight = true
    this.inFlightAt = now
    const id = ++this.frameId
    createImageBitmap(source as ImageBitmapSource)
      .then((bitmap) => {
        if (this.worker !== w) {
          bitmap.close()
          return
        }
        w.postMessage({ t: 'frame', bitmap, id, thr: THR }, [bitmap])
      })
      .catch(() => {
        this.inFlight = false
      })
  }

  /** Tests : one picture through the model, the people found (tracking included). */
  detect(bitmap: ImageBitmap): Promise<RoomPerson[]> {
    const w = this.worker
    if (!w || !this.ready) return Promise.resolve([])
    this.inFlight = true
    this.inFlightAt = performance.now()
    w.postMessage({ t: 'frame', bitmap, id: ++this.frameId, thr: THR }, [bitmap])
    return new Promise((res) => this.waiters.push(res))
  }

  private onMessage(w: Worker, m: { t: string; msg?: string; ep?: string; people?: Array<{ score: number; box: number[]; k: number[] }>; runMs?: number }): void {
    if (w !== this.worker) return
    if (m.t === 'ready') {
      this.ready = true
      this.ep = m.ep ?? ''
    } else if (m.t === 'error') {
      this.err = m.msg ?? 'the Room tracker failed'
      this.inFlight = false
      const ws = this.waiters
      this.waiters = []
      for (const res of ws) res([])
    } else if (m.t === 'result') {
      this.inFlight = false
      this.runMs = m.runMs ?? 0
      this.update(m.people ?? [])
      const ws = this.waiters
      this.waiters = []
      for (const res of ws) res(this.people)
    }
  }

  /** The frame's detections → the tracked people (ids kept by the best overlap). */
  private update(found: Array<{ score: number; box: number[]; k: number[] }>): void {
    const now = performance.now()
    // the same easing per second whatever the frame rate
    const dt = this.lastUpdate ? Math.min(0.5, (now - this.lastUpdate) / 1000) : 1 / EASE_HZ
    this.lastUpdate = now
    this.version++
    const ease = 1 - Math.pow(1 - EASE, dt * EASE_HZ)
    const free = new Set(this.people.map((p) => p.id))
    // the best overlaps first, each person and each detection used once
    const pairs: Array<{ p: RoomPerson; d: number; o: number }> = []
    found.forEach((d, di) => {
      for (const p of this.people) {
        const o = iou(p.box, d.box)
        if (o >= MATCH_IOU) pairs.push({ p, d: di, o })
      }
    })
    pairs.sort((a, b) => b.o - a.o)
    const usedD = new Set<number>()
    for (const { p, d, o } of pairs) {
      void o
      if (!free.has(p.id) || usedD.has(d)) continue
      free.delete(p.id)
      usedD.add(d)
      const f = found[d]
      for (let i = 0; i < 4; i++) p.box[i] += (f.box[i] - p.box[i]) * ease
      for (let i = 0; i < p.k.length; i += 3) {
        p.k[i] += (f.k[i] - p.k[i]) * ease
        p.k[i + 1] += (f.k[i + 1] - p.k[i + 1]) * ease
        p.k[i + 2] = f.k[i + 2]
      }
      p.score = f.score
      p.seenAt = now
    }
    found.forEach((f, di) => {
      if (usedD.has(di)) return
      this.people.push({ id: this.nextId++, score: f.score, box: [f.box[0], f.box[1], f.box[2], f.box[3]], k: Float32Array.from(f.k), seenAt: now })
    })
    this.people = this.people.filter((p) => now - p.seenAt <= KEEP_MS)
    // the main person : the nearest (largest), kept until someone is clearly nearer
    const live = this.people.filter((p) => p.seenAt === now)
    const cur = live.find((p) => p.id === this.mainId)
    let best: RoomPerson | null = null
    for (const p of live) if (!best || area(p.box) > area(best.box)) best = p
    if (!cur) this.mainId = best ? best.id : this.people.find((p) => p.id === this.mainId) ? this.mainId : null
    else if (best && best !== cur && area(best.box) > area(cur.box) * SWITCH) this.mainId = best.id
    // arrivals and departures : the head count, held a moment before it counts
    const n = live.length
    if (n !== this.countCand) {
      this.countCand = n
      this.countSince = now
    } else if (n !== this.count && now - this.countSince >= COUNT_MS) {
      this.events.push(n > this.count ? 'personEnter' : 'personLeave')
      this.count = n
    }
  }

  /** Everyone tracked now (raw camera coordinates). */
  list(): RoomPerson[] {
    return this.people
  }

  main(): RoomPerson | null {
    return this.people.find((p) => p.id === this.mainId) ?? null
  }

  /** The main person as MediaPipe's 33 pose points (raw camera coordinates). */
  mainPose(): NormalizedLandmark[] | null {
    const p = this.main()
    if (!p) return null
    const k = p.k
    return TO33.map((c, i) => {
      const hand = HAND_OF33[i]
      let x = k[c * 3], y = k[c * 3 + 1]
      if (hand) {
        // a little past the wrist, along the forearm
        const [wr, el] = hand
        x = k[wr * 3] + (k[wr * 3] - k[el * 3]) * 0.15
        y = k[wr * 3 + 1] + (k[wr * 3 + 1] - k[el * 3 + 1]) * 0.15
      }
      return { x, y, z: 0, visibility: k[c * 3 + 2] }
    })
  }

  /** The crowd's features (the Room group). */
  features(mirror: boolean): Partial<Record<BodyFeature, number>> {
    const live = this.people
    const cx = (p: RoomPerson): number => {
      const x = (p.box[0] + p.box[2]) / 2
      return mirror ? 1 - x : x
    }
    const n = live.length
    const xs = live.map(cx)
    const main = this.main()
    return {
      peopleCount: clamp01(n / 8),
      peopleSpread: n >= 2 ? clamp01(Math.max(...xs) - Math.min(...xs)) : 0,
      peopleX: n ? xs.reduce((a, b) => a + b, 0) / n : 0.5,
      nearestX: main ? cx(main) : 0.5,
      nearestSize: main ? clamp01(main.box[3] - main.box[1]) : 0
    }
  }

  /** The gestures since the last call (a person arriving or leaving). */
  takeEvents(): BodyGesture[] {
    const e = this.events
    this.events = []
    return e
  }
}

export const roomTracker = new RoomTracker()
