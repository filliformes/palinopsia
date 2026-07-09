// Collapsible : shared section chrome: a slim header with a chevron; the
// body unmounts when collapsed (cheap) and the state persists per key.

import type { ReactNode } from 'react'
import { useStore } from '../store'

export function Collapsible({
  sectionKey,
  title,
  extra,
  children,
  className = ''
}: {
  sectionKey: string
  title: string
  /** Optional inline content on the header row (counts, chips…). */
  extra?: ReactNode
  children: ReactNode
  className?: string
}): JSX.Element {
  const collapsed = useStore((s) => !!s.collapsed[sectionKey])
  const toggleSection = useStore((s) => s.toggleSection)
  return (
    <div className={`flex min-w-0 flex-col ${className}`}>
      <button
        onClick={() => toggleSection(sectionKey)}
        className="flex min-w-0 items-center gap-1.5 py-0.5 text-left"
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <span
          className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}
        >
          ▶
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wide text-muted">{title}</span>
        {extra}
      </button>
      {!collapsed && children}
    </div>
  )
}
