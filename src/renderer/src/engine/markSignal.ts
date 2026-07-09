// Animated / graphical sound (Cameraless spec §4.4) : the drawn optical
// soundtrack. This closes the loop over OSC: each frame it samples one scanline
// of the presented image and sends it to Pandore as a control signal, so a single
// drawn gesture is simultaneously image AND sound : synchrèse at the level of the
// mark itself. Reuses the outbound OSC path (window.api.oscSend) + the outbound
// host/port already configured for state feedback.
//
//   /opsia/av/mark-signal    f×N  the raw scanline (a waveform / optical track)
//   /opsia/av/mark-level     f    mean brightness of the line
//   /opsia/av/mark-centroid  f    horizontal centre of brightness (0..1)
//   /opsia/av/mark-flux      f    frame-to-frame change (onset-ish)

import { useStore } from '../store'

const N = 32 // scanline samples sent per frame
let lastSend = 0
let prevLevel = 0

interface StripReader {
  readMarkStrip: (n: number, y01: number) => Float32Array | null
}

/** Sample the presented scanline and push it to Pandore. Throttled to ~30 Hz.
 *  No-op unless enabled + an outbound host is set. Call AFTER comp.render(). */
export function pushMarkSignal(comp: StripReader, nowMs: number): void {
  const st = useStore.getState()
  if (!st.markSignalEnabled || !st.oscOutHost) return
  if (nowMs - lastSend < 33) return
  lastSend = nowMs

  const strip = comp.readMarkStrip(N, st.markSignalY ?? 0.5)
  if (!strip) return

  let sum = 0, csum = 0
  for (let i = 0; i < N; i++) {
    sum += strip[i]
    csum += strip[i] * i
  }
  const level = sum / N
  const centroid = sum > 1e-4 ? csum / sum / (N - 1) : 0.5
  const flux = Math.min(1, Math.abs(level - prevLevel) * 4)
  prevLevel = level

  const host = st.oscOutHost, port = st.oscOutPort
  const arg = (v: number): { type: 'f'; value: number } => ({ type: 'f', value: v })
  window.api.oscSend(host, port, '/opsia/av/mark-signal', Array.from(strip, arg))
  window.api.oscSend(host, port, '/opsia/av/mark-level', [arg(level)])
  window.api.oscSend(host, port, '/opsia/av/mark-centroid', [arg(centroid)])
  window.api.oscSend(host, port, '/opsia/av/mark-flux', [arg(flux)])
}
