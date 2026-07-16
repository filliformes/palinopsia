// Finishing Touches : the three always-on master finalizers (Vibe Palette →
// Context → Finalizer) live here in their OWN collapsible sub-sections instead
// of the shared Inspector. Each: a bypass dot, name, dice, preset picker, and
// its parameters stacked vertically. Default collapsed.

import type { FxInstance, ModTarget } from '@shared/types'
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { randomizeInputs } from '../randomize'
import { SHADER_BY_ID } from '../shaders/isf'
import { inputsForShader } from '../shaders/isf/inputs'
import { PRESETS_BY_ID } from '../shaders/isf/presets'
import { modTargetKey, useStore } from '../store'
import { AssignContext, AssignRow, AutoControls, XYControl } from './AutoControls'
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
  const toggleFinishing = useStore((s) => s.toggleFinishing)
  const order = ['fx-vibe', 'fx-context', 'fx-finalizer']
  const units = order.map((id) => master.find((f) => f.shaderId === id)).filter((u): u is FxInstance => !!u)
  const on = units.length > 0 && units.every((u) => u.enabled)
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
        {/* Global bypass for the whole finishing bank. */}
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-wide text-muted">finishing</span>
          <FinishingToggle on={on} onClick={toggleFinishing} />
          <span className="font-mono text-[9px] text-muted">
            Vibe · Context · Finalizer {on ? '' : '— bypassed'}
          </span>
        </div>
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
        title={`Vibe dry/wet ${v.toFixed(2)} : how much the palette re-colours the picture. Double-click = full.`}
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
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1">
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
        <span className={`text-[12px] font-semibold ${inst.enabled ? nameCls : 'text-muted line-through'}`}>
          {name}
        </span>
        <div className="flex-1" />
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
      {!collapsed && (
        <div className="border-t border-border">
          {/* Vibe : global dry/wet FIRST — how much the palette re-colours the picture. */}
          {isVibe && <VibeOpacityRow inst={inst} />}
          {isContext ? (
            <ContextBody inst={inst} onChange={onChange} modTargetFor={modTargetFor} />
          ) : (
            <AutoControls inputs={inputsForShader(shaderId)} values={values} onChange={onChange} modTargetFor={modTargetFor} layout="vertical" />
          )}
        </div>
      )}
    </div>
  )
}

// Context has a "light" XY pad. Render the scalar/colour controls normally,
// then a centered row: the pad, with the "Vibe Color" button to its right.
function ContextBody({
  inst,
  onChange,
  modTargetFor
}: {
  inst: FxInstance
  onChange: (n: string, v: number | number[]) => void
  modTargetFor: (input: string) => ModTarget
}): JSX.Element {
  const composition = useStore((s) => s.composition)
  const values = inst.inputs
  const all = inputsForShader('fx-context')
  const scalars = all.filter((i) => i.type !== 'point2D')
  const pad = all.find((i) => i.type === 'point2D')
  return (
    <>
      <AutoControls inputs={scalars} values={values} onChange={onChange} modTargetFor={modTargetFor} layout="vertical" />
      {pad && (
        <div className="flex items-center justify-center gap-3 border-t border-border px-2 py-2">
          <XYControl inp={pad} value={values[pad.name]} onChange={onChange} />
          <button
            onClick={() => {
              const vibe = composition.master.find((f) => f.shaderId === 'fx-vibe')
              if (vibe) onChange('lightColor', vibeMainColor(vibe.inputs))
            }}
            className="shrink-0 rounded border border-accent2/50 bg-accent2/10 px-1.5 py-0.5 font-mono text-[10px] text-accent2 hover:bg-accent2/20"
            title="Set the light colour from the Vibe Palette's main colour (brightened)"
          >
            Vibe Color
          </button>
        </div>
      )}
    </>
  )
}
