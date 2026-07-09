// ContextMenu : shared right-click menu. Fixed-positioned at the cursor,
// closes on outside mousedown / Escape. Items can be actions, dividers, or
// rows with a trailing delete affordance (used by preset lists).

import { useEffect, useRef, type ReactNode } from 'react'

export interface MenuItem {
  label: string
  onClick?: () => void
  danger?: boolean
  divider?: boolean
  /** Greyed and non-interactive (e.g. Paste with an empty clipboard). */
  disabled?: boolean
  /** Optional trailing × : e.g. delete a preset without applying it. */
  onDelete?: () => void
  deleteTitle?: string
}

export function ContextMenu({
  x,
  y,
  items,
  onClose,
  header
}: {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
  header?: ReactNode
}): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('mousedown', down)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('mousedown', down)
      window.removeEventListener('keydown', key)
    }
  }, [onClose])

  // Keep the menu inside the viewport.
  const style: React.CSSProperties = {
    left: Math.min(x, window.innerWidth - 220),
    top: Math.min(y, window.innerHeight - 40 * items.length - 20)
  }

  return (
    <div
      ref={ref}
      style={style}
      className="fixed z-50 flex min-w-[180px] flex-col rounded border border-border bg-panel2 py-1 shadow-lg"
    >
      {header && (
        <div className="border-b border-border px-3 py-1 font-mono text-[9px] uppercase tracking-wide text-muted">
          {header}
        </div>
      )}
      {items.map((item, i) =>
        item.divider ? (
          <div key={i} className="my-1 border-t border-border" />
        ) : (
          <div key={i} className="flex items-center">
            <button
              disabled={item.disabled}
              onClick={() => {
                item.onClick?.()
                onClose()
              }}
              className={`flex-1 px-3 py-1 text-left text-[11px] transition-colors ${
                item.disabled
                  ? 'cursor-default text-muted/40'
                  : `hover:bg-accent/15 ${item.danger ? 'text-danger hover:text-danger' : 'hover:text-accent'}`
              }`}
            >
              {item.label}
            </button>
            {item.onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  item.onDelete?.()
                  onClose()
                }}
                className="px-2 font-mono text-[10px] text-muted hover:text-danger"
                title={item.deleteTitle ?? 'Delete'}
              >
                ×
              </button>
            )}
          </div>
        )
      )}
    </div>
  )
}
