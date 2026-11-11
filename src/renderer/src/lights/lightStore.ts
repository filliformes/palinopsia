// The Lights rig's persistence (this computer) and the pure helpers the store's
// actions use. The rig was the old Output page's zone grid before the Lights
// page : that one setting comes over once, as a matrix on its own output.

import {
  fixtureChannels,
  RIG_DEFAULT,
  sanitizeFixture,
  sanitizeOutput,
  sanitizeRig,
  TUNE_DEFAULT,
  type LightFixture,
  type LightKind,
  type LightOutput,
  type LightOutputKind,
  type LightRig
} from '@shared/lights'
import { LOOK_DEFAULT, type LightModField, type LightsSession } from '@shared/lights'

/** A light slider's value now : a fixture's look or tuning, or a master. */
export function lightBaseValue(rig: LightRig, L: LightsSession, fixture: string, field: LightModField): number | null {
  if (field === 'masterBrightness') return L.master.brightness
  if (field === 'masterSpeed') return L.master.speed
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
    lightsSession: LightsSession
  },
  fixture: string,
  field: LightModField,
  v: number
): void {
  if (field === 'masterBrightness') return st.setLightsMaster({ brightness: v })
  if (field === 'masterSpeed') return st.setLightsMaster({ speed: v })
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
        : { x0: 0.12, y0: y, x1: 0.88, y1: y, size: 0.025, pixels: 60, layout: 'RGB' }
  const f = sanitizeFixture({
    id: uid('fx'),
    name: `${kind === 'spot' ? 'Spot' : kind === 'matrix' ? 'Matrix' : 'Bar'} ${same + 1}`,
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
