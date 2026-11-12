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
  'oil-cloud': [
    g('shape', 'grow', 'density', 'density2', 'swirl', 'evolve', 'audio'),
    g('view', 'rotation', 'zoom', 'light', 'lit', 'warm', 'cool', 'ground'),
    g('paint', 'brush', 'mixing', 'impasto')
  ],
  'cloud-study': [
    g('cloud', 'coverage', 'scale', 'detail', 'drift', 'evolve', 'horizon', 'audio'),
    g('light', 'sun', 'sunHeight', 'glow', 'shadow', 'sky', 'light', 'shade'),
    g('paint', 'brush', 'mixing', 'impasto', 'canvas')
  ],
  // three columns (a fourth wrapped under them at the Inspector's width)
  'gen-marble': [
    g('water', 'water', 'evolve', 'currents', 'swirl', 'comb', 'spacing', 'angle', 'budget', 'clear'),
    g('drops', 'auto', 'sync', 'audio', 'size', 'vary', 'crowding', 'spreadTime', 'drop', 'sprinkle', 'sprinkleN'),
    g('paint', 'tool', 'count', 'order', 'color1', 'color2', 'color3', 'color4', 'color5', 'color6')
  ],
  'gen-relief': [
    g('draw and light', 'draw', 'rate', 'speed', 'curve', 'length', 'sens', 'audio', 'sink', 'melt', 'stroke', 'clear', 'lightAngle', 'lightHeight', 'orbit', 'follow'),
    g('brush and color', 'brush', 'mode', 'size', 'convex', 'chaos', 'rough', 'fuse', 'ribs', 'dash', 'broken', 'mirror', 'fold', 'colorPick', 'color1', 'color2', 'color3', 'color4', 'color5'),
    g('material', 'relief', 'gloss', 'grain', 'dents', 'bevel', 'cavity', 'shadow', 'edge', 'edgeColor', 'film', 'filmThick', 'rainbow', 'flakes', 'glint', 'flow', 'flowSpeed', 'bands', 'split', 'ripple', 'side', 'sideUse', 'dispersion', 'rim', 'ground', 'groundOp')
  ],
  'gen-fur': [
    g('coat', 'length', 'density', 'thickness', 'clump', 'curl', 'wild', 'flow', 'lie', 'whorl', 'scale', 'drift', 'repart'),
    g('hand and wind', 'brush', 'hold', 'heal', 'groom', 'wind', 'gust', 'spring', 'audio', 'audioPart', 'lightAngle', 'lightHeight'),
    g('look', 'tip', 'root', 'skin', 'marks', 'markColor', 'markScale', 'shine', 'gloss', 'side', 'sideUse', 'ground')
  ],
  'gen-sandplate': [
    g('figure', 'order', 'tones', 'warp', 'wander', 'every', 'sync', 'glide', 'audio', 'redraw'),
    g('shake', 'drive', 'rotate', 'width', 'scatter', 'uneven', 'tilt', 'tiltAngle', 'pour', 'finger', 'reseed'),
    g('material', 'surface', 'shape', 'plate', 'ground', 'sheen', 'lightAngle', 'sand', 'grains', 'grainSize', 'sparkle', 'side')
  ],
  'gen-lattice': [
    g('points', 'form', 'count', 'size', 'irregular', 'evolve', 'vary', 'jitter', 'ink', 'ground'),
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
  // Noise : what the field is · how it is shaped into a matte · how it moves
  noise: [
    g('field', 'kind', 'scale', 'octaves', 'rough', 'seed', 'seamless', 'field'),
    g('matte', 'contrast', 'level', 'steps', 'focus', 'invert', 'key', 'tint'),
    g('motion', 'drift', 'angle', 'evolve', 'sync', 'glide')
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
  // Silhouette (effect) : how the people are found · how they look · how it lands
  // Drape : the sheet · what moves it · how it looks
  'node-drape': [
    g('sheet', 'mode', 'size', 'crumple', 'stiffness', 'damping', 'grab'),
    g('forces', 'gravity', 'wind', 'gust', 'audio', 'people', 'poke', 'reset'),
    g('look', 'material', 'color', 'sheen', 'folds', 'rainbow', 'flakes', 'glint', 'lightAngle', 'lightHeight', 'tilt', 'behind')
  ],
  // Touch : the touch · how it moves and looks · what fires it
  'node-touch': [
    g('touch', 'mode', 'size', 'strength', 'follow', 'soft', 'mix'),
    g('motion and look', 'fade', 'spring', 'speed', 'width', 'shade', 'split', 'clear'),
    g('fired by', 'fire', 'fireAt', 'audio', 'people', 'wander', 'press', 'point')
  ],
  // Ripple : the water · what stirs it · how it looks
  'node-ripple': [
    g('water', 'rain', 'dropSize', 'motion', 'speed', 'calm', 'edges', 'still'),
    g('stirred by', 'audio', 'people', 'wander', 'stone', 'stoneAt', 'follow', 'press', 'point'),
    g('look', 'refract', 'split', 'shade', 'lightAngle', 'tint', 'deep', 'mix')
  ],
  'node-inflate': [
    g('shape', 'from', 'threshold', 'puff', 'round', 'volume', 'mix'),
    g('material', 'material', 'keep', 'tint', 'gloss', 'film', 'filmThick', 'rainbow', 'flakes', 'glint', 'dispersion', 'rim', 'cavity'),
    g('light and flow', 'shadow', 'lightAngle', 'lightHeight', 'orbit', 'flow', 'flowSpeed', 'bands', 'split', 'ripple')
  ],
  // Time Glitch : the memory · the damage · where it lands (three balanced columns)
  'fx-time-glitch': [
    g('time', 'time', 'mode', 'drift', 'clear', 'amount'),
    g('damage', 'chaos', 'rate', 'sync', 'blocks', 'shift', 'audio'),
    g('where', 'inside', 'after', 'split', 'crush', 'burst', 'burstLen')
  ],
  // Break : the hit · the cracks · the pieces and their light
  'fx-break': [
    g('hit', 'impact', 'every', 'sync', 'scatter', 'hitX', 'hitY'),
    g('cracks', 'shards', 'rings', 'wander', 'broken', 'force', 'bevel'),
    g('pieces', 'after', 'time', 'tilt', 'refract', 'light', 'behind', 'amount')
  ],
  // Droste : the spiral · its flight
  'fx-droste': [
    g('spiral', 'scale', 'strands', 'arms', 'shape', 'edge', 'amount'),
    g('flight', 'zoom', 'spin', 'twist', 'depth', 'cx', 'cy')
  ],
  // Glass : the pane · the light
  'fx-glass': [
    g('pane', 'pattern', 'scale', 'angle', 'depth', 'dispersion', 'frost', 'drift'),
    g('light', 'shine', 'seams', 'lightAngle', 'tint')
  ],
  'fx-rain-pane': [
    g('rain', 'drops', 'size', 'slide', 'trails'),
    g('glass', 'fog', 'bend', 'shine', 'tint')
  ],
  // Print : the screen · the inks
  'fx-dither': [
    g('screen', 'pattern', 'levels', 'scale', 'angle', 'boil'),
    g('color', 'color', 'ink', 'paper', 'amount')
  ],
  'fx-halftone': [
    g('screen', 'mode', 'cell', 'angle', 'shape', 'gain', 'soft', 'grit'),
    g('inks', 'ink', 'ink2', 'paper', 'misreg', 'amount')
  ],
  'fx-riso': [
    g('inks', 'inks', 'ink1', 'ink2', 'ink3', 'paper', 'contrast', 'amount'),
    g('print', 'screen', 'cell', 'misreg', 'drift', 'seed', 'starve', 'tooth')
  ],
  'fx-thinfilm': [
    g('film', 'thickness', 'follow', 'lean', 'ior', 'keep'),
    g('currents', 'swirl', 'scale', 'rate', 'amount')
  ],
  'node-silhouette': [
    g('find', 'people', 'detail', 'smooth', 'sync'),
    g('look', 'mode', 'threshold', 'softness', 'color', 'shade'),
    g('out', 'trail', 'trailColor', 'over', 'mix')
  ],
  'node-codecmosh': [
    g('mosh', 'mosh', 'clean', 'cuts', 'pulse', 'refresh'),
    g('damage', 'bloom', 'drop', 'motionFrom'),
    g('codec', 'quality', 'size', 'mix')
  ],
  // Field Store : what it does · where it writes · when · the store itself
  'node-fieldstore': [
    g('mode', 'mode', 'show', 'hue', 'drift', 'mix'),
    g('key', 'key', 'threshold', 'invert'),
    g('clock', 'clock', 'every', 'grab', 'clear'),
    g('store', 'size', 'bits', 'slideX', 'slideY', 'keep')
  ],
  'node-datamosh': [
    g('mosh', 'mode', 'decay', 'refresh', 'residual', 'reseed', 'manifest', 'moshGate'),
    g('motion', 'motion', 'thresh', 'swirl', 'edgeRepel', 'flowInvert', 'sidechainFlow', 'flowRes'),
    g('texture', 'block', 'bleed', 'resharp'),
    g('bursts', 'trig', 'pulse', 'autoBloom', 'cutSense', 'actant', 'actantTrig', 'actantRate', 'actantLife')
  ],
  // the field effects : how it lands on the picture · what the picture does to
  // it · how it grows (the organic light rides with the look : a fourth column of
  // two wrapped under the others and left a blank band)
  'node-reaction': [
    g('look', 'look', 'amount', 'mix', 'ink', 'sharp', 'relief', 'lightAngle'),
    g('steer', 'steer', 'bias', 'feed', 'kill', 'follow'),
    g('growth', 'plant', 'plantFrom', 'seed', 'scale', 'rate', 'reseed')
  ],
  'node-fluid': [
    g('push', 'motion', 'rise', 'churn', 'swirl'),
    g('water', 'viscosity', 'detail', 'rate', 'stir'),
    g('picture', 'memory', 'keep', 'mix', 'clear')
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
  // the frame-store tricks : when it grabs · what the pattern is · how it moves;
  // what stamps and how long it shows · how the palette turns · its colors; how
  // the store is zoomed · where it reads · what the store is
  'fx-shatter': [
    g('clock', 'rate', 'sync', 'grab'),
    g('pattern', 'pattern', 'scale', 'density'),
    g('motion', 'flip', 'slide', 'wet')
  ],
  'fx-crawl': [
    g('history', 'threshold', 'fade', 'clear', 'ground', 'wet'),
    g('crawl', 'band', 'cycle', 'steps', 'palette', 'stops'),
    g('colors', 'colorA', 'colorB', 'colorC', 'colorD', 'colorE')
  ],
  'fx-store-zoom': [
    g('zoom', 'zoom', 'stretch', 'magnify', 'mirror'),
    g('place', 'panX', 'panY', 'scrollX', 'scrollY'),
    g('store', 'lines', 'wide', 'wet')
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
  /** a layer is picked in the node's first input (its sidechain : Silhouette's fill) */
  side: boolean
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
// The point sources' IRREGULAR (lib/blob.glsl) : EVOLVE morphs shapes that only exist above 0.
const NO_SHAPE = 'Irregular is at 0 : the points are round, there is no shape to evolve.'
const DIMS: Record<string, (q: Dim) => Why> = {
  // one flat color, or the gradient's three stops : never both
  'solid-color': ({ zero, is }) => {
    const d: Why = {}
    if (zero('gradient')) put(d, ['colA', 'colB', 'colC', 'angle', 'midpoint', 'dither'], 'Gradient is off : the one flat color (color) fills the frame.')
    else if (is('gradient', 1)) put(d, ['color'], 'Gradient is on : colA, colB and colC paint it.')
    return d
  },
  // Silhouette (engine/SilhouetteSource.ts) : the shadow color only colors SHADOW;
  // the trail color only tints the MATTE's echoes, so it needs a trail.
  'gen-silhouette': ({ zero, isnt }) => {
    const d: Why = {}
    if (isnt('mode', 2)) d.color = 'Only the shadow mode is drawn in the shadow color.'
    if (isnt('mode', 1)) d.trailColor = 'Only the matte mode colors its echoes : the other modes keep the look the body had.'
    else if (zero('trail')) d.trailColor = 'Trail is at 0 : the matte leaves no echoes to color.'
    return d
  },
  'node-silhouette': ({ zero, is, isnt, side }) => {
    const d: Why = {}
    if (!side) d.shade = 'No fill is picked : shade lights the fill, there is none.'
    else if (is('mode', 1)) d.shade = 'The matte is white people on black : the fill is not drawn.'
    if (isnt('mode', 2)) d.color = side ? 'Only the shadow mode tints the fill with the shadow color.' : 'Only the shadow mode is drawn in the shadow color.'
    if (isnt('mode', 1)) d.trailColor = 'Only the matte mode colors its echoes : the other modes keep the look the people had.'
    else if (zero('trail')) d.trailColor = 'Trail is at 0 : the matte leaves no echoes to color.'
    if (is('mode', 1)) d.over = 'The matte is opaque : nothing of the picture shows under it.'
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
  // Marbling (engine/marbleWorker.ts) : the currents, the comb and the swirl all
  // run on EVOLVE; SYNC only times AUTO; COLORS takes the first N colors.
  'gen-marble': ({ zero, is }) => {
    const d: Why = {}
    if (zero('evolve')) put(d, ['currents', 'swirl', 'comb', 'spacing', 'angle'], 'Evolve is at 0 : the water is still.')
    if (zero('comb')) put(d, ['spacing', 'angle'], 'Comb is at 0 : no comb is raked across.')
    if (zero('auto')) put(d, ['sync'], 'Auto drops is at 0 : no drop lands by itself.')
    for (let n = 2; n <= 5; n++) {
      if (is('count', n)) {
        const off = ['color3', 'color4', 'color5', 'color6'].slice(n - 2)
        put(d, off, `Colors is ${n} : only the first ${n} colors are dropped.`)
      }
    }
    return d
  },
  'gen-relief': ({ zero, is, isnt }) => {
    const d: Why = {}
    if (is('draw', 0)) put(d, ['rate', 'speed', 'curve', 'length'], 'It only draws by hand.')
    if (isnt('draw', 1)) put(d, ['curve', 'length'], 'Only the wandering strokes curve and end.')
    if (isnt('draw', 3)) put(d, ['sens'], 'Only following the moving things has something to sense.')
    if (is('draw', 3)) put(d, ['rate', 'speed'], 'Following the moving things : they set the pace.')
    if (isnt('brush', 5)) put(d, ['ribs', 'dash'], 'Only the ribbed metal has ribs and dashes.')
    if (isnt('brush', 6)) put(d, ['broken'], 'Only the ink breaks.')
    if (isnt('sideUse', 2)) put(d, ['dispersion', 'rim'], 'Only the glass (sidechain as glass) splits color and has a rim.')
    if (isnt('mirror', 4)) put(d, ['fold'], 'Only the mirror around has copies to count.')
    if (zero('edge')) put(d, ['edgeColor'], 'Edge glow is at 0.')
    if (zero('side')) put(d, ['sideUse'], 'Sidechain is at 0.')
    if (zero('groundOp')) put(d, ['ground'], 'Ground opacity is at 0.')
    if (zero('flow')) put(d, ['flowSpeed', 'bands', 'split', 'ripple'], 'Flowing is at 0.')
    return d
  },
  // Time Glitch : with no damage inside or after, the clock and the damage
  // controls have nothing to hit (the audio's share is scaled by them too)
  'fx-time-glitch': ({ zero, isnt }) => {
    const d: Why = {}
    if (isnt('sync', 0)) d.rate = 'Sync is on : the tempo sets the pace.'
    if (zero('inside') && zero('after')) put(d, ['chaos', 'rate', 'sync', 'blocks', 'shift', 'split', 'crush', 'burst', 'burstLen', 'audio'], 'Inside and after are at 0 : no damage is dealt.')
    return d
  },
  'fx-break': ({ zero, is, isnt }) => {
    const d: Why = {}
    if (isnt('sync', 0)) d.every = 'Sync is on : the tempo sets when it breaks by itself.'
    else if (zero('every')) d.scatter = 'Every is at 0 and sync is free : it only breaks when hit, right on the point.'
    if (is('after', 0)) d.time = 'Hold : the pieces stay cracked until the next hit.'
    return d
  },
  'fx-key': ({ isnt }) => {
    const d: Why = {}
    if (isnt('mode', 0)) put(d, ['color', 'despill'], 'Only the color mode keys a color and takes its cast off.')
    if (isnt('mode', 3)) d.channel = 'Only the channel mode reads one channel.'
    return d
  },
  'fx-dither': ({ is, isnt }) => {
    const d: Why = {}
    if (isnt('color', 2)) put(d, ['ink', 'paper'], 'Only ink on paper uses the two colors.')
    if (isnt('pattern', 5) && isnt('pattern', 6) && isnt('pattern', 7)) put(d, ['angle'], 'Only the clustered dots, the lines and the hatch turn.')
    if (isnt('pattern', 4)) put(d, ['boil'], 'Only the white noise boils.')
    return d
  },
  'fx-halftone': ({ is, isnt }) => {
    const d: Why = {}
    if (isnt('mode', 1)) put(d, ['ink2'], 'Only two inks has a second ink.')
    if (is('mode', 2) || is('mode', 3)) put(d, ['ink'], 'CMYK prints its own process inks; the color dots are the picture\'s.')
    if (is('mode', 3)) put(d, ['paper'], 'The color dots sit on black.')
    if (is('mode', 0) || is('mode', 3)) put(d, ['misreg'], 'One plate : nothing to slip apart.')
    return d
  },
  'fx-riso': ({ isnt }) => {
    const d: Why = {}
    if (isnt('inks', 3)) put(d, ['ink3'], 'Two inks : the third is not printed.')
    return d
  },
  'node-drape': ({ is, isnt }) => {
    const d: Why = {}
    if (is('mode', 2)) put(d, ['gravity'], 'Float has no gravity : the sheet drifts and comes back.')
    if (isnt('material', 0) && isnt('material', 1)) put(d, ['sheen'], 'Sheen is the cloth\'s : plastic, chrome and foil shine their own way.')
    if (isnt('material', 4)) put(d, ['rainbow', 'flakes', 'glint'], 'Only the foil has a rainbow, flakes and glints.')
    return d
  },
  'node-touch': ({ zero, is, isnt }) => {
    const d: Why = {}
    if (isnt('mode', 0)) put(d, ['speed', 'width'], 'Only the rings travel.')
    if (is('mode', 0)) put(d, ['fade', 'spring', 'soft'], 'Rings travel out and die away by themselves : nothing is pushed to come back.')
    if (is('mode', 4)) put(d, ['spring', 'soft'], 'A lens is drawn fresh each frame : nothing is pushed to spring back (FADE is how fast it closes).')
    if (isnt('fireAt', 1) && zero('press')) put(d, ['point'], 'Nothing uses the point : fire at the point, or press it.')
    return d
  },
  'node-ripple': ({ zero, isnt }) => {
    const d: Why = {}
    if (isnt('stoneAt', 1) && zero('press')) put(d, ['point'], 'Nothing uses the point : drop the stone at the point, or press it.')
    if (zero('refract')) put(d, ['split'], 'Refraction is at 0 : nothing is bent to split.')
    if (zero('deep')) put(d, ['tint'], 'Water depth is at 0 : the water has no color.')
    return d
  },
  'node-inflate': ({ zero, is, isnt }) => {
    const d: Why = {}
    if (zero('film') && isnt('material', 4)) put(d, ['filmThick'], 'No film : oil film is at 0 and the material is not soap film.')
    if (zero('flow')) put(d, ['flowSpeed', 'bands', 'split', 'ripple'], 'Flowing is at 0.')
    if (is('material', 0)) put(d, ['flow', 'flowSpeed', 'bands', 'split', 'ripple'], 'Clay has no reflection to flow.')
    if (isnt('material', 6)) put(d, ['rainbow', 'flakes', 'glint'], 'Only the foil has a rainbow, flakes and glints.')
    if (isnt('material', 5)) put(d, ['dispersion', 'rim'], 'Only the glass splits color and has a rim.')
    return d
  },
  'gen-fur': ({ zero, is }) => {
    const d: Why = {}
    if (zero('audio')) put(d, ['audioPart'], 'Audio is at 0 : the sound does nothing.')
    if (is('marks', 0)) put(d, ['markColor', 'markScale'], 'Marks is on none.')
    if (zero('side')) put(d, ['sideUse'], 'Sidechain is at 0.')
    if (zero('ground')) put(d, ['skin'], 'Skin opacity is at 0 : only the hairs show.')
    return d
  },
  // Sand Plate : the timer and the beat time the redraws; the tilt's angle needs a
  // tilt; a still plate leaves the width and the strays as they lie.
  'gen-sandplate': ({ zero, isnt }) => {
    const d: Why = {}
    if (isnt('sync', 0)) put(d, ['every'], 'Sync is on : the figure is redrawn on the beat.')
    if (zero('tilt')) put(d, ['tiltAngle'], 'Tilt is at 0 : the plate lies level.')
    if (zero('warp')) put(d, ['wander'], 'Warp is at 0 : the plate is perfect, there is nothing to wander.')
    if (zero('ground')) put(d, ['plate', 'sheen'], 'Plate opacity is at 0 : only the sand shows.')
    return d
  },
  'gen-lattice': ({ zero, is }) => {
    const d: Why = {}
    if (is('form', 1)) put(d, ['height'], 'A volume has no camera height.')
    if (zero('ripple')) put(d, ['rings'], 'Ripple is at 0.')
    if (zero('ripple') && zero('swell')) put(d, ['pace'], 'Ripple and swell are at 0 : nothing to pace.')
    if (zero('fly') && zero('spin')) put(d, ['streak'], 'Fly and spin are at 0 : nothing moves to streak.')
    if (zero('irregular')) put(d, ['evolve'], NO_SHAPE)
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
  // Morphogen (engine/morphogenNode.ts) : the light only on the lit looks, the ink
  // only on ink; steering and planting each need their own switch on.
  'node-reaction': ({ zero, is, isnt }) => {
    const d: Why = {}
    if (isnt('look', 1)) put(d, ['ink'], 'Only the ink look draws in the ink color.')
    if (is('look', 3, 4)) put(d, ['relief', 'lightAngle'], 'The matte and warp looks are not lit.')
    else if (is('look', 2)) put(d, ['relief'], 'Emboss : amount is the depth of the carving.')
    else if (zero('relief')) put(d, ['lightAngle'], NO_RELIEF)
    if (is('steer', 2)) put(d, ['bias'], 'Steered by nothing : feed and kill are the same everywhere.')
    else if (zero('bias')) put(d, ['steer'], 'Dark / light is at 0 : the picture does not push feed and kill.')
    if (zero('plant')) put(d, ['plantFrom'], 'Plant is at 0 : the picture plants nothing.')
    return d
  },
  // Noise (Noise.fs) : the glide only shapes the tempo's steps; with sync on, the
  // tempo clocks the evolving; a map is two plain fields (no tint).
  noise: ({ zero, is, isnt, at }) => {
    const d: Why = {}
    if (is('sync', 0)) put(d, ['glide'], 'Sync is free : glide only shapes the steps on the tempo.')
    else put(d, ['evolve'], 'Sync is on : the tempo sets how fast it changes.')
    if (zero('drift')) put(d, ['angle'], 'Drift is at 0 : nothing moves along the angle.')
    if (at('octaves', 1)) put(d, ['rough'], 'One octave : there are no finer copies to weigh.')
    if (isnt('field', 0)) put(d, ['tint'], 'A map is two plain fields, red and green : no tint.')
    return d
  },
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
  'particle-drift': ({ zero }) => ({
    ...one(zero('trail'), 'fade', 'Trail is at 0 : no trail to fade.'),
    ...one(zero('irregular'), 'evolve', NO_SHAPE)
  }),
  ash: ({ zero }) => one(zero('irregular'), 'evolve', 'Irregular is at 0 : the flecks are round, there is no shape to evolve.'),
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
  'node-fieldstore': ({ is, isnt }) => {
    const d: Why = {}
    if (isnt('mode', 1)) put(d, ['hue', 'drift'], 'Only color trail stamps in an ink.')
    if (is('key', 5)) put(d, ['threshold', 'invert'], 'No key : everything is written.')
    if (isnt('clock', 1, 2)) put(d, ['every'], 'Only every N frames and bursts count frames.')
    return d
  },
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
  'fx-shatter': ({ is, isnt }) => {
    const d: Why = {}
    if (isnt('sync', 0)) put(d, ['rate'], 'Sync grabs on the tempo.')
    if (is('pattern', 7)) put(d, ['scale', 'flip', 'slide'], 'The key follows the picture\'s own tones.')
    return d
  },
  'fx-crawl': ({ is }) => {
    const d: Why = {}
    if (is('palette', 1)) {
      put(d, ['stops', 'colorA', 'colorB', 'colorC', 'colorD', 'colorE'], 'Picture takes its colors from the picture.')
      return d
    }
    if (is('stops', 2)) put(d, ['colorC'], 'Only the first stops are used.')
    if (is('stops', 2, 3)) put(d, ['colorD'], 'Only the first stops are used.')
    if (is('stops', 2, 3, 4)) put(d, ['colorE'], 'Only the first stops are used.')
    return d
  },
  'fx-store-zoom': ({ at, zero }) =>
    one(at('zoom', 1) && zero('stretch'), 'magnify', 'Zoom is 1 and stretch is 0 : nothing is enlarged.'),
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
  modulated: ReadonlySet<string> = new Set(),
  slot: { side?: boolean } = {}
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
    at: (k, x) => free(k) && Math.abs(v(k) - x) < 0.001,
    side: !!slot.side
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
