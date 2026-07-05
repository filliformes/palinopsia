// Inbound OSC → store. This is how Pandore (or any OSC source) PLAYS the
// instrument. Mirrors the MIDI-CC pattern in midi.ts: a message arrives, we
// parse its `/opsia/...` address and drive the matching store action.
//
// Value convention (uniform, controller-friendly): every continuous control
// takes a NORMALIZED 0..1 float, scaled to the target's declared range. Enums
// (blend) take an int index or a 0..1 float mapped across the modes. Bools
// (mute/solo/feedback) are true at >= 0.5. Triggers (scene/randomize) fire on
// the rising edge. BPM is the one raw value. Addresses are 1-based (L1, Knob 1,
// Scene 1) to match the UI and the number-key scene shortcuts.
//
// Address map:
//   /opsia/layer/{1..4}/opacity|speed|mix|trail        f 0..1
//   /opsia/layer/{n}/blend|sourceblend                 i index | f 0..1
//   /opsia/layer/{n}/mute|solo|feedback                >= 0.5
//   /opsia/layer/{n}/source/{A|B}                       s shaderId | name | "none"
//   /opsia/layer/{n}/source/{A|B}/{input}              f 0..1 → range
//   /opsia/layer/{n}/source/{A|B}/fx/{i}/{input}       f 0..1 → range
//   /opsia/layer/{n}/fx/{i}/{input}                    f 0..1 → range
//   /opsia/master/fx/{i}/{input}                       f 0..1 → range
//   /opsia/master/vibe|context/{input}                 f 0..1 → range
//   /opsia/meta/{1..16}                                f 0..1 (drives the knob)
//   /opsia/bpm                                          f 20..300 (raw)
//   /opsia/scene/{n}                                    trigger
//   /opsia/randomize[/{scope}]                          trigger

import type { BlendMode, FxScope, OscInEvent, OscQueryLeaf } from '@shared/types'
import { BLEND_MODES } from '@shared/types'
import { useStore } from './store'
import type { RandomizeScope } from './randomize'
import { setKnobTarget } from './metaSmooth'
import { GENERATORS, SHADER_BY_ID } from './shaders/isf'
import { inputsForShader } from './shaders/isf/inputs'

type Args = OscInEvent['args']
const clamp01 = (v: number): number => Math.max(0, Math.min(1, v))

function firstNum(args: Args): number {
  const a = args[0]
  if (!a) return 0
  if (typeof a.value === 'number') return a.value
  if (a.value === true || a.value === 'true') return 1
  if (a.value === false || a.value === 'false') return 0
  const n = Number(a.value)
  return Number.isFinite(n) ? n : 0
}
function firstStr(args: Args): string | null {
  const a = args[0]
  return a && typeof a.value === 'string' ? a.value : null
}

/** Scale a normalized 0..1 OSC value onto a shader input's declared range/type. */
function scaleInput(shaderId: string, name: string, norm: number): number | null {
  const d = inputsForShader(shaderId).find((x) => x.name === name)
  if (!d) return null
  if (d.type === 'long') {
    const vals = d.values ?? []
    if (!vals.length) return null
    const i = Math.round(clamp01(norm) * (vals.length - 1))
    return vals[Math.max(0, Math.min(vals.length - 1, i))]
  }
  if (d.type === 'bool' || d.type === 'event') return norm >= 0.5 ? 1 : 0
  if (d.type !== 'float') return null // color / point2D need multi-arg — skip
  const min = typeof d.min === 'number' ? d.min : 0
  const max = typeof d.max === 'number' ? d.max : 1
  return min + clamp01(norm) * (max - min)
}

function sourceShaderId(li: number, slot: 'A' | 'B'): string | null {
  const l = useStore.getState().composition.layers[li]
  if (!l) return null
  const s = slot === 'A' ? l.sourceA : l.sourceB
  return s?.shaderId ?? null
}

/** The FX unit at `i` (0-based) in a scope's rack — master excludes the locked
 *  finalizers (address those via /master/vibe · /master/context). */
function fxAt(scope: FxScope, i: number): { id: string; shaderId: string } | null {
  const c = useStore.getState().composition
  let arr
  if (scope.kind === 'master') arr = c.master.filter((f) => !f.locked)
  else {
    const l = c.layers[scope.layer]
    if (!l) return null
    arr = scope.kind === 'layer' ? l.fx : scope.kind === 'sourceA' ? l.sourceAFx : l.sourceBFx
  }
  const u = arr[i]
  return u && u.shaderId ? { id: u.id, shaderId: u.shaderId } : null
}

function resolveGenerator(str: string): string | null {
  const lc = str.trim().toLowerCase()
  if (lc === 'none' || lc === 'off' || lc === '') return null
  if (SHADER_BY_ID[str]) return str
  const g = GENERATORS.find((x) => x.id === str || x.name.toLowerCase() === lc)
  return g?.id ?? null
}

function blendFrom(args: Args): BlendMode | null {
  const a = args[0]
  if (!a) return null
  if (typeof a.value === 'string') {
    return (BLEND_MODES as readonly string[]).includes(a.value) ? (a.value as BlendMode) : null
  }
  const v = Number(a.value)
  const idx = a.type === 'i' ? Math.round(v) : Math.round(clamp01(v) * (BLEND_MODES.length - 1))
  return BLEND_MODES[Math.max(0, Math.min(BLEND_MODES.length - 1, idx))] ?? null
}

// Rising-edge tracking for trigger addresses (scene / randomize).
const edge = new Map<string, boolean>()
function rising(address: string, v: number): boolean {
  const now = v >= 0.5
  const was = edge.get(address) ?? false
  edge.set(address, now)
  return now && !was
}

function route(address: string, args: Args): void {
  const segs = address.split('/').filter(Boolean)
  if (segs[0] !== 'opsia') return
  const st = useStore.getState()
  const n = firstNum(args)

  switch (segs[1]) {
    case 'layer': {
      const li = parseInt(segs[2], 10) - 1
      if (!(li >= 0 && li < 4)) return
      const ctl = segs[3]

      if (ctl === 'source') {
        const slot: 'A' | 'B' = segs[4] === 'B' ? 'B' : 'A'
        if (segs[5] === undefined) {
          const str = firstStr(args)
          if (str !== null) st.setSourceShader(li, slot, resolveGenerator(str))
          return
        }
        if (segs[5] === 'fx') {
          const fi = parseInt(segs[6], 10) - 1
          const input = segs[7]
          if (!input || fi < 0) return
          const scope: FxScope = { kind: slot === 'A' ? 'sourceA' : 'sourceB', layer: li }
          const u = fxAt(scope, fi)
          if (!u) return
          const v = scaleInput(u.shaderId, input, n)
          if (v !== null) st.setFxInput(scope, u.id, input, v)
          return
        }
        const input = segs[5]
        const sid = sourceShaderId(li, slot)
        if (!sid) return
        const v = scaleInput(sid, input, n)
        if (v !== null) st.setSourceInput(li, slot, input, v)
        return
      }

      if (ctl === 'fx') {
        const fi = parseInt(segs[4], 10) - 1
        const input = segs[5]
        if (!input || fi < 0) return
        const scope: FxScope = { kind: 'layer', layer: li }
        const u = fxAt(scope, fi)
        if (!u) return
        const v = scaleInput(u.shaderId, input, n)
        if (v !== null) st.setFxInput(scope, u.id, input, v)
        return
      }

      switch (ctl) {
        case 'opacity': st.setOpacity(li, clamp01(n)); return
        case 'mix': st.setSourceMix(li, clamp01(n)); return
        case 'trail': st.setFeedbackAmount(li, clamp01(n)); return
        case 'speed': st.setLayerSpeed(li, clamp01(n) * 20); return
        case 'blend': { const b = blendFrom(args); if (b) st.setBlend(li, b); return }
        case 'sourceblend': { const b = blendFrom(args); if (b) st.setSourceBlend(li, b); return }
        case 'mute': st.patchLayer(li, { mute: n >= 0.5 }); return
        case 'solo': st.patchLayer(li, { solo: n >= 0.5 }); return
        case 'feedback': st.patchLayer(li, { feedback: n >= 0.5 }); return
        default: return
      }
    }

    case 'master': {
      if (segs[2] === 'fx') {
        const fi = parseInt(segs[3], 10) - 1
        const input = segs[4]
        if (!input || fi < 0) return
        const scope: FxScope = { kind: 'master' }
        const u = fxAt(scope, fi)
        if (!u) return
        const v = scaleInput(u.shaderId, input, n)
        if (v !== null) st.setFxInput(scope, u.id, input, v)
        return
      }
      if (segs[2] === 'vibe' || segs[2] === 'context') {
        const shaderId = segs[2] === 'vibe' ? 'fx-vibe' : 'fx-context'
        const input = segs[3]
        if (!input) return
        const u = st.composition.master.find((f) => f.shaderId === shaderId)
        if (!u) return
        const v = scaleInput(shaderId, input, n)
        if (v !== null) st.setFxInput({ kind: 'master' }, u.id, input, v)
        return
      }
      return
    }

    case 'meta': {
      const k = parseInt(segs[2], 10) - 1
      if (!(k >= 0 && k < st.composition.metaKnobs.length)) return
      setKnobTarget(k, clamp01(n), st.composition.metaKnobs[k]?.smoothMs ?? 10)
      return
    }

    case 'bpm':
      st.setBpm(n)
      return

    case 'scene': {
      const idx = segs[2] !== undefined ? parseInt(segs[2], 10) - 1 : Math.round(n) - 1
      if (idx < 0) return
      // A dedicated /scene/{n} address is a trigger — fire on the rising edge.
      if (segs[2] !== undefined && !rising(address, n)) return
      const sc = st.scenes[idx]
      if (sc) st.recallScene(sc.id)
      return
    }

    case 'randomize': {
      if (!rising(address, n)) return
      const scope = segs[2] ?? 'all'
      const valid = ['all', 'sources', 'sourceparams', 'sourcefx', 'master', 'modulators']
      st.randomize((valid.includes(scope) ? scope : 'all') as RandomizeScope)
      return
    }

    default:
      return
  }
}

/** Subscribe to inbound OSC and apply it. Returns an unsubscribe fn. */
export function initOscInput(): () => void {
  return window.api.onOscReceived((batch) => {
    for (const m of batch) {
      try {
        route(m.address, m.args)
      } catch {
        // One malformed/unmapped message must never break the rest of the batch.
      }
    }
  })
}

/** Push (start=true) or clear (start=false) the listener + OSCQuery for the
 *  current store config, then reflect the result back into the store. */
export async function applyOscListen(): Promise<void> {
  const st = useStore.getState()
  try {
    const res = await window.api.oscListen(st.oscPort, st.oscEnabled)
    st.setOscConfig({ listening: res.listening, addresses: res.addresses })
    if (res.listening) publishOscQuery()
  } catch {
    st.setOscConfig({ listening: false })
  }
}

/** Enumerate the address space and hand it to the OSCQuery server. */
export function publishOscQuery(): void {
  const st = useStore.getState()
  const nodes: OscQueryLeaf[] = []
  const f = (full_path: string, min: number, max: number, value: number, description: string): void => {
    nodes.push({ full_path, type: 'f', range: { min, max }, value, description })
  }
  for (let n = 1; n <= 4; n++) {
    const l = st.composition.layers[n - 1]
    f(`/opsia/layer/${n}/opacity`, 0, 1, l?.opacity ?? 1, 'Layer opacity')
    f(`/opsia/layer/${n}/speed`, 0, 1, (l?.speed ?? 1) / 20, 'Layer speed (0..1 → 0..20×)')
    f(`/opsia/layer/${n}/mix`, 0, 1, l?.sourceMix ?? 0.5, 'A/B source mix')
    f(`/opsia/layer/${n}/trail`, 0, 1, l?.feedbackAmount ?? 0, 'Feedback trail amount')
    f(`/opsia/layer/${n}/blend`, 0, 1, 0, 'Layer blend mode (index)')
    f(`/opsia/layer/${n}/sourceblend`, 0, 1, 0, 'A/B blend mode (index)')
    f(`/opsia/layer/${n}/mute`, 0, 1, l?.mute ? 1 : 0, 'Mute (>= 0.5)')
    f(`/opsia/layer/${n}/solo`, 0, 1, l?.solo ? 1 : 0, 'Solo (>= 0.5)')
    f(`/opsia/layer/${n}/feedback`, 0, 1, l?.feedback ? 1 : 0, 'Feedback on (>= 0.5)')
  }
  for (let k = 1; k <= st.composition.metaKnobs.length; k++) {
    const knob = st.composition.metaKnobs[k - 1]
    f(`/opsia/meta/${k}`, 0, 1, knob?.value ?? 0, knob?.name ?? `Meta knob ${k}`)
  }
  nodes.push({ full_path: '/opsia/bpm', type: 'f', range: { min: 20, max: 300 }, value: st.composition.bpm, description: 'Tempo (raw BPM)' })
  for (const [key, sid] of [['vibe', 'fx-vibe'], ['context', 'fx-context']] as const) {
    for (const d of inputsForShader(sid)) {
      if (d.type !== 'float') continue
      const min = typeof d.min === 'number' ? d.min : 0
      const max = typeof d.max === 'number' ? d.max : 1
      f(`/opsia/master/${key}/${d.name}`, 0, 1, 0, `${key} · ${d.label} (0..1 → ${min}..${max})`)
    }
  }
  window.api.oscQueryPublish(nodes)
}
