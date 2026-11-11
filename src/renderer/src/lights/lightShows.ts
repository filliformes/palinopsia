// Light shows : looks for the whole rig in one click. They fit any setup because
// their patterns live in the room, not in the fixtures : a gradient runs across
// the space, a chase travels through it, so each fixture takes its part from
// where it stands; "each its layer" deals the layers out from left to right.

import { LOOK_DEFAULT, type LightFixture, type LightLook } from '@shared/lights'

export interface LightShow {
  id: string
  name: string
  blurb: string
  look: (f: LightFixture, i: number, all: LightFixture[], layers: number[], palette: number[][] | null) => Partial<LightLook>
}

/** The picture's main colors now (the runtime registers it : the store side stays
 *  free of the readback). */
let paletteSource: () => number[][] | null = () => null
export function setPaletteSource(fn: () => number[][] | null): void {
  paletteSource = fn
}
export const pictureColors = (): number[][] | null => paletteSource()

const grad = (stops: number[][], over: Partial<LightLook['gradient']> = {}): Partial<LightLook> => ({
  source: 'gradient',
  gradient: { ...LOOK_DEFAULT.gradient, stops, ...over }
})

export const LIGHT_SHOWS: LightShow[] = [
  { id: 'follow', name: 'Follow the picture', blurb: 'Every light takes the picture where it sits.', look: () => ({ source: 'master', effect: 'none', level: 1 }) },
  {
    id: 'layers', name: 'Each its layer', blurb: 'The playing layers dealt out from left to right : each light shows one.',
    look: (f, _i, all, layers) => {
      const order = all.slice().sort((a, b) => (a.x0 + a.x1) - (b.x0 + b.x1))
      const k = order.findIndex((x) => x.id === f.id)
      const L = layers.length ? layers : [0]
      return { source: 'layer', layer: L[Math.floor((k / Math.max(1, order.length)) * L.length) % L.length], effect: 'none', level: 1 }
    }
  },
  {
    id: 'palette', name: 'Picture colors', blurb: "The picture's own colors as a gradient across the room, left to right as they sit in it, drifting slowly.",
    look: (_f, _i, _a, _l, pal) => ({ ...grad(pal ?? [[0.9, 0.3, 0.1], [0.2, 0.4, 0.9]], { angle: 0, speed: 0.02 }), effect: 'none', level: 1 })
  },
  { id: 'warm', name: 'Warm white', blurb: 'A soft warm white, barely breathing.', look: () => ({ source: 'color', hue: 32, sat: 0.32, val: 1, effect: 'pulse', rate: 0.08, depth: 0.15, level: 1 }) },
  { id: 'sunset', name: 'Sunset', blurb: 'Deep red to gold across the room, drifting.', look: () => ({ ...grad([[0.55, 0.04, 0.06], [0.95, 0.35, 0.08], [1, 0.75, 0.35]], { angle: 0, speed: 0.03 }), effect: 'none', level: 1 }) },
  { id: 'ocean', name: 'Ocean', blurb: 'Blues and teal with slow waves passing through.', look: () => ({ ...grad([[0.02, 0.08, 0.35], [0.0, 0.45, 0.55], [0.55, 0.85, 0.9]], { angle: 20, speed: 0.04 }), effect: 'wave', rate: 0.15, depth: 0.45, width: 0.6, angle: 0, level: 1 }) },
  { id: 'fire', name: 'Fire', blurb: 'Reds and yellows, flickering upward.', look: () => ({ ...grad([[0.6, 0.02, 0.0], [1, 0.32, 0.0], [1, 0.75, 0.15]], { angle: 90, scale: 1.4, speed: 0.12 }), effect: 'wave', rate: 0.6, depth: 0.45, width: 0.25, angle: -90, level: 1 }) },
  { id: 'rainbow', name: 'Rainbow drift', blurb: 'The spectrum across the room, turning slowly.', look: () => ({ ...grad([[1, 0.1, 0.1], [1, 0.8, 0.1], [0.1, 0.9, 0.3], [0.1, 0.4, 1], [0.7, 0.1, 0.9]], { angle: 0, speed: 0.06 }), effect: 'none', level: 1 }) },
  { id: 'chase', name: 'White chase', blurb: 'A band of white running across the room.', look: () => ({ source: 'color', hue: 0, sat: 0, val: 1, effect: 'chase', rate: 0.5, depth: 1, width: 0.15, angle: 0, level: 1 }) },
  { id: 'picture-chase', name: 'Picture chase', blurb: 'The picture, with a band of it brighter running through.', look: () => ({ source: 'master', effect: 'chase', rate: 0.35, depth: 0.6, width: 0.25, angle: 0, level: 1 }) },
  { id: 'beat', name: 'On the beat', blurb: 'The picture, flashing on every beat of the tempo.', look: () => ({ source: 'master', effect: 'beat', rate: 1, depth: 0.7, level: 1 }) },
  { id: 'sound', name: 'Sound reactive', blurb: 'The picture, as bright as the sound is loud.', look: () => ({ source: 'master', effect: 'audio', depth: 0.8, level: 1 }) },
  { id: 'breathe', name: 'Breathing', blurb: 'A deep blue, slowly breathing in and out.', look: () => ({ source: 'color', hue: 225, sat: 0.85, val: 0.9, effect: 'pulse', rate: 0.12, depth: 0.8, level: 1 }) },
  { id: 'sparkle', name: 'Night sparkle', blurb: 'A dim night blue, with lights twinkling.', look: () => ({ source: 'color', hue: 220, sat: 0.6, val: 0.9, effect: 'sparkle', rate: 1.5, depth: 0.85, level: 1 }) },
  { id: 'dark', name: 'Dark', blurb: 'Everything down (the faders at 0).', look: () => ({ level: 0 }) }
]

/** The looks a show gives the rig (each fixture's look merged over what it had). */
export function showLooks(id: string, fixtures: LightFixture[], looks: Record<string, LightLook>, layers: number[]): Record<string, LightLook> | null {
  const show = LIGHT_SHOWS.find((s) => s.id === id)
  if (!show) return null
  const out: Record<string, LightLook> = { ...looks }
  const palette = id === 'palette' ? pictureColors() : null
  fixtures.forEach((f, i) => {
    const cur = looks[f.id] ?? LOOK_DEFAULT
    const p = show.look(f, i, fixtures, layers, palette)
    out[f.id] = { ...cur, ...p, gradient: p.gradient ? { ...p.gradient } : cur.gradient }
  })
  return out
}
