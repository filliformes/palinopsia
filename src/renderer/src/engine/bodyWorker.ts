// Body tracking OFF the main thread : MediaPipe Hands / Pose / Face run in a
// worker, so the render loop never waits on them. On the main thread they cost
// 4 ms (hands) to 13 ms (all three) of every frame (measured), more while the GPU
// is busy, since each detection waits for its GPU results : a heavy session fell
// from 60 to 7-21 fps with the camera on.
//
// The worker is a CLASSIC worker built from the self-contained workerMain()
// below (a blob URL) : MediaPipe's loader pulls its wasm glue with importScripts,
// which module workers lack, and a blob classic worker behaves the same in the dev
// server and in the build. It loads MediaPipe's own CommonJS bundle over
// opsia-asset:// (resources/mediapipe/vision_bundle.js, a copy of
// @mediapipe/tasks-vision's vision_bundle.cjs : keep it the package's version, as
// the wasm beside it). workerMain must not reference anything outside itself.
//
// Messages in  : init {urls} · config {cfg} · frame {bitmap, ts, camT, newFrame,
//                silhouette, mirror, full} (the bitmap is transferred) · stop
// Messages out : ready · configured · error {msg} · result {hands, pose, face,
//                blend, sil, people, ts, camT, newFrame, ms} (the mask buffer
//                transferred)
//
// cfg.people (default 1) : how many bodies Pose looks for; with several, the
// silhouette is every one of them, merged (a layer's People, personMask.ts).
// frame.full : the mask at the size it was computed, not halved.

/* eslint-disable @typescript-eslint/no-explicit-any */
function workerMain(): void {
  const g = self as any
  let mp: any = null
  let fileset: any = null
  let hands: any = null
  let pose: any = null
  let face: any = null
  let poseSeg = false
  let posePeople = 1
  let urls: any = null
  let cfg: any = { hands: false, pose: false, face: false, silhouette: false, people: 1 }
  let chain: Promise<void> = Promise.resolve()

  const fail = (e: any): void => g.postMessage({ t: 'error', msg: String((e && e.message) || e) })

  // GPU first (WebGL in the worker's own OffscreenCanvas), the CPU when it can't.
  const make = async (Kind: any, model: string, extra: any): Promise<any> => {
    try {
      return await Kind.createFromOptions(fileset, { baseOptions: { modelAssetPath: model, delegate: 'GPU' }, runningMode: 'VIDEO', ...extra })
    } catch {
      return Kind.createFromOptions(fileset, { baseOptions: { modelAssetPath: model, delegate: 'CPU' }, runningMode: 'VIDEO', ...extra })
    }
  }
  const close = (x: any): void => { try { if (x) x.close() } catch { /* gone */ } }

  // The same rules as the main-thread tracker : Pose runs for Pose OR Silhouette,
  // rebuilt when the segmentation flag flips (a create-time option).
  const ensure = async (): Promise<void> => {
    if (!mp || !fileset) return
    if (cfg.hands && !hands) hands = await make(mp.HandLandmarker, urls.hand, { numHands: 2 })
    else if (!cfg.hands && hands) { close(hands); hands = null }
    const poseNeeded = cfg.pose || cfg.silhouette
    const wantSeg = !!cfg.silhouette
    const people = Math.max(1, Math.min(4, (cfg.people | 0) || 1))
    if (poseNeeded && (!pose || poseSeg !== wantSeg || posePeople !== people)) {
      close(pose); pose = null
      pose = await make(mp.PoseLandmarker, urls.pose, { numPoses: people, outputSegmentationMasks: wantSeg })
      poseSeg = wantSeg
      posePeople = people
    } else if (!poseNeeded && pose) { close(pose); pose = null; poseSeg = false }
    if (cfg.face && !face) face = await make(mp.FaceLandmarker, urls.face, { numFaces: 1, outputFaceBlendshapes: true })
    else if (!cfg.face && face) { close(face); face = null }
  }

  // The silhouette : a half-size (full : same-size) 8-bit copy of the confidence
  // mask (top-down), every body's merged (the most confident wins), and its 3×3
  // zone coverage + whole-frame coverage (the main thread's readMaskZones).
  const maskOut = (masks: any[], mirror: boolean, full: boolean): any => {
    let arr: Float32Array | null = null
    let w = 0, h = 0
    for (const mk of masks) {
      let a: Float32Array | null = null
      try { a = mk.getAsFloat32Array() } catch { a = null }
      if (!a || !mk.width || !mk.height) continue
      if (!arr) {
        // One body : read in place. Several : merge into a copy (the mask's own
        // array goes with it when it is closed).
        arr = masks.length > 1 ? new Float32Array(a) : a
        w = mk.width; h = mk.height
      } else if (mk.width === w && mk.height === h) {
        for (let i = 0; i < arr.length; i++) if (a[i] > arr[i]) arr[i] = a[i]
      }
    }
    if (!arr || !w || !h) return { empty: true }
    const f = full ? 1 : 2
    const hw = Math.floor(w / f), hh = Math.floor(h / f)
    const out = new Uint8Array(hw * hh)
    for (let y = 0; y < hh; y++) {
      const src = f * y * w, dst = y * hw
      for (let x = 0; x < hw; x++) {
        const v = arr[src + f * x]
        out[dst + x] = v <= 0 ? 0 : v >= 1 ? 255 : (v * 255 + 0.5) | 0
      }
    }
    const sums = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    const counts = [0, 0, 0, 0, 0, 0, 0, 0, 0]
    let total = 0, n = 0
    const stepX = Math.max(1, Math.floor(w / 96))
    const stepY = Math.max(1, Math.floor(h / 96))
    for (let y = 0; y < h; y += stepY) {
      const row = y * 3 < h ? 0 : y * 3 < h * 2 ? 1 : 2
      const base = y * w
      for (let x = 0; x < w; x += stepX) {
        let col = x * 3 < w ? 0 : x * 3 < w * 2 ? 1 : 2
        if (mirror) col = 2 - col
        const v = arr[base + x]
        const zi = row * 3 + col
        sums[zi] += v; counts[zi]++
        total += v; n++
      }
    }
    const zones = sums.map((s, i) => (counts[i] ? Math.min(1, Math.max(0, s / counts[i])) : 0))
    return { mask: out, w: hw, h: hh, zones, cov: n ? Math.min(1, Math.max(0, total / n)) : 0 }
  }

  const detect = (m: any): void => {
    const t0 = performance.now()
    const out: any = { t: 'result', ts: m.ts, camT: m.camT, newFrame: m.newFrame, hands: [], pose: null, face: null, blend: null, sil: null, people: 0 }
    const bmp = m.bitmap
    try {
      if (hands) out.hands = hands.detectForVideo(bmp, m.ts).landmarks ?? []
      if (pose) {
        const pr = pose.detectForVideo(bmp, m.ts)
        out.pose = (pr.landmarks && pr.landmarks[0]) || null
        out.people = (pr.landmarks && pr.landmarks.length) || 0
        const masks = pr.segmentationMasks ?? []
        if (m.silhouette) out.sil = masks.length ? maskOut(masks, m.mirror, !!m.full) : { empty: true }
        // Every mask holds a GPU buffer until closed.
        for (const mk of masks) close(mk)
      }
      if (face) {
        const fr = face.detectForVideo(bmp, m.ts)
        out.face = (fr.faceLandmarks && fr.faceLandmarks[0]) || null
        const cats = fr.faceBlendshapes && fr.faceBlendshapes[0] && fr.faceBlendshapes[0].categories
        out.blend = cats ? cats.map((c: any) => ({ categoryName: c.categoryName, score: c.score })) : null
      }
    } catch (e) {
      out.error = String((e as any)?.message || e) // a transient GL / graph hiccup : this frame only
    }
    try { bmp.close() } catch { /* gone */ }
    out.ms = performance.now() - t0
    g.postMessage(out, out.sil && out.sil.mask ? [out.sil.mask.buffer] : [])
  }

  g.onmessage = (e: MessageEvent): void => {
    const m = e.data
    if (m.t === 'init') {
      urls = m.urls
      chain = chain.then(async () => {
        if (!mp) {
          g.module = { exports: {} }
          g.exports = g.module.exports
          g.importScripts(urls.bundle)
          mp = g.module.exports
        }
        if (!fileset) fileset = await mp.FilesetResolver.forVisionTasks(urls.wasm)
        g.postMessage({ t: 'ready' })
      }).catch(fail)
    } else if (m.t === 'config') {
      cfg = m.cfg
      chain = chain.then(ensure).then(() => g.postMessage({ t: 'configured', hands: !!hands, pose: !!pose, face: !!face })).catch(fail)
    } else if (m.t === 'frame') {
      chain = chain.then(() => detect(m)).catch(fail)
    } else if (m.t === 'stop') {
      // In the chain : never under a landmarker still being built.
      chain = chain.then(() => {
        close(hands); close(pose); close(face)
        hands = pose = face = null
        poseSeg = false
        posePeople = 1
      }).catch(fail)
    }
  }
}

/** The tracking worker (one per tracker, created on first use). */
export function createBodyWorker(): Worker {
  const src = `(${workerMain.toString()})()`
  const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }))
  const w = new Worker(url)
  // The worker has read its script once it runs : the URL can go.
  window.setTimeout(() => URL.revokeObjectURL(url), 10000)
  return w
}
