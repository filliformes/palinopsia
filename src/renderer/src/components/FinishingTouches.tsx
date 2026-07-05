// Finishing Touches — the three always-on master finalizers (Vibe Palette →
// Context → Finalizer) live here in their OWN collapsible sub-sections instead
// of the shared Inspector. Each: a bypass dot, name, dice, preset picker, and
// its parameters stacked vertically. Default collapsed.

import type { FxInstance, ModTarget } from '@shared/types'
import { randomizeInputs } from '../randomize'
import { SHADER_BY_ID } from '../shaders/isf'
import { inputsForShader } from '../shaders/isf/inputs'
import { useStore } from '../store'
import { AutoControls } from './AutoControls'
import { PresetPicker } from './PresetPicker'
import { useFlash } from './useFlash'

// Duplicated from the Inspector — the Vibe Palette's most characterful stop,
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

export function FinishingTouches(): JSX.Element {
  const master = useStore((s) => s.composition.master)
  const order = ['fx-vibe', 'fx-context', 'fx-finalizer']
  const units = order.map((id) => master.find((f) => f.shaderId === id)).filter((u): u is FxInstance => !!u)
  return (
    <div className="flex flex-col gap-1.5">
      {units.map((u) => (
        <FinalizerSection key={u.id} inst={u} />
      ))}
    </div>
  )
}

function FinalizerSection({ inst }: { inst: FxInstance }): JSX.Element {
  const shaderId = inst.shaderId as string
  const sectionKey = `ft-${shaderId.replace('fx-', '')}`
  const collapsed = useStore((s) => s.collapsed[sectionKey] ?? true)
  const toggleSection = useStore((s) => s.toggleSection)
  const composition = useStore((s) => s.composition)
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
      <div className="flex items-center gap-2 px-2 py-1">
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
          title={inst.enabled ? `${name} on — click to bypass` : `${name} bypassed — click to enable`}
        />
        <span className={`text-[12px] font-semibold ${inst.enabled ? nameCls : 'text-muted line-through'}`}>
          {name}
        </span>
        <div className="flex-1" />
        {isContext && (
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
        )}
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
        />
      </div>
      {!collapsed && (
        <div className="border-t border-border">
          <AutoControls inputs={inputsForShader(shaderId)} values={values} onChange={onChange} modTargetFor={modTargetFor} layout="vertical" />
        </div>
      )}
    </div>
  )
}
