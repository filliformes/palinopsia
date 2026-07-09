// Master-chain presets : 20 whole-rack chains for the master bus. Applying
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
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.12, size: 1.8, chroma: 0 } }
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
      { shaderId: 'fx-grain', inputs: { character: 2, amount: 0.2, size: 2, chroma: 0.5 } },
      { shaderId: 'fx-scanlines', inputs: { count: 400, darkness: 0.3, roll: 0.1 } },
      { shaderId: 'fx-chroma-shift', inputs: { amount: 0.008, angle: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.05, saturation: 1.1, gamma: 1, autoLevel: 0.2, splitTone: 0.25, shadowTint: [0.46, 0.48, 0.54, 1], highTint: [0.56, 0.52, 0.44, 1] }
  },
  {
    name: 'Soft Film',
    fx: [
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.15, size: 1.5, chroma: 0 } },
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
      { shaderId: 'fx-grain', inputs: { character: 0, amount: 0.1, size: 2, chroma: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.05, saturation: 1.05, gamma: 1, autoLevel: 0.5, splitTone: 0 }
  },
  {
    name: 'Dusty Projector',
    fx: [
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.25, size: 2, chroma: 0 } },
      { shaderId: 'fx-solarize', inputs: { level: 0.75, strength: 0.3, soft: 0.2 } },
      { shaderId: 'fx-streak', inputs: { reach: 0.03, angle: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 0.9, saturation: 0.8, gamma: 0.9, autoLevel: 0.1, splitTone: 0.35, shadowTint: [0.47, 0.47, 0.52, 1], highTint: [0.57, 0.54, 0.45, 1] }
  },
  {
    name: 'Xerox',
    fx: [
      { shaderId: 'fx-threshold', inputs: { level: 0.55, soft: 0.3, invert: 0 } },
      { shaderId: 'fx-grain', inputs: { character: 0, amount: 0.2, size: 2, chroma: 0 } },
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
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.12, size: 1.5, chroma: 0 } },
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
      { shaderId: 'fx-grain', inputs: { character: 2, amount: 0.25, size: 2, chroma: 0.5 } }
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
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.2, size: 2.5, chroma: 0 } },
      { shaderId: 'fx-edge', inputs: { gain: 1.2, blend: 0.25 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.15, saturation: 0.6, gamma: 1, autoLevel: 0.4, splitTone: 0.2, shadowTint: [0.47, 0.48, 0.51, 1], highTint: [0.53, 0.52, 0.49, 1] }
  },
  {
    name: 'Wrap Burn',
    fx: [
      { shaderId: 'fx-solarize', inputs: { level: 0.5, strength: 0.9, soft: 0.15 } },
      { shaderId: 'fx-palette', inputs: { stops: 3, blend: 1, dither: 0.2, mixSrc: 0, colorA: [0.03, 0.02, 0.05, 1], colorB: [0.4, 0.2, 0.55, 1], colorC: [0.95, 0.92, 0.98, 1] } },
      { shaderId: 'fx-grain', inputs: { character: 0, amount: 0.12, size: 1.5, chroma: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 1.1, gamma: 0.95, autoLevel: 0.25, splitTone: 0 }
  },
  {
    name: 'Chiaroscuro',
    fx: [
      { shaderId: 'fx-grade', inputs: { contrast: 1.6, saturation: 0.6, brightness: -0.05, lift: 0 } },
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.1, size: 1.5, chroma: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.4, saturation: 0.5, autoLevel: 0.3, splitTone: 0.3, shadowTint: [0.42, 0.44, 0.5, 1], highTint: [0.55, 0.52, 0.46, 1] }
  },
  {
    name: 'Sfumato',
    fx: [
      { shaderId: 'fx-streak', inputs: { reach: 0.03, angle: 1.5708 } },
      { shaderId: 'fx-grade', inputs: { contrast: 0.9, saturation: 0.85, lift: 0.05 } }
    ],
    vibe: { mixSrc: 1, contrast: 0.95, saturation: 0.85, gamma: 1.05, autoLevel: 0.15, splitTone: 0.25, shadowTint: [0.46, 0.48, 0.52, 1], highTint: [0.55, 0.52, 0.47, 1] }
  },
  {
    name: 'Pointillism',
    fx: [
      { shaderId: 'fx-pixelate', inputs: { cells: 220 } },
      { shaderId: 'fx-dither', inputs: { levels: 3, scale: 2, amount: 1 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.05, saturation: 1.15, autoLevel: 0.2 }
  },
  {
    name: 'Daguerreotype',
    fx: [
      { shaderId: 'fx-grade', inputs: { saturation: 0, contrast: 1.3, lift: 0.03 } },
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.12, size: 1.5, chroma: 0 } },
      { shaderId: 'fx-sharpen', inputs: { amount: 0.8 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.2, saturation: 0, gamma: 1.05, autoLevel: 0.4, splitTone: 0.3, shadowTint: [0.44, 0.46, 0.5, 1], highTint: [0.54, 0.52, 0.48, 1] }
  },
  {
    name: 'Solarisation',
    fx: [
      { shaderId: 'fx-solarize', inputs: { level: 0.55, strength: 0.85, soft: 0.12 } },
      { shaderId: 'fx-grade', inputs: { contrast: 1.15, saturation: 0.8 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 0.75, autoLevel: 0.25 }
  },
  {
    name: 'Photogram',
    fx: [
      { shaderId: 'fx-threshold', inputs: { level: 0.4, soft: 0.1, invert: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 0, autoLevel: 0.5 }
  },
  {
    name: 'Woodcut',
    fx: [
      { shaderId: 'fx-edge', inputs: { gain: 2.5, blend: 0.7 } },
      { shaderId: 'fx-threshold', inputs: { level: 0.5, soft: 0.05, invert: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.2, saturation: 0, autoLevel: 0.3 }
  },
  {
    name: 'Etching',
    fx: [
      { shaderId: 'fx-edge', inputs: { gain: 2, blend: 0.5 } },
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.15, size: 2, chroma: 0 } },
      { shaderId: 'fx-colorizer', inputs: { gain: 1.2, bias: 0.05, fold: 0, mixSrc: 0, low: [0.08, 0.05, 0.03, 1], mid: [0.5, 0.38, 0.24, 1], high: [0.95, 0.9, 0.78, 1] } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 1, autoLevel: 0.2 }
  },
  {
    name: 'Serigraphy',
    fx: [
      { shaderId: 'fx-posterize', inputs: { levels: 4, gamma: 1.1 } },
      { shaderId: 'fx-palette', inputs: { stops: 4, blend: 0.2, dither: 0.1, mixSrc: 0, colorA: [0.05, 0.05, 0.08, 1], colorB: [0.85, 0.2, 0.3, 1], colorC: [0.95, 0.8, 0.2, 1], colorD: [0.95, 0.95, 0.9, 1] } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 1.1, autoLevel: 0.2 }
  },
  {
    name: 'Halftone',
    fx: [
      { shaderId: 'fx-posterize', inputs: { levels: 3, gamma: 1 } },
      { shaderId: 'fx-dither', inputs: { levels: 2, scale: 3, amount: 1 } },
      { shaderId: 'fx-sharpen', inputs: { amount: 1 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.15, saturation: 1, autoLevel: 0.3 }
  },
  {
    name: 'Fresco',
    fx: [
      { shaderId: 'fx-grade', inputs: { saturation: 0.7, contrast: 0.95, lift: 0.06 } },
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.18, size: 2.5, chroma: 0.5 } }
    ],
    vibe: { mixSrc: 1, contrast: 0.95, saturation: 0.8, gamma: 1.05, autoLevel: 0.15, splitTone: 0.35, shadowTint: [0.47, 0.46, 0.5, 1], highTint: [0.57, 0.53, 0.45, 1] }
  },
  {
    name: 'Impasto',
    fx: [
      { shaderId: 'fx-displace', inputs: { amount: 0.02, scale: 6, rate: 0.05 } },
      { shaderId: 'fx-sharpen', inputs: { amount: 1.5 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 1.05, autoLevel: 0.2 }
  },
  {
    name: 'Collage',
    fx: [
      { shaderId: 'fx-slice-shuffle', inputs: { slices: 16, amount: 0.12, chance: 0.35, rate: 0.3 } },
      { shaderId: 'fx-mosh-blocks', inputs: { blocks: 16, amount: 0.15, chance: 0.3, rate: 0.4, freak: 0.2 } },
      { shaderId: 'fx-chroma-shift', inputs: { amount: 0.008, angle: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.05, saturation: 1.05, autoLevel: 0.2 }
  },
  {
    name: 'Photomontage',
    fx: [
      { shaderId: 'fx-mosh-blocks', inputs: { blocks: 12, amount: 0.2, chance: 0.25, rate: 0.3, freak: 0.35 } },
      { shaderId: 'fx-chroma-shift', inputs: { amount: 0.012, angle: 1.5708 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 1, autoLevel: 0.2 }
  },
  {
    name: 'Glitch Art',
    fx: [
      { shaderId: 'fx-byte-corrupt', inputs: { depth: 6, scramble: 0.4, blocks: 12, rate: 0.4, chaos: 0.3 } },
      { shaderId: 'fx-slice-shuffle', inputs: { slices: 24, amount: 0.15, chance: 0.4, rate: 0.6 } },
      { shaderId: 'fx-chroma-shift', inputs: { amount: 0.015, angle: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 1.1, autoLevel: 0.2 }
  },
  {
    name: 'Datamosh',
    fx: [
      { shaderId: 'fx-mosh-blocks', inputs: { blocks: 20, amount: 0.25, chance: 0.4, rate: 0.6, freak: 0.4 } },
      { shaderId: 'fx-smear', inputs: { reach: 0.12, threshold: 0.35, angle: 1.5708 } },
      { shaderId: 'fx-stutter', inputs: { rate: 6, chance: 0.4, bands: 1, jitter: 0, blackout: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.05, saturation: 1, autoLevel: 0.15 }
  },
  {
    name: 'Teletext',
    fx: [
      { shaderId: 'fx-pixelate', inputs: { cells: 80 } },
      { shaderId: 'fx-posterize', inputs: { levels: 3, gamma: 1 } },
      { shaderId: 'fx-palette', inputs: { stops: 4, blend: 0, dither: 0, mixSrc: 0, colorA: [0, 0, 0, 1], colorB: [0.1, 0.9, 0.9, 1], colorC: [0.95, 0.9, 0.15, 1], colorD: [0.95, 0.95, 0.95, 1] } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 1.15, autoLevel: 0.2 }
  },
  {
    name: 'Kinetoscope',
    fx: [
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.2, size: 2, chroma: 0, parasites: 0.4 } },
      { shaderId: 'fx-scanlines', inputs: { count: 400, darkness: 0.2, roll: 0.05 } },
      { shaderId: 'fx-triangle-flicker', inputs: { rate: 6, depth: 0.2, hard: 0, swap: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.05, saturation: 0.6, gamma: 1.05, autoLevel: 0.2, splitTone: 0.35, shadowTint: [0.46, 0.45, 0.5, 1], highTint: [0.58, 0.53, 0.44, 1] }
  },
  {
    name: 'Zoetrope',
    fx: [
      { shaderId: 'fx-triangle-flicker', inputs: { rate: 8, depth: 0.5, hard: 1, swap: 0 } },
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.15, size: 2, chroma: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 0.85, autoLevel: 0.2 }
  },
  {
    name: 'Camera Obscura',
    fx: [
      { shaderId: 'fx-streak', inputs: { reach: 0.04, angle: 1.5708 } },
      { shaderId: 'fx-solarize', inputs: { level: 0.7, strength: 0.3, soft: 0.2 } }
    ],
    vibe: { mixSrc: 1, contrast: 0.95, saturation: 0.7, gamma: 1.1, autoLevel: 0.15 }
  },
  {
    name: 'Infrared Film',
    fx: [
      { shaderId: 'fx-palette', inputs: { stops: 4, blend: 1, dither: 0.1, mixSrc: 0.1, colorA: [0.05, 0.02, 0.08, 1], colorB: [0.5, 0.1, 0.4, 1], colorC: [0.9, 0.4, 0.5, 1], colorD: [1, 0.95, 0.9, 1] } },
      { shaderId: 'fx-grain', inputs: { character: 1, amount: 0.12, size: 1.5, chroma: 0.5 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.05, saturation: 1.1, autoLevel: 0.2 }
  },
  {
    name: 'X-Ray',
    fx: [
      { shaderId: 'fx-colorizer', inputs: { gain: 1.4, bias: 0, fold: 0, mixSrc: 0, low: [0.9, 0.95, 1, 1], mid: [0.2, 0.4, 0.6, 1], high: [0.02, 0.03, 0.08, 1] } },
      { shaderId: 'fx-sharpen', inputs: { amount: 0.6 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.15, saturation: 0.9, autoLevel: 0.4 }
  },
  {
    name: 'Thermogram',
    fx: [
      { shaderId: 'fx-pixelate', inputs: { cells: 120 } },
      { shaderId: 'fx-colorizer', inputs: { gain: 1.3, bias: 0, fold: 0.2, mixSrc: 0, low: [0.02, 0.02, 0.1, 1], mid: [0.7, 0.15, 0.4, 1], high: [0.95, 0.9, 0.3, 1] } }
    ],
    vibe: { mixSrc: 1, contrast: 1.05, saturation: 1.1, autoLevel: 0.5 }
  },
  {
    name: 'Op Art',
    fx: [
      { shaderId: 'fx-displace', inputs: { amount: 0.03, scale: 8, rate: 0.1 } },
      { shaderId: 'fx-posterize', inputs: { levels: 2, gamma: 1 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.3, saturation: 0, autoLevel: 0.3 }
  },
  {
    name: 'De Stijl',
    fx: [
      { shaderId: 'fx-posterize', inputs: { levels: 3, gamma: 1 } },
      { shaderId: 'fx-palette', inputs: { stops: 5, blend: 0, dither: 0, mixSrc: 0, colorA: [0.05, 0.05, 0.05, 1], colorB: [0.9, 0.15, 0.12, 1], colorC: [0.95, 0.85, 0.1, 1], colorD: [0.1, 0.3, 0.75, 1], colorE: [0.97, 0.97, 0.95, 1] } }
    ],
    vibe: { mixSrc: 1, contrast: 1.15, saturation: 1.2, autoLevel: 0.2 }
  },
  {
    name: 'Constructivism',
    fx: [
      { shaderId: 'fx-threshold', inputs: { level: 0.5, soft: 0.08, invert: 0 } },
      { shaderId: 'fx-palette', inputs: { stops: 3, blend: 0.3, dither: 0.1, mixSrc: 0, colorA: [0.05, 0.03, 0.03, 1], colorB: [0.8, 0.12, 0.1, 1], colorC: [0.95, 0.92, 0.88, 1] } }
    ],
    vibe: { mixSrc: 1, contrast: 1.2, saturation: 1.1, autoLevel: 0.3 }
  },
  {
    name: 'Futurism',
    fx: [
      { shaderId: 'fx-streak', inputs: { reach: 0.12, angle: 0 } },
      { shaderId: 'fx-chroma-shift', inputs: { amount: 0.01, angle: 0 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 1.05, autoLevel: 0.2 }
  },
  {
    name: 'Vorticism',
    fx: [
      { shaderId: 'fx-distort', inputs: { mode: 4, amount: 0.4, scale: 3, center: [0.5, 0.5], angle: 0, rate: 0 } },
      { shaderId: 'fx-edge', inputs: { gain: 1.5, blend: 0.4 } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 0.9, autoLevel: 0.2 }
  },
  {
    name: 'Ukiyo-e',
    fx: [
      { shaderId: 'fx-edge', inputs: { gain: 1.5, blend: 0.25 } },
      { shaderId: 'fx-posterize', inputs: { levels: 5, gamma: 1.1 } },
      { shaderId: 'fx-palette', inputs: { stops: 4, blend: 0.6, dither: 0.05, mixSrc: 0.2, colorA: [0.08, 0.1, 0.14, 1], colorB: [0.3, 0.4, 0.45, 1], colorC: [0.75, 0.6, 0.5, 1], colorD: [0.95, 0.92, 0.85, 1] } }
    ],
    vibe: { mixSrc: 1, contrast: 1.05, saturation: 1, autoLevel: 0.2 }
  },
  {
    name: 'Demoscene',
    fx: [
      { shaderId: 'fx-feedback-zoom', inputs: { zoom: 1.03, twist: 0.03, amount: 0.6 } },
      { shaderId: 'fx-chroma-shift', inputs: { amount: 0.012, angle: 0 } },
      { shaderId: 'fx-palette', inputs: { stops: 4, blend: 1, dither: 0.1, mixSrc: 0.15, colorA: [0.02, 0.02, 0.08, 1], colorB: [0.2, 0.1, 0.6, 1], colorC: [0.7, 0.2, 0.6, 1], colorD: [0.95, 0.9, 0.95, 1] } }
    ],
    vibe: { mixSrc: 1, contrast: 1.1, saturation: 1.15, autoLevel: 0.2 }
  }
]
