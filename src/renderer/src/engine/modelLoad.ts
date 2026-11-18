// The Model source's files : read once on their own thread (workers/modelWorker.ts),
// kept by path, shared by every slot that shows the same file (A and B, the scenes,
// the Inspector's line that says what was read). Every file a slot still shows stays
// in memory (they ask for it each frame), and the last two no slot shows any more, so
// a scene that comes back to one does not read it again.

import ModelWorker from '../workers/modelWorker?worker&inline'
import type { FromModelWorker, ToModelWorker } from '../workers/modelWorker'
import type { MeshData } from './modelMesh'

export type ModelState =
  | { state: 'loading' }
  | { state: 'ready'; mesh: MeshData; read: string[] }
  | { state: 'error'; message: string }

const KEEP = 2
// (a file not asked for this long is no longer on screen)
const IDLE_MS = 5000

class ModelLoader {
  private worker: Worker | null = null
  private entries = new Map<string, ModelState>()
  private pending = new Map<number, string>()
  private used: string[] = []
  private asked = new Map<string, number>()
  private nextId = 1
  private listeners = new Set<() => void>()
  /** Bumped on every change : a cheap "has anything landed" for the engines. */
  version = 0

  private start(): Worker {
    if (this.worker) return this.worker
    const w = new ModelWorker()
    w.onmessage = (e: MessageEvent<FromModelWorker>): void => {
      if (this.worker !== w) return
      const m = e.data
      const path = this.pending.get(m.id)
      this.pending.delete(m.id)
      if (path === undefined) return
      if (m.t === 'done') {
        this.entries.set(path, { state: 'ready', mesh: m.mesh, read: m.read })
        this.touch(path)
        console.info(`[model] ${path} : ${m.mesh.info.points ? m.mesh.info.verts + ' points' : m.mesh.info.tris + ' triangles'}${m.mesh.info.notes.length ? ' (' + m.mesh.info.notes.join('; ') + ')' : ''}`)
      } else {
        this.entries.set(path, { state: 'error', message: m.message })
        console.warn(`[model] ${path} : ${m.message}`)
      }
      this.changed()
    }
    w.onerror = (e: ErrorEvent): void => {
      e.preventDefault()
      if (this.worker !== w) return
      // its thread stopped : every file it was reading fails, the next ask starts a new one
      for (const [, path] of this.pending) this.entries.set(path, { state: 'error', message: e.message || 'the model reader stopped' })
      this.pending.clear()
      this.worker = null
      w.terminate()
      this.changed()
    }
    this.worker = w
    return w
  }

  /** Forget the files no slot shows any more, beyond the last KEEP of them (run when
   *  a file lands : never while a slot is drawing one, which would read it again). */
  private touch(path: string): void {
    this.used = [path, ...this.used.filter((p) => p !== path)]
    const now = performance.now()
    let idle = 0
    for (const p of this.used) {
      if (now - (this.asked.get(p) ?? 0) < IDLE_MS) continue
      if (++idle <= KEEP) continue
      if (this.entries.get(p)?.state === 'ready') this.entries.delete(p)
      this.asked.delete(p)
    }
    this.used = this.used.filter((p) => this.entries.has(p))
  }

  private changed(): void {
    this.version++
    for (const fn of this.listeners) fn()
  }

  /** The file's state, its reading started on the first ask. */
  get(path: string, files: readonly string[] = []): ModelState {
    this.asked.set(path, performance.now())
    const e = this.entries.get(path)
    if (e) return e
    const st: ModelState = { state: 'loading' }
    this.entries.set(path, st)
    const id = this.nextId++
    this.pending.set(id, path)
    const msg: ToModelWorker = { t: 'load', id, path, files: [...files] }
    this.start().postMessage(msg)
    this.changed()
    return st
  }

  /** What is known about a file without reading it (null : never asked). */
  peek(path: string): ModelState | null {
    return this.entries.get(path) ?? null
  }

  /** Read it again (the file changed on disk, or was relinked). */
  reload(path: string, files: readonly string[] = []): void {
    for (const [id, p] of this.pending) if (p === path) this.pending.delete(id)
    this.entries.delete(path)
    this.get(path, files)
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  shutdown(): void {
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
    this.entries.clear()
    this.used = []
  }
}

export const modelLoader = new ModelLoader()

// A hot update re-runs this module as a new copy : end the old copy's thread
// (dev only, compiled out of builds).
if (import.meta.hot) {
  const g = globalThis as { __opsiaModel?: ModelLoader }
  g.__opsiaModel?.shutdown()
  g.__opsiaModel = modelLoader
}
