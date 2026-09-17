// Body (key B) : embodied control. A full-page takeover like Sonify / Output.
// Turn a camera on (opt-in), and MediaPipe Hands + Pose + Face read the performer
// into the body bus (engine/bodyIn.ts). Top row : the live camera with the
// skeleton on it + the capture controls (left), and the feature monitor (right,
// what is moving, one-click into a modulator). Below, full width : the rule
// builder ("Create actions"). Every action is authored as a rule : one gesture
// (or two combined) fires an action and/or an OSC bang (/body/<name>). No fixed
// per-gesture map.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { BodyControlConfig, BodyFeature, BodyGesture, GestureAction, GestureRule } from '@shared/types'
import { bodyTracker } from '../engine/bodyTracker'
import { bodyBus } from '../engine/bodyIn'
import { fireTrigger, midiTargetLabel } from '../midi'
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

// Short labels : dense enough for the two-column routing grid. Fuller names ride
// in the title tooltips at each use site.
const GESTURE_LABEL: Record<BodyGesture, string> = {
  pinchLeft: 'pinch L', pinchRight: 'pinch R', clap: 'clap', cross: 'cross',
  handsUp: 'hands up', leanLeft: 'lean L', leanRight: 'lean R', crouch: 'crouch', jump: 'jump',
  armsCross: 'arms cross', tPose: 'T-pose', raiseLeft: 'raise L', raiseRight: 'raise R',
  mouthPop: 'mouth pop', browRaise: 'brow raise', winkLeft: 'wink L', winkRight: 'wink R',
  smile: 'smile', frown: 'frown', browFurrow: 'brow furrow', squint: 'squint', cheekPuff: 'cheek puff', kiss: 'kiss',
  jawLeft: 'jaw L', jawRight: 'jaw R', mouthLeft: 'mouth L', mouthRight: 'mouth R', tongueOut: 'tongue out', blinkBoth: 'blink',
  headLeft: 'head L', headRight: 'head R', headUp: 'head up', headDown: 'head down', tiltLeft: 'tilt L', tiltRight: 'tilt R',
  holdHandsUp: 'hold up', holdPinchLeft: 'hold pinch L', holdPinchRight: 'hold pinch R', holdArmsWide: 'hold wide', holdMouthOpen: 'hold mouth',
  coverTL: 'cover TL', coverTC: 'cover T', coverTR: 'cover TR', coverML: 'cover L', coverMC: 'cover C', coverMR: 'cover R', coverBL: 'cover BL', coverBC: 'cover B', coverBR: 'cover BR'
}
const SONI_VOICE_NAMES = ['Spectra', 'Orbit', 'Flow', 'Events', 'Raster', 'Transmission', 'Filter', 'Chord']

// Conjugated verb phrases for auto-naming a rule ("<gesture> <verb>"). Only the
// static ids ; layers / scenes / voices are handled by index in actionVerb().
const ACTION_VERB: Record<string, string> = {
  'fire:randomize': 'randomizes', 'rand:all': 'randomizes everything', 'rand:sources': 'randomizes sources',
  'rand:sourcefx': 'randomizes source FX', 'rand:layerfx': 'randomizes layer FX', 'rand:mods': 'randomizes modulators',
  'rand:finishing': 'randomizes finishing', 'rand:bg': 'randomizes background', 'rand:master': 'randomizes master FX',
  'rand:meta': 'randomizes Meta knobs', 'rand:inspector': 'randomizes the inspector', 'rand:sonify': 'randomizes Sonify',
  'fire:vary': 'varies', 'fire:flush': 'flushes buffers', 'fire:freeze': 'toggles freeze', 'fire:record': 'toggles record',
  'fire:tap': 'taps tempo', 'fire:seq': 'toggles the sequencer', 'fire:soniseq': 'toggles the Sonify sequencer',
  'fire:sonify': 'toggles Sonify', 'fire:undo': 'undoes', 'fire:redo': 'redoes', 'master:chain': 'toggles master FX',
  'session:new': 'starts a new session', 'session:load': 'loads a session', 'session:open': 'opens a session'
}
// Truncated CamelCase tokens for the default /body/<osc> name.
const ACTION_TOKEN: Record<string, string> = {
  'fire:randomize': 'Rnd', 'rand:all': 'RndAll', 'rand:sources': 'RndSrc', 'rand:sourcefx': 'RndSrcFx',
  'rand:layerfx': 'RndLyrFx', 'rand:mods': 'RndMod', 'rand:finishing': 'RndFin', 'rand:bg': 'RndBg',
  'rand:master': 'RndMst', 'rand:meta': 'RndMeta', 'rand:inspector': 'RndInsp', 'rand:sonify': 'RndSoni',
  'fire:vary': 'Vary', 'fire:flush': 'Flush', 'fire:freeze': 'Freeze', 'fire:record': 'Rec', 'fire:tap': 'Tap',
  'fire:seq': 'Seq', 'fire:soniseq': 'SoniSeq', 'fire:sonify': 'Soni', 'fire:undo': 'Undo', 'fire:redo': 'Redo',
  'master:chain': 'MstChain', 'session:new': 'SesNew', 'session:load': 'SesLoad', 'session:open': 'SesOpen'
}
// Silhouette zone features in row-major order (TL..BR), for the preview grid.
const ZONE_KEYS: BodyFeature[] = ['zoneTL', 'zoneTC', 'zoneTR', 'zoneML', 'zoneMC', 'zoneMR', 'zoneBL', 'zoneBC', 'zoneBR']
// Group the feature list for a legible monitor.
const FEATURE_GROUPS: Array<{ title: string; keys: BodyFeature[] }> = [
  { title: 'Hands', keys: ['handLeftHeight', 'handRightHeight', 'handLeftX', 'handRightX', 'handLeftOpen', 'handRightOpen', 'handsApart', 'handsHeight'] },
  { title: 'Pose', keys: ['bodyMotion', 'bodyLean', 'bodySway', 'armSpan', 'bodyHeight', 'handsUp', 'weightLR'] },
  { title: 'Face', keys: ['faceJawOpen', 'faceSmile', 'faceBrowUp', 'faceBlink', 'faceMouthPucker', 'faceHeadYaw', 'faceHeadPitch', 'faceHeadRoll'] },
  { title: 'Silhouette (zones)', keys: ['zoneTL', 'zoneTC', 'zoneTR', 'zoneML', 'zoneMC', 'zoneMR', 'zoneBL', 'zoneBC', 'zoneBR', 'bodyCover'] },
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
  const [curRule, setCurRule] = useState<{ id: string; fresh: boolean } | null>(null)
  // Rule builder draft (one line : name, gesture(s), action, OSC name).
  const [rName, setRName] = useState('')
  const [rOsc, setROsc] = useState('')
  const [rG1, setRG1] = useState<BodyGesture>('pinchLeft')
  const [rG2, setRG2] = useState<BodyGesture | null>(null)
  const [rCombo, setRCombo] = useState<'together' | 'then'>('together')
  const [rExcl, setRExcl] = useState(false)
  const [rAction, setRAction] = useState<GestureAction>('fire:randomize')

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
      // Silhouette : the 3×3 sensor grid, each cell lit by how much shadow fills it
      // (drawn in screen space, over the mirrored image : TL = performer's top-left).
      if (useStore.getState().bodyControl.silhouette) {
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 3; c++) {
            const v = bodyBus.feature(ZONE_KEYS[r * 3 + c])
            const x = (c * W) / 3, y = (r * H) / 3, cw = W / 3, ch = H / 3
            const lit = v > 0.4
            g.fillStyle = `rgba(255,142,15,${0.05 + v * 0.4})`
            g.fillRect(x + 1, y + 1, cw - 2, ch - 2)
            g.lineWidth = lit ? 2 : 1
            g.strokeStyle = lit ? 'rgba(255,142,15,0.95)' : 'rgba(255,255,255,0.14)'
            g.strokeRect(x + 1, y + 1, cw - 2, ch - 2)
          }
        }
      }
    }
    raf = requestAnimationFrame(draw)
    const monitor = window.setInterval(() => {
      const all = bodyBus.all()
      setVals({ ...all })
      const s = bodyTracker.status(); const b = bodyBus.status()
      setLive({ running: s.running, hands: b.hands, pose: b.pose, face: b.face, error: s.error })
      const lg = bodyBus.lastGesture()
      setCur(lg ? { g: lg.g, fresh: lg.ageMs < 700 } : null)
      const lr = bodyBus.lastRule()
      setCurRule(lr ? { id: lr.id, fresh: lr.ageMs < 700 } : null)
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

  // Rule builder actions. Rules live in bodyControl.rules (machine-local).
  const comboSym = (mode: 'together' | 'then'): string => (mode === 'then' ? '→' : '+')
  const ruleTrigger = (r: { g1: BodyGesture; g2: BodyGesture | null; combo: 'together' | 'then' }): string =>
    r.g2 ? `${GESTURE_LABEL[r.g1]} ${comboSym(r.combo)} ${GESTURE_LABEL[r.g2]}` : GESTURE_LABEL[r.g1]

  // Auto-naming : an action's verb, conjugated for a third-person subject (the
  // gesture), so a blank name reads like a sentence — "hands up randomizes
  // modulators". Dynamic ids (layers, scenes, voices) resolve by index.
  const actionVerb = (id: GestureAction): string => {
    if (id === 'none') return 'sends OSC'
    const rl = /^rand:layer:(\d+)$/.exec(id); if (rl) return `randomizes layer ${Number(rl[1]) + 1}`
    if (id === 'scene:next') return 'goes to next scene'
    if (id === 'scene:prev') return 'goes to previous scene'
    if (id.startsWith('scene:')) return `recalls scene ${Number(id.slice(6)) + 1}`
    const sv = /^sonify:voice:(\d+)$/.exec(id); if (sv) return `toggles ${SONI_VOICE_NAMES[Number(sv[1])] ?? 'a voice'}`
    return ACTION_VERB[id] ?? midiTargetLabel(id).toLowerCase()
  }
  // Auto OSC token : a truncated CamelCase name from the gesture(s) + action, e.g.
  // hands up + randomize modulators → "HandsUpRndMod". Used when the OSC box is blank.
  const camel = (s: string): string =>
    s.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
  const gestureToken = (g: BodyGesture): string => camel(GESTURE_LABEL[g])
  const actionToken = (id: GestureAction): string => {
    if (id === 'none') return ''
    const rl = /^rand:layer:(\d+)$/.exec(id); if (rl) return `RndL${Number(rl[1]) + 1}`
    if (id === 'scene:next') return 'ScnNext'
    if (id === 'scene:prev') return 'ScnPrev'
    if (id.startsWith('scene:')) return `Scn${Number(id.slice(6)) + 1}`
    const sv = /^sonify:voice:(\d+)$/.exec(id); if (sv) return `Voice${Number(sv[1]) + 1}`
    return ACTION_TOKEN[id] ?? camel(midiTargetLabel(id))
  }
  const autoName = (g1: BodyGesture, g2: BodyGesture | null, combo: 'together' | 'then', action: GestureAction): string =>
    `${ruleTrigger({ g1, g2, combo })} ${actionVerb(action)}`
  const autoOsc = (g1: BodyGesture, g2: BodyGesture | null, action: GestureAction): string =>
    (gestureToken(g1) + (g2 ? gestureToken(g2) : '') + actionToken(action)) || 'Rule'
  // Preview strings for the placeholders (update live with the current draft).
  const namePreview = autoName(rG1, rG2, rCombo, rAction)
  const oscPreview = autoOsc(rG1, rG2, rAction)

  const addRule = (): void => {
    const name = rName.trim() || namePreview
    const typed = rOsc.trim().replace(/^\/*(?:body\/)?/i, '') // accept "/body/Foo", "body/Foo" or "Foo"
    const osc = typed.replace(/[^A-Za-z0-9_]/g, '') || oscPreview
    const rule: GestureRule = {
      id: `r${Date.now().toString(36)}`, name, g1: rG1, g2: rG2, combo: rCombo, action: rAction, osc, enabled: true,
      exclusive: rG2 ? rExcl : false
    }
    patch({ rules: [...cfg.rules, rule] })
    setRName(''); setROsc(''); setRG2(null); setRExcl(false)
  }
  const updateRule = (id: string, part: Partial<GestureRule>): void =>
    patch({ rules: cfg.rules.map((r) => (r.id === id ? { ...r, ...part } : r)) })
  const deleteRule = (id: string): void => patch({ rules: cfg.rules.filter((r) => r.id !== id) })

  // Action vocabulary, organised into categories for the dropdowns. Every id is
  // handled by fireTrigger (the shared MIDI/keyboard/gesture executor).
  const scenes = useStore((s) => s.scenes)
  const actionGroups = useMemo(() => {
    const opt = (id: string): { id: string; label: string } => ({ id, label: midiTargetLabel(id) })
    return [
      { label: 'Randomize', opts: [
        'fire:randomize', 'rand:all', 'rand:sources', 'rand:sourcefx', 'rand:layerfx', 'rand:mods', 'rand:finishing',
        'rand:bg', 'rand:master', 'rand:meta', 'rand:inspector', 'rand:sonify', 'fire:vary',
        'rand:layer:0', 'rand:layer:1', 'rand:layer:2', 'rand:layer:3'
      ].map(opt) },
      { label: 'Transport / performance', opts: ['fire:flush', 'fire:freeze', 'fire:record', 'fire:tap', 'fire:seq', 'fire:soniseq', 'fire:undo', 'fire:redo'].map(opt) },
      { label: 'Master FX', opts: ['master:chain'].map(opt) },
      { label: 'Scenes', opts: [opt('scene:next'), opt('scene:prev'), ...scenes.map((s, i) => ({ id: `scene:${i}`, label: `Scene ${i + 1}${s.name ? ' · ' + s.name : ''}` }))] },
      { label: 'Sonify', opts: [opt('fire:sonify'), ...SONI_VOICE_NAMES.map((n, i) => ({ id: `sonify:voice:${i}`, label: `Sonify: ${n}` }))] },
      { label: 'Session', opts: ['session:new', 'session:load', 'session:open'].map(opt) }
    ]
  }, [scenes])
  const actionLabelMap = useMemo(() => {
    const m: Record<string, string> = { none: '— nothing —' }
    for (const grp of actionGroups) for (const o of grp.opts) m[o.id] = o.label
    return m
  }, [actionGroups])
  const labelForAction = (id: GestureAction): string => actionLabelMap[id] ?? (id === 'none' ? '— nothing —' : midiTargetLabel(id))

  const actionOptionEls = (
    <>
      <option value="none">— nothing —</option>
      {actionGroups.map((grp) => (
        <optgroup key={grp.label} label={grp.label}>
          {grp.opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </optgroup>
      ))}
    </>
  )
  // Gestures grouped by body region, for the rule builder dropdowns.
  const GESTURE_GROUPS: Array<{ label: string; keys: BodyGesture[] }> = [
    { label: 'Hands', keys: ['pinchLeft', 'pinchRight', 'clap', 'cross'] },
    { label: 'Pose', keys: ['handsUp', 'leanLeft', 'leanRight', 'crouch', 'jump', 'armsCross', 'tPose', 'raiseLeft', 'raiseRight'] },
    { label: 'Face', keys: ['mouthPop', 'browRaise', 'winkLeft', 'winkRight', 'smile', 'frown', 'browFurrow', 'squint', 'cheekPuff', 'kiss', 'jawLeft', 'jawRight', 'mouthLeft', 'mouthRight', 'tongueOut', 'blinkBoth', 'headLeft', 'headRight', 'headUp', 'headDown', 'tiltLeft', 'tiltRight'] },
    { label: 'Holds', keys: ['holdHandsUp', 'holdPinchLeft', 'holdPinchRight', 'holdArmsWide', 'holdMouthOpen'] },
    { label: 'Zones (silhouette)', keys: ['coverTL', 'coverTC', 'coverTR', 'coverML', 'coverMC', 'coverMR', 'coverBL', 'coverBC', 'coverBR'] }
  ]
  const gestureOptionEls = GESTURE_GROUPS.map((grp) => (
    <optgroup key={grp.label} label={grp.label}>
      {grp.keys.map((g) => <option key={g} value={g}>{GESTURE_LABEL[g]}</option>)}
    </optgroup>
  ))

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
        <span className="font-mono text-[10px] text-muted">embodied control · MediaPipe Hands + Pose + Face</span>
        <div className="flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${cfg.enabled && (live.hands || live.pose || live.face) ? 'animate-pulse bg-red-500' : cfg.enabled ? 'bg-yellow-500' : 'bg-muted'}`} />
          <span className="font-mono text-[10px] text-muted">{statusText}</span>
        </div>
        <label className="flex items-center gap-1.5" title="Which camera feeds the tracker (a dedicated low-res capture, independent of any webcam layer)">
          <span className="font-mono text-[10px] text-muted">camera</span>
          <select
            value={cfg.deviceId ?? ''}
            onChange={(e) => patch({ deviceId: e.target.value || null })}
            className="input select-compact max-w-[200px] text-[11px]"
          >
            <option value="">default camera</option>
            {cameras.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <div className="flex-1" />
        <span className="font-mono text-[9px] text-muted">B / Esc closes</span>
        <button onClick={() => setOpen(false)} className="rounded px-2 py-0.5 text-[12px] text-muted hover:text-text" title="Close (Esc)">✕</button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {/* Tracking controls : one distributed line — which streams to track,
            how easily gestures fire and hold, and the OSC-out toggle. The two
            sliders grow to fill so there's no blank space. */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded border border-border bg-panel2 px-2.5 py-1.5">
          <div className="flex shrink-0 items-center gap-1.5">
            <Toggle on={cfg.hands} label="Hands" onClick={() => patch({ hands: !cfg.hands })} title="Track hand landmarks (21 per hand, up to two hands)" />
            <Toggle on={cfg.pose} label="Pose" onClick={() => patch({ pose: !cfg.pose })} title="Track the whole-body pose (33 landmarks)" />
            <Toggle on={cfg.face} label="Face" onClick={() => patch({ face: !cfg.face })} title="Track the face (blendshapes : jaw, smile, brow, blink, pucker + head yaw/pitch/roll). Heavier — enable when you want facial control." />
            <Toggle on={cfg.silhouette} label="Silhouette" onClick={() => patch({ silhouette: !cfg.silhouette, pose: cfg.pose || !cfg.silhouette })} title="Segment the body silhouette (rides the Pose model) into a 3×3 coverage grid : each zone is a continuous feature (for modulators) and an occlusion gesture 'cover …' (for rules). Cover a region with your shadow to fire it. Heavier — enable when you want screen-space control." />
            <Toggle on={cfg.mirror} label="Mirror" onClick={() => patch({ mirror: !cfg.mirror })} title="Selfie view : moving right moves the value right" />
          </div>
          <label className="flex min-w-[200px] flex-1 items-center gap-2 font-mono text-[11px] text-muted">
            <span className="shrink-0">sensitivity</span>
            <input
              type="range" min={0} max={1} step={0.01} value={cfg.sensitivity}
              onChange={(e) => patch({ sensitivity: Number(e.target.value) })}
              className="min-w-0 flex-1"
              title="How easily gestures fire (pinch distance, clap gap, hands-up threshold). Higher = easier."
            />
            <span className="w-8 shrink-0 text-right text-text">{cfg.sensitivity.toFixed(2)}</span>
          </label>
          <label className="flex min-w-[200px] flex-1 items-center gap-2 font-mono text-[11px] text-muted">
            <span className="shrink-0">hold time</span>
            <input
              type="range" min={400} max={3000} step={50} value={cfg.holdMs}
              onChange={(e) => patch({ holdMs: Number(e.target.value) })}
              className="min-w-0 flex-1"
              title="How long a pose must be held for a hold gesture (hold up, hold pinch, …) to fire."
            />
            <span className="w-8 shrink-0 text-right text-text">{(cfg.holdMs / 1000).toFixed(1)}s</span>
          </label>
          <div className="flex shrink-0 items-center gap-1.5">
            <Toggle
              on={cfg.oscOut}
              label="OSC out"
              onClick={() => patch({ oscOut: !cfg.oscOut })}
              title="When a rule fires, also send an OSC bang to /body/<its OSC name> at the OSC-out target set in I/O setup — so the body plays the sound side too."
            />
            <span className="font-mono text-[10px] text-muted">→ /body/…</span>
          </div>
        </div>
        {/* Top row : camera preview · live feature monitor */}
        <div className="flex flex-col gap-3 lg:flex-row">
        {/* Left : the enable button + live camera preview */}
        <div className="flex shrink-0 flex-col gap-2 lg:w-[420px]">
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

          <div className="relative mx-auto aspect-[4/3] w-full max-w-[420px] overflow-hidden rounded border border-border bg-black">
            <canvas ref={canvasRef} width={480} height={360} className="h-full w-full" />
            {!cfg.enabled && (
              <div className="absolute inset-0 flex items-center justify-center px-4 text-center font-mono text-[11px] text-muted">
                enable to preview the camera and skeleton
              </div>
            )}
          </div>
        </div>

        {/* Right : the live feature monitor (two columns). */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <section className="rounded border border-border bg-panel2 p-2">
            <div className="mb-1 font-mono text-[9px] uppercase tracking-wide text-accent2">Feature monitor</div>
            <p className="mb-2 text-[10px] leading-snug text-muted">
              Live 0..1 values off the body bus. <span className="text-text">→</span> routes one into a free modulator slot (then bind it with a param’s <span className="text-text">M</span> button). Every feature is also selectable in any modulator set to <span className="text-text">body</span> (Modulation : D).
            </p>
            {FEATURE_GROUPS.map((grp) => (
              <div key={grp.title} className="mb-1.5">
                <div className="mb-0.5 font-mono text-[8px] uppercase tracking-wide text-muted">{grp.title}</div>
                <div className="grid grid-cols-1 gap-x-3 gap-y-0.5 sm:grid-cols-2">
                  {grp.keys.map((k) => {
                    const v = vals[k] ?? 0
                    return (
                      <div key={k} className="flex items-center gap-1.5">
                        <span className="w-[70px] shrink-0 truncate font-mono text-[9px] text-muted" title={k}>{k}</span>
                        <div className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-panel3/70">
                          <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.round(v * 100)}%` }} />
                        </div>
                        <span className="w-7 shrink-0 text-right font-mono text-[9px] text-muted">{v.toFixed(2)}</span>
                        <button
                          onClick={() => toSlot(k)}
                          className="shrink-0 rounded border border-border bg-panel3/70 px-1 font-mono text-[10px] text-muted hover:border-accent hover:text-accent"
                          title={`Route ${k} into the first free modulator slot`}
                        >→</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </section>
        </div>
        </div>{/* end top row */}

        {/* Create actions : the rule builder, full width under the row. The only
            gesture routing — every action is a rule, single or a two-gesture combo. */}
        <section className="rounded border border-border bg-panel2 p-2">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="font-mono text-[9px] uppercase tracking-wide text-accent2">Create actions</span>
              {/* Currently recognised gesture : lights up for ~0.7s each time one fires. */}
              <span
                className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                  cur?.fresh ? 'border-accent bg-accent/20 text-accent' : 'border-border bg-panel3/50 text-muted'
                }`}
                title="The most recent gesture the tracker recognised"
              >
                {cur ? `⚡ ${GESTURE_LABEL[cur.g]}` : 'no gesture yet'}
              </span>
            </div>
            <p className="mb-2 text-[10px] leading-snug text-muted">
              One gesture, or two combined, fires an action and/or an OSC bang. A combo triggers when both land close together (<span className="text-text">+</span>) or in order (<span className="text-text">→</span>). Leave the name blank for an auto label like <span className="text-text">“{namePreview}”</span> ; leave OSC blank for <span className="text-text">/body/{oscPreview}</span>. Set the action to <span className="text-text">— nothing —</span> for an OSC-only rule.
            </p>

            {/* Builder line : name · gesture(s) · action · OSC · save */}
            <div className="mb-2 flex flex-wrap items-center gap-1.5 rounded border border-border/60 bg-panel3/30 p-1.5">
              <input
                value={rName}
                onChange={(e) => setRName(e.target.value)}
                placeholder={namePreview}
                spellCheck={false}
                className="input h-[26px] w-44 text-[11px]"
                title="A label for this rule. Blank = the auto name shown as the placeholder."
              />
              <select value={rG1} onChange={(e) => setRG1(e.target.value as BodyGesture)} className="input select-compact h-[26px] w-[108px] text-[11px]" title="First gesture">
                {gestureOptionEls}
              </select>
              {rG2 == null ? (
                <button
                  onClick={() => setRG2(rG1)}
                  className="rounded border border-border bg-panel3/70 px-1.5 py-1 font-mono text-[10px] text-muted hover:border-accent hover:text-accent"
                  title="Combine a second gesture into this action"
                >
                  + gesture&nbsp;2
                </button>
              ) : (
                <>
                  <button
                    onClick={() => setRCombo((c) => (c === 'together' ? 'then' : 'together'))}
                    className="rounded border border-accent bg-accent/15 px-2 py-1 font-mono text-[12px] text-accent"
                    title={rCombo === 'together' ? 'Both together (order-independent). Click for a sequence.' : 'In sequence (first, then second). Click for together.'}
                  >
                    {comboSym(rCombo)}
                  </button>
                  <select value={rG2} onChange={(e) => setRG2(e.target.value as BodyGesture)} className="input select-compact h-[26px] w-[108px] text-[11px]" title="Second gesture">
                    {gestureOptionEls}
                  </select>
                  <button
                    onClick={() => setRExcl((v) => !v)}
                    className={`rounded border px-1.5 py-1 font-mono text-[10px] ${rExcl ? 'border-accent bg-accent/15 text-accent' : 'border-border bg-panel3/70 text-muted hover:text-text'}`}
                    title="Exclusive : when this combo fires, swallow the two gestures' own single actions (a chord that doesn't also play its notes). Adds a small delay to those singles."
                  >
                    excl
                  </button>
                  <button onClick={() => setRG2(null)} className="rounded px-1 font-mono text-[12px] text-muted hover:text-danger" title="Remove the second gesture">×</button>
                </>
              )}
              <span className="font-mono text-[11px] text-muted">→</span>
              <select value={rAction} onChange={(e) => setRAction(e.target.value)} className="input select-compact h-[26px] w-[172px] text-[11px]" title="What the rule fires. — nothing — makes an OSC-only rule.">
                {actionOptionEls}
              </select>
              <div className="flex items-center" title="Custom OSC name. The message sent is /body/<name>. Blank = the truncated default shown as the placeholder.">
                <span className="rounded-l border border-r-0 border-border bg-panel3/70 px-1.5 py-1 font-mono text-[10px] text-muted">/body/</span>
                <input
                  value={rOsc}
                  onChange={(e) => setROsc(e.target.value)}
                  placeholder={oscPreview}
                  spellCheck={false}
                  className="input h-[26px] w-32 rounded-l-none text-[11px]"
                />
              </div>
              <button
                onClick={addRule}
                className="rounded border border-accent bg-accent/15 px-2 py-1 font-mono text-[11px] text-accent hover:bg-accent/25"
                title="Save this rule"
              >
                save
              </button>
            </div>

            {/* Saved rules */}
            {cfg.rules.length === 0 ? (
              <p className="text-[10px] text-muted">No custom rules yet.</p>
            ) : (
              <div className="grid grid-cols-1 gap-1 lg:grid-cols-2 2xl:grid-cols-3">
                {cfg.rules.map((r) => {
                  const lit = curRule?.id === r.id && curRule.fresh
                  return (
                    <div
                      key={r.id}
                      className={`flex items-center gap-1.5 rounded border px-1.5 py-1 font-mono text-[10px] transition-colors ${lit ? 'border-accent bg-accent/15' : 'border-border bg-panel3/30'}`}
                    >
                      <button
                        onClick={() => updateRule(r.id, { enabled: !r.enabled })}
                        className={`h-3.5 w-3.5 shrink-0 rounded-sm border ${r.enabled ? 'border-accent bg-accent/40' : 'border-border'}`}
                        title={r.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
                      />
                      <span className="w-20 shrink-0 truncate text-text" title={r.name}>{r.name}</span>
                      <span className="min-w-0 flex-1 truncate text-muted">
                        {ruleTrigger(r)} <span className="text-muted/60">→</span> <span className="text-accent2">{labelForAction(r.action)}</span>
                      </span>
                      {r.osc && (
                        <span
                          className={`shrink-0 truncate font-mono text-[9px] ${cfg.oscOut ? 'text-accent2/70' : 'text-muted/40'}`}
                          title={cfg.oscOut ? `Sends /body/${r.osc} over OSC` : `Would send /body/${r.osc} (OSC out is off)`}
                        >
                          /body/{r.osc}
                        </span>
                      )}
                      {r.g2 && (
                        <button
                          onClick={() => updateRule(r.id, { exclusive: !r.exclusive })}
                          className={`shrink-0 rounded border px-1 text-[9px] ${r.exclusive ? 'border-accent text-accent' : 'border-border text-muted/60 hover:text-text'}`}
                          title={r.exclusive ? 'Exclusive : swallows the component singles. Click to disable.' : 'Not exclusive : the component gestures also fire their own actions. Click to make exclusive.'}
                        >
                          excl
                        </button>
                      )}
                      <button
                        onClick={() => fireTrigger(r.action)}
                        disabled={r.action === 'none'}
                        className="shrink-0 rounded border border-border bg-panel3/70 px-1.5 text-[10px] text-muted hover:border-accent hover:text-accent disabled:opacity-30"
                        title="Fire this rule's action now"
                      >
                        test
                      </button>
                      <button onClick={() => deleteRule(r.id)} className="shrink-0 rounded px-1 text-[12px] text-muted hover:text-danger" title="Delete this rule">×</button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
      </div>
    </div>
  )
}
