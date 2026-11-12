// ◈ beside a control another dataflou node plays (a wire into one of Palinopsia's
// destinations) : lit while values arrive, says from where, right-click unwires.
// Renders nothing when no wire ends there.

import { dataflouBind, dfLastIn, useDataflouStatus } from '../dataflou'

export function MeshBadge({ dest, className = '' }: { dest: string; className?: string }): JSX.Element | null {
  const st = useDataflouStatus()
  if (!st.running) return null
  const me = st.nodes.find((n) => n.local)
  const subs = me?.subs[dest] ?? []
  if (!subs.length) return null
  const name = (sku: string): string => st.nodes.find((n) => n.sku === sku)?.label ?? sku.slice(0, 8)
  const from = subs.map((s) => `${name(s.sku)}/${s.path}`).join(', ')
  // (the status comes at least once a second : enough for lit / quiet)
  const live = (dfLastIn.get(dest)?.at ?? 0) > performance.now() - 2000
  return (
    <span
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
        for (const s of subs) void dataflouBind(st.sku, dest, s.sku, s.path, false)
      }}
      className={`shrink-0 cursor-help font-mono text-[9px] leading-none ${live ? 'text-accent2' : 'text-muted'} ${className}`}
      title={`Played over the dataflou mesh by ${from}${live ? '' : ' (quiet now)'} · its range, smoothing and what happens on loss : the ⚙ of its wire in the Connect tab · right-click : unwire`}
    >
      ◈
    </span>
  )
}
