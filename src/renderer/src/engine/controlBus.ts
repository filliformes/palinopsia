// The controller bus : what a MIDI or OSC control plays into a modulator slot.
// Each of the eight slots has two inputs :
//   in:<slot>    the Controller type's own (the slot IS the control)
//   take:<slot>  a takeover : the control takes the slot over from its own
//                motion while you play it, and hands it back after
// Which control feeds an input is a learned mapping (MIDI / OSC Learn, target
// ids mod:in:<slot> / mod:take:<slot> : midi.ts), or /opsia/mod/<n>/in · take
// pushes a value straight in (Pandore, dataFLOU). A value is 0..1 (Learn has
// scaled it to the control's range); a note is a gate with its velocity, which
// the modulator plays as an attack / release envelope (modulation.ts).
// Live state : never saved. A slot keeps the last thing it heard.

export interface ControlIn {
  v: number // the value, 0..1
  at: number // when it last moved (performance.now; 0 : never) : the takeover's activity
  note: boolean // a note : gate + velocity, not a value
  gate: boolean
  vel: number // 0..1
}

const ins = new Map<string, ControlIn>()

function entry(key: string): ControlIn {
  let e = ins.get(key)
  if (!e) {
    e = { v: 0, at: 0, note: false, gate: false, vel: 0 }
    ins.set(key, e)
  }
  return e
}

export const controlBus = {
  /** A value (0..1) played into an input : it counts as a move only when it
   *  changed (a controller resending where it sits is not a hand on it). */
  set(key: string, v01: number): void {
    const v = v01 < 0 ? 0 : v01 > 1 ? 1 : Number.isFinite(v01) ? v01 : 0
    const e = entry(key)
    const moved = e.note || Math.abs(v - e.v) > 1e-6 || e.at === 0
    e.note = false
    e.v = v
    if (moved) e.at = performance.now()
  },
  /** A note on (with its velocity, 0..1) or off. */
  note(key: string, on: boolean, vel = 1): void {
    const e = entry(key)
    e.note = true
    e.gate = on
    if (on) e.vel = vel < 0 ? 0 : vel > 1 ? 1 : vel
    e.at = performance.now()
  },
  get(key: string): ControlIn | undefined {
    return ins.get(key)
  },
  /** Forget an input (its mapping cleared) : the slot holds what it had. */
  clear(key: string): void {
    ins.delete(key)
  }
}

/** The bus key of a learn target id (mod:in:3 → in:3), or null. */
export function controlKeyOf(id: string): string | null {
  const m = /^mod:(in|take):([0-7])$/.exec(id)
  return m ? `${m[1]}:${m[2]}` : null
}
