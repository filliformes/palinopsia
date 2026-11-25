// "Where the dome goes" : what is live and what is not, in plain words, with what
// each way out costs, and why NDI is under its rate when it is. Used by the Output
// page's Fulldome and NDI sections.
//
// NDI® is a registered trademark of Vizrt NDI AB (https://ndi.video).

import { useRef } from 'react'
import type { NdiConfig, NdiStatus } from '@shared/ndi'
import { useStore } from '../store'
import { perfMeter } from '../engine/perfMeter'
import { currentFps } from '../perf'

const rate = (fps: number): string => (Number.isInteger(fps) ? String(fps) : fps.toFixed(fps < 100 && Math.abs(fps * 10 - Math.round(fps * 10)) > 0.01 ? 2 : 1))
const square = (w: number, h: number): string => (w === h ? `${w}²` : `${w}×${h}`)

/** Why NDI is under the rate asked for, or '' : the first thing in its way. */
function ndiReason(st: NdiStatus, app: number, asked: number): string {
  if (st.path === 'slow' && st.width * st.height > 2_100_000) {
    return `the slow path (${st.pathNote || 'no WebGPU'}) : every frame is read back through the window itself. Lower the NDI size`
  }
  if (app > 0 && app < asked * 0.93) {
    return `the picture itself runs at ${Math.round(app)} fps (the graphics card is full, or the display's own rate) : a lighter scene, a smaller composition or the 2K master`
  }
  if (st.skipped > 0) return `${st.skipped} captures skipped : the graphics card has no room left for them`
  if (st.dropped > 0 || st.sendMs > (1000 / asked) * 1.2) return `NDI is late (up to ${Math.round(st.sendMs)} ms to accept a frame) : the processor is full, or the network slow`
  return 'starting, or the scene just changed'
}

/** NDI under its rate for three seconds running : a warning, '' otherwise. */
export function useNdiTrouble(ndi: NdiConfig, st: NdiStatus): string {
  // (a render per status, once a second; other renders must not count twice)
  const low = useRef({ n: 0, seen: null as NdiStatus | null })
  if (!ndi.enabled || st.state !== 'live') {
    low.current.n = 0
    return ''
  }
  if (low.current.seen !== st) {
    low.current.seen = st
    low.current.n = st.fps < ndi.fps * 0.93 ? low.current.n + 1 : 0
  }
  if (low.current.n < 3) return ''
  return `${rate(st.fps)} of ${rate(ndi.fps)} fps : ${ndiReason(st, currentFps(), ndi.fps)}.`
}

/** What NDI is doing, in a few words. */
export function ndiLine(ndi: NdiConfig, st: NdiStatus): string {
  if (!ndi.enabled) return 'off'
  if (st.state === 'no-runtime') return 'no NDI runtime found'
  if (st.state === 'starting') return 'starting…'
  if (st.state !== 'live') return st.message || st.state
  return `${st.connections > 0 ? 'receiving' : 'no receiver yet'}${st.width ? ` · ${square(st.width, st.height)}` : ''} · ${rate(st.fps)} of ${rate(ndi.fps)} fps`
}

export function ndiDotClass(ndi: NdiConfig, st: NdiStatus, trouble: string): string {
  if (!ndi.enabled) return 'bg-muted'
  if (st.state === 'live') return trouble ? 'bg-yellow-500' : 'bg-green-500'
  if (st.state === 'starting') return 'animate-pulse bg-yellow-500'
  return st.state === 'no-runtime' ? 'bg-yellow-500' : 'bg-red-500' // an action to take · a fault
}

function Row({ dot, name, title, children }: { dot: string; name: string; title: string; children: string }): JSX.Element {
  return (
    <div className="flex items-baseline gap-1.5" title={title}>
      <span className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${dot}`} />
      <span className="w-[4.5rem] shrink-0 text-muted">{name}</span>
      <span className="min-w-0 flex-1 text-text">{children}</span>
    </div>
  )
}

export function DomeRoutes({ shareKind }: { shareKind: string | null }): JSX.Element {
  const dome = useStore((s) => s.dome)
  const ndi = useStore((s) => s.ndi)
  const st = useStore((s) => s.ndiStatus)
  const outputActive = useStore((s) => s.outputActive)
  const shareActive = useStore((s) => s.shareActive)
  const trouble = useNdiTrouble(ndi, st)
  const ms = perfMeter.read()
  const cost = (k: string): string => {
    const v = (ms[k] ?? 0) + (ms.capture ?? 0)
    return v > 0.5 ? `, ${v.toFixed(1)} ms of each frame` : ''
  }
  const ndiLive = ndi.enabled && st.state === 'live'
  return (
    <div className="flex flex-col gap-0.5 rounded border border-border/60 bg-panel/40 px-1.5 py-1 font-mono text-[10px] leading-snug">
      <div className="text-[9px] uppercase tracking-wide text-muted">
        where the dome goes{dome.enabled ? ` · ${dome.res}² master` : ' · dome off'}
      </div>
      <Row
        dot={ndiDotClass(ndi, st, trouble)}
        name="NDI"
        title={`The network, to a dome's media server (the Satosphère takes it live). It needs nothing else : no fullscreen output, no second screen.${ndiLive ? ` Last second : ${st.captured} captured, ${st.skipped} skipped, ${st.dropped} late, ${st.resent} repeated, ${st.latencyMs} ms from the picture to NDI.` : ''}`}
      >
        {ndiLive ? `${ndiLine(ndi, st)} · ${st.skipped + st.dropped} lost` : ndi.enabled ? ndiLine(ndi, st) : 'off : the way to a dome server (NDI, below)'}
      </Row>
      <Row
        dot={outputActive ? (ndiLive ? 'bg-yellow-500' : 'bg-green-500') : 'bg-muted'}
        name="fullscreen"
        title="The projector window : for a dome projector plugged into this computer. NDI does not go through it."
      >
        {outputActive
          ? ndiLive
            ? `on, not needed for NDI : a second read of the picture${cost('output')}`
            : 'on : the master on that screen'
          : ndiLive ? 'off, not needed for NDI' : 'off : only for a projector plugged in here'}
      </Row>
      {shareKind && (
        <Row
          dot={shareActive ? 'bg-green-500' : 'bg-muted'}
          name={shareKind}
          title="To another app on this same computer : a dome viewer to check the master, a mapping app. Not needed for NDI."
        >
          {shareActive ? `on : apps on this computer${cost('share')}` : 'off : for a dome viewer on this computer'}
        </Row>
      )}
      {trouble && <div className="text-yellow-400">NDI {trouble}</div>}
    </div>
  )
}
