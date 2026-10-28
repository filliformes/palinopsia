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
import { FluidSource } from './FluidSource'
import { PhysarumSource } from './PhysarumSource'
import { MyceliumSource } from './MyceliumSource'
import { VeinsSource } from './VeinsSource'
import { LatticeSource } from './LatticeSource'
import { MarbleSource } from './MarbleSource'
import type { HandGestureLog } from '@shared/types'

/** A pointer on the picture (the mouse on the preview, a pinching hand), for a
 *  source that takes it (pointerInput.ts routes it). `u`, `v` : the frame's own
 *  coordinates, 0..1, v up. `pid` : which pointer (the mouse, each hand), so
 *  several gestures can run at once. `commit` : set for a pointer whose
 *  gestures are kept (the mouse) : called with the gesture's log entry when it
 *  ends, to land in the slot's log (one undo step). */
export interface SourcePointer {
  phase: 'down' | 'move' | 'up' | 'cancel'
  pid: number
  u: number
  v: number
  shift?: boolean
  alt?: boolean
  commit?: (entry: HandGestureLog) => void
}

export interface NativeGenerator {
  /** The slot's whole input map, from the store, every frame. */
  update(inputs: Record<string, number | number[]>): void
  /** One input after update (modulation, MIDI, OSC). */
  setInput(name: string, value: number | number[]): void
  /** Draw this frame into `targetFbo` (the composition size), paced by the slot's
   *  own clock in seconds (layer Speed, freeze, the background's slow clock). */
  render(targetFbo: WebGLFramebuffer, clockSec: number): void
  /** Optional : the shared audio texture (row 0 waveform, row 1 log spectrum) and
   *  the slot's sidechain layer (null when none or on the Background), handed in
   *  just before render. An engine that reads neither leaves this out. */
  feed?(audio: WebGLTexture | null, side: WebGLTexture | null): void
  /** Optional : the slot's hand-made log (its `handOps`), from the store, every
   *  sync (the same array until it changes). */
  handOps?(ops: readonly HandGestureLog[] | undefined): void
  /** Optional : the engine takes a pointer on the picture (Marbling's drops). */
  pointer?(ev: SourcePointer): void
  /** What a click does now, for the preview's hint. */
  pointerHint?(): string
  /** A short line on its state (drops, points) for the hint. */
  status?(): string
  /** A remote event (OSC, an action) : a name and its numbers. */
  event?(name: string, args: number[]): void
  // No PANIC hook on purpose : a generator's state IS the picture (Compositor.panic);
  // each engine carries its own regrow / reseed event instead.
  dispose(): void
}

type Factory = (gl: WebGL2RenderingContext, w: number, h: number) => NativeGenerator

const REGISTRY: Record<string, Factory> = {
  'gen-nca': (gl, w, h) => new NcaSource(gl, w, h),
  reaction: (gl, w, h) => new ReactionSource(gl, w, h),
  'gen-fluid': (gl, w, h) => new FluidSource(gl, w, h),
  'gen-physarum': (gl, w, h) => new PhysarumSource(gl, w, h),
  mycelium: (gl, w, h) => new MyceliumSource(gl, w, h),
  'gen-veins': (gl, w, h) => new VeinsSource(gl, w, h),
  'gen-lattice': (gl, w, h) => new LatticeSource(gl, w, h),
  'gen-marble': (gl, w, h) => new MarbleSource(gl, w, h)
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
  inputs: Record<string, number | number[]> | null,
  ops?: readonly HandGestureLog[]
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
  if (inputs) {
    slot.src.update(inputs)
    slot.src.handOps?.(ops)
  }
  return slot
}
