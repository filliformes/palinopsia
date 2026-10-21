// The transport tempo, as the shaders' integrated phases see it. An ISF shader
// cannot read the BPM, so a phase that counts beats (Shatter's grab on a bar,
// 1/2, 1/4 or 1/8) reads it here through its integrand in phases.ts. Set by the
// Compositor from the composition every frame (syncFromState) : Ableton Link's
// tempo reaches the composition first, so a linked set grabs on the shared tempo.
// Like Decimate's beat sync, it counts on the rack's own clock (layer Speed and
// freeze carry), not on the shared beat grid.

let bpm = 120

export const tempoBpm = (): number => bpm

export function setTempoBpm(v: number): void {
  bpm = Number.isFinite(v) && v > 0 ? v : 120
}
