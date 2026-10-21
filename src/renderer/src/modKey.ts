import type { ModTarget } from '@shared/types'

/** Stable identity for a mod target : used to find existing assignments, and
 *  as a pinned control's key (persist.ts). */
export function modTargetKey(t: ModTarget): string {
  if (t.kind === 'source') return `src:${t.layer}:${t.slot}:${t.input}`
  if (t.kind === 'bgSource') return `bgsrc:${t.input}`
  if (t.kind === 'meta') return `meta:${t.knob}`
  if (t.kind === 'sonify') return `soni:${t.param}`
  if (t.kind === 'layer') return `lay:${t.layer}:${t.field}`
  if (t.kind === 'bg') return `bg:${t.field}`
  if (t.kind === 'dome') return `dome:${t.field}`
  if (t.kind === 'outx') return `outx:${t.field}`
  if (t.kind === 'world') return 'world:amount'
  const s = t.scope
  const scopeKey =
    s.kind === 'master' || s.kind === 'background' ? s.kind : `${s.kind}:${s.layer}`
  return `fx:${scopeKey}:${t.instId}:${t.input}`
}
