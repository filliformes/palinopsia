// Palinopsia — the shell. Mounts the WebGL2 Compositor onto the output-preview
// canvas and runs the frame loop; hosts the four layer strips, the transport,
// and the theme picker. The heavy engine lives here in the renderer (brief §3);
// main is pure IO. Panels/regions follow brief §10 — this is the Phase-0
// skeleton: preview + layers + transport, ready for the ISF runtime (Phase 1),
// the FX racks (Phase 3), the auto-UI (Phase 4), and modulation (Phase 5).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Compositor } from './engine/Compositor'
import { hiveEncoder } from './hiveEncoder'
import { audioBus } from './engine/audioIn'
import { applyCoupling } from './engine/coupling'
import { applyProximity, applyFieldMacros } from './engine/field'
import { applyModulation, modEngine } from './engine/modulation'
import { currentFps, tickFrame } from './perf'
import { tickSequencer } from './engine/sequencer'
import { Collapsible } from './components/Collapsible'
import { FxRackPanel, FxChips } from './components/FxRackPanel'
import { FinishingTouches, FinishingToggle } from './components/FinishingTouches'
import { Inspector } from './components/Inspector'
import { LayerPanel } from './components/LayerPanel'
import { MixerPanel } from './components/MixerPanel'
import { MetaBar } from './components/MetaBar'
import { ModulationPanel } from './components/ModulationPanel'
import { OscPanel } from './components/OscPanel'
import { AudioPanel } from './components/AudioPanel'
import { BackgroundPanel } from './components/BackgroundPanel'
import { OutputPage } from './components/OutputPage'
import { WorldPage } from './components/WorldPage'
import { SequencePage } from './components/SequencePage'
import { SceneBank } from './components/SceneBank'
import { initOscInput, applyOscListen } from './oscInput'
import { morphedComposition, consumeCrossfade } from './morph'
import { useFlash } from './components/useFlash'
import { Transport } from './components/Transport'
import { initMidi } from './midi'
import { GENERATORS, shaderSourceById } from './shaders/isf'
import { inputsForShader } from './shaders/isf/inputs'
import { MASTER_PRESETS } from './shaders/isf/masterPresets'
import { PRESETS_BY_ID } from './shaders/isf/presets'

// ── Vibe Palette (P / Shift+P) & Context (C / Shift+C) shortcuts ───────
// Cursors into each finalizer's preset list, kept at module scope so they
// survive re-renders and advance across Shift presses.
let vibePresetIndex = -1
let contextPresetIndex = -1

// Reveal a Finishing Touches sub-section: switch the right column to the
// Finishing view and expand the relevant sub-row.
function revealFinishing(sub: 'ft-vibe' | 'ft-context'): void {
  const st = useStore.getState()
  st.setRightView('finishing')
  if (st.collapsed[sub] ?? true) st.toggleSection(sub)
}

function openVibeInInspector(): void {
  revealFinishing('ft-vibe')
}

function cycleVibePreset(): void {
  const st = useStore.getState()
  const vibe = st.composition.master.find((f) => f.shaderId === 'fx-vibe')
  if (!vibe) return
  const presets = PRESETS_BY_ID['fx-vibe'] ?? []
  if (presets.length === 0) return
  vibePresetIndex = (vibePresetIndex + 1) % presets.length
  const p = presets[vibePresetIndex]
  for (const [k, v] of Object.entries(p.values)) {
    st.setFxInput({ kind: 'master' }, vibe.id, k, v)
  }
  st.setVibePresetName(p.name)
  revealFinishing('ft-vibe')
}

function openContextInInspector(): void {
  revealFinishing('ft-context')
}

function cycleContextPreset(): void {
  const st = useStore.getState()
  const ctx = st.composition.master.find((f) => f.shaderId === 'fx-context')
  if (!ctx) return
  const presets = PRESETS_BY_ID['fx-context'] ?? []
  if (presets.length === 0) return
  contextPresetIndex = (contextPresetIndex + 1) % presets.length
  const p = presets[contextPresetIndex]
  for (const [k, v] of Object.entries(p.values)) {
    st.setFxInput({ kind: 'master' }, ctx.id, k, v)
  }
  revealFinishing('ft-context')
}
import { initUndo, redo, undo, useUndoState } from './undo'
import { THEME_ORDER, useStore, type ThemeName } from './store'
import { randomizeMetaKnobs } from './metaSmooth'
import type { RandomizeScope } from './randomize'

// Fire the Randomize mode the Transport's chevron currently points at (persisted
// in localStorage) — the R shortcut mirrors clicking the Randomize button.
function fireSelectedRandomize(): void {
  const raw = localStorage.getItem('opsia.randScope') as RandomizeScope | null
  const scope: RandomizeScope = raw ?? 'all'
  if (scope === 'meta') {
    randomizeMetaKnobs()
    return
  }
  const i = Number(localStorage.getItem('opsia.randIntensity'))
  const intensity = Number.isFinite(i) && i > 0 ? i : 1
  useStore.getState().randomize(scope, intensity)
}

export default function App(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const compositorRef = useRef<Compositor | null>(null)
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const name = useStore((s) => s.name)
  const setName = useStore((s) => s.setName)
  const uiZoom = useStore((s) => s.uiZoom)
  const setUiZoom = useStore((s) => s.setUiZoom)
  const rightView = useStore((s) => s.rightView)
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

  // ── OSC input (Pandore plays the instrument) ────────────────────────
  useEffect(() => {
    const unsub = initOscInput()
    // Restore the saved listen state (starts the listener if it was on).
    void applyOscListen()
    return unsub
  }, [])

  // ── Output window — reset our flag if the user closes it directly ──────
  const outputActive = useStore((s) => s.outputActive)
  useEffect(() => {
    return window.api.onOutputClosed(() => useStore.getState().setOutputActive(false))
  }, [])

  // ── External output (NDI / Spout) — attach the readback while active ──
  const ndiActive = useStore((s) => s.ndiActive)
  const spoutActive = useStore((s) => s.spoutActive)
  const outputPageOpen = useStore((s) => s.outputPageOpen)
  const renderScale = useStore((s) => s.renderScale)
  const worldPageOpen = useStore((s) => s.worldPageOpen)
  const sequencePageOpen = useStore((s) => s.sequencePageOpen)
  useEffect(() => {
    const comp = compositorRef.current
    if (!comp) return
    const on = ndiActive || spoutActive
    comp.setOutputCapture(on ? (w, h, px) => window.api.ndiFrame(w, h, px) : null)
    return () => comp.setOutputCapture(null)
  }, [ndiActive, spoutActive])

  // ── HIVE output (sender) — start the HEVC encoder + TCP fan-out ───────
  const hiveOutActive = useStore((s) => s.hiveOutActive)
  const hiveOutPort = useStore((s) => s.hiveOutPort)
  useEffect(() => {
    if (!hiveOutActive) return
    let cancelled = false
    const canvas = canvasRef.current
    ;(async () => {
      const ok = canvas && (await hiveEncoder.start(canvas.width, canvas.height))
      if (cancelled) {
        hiveEncoder.stop()
        return
      }
      if (!ok) {
        // No WebCodecs HEVC encoder on this host — bail out and flip the toggle.
        alert('HIVE output needs a hardware HEVC encoder, which this machine reports as unavailable.')
        useStore.getState().setHiveOutActive(false)
        return
      }
      await window.api.hiveOutStart(hiveOutPort)
    })()
    // New receivers connect → main asks for a keyframe so they can start.
    const unsub = window.api.onHiveForceKey(() => hiveEncoder.requestKeyFrame())
    return () => {
      cancelled = true
      unsub()
      hiveEncoder.stop()
      void window.api.hiveOutStop()
    }
  }, [hiveOutActive, hiveOutPort])

  // ── Audio ingest (Slab 1) — drive the audio bus from OSC + local input ─
  const audioEnabled = useStore((s) => s.audioEnabled)
  const audioSource = useStore((s) => s.audioSource)
  const audioDeviceId = useStore((s) => s.audioDeviceId)
  useEffect(() => {
    if (!audioEnabled) {
      audioBus.mode = 'off'
      audioBus.stopLocal()
      return
    }
    audioBus.mode = audioSource
    // The local Web Audio input runs when the source uses it (local or both).
    const wantLocal = audioSource === 'local' || audioSource === 'both'
    if (wantLocal && !audioBus.localActive) {
      void audioBus.startLocal(audioDeviceId).then((ok) => {
        if (!ok && audioSource === 'local') {
          alert('Could not open the audio input. Check the device / OS permissions.')
        }
      })
    } else if (!wantLocal) {
      audioBus.stopLocal()
    }
    return () => {
      audioBus.mode = 'off'
    }
  }, [audioEnabled, audioSource, audioDeviceId])

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
      // C: open Context in the Inspector · Shift+C: cycle its presets.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !inField && e.key.toLowerCase() === 'c') {
        e.preventDefault()
        if (e.shiftKey) cycleContextPreset()
        else openContextInInspector()
        return
      }
      // M: swap the layer strips for the compact Mixer surface (and back).
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !inField && e.key.toLowerCase() === 'm') {
        e.preventDefault()
        useStore.getState().toggleMixerView()
        return
      }
      // O: open/close the Output / Mapping view.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !inField && e.key.toLowerCase() === 'o') {
        e.preventDefault()
        const st = useStore.getState()
        st.setOutputPageOpen(!st.outputPageOpen)
        return
      }
      // W: open/close the World editor.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !inField && e.key.toLowerCase() === 'w') {
        e.preventDefault()
        const st = useStore.getState()
        st.setWorldPageOpen(!st.worldPageOpen)
        return
      }
      // Q: open/close the Sequence (macro-form) page.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !inField && e.key.toLowerCase() === 'q') {
        e.preventDefault()
        const st = useStore.getState()
        st.setSequencePageOpen(!st.sequencePageOpen)
        return
      }
      // Bare letters: view / panel shortcuts (guarded against typing in fields).
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !inField) {
        const k = e.key.toLowerCase()
        // L / F: switch the right column to Layers / Finishing.
        if (k === 'l') {
          e.preventDefault()
          useStore.getState().setRightView('layers')
          return
        }
        if (k === 'f') {
          e.preventDefault()
          useStore.getState().setRightView('finishing')
          return
        }
        // D / X / I: collapse-toggle the Modulation / Master-FX / Inspector panels.
        if (k === 'd') {
          e.preventDefault()
          useStore.getState().toggleSection('modulation')
          return
        }
        if (k === 'x') {
          e.preventDefault()
          useStore.getState().toggleSection('master')
          return
        }
        if (k === 'i') {
          e.preventDefault()
          useStore.getState().toggleSection('inspector')
          return
        }
        // R: fire the Transport's currently-selected Randomize.
        if (k === 'r') {
          e.preventDefault()
          fireSelectedRandomize()
          return
        }
      }
      // Esc: close the World editor if it's open.
      if (e.key === 'Escape' && useStore.getState().worldPageOpen) {
        e.preventDefault()
        useStore.getState().setWorldPageOpen(false)
        return
      }
      if (e.key === 'Escape' && useStore.getState().outputPageOpen) {
        e.preventDefault()
        useStore.getState().setOutputPageOpen(false)
        return
      }
      if (e.key === 'Escape' && useStore.getState().sequencePageOpen) {
        e.preventDefault()
        useStore.getState().setSequencePageOpen(false)
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
    // Ctrl + mousewheel zooms the whole UI (like the +/- buttons / Ctrl +/-),
    // matching dataFLOU. preventDefault stops the browser's own page zoom.
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setUiZoom(useStore.getState().uiZoom + (e.deltaY < 0 ? 0.05 : -0.05))
    }
    window.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      unsub()
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('wheel', onWheel)
    }
  }, [setUiZoom])

  // ── Engine: mount the Compositor + run the frame loop ───────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    // Internal render resolution = 1920×1080 × renderScale (lo-fi ↔ 4K). The
    // canvas backing store IS the render res; CSS object-contain scales it to the
    // preview (pixelated upscale below 1× for the lo-fi look).
    canvas.width = Math.max(2, Math.round(1920 * renderScale))
    canvas.height = Math.max(2, Math.round(1080 * renderScale))
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

    // A blank open is seeded random (store.seedRandomStart); point the Inspector
    // at layer 1's source so its controls are up. Safety net: if somehow empty
    // (no seed, no loaded session), drop the first generator in.
    {
      const st0 = useStore.getState()
      if (!st0.composition.layers[0].sourceA.shaderId) {
        st0.setSourceShader(0, 'A', GENERATORS[0].id)
      }
      if (!st0.selection) st0.setSelection({ type: 'source', layer: 0, slot: 'A' })
    }

    const start = performance.now()
    const loop = (): void => {
      // The whole body is guarded: a shader that throws at load or draw time
      // must never kill the loop (that's a permanent freeze). Lose one frame,
      // keep scheduling — the offending layer simply doesn't render.
      try {
        const now = performance.now()
        const st = useStore.getState()
        // A morph just began → dissolve the frozen old frame into the new scene.
        const xfadeMs = consumeCrossfade()
        if (xfadeMs) comp!.beginCrossfade(xfadeMs)
        // Morph: while a scene recall / randomize is easing, the engine renders
        // an interpolated composition (the store still holds the target).
        const c = morphedComposition(now, st.composition)
        // 1. Store → engine reconciliation (base values). One write path for
        //    everything: UI edits, session loads, OSC — the engine follows.
        //    Shader hot-swaps preserve feedback buffers (brief §1).
        comp!.setGlobalSpeed(st.globalSpeed)
        comp!.setWarp(st.warpEnabled ? st.warpCorners : null, st.warpGrid)
        comp!.syncFromState(c, shaderSourceById)
        // 2. Modulation: refresh the audio bus (OSC/local features), then tick
        //    the 8-slot engine and overlay the mod-matrix on top of the base
        //    values — straight into the Compositor, never through React.
        audioBus.tick(now)
        const modValues = modEngine.tick(now, c.modulators, c.bpm)
        applyModulation(comp!, c, modValues, inputsForShader)
        // 2b. Coupling: audio binds each layer's A/B balance (post-sync so it
        //     overrides the base mix); returns the coupled mixes for the output.
        const coupledMix = applyCoupling(comp!, c, now)
        // 2c. Proximity (Field macro): push the Context mood into a depth zone.
        const contextProx = applyProximity(comp!, c, st.proximity, st.proximityAudio ? 0.6 : 0)
        // 2d. Macro-form sequencer: auto-advance scenes + Breathe/Arc overlay.
        if (st.sequence.enabled) tickSequencer(now, comp!, c)
        // 2e. Field macros: Density / Gesture⇄Texture / Coalesce (post-mod, 0.5 deadzone).
        applyFieldMacros(comp!, c, st.density, st.gestureTexture, st.coalesce)
        // 3. Render the frame.
        comp!.render(now - start)
        // 4. Native output window: push the exact render state so it renders
        //    the same composition itself (pixel-perfect, no transcode).
        if (st.outputActive) {
          window.api.outputFrame({
            c,
            modValues,
            globalSpeed: st.globalSpeed,
            warpEnabled: st.warpEnabled,
            warpCorners: st.warpCorners,
            warpGrid: st.warpGrid,
            time: now - start,
            coupledMix,
            contextProx
          })
        }
        // 5. HIVE output: encode the composite canvas to HEVC and fan it out to
        //    HIVE receivers (OBS plugin, Resolume …). Frame-drops if backed up.
        if (st.hiveOutActive) hiveEncoder.encode(canvas, now * 1000)
        tickFrame(now) // feed the Output HUD's FPS meter
      } catch (e) {
        console.error('[render loop]', e)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      comp?.dispose() // free all GL resources so a remount can't orphan them
      compositorRef.current = null
    }
    // Recreate the whole engine when the render resolution changes.
  }, [renderScale])

  // ── Save-before-quit handshake (main asks; we ack) ──────────────────
  useEffect(() => {
    const off = window.api.onAppBeforeClose(async () => {
      try {
        // Overwrite the session's own file when it has one; only unnamed
        // sessions land in Sessions/<name>.opsia.json (also overwritten —
        // quitting must never mint a new "Untitled (N)" file).
        const st = useStore.getState()
        if (st.sessionPath) await window.api.sessionSave(st.exportSession(), st.sessionPath)
        else await window.api.sessionSaveToDefault(st.exportSession())
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
    if (res) {
      // Silently save the session being left so switching A→B→A round-trips
      // everything (scenes included). Unnamed sessions go to the default
      // Sessions/<name> file rather than being lost.
      try {
        const st = useStore.getState()
        if (st.sessionPath) await window.api.sessionSave(st.exportSession(), st.sessionPath)
        else await window.api.sessionSaveToDefault(st.exportSession())
      } catch {
        /* best-effort — never block the open */
      }
      useStore.getState().loadSession(res.session)
      useStore.getState().setSessionPath(res.path) // Save now overwrites this file
    }
  }

  // One-shot blue flash on the Save button (dataFLOU's confirmation gesture) —
  // class re-add restarts the animation on every successful save.
  const saveBtnRef = useRef<HTMLButtonElement>(null)
  function flashSave(): void {
    const el = saveBtnRef.current
    if (!el) return
    el.classList.remove('flash-blue')
    void el.offsetWidth
    el.classList.add('flash-blue')
  }

  // Save As — always prompts; remembers the chosen path for later plain Saves.
  async function saveSessionAs(): Promise<boolean> {
    const path = await window.api.sessionSaveAs(useStore.getState().exportSession())
    if (path) useStore.getState().setSessionPath(path)
    return path != null
  }

  // Save — overwrites the current file in place (no dialog). Falls back to Save
  // As the first time (nothing saved/opened yet).
  async function saveSession(): Promise<void> {
    const st = useStore.getState()
    if (st.sessionPath) {
      await window.api.sessionSave(st.exportSession(), st.sessionPath)
      flashSave()
    } else if (await saveSessionAs()) {
      // First-time save promotes Save As → Save; confirm that one too.
      flashSave()
    }
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
        {(() => {
          const sinks = [
            ndiActive && 'NDI',
            spoutActive && 'Spout',
            hiveOutActive && 'HIVE'
          ].filter(Boolean)
          return sinks.length > 0 ? (
            <span
              className="font-mono text-[10px] text-accent"
              title="External output active"
            >
              {sinks.join(' · ')}
            </span>
          ) : null
        })()}
        <button
          className={`btn text-[12px] ${outputActive || ndiActive || spoutActive || hiveOutActive ? 'text-accent' : ''}`}
          onClick={() => useStore.getState().setOutputPageOpen(true)}
          title="Output & projection mapping — fullscreen output, keystone, NDI/Spout/HIVE"
        >
          ⛶ Output
        </button>
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
          onClick={async () => {
            // Same silent save-before-leaving as Open — New must not lose the
            // current session's scenes.
            try {
              const st = useStore.getState()
              if (st.sessionPath) await window.api.sessionSave(st.exportSession(), st.sessionPath)
              else await window.api.sessionSaveToDefault(st.exportSession())
            } catch {
              /* best-effort */
            }
            useStore.getState().newSession()
          }}
          title="New blank session (undoable; the current session is saved first)"
        >
          New
        </button>
        <button className="btn text-[12px]" onClick={openSession}>
          Open
        </button>
        <button
          ref={saveBtnRef}
          className="btn text-[12px]"
          onClick={saveSession}
          title="Save — overwrites the current file (Save As the first time)"
        >
          Save
        </button>
        <button
          className="btn text-[12px]"
          onClick={() => void saveSessionAs()}
          title="Save As — choose a new file"
        >
          Save As
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
              // Subtle scanline signature over the preview (brief §10). Below 1×
              // the low-res backing store upscales with crisp pixels (lo-fi look).
              style={{
                backgroundImage:
                  'repeating-linear-gradient(0deg, rgb(255 255 255 / 0.015) 0 1px, transparent 1px 3px)',
                imageRendering: renderScale < 1 ? 'pixelated' : 'auto'
              }}
            />
            {/* FPS bottom-right, mirroring the resolution tag bottom-left. */}
            <FpsTag />
            <div className="pointer-events-none absolute bottom-2 left-2 font-mono text-[10px] text-muted/70">
              output · {Math.round(1920 * renderScale)}×{Math.round(1080 * renderScale)}
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

        {/* Right column — three switchable views: Layers strips, the compact
            Mixer (M key), or the Finishing Touches finalizers stack. */}
        <aside
          className="flex shrink-0 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-0.5"
          style={{ width: layersWidth }}
        >
          <RightViewTabs />
          {rightView === 'mixer' ? (
            <MixerPanel />
          ) : rightView === 'finishing' ? (
            <FinishingTouches />
          ) : (
            <>
              {[0, 1, 2, 3].map((i) => (
                <LayerPanel key={i} index={i} />
              ))}
              {/* Background slab — pinned last, matching the stack (renders
                  under everything). */}
              <BackgroundPanel />
            </>
          )}
        </aside>
      </main>

      {/* ── Modulation: 8-mod bank + capped matrix (brief §10.4) ── */}
      <ModulationPanel />

      {/* ── Meta Controller: 32 macro knobs / 4 banks (brief §6) ── */}
      <MetaBar />

      {/* ── Audio ingest — OSC (Pandore) + local Web Audio → audio bus ── */}
      <AudioPanel />

      {/* ── OSC input — just above the transport bar; the ON/OFF button IS
             the collapse (info shows only while listening) ── */}
      <OscPanel />

      {/* ── Transport (BPM + Randomize) ───────────────────────────── */}
      <Transport />

      {/* ── Output / Mapping page — full-screen takeover (canvas keeps
             rendering underneath so the live mirror + engine never stop) ── */}
      {outputPageOpen && <OutputPage canvasRef={canvasRef} />}
      {worldPageOpen && <WorldPage />}
      {sequencePageOpen && <SequencePage />}
    </div>
  )
}

// Live FPS over the preview's bottom-right corner — mirrors the resolution tag
// on the left, same font. Samples the render-loop meter on a light interval.
function FpsTag(): JSX.Element {
  const [fps, setFps] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => setFps(currentFps()), 400)
    return () => window.clearInterval(id)
  }, [])
  return (
    <div className="pointer-events-none absolute bottom-2 right-2 font-mono text-[10px] text-muted/70">
      {fps > 0 ? `${Math.round(fps)} fps` : '— fps'}
    </div>
  )
}

// Segmented switch at the top of the right column: Layers / Mixer / Finishing.
function RightViewTabs(): JSX.Element {
  const rightView = useStore((s) => s.rightView)
  const setRightView = useStore((s) => s.setRightView)
  const tabs: Array<{ id: 'layers' | 'mixer' | 'finishing'; label: string; title: string }> = [
    { id: 'layers', label: 'layers', title: 'The 4 layer strips' },
    { id: 'mixer', label: 'mixer', title: 'Compact opacity/speed/blend for all 4 layers (M)' },
    { id: 'finishing', label: 'finishing', title: 'Finishing Touches — Vibe Palette · Context · Finalizer' }
  ]
  return (
    <div className="flex shrink-0 gap-1">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => setRightView(t.id)}
          title={t.title}
          className={`rounded border px-2 py-0.5 font-mono text-[9px] transition-colors ${
            rightView === t.id
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border text-muted hover:text-accent'
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  )
}

function MasterRackStrip(): JSX.Element {
  const master = useStore((s) => s.composition.master)
  const applyMasterPreset = useStore((s) => s.applyMasterPreset)
  const randomizeMasterParams = useStore((s) => s.randomizeMasterParams)
  const toggleMasterChain = useStore((s) => s.toggleMasterChain)
  // The select keeps showing the applied chain's name.
  const [applied, setApplied] = useState('')
  const [flashing, flash] = useFlash()
  // Regular (user-added) FX wrap on the left; the three pinned finalizers
  // (Vibe / Context / Finalizer) stay clustered at the rightmost — clicking one
  // opens the Finishing view, not the shared Inspector.
  const rackFx = master.filter((f) => !f.locked)
  const lockedFx = master.filter((f) => f.locked)
  // The "chain" On/Off state — on when every user FX is enabled.
  const chainOn = rackFx.length > 0 && rackFx.every((f) => f.enabled)
  return (
    // Line 1: chain label · dice · preset box · + fx; the regular FX chips wrap.
    <div
      className={`flex min-w-0 flex-wrap items-center gap-1.5 rounded-md border bg-panel2/40 p-2 transition-colors ${
        flashing ? 'animate-pulse border-danger ring-1 ring-danger' : 'border-border'
      }`}
    >
      <button
        onClick={toggleMasterChain}
        disabled={rackFx.length === 0}
        className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide transition-colors disabled:opacity-40 ${
          chainOn
            ? 'border-accent bg-accent/15 text-accent'
            : 'border-border text-muted hover:text-text'
        }`}
        title={
          rackFx.length === 0
            ? 'No master FX to toggle'
            : chainOn
              ? 'Master FX chain ON — click to bypass all (keeps Finishing Touches)'
              : 'Master FX chain OFF — click to enable all'
        }
      >
        chain {chainOn ? 'on' : 'off'}
      </button>
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
        className="input select-compact w-32 shrink-0 text-[10px]"
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
      {/* Regular FX rack — wraps to more rows if the chain is deep */}
      <div className="ml-3 flex min-w-0 flex-1 items-center">
        <FxRackPanel scope={{ kind: 'master' }} fx={rackFx} label="" />
      </div>
      {/* Pinned finalizers — clustered at the rightmost, never wrapping apart.
          A global finishing on/off pill mirrors the one in the Finishing view. */}
      {lockedFx.length > 0 && (
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <FinishingToggle
            on={lockedFx.every((f) => f.enabled)}
            onClick={() => useStore.getState().toggleFinishing()}
          />
          <FxChips scope={{ kind: 'master' }} fx={lockedFx} nowrap />
        </div>
      )}
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
