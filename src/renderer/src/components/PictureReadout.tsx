// Picture readout (Performance tab, under the load meter) : every feature the
// picture reports on the vision bus, live, in plain words. The same numbers drive
// `vision` and `homeostat` modulators, stream out over OSC (/opsia/vision/*), feed
// the Resolume mapper and the dataflou mesh. They are computed only while
// something reads them : this readout keeps them on while it is open. Drawn
// outside React (refs, ~15 Hz), so it costs nothing to the page.

import { useEffect, useRef } from 'react'
import { visionBus, type VisionFeatureName } from '../engine/visionIn'
import { useStore } from '../store'

type Kind = 'level' | 'center' // a 0..1 amount, or a -..+ swing around 0.5

interface Feat {
  f: VisionFeatureName
  label: string
  kind: Kind
  ends?: [string, string] // what 0 and 1 mean, for a centered one
  hint: string
}

const GROUPS: Array<{ title: string; feats: Feat[] }> = [
  {
    title: 'light and color',
    feats: [
      { f: 'brightness', label: 'brightness', kind: 'level', hint: 'How bright the picture is on average (0 black, 1 white)' },
      { f: 'contrast', label: 'contrast', kind: 'level', hint: 'The spread between its darkest and brightest parts' },
      { f: 'saturation', label: 'saturation', kind: 'level', hint: 'How colorful it is (0 grey, 1 vivid)' },
      { f: 'hue', label: 'hue', kind: 'level', hint: 'The dominant color, around the color wheel (red, yellow, green, cyan, blue, magenta, back to red)' },
      { f: 'warmth', label: 'warmth', kind: 'center', ends: ['cool', 'warm'], hint: 'The balance of red against blue (0.5 neutral)' }
    ]
  },
  {
    title: 'texture',
    feats: [
      { f: 'edges', label: 'edges', kind: 'level', hint: 'How much detail and outline : busy pictures read high' },
      { f: 'entropy', label: 'entropy', kind: 'level', hint: 'How disordered its tones are : a flat field reads low, noise reads high' }
    ]
  },
  {
    title: 'motion',
    feats: [
      { f: 'motion', label: 'motion', kind: 'level', hint: 'How much changes from one frame to the next' },
      { f: 'flowX', label: 'flow ←→', kind: 'center', ends: ['left', 'right'], hint: 'Which way the picture moves sideways (0.5 still)' },
      { f: 'flowY', label: 'flow ↓↑', kind: 'center', ends: ['down', 'up'], hint: 'Which way the picture moves up or down (0.5 still)' },
      { f: 'divergence', label: 'spread', kind: 'center', ends: ['closes', 'spreads'], hint: 'Whether the motion closes in or spreads out, like a zoom or a bloom (0.5 neither)' },
      { f: 'curl', label: 'turn', kind: 'center', ends: ['ccw', 'cw'], hint: 'Whether the motion turns, counter-clockwise or clockwise (0.5 neither)' },
      { f: 'coherence', label: 'as one', kind: 'level', hint: 'How much the whole picture moves the same way (0 every which way, 1 all together)' }
    ]
  },
  {
    title: 'where and how deep',
    feats: [
      { f: 'centroidX', label: 'mass ←→', kind: 'center', ends: ['left', 'right'], hint: 'Where the bright mass sits, left to right (the dot on the plane)' },
      { f: 'centroidY', label: 'mass ↑↓', kind: 'center', ends: ['top', 'bottom'], hint: 'Where the bright mass sits, top to bottom (the dot on the plane)' },
      { f: 'depth', label: 'depth', kind: 'level', hint: 'How near the scene is on average (0 far, 1 near). Needs the depth engine (Depth : estimate) on, else it holds' },
      { f: 'depthSpread', label: 'relief', kind: 'level', hint: 'How much near and far differ in the frame (0 flat). Needs the depth engine on' }
    ]
  }
]

const ALL = GROUPS.flatMap((g) => g.feats)

export function PictureReadout(): JSX.Element {
  const rows = useRef(new Map<VisionFeatureName, { bar: HTMLDivElement | null; val: HTMLSpanElement | null }>())
  const dot = useRef<HTMLDivElement | null>(null)
  const swatch = useRef<HTMLSpanElement | null>(null)
  const status = useRef<HTMLSpanElement | null>(null)
  const depthMode = useStore((s) => s.depthMode)

  useEffect(() => {
    visionBus.want('picture-readout', true)
    let raf = 0
    let last = 0
    const paint = (now: number): void => {
      raf = requestAnimationFrame(paint)
      if (now - last < 66) return
      last = now
      for (const ft of ALL) {
        const r = rows.current.get(ft.f)
        if (!r?.bar || !r.val) continue
        const v = Math.max(0, Math.min(1, visionBus.feature(ft.f)))
        if (ft.kind === 'center') {
          const d = v - 0.5
          r.bar.style.left = `${(d < 0 ? 50 + d * 100 : 50).toFixed(1)}%`
          r.bar.style.width = `${(Math.abs(d) * 100).toFixed(1)}%`
        } else {
          r.bar.style.left = '0%'
          r.bar.style.width = `${(v * 100).toFixed(1)}%`
        }
        if (ft.f === 'hue') r.bar.style.background = `hsl(${Math.round(v * 360)} 70% 55%)`
        r.val.textContent = v.toFixed(2)
      }
      if (dot.current) {
        dot.current.style.left = `${(visionBus.feature('centroidX') * 100).toFixed(1)}%`
        dot.current.style.top = `${(visionBus.feature('centroidY') * 100).toFixed(1)}%`
      }
      if (swatch.current) {
        const h = visionBus.feature('hue')
        const s = visionBus.feature('saturation')
        const l = visionBus.feature('brightness')
        swatch.current.style.background = `hsl(${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(20 + l * 60)}%)`
      }
      if (status.current) status.current.textContent = visionBus.hasData() ? '' : 'waiting for the first frame…'
    }
    raf = requestAnimationFrame(paint)
    return () => {
      cancelAnimationFrame(raf)
      visionBus.want('picture-readout', false)
    }
  }, [])

  return (
    <div className="flex min-w-0 flex-col gap-2 pb-1 pt-1">
      <div className="flex min-w-0 items-start gap-3">
        <div className="min-w-0 flex-1 font-mono text-[9px] leading-relaxed text-muted">
          The picture as numbers, 0 to 1 : what <span className="text-text">vision</span> modulators follow, what OSC sends as{' '}
          <span className="text-text">/opsia/vision/…</span>, and what the Resolume mapper and the dataflou mesh read. Computed
          30 times a second while something reads them (this readout does, while open).{' '}
          <span ref={status} className="text-accent2" />
        </div>
        {/* where the bright mass sits, and the picture's color in one swatch */}
        <div className="flex shrink-0 flex-col items-center gap-1">
          <div className="relative h-12 w-16 rounded-sm border border-border bg-panel3/60" title="Where the bright mass sits (centroid)">
            <div ref={dot} className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: '50%', top: '50%' }} />
          </div>
          <span ref={swatch} className="h-2 w-16 rounded-sm" title="The picture's color : dominant hue at its saturation and brightness" />
        </div>
      </div>
      {GROUPS.map((g) => (
        <div key={g.title} className="flex min-w-0 flex-col gap-[3px]">
          <span className="font-mono text-[8.5px] uppercase tracking-wide text-muted/70">{g.title}</span>
          {g.feats.map((ft) => (
            <div key={ft.f} className="flex min-w-0 items-center gap-1.5" title={`${ft.hint} · OSC /opsia/vision/${ft.f}`}>
              <span className="w-[68px] shrink-0 truncate font-mono text-[9.5px] text-text">{ft.label}</span>
              <span className="w-8 shrink-0 text-right font-mono text-[8px] text-muted/70">{ft.ends?.[0] ?? ''}</span>
              <div className="relative h-[6px] min-w-0 flex-1 overflow-hidden rounded-sm bg-panel3/70">
                {ft.kind === 'center' && <div className="absolute inset-y-0 left-1/2 w-px bg-border" />}
                <div
                  ref={(el) => {
                    const r = rows.current.get(ft.f) ?? { bar: null, val: null }
                    r.bar = el
                    rows.current.set(ft.f, r)
                  }}
                  className={`absolute inset-y-0 ${ft.kind === 'center' ? 'bg-accent2' : 'bg-accent'}`}
                  style={{ left: 0, width: 0 }}
                />
              </div>
              <span className="w-8 shrink-0 font-mono text-[8px] text-muted/70">{ft.ends?.[1] ?? ''}</span>
              <span
                ref={(el) => {
                  const r = rows.current.get(ft.f) ?? { bar: null, val: null }
                  r.val = el
                  rows.current.set(ft.f, r)
                }}
                className="w-8 shrink-0 text-right font-mono text-[9px] tabular-nums text-muted"
              >
                0.00
              </span>
            </div>
          ))}
        </div>
      ))}
      {depthMode === 'off' && (
        <span className="font-mono text-[8.5px] text-muted/70">depth and relief rest while the depth engine is off (Depth : estimate reads them off the picture)</span>
      )}
    </div>
  )
}
