// Resolume OSC mapper : the shared data model.
//
// A Resolume composition (.avc) is read in main into a ResoSession (how many
// layers / groups / columns / clips / effects / dashboard links it has); the
// renderer turns that into a catalogue of Resolume OSC addresses (the matrix
// COLUMNS), which Palinopsia's own signals (the matrix ROWS) drive in realtime.
// The patch that inspired it : OSC_Data_RouteToResolume (a Max `matrix 18 30`).

export interface ResoLink {
  n: number // 1-based dashboard link number
  name: string // the parameter it is linked to in Resolume ('' = unassigned)
}

export interface ResoFx {
  name: string // as shown in Resolume ("Levels", "Master FX", …)
  slug: string // the OSC path segment ("levels", "levels2" for a second one)
  dryWet: boolean // wrapped effects have bypassed + opacity; Transform does not
  params: string[] // parameter names the composition saved (non-default only)
}

export interface ResoTrack {
  index: number // 1-based OSC index
  name: string
  group: number | null // layers : the 1-based group they belong to
  dashboard: ResoLink[]
  effects: ResoFx[]
}

export interface ResoClip {
  layer: number // 1-based
  column: number // 1-based
  name: string
}

export interface ResoSession {
  name: string
  path: string
  version: string
  width: number
  height: number
  decks: string[]
  currentDeck: number // 0-based
  columns: number // in the current deck
  layers: ResoTrack[]
  groups: ResoTrack[]
  composition: { dashboard: ResoLink[]; effects: ResoFx[] }
  clips: ResoClip[] // current deck only
}

export type ResoParseResult = { ok: true; session: ResoSession } | { ok: false; error: string }

// ── Mapper state (persisted in the Palinopsia session) ─────────────────

/** How an output column turns the combined input into OSC. */
export type ResoKind = 'float' | 'toggle' | 'trigger'

export interface ResoOutput {
  id: string
  address: string
  label: string
  group: string // column group shown in the matrix header ("Layer 4 · FeedbackBottom")
  kind: ResoKind
  lo: number // output range (Resolume params take 0..1)
  hi: number
  smooth: number // 0..1 slew (the patch's slide / line~)
  combine: 'mean' | 'max' | 'sum'
}

export interface ResoInput {
  id: string
  source: string // 'mod:1' · 'meta:3' · 'audio:level' · 'vision:motion' · 'body:handsUp' · 'osc:/opsia/…'
  smooth: number // 0..1 slew on the incoming signal (the patch's speedlim / slide)
  gain: number // 0..4
}

export interface ResoCell {
  i: string // input id
  o: string // output id
  amount: number // 0..1
}

export interface ResolumeMap {
  enabled: boolean
  host: string
  port: number // Resolume's OSC INPUT port (Preferences › OSC, 7000 by default)
  rateHz: number
  // The loaded composition, kept so the catalogue can be rebuilt and the page can
  // say what it is mapped against.
  session: ResoSession | null
  inputs: ResoInput[]
  outputs: ResoOutput[]
  cells: ResoCell[]
  folded: string[] // column groups folded shut
  // When a Palinopsia scene N is recalled, connect Resolume column N + offset
  // (the patch's "Resolume Scene Trigger").
  sceneColumns: boolean
  columnOffset: number
  // Eight connection snapshots : click recalls, shift+click stores (the patch's preset).
  snapshots: (ResoCell[] | null)[]
  locked: boolean
}

export const RESO_SNAPSHOTS = 8

export function defaultResolumeMap(): ResolumeMap {
  return {
    enabled: false,
    host: '127.0.0.1',
    port: 7000,
    rateHz: 30,
    session: null,
    inputs: [],
    outputs: [],
    cells: [],
    folded: [],
    sceneColumns: false,
    columnOffset: 0,
    snapshots: Array.from({ length: RESO_SNAPSHOTS }, () => null),
    locked: false
  }
}

/** Resolume's OSC segment for an effect or parameter name : lower case, no spaces
 *  or punctuation ("Master FX" → "masterfx", "Hue Rotate" → "huerotate"). */
export function resoSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

const out = (
  address: string,
  label: string,
  group: string,
  kind: ResoKind = 'float'
): Omit<ResoOutput, 'id'> => ({ address, label, group, kind, lo: 0, hi: 1, smooth: 0, combine: 'mean' })

function linkLabel(links: ResoLink[], n: number): string {
  const l = links.find((x) => x.n === n)
  return l?.name ? `link ${n} · ${l.name}` : `link ${n}`
}

function effectOutputs(base: string, group: string, fxs: ResoFx[]): Omit<ResoOutput, 'id'>[] {
  const r: Omit<ResoOutput, 'id'>[] = []
  for (const fx of fxs) {
    if (fx.dryWet) {
      r.push(out(`${base}/video/effects/${fx.slug}/bypassed`, `${fx.name} bypass`, group, 'toggle'))
      r.push(out(`${base}/video/effects/${fx.slug}/opacity`, `${fx.name} mix`, group))
      for (const p of fx.params) r.push(out(`${base}/video/effects/${fx.slug}/effect/${resoSlug(p)}`, `${fx.name} · ${p}`, group))
    } else {
      // Transform : its params sit directly under the effect, no dry/wet wrapper.
      for (const p of fx.params) r.push(out(`${base}/video/effects/${fx.slug}/${resoSlug(p)}`, `${fx.name} · ${p}`, group))
    }
  }
  return r
}

/** Every Resolume address the composition offers, grouped for the matrix header.
 *  Dashboard links come first in each group : they are what a Resolume set is
 *  usually built to be played through (the patch drives nothing else). */
export function resoCatalogue(s: ResoSession): Omit<ResoOutput, 'id'>[] {
  const r: Omit<ResoOutput, 'id'>[] = []
  const g0 = 'Composition'
  for (let k = 1; k <= 8; k++) r.push(out(`/composition/dashboard/link${k}`, linkLabel(s.composition.dashboard, k), g0))
  r.push(out('/composition/master', 'master', g0))
  r.push(out('/composition/crossfader/phase', 'crossfader', g0))
  r.push(...effectOutputs('/composition', g0, s.composition.effects))

  const gs = 'Selected clip'
  for (let k = 1; k <= 8; k++) r.push(out(`/composition/selectedclip/dashboard/link${k}`, `link ${k}`, gs))

  for (const g of s.groups) {
    const grp = `Group ${g.index}${g.name ? ` · ${g.name}` : ''}`
    const base = `/composition/groups/${g.index}`
    for (let k = 1; k <= 8; k++) r.push(out(`${base}/dashboard/link${k}`, linkLabel(g.dashboard, k), grp))
    r.push(out(`${base}/master`, 'master', grp))
    r.push(out(`${base}/bypassed`, 'bypass', grp, 'toggle'))
    r.push(...effectOutputs(base, grp, g.effects))
  }
  for (const l of s.layers) {
    const grp = `Layer ${l.index}${l.name ? ` · ${l.name}` : ''}`
    const base = `/composition/layers/${l.index}`
    for (let k = 1; k <= 8; k++) r.push(out(`${base}/dashboard/link${k}`, linkLabel(l.dashboard, k), grp))
    r.push(out(`${base}/master`, 'master', grp))
    r.push(out(`${base}/video/opacity`, 'opacity', grp))
    r.push(out(`${base}/bypassed`, 'bypass', grp, 'toggle'))
    r.push(out(`${base}/clear`, 'clear', grp, 'trigger'))
    r.push(...effectOutputs(base, grp, l.effects))
  }
  for (let c = 1; c <= s.columns; c++) r.push(out(`/composition/columns/${c}/connect`, `column ${c}`, 'Columns', 'trigger'))
  for (const c of s.clips) {
    r.push(out(`/composition/layers/${c.layer}/clips/${c.column}/connect`, `L${c.layer} C${c.column}${c.name ? ` · ${c.name}` : ''}`, 'Clips', 'trigger'))
  }
  return r
}
