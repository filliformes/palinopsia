// Output recording + screenshots → the "Recorded" folder next to the app
// (project root in dev, install dir when packaged; falls back to <userData>).
// The renderer records the output canvas with MediaRecorder and streams the
// encoded chunks here; we append them to an open write stream so a long clip
// never has to sit in renderer memory or cross IPC as one giant buffer.

import { app } from 'electron'
import { createWriteStream, existsSync, promises as fs, type WriteStream } from 'fs'
import { join, dirname } from 'path'

function recordedFolder(): string {
  const base = app.isPackaged ? dirname(app.getPath('exe')) : process.cwd()
  return join(base, 'Recorded')
}

async function ensureFolder(): Promise<string> {
  let dir = recordedFolder()
  try {
    if (!existsSync(dir)) await fs.mkdir(dir, { recursive: true })
  } catch {
    dir = join(app.getPath('userData'), 'Recorded')
    if (!existsSync(dir)) await fs.mkdir(dir, { recursive: true })
  }
  return dir
}

// yyyymmdd-hhmmss (local) for sortable, collision-resistant filenames.
function stamp(): string {
  const d = new Date()
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

let stream: WriteStream | null = null
let currentPath: string | null = null

/** Open a new recording file; returns its full path (null on failure). */
export async function recordingStart(ext: string): Promise<string | null> {
  try {
    if (stream) stream.end() // a prior recording never stopped — close it first
    const dir = await ensureFolder()
    const safeExt = /^[a-z0-9]+$/i.test(ext) ? ext : 'webm'
    currentPath = join(dir, `opsia-${stamp()}.${safeExt}`)
    stream = createWriteStream(currentPath)
    return currentPath
  } catch (e) {
    console.error('[recording] start failed:', (e as Error).message)
    stream = null
    currentPath = null
    return null
  }
}

/** Append one MediaRecorder chunk to the open file. */
export function recordingChunk(data: Uint8Array): void {
  if (!stream) return
  stream.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength))
}

/** Close the file; returns the finished clip's path. */
export function recordingStop(): Promise<string | null> {
  return new Promise((resolve) => {
    const path = currentPath
    if (!stream) return resolve(path)
    stream.end(() => resolve(path))
    stream = null
    currentPath = null
  })
}

/** Write a one-shot PNG screenshot into Recorded/; returns its path. */
export async function saveScreenshot(data: Uint8Array): Promise<string | null> {
  try {
    const dir = await ensureFolder()
    const path = join(dir, `opsia-${stamp()}.png`)
    await fs.writeFile(path, Buffer.from(data.buffer, data.byteOffset, data.byteLength))
    return path
  } catch (e) {
    console.error('[recording] screenshot failed:', (e as Error).message)
    return null
  }
}
