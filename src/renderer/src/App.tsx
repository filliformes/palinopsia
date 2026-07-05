// Palinopsia — the shell. Mounts the WebGL2 Compositor onto the output-preview
// canvas and runs the frame loop; hosts the four layer strips, the transport,
// and the theme picker. The heavy engine lives here in the renderer (brief §3);
// main is pure IO. Panels/regions follow brief §10 — this is the Phase-0
// skeleton: preview + layers + transport, ready for the ISF runtime (Phase 1),
// the FX racks (Phase 3), the auto-UI (Phase 4), and modulation (Phase 5).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Compositor } from './engine/Compositor'
import { applyModulation, modEngine } from './engine/modulation'
import { Collapsible } from './components/Collapsible'
import { FxRackPanel } from './components/FxRackPanel'
import { Inspector } from './components/Inspector'
import { LayerPanel } from './components/LayerPanel'
import { MixerPanel } from './components/MixerPanel'
import { MetaBar } from './components/MetaBar'
import { ModulationPanel } from './components/ModulationPanel'
import { SceneBank } from './components/SceneBank'
import { useFlash } from './components/useFlash'
import { Transport } from './components/Transport'
import { initMidi } from './midi'
import { GENERATORS, shaderSourceById } from './shaders/isf'
import { inputsForShader } from './shaders/isf/inputs'
import { MASTER_PRESETS } from './shaders/isf/masterPresets'
import { PRESETS_BY_ID } from './shaders/isf/presets'

// ── Vibe Palette shortcuts (P / Shift+P) ──────────────────────────────
// Cursor into the Vibe's preset list, kept at module scope so it survives
// re-renders and advances across Shift+P presses.
let vibePresetIndex = -1

function openVibeInInspector(): void {
  const st = useStore.getState()
  const vibe = st.composition.master.find((f) => f.locked)
  if (!vibe) return
  if (st.collapsed['inspector']) st.toggleSection('inspector')
  st.setSelection({ type: 'fx', scope: { kind: 'master' }, instId: vibe.id })
}

function cycleVibePreset(): void {
  const st = useStore.getState()
  const vibe = st.composition.master.find((f) => f.locked)
  if (!vibe) return
  const presets = PRESETS_BY_ID['fx-vibe'] ?? []
  if (presets.length === 0) return
  vibePresetIndex = (vibePresetIndex + 1) % presets.length
  const p = presets[vibePresetIndex]
  for (const [k, v] of Object.entries(p.values)) {
    st.setFxInput({ kind: 'master' }, vibe.id, k, v)
  }
  st.setVibePresetName(p.name)
  // Show the change in the Inspector.
  if (st.collapsed['inspector']) st.toggleSection('inspector')
  st.setSelection({ type: 'fx', scope: { kind: 'master' }, instId: vibe.id })
}
import { initUndo, redo, undo, useUndoState } from './undo'
import { THEME_ORDER, useStore, type ThemeName } from './store'

export default function App(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const compositorRef = useRef<Compositor | null>(null)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const name = useStore((s) => s.name)
  const setName = useStore((s) => s.setName)
  const uiZoom = useStore((s) => s.uiZoom)
  const setUiZoom = useStore((s) => s.setUiZoom)
  const mixerView = useStore((s) => s.mixerView)
  // Layers-column width — draggable via the handle between preview and strips.
  const [layersWidth, setLayersWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('opsia.layersWidth'))
    return Number.isFinite(saved) && saved >= 240 ? saved : 320
  })
  useEffect(() => {
    localStorage.setItem('opsia.layersWidth', String(layersWidth))
  }, [layersWidth])

  // ── MIDI (Meta Controller CC learn + routing) ───────────────────────
  useEffect(() => {
    initMidi()
  }, [])

  // ── Undo/redo (100 levels) + keyboard shortcuts ─────────────────────
  useEffect(() => {
    const unsub = initUndo()
    const onKey = (e: KeyboardEvent): void => {
      // Don't hijack typing in inputs for zoom keys; undo is safe globally.
      const inField = (e.target as HTMLElement)?.tagName === 'INPUT'
      // Bare 1–9: recall scenes (the playing-surface shortcut).
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !inField && /^[1-9]$/.test(e.key)) {
        const st = useStore.getState()
        const scene = st.scenes[Number(e.key) - 1]
        if (scene) {
          e.preventDefault()
          st.recallScene(scene.id)
        }
        return
      }
      // P: open the Vibe Palette in the Inspector · Shift+P: cycle its presets.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !inField && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        if (e.shiftKey) cycleVibePreset()
        else openVibeInInspector()
        return
      }
      // M: swap the layer strips for the compact Mixer surface (and back).
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !inField && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        useStore.getState().toggleMixerView()
        return
      }
      if (!(e.ctrlKey || e.metaKey)) return
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (e.key === 'y') {
        e.preventDefault()
        redo()
      } else if (!inField && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        setUiZoom(useStore.getState().uiZoom + 0.05)
      } else if (!inField && e.key === '-') {
        e.preventDefault()
        setUiZoom(useStore.getState().uiZoom - 0.05)
      } else if (!inField && e.key === '0') {
        e.preventDefault()
        setUiZoom(1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      unsub()
      window.removeEventListener('keydown', onKey)
    }
  }, [setUiZoom])

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
      // The whole body is guarded: a shader that throws at load or draw time
      // must never kill the loop (that's a permanent freeze). Lose one frame,
      // keep scheduling — the offending layer simply doesn't render.
      try {
        const now = performance.now()
        const c = useStore.getState().composition
        // 1. Store → engine reconciliation (base values). One write path for
        //    everything: UI edits, session loads, OSC — the engine follows.
        //    Shader hot-swaps preserve feedback buffers (brief §1).
        comp!.syncFromState(c, shaderSourceById)
        // 2. Modulation: tick the 8-slot engine, then overlay the mod-matrix
        //    on top of the base values — straight into the Compositor, never
        //    through React (no 60 Hz re-renders).
        const modValues = modEngine.tick(now, c.modulators, c.bpm)
        applyModulation(comp!, c, modValues, inputsForShader)
        // 3. Render the frame.
        comp!.render(now - start)
      } catch (e) {
        console.error('[render loop]', e)
      }
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
    // CSS zoom scales the whole chrome; h-screen compensates by 1/zoom so
    // the layout still fills the window exactly.
    <div
      className="flex flex-col bg-bg font-app text-text"
      style={{ zoom: uiZoom, height: `calc(100vh / ${uiZoom})` }}
    >
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
        <UndoButtons />
        <div className="flex items-center gap-0.5" title="UI zoom — Ctrl+= / Ctrl+- / Ctrl+0">
          <button className="btn px-1.5 text-[12px]" onClick={() => setUiZoom(uiZoom - 0.05)}>
            −
          </button>
          <span className="w-9 text-center font-mono text-[10px] text-muted">
            {Math.round(uiZoom * 100)}%
          </span>
          <button className="btn px-1.5 text-[12px]" onClick={() => setUiZoom(uiZoom + 0.05)}>
            +
          </button>
        </div>
        <button
          className="btn text-[12px]"
          onClick={() => useStore.getState().newSession()}
          title="New blank session (undoable)"
        >
          New
        </button>
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

          {/* Scene bank — recallable full-instrument states (brief §10.7) */}
          <Collapsible sectionKey="scenes" title="scenes">
            <SceneBank />
          </Collapsible>

          {/* Auto-generated control panel — the selection's ISF INPUTS
              rendered as themed controls (brief §10.3). */}
          <Collapsible sectionKey="inspector" title="inspector">
            <Inspector />
          </Collapsible>

          {/* Master FX rack — chips layout, zero blank space (brief §10.5);
              the warp/mapping stage joins it in Phase 8. */}
          <Collapsible sectionKey="master" title="master fx">
            <MasterRackStrip />
          </Collapsible>
        </section>

        {/* Drag handle — the layers column is resizable */}
        <LayerColumnHandle onResize={setLayersWidth} width={layersWidth} />

        {/* Four layer strips (brief §10.2) — or the compact Mixer (M key) */}
        <aside
          className="flex shrink-0 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-0.5"
          style={{ width: layersWidth }}
        >
          {mixerView ? (
            <MixerPanel />
          ) : (
            <>
              <button
                onClick={() => useStore.getState().toggleMixerView()}
                className="self-start rounded border border-border px-1.5 py-0.5 font-mono text-[9px] text-muted hover:text-accent"
                title="Open the Mixer — opacity/speed/blend for all 4 layers (M)"
              >
                ▸ mixer
              </button>
              {[0, 1, 2, 3].map((i) => (
                <LayerPanel key={i} index={i} />
              ))}
            </>
          )}
        </aside>
      </main>

      {/* ── Modulation: 8-mod bank + capped matrix (brief §10.4) ── */}
      <ModulationPanel />

      {/* ── Meta Controller: 32 macro knobs / 4 banks (brief §6) ── */}
      <MetaBar />

      {/* ── Transport ───────────────────────────────────────────── */}
      <Transport />
    </div>
  )
}

function MasterRackStrip(): JSX.Element {
  const master = useStore((s) => s.composition.master)
  const applyMasterPreset = useStore((s) => s.applyMasterPreset)
  const randomizeMasterParams = useStore((s) => s.randomizeMasterParams)
  // The select keeps showing the applied chain's name.
  const [applied, setApplied] = useState('')
  const [flashing, flash] = useFlash()
  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 rounded-md border bg-panel2/40 p-2 transition-colors ${
        flashing ? 'animate-pulse border-danger ring-1 ring-danger' : 'border-border'
      }`}
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted">
          chain
        </span>
        <button
          onClick={() => {
            randomizeMasterParams()
            flash()
          }}
          className={`shrink-0 rounded border px-1 font-mono text-[10px] leading-4 transition-colors ${
            flashing
              ? 'animate-pulse border-danger bg-danger/25 text-danger'
              : 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/20'
          }`}
          title="Randomize the master FX parameters (keeps the chain + your Vibe)"
        >
          ⚄
        </button>
        <select
          className="input select-compact w-40 min-w-0 text-[10px]"
          value={applied}
          onChange={(e) => {
            const p = MASTER_PRESETS.find((x) => x.name === e.target.value)
            if (p) {
              applyMasterPreset(p.fx, p.vibe)
              setApplied(p.name)
            }
          }}
          title="Master chain presets — replaces the chain and sets the Vibe accordingly"
        >
          <option value="">chain presets…</option>
          {MASTER_PRESETS.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <FxRackPanel scope={{ kind: 'master' }} fx={master} label="" />
    </div>
  )
}

function UndoButtons(): JSX.Element {
  const state = useUndoState()
  return (
    <div className="flex items-center gap-0.5" title="Undo / Redo — Ctrl+Z / Ctrl+Shift+Z">
      <button className="btn px-1.5 text-[12px]" onClick={undo} disabled={!state.undo}>
        ↩
      </button>
      <button className="btn px-1.5 text-[12px]" onClick={redo} disabled={!state.redo}>
        ↪
      </button>
    </div>
  )
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
