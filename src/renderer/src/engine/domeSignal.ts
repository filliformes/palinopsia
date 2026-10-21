// The dome, as the shaders see it. Under full-dome FILL the whole flat frame is
// spread over the disc (frame centre at the zenith, its edges around the rim),
// so a shader that seats things toward the frame's edges (a vignette, a bezel,
// an edge erosion) draws them as a square ring on the dome. A shader that
// declares the plain uniform
//
//   uniform float DOME_FILL;
//
// gets, every draw, the horizon's radius on the disc while fill is on (180 /
// aperture / scale : 0.857 for a 210° dome at scale 1, 1 for 180°; above 1 when
// the frame is scaled down inside the dome) and 0 otherwise. The frame
// point's place on the dome : squareToDisc(uv·2 − 1) (Fong), its length / DOME_FILL
// = 1 at the horizon, more below it. Set by the Compositor's setDome; uploaded
// beside the integrated phases (isfTextureBridge).

let fill = 0

export const domeFill = (): number => fill

export function setDomeFill(v: number): void {
  fill = Number.isFinite(v) && v > 0 ? v : 0
}

// The Finalizer's film and digital grain, while the dome is on (any mapping) :
// the dome stage draws it after the mapping, in master pixels (engine/dome.ts,
// lib/finalGrain.glsl), and a Finalizer declaring
//
//   uniform float DOME_GRAIN;
//
// gets 1 and leaves it out (else 0 : it draws it over the flat frame, as ever).
let grain = 0

export const domeGrain = (): number => grain

export function setDomeGrain(on: boolean): void {
  grain = on ? 1 : 0
}
