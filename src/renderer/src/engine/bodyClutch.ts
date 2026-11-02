// The body modulator's CLUTCH : a second body feature that decides WHEN the
// modulator follows its own. While the clutch reads past its threshold (above,
// or below when inverted) the modulator follows; otherwise it holds the last
// value it had. The hand becomes a fader you grab and let go : open the hand
// and sweep, close it and the value stays where you left it.
//
// Pure (no app imports beyond the shared types) so a node bundle can test it.

import type { BodyFeature, ModulatorConfig } from '@shared/types'
import { BODY_FEATURES } from '@shared/types'

/** Half the width of the dead band around the threshold : it engages at
 *  threshold + BAND and lets go at threshold - BAND (the other way round when
 *  inverted). A fixed band, not a share of the threshold : the features are all
 *  0..1, and an open hand against a fist reads ~0.95 against ~0.2, so 0.1 of
 *  dead band is far under the gesture and well over the tracker's jitter
 *  (a hand held still wobbles ~±0.03). */
export const CLUTCH_BAND = 0.05
/** The threshold a new clutch starts at. */
export const CLUTCH_AT_DEFAULT = 0.5

/** The grab : when the clutch engages, the value glides from where it was held
 *  to where the hand is with this time constant (ms), unless the card's own
 *  smoothing is slower. A quick swoop (~0.3 s to land) rather than a cut. */
export const CLUTCH_CATCH_TAU_MS = 70
/** The glide ends once the value is this close to the hand, or after
 *  CLUTCH_CATCH_MAX_MS whatever happens (a hand still moving fast). */
export const CLUTCH_CATCH_EPS = 0.005
export const CLUTCH_CATCH_MAX_MS = 500

type BodyCfg = ModulatorConfig['body']

/** Whether the clutch is engaged after this reading. `was` : engaged before.
 *  Hysteresis : it engages only past the far edge of the band and lets go only
 *  past the near edge, so a value jittering around the threshold never
 *  chatters. The band is clipped to 0..1 (a threshold of 1 engages at a full
 *  reading). */
export function clutchEngaged(was: boolean, value: number, at: number, invert: boolean): boolean {
  const t = Math.max(0, Math.min(1, at))
  const hi = Math.min(1, t + CLUTCH_BAND)
  const lo = Math.max(0, t - CLUTCH_BAND)
  if (!invert) return was ? value > lo : value >= hi
  return was ? value < hi : value <= lo
}

/** The follower's step this frame (the one-pole's share of the gap) : the
 *  card's smoothing, or, while the grab glides in, the slower of it and the
 *  catch-up. `sm` 0..0.99 (retained per 60 fps frame), `dtMs` the frame. */
export function clutchStepK(sm: number, dtMs: number, catching: boolean, frameMs: number): number {
  const k = 1 - Math.pow(sm, dtMs / frameMs)
  if (!catching) return k
  return Math.min(k, 1 - Math.exp(-dtMs / CLUTCH_CATCH_TAU_MS))
}

const FEATURE_SET = new Set<string>(BODY_FEATURES)

/** A body block off a file (a session, a scene, a preset) : the clutch fields
 *  checked, everything else passed on as it was (an older session's body
 *  modulator loads exactly as it was made). A clutch that names no known
 *  feature is dropped (off). Not an object at all : the default block. */
export function sanitizeBodyMod(v: unknown, dflt: BodyCfg): BodyCfg {
  if (!v || typeof v !== 'object') return { ...dflt }
  const b = v as BodyCfg & Record<string, unknown>
  const { clutch, clutchAt, clutchInvert, ...rest } = b
  const out: BodyCfg = { ...(rest as BodyCfg) }
  if (typeof clutch === 'string' && FEATURE_SET.has(clutch)) out.clutch = clutch as BodyFeature
  // the threshold and the direction are kept with the clutch off too, so
  // picking a feature again finds them where they were
  if (typeof clutchAt === 'number' && Number.isFinite(clutchAt)) out.clutchAt = Math.max(0, Math.min(1, clutchAt))
  if (typeof clutchInvert === 'boolean') out.clutchInvert = clutchInvert
  return out
}
