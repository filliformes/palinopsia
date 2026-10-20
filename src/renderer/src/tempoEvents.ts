// A tempo set on purpose : the BPM box, tap tempo, a MIDI control, OSC. Ableton
// Link proposes it to every app in the session (./link.ts). A session, a scene,
// Randomize or a morph setting the BPM is not on purpose, and while other apps
// are linked their tempo wins over those. No store import, so the store can call it.

const edited = new Set<(bpm: number) => void>()

export function onTempoEdited(fn: (bpm: number) => void): () => void {
  edited.add(fn)
  return () => { edited.delete(fn) }
}

export function tempoEdited(bpm: number): void {
  if (!Number.isFinite(bpm)) return
  for (const fn of edited) {
    try { fn(bpm) } catch (e) { console.warn('[tempo] listener', e) }
  }
}

// A BPM being typed in the box : each keystroke sets Palinopsia's own tempo, but
// none is settled (typing "130" passes through 1 and 13, both clamped to the
// floor of 20). While it lasts, Link neither hears the box nor writes the
// session's tempo over it; the box ends it, then sends the settled number
// through tempoEdited().
let typing = false
export function tempoTyping(on: boolean): void {
  typing = on
}
export const isTempoTyping = (): boolean => typing
