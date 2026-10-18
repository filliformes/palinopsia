// The sessions opened or saved lately, newest first (machine-local, like the
// window's other conveniences) : the top bar's Open ▾ lists them. A file that
// is gone when picked is dropped from the list.

const KEY = 'opsia.recentSessions'
const MAX = 10

export interface RecentSession {
  path: string
  name: string
  at: number
}

const listeners = new Set<() => void>()

function read(): RecentSession[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown
    if (!Array.isArray(raw)) return []
    return raw.filter((r): r is RecentSession => !!r && typeof r === 'object' && typeof (r as RecentSession).path === 'string')
  } catch {
    return []
  }
}

function write(list: RecentSession[]): void {
  try { localStorage.setItem(KEY, JSON.stringify(list)) } catch { /* full or blocked */ }
  for (const fn of listeners) fn()
}

const same = (a: string, b: string): boolean => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

export const recentSessions = {
  list(): RecentSession[] {
    return read()
  },
  /** A session opened or saved : to the top of the list. */
  touch(path: string): void {
    if (!path) return
    const name = (path.split(/[\\/]/).pop() ?? path).replace(/\.opsia\.json$/i, '').replace(/\.json$/i, '')
    write([{ path, name, at: Date.now() }, ...read().filter((r) => !same(r.path, path))].slice(0, MAX))
  },
  remove(path: string): void {
    write(read().filter((r) => !same(r.path, path)))
  },
  clear(): void {
    write([])
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  }
}
