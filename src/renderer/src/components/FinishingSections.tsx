// The Finishing stages (Vibe Palette · Context · Finalizer) as labelled SECTIONS
// instead of one flat list : each family of controls gets a thin header in its
// own color and a matching rail down its left edge. A section with a master
// switch (3D stereo, film hold, output shape, PBR surface, color chord…) carries
// that switch IN its header, so the header replaces a row rather than adding one,
// and a section whose switch is off folds itself away until it's turned on.
// Folding is remembered per section once you click a header.
//
// Labels : a row only drops the words its header already says ("film dust" →
// "dust" under FILM DAMAGE). The full label stays everywhere else (M panel,
// modulation lists, OSC).

import { useEffect, useMemo, useState } from 'react'
import type { ModTarget } from '@shared/types'
import { inputsForShader, type IsfInputDesc } from '../shaders/isf/inputs'
import { modTargetKey, useStore } from '../store'
import { controlKey } from '../modKey'
import { frameVals } from '../engine/frameVals'
import { AutoControls, EnumSwitch } from './AutoControls'
import { HARMONIES } from './VibePaletteStrip'

type Values = Record<string, number | number[]>
/** What a dim rule may need beyond the unit's own values. */
export interface DimCtx {
  /** The Background slot has no source (the shape's outside fill falls back to its color). */
  bgEmpty: boolean
  /** The fulldome output is on (no projector warp : post warp waits). */
  dome: boolean
  /** Inputs something drives on top of their slider (a modulator, a Meta knob,
   *  Context's performance macros) : a rule never takes one of those as off. */
  driven: Set<string>
}

export interface FinishingSection {
  id: string
  title: string
  /** CSS color of the header text and the rail. */
  color: string
  /** An enum input shown in the header : the section's master switch / mode. */
  switchInput?: string
  /** The switch value that means "off" : the section folds itself while it holds. */
  offValue?: number
  inputs: string[]
  /** Inputs the section draws with its own control (its `lead`), not as rows. */
  own?: string[]
  /** Row labels inside this section (only where the header says the rest). */
  labels?: Record<string, string>
  /** Rows that do nothing right now : name → why (grayed, reason in the tooltip). */
  dim?: (v: Values, ctx: DimCtx) => Record<string, string>
  /** A short state read-out for sections without a switch. */
  summary?: (v: Values) => string
}

const C = {
  neutral: 'rgb(var(--c-muted))',
  accent: 'rgb(var(--c-accent))',
  accent2: 'rgb(var(--c-accent2))',
  red: 'rgb(224 96 110)',
  amber: 'rgb(217 164 65)',
  earth: 'rgb(184 138 98)',
  violet: 'rgb(176 127 224)'
}

const num = (v: Values, k: string, d: number): number => (typeof v[k] === 'number' ? (v[k] as number) : d)
const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-3
/** Is this amount doing something : above 0, or driven by something else. */
const live = (v: Values, ctx: DimCtx, k: string, d: number): boolean => ctx.driven.has(k) || num(v, k, d) > 0.001
/** Vibe : source mix at 1 (and nothing moving it) : the picture's own colors
 *  replace the palette, so everything that only shapes the palette is idle. */
const allSource = (v: Values, ctx: DimCtx): boolean => !ctx.driven.has('mixSrc') && num(v, 'mixSrc', 0.5) >= 0.999
const ALL_SOURCE = 'Source mix is at 1 : the picture keeps its own colors, so the palette (and what shapes it) is not seen.'
/** Context : the surface material is drawn (its switch on and relief above 0). */
const pbrOn = (v: Values, ctx: DimCtx): boolean =>
  (ctx.driven.has('pbrTexture') || Math.round(num(v, 'pbrTexture', 0)) > 0) && live(v, ctx, 'pbrAmount', 0.5)

export const FINISHING_SECTIONS: Record<string, FinishingSection[]> = {
  'fx-finalizer': [
    {
      id: 'grade',
      title: 'grade',
      color: C.neutral,
      inputs: ['black', 'white', 'gamma', 'rGain', 'gGain', 'bGain', 'alpha', 'sharpen'],
      labels: { black: 'input black', white: 'input white', alpha: 'opacity' },
      summary: (v) =>
        near(num(v, 'black', 0), 0) && near(num(v, 'white', 1), 1) && near(num(v, 'gamma', 1), 1) &&
        near(num(v, 'rGain', 1), 1) && near(num(v, 'gGain', 1), 1) && near(num(v, 'bGain', 1), 1) &&
        near(num(v, 'sharpen', 0), 0)
          ? near(num(v, 'alpha', 1), 1)
            ? 'neutral'
            : 'faded'
          : near(num(v, 'alpha', 1), 1)
            ? 'graded'
            : 'graded · faded'
    },
    {
      id: 'character',
      title: 'character',
      color: C.accent,
      switchInput: 'character',
      inputs: ['grain', 'grainSize', 'chroma', 'parasites'],
      labels: { grainSize: 'grain size' },
      dim: (v, ctx): Record<string, string> => {
        const c = Math.round(num(v, 'character', 1))
        const out: Record<string, string> = {}
        if (!live(v, ctx, 'grain', 0)) {
          const why = 'Grain amount is 0 : there is no grain to shape.'
          out.grainSize = why
          out.chroma = why
          out.parasites = 'Parasites need grain above 0 and the crt or vhs character.'
          return out
        }
        // a character something moves : either may act at any moment
        if (ctx.driven.has('character')) return out
        if (c === 2 || c === 3) out.chroma = 'Chroma grain only acts with the digital or film character.'
        else out.parasites = 'Parasites only act with the crt or vhs character (and grain above 0).'
        return out
      }
    },
    {
      id: 'stereo',
      title: '3D',
      color: C.red,
      switchInput: 'stereo',
      offValue: 0,
      inputs: ['stereoDepth', 'stereoConv', 'stereoInvert'],
      labels: { stereoDepth: 'relief', stereoConv: 'convergence', stereoInvert: 'invert depth' }
    },
    {
      id: 'film',
      title: 'hand-made film',
      color: C.amber,
      switchInput: 'filmHold',
      offValue: 0,
      inputs: ['filmRate', 'filmJitter', 'filmBoil', 'filmFlutter', 'filmBlank', 'filmBlankMode', 'filmGranule', 'filmSplice', 'filmGrab'],
      dim: (v, ctx): Record<string, string> =>
        !live(v, ctx, 'filmBlank', 0) ? { filmBlankMode: 'Blanks are at 0 : no leader frames to color.' } : {},
      labels: {
        filmRate: 'draw fps',
        filmJitter: 'draw timing',
        filmBoil: 'boil',
        filmFlutter: 'flutter',
        filmBlank: 'blanks',
        filmGranule: 'granulation',
        filmSplice: 'splice',
        filmGrab: 'grab ▸'
      }
    },
    {
      id: 'damage',
      title: 'film damage',
      color: C.earth,
      inputs: ['filmDust', 'filmScratch', 'filmGauge', 'filmDirt', 'filmBurst'],
      labels: { filmDust: 'dust', filmScratch: 'scratch', filmGauge: 'gauge', filmBurst: 'burst ▸' },
      dim: (v, ctx): Record<string, string> => {
        const any = live(v, ctx, 'filmDust', 0) || live(v, ctx, 'filmScratch', 0)
        if (any) return {}
        const why = 'Dust and scratch are both 0 : there is no damage to size or place.'
        return { filmGauge: why, filmDirt: why }
      },
      summary: (v) => {
        const on = [
          num(v, 'filmDust', 0) > 0.001 && 'dust',
          num(v, 'filmScratch', 0) > 0.001 && 'scratch'
        ].filter(Boolean)
        return on.length ? on.join(' · ') : 'clean'
      }
    },
    {
      id: 'shape',
      title: 'output shape',
      color: C.accent2,
      switchInput: 'outShape',
      offValue: 0,
      inputs: ['outSize', 'outFeather', 'outAngle', 'outPosX', 'outPosY', 'outTilt', 'outTurn', 'outPostWarp', 'outBgSource', 'outBgColor', 'outDepth', 'outShadowAngle', 'outPerspective'],
      labels: {
        outSize: 'size',
        outFeather: 'feather',
        outAngle: 'angle',
        outPosX: 'x',
        outPosY: 'y',
        outTilt: 'z tilt',
        outTurn: 'z turn',
        outPostWarp: 'post warp',
        outDepth: 'shadow',
        outShadowAngle: 'shadow angle'
      },
      dim: (v, ctx): Record<string, string> => {
        const out: Record<string, string> = {}
        // With the Background slot empty the engine falls back to this color.
        // (a fill source something moves may come back to the color at any moment)
        if (!ctx.driven.has('outBgSource') && Math.round(num(v, 'outBgSource', 0)) === 1 && !ctx.bgEmpty)
          out.outBgColor = 'The outside is filled by the Background layer, not this color.'
        if (ctx.dome)
          out.outPostWarp = 'The fulldome output is on : a domemaster has no projector warp, so the shape stays in the picture.'
        if (!live(v, ctx, 'outDepth', 0)) {
          const why = 'Shadow is 0 : there is no shadow to angle or rake.'
          out.outShadowAngle = why
          out.outPerspective = why
        }
        return out
      }
    }
  ],
  'fx-context': [
    {
      id: 'softness',
      title: 'softness',
      color: C.neutral,
      inputs: ['trails', 'blur', 'bloom', 'smoothing'],
      summary: (v) => {
        const on = [
          num(v, 'trails', 0.2) > 0.001 && 'trails',
          num(v, 'blur', 0) > 0.001 && 'blur',
          num(v, 'bloom', 0.3) > 0.001 && 'bloom'
        ].filter(Boolean)
        return on.length ? on.join(' · ') : 'clean'
      },
      dim: (v, ctx): Record<string, string> =>
        !live(v, ctx, 'blur', 0) && !live(v, ctx, 'bloom', 0.3)
          ? { smoothing: 'Blur and bloom are 0 : there is no ring to smooth.' }
          : {}
    },
    {
      id: 'distance',
      title: 'distance',
      color: C.accent2,
      inputs: ['depth', 'haze', 'atmosphere', 'voidEdge'],
      labels: { atmosphere: 'haze color' },
      // the haze color also tints the surface material as its field depth rises
      dim: (v, ctx): Record<string, string> =>
        !live(v, ctx, 'haze', 0.15) && !(pbrOn(v, ctx) && live(v, ctx, 'pbrDepth', 0))
          ? { atmosphere: 'Haze is 0 : there is no haze to color.' }
          : {},
      summary: (v) => {
        const on = [
          num(v, 'depth', 0.35) > 0.001 && 'depth',
          num(v, 'haze', 0.15) > 0.001 && 'haze',
          num(v, 'voidEdge', 0) > 0.001 && 'void'
        ].filter(Boolean)
        return on.length ? on.join(' · ') : 'clear'
      }
    },
    {
      id: 'light',
      title: 'light',
      color: C.amber,
      inputs: ['lightGlow', 'lightOrder', 'lightSize', 'lightColor'],
      labels: { lightGlow: 'glow', lightSize: 'size', lightColor: 'color' },
      summary: (v) => {
        const g = num(v, 'lightGlow', 0.1)
        if (g <= 0.001) return 'off'
        const post = typeof v.lightOrder === 'number' ? v.lightOrder >= 0.5 : true
        return `glow ${Math.round(g * 100)}% · ${post ? 'post' : 'pre'}`
      },
      // The light color also lights the surface material's rim and sheen.
      dim: (v, ctx): Record<string, string> => {
        if (live(v, ctx, 'lightGlow', 0.1)) return {}
        const why = 'Glow is 0 : the key light is off.'
        return pbrOn(v, ctx)
          ? { lightSize: why, lightOrder: why }
          : { lightSize: why, lightOrder: why, lightColor: 'Glow is 0 and there is no surface material : nothing is lit in this color.' }
      }
    },
    {
      id: 'surface',
      // "surface material" : plain "surface" also names the Metasurface.
      title: 'surface material',
      color: C.earth,
      switchInput: 'pbrTexture',
      offValue: 0,
      inputs: ['pbrAmount', 'pbrLight', 'pbrScale', 'pbrDepth', 'pbrEvolve'],
      labels: { pbrScale: 'texture scale' },
      dim: (v, ctx): Record<string, string> => {
        if (live(v, ctx, 'pbrAmount', 0.5)) return {}
        const why = 'Relief is 0 : the surface material is not drawn.'
        return { pbrLight: why, pbrScale: why, pbrDepth: why, pbrEvolve: why }
      }
    }
  ],
  'fx-vibe': [
    {
      id: 'palette',
      title: 'palette',
      color: C.accent,
      // the stops and their count are the palette strip (VibePaletteStrip)
      own: ['colorA', 'colorB', 'colorC', 'colorD', 'colorE', 'stops'],
      inputs: ['blend', 'dither', 'mixSrc'],
      dim: (v, ctx): Record<string, string> =>
        allSource(v, ctx) ? { stops: ALL_SOURCE, blend: ALL_SOURCE, dither: ALL_SOURCE } : {},
      summary: (v) => {
        const h = Math.round(num(v, 'harmony', 0))
        const b = num(v, 'blend', 1)
        const mix = num(v, 'mixSrc', 0.5)
        return [
          h >= 1 ? `${HARMONIES[h]} chord` : `${Math.round(num(v, 'stops', 2))} stops`,
          b >= 0.999 ? 'smooth' : b <= 0.001 ? 'bands' : 'soft bands',
          num(v, 'dither', 0) > 0.001 && 'dither',
          mix > 0.001 && `${Math.round(mix * 100)}% source`
        ].filter(Boolean).join(' · ')
      }
    },
    {
      id: 'chord',
      title: 'color chord',
      color: C.violet,
      switchInput: 'harmony',
      offValue: 0,
      inputs: ['baseHue', 'chroma', 'spread'],
      labels: { baseHue: 'hue', chroma: 'chroma', spread: 'spread' },
      dim: (v, ctx): Record<string, string> => {
        const h = Math.round(num(v, 'harmony', 0))
        if (h === 0 && !ctx.driven.has('harmony')) {
          const why = 'The chord is off : the palette uses its own stops.'
          return { baseHue: why, chroma: why, spread: why }
        }
        if (allSource(v, ctx)) return { baseHue: ALL_SOURCE, chroma: ALL_SOURCE, spread: ALL_SOURCE }
        return h === 1 || ctx.driven.has('harmony') ? {} : { spread: 'Spread only acts on the analogous chord.' }
      }
    },
    {
      id: 'tone',
      title: 'tone',
      color: C.neutral,
      inputs: ['autoLevel', 'gamma', 'contrast', 'saturation', 'sharpen'],
      labels: { gamma: 'gamma' },
      // auto-levels, gamma and sharpen shape the light that is mapped into the
      // palette; contrast and saturation act after the source mix
      dim: (v, ctx): Record<string, string> =>
        allSource(v, ctx) ? { autoLevel: ALL_SOURCE, gamma: ALL_SOURCE, sharpen: ALL_SOURCE } : {},
      summary: (v) => {
        const on = [
          num(v, 'autoLevel', 0) > 0.001 && 'auto-levels',
          !near(num(v, 'gamma', 1), 1) && 'gamma',
          !near(num(v, 'contrast', 1), 1) && 'contrast',
          !near(num(v, 'saturation', 1), 1) && (num(v, 'saturation', 1) < 1 ? 'desaturated' : 'saturated'),
          num(v, 'sharpen', 0) > 0.001 && 'sharpened'
        ].filter(Boolean)
        return on.length ? on.join(' · ') : 'neutral'
      }
    },
    {
      id: 'split',
      title: 'split-tone',
      color: C.accent2,
      inputs: ['splitTone', 'shadowTint', 'highTint'],
      labels: { splitTone: 'amount' },
      summary: (v) => (num(v, 'splitTone', 0) > 0.001 ? `${Math.round(num(v, 'splitTone', 0) * 100)}%` : 'off'),
      dim: (v, ctx): Record<string, string> => {
        if (live(v, ctx, 'splitTone', 0)) return {}
        const why = 'Split-tone amount is 0 : the tints are off.'
        return { shadowTint: why, highTint: why }
      }
    }
  ]
}

/** The inputs something drives on top of their slider : a modulator or a Meta
 *  knob (from the matrix), or a performance macro adding onto Context (read off
 *  the engine a few times a second). A grey-out rule never takes these as off. */
function useDriven(names: string[], modTargetFor: (input: string) => ModTarget): Set<string> {
  const bound = useStore((s) => {
    const keys = new Set<string>()
    // (a color's part counts for its color : controlKey)
    for (const a of s.composition.modMatrix) keys.add(controlKey(a.target))
    for (const k of s.composition.metaKnobs) for (const d of k.destinations) keys.add(controlKey(d))
    return names.filter((n) => keys.has(modTargetKey(modTargetFor(n)))).join(',')
  })
  const [macro, setMacro] = useState('')
  const namesKey = names.join(',')
  useEffect(() => {
    const read = (): void => {
      const on: string[] = []
      for (const n of names) {
        const t = modTargetFor(n)
        if (t.kind !== 'fx' || t.scope.kind !== 'master') continue
        const fv = frameVals.get(`fx:master:${t.instId}:${n}`)
        if (fv !== undefined && fv > 0.001) on.push(n)
      }
      const k = on.join(',')
      setMacro((prev) => (prev === k ? prev : k))
    }
    read()
    const id = window.setInterval(read, 400)
    return () => window.clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey])
  return useMemo(() => new Set([...bound.split(','), ...macro.split(',')].filter(Boolean)), [bound, macro])
}

export function hasSections(shaderId: string): boolean {
  return !!FINISHING_SECTIONS[shaderId]
}

/** A Finishing stage's controls, in sections. `extras` adds content at the end of
 *  a section's body (Context's light pad + Vibe Color button). */
export function SectionedControls({
  shaderId,
  values,
  onChange,
  modTargetFor,
  extras,
  leads
}: {
  shaderId: string
  values: Values
  onChange: (name: string, value: number | number[]) => void
  modTargetFor: (input: string) => ModTarget
  extras?: Record<string, JSX.Element>
  /** Content at the top of a section's body (the Vibe's palette strip). */
  leads?: Record<string, JSX.Element>
}): JSX.Element {
  const sections = FINISHING_SECTIONS[shaderId] ?? []
  const all = inputsForShader(shaderId)
  const byName = new Map(all.map((i) => [i.name, i]))
  const driven = useDriven(all.map((i) => i.name), modTargetFor)
  // Anything a section list forgot (a future input) still shows, at the end.
  const listed = new Set(sections.flatMap((s) => [...s.inputs, ...(s.own ?? []), ...(s.switchInput ? [s.switchInput] : [])]))
  const rest = all.filter((i) => !listed.has(i.name) && i.type !== 'point2D' && i.type !== 'image')
  return (
    <div className="flex flex-col">
      {sections.map((s) => (
        <Section
          key={s.id}
          shaderId={shaderId}
          section={s}
          byName={byName}
          values={values}
          onChange={onChange}
          modTargetFor={modTargetFor}
          extra={extras?.[s.id]}
          lead={leads?.[s.id]}
          driven={driven}
        />
      ))}
      {rest.length > 0 && (
        <AutoControls inputs={rest} values={values} onChange={onChange} modTargetFor={modTargetFor} layout="vertical" rgbOnly />
      )}
    </div>
  )
}

function Section({
  shaderId,
  section: s,
  byName,
  values,
  onChange,
  modTargetFor,
  extra,
  lead,
  driven
}: {
  shaderId: string
  section: FinishingSection
  byName: Map<string, IsfInputDesc>
  values: Values
  onChange: (name: string, value: number | number[]) => void
  modTargetFor: (input: string) => ModTarget
  extra?: JSX.Element
  lead?: JSX.Element
  driven: Set<string>
}): JSX.Element {
  const key = `fzs-${shaderId}-${s.id}`
  const stored = useStore((st) => st.collapsed[key])
  const setCollapsed = useStore((st) => st.setCollapsed)
  const bgEmpty = useStore((st) => !st.composition.background?.source.shaderId)
  const dome = useStore((st) => st.dome.enabled)
  const sw = s.switchInput ? byName.get(s.switchInput) : undefined
  const swDef = sw && typeof sw.def === 'number' ? sw.def : 0
  const isOff = sw && s.offValue !== undefined ? Math.round(num(values, sw.name, swDef)) === s.offValue : false
  // Until you click it, a section folds exactly while its switch is off.
  const folded = stored ?? isOff
  const inputs = s.inputs
    .map((n) => byName.get(n))
    .filter((i): i is IsfInputDesc => !!i)
    .map((i) => (s.labels?.[i.name] ? { ...i, display: s.labels[i.name] } : i))
  const dim = s.dim?.(values, { bgEmpty, dome, driven })
  // the section's own control (the palette strip) greys out with its inputs
  const leadDim = s.own?.map((n) => dim?.[n]).find(Boolean)
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed(key, !folded)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            setCollapsed(key, !folded)
          }
        }}
        className="flex min-h-[20px] cursor-pointer select-none items-center gap-1.5 border-t border-border bg-panel2/60 px-2 py-0.5 hover:bg-panel2"
        title={folded ? `Show ${s.title}` : `Fold ${s.title}`}
      >
        <span className="w-2.5 shrink-0 font-mono text-[9px]" style={{ color: s.color }}>
          {folded ? '▸' : '▾'}
        </span>
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: s.color }}>
          {s.title}
        </span>
        <div className="min-w-0 flex-1" />
        {sw ? (
          <EnumSwitch inp={sw} value={values[sw.name]} onChange={onChange} modTargetFor={modTargetFor} />
        ) : s.summary ? (
          <span className="truncate font-mono text-[9px] text-muted">{s.summary(values)}</span>
        ) : null}
      </div>
      {!folded && (
        <div className="border-l-2" style={{ borderLeftColor: s.color }}>
          {lead && (leadDim ? <div className="opacity-40" title={leadDim}>{lead}</div> : lead)}
          <AutoControls
            inputs={inputs}
            values={values}
            onChange={onChange}
            modTargetFor={modTargetFor}
            layout="vertical"
            dim={dim}
            rgbOnly
          />
          {extra}
        </div>
      )}
    </div>
  )
}
