// A session's media on disk : is each file still there, where did a missing
// one go (searched by name under a folder you pick), and copying them all next
// to the session (so it travels between computers). The renderer gathers the
// paths from the session and rewrites them; this side only touches the disk.

import { dialog, ipcMain, type WebContents } from 'electron'
import { promises as fs, constants as fsc } from 'fs'
import { basename, dirname, extname, join } from 'path'
import { lastDir, rememberDir } from './lastDir'

export type PathKind = 'file' | 'dir' | 'none'

async function kindOf(p: string): Promise<PathKind> {
  try {
    const st = await fs.stat(p)
    return st.isDirectory() ? 'dir' : 'file'
  } catch {
    return 'none'
  }
}

/** Under `root`, the first file (or folder) carrying each wanted name (case
 *  ignored), the shallowest first. A bounded walk : hidden folders and
 *  node_modules are skipped, and it stops after 200 000 entries. */
async function findByName(root: string, names: string[]): Promise<Record<string, string>> {
  const want = new Set(names.map((n) => n.toLowerCase()))
  const found: Record<string, string> = {}
  let seen = 0
  let level = [root]
  for (let depth = 0; depth < 10 && level.length && Object.keys(found).length < want.size; depth++) {
    const next: string[] = []
    for (const dir of level) {
      let ents: import('fs').Dirent[]
      try { ents = await fs.readdir(dir, { withFileTypes: true }) } catch { continue }
      for (const e of ents) {
        if (++seen > 200000) return found
        const k = e.name.toLowerCase()
        const full = join(dir, e.name)
        if (want.has(k) && !found[k]) found[k] = full
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') next.push(full)
      }
    }
    level = next
  }
  return found
}

/** Copy each source to its destination, no file overwritten : a name already
 *  taken by a different file gets " (2)", " (3)"… Same size and date : the copy
 *  is already there. Progress goes back as 'media:collectProgress'. */
async function collect(sender: WebContents, items: Array<{ src: string; dest: string }>): Promise<{ ok: boolean; map: Record<string, string>; bytes: number; error?: string }> {
  const map: Record<string, string> = {}
  let bytes = 0
  let done = 0
  const total = items.length
  try {
    for (const it of items) {
      const st = await fs.stat(it.src)
      await fs.mkdir(dirname(it.dest), { recursive: true })
      let dest = it.dest
      for (let n = 2; ; n++) {
        let other: import('fs').Stats | null = null
        try { other = await fs.stat(dest) } catch { other = null }
        if (!other) {
          await fs.copyFile(it.src, dest, fsc.COPYFILE_EXCL)
          bytes += st.size
          break
        }
        if (other.size === st.size && Math.abs(other.mtimeMs - st.mtimeMs) < 2000) break // already copied
        if (other.size === st.size) break // the same file, copied earlier with a fresh date
        const ext = extname(it.dest)
        dest = join(dirname(it.dest), `${basename(it.dest, ext)} (${n})${ext}`)
      }
      // keep the original's date : a later collect then knows the copy is there
      try { await fs.utimes(dest, st.atime, st.mtime) } catch { /* not fatal */ }
      map[it.src] = dest
      done++
      if (!sender.isDestroyed()) sender.send('media:collectProgress', { done, total, bytes })
    }
    return { ok: true, map, bytes }
  } catch (e) {
    return { ok: false, map, bytes, error: (e as Error).message }
  }
}

export function registerMediaRefs(): void {
  ipcMain.handle('media:check', async (_e, paths: string[]) => {
    const list = Array.isArray(paths) ? paths.slice(0, 5000) : []
    const out: Record<string, PathKind> = {}
    await Promise.all(list.map(async (p) => { out[p] = await kindOf(String(p)) }))
    return out
  })
  ipcMain.handle('media:find', async (_e, root: string, names: string[]) =>
    findByName(String(root), Array.isArray(names) ? names.map(String) : []))
  ipcMain.handle('media:pickFolder', async (_e, title: string) => {
    const r = await dialog.showOpenDialog({ title: String(title || 'Choose a folder'), defaultPath: lastDir('mediaSearch'), properties: ['openDirectory'] })
    if (r.canceled || !r.filePaths.length) return null
    rememberDir('mediaSearch', r.filePaths[0])
    return r.filePaths[0]
  })
  ipcMain.handle('media:collect', (e, items: Array<{ src: string; dest: string }>) =>
    collect(e.sender, Array.isArray(items) ? items : []))
}
