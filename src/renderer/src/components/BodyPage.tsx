// Body (key B) : embodied control. A full-page takeover like Sonify / Output.
// Turn a camera on (opt-in), and MediaPipe Hands + Pose read the performer into
// the body bus (engine/bodyIn.ts). The left half is the live camera with the
// skeleton drawn on it (frame + confidence check) ; the right half is the feature
// monitor (what is moving, and a one-click route into a modulator slot) plus the
// discrete-gesture routing (pinch / clap / cross / hands-up → an action).
//
// Face is a planned drop-in : when a FaceLandmarker is added to the tracker its
// features join BODY_FEATURES and appear here with no page changes.

import { useEffect, useRef, useState } from 'react'
import type { BodyControlConfig, BodyFeature, BodyGesture, GestureAction } from '@shared/types'
import { BODY_FEATURES, BODY_GESTURES } from '@shared/types'
import { bodyTracker } from '../engine/bodyTracker'
import { bodyBus } from '../engine/bodyIn'
import { TRIGGER_ACTION_IDS, fireTrigger, midiTargetLabel } from '../midi'
import { useStore } from '../store'
import { showToast } from './Toast'

// Standard MediaPipe hand connections (21 landmarks).
const HAND_CONN: Array<[number, number]> = [
  [0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12], [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]
]
// A readable pose stick-figure (BlazePose 33 : upper body + legs).
const POSE_CONN: Array<[number, number]> = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]
]

const GESTURE_LABEL: Record<BodyGesture, string> = {
  pinchLeft: 'pinch · left hand',
  pinchRight: 'pinch · right hand',
  clap: 'clap (hands meet)',
  cross: 'cross wrists',
  handsUp: 'hands above head',
  mouthPop: 'mouth pop (jaw)',
  browRaise: 'brow raise',
  winkLeft: 'wink · left eye',
  winkRight: 'wink · right eye'
}
const actionLabel = (id: GestureAction): string => (id === 'none' ? '— nothing —' : midiTargetLabel(id))
// Group the feature list for a legible monitor.
const FEATURE_GROUPS: Array<{ title: string; keys: BodyFeature[] }> = [
  { title: 'Hands', keys: ['handLeftHeight', 'handRightHeight', 'handLeftX', 'handRightX', 'handLeftOpen', 'handRightOpen', 'handsApart', 'handsHeight'] },
  { title: 'Pose', keys: ['bodyMotion', 'bodyLean', 'bodySway', 'armSpan', 'bodyHeight', 'handsUp', 'weightLR'] },
  { title: 'Face', keys: ['faceJawOpen', 'faceSmile', 'faceBrowUp', 'faceBlink', 'faceMouthPucker', 'faceHeadYaw', 'faceHeadPitch', 'faceHeadRoll'] },
  { title: 'Presence', keys: ['bodyPresent', 'handsPresent', 'facePresent'] }
]

function Toggle({ on, label, onClick, title }: { on: boolean; label: string; onClick: () => void; title?: string }): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded px-2.5 py-1 font-mono text-[11px] transition-colors ${
        on
          ? 'border border-accent bg-accent/15 text-accent'
          : 'border border-border bg-panel3/70 text-muted hover:bg-panel3 hover:text-text'
      }`}
    >
      {label}
    </button>
  )
}

export function BodyPage(): JSX.Element {
  const cfg = useStore((s) => s.bodyControl)
  const setCfg = useStore((s) => s.setBodyControl)
  const setOpen = useStore((s) => s.setBodyPageOpen)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [cameras, setCameras] = useState<Array<{ id: string; label: string }>>([])
  const [vals, setVals] = useState<Record<string, number>>({})
  const [live, setLive] = useState({ running: false, hands: false, pose: false, face: false, error: null as string | null })
  // The last gesture that fired + whether it's fresh (lights up briefly).
  const [cur, setCur] = useState<{ g: BodyGesture; fresh: boolean } | null>(null)

  const patch = (p: Partial<BodyControlConfig>): void => setCfg(p)

  // Camera list : refresh on mount and whenever we enable (labels only appear
  // once permission is granted, i.e. after the first getUserMedia).
  useEffect(() => {
    let alive = true
    bodyTracker.listCameras().then((cs) => { if (alive) setCameras(cs) })
    return () => { alive = false }
  }, [cfg.enabled])

  // Preview + monitor loop : draw the mirrored camera with the skeleton on it,
  // and snapshot the bus features for the meters. Runs while the page is open.
  useEffect(() => {
    let raf = 0
    const draw = (): void => {
      raf = requestAnimationFrame(draw)
      const canvas = canvasRef.current
      if (!canvas) return
      const g = canvas.getContext('2d')
      if (!g) return
      const W = canvas.width, H = canvas.height
      const pv = bodyTracker.preview()
      g.clearRect(0, 0, W, H)
      g.fillStyle = 'rgb(12,12,12)'
      g.fillRect(0, 0, W, H)
      g.save()
      if (pv.mirror) { g.translate(W, 0); g.scale(-1, 1) }
      if (pv.video && pv.video.readyState >= 2) {
        try { g.drawImage(pv.video, 0, 0, W, H) } catch { /* not ready */ }
      }
      // Landmarks (drawn in the same mirrored space so they align with the video).
      g.lineWidth = 2
      g.strokeStyle = 'rgba(255,142,15,0.9)' // accent
      g.fillStyle = 'rgba(255,255,255,0.9)'
      for (const hand of pv.hands) {
        for (const [a, b] of HAND_CONN) {
          g.beginPath(); g.moveTo(hand[a].x * W, hand[a].y * H); g.lineTo(hand[b].x * W, hand[b].y * H); g.stroke()
        }
        for (const p of hand) { g.beginPath(); g.arc(p.x * W, p.y * H, 2.5, 0, 7); g.fill() }
      }
      if (pv.pose) {
        g.strokeStyle = 'rgba(120,200,255,0.9)'
        for (const [a, b] of POSE_CONN) {
          const pa = pv.pose[a], pb = pv.pose[b]
          if (!pa || !pb) continue
          g.beginPath(); g.moveTo(pa.x * W, pa.y * H); g.lineTo(pb.x * W, pb.y * H); g.stroke()
        }
        g.fillStyle = 'rgba(120,200,255,0.95)'
        for (const p of pv.pose) { g.beginPath(); g.arc(p.x * W, p.y * H, 2, 0, 7); g.fill() }
      }
      if (pv.face) {
        // The 478-point mesh as a faint dot cloud : reads as a mask, confirms lock.
        g.fillStyle = 'rgba(180,255,180,0.5)'
        for (const p of pv.face) { g.beginPath(); g.arc(p.x * W, p.y * H, 1, 0, 7); g.fill() }
      }
      g.restore()
    }
    raf = requestAnimationFrame(draw)
    const monitor = window.setInterval(() => {
      const all = bodyBus.all()
      setVals({ ...all })
      const s = bodyTracker.status(); const b = bodyBus.status()
      setLive({ running: s.running, hands: b.hands, pose: b.pose, face: b.face, error: s.error })
      const lg = bodyBus.lastGesture()
      setCur(lg ? { g: lg.g, fresh: lg.ageMs < 700 } : null)
    }, 90)
    return () => { cancelAnimationFrame(raf); window.clearInterval(monitor) }
  }, [])

  // Route a feature into the first free modulator slot (quick-bind : then the
  // user binds it to params with the standard M buttons). Slots are a fixed bank.
  const toSlot = (feature: BodyFeature): void => {
    const st = useStore.getState()
    const mods = st.composition.modulators
    const free = mods.findIndex((m) => !m.enabled)
    if (free < 0) { showToast('All 8 modulator slots are in use', 'warn'); return }
    st.updateModulator(free, { enabled: true, type: 'body', body: { feature, smooth: 0.3 } })
    showToast(`Modulator ${free + 1} now follows ${feature} — bind it with a param’s M button (Modulation : D)`, 'ok', 6000)
  }

  const statusText = !cfg.enabled
    ? 'camera off'
    : live.error
      ? `error : ${live.error}`
      : !live.running
        ? 'starting camera…'
        : live.hands || live.pose || live.face
          ? `tracking · ${[live.hands && 'hands', live.pose && 'pose', live.face && 'face'].filter(Boolean).join(' + ')}`
          : 'no body in frame'

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-3 py-2">
        <span className="text-[13px] font-semibold">Body</span>
        <span className="font-mono text-[10px] text-muted">embodied control · MediaPipe Hands + Pose</span>
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${cfg.enabled && (live.hands || live.pose || live.face) ? 'animate-pulse bg-red-500' : cfg.enabled ? 'bg-yellow-500' : 'bg-muted'}`} />
          <span className="font-mono text-[10px] text-muted">{statusText}</span>
        </div>
        <div className="flex-1" />
        <span className="font-mono text-[9px] text-muted">B / Esc closes</span>
        <button onClick={() => setOpen(false)} className="rounded px-2 py-0.5 text-[12px] text-muted hover:text-text" title="Close (Esc)">✕</button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:flex-row">
        {/* Left : camera + controls */}
        <div className="flex shrink-0 flex-col gap-2 lg:w-[46%]">
          <button
            onClick={() => patch({ enabled: !cfg.enabled })}
            className={`w-full rounded px-3 py-2 font-mono text-[12px] transition-colors ${
              cfg.enabled
                ? 'border border-accent bg-accent/15 text-accent'
                : 'border border-border bg-panel3/70 text-muted hover:bg-panel3 hover:text-text'
            }`}
            title="Open the camera and start tracking. Off by default : a camera is opt-in and never opens on its own."
          >
            {cfg.enabled ? '● embodied control ON — camera live' : 'Enable embodied control (opens camera)'}
          </button>

          <div className="relative aspect-[4/3] w-full overflow-hidden rounded border border-border bg-black">
            <canvas ref={canvasRef} width={480} height={360} className="h-full w-full" />
            {!cfg.enabled && (
              <div className="absolute inset-0 flex items-center justify-center px-4 text-center font-mono text-[11px] text-muted">
                enable to preview the camera and skeleton
              </div>
            )}
          </div>

          <label className="flex items-center justify-between gap-2 font-mono text-[11px] text-muted">
            camera
            <select
              value={cfg.deviceId ?? ''}
              onChange={(e) => patch({ deviceId: e.target.value || null })}
              className="input select-compact min-w-0 flex-1 text-[11px]"
              title="Which camera feeds the tracker (a dedicated low-res capture, independent of any webcam layer)"
            >
              <option value="">default camera</option>
              {cameras.map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </label>

          <div className="flex flex-wrap items-center gap-1.5">
            <Toggle on={cfg.hands} label="Hands" onClick={() => patch({ hands: !cfg.hands })} title="Track hand landmarks (21 per hand, up to two hands)" />
            <Toggle on={cfg.pose} label="Pose" onClick={() => patch({ pose: !cfg.pose })} title="Track the whole-body pose (33 landmarks)" />
            <Toggle on={cfg.face} label="Face" onClick={() => patch({ face: !cfg.face })} title="Track the face (blendshapes : jaw, smile, brow, blink, pucker + head yaw/pitch/roll). Heavier — enable when you want facial control." />
            <Toggle on={cfg.mirror} label="Mirror" onClick={() => patch({ mirror: !cfg.mirror })} title="Selfie view : moving right moves the value right" />
          </div>

          <label className="flex items-center gap-2 font-mono text-[11px] text-muted">
            <span className="w-16 shrink-0">sensitivity</span>
            <input
              type="range" min={0} max={1} step={0.01} value={cfg.sensitivity}
              onChange={(e) => patch({ sensitivity: Number(e.target.value) })}
              className="min-w-0 flex-1"
              title="How easily gestures fire (pinch distance, clap gap, hands-up threshold). Higher = easier."
            />
            <span className="w-8 text-right text-text">{cfg.sensitivity.toFixed(2)}</span>
          </label>
        </div>

        {/* Right : feature monitor + gesture routing */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <section className="rounded border border-border bg-panel2 p-2">
            <div className="mb-1 font-mono text-[9px] uppercase tracking-wide text-accent2">Feature monitor</div>
            <p className="mb-2 text-[10px] leading-snug text-muted">
              Live 0..1 values off the body bus. <span className="text-text">→</span> routes one into a free modulator slot (then bind it with a param’s <span className="text-text">M</span> button). Every feature is also selectable in any modulator set to <span className="text-text">body</span> (Modulation : D).
            </p>
            {FEATURE_GROUPS.map((grp) => (
              <div key={grp.title} className="mb-1.5">
                <div className="mb-0.5 font-mono text-[8px] uppercase tracking-wide text-muted">{grp.title}</div>
                <div className="flex flex-col gap-0.5">
                  {grp.keys.map((k) => {
                    const v = vals[k] ?? 0
                    return (
                      <div key={k} className="flex items-center gap-1.5">
                        <span className="w-28 shrink-0 truncate font-mono text-[10px] text-muted" title={k}>{k}</span>
                        <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-panel3/70">
                          <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.round(v * 100)}%` }} />
                        </div>
                        <span className="w-8 shrink-0 text-right font-mono text-[9px] text-muted">{v.toFixed(2)}</span>
                        <button
                          onClick={() => toSlot(k)}
                          className="shrink-0 rounded border border-border bg-panel3/70 px-1.5 font-mono text-[10px] text-muted hover:border-accent hover:text-accent"
                          title={`Route ${k} into the first free modulator slot`}
                        >→</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </section>

          <section className="rounded border border-border bg-panel2 p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-mono text-[9px] uppercase tracking-wide text-accent2">Gestures → actions</span>
              {/* Current gesture : lights up for ~0.7s each time one is detected. */}
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                  cur?.fresh ? 'border-accent bg-accent/20 text-accent' : 'border-border bg-panel3/50 text-muted'
                }`}
                title="The most recent gesture the tracker detected"
              >
                {cur ? `⚡ ${GESTURE_LABEL[cur.g]}` : 'no gesture yet'}
              </span>
            </div>
            <p className="mb-2 text-[10px] leading-snug text-muted">
              Discrete moves fire one-shot actions (threshold + cooldown). Retune how easily they trigger with sensitivity. Actions are the same vocabulary as MIDI Learn and the keyboard : new ones are added in one place (engine/midi.ts) and show up here, on a pad, and on a key at once.
            </p>
            <div className="flex flex-col gap-1">
              {BODY_GESTURES.map((gk) => (
                <div key={gk} className="flex items-center gap-2 font-mono text-[11px] text-muted">
                  <span className="w-32 shrink-0">{GESTURE_LABEL[gk]}</span>
                  <select
                    value={cfg.gestures[gk]}
                    onChange={(e) => patch({ gestures: { ...cfg.gestures, [gk]: e.target.value as GestureAction } })}
                    className="input select-compact min-w-0 flex-1 text-[11px]"
                    title="What this gesture fires. Same action vocabulary as MIDI Learn and the keyboard : bind a hardware pad to the same action and they stay in sync."
                  >
                    <option value="none">{actionLabel('none')}</option>
                    {TRIGGER_ACTION_IDS.map((a) => (
                      <option key={a} value={a}>{actionLabel(a)}</option>
                    ))}
                  </select>
                  <button
                    onClick={() => fireTrigger(cfg.gestures[gk])}
                    disabled={cfg.gestures[gk] === 'none'}
                    className="shrink-0 rounded border border-border bg-panel3/70 px-1.5 py-0.5 text-[10px] text-muted hover:border-accent hover:text-accent disabled:opacity-30"
                    title="Fire this gesture's action now (preview what it does)"
                  >
                    test
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
