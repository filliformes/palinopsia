// Strata's clouds, asked of their worker (workers/strataWorker.ts) and kept : the four
// places once made, a file's cloud as long as its mesh is (modelLoad.ts forgets those no
// slot shows). Shared by every slot that shows the same one.

import StrataWorker from '../workers/strataWorker?worker&inline'
import type { FromStrataWorker, ToStrataWorker } from '../workers/strataWorker'
import type { MeshData } from './modelMesh'
import type { DrawCloud } from './strataPlaces'

/** A cloud, 'making' (in the worker now), or why it could not be made. */
export type CloudState = DrawCloud | 'making' | { error: string }

class StrataClouds {
  private worker: Worker | null = null
  private places = new Map<number, CloudState>()
  private meshes = new WeakMap<MeshData, CloudState>()
  private waiting = new Map<number, (s: CloudState) => void>()
  private nextId = 1

  private ask(msg: ToStrataWorker, put: (s: CloudState) => void): void {
    this.waiting.set(msg.id, put)
    if (!this.worker) {
      const w = new StrataWorker()
      w.onmessage = (e: MessageEvent<FromStrataWorker>): void => {
        const m = e.data
        const f = this.waiting.get(m.id)
        this.waiting.delete(m.id)
        f?.(m.t === 'done' ? m.cloud : { error: m.message })
        // (nothing left to make : its thread and its memory go)
        if (!this.waiting.size) { this.worker?.terminate(); this.worker = null }
      }
      w.onerror = (e: ErrorEvent): void => {
        e.preventDefault()
        const all = [...this.waiting.values()]
        this.waiting.clear()
        this.worker?.terminate()
        this.worker = null
        console.error('[strata] clouds:', e.message)
        for (const f of all) f({ error: 'the cloud could not be made' })
      }
      this.worker = w
    }
    try {
      this.worker.postMessage(msg)
    } catch (e) {
      this.waiting.delete(msg.id)
      throw e
    }
  }

  /** One of the four places (strataPlaces.ts PLACE_NAMES). */
  place(i: number): CloudState {
    const cur = this.places.get(i)
    if (cur) return cur
    this.places.set(i, 'making')
    this.ask({ t: 'place', id: this.nextId++, place: i }, (s) => this.places.set(i, s))
    return 'making'
  }

  /** A model's vertices or a scan's points. */
  mesh(m: MeshData): CloudState {
    const cur = this.meshes.get(m)
    if (cur) return cur
    this.meshes.set(m, 'making')
    // (the texture coordinates only where a texture reads them : the rest is copied over)
    const tex = m.info.hasTex ? m.texture : null
    const put = (s: CloudState): void => { this.meshes.set(m, s) }
    const send = (t: ImageBitmap | null): void =>
      this.ask({ t: 'mesh', id: this.nextId++, mesh: { pos: m.pos, uv: t ? m.uv : null, col: m.col, hasColor: m.info.hasColor, texture: t } }, put)
    try {
      send(tex)
    } catch (e) {
      // (a texture closed meanwhile cannot be copied over : the vertex colors alone)
      if (tex) send(null)
      else put({ error: (e as Error).message })
    }
    return this.meshes.get(m)!
  }

  shutdown(): void {
    this.worker?.terminate()
    this.worker = null
    this.waiting.clear()
    this.places.clear()
  }
}

export const strataClouds = new StrataClouds()

// A hot update re-runs this module as a new copy : end the old copy's thread
// (dev only, compiled out of builds).
if (import.meta.hot) {
  const g = globalThis as { __opsiaStrata?: StrataClouds }
  g.__opsiaStrata?.shutdown()
  g.__opsiaStrata = strataClouds
}
