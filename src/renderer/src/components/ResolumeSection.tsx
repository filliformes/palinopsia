// Resolume section of the audio/midi/osc tab : is the Resolume mapper (K) on,
// where it sends and how much, and a button into it. The SENDING pill turns the
// stream on and off from here, like OSC's LISTENING pill.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { resoLive } from '../resolume'

export function ResolumeSection(): JSX.Element {
  const r = useStore((s) => s.resolume)
  const setR = useStore((s) => s.setResolume)
  const setOpen = useStore((s) => s.setResolumePageOpen)
  const collapsed = useStore((s) => !!s.collapsed['resolume'])
  const toggleSection = useStore((s) => s.toggleSection)
  // The msg/s readout lives outside React : a slow refresh while sending.
  const [, setBeat] = useState(0)
  useEffect(() => {
    if (!r.enabled) return
    const t = window.setInterval(() => setBeat((x) => x + 1), 1000)
    return () => window.clearInterval(t)
  }, [r.enabled])

  const pins = r.cells.length
  const status = r.enabled
    ? `sending to ${r.host} : ${r.port} · ${pins} ${pins === 1 ? 'pin' : 'pins'} · ${resoLive.sentPerSec} msg/s`
    : r.session
      ? `${r.session.name} · ${pins} ${pins === 1 ? 'pin' : 'pins'} · not sending`
      : r.outputs.length
        ? `${r.outputs.length} addresses · ${pins} ${pins === 1 ? 'pin' : 'pins'} · not sending`
        : 'no composition yet : open the mapper to load one'

  return (
    <div className="flex min-w-0 flex-col gap-1 border-t border-border bg-panel px-3 py-1.5 text-[11px]">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={() => toggleSection('resolume')}
          className="flex shrink-0 items-center gap-1.5"
          title={collapsed ? 'Expand Resolume' : 'Collapse Resolume'}
        >
          <span className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">Resolume</span>
        </button>
        <button
          onClick={() => setR({ enabled: !r.enabled })}
          className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
            r.enabled ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'
          }`}
          title={r.enabled ? 'Stop sending to Resolume' : 'Send the mapper\'s pins to Resolume over OSC'}
        >
          {r.enabled && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />}
          {r.enabled ? 'SENDING' : 'OFF'}
        </button>
        {r.locked && <span className="shrink-0 font-mono text-[9px] text-muted" title="The mapping is locked">🔒</span>}
        <div className="flex-1" />
        <button
          onClick={() => setOpen(true)}
          className={`shrink-0 rounded border px-2 py-0.5 font-mono text-[10px] transition-colors ${
            r.enabled ? 'border-accent text-accent hover:bg-accent/10' : 'border-border text-muted hover:text-text'
          }`}
          title="Open the Resolume mapper (K) : wire Palinopsia's signals to any Resolume control in a pin matrix"
        >
          mapper ▸
        </button>
      </div>
      {!collapsed && (
        <span className={`truncate font-mono text-[9.5px] ${r.enabled ? 'text-accent' : 'text-muted'}`} title={status}>
          {status}
        </span>
      )}
    </div>
  )
}
