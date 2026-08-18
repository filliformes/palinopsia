// One layer strip (brief §10.2), compact form: opacity rides the header row;
// SRC A and SRC B sit side by side (their FX racks live BELOW as chips, so
// the columns stay narrow); every rack uses the chips layout : no blank
// space. Right-click anywhere on the strip: Init, Randomize layer, layer
// presets (save/apply/delete : app-persistent).

import { useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { AudioFeature, BlendMode, CouplingMode, LayerMask, SourceKind } from '@shared/types'
import { BLEND_MODES } from '@shared/types'
import { AUDIO_FEATURES } from '../engine/audioIn'
import { GENERATORS_ALPHA } from '../shaders/isf'
import { useStore } from '../store'
import { BoundedNumberInput } from './BoundedNumberInput'
import { CapturePicker } from './CapturePicker'
import { DevicePicker } from './DevicePicker'
import { HivePicker } from './HivePicker'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { FxAddSelect, FxChips } from './FxRackPanel'
import { SearchSelect, type SearchOption } from './SearchSelect'
import { ConfirmModal, PromptModal } from './PromptModal'
import { useFlash } from './useFlash'

export function LayerPanel({ index }: { index: number }): JSX.Element {
  const layer = useStore((s) => s.composition.layers[index])
  const setBlend = useStore((s) => s.setBlend)
  const setOpacity = useStore((s) => s.setOpacity)
  const toggleMute = useStore((s) => s.toggleMute)
  const toggleSolo = useStore((s) => s.toggleSolo)
  const toggleFeedback = useStore((s) => s.toggleFeedback)
  const setFeedbackAmount = useStore((s) => s.setFeedbackAmount)
  const setSourceMix = useStore((s) => s.setSourceMix)
  const setHarmony = useStore((s) => s.setHarmony)
  const showCoupling = useStore((s) => s.showCoupling)
  const setCoupling = useStore((s) => s.setCoupling)
  const setSourceBlend = useStore((s) => s.setSourceBlend)
  const setSourceShader = useStore((s) => s.setSourceShader)
  const setSourceVideo = useStore((s) => s.setSourceVideo)
  const setSourceCapture = useStore((s) => s.setSourceCapture)
  const setSourceHive = useStore((s) => s.setSourceHive)
  const setLayerSpeed = useStore((s) => s.setLayerSpeed)
  const setSelection = useStore((s) => s.setSelection)
  const selection = useStore((s) => s.selection)
  const collapsed = useStore((s) => !!s.collapsed[`layer${index}`])
  const toggleSection = useStore((s) => s.toggleSection)
  const initLayer = useStore((s) => s.initLayer)
  const randomizeLayer = useStore((s) => s.randomizeLayer)
  const layerPresets = useStore((s) => s.layerPresets)
  const saveLayerPreset = useStore((s) => s.saveLayerPreset)
  const applyLayerPreset = useStore((s) => s.applyLayerPreset)
  const deleteLayerPreset = useStore((s) => s.deleteLayerPreset)
  const copyLayer = useStore((s) => s.copyLayer)
  const pasteLayer = useStore((s) => s.pasteLayer)
  const hasCopiedLayer = useStore((s) => s.copiedLayer !== null)

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [savePrompt, setSavePrompt] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [flashing, flash] = useFlash()

  const isSelected = (slot: 'A' | 'B'): boolean =>
    selection?.type === 'source' && selection.layer === index && selection.slot === slot

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const menuItems: MenuItem[] = [
    { label: 'Init layer', onClick: () => initLayer(index) },
    { label: 'Randomize layer', onClick: () => randomizeLayer(index) },
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
        flashing ? 'animate-pulse border-danger ring-1 ring-danger' : 'border-border'
      }`}
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
          <span className="font-mono text-[11px] text-muted">L{index + 1}</span>
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={layer.opacity}
          onChange={(e) => setOpacity(index, Number(e.target.value))}
          onDoubleClick={() => setOpacity(index, 1)}
          className="min-w-0 flex-1 accent-accent"
          title={`Opacity ${layer.opacity.toFixed(2)} : double-click resets to 1`}
        />
        <div className="flex shrink-0 gap-1">
          <ToggleChip label="S" active={layer.solo} onClick={() => toggleSolo(index)} title="Solo" />
          <ToggleChip label="M" active={layer.mute} onClick={() => toggleMute(index)} title="Mute" />
          <ToggleChip
            label="FB"
            active={layer.feedback}
            onClick={() => toggleFeedback(index)}
            title="Feedback : this layer samples its own previous frame (trails)"
          />
          <button
            onClick={() => {
              randomizeLayer(index)
              flash()
            }}
            title="Randomize this whole layer (sources, FX, blend, feedback)"
            className={`rounded px-1.5 py-0.5 font-mono text-[11px] leading-none transition-colors ${
              flashing ? 'animate-pulse text-danger' : 'text-muted hover:bg-accent/15 hover:text-accent'
            }`}
          >
            ⚄
          </button>
        </div>
      </div>

      {!collapsed && (
        <>
          {/* SOURCE A: label · picker · +fx : its FX chips underneath */}
          <SourceRow
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
            onPickVideo={(url, name) => setSourceVideo(index, 'A', url, name)}
            onPickCapture={(spec, name) => setSourceCapture(index, 'A', spec, name)}
            onPickHive={(host, port) => setSourceHive(index, 'A', host, port)}
          />

          {/* MIX: combinator mode + depth : ALWAYS visible (fixed layout);
              inert until B has a source. */}
          <Row label="MIX">
            <select
              className="input select-compact w-20 shrink-0 text-[10px]"
              value={layer.sourceBlend}
              onChange={(e) => setSourceBlend(index, e.target.value as BlendMode)}
              title="How B combines with A : the slider is the depth"
            >
              {BLEND_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={layer.sourceMix}
              onChange={(e) => setSourceMix(index, Number(e.target.value))}
              className="min-w-0 flex-1 accent-accent"
              title="Mix depth : 0 = A only, 1 = full blend result"
            />
            <span className="shrink-0 font-mono text-[9px] text-muted" title="A/B harmony">⚖</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={layer.harmony}
              onChange={(e) => setHarmony(index, Number(e.target.value))}
              className="min-w-0 flex-1 accent-accent2"
              title={`Harmony ${layer.harmony.toFixed(2)} : 0 consonant (B matched) ↔ 1 dissonant (B hue clashes with A)`}
            />
          </Row>

          {/* CPL: audio couples the A/B balance. Hidden unless the user turns on
              coupling (Audio panel) : a visuals-only user never sees it. */}
          {showCoupling && (
          <Row label="CPL">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {/* Line 1 : mode + feature pickers, each wide enough to read. */}
              <div className="flex min-w-0 items-center gap-1.5">
                <select
                  className="input select-compact min-w-0 flex-1 text-[10px]"
                  value={layer.coupling.mode}
                  onChange={(e) => setCoupling(index, { mode: e.target.value as CouplingMode })}
                  title="A/B coupling by audio : lean · hocket (pump) · cut (transient flash) · gate (B while loud) · drift (slow momentum)"
                >
                  <option value="off">off</option>
                  <option value="lean">lean</option>
                  <option value="hocket">hocket</option>
                  <option value="cut">cut</option>
                  <option value="gate">gate</option>
                  <option value="drift">drift</option>
                </select>
                <select
                  className="input select-compact min-w-0 flex-1 text-[10px]"
                  value={layer.coupling.feature}
                  onChange={(e) => setCoupling(index, { feature: e.target.value as AudioFeature })}
                  title="Audio feature driving the bond (transient/flux read best)"
                >
                  {AUDIO_FEATURES.map((f) => (
                    <option key={f} value={f}>
                      {f}
                    </option>
                  ))}
                </select>
              </div>
              {/* Line 2 : amount + tightness sliders, labelled. */}
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="shrink-0 font-mono text-[9px] uppercase text-muted">amt</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={layer.coupling.amount}
                  onChange={(e) => setCoupling(index, { amount: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Coupling amount ${layer.coupling.amount.toFixed(2)}`}
                />
                <span className="shrink-0 font-mono text-[9px] uppercase text-muted">tight</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={layer.coupling.tightness}
                  onChange={(e) => setCoupling(index, { tightness: Number(e.target.value) })}
                  className="min-w-0 flex-1 accent-accent"
                  title={`Tightness ${layer.coupling.tightness.toFixed(2)} : vestigial (peaks only) ↔ obvious (linear)`}
                />
              </div>
            </div>
          </Row>
          )}

          {/* SOURCE B */}
          <SourceRow
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
            onPickVideo={(url, name) => setSourceVideo(index, 'B', url, name)}
            onPickCapture={(spec, name) => setSourceCapture(index, 'B', spec, name)}
            onPickHive={(host, port) => setSourceHive(index, 'B', host, port)}
          />

          {/* LAYER FX */}
          <Row label="FX">
            <FxAddSelect scope={{ kind: 'layer', layer: index }} className="min-w-0 flex-1" />
          </Row>
          <Indented>
            <FxChips scope={{ kind: 'layer', layer: index }} fx={layer.fx} />
          </Indented>

          {/* BLEND against the stack below */}
          <Row label="BLEND">
            <select
              className="input select-compact min-w-0 flex-1 text-[11px]"
              value={layer.blend}
              onChange={(e) => setBlend(index, e.target.value as BlendMode)}
            >
              {BLEND_MODES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </Row>

          {/* MASK : a spatial mask on this layer's stack contribution. */}
          <MaskControls index={index} mask={layer.mask} />

          {/* TRAIL persistence : only while FB is on */}
          {layer.feedback && (
            <Row label="TRAIL">
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={layer.feedbackAmount}
                onChange={(e) => setFeedbackAmount(index, Number(e.target.value))}
                className="min-w-0 flex-1 accent-accent"
                title="Feedback persistence : decay trails (capped below infinite bloom)"
              />
              <div className="w-11 shrink-0">
                <BoundedNumberInput
                  value={layer.feedbackAmount}
                  min={0}
                  max={1}
                  onChange={(v) => setFeedbackAmount(index, v)}
                  className="input w-full px-1 py-0.5 text-right text-[11px]"
                />
              </div>
            </Row>
          )}

          {/* SPEED : the layer's global clock multiplier; always the last row */}
          <Row label="SPEED">
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
            <div className="w-11 shrink-0">
              <BoundedNumberInput
                value={layer.speed}
                min={0}
                max={20}
                onChange={(v) => setLayerSpeed(index, v)}
                className="input w-full px-1 py-0.5 text-right text-[11px]"
              />
            </div>
          </Row>
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
  const sl = (label: string, key: keyof LayerMask, min = 0, max = 1, step = 0.01): JSX.Element => (
    <Row label={label}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={mask[key] as number}
        onChange={(e) => set({ [key]: Number(e.target.value) } as Partial<LayerMask>)}
        className="min-w-0 flex-1 accent-accent"
      />
    </Row>
  )
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
      {mask.mode === 3 && (<>{sl('X', 'cx')}{sl('Y', 'cy')}{sl('SIZE', 'size')}{sl('ASPECT', 'aspect', 0.2, 3)}{sl('ROUND', 'round')}{sl('SOFT', 'soft')}</>)}
    </>
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

// A picked video's loadable URL: the persistent opsia-media:// scheme (from its
// absolute path) so it survives reload, falling back to a session-only object
// URL if the path can't be resolved.
function mediaUrlForFile(file: File): string {
  try {
    const path = window.api.getMediaPath(file)
    if (path) return `opsia-media://local/${encodeURIComponent(path)}`
  } catch {
    /* getMediaPath unavailable : fall back */
  }
  return URL.createObjectURL(file)
}

// FX chips rows sit indented under their owner's row, inside the gutter.
function Indented({ children }: { children: ReactNode }): JSX.Element {
  return <div className="min-w-0 pl-[40px]">{children}</div>
}

/** One source: [A] [picker] [+fx], with its FX chips underneath. */
function SourceRow({
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
  onPickVideo: (url: string, name: string) => void
  onPickCapture: (spec: string, name: string) => void
  onPickHive: (host: string, port: number) => void
}): JSX.Element {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [showCapture, setShowCapture] = useState(false)
  const [showDevices, setShowDevices] = useState(false)
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
    if (path) {
      try {
        const probe = await window.api.videoProbe(path)
        if (probe.needsConvert) {
          if (!probe.ffmpegAvailable) {
            alert(
              `"${file.name}" is ${probe.codec ?? 'a codec'} the built-in player can't read.\n` +
                'Install ffmpeg to import it : add ffmpeg to PATH, `npm i ffmpeg-static`, or set OPSIA_FFMPEG.'
            )
            return
          }
          setConverting(0)
          const off = window.api.onVideoConvertProgress((p) => {
            if (p.path === path) setConverting(p.pct)
          })
          const res = await window.api.videoConvert(path)
          off()
          setConverting(null)
          if (!res.ok || !res.path) {
            alert(`Conversion failed : ${res.error ?? 'unknown error'}`)
            return
          }
          onPickVideo(`opsia-media://local/${encodeURIComponent(res.path)}`, file.name)
          return
        }
      } catch {
        /* probe failed (no ffmpeg) : just try playing it directly */
      }
    }
    onPickVideo(mediaUrlForFile(file), file.name)
  }
  const isVideo = sourceKind === 'video'
  const isCapture = sourceKind === 'capture'
  const isHive = sourceKind === 'hive'
  const isAsm = sourceKind === 'assemble'
  // The select's value: a generator id, or a sentinel for the active video /
  // capture / assemble source, or '' for none.
  const value = isAsm
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
            : '__cap_screen__'
        : (shaderId ?? '')
  const active = isVideo || isCapture || isHive || isAsm || !!shaderId
  return (
    <>
      <div className="flex min-w-0 items-center gap-1.5" onClick={onSelect}>
        <span
          className={`w-[34px] shrink-0 font-app text-[14px] font-bold leading-none ${
            selected ? 'text-accent' : active ? 'text-text' : 'text-muted'
          }`}
        >
          {label}
        </span>
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
          title="Source for this slot — type to search the generators"
          options={[
            { value: '', label: '— none —' },
            ...(isVideo
              ? [{ value: '__video__', label: mediaName ?? 'video', prefix: '🎞 ', group: 'live' }]
              : []),
            ...(isAsm
              ? [{ value: '__assemble__', label: mediaName ?? 'assemblage', prefix: '🎬 ', group: 'live' }]
              : []),
            { value: '__video_pick__', label: 'Import video…', prefix: '🎞 ', group: 'live' },
            { value: '__assemble_pick__', label: 'Assemblage…', prefix: '🎬 ', group: 'live' },
            { value: '__cap_webcam__', label: 'Webcam', prefix: '📷 ', group: 'live' },
            { value: '__cap_live__', label: 'Live Input…', prefix: '🎥 ', group: 'live' },
            { value: '__cap_screen__', label: 'Screen…', prefix: '🖥 ', group: 'live' },
            { value: '__cap_hive__', label: 'HIVE stream…', prefix: '📡 ', group: 'live' },
            ...GENERATORS_ALPHA.map(
              (g): SearchOption => ({ value: g.id, label: g.name, group: 'generators' })
            )
          ]}
          onChange={(v) => {
            if (v === '__video_pick__') fileRef.current?.click()
            else if (v === '__cap_webcam__') onPickCapture('webcam', 'Webcam')
            else if (v === '__cap_screen__') setShowCapture(true)
            else if (v === '__cap_live__') setShowDevices(true)
            else if (v === '__cap_hive__') setShowHive(true)
            // The assemble entries are informational : an assemblage is placed
            // from the assemble tab (it needs the corpus), so selecting either
            // one just opens that tab rather than silently doing nothing.
            else if (v === '__assemble_pick__') useStore.getState().setRightView('assemble')
            else if (v !== '__video__' && v !== '__assemble__') onPick(v || null)
          }}
        />
        {/* +fx always present : the layout never shifts when sources load.
            w-auto so the box hugs its "+ fx" label instead of a fixed gutter. */}
        <span onClick={(e) => e.stopPropagation()}>
          <FxAddSelect scope={scope} className="w-[8.5rem] shrink-0" />
        </span>
      </div>
      {/* Only the FX the user adds appear below the row */}
      {fx.length > 0 && (
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
