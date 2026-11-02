// SilhouetteStrip : the Inspector line under a Silhouette source. The source reads
// the Body camera's segmentation mask and never turns the camera on by itself (a
// camera is opt-in), so this says whether it is live and offers the explicit click
// that turns the Body camera on with Silhouette.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { bodyTracker } from '../engine/bodyTracker'
import { silhouetteFinder, type FinderStatus } from '../engine/silhouetteNode'

/** The line under a Silhouette EFFECT : what the body model finds, for every
 *  Silhouette effect together (they share one model). */
export function SilhouetteFxStrip(): JSX.Element {
  const [s, setS] = useState<FinderStatus>(() => ({ ...silhouetteFinder.read() }))
  useEffect(() => {
    const id = window.setInterval(() => setS({ ...silhouetteFinder.read() }), 500)
    return () => window.clearInterval(id)
  }, [])
  const running = s.state === 'running' && s.clients > 0
  const each = s.clients > 1 ? ` · ${s.clients} effects` : ''
  const status =
    s.state === 'failed'
      ? `the body model did not load : ${s.error}`
      : s.state === 'loading'
        ? 'loading the body model…'
        : !running
          ? 'resting (bypassed, or its layer is muted)'
          : `${s.people === 0 ? 'nobody found' : s.people === 1 ? '1 person' : `${s.people} people`} · ${Math.round(s.rate)} looks a second · ${s.ms} ms${each}`
  return (
    <div className="flex items-center gap-2 border-b border-border bg-panel2/40 px-2 py-1 font-mono text-[10px]">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${running ? 'bg-accent' : 'bg-muted/50'}`} />
      <span
        className="min-w-0 flex-1 truncate text-muted"
        title="The body model looks for people in this effect's own picture beside the render (it never holds the picture up). Every Silhouette effect shares one model : with several, they take turns."
      >
        {status}
      </span>
    </div>
  )
}

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
