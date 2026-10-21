// A tempo set on purpose : the BPM box, tap tempo, a MIDI control, OSC. Ableton
// Link proposes it to every app in the session (./link.ts). A session, a scene,
// Randomize or a morph setting the BPM is not on purpose, and while other apps
// are linked their tempo wins over those. No store import, so the store can call it.

const edited = new Set<(bpm: number) => void>()

export function onTempoEdited(fn: (bpm: number) => void): () => void {
  edited.add(fn)
  return () => { edited.delete(fn) }
}

// A BPM being typed in the box is set on purpose only once it settles (Enter,
// or leaving the box) : the box keeps the typing to itself until then, so the
// "1" on the way to "130" never comes through here, nor reaches the store.
export function tempoEdited(bpm: number): void {
  if (!Number.isFinite(bpm)) return
  for (const fn of edited) {
    try { fn(bpm) } catch (e) { console.warn('[tempo] listener', e) }
  }
}
