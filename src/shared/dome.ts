// Fulldome output : maps the flat composition into a square domemaster.
//
// Ported in spirit from Vincent's TouchDesigner FulldomeSimulator (an
// equiazimuth-textured sphere cap, tilted, seen through an orbit camera, with a
// sweet-spot patch and Paul Bourke alignment templates), carried two steps
// further : the engine RENDERS the domemaster itself (so projector, NDI, Spout,
// recording and stills all carry it) and offers ways to fit a 2D picture to a
// dome instead of only previewing one.
//
// Domemaster convention (the fulldome standard, and what the SAT Satosphère
// takes : 210°, 1:1, 4096² max) : an equidistant fisheye seen from INSIDE looking
// up, zenith at the centre, the front of the dome at the BOTTOM of the image,
// the audience's right on the image's right. radius ∝ angle from the zenith, so
// the rim of a 210° master is 15° below the horizon.

export type DomeMode = 'wrap' | 'screen' | 'fisheye'

export interface DomeConfig {
  enabled: boolean
  res: number // domemaster edge in pixels : 2048 · 4096 · 8192
  aperture: number // dome field of view in degrees (180..230; Satosphère 210)
  mode: DomeMode
  spin: number // continuous azimuth rotation, degrees / second (-360..360 : a full turn a second)
  rotate: number // azimuth offset in degrees (-180..180)
  flipX: boolean // mirror the master (some media servers expect it)
  feather: number // soft edges, 0..0.2 : the picture's own (screen border, panorama top / bottom, a contained frame) and the rim
  grid: boolean // burn a polar alignment grid into the OUTPUT (projector setup)

  // wrap : the flat picture wrapped around the dome like a panorama. Its width
  // runs around the azimuth, its height from `bottom` up to `top` elevation.
  turns: number // how many times the picture repeats around (1..6)
  mirrorSeams: boolean // alternate copies mirror, so repeats have no seam
  top: number // elevation (degrees) the picture's top edge reaches (up to 90 = zenith)
  bottom: number // elevation of the picture's bottom edge (below 0 = under the horizon)
  cap: 'fade' | 'stretch' | 'black' // what fills the zenith above `top`

  // screen : the picture as a virtual flat screen hung on the dome, re-projected
  // so it reads undistorted from the centre (a giant cinema screen).
  azimuth: number // degrees, 0 = front
  elevation: number // degrees above the horizon
  width: number // horizontal field of view the screen covers, degrees (20..170)
  roll: number // degrees
  surround: number // 0..1 : the picture wrapped dim behind the screen (no black dome)

  // fisheye ("full dome" in the UI) : the picture laid onto the master circle.
  // fill : the WHOLE frame stretched over the WHOLE dome (a square-to-disc map :
  // nothing cropped, no black inside the circle) · cover : the height spans the
  // dome, the sides are cropped · contain : the whole frame inside, black around.
  fit: 'fill' | 'cover' | 'contain'
  scale: number // 0.2..3
  offsetX: number // -1..1
  offsetY: number // -1..1

  // simulator (preview only, never in the output)
  sim: {
    tilt: number // dome tilt in degrees (TD default −15 for a tilted planetarium; Satosphère is level)
    fov: number // camera field of view, degrees
    back: number // inside view : how far the camera backs away from the centre (0 = the seat, up to 3 radii)
    template: number // alignment-template opacity over the dome (TD default ≈ 0.19)
    sweet: boolean // show the sweet-spot patch
    sweetW: number // sweet spot width, degrees of azimuth
    sweetLo: number // sweet spot lower elevation
    sweetHi: number // sweet spot upper elevation
    view: 'inside' | 'outside'
  }
}

/** The dome controls a modulator or a Meta knob can move : the picture's mapping
 *  in every mode. Not the venue (aperture, resolution) nor the simulator : the
 *  3D preview maps the master with the STORED aperture, so a moving one would
 *  make the preview lie. Ranges are the sliders'. */
export type DomeModField =
  | 'rotate' | 'spin' | 'feather' | 'turns' | 'top' | 'bottom'
  | 'azimuth' | 'elevation' | 'width' | 'roll' | 'surround' | 'scale' | 'offsetX' | 'offsetY'
export const DOME_MOD_RANGE: Record<DomeModField, { min: number; max: number; label: string }> = {
  rotate: { min: -180, max: 180, label: 'rotate' },
  spin: { min: -360, max: 360, label: 'spin' },
  feather: { min: 0, max: 0.2, label: 'feather' },
  turns: { min: 1, max: 6, label: 'turns' },
  top: { min: 0, max: 90, label: 'top' },
  bottom: { min: -25, max: 80, label: 'bottom' },
  azimuth: { min: -180, max: 180, label: 'azimuth' },
  elevation: { min: -20, max: 90, label: 'elevation' },
  width: { min: 20, max: 170, label: 'width' },
  roll: { min: -180, max: 180, label: 'roll' },
  surround: { min: 0, max: 1, label: 'surround' },
  scale: { min: 0.2, max: 3, label: 'scale' },
  offsetX: { min: -1, max: 1, label: 'offset x' },
  offsetY: { min: -1, max: 1, label: 'offset y' }
}

export const DOME_RES = [2048, 4096] as const // no live 8K : ~1.9 GB more VRAM (measured), a blue-screen risk

export function defaultDomeConfig(): DomeConfig {
  return {
    enabled: false,
    res: 4096,
    aperture: 210,
    mode: 'fisheye',
    spin: 0,
    rotate: 0,
    flipX: false,
    feather: 0.01,
    grid: false,
    turns: 2,
    mirrorSeams: true,
    top: 90,
    bottom: -15,
    cap: 'fade',
    azimuth: 0,
    elevation: 25,
    width: 100,
    roll: 0,
    surround: 0.25,
    fit: 'fill',
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    sim: { tilt: 0, fov: 100, back: 0, template: 0.19, sweet: false, sweetW: 90, sweetLo: 10, sweetHi: 55, view: 'inside' }
  }
}

/** Merge a possibly partial / older config over the defaults. */
export function sanitizeDome(raw: unknown): DomeConfig {
  const d = defaultDomeConfig()
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<DomeConfig>
  const num = (v: unknown, fb: number, lo: number, hi: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fb
  const sim = (r.sim && typeof r.sim === 'object' ? r.sim : {}) as Partial<DomeConfig['sim']>
  return {
    enabled: !!r.enabled,
    res: (DOME_RES as readonly number[]).includes(Number(r.res)) ? Number(r.res) : d.res,
    aperture: num(r.aperture, d.aperture, 180, 230),
    mode: r.mode === 'screen' || r.mode === 'fisheye' || r.mode === 'wrap' ? r.mode : d.mode,
    spin: num(r.spin, d.spin, -360, 360),
    rotate: num(r.rotate, d.rotate, -180, 180),
    flipX: !!r.flipX,
    feather: num(r.feather, d.feather, 0, 0.2),
    grid: !!r.grid,
    turns: num(r.turns, d.turns, 1, 6),
    mirrorSeams: r.mirrorSeams === undefined ? d.mirrorSeams : !!r.mirrorSeams,
    top: num(r.top, d.top, 0, 90),
    bottom: num(r.bottom, d.bottom, -25, 80),
    cap: r.cap === 'stretch' || r.cap === 'black' || r.cap === 'fade' ? r.cap : d.cap,
    azimuth: num(r.azimuth, d.azimuth, -180, 180),
    elevation: num(r.elevation, d.elevation, -20, 90),
    width: num(r.width, d.width, 20, 170),
    roll: num(r.roll, d.roll, -180, 180),
    surround: num(r.surround, d.surround, 0, 1),
    fit: r.fit === 'cover' || r.fit === 'contain' || r.fit === 'fill' ? r.fit : d.fit,
    scale: num(r.scale, d.scale, 0.2, 3),
    offsetX: num(r.offsetX, d.offsetX, -1, 1),
    offsetY: num(r.offsetY, d.offsetY, -1, 1),
    sim: {
      tilt: num(sim.tilt, d.sim.tilt, -30, 30),
      fov: num(sim.fov, d.sim.fov, 30, 150),
      back: num(sim.back, d.sim.back, 0, 3),
      template: num(sim.template, d.sim.template, 0, 1),
      sweet: sim.sweet === undefined ? d.sim.sweet : !!sim.sweet,
      sweetW: num(sim.sweetW, d.sim.sweetW, 10, 360),
      sweetLo: num(sim.sweetLo, d.sim.sweetLo, -20, 90),
      sweetHi: num(sim.sweetHi, d.sim.sweetHi, -20, 90),
      view: sim.view === 'outside' ? 'outside' : 'inside'
    }
  }
}
