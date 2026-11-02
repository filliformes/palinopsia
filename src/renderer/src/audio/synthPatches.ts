// The Sonify Synth's factory sounds : named patches of the engine's static
// config (synth.engine.js setConfig), curated by ear. The play side offers
// them in the Synth's preset menu; the picture patchbay is not part of a patch
// (a sound keeps whatever the picture is wired to).
//
// Each patch's `level` lands it on the same loudness as the others on the
// standard phrase (tools/synth-render.cjs calibrate : -20 LUFS, within 1 dB),
// so moving through the menu never jumps in level.

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

/** Two or more per engine, in engine order. */
export const SYNTH_PATCHES: SynthPatch[] = [
  {
    name: 'Brass Section',
    blurb: 'Thick detuned saws through the ladder, the brightness swelling in on each note, chorus I.',
    sound: { engine: 'dco', timbre: 0.67, harmonics: 0.3, morph: 0, voices: 'poly', filter: 'ladder', cutoff: 0.52, reso: 0.18, drive: 0.15, hpf: 0.05, fmode: 0, envAmt: 0.42, attack: 0.42, decay: 0.6, sustain: 0.65, release: 0.5, glide: 0, drift: 0.35, chorus: 1, level: 0.743 },
  },
  {
    name: 'Sync Lead',
    blurb: 'A mono lead with the second oscillator hard-synced and gliding, bright and vocal.',
    sound: { engine: 'dco', timbre: 0.67, harmonics: 0.05, morph: 0.42, voices: 'mono', filter: 'ladder', cutoff: 0.6, reso: 0.25, drive: 0.25, hpf: 0.08, fmode: 0, envAmt: 0.3, attack: 0.12, decay: 0.55, sustain: 0.75, release: 0.4, glide: 0.32, drift: 0.3, chorus: 0, level: 0.615 },
  },
  {
    name: 'Cross Metal',
    blurb: 'The two oscillators cross-clocked into a hollow, ringing metal; short and percussive.',
    sound: { engine: 'dco', timbre: 0.4, harmonics: 0.6, morph: 0.9, voices: 'poly', filter: 'ladder', cutoff: 0.55, reso: 0.3, drive: 0.1, hpf: 0.12, fmode: 0, envAmt: 0.35, attack: 0.05, decay: 0.7, sustain: 0.5, release: 0.55, glide: 0, drift: 0.25, chorus: 1, level: 1.000 },
  },
  {
    name: 'Poly Pad',
    blurb: 'Slow pulse-saw strings with density, chorus II and a long release.',
    sound: { engine: 'dco', timbre: 0.95, harmonics: 0.38, morph: 0, voices: 'poly', filter: 'ladder', cutoff: 0.5, reso: 0.12, drive: 0.05, hpf: 0.1, fmode: 0, envAmt: 0.15, attack: 0.72, decay: 0.7, sustain: 0.8, release: 0.72, glide: 0, drift: 0.45, chorus: 2, level: 0.715 },
  },
  {
    name: 'Squelch Bass',
    blurb: 'Saw and square into the two-pole high and low pass at high peak, snapping open on every note.',
    sound: { engine: 'ms', timbre: 0.45, harmonics: 0.25, morph: 0.35, voices: 'mono', filter: 'ms', cutoff: 0.22, reso: 0.82, drive: 0.2, hpf: 0.08, fmode: 0, envAmt: 0.6, attack: 0.02, decay: 0.45, sustain: 0.25, release: 0.32, glide: 0.18, drift: 0.35, chorus: 0, level: 0.691 },
  },
  {
    name: 'Ring Bells',
    blurb: 'The ring modulator on a climbing second oscillator : clangorous bells with a quick decay.',
    sound: { engine: 'ms', timbre: 0.15, harmonics: 0.88, morph: 0.1, voices: 'poly', filter: 'ms', cutoff: 0.7, reso: 0.3, drive: 0, hpf: 0.15, fmode: 0, envAmt: 0.2, attack: 0.02, decay: 0.68, sustain: 0.1, release: 0.6, glide: 0, drift: 0.3, chorus: 1, level: 0.866 },
  },
  {
    name: 'Noise Lead',
    blurb: 'A narrow pulse with noise and drive pushed into the filter : a rough, breathy lead.',
    sound: { engine: 'ms', timbre: 0.9, harmonics: 0.5, morph: 0.7, voices: 'mono', filter: 'ms', cutoff: 0.5, reso: 0.55, drive: 0.1, hpf: 0.12, fmode: 0, envAmt: 0.25, attack: 0.15, decay: 0.6, sustain: 0.7, release: 0.45, glide: 0.25, drift: 0.4, chorus: 0, level: 0.309 },
  },
  {
    name: 'Firefly Swarm',
    blurb: 'Each note a cloud of chirping oscillators pulsing at their own rates, scattered by fifths.',
    sound: { engine: 'swarm', timbre: 0.3, harmonics: 0.75, morph: 0.72, voices: 'poly', filter: 'morph', cutoff: 0.72, reso: 0.25, drive: 0, hpf: 0.1, fmode: 0.15, envAmt: 0, attack: 0.3, decay: 0.7, sustain: 0.8, release: 0.65, glide: 0, drift: 0.4, chorus: 1, level: 0.763 },
  },
  {
    name: 'Drone Cloud',
    blurb: 'A wide unpulsed swarm of saws and triangles, slowly breathing, chorus II.',
    sound: { engine: 'swarm', timbre: 0.5, harmonics: 1, morph: 0, voices: 'poly', filter: 'ladder', cutoff: 0.5, reso: 0.15, drive: 0, hpf: 0.08, fmode: 0, envAmt: 0.1, attack: 0.78, decay: 0.75, sustain: 0.9, release: 0.75, glide: 0, drift: 0.55, chorus: 2, level: 0.785 },
  },
  {
    name: 'Stutter Choir',
    blurb: 'Swarms of sines blinking fast enough to blur into a trembling choir.',
    sound: { engine: 'swarm', timbre: 0.15, harmonics: 0.45, morph: 0.82, voices: 'poly', filter: 'ladder', cutoff: 0.68, reso: 0.2, drive: 0, hpf: 0.05, fmode: 0, envAmt: 0.05, attack: 0.4, decay: 0.7, sustain: 0.85, release: 0.6, glide: 0, drift: 0.35, chorus: 2, level: 1.000 },
  },
  {
    name: 'Electric Piano',
    blurb: 'Two operators at 1 : 1, a bright tine on the strike that mellows as the note rings.',
    sound: { engine: 'fm', timbre: 0.42, harmonics: 1 / 15, morph: 0.1, voices: 'poly', filter: 'ladder', cutoff: 0.85, reso: 0.05, drive: 0.1, hpf: 0.08, fmode: 0, envAmt: 0, attack: 0.05, decay: 0.72, sustain: 0.3, release: 0.55, glide: 0, drift: 0.2, chorus: 1, level: 0.670 },
  },
  {
    name: 'Glass Bell',
    blurb: 'An inharmonic 3.7 ratio, struck bright, the shimmer dying long before the tone.',
    sound: { engine: 'fm', timbre: 0.55, harmonics: 6 / 15, morph: 0, voices: 'poly', filter: 'ladder', cutoff: 0.92, reso: 0, drive: 0, hpf: 0.1, fmode: 0, envAmt: 0, attack: 0.02, decay: 0.85, sustain: 0, release: 0.75, glide: 0, drift: 0.15, chorus: 1, level: 0.299 },
  },
  {
    name: 'Growl Bass',
    blurb: 'The modulator an octave under, its feedback biting into the shaper : a gritty mono bass.',
    sound: { engine: 'fm', timbre: 0.6, harmonics: 0, morph: 0.55, voices: 'mono', filter: 'ladder', cutoff: 0.45, reso: 0.2, drive: 0.15, hpf: 0.05, fmode: 0, envAmt: 0.3, attack: 0.03, decay: 0.55, sustain: 0.55, release: 0.3, glide: 0.15, drift: 0.25, chorus: 0, level: 0.751 },
  },
  {
    name: 'Marimba',
    blurb: 'A soft mallet on a wooden bar : warm, dry and short.',
    sound: { engine: 'modal', timbre: 0.3, harmonics: 0.5, morph: 0.55, voices: 'poly', filter: 'ladder', cutoff: 0.9, reso: 0, drive: 0, hpf: 0.08, fmode: 0, envAmt: 0, attack: 0, decay: 0.8, sustain: 0, release: 0.6, glide: 0, drift: 0.15, chorus: 0, level: 0.445 },
  },
  {
    name: 'Temple Bell',
    blurb: 'A hard strike on a bell, every partial ringing out for seconds.',
    sound: { engine: 'modal', timbre: 0.78, harmonics: 1, morph: 0.12, voices: 'poly', filter: 'ladder', cutoff: 0.95, reso: 0, drive: 0, hpf: 0.1, fmode: 0, envAmt: 0, attack: 0, decay: 0.95, sustain: 0.2, release: 0.85, glide: 0, drift: 0.1, chorus: 1, level: 0.199 },
  },
  {
    name: 'Bowed Glass',
    blurb: 'Stiff-string modes struck softly then bowed while the note is held : a singing glass.',
    sound: { engine: 'modal', timbre: 0.15, harmonics: 0.3, morph: 0.25, voices: 'poly', filter: 'morph', cutoff: 0.8, reso: 0.2, drive: 0, hpf: 0.1, fmode: 0.1, envAmt: 0, attack: 0.55, decay: 0.85, sustain: 0.9, release: 0.7, glide: 0, drift: 0.2, chorus: 2, level: 0.624 },
  },
  {
    name: 'Choir Ah',
    blurb: 'Open-throated voices on a slow attack, a touch of breath, chorus II.',
    sound: { engine: 'voice', timbre: 0, harmonics: 0.42, morph: 0.18, voices: 'poly', filter: 'ladder', cutoff: 0.82, reso: 0.05, drive: 0, hpf: 0.1, fmode: 0, envAmt: 0, attack: 0.62, decay: 0.7, sustain: 0.9, release: 0.65, glide: 0, drift: 0.5, chorus: 2, level: 0.419 },
  },
  {
    name: 'Whisper',
    blurb: 'Breath alone through the formants, on an o that closes toward u.',
    sound: { engine: 'voice', timbre: 0.85, harmonics: 0.55, morph: 0.85, voices: 'poly', filter: 'morph', cutoff: 0.85, reso: 0.1, drive: 0, hpf: 0.12, fmode: 0.2, envAmt: 0, attack: 0.5, decay: 0.7, sustain: 0.85, release: 0.6, glide: 0, drift: 0.3, chorus: 1, level: 0.848 },
  },
  {
    name: 'Vowel Lead',
    blurb: 'A small bright throat singing an e, mono and gliding.',
    sound: { engine: 'voice', timbre: 0.28, harmonics: 0.72, morph: 0.05, voices: 'mono', filter: 'ladder', cutoff: 0.85, reso: 0.1, drive: 0.2, hpf: 0.1, fmode: 0, envAmt: 0, attack: 0.25, decay: 0.6, sustain: 0.85, release: 0.45, glide: 0.35, drift: 0.4, chorus: 0, level: 0.572 },
  },
  {
    name: 'West Coast Pluck',
    blurb: 'A folded sine through a low-pass gate that pings on every note : the classic plucked bongo.',
    sound: { engine: 'fold', timbre: 0.55, harmonics: 0.35, morph: 1, voices: 'poly', filter: 'ladder', cutoff: 0.95, reso: 0, drive: 0, hpf: 0.08, fmode: 0, envAmt: 0, attack: 0, decay: 0.55, sustain: 1, release: 0.5, glide: 0, drift: 0.2, chorus: 0, level: 0.710 },
  },
  {
    name: 'Folded Bass',
    blurb: 'A triangle folded hard with even harmonics, the gate half open : a round, buzzing bass.',
    sound: { engine: 'fold', timbre: 0.7, harmonics: 0.75, morph: 0.4, voices: 'mono', filter: 'ladder', cutoff: 0.6, reso: 0.15, drive: 0.1, hpf: 0.05, fmode: 0, envAmt: 0.2, attack: 0.02, decay: 0.55, sustain: 0.7, release: 0.3, glide: 0.12, drift: 0.3, chorus: 0, level: 0.639 },
  },
  {
    name: 'Nylon Guitar',
    blurb: 'A plucked nylon string, picked midway, soft and warm.',
    sound: { engine: 'pluck', timbre: 0.5, harmonics: 0.05, morph: 0.35, voices: 'poly', filter: 'ladder', cutoff: 0.92, reso: 0, drive: 0, hpf: 0.08, fmode: 0, envAmt: 0, attack: 0, decay: 0.85, sustain: 0.85, release: 0.55, glide: 0, drift: 0.15, chorus: 1, level: 0.528 },
  },
  {
    name: 'Steel Harp',
    blurb: 'Bright steel strings picked near the bridge, ringing long, a little stretched.',
    sound: { engine: 'pluck', timbre: 0.85, harmonics: 0.22, morph: 0.05, voices: 'poly', filter: 'ladder', cutoff: 0.95, reso: 0, drive: 0, hpf: 0.1, fmode: 0, envAmt: 0, attack: 0, decay: 0.9, sustain: 0.9, release: 0.75, glide: 0, drift: 0.1, chorus: 2, level: 0.431 },
  },
  {
    name: 'Muted Kalimba',
    blurb: 'Stiff, damped tines : a short metallic plink with a woody body.',
    sound: { engine: 'pluck', timbre: 0.7, harmonics: 0.65, morph: 0.62, voices: 'poly', filter: 'ladder', cutoff: 0.9, reso: 0.05, drive: 0, hpf: 0.1, fmode: 0, envAmt: 0, attack: 0, decay: 0.8, sustain: 0.8, release: 0.5, glide: 0, drift: 0.1, chorus: 0, level: 0.667 },
  },
]
