// Palinopsia : the shell. Mounts the WebGL2 Compositor onto the output-preview
// canvas and runs the frame loop; hosts the four layer strips, the transport,
// and the theme picker. The heavy engine lives here in the renderer (brief §3);
// main is pure IO. Panels/regions follow brief §10 : this is the Phase-0
// skeleton: preview + layers + transport, ready for the ISF runtime (Phase 1),
// the FX racks (Phase 3), the auto-UI (Phase 4), and modulation (Phase 5).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AUDIO_TEX_GENS, Compositor } from './engine/Compositor'
import { hiveEncoder } from './hiveEncoder'
import { audioBus } from './engine/audioIn'
import { applyCoupling } from './engine/coupling'
import { applyProximity, applyFieldMacros } from './engine/field'
import { clearFrameVals } from './engine/frameVals'
import { applyTonicity, applyDrift, applyFlowInterrupt, shutterHold, shutterClear } from './engine/temperament'
import { applyFlicker } from './engine/flicker'
import { applyFrameWeave } from './engine/frameWeave'
import { pushMarkSignal } from './engine/markSignal'
import { applyMetaGlides, applyModulation, modEngine } from './engine/modulation'
import { visionBus } from './engine/visionIn'
import { depthEngine } from './engine/depthEstimate'
import { currentFps, tickFrame } from './perf'
import { videoSeekRequests } from './engine/videoState'
import { outputRecorder } from './recorder'
import { sonifyEngine } from './audio/sonify'
import { fireSelectedRandomize, registerPanic, firePanic, fireFreeze, isFrozen, registerRecordToggle } from './commands'
import { Toaster, showToast } from './components/Toast'
import { ShortcutHelp } from './components/ShortcutHelp'
import { onCaptureError } from './engine/CaptureSource'
import { collectAssembleSync, syncLiveMatchers } from './assemble/liveMatch'
import { GRID } from '@shared/assemble'
import { tickSequencer } from './engine/sequencer'
import { tickSonifySeq } from './audio/soniSeq'
import { Collapsible } from './components/Collapsible'
import { FxRackPanel, FxChips } from './components/FxRackPanel'
import { SearchSelect } from './components/SearchSelect'
import { FinishingTouches, FinishingToggle } from './components/FinishingTouches'
import { Inspector } from './components/Inspector'
import { LayerPanel } from './components/LayerPanel'
import { MixerPanel } from './components/MixerPanel'
import { FeelPanel } from './components/FeelPanel'
import { MetaBar } from './components/MetaBar'
import { MidiLearnOverlay } from './components/MidiLearnOverlay'
import { ModulationPanel } from './components/ModulationPanel'
import { OscPanel } from './components/OscPanel'
import { AudioPanel } from './components/AudioPanel'
import { MidiPanel } from './components/MidiPanel'
import { AssemblePanel } from './components/AssemblePanel'
import { BackgroundPanel } from './components/BackgroundPanel'
import { OutputPage } from './components/OutputPage'
import { SonifyPage } from './components/SonifyPage'
import { WorldPage } from './components/WorldPage'
import { SequencePage } from './components/SequencePage'
import { SceneBank } from './components/SceneBank'
import { SurfacePad, SurfaceOnToggle } from './components/SurfacePad'
import { initOscInput, applyOscListen, applyOscOutput, initOscQueryStream } from './oscInput'
import { morphedComposition, consumeCrossfade } from './morph'
import { surfaceComposition, nearestSurfaceScene, samplePath } from './surface'
import { useFlash } from './components/useFlash'
import { Transport } from './components/Transport'
import { SessionLoader, GenerateMenu } from './components/TopBarMenus'
import { ConfirmModal } from './components/PromptModal'
import type { AutosaveEntry } from '@shared/types'
import { initMidi } from './midi'
import { FX_SHADERS, GENERATORS, NATIVE_NODES, shaderSourceById } from './shaders/isf'
import { inputsForShader } from './shaders/isf/inputs'
import { MASTER_PRESETS } from './shaders/isf/masterPresets'
import { PRESETS_BY_ID } from './shaders/isf/presets'

// ── Vibe Palette (P / Shift+P) & Context (C / Shift+C) shortcuts ───────
// Cursors into each finalizer's preset list, kept at module scope so they
// survive re-renders and advance across Shift presses.
let vibePresetIndex = -1
let contextPresetIndex = -1
// Tracks the last-applied depth mode so the render loop only re-fills the depth
// map on a change (synth bowl / clear), rather than every frame.
let depthModePrev = ''
let lastDepthSample = 0 // throttles the depth-estimator frame readback (~11 Hz)
let lastVisionSample = 0 // throttles the vision-bus readback (~30 Hz)

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
import { metaGlides } from './metaSmooth'

// The global REC pill : visible in the top bar while a take is rolling, so you
// can leave the Output page and tweak live. Click ■ to stop + save the take.
// Stop the running take and confirm WHERE it saved. The Output page shows its
// own banner, but the common path — start there, return, stop from the REC pill
// or the keyboard — had no confirmation at all; this toast fills that gap.
function stopRecordingWithToast(): void {
  void outputRecorder.stop().then((path) => {
    if (path) showToast('Recording saved · ' + (path.split(/[\\/]/).pop() ?? path))
    else showToast('Recording stopped — the file may not have saved', 'warn')
  })
}

function RecPill(): JSX.Element | null {
  const recording = useStore((s) => s.recording)
  const since = useStore((s) => s.recordingSince)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!recording) return
    const id = window.setInterval(() => tick((t) => t + 1), 500)
    return () => window.clearInterval(id)
  }, [recording])
  if (!recording) return null
  const sec = Math.max(0, (performance.now() - since) / 1000)
  const mm = Math.floor(sec / 60)
  const ss = String(Math.floor(sec % 60)).padStart(2, '0')
  return (
    <button
      onClick={stopRecordingWithToast}
      className="flex shrink-0 items-center gap-1.5 rounded border border-red-500/60 bg-red-500/15 px-2 py-1 font-mono text-[11px] text-red-400 transition-colors hover:bg-red-500/30"
      title="Recording the output (keeps rolling while you tweak) : click to stop + save"
    >
      <span className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
      REC {mm}:{ss} ■
    </button>
  )
}


// fireSelectedRandomize lives in commands.ts now : the R shortcut, the
// Transport button and a learned MIDI pad all fire the same implementation.

export default function App(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const compositorRef = useRef<Compositor | null>(null)
  // Metasurface : last-nearest scene index, so a structure jump (a new nearest)
  // crossfades instead of snapping. -1 = surface inactive / nothing placed.
  const surfaceNearest = useRef(-1)
  // Draw sequencer playback state (loop-local, off the store to avoid per-frame
  // React churn). phase wraps in [0,∞); jump* hold a random-teleport target
  // between refreshes; lastStoreT throttles the pad-cursor visual write.
  const surfaceSeq = useRef({
    phase: 0,
    lastT: 0,
    jumpActive: false,
    jumpTarget: 0.5,
    lastJumpT: 0,
    lastStoreT: 0
  })
  // Cursor-motion tracking for the structure crossfade : previous position + time
  // (to derive speed) and the last fade's start (to rate-limit re-fires). Hysteresis
  // + speed-aware duration keep boundary crossings smooth and stop jump from
  // machine-gunning 250 ms fades.
  const surfaceMove = useRef({ x: 0.5, y: 0.5, t: 0, lastFadeT: 0 })
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const depthMode = useStore((s) => s.depthMode)
  const setDepthMode = useStore((s) => s.setDepthMode)
  // MIDI Learn + Flush moved up to the top bar (World moved down to the Transport).
  const midiLearnMode = useStore((s) => s.midiLearnMode)
  const setMidiLearnMode = useStore((s) => s.setMidiLearnMode)
  const [flushFlashing, flushFlash] = useFlash()
  // The keyboard cheat-sheet (`?`). A ref shadows the state so the mount-once
  // keydown handler can read "is it open?" for the Esc path without a stale closure.
  const [helpOpen, setHelpOpen] = useState(false)
  const helpOpenRef = useRef(false)
  useEffect(() => {
    helpOpenRef.current = helpOpen
  }, [helpOpen])
  const name = useStore((s) => s.name)
  const setName = useStore((s) => s.setName)
  const uiZoom = useStore((s) => s.uiZoom)
  const setUiZoom = useStore((s) => s.setUiZoom)
  const rightView = useStore((s) => s.rightView)
  // Layers-column width : draggable via the handle between preview and strips.
  const [layersWidth, setLayersWidth] = useState<number>(() => {
    const saved = Number(localStorage.getItem('opsia.layersWidth'))
    return Number.isFinite(saved) && saved >= 240 ? saved : 320
  })
  useEffect(() => {
    localStorage.setItem('opsia.layersWidth', String(layersWidth))
  }, [layersWidth])

  // Crash recovery : on launch, if the previous run didn't shut down cleanly and
  // a rotating autosave snapshot exists, offer to restore the most recent one.
  // (main writes a `.running` sentinel + a 60s snapshot; without this prompt the
  // recovered work sat unreachable in <userData>/autosave.)
  const [crashEntry, setCrashEntry] = useState<AutosaveEntry | null>(null)
  useEffect(() => {
    let cancelled = false
    void window.api
      .autosaveCrashCheck()
      .then((res) => {
        if (!cancelled && res?.crashed && res.entries.length > 0) setCrashEntry(res.entries[0])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // ── MIDI (Meta Controller CC learn + routing) ───────────────────────
  useEffect(() => {
    initMidi()
  }, [])

  // ── OSC input (Pandore plays the instrument) ────────────────────────
  useEffect(() => {
    const unsub = initOscInput()
    // Restore the saved listen state (starts the listener if it was on).
    void applyOscListen()
    // Restore outbound feedback (starts the diff-and-send loop if it was on).
    applyOscOutput()
    // Stream values to OSCQuery WS clients while any are attached.
    const unsubWs = initOscQueryStream()
    return () => {
      unsub()
      unsubWs()
    }
  }, [])

  // ── Output window : reset our flag if the user closes it directly ──────
  const outputActive = useStore((s) => s.outputActive)
  useEffect(() => {
    return window.api.onOutputClosed(() => useStore.getState().setOutputActive(false))
  }, [])

  // The zero-copy pixel port to the output window (see main's MessageChannelMain).
  const pixelPortRef = useRef<MessagePort | null>(null)
  // The long-edge cap for the streamed frame : the output window reports its
  // native drawing-buffer size back over the port, and we stream at exactly that
  // — never larger (a 4K readback is 32MB/frame and memory-bound; the projector
  // can't show more than its own pixels anyway) nor upscaled-soft (a 1080p stream
  // on a 1440p panel). 1920 is a safe default for the first frames before the
  // output has reported in.
  const outCapRef = useRef(1920)
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.data === 'opsia:pixelport' && e.ports[0]) {
        pixelPortRef.current = e.ports[0]
        pixelPortRef.current.onmessage = (m: MessageEvent): void => {
          const d = m.data as { type?: string; w?: number; h?: number }
          if (d && d.type === 'outsize' && d.w && d.h) outCapRef.current = Math.max(d.w, d.h)
        }
        pixelPortRef.current.start()
      }
    }
    window.addEventListener('message', onMsg)
    // Ask the preload to hand over the port (handshake — order-independent).
    window.postMessage('opsia:want-pixelport', '*')
    return () => window.removeEventListener('message', onMsg)
  }, [])

  // ── External output (NDI / Spout) : attach the readback while active ──
  const ndiActive = useStore((s) => s.ndiActive)
  const spoutActive = useStore((s) => s.spoutActive)
  const outputPageOpen = useStore((s) => s.outputPageOpen)
  const sonifyPageOpen = useStore((s) => s.sonifyPageOpen)
  const renderScale = useStore((s) => s.renderScale)
  const worldPageOpen = useStore((s) => s.worldPageOpen)
  const sequencePageOpen = useStore((s) => s.sequencePageOpen)
  useEffect(() => {
    const comp = compositorRef.current
    if (!comp) return
    const on = ndiActive || spoutActive
    comp.setOutputCapture(on ? (w, h, px) => window.api.ndiFrame(w, h, px) : null)
    return () => comp.setOutputCapture(null)
    // Handles live NDI/Spout toggles. Re-attachment across an engine REBUILD is
    // owned by the compositor-build effect instead : this effect is declared
    // earlier, so on a rebuild it runs first and just reads a null ref (harmless
    // no-op). `renderScale` stays a dep so this effect's cleanup runs on the LIVE
    // compositor before it's disposed (glEpoch is declared later, so the build
    // effect — which does see it — carries the GPU-reset case). (The output-window
    // STREAM is driven from the render loop, not here.)
  }, [ndiActive, spoutActive, renderScale])

  // ── HIVE output (sender) : start the HEVC encoder + TCP fan-out ───────
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
        // No WebCodecs HEVC encoder on this host : bail out and flip the toggle.
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

  // ── Audio ingest (Slab 1) : drive the audio bus from OSC + local input ─
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
      // Covers <input>, <textarea>, <select>, and any contentEditable region so
      // bare-letter shortcuts (p/c/m/o/… and 1–9) never eat a typed character.
      const el = e.target as HTMLElement | null
      const inField =
        el?.tagName === 'INPUT' ||
        el?.tagName === 'TEXTAREA' ||
        el?.tagName === 'SELECT' ||
        el?.isContentEditable === true
      // ? : the keyboard cheat-sheet (Shift+/ on most layouts). Toggles.
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !inField && e.key === '?') {
        e.preventDefault()
        setHelpOpen((o) => !o)
        return
      }
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
      // Bare 0: PANIC FLUSH — empty every self-feeding buffer (feedback + stateful
      // native nodes) so a runaway feedback / stuck mosh recovers without a reload.
      // (Ctrl+0 is the separate UI-zoom reset, handled in the modifier block.)
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !inField && e.key === '0') {
        e.preventDefault()
        firePanic()
        flushFlash() // match the top-bar Flush button's click feedback
        showToast('Panic flush — buffers emptied', 'warn')
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
      // S : the Sonify page (image-to-sound engine).
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !inField && e.key.toLowerCase() === 's') {
        e.preventDefault()
        const st = useStore.getState()
        st.setSonifyPageOpen(!st.sonifyPageOpen)
        return
      }
      // Bare letters: view / panel shortcuts (guarded against typing in fields).
      if (!e.ctrlKey && !e.metaKey && !e.altKey && !inField) {
        const k = e.key.toLowerCase()
        // L: toggle MIDI Learn from anywhere (any tab / full-page overlay), so
        // you can arm bindings without hunting for the top-bar button.
        if (k === 'l') {
          e.preventDefault()
          const st = useStore.getState()
          st.setMidiLearnMode(!st.midiLearnMode)
          return
        }
        // F: switch the right column to Finishing.
        if (k === 'f') {
          e.preventDefault()
          useStore.getState().setRightView('finishing')
          return
        }
        // G: switch the right column to Feel (the global macros).
        if (k === 'g') {
          e.preventDefault()
          useStore.getState().setRightView('feel')
          return
        }
        // E: show/hide the assemble (automatic editor) tab.
        if (k === 'e') {
          e.preventDefault()
          const st = useStore.getState()
          st.setRightView(st.rightView === 'assemble' ? 'layers' : 'assemble')
          return
        }
        // A: show/hide the osc/audio/midi setup tab.
        if (k === 'a') {
          e.preventDefault()
          const st = useStore.getState()
          st.setRightView(st.rightView === 'io' ? 'layers' : 'io')
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
        // H: freeze / hold the output (the same latch as the Transport ❄).
        if (k === 'h') {
          e.preventDefault()
          fireFreeze()
          return
        }
      }
      // Esc: close the cheat-sheet first if it's up (it sits above everything).
      if (e.key === 'Escape' && helpOpenRef.current) {
        e.preventDefault()
        setHelpOpen(false)
        return
      }
      // Esc: leave MIDI Learn mode first — it sits over every other surface.
      if (e.key === 'Escape' && useStore.getState().midiLearnMode) {
        e.preventDefault()
        useStore.getState().setMidiLearnMode(false)
        return
      }
      // Esc: close the VISUALLY topmost full-page overlay first — but NOT while a
      // text field is focused, so Escape cancels the field edit (World JSON, a
      // number input) instead of closing the page and discarding it. The overlays
      // render output → sonify → world → sequence, so sequence paints on top;
      // close them in that reverse (topmost-first) order.
      if (e.key === 'Escape' && !inField) {
        const st = useStore.getState()
        if (st.sequencePageOpen) {
          e.preventDefault()
          st.setSequencePageOpen(false)
          return
        }
        if (st.worldPageOpen) {
          e.preventDefault()
          st.setWorldPageOpen(false)
          return
        }
        if (st.sonifyPageOpen) {
          e.preventDefault()
          st.setSonifyPageOpen(false)
          return
        }
        if (st.outputPageOpen) {
          e.preventDefault()
          st.setOutputPageOpen(false)
          return
        }
      }
      if (!(e.ctrlKey || e.metaKey)) return
      // Undo/redo apply to the app composition — but NOT while a text field is
      // focused, so Ctrl+Z there undoes the keystroke (native) instead of
      // reverting the last composition edit while the typo stays.
      if (!inField && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        if (e.shiftKey) redo()
        else undo()
      } else if (!inField && e.key === 'y') {
        e.preventDefault()
        redo()
      } else if (e.key === 's' || e.key === 'S') {
        // Save the session in place (Save As the first time). Global : Ctrl/Cmd+S
        // is universally "save", so it fires even while an input is focused.
        e.preventDefault()
        void saveSession()
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

  // Bumped when the GPU comes back after a driver reset : re-keys the engine
  // effect below, which rebuilds the Compositor on the restored context.
  const [glEpoch, setGlEpoch] = useState(0)

  // ── Engine: mount the Compositor + run the frame loop ───────────────
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    // GPU-loss recovery. A driver reset (Windows TDR — heavy sessions on two
    // displays can provoke it) kills EVERY WebGL context in the process : the
    // preview turns into Chromium's white failure surface and, without these
    // handlers, stays dead until the app restarts — loading another session
    // can't help because the dead context is the Compositor's, not the store's.
    // preventDefault() on `lost` is what tells the browser we want `restored`;
    // on `restored` we bump the epoch and this whole effect re-runs on a live
    // context. Engine-side buffers (feedback trails, Context) reset — after a
    // GPU crash that is the acceptable cost of coming back at all.
    let restoreFallback: number | null = null
    const onLost = (e: Event): void => {
      e.preventDefault()
      console.warn('[gl] context LOST (GPU reset) — awaiting restore')
      // If `restored` never fires (repeated crashes can blocklist the GPU),
      // force one rebuild attempt anyway : either the context is quietly back,
      // or the Compositor constructor throws and the existing catch surfaces
      // the WebGL-unavailable message instead of a silent white canvas.
      restoreFallback = window.setTimeout(() => setGlEpoch((n) => n + 1), 6000)
    }
    const onRestored = (): void => {
      console.warn('[gl] context restored — rebuilding the engine')
      if (restoreFallback) window.clearTimeout(restoreFallback)
      setGlEpoch((n) => n + 1)
    }
    canvas.addEventListener('webglcontextlost', onLost)
    canvas.addEventListener('webglcontextrestored', onRestored)
    const offGl = (): void => {
      if (restoreFallback) window.clearTimeout(restoreFallback)
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
    }
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
      // Re-attach the external-output (NDI/Spout) readback to the freshly built
      // compositor. The separate toggle effect is declared earlier, so on a
      // rebuild (renderScale change or glEpoch GPU-reset) it runs BEFORE this and
      // reads a null ref — leaving the sender black until toggled. Restoring it
      // here, from the live store state, keeps NDI/Spout output alive across any
      // engine rebuild.
      {
        const st = useStore.getState()
        comp.setOutputCapture(
          st.ndiActive || st.spoutActive ? (w, h, px) => window.api.ndiFrame(w, h, px) : null
        )
      }
      // The fresh compositor's depth map is empty : force the depth mode to
      // re-apply next frame (else module-level depthModePrev still equals the
      // active mode and synth-depth Parallax silently goes flat after a rebuild).
      depthModePrev = ''
      // The `0` key + the Transport's flush button both fire panic through here.
      registerPanic(() => compositorRef.current?.panic())
      // MIDI record toggle : start a fast (no-reencode) take or stop the running
      // one — the canvas + recorder live here, not in the store.
      registerRecordToggle(() => {
        if (useStore.getState().recording) stopRecordingWithToast()
        else if (canvasRef.current)
          void outputRecorder.start(canvasRef.current, 'source').then((ok) => {
            showToast(ok ? 'Recording started' : 'Recording could not start', ok ? 'ok' : 'warn')
          })
      })
      // A live-capture slot that fails to start (denied permission, no device,
      // cancelled screen picker) used to render a silent black source. Surface why.
      onCaptureError((spec, errName) => {
        const src = spec.startsWith('device:')
          ? 'Live input'
          : spec === 'screen' || spec.startsWith('desktop:')
            ? 'Screen capture'
            : 'Webcam'
        const reason =
          errName === 'NotAllowedError'
            ? 'permission denied'
            : errName === 'NotFoundError' || errName === 'OverconstrainedError'
              ? 'no matching device found'
              : errName === 'NotReadableError'
                ? 'device busy / already in use'
                : errName === 'AbortError'
                  ? 'cancelled'
                  : errName
        showToast(`${src} couldn’t start — ${reason}`, 'warn', 5000)
      })
    } catch (e) {
      // WebGL2 unavailable : surface it rather than a blank canvas.
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
    // Shader warm-up queue : every registry shader + native node, compiled ONE
    // per frame in the background (starting a beat after launch) and discarded.
    // Chromium's GPU program cache (memory + disk) keeps the results, so a
    // Randomize-All burst of ~20 loads hits the cache instead of stalling the
    // driver for seconds. Dedup because BG sources overlap the generators.
    // Native GENERATORS (Text / Parametric) are header-only ISF — no GLSL body
    // to compile — so warming them just spams GL errors. Native NODES compile
    // via their own constructors and stay in.
    const prewarmQueue = [
      ...new Set(
        [...GENERATORS.filter((g) => !g.native), ...FX_SHADERS, ...NATIVE_NODES].map((s) => s.id)
      )
    ]
    const loop = (): void => {
      // The whole body is guarded: a shader that throws at load or draw time
      // must never kill the loop (that's a permanent freeze). Lose one frame,
      // keep scheduling : the offending layer simply doesn't render.
      try {
        const now = performance.now()
        const st = useStore.getState()
        // A morph just began → dissolve the frozen old frame into the new scene.
        const xfadeMs = consumeCrossfade()
        if (xfadeMs) comp!.beginCrossfade(xfadeMs)
        // Metasurface : when active, the engine renders a live Gaussian blend of the
        // placed scenes at the cursor (structure snaps to the nearest, numeric params
        // ease across the scenes that share it). A new nearest = a structure jump, so
        // dissolve it. Otherwise the Morph path (scene recall / Randomize easing).
        let c
        const surf = st.surface
        // Draw sequencer : when playing a recorded path, advance a phase in real
        // time and drive the cursor along the drawing (dataFLOU's Gesture model,
        // retargeted to the surface). way maps phase→playhead; jump% overlays
        // random teleports (a held sample-and-hold jitter). The blend still reads
        // sx/sy below, so playback and hand-dragging share one code path.
        let sx = surf.x
        let sy = surf.y
        if (surf.active && surf.play && surf.path.length >= 2) {
          const seq = surfaceSeq.current
          const dt = seq.lastT ? Math.min(200, now - seq.lastT) : 0
          seq.lastT = now
          seq.phase += dt / Math.max(100, surf.timeMs)
          const pf = seq.phase - Math.floor(seq.phase)
          let base = pf
          if (surf.way === 'backward') base = 1 - pf
          else if (surf.way === 'pingpong') base = 1 - Math.abs(2 * pf - 1)
          // jump : refresh a held random target on an interval that tightens as
          // jump grows; each refresh has `jumpAmt` odds of teleporting (else it
          // rejoins the smooth path). 0 % = clean traversal, 100 % = near-chaos.
          const jumpAmt = Math.max(0, Math.min(1, surf.jump / 100))
          let ph = base
          if (jumpAmt > 0) {
            const holdMs = 60 + (1 - jumpAmt) * 340
            if (now - seq.lastJumpT >= holdMs) {
              seq.lastJumpT = now
              seq.jumpActive = Math.random() < jumpAmt
              if (seq.jumpActive) seq.jumpTarget = Math.random()
            }
          }
          if (jumpAmt > 0 && seq.jumpActive) {
            // A discrete teleport overrides the smooth position for this hold window.
            ph = seq.jumpTarget
          } else if (surf.wiggle > 0) {
            // Smooth sinusoidal wobble around the traced position (a vibrato). ~0.8 Hz
            // so it reads as a shimmer regardless of loop length; amplitude by %.
            const span = (surf.wiggle / 100) * 0.12
            ph = base + Math.sin((now / 1000) * 0.8 * Math.PI * 2) * span
            ph = ((ph % 1) + 1) % 1
          }
          const s = samplePath(surf.path, ph, surf.closed)
          sx = s.x
          sy = s.y
          // Throttle the store write (pad-cursor visual) to ~25 Hz — the blend
          // itself runs off sx/sy every frame regardless.
          if (now - seq.lastStoreT >= 40) {
            seq.lastStoreT = now
            st.setSurfaceXY(sx, sy)
          }
        } else {
          surfaceSeq.current.lastT = 0
        }
        const placed = surf.active ? st.scenes.filter((s) => s.surface) : []
        if (surf.active && placed.length >= 2) {
          const ni = nearestSurfaceScene(placed, sx, sy)
          const mv = surfaceMove.current
          let cur = surfaceNearest.current
          // Hysteresis : hold the current structure until a NEW nearest is clearly
          // closer (a dead-band around the Voronoi seam), so tiny wobbles / sitting on
          // an edge / a jump landing barely across don't flip-flop the shaders. The
          // held index drives BOTH the base structure (below) and the crossfade, so
          // they always agree — the structure never pops without its dissolve.
          let commit = cur === -1 || cur >= placed.length
          if (!commit && ni !== cur) {
            const pn = placed[ni].surface ?? { x: 0.5, y: 0.5 }
            const pc = placed[cur].surface ?? { x: 0.5, y: 0.5 }
            const dn = Math.hypot(pn.x - sx, pn.y - sy)
            const dc = Math.hypot(pc.x - sx, pc.y - sy)
            if (dn < dc - 0.04) commit = true // 4 % dead-band
          }
          if (commit && ni !== cur) {
            // Speed-aware fade : a slow drag across a seam wants a long dissolve to hide
            // the shader swap; a fast sweep wants a short one. And never restart a fade
            // that's still running (rate-limit) — that's what made jump smear.
            const dtm = mv.t ? Math.max(1, now - mv.t) : 16
            const speed = Math.hypot(sx - mv.x, sy - mv.y) / dtm // units/ms
            const fadeMs = Math.round(Math.max(90, Math.min(420, 420 - speed * 12000)))
            if (cur !== -1 && now - mv.lastFadeT >= fadeMs * 0.6) {
              comp!.beginCrossfade(fadeMs)
              mv.lastFadeT = now
            }
            cur = ni
            surfaceNearest.current = ni
          }
          mv.x = sx
          mv.y = sy
          mv.t = now
          c = surfaceComposition(st.scenes, sx, sy, cur)!
        } else {
          surfaceNearest.current = -1
          surfaceMove.current.t = 0
          c = morphedComposition(now, st.composition)
        }
        // 1. Store → engine reconciliation (base values). One write path for
        //    everything: UI edits, session loads, OSC : the engine follows.
        //    Shader hot-swaps preserve feedback buffers (brief §1).
        comp!.setGlobalSpeed(st.globalSpeed)
        comp!.setWarp(st.warpEnabled ? st.warpCorners : null, st.warpGrid)
        comp!.setStrobeSafe(st.strobeSafe)
        comp!.syncFromState(c, shaderSourceById)
        // 1b. Assemble : hand any target-driven edit its matcher, so its next
        //     cut is chosen from the corpus by what the output looks like now.
        //     Cheap : a no-op unless the assemblage on a slot actually changed.
        syncLiveMatchers(comp!)
        // 2. Modulation: refresh the audio bus (OSC/local features), then tick
        //    the 8-slot engine and overlay the mod-matrix on top of the base
        //    values : straight into the Compositor, never through React.
        audioBus.tick(now)
        const modValues = modEngine.tick(now, c.modulators, c.bpm)
        applyModulation(comp!, c, modValues, inputsForShader, st.modBypass)
        // 2a½. Meta-knob glides/drags : in-flight positions fan out to their
        //      destinations engine-side (zero store writes per frame; the
        //      final value commits to the store on settle).
        if (metaGlides.size) applyMetaGlides(comp!, c, inputsForShader, metaGlides)
        // 2a¾. One-shot video seeks (OSC /video/position) : drained into the
        //      same consumed-per-frame seam the playhead modulators use, and
        //      kept for the output-window payload so the mirror seeks too.
        let videoSeeks: Array<[string, number]> | undefined
        if (videoSeekRequests.size) {
          videoSeeks = Array.from(videoSeekRequests)
          videoSeekRequests.clear()
          for (const [k, v] of videoSeeks) {
            const ci = k.indexOf(':')
            const li = Number(k.slice(0, ci))
            comp!.layers[li]?.setVideoInput(k.slice(ci + 1) === 'B' ? 'B' : 'A', 'position', v)
          }
        }
        // 2b. Coupling: audio binds each layer's A/B balance (post-sync so it
        //     overrides the base mix); returns the coupled mixes for the output.
        const coupledMix = applyCoupling(comp!, c, now)
        // 2c. Proximity (Field macro): push the Context mood into a depth zone.
        //     From here on the passes share the per-frame write bus (frameVals) so
        //     co-engaged macros stack on the same param instead of clobbering.
        clearFrameVals()
        const contextProx = applyProximity(comp!, c, st.proximity, st.proximityAudio ? 0.6 : 0)
        // 2d. Macro-form sequencer: auto-advance scenes + Breathe/Arc overlay.
        //     The overlay writes master-FX values, layer mixes and freeze straight
        //     onto the compositor — none of which is otherwise in the payload, so
        //     the output window desyncs whenever a sequence is running. Capture the
        //     master-FX writes through a recording proxy (merged into
        //     masterOverrides below) and the freeze; the final layer mixes are read
        //     back afterwards so cadence's mix pull travels too.
        const seqOverrides: Record<string, Record<string, number>> = {}
        let seqFreeze: boolean | null = null
        let seqTouchedMix = false
        if (st.sequence.enabled) {
          const beforeMix = comp!.layers.map((L) => (L ? L.sourceMix : 0))
          const rec = {
            setFxInput: (
              scope: { kind: 'master' },
              id: string,
              name: string,
              v: number
            ): void => {
              comp!.setFxInput(scope, id, name, v)
              ;(seqOverrides[id] ||= {})[name] = v
            },
            layers: comp!.layers,
            setFreeze: (on: boolean): void => {
              comp!.setFreeze(on)
              seqFreeze = on
            }
          }
          tickSequencer(now, rec, c)
          seqTouchedMix = comp!.layers.some((L, i) => L && L.sourceMix !== beforeMix[i])
        }
        // Sonify step sequencer : evolves the sound over time (independent of the
        // scene sequencer above). No-op unless the user started it on the S mixer.
        tickSonifySeq(now)
        // 2e. Field macros: Density / Gesture⇄Texture / Coalesce (post-mod, 0.5 deadzone).
        applyFieldMacros(comp!, c, st.density, st.gestureTexture, st.coalesce)
        // 2f. Temperament: Tonicity (tonal audio → colour) + Drift
        //     (analog-instability wander). Shutter (stop-motion stepping) freezes
        //     the output on held frames.
        const tonOv = applyTonicity(comp!, c, st.tonicity)
        const driftOv = applyDrift(comp!, c, st.drift, now)
        // Flow ↔ Interruption : smooth/liquid ↔ stutter/decimate/blank. Its freeze
        // ORs into the shutter path; its finishing overrides merge below.
        const flowRes = applyFlowInterrupt(comp!, c, st.flow, now)
        const flowActive = Math.abs(st.flow - 0.5) > 0.02
        let freeze = false
        if (st.shutter > 0.02) freeze = shutterHold(now, st.shutter)
        else if (seqFreeze !== null) freeze = seqFreeze // sequencer mono-freeze
        else shutterClear()
        freeze = freeze || (flowActive && flowRes.freeze) || isFrozen() // MIDI hold latch
        comp!.setFreeze(freeze)
        // 2g. Superimposition flicker (§5.2): cross-cut which layer shows on the
        //     drawn cadence : rate follows the Cameraless film rate when it's on.
        let flickerHot = -1
        if (st.superFlicker > 0.02) {
          const fin = c.master.find((f) => f.shaderId === 'fx-finalizer')?.inputs
          const filmOn = fin && Math.round(Number(fin.filmHold) || 0) > 0
          const rateFps = filmOn ? Number(fin!.filmRate) || 8 : 8
          flickerHot = applyFlicker(comp!, st.superFlicker, rateFps, now)
        }
        // 2h. Frame-Weave (Lowder) : temporal interlace — show ONE layer per frame
        //     stepping through the lattice. Runs whenever enabled (independent of
        //     the scene sequencer). Hard-mutes the non-chosen layers this frame.
        let weaveHot: number | undefined
        if (st.sequence.frameWeave?.enabled) weaveHot = applyFrameWeave(comp!, st.sequence.frameWeave, now)
        // Merge the temperament results (Tonicity + Drift) into one override map so
        // the output window can mirror them exactly (they can't re-derive audio/
        // random/time). Field macros + freeze + flicker travel alongside.
        // Sequencer overlay first, then temperament on top : the same order the
        // monitor applied them, so shared inputs resolve identically.
        const masterOverrides: Record<string, Record<string, number>> = {}
        for (const ov of [seqOverrides, tonOv, driftOv, flowRes.overrides]) {
          if (!ov) continue
          for (const id in ov) masterOverrides[id] = { ...masterOverrides[id], ...ov[id] }
        }
        // Cadence pulls the layer mixes toward fused; send the post-sequencer mixes
        // so the output mirrors that too (else only the pre-sequencer coupling shows).
        const outMix = seqTouchedMix ? comp!.layers.map((L) => (L ? L.sourceMix : 0.5)) : coupledMix
        // 3. Render the frame.
        comp!.render(now - start)
        // 3a. Output window : stream the just-rendered frame to it (identical
        //     mirror). Synchronous readback in lockstep with render — every
        //     frame reaches the projector, unlike the async NDI path.
        if (st.outputActive && pixelPortRef.current) {
          const fr = comp!.captureFrameSync(outCapRef.current)
          if (fr) {
            const buf = fr.px.slice(0, fr.w * fr.h * 4).buffer
            pixelPortRef.current.postMessage({ w: fr.w, h: fr.h, buf }, [buf])
          }
        }
        // 3b. Animated sound (§4.4): sample a scanline of the presented frame and
        //     send it to Pandore over OSC (the drawn optical track).
        if (st.markSignalEnabled) pushMarkSignal(comp!, now)
        // 3c. Return path (image → control): reduce the presented frame to vision
        //     features that drive `vision` modulators next frame + stream out over
        //     OSC. Gated to when something actually reads them (a vision modulator
        //     or outbound feedback), so the tiny readback is skipped otherwise.
        //     Throttled to ~30Hz : a sync readPixels (even 4KB) flushes the GPU
        //     pipeline, and the vision features don't need frame-rate freshness.
        //     Assemble's target-driven mode reads the SAME bus, so it has to be
        //     in this gate too : without it the matcher saw an all-defaults bus
        //     forever and "follow the live output" silently did nothing unless
        //     some unrelated vision modulator happened to be switched on.
        const assembleLive =
          st.assembleParams.mode === 'live' &&
          c.layers.some((l) => l.sourceA.kind === 'assemble' || l.sourceB?.kind === 'assemble')
        if (
          now - lastVisionSample > 33 &&
          (st.oscOutEnabled ||
            assembleLive ||
            c.modulators.some((m) => m.enabled && (m.type === 'vision' || m.type === 'homeostat')))
        ) {
          lastVisionSample = now
          // Assemble measures its corpus on a GRID² raster, so when it's driving
          // we sample at the same resolution — the scale-dependent axes (edges,
          // texture, grain) only compare meaningfully at a matched raster.
          const vs = comp!.visionSample(assembleLive ? GRID : 32)
          if (vs) visionBus.ingest(vs.grid, vs.size)
        }
        // 3d. Depth (2.5D) : keep the shared depth map current. Off = flat (Parallax
        //     passthrough); synth = a test bowl; estimate = the monocular model,
        //     fed a low-res frame, run async, its result EMA-smoothed into the map.
        if (st.depthMode !== depthModePrev) {
          depthModePrev = st.depthMode
          if (st.depthMode === 'synth') {
            comp!.setSyntheticDepth()
            // The synthetic bowl is static, so feed its mean + spread to the
            // vision bus once (matching the mean / sqrt(var)·3 the estimate path
            // reports) instead of leaving depth/depthSpread modulators pinned at
            // the 0.5 / 0 init default.
            visionBus.setDepth(0.3444, 0.7125)
          } else if (st.depthMode === 'off') {
            comp!.clearDepth()
            visionBus.setDepth(0.5, 0) // flat : no depth signal
          }
        }
        if (st.depthMode === 'estimate') {
          // Throttle the frame readback to the estimator's cadence (~11 Hz) so we
          // don't stall the pipeline with a 256² readback every frame.
          if (now - lastDepthSample > 85) {
            lastDepthSample = now
            const df = comp!.depthFrame(256)
            if (df) depthEngine.update(df.data, df.w, df.h, now)
          }
          const dr = depthEngine.take()
          if (dr) {
            comp!.setDepth(dr.data, dr.w, dr.h, 0.35)
            // Depth → Vision bus : the image's SPACE as control (mean depth + the
            // near↔far spread), drivable into modulators + streamed over OSC.
            let s = 0
            for (let i = 0; i < dr.data.length; i++) s += dr.data[i]
            const mean = s / dr.data.length
            let v = 0
            for (let i = 0; i < dr.data.length; i++) { const e = dr.data[i] - mean; v += e * e }
            visionBus.setDepth(mean, Math.min(1, Math.sqrt(v / dr.data.length) * 3))
          }
        }
        // 4. Native output window: push the exact render state so it renders
        //    the same composition itself (pixel-perfect, no transcode).
        if (st.outputActive) {
          window.api.outputFrame({
            c,
            modValues,
            modBypass: st.modBypass,
            globalSpeed: st.globalSpeed,
            warpEnabled: st.warpEnabled,
            warpCorners: st.warpCorners,
            warpGrid: st.warpGrid,
            time: now - start,
            coupledMix: outMix,
            contextProx,
            // Bottom-bar state → exact replica in the output window.
            density: st.density,
            gestureTexture: st.gestureTexture,
            coalesce: st.coalesce,
            masterOverrides,
            freeze,
            superFlicker: st.superFlicker,
            flickerHot,
            weaveHot,
            strobeSafe: st.strobeSafe,
            // In-flight Meta-knob gestures : the mirror re-applies the same
            // engine-side fan-out (the store only updates on settle).
            metaGlides: metaGlides.size ? Array.from(metaGlides) : undefined,
            // One-shot video seeks : the mirror's own decoders seek too.
            videoSeeks,
            // Assemble : the mirror walks its own copy of the edit, so hand it
            // our position (it snaps only when it has actually drifted) and any
            // clip a live matcher just chose (it has no vision bus of its own).
            assemble: collectAssembleSync(comp!),
            // Per-element audio rows, only when some layer's generator reads them.
            audioRows: c.layers.some(
              (l) =>
                (l.sourceA.shaderId && AUDIO_TEX_GENS.has(l.sourceA.shaderId)) ||
                (l.sourceB?.shaderId && AUDIO_TEX_GENS.has(l.sourceB.shaderId))
            )
              ? {
                  wave: Array.from(audioBus.waveformBytes() ?? []),
                  spec: Array.from(audioBus.spectrumBytes() ?? [])
                }
              : undefined
          })
        }
        // 5. HIVE output: encode the composite canvas to HEVC and fan it out to
        //    HIVE receivers (an OBS plugin, …). Frame-drops if backed up.
        if (st.hiveOutActive) hiveEncoder.encode(canvas, now * 1000)
        // 5b. Sonify : ship the image taps to the audio engine (~30Hz; no-op
        //     while the sound engine is off).
        sonifyEngine.tick(comp!, now, c.bpm)
        // 6. Shader warm-up : one registry compile per frame, in the background,
        //    after launch settles. First-ever run pays the compiles here (a few
        //    seconds of background work); afterwards the GPU disk cache makes
        //    both this warm-up AND every Randomize burst near-instant.
        if (prewarmQueue.length && now - start > 1200) {
          const id = prewarmQueue.pop()!
          comp!.prewarmShader(id, shaderSourceById(id))
          if (!prewarmQueue.length) console.info('[prewarm] shader registry warm')
        }
        tickFrame(now) // feed the Output HUD's FPS meter
      } catch (e) {
        console.error('[render loop]', e)
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => {
      offGl()
      onCaptureError(null)
      cancelAnimationFrame(raf)
      // After a GPU reset the old context is dead : dispose would only spray
      // INVALID_OPERATION noise into the console on its way out.
      try {
        comp?.dispose() // free all GL resources so a remount can't orphan them
      } catch {
        /* context already gone */
      }
      compositorRef.current = null
    }
    // Recreate the whole engine when the render resolution changes — or when
    // the GPU comes back from a driver reset (glEpoch).
  }, [renderScale, glEpoch])

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
    // Serializing the whole session (every scene's composition, collage pools,
    // EDLs) on EVERY store write floods the IPC boundary — 25 Hz during surface
    // playback, one write per pointermove on a slider drag — though main only
    // writes the autosave to disk every 60s. Coalesce to a trailing push at most
    // ~once/second : crash recovery then loses at most the last second of work.
    let timer: ReturnType<typeof setTimeout> | null = null
    const push = (): void => {
      void window.api.setCurrentSession(useStore.getState().exportSession())
    }
    const schedule = (): void => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        push()
      }, 1000)
    }
    push() // seed main with the current session immediately
    const unsub = useStore.subscribe(schedule)
    return () => {
      unsub()
      if (timer) clearTimeout(timer)
    }
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
        /* best-effort : never block the open */
      }
      // Guard the load : loadSession is defensive, but a corrupt/foreign file
      // that slips past validation must not throw here and leave a half-applied
      // state (the current session is already saved above).
      try {
        useStore.getState().loadSession(res.session)
        useStore.getState().setSessionPath(res.path) // Save now overwrites this file
      } catch (e) {
        console.error('[session] load failed:', (e as Error).message)
      }
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

  // Save As : always prompts; remembers the chosen path for later plain Saves.
  async function saveSessionAs(): Promise<boolean> {
    const path = await window.api.sessionSaveAs(useStore.getState().exportSession())
    if (path) useStore.getState().setSessionPath(path)
    return path != null
  }

  // Save : overwrites the current file in place (no dialog). Falls back to Save
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
      <header className="flex items-center gap-3 border-b border-border bg-panel px-4 py-2 pr-6">
        <h1
          className="select-none font-mono text-[15px] font-semibold uppercase tracking-[0.2em]"
          // Restrained glitch signature on the title : a faint chromatic
          // aberration, never spectacle (brief §10).
          style={{ textShadow: '0.5px 0 rgb(var(--c-accent) / 0.5), -0.5px 0 rgb(var(--c-accent2) / 0.5)' }}
        >
          Palinopsia
        </h1>
        <input
          className="input w-28 text-[12px]"
          value={name}
          onChange={(e) => setName(e.target.value)}
          title="Session name"
        />
        <SessionLoader />
        <GenerateMenu />
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
        {/* MIDI Learn : moved up from the Transport (World moved down there).
            Blue while active — the app's MIDI-learn colour. */}
        <button
          onClick={() => setMidiLearnMode(!midiLearnMode)}
          className="btn text-[12px]"
          style={
            midiLearnMode
              ? { background: 'rgba(90, 150, 255, 0.6)', color: '#fff', borderColor: 'rgba(90, 150, 255, 1)' }
              : undefined
          }
          title={
            midiLearnMode
              ? 'MIDI Learn ON — click a highlighted control, then move a knob / hit a pad to bind it. Right-click a green one to clear. Click here (or press L / Esc) to exit.'
              : 'Enter MIDI Learn mode (shortcut : L, from any tab) : map hardware knobs and pads to Meta knobs, transport controls, Vary / Randomize / Sonify and scenes.'
          }
        >
          MIDI Learn
        </button>
        <RecPill />
        <UndoButtons />
        <div className="flex items-center gap-0.5" title="UI zoom : Ctrl+= / Ctrl+- / Ctrl+0">
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
            // Same silent save-before-leaving as Open : New must not lose the
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
          title="Save (Ctrl+S) : overwrites the current file (Save As the first time)"
        >
          Save
        </button>
        <button
          className="btn text-[12px]"
          onClick={() => void saveSessionAs()}
          title="Save As : choose a new file"
        >
          Save As
        </button>
        <select
          className="input select-compact w-24 shrink-0 text-[11px]"
          style={{ paddingLeft: 6 }}
          value={depthMode}
          onChange={(e) => setDepthMode(e.target.value as 'off' | 'synth' | 'estimate')}
          title="Depth engine (2.5D) : fills the depth map the Parallax FX reads. off = flat (passthrough) · synth = a test depth bowl · AI = monocular depth estimation (downloads a small model on first use; needs network + WebGPU)."
        >
          <option value="off">depth: off</option>
          <option value="synth">depth: synth</option>
          <option value="estimate">depth: AI</option>
        </select>
        {/* Theme : sizes to its widest entry (no fixed width). */}
        <select
          className="input select-compact shrink-0 text-[12px]"
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
        {/* Panic flush : moved up from the Transport, sits at the far right. */}
        <span className="relative flex shrink-0">
          <MidiLearnOverlay id="fire:flush" />
          <button
            onClick={() => {
              firePanic()
              flushFlash()
            }}
            className={`btn text-[12px] ${flushFlashing ? '!border-danger !text-danger' : ''}`}
            title="Panic flush (0) : empty every self-feeding buffer — feedback, and the datamosh / sediment / corrode / scanner / echo accumulators — so a runaway image recovers WITHOUT a reload. Parameters, modulators and the clock stay put."
          >
            ⚡ Flush
          </button>
        </span>
      </header>

      {/* ── Body: preview + layer strips ────────────────────────── */}
      <main className="flex min-h-0 flex-1 gap-2 overflow-hidden p-3">
        {/* Output preview : the live composite, front and centre (brief §10.1) */}
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

          {/* Scene bank : recallable full-instrument states (brief §10.7) */}
          <Collapsible sectionKey="scenes" title="scenes">
            <SceneBank />
          </Collapsible>

          {/* Auto-generated control panel : the selection's ISF INPUTS
              rendered as themed controls (brief §10.3). */}
          <Collapsible sectionKey="inspector" title="inspector">
            <Inspector />
          </Collapsible>

          {/* Master FX rack : chips layout, zero blank space (brief §10.5);
              the warp/mapping stage joins it in Phase 8. */}
          <Collapsible sectionKey="master" title="master fx">
            <MasterRackStrip />
          </Collapsible>

        </section>

        {/* Drag handle : the layers column is resizable */}
        <LayerColumnHandle onResize={setLayersWidth} width={layersWidth} />

        {/* Right column : three switchable views: Layers strips, the compact
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
          ) : rightView === 'feel' ? (
            <FeelPanel />
          ) : rightView === 'assemble' ? (
            <AssemblePanel />
          ) : rightView === 'io' ? (
            // Setup lives out of the way : OSC + Audio + MIDI as collapsible
            // sections (A toggles this tab).
            <>
              <OscPanel />
              <AudioPanel />
              <MidiPanel />
            </>
          ) : (
            <>
              {[0, 1, 2, 3].map((i) => (
                <LayerPanel key={i} index={i} />
              ))}
              {/* Background slab : pinned last, matching the stack (renders
                  under everything). */}
              <BackgroundPanel />
              {/* Metasurface : the scene bank as a continuous 2D plane you play
                  by dragging (Bencina 2005). Collapsed by default. */}
              <Collapsible sectionKey="surface" title="surface" extra={<SurfaceOnToggle />}>
                <SurfacePad />
              </Collapsible>
            </>
          )}
        </aside>
      </main>

      {/* ── Modulation: 8-mod bank + capped matrix (brief §10.4) ── */}
      <ModulationPanel />

      {/* ── Meta Controller: 32 macro knobs / 4 banks (brief §6) ── */}
      <MetaBar />

      {/* Audio + OSC + MIDI setup lives in the right column's `osc/audio/midi`
          tab (A) : performance space stays for creation, setup out of the way. */}

      {/* ── Transport (BPM + Randomize) ───────────────────────────── */}
      <Transport />

      {/* ── Output / Mapping page : full-screen takeover (canvas keeps
             rendering underneath so the live mirror + engine never stop) ── */}
      {outputPageOpen && <OutputPage canvasRef={canvasRef} />}
      {sonifyPageOpen && <SonifyPage canvasRef={canvasRef} />}
      {worldPageOpen && <WorldPage />}
      {sequencePageOpen && <SequencePage canvasRef={canvasRef} />}

      {/* Crash recovery : offer to restore the last autosave after an unclean exit. */}
      {crashEntry && (
        <ConfirmModal
          title={`Palinopsia didn't close cleanly last time. Restore your last autosave${
            crashEntry.name ? ` — "${crashEntry.name}"` : ''
          }?`}
          yesLabel="Restore"
          noLabel="Discard"
          onYes={() => {
            const entry = crashEntry
            setCrashEntry(null)
            void (async () => {
              try {
                const session = await window.api.autosaveLoad(entry.path)
                useStore.getState().loadSession(session)
              } catch {
                /* best-effort : a corrupt snapshot just leaves the fresh boot in place */
              }
            })()
          }}
          onNo={() => setCrashEntry(null)}
        />
      )}
      {helpOpen && <ShortcutHelp onClose={() => setHelpOpen(false)} />}
      <Toaster />
    </div>
  )
}

// Live FPS over the preview's bottom-right corner : mirrors the resolution tag
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
  const tabs: Array<{
    id: 'layers' | 'mixer' | 'finishing' | 'feel' | 'io' | 'assemble'
    label: string
    title: string
  }> = [
    { id: 'layers', label: 'layers', title: 'The 4 layer strips' },
    { id: 'mixer', label: 'mixer', title: 'Compact opacity/speed/blend for all 4 layers (M)' },
    { id: 'finishing', label: 'finishing', title: 'Finishing Touches : Vibe Palette · Context · Finalizer' },
    { id: 'feel', label: 'feel', title: 'Feel : the global macros — Field + Temperament (G)' },
    {
      id: 'assemble',
      label: 'assemble',
      title:
        'Assemble (E) : the automatic editor — analyse a folder of video into a descriptor point cloud, then generate an edit from it'
    },
    { id: 'io', label: 'osc/audio/midi', title: 'Setup (A) : OSC input/OSCQuery, the audio bus, and MIDI (controller input + learned bindings), each a collapsible section' }
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
  // (Vibe / Context / Finalizer) stay clustered at the rightmost : clicking one
  // opens the Finishing view, not the shared Inspector.
  const rackFx = master.filter((f) => !f.locked)
  const lockedFx = master.filter((f) => f.locked)
  // The "chain" On/Off state : on when every user FX is enabled.
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
              ? 'Master FX chain ON : click to bypass all (keeps Finishing Touches)'
              : 'Master FX chain OFF : click to enable all'
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
      <SearchSelect
        className="w-32 shrink-0 text-[10px]"
        value={applied}
        placeholder="chain presets…"
        options={MASTER_PRESETS.map((p) => ({ value: p.name, label: p.name }))}
        onChange={(v) => {
          const p = MASTER_PRESETS.find((x) => x.name === v)
          if (p) {
            applyMasterPreset(p.fx, p.vibe)
            setApplied(p.name)
          }
        }}
        title="Master chain presets : replaces the chain and sets the Vibe accordingly"
      />
      {/* Regular FX rack : wraps to more rows if the chain is deep */}
      <div className="ml-3 flex min-w-0 flex-1 items-center">
        <FxRackPanel scope={{ kind: 'master' }} fx={rackFx} label="" />
      </div>
      {/* Pinned finalizers : clustered at the rightmost, never wrapping apart.
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
    <div className="flex items-center gap-0.5" title="Undo / Redo : Ctrl+Z / Ctrl+Shift+Z">
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
