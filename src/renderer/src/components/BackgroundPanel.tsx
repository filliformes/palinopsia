// BackgroundPanel : the Background's strip, FIRST in the Layers column so the
// column reads as the stack does, bottom to top : the Background, then Layer 1
// (on it) up to Layer 4. Collapsible like a layer : the header keeps its
// opacity and dice, folded it says what it holds. Inside : one source (the
// curated ground set), its FX rack, its own slow clock (default 0.25×), the
// shadow the layers cast on it, and how the layers sit on it (blend or group).
// Its own dice and presets (25 built-ins + yours, right-click to save); the
// global Randomize never touches it : the ground stays put while the layers churn.

import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import type { ModTarget } from '@shared/types'
import { BG_DEFAULT_SPEED, BG_SPEED_MAX } from '@shared/types'
import { TBTN, TBTN_IDLE, TBTN_IDLE_ON, TBTN_LIT } from './buttonStyles'
import { modTargetKey, useStore } from '../store'
import { BG_PRESETS, BG_SOURCES, bgPresetToState } from '../bgPresets'
import { SHADER_BY_ID, inPickerOrder, sourceSection } from '../shaders/isf'
import { keywordsFor } from '../shaders/isf/keywords'
import { generatorBlurb } from '../shaders/isf/sourceBlurbs'
import { AssignRow } from './AutoControls'
import { BoundedNumberInput } from './BoundedNumberInput'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { FxAddSelect, FxChips } from './FxRackPanel'
import { registerLiveOverlay } from './liveOverlay'
import { MidiLearnOverlay } from './MidiLearnOverlay'
import { SearchSelect, type SearchOption } from './SearchSelect'
import { ConfirmModal, PromptModal } from './PromptModal'
import { useFlash } from './useFlash'

const BG_SOURCES_ALPHA = [...BG_SOURCES].sort((a, b) => a.name.localeCompare(b.name))

type BgField = 'opacity' | 'speed' | 'depth'
const FIELD_LABEL: Record<BgField, string> = { opacity: 'background opacity', speed: 'background speed', depth: 'background shadow' }

export function BackgroundPanel(): JSX.Element {
  const bg = useStore((s) => s.composition.background)
  const selection = useStore((s) => s.selection)
  const setSelection = useStore((s) => s.setSelection)
  const setBackgroundSource = useStore((s) => s.setBackgroundSource)
  const setBackgroundOpacity = useStore((s) => s.setBackgroundOpacity)
  const setBackgroundSpeed = useStore((s) => s.setBackgroundSpeed)
  const setBackgroundDepth = useStore((s) => s.setBackgroundDepth)
  const setBackgroundBlendMode = useStore((s) => s.setBackgroundBlendMode)
  const randomizeBg = useStore((s) => s.randomizeBg)
  const initBackground = useStore((s) => s.initBackground)
  const applyBgPreset = useStore((s) => s.applyBgPreset)
  const bgPresets = useStore((s) => s.bgPresets)
  const saveBgPreset = useStore((s) => s.saveBgPreset)
  const deleteBgPreset = useStore((s) => s.deleteBgPreset)
  const collapsed = useStore((s) => !!s.collapsed['background'])
  const toggleSection = useStore((s) => s.toggleSection)
  const modMatrix = useStore((s) => s.composition.modMatrix)

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [savePrompt, setSavePrompt] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null)
  const [openMod, setOpenMod] = useState<BgField | null>(null)
  const [flashing, flash] = useFlash()

  const selected = selection?.type === 'background'
  const opacity = bg?.opacity ?? 1
  const speed = bg?.speed ?? BG_DEFAULT_SPEED
  const depth = bg?.depth ?? 0
  const mode = bg?.blendMode ?? 'blend'
  const shaderId = bg?.source.shaderId ?? null
  const fxCount = bg?.fx.length ?? 0

  // ── Modulation of its own controls (opacity / speed / shadow), like a layer's.
  const bgTarget = (field: BgField): ModTarget => ({ kind: 'bg', field })
  const boundFor = (field: BgField): typeof modMatrix => {
    const key = modTargetKey(bgTarget(field))
    return modMatrix.filter((a) => modTargetKey(a.target) === key)
  }
  const opacityBound = boundFor('opacity').length > 0
  const speedBound = boundFor('speed').length > 0
  const depthBound = boundFor('depth').length > 0
  const opacityRef = useRef<HTMLInputElement | null>(null)
  const speedRef = useRef<HTMLInputElement | null>(null)
  const depthRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    const offs: Array<() => void> = []
    const live = (on: boolean, el: HTMLInputElement | null, field: BgField): void => {
      if (on && el) offs.push(registerLiveOverlay({ el, key: modTargetKey(bgTarget(field)), format: (x) => String(x) }))
    }
    live(opacityBound, opacityRef.current, 'opacity')
    live(speedBound, speedRef.current, 'speed')
    live(depthBound, depthRef.current, 'depth')
    return () => offs.forEach((o) => o())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opacityBound, speedBound, depthBound, collapsed])

  const modChip = (field: BgField): JSX.Element => {
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
          const key = modTargetKey(bgTarget(field))
          st.composition.modMatrix.filter((a) => modTargetKey(a.target) === key).forEach((a) => st.removeAssignment(a.id))
          st.composition.metaKnobs.forEach((k, i) => {
            if (k.destinations.some((d) => modTargetKey(d) === key)) st.toggleMetaDest(i, bgTarget(field))
          })
        }}
        className={`shrink-0 rounded px-1 font-mono text-[9px] leading-4 transition-colors ${
          bound.length
            ? 'bg-accent/20 text-accent ring-1 ring-accent'
            : active
              ? 'bg-accent2/25 text-accent2 ring-1 ring-accent2'
              : 'bg-panel3/60 text-muted hover:text-text'
        }`}
        title={`Modulate the ${FIELD_LABEL[field]} : right-click clears its modulation`}
      >
        M{bound.length ? bound.map((b) => b.mod + 1).join('·') : ''}
      </button>
    )
  }
  const modAssign = (field: BgField): JSX.Element | null =>
    openMod === field ? (
      <div className="px-1 pb-0.5" onClick={(e) => e.stopPropagation()}>
        <AssignRow target={bgTarget(field)} bound={boundFor(field)} />
      </div>
    ) : null

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const menuItems: MenuItem[] = [
    { label: 'Init background', onClick: () => initBackground() },
    { label: 'Randomize background', onClick: () => { randomizeBg(); flash() } },
    { divider: true, label: '' },
    { label: 'Save background as preset…', onClick: () => setSavePrompt(true) },
    ...bgPresets.map((p) => ({
      label: p.name,
      onClick: () => applyBgPreset(p.bg),
      onDelete: () => setDeleteTarget({ id: p.id, name: p.name }),
      deleteTitle: `Delete background preset "${p.name}"`
    }))
  ]

  const sourceName = shaderId ? (SHADER_BY_ID[shaderId]?.name ?? shaderId) : null
  const stop = (e: { stopPropagation: () => void }): void => e.stopPropagation()

  return (
    <div
      className={`flex min-w-0 flex-col gap-1.5 rounded-md border bg-panel p-2 transition-colors ${
        flashing ? 'animate-pulse border-accent ring-1 ring-accent' : 'border-border'
      }`}
      onContextMenu={onContextMenu}
    >
      {/* Header : chevron · BG · opacity · M · dice (a layer's header, for the ground) */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={() => toggleSection('background')}
          className="flex shrink-0 items-center gap-1"
          title={collapsed ? 'Expand the Background' : 'Collapse the Background'}
        >
          <span className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          <span className="font-mono text-[11px] text-muted">BG</span>
        </button>
        <span className="relative flex min-w-0 flex-1">
          <MidiLearnOverlay id="bg:opacity" />
          <input
            ref={opacityRef}
            type="range" min={0} max={1} step={0.01} value={opacity}
            onChange={(e) => setBackgroundOpacity(Number(e.target.value))}
            onDoubleClick={() => setBackgroundOpacity(1)}
            className={`w-full ${opacityBound ? 'accent-accent2' : 'accent-accent'}`}
            title={`Background opacity ${opacity.toFixed(2)} : 0 = off · double-click resets to 1`}
          />
        </span>
        {modChip('opacity')}
        <span className="relative inline-flex shrink-0">
          <MidiLearnOverlay id="rand:bg" />
          <button
            onClick={() => {
              randomizeBg()
              flash()
            }}
            title="Randomize the Background : a new ground and rack (keeps its opacity, speed, shadow and mode)"
            className={`rounded px-1.5 py-0.5 font-mono text-[11px] leading-none transition-colors ${
              flashing ? 'animate-pulse text-accent' : 'text-muted hover:bg-accent/15 hover:text-accent'
            }`}
          >
            ⚄
          </button>
        </span>
      </div>
      {modAssign('opacity')}

      {collapsed && (
        <div className="flex min-w-0 items-center gap-1 px-1 font-mono text-[9px] text-muted" title="What the Background holds (expand to edit)">
          <span className="min-w-0 truncate">{sourceName ?? 'empty : the layers sit on black'}</span>
          {sourceName && fxCount > 0 && <span className="shrink-0 text-muted/70">· {fxCount} fx</span>}
          {sourceName && <span className="shrink-0 text-muted/70">· {speed.toFixed(2)}×</span>}
          {sourceName && depth > 0.001 && <span className="shrink-0 text-muted/70">· shadow</span>}
          {sourceName && <span className="shrink-0 text-accent2/80">· {mode === 'isolate' ? 'group' : 'blend'}</span>}
        </div>
      )}

      {!collapsed && (
        <>
          {/* SOURCE : BG (shows its parameters in the Inspector) · ground picker · +fx · presets */}
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => shaderId && setSelection({ type: 'background' })}
              className={`${TBTN} w-[34px] px-0 text-center ${selected ? TBTN_LIT : shaderId ? TBTN_IDLE_ON : TBTN_IDLE}`}
              title={shaderId ? 'Show the Background source\'s parameters in the Inspector' : 'Pick a ground first'}
            >
              BG
            </button>
            <SearchSelect
              className={`min-w-[5rem] flex-1 text-[11px] ${selected ? 'border-accent' : ''}`}
              value={shaderId ?? ''}
              options={[
                { value: '', label: 'none' },
                ...inPickerOrder(BG_SOURCES_ALPHA).map((g): SearchOption => ({ value: g.id, label: g.name, group: sourceSection(g), keywords: keywordsFor(g.id), title: generatorBlurb(g.id) }))
              ]}
              onChange={(v) => setBackgroundSource(v || null)}
              title="The Background's source : a curated set of grounds (type to search)"
            />
            <span onClick={stop}>
              <FxAddSelect scope={{ kind: 'background' }} className="w-16 shrink-0" />
            </span>
            <SearchSelect
              className="w-[4.75rem] shrink-0 text-[10px]"
              value=""
              placeholder="presets"
              resetAfterPick
              options={[
                ...BG_PRESETS.map((p): SearchOption => ({ value: p.id, label: p.name, group: 'Built-in' })),
                ...bgPresets.map((p): SearchOption => ({ value: `u:${p.id}`, label: p.name, group: 'Yours' }))
              ]}
              onChange={(v) => {
                if (!v) return
                if (v.startsWith('u:')) {
                  const p = bgPresets.find((x) => x.id === v.slice(2))
                  if (p) applyBgPreset(p.bg)
                } else {
                  const p = BG_PRESETS.find((x) => x.id === v)
                  // a built-in is a ground and a rack : it keeps your shadow and mode
                  if (p) applyBgPreset({ ...bgPresetToState(p), depth, blendMode: mode })
                }
              }}
              title="Background presets : 25 built-ins (a ground and its rack) + yours (everything, right-click the strip to save or delete)"
            />
          </div>

          {/* FX chips under the source, inside the gutter (like a layer strip). */}
          {fxCount > 0 && bg && (
            <div className="min-w-0 pl-[40px]" onClick={stop}>
              <FxChips scope={{ kind: 'background' }} fx={bg.fx} />
            </div>
          )}

          {/* SPEED : its own clock (source, rack and films), 0..4× */}
          <Row label="SPEED" hint="The Background's own clock : its source, its effects and a Collage's films play at this speed (grounds move slowly : 0.25× by default)">
            <span className="relative flex min-w-0 flex-1">
              <MidiLearnOverlay id="bg:speed" />
              <input
                ref={speedRef}
                type="range" min={0} max={BG_SPEED_MAX} step={0.01} value={speed}
                onChange={(e) => setBackgroundSpeed(Number(e.target.value))}
                onDoubleClick={() => setBackgroundSpeed(BG_DEFAULT_SPEED)}
                className={`w-full ${speedBound ? 'accent-accent2' : 'accent-accent'}`}
                title={`Background clock ${speed.toFixed(2)}× · double-click : 0.25×`}
              />
            </span>
            <div className="w-11 shrink-0">
              <BoundedNumberInput value={Math.round(speed * 100) / 100} min={0} max={BG_SPEED_MAX} onChange={setBackgroundSpeed} className="input w-full px-1 py-0.5 text-right text-[11px]" />
            </div>
            {modChip('speed')}
          </Row>
          {modAssign('speed')}

          {/* SHADOW : the layers cast a soft shadow onto the ground */}
          <Row label="SHADOW" hint="The layers cast a soft shadow onto the Background (their bright parts, offset down-right) : it lifts them off the ground. 0 = flat">
            <span className="relative flex min-w-0 flex-1">
              <MidiLearnOverlay id="bg:depth" />
              <input
                ref={depthRef}
                type="range" min={0} max={1} step={0.01} value={depth}
                onChange={(e) => setBackgroundDepth(Number(e.target.value))}
                onDoubleClick={() => setBackgroundDepth(0)}
                className={`w-full ${depthBound ? 'accent-accent2' : 'accent-accent'}`}
                title={`Shadow ${depth.toFixed(2)} · double-click : 0`}
              />
            </span>
            <div className="w-11 shrink-0">
              <BoundedNumberInput value={Math.round(depth * 100) / 100} min={0} max={1} onChange={setBackgroundDepth} className="input w-full px-1 py-0.5 text-right text-[11px]" />
            </div>
            {modChip('depth')}
          </Row>
          {modAssign('depth')}

          {/* LAYERS : how the four layers sit on it */}
          <Row label="LAYERS" hint="How the four layers sit on the Background">
            <div className="flex min-w-0 flex-1 gap-1">
              {(['blend', 'isolate'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setBackgroundBlendMode(m)}
                  className={`min-w-0 flex-1 truncate rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                    mode === m ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel3/60 text-muted hover:text-text'
                  }`}
                  title={
                    m === 'blend'
                      ? 'Blend in : Layer 1 blends onto the Background in its own blend mode (screen lets it glow through, multiply darkens it…); the other layers blend on top'
                      : 'Group : the four layers composite among themselves, as if alone, and the group sits over the Background, which shows through wherever the layers are transparent or dark'
                  }
                >
                  {m === 'blend' ? 'blend in' : 'group'}
                </button>
              ))}
            </div>
          </Row>
        </>
      )}

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} header="Background" items={menuItems} onClose={() => setMenu(null)} />
      )}
      {savePrompt && (
        <PromptModal
          title="Background preset name?"
          placeholder="e.g. Deep sea + grain"
          confirmLabel="Save"
          onConfirm={(name) => {
            saveBgPreset(name)
            setSavePrompt(false)
          }}
          onCancel={() => setSavePrompt(false)}
        />
      )}
      {deleteTarget && (
        <ConfirmModal
          title={`Are you sure you want to delete the background preset "${deleteTarget.name}"?`}
          onYes={() => {
            deleteBgPreset(deleteTarget.id)
            setDeleteTarget(null)
          }}
          onNo={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function Row({ label, hint, children }: { label: string; hint: string; children: ReactNode }): JSX.Element {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <label className="w-[40px] shrink-0 font-mono text-[9px] uppercase text-muted" title={hint}>{label}</label>
      {children}
    </div>
  )
}
