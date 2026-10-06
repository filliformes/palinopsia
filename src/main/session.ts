// Session file I/O. Plain JSON, .opsia.json extension.
// Forked from dataFLOU's session.ts : same atomic-write discipline.

import { app, dialog, BrowserWindow } from 'electron'
import { promises as fs, existsSync } from 'fs'
import { basename, dirname, join, relative, resolve } from 'path'
import type { Session } from '@shared/types'
import { userFilesBase } from './paths'
import { lastDir, rememberDir } from './lastDir'

const FILTERS = [{ name: 'Palinopsia Session', extensions: ['opsia.json', 'json'] }]

// ── Session history ──────────────────────────────────────────────────────
// Before a session file is replaced, its previous content is kept in a hidden
// `.history/<name>/` folder beside it (the newest HISTORY_KEEP versions), so no
// overwrite is ever final : a session overwritten by mistake comes back from
// right-click Load → "Earlier versions". Hidden folders never reach the
// Session dropdown (scanSessions and listDefault skip them).
const HISTORY_KEEP = 30
const historyRoot = (path: string): string => join(dirname(path), '.history')
const stem = (path: string): string => basename(path).replace(/\.opsia\.json$/i, '').replace(/\.json$/i, '')
const stamp = (): string => {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}
export const historyDir = (path: string): string => join(historyRoot(path), stem(path))

async function keepHistory(path: string, next: string): Promise<void> {
  let old: string
  try {
    old = await fs.readFile(path, 'utf8')
  } catch {
    return // nothing there yet
  }
  if (old === next) return // unchanged : no new version
  const dir = historyDir(path)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, `${stamp()}.opsia.json`), old, 'utf8')
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.opsia.json')).sort()
  for (const f of files.slice(0, Math.max(0, files.length - HISTORY_KEEP))) {
    await fs.rm(join(dir, f)).catch(() => {})
  }
}

/**
 * Atomic save: write to `<path>.tmp` then rename onto the final path.
 * `fs.rename` is atomic on the same filesystem, so a crash mid-write can
 * only leave the .tmp around : the original session file stays intact.
 * The version being replaced goes to the session's history first.
 */
async function atomicWriteJson(path: string, session: Session): Promise<void> {
  const tmpPath = `${path}.tmp`
  const json = JSON.stringify(session, null, 2)
  try {
    await keepHistory(path, json)
  } catch (e) {
    console.error('[session] history copy failed:', (e as Error).message)
  }
  await fs.writeFile(tmpPath, json, 'utf8')
  await fs.rename(tmpPath, path)
}

export async function saveAs(
  parent: BrowserWindow | null,
  session: Session,
  currentPath?: string | null
): Promise<string | null> {
  const result = await dialog.showSaveDialog(parent ?? undefined!, {
    title: 'Save Session',
    // Start from the file it came from (its folder and name), else the
    // Sessions folder and the session's name.
    defaultPath: currentPath || join(sessionsFolderPath(), `${session.name || 'session'}.opsia.json`),
    filters: FILTERS
  })
  if (result.canceled || !result.filePath) return null
  rememberDir('session', result.filePath)
  // The name INSIDE follows the file name, so a Save As copy never carries the
  // old session's name (that drift once sent a crash-recovered session onto
  // another file of that name).
  await atomicWriteJson(result.filePath, { ...session, name: stem(result.filePath) })
  return result.filePath
}

/** Keep a copy of a session the user chose not to save (or a performance switch
 *  that never prompts) in Sessions/.history/_unsaved : never a session file. */
export async function keepRecovery(session: Session): Promise<string> {
  const safe = (session.name || 'session').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'session'
  const dir = join(sessionsFolderPath(), '.history', '_unsaved')
  await fs.mkdir(dir, { recursive: true })
  const path = join(dir, `${stamp()} ${safe}.opsia.json`)
  await fs.writeFile(path, JSON.stringify(session, null, 2), 'utf8')
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.opsia.json')).sort()
  for (const f of files.slice(0, Math.max(0, files.length - 60))) await fs.rm(join(dir, f)).catch(() => {})
  return path
}

/** Pick one of a session's earlier versions (its .history folder). */
export async function openVersion(
  parent: BrowserWindow | null,
  path: string
): Promise<{ session: Session; path: string } | null> {
  const dir = historyDir(path)
  if (!existsSync(dir)) return null
  const result = await dialog.showOpenDialog(parent ?? undefined!, {
    title: `Earlier versions of ${stem(path)}`,
    defaultPath: dir,
    filters: FILTERS,
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return { session: await loadFromPath(result.filePaths[0]), path: result.filePaths[0] }
}

/** How many earlier versions a session has. */
export async function versionCount(path: string): Promise<number> {
  try {
    return (await fs.readdir(historyDir(path))).filter((f) => f.endsWith('.opsia.json')).length
  } catch {
    return 0
  }
}

export async function saveTo(path: string, session: Session): Promise<boolean> {
  await atomicWriteJson(path, session)
  return true
}

/**
 * Resolve the "Sessions" folder : repo root in dev, ~/Documents/Palinopsia when
 * packaged (see userFilesBase), falling back to `<userData>/Sessions` if that
 * location is read-only.
 */
function sessionsFolderPath(): string {
  return join(userFilesBase(), 'Sessions')
}

// ── Linked session folders ──────────────────────────────────────────────
// Folders the user pointed the Session loader at (right-click Load) : every
// session inside them (and their subfolders) joins the dropdown. LINKED, not
// copied : a session saved there later shows up too. Kept in userData.
type SessionEntry = { name: string; path: string; mtime: number; group?: string }
const foldersFile = (): string => join(app.getPath('userData'), 'session-folders.json')
const MAX_DEPTH = 3 // a show folder with per-act subfolders, not a whole disk
const MAX_FILES = 1000

export async function linkedFolders(): Promise<string[]> {
  try {
    const j = JSON.parse(await fs.readFile(foldersFile(), 'utf8'))
    return Array.isArray(j) ? j.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

async function writeFolders(list: string[]): Promise<void> {
  const tmp = `${foldersFile()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8')
  await fs.rename(tmp, foldersFile())
}

/** Every .opsia.json under `dir`, a few levels deep (hidden folders skipped). */
async function scanSessions(dir: string, depth: number, out: string[]): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
  let ents: import('fs').Dirent[]
  try {
    ents = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return // gone, unplugged, no access
  }
  for (const e of ents) {
    if (out.length >= MAX_FILES) return
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) await scanSessions(p, depth + 1, out)
    else if (e.isFile() && /\.opsia\.json$/i.test(e.name)) out.push(p)
  }
}

/** Pick a folder and link it. Returns the folder and how many sessions it holds. */
export async function addFolder(parent: BrowserWindow | null): Promise<{ folder: string; count: number } | null> {
  const result = await dialog.showOpenDialog(parent ?? undefined!, {
    title: 'Link a folder of sessions',
    defaultPath: lastDir('sessionFolder', sessionsFolderPath()),
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const folder = resolve(result.filePaths[0])
  rememberDir('sessionFolder', folder)
  const list = await linkedFolders()
  if (!list.some((f) => resolve(f).toLowerCase() === folder.toLowerCase())) {
    list.push(folder)
    await writeFolders(list)
  }
  const found: string[] = []
  await scanSessions(folder, 0, found)
  return { folder, count: found.length }
}

export async function removeFolder(folder: string): Promise<boolean> {
  const list = await linkedFolders()
  const next = list.filter((f) => resolve(f).toLowerCase() !== resolve(folder).toLowerCase())
  if (next.length === list.length) return false
  await writeFolders(next)
  return true
}

/** List every saved session across the Sessions folder(s) : the primary folder
 *  next to the app plus the userData fallback (older builds saved there too),
 *  then each linked folder. The display name is the FILENAME (what the user chose
 *  in Save As), not the in-JSON `name` : those are often a stale "Untitled" even
 *  when the file is named meaningfully. The default folders are deduped by
 *  basename, newest first; each linked folder follows as its own group, in name
 *  order (a show folder numbered 01, 02… plays in order), a subfolder's sessions
 *  named with their subfolder. */
export async function listSaved(): Promise<SessionEntry[]> {
  const out = await listDefault()
  const seenPath = new Set(out.map((e) => resolve(e.path).toLowerCase()))
  for (const folder of await linkedFolders()) {
    const files: string[] = []
    await scanSessions(folder, 0, files)
    const group = basename(folder) || folder
    const entries: SessionEntry[] = []
    for (const path of files) {
      const key = resolve(path).toLowerCase()
      if (seenPath.has(key)) continue
      seenPath.add(key)
      let mtime = 0
      try {
        mtime = (await fs.stat(path)).mtimeMs
      } catch {
        /* keep mtime 0 */
      }
      const name = relative(folder, path).replace(/\.opsia\.json$/i, '').replace(/\\/g, '/')
      entries.push({ name, path, mtime, group })
    }
    entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    out.push(...entries)
  }
  return out
}

async function listDefault(): Promise<SessionEntry[]> {
  const dirs = [sessionsFolderPath(), join(app.getPath('userData'), 'Sessions')]
  const seenName = new Set<string>()
  const out: SessionEntry[] = []
  for (const dir of dirs) {
    let files: string[]
    try {
      files = (await fs.readdir(dir)).filter((f) => f.endsWith('.opsia.json'))
    } catch {
      continue // folder doesn't exist yet
    }
    for (const f of files) {
      const name = f.replace(/\.opsia\.json$/i, '')
      if (seenName.has(name)) continue // primary folder wins over the fallback
      seenName.add(name)
      const path = join(dir, f)
      let mtime = 0
      try {
        mtime = (await fs.stat(path)).mtimeMs
      } catch {
        /* keep mtime 0 */
      }
      out.push({ name, path, mtime })
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

/** Load + validate a session from an explicit path (the Session Loader). */
export async function loadFromPath(path: string): Promise<Session> {
  const text = await fs.readFile(path, 'utf8')
  let session: Session
  try {
    session = JSON.parse(text) as Session
  } catch (e) {
    throw new Error(`Session file could not be parsed: ${(e as Error).message}`)
  }
  if (!session || typeof session !== 'object') throw new Error('Session file is not a JSON object')
  if (session.version !== 1)
    throw new Error(`Unsupported session version: ${session.version}. Expected 1.`)
  return session
}

export async function open(
  parent: BrowserWindow | null
): Promise<{ session: Session; path: string } | null> {
  const result = await dialog.showOpenDialog(parent ?? undefined!, {
    title: 'Open Session',
    defaultPath: lastDir('session', sessionsFolderPath()),
    filters: FILTERS,
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const path = result.filePaths[0]
  rememberDir('session', path)
  const text = await fs.readFile(path, 'utf8')
  let session: Session
  try {
    session = JSON.parse(text) as Session
  } catch (e) {
    throw new Error(`Session file could not be parsed: ${(e as Error).message}`)
  }
  if (!session || typeof session !== 'object') {
    throw new Error('Session file is not a JSON object')
  }
  if (session.version !== 1) {
    throw new Error(`Unsupported session version: ${session.version}. Expected 1.`)
  }
  return { session, path }
}
