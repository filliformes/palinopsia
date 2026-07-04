// Palinopsia — the shell. Mounts the WebGL2 Compositor onto the output-preview
// canvas and runs the frame loop; hosts the four layer strips, the transport,
// and the theme picker. The heavy engine lives here in the renderer (brief §3);
// main is pure IO. Panels/regions follow brief §10 — this is the Phase-0
// skeleton: preview + layers + transport, ready for the ISF runtime (Phase 1),
// the FX racks (Phase 3), the auto-UI (Phase 4), and modulation (Phase 5).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Compositor } from './engine/Compositor'
import { FxRackPanel } from './components/FxRackPanel'
import { Inspector } from './components/Inspector'
import { LayerPanel } from './components/LayerPanel'
import { Transport } from './components/Transport'
import { GENERATORS, shaderSourceById } from './shaders/isf'
import { THEME_ORDER, useStore, type ThemeName } from './store'

export default function App(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const compositorRef = useRef<Compositor | null>(null)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const name = useStore((s) => s.name)
  const setName = useStore((s) => s.setName)
  // Layers-column width — draggable via the handle between preview and strips.
  const [layersWidth, setLayersWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('opsia.layersWidth'))
    return Number.isFinite(saved) && saved >= 240 ? saved : 320
  })
  useEffect(() => {
    localStorage.setItem('opsia.layersWidth', String(layersWidth))
  }, [layersWidth])

  // ── Engine: mount the Compositor + run the frame loop ───────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let raf = 0
    let comp: Compositor | null = null
    try {
      comp = new Compositor(canvas, canvas.width, canvas.height)
      compositorRef.current = comp
    } catch (e) {
      // WebGL2 unavailable — surface it rather than a blank canvas.
      console.error('[Compositor]', (e as Error).message)
      return
    }

    // Seed the session: Drift Field on layer 1 so first launch shows the
    // instrument's voice, with its controls up in the Inspector.
    if (!useStore.getState().composition.layers[0].sourceA.shaderId) {
      useStore.getState().setSourceShader(0, 'A', GENERATORS[0].id)
      useStore.getState().setSelection({ type: 'source', layer: 0, slot: 'A' })
    }

    const start = performance.now()
    const loop = (): void => {
      // Store → engine reconciliation, every frame. One write path for
      // everything: UI edits, session loads, and (later) OSC / modulators /
      // auto-UI all mutate the store; the engine follows. Shader hot-swaps
      // preserve feedback buffers (brief §1) — never a reset to black.
      comp!.syncFromState(useStore.getState().composition, shaderSourceById)
      comp!.render(performance.now() - start)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      compositorRef.current = null
    }
  }, [])

  // ── Save-before-quit handshake (main asks; we ack) ──────────────────
  useEffect(() => {
    const off = window.api.onAppBeforeClose(async () => {
      try {
        await window.api.sessionSaveToDefault(useStore.getState().exportSession())
      } catch {
        /* best-effort autosave on quit */
      }
      window.api.appCloseProceed()
    })
    return off
  }, [])

  // ── Push the live session to main for the 60s autosave loop ─────────
  useEffect(() => {
    const push = (): void => {
      void window.api.setCurrentSession(useStore.getState().exportSession())
    }
    push()
    const unsub = useStore.subscribe(push)
    return unsub
  }, [])

  async function openSession(): Promise<void> {
    const res = await window.api.sessionOpen()
    if (res) useStore.getState().loadSession(res.session)
  }

  async function saveSession(): Promise<void> {
    await window.api.sessionSaveAs(useStore.getState().exportSession())
  }

  return (
    <div className="flex h-screen flex-col bg-bg font-app text-text">
      {/* ── Top bar ─────────────────────────────────────────────── */}
      <header className="flex items-center gap-4 border-b border-border bg-panel px-4 py-2">
        <h1
          className="select-none font-mono text-[15px] font-semibold uppercase tracking-[0.2em]"
          // Restrained glitch signature on the title — a faint chromatic
          // aberration, never spectacle (brief §10).
          style={{ textShadow: '0.5px 0 rgb(var(--c-accent) / 0.5), -0.5px 0 rgb(var(--c-accent2) / 0.5)' }}
        >
          Palinopsia
        </h1>
        <input
          className="input w-56 text-[12px]"
          value={name}
          onChange={(e) => setName(e.target.value)}
          title="Session name"
        />
        <div className="flex-1" />
        <button className="btn text-[12px]" onClick={openSession}>
          Open
        </button>
        <button className="btn text-[12px]" onClick={saveSession}>
          Save
        </button>
        <select
          className="input text-[12px]"
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeName)}
          title="Theme"
        >
          {THEME_ORDER.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </header>

      {/* ── Body: preview + layer strips ────────────────────────── */}
      <main className="flex min-h-0 flex-1 gap-2 overflow-hidden p-3">
        {/* Output preview — the live composite, front and centre (brief §10.1) */}
        <section className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="relative flex-1 overflow-hidden rounded-md border border-border bg-black">
            <canvas
              ref={canvasRef}
              width={1920}
              height={1080}
              className="h-full w-full object-contain"
              // Subtle scanline signature over the preview (brief §10).
              style={{
                backgroundImage:
                  'repeating-linear-gradient(0deg, rgb(255 255 255 / 0.015) 0 1px, transparent 1px 3px)'
              }}
            />
            <div className="pointer-events-none absolute bottom-2 left-2 font-mono text-[10px] text-muted/70">
              output · 1920×1080
            </div>
          </div>

          {/* Auto-generated control panel — the selection's ISF INPUTS
              rendered as themed controls (brief §10.3). */}
          <Inspector />

          {/* Master FX rack — glitch / dither / chroma / grade (brief §10.5);
              the warp/mapping stage joins it in Phase 8. */}
          <MasterRackStrip />
        </section>

        {/* Drag handle — the layers column is resizable */}
        <LayerColumnHandle onResize={setLayersWidth} width={layersWidth} />

        {/* Four layer strips (brief §10.2) */}
        <aside
          className="flex shrink-0 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-0.5"
          style={{ width: layersWidth }}
        >
          {[0, 1, 2, 3].map((i) => (
            <LayerPanel key={i} index={i} />
          ))}
        </aside>
      </main>

      {/* ── Transport ───────────────────────────────────────────── */}
      <Transport />
    </div>
  )
}

function MasterRackStrip(): JSX.Element {
  const master = useStore((s) => s.composition.master)
  return <FxRackPanel scope={{ kind: 'master' }} fx={master} label="master fx" />
}

/** Thin draggable divider between the preview and the layers column. */
function LayerColumnHandle({
  width,
  onResize
}: {
  width: number
  onResize: (w: number) => void
}): JSX.Element {
  const drag = useRef<{ startX: number; startW: number; pointerId: number } | null>(null)
  return (
    <div
      className="w-1 shrink-0 cursor-col-resize rounded bg-border/60 transition-colors hover:bg-accent/60"
      style={{ touchAction: 'none' }}
      title="Drag to resize the layers column · double-click to reset"
      onPointerDown={(e: ReactPointerEvent<HTMLDivElement>) => {
        drag.current = { startX: e.clientX, startW: width, pointerId: e.pointerId }
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      }}
      onPointerMove={(e: ReactPointerEvent<HTMLDivElement>) => {
        const d = drag.current
        if (!d || e.pointerId !== d.pointerId) return
        // Handle sits left of the column: dragging left widens it.
        const w = d.startW + (d.startX - e.clientX)
        onResize(Math.max(240, Math.min(560, w)))
      }}
      onPointerUp={() => {
        drag.current = null
      }}
      onPointerCancel={() => {
        drag.current = null
      }}
      onDoubleClick={() => onResize(320)}
    />
  )
}
