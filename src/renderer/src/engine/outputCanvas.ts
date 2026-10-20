// The output canvas (the engine's, where the picture is drawn), for what reads
// the picture outside the render loop : the agent's snapshot, the Source
// Editor's "the live picture" input. App registers a getter : a rebuilt engine
// (a GPU reset) hands over its new canvas with no re-registering.

let getter: (() => HTMLCanvasElement | null) | null = null

export function registerOutputCanvas(fn: (() => HTMLCanvasElement | null) | null): void {
  getter = fn
}

export function outputCanvas(): HTMLCanvasElement | null {
  return getter?.() ?? null
}
