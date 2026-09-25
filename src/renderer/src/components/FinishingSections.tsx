// The Finishing stages (Vibe Palette · Context · Finalizer) as labelled SECTIONS
// instead of one flat list : each family of controls gets a thin header in its
// own colour and a matching rail down its left edge. A section with a master
// switch (3D stereo, film hold, output shape, PBR surface, colour chord…) carries
// that switch IN its header, so the header replaces a row rather than adding one,
// and a section whose switch is off folds itself away until it's turned on.
// Folding is remembered per section once you click a header.
//
// Labels : a row only drops the words its header already says ("film dust" →
// "dust" under FILM DAMAGE). The full label stays everywhere else (M panel,
// modulation lists, OSC).

import type { ModTarget } from '@shared/types'
import { inputsForShader, type IsfInputDesc } from '../shaders/isf/inputs'
import { useStore } from '../store'
import { AutoControls, EnumSwitch } from './AutoControls'

type Values = Record<string, number | number[]>

export interface FinishingSection {
  id: string
  title: string
  /** CSS colour of the header text and the rail. */
  color: string
  /** An enum input shown in the header : the section's master switch / mode. */
  switchInput?: string
  /** The switch value that means "off" : the section folds itself while it holds. */
  offValue?: number
  inputs: string[]
  /** Row labels inside this section (only where the header says the rest). */
  labels?: Record<string, string>
  /** Rows that do nothing right now : name → why (greyed, reason in the tooltip). */
  dim?: (v: Values) => Record<string, string>
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

export const FINISHING_SECTIONS: Record<string, FinishingSection[]> = {
  'fx-finalizer': [
    {
      id: 'grade',
      title: 'grade',
      color: C.neutral,
      inputs: ['black', 'white', 'gamma', 'rGain', 'gGain', 'bGain', 'alpha', 'sharpen'],
      labels: { black: 'input black', white: 'input white', alpha: 'alpha' },
      summary: (v) =>
        near(num(v, 'black', 0), 0) && near(num(v, 'white', 1), 1) && near(num(v, 'gamma', 1), 1) &&
        near(num(v, 'rGain', 1), 1) && near(num(v, 'gGain', 1), 1) && near(num(v, 'bGain', 1), 1) &&
        near(num(v, 'sharpen', 0), 0)
          ? 'neutral'
          : 'graded'
    },
    {
      id: 'character',
      title: 'character',
      color: C.accent,
      switchInput: 'character',
      inputs: ['grain', 'grainSize', 'chroma', 'parasites'],
      labels: { grainSize: 'grain size' },
      dim: (v): Record<string, string> => {
        const c = Math.round(num(v, 'character', 1))
        return c === 2 || c === 3 ? {} : { parasites: 'Parasites only act with the crt or vhs character.' }
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
      inputs: ['filmRate', 'filmJitter', 'filmBoil', 'filmFlutter', 'filmBlank', 'filmBlankMode', 'filmGranule', 'filmSplice'],
      labels: {
        filmRate: 'draw fps',
        filmJitter: 'draw timing',
        filmBoil: 'boil',
        filmFlutter: 'flutter',
        filmBlank: 'blanks',
        filmGranule: 'granulation',
        filmSplice: 'splice'
      }
    },
    {
      id: 'damage',
      title: 'film damage',
      color: C.earth,
      inputs: ['filmDust', 'filmScratch', 'filmHair', 'filmGauge', 'filmDirt'],
      labels: { filmDust: 'dust', filmScratch: 'scratch', filmGauge: 'gauge' },
      summary: (v) => {
        const on = [
          num(v, 'filmDust', 0) > 0.001 && 'dust',
          num(v, 'filmScratch', 0) > 0.001 && 'scratch',
          num(v, 'filmHair', 0) > 0.001 && 'hair'
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
      inputs: ['outSize', 'outAngle', 'outPosX', 'outPosY', 'outBgSource', 'outBgColor', 'outDepth', 'outShadowAngle', 'outPerspective'],
      labels: {
        outSize: 'size',
        outAngle: 'angle',
        outPosX: 'x',
        outPosY: 'y',
        outDepth: 'shadow',
        outShadowAngle: 'shadow angle'
      },
      dim: (v): Record<string, string> =>
        Math.round(num(v, 'outBgSource', 0)) === 1 ? { outBgColor: 'The outside is filled by the Background layer, not this color.' } : {}
    }
  ],
  'fx-context': [
    {
      id: 'softness',
      title: 'softness',
      color: C.neutral,
      inputs: ['trails', 'blur', 'bloom']
    },
    {
      id: 'distance',
      title: 'distance',
      color: C.accent2,
      inputs: ['depth', 'haze', 'atmosphere', 'voidEdge'],
      labels: { atmosphere: 'haze color' }
    },
    {
      id: 'light',
      title: 'light',
      color: C.amber,
      inputs: ['lightGlow', 'lightOrder', 'lightSize', 'lightColor'],
      labels: { lightGlow: 'glow', lightSize: 'size', lightColor: 'color' }
    },
    {
      id: 'surface',
      title: 'surface',
      color: C.earth,
      switchInput: 'pbrTexture',
      offValue: 0,
      inputs: ['pbrAmount', 'pbrLight', 'pbrScale', 'pbrDepth'],
      labels: { pbrScale: 'texture scale' }
    }
  ],
  'fx-vibe': [
    {
      id: 'palette',
      title: 'palette',
      color: C.accent,
      inputs: ['colorA', 'colorB', 'colorC', 'colorD', 'colorE', 'stops', 'blend', 'dither', 'mixSrc'],
      labels: { colorA: 'stop 1 (darks)', colorB: 'stop 2', colorC: 'stop 3', colorD: 'stop 4', colorE: 'stop 5 (lights)', stops: 'stops used' },
      dim: (v) => {
        const out: Record<string, string> = {}
        const chord = Math.round(num(v, 'harmony', 0)) >= 1
        const n = Math.round(num(v, 'stops', 2))
        const keys = ['colorA', 'colorB', 'colorC', 'colorD', 'colorE']
        keys.forEach((k, i) => {
          if (chord) out[k] = 'A color chord is on : it sets the palette instead of these stops.'
          else if (i >= n) out[k] = `Only ${n} stops are used (see "stops used").`
        })
        return out
      }
    },
    {
      id: 'chord',
      title: 'color chord',
      color: C.violet,
      switchInput: 'harmony',
      offValue: 0,
      inputs: ['baseHue', 'chroma', 'spread'],
      labels: { baseHue: 'hue', chroma: 'chroma', spread: 'spread' }
    },
    {
      id: 'tone',
      title: 'tone',
      color: C.neutral,
      inputs: ['autoLevel', 'gamma', 'contrast', 'saturation', 'sharpen'],
      labels: { gamma: 'gamma' }
    },
    {
      id: 'split',
      title: 'split-tone',
      color: C.accent2,
      inputs: ['splitTone', 'shadowTint', 'highTint'],
      labels: { splitTone: 'amount' }
    }
  ]
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
  extras
}: {
  shaderId: string
  values: Values
  onChange: (name: string, value: number | number[]) => void
  modTargetFor: (input: string) => ModTarget
  extras?: Record<string, JSX.Element>
}): JSX.Element {
  const sections = FINISHING_SECTIONS[shaderId] ?? []
  const all = inputsForShader(shaderId)
  const byName = new Map(all.map((i) => [i.name, i]))
  // Anything a section list forgot (a future input) still shows, at the end.
  const listed = new Set(sections.flatMap((s) => [...s.inputs, ...(s.switchInput ? [s.switchInput] : [])]))
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
        />
      ))}
      {rest.length > 0 && (
        <AutoControls inputs={rest} values={values} onChange={onChange} modTargetFor={modTargetFor} layout="vertical" />
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
  extra
}: {
  shaderId: string
  section: FinishingSection
  byName: Map<string, IsfInputDesc>
  values: Values
  onChange: (name: string, value: number | number[]) => void
  modTargetFor: (input: string) => ModTarget
  extra?: JSX.Element
}): JSX.Element {
  const key = `fzs-${shaderId}-${s.id}`
  const stored = useStore((st) => st.collapsed[key])
  const setCollapsed = useStore((st) => st.setCollapsed)
  const sw = s.switchInput ? byName.get(s.switchInput) : undefined
  const swDef = sw && typeof sw.def === 'number' ? sw.def : 0
  const isOff = sw && s.offValue !== undefined ? Math.round(num(values, sw.name, swDef)) === s.offValue : false
  // Until you click it, a section folds exactly while its switch is off.
  const folded = stored ?? isOff
  const inputs = s.inputs
    .map((n) => byName.get(n))
    .filter((i): i is IsfInputDesc => !!i)
    .map((i) => (s.labels?.[i.name] ? { ...i, display: s.labels[i.name] } : i))
  const dim = s.dim?.(values)
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
          <AutoControls
            inputs={inputs}
            values={values}
            onChange={onChange}
            modTargetFor={modTargetFor}
            layout="vertical"
            dim={dim}
          />
          {extra}
        </div>
      )}
    </div>
  )
}
