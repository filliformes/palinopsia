// The Lights rig's persistence (this computer) and the pure helpers the store's
// actions use. The rig was the old Output page's zone grid before the Lights
// page : that one setting comes over once, as a matrix on its own output.

import {
  firstUniverse,
  fixtureChannels,
  fixtureSpans,
  profilePatch,
  sanitizeLightsSession,
  RIG_DEFAULT,
  sanitizeFixture,
  sanitizeOutput,
  sanitizeRig,
  TUNE_DEFAULT,
  type LightFixture,
  type LightKind,
  type LightOutput,
  type LightOutputKind,
  type LightProfile,
  type LightRig
} from '@shared/lights'
import { GROUP_PREFIX, GROUP_TUNE_DEFAULT, GROUP_TUNE_FIELDS, LOOK_DEFAULT, type GroupTune, type LightModField, type LightsSession } from '@shared/lights'

/** A light slider's value now : a fixture's look or tuning, or a master. */
export function lightBaseValue(rig: LightRig, L: LightsSession, fixture: string, field: LightModField): number | null {
  if (field === 'masterBrightness') return L.master.brightness
  if (field === 'masterSpeed') return L.master.speed
  if (field === 'masterGain') return L.master.gain
  if (field === 'masterSaturation') return L.master.saturation
  if (field === 'masterContrast') return L.master.contrast
  if (fixture.startsWith(GROUP_PREFIX)) {
    const gid = fixture.slice(GROUP_PREFIX.length)
    if (!rig.groups.some((g) => g.id === gid)) return null
    if (field === 'level') return L.groups?.[gid] ?? 1
    const k = GROUP_TUNE_FIELDS[field]
    return k ? (L.groupTunes?.[gid] ?? GROUP_TUNE_DEFAULT)[k] : null
  }
  const f = rig.fixtures.find((x) => x.id === fixture)
  if (!f) return null
  const look = L.looks[fixture] ?? LOOK_DEFAULT
  const tune = (rig.tuneScope === 'look' ? L.tunes?.[fixture] : null) ?? f.tune
  switch (field) {
    case 'level': return look.level
    case 'hue': return look.hue
    case 'sat': return look.sat
    case 'val': return look.val
    case 'gradOffset': return look.gradient.offset
    case 'gradAngle': return look.gradient.angle
    case 'gradScale': return look.gradient.scale
    case 'rate': return look.rate
    case 'depth': return look.depth
    case 'width': return look.width
    case 'angle': return look.angle
    case 'fan': return look.fan
    case 'tuneBrightness': return tune.brightness
    case 'tuneSaturation': return tune.saturation
    case 'tuneHue': return tune.hue
    case 'tuneWarmth': return tune.warmth
    case 'tuneContrast': return tune.contrast
    case 'tuneGamma': return tune.gamma
    case 'tuneBlack': return tune.black
    case 'tuneSmooth': return tune.smooth
    case 'gradSpeed': return look.gradient.speed
    case 'area': return f.size
  }
  return null
}

/** A light slider set to `v` (a Macro knob's value committed) : into the look,
 *  its gradient, the tuning or the masters, through the store's own actions. */
export function commitLightValue(
  st: {
    setLightLook: (id: string, p: Partial<import('@shared/lights').LightLook>) => void
    setLightTune: (id: string, p: Partial<import('@shared/lights').LightTune>) => void
    setLightsMaster: (p: Partial<import('@shared/lights').LightsMaster>) => void
    setLightGroupLevel: (id: string, v: number) => void
    setLightGroupTune: (id: string, p: Partial<GroupTune>) => void
    updateLightFixture: (id: string, p: Partial<LightFixture>) => void
    lightsSession: LightsSession
  },
  fixture: string,
  field: LightModField,
  v: number
): void {
  if (field === 'masterBrightness') return st.setLightsMaster({ brightness: v })
  if (field === 'masterSpeed') return st.setLightsMaster({ speed: v })
  if (field === 'masterGain') return st.setLightsMaster({ gain: v })
  if (field === 'masterSaturation') return st.setLightsMaster({ saturation: v })
  if (field === 'masterContrast') return st.setLightsMaster({ contrast: v })
  if (fixture.startsWith(GROUP_PREFIX)) {
    const gid = fixture.slice(GROUP_PREFIX.length)
    const k = GROUP_TUNE_FIELDS[field]
    if (field === 'level') st.setLightGroupLevel(gid, v)
    else if (k) st.setLightGroupTune(gid, { [k]: v })
    return
  }
  if (field === 'tuneContrast') return st.setLightTune(fixture, { contrast: v })
  if (field === 'tuneGamma') return st.setLightTune(fixture, { gamma: v })
  if (field === 'tuneBlack') return st.setLightTune(fixture, { black: v })
  if (field === 'tuneSmooth') return st.setLightTune(fixture, { smooth: v })
  if (field === 'area') return st.updateLightFixture(fixture, { size: v })
  if (field === 'tuneBrightness') return st.setLightTune(fixture, { brightness: v })
  if (field === 'tuneSaturation') return st.setLightTune(fixture, { saturation: v })
  if (field === 'tuneHue') return st.setLightTune(fixture, { hue: v })
  if (field === 'tuneWarmth') return st.setLightTune(fixture, { warmth: v })
  if (field === 'gradOffset' || field === 'gradAngle' || field === 'gradScale' || field === 'gradSpeed') {
    const g = (st.lightsSession.looks[fixture] ?? LOOK_DEFAULT).gradient
    const k = field === 'gradOffset' ? 'offset' : field === 'gradAngle' ? 'angle' : field === 'gradSpeed' ? 'speed' : 'scale'
    return st.setLightLook(fixture, { gradient: { ...g, [k]: v } })
  }
  st.setLightLook(fixture, { [field]: v })
}

const RIG_KEY = 'opsia.lightRig'
const OLD_KEY = 'opsia.lights'

// (written at most four times a second : a drag on the map or a knob on a light's
// tuning commits at pointer or MIDI rate, and the whole rig is a big string)
let rigDue: LightRig | null = null
let rigTimer: ReturnType<typeof setTimeout> | null = null
function writeRig(): void {
  if (rigTimer !== null) { clearTimeout(rigTimer); rigTimer = null }
  const r = rigDue
  rigDue = null
  if (r) { try { localStorage.setItem(RIG_KEY, JSON.stringify(r)) } catch { /* quota : the rig lives on for this run */ } }
}
if (typeof window !== 'undefined') window.addEventListener('beforeunload', writeRig)

export function persistRig(rig: LightRig): LightRig {
  rigDue = rig
  if (rigTimer === null) rigTimer = setTimeout(writeRig, 250)
  return rig
}

/** The rig of this computer; the first time, the old light output's grid made into
 *  a matrix fixture (its host, universe, channel and order kept). */
export function loadRig(): LightRig {
  try {
    const raw = localStorage.getItem(RIG_KEY)
    if (raw) return sanitizeRig(JSON.parse(raw))
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || 'null') as Record<string, unknown> | null
    if (old && typeof old === 'object' && (old.host || old.enabled)) {
      const out = sanitizeOutput({ id: 'out1', kind: old.protocol === 'wled' ? 'wled' : 'artnet', host: old.host, enabled: true })
      const order = typeof old.order === 'string' ? old.order.toUpperCase() : 'RGB'
      const fx = sanitizeFixture({
        id: 'fx1', name: 'Zone grid', kind: 'matrix', x0: 0, y0: 0, x1: 1, y1: 1, size: 0.08,
        cols: old.cols, rows: old.rows, serpentine: old.serpentine, layout: order, out: out.id,
        universe: old.universe, address: old.startChannel,
        tune: { ...TUNE_DEFAULT, brightness: typeof old.brightness === 'number' ? old.brightness : 1, gamma: typeof old.gamma === 'number' ? old.gamma : 2.2, smooth: 0 }
      })
      return persistRig(sanitizeRig({ ...RIG_DEFAULT, fixtures: [fx], outputs: [out], on: !!old.enabled, fps: old.fps }))
    }
  } catch { /* a broken entry : start empty */ }
  return { ...RIG_DEFAULT, fixtures: [], outputs: [] }
}

const uid = (p: string): string => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 46656).toString(36)}`
/** An id no light, output or group of the rig has (several made in one millisecond stay apart). */
function freshId(rig: LightRig, p: string): string {
  let id = uid(p)
  while (rig.fixtures.some((f) => f.id === id) || rig.outputs.some((o) => o.id === id)) id = uid(p)
  return id
}

/** Where the next light of `channels` channels goes on an output : right after the
 *  last channel in use there (the real one : a long pixel bar's spill into the next
 *  universes counts), on the next universe when it would not fit in this one. An
 *  Enttec has one universe : past its end, the address stays at 512 (the page says
 *  it does not fit). */
export function nextSlot(rig: LightRig, out: string, channels: number): { universe: number; address: number } {
  const o = rig.outputs.find((x) => x.id === out)
  const enttec = !o || o.kind === 'enttec'
  let uni = firstUniverse(o?.kind ?? 'enttec', 0), end = 0, any = false
  for (const f of rig.fixtures) {
    if (f.out !== out) continue
    const sp = fixtureSpans(f, enttec, o?.kind === 'sacn', o?.kind === 'wled')
    const last = sp[sp.length - 1]
    if (!last) continue
    if (!any || last.universe > uni || (last.universe === uni && last.to > end)) { uni = last.universe; end = last.to }
    any = true
  }
  if (enttec) return { universe: 0, address: Math.min(512, end + 1) }
  if (end + channels > 512 && channels <= 512) return { universe: uni + 1, address: 1 }
  if (end >= 512) return { universe: uni + 1, address: 1 }
  return { universe: uni, address: end + 1 }
}
/** (kept for callers that only want the address on an Enttec) */
export function nextAddress(rig: LightRig, out: string, _universe: number): number {
  return nextSlot(rig, out, 1).address
}
/** A light put on its output's next free slot. */
function slotted(rig: LightRig, f: LightFixture): LightFixture {
  const sl = nextSlot(rig, f.out, fixtureChannels(f, rig.outputs.find((o) => o.id === f.out)?.kind === 'wled'))
  return { ...f, universe: sl.universe, address: sl.address }
}

export function newFixture(rig: LightRig, kind: LightKind): LightFixture {
  const same = rig.fixtures.filter((f) => f.kind === kind).length
  const out = rig.outputs[0]?.id ?? ''
  const k = rig.fixtures.length
  const y = 0.12 + ((k * 0.11) % 0.76)
  const base =
    kind === 'spot'
      ? { x0: 0.2 + ((k * 0.17) % 0.6), y0: y, x1: 0, y1: 0, size: 0.05, pixels: 1, layout: 'DRGB' }
      : kind === 'matrix'
        ? { x0: 0.3, y0: 0.3, x1: 0.7, y1: 0.7, size: 0.04, cols: 8, rows: 8, layout: 'RGB' }
        : kind === 'ring'
          ? { x0: 0.5, y0: 0.5, x1: 0.62, y1: 0.5, size: 0.025, pixels: 24, layout: 'RGB' }
          : { x0: 0.12, y0: y, x1: 0.88, y1: y, size: 0.025, pixels: 60, layout: 'RGB' }
  const f = sanitizeFixture({
    id: freshId(rig, 'fx'),
    name: `${kind === 'spot' ? 'Spot' : kind === 'matrix' ? 'Matrix' : kind === 'ring' ? 'Ring' : 'Bar'} ${same + 1}`,
    kind,
    ...base,
    out,
    universe: 0
  })
  return slotted(rig, f)
}

export function newOutput(rig: LightRig, kind: LightOutputKind): LightOutput {
  const enttecs = rig.outputs.filter((o) => o.kind === 'enttec').length
  // (the lowest Pro not taken : after one is removed, the count is someone's index)
  let index = 0
  if (kind === 'enttec') while (rig.outputs.some((o) => o.kind === 'enttec' && o.index === index)) index++
  void enttecs
  return sanitizeOutput({ id: freshId(rig, 'out'), kind, index, enabled: true })
}

export function duplicate(rig: LightRig, f: LightFixture): LightFixture {
  const dy = Math.min(0.06, Math.max(0, 1 - Math.max(f.y0, f.y1)))
  return slotted(rig, sanitizeFixture({ ...f, ...shifted(f, 0, dy || -0.06), id: freshId(rig, 'fx'), name: `${f.name} copy` }))
}

/** A fixture moved by (dx, dy), its bends with it. */
export function shifted(f: LightFixture, dx: number, dy: number): Partial<LightFixture> {
  return { x0: f.x0 + dx, y0: f.y0 + dy, x1: f.x1 + dx, y1: f.y1 + dy, bends: f.bends.map((v, i) => v + (i % 2 ? dy : dx)) }
}

/** A fixture's middle on the picture. */
export function middleOf(f: LightFixture): [number, number] {
  if (f.kind === 'spot' || f.kind === 'ring') return [f.x0, f.y0]
  const p = [f.x0, f.y0, ...(f.kind === 'strip' ? f.bends : []), f.x1, f.y1]
  let x = 0, y = 0
  for (let i = 0; i < p.length; i += 2) { x += p[i]; y += p[i + 1] }
  return [x / (p.length / 2), y / (p.length / 2)]
}

/** A row of `n` of this light, evenly across the picture (or down it) : the light
 *  itself first, then its copies, addressed one after the other. */
export function rowOf(rig: LightRig, f: LightFixture, n: number, dir: 'across' | 'down'): LightFixture[] {
  const N = Math.max(2, Math.min(32, Math.round(n)))
  const [cx, cy] = middleOf(f)
  const at = (q: LightFixture, k: number): LightFixture => {
    const t = (k + 0.5) / N
    return { ...q, ...shifted(q, dir === 'across' ? t - cx : 0, dir === 'down' ? t - cy : 0) }
  }
  const out: LightFixture[] = [at(f, 0)]
  let r: LightRig = { ...rig, fixtures: rig.fixtures.map((x) => (x.id === f.id ? out[0] : x)) }
  const base = f.name.replace(/\s+\d+$/, '')
  for (let k = 1; k < N; k++) {
    const c = slotted(r, sanitizeFixture({ ...at(f, k), id: freshId(r, 'fx'), name: `${base} ${k + 1}` }))
    r = { ...r, fixtures: [...r.fixtures, c] }
    out.push(c)
  }
  return out
}

/** Every light on an output readdressed one after the other from channel 1, in
 *  their order now, none sharing a channel; a light that would cross into the
 *  next universe starts it (a long pixel bar flows over, as pixel controllers do). */
export function addressedInOrder(rig: LightRig, out: string): LightFixture[] {
  const o = rig.outputs.find((x) => x.id === out)
  const enttec = o?.kind === 'enttec'
  // (an Enttec hides the universe : by address alone there, as its lights are listed)
  const list = rig.fixtures.filter((f) => f.out === out).sort((a, b) => (enttec ? 0 : a.universe - b.universe) || (a.address - b.address))
  let uni = enttec ? 0 : firstUniverse(o?.kind ?? 'artnet', list[0]?.universe ?? 0)
  let ch = 0
  const done: LightFixture[] = []
  for (const f of list) {
    const n = fixtureChannels(f, o?.kind === 'wled')
    if (!enttec && ch > 0 && ch + n > 512 && n <= 512) { uni++; ch = 0 }
    if (!enttec && ch >= 512) { uni++; ch = 0 }
    const g = { ...f, address: Math.min(512, ch + 1), universe: enttec ? f.universe : uni }
    const spans = fixtureSpans(g, enttec, o?.kind === 'sacn', o?.kind === 'wled')
    const last = spans[spans.length - 1]
    if (last) { if (!enttec) uni = last.universe; ch = last.to } else ch += n
    done.push(g)
  }
  return done
}

/** A chain of `n` lights of one kind, as a beginner sets a rig up : on the Enttec
 *  output (made if there is none), in a row across the picture, addressed one
 *  after the other from the first free channel. */
export function chainOf(rig: LightRig, profile: LightProfile, n: number): LightRig {
  let r = rig
  let out = r.outputs.find((o) => o.kind === 'enttec') ?? r.outputs[0]
  if (!out) { out = newOutput(r, 'enttec'); r = { ...r, outputs: [out] } }
  const N = Math.max(1, Math.min(32, Math.round(n)))
  for (let k = 0; k < N; k++) {
    const t = (k + 0.5) / N
    const base = newFixture(r, profile.kind)
    const place =
      profile.kind === 'spot' ? { x0: t, y0: 0.78 }
        : profile.kind === 'ring' ? { x0: t, y0: 0.5, x1: t + 0.3 / N, y1: 0.5 }
          : profile.kind === 'matrix' ? { x0: t - 0.4 / N, y0: 0.3, x1: t + 0.4 / N, y1: 0.7 }
            : { x0: t - 0.42 / N, y0: 0.62, x1: t + 0.42 / N, y1: 0.62 }
    const f = slotted(r, sanitizeFixture({ ...base, ...profilePatch(profile), ...place, bends: [], out: out.id, universe: 0, name: `Light ${r.fixtures.length + 1}` }))
    r = { ...r, fixtures: [...r.fixtures, f] }
  }
  return r
}

/** A light made another kind, with a shape that makes sense where it stands (a
 *  spot has no second point : a bar or a matrix made from one is laid around it). */
export function kindPatch(f: LightFixture, kind: LightKind): Partial<LightFixture> {
  if (kind === f.kind) return {}
  const p: Partial<LightFixture> = { kind, bends: [] }
  const [cx, cy] = middleOf(f)
  if (kind === 'spot') return { ...p, x0: cx, y0: cy }
  if (kind === 'ring') return { ...p, x0: cx, y0: cy, x1: cx + 0.1, y1: cy, pixels: f.pixels >= 2 ? f.pixels : 24 }
  const flat = f.kind === 'spot' || f.kind === 'ring'
  if (kind === 'strip') return { ...p, ...(flat ? { x0: cx - 0.15, y0: cy, x1: cx + 0.15, y1: cy } : {}), pixels: f.pixels >= 2 ? f.pixels : 30 }
  // a matrix : a real rectangle, its wiring starting over
  const thin = Math.abs(f.x1 - f.x0) < 0.02 || Math.abs(f.y1 - f.y0) < 0.02
  return { ...p, reverse: false, ...(flat || thin ? { x0: cx - 0.12, y0: cy - 0.12, x1: cx + 0.12, y1: cy + 0.12 } : {}) }
}

/** A profile on a light : its channels always; its kind and size only when it
 *  says how many pixels it has (a bar of 30 zones), or when a single light is
 *  given a pixel kind. A matrix given "pixel strip, GRB" stays a matrix. */
export function withProfile(f: LightFixture, p: LightProfile): LightFixture {
  const sized = !!(p.pixels || p.cols || p.rows)
  const kind: LightKind = sized ? p.kind : f.kind === 'spot' && p.kind !== 'spot' ? p.kind : f.kind
  return sanitizeFixture({
    ...f,
    ...kindPatch(f, kind),
    profile: p.id, head: p.head, layout: p.layout, tail: p.tail,
    ...(p.pixels ? { pixels: p.pixels } : {}), ...(p.cols ? { cols: p.cols } : {}), ...(p.rows ? { rows: p.rows } : {}),
    id: f.id
  })
}

// ── light setups : the rig and what the lights show, kept by name on this computer ──
export interface LightSetup {
  name: string
  rig: LightRig
  lights: LightsSession
}
const SETUPS_KEY = 'opsia.lightSetups'
const SETUP_NAME_KEY = 'opsia.lightSetupName'

/** A setup read from anywhere (a file, the list) : sanitized, or null. */
export function readSetup(raw: unknown, fallbackName = 'Setup'): LightSetup | null {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!o || !o.rig || typeof o.rig !== 'object') return null
  return {
    name: (typeof o.name === 'string' && o.name.trim().slice(0, 60)) || fallbackName,
    rig: sanitizeRig(o.rig),
    lights: sanitizeLightsSession(o.lights ?? null)
  }
}
export function loadSetups(): LightSetup[] {
  try {
    const list = JSON.parse(localStorage.getItem(SETUPS_KEY) || '[]') as unknown[]
    return (Array.isArray(list) ? list : []).map((x) => readSetup(x)).filter((x): x is LightSetup => !!x).slice(0, 64)
  } catch { return [] }
}
export function persistSetups(list: LightSetup[]): LightSetup[] {
  try { localStorage.setItem(SETUPS_KEY, JSON.stringify(list)) } catch { /* quota : for this run */ }
  return list
}
export const loadSetupName = (): string => { try { return localStorage.getItem(SETUP_NAME_KEY) || '' } catch { return '' } }
export const persistSetupName = (n: string): string => { try { localStorage.setItem(SETUP_NAME_KEY, n) } catch { /* private */ } return n }
/** A setup as the text of its file. */
export const setupText = (s: LightSetup): string => JSON.stringify({ kind: 'palinopsia-light-setup', version: 1, ...s }, null, 1)

/** The kind of light a mode of so many channels most likely is (the 30-zone bars'
 *  modes first; null : no guess, its channels are written as held values). */
export function profileForFootprint(fp: number): string | null {
  return ({ 90: 'b:bar30-90', 94: 'b:bar30-94', 8: 'b:bar-8', 5: 'b:bar-5', 3: 'b:rgb', 4: 'b:drgb', 1: 'b:dimmer', 2: 'b:dimmer16' } as Record<number, string>)[fp] ?? null
}

/** Lights on the map for what answered on the line : each at the address it has,
 *  of the kind its mode suggests, in a row across the picture, on `out`. A light
 *  already on the map at that address stays where it is (its look, its place) and
 *  takes the kind of its mode now, if that is known : asked twice, nothing doubles. */
export function lightsFromLine(rig: LightRig, out: string, devs: Array<{ name: string; address: number; profile: LightProfile }>): LightRig {
  let r = rig
  const N = devs.length
  // (each light on the map stands for one device : two answering at one address are two)
  const claimed = new Set<string>()
  devs.forEach((d, k) => {
    const t = (k + 0.5) / N
    const p = d.profile
    const at = Math.max(1, Math.min(512, d.address))
    const there = rig.fixtures.find((f) => f.out === out && f.address === at && !claimed.has(f.id))
    if (there) {
      claimed.add(there.id)
      if (p.id && p.id !== there.profile) r = { ...r, fixtures: r.fixtures.map((f) => (f.id === there.id ? withProfile(f, p) : f)) }
      return
    }
    const base = newFixture(r, p.kind)
    const place =
      p.kind === 'spot' ? { x0: t, y0: 0.78 }
        : p.kind === 'matrix' ? { x0: t - 0.4 / N, y0: 0.3, x1: t + 0.4 / N, y1: 0.7 }
          : { x0: t - 0.42 / N, y0: 0.62, x1: t + 0.42 / N, y1: 0.62 }
    const f = sanitizeFixture({ ...base, ...profilePatch(p), ...place, bends: [], out, universe: 0, address: at, name: d.name.slice(0, 40) || base.name })
    r = { ...r, fixtures: [...r.fixtures, f] }
  })
  return r
}
