// Light setups as files : the rig (fixtures, outputs, groups, kinds) and what the
// lights show (looks, cues, masters), to carry a room's setup to another computer
// or to keep several beside one project. The renderer makes and reads the JSON
// (it sanitizes what it loads); main only asks where and writes or reads the text.

import { dialog, type BrowserWindow } from 'electron'
import { readFile, stat, writeFile } from 'fs/promises'

const FILTERS = [{ name: 'Palinopsia light setup', extensions: ['opsialights', 'json'] }]
const MAX_BYTES = 8 * 1024 * 1024

export async function saveLightSetupFile(parent: BrowserWindow | null, text: string, name: string): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (typeof text !== 'string' || text.length > MAX_BYTES) return { ok: false, error: 'too large' }
  const safe = String(name || 'lights').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'lights'
  const opts = { title: 'Save the light setup', defaultPath: `${safe}.opsialights`, filters: FILTERS }
  const r = parent ? await dialog.showSaveDialog(parent, opts) : await dialog.showSaveDialog(opts)
  if (r.canceled || !r.filePath) return { ok: false }
  try {
    await writeFile(r.filePath, text, 'utf8')
    return { ok: true, path: r.filePath }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}

export async function openLightSetupFile(parent: BrowserWindow | null): Promise<{ ok: boolean; text?: string; name?: string; error?: string }> {
  const opts = { title: 'Open a light setup', filters: FILTERS, properties: ['openFile' as const] }
  const r = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts)
  const file = r.filePaths[0]
  if (r.canceled || !file) return { ok: false }
  try {
    if ((await stat(file)).size > MAX_BYTES) return { ok: false, error: 'that file is too large to be a light setup' }
    const base = file.replace(/^.*[\\/]/, '').replace(/\.(opsialights|json)$/i, '')
    return { ok: true, text: await readFile(file, 'utf8'), name: base }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
