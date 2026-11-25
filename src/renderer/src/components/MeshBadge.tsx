// ◈ beside a control another dataflou node plays (a wire into one of Palinopsia's
// destinations) : lit while its source is there, says from where, right-click unwires.
// Renders nothing when no wire ends there.

import { dataflouBind, useDataflouStatus } from '../dataflou'
import { dfStateWords } from '@shared/dataflou'

export function MeshBadge({ dest, className = '' }: { dest: string; className?: string }): JSX.Element | null {
  const st = useDataflouStatus()
  if (!st.running) return null
  const me = st.nodes.find((n) => n.local)
  const subs = me?.subs[dest] ?? []
  if (!subs.length) return null
  const name = (sku: string): string => st.nodes.find((n) => n.sku === sku)?.label ?? sku.slice(0, 8)
  const from = subs.map((s) => `${name(s.sku)}/${s.path}`).join(', ')
  // fed by a live connection, as the mesh says (a fader at rest is not a lost one)
  const at = st.dests[dest]
  const live = at?.state === 'bound'
  return (
    <span
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        for (const s of subs) void dataflouBind(st.sku, dest, s.sku, s.path, false)
      }}
      className={`shrink-0 cursor-help font-mono text-[9px] leading-none ${live ? 'text-accent2' : 'text-muted'} ${className}`}
      title={`Played over the dataflou mesh by ${from}${live ? '' : ` (${dfStateWords(at)})`} · its range, smoothing and what happens on loss : the ⚙ of its wire in the Connect tab · right-click : unwire`}
    >
      ◈
    </span>
  )
}
