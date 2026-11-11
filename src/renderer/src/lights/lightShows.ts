// Light shows : looks for the whole rig in one click. They fit any setup because
// their patterns live in the room, not in the fixtures : a gradient runs across
// the space, a chase travels through it, so each fixture takes its part from
// where it stands; "each its layer" deals the layers out from left to right.

import { LOOK_DEFAULT, type LightFixture, type LightLook } from '@shared/lights'

export interface LightShow {
  id: string
  name: string
  blurb: string
  /** A shorter name for its button (the name stays its name in OSC and the docs). */
  label?: string
  /** The digital ones : automata, memory, glitches (the Shows section lists them apart). */
  digital?: boolean
  /** One to three colors that say what it looks like (its button's swatch); none : the picture's. */
  tint?: string[]
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
  { id: 'follow', name: 'Follow the picture', label: 'The picture', blurb: 'Every light takes the picture where it sits.', look: () => ({ source: 'master', effect: 'none', level: 1 }) },
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
  { id: 'warm', name: 'Warm white', tint: ['#ffd9a8'], blurb: 'A soft warm white, barely breathing.', look: () => ({ source: 'color', hue: 32, sat: 0.32, val: 1, effect: 'pulse', rate: 0.08, depth: 0.15, level: 1 }) },
  { id: 'sunset', name: 'Sunset', tint: ['#8c0a0f', '#f25914', '#ffbf59'], blurb: 'Deep red to gold across the room, drifting.', look: () => ({ ...grad([[0.55, 0.04, 0.06], [0.95, 0.35, 0.08], [1, 0.75, 0.35]], { angle: 0, speed: 0.03 }), effect: 'none', level: 1 }) },
  { id: 'ocean', name: 'Ocean', tint: ['#05145a', '#00738c', '#8cd9e6'], blurb: 'Blues and teal with slow waves passing through.', look: () => ({ ...grad([[0.02, 0.08, 0.35], [0.0, 0.45, 0.55], [0.55, 0.85, 0.9]], { angle: 20, speed: 0.04 }), effect: 'wave', rate: 0.15, depth: 0.45, width: 0.6, angle: 0, level: 1 }) },
  { id: 'fire', name: 'Fire', tint: ['#990500', '#ff5200', '#ffbf26'], blurb: 'Reds and yellows, flickering upward.', look: () => ({ ...grad([[0.6, 0.02, 0.0], [1, 0.32, 0.0], [1, 0.75, 0.15]], { angle: 90, scale: 1.4, speed: 0.12 }), effect: 'wave', rate: 0.6, depth: 0.45, width: 0.25, angle: -90, level: 1 }) },
  { id: 'rainbow', name: 'Rainbow drift', tint: ['#ff1a1a', '#1ae64d', '#1a66ff'], blurb: 'The spectrum across the room, turning slowly.', look: () => ({ ...grad([[1, 0.1, 0.1], [1, 0.8, 0.1], [0.1, 0.9, 0.3], [0.1, 0.4, 1], [0.7, 0.1, 0.9]], { angle: 0, speed: 0.06 }), effect: 'none', level: 1 }) },
  { id: 'chase', name: 'White chase', tint: ['#fff', '#222'], blurb: 'A band of white running across the room.', look: () => ({ source: 'color', hue: 0, sat: 0, val: 1, effect: 'chase', rate: 0.5, depth: 1, width: 0.15, angle: 0, level: 1 }) },
  { id: 'picture-chase', name: 'Picture chase', blurb: 'The picture, with a band of it brighter running through.', look: () => ({ source: 'master', effect: 'chase', rate: 0.35, depth: 0.6, width: 0.25, angle: 0, level: 1 }) },
  { id: 'beat', name: 'On the beat', blurb: 'The picture, flashing on every beat of the tempo.', look: () => ({ source: 'master', effect: 'beat', rate: 1, depth: 0.7, level: 1 }) },
  { id: 'sound', name: 'Sound reactive', blurb: 'The picture, as bright as the sound is loud.', look: () => ({ source: 'master', effect: 'audio', depth: 0.8, level: 1 }) },
  { id: 'breathe', name: 'Breathing', tint: ['#2247e6'], blurb: 'A deep blue, slowly breathing in and out.', look: () => ({ source: 'color', hue: 225, sat: 0.85, val: 0.9, effect: 'pulse', rate: 0.12, depth: 0.8, level: 1 }) },
  { id: 'sparkle', name: 'Night sparkle', tint: ['#3d5ce6', '#0a0f26'], blurb: 'A dim night blue, with lights twinkling.', look: () => ({ source: 'color', hue: 220, sat: 0.6, val: 0.9, effect: 'sparkle', rate: 1.5, depth: 0.85, level: 1 }) },
  { id: 'dark', name: 'Dark', blurb: 'Everything down (the faders at 0).', tint: ['#000'], look: () => ({ level: 0 }) },

  // ── digital : memory, automata, errors ──
  {
    id: 'afterimage', name: 'Afterimage', digital: true,
    blurb: 'The lights follow the picture, and when it changes they flare the complement of what was there, fading : the afterimage the eye would keep.',
    look: () => ({ source: 'master', sample: 'vivid', effect: 'afterimage', depth: 0.95, width: 0.3, level: 1 })
  },
  {
    id: 'echo', name: 'Echo', digital: true,
    blurb: 'The room remembers : the lights show the picture as it was three seconds ago.',
    look: () => ({ source: 'master', sample: 'average', effect: 'echo', depth: 1, width: 0.36, level: 1 })
  },
  {
    id: 'hold', name: 'Sample and hold', digital: true,
    blurb: 'The picture arrives in pieces : each light freezes what it saw, then looks again when it likes.',
    look: () => ({ source: 'master', sample: 'vivid', effect: 'hold', rate: 0.45, depth: 1, level: 1 })
  },
  {
    id: 'eight', name: 'Eight colors', digital: true, tint: ['#f00', '#0f0', '#00f'],
    blurb: 'One bit a channel : every light fully red, green or blue, or not, as an early computer would show the picture.',
    look: () => ({ source: 'master', sample: 'vivid', effect: 'bits', depth: 1, level: 1 })
  },
  {
    id: 'glitch', name: 'Glitch', digital: true, tint: ['#0ff', '#f0f', '#ff0'],
    blurb: 'The picture, with blocks of wrong colors breaking in : pure primaries, negatives, pieces read from the wrong place.',
    look: () => ({ source: 'master', sample: 'average', effect: 'glitch', rate: 1.4, depth: 1, level: 1 })
  },
  {
    id: 'tape', name: 'Tape head', digital: true,
    blurb: 'The lights slide across the picture and read it like a tape head : a still picture moves through the room.',
    look: () => ({ source: 'master', sample: 'vivid', effect: 'scan', rate: 0.35, depth: 1, angle: 0, level: 1 })
  },
  {
    id: 'rule30', name: 'Rule 30', digital: true, tint: ['#dfe9ff', '#10131c'],
    blurb: 'A cellular automaton growing across the room from one cell : rule 30, order turning into noise. Its past trails behind it.',
    look: () => ({ source: 'color', hue: 215, sat: 0.18, val: 1, effect: 'automaton', rule: 30, rate: 2, depth: 1, width: 0.05, angle: 0, level: 1 })
  },
  {
    id: 'triangles', name: 'Triangles', digital: true, tint: ['#19e6c8', '#e633cc'],
    blurb: 'Rule 90 : triangles inside triangles drawn in light, again and again from one cell.',
    look: () => ({ ...grad([[0.1, 0.9, 0.78], [0.9, 0.2, 0.8]], { angle: 0, speed: 0.02 }), effect: 'automaton', rule: 90, rate: 1.5, depth: 1, width: 0.04, angle: 0, level: 1 })
  },
  {
    id: 'life', name: 'Game of Life', digital: true,
    blurb: "The Game of Life played over the room in the picture's colors : cells are born, crowd and die, and new ones land when it settles.",
    look: () => ({ source: 'master', sample: 'vivid', effect: 'life', rate: 2, depth: 0.96, width: 0.05, level: 1 })
  },
  {
    id: 'fireflies', name: 'Fireflies', digital: true, tint: ['#c8ff3a', '#16210a'],
    blurb: 'Each light blinks at its own tempo; little by little they fall into step, all together, then drift apart again.',
    look: () => ({ source: 'color', hue: 74, sat: 0.78, val: 1, effect: 'fireflies', rate: 0.55, depth: 1, level: 1 })
  },
  {
    id: 'drift', name: 'Cloud field', digital: true, tint: ['#0d1a4d', '#66b3e6', '#f2f2ff'],
    blurb: 'Slow clouds of light drifting through the room, in blues to white.',
    look: () => ({ ...grad([[0.05, 0.1, 0.3], [0.4, 0.7, 0.9], [0.95, 0.95, 1]], { angle: 60, speed: 0.01 }), effect: 'noise', rate: 0.4, depth: 0.92, width: 0.3, level: 1 })
  },
  {
    id: 'binary', name: 'Binary count', digital: true, tint: ['#fff', '#000'],
    blurb: 'The lights count the beats in binary, the fastest bit on the left.',
    look: () => ({ source: 'color', hue: 0, sat: 0, val: 1, effect: 'binary', rate: 1, depth: 1, order: 'ltr', level: 1 })
  }
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
    // (a show is a whole look : what the last one set and this one does not say goes back)
    out[f.id] = { ...cur, order: 'room', wings: 1, fan: 0, band: 'level', ...p, gradient: p.gradient ? { ...p.gradient } : cur.gradient }
  })
  return out
}
