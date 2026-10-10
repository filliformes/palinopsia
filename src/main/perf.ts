// Host resource sampler for the Output HUD. Reports Palinopsia's OWN CPU + RAM
// share (from Electron's per-process metrics), the GPU's memory + utilization
// (whole-GPU : per-process VRAM isn't reliably attributable for a graphics
// context), and the refresh rate of the display the main window is on.
//
// Two GPU back ends, because no single tool covers both machines we ship to:
//   - a discrete-GPU driver query, which reports a dedicated memory pool;
//   - the accelerator statistics in the IO registry, used where the GPU shares
//     system memory and the number to report is the driver's share of it.
// Everything degrades gracefully: when neither answers, the GPU fields come
// back null and the HUD shows "-".

import { app, screen, type BrowserWindow } from 'electron'
import { execFile } from 'child_process'
import { totalmem } from 'os'
import type { PerfStats } from '@shared/types'

// Cached GPU reading, refreshed on a throttle so we never spawn a helper more
// than ~once/second even if the HUD polls faster.
let gpuCache: { vram: number | null; gpu: number | null } = { vram: null, gpu: null }
let lastSpawn = 0
let gpuToolMissing = false // stop trying after the first failure (no such tool)
// One helper at a time : a slow answer (up to its 2 s timeout) must not stack a
// second and a third behind it on a once-a-second sampler.
let gpuBusy = false

/** First `"<key>" = <integer>` in an IO registry dump, or null. */
function ioregInt(text: string, key: string): number | null {
  const m = text.match(new RegExp(`"${key}"\\s*=\\s*(\\d+)`))
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) ? n : null
}

function refreshGpuUnified(): void {
  // The accelerator's PerformanceStatistics dictionary. Needs no privileges.
  // "-w 0" stops ioreg wrapping the dictionary across lines.
  execFile(
    'ioreg',
    ['-r', '-d', '1', '-w', '0', '-c', 'AGXAccelerator'],
    { timeout: 2000, maxBuffer: 4 * 1024 * 1024 },
    (err, stdout) => {
      gpuBusy = false
      if (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') gpuToolMissing = true
        gpuCache = { vram: null, gpu: null }
        return
      }
      const util = ioregInt(stdout, 'Device Utilization %')
      // Unified memory : the driver's in-use bytes against total system memory.
      const used = ioregInt(stdout, 'In use system memory')
      if (util == null && used == null) {
        // No such accelerator (a Mac with a different GPU family), or it keeps no
        // statistics. The answer will not change, so stop asking : the sampler
        // runs once a second for as long as the app is open.
        gpuToolMissing = true
        gpuCache = { vram: null, gpu: null }
        return
      }
      const total = totalmem()
      gpuCache = {
        vram: used != null && total > 0 ? (used / total) * 100 : null,
        gpu: util
      }
    }
  )
}

function refreshGpuDiscrete(): void {
  execFile(
    'nvidia-smi',
    ['--query-gpu=memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits'],
    { timeout: 2000, windowsHide: true },
    (err, stdout) => {
      gpuBusy = false
      if (err) {
        // ENOENT = the tool is not on PATH (no such GPU) → give up permanently.
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') gpuToolMissing = true
        gpuCache = { vram: null, gpu: null }
        return
      }
      // First GPU line: "used, total, util".
      const line = stdout.trim().split('\n')[0] ?? ''
      const [usedS, totalS, utilS] = line.split(',').map((s) => s.trim())
      const used = Number(usedS)
      const total = Number(totalS)
      const util = Number(utilS)
      gpuCache = {
        vram: total > 0 && Number.isFinite(used) ? (used / total) * 100 : null,
        gpu: Number.isFinite(util) ? util : null
      }
    }
  )
}

function refreshGpu(): void {
  if (gpuToolMissing || gpuBusy) return
  const now = Date.now()
  if (now - lastSpawn < 900) return
  lastSpawn = now
  gpuBusy = true
  if (process.platform === 'darwin') refreshGpuUnified()
  else refreshGpuDiscrete()
}

/** Refresh rate of the display `win` is on, else of the primary display. The
 *  render loop rides that display's vsync, so this is the frame-rate ceiling.
 *  Exported on its own because the readouts that only want the ceiling should
 *  not drag a whole resource sample (and its helper process) along. */
export function displayHz(win: BrowserWindow | null): number | null {
  try {
    const d =
      win && !win.isDestroyed()
        ? screen.getDisplayMatching(win.getBounds())
        : screen.getPrimaryDisplay()
    const hz = d?.displayFrequency ?? 0
    return hz > 0 ? hz : null
  } catch {
    return null // no screen module before the app is ready
  }
}

/** One HUD sample: fresh app CPU/RAM + the cached GPU reading (kicks a refresh). */
export function samplePerf(win: BrowserWindow | null = null): PerfStats {
  refreshGpu()
  const hz = displayHz(win)
  let cpu = 0
  let ramBytes = 0
  try {
    for (const m of app.getAppMetrics()) {
      cpu += m.cpu?.percentCPUUsage ?? 0
      ramBytes += (m.memory?.workingSetSize ?? 0) * 1024 // KB → bytes
    }
  } catch {
    return { cpu: null, ram: null, vram: gpuCache.vram, gpu: gpuCache.gpu, hz }
  }
  const total = totalmem()
  return {
    cpu: Math.round(cpu),
    ram: total > 0 ? (ramBytes / total) * 100 : null,
    vram: gpuCache.vram,
    gpu: gpuCache.gpu,
    hz
  }
}
