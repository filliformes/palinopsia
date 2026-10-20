import type { ModTarget } from '@shared/types'
import { inputsForShader, type IsfInputDesc } from '../shaders/isf/inputs'
import { AutoControls } from './AutoControls'

type Value = number | number[]

/** A shader's controls sorted into titled columns, for the sources and FX with
 *  too many parameters to read as one wrapped row. Each group lists its inputs by
 *  NAME in the order they show; an input no group names lands in a last "more"
 *  column, so a new parameter can never go missing from the Inspector. The title
 *  colors follow the column order (the same four everywhere) unless one is given. */
export interface ControlGroup {
  title: string
  inputs: string[]
  color?: string
}

const COL = {
  accent: 'rgb(var(--c-accent))',
  accent2: 'rgb(var(--c-accent2))',
  earth: 'rgb(184 138 98)',
  violet: 'rgb(176 127 224)',
  muted: 'rgb(var(--c-muted))'
}
const ORDER = [COL.accent, COL.accent2, COL.earth, COL.violet]

const g = (title: string, ...inputs: string[]): ControlGroup => ({ title, inputs })

// Only the shaders whose parameters read as a jumble in one row (the audit of
// 2026-10-13 : the heaviest sources, nodes and FX, and the whole organic family so
// it reads alike). The lighter ones stay one row.
// THE RULE (Vincent) : the most logical order for exploring and creating, in the
// least space. The panel is as tall as its longest column, so the columns are
// BALANCED (up to four; a long column beside short ones is blank space), and a
// column never holds an XY pad (pads stand at the right).
export const CONTROL_GROUPS: Record<string, ControlGroup[]> = {
  // ── Sources ──
  // Collage : what plays · how the frame is cut · how the pieces meet · how the
  // wall changes over time.
  'gen-collage': [
    g('films', 'feed', 'films', 'hold', 'speed', 'vary', 'zoom'),
    g('pieces', 'shape', 'cuts', 'stack', 'warp', 'rotate', 'mask'),
    g('edges', 'gap', 'torn', 'contour', 'curve', 'contourMode', 'fxFirst'),
    g('deal', 'deal', 'rate', 'xfade', 'churn', 'freeze')
  ],
  'cloud-study': [
    g('cloud', 'coverage', 'scale', 'detail', 'drift', 'evolve', 'horizon', 'audio'),
    g('light', 'sun', 'sunHeight', 'glow', 'shadow', 'sky', 'light', 'shade'),
    g('paint', 'brush', 'mixing', 'impasto', 'canvas')
  ],
  'gen-lattice': [
    g('points', 'form', 'count', 'size', 'vary', 'jitter', 'ink', 'ground'),
    g('camera', 'tilt', 'turn', 'height', 'lens', 'fly', 'spin', 'streak', 'fog'),
    g('well', 'well', 'reach', 'ripple', 'rings', 'pace', 'swell', 'audio', 'side')
  ],
  lowercase: [
    g('figure', 'figure', 'cells', 'density', 'split', 'seed', 'side'),
    g('clock', 'rate', 'gate', 'audio', 'quant', 'hold', 'smear'),
    g('deal', 'jump', 'scroll', 'shear', 'flip'),
    g('color', 'ink', 'ground', 'accentAmt', 'accent', 'accentEvery', 'halo')
  ],
  'gen-text': [
    g('type', 'font', 'weight', 'size', 'spacing', 'stretch', 'color'),
    g('place', 'posX', 'posY', 'angle', 'fit'),
    g('motion', 'lines', 'line', 'reveal', 'scroll', 'drift')
  ],
  'direct-marks': [
    g('marks', 'markType', 'density', 'weight', 'angle'),
    g('blink', 'gate', 'rate', 'audio'),
    g('hand', 'jitter', 'boil', 'fps', 'seed'),
    g('color', 'ink', 'paper')
  ],
  // The organic family : what grows, how it looks, and always last the same
  // LIGHT column (relief, light angle).
  'gen-physarum': [
    g('growth', 'rate', 'scale', 'shape', 'zoom', 'reseed'),
    g('agents', 'agents', 'speed', 'sensor', 'sensorAngle', 'turn', 'wobble'),
    g('trail', 'deposit', 'decay', 'diffuse', 'contrast', 'glow'),
    g('light', 'tint', 'ground', 'relief', 'lightAngle')
  ],
  'gen-fluid': [
    g('sources', 'kind', 'sources', 'flow', 'size', 'wander', 'stir', 'clear'),
    g('motion', 'rate', 'swirl', 'buoyancy', 'viscosity', 'fade', 'detail'),
    g('light', 'colorA', 'colorB', 'ground', 'glow', 'relief', 'lightAngle')
  ],
  reaction: [
    g('pattern', 'feed', 'kill', 'seed', 'scale'),
    g('growth', 'rate', 'reseed'),
    g('view', 'zoom', 'panX', 'panY', 'rotate'),
    g('light', 'tint', 'sharp', 'relief', 'lightAngle')
  ],
  'gen-veins': [
    g('form', 'kind', 'density', 'thickness'),
    g('growth', 'rate', 'cycle', 'reseed'),
    g('color', 'veinColor', 'blade', 'bladeAmt', 'ground'),
    g('light', 'relief', 'lightAngle')
  ],
  colony: [
    g('growth', 'kind', 'growth', 'colonies', 'grain'),
    g('life', 'bare', 'maturing', 'cycle', 'regrow'),
    g('light', 'palette', 'ground', 'relief', 'lightAngle')
  ],
  mycelium: [
    g('growth', 'rate', 'front', 'reseed'),
    g('form', 'scale', 'width', 'density'),
    g('color', 'tint', 'ground'),
    g('light', 'relief', 'lightAngle')
  ],
  'dye-field': [
    g('flow', 'rate', 'warp', 'pool'),
    g('form', 'scale', 'density', 'grain'),
    g('color', 'pigment', 'base'),
    g('light', 'relief', 'lightAngle')
  ],
  scan: [
    g('surface', 'material', 'colour', 'weather'),
    g('layout', 'scale', 'rotate', 'tiling'),
    g('motion', 'drift', 'driftAngle'),
    g('light', 'relief', 'lightAngle')
  ],
  // ── Nodes ──
  'node-feedback': [
    g('loop', 'feedback', 'gain', 'blend', 'couple', 'couple2', 'agc', 'noise', 'clear'),
    g('motion', 'zoom', 'rotate', 'driftX', 'driftY', 'warp', 'pivot', 'placement'),
    g('trails', 'blur', 'hue', 'hueCurve', 'sat', 'delayMix', 'delay', 'rgbDelay', 'route'),
    g('key', 'keyMode', 'keyThresh', 'keySoft', 'border', 'borderHue')
  ],
  'node-codecmosh': [
    g('mosh', 'mosh', 'clean', 'cuts', 'pulse', 'refresh'),
    g('damage', 'bloom', 'drop', 'motionFrom'),
    g('codec', 'quality', 'size', 'mix')
  ],
  'node-datamosh': [
    g('mosh', 'mode', 'decay', 'refresh', 'residual', 'reseed', 'manifest', 'moshGate'),
    g('motion', 'motion', 'thresh', 'swirl', 'edgeRepel', 'flowInvert', 'sidechainFlow', 'flowRes'),
    g('texture', 'block', 'bleed', 'resharp'),
    g('bursts', 'trig', 'pulse', 'autoBloom', 'cutSense', 'actant', 'actantTrig', 'actantRate', 'actantLife')
  ],
  'node-ibfv': [
    g('trails', 'flow', 'inject', 'speed', 'clear'),
    g('motion', 'field', 'motion', 'push', 'angle', 'swirl', 'swirlX', 'swirlY'),
    g('grain', 'scale', 'scan', 'dye', 'ground', 'mix')
  ],
  // the Collage's own dials, in the Collage's columns
  'node-autocutter': [
    g('pieces', 'shape', 'cuts', 'rotate', 'slip', 'mask'),
    g('edges', 'gap', 'torn', 'contour', 'curve'),
    g('recut', 'trig', 'rate', 'xfade', 'mix')
  ],
  'node-mosaique': [
    g('pieces', 'tile', 'shape', 'irregular', 'drift', 'melt'),
    g('match', 'corpus', 'structure', 'orient', 'stick', 'jitter'),
    g('color', 'correct', 'gain', 'mix')
  ],
  'node-transfert': [
    g('transfer', 'mode', 'amount', 'flowScale', 'invert', 'channelSpread'),
    g('motion', 'inertie', 'flowBlur', 'magnitudeGamma', 'flowRes'),
    g('trail', 'taps', 'falloff', 'bidirectional')
  ],
  // ── FX ──
  'fx-perspective': [
    g('view', 'tilt', 'turn', 'roll', 'lens', 'zoom'),
    g('place', 'posX', 'posY', 'repeat', 'travel', 'drift'),
    g('surface', 'bend', 'wave', 'waves', 'waveRate', 'axis'),
    g('depth', 'fog', 'shade', 'soften')
  ],
  'fx-transform': [
    g('frame', 'zoom', 'posX', 'posY', 'rotate', 'wrap'),
    g('mask', 'shape', 'cropUp', 'cropDown', 'cropLeft', 'cropRight', 'cutout')
  ]
}

/** What a dim rule can ask about the shader's inputs. A MODULATED input is
 *  never taken as off or as any one value (its base can sit at 0 while it moves),
 *  so nothing that depends on it greys out. */
interface Dim {
  /** the base value (the default when the slot has none) */
  v: (name: string) => number
  /** at 0 and not modulated */
  zero: (name: string) => boolean
  /** a menu at one of these values (rounded) and not modulated */
  is: (name: string, ...vals: number[]) => boolean
  /** a menu at none of these values (rounded) and not modulated */
  isnt: (name: string, ...vals: number[]) => boolean
  /** at this value and not modulated */
  at: (name: string, x: number) => boolean
}
type Why = Record<string, string>
const put = (d: Why, names: string[], why: string): void => {
  for (const n of names) if (!d[n]) d[n] = why
}

/** Per shader : the inputs that do nothing in the current state, name → why
 *  (greyed out, still live : a modulator or a later change can wake them). Every
 *  rule is read off the shader's code (the audit of 2026-10-13). */
const NO_RELIEF = 'Relief is at 0 : no light to angle.'
/** One input greyed out when `on`. */
const one = (on: boolean, name: string, why: string): Why => (on ? { [name]: why } : {})
const DIMS: Record<string, (q: Dim) => Why> = {
  // one flat color, or the gradient's three stops : never both
  'solid-color': ({ zero, is }) => {
    const d: Why = {}
    if (zero('gradient')) put(d, ['colA', 'colB', 'colC', 'angle', 'midpoint', 'dither'], 'Gradient is off : the one flat color (color) fills the frame.')
    else if (is('gradient', 1)) put(d, ['color'], 'Gradient is on : colA, colB and colC paint it.')
    return d
  },
  'gen-collage': ({ zero, isnt }) => {
    const d: Why = {}
    if (!zero('contour')) return d
    d.curve = 'Contour is at 0 : there is no curve to lengthen.'
    // (warp bends a cut-up's films too, through the same mode)
    if (zero('warp') || isnt('shape', 0)) d.contourMode = 'Contour is at 0 : nothing is warped.'
    return d
  },
  'gen-lattice': ({ zero, is }) => {
    const d: Why = {}
    if (is('form', 1)) put(d, ['height'], 'A volume has no camera height.')
    if (zero('ripple')) put(d, ['rings'], 'Ripple is at 0.')
    if (zero('ripple') && zero('swell')) put(d, ['pace'], 'Ripple and swell are at 0 : nothing to pace.')
    if (zero('fly') && zero('spin')) put(d, ['streak'], 'Fly and spin are at 0 : nothing moves to streak.')
    if (!is('form', 1) && ['well', 'ripple', 'swell', 'audio', 'side'].every(zero))
      put(d, ['reach'], 'Well, ripple, swell, audio and sidechain are at 0 : nothing to reach.')
    return d
  },
  lowercase: ({ zero, is }) => {
    const d: Why = {}
    if (is('figure', 1, 2, 3, 6)) put(d, ['split'], 'This figure has no split.')
    if (is('figure', 2, 7) || (is('figure', 4) && zero('accentAmt'))) put(d, ['scroll'], 'This figure does not scroll.')
    if (is('figure', 7)) put(d, ['audio', 'side', 'accentAmt', 'accent', 'accentEvery'], 'The slab figure does not use it.')
    if (zero('accentAmt')) put(d, ['accent', 'accentEvery'], 'Accent is at 0.')
    if (is('figure', 4) && zero('audio') && zero('side') && zero('accentAmt'))
      put(d, ['jump', 'shear'], 'The rule figure only moves with audio, sidechain or accents.')
    return d
  },
  'gen-text': ({ is }) => one(is('lines', 0), 'line', 'Lines shows all of them : there is no next line.'),
  'direct-marks': ({ zero, at }) => {
    const d: Why = {}
    if (at('audio', 1)) put(d, ['gate'], 'Audio gates the marks fully.')
    if (at('gate', 1) && zero('audio')) put(d, ['rate'], 'Gate is at 1 : nothing flickers.')
    if (zero('boil')) put(d, ['fps'], 'Boil is at 0.')
    return d
  },
  'gen-physarum': ({ zero }) => one(zero('relief'), 'lightAngle', NO_RELIEF),
  'gen-fluid': ({ zero, is, isnt }) => {
    const d: Why = {}
    if (isnt('kind', 0)) put(d, ['colorB'], 'Only ink has a second ink.')
    else if (is('sources', 0, 1)) put(d, ['colorB'], 'One source : only the first ink.')
    if (isnt('kind', 2)) put(d, ['glow'], 'Only fire glows.')
    if (is('kind', 2)) put(d, ['relief', 'lightAngle'], 'Fire has no relief.')
    if (zero('relief')) put(d, ['lightAngle'], NO_RELIEF)
    return d
  },
  reaction: ({ zero }) => one(zero('relief'), 'lightAngle', NO_RELIEF),
  'gen-veins': ({ zero, is }) => {
    const d: Why = {}
    if (is('kind', 2)) put(d, ['blade', 'bladeAmt'], 'Roots have no blade.')
    if (zero('bladeAmt')) put(d, ['blade'], 'Blade amount is at 0.')
    if (zero('relief')) put(d, ['lightAngle'], NO_RELIEF)
    return d
  },
  colony: ({ zero }) => one(zero('relief'), 'lightAngle', NO_RELIEF),
  mycelium: ({ zero }) => one(zero('relief'), 'lightAngle', NO_RELIEF),
  'dye-field': ({ zero }) => one(zero('relief'), 'lightAngle', NO_RELIEF),
  scan: ({ zero }) => {
    const d: Why = {}
    if (zero('drift')) put(d, ['driftAngle'], 'Drift is at 0.')
    if (zero('relief')) put(d, ['lightAngle'], NO_RELIEF)
    return d
  },
  erosion: ({ zero }) => one(zero('relief'), 'lightAngle', NO_RELIEF),
  membrane: ({ zero }) => one(zero('relief'), 'lightAngle', NO_RELIEF),
  ground: ({ zero, isnt }) => {
    const d: Why = {}
    if (isnt('kind', 0)) put(d, ['drying'], 'Only cracked mud dries.')
    if (zero('relief')) put(d, ['lightAngle'], NO_RELIEF)
    return d
  },
  slabs: ({ zero }) => one(zero('accent'), 'tint', 'Accent is at 0 : no accent cells to color.'),
  'particle-drift': ({ zero }) => one(zero('trail'), 'fade', 'Trail is at 0 : no trail to fade.'),
  shapes: ({ is }) => one(is('shape', 0, 1, 4), 'spin', 'This shape does not turn.'),
  'ten-print': ({ zero }) => one(zero('accent'), 'tint', 'Accent is at 0 : no accent cells to color.'),
  differential: ({ zero }) => one(zero('rate'), 'ratio', 'Rate is at 0 : the waves do not spread.'),
  organic: ({ zero, is }) => one(zero('rate') && is('mode', 0, 1), 'flow', 'Rate is at 0 : fire and water stand still.'),
  // ── Nodes ──
  'node-feedback': ({ zero, is }) => {
    const d: Why = {}
    if (is('keyMode', 0)) put(d, ['keyThresh', 'keySoft', 'border', 'borderHue'], 'The keyer is off.')
    if (zero('border')) put(d, ['borderHue'], 'Key border is at 0.')
    if (zero('delayMix')) put(d, ['delay', 'rgbDelay', 'route'], 'Delay echo is at 0.')
    if (zero('couple')) put(d, ['couple2'], 'Couple is at 0 : there is no second buffer.')
    if (zero('hue')) put(d, ['hueCurve'], 'Hue cycle is at 0.')
    if (zero('zoom') && zero('rotate')) {
      put(d, ['pivot'], 'Zoom and rotate are at 0 : nothing turns around the pivot.')
      put(d, ['couple2'], 'Zoom and rotate are at 0 : nothing for the second buffer to diverge.')
    }
    return d
  },
  'node-datamosh': ({ zero, isnt }) => {
    const d: Why = {}
    if (zero('actant')) put(d, ['actantTrig', 'actantRate', 'actantLife'], 'Actants are at 0.')
    if (zero('autoBloom')) put(d, ['cutSense'], 'Auto-bloom is at 0 : no cuts are listened for.')
    if (isnt('mode', 1) && zero('reseed') && zero('actant')) put(d, ['block'], 'Only the sticky mode, reseed and actants use blocks.')
    return d
  },
  'node-ibfv': ({ zero, at }) => {
    const d: Why = {}
    if (zero('push')) put(d, ['angle'], 'Wind is at 0.')
    if (at('swirl', 0.5)) put(d, ['swirlX', 'swirlY'], 'Swirl is at its middle (none) : no center to place.')
    return d
  },
  'node-autocutter': ({ zero }) => one(zero('contour'), 'curve', 'Contour is at 0 : there is no curve to lengthen.'),
  'node-mosaique': ({ zero, is }) => {
    const d: Why = {}
    if (is('shape', 0)) put(d, ['irregular'], 'The grid is regular.')
    if (is('shape', 0, 1) || zero('irregular')) put(d, ['drift'], 'Only irregular tiles drift.')
    return d
  },
  'node-transfert': ({ is }) => {
    const d: Why = {}
    if (is('mode', 0)) put(d, ['taps', 'falloff', 'bidirectional'], 'Displace mode leaves no trail.')
    if (is('mode', 1)) put(d, ['channelSpread'], 'Trail mode does not pull the colors apart.')
    return d
  },
  'node-scanner': ({ zero }) => one(zero('jitter'), 'tear', 'Line jitter is at 0 : nothing rips.'),
  'node-chronoscan': ({ isnt }) => {
    const d: Why = {}
    if (isnt('source', 2)) put(d, ['angle', 'sweep', 'sweepMode'], 'Only the slit-scan control sweeps.')
    return d
  },
  'node-parallax': ({ zero }) => {
    const d: Why = {}
    if (zero('amount')) put(d, ['angle'], 'Parallax is at 0.')
    if (zero('sway')) put(d, ['swayRate'], 'Sway is at 0.')
    if (zero('dof')) put(d, ['dofShape'], 'Depth blur is at 0.')
    if (zero('dof') && zero('fog')) put(d, ['focus'], 'Depth blur and fog are at 0 : nothing to focus.')
    return d
  },
  // ── FX ──
  'fx-perspective': ({ zero }) => {
    const d: Why = {}
    if (zero('wave')) put(d, ['waves', 'waveRate'], 'Wave is at 0.')
    if (zero('bend') && zero('wave')) put(d, ['axis'], 'Bend and wave are at 0 : the surface is flat.')
    return d
  },
  'fx-transform': ({ zero, is, isnt }) => {
    const d: Why = {}
    if (isnt('shape', 0)) put(d, ['wrap'], 'A shape cuts the picture : nothing wraps.')
    if (is('shape', 0) && ['cropUp', 'cropDown', 'cropLeft', 'cropRight'].every(zero))
      put(d, ['cutout'], 'Nothing is cropped or shaped : nothing to cut out.')
    if (is('shape', 1, 15)) put(d, ['rotate'], 'A circle or a ring looks the same turned.')
    return d
  },
  'fx-palette': ({ is }) => {
    const d: Why = {}
    if (is('stops', 2)) put(d, ['colorC'], 'Only the first stops are used.')
    if (is('stops', 2, 3)) put(d, ['colorD'], 'Only the first stops are used.')
    if (is('stops', 2, 3, 4)) put(d, ['colorE'], 'Only the first stops are used.')
    return d
  },
  'fx-tracking': ({ zero }) => one(zero('bleed'), 'bleedRange', 'Chroma bleed is at 0.')
}

/** Inputs to grey out (they do nothing right now), name → why. `modulated` :
 *  the inputs a modulator or a Meta knob drives. */
export function groupDim(
  shaderId: string,
  values: Record<string, Value>,
  modulated: ReadonlySet<string> = new Set()
): Record<string, string> | undefined {
  const f = DIMS[shaderId]
  if (!f) return undefined
  const ins = inputsForShader(shaderId)
  const v = (k: string): number => {
    const x = values[k]
    if (typeof x === 'number') return x
    const d = ins.find((i) => i.name === k)?.def
    return typeof d === 'number' ? d : 0
  }
  const free = (k: string): boolean => !modulated.has(k)
  const out = f({
    v,
    zero: (k) => free(k) && Math.abs(v(k)) < 0.001,
    is: (k, ...vals) => free(k) && vals.includes(Math.round(v(k))),
    isnt: (k, ...vals) => free(k) && !vals.includes(Math.round(v(k))),
    at: (k, x) => free(k) && Math.abs(v(k) - x) < 0.001
  })
  return Object.keys(out).length ? out : undefined
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
  // XY pads never go in a column (a pad one line tall per row would be a wall of
  // blank space) : they stand together at the right.
  const pads = inputs.filter((i) => i.type === 'point2D')
  const byName = new Map(inputs.filter((i) => i.type !== 'point2D').map((i) => [i.name, i]))
  const named = new Set(groups.flatMap((g) => g.inputs))
  const rest = inputs.filter((i) => !named.has(i.name) && i.type !== 'point2D')
  const cols = [
    ...groups.map((gr, i) => ({
      ...gr,
      color: gr.color ?? ORDER[i % ORDER.length],
      list: gr.inputs.map((n) => byName.get(n)).filter((i): i is IsfInputDesc => !!i)
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
      {pads.length > 0 && (
        <div className="shrink-0">
          <AutoControls inputs={pads} values={values} onChange={onChange} modTargetFor={modTargetFor} dim={dim} layout="wrap" />
        </div>
      )}
    </div>
  )
}
