// The Loop rack's recipes : ready loops for a layer's feedback (its Loop rack,
// the blend the returning picture meets the new frame with, and how much of
// each pass comes back). Picked from the Loop drawer's menu, dealt by Generate
// (a theme's `loops`) and by the layer dice.
//
// Everything in a loop runs again on every pass, so it compounds : the values
// here are a few hundredths of what the same effect needs on a layer (a 1%
// zoom is a fast tunnel, a hue shift of 0.25 a color strobe). LOOP_START holds
// the same idea for an effect put in a loop by hand.
//
// Never a centered mandala (the house rule for feedback) : the loops that turn
// or zoom carry a tiny pan, which sets their vortex off center (a pan p moves
// the still point of a zoom z by about p / 2 / (1 - z) of the frame), and the
// two strongest a faint slow waver.

import type { LoopBlend } from '@shared/types'

type Values = Record<string, number | number[]>

export interface LoopRecipe {
  id: string
  name: string
  /** What it does, for the menu's tooltip. */
  blurb: string
  blend: LoopBlend
  /** The layer's feedback amount : how much of each pass comes back. */
  amount: number
  /** The Loop rack, in order (inputs on top of each effect's defaults). */
  fx: Array<{ shaderId: string; inputs: Values; opacity?: number }>
  /** The loop's delay : milliseconds, or beats on the tempo (sync, wins). */
  delay?: number
  sync?: number
}

export const LOOP_RECIPES: LoopRecipe[] = [
  {
    id: 'spiral', name: 'Spiral', blend: 'mix', amount: 0.92,
    blurb: 'A small turn and a little zoom on every pass : the picture winds out of the middle',
    fx: [
      { shaderId: 'fx-transform', inputs: { zoom: 1.012, rotate: 0.018, posX: 0.0024, posY: -0.0012, wrap: 0 } },
      { shaderId: 'fx-displace', inputs: { amount: 0.0012, scale: 1.5, rate: 0.08 } }
    ]
  },
  {
    id: 'tunnel', name: 'Tunnel', blend: 'mix', amount: 0.94,
    blurb: 'Each pass a little smaller : frames inside frames, falling away',
    fx: [
      { shaderId: 'fx-transform', inputs: { zoom: 0.965, posX: -0.006, posY: 0.003, wrap: 0 } },
      { shaderId: 'fx-displace', inputs: { amount: 0.0012, scale: 1.5, rate: 0.08 } }
    ]
  },
  {
    id: 'echo-key', name: 'Echo key', blend: 'key', amount: 0.96,
    blurb: 'The loop shows only through the dark of the new picture, shrinking away : the studio feedback key',
    fx: [{ shaderId: 'fx-transform', inputs: { zoom: 0.975, posX: 0.004, posY: 0.002, wrap: 0 } }]
  },
  {
    id: 'hue-drift', name: 'Hue drift', blend: 'lighten', amount: 0.9,
    blurb: 'The brightest parts linger, flowing outward, their color turning a little on every pass',
    fx: [
      { shaderId: 'fx-hue-rotate', inputs: { shift: 0.008, byLuma: 0, rate: 0 } },
      { shaderId: 'fx-transform', inputs: { zoom: 1.006, wrap: 0 } }
    ]
  },
  {
    id: 'melt', name: 'Melt', blend: 'mix', amount: 0.94,
    blurb: 'A slow liquid push on every pass : the trail flows like wax',
    fx: [{ shaderId: 'fx-displace', inputs: { amount: 0.004, scale: 2.5, rate: 0.1 } }]
  },
  {
    id: 'swirl', name: 'Swirl', blend: 'mix', amount: 0.9,
    blurb: 'A little twist around the middle on every pass : a whirlpool',
    fx: [{ shaderId: 'fx-distort', inputs: { mode: 4, amount: 0.04, scale: 4, rate: 0, center: [0.46, 0.55] } }]
  },
  {
    id: 'drip', name: 'Drip', blend: 'lighten', amount: 0.95,
    blurb: 'The bright parts run, pass after pass, like wet paint',
    fx: [{ shaderId: 'fx-smear', inputs: { reach: 0.012, threshold: 0.35, smoothing: 0.4, angle: 4.7124 } }]
  },
  {
    id: 'rise', name: 'Rise', blend: 'lighten', amount: 0.96,
    blurb: 'Each pass lifts a little and wavers : the bright parts rise like smoke',
    fx: [
      { shaderId: 'fx-transform', inputs: { zoom: 1.002, posY: 0.006, wrap: 0 } },
      { shaderId: 'fx-displace', inputs: { amount: 0.0015, scale: 3, rate: 0.15 } }
    ]
  },
  {
    id: 'chroma-trail', name: 'Chroma trail', blend: 'mix', amount: 0.9,
    blurb: 'Red, green and blue part a hair on every pass : trails that split into color',
    fx: [{ shaderId: 'fx-rgb-shift', inputs: { offset: 0.002, scale: 0, wobble: 0 } }]
  },
  {
    id: 'xor-bloom', name: 'XOR bloom', blend: 'xor', amount: 0.8,
    blurb: 'Digital XOR against a turning loop : shimmering, stepped edges that bloom where things move',
    fx: [{ shaderId: 'fx-transform', inputs: { zoom: 1.01, rotate: -0.012, posX: -0.002, posY: 0.0015, wrap: 0 } }]
  },
  {
    id: 'beat-echo', name: 'Beat echo', blend: 'lighten', amount: 0.8, sync: 0.5,
    blurb: 'Every eighth note an echo, each one a little smaller and off to the side : copies falling away on the beat',
    fx: [{ shaderId: 'fx-transform', inputs: { zoom: 0.82, posX: 0.03, posY: 0.012, wrap: 0 } }]
  },
  {
    id: 'slow-echo', name: 'Slow echo', blend: 'screen', amount: 0.7, delay: 400,
    blurb: 'An echo every 0.4 s, grown a little, turned a little, its color moved on : ghosts that bloom outward',
    fx: [
      { shaderId: 'fx-transform', inputs: { zoom: 1.12, rotate: 0.18, posX: -0.02, wrap: 0 } },
      { shaderId: 'fx-hue-rotate', inputs: { shift: 0.03, byLuma: 0, rate: 0 } }
    ]
  },
  {
    id: 'burn', name: 'Burn', blend: 'multiply', amount: 0.75,
    blurb: 'The loop darkens what it meets : shadows that burn in and spread',
    fx: [{ shaderId: 'fx-transform', inputs: { zoom: 1.008, wrap: 0 } }]
  }
]

export const LOOP_RECIPE_BY_ID: Record<string, LoopRecipe> = Object.fromEntries(LOOP_RECIPES.map((r) => [r.id, r]))

/** Which recipe a layer's loop is, if it is one unchanged in its effects (the
 *  menu shows it; any edit makes it the layer's own loop). */
export function loopRecipeOf(fx: Array<{ shaderId: string | null }>, blend: LoopBlend | undefined): LoopRecipe | null {
  const ids = fx.map((f) => f.shaderId).join('|')
  return LOOP_RECIPES.find((r) => r.blend === (blend ?? 'mix') && r.fx.map((f) => f.shaderId).join('|') === ids) ?? null
}

/** Starting values for an effect put in a loop by hand : the layer's defaults
 *  would do nothing (a zoom of 1) or far too much (a hue shift of 0.25 on every
 *  pass is a strobe of color). */
export const LOOP_START: Record<string, Values> = {
  'fx-transform': { zoom: 1.01, rotate: 0.01, wrap: 0 },
  'fx-hue-rotate': { shift: 0.01, rate: 0 },
  'fx-displace': { amount: 0.004 },
  'fx-distort': { amount: 0.04, rate: 0 },
  'fx-rgb-shift': { offset: 0.002, scale: 0 },
  'fx-smear': { reach: 0.01 },
  'fx-perspective': { tilt: 0.05, lens: 0, fog: 0, soften: 0 },
  'fx-sharpen': { amount: 0.3 }
}
