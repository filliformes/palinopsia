// The instrument's playable actions beyond midi.ts's first set : what a body
// rule, a MIDI pad or a learned key can fire to PLAY the layers, the effects'
// triggers, the Worlds, Generate, the Meta knobs, the modulators, the Feel, the
// tempo and the key, the Audio Layer and the output. Every id starts `act:`;
// midi.ts's fireTrigger hands them here and its midiTargetLabel names them from
// here, so the Body page, MIDI Learn and the keyboard share one vocabulary.
//
// The rules every action keeps :
//   - it writes through the store's own actions (undo, the session guard, the
//     morph, Flash safety at the output all apply as for a hand);
//   - a persistent (pinned) thing is left alone : the action says so in a toast
//     (once in a while, never one per fire) and does nothing. What changes no
//     setting (an effect's trigger, a modulator's retrigger) plays anyway, as a
//     hand on its button would;
//   - cheap to fire again and again : a second fire while one is in flight
//     reverses it (A↔B), restarts it (a punch) or is skipped (a screenshot);
//   - it never opens a camera, a file dialog or a network source by itself;
//   - an id whose target is gone (an effect no longer loaded, a deleted World)
//     names itself "(gone)" and does nothing.
//
// Ids :
//   act:layer:<i>:<mute|solo|fx|fb|freeze|next|prev|rand|ab|blend|vary|punch>
//   act:fx:<rack>:<shader>:<input>   an effect's trigger (rack : master,
//                                     background, layer:<i>, sourceA:<i>, sourceB:<i>)
//   act:src:<i>:<A|B>:<shader>:<input> · act:bgsrc:<shader>:<input>   a source's trigger
//   act:chain:<next|prev|rand> · act:finishing
//   act:scene:rand
//   act:world:<next|prev|rand> · act:world:id:<id>
//   act:gen:<rand|next> · act:gen:family:<family>
//   act:meta:<k>:<up|down|rand|flip>
//   act:mod:<n>:<trig|onoff>
//   act:feel:<macro>:<up|down> · act:feel:reset
//   act:bpm:<double|half> · act:link:play
//   act:key:<next|fifthup|fifthdown|up|down>
//   act:au:<play|A|B|mute>
//   act:out:<shot|turn|spin|flipx|flipy|reset>

import type { FxInstance, FxScope, LayerState, SourceSlot } from '@shared/types'
import { BLEND_MODES } from '@shared/types'
import { useStore, FEEL_NEUTRAL } from './store'
import { layerPin, layerSpeedPin, modPin, slotPin, isPinnedTarget } from './persist'
import { DICE_SOURCES, randomizeInputs } from './randomize'
import { SHADER_BY_ID, inPickerOrder } from './shaders/isf'
import { inputsForShader } from './shaders/isf/inputs'
import { MASTER_PRESETS } from './shaders/isf/masterPresets'
import { THEMES, THEME_BY_ID, THEME_FAMILIES } from './themes'
import { knobDisplayValue, setKnobTarget } from './metaSmooth'
import { modEngine } from './engine/modulation'
import { linkPlay, setLinkPlaying } from './link'
import { keySeqNext } from './audio/soniKeySeq'
import { sonifyEngine } from './audio/sonify'
import { leaveSession, markClean } from './sessionGuard'
import { captureScreenshot } from './recorder'
import { outputCanvas } from './engine/outputCanvas'
import { runSilently } from './undo'
import { showToast } from './components/Toast'

type St = ReturnType<typeof useStore.getState>
const get = (): St => useStore.getState()

/** One action, described for the pickers and the rule list. */
export interface ActionInfo {
  label: string // its name everywhere (the rule list, the MIDI ledger)
  verb: string // a rule's auto name : "<gesture> <verb>"
  token: string // a rule's default OSC name part (CamelCase)
  group: string // its heading in the picker
  title?: string // what it does, on hover
  gone?: boolean // its target is not there now : it does nothing
}

// ── Small helpers ───────────────────────────────────────────────────────────

const pickOne = <T,>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)]
const camel = (s: string): string =>
  s.replace(/[^A-Za-z0-9]+/g, ' ').trim().split(' ').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join('')
const mod12 = (n: number): number => ((n % 12) + 12) % 12

// A refusal says why, but at most once every few seconds per thing : a gesture
// fired again and again must not bury the screen in toasts.
const lastSaid = new Map<string, number>()
function say(text: string, kind: 'ok' | 'warn' = 'warn'): void {
  const now = performance.now()
  if (now - (lastSaid.get(text) ?? -1e9) < 4000) return
  lastSaid.set(text, now)
  showToast(text, kind, 3200)
}

/** A pinned thing among `keys` : say so and refuse. */
function held(st: St, keys: string[], what: string): boolean {
  if (!keys.some((k) => st.pins.includes(k))) return false
  say(`${what} is persistent : the action leaves it (unpin it first)`)
  return true
}

/** The side of a layer you see : B when it has one and the mix leans to it. */
const onAir = (l: LayerState): 'A' | 'B' => (l.sourceB && l.sourceB.kind !== 'none' && l.sourceMix >= 0.5 ? 'B' : 'A')
const hasB = (l: LayerState | undefined): boolean => !!l?.sourceB && l.sourceB.kind !== 'none'

// ── Layers ──────────────────────────────────────────────────────────────────

const LAYER_VERBS = ['mute', 'solo', 'fx', 'fb', 'freeze', 'next', 'prev', 'rand', 'ab', 'blend', 'vary', 'punch'] as const
type LayerVerb = (typeof LAYER_VERBS)[number]
const LAYER_WORDS: Record<LayerVerb, { label: string; verb: (n: number) => string; token: string; title: string }> = {
  mute: { label: 'mute on/off', verb: (n) => `mutes layer ${n}`, token: 'Mute', title: 'Mutes the layer, or brings it back' },
  solo: { label: 'solo on/off', verb: (n) => `solos layer ${n}`, token: 'Solo', title: 'Solos the layer, or lets the others back' },
  fx: { label: 'FX on/off', verb: (n) => `switches layer ${n}’s FX`, token: 'Fx', title: 'Turns all the layer’s effects off, or all back on (its rack’s power switch)' },
  fb: { label: 'feedback on/off', verb: (n) => `switches layer ${n}’s feedback`, token: 'Fb', title: 'Turns the layer’s feedback (its trails) on or off' },
  freeze: { label: 'freeze / run', verb: (n) => `freezes layer ${n}`, token: 'Frz', title: 'Stops the layer’s time (its speed to 0) while the others run on; again, back to its speed' },
  next: { label: 'next source', verb: (n) => `steps layer ${n}’s source`, token: 'Src', title: 'The next source in the picker’s order, on the side you see (A, or B when the mix leans to it), at its own look. The dice’s pool : never one that needs you (text, films, the camera)' },
  prev: { label: 'previous source', verb: (n) => `steps layer ${n}’s source back`, token: 'SrcBack', title: 'The previous source in the picker’s order, on the side you see' },
  rand: { label: 'random source', verb: (n) => `deals layer ${n} a source`, token: 'SrcRnd', title: 'A source dealt as the layer’s dice deals one, curated settings included, on the side you see. Its effects stay' },
  ab: { label: 'A↔B', verb: (n) => `crosses layer ${n} to the other side`, token: 'AB', title: 'Crossfades the layer to its other source over the Morph time (needs a B); again mid-way, it turns back' },
  blend: { label: 'next blend', verb: (n) => `steps layer ${n}’s blend`, token: 'Blend', title: 'The next blend mode, in the blend menu’s order' },
  vary: { label: 'vary', verb: (n) => `varies layer ${n}`, token: 'Vary', title: 'The layer’s own Vary : a variant around where it sits' },
  punch: { label: 'punch', verb: (n) => `punches layer ${n}`, token: 'Punch', title: 'A flash of the layer’s opacity, up and back in half a second (a dip when it is already full). Flash safety still holds the output to a gentle pulse past 3 a second' }
}

// What a layer action changes, as pins
function layerPins(i: number, v: LayerVerb, l: LayerState | undefined): string[] {
  const keys = [layerPin(i)]
  if (v === 'freeze') keys.push(layerSpeedPin(i))
  if (v === 'ab') keys.push(`lay:${i}:mix`)
  if (v === 'blend') keys.push(`lay:${i}:blend`)
  if (v === 'punch') keys.push(`lay:${i}:opacity`)
  if ((v === 'next' || v === 'prev' || v === 'rand') && l) keys.push(slotPin(i, onAir(l)))
  return keys
}

// A layer frozen by an action : the speed it had (given back by the next fire)
const frozenAt = new Map<number, number>()

function stepSource(st: St, i: number, l: LayerState, how: 'next' | 'prev' | 'rand'): void {
  const slot = onAir(l)
  const pool = inPickerOrder(DICE_SOURCES)
  if (!pool.length) return
  const cur = (slot === 'A' ? l.sourceA : l.sourceB)?.shaderId ?? null
  let id: string
  if (how === 'rand') id = pickOne(pool.filter((g) => g.id !== cur).length ? pool.filter((g) => g.id !== cur) : pool).id
  else {
    const k = pool.findIndex((g) => g.id === cur)
    const d = how === 'next' ? 1 : -1
    id = pool[k < 0 ? (d > 0 ? 0 : pool.length - 1) : (k + d + pool.length) % pool.length].id
  }
  // (a pick by hand opens it in the Inspector; a gesture leaves the selection)
  const sel = st.selection
  st.setSourceShader(i, slot, id)
  if (how === 'rand') {
    const now = get().composition.layers[i]
    const s = slot === 'A' ? now?.sourceA : now?.sourceB
    if (s && s.shaderId === id) get().patchLayer(i, slot === 'A' ? { sourceA: { ...s, inputs: randomizeInputs(id, {}) } } : { sourceB: { ...s, inputs: randomizeInputs(id, {}) } })
  }
  useStore.setState({ selection: sel })
}

// A↔B : one crossfade per layer, frame by frame through the store (one undo
// step : the frames come closer than the undo's quiet time). It stops where it
// is when anything else moves the mix (a hand, a recall).
const abRuns = new Map<number, { to: number; timer: number }>()
function crossAB(st: St, i: number, l: LayerState): void {
  const run = abRuns.get(i)
  const to = run ? (run.to > 0.5 ? 0 : 1) : l.sourceMix < 0.5 ? 1 : 0
  if (run) { window.clearTimeout(run.timer); abRuns.delete(i) }
  const ms = st.morphMs
  if (ms <= 20) { st.setSourceMix(i, to); return }
  const from = l.sourceMix
  const t0 = performance.now()
  let last = from
  const me = { to, timer: 0 }
  const step = (): void => {
    const s = get()
    const cur = s.composition.layers[i]
    if (abRuns.get(i) !== me) return
    if (!cur || Math.abs(cur.sourceMix - last) > 1e-6) { abRuns.delete(i); return }
    const k = Math.min(1, (performance.now() - t0) / ms)
    s.setSourceMix(i, from + (to - from) * k * k * (3 - 2 * k))
    last = get().composition.layers[i]?.sourceMix ?? last
    if (k < 1) me.timer = window.setTimeout(step, 16)
    else abRuns.delete(i)
  }
  abRuns.set(i, me)
  me.timer = window.setTimeout(step, 0)
}

// Punch : the layer's opacity up (or down when it is full) and back, silently
// (a momentary flash is no edit : no undo step, the session stays clean). A
// fire during one restarts it from the same base.
const punches = new Map<number, { base: number; peak: number; t0: number; last: number; timer: number }>()
const PUNCH_UP = 50
const PUNCH_DOWN = 450
function punch(i: number, l: LayerState): void {
  const run = punches.get(i)
  if (run) { run.t0 = performance.now(); return }
  const base = l.opacity
  const me = { base, peak: base < 0.6 ? 1 : base * 0.2, t0: performance.now(), last: base, timer: 0 }
  const write = (v: number): void => runSilently(() => get().setOpacity(i, v))
  const step = (): void => {
    const cur = get().composition.layers[i]
    if (punches.get(i) !== me) return
    if (!cur || Math.abs(cur.opacity - me.last) > 1e-6) { punches.delete(i); return } // moved by something else
    const t = performance.now() - me.t0
    let v: number
    if (t < PUNCH_UP) v = me.base + (me.peak - me.base) * (t / PUNCH_UP)
    else if (t < PUNCH_UP + PUNCH_DOWN) { const k = (t - PUNCH_UP) / PUNCH_DOWN; v = me.peak + (me.base - me.peak) * (1 - (1 - k) * (1 - k)) }
    else v = me.base
    write(v)
    me.last = get().composition.layers[i]?.opacity ?? v
    if (t < PUNCH_UP + PUNCH_DOWN) me.timer = window.setTimeout(step, 16)
    else punches.delete(i)
  }
  punches.set(i, me)
  step()
}

function fireLayer(i: number, v: LayerVerb): void {
  const st = get()
  const l = st.composition.layers[i]
  if (!l) return
  if (v === 'vary') { st.varyLayer(i); return } // (it keeps its own pins)
  if (held(st, layerPins(i, v, l), `L${i + 1}${v === 'next' || v === 'prev' || v === 'rand' ? ` ${onAir(l)}` : ''}`)) return
  switch (v) {
    case 'mute': st.toggleMute(i); return
    case 'solo': st.toggleSolo(i); return
    case 'fx':
      if (st.pins.some((k) => k.startsWith(`fxunit:layer:${i}:`))) { say(`An effect on L${i + 1} is persistent : the action leaves its rack`); return }
      st.toggleRackChain({ kind: 'layer', layer: i })
      return
    case 'fb': st.toggleFeedback(i); return
    case 'freeze':
      if (l.speed > 0) { frozenAt.set(i, l.speed); st.setLayerSpeed(i, 0) }
      else { st.setLayerSpeed(i, frozenAt.get(i) ?? 1); frozenAt.delete(i) }
      return
    case 'next': case 'prev': case 'rand': stepSource(st, i, l, v); return
    case 'ab':
      if (!hasB(l)) { say(`L${i + 1} has no source B to cross to`); return }
      crossAB(st, i, l)
      return
    case 'blend': {
      const k = BLEND_MODES.indexOf(l.blend)
      st.setBlend(i, BLEND_MODES[(k + 1) % BLEND_MODES.length])
      return
    }
    case 'punch': punch(i, l); return
  }
}

// ── Triggers : every event input loaded (an effect's grab / clear, a source's reseed) ──

type RackKey = 'master' | 'background' | `${'layer' | 'sourceA' | 'sourceB'}:${number}`
function scopeOf(rack: string): FxScope | null {
  if (rack === 'master' || rack === 'background') return { kind: rack }
  const [k, n] = rack.split(':')
  const layer = Number(n)
  if ((k === 'layer' || k === 'sourceA' || k === 'sourceB') && Number.isInteger(layer) && layer >= 0) return { kind: k, layer }
  return null
}
function chainOf(st: St, s: FxScope): FxInstance[] {
  const c = st.composition
  if (s.kind === 'master') return c.master
  if (s.kind === 'background') return c.background?.fx ?? []
  const l = c.layers[s.layer]
  if (!l) return []
  return s.kind === 'layer' ? l.fx : s.kind === 'sourceA' ? l.sourceAFx : l.sourceBFx
}
const rackWords = (s: FxScope): string =>
  s.kind === 'master' ? 'Master' : s.kind === 'background' ? 'Background FX' : `L${s.layer + 1} ${s.kind === 'layer' ? 'FX' : s.kind === 'sourceA' ? 'A fx' : 'B fx'}`
const shaderName = (id: string): string => SHADER_BY_ID[id]?.name ?? id
const eventsOf = (shaderId: string | null | undefined): Array<{ name: string; label: string }> =>
  shaderId && SHADER_BY_ID[shaderId] ? inputsForShader(shaderId).filter((d) => d.type === 'event').map((d) => ({ name: d.name, label: d.label.replace(/\s*▸\s*$/, '') })) : []
const eventLabel = (shaderId: string, input: string): string => eventsOf(shaderId).find((e) => e.name === input)?.label ?? input

// A trigger is a pulse (on, then off 140 ms later, as its FIRE ▸ button) :
// silent, a pulse is no edit. A fire during one restarts its pulse.
const pulses = new Map<string, number>()
function pulse(key: string, set: (v: number) => void): void {
  const t = pulses.get(key)
  if (t != null) window.clearTimeout(t)
  runSilently(() => set(1))
  pulses.set(key, window.setTimeout(() => { pulses.delete(key); runSilently(() => set(0)) }, 140))
}

function fireFxEvent(rack: string, shaderId: string, input: string): void {
  const st = get()
  const scope = scopeOf(rack)
  if (!scope) return
  for (const u of chainOf(st, scope)) {
    if (u.shaderId !== shaderId) continue
    pulse(`${rack}:${u.id}:${input}`, (v) => get().setFxInput(scope, u.id, input, v))
  }
}
function slotPlays(st: St, i: number, slot: 'A' | 'B', shaderId: string): boolean {
  const l = st.composition.layers[i]
  const s: SourceSlot | null | undefined = slot === 'A' ? l?.sourceA : l?.sourceB
  return !!s && s.shaderId === shaderId
}

// ── Chains, scenes, Worlds, Generate ────────────────────────────────────────

let lastChain = -1
function currentChain(st: St): number {
  const ids = st.composition.master.filter((f) => !f.locked).map((f) => f.shaderId).join('|')
  const same = (k: number): boolean => k >= 0 && MASTER_PRESETS[k]?.fx.map((f) => f.shaderId).join('|') === ids
  if (same(lastChain)) return lastChain
  return MASTER_PRESETS.findIndex((_, k) => same(k))
}
function applyChain(k: number): void {
  const p = MASTER_PRESETS[k]
  if (!p) return
  get().applyMasterPreset(p.fx, p.vibe, p.context) // (through the pins' gate)
  lastChain = k
}

// Generate replaces the session : as a learned MIDI pad's New, it never stops
// the show to ask, it keeps a recovery copy of unsaved work instead (and undo
// brings the session back).
let lastTheme: string | null = null
let generating = false
async function generate(id: string): Promise<void> {
  const theme = THEME_BY_ID[id]
  if (!theme || generating) return
  generating = true
  try {
    if (!(await leaveSession(`generating “${theme.name}”`, false))) return
    get().generateTheme(id)
    markClean()
    lastTheme = id
    showToast(`Generated · ${theme.name}`)
  } finally {
    generating = false
  }
}
function themeNow(st: St): string | null {
  if (lastTheme && THEME_BY_ID[lastTheme]?.name === st.name) return lastTheme
  return THEMES.find((t) => t.name === st.name)?.id ?? null
}

// ── Meta, modulators, Feel ──────────────────────────────────────────────────

const META_VERBS = ['up', 'down', 'rand', 'flip'] as const
type MetaVerb = (typeof META_VERBS)[number]
const META_STEP = 0.1
function fireMeta(k: number, v: MetaVerb): void {
  const st = get()
  const knob = st.composition.metaKnobs[k]
  if (!knob) return
  if (isPinnedTarget({ kind: 'meta', knob: k }, st.pins)) { say(`Meta ${k + 1} is persistent : the action leaves it (unpin it first)`); return }
  const cur = knobDisplayValue(k)
  const to = v === 'up' ? cur + META_STEP : v === 'down' ? cur - META_STEP : v === 'rand' ? Math.random() : cur < 0.5 ? 1 : 0
  setKnobTarget(k, Math.max(0, Math.min(1, to)), knob.smoothMs)
}

const FEEL: Array<{ key: string; label: string; neutral: number; set: (st: St, v: number) => void; get: (st: St) => number }> = [
  { key: 'density', label: 'density', neutral: 0.5, set: (s, v) => s.setDensity(v), get: (s) => s.density },
  { key: 'gestureTexture', label: 'gesture↔texture', neutral: 0.5, set: (s, v) => s.setGestureTexture(v), get: (s) => s.gestureTexture },
  { key: 'coalesce', label: 'coalesce', neutral: 0.5, set: (s, v) => s.setCoalesce(v), get: (s) => s.coalesce },
  { key: 'flow', label: 'flow↔interruption', neutral: 0.5, set: (s, v) => s.setFlow(v), get: (s) => s.flow },
  { key: 'tonicity', label: 'tonicity', neutral: 0, set: (s, v) => s.setTonicity(v), get: (s) => s.tonicity },
  { key: 'shutter', label: 'shutter', neutral: 0, set: (s, v) => s.setShutter(v), get: (s) => s.shutter },
  { key: 'drift', label: 'drift', neutral: 0, set: (s, v) => s.setDrift(v), get: (s) => s.drift },
  { key: 'superFlicker', label: 'superimposition', neutral: 0, set: (s, v) => s.setSuperFlicker(v), get: (s) => s.superFlicker }
]
const FEEL_STEP = 0.1

// ── Tempo, key, the Audio Layer, the output ─────────────────────────────────

function moveKey(semis: number): void {
  const st = get()
  const c = st.sonify
  sonifyEngine.glideNext(st.soniKeySeq.glide) // (the key sequencer's glide)
  st.setSonify({ ...c, root: mod12(c.root + semis) })
  sonifyEngine.glideNext(0)
}

let shooting = false
async function screenshot(): Promise<void> {
  const canvas = outputCanvas()
  if (!canvas || shooting) return
  shooting = true
  try {
    const path = await captureScreenshot(canvas)
    if (path) showToast(`Screenshot saved · ${path}`)
  } finally {
    shooting = false
  }
}

const SPIN_DEG = 20 // degrees a second : a slow turn

// ── The executor ────────────────────────────────────────────────────────────

/** Fire an `act:` id. Unknown or gone : nothing. */
export function fireAction(id: string): void {
  const p = id.split(':')
  if (p[0] !== 'act') return
  const st = get()
  switch (p[1]) {
    case 'layer': {
      const i = Number(p[2])
      if (Number.isInteger(i) && (LAYER_VERBS as readonly string[]).includes(p[3])) fireLayer(i, p[3] as LayerVerb)
      return
    }
    case 'fx': {
      // rack is one word (master / background) or two (layer:1)
      const two = p[2] !== 'master' && p[2] !== 'background'
      const rack = two ? `${p[2]}:${p[3]}` : p[2]
      const rest = p.slice(two ? 4 : 3)
      if (rest.length === 2) fireFxEvent(rack, rest[0], rest[1])
      return
    }
    case 'src': {
      const i = Number(p[2])
      const slot = p[3] === 'B' ? 'B' : 'A'
      const [shaderId, input] = [p[4], p[5]]
      if (Number.isInteger(i) && shaderId && input && slotPlays(st, i, slot, shaderId))
        pulse(`src:${i}:${slot}:${input}`, (v) => get().setSourceInput(i, slot, input, v))
      return
    }
    case 'bgsrc': {
      const [shaderId, input] = [p[2], p[3]]
      if (shaderId && input && st.composition.background?.source?.shaderId === shaderId)
        pulse(`bgsrc:${input}`, (v) => get().setBackgroundInput(input, v))
      return
    }
    case 'chain': {
      const k = currentChain(st)
      const n = MASTER_PRESETS.length
      if (!n) return
      if (p[2] === 'next') applyChain(k < 0 ? 0 : (k + 1) % n)
      else if (p[2] === 'prev') applyChain(k < 0 ? n - 1 : (k - 1 + n) % n)
      else if (p[2] === 'rand') applyChain(pickOne(MASTER_PRESETS.map((_, j) => j).filter((j) => j !== k)))
      return
    }
    case 'finishing': st.toggleFinishing(); return
    case 'scene': {
      if (p[2] !== 'rand' || !st.scenes.length) return
      const others = st.scenes.filter((s) => s.id !== st.activeSceneId)
      st.recallScene(pickOne(others.length ? others : st.scenes).id)
      return
    }
    case 'world': {
      const ws = st.worlds
      if (!ws.length) return
      const k = ws.findIndex((w) => w.id === st.world)
      if (p[2] === 'next') st.setWorld(ws[(k + 1) % ws.length].id)
      else if (p[2] === 'prev') st.setWorld(ws[(k - 1 + ws.length) % ws.length].id)
      else if (p[2] === 'rand') { const o = ws.filter((w) => w.id !== st.world); st.setWorld(pickOne(o.length ? o : ws).id) }
      else if (p[2] === 'id') { const wid = p.slice(3).join(':'); if (ws.some((w) => w.id === wid)) st.setWorld(wid) }
      return
    }
    case 'gen': {
      if (p[2] === 'rand') void generate(pickOne(THEMES).id)
      else if (p[2] === 'next') {
        const cur = themeNow(st)
        const fam = cur ? THEME_FAMILIES.find((f) => f.themes.some((t) => t.id === cur)) : null
        if (!fam) { void generate(pickOne(THEMES).id); return }
        const k = fam.themes.findIndex((t) => t.id === cur)
        void generate(fam.themes[(k + 1) % fam.themes.length].id)
      } else if (p[2] === 'family') {
        const fam = THEME_FAMILIES.find((f) => f.family === p.slice(3).join(':'))
        if (fam) void generate(pickOne(fam.themes).id)
      }
      return
    }
    case 'meta': {
      const k = Number(p[2])
      if (Number.isInteger(k) && (META_VERBS as readonly string[]).includes(p[3])) fireMeta(k, p[3] as MetaVerb)
      return
    }
    case 'mod': {
      const n = Number(p[2])
      const m = st.composition.modulators[n]
      if (!m) return
      if (p[3] === 'trig') modEngine.retrigger(n) // (no setting changes : plays even on a persistent card)
      else if (p[3] === 'onoff' && !held(st, [modPin(n)], `M${n + 1}`)) st.updateModulator(n, { enabled: !m.enabled })
      return
    }
    case 'feel': {
      if (p[2] === 'reset') { for (const f of FEEL) f.set(st, FEEL_NEUTRAL[f.key as keyof typeof FEEL_NEUTRAL] ?? f.neutral); return }
      const f = FEEL.find((x) => x.key === p[2])
      if (!f) return
      const d = p[3] === 'up' ? FEEL_STEP : p[3] === 'down' ? -FEEL_STEP : 0
      if (d) f.set(st, Math.max(0, Math.min(1, Math.round((f.get(st) + d) * 100) / 100)))
      return
    }
    case 'bpm': {
      const bpm = st.composition.bpm || 120
      if (p[2] === 'double') st.setBpm(bpm * 2)
      else if (p[2] === 'half') st.setBpm(bpm / 2)
      return
    }
    case 'link': {
      const play = linkPlay()
      if (!play) { say('Ableton Link start / stop sync is off (Connect tab : Ableton Link)'); return }
      setLinkPlaying(!play.playing)
      return
    }
    case 'key': {
      if (p[2] === 'next') keySeqNext()
      else if (p[2] === 'fifthup') moveKey(7)
      else if (p[2] === 'fifthdown') moveKey(-7)
      else if (p[2] === 'up') moveKey(1)
      else if (p[2] === 'down') moveKey(-1)
      return
    }
    case 'au': {
      const al = st.audioLayer
      if (p[2] === 'play') {
        const files = (['A', 'B'] as const).filter((s) => al[s]?.kind === 'file')
        if (!files.length) { say('The Audio Layer has no sound file to play'); return }
        st.playAudioLayer(!files.some((s) => al[s]?.videoPlaying !== false))
      } else if (p[2] === 'A' || p[2] === 'B') {
        const s = al[p[2]]
        if (!s) return
        // a file plays or stops; a live input or an NDI source (never opened
        // here) is muted or let through
        if (s.kind === 'file') st.patchAudioLayerSlot(p[2], { videoPlaying: s.videoPlaying === false })
        else st.patchAudioLayerSlot(p[2], { mute: !s.mute })
      } else if (p[2] === 'mute') st.patchAudioLayer({ mute: !al.mute })
      return
    }
    case 'out': {
      const x = st.outXform
      switch (p[2]) {
        case 'shot': void screenshot(); return
        case 'turn': st.setOutXform({ rotate: ((((x.rotate + 90 + 180) % 360) + 360) % 360) - 180 }); return
        case 'spin': st.setOutXform({ spin: x.spin !== 0 ? 0 : SPIN_DEG }); return
        case 'flipx': st.setOutXform({ flipX: !x.flipX }); return
        case 'flipy': st.setOutXform({ flipY: !x.flipY }); return
        case 'reset': st.resetOutXform(); return
      }
      return
    }
  }
}

// ── Names ───────────────────────────────────────────────────────────────────

const metaName = (st: St, k: number): string => {
  const n = st.composition.metaKnobs[k]?.name
  // (a knob still on its default name says nothing more than its number)
  return `META ${k + 1}${n && n !== `Knob ${k + 1}` ? ` (${n})` : ''}`
}
const modName = (st: St, n: number): string => {
  const m = st.composition.modulators[n]
  return `MOD ${n + 1}${m ? ` (${m.type}${m.enabled ? '' : ', off'})` : ''}`
}

/** Name, verb, OSC token and group of an `act:` id, from the live state (null :
 *  not an id this version knows). `gone` : its target is not there now. */
export function actionInfo(id: string, st: St = get()): ActionInfo | null {
  const p = id.split(':')
  if (p[0] !== 'act') return null
  switch (p[1]) {
    case 'layer': {
      const i = Number(p[2])
      const w = LAYER_WORDS[p[3] as LayerVerb]
      if (!Number.isInteger(i) || i < 0 || !w) return null
      return { label: `LAYER ${i + 1} ${w.label}`, verb: w.verb(i + 1), token: `L${i + 1}${w.token}`, group: `Layer ${i + 1}`, title: w.title, gone: !st.composition.layers[i] }
    }
    case 'fx': {
      const two = p[2] !== 'master' && p[2] !== 'background'
      const rack = two ? `${p[2]}:${p[3]}` : p[2]
      const [shaderId, input] = p.slice(two ? 4 : 3)
      const scope = scopeOf(rack)
      if (!scope || !shaderId || !input) return null
      const here = chainOf(st, scope).some((u) => u.shaderId === shaderId)
      const what = `${rackWords(scope)} · ${shaderName(shaderId)} · ${eventLabel(shaderId, input)}`
      return {
        label: here ? what : `${what} (gone)`, verb: `fires ${what}`, token: camel(`${shaderName(shaderId)} ${eventLabel(shaderId, input)}`),
        group: 'Triggers (what is loaded)', title: `Fires the trigger, as its FIRE ▸ button (every ${shaderName(shaderId)} in that rack)`, gone: !here
      }
    }
    case 'src': {
      const i = Number(p[2])
      const slot = p[3] === 'B' ? 'B' : 'A'
      const [shaderId, input] = [p[4], p[5]]
      if (!Number.isInteger(i) || !shaderId || !input) return null
      const here = slotPlays(st, i, slot, shaderId)
      const what = `L${i + 1} ${slot} · ${shaderName(shaderId)} · ${eventLabel(shaderId, input)}`
      return { label: here ? what : `${what} (gone)`, verb: `fires ${what}`, token: camel(`${shaderName(shaderId)} ${eventLabel(shaderId, input)}`), group: 'Triggers (what is loaded)', title: 'Fires the source’s trigger, as its FIRE ▸ button', gone: !here }
    }
    case 'bgsrc': {
      const [shaderId, input] = [p[2], p[3]]
      if (!shaderId || !input) return null
      const here = st.composition.background?.source?.shaderId === shaderId
      const what = `Background · ${shaderName(shaderId)} · ${eventLabel(shaderId, input)}`
      return { label: here ? what : `${what} (gone)`, verb: `fires ${what}`, token: camel(`Bg ${shaderName(shaderId)} ${eventLabel(shaderId, input)}`), group: 'Triggers (what is loaded)', title: 'Fires the Background source’s trigger', gone: !here }
    }
    case 'chain': {
      const w = { next: ['next', 'steps the master chain', 'ChainNext'], prev: ['previous', 'steps the master chain back', 'ChainBack'], rand: ['random', 'deals a master chain', 'ChainRnd'] }[p[2] as 'next' | 'prev' | 'rand']
      if (!w) return null
      return { label: `CHAIN ${w[0]}`, verb: w[1], token: w[2], group: 'Effects', title: 'A master chain preset, in the chain menu’s order (your Vibe and what you pinned stay)' }
    }
    case 'finishing':
      return { label: 'FINISHING on/off', verb: 'switches the finishing', token: 'Finish', group: 'Effects', title: 'The finishing stages (Vibe, Context, Finalizer) on or off, as the Finishing switch' }
    case 'scene':
      return p[2] === 'rand' ? { label: 'SCENE random', verb: 'recalls a random scene', token: 'ScnRnd', group: 'Scenes', title: 'Recalls any other scene of the bank, over the Morph time', gone: !st.scenes.length } : null
    case 'world': {
      if (p[2] === 'id') {
        const wid = p.slice(3).join(':')
        const w = st.worlds.find((x) => x.id === wid)
        const name = w?.name ?? wid
        return { label: `WORLD · ${name}${w ? '' : ' (gone)'}`, verb: `turns to the ${name} World`, token: camel(`World ${name}`), group: 'Worlds', title: 'Applies this World over the Morph time', gone: !w }
      }
      const w = { next: ['next', 'steps the World', 'WorldNext'], prev: ['previous', 'steps the World back', 'WorldBack'], rand: ['random', 'turns to a random World', 'WorldRnd'] }[p[2] as 'next' | 'prev' | 'rand']
      return w ? { label: `WORLD ${w[0]}`, verb: w[1], token: w[2], group: 'Worlds', title: 'Applies a World over the Morph time, in the World menu’s order' } : null
    }
    case 'gen': {
      const t = 'Replaces the session as the Generate button does, without asking : unsaved work is kept as a recovery copy, and undo brings it back'
      if (p[2] === 'rand') return { label: 'GENERATE random theme', verb: 'generates a theme', token: 'Gen', group: 'Generate', title: t }
      if (p[2] === 'next') return { label: 'GENERATE next in its family', verb: 'generates the next theme', token: 'GenNext', group: 'Generate', title: `The next theme in the current theme’s family (a random one when the session is not a theme). ${t}` }
      if (p[2] === 'family') {
        const fam = p.slice(3).join(':')
        const here = THEME_FAMILIES.some((f) => f.family === fam)
        return { label: `GENERATE · ${fam}${here ? '' : ' (gone)'}`, verb: `generates ${fam}`, token: camel(`Gen ${fam}`), group: 'Generate', title: `A random theme of this family. ${t}`, gone: !here }
      }
      return null
    }
    case 'meta': {
      const k = Number(p[2])
      const v = p[3] as MetaVerb
      if (!Number.isInteger(k) || k < 0 || !(META_VERBS as readonly string[]).includes(v)) return null
      const words: Record<MetaVerb, [string, string, string]> = {
        up: ['up', `raises meta ${k + 1}`, 'Up'], down: ['down', `lowers meta ${k + 1}`, 'Down'],
        rand: ['random', `throws meta ${k + 1}`, 'Rnd'], flip: ['flip 0↔1', `flips meta ${k + 1}`, 'Flip']
      }
      return { label: `${metaName(st, k)} ${words[v][0]}`, verb: words[v][1], token: `Meta${k + 1}${words[v][2]}`, group: 'Meta', title: 'Moves the knob over its own smoothing time : up / down a tenth, to a random place, or flips it to the far end', gone: !st.composition.metaKnobs[k] }
    }
    case 'mod': {
      const n = Number(p[2])
      if (!Number.isInteger(n) || n < 0) return null
      if (p[3] === 'trig') return { label: `${modName(st, n)} retrigger`, verb: `retriggers mod ${n + 1}`, token: `Mod${n + 1}Trig`, group: 'Modulators', title: 'Its ⟳ : back to the start of its cycle (an LFO, a rhythm), or from zero (a ramp, an envelope). A modulator on its own clock or following a signal does not move', gone: !st.composition.modulators[n] }
      if (p[3] === 'onoff') return { label: `${modName(st, n)} on/off`, verb: `switches mod ${n + 1}`, token: `Mod${n + 1}OnOff`, group: 'Modulators', title: 'Turns the modulator card on or off', gone: !st.composition.modulators[n] }
      return null
    }
    case 'feel': {
      if (p[2] === 'reset') return { label: 'FEEL reset', verb: 'resets the Feel', token: 'FeelReset', group: 'Feel', title: 'All eight Feel macros back to neutral' }
      const f = FEEL.find((x) => x.key === p[2])
      if (!f || (p[3] !== 'up' && p[3] !== 'down')) return null
      return { label: `FEEL ${f.label} ${p[3]}`, verb: `${p[3] === 'up' ? 'raises' : 'lowers'} ${f.label}`, token: camel(`${f.key} ${p[3]}`), group: 'Feel', title: `A tenth ${p[3]} on the ${f.label} dial` }
    }
    case 'bpm':
      if (p[2] === 'double') return { label: 'BPM ×2', verb: 'doubles the tempo', token: 'BpmX2', group: 'Tempo and sound', title: 'Doubles the tempo (up to 800); with Ableton Link, every linked app follows' }
      if (p[2] === 'half') return { label: 'BPM ÷2', verb: 'halves the tempo', token: 'BpmHalf', group: 'Tempo and sound', title: 'Halves the tempo (down to 20)' }
      return null
    case 'link':
      return p[2] === 'play' ? { label: 'LINK play / stop', verb: 'plays or stops Link', token: 'LinkPlay', group: 'Tempo and sound', title: 'Plays or stops every linked app (needs Ableton Link enabled with start / stop sync)' } : null
    case 'key': {
      const w = {
        next: ['change now', 'changes the key', 'KeyNext', 'A key change now, the key sequencer’s way (its mode, pool, glide), running or not'],
        fifthup: ['up a fifth', 'moves the key up a fifth', 'KeyFifthUp', 'Sonify’s root a fifth up (a step on the circle of fifths), over the key glide'],
        fifthdown: ['down a fifth', 'moves the key down a fifth', 'KeyFifthDown', 'Sonify’s root a fifth down, over the key glide'],
        up: ['up a semitone', 'moves the key up', 'KeyUp', 'Sonify’s root a semitone up, over the key glide'],
        down: ['down a semitone', 'moves the key down', 'KeyDown', 'Sonify’s root a semitone down, over the key glide']
      }[p[2] as 'next' | 'fifthup' | 'fifthdown' | 'up' | 'down']
      return w ? { label: `KEY ${w[0]}`, verb: w[1], token: w[2], group: 'Tempo and sound', title: w[3] } : null
    }
    case 'au': {
      const w = {
        play: ['AU play / stop', 'plays or stops the Audio Layer', 'AuPlay', 'Plays or stops the Audio Layer’s sound files, together'],
        A: ['AU A play / stop', 'plays or stops Audio Layer A', 'AuA', 'Slot A : a file plays or stops; a live input or an NDI source is muted or let through (never opened here)'],
        B: ['AU B play / stop', 'plays or stops Audio Layer B', 'AuB', 'Slot B : a file plays or stops; a live input or an NDI source is muted or let through (never opened here)'],
        mute: ['AU mute', 'mutes the Audio Layer', 'AuMute', 'The Audio Layer muted or let through']
      }[p[2] as 'play' | 'A' | 'B' | 'mute']
      return w ? { label: w[0], verb: w[1], token: w[2], group: 'Tempo and sound', title: w[3] } : null
    }
    case 'out': {
      const w = {
        shot: ['OUTPUT screenshot', 'takes a screenshot', 'Shot', 'A PNG of the picture into the Recorded folder (the record location), no dialog'],
        turn: ['OUTPUT turn 90°', 'turns the output', 'OutTurn', 'The output transform’s rotate a quarter turn on'],
        spin: ['OUTPUT spin on/off', 'spins the output', 'OutSpin', `The output transform’s spin : a slow turn (${SPIN_DEG}° a second), or stopped`],
        flipx: ['OUTPUT flip X', 'flips the output', 'OutFlipX', 'The output flipped left to right, or back'],
        flipy: ['OUTPUT flip Y', 'flips the output upside down', 'OutFlipY', 'The output flipped top to bottom, or back'],
        reset: ['OUTPUT reset', 'resets the output', 'OutReset', 'The output transform back to the frame as it is']
      }[p[2] as 'shot' | 'turn' | 'spin' | 'flipx' | 'flipy' | 'reset']
      return w ? { label: w[0], verb: w[1], token: w[2], group: 'Output', title: `${w[3]}. Under the fulldome the output transform waits (the dome has its own)` } : null
    }
  }
  return null
}

/** The name of an `act:` id (its id when unknown). */
export function actionLabel(id: string): string {
  return actionInfo(id)?.label ?? id
}

/** Every `act:` id worth offering now, in the picker's order : the layers, the
 *  triggers of what is loaded, the effects, the scenes, the Worlds, Generate,
 *  the Meta knobs, the modulators, the Feel, tempo and sound, the output. */
export function actionIds(st: St = get()): string[] {
  const out: string[] = []
  st.composition.layers.forEach((_, i) => { for (const v of LAYER_VERBS) out.push(`act:layer:${i}:${v}`) })
  // triggers : every event input of every effect and source loaded now
  const seen = new Set<string>()
  const add = (id: string): void => { if (!seen.has(id)) { seen.add(id); out.push(id) } }
  const c = st.composition
  const racks: RackKey[] = ['master', 'background']
  c.layers.forEach((l, i) => {
    for (const slot of ['A', 'B'] as const) {
      const s = slot === 'A' ? l.sourceA : l.sourceB
      if (s?.shaderId) for (const e of eventsOf(s.shaderId)) add(`act:src:${i}:${slot}:${s.shaderId}:${e.name}`)
    }
    racks.push(`sourceA:${i}`, `sourceB:${i}`, `layer:${i}`)
  })
  const bg = c.background?.source?.shaderId
  if (bg) for (const e of eventsOf(bg)) add(`act:bgsrc:${bg}:${e.name}`)
  for (const rack of racks) {
    const scope = scopeOf(rack)
    if (!scope) continue
    for (const u of chainOf(st, scope)) for (const e of eventsOf(u.shaderId)) add(`act:fx:${rack}:${u.shaderId}:${e.name}`)
  }
  out.push('act:chain:next', 'act:chain:prev', 'act:chain:rand', 'act:finishing', 'act:scene:rand')
  out.push('act:world:next', 'act:world:prev', 'act:world:rand', ...st.worlds.map((w) => `act:world:id:${w.id}`))
  out.push('act:gen:rand', 'act:gen:next', ...THEME_FAMILIES.map((f) => `act:gen:family:${f.family}`))
  st.composition.metaKnobs.forEach((_, k) => { for (const v of META_VERBS) out.push(`act:meta:${k}:${v}`) })
  st.composition.modulators.forEach((_, n) => out.push(`act:mod:${n}:trig`, `act:mod:${n}:onoff`))
  for (const f of FEEL) out.push(`act:feel:${f.key}:up`, `act:feel:${f.key}:down`)
  out.push('act:feel:reset', 'act:bpm:double', 'act:bpm:half', 'act:link:play')
  out.push('act:key:next', 'act:key:fifthup', 'act:key:fifthdown', 'act:key:up', 'act:key:down')
  out.push('act:au:play', 'act:au:A', 'act:au:B', 'act:au:mute')
  out.push('act:out:shot', 'act:out:turn', 'act:out:spin', 'act:out:flipx', 'act:out:flipy', 'act:out:reset')
  return out
}
