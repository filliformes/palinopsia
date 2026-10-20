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
import { userShaderId } from '@shared/userShaderId'

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

/** A name a file can carry (the shader's name IS its file name). */
const fileNameOf = (name: string): string =>
  name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'shader'

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
    try {
      await fs.writeFile(file, String(source ?? ''), 'utf8')
      // the same shader under another spelling or extension : this one replaces it
      for (const f of await filesOf(n)) if (f.toLowerCase() !== file.toLowerCase()) await fs.unlink(f).catch(() => {})
      return { ok: true, name: n, file }
    } catch (e) {
      return { ok: false, name: n, file, error: (e as Error).message }
    }
  })
  ipcMain.handle('shaders:delete', async (_e, name: string) => {
    let gone = false
    for (const f of await filesOf(fileNameOf(String(name ?? '')))) {
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
