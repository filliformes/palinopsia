import type { ColorChannel, ModTarget } from '@shared/types'

/** Stable identity for a mod target : used to find existing assignments, and
 *  as a pinned control's key (persist.ts). A color's part adds `#<part>` to its
 *  color's key ('src:0:A:tint#h'). */
export function modTargetKey(t: ModTarget): string {
  if (t.kind === 'source') return `src:${t.layer}:${t.slot}:${t.input}${t.ch ? `#${t.ch}` : ''}`
  if (t.kind === 'bgSource') return `bgsrc:${t.input}${t.ch ? `#${t.ch}` : ''}`
  if (t.kind === 'meta') return `meta:${t.knob}`
  if (t.kind === 'sonify') return `soni:${t.param}`
  if (t.kind === 'layer') return `lay:${t.layer}:${t.field}`
  if (t.kind === 'bg') return `bg:${t.field}`
  if (t.kind === 'dome') return `dome:${t.field}`
  if (t.kind === 'outx') return `outx:${t.field}`
  if (t.kind === 'world') return 'world:amount'
  if (t.kind === 'au') return t.slot ? `au:${t.slot}:${t.field}` : `au:${t.field}`
  const s = t.scope
  const scopeKey =
    s.kind === 'master' || s.kind === 'background' ? s.kind : `${s.kind}:${s.layer}`
  return `fx:${scopeKey}:${t.instId}:${t.input}${t.ch ? `#${t.ch}` : ''}`
}

/** The color part a target moves (null : not a part). */
export function partOf(t: ModTarget): ColorChannel | null {
  return (t.kind === 'source' || t.kind === 'bgSource' || t.kind === 'fx') && t.ch ? t.ch : null
}

/** The same input with one of its color's parts (null : a target not on an input). */
export function withPartTarget(t: ModTarget, ch: ColorChannel): ModTarget | null {
  return t.kind === 'source' || t.kind === 'bgSource' || t.kind === 'fx' ? { ...t, ch } : null
}

/** The key of the CONTROL a target sits on : a color's part is on its color (its
 *  pin, its live color); anything else, its own key. */
export function controlKey(t: ModTarget): string {
  const k = modTargetKey(t)
  return partOf(t) ? k.slice(0, k.lastIndexOf('#')) : k
}
