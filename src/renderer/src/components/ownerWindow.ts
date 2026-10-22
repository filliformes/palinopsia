// A page can sit in a window of its own (the Output, Body and Sonify pages :
// PageWindow.tsx), drawn by the instrument's renderer into a second document.
// What it draws there must use THAT window : its frames (requestAnimationFrame :
// the instrument's stall while it is minimized), its size, its pixel ratio, its
// focus, its listeners.

/** The window an element is drawn in (the instrument's when there is none). */
export function ownerWindow(el: Node | null | undefined): Window & typeof globalThis {
  return (el?.ownerDocument?.defaultView ?? window) as Window & typeof globalThis
}
