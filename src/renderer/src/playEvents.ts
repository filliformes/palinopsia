// A clocked thing started or stopped on purpose : its play button, a MIDI pad,
// OSC (the Sonify step and key sequences, the scene sequencer, the MIDI clock
// out). With Ableton Link's start / stop sync, the first one started plays
// every linked app and the last one stopped stops them (./link.ts). What Link's
// own play or stop starts and stops is not on purpose and never comes back
// through here. No store import, so the store can call it.

export type PlayThing = 'soniSeq' | 'keySeq' | 'scenes' | 'clock'

const edited = new Set<(what: PlayThing, on: boolean) => void>()

export function onPlayEdited(fn: (what: PlayThing, on: boolean) => void): () => void {
  edited.add(fn)
  return () => { edited.delete(fn) }
}

export function playEdited(what: PlayThing, on: boolean): void {
  for (const fn of edited) {
    try { fn(what, on) } catch (e) { console.warn('[play] listener', e) }
  }
}
