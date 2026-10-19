// A session just loaded (Open, Load, a drop, a recent one, a restore) : what
// wants to know listens here. No store import, so the store can call it.

const loaded = new Set<() => void>()

export function onSessionLoaded(fn: () => void): () => void {
  loaded.add(fn)
  return () => { loaded.delete(fn) }
}

export function emitSessionLoaded(): void {
  for (const fn of loaded) {
    try { fn() } catch (e) { console.warn('[session] loaded listener', e) }
  }
}
