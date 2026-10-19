// Worlds (diegesis) : editable, saveable presets. A World biases the whole
// composition when selected: every layer's A/B coupling character, a Context
// mood nudge, and an optional audio-routing default (an audio modulator on the
// reserved slot 8 → a Context input). Vibe (the user's palette) is left alone.
//
// Context nudges stay inside the FINISHING-safe bands (bloom ≤ .35, haze ≤ .28,
// depth ≤ .5) so a World can never crush/blow the output. Built-ins ship here;
// user worlds live in the store (persisted to localStorage).

import type { CompositionState, CouplingMode, SceneClimate, SceneEntry, SceneTags, World } from '@shared/types'
import { MAX_MOD_ASSIGNMENTS, WORLD_AUTOMOD_SLOT } from '@shared/types'
import { makeDefaultModulator } from './engine/modulation'

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/** Auto-derive a scene's relation tags from its composition (editable after).
 *  Diégèse = saved World · Synchrèse = its layers' coupling modes · Espace-temps
 *  from mean visible opacity + Context haze/depth · Climat neutral (release). */
export function deriveSceneTags(scene: SceneEntry): SceneTags {
  const c = scene.composition
  const modes = Array.from(
    new Set(
      c.layers
        .map((l) => l.coupling?.mode)
        .filter((m): m is CouplingMode => !!m && m !== 'off')
    )
  )
  const vis = c.layers.filter((l) => !l.mute)
  const meanOpac = vis.length ? vis.reduce((a, l) => a + (l.opacity ?? 0), 0) / vis.length : 0.5
  const ctx = c.master.find((f) => f.shaderId === 'fx-context')?.inputs ?? {}
  const haze = typeof ctx.haze === 'number' ? ctx.haze : 0
  const depth = typeof ctx.depth === 'number' ? ctx.depth : 0
  // Fuller (low spaceTime) = high opacity + low haze; void (high) = sparse + hazy/deep.
  const spaceTime = clamp01(0.5 + (haze * 0.6 + depth * 0.4) * 0.5 - (meanOpac - 0.5) * 0.6)
  return {
    world: scene.world?.id ?? 'synthetic',
    synchresis: modes.length ? modes : ['lean'],
    spaceTime,
    climate: 'release'
  }
}

/** Suggest a Climat from a picture's palette (crossmodal colour→affect, after the
 *  colour-psychology results distilled in the NIME reading : warm+saturated reads
 *  aroused/unresolved, cool+muted reads eased, cool+bright+calm reads settled).
 *  warmth 0 cool..1 warm, saturation 0 grey..1 vivid, brightness 0 dark..1 light. */
export function climateFromColour(warmth: number, saturation: number, brightness: number): SceneClimate {
  if (saturation < 0.22) return 'release' // muted / grey : easing off, neutral
  if (warmth > 0.55) return brightness < 0.5 ? 'tension' : 'expectation' // warm+dark tense, warm+bright anticipating
  return brightness > 0.5 ? 'resolution' : 'release' // cool+bright settled, cool+dark eased
}

const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)

export const BUILTIN_WORLDS: World[] = [
  {
    id: 'synthetic',
    name: 'Synthetic',
    builtin: true,
    blurb: 'Abstract concordance : audio leans the A/B texture (default).',
    coupling: { mode: 'lean', amount: 0.5, tightness: 0.7, feature: 'flux' },
    context: { trails: 0.22, bloom: 0.18, depth: 0.28, haze: 0.16 },
    autoMod: { feature: 'flux', target: 'haze', depth: 0.4 }
  },
  {
    id: 'parametric',
    name: 'Parametric',
    builtin: true,
    blurb: 'Data-mapped : transient cut, crisp and digital.',
    coupling: { mode: 'cut', amount: 0.8, tightness: 0.9, feature: 'transient' },
    context: { trails: 0.05, bloom: 0.05, depth: 0.15, haze: 0.03 },
    autoMod: { feature: 'transient', target: 'bloom', depth: 0.5 }
  },
  {
    id: 'musical',
    name: 'Musical',
    builtin: true,
    blurb: 'Visual reading of the music : pitch drifts the balance.',
    coupling: { mode: 'drift', amount: 0.6, tightness: 0.6, feature: 'pitch' },
    context: { trails: 0.2, bloom: 0.22, depth: 0.25, haze: 0.1 },
    autoMod: { feature: 'centroid', target: 'bloom', depth: 0.35 }
  },
  {
    id: 'incongruent',
    name: 'Incongruent',
    builtin: true,
    blurb: 'Independent voices : coupling off, detached.',
    coupling: { mode: 'off', amount: 0.5, tightness: 0.7, feature: 'level' },
    context: { trails: 0.15, bloom: 0.1, depth: 0.3, haze: 0.06 },
    autoMod: null
  },
  {
    id: 'sublimated',
    name: 'Sublimated',
    builtin: true,
    blurb: 'Mood over sync : warm, dreamy, gently level-led.',
    coupling: { mode: 'lean', amount: 0.3, tightness: 0.4, feature: 'level' },
    context: { trails: 0.35, bloom: 0.28, depth: 0.4, haze: 0.28 },
    autoMod: { feature: 'level', target: 'trails', depth: 0.45 }
  },
  {
    id: 'monomedia',
    name: 'Monomedia',
    builtin: true,
    blurb: 'Absence as tension : stark, near-black, uncoupled.',
    coupling: { mode: 'off', amount: 0.5, tightness: 0.7, feature: 'level' },
    context: { trails: 0.1, bloom: 0.0, depth: 0.5, haze: 0.0 },
    autoMod: null
  },
  // ── Cameraless / direct-film modes (spec §6). These bias the whole comp toward
  //    a hand-made-film reading; pick the sources to match (Op-Art marks for
  //    Griffé, an organic/feedback source for Peint, a scanned clip for Pressé).
  {
    id: 'griffe',
    name: 'Griffé',
    builtin: true,
    blurb: 'Graphic, rhythmic, tightly synced. Marks on the beat.',
    coupling: { mode: 'cut', amount: 0.85, tightness: 0.9, feature: 'transient' },
    context: { trails: 0.04, bloom: 0.06, depth: 0.12, haze: 0.02 },
    finalizer: {
      filmHold: 1, filmRate: 10, filmJitter: 0.2, filmBoil: 0.15, filmFlutter: 0.12,
      filmBlank: 0.35, filmBlankMode: 0, filmDust: 0.2, filmScratch: 0.3, filmHair: 0,
      filmGauge: 0, filmDirt: 0, filmGranule: 0, filmSplice: 0.05
    },
    autoMod: { feature: 'transient', target: 'bloom', depth: 0.4 }
  },
  {
    id: 'peint',
    name: 'Peint',
    builtin: true,
    blurb: 'Dense, gestural, silent. Dye, boil, granulation.',
    coupling: { mode: 'drift', amount: 0.6, tightness: 0.35, feature: 'level' },
    context: { trails: 0.2, bloom: 0.18, depth: 0.28, haze: 0.1 },
    finalizer: {
      filmHold: 1, filmRate: 6, filmJitter: 0.4, filmBoil: 0.6, filmFlutter: 0.4,
      filmBlank: 0.05, filmBlankMode: 2, filmDust: 0.3, filmScratch: 0.15, filmHair: 0.25,
      filmGauge: 1, filmDirt: 1, filmGranule: 0.6, filmSplice: 0.03
    },
    autoMod: null // "silent by conviction" : audio decoupled
  },
  {
    id: 'presse',
    name: 'Pressé',
    builtin: true,
    blurb: 'Pressed material. Heavy handling, scratch, dust.',
    coupling: { mode: 'drift', amount: 0.5, tightness: 0.5, feature: 'level' },
    context: { trails: 0.12, bloom: 0.1, depth: 0.35, haze: 0.08 },
    finalizer: {
      filmHold: 1, filmRate: 8, filmJitter: 0.35, filmBoil: 0.4, filmFlutter: 0.25,
      filmBlank: 0.08, filmBlankMode: 0, filmDust: 0.55, filmScratch: 0.6, filmHair: 0.5,
      filmGauge: 1, filmDirt: 0, filmGranule: 0.35, filmSplice: 0.08
    },
    autoMod: { feature: 'level', target: 'haze', depth: 0.3 }
  }
]

/** Context's blur is the user's alone : no World, theme or New sets it (a world
 *  saved before carried one). Every automatic Context write goes through this. */
export function sansBlur(ctx: Record<string, number | number[]>): Record<string, number | number[]> {
  const out = { ...ctx }
  delete out.blur
  return out
}

/** A fresh user world, cloned from an existing one (defaults to Synthetic). */
export function cloneWorld(src: World, name: string): World {
  return {
    id: uid(),
    name,
    builtin: false,
    blurb: src.blurb,
    coupling: { ...src.coupling },
    context: { ...src.context },
    finalizer: src.finalizer ? { ...src.finalizer } : undefined,
    autoMod: src.autoMod ? { ...src.autoMod } : null,
    layers: src.layers ? [...src.layers] : undefined
  }
}

/** The Context keys a World sets (its mood), in the editor's order, with what
 *  each does. Blur is never one (sansBlur). */
export const WORLD_CONTEXT_KEYS: Array<{ k: string; label: string; hint: string }> = [
  { k: 'trails', label: 'trails', hint: 'Temporal color bleed : past frames linger and drift into the distance.' },
  { k: 'bloom', label: 'bloom', hint: 'Highlights glow / bleed light : dreamier, more luminous.' },
  { k: 'depth', label: 'depth', hint: 'Vignette + aerial recession that seats the image in a volume.' },
  { k: 'haze', label: 'haze', hint: 'Atmospheric veil toward the atmosphere color : distance, air.' },
  { k: 'lightGlow', label: 'light', hint: 'The key light : a soft glow and its volumetric bloom.' },
  { k: 'voidEdge', label: 'void', hint: 'The frame\u2019s edges eaten toward black, ragged and breathing.' },
  { k: 'pbrAmount', label: 'material', hint: 'How much the picture lies on the surface material picked in Context.' }
]

/** The film character a World can carry (the Finalizer's film inputs) : what the
 *  editor shows, with their ranges. Absent from a World = film off. */
export const WORLD_FILM_KEYS: Array<{ k: string; label: string; min: number; max: number; step?: number; labels?: string[] }> = [
  { k: 'filmHold', label: 'hold', min: 0, max: 2, step: 1, labels: ['off', 'film-hold', 'freeze'] },
  { k: 'filmRate', label: 'draw fps', min: 1, max: 60, step: 1 },
  { k: 'filmJitter', label: 'timing', min: 0, max: 1 },
  { k: 'filmBoil', label: 'boil', min: 0, max: 1 },
  { k: 'filmFlutter', label: 'flutter', min: 0, max: 1 },
  { k: 'filmBlank', label: 'blanks', min: 0, max: 1 },
  { k: 'filmDust', label: 'dust', min: 0, max: 1 },
  { k: 'filmScratch', label: 'scratch', min: 0, max: 1 },
  { k: 'filmHair', label: 'gate hair', min: 0, max: 1 },
  { k: 'filmGranule', label: 'granulation', min: 0, max: 1 },
  { k: 'filmSplice', label: 'splice', min: 0, max: 1 }
]
// What a World without film puts back : the hold and the damage off.
const FILM_OFF: Record<string, number> = { filmHold: 0, filmDust: 0, filmScratch: 0, filmHair: 0 }

const num = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d)
const CONTEXT_DEFAULTS: Record<string, number> = { trails: 0.2, bloom: 0.3, depth: 0.35, haze: 0.15, lightGlow: 0.1, voidEdge: 0, pbrAmount: 0 }

/** Which layers a World couples (L1..L4). */
export const worldLayers = (w: World): boolean[] => [0, 1, 2, 3].map((i) => w.layers?.[i] ?? true)

/** The modulator a World installed (its flag), or, in a session from before the
 *  flag, slot 8 when it looks like one (an audio modulator on one Context row). */
function worldSlotOf(c: CompositionState): number {
  const flagged = c.modulators.findIndex((m) => m?.fromWorld)
  if (flagged >= 0) return flagged
  const m = c.modulators[WORLD_AUTOMOD_SLOT]
  const rows = c.modMatrix.filter((a) => a.mod === WORLD_AUTOMOD_SLOT)
  const ctx = c.master.find((f) => f.shaderId === 'fx-context')
  if (m && m.enabled && m.type === 'audio' && rows.length === 1 && ctx && rows[0].target.kind === 'fx' && rows[0].target.instId === ctx.id) return WORLD_AUTOMOD_SLOT
  return -1
}

/** Where a World's audio modulator goes : the one it installed before, else the
 *  first free slot from M8 down (free = off and driving nothing); -1 = none free. */
export function worldModSlot(c: CompositionState): number {
  const own = worldSlotOf(c)
  if (own >= 0) return own
  for (let i = WORLD_AUTOMOD_SLOT; i >= 0; i--) {
    const m = c.modulators[i]
    if ((!m || !m.enabled) && !c.modMatrix.some((a) => a.mod === i)) return i
  }
  return -1
}

/** Apply a World's bias to a composition : the coupling of the layers it picks,
 *  the Context mood, the film character, and its audio modulator in a free slot
 *  (replacing only the one a World installed). The mood it finds is kept as
 *  `worldBase` (the first World's find stays, so switching Worlds never loses
 *  yours), which the World amount blends from. Returns a new composition. */
export function applyWorldToComposition(c: CompositionState, world: World): CompositionState {
  const contextInst = c.master.find((f) => f.shaderId === 'fx-context')
  const finInst = c.master.find((f) => f.shaderId === 'fx-finalizer')
  const use = worldLayers(world)
  // The mood as found, for every key this World touches (kept from an earlier World).
  const base: Record<string, number> = { ...(c.worldBase ?? {}) }
  for (const k of Object.keys(sansBlur(world.context)))
    if (!(k in base) && contextInst) base[k] = num(contextInst.inputs[k], CONTEXT_DEFAULTS[k] ?? 0)
  for (const k of Object.keys({ ...FILM_OFF, ...(world.finalizer ?? {}) }))
    if (!(k in base) && finInst) base[k] = num(finInst.inputs[k], 0)
  let next: CompositionState = {
    ...c,
    worldBase: base,
    layers: c.layers.map((l, i) => (use[i] ? { ...l, coupling: { ...world.coupling } } : l)),
    master: c.master.map((f) => {
      if (f.shaderId === 'fx-context') return { ...f, inputs: { ...f.inputs, ...sansBlur(world.context) } }
      // Finalizer: reset the Cameraless hold and the film damage OFF as a baseline
      // (so a non-film World clears drawn-film : dust no longer needs the hold),
      // then apply this World's film character if any.
      if (f.shaderId === 'fx-finalizer')
        return { ...f, inputs: { ...f.inputs, ...FILM_OFF, ...(world.finalizer ?? {}) } }
      return f
    })
  }

  // Audio routing : a World only ever replaces the modulator a World installed.
  const old = worldSlotOf(c)
  let matrix = next.modMatrix
  const modulators = next.modulators.slice()
  if (old >= 0) {
    matrix = matrix.filter((a) => a.mod !== old)
    modulators[old] = { ...makeDefaultModulator(), ...modulators[old], enabled: false, fromWorld: false }
  }
  const am = world.autoMod
  const slot = worldModSlot({ ...next, modulators, modMatrix: matrix })
  // Only install the row if the matrix has room for it (never past the cap).
  if (am && am.target !== 'none' && contextInst && slot >= 0 && matrix.length < MAX_MOD_ASSIGNMENTS) {
    modulators[slot] = {
      ...makeDefaultModulator(),
      type: 'audio',
      enabled: true,
      fromWorld: true,
      audio: { feature: am.feature, band: 0, smooth: 0.2 }
    }
    matrix = [
      ...matrix,
      {
        id: uid(),
        mod: slot,
        target: { kind: 'fx', scope: { kind: 'master' }, instId: contextInst.id, input: am.target },
        depth: am.depth
      }
    ]
  }
  next = { ...next, modulators, modMatrix: matrix }
  return next
}

/** What applying `world` to `c` changes, line by line (the editor shows it
 *  under Apply). */
export function worldEffects(world: World, c: CompositionState): string[] {
  const out: string[] = []
  const use = worldLayers(world)
  const ls = use.map((u, i) => (u ? `L${i + 1}` : '')).filter(Boolean)
  out.push(
    ls.length
      ? `coupling ${world.coupling.mode}${world.coupling.mode === 'off' ? '' : ` ${world.coupling.amount.toFixed(2)} on ${world.coupling.feature}`} → ${ls.join(' ')}`
      : 'coupling : no layer'
  )
  const ctx = Object.entries(sansBlur(world.context)) as Array<[string, number]>
  if (ctx.length) {
    const label = (k: string): string => WORLD_CONTEXT_KEYS.find((x) => x.k === k)?.label ?? k
    out.push('Context ' + ctx.map(([k, v]) => `${label(k)} ${Number(v).toFixed(2)}`).join(' · '))
  }
  const film = world.finalizer
  out.push(film && Object.keys(film).length ? `film : hold ${['off', 'on', 'freeze'][Math.round(num(film.filmHold, 0))] ?? 'off'} · dust ${num(film.filmDust, 0).toFixed(2)} · scratch ${num(film.filmScratch, 0).toFixed(2)}` : 'film off')
  const am = world.autoMod
  if (am && am.target !== 'none') {
    const ctxInst = c.master.find((f) => f.shaderId === 'fx-context')
    const own = worldSlotOf(c)
    const freeC = own >= 0 ? { ...c, modulators: c.modulators.map((m, i) => (i === own ? { ...m, enabled: false } : m)), modMatrix: c.modMatrix.filter((a) => a.mod !== own) } : c
    const slot = worldModSlot(freeC)
    if (!ctxInst) out.push('audio routing skipped : no Context')
    else if (slot < 0) out.push('audio routing skipped : no free modulator (all 8 are yours)')
    else out.push(`audio : M${slot + 1} ← ${am.feature} → ${am.target} ${am.depth.toFixed(2)}${own >= 0 && own !== slot ? '' : own === slot ? ' (replaces the World\u2019s own)' : ' (a free slot)'}`)
  } else out.push('no audio routing (a World\u2019s earlier one is removed)')
  return out
}

/** A World's settings read back from a composition : the coupling of the first
 *  coupled layer (and which layers share it), the Context mood, the film
 *  character, the audio routing a World installed. The reverse of Apply. */
export function worldFromComposition(c: CompositionState): Pick<World, 'coupling' | 'context' | 'finalizer' | 'autoMod' | 'layers'> {
  const first = c.layers.find((l) => l.coupling && l.coupling.mode !== 'off') ?? c.layers[0]
  const coupling = { ...first.coupling }
  const layers = c.layers.slice(0, 4).map((l) => !!l.coupling && JSON.stringify(l.coupling) === JSON.stringify(coupling))
  const ctxInst = c.master.find((f) => f.shaderId === 'fx-context')
  const context: Record<string, number> = {}
  for (const { k } of WORLD_CONTEXT_KEYS) context[k] = Math.round(num(ctxInst?.inputs[k], CONTEXT_DEFAULTS[k] ?? 0) * 1000) / 1000
  const finInst = c.master.find((f) => f.shaderId === 'fx-finalizer')
  let finalizer: Record<string, number> | undefined
  if (finInst && (num(finInst.inputs.filmHold, 0) > 0 || num(finInst.inputs.filmDust, 0) > 0 || num(finInst.inputs.filmScratch, 0) > 0)) {
    finalizer = {}
    for (const { k } of WORLD_FILM_KEYS) if (typeof finInst.inputs[k] === 'number') finalizer[k] = finInst.inputs[k] as number
  }
  const slot = worldSlotOf(c)
  let autoMod: World['autoMod'] = null
  if (slot >= 0) {
    const m = c.modulators[slot]
    const row = c.modMatrix.find((a) => a.mod === slot)
    if (m?.audio && row && row.target.kind === 'fx')
      autoMod = { feature: m.audio.feature, target: row.target.input as World['autoMod'] extends infer T ? T extends { target: infer U } ? U : never : never, depth: row.depth }
  }
  return { coupling, layers, context, finalizer, autoMod }
}

/** A built-in edited this session differs from how it ships. */
export function builtinChanged(w: World): boolean {
  const o = BUILTIN_WORLDS.find((x) => x.id === w.id)
  if (!o) return false
  const pick = (x: World): string => JSON.stringify([x.name, x.blurb, x.coupling, x.context, x.finalizer ?? null, x.autoMod, worldLayers(x)])
  return pick(o) !== pick(w)
}
