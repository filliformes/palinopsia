// SilhouetteStrip : the Inspector line under a Silhouette source. The source reads
// the Body camera's segmentation mask and never turns the camera on by itself (a
// camera is opt-in), so this says whether it is live and offers the explicit click
// that turns the Body camera on with Silhouette.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { bodyTracker } from '../engine/bodyTracker'

export function SilhouetteStrip(): JSX.Element {
  const cfg = useStore((s) => s.bodyControl)
  const setCfg = useStore((s) => s.setBodyControl)
  const setBodyPageOpen = useStore((s) => s.setBodyPageOpen)
  const [live, setLive] = useState(() => !!bodyTracker.silhouette())
  useEffect(() => {
    const id = window.setInterval(() => setLive(!!bodyTracker.silhouette()), 500)
    return () => window.clearInterval(id)
  }, [])
  const on = cfg.enabled && cfg.silhouette
  const status = live
    ? 'camera live'
    : on
      ? 'starting the camera…'
      : !cfg.enabled
        ? 'Body camera off'
        : 'Silhouette off on the Body page'
  return (
    <div className="flex items-center gap-2 border-b border-border bg-panel2/40 px-2 py-1 font-mono text-[10px]">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${live ? 'animate-pulse bg-danger' : 'bg-muted/50'}`} />
      <span className="min-w-0 flex-1 truncate text-muted" title="The Silhouette source reads the Body camera's segmentation mask. It never turns the camera on by itself.">
        {status}
      </span>
      {!on && (
        <button
          className="rounded border border-accent/50 bg-accent/10 px-1.5 text-accent hover:bg-accent/20"
          onClick={() => setCfg({ enabled: true, silhouette: true, pose: true })}
          title="Turn the Body camera on with Silhouette (the red pip in the top bar shows it is live)"
        >
          turn on
        </button>
      )}
      <button
        className="rounded border border-border px-1.5 text-muted hover:text-text"
        onClick={() => setBodyPageOpen(true)}
        title="Open the Body page (camera, mirror, other tracking)"
      >
        Body page
      </button>
    </div>
  )
}
