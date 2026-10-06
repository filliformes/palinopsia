// Finishing Touches : the three always-on master finalizers (Vibe Palette →
// Context → Finalizer) live here in their OWN collapsible sub-sections instead
// of the shared Inspector. Each: a bypass dot, name, dice, preset picker, and
// its parameters stacked vertically. Default collapsed.

import type { FxInstance, ModTarget } from '@shared/types'
import { useEffect, useState } from 'react'
import { frameVals } from '../engine/frameVals'
import { liveModValues } from '../engine/modulation'
import { useShallow } from 'zustand/react/shallow'
import { randomizeInputs } from '../randomize'
import { SHADER_BY_ID } from '../shaders/isf'
import { defaultInputs, inputsForShader } from '../shaders/isf/inputs'
import { PRESETS_BY_ID } from '../shaders/isf/presets'
import { makeContext, makeFinalizer, makeVibePalette, modTargetKey, useStore } from '../store'
import { AssignContext, AssignRow, XYControl } from './AutoControls'
import { SectionedControls } from './FinishingSections'
import { PresetPicker } from './PresetPicker'
import { useFlash } from './useFlash'

// Duplicated from the Inspector : the Vibe Palette's most characterful stop,
// brightened, for Context's "Vibe Color" button.
function vibeMainColor(inputs: Record<string, number | number[]>): number[] {
  const stops = ['colorA', 'colorB', 'colorC', 'colorD', 'colorE']
    .map((k) => inputs[k])
    .filter((c): c is number[] => Array.isArray(c) && c.length >= 3)
  let best = stops[0] ?? [1, 1, 1, 1]
  let bestScore = -1
  for (const c of stops) {
    const chroma = Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2])
    const luma = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]
    const score = chroma * 2 + luma * 0.4
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  return [Math.min(1, best[0] * 1.25 + 0.08), Math.min(1, best[1] * 1.25 + 0.08), Math.min(1, best[2] * 1.25 + 0.08), 1]
}

const AC: Record<string, string> = { 'fx-vibe': 'accent2', 'fx-context': 'accent', 'fx-finalizer': 'active' }

// One width for all three pickers: the longest preset name across Vibe,
// Context and Finalizer (plus a little for the caret / padding).
const FT_PRESET_WIDTH_CH = (() => {
  const names = ['fx-vibe', 'fx-context', 'fx-finalizer'].flatMap((id) =>
    (PRESETS_BY_ID[id] ?? []).map((p) => p.name)
  )
  const longest = names.reduce((m, n) => Math.max(m, n.length), 'presets…'.length)
  return longest + 2.5
})()

export function FinishingTouches(): JSX.Element {
  const master = useStore((s) => s.composition.master)
  const order = ['fx-vibe', 'fx-context', 'fx-finalizer']
  const units = order.map((id) => master.find((f) => f.shaderId === id)).filter((u): u is FxInstance => !!u)
  // M buttons open the DEDICATED Modulate section pinned at the bottom of this
  // column (mirrors the main Inspector's side panel) : never the old popover.
  const [assign, setAssign] = useState<{ target: ModTarget; label: string } | null>(null)
  return (
    <AssignContext.Provider
      value={{
        activeKey: assign ? modTargetKey(assign.target) : null,
        onAssign: (target, label) =>
          setAssign((cur) =>
            cur && modTargetKey(cur.target) === modTargetKey(target) ? null : { target, label }
          )
      }}
    >
      <div className="flex min-h-full flex-col gap-1.5">
        {units.map((u) => (
          <FinalizerSection key={u.id} inst={u} />
        ))}
        {assign && (
          <FinishingAssign target={assign.target} label={assign.label} onClose={() => setAssign(null)} />
        )}
      </div>
    </AssignContext.Provider>
  )
}

// The Finishing column's Modulate section : pinned to the very bottom (sticky
// inside the column's scrollport), full column width, min-w-0 throughout so
// nothing escapes the margins however narrow the column is resized.
function FinishingAssign({
  target,
  label,
  onClose
}: {
  target: ModTarget
  label: string
  onClose: () => void
}): JSX.Element {
  const key = modTargetKey(target)
  const bound = useStore(
    useShallow((s) => s.composition.modMatrix.filter((a) => modTargetKey(a.target) === key))
  )
  return (
    <div className="sticky bottom-0 z-10 mt-auto min-w-0 rounded-md border border-accent2/40 bg-panel pt-0">
      <div className="flex min-w-0 items-center gap-2 border-b border-border px-2 py-1">
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-accent2">modulate</span>
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold" title={label}>
          {label}
        </span>
        <button
          onClick={onClose}
          className="shrink-0 font-mono text-[11px] text-muted hover:text-text"
          title="Close"
        >
          ✕
        </button>
      </div>
      <div className="min-w-0 p-1.5">
        <AssignRow target={target} bound={bound} />
      </div>
    </div>
  )
}

// The global finishing on/off pill : reused (mirrored) in the Master FX strip.
export function FinishingToggle({ on, onClick }: { on: boolean; onClick: () => void }): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wide transition-colors ${
        on ? 'border-active bg-active/15 text-active' : 'border-border text-muted hover:text-text'
      }`}
      title={
        on
          ? 'Finishing ON : click to bypass Vibe · Context · Finalizer'
          : 'Finishing bypassed : click to enable Vibe · Context · Finalizer'
      }
    >
      finishing {on ? 'on' : 'off'}
    </button>
  )
}

// The Vibe Palette's dry/wet, surfaced as the FIRST control of its section : how
// much the palette re-colours the picture (1 = full grade, 0 = untouched).
// Context params the performance macros add onto (they write the engine, not the
// store, so the sliders keep showing the base).
const CONTEXT_LIVE: Array<[string, string, number]> = [
  ['blur', 'blur', 0], ['trails', 'trails', 0.2], ['haze', 'haze', 0.15], ['depth', 'depth', 0.35], ['bloom', 'bloom', 0.3]
]
const NEUTRAL = (v: number): boolean => Math.abs(v - 0.5) <= 0.02

/** What the ENGINE is using for Context when something adds on top of the
 *  sliders : Proximity, Coalesce, Flow, Gesture⇄Texture, the sequencer's Breathe
 *  / Arc, a modulator. The sliders show the base, so without this "every slider at
 *  0" could still blur. Polled a few times a second; hidden when nothing adds. A
 *  click puts the macros that are adding back to neutral. */
function ContextLiveRow({ inst }: { inst: FxInstance }): JSX.Element | null {
  const [info, setInfo] = useState<{ vals: string; from: string[] } | null>(null)
  useEffect(() => {
    const read = (): void => {
      const st = useStore.getState()
      const cur = st.composition.master.find((f) => f.id === inst.id)
      if (!cur || !cur.enabled) { setInfo(null); return }
      const parts: string[] = []
      for (const [name, label, def] of CONTEXT_LIVE) {
        const key = `fx:master:${inst.id}:${name}`
        const eff = frameVals.get(key) ?? liveModValues.get(key)
        if (eff === undefined) continue
        const base = typeof cur.inputs[name] === 'number' ? (cur.inputs[name] as number) : def
        if (Math.abs(eff - base) > 0.01) parts.push(`${label} ${eff.toFixed(2)}`)
      }
      if (!parts.length) { setInfo(null); return }
      const from: string[] = []
      if (!NEUTRAL(st.proximity) || st.proximityAudio) from.push('Proximity')
      if (!NEUTRAL(st.coalesce)) from.push('Coalesce')
      if (st.flow > 0.52) from.push('Flow')
      if (!NEUTRAL(st.gestureTexture)) from.push('Gesture⇄Texture')
      const seq = st.sequence
      if ((seq.breathe?.amount ?? 0) > 0.001 || seq.arc?.enabled) from.push('sequencer')
      if (st.composition.modMatrix.some((a) => a.target.kind === 'fx' && 'instId' in a.target && a.target.instId === inst.id)) from.push('a modulator')
      const vals = parts.join(' · ')
      setInfo((prev) => (prev && prev.vals === vals && prev.from.join() === from.join() ? prev : { vals, from }))
    }
    read()
    const id = window.setInterval(read, 250)
    return () => window.clearInterval(id)
  }, [inst.id])
  if (!info) return null
  const macros = info.from.filter((f) => f !== 'sequencer' && f !== 'a modulator')
  return (
    <div
      className="flex items-center gap-1.5 border-b border-border bg-accent2/10 px-2 py-1 font-mono text-[10px] text-accent2"
      title="The sliders show Context's base values. These performance controls add on top of them, so this is what the picture actually gets."
    >
      <span className="min-w-0 flex-1 truncate">
        live {info.vals}
        {info.from.length ? ` ← ${info.from.join(', ')}` : ''}
      </span>
      {macros.length > 0 && (
        <button
          className="shrink-0 rounded border border-accent2/50 px-1 hover:bg-accent2/20"
          onClick={() => {
            const st = useStore.getState()
            if (macros.includes('Proximity')) { st.setProximity(0.5); if (st.proximityAudio) st.setProximityAudio(false) }
            if (macros.includes('Coalesce')) st.setCoalesce(0.5)
            if (macros.includes('Flow')) st.setFlow(0.5)
            if (macros.includes('Gesture⇄Texture')) st.setGestureTexture(0.5)
          }}
          title={`Put ${macros.join(', ')} back to neutral (0.5) : Context then uses exactly its sliders`}
        >
          neutral
        </button>
      )}
    </div>
  )
}

function VibeOpacityRow({ inst }: { inst: FxInstance }): JSX.Element {
  const setFxOpacity = useStore((s) => s.setFxOpacity)
  const v = inst.opacity ?? 1
  return (
    <div className="flex items-center gap-2 border-b border-border bg-panel2/40 px-2 py-1">
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-accent2">opacity</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={v}
        onChange={(e) => setFxOpacity({ kind: 'master' }, inst.id, Number(e.target.value))}
        onDoubleClick={() => setFxOpacity({ kind: 'master' }, inst.id, 1)}
        className="min-w-0 flex-1 accent-accent2"
        title={`Vibe dry/wet ${v.toFixed(2)} : how much the palette re-colors the picture. Double-click = full.`}
      />
      <span className="w-8 shrink-0 text-right font-mono text-[10px] text-muted">{v.toFixed(2)}</span>
    </div>
  )
}

function FinalizerSection({ inst }: { inst: FxInstance }): JSX.Element {
  const shaderId = inst.shaderId as string
  const sectionKey = `ft-${shaderId.replace('fx-', '')}`
  const collapsed = useStore((s) => s.collapsed[sectionKey] ?? true)
  const toggleSection = useStore((s) => s.toggleSection)
  const setFxInput = useStore((s) => s.setFxInput)
  const setFxInputs = useStore((s) => s.setFxInputs)
  const setFxOpacity = useStore((s) => s.setFxOpacity)
  const toggleFx = useStore((s) => s.toggleFx)
  const vibePresetName = useStore((s) => s.vibePresetName)
  const setVibePresetName = useStore((s) => s.setVibePresetName)
  const [flashing, flash] = useFlash()

  const name = SHADER_BY_ID[shaderId]?.name ?? shaderId
  const ac = AC[shaderId] ?? 'accent'
  const isVibe = shaderId === 'fx-vibe'
  const isContext = shaderId === 'fx-context'
  const values = inst.inputs
  const onChange = (n: string, v: number | number[]): void =>
    setFxInput({ kind: 'master' }, inst.id, n, v)
  const modTargetFor = (input: string): ModTarget => ({ kind: 'fx', scope: { kind: 'master' }, instId: inst.id, input })

  // Literal accent classes (JIT-safe).
  const dotCls =
    ac === 'accent' ? 'bg-accent' : ac === 'active' ? 'bg-active' : 'bg-accent2'
  const nameCls =
    ac === 'accent' ? 'text-accent' : ac === 'active' ? 'text-active' : 'text-accent2'
  const ringCls =
    ac === 'accent' ? 'border-accent/40' : ac === 'active' ? 'border-active/40' : 'border-accent2/40'

  return (
    <div className={`rounded-md border bg-panel ${flashing ? 'animate-pulse border-danger' : ringCls}`}>
      <div className="flex min-w-0 items-center gap-2 px-2 py-1">
        <button
          onClick={() => toggleSection(sectionKey)}
          className="flex shrink-0 items-center gap-1"
          title={collapsed ? `Expand ${name}` : `Collapse ${name}`}
        >
          <span className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
        </button>
        {/* bypass */}
        <button
          onClick={() => toggleFx({ kind: 'master' }, inst.id)}
          className={`h-2.5 w-2.5 shrink-0 rounded-full transition-colors ${inst.enabled ? dotCls : 'bg-panel3'}`}
          title={inst.enabled ? `${name} on : click to bypass` : `${name} bypassed : click to enable`}
        />
        <span className={`shrink-0 text-[12px] font-semibold ${inst.enabled ? nameCls : 'text-muted line-through'}`}>
          {name}
        </span>
        <div className="flex-1" />
        <button
          onClick={() => {
            // The values a New session starts with : the stage's own factory
            // values over the shader's defaults, so every parameter (the hidden
            // ones included) goes back, not only the ones the factory names.
            const factory =
              shaderId === 'fx-vibe' ? makeVibePalette() : shaderId === 'fx-context' ? makeContext() : shaderId === 'fx-finalizer' ? makeFinalizer() : null
            setFxInputs({ kind: 'master' }, inst.id, { ...defaultInputs(shaderId), ...(factory?.inputs ?? {}) })
            if (isVibe) {
              setFxOpacity({ kind: 'master' }, inst.id, factory?.opacity ?? 1)
              setVibePresetName(null)
            }
          }}
          className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[12px] leading-none text-muted transition-colors hover:border-accent hover:text-accent"
          title={`Back to default : ${name} as a New session starts it (modulators stay bound)`}
          aria-label={`Reset ${name} to default`}
        >
          ↺
        </button>
        <button
          onClick={() => {
            const next = randomizeInputs(shaderId, values)
            for (const [k, v] of Object.entries(next)) onChange(k, v)
            if (isVibe) setVibePresetName(null)
            flash()
          }}
          className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
            flashing ? 'animate-pulse border-danger bg-danger/25 text-danger' : 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/20'
          }`}
          title="Randomize this stage's parameters (curated ranges)"
        >
          ⚄
        </button>
        <PresetPicker
          key={shaderId}
          shaderId={shaderId}
          values={values}
          onChange={onChange}
          appliedName={isVibe ? vibePresetName : undefined}
          onApplied={isVibe ? setVibePresetName : undefined}
          widthCh={FT_PRESET_WIDTH_CH}
        />
      </div>
      {/* Context : what the engine uses when a macro adds on top of the sliders
          (shown collapsed or not : it is the answer to "why is it soft"). */}
      {isContext && <ContextLiveRow inst={inst} />}
      {!collapsed && (
        <div className="border-t border-border">
          {/* Vibe : global dry/wet FIRST : how much the palette re-colors the picture. */}
          {isVibe && <VibeOpacityRow inst={inst} />}
          {/* Controls in labelled sections (FinishingSections.tsx). */}
          <SectionedControls
            shaderId={shaderId}
            values={values}
            onChange={onChange}
            modTargetFor={modTargetFor}
            extras={isContext ? { light: <ContextLightPad inst={inst} onChange={onChange} /> } : undefined}
          />
        </div>
      )}
    </div>
  )
}

// Context's light section ends with the light's XY pad and, beside it, the
// "Vibe Color" button (the light takes the Vibe Palette's main colour).
function ContextLightPad({
  inst,
  onChange
}: {
  inst: FxInstance
  onChange: (n: string, v: number | number[]) => void
}): JSX.Element | null {
  const composition = useStore((s) => s.composition)
  const values = inst.inputs
  const pad = inputsForShader('fx-context').find((i) => i.type === 'point2D')
  if (!pad) return null
  return (
    <div className="flex items-center justify-center gap-3 px-2 py-2">
      <XYControl inp={pad} value={values[pad.name]} onChange={onChange} />
      <button
        onClick={() => {
          const vibe = composition.master.find((f) => f.shaderId === 'fx-vibe')
          if (vibe) onChange('lightColor', vibeMainColor(vibe.inputs))
        }}
        className="shrink-0 rounded border border-accent2/50 bg-accent2/10 px-1.5 py-0.5 font-mono text-[10px] text-accent2 hover:bg-accent2/20"
        title="Set the light color from the Vibe Palette's main color (brightened)"
      >
        Vibe Color
      </button>
    </div>
  )
}
