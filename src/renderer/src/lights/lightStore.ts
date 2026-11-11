// The Lights rig's persistence (this computer) and the pure helpers the store's
// actions use. The rig was the old Output page's zone grid before the Lights
// page : that one setting comes over once, as a matrix on its own output.

import {
  fixtureChannels,
  fixtureSpans,
  profilePatch,
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
import { GROUP_PREFIX, LOOK_DEFAULT, type LightModField, type LightsSession } from '@shared/lights'

/** A light slider's value now : a fixture's look or tuning, or a master. */
export function lightBaseValue(rig: LightRig, L: LightsSession, fixture: string, field: LightModField): number | null {
  if (field === 'masterBrightness') return L.master.brightness
  if (field === 'masterSpeed') return L.master.speed
  if (fixture.startsWith(GROUP_PREFIX)) {
    const gid = fixture.slice(GROUP_PREFIX.length)
    return field === 'level' && rig.groups.some((g) => g.id === gid) ? L.groups?.[gid] ?? 1 : null
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
    lightsSession: LightsSession
  },
  fixture: string,
  field: LightModField,
  v: number
): void {
  if (field === 'masterBrightness') return st.setLightsMaster({ brightness: v })
  if (field === 'masterSpeed') return st.setLightsMaster({ speed: v })
  if (fixture.startsWith(GROUP_PREFIX)) {
    if (field === 'level') st.setLightGroupLevel(fixture.slice(GROUP_PREFIX.length), v)
    return
  }
  if (field === 'tuneBrightness') return st.setLightTune(fixture, { brightness: v })
  if (field === 'tuneSaturation') return st.setLightTune(fixture, { saturation: v })
  if (field === 'tuneHue') return st.setLightTune(fixture, { hue: v })
  if (field === 'tuneWarmth') return st.setLightTune(fixture, { warmth: v })
  if (field === 'gradOffset' || field === 'gradAngle' || field === 'gradScale') {
    const g = (st.lightsSession.looks[fixture] ?? LOOK_DEFAULT).gradient
    const k = field === 'gradOffset' ? 'offset' : field === 'gradAngle' ? 'angle' : 'scale'
    return st.setLightLook(fixture, { gradient: { ...g, [k]: v } })
  }
  st.setLightLook(fixture, { [field]: v })
}

const RIG_KEY = 'opsia.lightRig'
const OLD_KEY = 'opsia.lights'

export function persistRig(rig: LightRig): LightRig {
  try { localStorage.setItem(RIG_KEY, JSON.stringify(rig)) } catch { /* quota : the rig lives on for this run */ }
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

const uid = (p: string): string => `${p}${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`

/** The next free channel on an output's universe, after the fixtures already there. */
export function nextAddress(rig: LightRig, out: string, universe: number): number {
  let end = 0
  for (const f of rig.fixtures) {
    if (f.out !== out || f.universe !== universe) continue
    end = Math.max(end, f.address - 1 + fixtureChannels(f))
  }
  return Math.min(512, end + 1)
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
    id: uid('fx'),
    name: `${kind === 'spot' ? 'Spot' : kind === 'matrix' ? 'Matrix' : kind === 'ring' ? 'Ring' : 'Bar'} ${same + 1}`,
    kind,
    ...base,
    out,
    universe: 0
  })
  f.address = nextAddress(rig, out, 0)
  return f
}

export function newOutput(rig: LightRig, kind: LightOutputKind): LightOutput {
  const enttecs = rig.outputs.filter((o) => o.kind === 'enttec').length
  return sanitizeOutput({ id: uid('out'), kind, index: kind === 'enttec' ? enttecs : 0, enabled: true })
}

export function duplicate(rig: LightRig, f: LightFixture): LightFixture {
  const d = sanitizeFixture({ ...f, id: uid('fx'), name: `${f.name} copy`, y0: Math.min(1, f.y0 + 0.06), y1: Math.min(1, f.y1 + 0.06) })
  d.address = nextAddress(rig, d.out, d.universe)
  return d
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
    const c = sanitizeFixture({ ...at(f, k), id: uid('fx'), name: `${base} ${k + 1}` })
    c.address = nextAddress(r, c.out, c.universe)
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
  const list = rig.fixtures.filter((f) => f.out === out).sort((a, b) => (a.universe - b.universe) || (a.address - b.address))
  let uni = enttec ? 0 : list[0]?.universe ?? 0
  let ch = 0
  const done: LightFixture[] = []
  for (const f of list) {
    const n = fixtureChannels(f)
    if (!enttec && ch > 0 && ch + n > 512 && n <= 512) { uni++; ch = 0 }
    if (!enttec && ch >= 512) { uni++; ch = 0 }
    const g = { ...f, address: Math.min(512, ch + 1), universe: enttec ? f.universe : uni }
    const spans = fixtureSpans(g, enttec)
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
    const f = sanitizeFixture({ ...base, ...profilePatch(profile), ...place, bends: [], out: out.id, universe: 0, name: `Light ${r.fixtures.length + 1}` })
    f.address = nextAddress(r, out.id, 0)
    r = { ...r, fixtures: [...r.fixtures, f] }
  }
  return r
}
