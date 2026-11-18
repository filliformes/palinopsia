// The sessions you starred to recall quickly, in the order you starred them
// (machine-local, like the recent list) : the top bar's Open ▾ lists them above
// Recent, and a pad, a key or a body rule opens one by its place (act:fav:<n>).
// Favorites are deliberate : a file that is gone stays on the list, flagged,
// until you take it off (a drive plugged in again brings it back).

const KEY = 'opsia.favoriteSessions'
export const MAX_FAVORITES = 24

export interface FavoriteSession {
  path: string
  name: string
  at: number
}

const listeners = new Set<() => void>()

function read(): FavoriteSession[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((r): r is FavoriteSession => !!r && typeof r === 'object' && typeof (r as FavoriteSession).path === 'string')
  } catch {
    return []
  }
}

function write(list: FavoriteSession[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* full or blocked */ }
  for (const fn of listeners) fn()
}

const same = (a: string, b: string): boolean => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

/** A session file's name, as the recent list shows it. */
export const sessionFileName = (path: string): string =>
  (path.split(/[\\/]/).pop() ?? path).replace(/\.opsia\.json$/i, '').replace(/\.json$/i, '')

export const favoriteSessions = {
  list(): FavoriteSession[] {
    return read()
  },
  has(path: string | null | undefined): boolean {
    return !!path && read().some((r) => same(r.path, path))
  },
  /** Starred : to the end of the list (the order you starred them). False when
   *  the list is full. */
  add(path: string): boolean {
    if (!path) return false
    const list = read()
    if (list.some((r) => same(r.path, path))) return true
    if (list.length >= MAX_FAVORITES) return false
    write([...list, { path, name: sessionFileName(path), at: Date.now() }])
    return true
  },
  remove(path: string): void {
    write(read().filter((r) => !same(r.path, path)))
  },
  /** Starred or not, the other way round. False when it could not be starred
   *  (the list is full). */
  toggle(path: string): boolean {
    if (this.has(path)) {
      this.remove(path)
      return true
    }
    return this.add(path)
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }
}
