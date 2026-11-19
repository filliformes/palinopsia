// Pickup (soft takeover) for MIDI faders and knobs. After a scene recall, a
// session load, an undo, a morph or a mouse drag, a fader's physical position
// no longer matches the value it drives : with "jump" (the default, as always)
// the first touch snaps the value to the fader; with "pickup", the fader does
// nothing until it reaches the value (passes it, or comes within a step and a
// half of it), then follows.
//
// No event says "the value moved by other means" : each message compares the
// value now with the one this control left there at its last write (one frame
// of faders lands together, midi.ts flushContinuous), and when they differ the
// control lets go and waits to pick it up again. So whatever moved it (a scene,
// undo, the mouse, OSC, another fader) re-arms pickup, with nothing to wire.
// The value read is the BASE, never what a modulator plays over it : a
// modulated target would never hold still long enough to be caught.
//
// Pure : the target's value comes in through `read` (midi.ts readContinuous).

/** A step and a half of a 7-bit control : "within reach". */
const TOL = 1.5 / 127
/** A value this close to the one left there is the same value. */
const SAME = 1e-4

interface Pick {
  engaged: boolean
  /** the control's last position (null : not heard yet) */
  prev: number | null
  /** the value this control's last write left (NaN : none yet) */
  left: number
}

// by target, then by input ('cc:0:21' …) : one fader may play several targets,
// and several inputs one target
const picks = new Map<string, Map<string, Pick>>()

/** May this control's value `t` go to target `id` now? (Updates the state.)
 *  `cur` : the target's base value now, 0..1 (null : it has none, so nothing
 *  to pick up : it plays). */
export function pickupPass(input: string, id: string, t: number, cur: number | null): boolean {
  if (cur == null || !Number.isFinite(cur)) return true
  let byIn = picks.get(id)
  if (!byIn) picks.set(id, (byIn = new Map()))
  let p = byIn.get(input)
  if (!p) byIn.set(input, (p = { engaged: false, prev: null, left: NaN }))
  // moved by other means since this control's last write : let go
  if (p.engaged && Number.isFinite(p.left) && Math.abs(cur - p.left) > SAME) p.engaged = false
  if (!p.engaged) {
    const crossed = p.prev != null && (p.prev - cur) * (t - cur) <= 0
    if (crossed || Math.abs(t - cur) <= TOL) {
      p.engaged = true
      p.left = NaN // (set at the write)
    }
  }
  p.prev = t
  return p.engaged
}

/** The target `id` was just written (by MIDI) : what it holds now is what the
 *  control that wrote it (`input`) left there. The other engaged controls on the
 *  same target see the change at their next message and let go, as they would
 *  for a scene or the mouse. */
export function pickupWritten(id: string, cur: number | null, input?: string): void {
  const byIn = picks.get(id)
  if (!byIn || cur == null) return
  if (input != null) {
    const p = byIn.get(input)
    if (p?.engaged) p.left = cur
    return
  }
  for (const p of byIn.values()) if (p.engaged) p.left = cur
}

/** The controls waiting to pick their value up : target id → input → where
 *  the control is (0..1), for the MIDI panel. */
export function pickupWaiting(): Array<{ id: string; input: string; at: number }> {
  const out: Array<{ id: string; input: string; at: number }> = []
  for (const [id, byIn] of picks) {
    for (const [input, p] of byIn) if (!p.engaged && p.prev != null) out.push({ id, input, at: p.prev })
  }
  return out
}

/** Re-check an engaged control against the value now (the panel's hint : a
 *  scene recalled since the last message shows as waiting at once). */
export function pickupRecheck(id: string, cur: number | null): void {
  const byIn = picks.get(id)
  if (!byIn || cur == null) return
  for (const p of byIn.values()) {
    if (p.engaged && Number.isFinite(p.left) && Math.abs(cur - p.left) > SAME) p.engaged = false
  }
}

/** A pickup control plays this target (its writes are watched). */
export const pickupTracks = (id: string): boolean => picks.has(id)

/** Every target a pickup control plays. */
export const pickupTrackedIds = (): string[] => [...picks.keys()]

/** Forget a target's pickup state (its mapping cleared or set to jump). */
export function pickupForget(id?: string): void {
  if (id == null) picks.clear()
  else picks.delete(id)
}

/** The input key of a MIDI binding (the same one sameMidiInput compares). */
export const pickupInputKey = (kind: string, channel: number, number: number): string => `${kind}:${channel}:${number}`
