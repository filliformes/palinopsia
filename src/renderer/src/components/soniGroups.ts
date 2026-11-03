// The Sonify voices' families : the order every list of the voices shows them
// in (the voice cards, the mixer, the effects sequencer, Space), and the color
// that marks each family (the sectioned panels' colors). A voice is named by
// its STORED index (VOICE_KEYS / SPACE_VOICES : what a session saves for its
// mixer channel, filter, sequencer mask and MIDI binding), which never moves :
// only where it is shown does.

import { SECTION_COLORS } from './FinishingSections'

export interface SoniGroup {
  id: string
  color: string
  /** Stored voice indices, in the order they are shown. */
  voices: number[]
  hint: string
}

// spectra 0 · orbit 1 · flow 2 · events 3 · raster 4 · sstv 5 · filter 6 ·
// chord 7 · collage 8 · signal 9 · assemblage 10 · synth 11
export const SONI_GROUPS: SoniGroup[] = [
  { id: 'spectrum', color: SECTION_COLORS.accent2, voices: [0, 6], hint: 'The frame as frequencies : height is the pitch, brightness the loudness. Spectra sings its partials, Filter shapes noise or a live input with them' },
  { id: 'wave', color: SECTION_COLORS.red, voices: [1, 4, 5], hint: 'The pixels are the sound itself : read at audio rate as a waveform (Orbit, Raster) or line by line as a signal (Transmission)' },
  { id: 'hits', color: SECTION_COLORS.amber, voices: [2, 3, 9], hint: 'What moves or stands out fires sounds : grains where it moves (Flow), struck notes on edges and motion (Events), micro-grains under read heads on a clock (Signal)' },
  { id: 'notes', color: SECTION_COLORS.violet, voices: [7, 11], hint: 'Instruments in the key : a chord that breathes with the light (Chord), a synthesizer the moving things play (Synth)' },
  { id: 'films', color: SECTION_COLORS.earth, voices: [8, 10], hint: 'The films\' own sound : a Collage\'s films all at once, an Assemblage\'s cut with the picture' }
]

/** The FX tail's family (one card, not a voice). */
export const SONI_TAIL = {
  id: 'tail',
  color: SECTION_COLORS.neutral,
  hint: 'The delay and the reverb every voice shares'
}

/** Every voice's stored index, in the order the page shows them. */
export const SONI_VOICE_ORDER: number[] = SONI_GROUPS.flatMap((g) => g.voices)

/** The family color of a voice (by its stored index). */
export function soniVoiceColor(i: number): string {
  return SONI_GROUPS.find((g) => g.voices.includes(i))?.color ?? SECTION_COLORS.neutral
}
