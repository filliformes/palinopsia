// The Model source's files : read once on their own thread (workers/modelWorker.ts),
// kept by path, shared by every slot that shows the same file (A and B, the scenes,
// the Inspector's line that says what was read). Every file a slot still shows stays
// in memory (they ask for it each frame), and the last two no slot shows any more, so
// a scene that comes back to one does not read it again.
//
// One file is read at a time, the rest wait their turn. A file whose reading runs
// past WATCHDOG_MS (a damaged or hostile file that would keep the thread busy for
// ever) is given up : the thread is ended and a new one started for the files behind
// it, and that file says why.

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
// (a model of two million triangles reads in a few seconds)
const WATCHDOG_MS = 30000

class ModelLoader {
  private worker: Worker | null = null
  private entries = new Map<string, ModelState>()
  /** The file being read now (its message id), and the ones waiting their turn. */
  private pending = new Map<number, string>()
  private queue: Array<{ id: number; path: string; files: string[] }> = []
  private active: { id: number; path: string; timer: number } | null = null
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
      if (this.active?.id === m.id) this.endActive()
      const path = this.pending.get(m.id)
      this.pending.delete(m.id)
      if (path !== undefined) {
        if (m.t === 'done') {
          this.entries.set(path, { state: 'ready', mesh: m.mesh, read: m.read })
          this.touch(path)
          console.info(`[model] ${path} : ${m.mesh.info.points ? m.mesh.info.verts + ' points' : m.mesh.info.tris + ' triangles'}${m.mesh.info.notes.length ? ' (' + m.mesh.info.notes.join('; ') + ')' : ''}`)
        } else {
          this.entries.set(path, { state: 'error', message: m.message })
          console.warn(`[model] ${path} : ${m.message}`)
        }
        this.changed()
      } else if (m.t === 'done' && m.mesh.texture) m.mesh.texture.close() // (a read no longer wanted)
      this.next()
    }
    w.onerror = (e: ErrorEvent): void => {
      e.preventDefault()
      if (this.worker !== w) return
      // its thread stopped : the file it was reading fails, the files behind it are
      // read by a new one
      this.fail(e.message || 'the model reader stopped')
    }
    this.worker = w
    return w
  }

  /** The file being read now is given up (its thread ended, a new one for the rest). */
  private fail(message: string): void {
    const a = this.active
    this.endActive()
    this.worker?.terminate()
    this.worker = null
    if (a) {
      const path = this.pending.get(a.id)
      this.pending.delete(a.id)
      if (path !== undefined) {
        this.entries.set(path, { state: 'error', message })
        console.warn(`[model] ${path} : ${message}`)
        this.changed()
      }
    }
    this.next()
  }

  private endActive(): void {
    if (this.active) window.clearTimeout(this.active.timer)
    this.active = null
  }

  /** The next file waiting its turn, sent to the thread (one at a time). */
  private next(): void {
    while (!this.active && this.queue.length) {
      const job = this.queue.shift()!
      if (!this.pending.has(job.id)) continue // (asked again since : that ask reads it)
      const msg: ToModelWorker = { t: 'load', id: job.id, path: job.path, files: job.files }
      const timer = window.setTimeout(() => {
        if (this.active?.id === job.id) this.fail(`took over ${WATCHDOG_MS / 1000} s to read and was given up : the file may be damaged`)
      }, WATCHDOG_MS)
      this.active = { id: job.id, path: job.path, timer }
      this.start().postMessage(msg)
    }
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
    this.queue.push({ id, path, files: [...files] })
    this.next()
    this.changed()
    return st
  }

  /** The file read (or failed), with the files the session carries for it : the
   *  collect asks what each model really reads. */
  whenRead(path: string, files: readonly string[] = []): Promise<ModelState> {
    return new Promise((resolve) => {
      const done = (): boolean => {
        const st = this.peek(path)
        if (!st || st.state === 'loading') return false
        resolve(st)
        return true
      }
      this.get(path, files)
      if (done()) return
      const off = this.subscribe(() => { if (done()) off() })
    })
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
    this.endActive()
    this.worker?.terminate()
    this.worker = null
    this.pending.clear()
    this.queue = []
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
