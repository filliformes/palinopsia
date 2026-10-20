// The session's media : every file it plays (films and their converted copies,
// sound files, Collage folders and their clips, Assemble edits, the Audio
// Layer), found by walking the live session (the composition, every scene, the
// Audio Layer). What's missing is said after each load (a banner); a missing
// file is found again under a folder you pick (relink); a converted copy
// missing on this computer is made again from its original (rebuild); and
// every original can be copied next to the session (collect), so the session
// travels between computers.

import type { CompositionState } from '@shared/types'
import { useStore } from './store'
import { markDirty } from './sessionGuard'
import { onSessionLoaded, sessionSerial } from './sessionEvents'
import { showToast } from './components/Toast'
import { playableVideoUrl } from './components/videoImport'

const URL_PREFIX = 'opsia-media://local/'

/** An absolute path on disk (Windows, UNC, or a macOS / Linux one). */
function isAbsPath(s: string): boolean {
  if (s.length < 4 || s.length > 1024 || s.includes('\n')) return false
  if (/^[A-Za-z]:[\\/]/.test(s) || /^\\\\[^\\]/.test(s)) return true
  return /^\/(Users|Volumes|home|private|tmp|mnt|media|opt|var|Library|Applications)\//.test(s)
}
// Compared Unicode-normalized, separators and case ignored : a path typed on one
// system and read back from another's disk is still the same path.
const norm = (p: string): string => p.normalize('NFC').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
const sep = (p: string): string => (p.includes('\\') ? '\\' : '/')
export const baseOf = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p
const dirOf = (p: string): string => p.replace(/[\\/][^\\/]*[\\/]?$/, '')
const partsOf = (p: string): string[] => p.split(/[\\/]+/).filter(Boolean)
/** `dir` and the parts under it, in `dir`'s own separator. */
const joinPath = (dir: string, ...parts: string[]): string => [dir.replace(/[\\/]+$/, ''), ...parts].join(sep(dir))
const isUnder = (p: string, dir: string): boolean => norm(p).startsWith(norm(dir) + '/')

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

/** Every object in `obj`, visited once (the composition, the scenes, …). */
function eachObject(obj: unknown, fn: (o: Record<string, unknown>) => void): void {
  if (Array.isArray(obj)) {
    for (const x of obj) eachObject(x, fn)
  } else if (obj && typeof obj === 'object') {
    fn(obj as Record<string, unknown>)
    for (const v of Object.values(obj as Record<string, unknown>)) eachObject(v, fn)
  }
}

const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)

type ClipLike = Record<string, unknown>
/** Every assemblage clip in the session (an Assemble slot's edit, a Collage's
 *  edits), with the corpus folder its originals sit in. */
function eachEdlClip(fn: (c: ClipLike, folder: string | null) => void): void {
  eachObject(mediaState(), (o) => {
    if (Array.isArray(o.edl)) {
      const folder = o.kind === 'assemble' ? str(o.mediaPath) : null
      for (const c of o.edl) if (c && typeof c === 'object') fn(c as ClipLike, folder)
    }
    if (Array.isArray(o.collageEdls)) {
      for (const e of o.collageEdls as Array<Record<string, unknown>>) {
        if (!e || !Array.isArray(e.clips)) continue
        for (const c of e.clips) if (c && typeof c === 'object') fn(c as ClipLike, str(e.folder))
      }
    }
  })
}

/** An assemblage clip's original file : its own record, else (older edits) the
 *  corpus folder + its name when it plays a converted copy, else what it plays. */
function clipOriginal(c: ClipLike, folder: string | null): string | null {
  const own = str(c.src)
  if (own) return own
  const file = str(c.file)
  const name = str(c.fileName)
  if (file && folder && name && baseOf(file) !== name) return joinPath(folder, name)
  return file
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

/** Apply exact path replacements (old → new) to the live session (every scene
 *  included), then say so. Only the paths named change : a file that was not
 *  missing is never moved by a rule meant for another. */
function applyMap(files: Record<string, string>): void {
  const f = new Map(Object.entries(files).map(([k, v]) => [norm(k), v]))
  if (!f.size) return
  const cur = mediaState()
  const next = rewrite(cur, (p) => f.get(norm(p)) ?? p)
  useStore.setState({ composition: next.composition, scenes: next.scenes as never, audioLayer: next.audioLayer as never })
  markDirty()
}

/** What each path is now (asked in batches : a Collage pool can hold thousands). */
async function kindsOf(paths: string[]): Promise<Record<string, MediaEntry['kind']>> {
  const out: Record<string, MediaEntry['kind']> = {}
  for (let i = 0; i < paths.length; i += 20000) Object.assign(out, await window.api.mediaCheck(paths.slice(i, i + 20000)))
  return out
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

const EMPTY: MediaStatus = { entries: [], missing: [], cacheMissing: [], checking: false }
let status: MediaStatus = EMPTY
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
/** A converted copy (a film's all-intra copy, a Collage's 720p copy, a film's
 *  sound) : in this computer's cache folder, or in any `video-cache` folder
 *  under the converter's own naming (a session made on another computer). */
const CACHE_NAME = /(^|\/)video-cache\/[0-9a-f]{20}(\.c720)?(\.mp4|\.a\.m4a)$/
const isCachePath = (p: string): boolean => {
  const n = norm(p)
  return (!!cacheDir && n.startsWith(cacheDir + '/')) || CACHE_NAME.test(n)
}

let checkRun = 0 // a check that outlived its session (or a newer check) is dropped
async function check(): Promise<MediaStatus> {
  const run = ++checkRun
  status = { ...status, checking: true }
  emit()
  try {
    if (!cacheDir) cacheDir = norm(await window.api.videoCacheDir())
    const refs = [...gather(mediaState()).values()]
    const kinds = refs.length ? await kindsOf(refs) : {}
    if (run !== checkRun) return status
    const entries = refs.map((p) => ({ path: p, kind: kinds[p] ?? 'none', cache: isCachePath(p) }))
      .sort((a, b) => baseOf(a.path).localeCompare(baseOf(b.path)))
    status = {
      entries,
      missing: entries.filter((e) => e.kind === 'none' && !e.cache),
      cacheMissing: entries.filter((e) => e.kind === 'none' && e.cache),
      checking: false
    }
  } catch (e) {
    if (run !== checkRun) return status
    console.warn('[media] check failed', e)
    status = { ...status, checking: false }
  }
  emit()
  return status
}

/** Another session came in while a job ran : its result is dropped. */
function stale(ser: number, what: string): boolean {
  if (sessionSerial() === ser) return false
  showToast(`${what} : another session was opened meanwhile, so it was left as it is`, 'warn', 6000)
  return true
}

/** Find the missing files (and folders) under a folder you pick (or the one
 *  given). Each is placed, in this order : through a missing folder found there
 *  (what was in it follows), by its own name with its folder's name, through the
 *  folder a missing neighbor was found in, by its name alone. A file found for
 *  it must be there : nothing is pointed at a file that isn't. */
async function relink(under?: string): Promise<void> {
  const ser = sessionSerial()
  const missing = status.missing
  if (!missing.length) return
  const root = under ?? (await window.api.mediaPickFolder('Find the missing media in…'))
  if (!root || stale(ser, 'Relink')) return
  showToast(`Looking for ${missing.length} file${missing.length === 1 ? '' : 's'} in ${baseOf(root)}…`)
  const found = await window.api.mediaFind(root, missing.map((m) => m.path))
  // the missing folders found : what was in them follows (deepest first)
  const viaFolder = missing.filter((m) => found[m.path]?.dir)
    .map((m) => [m.path, found[m.path].path] as const)
    .sort((a, b) => partsOf(b[0]).length - partsOf(a[0]).length)
  // the folder each found file was in : its neighbors may have gone there too
  const viaNeighbor: Array<readonly [string, string]> = []
  for (const m of missing) {
    const f = found[m.path]
    if (!f || f.dir) continue
    const od = dirOf(m.path), nd = dirOf(f.path)
    if (od && nd && !viaNeighbor.some(([o]) => norm(o) === norm(od))) viaNeighbor.push([od, nd])
  }
  viaNeighbor.sort((a, b) => partsOf(b[0]).length - partsOf(a[0]).length)
  const through = (rules: ReadonlyArray<readonly [string, string]>, p: string): string | null => {
    for (const [old, to] of rules) {
      if (norm(p) === norm(old)) return to
      if (isUnder(p, old)) return joinPath(to, ...partsOf(p).slice(partsOf(old).length))
    }
    return null
  }
  const choices = new Map<string, string[]>()
  for (const m of missing) {
    const f = found[m.path]
    if (f?.dir) { choices.set(m.path, [f.path]); continue }
    const list = [
      through(viaFolder, m.path),
      f && f.score >= 2 ? f.path : null,
      through(viaNeighbor, m.path),
      f?.path ?? null
    ].filter((x): x is string => !!x)
    if (list.length) choices.set(m.path, list)
  }
  // only what is there (the found ones are; what follows a folder is checked)
  const kinds = await kindsOf([...new Set([...choices.values()].flat())])
  if (stale(ser, 'Relink')) return
  const files: Record<string, string> = {}
  for (const [old, list] of choices) {
    const hit = list.find((p) => kinds[p] && kinds[p] !== 'none')
    if (hit) files[old] = hit
  }
  const n = Object.keys(files).length
  if (!n) {
    showToast(`None of the missing files is in ${baseOf(root)} (or the folders under it)`, 'warn', 6000)
    return
  }
  applyMap(files)
  await check()
  showToast(`Relinked ${n} of ${missing.length} missing file${missing.length === 1 ? '' : 's'}${status.missing.length ? ` · ${status.missing.length} still missing` : ''}`)
  if (status.cacheMissing.length) await rebuild()
}

/** Converted copies missing on this computer : made again from their originals
 *  (a film re-converted, a Collage folder scanned again, an assemblage clip's
 *  original converted), in the composition and every scene alike. */
async function rebuild(): Promise<void> {
  if (!status.cacheMissing.length) return
  const ser = sessionSerial()
  const gone = new Set(status.cacheMissing.map((e) => norm(e.path)))
  const isGone = (p: string | null): p is string => !!p && gone.has(norm(p))
  // each gone copy and the original it was made from
  const fromOriginal = new Map<string, string>()
  // the Collage folders to scan again, with their clips whose copies are gone
  const collages = new Map<string, { folder: string; clips: ClipLike[] }>()
  eachObject(mediaState(), (o) => {
    // a film whose converted copy is gone, its original here
    const id = str(o.mediaId)
    const cur = id ? fromMediaUrl(id) ?? (isAbsPath(id) ? id : null) : null
    const orig = str(o.mediaPath)
    if (o.kind === 'video' && isGone(cur) && orig) fromOriginal.set(cur, orig)
    // a Collage whose clips' copies are gone
    if (o.shaderId === 'gen-collage' && Array.isArray(o.collagePool)) {
      const folder = str(o.collageFolder)
      for (const cl of o.collagePool as ClipLike[]) {
        const file = str(cl?.file)
        if (!isGone(file)) continue
        if (folder) {
          const k = norm(folder)
          const c = collages.get(k) ?? { folder, clips: [] }
          c.clips.push(cl)
          collages.set(k, c)
        } else if (str(cl.src)) fromOriginal.set(file, str(cl.src) as string)
      }
    }
  })
  // an assemblage clip whose copy is gone : its original
  eachEdlClip((c, folder) => {
    const file = str(c.file)
    const orig = clipOriginal(c, folder)
    if (isGone(file) && orig && norm(orig) !== norm(file)) fromOriginal.set(file, orig)
  })

  const files: Record<string, string> = {}
  // Collage folders scanned again : what the scan makes is what plays (a clip
  // the scan doesn't give back is made from its own original below)
  for (const { folder, clips } of collages.values()) {
    const res = await window.api.collageScan(folder).catch(() => null)
    const bySrc = new Map<string, string>()
    const byName = new Map<string, string>()
    if (res?.ok) {
      for (const cl of res.clips) {
        if (cl.src) bySrc.set(norm(cl.src), cl.file)
        byName.set(cl.fileName.normalize('NFC').toLowerCase(), cl.file)
      }
    }
    for (const cl of clips) {
      const file = cl.file as string
      const src = str(cl.src)
      const name = str(cl.fileName)
      const nf = (src ? bySrc.get(norm(src)) : undefined) ?? (name ? byName.get(name.normalize('NFC').toLowerCase()) : undefined)
      if (nf && norm(nf) !== norm(file)) files[file] = nf
      else if (src) fromOriginal.set(file, src)
    }
  }
  // the originals that are here (a missing one is relinked first), each made
  // playable once (converted when the player can't read it, else itself)
  const pending = [...fromOriginal].filter(([g]) => !files[g])
  const here = await kindsOf([...new Set(pending.map(([, o]) => o))])
  const made = new Map<string, Promise<string | null>>()
  for (const [g, orig] of pending) {
    if (here[orig] !== 'file') continue
    const k = norm(orig)
    let job = made.get(k)
    if (!job) {
      job = playableVideoUrl(orig, baseOf(orig)).then((u) => (u ? fromMediaUrl(u) : null)).catch(() => null)
      made.set(k, job)
    }
    const np = await job
    if (np && norm(np) !== norm(g)) files[g] = np
  }
  if (stale(ser, 'Make converted copies again')) return
  const count = Object.keys(files).length
  applyMap(files)
  await check()
  showToast(count ? `Made ${count} converted cop${count === 1 ? 'y' : 'ies'} again` : 'No converted copy could be made again (their originals are missing)', count ? 'ok' : 'warn')
}

/** Copy every original next to the session (its own "<name> media" folder) and
 *  point the session at the copies. Converted copies are not copied : they are
 *  made again where needed (an assemblage clip playing one has its original
 *  copied). A folder keeps its place (one inside another stays inside it; two
 *  of the same name get their own); it is pointed at only once every file went
 *  and something went into it; a file only once its copy is there. */
async function collect(onProgress?: (done: number, total: number) => void): Promise<boolean> {
  const sessionPath = useStore.getState().sessionPath
  if (!sessionPath) {
    showToast('Save the session first : its media are collected next to its file', 'warn', 6000)
    return false
  }
  const ser = sessionSerial()
  await check()
  if (stale(ser, 'Collect')) return false
  const sessDir = dirOf(sessionPath)
  const name = baseOf(sessionPath).replace(/\.opsia\.json$/i, '').replace(/\.json$/i, '')
  const dest = joinPath(sessDir, `${name} media`)
  const inside = (p: string): boolean => isUnder(p, sessDir)
  const folders = status.entries.filter((e) => e.kind === 'dir' && !inside(e.path)).map((e) => e.path)
  const files = status.entries.filter((e) => e.kind === 'file' && !e.cache && !inside(e.path)).map((e) => e.path)
  // an assemblage clip playing a converted copy, with no record of its original
  // (an older edit) : the original in its corpus folder is copied too
  const known = new Set(files.map(norm))
  const extra = new Set<string>()
  eachEdlClip((c, folder) => {
    const o = clipOriginal(c, folder)
    if (o && isCachePath(str(c.file) ?? '') && !isCachePath(o) && !inside(o) && !known.has(norm(o))) extra.add(o)
  })
  if (extra.size) {
    const k = await kindsOf([...extra])
    for (const o of extra) if (k[o] === 'file') { files.push(o); known.add(norm(o)) }
  }
  if (!files.length && !folders.length) {
    showToast('Every file is already beside the session')
    return true
  }
  // Each folder its own place in the media folder : one inside another keeps its
  // place in it, and two of the same name don't share one.
  const folderDest: Record<string, string> = {}
  const usedNames = new Set<string>()
  const holderOf = (p: string, among: string[]): string | null => {
    let best: string | null = null
    for (const d of among) if (d !== p && isUnder(p, d) && (!best || partsOf(d).length > partsOf(best).length)) best = d
    return best
  }
  for (const f of [...folders].sort((a, b) => partsOf(a).length - partsOf(b).length)) {
    const up = holderOf(f, folders)
    if (up && folderDest[up]) {
      folderDest[f] = joinPath(folderDest[up], ...partsOf(f).slice(partsOf(up).length))
      continue
    }
    let nm = baseOf(f)
    for (let n = 2; usedNames.has(nm.normalize('NFC').toLowerCase()); n++) nm = `${baseOf(f)} (${n})`
    usedNames.add(nm.normalize('NFC').toLowerCase())
    folderDest[f] = joinPath(dest, nm)
  }
  // a file goes into the deepest collected folder holding it
  const items = files.map((f) => {
    const h = holderOf(f, folders)
    return { src: f, dest: h ? joinPath(folderDest[h], ...partsOf(f).slice(partsOf(h).length)) : joinPath(dest, baseOf(f)) }
  })
  const off = window.api.onMediaCollectProgress((p) => onProgress?.(p.done, p.total))
  try {
    const res = await window.api.mediaCollect(sessionPath, items)
    const copied = Object.keys(res.map).length
    if (sessionSerial() !== ser) {
      showToast(`Collected ${copied} file${copied === 1 ? '' : 's'} into "${name} media", but another session was opened meanwhile : its paths were left as they are`, 'warn', 8000)
      return false
    }
    const map: Record<string, string> = { ...res.map }
    if (res.ok) {
      const into = Object.values(res.map)
      for (const f of folders) if (into.some((p) => isUnder(p, folderDest[f]))) map[f] = folderDest[f]
    }
    applyMap(map)
    await check()
    const gb = res.bytes / 1e9
    const size = gb >= 1 ? gb.toFixed(1) + ' GB' : Math.round(res.bytes / 1e6) + ' MB'
    const skipped = res.refused ? ` · ${res.refused} skipped (not a film or a sound file)` : ''
    if (!res.ok) showToast(`Collected ${copied} of ${items.length} files, then : ${res.error}${skipped}`, 'warn', 8000)
    else showToast(`Collected ${copied} file${copied === 1 ? '' : 's'} (${size}) into "${name} media"${skipped} · save to keep the new paths`, res.refused ? 'warn' : 'ok', 7000)
    return res.ok && !res.refused
  } finally {
    off()
  }
}

// After every load (New and Generate too) : what the last one said is gone at
// once; the files this one needs are checked once its sources are in place, and
// the films beside its file are readied in the background (an exotic codec
// converted once), now that the load went through.
let timer = 0
onSessionLoaded(() => {
  window.clearTimeout(timer)
  checkRun++ // a check still running was for the session before
  status = EMPTY
  emit()
  timer = window.setTimeout(() => {
    void check()
    const p = useStore.getState().sessionPath
    if (p) void window.api.sessionWarm(p).catch(() => {})
  }, 1200)
})
