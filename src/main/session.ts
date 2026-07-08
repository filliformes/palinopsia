// Session file I/O. Plain JSON, .opsia.json extension.
// Forked from dataFLOU's session.ts — same atomic-write discipline.

import { app, dialog, BrowserWindow } from 'electron'
import { promises as fs, existsSync } from 'fs'
import { join, dirname } from 'path'
import type { Session } from '@shared/types'

const FILTERS = [{ name: 'Palinopsia Session', extensions: ['opsia.json', 'json'] }]

/**
 * Atomic save: write to `<path>.tmp` then rename onto the final path.
 * `fs.rename` is atomic on the same filesystem, so a crash mid-write can
 * only leave the .tmp around — the original session file stays intact.
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
 * Resolve the project's "Sessions" folder — sessions land next to the app
 * (project root in dev, install dir when packaged), falling back to
 * `<userData>/Sessions` if the install location is read-only.
 */
function sessionsFolderPath(): string {
  if (app.isPackaged) {
    return join(dirname(app.getPath('exe')), 'Sessions')
  }
  return join(process.cwd(), 'Sessions')
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
  // Overwrite in place — this is the "keep the latest state of <name>" path
  // (quit-save / switch-save). Suffixing "(N)" here used to mint a new file on
  // every app close, flooding Sessions/ with Untitled (N) duplicates.
  const candidate = join(dir, `${safe}.opsia.json`)
  await atomicWriteJson(candidate, session)
  return candidate
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
