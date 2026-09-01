// Inspector : the auto-generated control panel (brief §10.3). Points at the
// current selection (a source slot or an FX unit), renders its ISF INPUTS as
// themed controls, and writes edits back through the store : the same path
// OSC and the modulators (Phase 5) use, so the engine follows automatically.

import type { FxInstance, ModTarget, SidechainRef, SourceSlot } from '@shared/types'
import { FX_OPACITY_INPUT } from '@shared/types'
import { randomizeInputs } from '../randomize'
import { SHADER_BY_ID } from '../shaders/isf'
import { blurbFor } from '../shaders/isf/shaderBlurbs'
import { generatorBlurb } from '../shaders/isf/sourceBlurbs'
import { inputsForShader, defaultInputs } from '../shaders/isf/inputs'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CollageStrip } from './CollageStrip'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { floatModTargets, hasModulationOn, useFxMenuItems } from './fxMenu'
import { fxArrayFor, modTargetKey, useStore, type FxScope } from '../store'
import { AutoControls, AssignContext, AssignRow, ModButton, useBound } from './AutoControls'
import { registerLiveOverlay } from './liveOverlay'
import { CapturePicker } from './CapturePicker'
import { DevicePicker } from './DevicePicker'
import { PresetPicker } from './PresetPicker'
import { useFlash } from './useFlash'
import { SourceFraming } from './SourceFraming'
import { VideoTransport } from './VideoTransport'
import { AssembleTransport } from './AssembleTransport'

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
  background: 'background fx',
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
  const setBackgroundInput = useStore((s) => s.setBackgroundInput)
  const setFxInput = useStore((s) => s.setFxInput)
  const setFxSidechain = useStore((s) => s.setFxSidechain)
  const setFxOpacity = useStore((s) => s.setFxOpacity)
  const vibePresetName = useStore((s) => s.vibePresetName)
  const setVibePresetName = useStore((s) => s.setVibePresetName)
  const setSourceCapture = useStore((s) => s.setSourceCapture)
  const randomizeModulation = useStore((s) => s.randomizeModulation)
  const [flashing, flash] = useFlash()
  const [switchCapture, setSwitchCapture] = useState(false)
  const [switchDevice, setSwitchDevice] = useState(false)
  // The mod-assign side panel: which parameter's M was clicked (null = closed),
  // and its draggable width (persisted).
  const [assign, setAssign] = useState<{ target: ModTarget; label: string } | null>(null)
  const [assignW, setAssignW] = useState(() => {
    const n = Number(localStorage.getItem('opsia.assignPanelW'))
    return Number.isFinite(n) && n >= 150 ? n : 224
  })
  // Resizable FX-controls band (drag the handle under it; persisted).
  const [fxH, setFxH] = useState(() => {
    const n = Number(localStorage.getItem('opsia.inspectorH'))
    return Number.isFinite(n) && n >= 96 ? n : 136
  })
  const resize = useRef<{ startX: number; startW: number; last: number } | null>(null)
  // The FX-controls band measures its own content so it can auto-fit (see the
  // auto-fit RULE below).
  const fxContentRef = useRef<HTMLDivElement>(null)
  // The FX dry/wet opacity slider tracks its live modulated value (like every
  // other modulated control), so a bound opacity visibly moves in the header.
  const fxOpaRef = useRef<HTMLInputElement | null>(null)
  // Close the panel whenever the selection moves to a different shader/unit.
  const selKey =
    selection?.type === 'source'
      ? `s:${selection.layer}:${selection.slot}`
      : selection?.type === 'fx'
        ? `f:${selection.instId}`
        : selection?.type === 'background'
          ? 'bg'
          : 'none'
  useEffect(() => setAssign(null), [selKey])

  // RULE — the FX-controls band ALWAYS auto-fits its parameters : never blank space
  // over a few, never a hidden/scrolled row when there are many. On every selection
  // change (and on any reflow — a width change re-flows the wrapped controls) we
  // measure the natural content height and size the band to it, clamped to a
  // screen-sensible range (below the cap it fits exactly; above it, it scrolls). The
  // drag handle still lets you override the height until the next selection.
  useLayoutEffect(() => {
    const el = fxContentRef.current
    if (!el) return
    const fit = (): void => {
      const min = 44
      const max = Math.max(240, Math.min(560, Math.round(window.innerHeight * 0.55)))
      const h = el.scrollHeight
      if (h > 0) setFxH(Math.max(min, Math.min(max, h + 6)))
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [selKey])

  let title = ''
  let context = ''
  let shaderId: string | null = null
  let values: Record<string, number | number[]> = {}
  let onChange: (name: string, value: number | number[]) => void = () => {}
  let modTargetFor: ((inputName: string) => ModTarget) | undefined
  // For FX selections: the dry/wet control shown above the shader's own params.
  let fxOpacity: { value: number; set: (v: number) => void } | null = null
  // For a video source (no ISF controls) : the clip name shown in a small panel.
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
  let collageCfg: {
    target: { kind: 'layer'; layer: number; slot: 'A' | 'B' } | { kind: 'background' }
    folder: string
    pool: import('@shared/collage').CollageClip[]
    edls: import('@shared/collage').CollageEdl[]
  } | null = null
  // The FX the header is showing, if any : right-clicking its title offers the
  // same copy/paste menu as right-clicking its chip in the rack.
  const fxHere: { scope: FxScope; instId: string } | null =
    selection?.type === 'fx' ? { scope: selection.scope, instId: selection.instId } : null
  const [headerMenu, setHeaderMenu] = useState<{ x: number; y: number } | null>(null)
  // Hooks run unconditionally : the fallback scope is never used, because the
  // menu only renders when fxHere is set.
  const headerUnit = fxHere ? fxArrayFor(composition, fxHere.scope).find((f) => f.id === fxHere.instId) : undefined
  const headerMenuItems = useFxMenuItems(
    fxHere?.scope ?? { kind: 'master' },
    fxHere?.instId ?? null,
    headerUnit?.shaderId,
    () => setHeaderMenu(null),
    !!headerUnit?.locked
  )

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
      if (slot.shaderId === 'gen-collage') {
        collageCfg = {
          target: { kind: 'layer', layer: li, slot: sl },
          folder: slot.collageFolder ?? '',
          pool: slot.collagePool ?? [],
          edls: slot.collageEdls ?? []
        }
      }
      if (slot.shaderId === 'gen-text') {
        textCfg = {
          text: slot.text ?? 'OPSIA',
          setText: (t) => setSourceText(li, sl, t),
          ref: slot.sidechain ?? null,
          setRef: (r) => setSourceSidechain(li, sl, r),
          hostLayer: li
        }
      }
    } else if (
      slot?.kind === 'video' ||
      slot?.kind === 'capture' ||
      slot?.kind === 'hive' ||
      slot?.kind === 'assemble'
    ) {
      videoName = slot.mediaName ?? slot.kind
      context = `layer ${selection.layer + 1} · src ${selection.slot}`
    }
  } else if (selection?.type === 'background') {
    // The Background slab's SOURCE params (its FX go through the fx branch).
    const bg = composition.background
    if (bg?.source.shaderId) {
      shaderId = bg.source.shaderId
      values = bg.source.inputs
      title = SHADER_BY_ID[bg.source.shaderId]?.name ?? bg.source.shaderId
      context = 'background'
      onChange = (n, v) => setBackgroundInput(n, v)
      modTargetFor = (input) => ({ kind: 'bgSource', input })
      if (bg.source.shaderId === 'gen-collage') {
        collageCfg = {
          target: { kind: 'background' },
          folder: bg.source.collageFolder ?? '',
          pool: bg.source.collagePool ?? [],
          edls: bg.source.collageEdls ?? []
        }
      }
    }
  } else if (selection?.type === 'fx') {
    const { scope, instId } = selection
    let arr: FxInstance[] = []
    if (scope.kind === 'master') arr = composition.master
    else if (scope.kind === 'background') arr = composition.background?.fx ?? []
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
        scope.kind === 'master' || scope.kind === 'background'
          ? SCOPE_LABEL[scope.kind]
          : `layer ${scope.layer + 1} · ${SCOPE_LABEL[scope.kind]}`
      onChange = (n, v) => setFxInput(scope, instId, n, v)
      modTargetFor = (input) => ({ kind: 'fx', scope, instId, input })
      // Only the SIDECHAIN nodes read a sidechain; the self-contained
      // nodes ignore it, so showing the picker for them is misleading.
      if (
        (inst.shaderId === 'node-transfert' ||
          inst.shaderId === 'node-convolve' ||
          inst.shaderId === 'node-mosaique') &&
        scope.kind === 'layer'
      ) {
        const sc = scope
        nodeSidechain = {
          ref: inst.sidechain ?? null,
          hostLayer: scope.layer,
          set: (r) => setFxSidechain(sc, instId, r)
        }
      }
    }
  }

  // Per-FX dry/wet opacity as a modulation target : rides the fx plumbing via a
  // sentinel input name, so its M pill opens the same mod-assign side panel as
  // any other FX parameter. useBound is a hook, so it must run before any early
  // return below (it no-ops on a null key when no FX is selected).
  const fxOpaTarget: ModTarget | null = fxOpacity && modTargetFor ? modTargetFor(FX_OPACITY_INPUT) : null
  const fxOpaBound = useBound(fxOpaTarget ? modTargetKey(fxOpaTarget) : null)
  // One shared assign-context value : the header's FX-opacity pill and the body's
  // parameter pills both toggle the same side panel (`assign`).
  const assignCtxValue = {
    activeKey: assign ? modTargetKey(assign.target) : null,
    onAssign: (target: ModTarget, label: string): void =>
      setAssign((cur) =>
        cur && modTargetKey(cur.target) === modTargetKey(target) ? null : { target, label }
      )
  }
  const fxOpaKey = fxOpaTarget ? modTargetKey(fxOpaTarget) : null
  const fxOpaModulated = fxOpaBound.length > 0
  useEffect(() => {
    const el = fxOpaRef.current
    if (!fxOpaModulated || !fxOpaKey || !el) return
    return registerLiveOverlay({ el, key: fxOpaKey, format: (x) => String(x) })
  }, [fxOpaModulated, fxOpaKey])

  // A stable identity for the preset picker : distinct per selected FX unit /
  // source slot / background, so it never bleeds an applied name between two
  // same-shader units.
  const presetKey =
    selection?.type === 'fx'
      ? `fx:${JSON.stringify(selection.scope)}:${selection.instId}`
      : selection?.type === 'source'
        ? `src:${selection.layer}:${selection.slot}`
        : selection?.type === 'background'
          ? 'bg'
          : String(shaderId)

  // Plain-English hover-help on the title : an FX blurb, or — when a
  // generator source is selected — a source blurb.
  const blurb =
    blurbFor(shaderId) ??
    (selection?.type === 'source' || selection?.type === 'background'
      ? generatorBlurb(shaderId)
      : undefined)

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
      const isAsm = vslot?.kind === 'assemble'
      const icon = isAsm
        ? '🎬'
        : isHive
          ? '📡'
          : !isCap
            ? '🎞'
            : isDevice
              ? '🎥'
              : capId === 'webcam'
                ? '📷'
                : '🖥'
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
          {vslot?.kind === 'assemble' && (
            <AssembleTransport layer={selection.layer} slot={selection.slot} state={vslot} />
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

  // Header right-click menu : an FX gets copy/paste + modulation (useFxMenuItems);
  // a source/background gets "Randomize modulation" only when it already carries
  // modulation. No items ⇒ no menu (right-click does nothing).
  const isSourceSel = selection?.type === 'source' || selection?.type === 'background'
  const srcModCands =
    isSourceSel && modTargetFor ? floatModTargets(shaderId, modTargetFor) : []
  const srcMenuItems: MenuItem[] = hasModulationOn(composition.modMatrix, srcModCands)
    ? [
        {
          label: 'Randomize modulation',
          onClick: () => {
            randomizeModulation(srcModCands, false)
            setHeaderMenu(null)
          }
        }
      ]
    : []
  const menuItems = fxHere ? headerMenuItems : srcMenuItems
  const menuOpenable = fxHere ? true : srcMenuItems.length > 0

  return (
    <div
      className={`rounded-md border bg-panel transition-colors ${
        flashing ? 'animate-pulse border-accent ring-1 ring-accent' : 'border-border'
      }`}
    >
      <div
        className="flex items-center gap-2 border-b border-border px-2 py-1"
        onContextMenu={(e) => {
          if (!menuOpenable) return
          e.preventDefault()
          setHeaderMenu({ x: e.clientX, y: e.clientY })
        }}
      >
        {headerMenu && menuOpenable && (
          <ContextMenu
            x={headerMenu.x}
            y={headerMenu.y}
            header={title}
            items={menuItems}
            onClose={() => setHeaderMenu(null)}
          />
        )}
        <span
          className={`text-[12px] font-semibold ${
            blurb ? 'cursor-help underline decoration-dotted decoration-muted underline-offset-4' : ''
          }`}
          title={blurb}
        >
          {title}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wide text-muted">{context}</span>
        <div className="flex-1" />
        {/* Per-FX dry/wet opacity : centered, sized like a normal control. */}
        {fxOpacity && (
          <div className="flex shrink-0 items-center gap-1.5" title={`FX dry/wet : ${fxOpacity.value.toFixed(2)}`}>
            <span className="font-mono text-[9px] uppercase text-muted">opacity</span>
            <input
              ref={fxOpaRef}
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={fxOpacity.value}
              onChange={(e) => fxOpacity!.set(Number(e.target.value))}
              onDoubleClick={() => fxOpacity!.set(1)}
              className={`w-24 ${fxOpaBound.length ? 'accent-accent2' : 'accent-accent'}`}
            />
            <span className="w-7 text-right font-mono text-[10px] text-muted">
              {fxOpacity.value.toFixed(2)}
            </span>
            {fxOpaTarget && (
              <AssignContext.Provider value={assignCtxValue}>
                <ModButton target={fxOpaTarget} bound={fxOpaBound} label="FX opacity" />
              </AssignContext.Provider>
            )}
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
            title="Set the light colour from the Vibe Palette's main colour (brightened) : an instant unified look"
          >
            Vibe Color
          </button>
        )}
        <button
          onClick={() => {
            // Back to the factory state : every parameter to its DEFAULT, the
            // same values a freshly-added unit shows.
            const def = defaultInputs(shaderId)
            for (const [k, v] of Object.entries(def)) onChange(k, v)
            if (isVibe) setVibePresetName(null)
          }}
          className="shrink-0 rounded border border-border bg-panel2/60 px-1.5 py-0.5 font-mono text-[10px] text-muted transition-colors hover:border-fg/40 hover:text-fg"
          title="Reset this effect to its default state (every parameter to its default value)"
        >
          ↺
        </button>
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
              ? 'animate-pulse border-accent bg-accent/25 text-accent'
              : 'border-accent/50 bg-accent/10 text-accent hover:bg-accent/20'
          }`}
          title="Randomize this shader's parameters (curated ranges)"
        >
          ⚄
        </button>
        {/* key resets the picker's applied-name when the selection moves. Keyed
            on the selection's IDENTITY (an FX instId, or the source/bg slot) so
            two units of the same shader in one rack don't share a picker. */}
        <PresetPicker
          key={presetKey}
          shaderId={shaderId}
          values={values}
          onChange={onChange}
          appliedName={isVibe ? vibePresetName : undefined}
          onApplied={isVibe ? setVibePresetName : undefined}
        />
      </div>
      {/* Native Collage source : the folder / assemblage picker strip. */}
      {collageCfg && (
        <CollageStrip
          target={collageCfg.target}
          folder={collageCfg.folder}
          pool={collageCfg.pool}
          edls={collageCfg.edls}
        />
      )}
      {textCfg && (
        <div className="flex items-center gap-2 border-b border-border bg-panel2/40 px-2 py-1">
          <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted">text</span>
          <input
            className="input min-w-0 flex-1 px-2 py-0.5 text-[12px]"
            value={textCfg.text}
            onChange={(e) => textCfg!.setText(e.target.value)}
            placeholder={'Your text : \\n for a new line'}
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
      {/* Sources (≤8 params) fit their content : wrap onto as few rows as
          needed (usually one), no fixed height, no horizontal scroll. FX can be
          deep, so they keep the fixed two-row grid that flows into columns. */}
      {/* Controls on the left; the mod-assign panel slides in on the right,
          under the header's dice/presets, when an M is clicked. */}
      <AssignContext.Provider value={assignCtxValue}>
        <div className="flex min-w-0 items-stretch">
          <div className="min-w-0 flex-1">
            {selection?.type === 'source' || selection?.type === 'background' ? (
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
              <>
              <div style={{ height: fxH }} className="flex overflow-x-hidden overflow-y-auto">
                {/* The band auto-fits this content (see the auto-fit RULE); m-auto
                    still centres the controls in the rare case the band is capped
                    below the content and has to scroll. */}
                <div className="m-auto w-full">
                  {/* A plain block that tightly wraps the controls : its height is
                      exactly the content, so measuring it (auto-fit RULE) is immune
                      to the parent's flex stretch. */}
                  <div ref={fxContentRef}>
                    <AutoControls
                      inputs={inputsForShader(shaderId)}
                      values={values}
                      onChange={onChange}
                      modTargetFor={modTargetFor}
                      layout="twoRow"
                    />
                  </div>
                </div>
              </div>
              {/* Drag to resize the controls band (persisted). */}
              <div
                className="h-1 cursor-row-resize bg-border/50 transition-colors hover:bg-accent/60"
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => {
                  const startY = e.clientY
                  const startH = fxH
                  const el = e.target as HTMLElement
                  el.setPointerCapture(e.pointerId)
                  const move = (ev: PointerEvent): void => {
                    const h = Math.max(44, Math.min(560, startH + (ev.clientY - startY)))
                    setFxH(h)
                    localStorage.setItem('opsia.inspectorH', String(h))
                  }
                  const up = (): void => {
                    el.removeEventListener('pointermove', move)
                    el.removeEventListener('pointerup', up)
                    el.removeEventListener('pointercancel', up)
                  }
                  el.addEventListener('pointermove', move)
                  el.addEventListener('pointerup', up)
                  el.addEventListener('pointercancel', up)
                }}
                title="Drag to resize the Inspector"
              />
              </>
            )}
          </div>
          {assign && (
            <>
              {/* Drag the left edge to resize the panel (it's on the right, so
                  dragging left widens it). */}
              <div
                className="w-1 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-accent/60"
                style={{ touchAction: 'none' }}
                onPointerDown={(e) => {
                  resize.current = { startX: e.clientX, startW: assignW, last: assignW }
                  ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
                }}
                onPointerMove={(e) => {
                  const r = resize.current
                  if (!r) return
                  const w = Math.max(160, Math.min(460, r.startW + (r.startX - e.clientX)))
                  r.last = w
                  setAssignW(w)
                }}
                onPointerUp={(e) => {
                  if (resize.current) {
                    localStorage.setItem('opsia.assignPanelW', String(resize.current.last))
                    resize.current = null
                    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
                  }
                }}
                onPointerCancel={(e) => {
                  if (resize.current) {
                    localStorage.setItem('opsia.assignPanelW', String(resize.current.last))
                    resize.current = null
                    ;(e.target as HTMLElement).releasePointerCapture(e.pointerId)
                  }
                }}
                title="Drag to resize the Modulate panel"
              />
              <AssignPanel
                width={assignW}
                target={assign.target}
                label={assign.label}
                onClose={() => setAssign(null)}
              />
            </>
          )}
        </div>
      </AssignContext.Provider>
    </div>
  )
}

// The mod-assign side panel : replaces the old floating popover. Sits at the
// right of the controls band (under the header's dice/presets), names the
// parameter it modulates, and hosts the M1–8 / Meta binding row.
function AssignPanel({
  target,
  label,
  onClose,
  width
}: {
  target: ModTarget
  label: string
  onClose: () => void
  width: number
}): JSX.Element {
  const key = modTargetKey(target)
  const bound = useStore(
    useShallow((s) => s.composition.modMatrix.filter((a) => modTargetKey(a.target) === key))
  )
  return (
    <div
      className="flex shrink-0 flex-col border-l border-border bg-panel2/40"
      style={{ width }}
    >
      <div className="flex items-center gap-2 border-b border-border py-1 pl-3.5 pr-2">
        <span className="font-mono text-[9px] uppercase tracking-wide text-accent2">modulate</span>
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
      <div className="min-h-0 flex-1 overflow-y-auto py-2 pl-3 pr-1.5">
        <AssignRow target={target} bound={bound} />
      </div>
    </div>
  )
}
