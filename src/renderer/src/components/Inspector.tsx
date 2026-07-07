// Inspector — the auto-generated control panel (brief §10.3). Points at the
// current selection (a source slot or an FX unit), renders its ISF INPUTS as
// themed controls, and writes edits back through the store — the same path
// OSC and the modulators (Phase 5) use, so the engine follows automatically.

import type { FxInstance, ModTarget, SidechainRef, SourceSlot } from '@shared/types'
import { randomizeInputs } from '../randomize'
import { SHADER_BY_ID } from '../shaders/isf'
import { inputsForShader } from '../shaders/isf/inputs'
import { useState } from 'react'
import { useStore, type FxScope } from '../store'
import { AutoControls } from './AutoControls'
import { CapturePicker } from './CapturePicker'
import { DevicePicker } from './DevicePicker'
import { PresetPicker } from './PresetPicker'
import { useFlash } from './useFlash'
import { SourceFraming } from './SourceFraming'
import { VideoTransport } from './VideoTransport'

// The Vibe Palette's "main" colour = its most characterful stop (highest
// chroma, luma as a tiebreak), brightened a touch so it reads as a light
// source. Fed into Context's light colour for an instant unified look.
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
  return [
    Math.min(1, best[0] * 1.25 + 0.08),
    Math.min(1, best[1] * 1.25 + 0.08),
    Math.min(1, best[2] * 1.25 + 0.08),
    1
  ]
}

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
  const setSourceText = useStore((s) => s.setSourceText)
  const setSourceSidechain = useStore((s) => s.setSourceSidechain)
  const setFxInput = useStore((s) => s.setFxInput)
  const setFxSidechain = useStore((s) => s.setFxSidechain)
  const setFxOpacity = useStore((s) => s.setFxOpacity)
  const vibePresetName = useStore((s) => s.vibePresetName)
  const setVibePresetName = useStore((s) => s.setVibePresetName)
  const setSourceCapture = useStore((s) => s.setSourceCapture)
  const [flashing, flash] = useFlash()
  const [switchCapture, setSwitchCapture] = useState(false)
  const [switchDevice, setSwitchDevice] = useState(false)

  let title = ''
  let context = ''
  let shaderId: string | null = null
  let values: Record<string, number | number[]> = {}
  let onChange: (name: string, value: number | number[]) => void = () => {}
  let modTargetFor: ((inputName: string) => ModTarget) | undefined
  // For FX selections: the dry/wet control shown above the shader's own params.
  let fxOpacity: { value: number; set: (v: number) => void } | null = null
  // For a video source (no ISF controls) — the clip name shown in a small panel.
  let videoName: string | null = null
  // For a native convolution node (layer FX): the sidechain picker.
  let nodeSidechain: { ref: SidechainRef | null; hostLayer: number; set: (r: SidechainRef | null) => void } | null =
    null
  // For the native Text source: the string field + the glyph-fill sidechain.
  let textCfg: {
    text: string
    setText: (t: string) => void
    ref: SidechainRef | null
    setRef: (r: SidechainRef | null) => void
    hostLayer: number
  } | null = null

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
      modTargetFor = (input) => ({ kind: 'source', layer: li, slot: sl, input })
      if (slot.shaderId === 'gen-text') {
        textCfg = {
          text: slot.text ?? 'OPSIA',
          setText: (t) => setSourceText(li, sl, t),
          ref: slot.sidechain ?? null,
          setRef: (r) => setSourceSidechain(li, sl, r),
          hostLayer: li
        }
      }
    } else if (slot?.kind === 'video' || slot?.kind === 'capture' || slot?.kind === 'hive') {
      videoName = slot.mediaName ?? slot.kind
      context = `layer ${selection.layer + 1} · src ${selection.slot}`
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
      fxOpacity = { value: inst.opacity ?? 1, set: (v) => setFxOpacity(scope, instId, v) }
      title = SHADER_BY_ID[inst.shaderId]?.name ?? inst.shaderId
      context =
        scope.kind === 'master'
          ? SCOPE_LABEL.master
          : `layer ${scope.layer + 1} · ${SCOPE_LABEL[scope.kind]}`
      onChange = (n, v) => setFxInput(scope, instId, n, v)
      modTargetFor = (input) => ({ kind: 'fx', scope, instId, input })
      if (SHADER_BY_ID[inst.shaderId]?.native && scope.kind === 'layer') {
        const sc = scope
        nodeSidechain = {
          ref: inst.sidechain ?? null,
          hostLayer: scope.layer,
          set: (r) => setFxSidechain(sc, instId, r)
        }
      }
    }
  }

  if (!shaderId) {
    if (videoName && selection?.type === 'source') {
      const vslot =
        selection.slot === 'A'
          ? composition.layers[selection.layer]?.sourceA
          : composition.layers[selection.layer]?.sourceB
      const isCap = vslot?.kind === 'capture'
      const isHive = vslot?.kind === 'hive'
      const capId = vslot?.mediaId ?? ''
      const isDevice = capId.startsWith('device:')
      const isScreen = isCap && !isDevice && capId !== 'webcam'
      const icon = isHive ? '📡' : !isCap ? '🎞' : isDevice ? '🎥' : capId === 'webcam' ? '📷' : '🖥'
      return (
        <div className="rounded-md border border-border bg-panel">
          <div className="flex items-start gap-2 px-3 py-2">
            <span className="whitespace-nowrap text-[12px] font-semibold">
              {icon} {videoName}
            </span>
            <span className="whitespace-nowrap pt-0.5 font-mono text-[9px] uppercase tracking-wide text-muted">
              {context}
            </span>
            {isScreen && (
              <button
                onClick={() => setSwitchCapture(true)}
                className="shrink-0 rounded border border-accent/50 bg-accent/10 px-2 py-0.5 font-mono text-[10px] text-accent transition-colors hover:bg-accent/20"
                title="Choose a different screen or window to capture"
              >
                🖥 Switch window
              </button>
            )}
            {isDevice && (
              <button
                onClick={() => setSwitchDevice(true)}
                className="shrink-0 rounded border border-accent/50 bg-accent/10 px-2 py-0.5 font-mono text-[10px] text-accent transition-colors hover:bg-accent/20"
                title="Choose a different live input device"
              >
                🎥 Switch input
              </button>
            )}
            <p className="ml-auto max-w-[50%] text-right text-[10px] leading-tight text-muted">
              {isCap ? 'Live capture source' : 'Video source'}. Add FX to this
              source&apos;s rack to synthify it (posterize · dither · key ·
              chroma-shift · feedback).
            </p>
          </div>
          {switchCapture && (
            <CapturePicker
              onPick={(spec, name) => {
                setSourceCapture(selection.layer, selection.slot, spec, name)
                setSwitchCapture(false)
              }}
              onCancel={() => setSwitchCapture(false)}
            />
          )}
          {switchDevice && (
            <DevicePicker
              onPick={(id, name) => {
                setSourceCapture(selection.layer, selection.slot, `device:${id}`, name)
                setSwitchDevice(false)
              }}
              onCancel={() => setSwitchDevice(false)}
            />
          )}
          {vslot?.kind === 'video' && (
            <VideoTransport layer={selection.layer} slot={selection.slot} state={vslot} />
          )}
          {vslot && (
            <SourceFraming layer={selection.layer} slot={selection.slot} state={vslot} />
          )}
        </div>
      )
    }
    return (
      <div className="rounded-md border border-border bg-panel p-3 text-[11px] text-muted">
        Select a source or an FX to edit its controls.
      </div>
    )
  }

  // The Vibe's preset name is shared with P/Shift+P (controlled picker).
  const isVibe = shaderId === 'fx-vibe'
  const isContext = shaderId === 'fx-context'

  return (
    <div
      className={`rounded-md border bg-panel transition-colors ${
        flashing ? 'animate-pulse border-danger ring-1 ring-danger' : 'border-border'
      }`}
    >
      <div className="flex items-center gap-2 border-b border-border px-2 py-1">
        <span className="text-[12px] font-semibold">{title}</span>
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted">{context}</span>
        <div className="flex-1" />
        {/* Per-FX dry/wet opacity — centered, sized like a normal control. */}
        {fxOpacity && (
          <div className="flex shrink-0 items-center gap-1.5" title={`FX dry/wet — ${fxOpacity.value.toFixed(2)}`}>
            <span className="font-mono text-[9px] uppercase text-muted">opacity</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={fxOpacity.value}
              onChange={(e) => fxOpacity!.set(Number(e.target.value))}
              className="w-24 accent-accent"
            />
            <span className="w-7 text-right font-mono text-[10px] text-muted">
              {fxOpacity.value.toFixed(2)}
            </span>
          </div>
        )}
        <div className="flex-1" />
        {isContext && (
          <button
            onClick={() => {
              // Pull the Vibe Palette's signature colour into the key light
              // (brightened) so the whole frame reads as one lit space.
              const vibe = composition.master.find((f) => f.shaderId === 'fx-vibe')
              if (vibe) onChange('lightColor', vibeMainColor(vibe.inputs))
            }}
            className="shrink-0 rounded border border-accent2/50 bg-accent2/10 px-1.5 py-0.5 font-mono text-[10px] text-accent2 transition-colors hover:bg-accent2/20"
            title="Set the light colour from the Vibe Palette's main colour (brightened) — an instant unified look"
          >
            Vibe Color
          </button>
        )}
        <button
          onClick={() => {
            // Curated-range randomize of THIS shader's params only.
            const next = randomizeInputs(shaderId, values)
            for (const [k, v] of Object.entries(next)) onChange(k, v)
            if (isVibe) setVibePresetName(null)
            flash()
          }}
          className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
            flashing
              ? 'animate-pulse border-danger bg-danger/25 text-danger'
              : 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/20'
          }`}
          title="Randomize this shader's parameters (curated ranges)"
        >
          ⚄
        </button>
        {/* key resets the picker's applied-name when the selection moves */}
        <PresetPicker
          key={`${shaderId}:${context}`}
          shaderId={shaderId}
          values={values}
          onChange={onChange}
          appliedName={isVibe ? vibePresetName : undefined}
          onApplied={isVibe ? setVibePresetName : undefined}
        />
      </div>
      {/* Native Text source: the string + the glyph-fill sidechain. */}
      {textCfg && (
        <div className="flex items-center gap-2 border-b border-border bg-panel2/40 px-2 py-1">
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted">text</span>
          <input
            className="input min-w-0 flex-1 px-2 py-0.5 text-[12px]"
            value={textCfg.text}
            onChange={(e) => textCfg!.setText(e.target.value)}
            placeholder={'Your text — \\n for a new line'}
            spellCheck={false}
          />
          <span
            className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-accent2"
            title="A layer whose texture FILLS the letters (glyphs as a matte). None = solid colour."
          >
            fill
          </span>
          <select
            className="input select-compact text-[11px]"
            value={textCfg.ref?.kind === 'layer' ? `layer:${textCfg.ref.layer}` : ''}
            onChange={(e) => {
              const v = e.target.value
              textCfg!.setRef(v.startsWith('layer:') ? { kind: 'layer', layer: Number(v.slice(6)) } : null)
            }}
          >
            <option value="">— color —</option>
            {[0, 1, 2, 3].map((li) => (
              <option key={li} value={`layer:${li}`}>
                Layer {li + 1}
                {li === textCfg!.hostLayer ? ' (self)' : ''}
              </option>
            ))}
          </select>
        </div>
      )}
      {/* Native convolution node: the sidechain (impulse) source picker. */}
      {nodeSidechain && (
        <div className="flex items-center gap-2 border-b border-border bg-panel2/40 px-2 py-1">
          <span className="font-mono text-[9px] uppercase tracking-wide text-accent2" title="The layer whose MOVEMENT is imprinted onto this one">
            sidechain
          </span>
          <select
            className="input select-compact text-[11px]"
            value={nodeSidechain.ref?.kind === 'layer' ? `layer:${nodeSidechain.ref.layer}` : ''}
            onChange={(e) => {
              const v = e.target.value
              nodeSidechain!.set(v.startsWith('layer:') ? { kind: 'layer', layer: Number(v.slice(6)) } : null)
            }}
          >
            <option value="">— none —</option>
            {[0, 1, 2, 3].map((li) => (
              <option key={li} value={`layer:${li}`}>
                Layer {li + 1}
                {li === nodeSidechain!.hostLayer ? ' (self)' : ''}
              </option>
            ))}
          </select>
          <span className="font-mono text-[9px] text-muted">its motion → this layer</span>
        </div>
      )}
      {/* Sources (≤8 params) fit their content — wrap onto as few rows as
          needed (usually one), no fixed height, no horizontal scroll. FX can be
          deep, so they keep the fixed two-row grid that flows into columns. */}
      {selection?.type === 'source' ? (
        <div className="min-h-[3.25rem]">
          <AutoControls
            inputs={inputsForShader(shaderId)}
            values={values}
            onChange={onChange}
            modTargetFor={modTargetFor}
            layout="wrap"
          />
        </div>
      ) : (
        <div className="h-[8.5rem] overflow-x-auto overflow-y-hidden">
          <AutoControls
            inputs={inputsForShader(shaderId)}
            values={values}
            onChange={onChange}
            modTargetFor={modTargetFor}
            layout="twoRow"
          />
        </div>
      )}
    </div>
  )
}
