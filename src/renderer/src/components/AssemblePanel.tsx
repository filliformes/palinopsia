// Assemble — the automatic experimental editor (right column tab).
//
// Mosaïque's workflow, carried to video : point it at a folder, let it segment
// and analyse every film into a point cloud, shape HOW clips should follow one
// another, then generate. The result is an edit decision list played live by an
// Assemble layer source — so it lands in the instrument like any other picture
// and takes the whole FX stack on top.

import { useEffect, useRef, useState } from 'react'
import {
  CURVE_SHAPES,
  DESCRIPTORS,
  DESC_LABELS,
  type Assemblage,
  type AssembleParams,
  type CurveShape,
  type MatchMode
} from '@shared/assemble'
import { corpusMap, curveAt, edlDuration, generate } from '../assemble/match'
import { liveDescriptor } from '../assemble/liveMatch'
import { useStore } from '../store'

const fmt = (s: number): string =>
  s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(1)}s`

export function AssemblePanel(): JSX.Element {
  const folder = useStore((s) => s.assembleFolder)
  const corpus = useStore((s) => s.assembleCorpus)
  const map = useStore((s) => s.assembleMap)
  const params = useStore((s) => s.assembleParams)
  const setParams = useStore((s) => s.setAssembleParams)
  const setCorpus = useStore((s) => s.setAssembleCorpus)
  const busy = useStore((s) => s.assembleBusy)
  const setBusy = useStore((s) => s.setAssembleBusy)
  const assemblages = useStore((s) => s.assemblages)
  const saveAssemblage = useStore((s) => s.saveAssemblage)
  const deleteAssemblage = useStore((s) => s.deleteAssemblage)
  const setSourceAssemble = useStore((s) => s.setSourceAssemble)
  const selection = useStore((s) => s.selection)

  // The edit currently on the bench : generated but not necessarily saved.
  const [draft, setDraft] = useState<Assemblage | null>(null)
  const [name, setName] = useState('')
  const [err, setErr] = useState('')
  const [showWeights, setShowWeights] = useState(false)

  // Where a generated / recalled assemblage lands. Follows the selection when
  // one is a source, so "select a slot, hit generate" does the obvious thing.
  const target =
    selection?.type === 'source' ? { layer: selection.layer, slot: selection.slot } : { layer: 0, slot: 'A' as const }

  // ── Corpus ────────────────────────────────────────────────────────────
  async function pickFolder(): Promise<void> {
    const f = await window.api.assemblePickFolder()
    if (f) void analyze(f)
  }

  async function analyze(f: string): Promise<void> {
    setErr('')
    setBusy({ label: 'scanning…', pct: 0 })
    const off = window.api.onAssembleProgress((p) => {
      setBusy({
        label: p.done ? 'finishing…' : `${p.file} (${p.index + 1}/${p.total}) · ${p.units} units`,
        pct: p.total ? Math.round((p.index / p.total) * 100) : 0
      })
    })
    try {
      const r = await window.api.assembleAnalyze(f)
      if (r.ok && r.corpus) {
        setCorpus(f, r.corpus)
        if (!r.corpus.units.length) setErr('No usable video found in that folder.')
      } else {
        setErr(r.error ?? 'analysis failed')
      }
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      off()
      setBusy(null)
    }
  }

  // Re-open the last corpus on first visit : the on-disk cache makes this near
  // instant, so the tab is never empty just because the app restarted.
  const tried = useRef(false)
  useEffect(() => {
    if (tried.current || corpus || !folder || busy) return
    tried.current = true
    void analyze(folder)
  }, [folder, corpus, busy])

  // ── Generate / vary ───────────────────────────────────────────────────
  function build(seed: number, label?: string): Assemblage | null {
    if (!corpus || !corpus.units.length) {
      setErr('Analyse a folder first.')
      return null
    }
    const clips = generate({
      corpus,
      params,
      seed,
      map,
      liveTarget: params.mode === 'live' ? liveDescriptor() : null
    })
    if (!clips.length) {
      setErr('The corpus produced no clips — try loosening the matching.')
      return null
    }
    const a: Assemblage = {
      id: `asm-${seed.toString(36)}-${Date.now().toString(36)}`,
      name: label ?? name ?? '',
      clips,
      seed,
      params: { ...params },
      folder: corpus.folder,
      createdAt: Date.now()
    }
    setErr('')
    setDraft(a)
    // Put it straight on the target slot : you want to SEE it immediately.
    setSourceAssemble(target.layer, target.slot, a)
    return a
  }

  const doGenerate = (): void => void build((Math.random() * 2 ** 32) >>> 0)
  // Variation keeps the recipe and re-rolls the dice, exactly like the
  // instrument's Vary button — same intent, new siblings.
  const doVary = (): void => {
    if (!draft) return void doGenerate()
    void build((draft.seed + 1 + ((Math.random() * 1000) | 0)) >>> 0, draft.name)
  }

  async function doExport(): Promise<void> {
    if (!draft) return
    setBusy({ label: 'rendering…', pct: 0 })
    const off = window.api.onAssembleExportProgress((p) => setBusy({ label: 'rendering…', pct: p.pct }))
    try {
      const r = await window.api.assembleExport(draft.clips, draft.name || 'assemblage')
      setErr(r.ok ? `saved → ${r.path}` : (r.error ?? 'export failed'))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      off()
      setBusy(null)
    }
  }

  const units = corpus?.units.length ?? 0

  return (
    <div className="flex min-w-0 flex-col gap-2 text-[11px]">
      {/* ── Corpus ── */}
      <Box title="corpus">
        <div className="flex min-w-0 items-center gap-1.5">
          <button className="btn shrink-0 px-2 py-0.5 text-[11px]" onClick={pickFolder} disabled={!!busy}>
            folder…
          </button>
          <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-muted" title={folder}>
            {folder || 'no folder chosen'}
          </span>
          {!!folder && (
            <button
              className="shrink-0 font-mono text-[10px] text-muted hover:text-accent"
              onClick={() => void analyze(folder)}
              disabled={!!busy}
              title="Re-analyse (picks up new or changed files)"
            >
              ↻
            </button>
          )}
        </div>
        {busy && (
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="h-1 min-w-0 flex-1 overflow-hidden rounded bg-panel3">
              <div className="h-full bg-accent transition-all" style={{ width: `${busy.pct}%` }} />
            </div>
            <span className="shrink-0 truncate font-mono text-[9px] text-muted">{busy.label}</span>
          </div>
        )}
        {!!units && !busy && (
          <div className="font-mono text-[9px] text-muted">
            <span className="text-accent">{units}</span> units from{' '}
            <span className="text-text">{corpus?.files}</span> file{corpus?.files === 1 ? '' : 's'} ·{' '}
            {fmt(corpus?.units.reduce((s, u) => s + u.dur, 0) ?? 0)} of material
          </div>
        )}
        {!!err && <div className="break-words font-mono text-[9px] text-danger">{err}</div>}
      </Box>

      {/* ── The map ── */}
      {units > 0 && <CorpusMap />}

      {/* ── Matching ── */}
      <Box title="matching">
        <div className="flex min-w-0 items-center gap-1">
          <span className="w-12 shrink-0 font-mono text-[9px] uppercase text-muted">mode</span>
          <select
            className="input select-compact min-w-0 flex-1 px-1 py-0.5 text-[11px]"
            value={params.mode}
            onChange={(e) => setParams({ mode: e.target.value as MatchMode })}
            title={
              params.mode === 'walk'
                ? 'Free walk : each clip is chosen relative to the last one only'
                : params.mode === 'trajectory'
                  ? 'Trajectory : the sequence travels the path drawn on the map'
                  : 'Live : the edit chases the composited image, re-matching at every cut'
            }
          >
            <option value="walk">free walk</option>
            <option value="trajectory">trajectory across the map</option>
            <option value="live">follow the live output</option>
          </select>
        </div>

        <Slider
          label="similar ↔ contrast"
          value={params.contrast}
          onChange={(v) => setParams({ contrast: v })}
          fmt={(v) => (v < 0.12 ? 'morph' : v > 0.85 ? 'whiplash' : `${Math.round(v * 100)}%`)}
          title="0 = each cut lands on the nearest neighbour (clips melt into each other) · 1 = the farthest (every cut is a slap)"
        />
        <Slider
          label="variety"
          value={params.variety}
          onChange={(v) => setParams({ variety: v })}
          title="0 always takes the single best match (and repeats itself); higher samples loosely among the good ones"
        />

        <button
          className="self-start font-mono text-[9px] uppercase text-muted hover:text-accent"
          onClick={() => setShowWeights((o) => !o)}
        >
          {showWeights ? '▾' : '▸'} what counts as similar
        </button>
        {showWeights && (
          <div className="flex flex-col gap-px rounded border border-border bg-panel2/40 p-1.5">
            {DESCRIPTORS.map((d, i) => (
              <Slider
                key={d}
                tiny
                label={DESC_LABELS[d]}
                value={params.weights[i] ?? 0}
                onChange={(v) => {
                  const weights = [...params.weights]
                  weights[i] = v
                  setParams({ weights })
                }}
                title={
                  i < 8
                    ? `${DESC_LABELS[d]} — also readable from the live output, so it works in follow mode`
                    : `${DESC_LABELS[d]} — corpus only`
                }
              />
            ))}
          </div>
        )}
      </Box>

      {/* ── Time ── */}
      <Box title="time">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="w-12 shrink-0 font-mono text-[9px] uppercase text-muted">length</span>
          <input
            type="range"
            min={5}
            max={600}
            step={5}
            value={params.duration}
            onChange={(e) => setParams({ duration: Number(e.target.value) })}
            className="min-w-0 flex-1 accent-accent"
          />
          <span className="w-10 shrink-0 text-right font-mono text-[9px] text-muted">{fmt(params.duration)}</span>
          <button
            onClick={() => setParams({ loop: !params.loop })}
            className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[9px] ${
              params.loop ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted'
            }`}
            title="Loop the assemblage when it reaches the end"
          >
            loop
          </button>
        </div>

        <Curve
          label="cut length"
          shape={params.lenShape}
          amount={params.lenAmount}
          onShape={(lenShape) => setParams({ lenShape })}
          onAmount={(lenAmount) => setParams({ lenAmount })}
          hint="How long each clip stays on screen, across the sequence. Rise = cuts get slower; accel = a late rush."
        />
        <Curve
          label="speed"
          shape={params.spdShape}
          amount={params.spdAmount}
          onShape={(spdShape) => setParams({ spdShape })}
          onAmount={(spdAmount) => setParams({ spdAmount })}
          hint="Playback rate of each clip, across the sequence. Independent of cut length — cross the two for slow-motion stutter."
        />
      </Box>

      {/* ── Generate ── */}
      <Box title="assemblage">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            className="shrink-0 rounded border border-accent/60 bg-accent/10 px-2.5 py-1 text-[11.5px] font-semibold text-accent transition-colors hover:bg-accent/20 disabled:opacity-40"
            onClick={doGenerate}
            disabled={!units || !!busy}
            title={`Build an edit and put it on layer ${target.layer + 1} source ${target.slot}`}
          >
            Generate
          </button>
          <button
            className="shrink-0 rounded border border-accent2/60 bg-accent2/10 px-2.5 py-1 text-[11.5px] font-semibold text-accent2 transition-colors hover:bg-accent2/20 disabled:opacity-40"
            onClick={doVary}
            disabled={!units || !!busy}
            title="Same recipe, new dice : a sibling edit"
          >
            Vary
          </button>
          <span className="min-w-0 flex-1 truncate text-right font-mono text-[9px] text-muted">
            {draft
              ? `${draft.clips.length} clips · ${fmt(edlDuration(draft.clips))} → L${target.layer + 1}${target.slot}`
              : `→ layer ${target.layer + 1} · src ${target.slot}`}
          </span>
        </div>

        {draft && (
          <>
            <EdlStrip clips={draft.clips} />
            <div className="flex min-w-0 items-center gap-1.5">
              <input
                className="input min-w-0 flex-1 px-1 py-0.5 text-[11px]"
                placeholder="name this assemblage…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && name.trim()) {
                    saveAssemblage({ ...draft, name: name.trim() })
                    setDraft({ ...draft, name: name.trim() })
                  }
                }}
              />
              <button
                className="btn shrink-0 px-2 py-0.5 text-[11px]"
                disabled={!name.trim()}
                onClick={() => {
                  saveAssemblage({ ...draft, name: name.trim() })
                  setDraft({ ...draft, name: name.trim() })
                }}
                title="Keep this edit in the bank"
              >
                save
              </button>
              <button
                className="btn shrink-0 px-2 py-0.5 text-[11px]"
                onClick={() => void doExport()}
                disabled={!!busy}
                title="Render this edit to a video file in Recorded/ (ffmpeg)"
              >
                export…
              </button>
            </div>
          </>
        )}
      </Box>

      {/* ── Bank ── */}
      {assemblages.length > 0 && (
        <Box title={`saved (${assemblages.length})`}>
          <div className="flex flex-col gap-px">
            {assemblages.map((a) => (
              <div key={a.id} className="flex min-w-0 items-center gap-1.5 rounded bg-panel2/40 px-1.5 py-0.5">
                <button
                  className="min-w-0 flex-1 truncate text-left text-[11px] hover:text-accent"
                  onClick={() => {
                    setDraft(a)
                    setName(a.name)
                    setSourceAssemble(target.layer, target.slot, a)
                  }}
                  title={`Put "${a.name}" on layer ${target.layer + 1} src ${target.slot} · ${a.clips.length} clips`}
                >
                  {a.name}
                </button>
                <span className="shrink-0 font-mono text-[9px] text-muted">{fmt(edlDuration(a.clips))}</span>
                <button
                  className="shrink-0 font-mono text-[10px] text-muted hover:text-danger"
                  onClick={() => deleteAssemblage(a.id)}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </Box>
      )}
    </div>
  )
}

// ── Pieces ────────────────────────────────────────────────────────────────

function Box({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded border border-border bg-panel2/30 p-2">
      <span className="font-mono text-[9px] uppercase tracking-wide text-muted">{title}</span>
      {children}
    </div>
  )
}

function Slider({
  label,
  value,
  onChange,
  title,
  fmt: f,
  tiny
}: {
  label: string
  value: number
  onChange: (v: number) => void
  title?: string
  fmt?: (v: number) => string
  tiny?: boolean
}): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5" title={title}>
      <span
        className={`shrink-0 font-mono text-[9px] text-muted ${tiny ? 'w-[74px]' : 'w-[86px]'}`}
      >
        {label}
      </span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1 accent-accent"
      />
      <span className="w-9 shrink-0 text-right font-mono text-[9px] text-muted">
        {f ? f(value) : value.toFixed(2)}
      </span>
    </div>
  )
}

/** Curve chooser with a live sparkline of its shape. */
function Curve({
  label,
  shape,
  amount,
  onShape,
  onAmount,
  hint
}: {
  label: string
  shape: CurveShape
  amount: number
  onShape: (s: CurveShape) => void
  onAmount: (a: number) => void
  hint: string
}): JSX.Element {
  const pts: string[] = []
  for (let i = 0; i <= 28; i++) {
    const t = i / 28
    // Draw the amount-scaled deviation from neutral, so amount 0 is a flat line
    // whatever the shape — which is exactly what it does to the edit.
    const c = 0.5 + (curveAt(shape, t, 0.5) - 0.5) * amount
    pts.push(`${(t * 60).toFixed(1)},${(14 - c * 12).toFixed(1)}`)
  }
  return (
    <div className="flex min-w-0 items-center gap-1.5" title={hint}>
      <span className="w-[86px] shrink-0 font-mono text-[9px] text-muted">{label}</span>
      <svg width={60} height={16} className="shrink-0 rounded bg-panel3/50">
        <polyline points={pts.join(' ')} fill="none" stroke="rgb(var(--c-accent))" strokeWidth={1.2} />
      </svg>
      <select
        className="input select-compact min-w-0 flex-1 px-1 py-0.5 text-[9px]"
        value={shape}
        onChange={(e) => onShape(e.target.value as CurveShape)}
      >
        {CURVE_SHAPES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={amount}
        onChange={(e) => onAmount(Number(e.target.value))}
        className="w-12 shrink-0 accent-accent2"
        title={`Depth ${Math.round(amount * 100)}% (±${(amount * 3).toFixed(1)} octaves)`}
      />
    </div>
  )
}

/** The generated edit as a proportional strip : each block one clip, width its
 *  screen time, tint its speed. Reads the rhythm of the edit at a glance. */
function EdlStrip({ clips }: { clips: import('@shared/assemble').AssembleClip[] }): JSX.Element {
  const total = edlDuration(clips) || 1
  return (
    <div className="flex h-4 w-full overflow-hidden rounded border border-border">
      {clips.slice(0, 220).map((c, i) => {
        // Slow clips read cool, fast clips read hot.
        const h = c.speed <= 1 ? 200 - (1 - c.speed) * 40 : 40 - Math.min(1, (c.speed - 1) / 7) * 40
        return (
          <div
            key={i}
            style={{
              width: `${(c.durSec / total) * 100}%`,
              background: `hsl(${h} 55% ${38 + (i % 2) * 8}%)`
            }}
            title={`${i + 1}. ${c.fileName} @${c.inSec.toFixed(1)}s · ${c.durSec.toFixed(2)}s · ${c.speed.toFixed(2)}×`}
          />
        )
      })}
    </div>
  )
}

/**
 * The corpus as a point cloud (the first two principal components of the
 * z-scored descriptors). Neighbours here look alike; that is the whole premise.
 * In trajectory mode the two handles are draggable and the edit travels the
 * line between them.
 */
function CorpusMap(): JSX.Element {
  const corpus = useStore((s) => s.assembleCorpus)
  const map = useStore((s) => s.assembleMap)
  const params = useStore((s) => s.assembleParams)
  const setParams = useStore((s) => s.setAssembleParams)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [hover, setHover] = useState<number>(-1)
  const drag = useRef<'from' | 'to' | null>(null)

  const H = 132

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !corpus) return
    const w = cv.clientWidth || 240
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = w * dpr
    cv.height = H * dpr
    const g = cv.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.clearRect(0, 0, w, H)

    for (let i = 0; i < map.length; i++) {
      const u = corpus.units[i]
      if (!u) continue
      const [mx, my] = map[i]
      // Tint each point by its own look : hue from warmth, lightness from
      // brightness — so the cloud reads as the corpus, not as abstract dots.
      const warm = u.desc[7] ?? 0.5
      const bright = u.desc[0] ?? 0.5
      g.fillStyle = `hsl(${200 - warm * 190} ${25 + (u.desc[9] ?? 0) * 55}% ${22 + bright * 55}%)`
      g.beginPath()
      g.arc(mx * w, my * H, i === hover ? 4 : 2, 0, Math.PI * 2)
      g.fill()
    }

    if (params.mode === 'trajectory') {
      const [ax, ay] = params.trajFrom
      const [bx, by] = params.trajTo
      g.strokeStyle = 'rgba(255,255,255,0.5)'
      g.lineWidth = 1
      g.setLineDash([3, 3])
      g.beginPath()
      g.moveTo(ax * w, ay * H)
      g.lineTo(bx * w, by * H)
      g.stroke()
      g.setLineDash([])
      for (const [p, label] of [
        [params.trajFrom, 'A'],
        [params.trajTo, 'B']
      ] as const) {
        g.fillStyle = 'rgb(var(--c-accent))'
        g.beginPath()
        g.arc(p[0] * w, p[1] * H, 5, 0, Math.PI * 2)
        g.fill()
        g.fillStyle = '#000'
        g.font = '8px monospace'
        g.textAlign = 'center'
        g.textBaseline = 'middle'
        g.fillText(label, p[0] * w, p[1] * H)
      }
    }
  }, [corpus, map, hover, params.mode, params.trajFrom, params.trajTo])

  const at = (e: React.PointerEvent): [number, number] => {
    const r = (e.target as HTMLCanvasElement).getBoundingClientRect()
    return [
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
    ]
  }
  const nearest = (x: number, y: number): number => {
    let best = -1
    let bd = 0.0025 // ~5% of the box : don't snap from across the map
    for (let i = 0; i < map.length; i++) {
      const d = (map[i][0] - x) ** 2 + (map[i][1] - y) ** 2
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }

  const hovered = hover >= 0 ? corpus?.units[hover] : null

  return (
    <div className="relative flex min-w-0 flex-col gap-1 rounded border border-border bg-panel2/30 p-2">
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted">map</span>
        <span className="font-mono text-[8px] text-muted">
          {params.mode === 'trajectory' ? 'drag A / B to set the path' : 'neighbours look alike'}
        </span>
      </div>
      <canvas
        ref={canvasRef}
        style={{ height: H, touchAction: 'none' }}
        className="w-full cursor-crosshair rounded bg-panel"
        onPointerDown={(e) => {
          if (params.mode !== 'trajectory') return
          const [x, y] = at(e)
          const da = (params.trajFrom[0] - x) ** 2 + (params.trajFrom[1] - y) ** 2
          const db = (params.trajTo[0] - x) ** 2 + (params.trajTo[1] - y) ** 2
          drag.current = da < db ? 'from' : 'to'
          ;(e.target as HTMLCanvasElement).setPointerCapture(e.pointerId)
          setParams(drag.current === 'from' ? { trajFrom: [x, y] } : { trajTo: [x, y] })
        }}
        onPointerMove={(e) => {
          const [x, y] = at(e)
          if (drag.current) {
            setParams(drag.current === 'from' ? { trajFrom: [x, y] } : { trajTo: [x, y] })
          } else {
            setHover(nearest(x, y))
          }
        }}
        onPointerUp={(e) => {
          drag.current = null
          try {
            ;(e.target as HTMLCanvasElement).releasePointerCapture(e.pointerId)
          } catch {
            /* ignore */
          }
        }}
        onPointerLeave={() => setHover(-1)}
      />
      {hovered && (
        <div className="pointer-events-none absolute right-3 top-7 flex items-center gap-1.5 rounded border border-border bg-panel px-1 py-1 shadow-lg">
          <Thumb b64={hovered.thumb} />
          <span className="max-w-[110px] truncate font-mono text-[8px] text-muted">
            {hovered.fileName}
            <br />
            {hovered.start.toFixed(1)}s · {hovered.dur.toFixed(1)}s
          </span>
        </div>
      )}
    </div>
  )
}

/** Draw a base64 raw-RGB chip. No decoder involved — the analyser already gave
 *  us pixels, so this is just a putImageData. */
function Thumb({ b64, size = 34 }: { b64: string; size?: number }): JSX.Element {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const cv = ref.current
    if (!cv) return
    const g = cv.getContext('2d')
    if (!g) return
    try {
      const bin = atob(b64)
      const edge = Math.round(Math.sqrt(bin.length / 3))
      const img = g.createImageData(edge, edge)
      for (let i = 0; i < edge * edge; i++) {
        img.data[i * 4] = bin.charCodeAt(i * 3)
        img.data[i * 4 + 1] = bin.charCodeAt(i * 3 + 1)
        img.data[i * 4 + 2] = bin.charCodeAt(i * 3 + 2)
        img.data[i * 4 + 3] = 255
      }
      cv.width = edge
      cv.height = edge
      g.putImageData(img, 0, 0)
    } catch {
      /* a malformed thumb just stays blank */
    }
  }, [b64])
  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
      className="shrink-0 rounded-sm"
    />
  )
}
