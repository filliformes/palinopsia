// OSC destinations : where Palinopsia sends, several at once (Pandore, dataFLOU,
// TouchDesigner…). Each has its own host:port, an on/off and its own choice of
// content :
//   feedback  the live /opsia state mirrored out (only what changes), optionally
//             only under some address prefixes
//   mark      the output's scanline as sound (/opsia/av/mark-*)
//   body      the Body rules' OSC (/body/<rule>)
// The section's FEEDBACK and MARK buttons (and the Body page's OSC switch) stay the
// masters : a destination gets a kind only while its master is on too.
// Kept per computer (localStorage 'opsia.oscDests'), never in a session : the
// addresses belong to this network. The first destination is mirrored into the old
// single-destination keys, so an older Palinopsia on this computer still finds it.

import { useStore } from './store'

export interface OscDest {
  id: string
  name: string
  host: string
  port: number
  on: boolean
  feedback: boolean
  prefixes: string[] // feedback only under these (e.g. /opsia/layer1) : empty = everything
  mark: boolean
  body: boolean
}

export type OscDestKind = 'feedback' | 'mark' | 'body'

/** Dotted IPv4 (each octet 0..255) or localhost : what the main process sends to. */
export function isPlausibleHost(h: string): boolean {
  if (h === 'localhost') return true
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h)
  return !!m && m.slice(1).every((o) => Number(o) <= 255)
}

const newId = (): string => Math.random().toString(36).slice(2, 10)

export function makeDest(p: Partial<OscDest> = {}): OscDest {
  return { id: newId(), name: 'out', host: '127.0.0.1', port: 9001, on: true, feedback: true, prefixes: [], mark: true, body: true, ...p }
}

/** One stored destination, checked (a bad one is dropped, not repaired). */
function clean(x: unknown): OscDest | null {
  if (!x || typeof x !== 'object') return null
  const o = x as Record<string, unknown>
  const host = typeof o.host === 'string' ? o.host.trim() : ''
  const port = Number(o.port)
  if (!isPlausibleHost(host) || !Number.isInteger(port) || port < 1 || port > 65535) return null
  return {
    id: typeof o.id === 'string' && o.id ? o.id.slice(0, 16) : newId(),
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim().slice(0, 24) : 'out',
    host,
    port,
    on: o.on !== false,
    feedback: o.feedback !== false,
    prefixes: Array.isArray(o.prefixes)
      ? o.prefixes.filter((s): s is string => typeof s === 'string' && s.startsWith('/') && s.length < 120).slice(0, 16)
      : [],
    mark: o.mark !== false,
    body: o.body !== false
  }
}

/** The stored list, or (first run since destinations) the old single destination. */
export function loadOscDests(): OscDest[] {
  try {
    const raw = localStorage.getItem('opsia.oscDests')
    if (raw !== null) {
      const arr = JSON.parse(raw) as unknown[]
      return Array.isArray(arr) ? arr.map(clean).filter((d): d is OscDest => !!d).slice(0, 16) : []
    }
  } catch {
    /* fall through to the migration */
  }
  const host = (localStorage.getItem('opsia.oscOutHost') || '127.0.0.1').trim()
  const port = Number(localStorage.getItem('opsia.oscOutPort'))
  return [makeDest({ name: 'out', host: isPlausibleHost(host) ? host : '127.0.0.1', port: Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 9001 })]
}

export function saveOscDests(list: OscDest[]): void {
  try {
    localStorage.setItem('opsia.oscDests', JSON.stringify(list))
    // the first one, for an older Palinopsia on this computer
    if (list[0]) {
      localStorage.setItem('opsia.oscOutHost', list[0].host)
      localStorage.setItem('opsia.oscOutPort', String(list[0].port))
    }
  } catch {
    /* quota : the list just won't survive the restart */
  }
}

const isLoopback = (h: string): boolean => h === 'localhost' || h.startsWith('127.')

/** Would this destination send into Palinopsia's own OSC input (a loop) ? */
export function isSelfDest(d: Pick<OscDest, 'host' | 'port'>): boolean {
  const st = useStore.getState()
  if (!st.oscEnabled || d.port !== st.oscPort) return false
  return isLoopback(d.host) || st.oscAddresses.includes(d.host)
}

let memo: { list: OscDest[]; masters: string; byKind: Map<OscDestKind, OscDest[]> } | null = null

/** The destinations a kind of message goes to now : on, the kind ticked, its
 *  master on, never Palinopsia's own input, one per host:port (flags merged, the
 *  first one's prefixes). */
export function destsFor(kind: OscDestKind): OscDest[] {
  const st = useStore.getState()
  const masters = `${st.oscOutEnabled}|${st.markSignalEnabled}|${st.bodyControl.oscOut}|${st.oscEnabled}|${st.oscPort}|${st.oscAddresses.join(',')}`
  if (!memo || memo.list !== st.oscDests || memo.masters !== masters) {
    const byKind = new Map<OscDestKind, OscDest[]>()
    const master: Record<OscDestKind, boolean> = { feedback: st.oscOutEnabled, mark: st.markSignalEnabled, body: !!st.bodyControl.oscOut }
    for (const k of ['feedback', 'mark', 'body'] as OscDestKind[]) {
      const seen = new Map<string, OscDest>()
      if (master[k]) {
        for (const d of st.oscDests) {
          if (!d.on || !d[k] || isSelfDest(d)) continue
          const key = `${d.host}:${d.port}`
          const had = seen.get(key)
          // the same place twice : one send; feedback to everything if either wants it
          if (had) { if (k === 'feedback' && (!had.prefixes.length || !d.prefixes.length)) seen.set(key, { ...had, prefixes: [] }) }
          else seen.set(key, d)
        }
      }
      byKind.set(k, [...seen.values()])
    }
    memo = { list: st.oscDests, masters, byKind }
  }
  return memo.byKind.get(kind) ?? []
}

/** Does any destination take the feedback now ? (keeps the picture's features
 *  sampled for /opsia/vision/*) */
export const feedbackWanted = (): boolean => destsFor('feedback').length > 0
