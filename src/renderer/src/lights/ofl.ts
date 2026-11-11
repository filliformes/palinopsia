// Open Fixture Library files (open-fixture-library.org : a fixture's page, Download,
// "OFL JSON") read into profiles, one per mode : each channel of the mode becomes a
// token the Lights engine fills. Its intensity becomes the dimmer (D, or D16 with
// its fine channel next to it), its color channels the color (R G B W A U C M Y),
// a strobe or shutter is held where it is open, pan and tilt at their middle, and
// everything else (wheels, gobos, effects, maintenance) at its default value, or
// where it does nothing. A pixel fixture's matrix becomes a bar or a matrix, its
// template channels the pixel's layout.
//
// The file is read as data, never trusted : anything unexpected is skipped.

import type { LightKind, LightProfile } from '@shared/lights'

type Cap = Record<string, unknown> & { type?: string; dmxRange?: number[] }
type ChanDef = Record<string, unknown> & { capability?: Cap; capabilities?: Cap[]; defaultValue?: unknown; fineChannelAliases?: unknown }

const COLOR: Record<string, string> = {
  red: 'R', green: 'G', blue: 'B', white: 'W', 'warm white': 'W', 'cold white': 'W', amber: 'A', uv: 'U',
  cyan: 'C', magenta: 'M', yellow: 'Y'
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** A DMX value from OFL's forms : a number, or "50%". */
function dmxValue(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(255, Math.round(v)))
  if (typeof v === 'string') {
    const m = /^(-?\d+(?:\.\d+)?)%$/.exec(v.trim())
    if (m) return Math.max(0, Math.min(255, Math.round((Number(m[1]) / 100) * 255)))
  }
  return null
}

function capsOf(c: ChanDef): Cap[] {
  if (Array.isArray(c.capabilities)) return c.capabilities.filter((x) => x && typeof x === 'object') as Cap[]
  if (c.capability && typeof c.capability === 'object') return [c.capability]
  return []
}

const startOf = (cap: Cap | undefined): number => (cap && Array.isArray(cap.dmxRange) && typeof cap.dmxRange[0] === 'number' ? Math.max(0, Math.min(255, cap.dmxRange[0])) : 0)

/** A channel's token and what it does (for the patch readout). */
function tokenOf(c: ChanDef): { t: string; label: string } {
  const caps = capsOf(c)
  const types = caps.map((x) => String(x.type ?? ''))
  const def = dmxValue(c.defaultValue)
  if (caps.length === 1 && types[0] === 'Intensity') return { t: 'D', label: 'dimmer' }
  if (caps.length === 1 && types[0] === 'ColorIntensity') {
    const col = String(caps[0].color ?? '').toLowerCase()
    const t = COLOR[col]
    return t ? { t, label: col } : { t: '0', label: `${col || 'color'} (held at 0)` }
  }
  if (types.includes('ShutterStrobe')) {
    // held where it is open (or where it does nothing)
    const open = caps.find((x) => (x.type === 'ShutterStrobe' && x.shutterEffect === 'Open') || x.type === 'NoFunction')
    const v = open ? startOf(open) : def ?? 0
    return { t: String(v), label: `shutter (held open at ${v})` }
  }
  if (types.every((x) => x === 'Pan' || x === 'Tilt' || x === 'PanContinuous' || x === 'TiltContinuous')) {
    const v = def ?? 128
    return { t: String(v), label: `${types[0].startsWith('Pan') ? 'pan' : 'tilt'} (held at ${v})` }
  }
  if (types.length && types.every((x) => x === 'NoFunction')) return { t: '0', label: 'unused' }
  // anything else : its default, or where it does nothing, or 0
  const none = caps.find((x) => x.type === 'NoFunction' || (x.type === 'WheelSlot' && String(x.slotNumber) === '1') || x.shutterEffect === 'Open')
  const v = def ?? (none ? startOf(none) : 0)
  const what = (types[0] || 'channel').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
  return { t: String(v), label: `${what} (held at ${v})` }
}

/** Every mode of an OFL fixture file as a profile (empty : not a fixture file). */
export function readOfl(text: string, fileName = 'fixture'): { name: string; profiles: LightProfile[]; skipped: string[] } {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { return { name: fileName, profiles: [], skipped: ['not a JSON file'] } }
  const fx = obj(raw)
  const name = (typeof fx.name === 'string' && fx.name.trim()) || fileName.replace(/\.json$/i, '')
  const avail = obj(fx.availableChannels)
  const templ = obj(fx.templateChannels)
  // fine channel aliases : "Dimmer fine" -> "Dimmer"
  const fineOf = new Map<string, string>()
  for (const src of [avail, templ]) {
    for (const [k, v] of Object.entries(src)) {
      const al = obj(v).fineChannelAliases
      if (Array.isArray(al)) al.forEach((a, i) => { if (typeof a === 'string' && i === 0) fineOf.set(a, k) })
    }
  }
  // the matrix : how many pixels, in what shape
  const mx = obj(fx.matrix)
  let px = 0, cols = 0, rows = 0
  if (Array.isArray(mx.pixelCount)) {
    const [x, y, z] = mx.pixelCount.map((v) => (typeof v === 'number' && v > 0 ? Math.round(v) : 1))
    px = x * y * (z ?? 1); cols = x; rows = y * (z ?? 1)
  } else if (Array.isArray(mx.pixelKeys)) {
    // [z][y][x] of keys or null
    let n = 0
    rows = 0; cols = 0
    for (const plane of mx.pixelKeys) {
      if (!Array.isArray(plane)) continue
      for (const row of plane) {
        if (!Array.isArray(row)) continue
        rows++
        cols = Math.max(cols, row.length)
        n += row.filter((k) => typeof k === 'string').length
      }
    }
    px = n
  }
  const profiles: LightProfile[] = []
  const skipped: string[] = []
  const modes = Array.isArray(fx.modes) ? fx.modes : []
  modes.slice(0, 32).forEach((m, mi) => {
    const mo = obj(m)
    const mname = (typeof mo.name === 'string' && mo.name) || `mode ${mi + 1}`
    const chans = Array.isArray(mo.channels) ? mo.channels : []
    const head: string[] = [], pix: string[] = [], tail: string[] = []
    const hl: string[] = [], pl: string[] = [], tl: string[] = []
    let where: 'head' | 'pix' | 'tail' = 'head'
    let bad = ''
    const push = (t: string, label: string, ctx: 'head' | 'pix' | 'tail'): void => {
      const list = ctx === 'head' ? head : ctx === 'pix' ? pix : tail
      const labels = ctx === 'head' ? hl : ctx === 'pix' ? pl : tl
      // a fine channel right after its coarse one : the pair is a 16-bit token
      list.push(t)
      labels.push(label)
    }
    const one = (key: string, ctx: 'head' | 'pix' | 'tail', defs: Record<string, unknown>): void => {
      const coarse = fineOf.get(key)
      if (coarse) {
        const list = ctx === 'head' ? head : ctx === 'pix' ? pix : tail
        const labels = ctx === 'head' ? hl : ctx === 'pix' ? pl : tl
        const prev = list[list.length - 1]
        if (prev && /^[A-Z]$/.test(prev) && prev !== 'X' && prev !== 'S' && prev !== 'U') {
          list[list.length - 1] = prev + '16'
          labels[labels.length - 1] = `${labels[labels.length - 1]} (16-bit)`
          labels.push('(fine)')
          return
        }
        push('0', `${key} (held at 0)`, ctx)
        return
      }
      const d = defs[key]
      if (!d || typeof d !== 'object') { push('0', `${key} (unknown, held at 0)`, ctx); return }
      const { t, label } = tokenOf(d as ChanDef)
      push(t, label, ctx)
    }
    for (const c of chans) {
      if (c === null) { push('0', 'unused', where); continue }
      if (typeof c === 'string') { one(c, where === 'pix' ? 'tail' : where, avail); if (where === 'pix') where = 'tail'; continue }
      const ins = obj(c)
      if (ins.insert === 'matrixChannels' && Array.isArray(ins.templateChannels)) {
        if (where !== 'head') { bad = 'two pixel blocks'; break }
        if (ins.channelOrder === 'perChannel') { bad = 'its pixels are not one after the other (per channel)'; break }
        for (const tc of ins.templateChannels) {
          if (typeof tc !== 'string') { push('0', 'unused', 'pix'); continue }
          one(tc, 'pix', templ)
        }
        where = 'pix'
        continue
      }
      bad = 'a channel it cannot read'
      break
    }
    if (bad) { skipped.push(`${mname} : ${bad}`); return }
    // a dimmer-only light : its dimmer is the luminance
    const all = [...head, ...pix, ...tail]
    const hasColor = all.some((t) => /^[RGBWAUCMY]/.test(t))
    const fix = (list: string[]): string[] => (hasColor ? list : list.map((t) => (t[0] === 'D' ? 'L' + t.slice(1) : t)))
    const hasPix = pix.length > 0 && px > 1
    const kind: LightKind = hasPix ? (cols > 1 && rows > 1 ? 'matrix' : 'strip') : 'spot'
    const labels = [...hl, ...pl.map((l) => `pixel : ${l}`), ...tl]
    const p: LightProfile = {
      id: `ofl:${name}:${mname}`.slice(0, 80),
      name: `${name} : ${mname}`.slice(0, 80),
      kind,
      head: hasPix ? fix(head).join(' ') : '',
      layout: hasPix ? fix(pix).join(' ') : fix(all).join(' ') || 'RGB',
      tail: hasPix ? fix(tail).join(' ') : '',
      ...(kind === 'strip' ? { pixels: px } : {}),
      ...(kind === 'matrix' ? { cols, rows } : {}),
      labels: hasPix ? labels : [...hl, ...pl, ...tl]
    }
    profiles.push(p)
  })
  if (!modes.length) skipped.push('no modes : not a fixture file')
  return { name, profiles, skipped }
}
