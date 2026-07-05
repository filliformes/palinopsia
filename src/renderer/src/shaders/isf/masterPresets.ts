// Master-chain presets — 20 whole-rack chains for the master bus. Applying
// one replaces the chain AND states its Vibe (the pinned mastering stage):
// the chain and the vibe are designed together; the vibe's settings merge
// onto the locked unit without replacing it.

export interface MasterPreset {
  name: string
  fx: Array<{ shaderId: string; inputs: Record<string, number | number[]> }>
  // Settings merged onto the pinned Vibe Palette.
  vibe: Record<string, number | number[]>
}

export const MASTER_PRESETS: MasterPreset[] = [
  {
    name: 'Clean Grade',
    fx: [{ shaderId: 'fx-grade', inputs: { contrast: 1.15, saturation: 1.05, brightness: 0.01, lift: 0.01 } }],
    vibe: { mixSrc: 1, contrast: 1.05, saturation: 1, gamma: 1, autoLevel: 0.3, splitTone: 0 }
  },
  {
    name: 'Cyanotype Print',
    fx: [
      { shaderId: 'fx-palette', inputs: { stops: 4, blend: 1, dither: 0.15, mixSrc: 0, colorA: [0.02, 0.03, 0.08, 1], colorB: [0.05, 0.15, 0.4, 1], colorC: [0.2, 0.5, 0.75, 1], colorD: [0.85, 0.92, 0.95, 1] } },
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.12, size: 1.8, mono: 1 } }
    ],
    vibe: { mixSrc: 1, contrast: 1, saturation: 0.95, gamma: 1, autoLevel: 0.25, splitTone: 0.2, shadowTint: [0.44, 0.47, 0.56, 1], highTint: [0.52, 0.53, 0.5, 1] }
  },
  {
    name: 'Newsprint',
    fx: [
      { shaderId: 'fx-threshold', inputs: { level: 0.5, soft: 0.15, invert: 0 } },
      { shaderId: 'fx-dither', inputs: { levels: 2, scale: 3, amount: 1 } },
      { shaderId: 'fx-grade', inputs: { contrast: 1.1, saturation: 0, lift: 0.04 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 0.9, gamma: 1, autoLevel: 0.5, splitTone: 0 }
  },
  {
    name: 'Broadcast 1986',
    fx: [
      { shaderId: 'fx-grain', inputs: { character: 2, amount: 0.2, size: 2, mono: 0 } },
      { shaderId: 'fx-scanlines', inputs: { count: 400, darkness: 0.3, roll: 0.1 } },
      { shaderId: 'fx-chroma-shift', inputs: { amount: 0.008, angle: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.05, saturation: 1.1, gamma: 1, autoLevel: 0.2, splitTone: 0.25, shadowTint: [0.46, 0.48, 0.54, 1], highTint: [0.56, 0.52, 0.44, 1] }
  },
  {
    name: 'Soft Film',
    fx: [
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.15, size: 1.5, mono: 1 } },
      { shaderId: 'fx-grade', inputs: { lift: 0.06, saturation: 0.85, contrast: 0.95 } },
      { shaderId: 'fx-streak', inputs: { reach: 0.02, angle: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 0.95, saturation: 0.9, gamma: 0.95, autoLevel: 0.15, splitTone: 0.3, shadowTint: [0.46, 0.49, 0.54, 1], highTint: [0.56, 0.53, 0.46, 1] }
  },
  {
    name: 'Hard Mosh',
    fx: [
      { shaderId: 'fx-mosh-blocks', inputs: { blocks: 24, amount: 0.2, chance: 0.4, rate: 0.6, freak: 0.3 } },
      { shaderId: 'fx-slice-shuffle', inputs: { slices: 24, amount: 0.15, chance: 0.4, rate: 0.5 } },
      { shaderId: 'fx-chroma-shift', inputs: { amount: 0.012, angle: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.15, saturation: 1.15, gamma: 1, autoLevel: 0.3, splitTone: 0 }
  },
  {
    name: 'Melt',
    fx: [
      { shaderId: 'fx-smear', inputs: { reach: 0.2, threshold: 0.35, angle: 4.7124 } },
      { shaderId: 'fx-displace', inputs: { amount: 0.05, scale: 3, rate: 0.2 } },
      { shaderId: 'fx-grade', inputs: { saturation: 0.8, contrast: 1.05 } }
    ],
    vibe: { mixSrc: 1, contrast: 1, saturation: 0.85, gamma: 1.1, autoLevel: 0.2, splitTone: 0 }
  },
  {
    name: 'Terminal',
    fx: [
      { shaderId: 'fx-palette', inputs: { stops: 3, blend: 1, dither: 0.2, mixSrc: 0, colorA: [0.02, 0.04, 0.02, 1], colorB: [0.15, 0.6, 0.25, 1], colorC: [0.75, 0.95, 0.7, 1] } },
      { shaderId: 'fx-scanlines', inputs: { count: 500, darkness: 0.25, roll: 0.02 } },
      { shaderId: 'fx-sharpen', inputs: { amount: 0.8 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 1, gamma: 1, autoLevel: 0.4, splitTone: 0 }
  },
  {
    name: 'Thermal Cam',
    fx: [
      { shaderId: 'fx-palette', inputs: { stops: 5, blend: 1, dither: 0.12, mixSrc: 0, colorA: [0.02, 0.02, 0.06, 1], colorB: [0.25, 0.08, 0.3, 1], colorC: [0.65, 0.15, 0.2, 1], colorD: [0.9, 0.55, 0.2, 1], colorE: [0.95, 0.9, 0.75, 1] } },
      { shaderId: 'fx-pixelate', inputs: { cells: 160 } },
      { shaderId: 'fx-grain', inputs: { character: 0, amount: 0.1, size: 2, mono: 1 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.05, saturation: 1.05, gamma: 1, autoLevel: 0.5, splitTone: 0 }
  },
  {
    name: 'Dusty Projector',
    fx: [
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.25, size: 2, mono: 1 } },
      { shaderId: 'fx-solarize', inputs: { level: 0.75, strength: 0.3, soft: 0.2 } },
      { shaderId: 'fx-streak', inputs: { reach: 0.03, angle: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 0.9, saturation: 0.8, gamma: 0.9, autoLevel: 0.1, splitTone: 0.35, shadowTint: [0.47, 0.47, 0.52, 1], highTint: [0.57, 0.54, 0.45, 1] }
  },
  {
    name: 'Xerox',
    fx: [
      { shaderId: 'fx-threshold', inputs: { level: 0.55, soft: 0.3, invert: 0 } },
      { shaderId: 'fx-grain', inputs: { character: 0, amount: 0.2, size: 2, mono: 1 } },
      { shaderId: 'fx-sharpen', inputs: { amount: 1.2 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.25, saturation: 0.7, gamma: 1, autoLevel: 0.6, splitTone: 0 }
  },
  {
    name: 'Deep Fold',
    fx: [
      { shaderId: 'fx-fold', inputs: { vertical: 0, seam: 0.65, offset: 0.15 } },
      { shaderId: 'fx-chroma-shift', inputs: { amount: 0.01, angle: 1.5708 } },
      { shaderId: 'fx-grade', inputs: { brightness: -0.05, contrast: 1.15 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 0.95, gamma: 1, autoLevel: 0.2, splitTone: 0 }
  },
  {
    name: 'Night Bus',
    fx: [
      { shaderId: 'fx-grade', inputs: { brightness: -0.1, contrast: 1.3, saturation: 0.55, lift: 0.08 } },
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.12, size: 1.5, mono: 1 } },
      { shaderId: 'fx-scanlines', inputs: { count: 600, darkness: 0.1, roll: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.05, saturation: 0.85, gamma: 1.15, autoLevel: 0.1, splitTone: 0.4, shadowTint: [0.44, 0.47, 0.56, 1], highTint: [0.55, 0.52, 0.46, 1] }
  },
  {
    name: 'Shatter',
    fx: [
      { shaderId: 'fx-slice-shuffle', inputs: { slices: 48, amount: 0.3, chance: 0.6, rate: 0.9 } },
      { shaderId: 'fx-mosh-blocks', inputs: { blocks: 32, amount: 0.25, chance: 0.4, rate: 0.7, freak: 0.4 } },
      { shaderId: 'fx-stutter', inputs: { rate: 8, chance: 0.5 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.2, saturation: 1.1, gamma: 1, autoLevel: 0.35, splitTone: 0 }
  },
  {
    name: 'Ghost Signal',
    fx: [
      { shaderId: 'fx-stutter', inputs: { rate: 5, chance: 0.35 } },
      { shaderId: 'fx-chroma-shift', inputs: { amount: 0.02, angle: 0 } },
      { shaderId: 'fx-grain', inputs: { character: 2, amount: 0.25, size: 2, mono: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 0.95, saturation: 0.75, gamma: 1, autoLevel: 0.15, splitTone: 0.3, shadowTint: [0.45, 0.5, 0.53, 1], highTint: [0.53, 0.52, 0.5, 1] }
  },
  {
    name: 'Amber Monitor',
    fx: [
      { shaderId: 'fx-palette', inputs: { stops: 3, blend: 1, dither: 0.15, mixSrc: 0, colorA: [0.04, 0.02, 0.01, 1], colorB: [0.85, 0.55, 0.15, 1], colorC: [1, 0.92, 0.75, 1] } },
      { shaderId: 'fx-scanlines', inputs: { count: 450, darkness: 0.3, roll: 0 } },
      { shaderId: 'fx-sharpen', inputs: { amount: 0.6 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 1.05, gamma: 1, autoLevel: 0.45, splitTone: 0 }
  },
  {
    name: 'Riso Print',
    fx: [
      { shaderId: 'fx-posterize', inputs: { levels: 4, gamma: 1.1 } },
      { shaderId: 'fx-dither', inputs: { levels: 3, scale: 3, amount: 0.8 } },
      { shaderId: 'fx-palette', inputs: { stops: 4, blend: 1, dither: 0.1, mixSrc: 0, colorA: [0.04, 0.02, 0.02, 1], colorB: [0.35, 0.1, 0.08, 1], colorC: [0.7, 0.35, 0.15, 1], colorD: [0.9, 0.85, 0.7, 1] } }
    ],
    vibe: { mixSrc: 1, contrast: 1.05, saturation: 1.1, gamma: 1, autoLevel: 0.3, splitTone: 0 }
  },
  {
    name: 'Underwater',
    fx: [
      { shaderId: 'fx-displace', inputs: { amount: 0.04, scale: 2, rate: 0.1 } },
      { shaderId: 'fx-palette', inputs: { stops: 3, blend: 1, dither: 0, mixSrc: 0.15, colorA: [0.03, 0.1, 0.12, 1], colorB: [0.1, 0.45, 0.5, 1], colorC: [0.7, 0.9, 0.85, 1] } },
      { shaderId: 'fx-streak', inputs: { reach: 0.05, angle: 1.5708 } }
    ],
    vibe: { mixSrc: 1, contrast: 0.95, saturation: 0.9, gamma: 1.05, autoLevel: 0.2, splitTone: 0.3, shadowTint: [0.43, 0.5, 0.55, 1], highTint: [0.5, 0.54, 0.52, 1] }
  },
  {
    name: 'Concrete',
    fx: [
      { shaderId: 'fx-grade', inputs: { saturation: 0, contrast: 1.2, lift: 0.03 } },
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.2, size: 2.5, mono: 1 } },
      { shaderId: 'fx-edge', inputs: { gain: 1.2, blend: 0.25 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.15, saturation: 0.6, gamma: 1, autoLevel: 0.4, splitTone: 0.2, shadowTint: [0.47, 0.48, 0.51, 1], highTint: [0.53, 0.52, 0.49, 1] }
  },
  {
    name: 'Wrap Burn',
    fx: [
      { shaderId: 'fx-solarize', inputs: { level: 0.5, strength: 0.9, soft: 0.15 } },
      { shaderId: 'fx-palette', inputs: { stops: 3, blend: 1, dither: 0.2, mixSrc: 0, colorA: [0.03, 0.02, 0.05, 1], colorB: [0.4, 0.2, 0.55, 1], colorC: [0.95, 0.92, 0.98, 1] } },
      { shaderId: 'fx-grain', inputs: { character: 0, amount: 0.12, size: 1.5, mono: 1 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 1.1, gamma: 0.95, autoLevel: 0.25, splitTone: 0 }
  }
]
