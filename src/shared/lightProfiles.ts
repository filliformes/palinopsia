// Built-in fixture profiles : the common kinds of lights, by their channels. A
// fixture set from one gets its channels in the right order and its held values;
// any real light can also be read from an Open Fixture Library file
// (renderer/src/lights/ofl.ts). Names describe the light, never a brand.

import type { LightProfile } from './lights'

export const BUILTIN_PROFILES: LightProfile[] = [
  { id: 'b:rgb-strip', name: 'Pixel strip, RGB', kind: 'strip', head: '', layout: 'RGB', tail: '' },
  { id: 'b:grb-strip', name: 'Pixel strip, GRB (most addressable strips)', kind: 'strip', head: '', layout: 'GRB', tail: '' },
  { id: 'b:grbw-strip', name: 'Pixel strip, GRBW (RGBW strips)', kind: 'strip', head: '', layout: 'GRBW', tail: '' },
  { id: 'b:bar-head', name: 'LED bar : dimmer and strobe, then RGB pixels', kind: 'strip', head: 'D S', layout: 'RGB', tail: '', pixels: 8 },
  { id: 'b:bar-head-w', name: 'LED bar : dimmer and strobe, then RGBW pixels', kind: 'strip', head: 'D S', layout: 'RGBW', tail: '', pixels: 8 },
  { id: 'b:rgb', name: 'RGB light, 3 channels', kind: 'spot', head: '', layout: 'RGB', tail: '' },
  { id: 'b:rgbw', name: 'RGBW light, 4 channels', kind: 'spot', head: '', layout: 'RGBW', tail: '' },
  { id: 'b:drgb', name: 'Dimmer + RGB, 4 channels', kind: 'spot', head: '', layout: 'D R G B', tail: '' },
  { id: 'b:drgbs', name: 'Dimmer + RGB + strobe, 5 channels', kind: 'spot', head: '', layout: 'D R G B S', tail: '' },
  { id: 'b:drgbws', name: 'Dimmer + RGBW + strobe, 6 channels', kind: 'spot', head: '', layout: 'D R G B W S', tail: '' },
  { id: 'b:rgbwau', name: 'RGBWA + UV, 6 channels', kind: 'spot', head: '', layout: 'R G B W A U', tail: '' },
  { id: 'b:drgbwaus', name: 'Dimmer + RGBWA + UV + strobe, 8 channels', kind: 'spot', head: '', layout: 'D R G B W A U S', tail: '' },
  { id: 'b:d16rgbw', name: '16-bit dimmer + RGBW, 6 channels', kind: 'spot', head: '', layout: 'D16 R G B W', tail: '' },
  { id: 'b:dcmy', name: 'Color mixing : dimmer + CMY, 4 channels', kind: 'spot', head: '', layout: 'D C M Y', tail: '' },
  { id: 'b:dimmer', name: 'Dimmer, 1 channel (a white or a lamp)', kind: 'spot', head: '', layout: 'L', tail: '' },
  { id: 'b:dimmer16', name: 'Dimmer, 16 bits, 2 channels', kind: 'spot', head: '', layout: 'L16', tail: '' },
  { id: 'b:panel', name: 'LED panel, RGB pixels', kind: 'matrix', head: '', layout: 'RGB', tail: '', cols: 8, rows: 8 }
]
