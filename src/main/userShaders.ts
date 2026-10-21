// Your own shaders (the Source Editor) : plain ISF files in a "Shaders" folder
// beside "Sessions" (the project folder in dev, Documents/Palinopsia packaged),
// one file per shader, named after it. The renderer registers them all at
// start ("My shaders" in the source and FX menus); a session that plays one
// also carries its source, so it opens on a computer that never had the file.

import { app, dialog, ipcMain, shell } from 'electron'
import { promises as fs, mkdirSync } from 'fs'
import { basename, extname, join } from 'path'
import { userFilesBase } from './paths'
import { lastDir, rememberDir } from './lastDir'
import { fileNameOf, userShaderId } from '@shared/userShaderId'

const EXT = /\.(fs|frag|glsl|isf)$/i

export function shadersDir(): string {
  const d = join(userFilesBase(), 'Shaders')
  try {
    mkdirSync(d, { recursive: true })
    return d
  } catch {
    const f = join(app.getPath('userData'), 'Shaders')
    mkdirSync(f, { recursive: true })
    return f
  }
}

// ── history : no overwrite is final ──────────────────────────────────────
// Before a shader file is written over or removed (a save under its name, by
// you or the agent, its twin spellings, a delete), its content is kept in
// Shaders/.history/<name>/ (the newest HISTORY_KEEP versions), like a session's.
// The hidden folder never reaches the menus (list() reads only shader files).
const HISTORY_KEEP = 30
const stamp = (): string => {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
}
async function keepHistory(file: string, next: string | null): Promise<void> {
  let old: string
  try {
    old = await fs.readFile(file, 'utf8')
  } catch {
    return // nothing there yet
  }
  if (old === next) return // unchanged : no new version
  const dir = join(shadersDir(), '.history', basename(file, extname(file)))
  await fs.mkdir(dir, { recursive: true })
  const at = stamp()
  let to = join(dir, `${at}${extname(file)}`)
  for (let n = 2; n < 50; n++) {
    try { await fs.access(to) } catch { break } // a free name
    to = join(dir, `${at} ${n}${extname(file)}`)
  }
  await fs.writeFile(to, old, 'utf8')
  const files = (await fs.readdir(dir)).filter((f) => EXT.test(f)).sort()
  for (const f of files.slice(0, Math.max(0, files.length - HISTORY_KEEP))) await fs.rm(join(dir, f)).catch(() => {})
}
const keep = async (file: string, next: string | null): Promise<void> => {
  try { await keepHistory(file, next) } catch (e) { console.error('[shaders] history copy failed:', (e as Error).message) }
}

async function list(): Promise<Array<{ name: string; file: string; source: string; mtime: number }>> {
  const d = shadersDir()
  const out: Array<{ name: string; file: string; source: string; mtime: number }> = []
  let names: string[] = []
  try { names = await fs.readdir(d) } catch { return out }
  for (const f of names) {
    if (!EXT.test(f)) continue
    const p = join(d, f)
    try {
      const st = await fs.stat(p)
      if (!st.isFile() || st.size > 2_000_000) continue
      out.push({ name: basename(f, extname(f)), file: p, source: await fs.readFile(p, 'utf8'), mtime: st.mtimeMs })
    } catch { /* unreadable : skipped */ }
  }
  // two files that are one shader ("Foo.fs" and "Foo.frag", "Waves 2" and
  // "Waves_2") : the newest is the one
  const byId = new Map<string, (typeof out)[number]>()
  for (const s of out) {
    const id = userShaderId(s.name)
    const had = byId.get(id)
    if (!had || s.mtime > had.mtime) byId.set(id, s)
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Every file that is the shader called `name` (its id) : the others are
 *  removed when it is saved again under this name; all go when it is deleted. */
async function filesOf(name: string): Promise<string[]> {
  const id = userShaderId(name)
  let names: string[] = []
  try { names = await fs.readdir(shadersDir()) } catch { return [] }
  return names.filter((f) => EXT.test(f) && userShaderId(basename(f, extname(f))) === id).map((f) => join(shadersDir(), f))
}

export function registerUserShaders(): void {
  ipcMain.handle('shaders:list', () => list())
  ipcMain.handle('shaders:save', async (_e, name: string, source: string) => {
    const n = fileNameOf(String(name ?? ''))
    const file = join(shadersDir(), `${n}.fs`)
    const src = String(source ?? '')
    try {
      // what it replaces (this file, its twins) goes to the history first
      const twins = await filesOf(n)
      for (const f of twins) await keep(f, src)
      await fs.writeFile(file, src, 'utf8')
      // the same shader under another spelling or extension : this one replaces it
      for (const f of twins) if (f.toLowerCase() !== file.toLowerCase()) await fs.unlink(f).catch(() => {})
      return { ok: true, name: n, file }
    } catch (e) {
      return { ok: false, name: n, file, error: (e as Error).message }
    }
  })
  ipcMain.handle('shaders:delete', async (_e, name: string) => {
    let gone = false
    for (const f of await filesOf(fileNameOf(String(name ?? '')))) {
      await keep(f, null)
      try { await fs.unlink(f); gone = true } catch { /* not this one */ }
    }
    return gone
  })
  ipcMain.handle('shaders:openFile', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Open a shader (ISF)',
      defaultPath: lastDir('shaderOpen'),
      properties: ['openFile'],
      filters: [{ name: 'ISF shaders', extensions: ['fs', 'frag', 'glsl', 'isf'] }]
    })
    if (r.canceled || !r.filePaths.length) return null
    const p = r.filePaths[0]
    rememberDir('shaderOpen', p)
    try {
      return { name: basename(p, extname(p)), source: await fs.readFile(p, 'utf8') }
    } catch {
      return null
    }
  })
  ipcMain.handle('shaders:reveal', async () => {
    await shell.openPath(shadersDir())
    return shadersDir()
  })
}
