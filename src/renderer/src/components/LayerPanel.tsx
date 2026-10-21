// One layer strip (brief §10.2), compact form: opacity rides the header row;
// SRC A and SRC B sit side by side (their FX racks live BELOW as chips, so
// the columns stay narrow); every rack uses the chips layout : no blank
// space. Right-click anywhere on the strip: Init, Randomize layer, layer
// presets (save/apply/delete : app-persistent).

import { useEffect, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react'
import { TBTN, TBTN_IDLE, TBTN_IDLE_ON, TBTN_LIT, TBTN_MOD } from './buttonStyles'
import type { LayerMask, ModTarget, SourceKind, SourceSlot } from '@shared/types'
import { DEFAULT_LAYER_VARY } from '@shared/types'
import { blendAt, blendLabel, couplingWords, mixTitle, mixWord } from './abMix'
import { BlendSelect } from './BlendSelect'
import { GENERATORS_ALPHA, SHADER_BY_ID, inPickerOrder, sourceSection } from '../shaders/isf'
import { generatorBlurb } from '../shaders/isf/sourceBlurbs'
import { keywordsFor } from '../shaders/isf/keywords'
import { makeDefaultMask, modTargetKey, useStore } from '../store'
import { AssignRow } from './AutoControls'
import { registerLiveOverlay } from './liveOverlay'
import { useModSlide } from './useModSlide'
import { showToast } from './Toast'
import { placeAssemblage } from '../assemble/place'
import { playableVideoUrl } from './videoImport'
import { collageFromFolder, droppedPaths, dropKind, isFileDrag, openDroppedSession } from './fileDrop'
import { BoundedNumberInput } from './BoundedNumberInput'
import { CapturePicker } from './CapturePicker'
import { DevicePicker } from './DevicePicker'
import { NdiPicker } from './NdiPicker'
import { HivePicker } from './HivePicker'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { FxAddSelect, FxChips } from './FxRackPanel'
import { MidiLearnOverlay } from './MidiLearnOverlay'
import { SearchSelect, type SearchOption } from './SearchSelect'
import { ConfirmModal, PromptModal } from './PromptModal'
import { useFlash } from './useFlash'
import { Blink } from './Blink'
import { PinZone, usePinItems } from './Pin'
import { layerPin, layerSpeedPin } from '../persist'
import { SOURCE_EDITOR_KEY } from '../shaders/userShaders'

export function LayerPanel({ index }: { index: number }): JSX.Element {
  const layer = useStore((s) => s.composition.layers[index])
  const setBlend = useStore((s) => s.setBlend)
  const setOpacity = useStore((s) => s.setOpacity)
  const toggleMute = useStore((s) => s.toggleMute)
  const toggleSolo = useStore((s) => s.toggleSolo)
  const toggleFeedback = useStore((s) => s.toggleFeedback)
  const setFeedbackAmount = useStore((s) => s.setFeedbackAmount)
  const setSourceMix = useStore((s) => s.setSourceMix)
  const couplingOn = useStore((s) => s.couplingOn)
  const setRightView = useStore((s) => s.setRightView)
  const setSourceBlend = useStore((s) => s.setSourceBlend)
  const setSourceShader = useStore((s) => s.setSourceShader)
  const setSourceVideo = useStore((s) => s.setSourceVideo)
  const setSourceCapture = useStore((s) => s.setSourceCapture)
  const setSourceHive = useStore((s) => s.setSourceHive)
  const setLayerSpeed = useStore((s) => s.setLayerSpeed)
  const varyLayer = useStore((s) => s.varyLayer)
  const setLayerVary = useStore((s) => s.setLayerVary)
  const varyPulse = useStore((s) => s.varyPulse[index] ?? 0)
  const setSelection = useStore((s) => s.setSelection)
  const selection = useStore((s) => s.selection)
  const collapsed = useStore((s) => !!s.collapsed[`layer${index}`])
  const toggleSection = useStore((s) => s.toggleSection)
  const initLayer = useStore((s) => s.initLayer)
  const randomizeLayer = useStore((s) => s.randomizeLayer)
  const randomizeLayerFx = useStore((s) => s.randomizeLayerFx)
  const layerPresets = useStore((s) => s.layerPresets)
  const saveLayerPreset = useStore((s) => s.saveLayerPreset)
  const applyLayerPreset = useStore((s) => s.applyLayerPreset)
  const deleteLayerPreset = useStore((s) => s.deleteLayerPreset)
  const copyLayer = useStore((s) => s.copyLayer)
  const pasteLayer = useStore((s) => s.pasteLayer)
  const hasCopiedLayer = useStore((s) => s.copiedLayer !== null)

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  // Which OUT drawer is open (blend, mask, feedback) : one at a time.
  const [outTab, setOutTab] = useState<OutTab | null>(null)
  const [savePrompt, setSavePrompt] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [flashing, flash] = useFlash()

  // ── Modulation of the compositor-level layer controls (opacity / A-B mix /
  // blend). A small M chip beside each toggles its M1–8 binding row; bound
  // sliders tint accent2 and MOVE with the live value (the app-wide behaviour).
  type LayerField = 'opacity' | 'mix' | 'blend' | 'vary'
  const modMatrix = useStore((s) => s.composition.modMatrix)
  const [openMod, setOpenMod] = useState<LayerField | null>(null)
  const layerTarget = (field: LayerField): ModTarget => ({ kind: 'layer', layer: index, field })
  const boundFor = (field: LayerField): typeof modMatrix => {
    const key = modTargetKey(layerTarget(field))
    return modMatrix.filter((a) => modTargetKey(a.target) === key)
  }
  const opacityBound = boundFor('opacity').length > 0
  const varyBound = boundFor('vary').length > 0
  const mixBound = boundFor('mix').length > 0
  const blendBound = boundFor('blend').length > 0
  const hasB = !!layer.sourceB && layer.sourceB.kind !== 'none'
  const coupled = couplingOn && hasB && layer.coupling.mode !== 'off'
  const opacityRef = useRef<HTMLInputElement | null>(null)
  const mixRef = useRef<HTMLInputElement | null>(null)
  // a modulated slider : a drag moves the base by as much as the thumb moves
  const opacitySlide = useModSlide(opacityBound, layer.opacity, 0, 1, (v) => setOpacity(index, v))
  const mixSlide = useModSlide(mixBound, layer.sourceMix, 0, 1, (v) => setSourceMix(index, v))
  // The blend tab's word, live too while modulated (the loop fills it, never
  // React : seeded at mount, back to the base once the modulation stops).
  const blendTabRef = useRef<HTMLSpanElement | null>(null)
  const blendBase = useRef(layer.blend)
  blendBase.current = layer.blend
  useEffect(() => {
    const offs: Array<() => void> = []
    if (opacityBound && opacityRef.current)
      offs.push(registerLiveOverlay({ el: opacityRef.current, key: modTargetKey(layerTarget('opacity')), format: (x) => String(x) }))
    if (mixBound && mixRef.current)
      offs.push(registerLiveOverlay({ el: mixRef.current, key: modTargetKey(layerTarget('mix')), format: (x) => String(x) }))
    // (the blend menu in the drawer shows its live mode itself : BlendSelect)
    const tab = blendTabRef.current
    if (blendBound && tab) {
      const show = (m: string): void => {
        if (tab.textContent !== m) tab.textContent = m
      }
      offs.push(registerLiveOverlay({ key: modTargetKey(layerTarget('blend')), apply: (x) => show(blendLabel(blendAt(x))), idle: () => show(blendLabel(blendBase.current)) }))
    }
    return () => offs.forEach((o) => o())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opacityBound, mixBound, blendBound, collapsed, index, outTab])

  // The M chip beside a layer control : accent when bound, accent2 while its
  // binding row is open. Right-click clears every modulation on that field.
  const modChip = (field: LayerField, label: string): JSX.Element => {
    const bound = boundFor(field)
    const active = openMod === field
    return (
      <button
        onClick={(e) => {
          e.stopPropagation()
          setOpenMod(active ? null : field)
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          e.stopPropagation()
          const st = useStore.getState()
          const key = modTargetKey(layerTarget(field))
          st.composition.modMatrix
            .filter((a) => modTargetKey(a.target) === key)
            .forEach((a) => st.removeAssignment(a.id))
          st.composition.metaKnobs.forEach((k, i) => {
            if (k.destinations.some((d) => modTargetKey(d) === key)) st.toggleMetaDest(i, layerTarget(field))
          })
        }}
        className={`shrink-0 rounded px-1 font-mono text-[9px] leading-4 transition-colors ${
          bound.length
            ? 'bg-accent/20 text-accent ring-1 ring-accent'
            : active
              ? 'bg-accent2/25 text-accent2 ring-1 ring-accent2'
              : 'bg-panel3/60 text-muted hover:text-text'
        }`}
        title={`Modulate ${label} : right-click clears its modulation`}
      >
        M{bound.length ? bound.map((b) => b.mod + 1).join('·') : ''}
      </button>
    )
  }
  const modAssign = (field: LayerField): JSX.Element | null =>
    openMod === field ? (
      <div className="px-1 pb-0.5">
        <AssignRow target={layerTarget(field)} bound={boundFor(field)} />
      </div>
    ) : null

  const isSelected = (slot: 'A' | 'B'): boolean =>
    selection?.type === 'source' && selection.layer === index && selection.slot === slot

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }
  // the whole layer persistent : no scene, Randomize, Generate or World changes it
  const wholeKey = layerPin(index)
  const wholePinned = useStore((s) => s.pins.includes(wholeKey))
  const wholeItems = usePinItems(wholeKey, `L${index + 1}, the whole layer`, { pin: 'Persistent layer', every: 'Set this layer in every scene' })

  const menuItems: MenuItem[] = [
    ...wholeItems,
    { divider: true, label: '' },
    { label: 'Init layer', onClick: () => initLayer(index) },
    { label: 'Randomize layer', onClick: () => randomizeLayer(index) },
    // An empty source has nothing to process : its rack is not offered
    { label: 'Randomize effects for source A', onClick: () => randomizeLayerFx(index, 'A'), disabled: !layer.sourceA || layer.sourceA.kind === 'none' },
    { label: 'Randomize effects for source B', onClick: () => randomizeLayerFx(index, 'B'), disabled: !layer.sourceB || layer.sourceB.kind === 'none' },
    { label: 'Randomize layer FX', onClick: () => randomizeLayerFx(index, 'layer') },
    { divider: true, label: '' },
    { label: 'Copy layer', onClick: () => copyLayer(index) },
    {
      label: hasCopiedLayer ? 'Paste layer' : 'Paste layer (empty)',
      onClick: () => pasteLayer(index),
      disabled: !hasCopiedLayer
    },
    { divider: true, label: '' },
    { label: 'Save layer as preset…', onClick: () => setSavePrompt(true) },
    ...layerPresets.map((p) => ({
      label: p.name,
      onClick: () => applyLayerPreset(index, p.id),
      onDelete: () => setDeleteTarget({ id: p.id, name: p.name }),
      deleteTitle: `Delete layer preset "${p.name}"`
    }))
  ]

  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 rounded-md border bg-panel p-2 transition-colors ${
        flashing ? 'animate-pulse border-accent ring-1 ring-accent' : 'border-border'
      }`}
      style={wholePinned && !flashing ? { borderColor: 'rgb(var(--c-pin) / 0.75)' } : undefined}
      onContextMenu={onContextMenu}
    >
      {/* Header: chevron · LAYER n · opacity · S/M/FB */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={() => toggleSection(`layer${index}`)}
          className="flex shrink-0 items-center gap-1"
          title={collapsed ? 'Expand layer' : 'Collapse layer'}
        >
          <span
            className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}
          >
            ▶
          </span>
          <span
            className="font-mono text-[11px]"
            style={{ color: wholePinned ? 'rgb(var(--c-pin))' : 'rgb(var(--c-muted))' }}
            title={wholePinned ? 'Persistent : no scene, Randomize or Generate changes this layer (right-click the layer to unpin)' : undefined}
          >
            L{index + 1}
          </span>
        </button>
        <PinZone pin={modTargetKey(layerTarget('opacity'))} label={`L${index + 1} opacity`}>
        <span className="relative flex min-w-0 flex-1">
          <MidiLearnOverlay id={`layer:${index}:opacity`} />
          <input
            ref={opacityRef}
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={layer.opacity}
            {...opacitySlide}
            onDoubleClick={() => setOpacity(index, 1)}
            className={`w-full ${opacityBound ? 'accent-accent2' : 'accent-accent'}`}
            title={`Opacity ${layer.opacity.toFixed(2)} : ${opacityBound ? 'modulated (a drag moves the base by as much as you move it)' : 'double-click resets to 1'}`}
          />
        </span>
        </PinZone>
        {modChip('opacity', 'layer opacity')}
        <div className="flex shrink-0 gap-1">
          <ToggleChip label="S" active={layer.solo} onClick={() => toggleSolo(index)} title="Solo" />
          <ToggleChip label="⊘" active={layer.mute} onClick={() => toggleMute(index)} title="Mute" />
          <ToggleChip
            label="FB"
            active={layer.feedback}
            onClick={() => toggleFeedback(index)}
            title="Feedback : this layer samples its own previous frame (trails; their length in the feedback tab)"
          />
          <span className="relative inline-flex">
            <MidiLearnOverlay id={`rand:layer:${index}`} />
            <button
              onClick={() => {
                randomizeLayer(index)
                flash()
              }}
              title="Randomize this whole layer (sources, FX, blend, feedback)"
              className={`rounded px-1.5 py-0.5 font-mono text-[11px] leading-none transition-colors ${
                flashing ? 'animate-pulse text-accent' : 'text-muted hover:bg-accent/15 hover:text-accent'
              }`}
            >
              ⚄
            </button>
          </span>
        </div>
      </div>
      {modAssign('opacity')}
      {collapsed &&
        (() => {
          const srcLabel = (slot?: SourceSlot | null): string | null => {
            if (!slot || slot.kind === 'none') return null
            if (slot.shaderId) return SHADER_BY_ID[slot.shaderId]?.name ?? slot.shaderId
            return slot.mediaName || slot.kind
          }
          const a = srcLabel(layer.sourceA)
          const b = srcLabel(layer.sourceB)
          const fxCount = layer.fx.length + layer.sourceAFx.length + layer.sourceBFx.length
          return (
            <div
              className="flex min-w-0 items-center gap-1 px-1 font-mono text-[9px] text-muted"
              title="What this collapsed layer holds (expand to edit)"
            >
              <span className="min-w-0 truncate">{a && b ? `${a} + ${b}` : (a ?? b ?? 'empty')}</span>
              {fxCount > 0 && <span className="shrink-0 text-muted/70">· {fxCount} fx</span>}
              {layer.feedback && <span className="shrink-0 text-accent2/80">· FB</span>}
              {layer.mute && <span className="shrink-0 text-danger/80">· muted</span>}
              {layer.solo && <span className="shrink-0 text-accent/80">· solo</span>}
            </div>
          )
        })()}

      {!collapsed && (
        <>
          {/* The layer reads top to bottom in the order the picture goes
              through it, its four steps named in the left margin, each on a
              panel of its color : IN the two sources, side by side, MIX where
              they meet, FX the effects on the mixed picture, OUT how it lands
              on the layers below (tabs, a drawer opened on demand). Speed and
              Vary, which act on all of it, share the last line, under a rule.
              No boxes, no title lines : as compact as the old strip. */}
          <div className="relative flex min-w-0 flex-col gap-1.5">
            {/* 1 · SOURCES */}
            <div className="-mx-1 -my-[2px] flex min-w-0 items-start gap-1.5 rounded-[5px] px-1 py-[2px]" style={{ background: STEP_TINT[1] }}>
              <StepLabel n={1} title="Sources : what the layer shows (A and B, each with its own effects)" />
              <div className="flex min-w-0 flex-1 items-start gap-1.5">
                <SourceRow
                  card
                  label="A"
                  shaderId={layer.sourceA.shaderId}
                  sourceKind={layer.sourceA.kind}
                  mediaId={layer.sourceA.mediaId}
                  mediaName={layer.sourceA.mediaName}
                  selected={isSelected('A')}
                  scope={{ kind: 'sourceA', layer: index }}
                  fx={layer.sourceAFx}
                  onSelect={() => setSelection({ type: 'source', layer: index, slot: 'A' })}
                  onPick={(id) => setSourceShader(index, 'A', id)}
                  onPickVideo={(url, name, path) => setSourceVideo(index, 'A', url, name, path)}
                  onPickCapture={(spec, name) => setSourceCapture(index, 'A', spec, name)}
                  onPickHive={(host, port) => setSourceHive(index, 'A', host, port)}
                />
                {/* a thin line between A and B */}
                <span className="w-px shrink-0 self-stretch bg-border" aria-hidden="true" />
                <SourceRow
                  card
                  label="B"
                  shaderId={layer.sourceB?.shaderId ?? null}
                  sourceKind={layer.sourceB?.kind ?? 'none'}
                  mediaId={layer.sourceB?.mediaId}
                  mediaName={layer.sourceB?.mediaName}
                  selected={isSelected('B')}
                  scope={{ kind: 'sourceB', layer: index }}
                  fx={layer.sourceBFx}
                  onSelect={() => setSelection({ type: 'source', layer: index, slot: 'B' })}
                  onPick={(id) => setSourceShader(index, 'B', id)}
                  onPickVideo={(url, name, path) => setSourceVideo(index, 'B', url, name, path)}
                  onPickCapture={(spec, name) => setSourceCapture(index, 'B', spec, name)}
                  onPickHive={(host, port) => setSourceHive(index, 'B', host, port)}
                />
              </div>
            </div>

            {/* 2 · MIX : how B meets A, and how much (what the slider means
                follows the mode : its tooltip says). Dimmed while B is empty.
                The A/B harmony and the coupling live in the Mixer (M) : the ≈
                chip says this layer is coupled. */}
            <div className="-mx-1 -my-[2px] flex min-w-0 items-start gap-1.5 rounded-[5px] px-1 py-[2px]" style={{ background: STEP_TINT[2] }}>
              <StepLabel n={2} title={hasB ? `Mix : how A and B meet (${mixWord(layer.sourceBlend)})` : 'Mix : no Source B yet, pick one above'} />
              <div className={`flex min-w-0 flex-1 flex-col gap-1 ${hasB ? '' : 'opacity-40'}`}>
                <div className="flex min-h-[26px] min-w-0 items-center gap-1.5">
                  <PinZone pin={modTargetKey(layerTarget('mix'))} label={`L${index + 1} A·B mix`}>
                  <span className="shrink-0 font-mono text-[9px] text-text/80">A</span>
                  <span className="relative flex min-w-0 flex-1">
                    <MidiLearnOverlay id={`layer:${index}:mix`} />
                    <input
                      ref={mixRef}
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={layer.sourceMix}
                      {...mixSlide}
                      onDoubleClick={() => setSourceMix(index, 0.5)}
                      className={`w-full min-w-0 ${mixBound ? 'accent-accent2' : 'accent-accent'}`}
                      title={!hasB ? 'No Source B : pick one above and this mixes it with A' : mixBound ? `${mixTitle(layer.sourceBlend)} : modulated (a drag moves the base by as much as you move it)` : mixTitle(layer.sourceBlend)}
                    />
                  </span>
                  <span className="shrink-0 font-mono text-[9px] text-accent">B</span>
                  {/* the mix in percent, typed or read : as wide as its longest
                      number ("33.3", in its own font : a wider Mac monospace too) */}
                  <span className="flex shrink-0 items-center gap-0.5" title={mixTitle(layer.sourceBlend)}>
                    <BoundedNumberInput
                      value={Math.round(layer.sourceMix * 1000) / 10}
                      min={0}
                      max={100}
                      maxFrac={1}
                      onChange={(v) => setSourceMix(index, v / 100)}
                      className={`input w-[calc(4ch+7px)] !px-0.5 !py-0.5 text-right !text-[10px] tabular-nums ${mixBound ? 'text-accent2' : ''}`}
                    />
                    <span className="font-mono text-[9px] text-muted">%</span>
                  </span>
                  </PinZone>
                  {/* as wide as its longest mode, the same in every mode (no
                      fixed width : an invisible stack of every name sizes it),
                      so "lighter color" is never cut */}
                  <BlendSelect
                    fit
                    className="input select-compact shrink-0 text-[10px]"
                    value={layer.sourceBlend}
                    onChange={(m) => setSourceBlend(index, m)}
                    title="How B meets A : the slider beside it is what this mode makes of it"
                  />
                  {coupled && (
                    <button
                      onClick={() => setRightView('mixer')}
                      className="shrink-0 rounded bg-accent/20 px-1 font-mono text-[10px] leading-4 text-accent ring-1 ring-accent/60 hover:bg-accent/30"
                      title={`Coupled to the sound (${couplingWords(layer.coupling)}) : it pushes this mix. Set it in the Mixer (click, or M)`}
                    >
                      ≈
                    </button>
                  )}
                  {modChip('mix', 'A-B mix')}
                </div>
                {modAssign('mix')}
              </div>
            </div>

            {/* 3 · LAYER FX : the effects on the mixed picture */}
            <div className="-mx-1 -my-[2px] flex min-w-0 items-start gap-1.5 rounded-[5px] px-1 py-[2px]" style={{ background: STEP_TINT[3] }}>
              <StepLabel n={3} title="Layer FX : the effects on the mixed picture" />
              <div className="flex min-h-[26px] min-w-0 flex-1 items-center">
                <FxChips
                  scope={{ kind: 'layer', layer: index }}
                  fx={layer.fx}
                  leading={
                    <>
                      <FxAddSelect scope={{ kind: 'layer', layer: index }} className="w-[3.4rem] shrink-0" />
                      {/* the whole chain off, or all back on (as on each source) */}
                      {layer.fx.length > 0 && <ChainSwitch scope={{ kind: 'layer', layer: index }} fx={layer.fx} />}
                    </>
                  }
                />
              </div>
            </div>

            {/* 4 · OUT : how it lands on the layers below. Each tab says where
                it stands; a click opens its drawer, another closes it. */}
            <div className="-mx-1 -my-[2px] flex min-w-0 items-start gap-1.5 rounded-[5px] px-1 py-[2px]" style={{ background: STEP_TINT[4] }}>
              <StepLabel n={4} title="Out : how the layer lands on the layers below" small />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
              {/* Each tab as wide as its words (the short ones give room to
                  the long), the blend's mode alone, the feedback's amount never
                  cut : a long mode or mask name gives way first. */}
              <div className="flex min-w-0 overflow-hidden rounded border border-border">
                {(
                  [
                    ['blend', blendLabel(layer.blend), blendBound],
                    ['mask', layer.mask.mode > 0 ? `mask ${MASK_MODES[layer.mask.mode] ?? 'none'}${layer.mask.invert ? ' inv' : ''}` : 'no mask', false],
                    ['feedback', layer.feedback ? `fb ${layer.feedbackAmount.toFixed(2)}` : 'fb off', false]
                  ] as Array<[OutTab, string, boolean]>
                ).map(([k, text, mod]) => (
                  <button
                    key={k}
                    onClick={() => setOutTab(outTab === k ? null : k)}
                    className={`flex-auto border-r border-border px-1 py-0.5 font-mono text-[10px] last:border-r-0 transition-colors ${
                      k === 'feedback' ? 'shrink-0 whitespace-nowrap' : 'min-w-0 truncate'
                    } ${
                      outTab === k
                        ? 'bg-accent/20 text-accent'
                        : mod
                          ? 'text-accent2 hover:bg-panel3/60'
                          : (k === 'mask' && layer.mask.mode > 0) || (k === 'feedback' && layer.feedback)
                            ? 'text-text hover:bg-panel3/60'
                            : 'text-muted hover:bg-panel3/60 hover:text-text'
                    }`}
                    title={`${k === 'blend' ? 'Blend : how this layer lands on the layers below' : k === 'mask' ? 'Mask : where this layer shows : its own brightness, a fade, or a window' : 'Feedback : trails, the layer samples its own previous frame'} (click to ${outTab === k ? 'close' : 'open'})`}
                  >
                    {k === 'blend' && mod ? (
                      <span
                        ref={(el) => {
                          blendTabRef.current = el
                          if (el && !el.textContent) el.textContent = text
                        }}
                      />
                    ) : (
                      text
                    )}
                  </button>
                ))}
              </div>
              {/* the open drawer, under the tabs, on the step's panel */}
              {outTab && (
                <div className="flex min-w-0 flex-col gap-1 border-l-2 pl-1.5" style={{ borderColor: STEP_EDGE[4] }}>
                  {outTab === 'blend' && (
                    <>
                      <Row label="BLEND">
                        <PinZone pin={modTargetKey(layerTarget('blend'))} label={`L${index + 1} blend`}>
                        <BlendSelect
                          className={`input select-compact min-w-0 flex-1 text-[11px] ${blendBound ? 'text-accent2 ring-1 ring-accent2' : ''}`}
                          value={layer.blend}
                          onChange={(m) => setBlend(index, m)}
                          liveKey={blendBound ? modTargetKey(layerTarget('blend')) : undefined}
                        />
                        </PinZone>
                        {modChip('blend', 'blend mode')}
                      </Row>
                      {modAssign('blend')}
                    </>
                  )}
                  {outTab === 'mask' && <MaskControls index={index} mask={layer.mask} />}
                  {outTab === 'feedback' && (
                    // on or off, the same row : the trail stays put, asleep while off
                    <Row label="TRAIL">
                      <ToggleChip
                        label={layer.feedback ? 'on' : 'off'}
                        active={layer.feedback}
                        onClick={() => toggleFeedback(index)}
                        title="Feedback : this layer samples its own previous frame (trails)"
                      />
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.01}
                        value={layer.feedbackAmount}
                        onChange={(e) => setFeedbackAmount(index, Number(e.target.value))}
                        className={`min-w-0 flex-1 accent-accent ${layer.feedback ? '' : 'opacity-40'}`}
                        title={layer.feedback ? 'Feedback persistence : decay trails (capped below infinite bloom)' : 'Feedback is off : the trail it will have when on'}
                      />
                      <div className={`w-11 shrink-0 ${layer.feedback ? '' : 'opacity-40'}`}>
                        <BoundedNumberInput
                          value={Math.round(layer.feedbackAmount * 100) / 100}
                          min={0}
                          max={1}
                          onChange={(v) => setFeedbackAmount(index, v)}
                          className="input w-full px-1 py-0.5 text-right text-[11px]"
                        />
                      </div>
                    </Row>
                  )}
                </div>
              )}
              </div>
            </div>
          </div>


          {/* Speed and Vary act on the whole layer : one line, under a rule */}
          <div className="border-t border-border/80" />
          <div className="flex min-w-0 items-center gap-1.5">
            <PinZone pin={layerSpeedPin(index)} label={`L${index + 1} speed`}>
            <span className="shrink-0 font-mono text-[9px] uppercase text-muted">speed</span>
            <input
              type="range"
              min={0}
              max={20}
              step={0.05}
              value={layer.speed}
              onChange={(e) => setLayerSpeed(index, Number(e.target.value))}
              onDoubleClick={() => setLayerSpeed(index, 1)}
              className="min-w-0 flex-1 accent-accent"
              title="Layer time : scales every source and FX clock on this layer (1 = realtime) : double-click resets"
            />
            {/* as wide as its longest number ("12.35") */}
            <BoundedNumberInput
              value={Math.round(layer.speed * 100) / 100}
              min={0}
              max={20}
              onChange={(v) => setLayerSpeed(index, v)}
              className="input w-[calc(5ch+7px)] shrink-0 !px-0.5 !py-0.5 text-right !text-[10px] tabular-nums"
            />
            </PinZone>
            {/* VARY : the global Vary, aimed at this layer alone; a modulation
                target like the other layer fields, so a modulator can fire it. */}
            <button
              onClick={() => varyLayer(index)}
              className={`relative ${TBTN} ${varyBound ? TBTN_MOD : TBTN_IDLE}`}
              title="Nudge THIS layer around where it already sits : its sources, its racks and their parameters move by the amount beside this, and nothing else in the composition changes. Bind the M to fire it from a modulator."
            >
              Vary
              <Blink n={varyPulse} color="accent2" />
            </button>
            {modChip('vary', 'Vary (a modulator fires it)')}
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={layer.varyAmount ?? DEFAULT_LAYER_VARY}
              onChange={(e) => setLayerVary(index, Number(e.target.value))}
              onDoubleClick={() => setLayerVary(index, DEFAULT_LAYER_VARY)}
              className="min-w-0 flex-1 accent-accent"
              title="How far one Vary moves this layer : double-click resets"
            />
            <BoundedNumberInput
              value={layer.varyAmount ?? DEFAULT_LAYER_VARY}
              min={0}
              max={1}
              maxFrac={2}
              onChange={(v) => setLayerVary(index, v)}
              className="input w-[calc(4ch+7px)] shrink-0 !px-0.5 !py-0.5 text-right !text-[10px] tabular-nums"
            />
          </div>
          {/* The binding row this chip opens. Without it the M toggled state
              that nothing rendered, so the chip looked dead. */}
          {modAssign('vary')}
        </>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          header={`Layer ${index + 1}`}
          items={menuItems}
          onClose={() => setMenu(null)}
        />
      )}
      {savePrompt && (
        <PromptModal
          title="Layer preset name?"
          placeholder="e.g. Contour + trails"
          confirmLabel="Save"
          onConfirm={(name) => {
            saveLayerPreset(index, name)
            setSavePrompt(false)
          }}
          onCancel={() => setSavePrompt(false)}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title={`Are you sure you want to delete the layer preset "${deleteTarget.name}"?`}
          onYes={() => {
            deleteLayerPreset(deleteTarget.id)
            setDeleteTarget(null)
          }}
          onNo={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function ToggleChip({
  label,
  active,
  onClick,
  title
}: {
  label: string
  active: boolean
  onClick: () => void
  title: string
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
        active
          ? 'bg-accent/20 text-accent ring-1 ring-accent'
          : 'bg-panel2 text-muted hover:text-text'
      }`}
    >
      {label}
    </button>
  )
}

// Per-layer spatial mask : mode + invert, then the mode's own params. Multiplies
// the layer's contribution to the stack (beyond blend + opacity).
const MASK_MODES = ['none', 'luma', 'gradient', 'shape']
function MaskControls({ index, mask }: { index: number; mask: LayerMask }): JSX.Element {
  const setLayerMask = useStore((s) => s.setLayerMask)
  const set = (p: Partial<LayerMask>): void => setLayerMask(index, p)
  const def = makeDefaultMask()
  const sl = (label: string, key: keyof LayerMask, min = 0, max = 1, step = 0.01): JSX.Element => {
    const v = mask[key] as number
    const d = def[key] as number
    return (
      <Row label={label}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={v}
          onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<LayerMask>)}
          onDoubleClick={() => set({ [key]: d } as Partial<LayerMask>)}
          className="min-w-0 flex-1 accent-accent"
          title={`${label} ${v.toFixed(2)} : double-click resets to ${d}`}
        />
        <span className="w-8 shrink-0 text-right font-mono text-[9px] text-muted">{v.toFixed(2)}</span>
      </Row>
    )
  }
  return (
    <>
      <Row label="MASK">
        <select
          className="input select-compact min-w-0 flex-1 text-[11px]"
          value={mask.mode}
          onChange={(e) => set({ mode: Number(e.target.value) })}
          title="Spatial mask on this layer : luma (its own brightness), gradient (a linear fade), or shape (a box↔ellipse window)."
        >
          {MASK_MODES.map((m, i) => (
            <option key={m} value={i}>
              {m}
            </option>
          ))}
        </select>
        {mask.mode > 0 && (
          <button
            onClick={() => set({ invert: !mask.invert })}
            className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
              mask.invert ? 'border-accent bg-accent/15 text-accent' : 'border-border text-muted hover:text-text'
            }`}
            title="Invert the mask"
          >
            inv
          </button>
        )}
      </Row>
      {mask.mode === 1 && (<>{sl('LO', 'lumaLo')}{sl('HI', 'lumaHi')}{sl('SOFT', 'soft')}</>)}
      {mask.mode === 2 && (<>{sl('ANGLE', 'angle', 0, 6.283)}{sl('POS', 'pos')}{sl('SOFT', 'soft')}</>)}
      {mask.mode === 3 && (
        // the window's place on a pad at the right, its size and shape at the left
        <div className="flex min-w-0 items-start gap-1.5">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            {sl('SIZE', 'size')}{sl('ASPECT', 'aspect', 0.2, 3)}{sl('ROUND', 'round')}{sl('SOFT', 'soft')}
          </div>
          <XYPad
            x={mask.cx}
            y={mask.cy}
            onChange={(cx, cy) => set({ cx, cy })}
            onReset={() => set({ cx: def.cx, cy: def.cy })}
            title={`The window's place : x ${mask.cx.toFixed(2)}, y ${mask.cy.toFixed(2)} (drag; double-click : the middle)`}
          />
        </div>
      )}
    </>
  )
}

type OutTab = 'blend' | 'mask' | 'feedback'

// A power glyph (the chain's on/off).
function PowerIcon({ size = 10 }: { size?: number }): JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
      <path d="M3.4 3.2a4.2 4.2 0 1 0 5.2 0" />
      <path d="M6 1.2v4.3" />
    </svg>
  )
}

// One effect chain on or off (a source's, the layer's) : lit while every unit
// is on, half lit while some are off; a click turns them all off, or all back on.
function ChainSwitch({ scope, fx }: { scope: Parameters<typeof FxAddSelect>[0]['scope']; fx: Parameters<typeof FxChips>[0]['fx'] }): JSX.Element {
  const toggleRackChain = useStore((s) => s.toggleRackChain)
  const on = fx.filter((f) => f.enabled).length
  const all = on === fx.length
  return (
    <button
      onClick={(e) => {
        e.stopPropagation()
        toggleRackChain(scope)
      }}
      className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded transition-colors ${
        all
          ? 'bg-accent/20 text-accent ring-1 ring-accent/60'
          : on > 0
            ? 'bg-accent/10 text-accent/70 ring-1 ring-accent/30'
            : 'bg-panel3/60 text-muted hover:text-text'
      }`}
      title={all ? 'This chain is on : click to turn all its effects off' : on > 0 ? `${on} of ${fx.length} effects on : click to turn them all on` : 'This chain is off : click to turn all its effects on'}
    >
      <PowerIcon />
    </button>
  )
}

// Each step's color (styles.css --c-step1..4 : sources, mix, layer FX, out) :
// its word, its panel's tint, an edge where it needs one.
const STEP_TINT: Record<number, string> = {
  1: 'rgb(var(--c-step1) / 0.1)', 2: 'rgb(var(--c-step2) / 0.1)', 3: 'rgb(var(--c-step3) / 0.1)', 4: 'rgb(var(--c-step4) / 0.1)'
}
const STEP_EDGE: Record<number, string> = {
  1: 'rgb(var(--c-step1) / 0.5)', 2: 'rgb(var(--c-step2) / 0.5)', 3: 'rgb(var(--c-step3) / 0.5)', 4: 'rgb(var(--c-step4) / 0.5)'
}

// A step's word in the left margin (IN, MIX, FX, OUT : the order the picture
// goes through the layer), in the step's color, centered on its row's first
// line; the title says what the step does. As narrow as the number it replaced.
const STEP_WORD: Record<number, string> = { 1: 'IN', 2: 'MIX', 3: 'FX', 4: 'OUT' }

function StepLabel({ n, title, small = false }: { n: number; title: string; small?: boolean }): JSX.Element {
  return (
    <span
      className={`w-[17px] shrink-0 cursor-default select-none font-mono text-[9px] leading-[13px] ${small ? 'mt-[4px]' : 'mt-[6px]'}`}
      style={{ color: `rgb(var(--c-step${n}))` }}
      title={title}
    >
      {STEP_WORD[n]}
    </span>
  )
}

// A small X/Y pad (0..1 each, y up), for a mask window's place. Pointer
// mapped through the pad's own rectangle (the UI zoom is a CSS zoom).
function XYPad({ x, y, onChange, onReset, title }: { x: number; y: number; onChange: (x: number, y: number) => void; onReset: () => void; title: string }): JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null)
  const drag = useRef<number | null>(null)
  const at = (e: { clientX: number; clientY: number }): void => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const nx = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width))
    const ny = Math.max(0, Math.min(1, 1 - (e.clientY - r.top) / r.height))
    onChange(Math.round(nx * 100) / 100, Math.round(ny * 100) / 100)
  }
  return (
    <div
      ref={ref}
      className="relative h-[62px] w-[62px] shrink-0 cursor-crosshair rounded border border-border"
      style={{ touchAction: 'none', background: 'rgb(var(--c-input-bg))' }}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
        drag.current = e.pointerId
        at(e)
      }}
      onPointerMove={(e) => { if (drag.current === e.pointerId) at(e) }}
      onPointerUp={(e) => { if (drag.current === e.pointerId) drag.current = null }}
      onPointerCancel={() => { drag.current = null }}
      onDoubleClick={onReset}
      title={title}
    >
      <span className="pointer-events-none absolute inset-x-0 top-1/2 h-px bg-border/60" />
      <span className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-border/60" />
      <span
        className="pointer-events-none absolute h-2.5 w-2.5 -translate-x-1/2 translate-y-1/2 rounded-full bg-accent"
        style={{ left: `${x * 100}%`, bottom: `${y * 100}%` }}
      />
    </div>
  )
}

// Fixed 34px label gutter : every row in the strip aligns to it.
function Row({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <label className="w-[34px] shrink-0 font-mono text-[9px] uppercase text-muted">
        {label}
      </label>
      {children}
    </div>
  )
}

// FX chips rows sit indented under their owner's row, inside the gutter.
function Indented({ children }: { children: ReactNode }): JSX.Element {
  return <div className="min-w-0 pl-[40px]">{children}</div>
}

/** One source: [A] [picker] [+fx], with its FX chips underneath. */
function SourceRow({
  card = false,
  label,
  shaderId,
  sourceKind,
  mediaId,
  mediaName,
  selected,
  scope,
  fx,
  onSelect,
  onPick,
  onPickVideo,
  onPickCapture,
  onPickHive
}: {
  /** A card (layout 2 : A and B side by side) : the picker over the effects. */
  card?: boolean
  label: string
  shaderId: string | null
  sourceKind: SourceKind
  mediaId?: string
  mediaName?: string
  selected: boolean
  scope: Parameters<typeof FxAddSelect>[0]['scope']
  fx: Parameters<typeof FxChips>[0]['fx']
  onSelect: () => void
  onPick: (id: string | null) => void
  onPickVideo: (url: string, name: string, path?: string) => void
  onPickCapture: (spec: string, name: string) => void
  onPickHive: (host: string, port: number) => void
}): JSX.Element {
  const userGens = useStore((s) => s.userShaders).filter((u) => u.category === 'Generator')
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [showCapture, setShowCapture] = useState(false)
  const [showDevices, setShowDevices] = useState(false)
  const [showNdi, setShowNdi] = useState(false)
  const [showHive, setShowHive] = useState(false)
  // ffmpeg import conversion (DXV3 / HAP / ProRes → all-intra cache) : 0..1, null = idle.
  const [converting, setConverting] = useState<number | null>(null)

  async function importVideo(file: File): Promise<void> {
    let path = ''
    try {
      path = window.api.getMediaPath(file)
    } catch {
      /* getMediaPath unavailable */
    }
    // No path on disk (rare) : a session-only object URL, no folder to browse.
    if (!path) {
      onPickVideo(URL.createObjectURL(file), file.name)
      return
    }
    const url = await playableVideoUrl(path, file.name, setConverting)
    if (url) onPickVideo(url, file.name, path)
  }
  // Import audio : the file plays straight from disk (Chromium decodes WAV, MP3,
  // FLAC, Ogg, AAC; an AIFF falls back to its m4a copy in the engine).
  const audioRef = useRef<HTMLInputElement | null>(null)
  function importAudio(file: File): void {
    let path = ''
    try {
      path = window.api.getMediaPath(file)
    } catch {
      /* getMediaPath unavailable */
    }
    if (!path || (scope.kind !== 'sourceA' && scope.kind !== 'sourceB')) return
    useStore.getState().setSourceAudio(scope.layer, scope.kind === 'sourceA' ? 'A' : 'B', `opsia-media://local/${encodeURIComponent(path)}`, file.name, path)
  }
  // Files dragged in from the desktop : a film (imported, converted if it
  // must be), a sound (Import audio), or a folder (a Collage of its films).
  const [dropOver, setDropOver] = useState(false)
  async function onDropFiles(e: DragEvent): Promise<void> {
    const items = droppedPaths(e)
    if (openDroppedSession(items)) return // a session file opens, wherever it lands
    if (!items.length || (scope.kind !== 'sourceA' && scope.kind !== 'sourceB')) return
    const layer = scope.layer, slotName = scope.kind === 'sourceA' ? 'A' : 'B'
    const { path, name } = items[0]
    if (items.length > 1) showToast(`${items.length} files dropped : slot ${slotName} took the first (${name})`)
    const kind = dropKind(path)
    if (kind === 'video') {
      const url = await playableVideoUrl(path, name, setConverting)
      if (url) onPickVideo(url, name, path)
      return
    }
    if (kind === 'audio') {
      useStore.getState().setSourceAudio(layer, slotName, `opsia-media://local/${encodeURIComponent(path)}`, name, path)
      return
    }
    if ((await window.api.pathKind(path)) === 'dir') {
      await collageFromFolder(layer, slotName, path)
      return
    }
    showToast(`${name} : a layer slot takes a film, a sound file or a folder (a Collage of its films)`, 'warn', 5000)
  }
  const isAudio = sourceKind === 'audio'
  const isVideo = sourceKind === 'video'
  const isCapture = sourceKind === 'capture'
  const isHive = sourceKind === 'hive'
  const isAsm = sourceKind === 'assemble'
  // The select's value: a generator id, or a sentinel for the active video /
  // capture / assemble source, or '' for none.
  const value = isAudio
    ? '__audio__'
    : isAsm
    ? '__assemble__'
    : isVideo
    ? '__video__'
    : isHive
      ? '__cap_hive__'
      : isCapture
        ? mediaId === 'webcam'
          ? '__cap_webcam__'
          : mediaId?.startsWith('device:')
            ? '__cap_live__'
            : mediaId?.startsWith('ndi:')
              ? '__cap_ndi__'
            : '__cap_screen__'
        : (shaderId ?? '')
  const active = isVideo || isAudio || isCapture || isHive || isAsm || !!shaderId
  return (
    <>
      <div
        className={
          card
            ? `flex min-w-0 flex-1 basis-0 flex-col gap-1 rounded transition-shadow ${dropOver ? 'ring-2 ring-accent' : ''}`
            : `flex min-w-0 items-center gap-1.5 rounded transition-shadow ${dropOver ? 'ring-2 ring-accent' : ''}`
        }
        onClick={onSelect}
        onDragOver={(e) => {
          if (!isFileDrag(e)) return
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'copy'
          if (!dropOver) setDropOver(true)
        }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropOver(false) }}
        onDrop={(e) => {
          if (!isFileDrag(e)) return
          e.preventDefault()
          e.stopPropagation()
          setDropOver(false)
          void onDropFiles(e)
        }}
        title={`Source ${label} : drop a film, a sound file or a folder here`}
      >
        {/* (a card : the label, the picker and "+ fx" on one line, the
            effects under them, led by the chain's on/off) */}
        <div className={card ? 'flex min-w-0 items-center gap-1' : 'contents'}>
        {/* A real button (it selects this source : its controls go to the
            Inspector); the click bubbles to the row's onSelect. */}
        <button
          type="button"
          className={`${TBTN} ${card ? 'w-[24px]' : 'w-[34px]'} shrink-0 px-0 text-center ${selected ? TBTN_LIT : active ? TBTN_IDLE_ON : TBTN_IDLE}`}
          title={`Source ${label} : show its controls in the Inspector`}
        >
          {label}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="video/*,.dxv,.mov,.avi,.mkv,.mpg,.mpeg,.mxf,.m2v"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void importVideo(file)
            e.target.value = '' // allow re-picking the same file
          }}
        />
        <input
          ref={audioRef}
          type="file"
          accept="audio/*,.wav,.mp3,.flac,.ogg,.oga,.opus,.aac,.m4a,.aif,.aiff,.wma,.caf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) importAudio(file)
            e.target.value = ''
          }}
        />
        {converting !== null && (
          <span
            className="shrink-0 animate-pulse font-mono text-[9px] text-accent"
            title="Converting to the all-intra cache (once per clip : later imports are instant)"
          >
            ⚙ {Math.round(converting * 100)}%
          </span>
        )}
        <SearchSelect
          className={`min-w-0 flex-1 text-[11px] ${selected ? 'border-accent' : ''}`}
          value={value}
          menuWidth={248}
          title="Source for this slot (type to search the generators)"
          options={[
            { value: '', label: 'none' },
            ...(isVideo
              ? [{ value: '__video__', label: mediaName || 'video', prefix: '🎞 ', group: 'live' }]
              : []),
            ...(isAsm
              ? [{ value: '__assemble__', label: mediaName || 'assemblage', prefix: '🎬 ', group: 'live' }]
              : []),
            ...(isAudio
              ? [{ value: '__audio__', label: mediaName || 'audio', prefix: '🔊 ', group: 'live' }]
              : []),
            { value: '__video_pick__', label: 'Import video…', prefix: '🎞 ', group: 'live' },
            { value: '__audio_pick__', label: 'Import audio…', prefix: '🔊 ', group: 'live', title: 'A sound file played in the layer like a film, its waveform on screen; its sound can drive any audio modulator (FROM)' },
            { value: '__assemble_pick__', label: 'Assemblage…', prefix: '🎬 ', group: 'live' },
            { value: '__cap_webcam__', label: 'Webcam', prefix: '📷 ', group: 'live' },
            { value: '__cap_live__', label: 'Live Input…', prefix: '🎥 ', group: 'live' },
            { value: '__cap_ndi__', label: 'NDI Input…', prefix: '📶 ', group: 'live', title: 'An NDI® source on the network : a camera, a phone, OBS, NDI Tools, another Palinopsia' },
            { value: '__cap_screen__', label: 'Screen…', prefix: '🖥 ', group: 'live' },
            { value: '__cap_hive__', label: 'HIVE stream…', prefix: '📡 ', group: 'live' },
            // The body silhouette joins the live entries, then living matter, then
            // analog video, then every other generator.
            ...userGens.map((u) => ({ value: u.id, label: u.name, group: 'my shaders', title: `One of your shaders (the Source Editor, ${SOURCE_EDITOR_KEY})` })),
            ...inPickerOrder(GENERATORS_ALPHA).map(
              (g): SearchOption => ({
                value: g.id,
                label: g.name,
                group: sourceSection(g),
                keywords: keywordsFor(g.id),
                title: generatorBlurb(g.id)
              })
            )
          ]}
          onChange={(v) => {
            if (v === '__video_pick__') fileRef.current?.click()
            else if (v === '__audio_pick__') audioRef.current?.click()
            else if (v === '__cap_webcam__') onPickCapture('webcam', 'Webcam')
            else if (v === '__cap_screen__') setShowCapture(true)
            else if (v === '__cap_live__') setShowDevices(true)
            else if (v === '__cap_ndi__') setShowNdi(true)
            else if (v === '__cap_hive__') setShowHive(true)
            // Assemblage… : the latest saved edit (or a fresh one from the corpus)
            // right here, selected so the Inspector shows how it plays; the tab
            // stays where it is (its button is in the Inspector).
            else if (v === '__assemble_pick__') {
              const ly = 'layer' in scope ? scope.layer : 0
              if (!placeAssemblage(ly, scope.kind === 'sourceB' ? 'B' : 'A'))
                showToast('No assemblage yet : make one from a folder of films in the assemble tab (E).', 'warn', 6000)
            }
            else if (v !== '__video__' && v !== '__assemble__' && v !== '__audio__') onPick(v || null)
          }}
        />
        {card && (
          <span className="shrink-0" onClick={(e) => e.stopPropagation()}>
            <FxAddSelect scope={scope} className="w-[3.4rem] shrink-0" />
          </span>
        )}
        </div>
        {/* +fx always present : the layout never shifts when sources load. */}
        {card ? (
          fx.length > 0 && (
            <div className="min-w-0" onClick={(e) => e.stopPropagation()}>
              <FxChips scope={scope} fx={fx} leading={<ChainSwitch scope={scope} fx={fx} />} />
            </div>
          )
        ) : (
          <span onClick={(e) => e.stopPropagation()}>
            <FxAddSelect scope={scope} className="w-[8.5rem] shrink-0" />
          </span>
        )}
      </div>
      {/* Only the FX the user adds appear below the row */}
      {!card && fx.length > 0 && (
        <div onClick={(e) => e.stopPropagation()}>
          <Indented>
            <FxChips scope={scope} fx={fx} />
          </Indented>
        </div>
      )}
      {showCapture && (
        <CapturePicker
          onPick={(spec, name) => {
            onPickCapture(spec, name)
            setShowCapture(false)
          }}
          onCancel={() => setShowCapture(false)}
        />
      )}
      {showNdi && (
        <NdiPicker
          onPick={(name) => {
            onPickCapture(`ndi:${name}`, name)
            setShowNdi(false)
          }}
          onCancel={() => setShowNdi(false)}
        />
      )}
      {showDevices && (
        <DevicePicker
          onPick={(id, name) => {
            onPickCapture(`device:${id}`, name)
            setShowDevices(false)
          }}
          onCancel={() => setShowDevices(false)}
        />
      )}
      {showHive && (
        <HivePicker
          onPick={(host, port) => {
            onPickHive(host, port)
            setShowHive(false)
          }}
          onCancel={() => setShowHive(false)}
        />
      )}
    </>
  )
}
