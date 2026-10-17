// The output device the layers' sound plays on : an Import Audio player and a
// film whose volume is up both play on Sonify's device (App follows the setting).

let sinkId = ''
const els = new Set<HTMLMediaElement>()

function apply(el: HTMLMediaElement): void {
  const e = el as HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }
  if (e.setSinkId) void e.setSinkId(sinkId).catch(() => { /* a device gone : the default */ })
}

export function setMediaSink(id: string): void {
  if (id === sinkId) return
  sinkId = id
  for (const el of els) apply(el)
}

export function trackMediaSink(el: HTMLMediaElement): void {
  els.add(el)
  apply(el)
}

export function untrackMediaSink(el: HTMLMediaElement): void {
  els.delete(el)
}
