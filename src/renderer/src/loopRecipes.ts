// The Loop rack's recipes : ready loops for a layer's feedback (its Loop rack,
// the blend the returning picture meets the new frame with, and how much of
// each pass comes back). Picked from the Loop drawer's menu, dealt by Generate
// (a theme's `loops`) and by the layer dice (all but the ones marked
// dice: false, kept to the menu).
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
  /** Where it sits in the menu : the plain feedback loops (absent), the glitch
   *  loops (damage inside the loop, remembered and smeared by every pass) or
   *  the echoes (a delay, in milliseconds or on the beat). */
  group?: 'glitch' | 'echo'
  /** false : menu only. The dice and Generate leave it alone (it flickers
   *  fast in places, or wrecks the picture too far to be dealt blind). */
  dice?: false
}

export const LOOP_GROUPS: Array<{ group: LoopRecipe['group']; label: string }> = [
  { group: undefined, label: 'feedback' },
  { group: 'glitch', label: 'glitch' },
  { group: 'echo', label: 'echoes and beats' }
]

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
    id: 'beat-echo', name: 'Beat echo', blend: 'lighten', amount: 0.8, sync: 0.5, group: 'echo',
    blurb: 'Every eighth note an echo, each one a little smaller and off to the side : copies falling away on the beat',
    fx: [{ shaderId: 'fx-transform', inputs: { zoom: 0.82, posX: 0.03, posY: 0.012, wrap: 0 } }]
  },
  {
    id: 'slow-echo', name: 'Slow echo', blend: 'screen', amount: 0.7, delay: 400, group: 'echo',
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
  },

  // ── Glitch : the damage runs inside the loop, so every pass remembers it and
  // smears it further. Each was soaked 60 s on a film and on a generator (mean
  // light, the share of near-black and near-white, flashes a second per sixth of
  // the frame) : none goes black, white, flat or still. Their stepped clocks move
  // bands and blocks a hair a frame : a tear of 0.006 or a shift of 0.004 already
  // slides a band across the frame in a few seconds.
  {
    id: 'bit-rot', name: 'Bit rot', blend: 'mix', amount: 0.9, group: 'glitch', dice: false,
    blurb: 'Values crushed and channels scrambled in blocks on every pass : the damage piles up into tinted bricks drifting outward',
    // (10 levels : at 6 the darks rounded to black on every pass and a dim picture went out)
    fx: [
      { shaderId: 'fx-byte-corrupt', inputs: { depth: 10, scramble: 0.12, blocks: 14, warpByte: 0, rate: 0.2, chaos: 0, audio: 0 } },
      { shaderId: 'fx-transform', inputs: { zoom: 1.004, rotate: 0.003, posX: 0.0016, posY: -0.001, wrap: 0 } }
    ]
  },
  {
    id: 'recompress', name: 'Recompress', blend: 'mix', amount: 0.93, group: 'glitch', dice: false,
    blurb: 'Saved again as a cheap compressed file on every pass, a hair larger : blocks and smears, the color draining toward gray',
    fx: [
      { shaderId: 'fx-compress', inputs: { block: 8, quality: 0.55, ring: 0.25, chroma: 0.12, grid: 0, vary: 0.3 } },
      { shaderId: 'fx-transform', inputs: { zoom: 1.002, rotate: -0.003, posX: -0.0015, posY: 0.001, wrap: 0 } }
    ]
  },
  {
    id: 'tear-drift', name: 'Tear drift', blend: 'mix', amount: 0.93, group: 'glitch',
    blurb: 'A few bands tear sideways and go on tearing on every pass : the trail slides apart in strata',
    // (Slice Shuffle, not Sync Loss : on the dome Sync Loss darkens a ring at the
    // rim on every pass and twists its rings round the zenith, and in a loop that
    // closed into a dark oval flickering 4 to 8 times a second)
    fx: [{ shaderId: 'fx-slice-shuffle', inputs: { slices: 8, amount: 0.006, chance: 0.35, rate: 0.3, audio: 0 } }]
  },
  {
    id: 'band-slip', name: 'Band slip', blend: 'mix', amount: 0.92, group: 'glitch',
    blurb: 'Bands of the stream slip sideways and stick, their top line held : the trail breaks into torn rows',
    // (no channel turn : turning the colors again on every pass is a color strobe)
    fx: [{ shaderId: 'fx-databend', inputs: { bands: 36, shift: 0.004, chance: 0.3, hold: 0.15, channel: 0, rate: 0.15, wrap: 1, audio: 0 } }]
  },
  {
    id: 'sort-drip', name: 'Sort drip', blend: 'mix', amount: 0.9, group: 'glitch',
    blurb: 'Pixel sort run again on every pass : the middle tones run down in sorted streaks',
    fx: [
      { shaderId: 'fx-pixelsort', inputs: { low: 0.25, high: 0.85, length: 0.04, vertical: 1, reverse: 0, angle: 0 } },
      { shaderId: 'fx-transform', inputs: { zoom: 1, posY: -0.002, wrap: 0 } }
    ]
  },
  {
    id: 'freeze-bands', name: 'Freeze bands', blend: 'mix', amount: 0.93, group: 'glitch',
    blurb: 'A slow spiral whose bands freeze at random while the rest keeps turning : the loop stutters apart',
    fx: [
      { shaderId: 'fx-transform', inputs: { zoom: 1.012, rotate: 0.014, posX: 0.002, posY: -0.001, wrap: 0 } },
      { shaderId: 'fx-stutter', inputs: { rate: 2, chance: 0.5, bands: 8, jitter: 0.6, blackout: 0 } }
    ]
  },
  {
    id: 'tape-rot', name: 'Tape rot', blend: 'mix', amount: 0.85, delay: 90, group: 'glitch', dice: false, // (on the dome it rings the rim : menu only)
    blurb: 'A tape dubbed again every 90 ms : the tracking band, the wobble and the color bleed pile up',
    fx: [{ shaderId: 'fx-tracking', inputs: { band: 0.12, position: 0.3, roll: 0.1, wobble: 0.02, noise: 0.3, rate: 0.3, freeze: 0.1, distort: 0.08, bleed: 0.12, bleedRange: 1 } }]
  },
  {
    id: 'scan-relief', name: 'Scan relief', blend: 'lighten', amount: 0.9, group: 'glitch',
    blurb: 'Scan lines lifted by brightness, again on every pass : the bright parts climb into a ridged relief',
    // (lighten : the scan lines sit on black, so a mixing loop sank the picture under them)
    fx: [{ shaderId: 'fx-rutt', inputs: { lines: 90, amp: 0.012, width: 0.3, color: 0.8, relief: 1 } }]
  },
  {
    id: 'slice-drag', name: 'Slice drag', blend: 'mix', amount: 0.9, group: 'glitch',
    blurb: 'Slices jump sideways and smear as they go : the trail drags into torn streaks',
    fx: [
      { shaderId: 'fx-streak', inputs: { reach: 0.006, angle: 0.3, smoothing: 0.5 } },
      { shaderId: 'fx-slice-shuffle', inputs: { slices: 30, amount: 0.01, chance: 0.2, rate: 0.25, audio: 0 } }
    ]
  },
  {
    id: 'ink-latch', name: 'Ink latch', blend: 'mix', amount: 0.5, group: 'glitch', dice: false,
    blurb: 'What passes the level once stays inked until the new picture darkens it : hard blots that hold and creep',
    // (half back : nearer 1 a blot can never let go and the frame inks over for good)
    fx: [
      { shaderId: 'fx-threshold', inputs: { level: 0.55, soft: 0.15, invert: 0, alphaOut: 0 } },
      { shaderId: 'fx-displace', inputs: { amount: 0.003, scale: 2.5, rate: 0.1 } }
    ]
  },
  {
    id: 'crawl-stain', name: 'Crawl stain', blend: 'mix', amount: 0.85, group: 'glitch', dice: false,
    blurb: 'Where things change, the trail is stained by how long ago : a gray, scratched bloom spreading outward',
    fx: [
      { shaderId: 'fx-crawl', inputs: { threshold: 0.08, fade: 8, ground: 0, wet: 0.25, band: 1, cycle: 0.1, steps: 8, palette: 1, stops: 4 } },
      { shaderId: 'fx-transform', inputs: { zoom: 1.004, posX: 0.004, posY: -0.003, wrap: 0 } }
    ]
  },

  // ── Echoes and beats : the delay, or a clock on the tempo, inside the loop
  {
    id: 'torn-echo', name: 'Torn echo', blend: 'lighten', amount: 0.8, sync: 0.5, group: 'echo',
    blurb: 'Every eighth note an echo, smaller and off to the side, its slices torn sideways',
    fx: [
      { shaderId: 'fx-slice-shuffle', inputs: { slices: 24, amount: 0.05, chance: 0.3, rate: 0.5, audio: 0 } },
      { shaderId: 'fx-transform', inputs: { zoom: 0.9, posX: 0.025, posY: -0.01, wrap: 0 } }
    ]
  },
  {
    id: 'bar-grab', name: 'Bar grab', blend: 'mix', amount: 0.9, group: 'echo',
    blurb: 'Every bar the loop grabs a still and holds it in scattered cells : the trail jumps on the downbeat',
    fx: [{ shaderId: 'fx-shatter', inputs: { rate: 1.5, sync: 1, pattern: 6, scale: 24, density: 0.35, flip: 0, slide: 0, wet: 1 } }]
  },
  {
    id: 'beat-stutter', name: 'Beat stutter', blend: 'mix', amount: 0.8, sync: 0.25, group: 'echo',
    blurb: 'Echoes a sixteenth note apart, bands of them freezing at random : a stutter on the beat',
    fx: [{ shaderId: 'fx-stutter', inputs: { rate: 4, chance: 0.3, bands: 6, jitter: 0.5, blackout: 0 } }]
  },
  {
    id: 'step-spiral', name: 'Step spiral', blend: 'mix', amount: 0.9, group: 'echo',
    blurb: 'The loop moves only on the eighth note, a turn and a zoom at a time : a stop-motion spiral',
    // (the frame is held between steps, so each step is one pass : it takes an echo-sized move)
    fx: [
      { shaderId: 'node-decimate', inputs: { mode: 0, rate: 6, sync: 2, smooth: 0, mix: 1 } },
      { shaderId: 'fx-transform', inputs: { zoom: 1.06, rotate: 0.06, posX: 0.012, posY: -0.006, wrap: 0 } }
    ]
  }
]

export const LOOP_RECIPE_BY_ID: Record<string, LoopRecipe> = Object.fromEntries(LOOP_RECIPES.map((r) => [r.id, r]))

/** Which recipe a layer's loop is, if it is one unchanged in its effects (the
 *  menu shows it; any edit makes it the layer's own loop). */
export function loopRecipeOf(
  fx: Array<{ shaderId: string | null; inputs?: Values }>,
  blend: LoopBlend | undefined,
  timing?: { loopDelay?: number; loopSync?: number }
): LoopRecipe | null {
  const ids = fx.map((f) => f.shaderId).join('|')
  // a recipe that comes back on a delay or the tempo is that recipe only with the
  // same timing (a hand-built Stutter loop with no delay is not Beat stutter)
  const timed = (r: LoopRecipe): boolean => (r.sync ?? 0) === (timing?.loopSync ?? 0) && (r.delay ?? 0) === (timing?.loopDelay ?? 0)
  const same = LOOP_RECIPES.filter((r) => r.blend === (blend ?? 'mix') && r.fx.map((f) => f.shaderId).join('|') === ids && (!(r.sync || r.delay) || timed(r)))
  if (same.length < 2) return same[0] ?? null
  // Two recipes on the same effects (Spiral and Tunnel are both a Transform and
  // a Displace) : the one whose delay and values are nearest.
  const off = (r: LoopRecipe): number => {
    let d = (r.sync ?? 0) !== (timing?.loopSync ?? 0) || (r.delay ?? 0) !== (timing?.loopDelay ?? 0) ? 10 : 0
    r.fx.forEach((f, k) => {
      for (const [name, v] of Object.entries(f.inputs)) {
        const have = fx[k]?.inputs?.[name]
        if (typeof v === 'number' && typeof have === 'number') d += Math.abs(have - v) / (Math.abs(v) + 0.01)
      }
    })
    return d
  }
  return same.reduce((a, b) => (off(b) < off(a) ? b : a))
}

/** The recipes the dice and Generate may deal. */
export const DICE_LOOP_RECIPES: LoopRecipe[] = LOOP_RECIPES.filter((r) => r.dice !== false)

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
