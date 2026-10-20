// A session's media on disk : is each file still there, where did a missing
// one go (searched by name under a folder you pick), and copying them all next
// to the session (so it travels between computers). The renderer gathers the
// paths from the session and rewrites them; this side only touches the disk.

import { dialog, ipcMain, type WebContents } from 'electron'
import { promises as fs, constants as fsc } from 'fs'
import type { FileHandle } from 'fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'path'
import { lastDir, rememberDir } from './lastDir'

export type PathKind = 'file' | 'dir' | 'none'

/** The files a session plays : films and sounds (what the app imports). A
 *  relink only proposes these, and a collect only copies these. */
const MEDIA_FILE = /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mxf|m2v|dxv|ogv|wmv|flv|ts|mts|m2ts|3gp|wav|mp3|flac|ogg|oga|opus|aac|m4a|aif|aiff|wma|caf)$/i

async function kindOf(p: string): Promise<PathKind> {
  try {
    const st = await fs.stat(p)
    return st.isDirectory() ? 'dir' : 'file'
  } catch {
    return 'none'
  }
}

// Names compared Unicode-normalized and case ignored : a name typed on one
// system and read back from another's disk (a Mac's decomposed accents) is
// still the same name.
const nameKey = (s: string): string => s.normalize('NFC').toLowerCase()
const partsOf = (p: string): string[] => p.split(/[\\/]+/).filter(Boolean).map(nameKey)
/** How many trailing parts two paths share : the name, its folder, the folder above… */
function tailMatch(a: string[], b: string[]): number {
  let n = 0
  while (n < a.length && n < b.length && a[a.length - 1 - n] === b[b.length - 1 - n]) n++
  return n
}

export interface FoundMedia {
  path: string
  dir: boolean
  /** Trailing parts shared with the missing path (1 : the name alone). */
  score: number
}

/** Under `root`, where each missing path went. Every file (or folder) carrying
 *  its name is a candidate, scored by how many trailing parts of the old path it
 *  shares (day2/take1.mov beats a lone take1.mov), the shallowest first among
 *  equals. One found file never stands for two missing paths it fits equally
 *  well (two take1.mov from different folders) : it goes to the one it fits best,
 *  or to none. A file candidate is a film or a sound. A bounded walk : hidden
 *  folders and node_modules are skipped, 10 levels and 200 000 entries at most. */
async function findMissing(root: string, wants: string[]): Promise<Record<string, FoundMedia>> {
  const want = wants.map((w) => ({ old: w, parts: partsOf(w) })).filter((w) => w.parts.length > 0)
  const byName = new Map<string, number[]>()
  want.forEach((w, i) => {
    const k = w.parts[w.parts.length - 1]
    const l = byName.get(k)
    if (l) l.push(i)
    else byName.set(k, [i])
  })
  type Cand = { path: string; dir: boolean; score: number; order: number }
  const cands: Cand[][] = want.map(() => [])
  // Good enough to stop looking : the name and the folder it was in (or all
  // the old path has).
  const enough = want.map((w) => Math.min(2, Math.max(1, w.parts.length - 1)))
  const settled = (): boolean => want.every((_, i) => cands[i].some((c) => c.score >= enough[i]))
  let seen = 0
  let order = 0
  let level = [root]
  walk: for (let depth = 0; depth < 10 && level.length && !settled(); depth++) {
    const next: string[] = []
    for (const dir of level) {
      let ents: import('fs').Dirent[]
      try { ents = await fs.readdir(dir, { withFileTypes: true }) } catch { continue }
      for (const e of ents) {
        if (++seen > 200000) break walk
        const full = join(dir, e.name)
        const isDir = e.isDirectory()
        const hit = byName.get(nameKey(e.name))
        if (hit && (isDir || MEDIA_FILE.test(e.name))) {
          const cp = partsOf(full)
          for (const i of hit) {
            if (cands[i].length < 64) cands[i].push({ path: full, dir: isDir, score: tailMatch(want[i].parts, cp), order: order++ })
          }
        }
        if (isDir && !e.name.startsWith('.') && e.name !== 'node_modules') next.push(full)
      }
    }
    level = next
  }

  // Hand the candidates out, best fit first. At one score, a candidate two open
  // paths both want goes to neither (once the others are served, it may be one's
  // alone again).
  const pairs: Array<{ i: number; c: Cand }> = []
  cands.forEach((l, i) => { for (const c of l) pairs.push({ i, c }) })
  pairs.sort((a, b) => b.c.score - a.c.score || a.c.order - b.c.order)
  const out: Record<string, FoundMedia> = {}
  const taken = new Set<string>()
  const done = new Set<number>()
  for (let k = 0; k < pairs.length; ) {
    let end = k
    while (end < pairs.length && pairs[end].c.score === pairs[k].c.score) end++
    const tier = pairs.slice(k, end)
    let wanters = new Map<string, Set<number>>()
    for (let gave = true; gave; ) {
      gave = false
      wanters = new Map()
      for (const { i, c } of tier) {
        const key = nameKey(c.path)
        if (done.has(i) || taken.has(key)) continue
        const set = wanters.get(key) ?? new Set<number>()
        set.add(i)
        wanters.set(key, set)
      }
      for (const { i, c } of tier) {
        const key = nameKey(c.path)
        if (done.has(i) || taken.has(key) || (wanters.get(key)?.size ?? 0) > 1) continue
        out[want[i].old] = { path: c.path, dir: c.dir, score: c.score }
        done.add(i)
        taken.add(key)
        gave = true
      }
    }
    for (const [key, set] of wanters) if (set.size > 1) taken.add(key)
    k = end
  }
  return out
}

/** The same bytes ? Same size already known; the first and the last megabyte
 *  compared (a copy made earlier, with a fresh date). */
async function sameContent(a: string, b: string, size: number): Promise<boolean> {
  const MB = 1 << 20
  const spans = size <= 2 * MB ? [[0, size]] : [[0, MB], [size - MB, MB]]
  let fa: FileHandle | null = null
  let fb: FileHandle | null = null
  try {
    fa = await fs.open(a, 'r')
    fb = await fs.open(b, 'r')
    for (const [pos, len] of spans) {
      const ba = Buffer.alloc(len)
      const bb = Buffer.alloc(len)
      const [ra, rb] = await Promise.all([fa.read(ba, 0, len, pos), fb.read(bb, 0, len, pos)])
      if (ra.bytesRead !== rb.bytesRead || !ba.equals(bb)) return false
    }
    return true
  } catch {
    return false
  } finally {
    await fa?.close().catch(() => {})
    await fb?.close().catch(() => {})
  }
}

/** The folder a session's media are collected into : "<name> media" beside it. */
function mediaFolderOf(sessionPath: string): string {
  const name = basename(sessionPath).replace(/\.opsia\.json$/i, '').replace(/\.json$/i, '')
  return join(dirname(sessionPath), `${name} media`)
}

const isInside = (root: string, p: string): boolean => {
  const rel = relative(resolve(root), resolve(p))
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Copy each source to its destination, no file overwritten : a name already
 *  taken by a different file gets " (2)", " (3)"… Same size and date, or same
 *  size and the same bytes : the copy is already there. Only films and sounds
 *  are copied, and only into the session's own "<name> media" folder. Progress
 *  goes back as 'media:collectProgress'. */
async function collect(
  sender: WebContents,
  sessionPath: string,
  items: Array<{ src: string; dest: string }>
): Promise<{ ok: boolean; map: Record<string, string>; bytes: number; refused: number; error?: string }> {
  const map: Record<string, string> = {}
  let bytes = 0
  let done = 0
  let refused = 0
  const total = items.length
  if (typeof sessionPath !== 'string' || !isAbsolute(sessionPath) || !/\.json$/i.test(sessionPath) || (await kindOf(sessionPath)) !== 'file') {
    return { ok: false, map, bytes, refused, error: 'save the session first' }
  }
  const root = mediaFolderOf(sessionPath)
  const tell = (): void => { if (!sender.isDestroyed()) sender.send('media:collectProgress', { done, total, bytes }) }
  try {
    for (const it of items) {
      const src = typeof it?.src === 'string' ? it.src : ''
      const want = typeof it?.dest === 'string' ? it.dest : ''
      const st = src && isAbsolute(src) && MEDIA_FILE.test(src) ? await fs.stat(src).catch(() => null) : null
      if (!st?.isFile() || !want || !isInside(root, want) || !MEDIA_FILE.test(want)) {
        refused++
        done++
        tell()
        continue
      }
      await fs.mkdir(dirname(want), { recursive: true })
      let dest = want
      for (let n = 2; ; n++) {
        let other: import('fs').Stats | null = null
        try { other = await fs.stat(dest) } catch { other = null }
        if (!other) {
          // through a part file : a copy cut short (a full disk) never sits
          // under the real name, where the next collect would trust it
          const part = `${dest}.part`
          await fs.unlink(part).catch(() => {}) // left by a copy cut short before
          try {
            await fs.copyFile(src, part, fsc.COPYFILE_EXCL)
            await fs.rename(part, dest)
          } catch (e) {
            await fs.unlink(part).catch(() => {})
            throw e
          }
          bytes += st.size
          break
        }
        if (other.isFile() && other.size === st.size &&
          (Math.abs(other.mtimeMs - st.mtimeMs) < 2000 || (await sameContent(src, dest, st.size)))) break // already copied
        const ext = extname(want)
        dest = join(dirname(want), `${basename(want, ext)} (${n})${ext}`)
      }
      // keep the original's date (on our copy, or on the same bytes) : a later
      // collect then knows the copy is there at a glance
      try { await fs.utimes(dest, st.atime, st.mtime) } catch { /* not fatal */ }
      map[src] = dest
      done++
      tell()
    }
    return { ok: true, map, bytes, refused }
  } catch (e) {
    return { ok: false, map, bytes, refused, error: (e as Error).message }
  }
}

export function registerMediaRefs(): void {
  ipcMain.handle('media:check', async (_e, paths: unknown) => {
    const list = Array.isArray(paths) ? paths.slice(0, 100000).map(String) : []
    const out: Record<string, PathKind> = {}
    // a few at a time : a pool of thousands of films never floods the disk
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < list.length) {
        const p = list[next++]
        out[p] = await kindOf(p)
      }
    }
    await Promise.all(Array.from({ length: Math.min(32, list.length) }, worker))
    return out
  })
  ipcMain.handle('media:find', async (_e, root: unknown, wants: unknown) => {
    if (typeof root !== 'string' || !isAbsolute(root) || (await kindOf(root)) !== 'dir') return {}
    const list = Array.isArray(wants) ? wants.filter((w): w is string => typeof w === 'string' && w.length > 0 && w.length < 4096).slice(0, 50000) : []
    return findMissing(root, list)
  })
  ipcMain.handle('media:pickFolder', async (_e, title: string) => {
    const r = await dialog.showOpenDialog({ title: String(title || 'Choose a folder'), defaultPath: lastDir('mediaSearch'), properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths.length) return null
    rememberDir('mediaSearch', r.filePaths[0])
    return r.filePaths[0]
  })
  ipcMain.handle('media:collect', (e, sessionPath: string, items: Array<{ src: string; dest: string }>) =>
    collect(e.sender, sessionPath, Array.isArray(items) ? items : []))
}
