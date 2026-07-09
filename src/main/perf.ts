// Host resource sampler for the Output HUD. Reports Palinopsia's OWN CPU + RAM
// share (from Electron's per-process metrics) and the GPU's VRAM + utilisation
// (whole-GPU, via nvidia-smi : per-process VRAM isn't reliably attributable for
// a graphics context). Everything degrades gracefully: no nvidia-smi → the GPU
// fields come back null and the HUD shows "—".

import { app } from 'electron'
import { execFile } from 'child_process'
import { totalmem } from 'os'
import type { PerfStats } from '@shared/types'

// Cached GPU reading, refreshed on a throttle so we never spawn nvidia-smi more
// than ~once/second even if the HUD polls faster.
let gpuCache: { vram: number | null; gpu: number | null } = { vram: null, gpu: null }
let lastSpawn = 0
let nvidiaMissing = false // stop trying after the first failure (no NVIDIA GPU)

function refreshGpu(): void {
  if (nvidiaMissing) return
  const now = Date.now()
  if (now - lastSpawn < 900) return
  lastSpawn = now
  execFile(
    'nvidia-smi',
    ['--query-gpu=memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits'],
    { timeout: 2000, windowsHide: true },
    (err, stdout) => {
      if (err) {
        // ENOENT = nvidia-smi not on PATH (no NVIDIA GPU) → give up permanently.
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') nvidiaMissing = true
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

/** One HUD sample: fresh app CPU/RAM + the cached GPU reading (kicks a refresh). */
export function samplePerf(): PerfStats {
  refreshGpu()
  let cpu = 0
  let ramBytes = 0
  try {
    for (const m of app.getAppMetrics()) {
      cpu += m.cpu?.percentCPUUsage ?? 0
      ramBytes += (m.memory?.workingSetSize ?? 0) * 1024 // KB → bytes
    }
  } catch {
    return { cpu: null, ram: null, vram: gpuCache.vram, gpu: gpuCache.gpu }
  }
  const total = totalmem()
  return {
    cpu: Math.round(cpu),
    ram: total > 0 ? (ramBytes / total) * 100 : null,
    vram: gpuCache.vram,
    gpu: gpuCache.gpu
  }
}
