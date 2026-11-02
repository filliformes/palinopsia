// The Sonify Synth's factory sounds : named patches of the engine's static
// config (synth.engine.js setConfig), curated by ear. The play side offers
// them in the Synth's preset menu; the picture patchbay is not part of a patch
// (a sound keeps whatever the picture is wired to).

export type SynthEngineId = 'dco' | 'ms' | 'swarm' | 'fm' | 'modal' | 'voice' | 'fold' | 'pluck'
export type SynthFilterId = 'ladder' | 'ms' | 'morph'

export interface SynthSound {
  engine: SynthEngineId
  timbre: number
  harmonics: number
  morph: number
  voices: 'poly' | 'unison' | 'mono'
  filter: SynthFilterId
  cutoff: number
  reso: number
  drive: number
  hpf: number
  fmode: number
  envAmt: number
  attack: number
  decay: number
  sustain: number
  release: number
  glide: number
  drift: number
  chorus: 0 | 1 | 2
  level: number
}

export interface SynthPatch {
  name: string
  /** One line : what it sounds like. */
  blurb: string
  sound: SynthSound
}

/** Filled by the sound side (two or more per engine). Empty until then. */
export const SYNTH_PATCHES: SynthPatch[] = []
