// OSCQuery — self-describing OSC address space (brief §8).
//
// PHASE 8. Publishes Palinopsia's parameter tree over HTTP + WebSocket so
// Pandore / dataFLOU auto-discover and bind every control instead of a
// hand-maintained OSC map. Stubbed here so the wiring seam exists from
// Phase 0; the renderer will push its live parameter tree in via
// `publishTree()` once the auto-UI (Phase 4) can enumerate ISF inputs.

export interface OscQueryNode {
  full_path: string
  type?: string // OSC type tag, e.g. 'f'
  range?: { min?: number; max?: number }
  value?: number | number[]
}

export class OscQueryServer {
  private tree: OscQueryNode[] = []

  /** Renderer pushes the flattened parameter tree; served on request. */
  publishTree(nodes: OscQueryNode[]): void {
    this.tree = nodes
  }

  getTree(): OscQueryNode[] {
    return this.tree
  }

  // Phase 8: start()/stop() an HTTP+WS server (e.g. on :8080) that serves
  // the OSCQuery JSON and streams value updates.
  async start(): Promise<void> {
    /* TODO Phase 8 */
  }
  stop(): void {
    /* TODO Phase 8 */
  }
}
