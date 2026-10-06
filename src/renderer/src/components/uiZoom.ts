// The app's chrome is scaled with CSS `zoom` (the UI zoom, Ctrl +/-). Inside a
// zoomed element, a `position: fixed` popup's left/top are scaled by that zoom
// again, while getBoundingClientRect() and mouse events report true viewport
// pixels : a popup placed from them landed off its anchor (at 80 %, a menu
// opened from the right-hand layer panel appeared far to its left). Divide
// viewport coordinates by the element's effective zoom before using them as
// left / top.

/** The zoom actually applied to `el` (1 when unzoomed or unmeasurable). */
export function effectiveZoom(el: HTMLElement | null): number {
  if (!el || el.offsetWidth <= 0) return 1
  const z = el.getBoundingClientRect().width / el.offsetWidth
  return z > 0.2 && z < 5 ? z : 1
}
