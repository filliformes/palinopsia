// The native-generator registry : self-contained generator engines (TS classes
// running their own GL : float state, many passes, agents) that a layer slot or
// the Background slab runs in place of an ISF shader. One contract and one table,
// so a new engine plugs in here once instead of being special-cased across the
// Compositor (slot fields, sync, modulation, render, PANIC, dispose, background).
//
// Text, Parametric, Collage and Silhouette stay wired by hand : each takes an
// outside input a generic slot can't carry (a sidechain texture, a film pool, the
// body camera).
//
// The matching shader-registry entry (shaders/isf/index.ts) is `native: true`
// with a header-only ISF source : its INPUTS drive the auto-UI, presets,
// modulation and OSC exactly as for an ISF generator.

import { NcaSource } from './NcaSource'
import { ReactionSource } from './ReactionSource'

export interface NativeGenerator {
  /** The slot's whole input map, from the store, every frame. */
  update(inputs: Record<string, number | number[]>): void
  /** One input after update (modulation, MIDI, OSC). */
  setInput(name: string, value: number | number[]): void
  /** Draw this frame into `targetFbo` (the composition size), paced by the slot's
   *  own clock in seconds (layer Speed, freeze, the background's slow clock). */
  render(targetFbo: WebGLFramebuffer, clockSec: number): void
  // No PANIC hook on purpose : a generator's state IS the picture (Compositor.panic);
  // each engine carries its own regrow / reseed event instead.
  dispose(): void
}

type Factory = (gl: WebGL2RenderingContext, w: number, h: number) => NativeGenerator

const REGISTRY: Record<string, Factory> = {
  'gen-nca': (gl, w, h) => new NcaSource(gl, w, h),
  reaction: (gl, w, h) => new ReactionSource(gl, w, h)
}

export const NATIVE_GENERATOR_IDS: readonly string[] = Object.keys(REGISTRY)

export function nativeGeneratorFactory(id: string | null | undefined): Factory | null {
  return (id && REGISTRY[id]) || null
}

/** A slot's live engine, recreated when the slot switches to another engine. */
export interface NativeSlot {
  id: string
  src: NativeGenerator
}

/** Reconcile one slot : create, keep, swap or drop its engine, then feed it the
 *  slot's inputs. Returns the slot's new state. */
export function syncNativeSlot(
  cur: NativeSlot | null,
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  id: string | null,
  inputs: Record<string, number | number[]> | null
): NativeSlot | null {
  const make = nativeGeneratorFactory(id)
  if (!make || !id) {
    cur?.src.dispose()
    return null
  }
  let slot = cur
  if (!slot || slot.id !== id) {
    cur?.src.dispose()
    slot = { id, src: make(gl, w, h) }
  }
  if (inputs) slot.src.update(inputs)
  return slot
}
