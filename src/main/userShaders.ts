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
  return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function registerUserShaders(): void {
  ipcMain.handle('shaders:list', () => list())
  ipcMain.handle('shaders:save', async (_e, name: string, source: string) => {
    const n = fileNameOf(String(name ?? ''))
    const file = join(shadersDir(), `${n}.fs`)
    try {
      await fs.writeFile(file, String(source ?? ''), 'utf8')
      return { ok: true, name: n, file }
    } catch (e) {
      return { ok: false, name: n, file, error: (e as Error).message }
    }
  })
  ipcMain.handle('shaders:delete', async (_e, name: string) => {
    const n = fileNameOf(String(name ?? ''))
    for (const ext of ['.fs', '.frag', '.glsl', '.isf']) {
      try { await fs.unlink(join(shadersDir(), n + ext)); return true } catch { /* not this one */ }
    }
    return false
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
