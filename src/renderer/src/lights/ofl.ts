// Open Fixture Library files (open-fixture-library.org : a fixture's page, Download,
// "OFL JSON") read into profiles, one per mode : each channel of the mode becomes a
// token the Lights engine fills. Its intensity becomes the dimmer (D, or D16 with
// its fine channel next to it), its color channels the color (R G B W A U C M Y),
// a strobe or shutter is held where it is open, pan and tilt at their middle, and
// everything else (wheels, gobos, effects, maintenance) at its default value, or
// where it does nothing. A pixel fixture's matrix becomes a bar or a matrix, its
// template channels the pixel's layout.
//
// The file is read as data, never trusted : a mode it cannot read for sure is left
// out and named (a wrong guess would send colors to a strobe or a reset channel).

import { MAX_TOKENS, type LightKind, type LightProfile } from '@shared/lights'

type Cap = Record<string, unknown> & { type?: string; dmxRange?: number[] }
type ChanDef = Record<string, unknown> & { capability?: Cap; capabilities?: Cap[]; defaultValue?: unknown; fineChannelAliases?: unknown }

const COLOR: Record<string, string> = {
  red: 'R', green: 'G', blue: 'B', white: 'W', 'warm white': 'W', 'cold white': 'W', amber: 'A', uv: 'U',
  cyan: 'C', magenta: 'M', yellow: 'Y'
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

/** A DMX value from OFL's forms : a number (in 16 bits on a channel with a fine
 *  one : its coarse byte), or "50%". */
function dmxValue(v: unknown, wide = false): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.max(0, Math.min(255, Math.round(wide && v > 255 ? v / 256 : v)))
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

const startOf = (cap: Cap | undefined, wide: boolean): number => {
  const v = cap && Array.isArray(cap.dmxRange) && typeof cap.dmxRange[0] === 'number' ? cap.dmxRange[0] : 0
  return Math.max(0, Math.min(255, Math.round(wide && v > 255 ? v / 256 : v)))
}
const endOf = (cap: Cap, wide: boolean): number => {
  const v = Array.isArray(cap.dmxRange) && typeof cap.dmxRange[1] === 'number' ? cap.dmxRange[1] : 255
  return Math.max(0, Math.min(255, Math.round(wide && v > 255 ? v / 256 : v)))
}

/** A channel's token and what it does (for the patch readout). */
function tokenOf(c: ChanDef): { t: string; label: string } {
  const caps = capsOf(c)
  const types = caps.map((x) => String(x.type ?? ''))
  const wide = Array.isArray(c.fineChannelAliases) && c.fineChannelAliases.length > 0 && c.dmxValueResolution !== '8bit'
  const def = dmxValue(c.defaultValue, wide)
  if (caps.length === 1 && types[0] === 'Intensity') return { t: 'D', label: 'dimmer' }
  if (caps.length === 1 && types[0] === 'ColorIntensity') {
    const col = String(caps[0].color ?? '').toLowerCase()
    const t = COLOR[col]
    return t ? { t, label: col } : { t: '0', label: `${col || 'color'} (held at 0)` }
  }
  // a dimmer and a strobe on one channel : held at the top of its dimmer range (open, full)
  const inten = caps.find((x) => x.type === 'Intensity')
  if (inten && caps.length > 1) {
    const v = endOf(inten, wide)
    return { t: String(v), label: `dimmer / strobe (held full at ${v})` }
  }
  if (types.includes('ShutterStrobe')) {
    // held where it is open (or where it does nothing)
    const open = caps.find((x) => (x.type === 'ShutterStrobe' && x.shutterEffect === 'Open') || x.type === 'NoFunction')
    const v = open ? startOf(open, wide) : def ?? 0
    return { t: String(v), label: open ? `shutter (held open at ${v})` : `shutter (held at ${v} : check that it is open)` }
  }
  if (types.length && types.every((x) => x === 'Pan' || x === 'Tilt' || x === 'PanContinuous' || x === 'TiltContinuous')) {
    const v = def ?? 128
    return { t: String(v), label: `${types[0].startsWith('Pan') ? 'pan' : 'tilt'} (held at ${v})` }
  }
  if (!types.length || types.every((x) => x === 'NoFunction')) return { t: '0', label: 'unused' }
  // anything else : its default, or where it does nothing, or 0
  const none = caps.find((x) => x.type === 'NoFunction' || (x.type === 'WheelSlot' && String(x.slotNumber) === '1') || x.shutterEffect === 'Open')
  const v = def ?? (none ? startOf(none, wide) : 0)
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
  // the matrix : how many pixels, in what shape, and its named groups
  const mx = obj(fx.matrix)
  let px = 0, cols = 0, rows = 0
  if (Array.isArray(mx.pixelCount)) {
    const [x, y, z] = mx.pixelCount.map((v) => (typeof v === 'number' && v > 0 ? Math.round(v) : 1))
    px = x * y * (z ?? 1); cols = x; rows = y * (z ?? 1)
  } else if (Array.isArray(mx.pixelKeys)) {
    // [z][y][x] of keys or null
    let n = 0
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
  const groups = Object.keys(obj(mx.pixelGroups)).length
  const profiles: LightProfile[] = []
  const skipped: string[] = []
  const modes = Array.isArray(fx.modes) ? fx.modes : []
  modes.slice(0, 32).forEach((m, mi) => {
    const mo = obj(m)
    const mname = (typeof mo.name === 'string' && mo.name) || `mode ${mi + 1}`
    try {
      const chans = Array.isArray(mo.channels) ? mo.channels : []
      type Ctx = 'head' | 'pix' | 'tail'
      const toks: Record<Ctx, string[]> = { head: [], pix: [], tail: [] }
      const labs: Record<Ctx, string[]> = { head: [], pix: [], tail: [] }
      const last: Record<Ctx, string> = { head: '', pix: '', tail: '' } // the last channel's key there
      let where: 'head' | 'tail' = 'head'
      let seenPix = false
      let repeats = 0
      let bad = ''
      const push = (t: string, label: string, ctx: Ctx, key: string): void => { toks[ctx].push(t); labs[ctx].push(label); last[ctx] = key }
      const one = (key: string, ctx: Ctx, defs: Record<string, unknown>): void => {
        const coarse = fineOf.get(key)
        if (coarse) {
          // a fine channel right after its own coarse one : the pair is a 16-bit token
          const list = toks[ctx], prev = list[list.length - 1]
          if (last[ctx] === coarse && prev && /^[A-Z]$/.test(prev) && prev !== 'X' && prev !== 'S' && prev !== 'U') {
            list[list.length - 1] = prev + '16'
            labs[ctx][labs[ctx].length - 1] += ' (16-bit)'
            labs[ctx].push('(fine)')
            last[ctx] = key
            return
          }
          push('0', `${key} (held at 0)`, ctx, key)
          return
        }
        const d = defs[key]
        if (!d || typeof d !== 'object') { bad = `its channel "${key}" is not described`; return }
        const { t, label } = tokenOf(d as ChanDef)
        push(t, label, ctx, key)
      }
      for (const c of chans) {
        if (bad) break
        if (c === null) { push('0', 'unused', where, ''); continue }
        if (typeof c === 'string') { one(c, where, avail); continue }
        const ins = obj(c)
        if (ins.insert === 'matrixChannels' && Array.isArray(ins.templateChannels)) {
          if (seenPix) { bad = 'two pixel blocks'; break }
          if (ins.channelOrder === 'perChannel') { bad = 'its pixels are not one after the other (per channel)'; break }
          // what the block repeats over : every pixel, the named groups, or a list
          const rf = ins.repeatFor
          repeats = Array.isArray(rf) ? rf.length : rf === 'eachPixelGroup' ? groups : typeof rf === 'string' && /^eachPixel/.test(rf) ? px : 0
          if (repeats < 1) { bad = 'its pixel block repeats over something it does not say'; break }
          for (const tc of ins.templateChannels) {
            if (typeof tc !== 'string') { push('0', 'unused', 'pix', ''); continue }
            one(tc, 'pix', templ)
          }
          seenPix = true
          where = 'tail'
          continue
        }
        bad = 'a channel it cannot read'
      }
      if (!bad && [toks.head, toks.pix, toks.tail].some((l) => l.length > MAX_TOKENS)) bad = `more than ${MAX_TOKENS} channels in a row`
      if (bad) { skipped.push(`${mname} : ${bad}`); return }
      // a dimmer-only light : its dimmer is the luminance
      const all = [...toks.head, ...toks.pix, ...toks.tail]
      const hasColor = all.some((t) => /^[RGBWAUCMY]/.test(t))
      // (its only dimmer shares a channel with a strobe : held full there, nothing
      // would carry its level, its fader and Black would never take it down)
      if (!hasColor && !all.some((t) => t[0] === 'D') && [...labs.head, ...labs.pix, ...labs.tail].some((l) => l.startsWith('dimmer / strobe'))) {
        skipped.push(`${mname} : its only dimmer shares its channel with a strobe`)
        return
      }
      const fix = (list: string[]): string[] => (hasColor ? list : list.map((t) => (t[0] === 'D' ? 'L' + t.slice(1) : t)))
      const hasPix = seenPix && repeats > 1
      // every pixel of a full grid : a matrix; anything else (groups, a list, holes) : a bar of that many
      const kind: LightKind = hasPix ? (repeats === cols * rows && cols > 1 && rows > 1 ? 'matrix' : 'strip') : 'spot'
      if (!hasPix && all.length > MAX_TOKENS) { skipped.push(`${mname} : more than ${MAX_TOKENS} channels`); return }
      profiles.push({
        id: `ofl:${name}:${mname}`.slice(0, 80),
        name: `${name} : ${mname}`.slice(0, 80),
        kind,
        head: hasPix ? fix(toks.head).join(' ') : '',
        layout: hasPix ? fix(toks.pix).join(' ') : fix(all).join(' ') || 'RGB',
        tail: hasPix ? fix(toks.tail).join(' ') : '',
        ...(kind === 'strip' ? { pixels: repeats } : {}),
        ...(kind === 'matrix' ? { cols, rows } : {}),
        labels: hasPix ? [...labs.head, ...labs.pix.map((l) => `pixel : ${l}`), ...labs.tail] : [...labs.head, ...labs.pix, ...labs.tail]
      })
    } catch {
      skipped.push(`${mname} : it could not be read`)
    }
  })
  if (!modes.length) skipped.push('no modes : not a fixture file')
  return { name, profiles, skipped }
}
