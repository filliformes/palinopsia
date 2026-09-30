// Session file I/O. Plain JSON, .opsia.json extension.
// Forked from dataFLOU's session.ts : same atomic-write discipline.

import { app, dialog, BrowserWindow } from 'electron'
import { promises as fs, existsSync } from 'fs'
import { basename, join, relative, resolve } from 'path'
import type { Session } from '@shared/types'
import { userFilesBase } from './paths'

const FILTERS = [{ name: 'Palinopsia Session', extensions: ['opsia.json', 'json'] }]

/**
 * Atomic save: write to `<path>.tmp` then rename onto the final path.
 * `fs.rename` is atomic on the same filesystem, so a crash mid-write can
 * only leave the .tmp around : the original session file stays intact.
 */
async function atomicWriteJson(path: string, session: Session): Promise<void> {
  const tmpPath = `${path}.tmp`
  const json = JSON.stringify(session, null, 2)
  await fs.writeFile(tmpPath, json, 'utf8')
  await fs.rename(tmpPath, path)
}

export async function saveAs(
  parent: BrowserWindow | null,
  session: Session
): Promise<string | null> {
  const result = await dialog.showSaveDialog(parent ?? undefined!, {
    title: 'Save Session',
    defaultPath: `${session.name || 'session'}.opsia.json`,
    filters: FILTERS
  })
  if (result.canceled || !result.filePath) return null
  await atomicWriteJson(result.filePath, session)
  return result.filePath
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

export async function saveToDefault(session: Session): Promise<string> {
  let dir = sessionsFolderPath()
  try {
    if (!existsSync(dir)) await fs.mkdir(dir, { recursive: true })
  } catch (e) {
    console.error(
      '[session.saveToDefault] Sessions folder unwritable, falling back to userData:',
      (e as Error).message
    )
    dir = join(app.getPath('userData'), 'Sessions')
    if (!existsSync(dir)) await fs.mkdir(dir, { recursive: true })
  }
  const safe =
    (session.name || 'session')
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'session'
  // Overwrite in place : this is the "keep the latest state of <name>" path
  // (quit-save / switch-save). Suffixing "(N)" here used to mint a new file on
  // every app close, flooding Sessions/ with Untitled (N) duplicates.
  const candidate = join(dir, `${safe}.opsia.json`)
  await atomicWriteJson(candidate, session)
  return candidate
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
    properties: ['openDirectory']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const folder = resolve(result.filePaths[0])
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
 *  next to the app plus the userData fallback (saveToDefault may land in either),
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
    filters: FILTERS,
    properties: ['openFile']
  })
  if (result.canceled || result.filePaths.length === 0) return null
  const path = result.filePaths[0]
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
