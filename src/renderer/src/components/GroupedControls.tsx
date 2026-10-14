import type { ModTarget } from '@shared/types'
import type { IsfInputDesc } from '../shaders/isf/inputs'
import { AutoControls } from './AutoControls'

type Value = number | number[]

/** A source's controls sorted into titled columns, for the sources with too many
 *  parameters to read as one wrapped row. Each group lists its inputs by NAME in
 *  the order they show; an input no group names lands in a last "more" column,
 *  so a new parameter can never go missing from the Inspector. */
export interface ControlGroup {
  title: string
  color: string
  inputs: string[]
}

const COL = {
  accent: 'rgb(var(--c-accent))',
  accent2: 'rgb(var(--c-accent2))',
  earth: 'rgb(184 138 98)',
  violet: 'rgb(176 127 224)',
  muted: 'rgb(var(--c-muted))'
}

export const SOURCE_GROUPS: Record<string, ControlGroup[]> = {
  // Collage : what plays · how the frame is cut · how the pieces meet · how the
  // wall changes over time.
  'gen-collage': [
    { title: 'films', color: COL.accent, inputs: ['feed', 'films', 'hold', 'speed', 'vary', 'zoom'] },
    { title: 'pieces', color: COL.accent2, inputs: ['shape', 'cuts', 'stack', 'warp', 'rotate', 'mask'] },
    { title: 'edges', color: COL.earth, inputs: ['gap', 'torn', 'contour', 'curve', 'contourMode', 'fxFirst'] },
    { title: 'deal', color: COL.violet, inputs: ['deal', 'rate', 'xfade', 'churn', 'freeze'] }
  ]
}

/** Inputs to grey out (they do nothing right now), name → why. */
export function groupDim(shaderId: string, values: Record<string, Value>): Record<string, string> | undefined {
  if (shaderId !== 'gen-collage') return undefined
  const n = (k: string): number => (typeof values[k] === 'number' ? (values[k] as number) : 0)
  if (n('contour') > 0.001) return undefined
  const dim: Record<string, string> = { curve: 'Contour is at 0 : there is no curve to lengthen.' }
  // (warp bends a cut-up's films too, through the same mode)
  if (!(n('warp') > 0.001 && Math.round(n('shape')) === 0)) dim.contourMode = 'Contour is at 0 : nothing is warped.'
  return dim
}

export function GroupedControls({
  groups,
  inputs,
  values,
  onChange,
  modTargetFor,
  dim
}: {
  groups: ControlGroup[]
  inputs: IsfInputDesc[]
  values: Record<string, Value>
  onChange: (name: string, value: Value) => void
  modTargetFor?: (inputName: string) => ModTarget
  dim?: Record<string, string>
}): JSX.Element {
  const byName = new Map(inputs.map((i) => [i.name, i]))
  const named = new Set(groups.flatMap((g) => g.inputs))
  const rest = inputs.filter((i) => !named.has(i.name))
  const cols = [
    ...groups.map((g) => ({
      ...g,
      list: g.inputs.map((n) => byName.get(n)).filter((i): i is IsfInputDesc => !!i)
    })),
    ...(rest.length ? [{ title: 'more', color: COL.muted, inputs: [], list: rest }] : [])
  ].filter((g) => g.list.length > 0)
  // Columns at least wide enough for a usable slider beside the label and the
  // number, sharing the band's width, wrapping two by two when it narrows.
  return (
    <div className="flex flex-wrap items-start gap-x-5 gap-y-2 px-2 py-1.5">
      {cols.map((g) => (
        <div key={g.title} className="min-w-[15rem] max-w-[24rem] flex-1">
          <div className="flex items-center gap-2 pb-0.5">
            <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em]" style={{ color: g.color }}>
              {g.title}
            </span>
            <div className="h-px min-w-0 flex-1 opacity-30" style={{ background: g.color }} />
          </div>
          <AutoControls
            inputs={g.list}
            values={values}
            onChange={onChange}
            modTargetFor={modTargetFor}
            dim={dim}
            layout="vertical"
            bare
          />
        </div>
      ))}
    </div>
  )
}
