// Inspector — the auto-generated control panel (brief §10.3). Points at the
// current selection (a source slot or an FX unit), renders its ISF INPUTS as
// themed controls, and writes edits back through the store — the same path
// OSC and the modulators (Phase 5) use, so the engine follows automatically.

import type { FxInstance, SourceSlot } from '@shared/types'
import { SHADER_BY_ID } from '../shaders/isf'
import { inputsForShader } from '../shaders/isf/inputs'
import { useStore, type FxScope } from '../store'
import { AutoControls } from './AutoControls'

const SCOPE_LABEL: Record<FxScope['kind'], string> = {
  master: 'master',
  layer: 'layer fx',
  sourceA: 'src A fx',
  sourceB: 'src B fx'
}

export function Inspector(): JSX.Element {
  const selection = useStore((s) => s.selection)
  const composition = useStore((s) => s.composition)
  const setSourceInput = useStore((s) => s.setSourceInput)
  const setFxInput = useStore((s) => s.setFxInput)

  let title = ''
  let context = ''
  let shaderId: string | null = null
  let values: Record<string, number | number[]> = {}
  let onChange: (name: string, value: number | number[]) => void = () => {}

  if (selection?.type === 'source') {
    const layer = composition.layers[selection.layer]
    const slot: SourceSlot | null =
      selection.slot === 'A' ? (layer?.sourceA ?? null) : (layer?.sourceB ?? null)
    if (slot?.shaderId) {
      shaderId = slot.shaderId
      values = slot.inputs
      title = SHADER_BY_ID[slot.shaderId]?.name ?? slot.shaderId
      context = `layer ${selection.layer + 1} · src ${selection.slot}`
      const { layer: li, slot: sl } = selection
      onChange = (n, v) => setSourceInput(li, sl, n, v)
    }
  } else if (selection?.type === 'fx') {
    const { scope, instId } = selection
    let arr: FxInstance[] = []
    if (scope.kind === 'master') arr = composition.master
    else {
      const layer = composition.layers[scope.layer]
      if (layer) {
        arr =
          scope.kind === 'layer'
            ? layer.fx
            : scope.kind === 'sourceA'
              ? layer.sourceAFx
              : layer.sourceBFx
      }
    }
    const inst = arr.find((f) => f.id === instId)
    if (inst?.shaderId) {
      shaderId = inst.shaderId
      values = inst.inputs
      title = SHADER_BY_ID[inst.shaderId]?.name ?? inst.shaderId
      context =
        scope.kind === 'master'
          ? SCOPE_LABEL.master
          : `layer ${scope.layer + 1} · ${SCOPE_LABEL[scope.kind]}`
      onChange = (n, v) => setFxInput(scope, instId, n, v)
    }
  }

  if (!shaderId) {
    return (
      <div className="rounded-md border border-border bg-panel p-3 text-[11px] text-muted">
        Select a source or an FX to edit its controls.
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border bg-panel">
      <div className="flex items-baseline gap-2 border-b border-border px-2 py-1">
        <span className="text-[12px] font-semibold">{title}</span>
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted">{context}</span>
      </div>
      <div className="max-h-44 overflow-y-auto">
        <AutoControls inputs={inputsForShader(shaderId)} values={values} onChange={onChange} />
      </div>
    </div>
  )
}
