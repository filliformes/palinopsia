// The session's media : every file it plays (films and their converted copies,
// sound files, Collage folders and their clips, Assemble edits, the Audio
// Layer), found by walking the live session (the composition, every scene, the
// Audio Layer). What's missing is said after each load (a banner); a missing
// file is found again by name under a folder you pick (relink); a converted
// copy missing on this computer is made again from its original (rebuild); and
// every original can be copied next to the session (collect), so the session
// travels between computers.

import type { CompositionState } from '@shared/types'
import { useStore } from './store'
import { markDirty } from './sessionGuard'
import { onSessionLoaded } from './sessionEvents'
import { showToast } from './components/Toast'
import { playableVideoUrl } from './components/videoImport'

const URL_PREFIX = 'opsia-media://local/'

/** An absolute path on disk (Windows, UNC, or a macOS / Linux one). */
function isAbsPath(s: string): boolean {
  if (s.length < 4 || s.length > 1024 || s.includes('\n')) return false
  if (/^[A-Za-z]:[\\/]/.test(s) || /^\\\\[^\\]/.test(s)) return true
  return /^\/(Users|Volumes|home|private|tmp|mnt|media|opt|var|Library|Applications)\//.test(s)
}
const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const sep = (p: string): string => (p.includes('\\') ? '\\' : '/')
export const baseOf = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const dirOf = (p: string): string => p.replace(/[\\/][^\\/]*[\\/]?$/, '')

function fromMediaUrl(s: string): string | null {
  if (!s.startsWith(URL_PREFIX)) return null
  try { return decodeURIComponent(s.slice(URL_PREFIX.length)) } catch { return null }
}

/** The parts of the live state that hold media paths. */
function mediaState(): { composition: CompositionState; scenes: unknown; audioLayer: unknown } {
  const st = useStore.getState()
  return { composition: st.composition, scenes: st.scenes, audioLayer: st.audioLayer }
}

/** Every path the state refers to (raw paths and media URLs), keyed normalized. */
function gather(obj: unknown, out = new Map<string, string>()): Map<string, string> {
  if (typeof obj === 'string') {
    const p = fromMediaUrl(obj) ?? (isAbsPath(obj) ? obj : null)
    if (p) out.set(norm(p), p)
  } else if (Array.isArray(obj)) {
    for (const x of obj) gather(x, out)
  } else if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj as Record<string, unknown>)) gather(v, out)
  }
  return out
}

/** A copy of `obj` with every path (raw or inside a media URL) passed through `map`. */
function rewrite<T>(obj: T, map: (p: string) => string): T {
  const walk = (o: unknown): unknown => {
    if (typeof o === 'string') {
      const u = fromMediaUrl(o)
      if (u !== null) { const n = map(u); return n === u ? o : URL_PREFIX + encodeURIComponent(n) }
      return isAbsPath(o) ? map(o) : o
    }
    // only what changes is new : an untouched layer keeps its objects (and
    // nothing reloads)
    if (Array.isArray(o)) {
      let changed = false
      const r = o.map((x) => { const y = walk(x); if (y !== x) changed = true; return y })
      return changed ? r : o
    }
    if (o && typeof o === 'object') {
      let changed = false
      const r: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) { const y = walk(v); if (y !== v) changed = true; r[k] = y }
      return changed ? r : o
    }
    return o
  }
  return walk(obj) as T
}

/** A path map : exact files first, then the longest folder that holds the path. */
function makeMapper(files: Record<string, string>, folders: Record<string, string>): (p: string) => string {
  const f = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]))
  const d = Object.entries(folders).map(([k, v]) => [norm(k), v] as const).sort((a, b) => b[0].length - a[0].length)
  return (p) => {
    const n = norm(p)
    const hit = f.get(n)
    if (hit) return hit
    for (const [old, to] of d) {
      if (n === old) return to
      if (n.startsWith(old + '/')) return to + sep(to) + p.slice(old.length + 1).split(/[\\/]/).join(sep(to))
    }
    return p
  }
}

/** Apply a path map to the live session (every scene included), then say so. */
function applyMap(map: (p: string) => string): void {
  const cur = mediaState()
  const next = rewrite(cur, map)
  useStore.setState({ composition: next.composition, scenes: next.scenes as never, audioLayer: next.audioLayer as never })
  markDirty()
}

// ── the session's status ────────────────────────────────────────────────────

export interface MediaEntry {
  path: string
  kind: 'file' | 'dir' | 'none'
  cache: boolean // a converted copy (made again from its original when missing)
}
export interface MediaStatus {
  entries: MediaEntry[]
  missing: MediaEntry[] // originals not found
  cacheMissing: MediaEntry[] // converted copies to make again
  checking: boolean
}

let status: MediaStatus = { entries: [], missing: [], cacheMissing: [], checking: false }
let dismissedFor = '' // the banner closed for this set of missing files
const listeners = new Set<() => void>()
const emit = (): void => { for (const fn of listeners) fn() }

export const sessionMedia = {
  status: (): MediaStatus => status,
  subscribe(fn: () => void): () => void {
    listeners.add(fn)
    return () => { listeners.delete(fn) }
  },
  /** The banner is shown while files are missing and it wasn't closed for them. */
  bannerShown: (): boolean => status.missing.length > 0 && dismissedFor !== missingKey(),
  dismiss(): void {
    dismissedFor = missingKey()
    emit()
  },
  check,
  relink,
  rebuild,
  collect
}

const missingKey = (): string => status.missing.map((m) => norm(m.path)).sort().join('|')

let cacheDir = ''
async function check(): Promise<MediaStatus> {
  status = { ...status, checking: true }
  emit()
  try {
    if (!cacheDir) cacheDir = norm(await window.api.videoCacheDir())
    const refs = [...gather(mediaState()).values()]
    const kinds = refs.length ? await window.api.mediaCheck(refs) : {}
    const entries = refs.map((p) => ({ path: p, kind: kinds[p] ?? 'none', cache: !!cacheDir && norm(p).startsWith(cacheDir + '/') }))
      .sort((a, b) => baseOf(a.path).localeCompare(baseOf(b.path)))
    status = {
      entries,
      missing: entries.filter((e) => e.kind === 'none' && !e.cache),
      cacheMissing: entries.filter((e) => e.kind === 'none' && e.cache),
      checking: false
    }
  } catch (e) {
    console.warn('[media] check failed', e)
    status = { ...status, checking: false }
  }
  emit()
  return status
}

/** Find the missing files (and folders) by name under a folder you pick (or
 *  the one given). */
async function relink(under?: string): Promise<void> {
  const missing = status.missing
  if (!missing.length) return
  const root = under ?? (await window.api.mediaPickFolder('Find the missing media in…'))
  if (!root) return
  showToast(`Looking for ${missing.length} file${missing.length === 1 ? '' : 's'} in ${baseOf(root)}…`)
  const names = [...new Set(missing.map((m) => baseOf(m.path)))]
  const found = await window.api.mediaFind(root, names)
  const files: Record<string, string> = {}
  const folders: Record<string, string> = {}
  let n = 0
  for (const m of missing) {
    const to = found[baseOf(m.path).toLowerCase()]
    if (!to) continue
    files[m.path] = to
    n++
    // the folder it was in moved with it : anything else from there follows
    const od = dirOf(m.path), nd = dirOf(to)
    if (od && nd && !folders[od]) folders[od] = nd
  }
  if (!n) {
    showToast(`None of the missing files is in ${baseOf(root)} (or the folders under it)`, 'warn', 6000)
    return
  }
  applyMap(makeMapper(files, folders))
  await check()
  showToast(`Relinked ${n} of ${missing.length} missing file${missing.length === 1 ? '' : 's'}${status.missing.length ? ` · ${status.missing.length} still missing` : ''}`)
  if (status.cacheMissing.length) await rebuild()
}

/** Converted copies missing on this computer : made again from their originals
 *  (a film re-converted, a Collage folder scanned again). */
async function rebuild(): Promise<void> {
  if (!status.cacheMissing.length) return
  const st = useStore.getState()
  const files: Record<string, string> = {}
  let made = 0
  const slots: Array<{ layer: number; slot: 'A' | 'B' } | 'bg'> = []
  st.composition.layers.forEach((_, i) => { slots.push({ layer: i, slot: 'A' }, { layer: i, slot: 'B' }) })
  slots.push('bg')
  const missingCache = new Set(status.cacheMissing.map((e) => norm(e.path)))
  for (const where of slots) {
    const c = useStore.getState().composition
    const s = where === 'bg' ? c.background?.source : where.slot === 'A' ? c.layers[where.layer]?.sourceA : c.layers[where.layer]?.sourceB
    if (!s) continue
    // a film whose converted copy is gone, its original here
    const cur = s.mediaId ? fromMediaUrl(s.mediaId) : null
    if (s.kind === 'video' && cur && missingCache.has(norm(cur)) && s.mediaPath) {
      const url = await playableVideoUrl(s.mediaPath, s.mediaName ?? baseOf(s.mediaPath))
      const np = url ? fromMediaUrl(url) : null
      if (np) { files[cur] = np; made++ }
    }
    // a Collage whose clips' copies are gone : its folder scanned again
    if (s.shaderId === 'gen-collage' && s.collageFolder && (s.collagePool ?? []).some((cl) => missingCache.has(norm(cl.file)))) {
      const res = await window.api.collageScan(s.collageFolder)
      if (res.ok) {
        const byName = new Map(res.clips.map((cl) => [(cl.src ?? cl.fileName).toLowerCase(), cl.file]))
        for (const cl of s.collagePool ?? []) {
          const nf = byName.get((cl.src ?? cl.fileName).toLowerCase()) ?? byName.get(cl.fileName.toLowerCase())
          if (nf && nf !== cl.file) { files[cl.file] = nf; made++ }
        }
      }
    }
  }
  if (made) applyMap(makeMapper(files, {}))
  await check()
  showToast(made ? `Made ${made} converted cop${made === 1 ? 'y' : 'ies'} again` : 'No converted copy could be made again (their originals are missing)', made ? 'ok' : 'warn')
}

/** Copy every original next to the session (its own "<name> media" folder) and
 *  point the session at the copies. Converted copies are not copied : they are
 *  made again where needed. */
async function collect(onProgress?: (done: number, total: number) => void): Promise<boolean> {
  const st = useStore.getState()
  if (!st.sessionPath) {
    showToast('Save the session first : its media are collected next to its file', 'warn', 6000)
    return false
  }
  await check()
  const sessDir = dirOf(st.sessionPath)
  const name = baseOf(st.sessionPath).replace(/\.opsia\.json$/i, '').replace(/\.json$/i, '')
  const dest = sessDir + sep(sessDir) + `${name} media`
  const inside = (p: string): boolean => norm(p).startsWith(norm(sessDir) + '/')
  const folders = status.entries.filter((e) => e.kind === 'dir' && !inside(e.path))
  const files = status.entries.filter((e) => e.kind === 'file' && !e.cache && !inside(e.path))
  if (!files.length && !folders.length) {
    showToast('Every file is already beside the session')
    return true
  }
  const folderDest: Record<string, string> = {}
  for (const f of folders) folderDest[f.path] = dest + sep(dest) + baseOf(f.path)
  const items = files.map((f) => {
    const holder = folders.find((d) => norm(f.path).startsWith(norm(d.path) + '/'))
    return { src: f.path, dest: holder ? folderDest[holder.path] + sep(dest) + baseOf(f.path) : dest + sep(dest) + baseOf(f.path) }
  })
  const off = window.api.onMediaCollectProgress((p) => onProgress?.(p.done, p.total))
  try {
    const res = await window.api.mediaCollect(items)
    applyMap(makeMapper(res.map, folderDest))
    await check()
    const gb = res.bytes / 1e9
    if (!res.ok) showToast(`Collected ${Object.keys(res.map).length} of ${items.length} files, then : ${res.error}`, 'warn', 8000)
    else showToast(`Collected ${items.length} file${items.length === 1 ? '' : 's'} (${gb >= 1 ? gb.toFixed(1) + ' GB' : Math.round(res.bytes / 1e6) + ' MB'}) into "${name} media" · save to keep the new paths`, 'ok', 7000)
    return res.ok
  } finally {
    off()
  }
}

// After every load : the files it needs, checked once its sources are in place.
let timer = 0
onSessionLoaded(() => {
  window.clearTimeout(timer)
  timer = window.setTimeout(() => { void check() }, 1200)
})
