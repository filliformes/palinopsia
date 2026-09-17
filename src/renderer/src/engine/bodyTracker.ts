// Embodied-control tracker : a dedicated low-res webcam → MediaPipe Hands + Pose
// → the body bus (engine/bodyIn.ts). Runs ONLY while enabled (a camera : opt-in),
// on its own rAF loop off the render critical path. The heavy MediaPipe module +
// wasm load lazily (dynamic import) the first time it starts, so the app costs
// nothing for it until the performer turns it on.
//
// Everything is self-hosted over opsia-asset:// (main/assets.ts) : no CDN, works
// offline and in a kiosk. Landmarks are reduced to normalised 0..1 features; the
// modulation engine smooths them. Face is a planned drop-in : add a FaceLandmarker
// beside these two and extend the feature derivation, nothing else changes.

import type { NormalizedLandmark, MPMask } from '@mediapipe/tasks-vision'
import type { BodyControlConfig, BodyFeature, BodyGesture } from '@shared/types'
import { bodyBus } from './bodyIn'
import { perfMeter } from './perfMeter'

// opsia-asset:// URLs (served by main from the bundled resources/mediapipe dir).
const WASM_BASE = 'opsia-asset://local/wasm'
const HAND_MODEL = 'opsia-asset://local/models/hand_landmarker.task'
const POSE_MODEL = 'opsia-asset://local/models/pose_landmarker_lite.task'
const FACE_MODEL = 'opsia-asset://local/models/face_landmarker.task'

type MP = typeof import('@mediapipe/tasks-vision')
// The landmarker classes have private constructors, so derive the instance type
// from the static factory's return instead of InstanceType<>.
type Hands = Awaited<ReturnType<MP['HandLandmarker']['createFromOptions']>>
type Pose = Awaited<ReturnType<MP['PoseLandmarker']['createFromOptions']>>
type Face = Awaited<ReturnType<MP['FaceLandmarker']['createFromOptions']>>

const dist = (a: NormalizedLandmark, b: NormalizedLandmark): number =>
  Math.hypot(a.x - b.x, a.y - b.y)
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x)

// Pose landmark indices (BlazePose 33).
const NOSE = 0, L_SHO = 11, R_SHO = 12, L_HIP = 23, R_HIP = 24, L_WRI = 15, R_WRI = 16
// Hand landmark indices (21).
const WRIST = 0, THUMB = 4, INDEX = 8, PINKY = 20, INDEX_MCP = 5, PINKY_MCP = 17, MID_MCP = 9
// Face-mesh canonical indices (478) used for head pose from geometry.
const F_NOSE = 1, F_CHIN = 152, F_FORE = 10, F_LCHEEK = 234, F_RCHEEK = 454, F_LEYE = 33, F_REYE = 263

export interface BodyPreview {
  video: HTMLVideoElement | null
  hands: NormalizedLandmark[][] // per detected hand
  pose: NormalizedLandmark[] | null // one body
  face: NormalizedLandmark[] | null // one face mesh (478 pts)
  mirror: boolean
}

class BodyTracker {
  private cfg: BodyControlConfig | null = null
  private video: HTMLVideoElement | null = null
  private stream: MediaStream | null = null
  private vision: MP | null = null
  private fileset: Awaited<ReturnType<MP['FilesetResolver']['forVisionTasks']>> | null = null
  private hands: Hands | null = null
  private pose: Pose | null = null
  private face: Face | null = null
  private poseSeg = false // whether the current pose landmarker outputs segmentation masks
  private zoneCov = new Array<number>(9).fill(0) // 3×3 silhouette zone coverage (row-major)
  private bodyCov = 0 // whole-frame silhouette coverage
  private raf = 0
  private lastTs = -1
  private running = false
  private starting = false
  private err: string | null = null

  // Preview + gesture state.
  private latestHands: NormalizedLandmark[][] = []
  private latestPose: NormalizedLandmark[] | null = null
  private latestFace: NormalizedLandmark[] | null = null
  private prevPose: NormalizedLandmark[] | null = null
  private pinchDown = { left: false, right: false }
  private crossSign = 0
  private clapArmed = true
  private handsUpArmed = true
  private mouthArmed = true
  private browArmed = true
  private winkLDown = false
  private winkRDown = false
  private cooldown: Partial<Record<BodyGesture, number>> = {}
  // Hysteresis-edge arming for the threshold gestures (lean / crouch / smile /
  // head turn…) : undefined = ready to fire, false = fired and not yet re-armed.
  private armed: Partial<Record<BodyGesture, boolean>> = {}
  private prevShoY = 0.5 // shoulder-midpoint height last pose frame (for jump)
  // Hold-duration state : when a pose's condition became true, and whether its
  // hold has already fired (so it fires once per hold, re-arming on release).
  private holdSince: Partial<Record<BodyGesture, number>> = {}
  private holdFired: Partial<Record<BodyGesture, boolean>> = {}

  status(): { running: boolean; error: string | null } {
    return { running: this.running, error: this.err }
  }
  preview(): BodyPreview {
    return {
      video: this.video,
      hands: this.latestHands,
      pose: this.latestPose,
      face: this.latestFace,
      mirror: this.cfg?.mirror ?? true
    }
  }

  /** Cameras the browser exposes (labels appear once permission is granted). */
  async listCameras(): Promise<Array<{ id: string; label: string }>> {
    try {
      const devs = await navigator.mediaDevices.enumerateDevices()
      return devs
        .filter((d) => d.kind === 'videoinput')
        .map((d, i) => ({ id: d.deviceId, label: d.label || `Camera ${i + 1}` }))
    } catch {
      return []
    }
  }

  async setConfig(cfg: BodyControlConfig): Promise<void> {
    const was = this.cfg
    this.cfg = cfg
    if (cfg.enabled && !this.running && !this.starting) {
      await this.start()
    } else if (!cfg.enabled && (this.running || this.starting)) {
      this.stop()
    } else if (cfg.enabled && this.running && was && was.deviceId !== cfg.deviceId) {
      // Camera changed : restart the stream on the new device.
      this.stop()
      await this.start()
    } else if (cfg.enabled && this.running && was && (was.hands !== cfg.hands || was.pose !== cfg.pose || was.face !== cfg.face || was.silhouette !== cfg.silhouette)) {
      // Hands / Pose / Face / Silhouette toggled live : create or close the affected
      // landmarker only (no camera flicker). mirror + sensitivity are read per-frame.
      await this.ensureLandmarkers()
    }
  }

  /** Create the landmarkers the config asks for, close the ones it doesn't.
   *  Needs `fileset` + `vision` (set in start()). GPU first, CPU fallback. */
  private async ensureLandmarkers(): Promise<void> {
    const vision = this.vision, fileset = this.fileset, cfg = this.cfg
    if (!vision || !fileset || !cfg) return
    if (cfg.hands && !this.hands) {
      this.hands = await vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO', numHands: 2
      }).catch(() => vision.HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: HAND_MODEL, delegate: 'CPU' }, runningMode: 'VIDEO', numHands: 2
      }))
    } else if (!cfg.hands && this.hands) {
      try { this.hands.close() } catch { /* gone */ }
      this.hands = null
      this.latestHands = []
    }
    // Pose runs when Pose OR Silhouette is on (the silhouette rides the same
    // landmarker with segmentation masks enabled). Recreate if the segmentation
    // flag flips, since it is a create-time option.
    const poseNeeded = cfg.pose || cfg.silhouette
    const wantSeg = cfg.silhouette
    if (poseNeeded && (!this.pose || this.poseSeg !== wantSeg)) {
      if (this.pose) { try { this.pose.close() } catch { /* gone */ } this.pose = null }
      const mk = (delegate: 'GPU' | 'CPU'): Promise<Pose> => vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: POSE_MODEL, delegate },
        runningMode: 'VIDEO', numPoses: 1, outputSegmentationMasks: wantSeg
      })
      this.pose = await mk('GPU').catch(() => mk('CPU'))
      this.poseSeg = wantSeg
    } else if (!poseNeeded && this.pose) {
      try { this.pose.close() } catch { /* gone */ }
      this.pose = null
      this.latestPose = null
      this.poseSeg = false
      this.zoneCov.fill(0); this.bodyCov = 0
    }
    if (cfg.face && !this.face) {
      // Blendshapes are the control gold (jawOpen, smile, brow, blink…) : ask for
      // them. Head pose is derived from mesh geometry (no transform matrix needed).
      this.face = await vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'GPU' },
        runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true
      }).catch(() => vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: FACE_MODEL, delegate: 'CPU' },
        runningMode: 'VIDEO', numFaces: 1, outputFaceBlendshapes: true
      }))
    } else if (!cfg.face && this.face) {
      try { this.face.close() } catch { /* gone */ }
      this.face = null
      this.latestFace = null
    }
  }

  private async start(): Promise<void> {
    if (this.starting || this.running || !this.cfg?.enabled) return
    this.starting = true
    this.err = null
    try {
      // 1) Dedicated low-res webcam (480p is plenty for landmarks, cheap to run).
      const deviceId = this.cfg.deviceId
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 640 },
          height: { ideal: 480 },
          ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: 'user' })
        },
        audio: false
      })
      const video = document.createElement('video')
      video.autoplay = true
      video.muted = true
      video.playsInline = true
      video.srcObject = this.stream
      await video.play().catch(() => {})
      this.video = video

      // 2) MediaPipe : lazy import + self-hosted wasm/models (offline). Cache the
      //    module + fileset so Hands / Pose can be toggled live without reloading.
      if (!this.vision) this.vision = (await import('@mediapipe/tasks-vision')) as MP
      if (!this.fileset) this.fileset = await this.vision.FilesetResolver.forVisionTasks(WASM_BASE)
      await this.ensureLandmarkers()

      this.running = true
      this.starting = false
      this.loop()
    } catch (e) {
      this.err = (e as Error).message || 'camera / model load failed'
      this.starting = false
      this.stop()
    }
  }

  stop(): void {
    this.running = false
    this.starting = false
    if (this.raf) cancelAnimationFrame(this.raf)
    this.raf = 0
    this.lastTs = -1
    try { this.hands?.close() } catch { /* already gone */ }
    try { this.pose?.close() } catch { /* already gone */ }
    try { this.face?.close() } catch { /* already gone */ }
    this.hands = null
    this.pose = null
    this.face = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    if (this.video) {
      this.video.srcObject = null
      this.video = null
    }
    this.latestHands = []
    this.latestPose = null
    this.latestFace = null
    this.prevPose = null
    bodyBus.setLive(false, false, false)
  }

  private loop = (): void => {
    if (!this.running) return
    this.raf = requestAnimationFrame(this.loop)
    const video = this.video
    const cfg = this.cfg
    if (!video || !cfg || video.readyState < 2) return
    // detectForVideo needs strictly increasing timestamps (ms).
    let ts = performance.now()
    if (ts <= this.lastTs) ts = this.lastTs + 1
    this.lastTs = ts

    let blendshapes: Array<{ categoryName: string; score: number }> | null = null
    const mpT0 = performance.now()
    try {
      this.latestHands = this.hands ? (this.hands.detectForVideo(video, ts).landmarks ?? []) : []
      if (this.pose) {
        const pr = this.pose.detectForVideo(video, ts)
        this.latestPose = pr.landmarks?.[0] ?? null
        // Silhouette : read the segmentation mask into 3×3 zone coverage, then free it.
        if (cfg.silhouette) this.readMaskZones(pr.segmentationMasks?.[0] ?? null, cfg.mirror)
      } else {
        this.latestPose = null
      }
      if (this.face) {
        const fr = this.face.detectForVideo(video, ts)
        this.latestFace = fr.faceLandmarks?.[0] ?? null
        blendshapes = fr.faceBlendshapes?.[0]?.categories ?? null
      } else {
        this.latestFace = null
      }
    } catch {
      // A transient GL/graph hiccup : skip this frame, keep the loop alive.
      return
    }
    perfMeter.add('mediapipe', performance.now() - mpT0) // Performance panel

    const hasHands = this.latestHands.length > 0
    const hasPose = !!this.latestPose
    const hasFace = !!this.latestFace
    bodyBus.setLive(hasHands, hasPose, hasFace)

    // A hold whose detector isn't present this frame must reset, or a vanished
    // hand / body leaves it half-counted and it fires spuriously on return.
    if (!hasHands) { this.hold('holdPinchLeft', false); this.hold('holdPinchRight', false) }
    if (!hasPose) { this.hold('holdHandsUp', false); this.hold('holdArmsWide', false) }
    if (!hasFace) this.hold('holdMouthOpen', false)

    if (!hasHands && !hasPose && !hasFace) {
      // Nobody in frame : relax toward neutral so params don't stick, and drop the
      // previous pose so `jump` can't false-fire off a stale frame on re-entry.
      bodyBus.relax(0.06)
      bodyBus.update({ bodyPresent: 0, handsPresent: 0, facePresent: 0 })
      this.prevPose = null
      return
    }

    const mirror = cfg.mirror
    const out: Partial<Record<BodyFeature, number>> = {
      bodyPresent: hasPose ? 1 : 0,
      handsPresent: hasHands ? 1 : 0,
      facePresent: hasFace ? 1 : 0
    }
    if (hasHands) this.deriveHands(this.latestHands, mirror, out, cfg)
    if (hasPose) this.derivePose(this.latestPose as NormalizedLandmark[], mirror, out, cfg, ts)
    if (hasFace) this.deriveFace(this.latestFace as NormalizedLandmark[], blendshapes, mirror, out, cfg)
    if (cfg.silhouette) this.deriveSilhouette(out, cfg)
    bodyBus.update(out)
    this.prevPose = this.latestPose
  }

  // ── Hands → features + pinch gestures ──────────────────────────────────
  private deriveHands(
    handsLm: NormalizedLandmark[][],
    mirror: boolean,
    out: Partial<Record<BodyFeature, number>>,
    cfg: BodyControlConfig
  ): void {
    const mx = (x: number): number => (mirror ? 1 - x : x)
    // Assign hands to left/right SLOTS by screen position (robust vs handedness
    // labels), after mirroring so "left" is the performer's left in a selfie view.
    const scored = handsLm.map((lm) => ({ lm, x: mx(lm[WRIST].x) }))
    scored.sort((a, b) => a.x - b.x)
    const left = scored[0]?.lm ?? null
    const right = (scored[1]?.lm ?? null) as NormalizedLandmark[] | null

    const openness = (lm: NormalizedLandmark[]): number => {
      const palm = dist(lm[INDEX_MCP], lm[PINKY_MCP]) || 1e-3
      // Fingertip spread relative to knuckle width : fist ~1, open hand ~2.5+.
      const spread = dist(lm[INDEX], lm[PINKY]) / palm
      return clamp01((spread - 0.6) / 2.0)
    }
    const pinchAmt = (lm: NormalizedLandmark[]): number => {
      const size = dist(lm[WRIST], lm[MID_MCP]) || 1e-3
      return dist(lm[THUMB], lm[INDEX]) / size // small = pinched
    }

    if (left) {
      out.handLeftHeight = 1 - left[WRIST].y
      out.handLeftX = mx(left[WRIST].x)
      out.handLeftOpen = openness(left)
    }
    if (right) {
      out.handRightHeight = 1 - right[WRIST].y
      out.handRightX = mx(right[WRIST].x)
      out.handRightOpen = openness(right)
    }
    // Two-hand relations.
    if (left && right) {
      out.handsApart = clamp01(dist(left[WRIST], right[WRIST]) / 0.8)
      out.handsHeight = 1 - (left[WRIST].y + right[WRIST].y) / 2
    } else {
      const only = left ?? right
      if (only) out.handsHeight = 1 - only[WRIST].y
    }

    // Pinch gestures (per slot). sensitivity raises the trigger distance.
    const pinchThresh = 0.35 + cfg.sensitivity * 0.35
    const pinchL = left ? pinchAmt(left) < pinchThresh : false
    const pinchR = right ? pinchAmt(right) < pinchThresh : false
    this.pinchGate('left', pinchL)
    this.pinchGate('right', pinchR)
    this.hold('holdPinchLeft', pinchL)
    this.hold('holdPinchRight', pinchR)

    // Clap : two wrists collapse together. Fire on the crossing, re-arm apart.
    if (left && right) {
      const apart = dist(left[WRIST], right[WRIST])
      const clapThresh = 0.14 - cfg.sensitivity * 0.05
      if (apart < clapThresh && this.clapArmed) {
        this.emit('clap')
        this.clapArmed = false
      } else if (apart > clapThresh * 2) {
        this.clapArmed = true
      }
      // Cross : the two wrists swap sides.
      const sign = Math.sign(mx(right[WRIST].x) - mx(left[WRIST].x))
      if (sign !== 0 && this.crossSign !== 0 && sign !== this.crossSign) this.emit('cross')
      if (sign !== 0) this.crossSign = sign
    } else {
      this.crossSign = 0
    }
  }

  private pinchGate(slot: 'left' | 'right', down: boolean): void {
    if (down && !this.pinchDown[slot]) this.emit(slot === 'left' ? 'pinchLeft' : 'pinchRight')
    this.pinchDown[slot] = down
  }

  // ── Pose → features + hands-up gesture ─────────────────────────────────
  private derivePose(
    lm: NormalizedLandmark[],
    mirror: boolean,
    out: Partial<Record<BodyFeature, number>>,
    cfg: BodyControlConfig,
    _ts: number
  ): void {
    const mx = (x: number): number => (mirror ? 1 - x : x)
    const shoMid = { x: (lm[L_SHO].x + lm[R_SHO].x) / 2, y: (lm[L_SHO].y + lm[R_SHO].y) / 2 }
    const hipMid = { x: (lm[L_HIP].x + lm[R_HIP].x) / 2, y: (lm[L_HIP].y + lm[R_HIP].y) / 2 }
    const shoulderW = Math.abs(lm[L_SHO].x - lm[R_SHO].x) || 1e-3

    // Overall left/right placement + torso lean.
    out.weightLR = clamp01(mx((shoMid.x + hipMid.x) / 2))
    out.bodyLean = clamp01(0.5 + mx(shoMid.x - hipMid.x) * 3 - (mirror ? 0 : 0))
    // Shoulder-line tilt : one shoulder higher than the other.
    const tilt = (lm[L_SHO].y - lm[R_SHO].y) * (mirror ? -1 : 1)
    out.bodySway = clamp01(0.5 + tilt * 4)
    // Arm span : wrist-to-wrist over shoulder width.
    out.armSpan = clamp01((dist(lm[L_WRI], lm[R_WRI]) / shoulderW - 0.4) / 3.0)
    // Stance : shoulders high in frame = tall, dropped = crouched.
    out.bodyHeight = clamp01(1 - shoMid.y)
    // Hands above the head.
    const meanWristY = (lm[L_WRI].y + lm[R_WRI].y) / 2
    const headUnit = Math.abs(shoMid.y - lm[NOSE].y) * 2 || 0.15
    const up = clamp01((lm[NOSE].y - meanWristY) / headUnit + 0.15)
    out.handsUp = up

    // Motion energy : mean landmark displacement since the previous pose.
    if (this.prevPose && this.prevPose.length === lm.length) {
      let m = 0
      for (let i = 0; i < lm.length; i++) m += Math.hypot(lm[i].x - this.prevPose[i].x, lm[i].y - this.prevPose[i].y)
      out.bodyMotion = clamp01((m / lm.length) * 12)
    }

    // Hands-up gesture : cross a raised threshold, re-arm when lowered.
    const upThresh = 0.7 - cfg.sensitivity * 0.15
    if (up > upThresh && this.handsUpArmed) {
      this.emit('handsUp')
      this.handsUpArmed = false
    } else if (up < upThresh * 0.6) {
      this.handsUpArmed = true
    }
    // Hold-duration poses (fire after being held holdMs).
    this.hold('holdHandsUp', up > 0.6)
    this.hold('holdArmsWide', (out.armSpan ?? 0) > 0.65)

    // ── Discrete pose gestures (rising edge + hysteresis) ──
    const s = cfg.sensitivity
    const lean = out.bodyLean ?? 0.5
    this.edgeHys('leanLeft', 1 - lean, 0.72 - s * 0.1, 0.58)
    this.edgeHys('leanRight', lean, 0.72 - s * 0.1, 0.58)
    this.edgeHys('crouch', 1 - (out.bodyHeight ?? 0.5), 0.68 - s * 0.1, 0.55)
    // Jump : a fast upward move of the shoulder line since the previous frame.
    if (this.prevPose) this.edgeHys('jump', this.prevShoY - shoMid.y, 0.035 - s * 0.015, 0.008)
    this.prevShoY = shoMid.y
    // Arms crossed : each wrist on the opposite side of the body midline from its
    // own shoulder, and the wrists close together (mirror-invariant).
    const midX = (shoMid.x + hipMid.x) / 2
    const crossed = (lm[L_WRI].x - midX) * (lm[L_SHO].x - midX) < 0 &&
      (lm[R_WRI].x - midX) * (lm[R_SHO].x - midX) < 0 &&
      dist(lm[L_WRI], lm[R_WRI]) < shoulderW * 1.4
    this.edgeHys('armsCross', crossed ? 1 : 0, 0.5, 0.5)
    // T-pose : arms spread wide at shoulder height.
    const tpose = (out.armSpan ?? 0) > 0.6 &&
      Math.abs(lm[L_WRI].y - lm[L_SHO].y) < 0.12 && Math.abs(lm[R_WRI].y - lm[R_SHO].y) < 0.12
    this.edgeHys('tPose', tpose ? 1 : 0, 0.5, 0.5)
    // Single-hand raise above the head (subject-relative L / R).
    this.edgeHys('raiseLeft', lm[NOSE].y - lm[L_WRI].y, 0.05, 0.0)
    this.edgeHys('raiseRight', lm[NOSE].y - lm[R_WRI].y, 0.05, 0.0)
  }

  // ── Face → blendshape features + head pose + face gestures ─────────────
  private deriveFace(
    lm: NormalizedLandmark[],
    blend: Array<{ categoryName: string; score: number }> | null,
    mirror: boolean,
    out: Partial<Record<BodyFeature, number>>,
    cfg: BodyControlConfig
  ): void {
    const mx = (x: number): number => (mirror ? 1 - x : x)
    // Blendshape scores are already 0..1 and named (ARKit set). Sum by name so a
    // missing shape reads 0 rather than throwing.
    const bs: Record<string, number> = {}
    if (blend) for (const c of blend) bs[c.categoryName] = c.score
    const g = (n: string): number => bs[n] ?? 0

    const blinkL = g('eyeBlinkLeft'), blinkR = g('eyeBlinkRight')
    out.faceJawOpen = clamp01(g('jawOpen'))
    out.faceSmile = clamp01((g('mouthSmileLeft') + g('mouthSmileRight')) / 2 * 1.3)
    out.faceBrowUp = clamp01((g('browInnerUp') + g('browOuterUpLeft') + g('browOuterUpRight')) / 3 * 1.4)
    out.faceBlink = clamp01((blinkL + blinkR) / 2)
    out.faceMouthPucker = clamp01(g('mouthPucker'))

    // Head pose from mesh geometry (no transform matrix needed).
    const nose = lm[F_NOSE], chin = lm[F_CHIN], fore = lm[F_FORE]
    const lc = lm[F_LCHEEK], rc = lm[F_RCHEEK], le = lm[F_LEYE], re = lm[F_REYE]
    if (nose && chin && fore && lc && rc && le && re) {
      const faceW = Math.abs(mx(rc.x) - mx(lc.x)) || 1e-3
      const faceH = Math.abs(chin.y - fore.y) || 1e-3
      out.faceHeadYaw = clamp01(0.5 + ((mx(nose.x) - (mx(lc.x) + mx(rc.x)) / 2) / faceW) * 1.8)
      const eyeMidY = (le.y + re.y) / 2
      out.faceHeadPitch = clamp01(0.5 - ((nose.y - eyeMidY) / faceH - 0.15) * 2.2)
      const dx = mx(re.x) - mx(le.x), dy = re.y - le.y
      out.faceHeadRoll = clamp01(0.5 + Math.atan2(dy, dx) / (Math.PI / 3))
    }

    // Gestures. Blendshape thresholds scaled by sensitivity. Wink handedness is
    // subject-relative (MediaPipe's eyeBlinkLeft is the person's own left eye),
    // so it stays intuitive regardless of mirror.
    const s = cfg.sensitivity
    const jawT = 0.55 - s * 0.2
    if ((out.faceJawOpen ?? 0) > jawT && this.mouthArmed) { this.emit('mouthPop'); this.mouthArmed = false }
    else if ((out.faceJawOpen ?? 0) < jawT * 0.5) this.mouthArmed = true
    const browT = 0.5 - s * 0.2
    if ((out.faceBrowUp ?? 0) > browT && this.browArmed) { this.emit('browRaise'); this.browArmed = false }
    else if ((out.faceBrowUp ?? 0) < browT * 0.5) this.browArmed = true
    const winkHi = 0.5, winkLo = 0.25
    const wl = blinkL > winkHi && blinkR < winkLo
    const wr = blinkR > winkHi && blinkL < winkLo
    if (wl && !this.winkLDown) this.emit('winkLeft')
    if (wr && !this.winkRDown) this.emit('winkRight')
    this.winkLDown = wl
    this.winkRDown = wr
    // Hold : mouth open sustained.
    this.hold('holdMouthOpen', (out.faceJawOpen ?? 0) > 0.5)

    // ── Expression gestures (blendshape thresholds, edge + hysteresis) ──
    const sm = out.faceSmile ?? 0
    this.edgeHys('smile', sm, 0.5 - s * 0.15, 0.3)
    this.edgeHys('frown', (g('mouthFrownLeft') + g('mouthFrownRight')) / 2, 0.4 - s * 0.12, 0.2)
    this.edgeHys('browFurrow', (g('browDownLeft') + g('browDownRight')) / 2, 0.42 - s * 0.12, 0.22)
    this.edgeHys('squint', (g('eyeSquintLeft') + g('eyeSquintRight')) / 2, 0.5 - s * 0.15, 0.3)
    this.edgeHys('cheekPuff', g('cheekPuff'), 0.4 - s * 0.12, 0.2)
    this.edgeHys('kiss', g('mouthPucker'), 0.55 - s * 0.15, 0.3) // lips pursed
    this.edgeHys('jawLeft', g('jawLeft'), 0.4 - s * 0.12, 0.2)
    this.edgeHys('jawRight', g('jawRight'), 0.4 - s * 0.12, 0.2)
    this.edgeHys('mouthLeft', g('mouthLeft'), 0.4 - s * 0.12, 0.2)
    this.edgeHys('mouthRight', g('mouthRight'), 0.4 - s * 0.12, 0.2)
    this.edgeHys('tongueOut', g('tongueOut'), 0.3 - s * 0.1, 0.15)
    this.edgeHys('blinkBoth', (blinkL + blinkR) / 2, 0.55, 0.2) // both eyes (fires on hard blinks)
    // ── Head-pose gestures (from the yaw/pitch/roll features, mirror-aware) ──
    const yaw = out.faceHeadYaw ?? 0.5, pitch = out.faceHeadPitch ?? 0.5, roll = out.faceHeadRoll ?? 0.5
    this.edgeHys('headLeft', 1 - yaw, 0.72 - s * 0.1, 0.58)
    this.edgeHys('headRight', yaw, 0.72 - s * 0.1, 0.58)
    this.edgeHys('headUp', pitch, 0.72 - s * 0.1, 0.58)
    this.edgeHys('headDown', 1 - pitch, 0.72 - s * 0.1, 0.58)
    this.edgeHys('tiltLeft', 1 - roll, 0.7 - s * 0.1, 0.58)
    this.edgeHys('tiltRight', roll, 0.7 - s * 0.1, 0.58)
  }

  // ── Silhouette → 3×3 zone coverage (segmentation mask) ─────────────────
  // Read the pose confidence mask (0..1 person probability) into 9 zone means +
  // a whole-frame mean, sampling on a stride grid so it stays cheap. The mask is
  // owned by MediaPipe and MUST be closed after reading to free its GPU buffer.
  private readMaskZones(mask: MPMask | null, mirror: boolean): void {
    if (!mask) { this.zoneCov.fill(0); this.bodyCov = 0; return }
    let arr: Float32Array | null = null
    const w = mask.width, h = mask.height
    try { arr = mask.getAsFloat32Array() } catch { arr = null }
    try { mask.close() } catch { /* already freed */ }
    if (!arr || !w || !h) { this.zoneCov.fill(0); this.bodyCov = 0; return }
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
    for (let i = 0; i < 9; i++) this.zoneCov[i] = counts[i] ? clamp01(sums[i] / counts[i]) : 0
    this.bodyCov = n ? clamp01(total / n) : 0
  }

  private static ZONE_FEATURES: BodyFeature[] = ['zoneTL', 'zoneTC', 'zoneTR', 'zoneML', 'zoneMC', 'zoneMR', 'zoneBL', 'zoneBC', 'zoneBR']
  private static ZONE_GESTURES: BodyGesture[] = ['coverTL', 'coverTC', 'coverTR', 'coverML', 'coverMC', 'coverMR', 'coverBL', 'coverBC', 'coverBR']
  private deriveSilhouette(out: Partial<Record<BodyFeature, number>>, cfg: BodyControlConfig): void {
    for (let i = 0; i < 9; i++) out[BodyTracker.ZONE_FEATURES[i]] = this.zoneCov[i]
    out.bodyCover = this.bodyCov
    // Occlusion onsets : the body's shadow covers a zone past a threshold, re-arm
    // when it clears. sensitivity lowers the trigger threshold.
    const hi = 0.45 - cfg.sensitivity * 0.15, lo = 0.2
    for (let i = 0; i < 9; i++) this.edgeHys(BodyTracker.ZONE_GESTURES[i], this.zoneCov[i], hi, lo)
  }

  private emit(g: BodyGesture): void {
    const now = performance.now()
    if (now - (this.cooldown[g] ?? 0) < 350) return // debounce : no retrigger bursts
    this.cooldown[g] = now
    bodyBus.fireGesture(g)
  }

  /** Rising-edge trigger with hysteresis : fire once when `value` crosses `hi`,
   *  re-arm when it drops below `lo`. Powers the many threshold gestures. */
  private edgeHys(g: BodyGesture, value: number, hi: number, lo: number): void {
    if (value > hi) { if (this.armed[g] !== false) { this.emit(g); this.armed[g] = false } }
    else if (value < lo) this.armed[g] = true
  }

  /** Sustained-pose trigger : fire `g` once after its condition has been true for
   *  the configured hold time, then re-arm when the condition drops. */
  private hold(g: BodyGesture, active: boolean): void {
    if (active) {
      const since = this.holdSince[g]
      if (since == null) { this.holdSince[g] = performance.now(); return }
      const holdMs = this.cfg?.holdMs ?? 1200
      if (!this.holdFired[g] && performance.now() - since >= holdMs) {
        this.holdFired[g] = true
        this.emit(g)
      }
    } else {
      this.holdSince[g] = undefined
      this.holdFired[g] = false
    }
  }
}

export const bodyTracker = new BodyTracker()
