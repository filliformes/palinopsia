// Persistence in the UI : a right-click on a control offers "Persistent" (no
// scene, Randomize, Variation, Generate, World or mix preset changes it) and
// "Set in every scene" (what plays now, written into each scene once). A
// pinned control wears a thin bar at its left (styles.css [data-pinned]); a
// pinned effect chip, source card or modulator card a gold outline (their own
// components), a pinned layer a gold border. The rule itself lives in persist.ts.

import { useState, type MouseEvent, type ReactNode } from 'react'
import { useStore } from '../store'
import { ContextMenu, type MenuItem } from './ContextMenu'

/** The two pin entries, for a menu that already has its own items. */
export function usePinItems(key: string | null, label: string, words?: { pin: string; every: string }): MenuItem[] {
  const pinned = useStore((s) => (key ? s.pins.includes(key) : false))
  const hasScenes = useStore((s) => s.scenes.length > 0)
  const togglePin = useStore((s) => s.togglePin)
  const setInEveryScene = useStore((s) => s.setInEveryScene)
  if (!key) return []
  return [
    {
      label: `${pinned ? '✓ ' : ''}${words?.pin ?? 'Persistent'}`,
      onClick: () => togglePin(key)
    },
    {
      label: `${words?.every ?? 'Set in every scene'}${hasScenes ? '' : ' (no scenes yet)'}`,
      onClick: () => setInEveryScene(key, label),
      disabled: !hasScenes
    }
  ]
}

/** A right-click menu with the pin entries for one control (or one whole
 *  thing : `words` names it). */
export function usePin(key: string | null, label: string, words?: { pin: string; every: string }): {
  pinned: boolean
  onContextMenu: (e: MouseEvent) => void
  menu: ReactNode
} {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)
  const pinned = useStore((s) => (key ? s.pins.includes(key) : false))
  const items = usePinItems(key, label, words)
  const onContextMenu = (e: MouseEvent): void => {
    if (!key) return
    e.preventDefault()
    e.stopPropagation() // (the layer's own menu is under it)
    setAt({ x: e.clientX, y: e.clientY })
  }
  const menu = at ? <ContextMenu x={at.x} y={at.y} header={label} items={items} onClose={() => setAt(null)} /> : null
  return { pinned, onContextMenu, menu }
}

/** Wraps one control (no box of its own : the layout never moves) : the
 *  right-click menu, and the bar while it is pinned. */
export function PinZone({ pin, label, children }: { pin: string | null; label: string; children: ReactNode }): JSX.Element {
  const { pinned, onContextMenu, menu } = usePin(pin, label)
  return (
    <div className="contents" onContextMenu={onContextMenu} data-pinned={pinned ? '' : undefined}>
      {children}
      {menu}
    </div>
  )
}
