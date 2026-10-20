// A session just loaded (Open, Load, a drop, a recent one, a restore, New,
// Generate) : what wants to know listens here. No store import, so the store can
// call it.

const loaded = new Set<() => void>()
let serial = 0

export function onSessionLoaded(fn: () => void): () => void {
  loaded.add(fn)
  return () => { loaded.delete(fn) }
}

/** Changes at every session loaded : a job begun for one session (a relink, a
 *  rebuild, a collect) drops its result when another came in meanwhile. */
export function sessionSerial(): number {
  return serial
}

export function emitSessionLoaded(): void {
  serial++
  for (const fn of loaded) {
    try { fn() } catch (e) { console.warn('[session] loaded listener', e) }
  }
}
