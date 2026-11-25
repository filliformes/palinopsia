// third-party: The dataflou core
// The dataflou addon (native/dataflou : the core 9.3 behind its C interface), loaded
// once, and one node of it. Each node polls on a thread of its own inside the addon;
// what is asked here is queued to that thread and answered by a promise, what the node
// says comes back in batches (one wake for everything that waits). Without the module
// the app runs normally and the dataflou section says so.

import type { DfAxis, DfValue } from '@shared/dataflou'

export type DfEvent =
  | { k: 'value'; path: string; value: DfValue | null }
  | { k: 'fire'; path: string; times: number }
  | { k: 'dest'; path: string; state: number; origin: number; connections: number; live: number }
  | { k: 'locate'; path: string; on: boolean }
  | { k: 'halt'; on: boolean }
  | { k: 'peer'; sku: string; label: string; joined: boolean }
  | { k: 'scene'; op: number; slot: number; state: number; skipped: number; current: number; slots: number }
  | { k: 'topology' }
  | { k: 'log'; text: string }
  | { k: 'reply'; id: number; as: string; value: DfValue | null }
  | { k: 'started'; port: number }
  | { k: 'failed'; text: string }

export interface DfArgs {
  s?: string[]
  n?: number[]
  value?: DfValue | null
  sets?: Array<[string, DfValue | null]>
  axes?: DfAxis[]
}

interface Native {
  version(): { core: string; api: string }
  skuFromSeed(s: string): string | null
  feature(s: string): boolean
  open(opts: { name: string; sku: string; product: string; universe: string; dir: string; config: string; pollMs?: number }, wake: () => void): number
  go(h: number): boolean
  close(h: number): boolean
  drain(h: number): DfEvent[]
  call(h: number, id: number, op: string, args?: DfArgs): boolean
}

let mod: Native | null = null
let loadError = ''

/** Load the module at `file` (once). Null, and why in dfAddonError(), when it cannot. */
export function loadDfAddon(file: string): Native | null {
  if (mod || loadError) return mod
  try {
    const m = { exports: {} as Native }
    // (dlopen : the bundler must not touch it)
    process.dlopen(m as unknown as NodeModule, file)
    const v = m.exports.version()
    if (!v.api.startsWith('0.6')) throw new Error(`the module speaks the C interface ${v.api}, not 0.6`)
    mod = m.exports
  } catch (e) {
    loadError = (e as Error).message.split('\n')[0]
  }
  return mod
}
export const dfAddonError = (): string => loadError
export const dfAddonVersion = (): { core: string; api: string } | null => mod?.version() ?? null

/** One node on the mesh. */
export class DfNative {
  private h = 0
  private ids = 0
  private waiting = new Map<number, (v: unknown) => void>()

  constructor(private on: (e: DfEvent[]) => void) {}

  /** Make it and start it : resolved with its port once it is on the mesh (it polls
   *  only after go()), rejected with why it could not. */
  open(opts: { name: string; sku: string; product: string; universe: string; dir: string; config: string; pollMs?: number }): Promise<number> {
    if (!mod) return Promise.reject(new Error(loadError || 'the dataflou module is not loaded'))
    return new Promise((res, rej) => {
      this.begun = (e) => (e.k === 'started' ? res(e.port) : rej(new Error(e.k === 'failed' ? e.text : 'it stopped')))
      this.h = mod!.open(opts, () => this.drain())
      if (!this.h) rej(new Error('its name, universe or folder was refused'))
    })
  }
  private begun: ((e: DfEvent) => void) | null = null

  go(): void {
    if (this.h) mod?.go(this.h)
  }

  private drain(): void {
    if (!this.h || !mod) return
    const list = mod.drain(this.h)
    const out: DfEvent[] = []
    for (const e of list) {
      if (e.k === 'reply') {
        const w = this.waiting.get(e.id)
        this.waiting.delete(e.id)
        if (!w) continue
        if (e.as === 'json') {
          try {
            w(JSON.parse(String(e.value)))
          } catch {
            w(null)
          }
        } else w(e.value)
      } else {
        if ((e.k === 'started' || e.k === 'failed') && this.begun) {
          const b = this.begun
          this.begun = null
          b(e)
        }
        out.push(e)
      }
    }
    if (out.length) this.on(out)
  }

  /** Ask for something and wait for its answer (null : the node is gone, or refused it). */
  call<T = boolean>(op: string, args?: DfArgs): Promise<T | null> {
    return new Promise((res) => {
      if (!this.h || !mod) return res(null)
      const id = ++this.ids
      this.waiting.set(id, (v) => res(v as T | null))
      if (!mod.call(this.h, id, op, args)) {
        this.waiting.delete(id)
        res(null)
      }
    })
  }
  /** Ask, with no answer. */
  post(op: string, args?: DfArgs): boolean {
    return !!this.h && !!mod && mod.call(this.h, 0, op, args)
  }

  close(): void {
    const h = this.h
    this.h = 0
    if (h) mod?.close(h)
    for (const w of this.waiting.values()) w(null)
    this.waiting.clear()
    this.begun?.({ k: 'failed', text: 'it stopped' })
    this.begun = null
  }
}
