// Shared type contract across main / preload / renderer.
// Kept framework-free so it imports cleanly on both the Node and web sides.

// ── Engine / signal model ────────────────────────────────────────────
// The 15 blend modes implemented in the Compositor's BLEND_GLSL : shared by
// the layer stack AND each layer's A/B source mix. Extend here AND in the
// Compositor's modeIndex together. 'wrap' (fract(b+t)) is the digital-native
// one: hard value wrap-around.
export type BlendMode =
  | 'normal'
  | 'add'
  | 'subtract'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'softlight'
  | 'hardlight'
  | 'darken'
  | 'lighten'
  | 'difference'
  | 'exclusion'
  | 'dodge'
  | 'burn'
  | 'wrap'
  | 'weave'
  | 'lumakey'
  | 'consume'

export const BLEND_MODES: BlendMode[] = [
  'normal',
  'add',
  'subtract',
  'multiply',
  'screen',
  'overlay',
  'softlight',
  'hardlight',
  'darken',
  'lighten',
  'difference',
  'exclusion',
  'dodge',
  'burn',
  'wrap',
  'weave',
  'lumakey',
  'consume'
]

// What feeds a layer slot. ISF generator is the MVP path; the rest land
// in later phases (video + synthify → Phase 7, capture/HIVE → Phase 7,
// feedback samples another layer's previous frame → Phase 2).
export type SourceKind =
  | 'none'
  | 'generator'
  | 'video'
  | 'capture'
  | 'hive'
  | 'feedback'
  | 'assemble'

// A live shader instance: which ISF shader, and the current value of each
// of its declared INPUTS (float → number, color/point2D → number[]).
export interface ShaderInstance {
  shaderId: string | null
  inputs: Record<string, number | number[]>
}

export interface SourceSlot extends ShaderInstance {
  kind: SourceKind
  // For kind:'feedback' : index of the layer whose previous frame we sample.
  feedbackLayer?: number
  // For kind:'video' : the clip's object URL (or path) the engine loads.
  // For kind:'assemble' : the assemblage's id (changes on every generate /
  // Variation, which is what tells the engine to reload the edit).
  mediaId?: string
  // For kind:'video' : the file's display name, shown in the source picker.
  mediaName?: string
  // For kind:'assemble' : the generated edit decision list, carried ON the slot
  // so an assemblage travels with sessions and scenes and can be played back
  // from the source files alone — no corpus re-analysis needed.
  edl?: import('./assemble').AssembleClip[]
  // For kind:'video' : transport (all optional; engine applies defaults).
  videoPlaying?: boolean // default true
  videoSpeed?: number // 1/28..128, default 1 (× layer speed × global speed)
  videoReverse?: boolean // legacy; superseded by videoDirection
  videoDirection?: 'forward' | 'reverse' | 'pendulum' // default 'forward'
  videoLoop?: boolean // default true
  videoIn?: number // normalized start point 0..1, default 0
  videoOut?: number // normalized stop point 0..1, default 1
  // Video granulation (multi-voice) : 3 seek-head voices scattering grains
  // around the (modulatable) playhead, crossfaded with raised-cosine envelopes.
  grainOn?: boolean // default false
  grainSize?: number // grain length seconds 0.05..1, default 0.25
  grainSpray?: number // scatter around the playhead, 0..1 of the trim, default 0.15
  grainReverse?: number // probability a grain plays backward 0..1, default 0.25
  grainJitter?: number // per-grain speed jitter 0..1, default 0.2
  // BPM-synced grain clock : grains retrigger on the beat grid. 0 = free-run
  // (grainSize seconds); else beats-per-grain (0.25 = 16th … 2 = half note).
  grainSync?: number
  // Source framing (video + capture): sample transform applied on upload.
  zoom?: number // scale about centre, default 1
  panX?: number // -1..1, default 0
  panY?: number // -1..1, default 0
  cropL?: number // trim left edge 0..0.9, default 0
  cropR?: number // trim right edge 0..0.9, default 0
  cropT?: number // trim top edge 0..0.9, default 0
  cropB?: number // trim bottom edge 0..0.9, default 0
  // For the native Text generator (shaderId 'gen-text'): the string, and an
  // optional sidechain whose texture FILLS the glyphs (letters as a matte).
  text?: string
  sidechain?: SidechainRef | null
  // For the native Collage generator (shaderId 'gen-collage'): the scanned
  // folder and the playable clip pool it produced. The POOL travels with the
  // session (like an assemblage's edl) so a saved collage replays from the
  // source files alone, with no re-scan and no re-conversion.
  collageFolder?: string
  collagePool?: import('./collage').CollageClip[]
  // Collage `feed: assemblages` : one small edit per piece, copied out of the
  // Assemble bank so the session does not depend on machine-local storage.
  collageEdls?: import('./collage').CollageEdl[]
}

// Where a native convolution node reads its "impulse"/energy source from: another
// layer's composited output, or an imported still/clip asset. null = inert.
export type SidechainRef =
  | { kind: 'layer'; layer: number }
  | { kind: 'asset'; assetId: string }

// One FX in a rack. Usually an ISF shader (brief §5); a `node-*` shaderId marks a
// native multi-pass convolution node (visual-convolution spec) run by a TS class
// instead of the ISF runtime : it carries an extra sidechain source.
export interface FxInstance extends ShaderInstance {
  id: string
  enabled: boolean
  // Dry/wet : the engine blends the FX output back over its input by this
  // amount (1 = fully wet). Undefined ⇒ 1 for older sessions.
  opacity?: number
  // Pinned rack units (the master Vibe Palette): always on, not removable,
  // always last in the chain.
  locked?: boolean
  // Native convolution nodes only: the sidechain (impulse) source.
  sidechain?: SidechainRef | null
}

// One of the four layers.
// A/B coupling (Slab 1 : the coupling-engine spine). A layer's two "voices"
// (source A and B) are bound by an audio feature: the A↔B balance leans or
// pumps with the sound. `tightness` runs obvious↔vestigial (linear response ↔
// only strong peaks). Slab 2 adds the full synchresis mode catalogue.
export type CouplingMode = 'off' | 'lean' | 'hocket' | 'cut' | 'gate' | 'drift'

// World / diegesis (Slab 1) : a single, global "proposed world" that biases the
// whole composition: it sets every layer's A/B coupling character and nudges
// the Context depth-finalizer's mood. A bias, not a lock : manual edits after
// still win. Later slabs deepen each world's audio routing + source choices.
//
// An editable World preset. Built-ins ship with the app (id = a built-in world);
// user worlds are saved to localStorage. A World biases the composition when
// selected: A/B coupling character + Context mood + an optional audio-routing
// default. Vibe (the user's palette) is deliberately NOT touched.
export interface World {
  id: string
  name: string
  builtin: boolean
  blurb: string
  coupling: LayerCoupling // A/B bond character applied to every layer
  context: Record<string, number> // Context finalizer mood nudges (safe bands)
  // Optional Finalizer input overrides : the curated home for the Cameraless /
  // direct-film character (film* params). Absent ⇒ the World forces film off, so
  // switching to a non-film World clears any drawn-film hold. Vibe stays untouched.
  finalizer?: Record<string, number>
  // Audio routing default: an audio modulator the World can install on apply,
  // driving one common target. null = none.
  autoMod: { feature: AudioFeature; target: WorldAudioTarget; depth: number } | null
}

// Where a World's default audio modulator lands. Kept to a few safe Context
// inputs (all valid mod targets); the World reserves modulator slot 8 for it.
export type WorldAudioTarget = 'none' | 'haze' | 'bloom' | 'trails'
export const WORLD_AUDIO_TARGETS: WorldAudioTarget[] = ['none', 'haze', 'bloom', 'trails']
// Modulator slot the World manages for its audio-routing default (0-based).
export const WORLD_AUTOMOD_SLOT = 7
export interface LayerCoupling {
  mode: CouplingMode
  amount: number // 0..1 : depth
  tightness: number // 0..1 : vestigial (0) ↔ obvious (1)
  feature: AudioFeature // which audio feature drives the bond
}

export interface LayerState {
  id: string
  sourceA: SourceSlot
  sourceB: SourceSlot | null
  // Per-source FX (applied before the two sources are mixed) live on the
  // slot's own rack; the per-layer rack applies to the mixed layer.
  sourceAFx: FxInstance[]
  sourceBFx: FxInstance[]
  fx: FxInstance[] // finite per-layer FX rack
  blend: BlendMode // against the stack below
  opacity: number // 0..1
  mute: boolean
  solo: boolean
  feedback: boolean // does this layer sample its own previous frame
  // Trail persistence when feedback is on: 0 = none, →1 = long decay trails.
  feedbackAmount: number
  // A/B source crossfade : 0 = A only, 1 = B only. Ignored while B is empty.
  sourceMix: number
  // How B combines with A before the crossfade: out = mix(A, blend(A,B), mix).
  sourceBlend: BlendMode
  // A/B harmony (consonant↔dissonant axis) : 0 = consonant (B matched
  // to A), 1 = dissonant (B hue rotated toward complementary; clashes yet stays
  // time-locked). A colour-relationship macro on the A/B pair.
  harmony: number
  // Global time multiplier for this layer's sources + racks (1 = realtime).
  speed: number
  // A/B audio coupling (Slab 1). Off by default.
  coupling: LayerCoupling
  // Per-layer spatial mask : multiplies the layer's contribution to the stack,
  // beyond blend + opacity (luma / gradient / shape). Applied in the blend pass.
  mask: LayerMask
}

// A spatial mask on a layer's stack contribution. mode : 0 none · 1 luma (the
// layer's own luminance window) · 2 gradient (a linear fade) · 3 shape (box↔ellipse
// window). `soft` feathers every edge; `invert` flips the mask.
export interface LayerMask {
  mode: number
  invert: boolean
  soft: number
  lumaLo: number // luma : keep where the layer's luminance is within [lo, hi]
  lumaHi: number
  angle: number // gradient : direction (radians)
  pos: number // gradient : edge position along the axis (0..1)
  cx: number // shape : centre
  cy: number
  size: number // shape : radius
  aspect: number // shape : x/y stretch
  round: number // shape : 0 = box, 1 = ellipse
}

// ── Modulation (brief §6 : ported from dataFLOU) ─────────────────────
export type ModulatorType =
  | 'lfo'
  | 'ramp'
  | 'adsr'
  | 'arp'
  | 'random'
  | 'sh'
  | 'slew'
  | 'chaos'
  | 'audio'
  | 'organic'
  | 'physics'
  | 'motion'
  | 'vision'
  | 'homeostat'
  | 'euclid'
  | 'turing'
  | 'cellular'

// Which audio feature an `audio` modulator follows (bus in engine/audioIn.ts).
export type AudioFeature = 'level' | 'flux' | 'transient' | 'centroid' | 'band' | 'pitch'

// Which picture feature a `vision` modulator follows (bus in engine/visionIn.ts) :
// the RETURN PATH — the composited image drives control.
export type VisionFeature =
  | 'brightness'
  | 'contrast'
  | 'motion'
  | 'edges'
  | 'entropy'
  | 'centroidX'
  | 'centroidY'
  | 'warmth'
  | 'depth'
  | 'depthSpread'

// Force-driven motion for the `physics` modulator.
export type PhysicsMotion = 'bounce' | 'spring' | 'riser'

// Named motion archetypes + force behaviours
// for the `motion` modulator : each a characteristic scalar
// trajectory, clocked like an LFO.
export type MotionShape =
  | 'ascent'
  | 'descent'
  | 'oscillation'
  | 'rotation'
  | 'dilation'
  | 'contraction'
  | 'convergence'
  | 'divergence'
  | 'gravity'
  | 'wind'
  | 'attract'
  | 'drag'
export const MOTION_SHAPES: MotionShape[] = [
  'ascent', 'descent', 'oscillation', 'rotation', 'dilation', 'contraction',
  'convergence', 'divergence', 'gravity', 'wind', 'attract', 'drag'
]

export type LfoShape =
  | 'sine'
  | 'triangle'
  | 'square'
  | 'sawtooth'
  | 'rndStep'
  | 'rndSmooth'
  | 'spastic'

// The 14 output curves (dataFLOU's scaleMetaValue vocabulary).
export type ModCurve =
  | 'linear'
  | 'log'
  | 'exp'
  | 'geom'
  | 'easeIn'
  | 'easeOut'
  | 'cubic'
  | 'sqrt'
  | 'sigmoid'
  | 'smoothstep'
  | 'db'
  | 'gamma'
  | 'step'
  | 'invert'

export type ArpMode = 'up' | 'down' | 'upDown' | 'random' | 'drunk'

// One modulator slot's configuration (runtime state lives in the engine).
export interface ModulatorConfig {
  type: ModulatorType
  enabled: boolean
  // Clock : shared vocabulary with dataFLOU: free Hz or BPM-synced division.
  sync: 'free' | 'bpm'
  rateHz: number
  divisionIdx: number
  dotted: boolean
  triplet: boolean
  // SLIP : how much this modulator's events depart from its own metric grid,
  // 0 = dead regular. The mechanism is a Bernoulli SKIP — the clock still ticks,
  // some ticks just don't fire — which is what makes it read as polyrhythm
  // rather than as sloppiness: events never land off-grid, there are simply
  // fewer of them. (Same law that gives Spastic its un-feelable clock, and the
  // same one S&H spells 'probability'.) Currently read by `arp` only; the field
  // lives at clock level so extending it to the other grid-locked types is
  // purely additive. Optional — absent is 0, so old sessions are unchanged.
  slip?: number
  // Output shaping.
  curve: ModCurve
  // Type-specific parameter blocks (only the active type's block is read).
  shape: LfoShape // lfo
  // Spastic only : what it throws on each cycle. 'binary' is the original
  // hard flip between the two extremes; 'float' lands anywhere in between,
  // which is the same stepped-noise family with the quantisation removed.
  // Optional so older sessions keep the binary behaviour they were made with.
  spasticMode?: 'binary' | 'float'
  ramp: { rampMs: number; curvePct: number; mode: 'normal' | 'inverted' | 'loop' }
  adsr: {
    attackMs: number
    decayMs: number
    sustainMs: number
    releaseMs: number
    sustainLevel: number
    loop: boolean
  }
  arp: { steps: number; mode: ArpMode }
  random: { distribution: number } // 0.5 = uniform; >0.5 centre-hug, <0.5 edge-weight
  sh: { probability: number; smooth: boolean; distribution: number }
  slew: { riseMs: number; fallMs: number; randomTarget: boolean }
  chaos: { r: number } // logistic-map r in [3.4, 4.0]
  audio: { feature: AudioFeature; band: number; smooth: number } // follows the audio bus
  organic: { variation: number } // 0 = near-LFO, 1 = very irregular (never repeats)
  physics: { motion: PhysicsMotion; damping: number } // force-driven motion
  motion: { shape: MotionShape } // named motion archetype / force behaviour
  vision: { feature: VisionFeature; smooth: number } // follows the picture (return path)
  // Negative-feedback controller : watches a picture feature and integrates a
  // corrective output that (bound in `replace` mode) nudges the param to hold the
  // feature at `setpoint` — AGC-as-modulator, parks the rig at edge-of-chaos.
  // Regulates around a self-adapting baseline (so features that sit high/low still
  // give full control range); `gain` = grip (sensitivity + drive), `adapt` =
  // baseline re-centre rate.
  homeostat: { feature: VisionFeature; setpoint: number; gain: number; adapt: number }
  // ── Generative clocked sequencers (LZX Videomancer borrows) ──
  // Euclidean rhythm : `pulses` onsets spread evenly (Bjorklund) over `steps`,
  // advancing one step per clock. `decay` is the release each pulse fades over
  // once it ends — 0 = a hard on/off GATE, up = a soft pluck / swell so the
  // output rides continuously between beats instead of just 0/1. Grid-locked → SLIP.
  euclid: { steps: number; pulses: number; decay: number }
  // Turing machine : a `length`-bit shift register read as a value; each clock
  // shifts, feeding the falling bit back UNLESS `mutate` flips it — a looping
  // sequence that occasionally rewrites itself (0 = locked loop, 1 = free). SLIP.
  turing: { length: number; mutate: number }
  // Cellular automaton : a `cells`-wide 1-D elementary CA under Wolfram `rule`
  // (30/90/110/150), advanced one generation per clock; output = live-cell
  // density. Chaotic (30), fractal (90/150) or complex (110). Grid-locked → SLIP.
  cellular: { rule: number; cells: number }
}

// What an assignment modulates: float ISF inputs, or a Meta knob (the
// modulator then drives every destination the knob carries : macro motion).
// 'bgSource' addresses the Background slab's single source (no layer/slot).
// Sonify probe/pitch parameters reachable by the mod-matrix + Meta knobs.
export type SonifyModParam =
  | 'spectraX' | 'filterX'
  | 'orbitX' | 'orbitY' | 'orbitR' | 'orbitPitch'
  | 'rasterX' | 'rasterY' | 'rasterW' | 'rasterH' | 'rasterPitch'
  // Simple scalar targets (SONI_SIMPLE_MODS in sonify.ts) — breathe life into
  // the timbre / motion params, not just the probe positions.
  | 'spectraGain' | 'spectraGamma' | 'spectraSweep' | 'spectraBreath'
  | 'orbitDrive' | 'orbitSmooth'
  | 'flowDur' | 'flowColour'
  | 'eventsDecay'
  | 'rasterSmooth' | 'rasterTone'
  | 'sstvLine' | 'sstvDev'
  | 'filterQ' | 'filterSweep'
  | 'chordTone' | 'chordSpread' | 'chordAttack'
  | 'fxSend' | 'fxReverb' | 'fxDelay'
export const SONIFY_MOD_PARAMS: SonifyModParam[] = [
  'spectraX', 'filterX', 'orbitX', 'orbitY', 'orbitR', 'orbitPitch',
  'rasterX', 'rasterY', 'rasterW', 'rasterH', 'rasterPitch',
  'spectraGain', 'spectraGamma', 'spectraSweep', 'spectraBreath',
  'orbitDrive', 'orbitSmooth', 'flowDur', 'flowColour',
  'eventsDecay', 'rasterSmooth', 'rasterTone',
  'sstvLine', 'sstvDev', 'filterQ', 'filterSweep',
  'chordTone', 'chordSpread', 'chordAttack', 'fxSend', 'fxReverb', 'fxDelay'
]

export type ModTarget =
  | { kind: 'source'; layer: number; slot: 'A' | 'B'; input: string }
  | { kind: 'bgSource'; input: string }
  | { kind: 'fx'; scope: FxScope; instId: string; input: string }
  | { kind: 'meta'; knob: number }
  | { kind: 'sonify'; param: SonifyModParam }
  // Compositor-level layer controls (not ISF inputs) : the layer's own opacity,
  // its A/B source mix, and its blend-against-the-stack mode (driven as an enum
  // index that cycles through BLEND_MODES). Applied as a final per-frame override.
  | { kind: 'layer'; layer: number; field: 'opacity' | 'mix' | 'blend' }

// Sentinel `input` name that turns an `fx` ModTarget into the FX unit's dry/wet
// OPACITY (a compositor property, not an ISF uniform), so per-FX opacity rides
// the exact same fx target plumbing (key, label, removal-pruning, session save).
export const FX_OPACITY_INPUT = '__opacity'

// Addresses one of the FX racks (per-source, per-layer, master, or background).
export type FxScope =
  | { kind: 'master' }
  | { kind: 'background' }
  | { kind: 'layer' | 'sourceA' | 'sourceB'; layer: number }

// How a modulator combines with the parameter's base value:
//  - 'multiply' (default for new bindings): VCA-style : the base is scaled by
//    the modulator, `|depth|` sets how deep (base·1 → base·mod), negative depth
//    inverts the signal. A param resting at 0 stays 0 (multiply of nothing).
//  - 'replace': the modulator swings the value bipolarly around the base over
//    `depth`·range (the original behaviour; kept for old sessions + randomize).
export type ModMode = 'multiply' | 'replace'

export interface ModAssignment {
  id: string
  mod: number // modulator slot 0..7
  target: ModTarget
  depth: number // -1..+1 : swing/scale amount
  mode?: ModMode // undefined = 'replace' (back-compat with pre-mode sessions)
}

// The cap is deliberate (simplexité): bounded modulation stays followable.
export const MAX_MOD_ASSIGNMENTS = 12

// ── Meta Controller (brief §6 : dataFLOU's macro surface) ─────────────
// 16 knobs, one flat bank. Each knob maps its 0..1 position through a curve
// onto up to 8 destinations (ISF float inputs), with per-knob smoothing and
// MIDI-CC learn. Modulators can drive knobs (ModTarget kind 'meta').
export const META_KNOB_COUNT = 16
export const META_MAX_DESTS = 8

// A learned MIDI control : a CC (knob/slider/button) or a Note (pad/key) on
// one channel. dataFLOU's shape, verbatim — the two apps share controllers.
export interface MidiBinding {
  kind: 'cc' | 'note'
  channel: number // 0..15
  number: number // CC# or note#
}

export interface MetaKnobState {
  name: string
  value: number // committed 0..1 position
  smoothMs: number
  curve: ModCurve // shapes the 0..1 before mapping to each target's range
  midiCc: { channel: number; number: number } | null
  destinations: ModTarget[] // max META_MAX_DESTS
}

// The Background slab : the stable ground UNDER the four layers. One source
// (curated generator set), a full FX rack, opacity and its own slow clock.
// Deliberately untouched by the global Randomize: the ground stays put while
// the layers churn. Optional on older sessions (normalized on load).
export interface BackgroundState {
  source: SourceSlot
  fx: FxInstance[]
  opacity: number // 0..1 (0 = off)
  speed: number // background clock multiplier : default 0.25 (slow ground)
  // Contact shadow the foreground casts onto the background (separation/depth).
  // 0 = off (optional). Undefined on older sessions ⇒ 0.
  depth?: number
  // How the four layers sit over the background:
  //  'blend'   : layer 1 blends onto the background with its own blend mode
  //              (Photoshop-standard; additive/screen layers glow it through).
  //  'isolate' : the four layers composite as their own group (layer 1 forced
  //              'normal'), then sit over the background; the background is a
  //              pure backdrop that never alters the inter-layer blends.
  blendMode?: 'blend' | 'isolate'
}

// The whole composition: background + four layers + master rack + transport.
export interface CompositionState {
  layers: LayerState[]
  background?: BackgroundState
  master: FxInstance[] // glitch / dither / chroma / grade + warp
  bpm: number
  modulators: ModulatorConfig[]
  modMatrix: ModAssignment[]
  metaKnobs: MetaKnobState[]
}

// ── Scenes (brief §7, §10.7) : recallable full-instrument states ──────
export interface SceneEntry {
  id: string
  name: string
  composition: CompositionState
  // The World active when the scene was saved (travels for the selector label +
  // portability; the composition already carries the World's baked effect).
  world?: World | null
  // Relation tags (macro-form sequencer). Auto-derived on first tag, editable.
  tags?: SceneTags
  // Sonify patch active when the scene was saved (recall switches the sound
  // half too). Opaque here : the renderer owns the SoniConfig shape.
  sonify?: unknown
  // Metasurface : this scene's point on the continuous 0..1 scene-space plane.
  // Absent = not placed yet (auto-placed on first use of the Surface).
  surface?: { x: number; y: number }
}

// The scene-relation schema : the sequencer's data model.
// Diégèse (which world) · Synchrèse (coupling character) · Espace-temps
// (compressed/dense ↔ decompressed/void) · Climat (affective charge).
export type SceneClimate = 'tension' | 'expectation' | 'release' | 'resolution'
export const SCENE_CLIMATES: SceneClimate[] = ['tension', 'expectation', 'release', 'resolution']
export interface SceneTags {
  world: string // Diégèse : a World id (built-in WorldMode or a user world's uuid)
  synchresis: CouplingMode[] // Synchrèse : the coupling character(s) this scene reads as
  spaceTime: number // Espace-temps : 0 dense/full · 0.5 neutral · 1 void
  climate: SceneClimate // Climat
}

// The generative scene / relation sequencer (macro-form engine). Session-scoped,
// sits BESIDE `scenes` (never inside a composition : that would recurse). See
// docs/opsia-sequencer-spec.md. S3 fields (cadence/rupture/monomedia) ship inert.
export type SequenceMode = 'weighted' | 'arc' | 'shuffle'
export type SequenceTransition = 'morph' | 'cut' | 'auto'
export type MonomediaStyle = 'black' | 'freeze'
export interface SequenceState {
  enabled: boolean
  running: boolean
  // Pacing (seconds).
  dwell: number
  dwellJitter: number // 0..1 humanise
  // Transition.
  transition: SequenceTransition
  crossfadeMs: number
  // Selection.
  mode: SequenceMode
  noRepeat: number
  variation: number // 0..1 → varyComposition per recall (no exact repeat)
  // Macro-form overlays (S2).
  breathe: { amount: number; periodSec: number } // Espace-temps oscillator
  arc: { enabled: boolean; lengthSec: number } // Repose–Disturbance–Repose
  // Durational long-forms (ecological texts, process/entropy family).
  // Burial → Exhumation : degrade the grade toward illegibility over minutes,
  // then recover (a slow cosine 0→1→0). Long-Take / Veil : a slowness governor
  // that FORBIDS auto-cuts and drives one slow veil (Context haze) over minutes.
  burial: { enabled: boolean; lengthSec: number; depth: number }
  longTake: { enabled: boolean; lengthSec: number; depth: number }
  // Frame-Weave (Rose Lowder) : temporal interlace. Instead of blending, show ONE
  // layer per frame, stepping through a paintable lattice at `rate` cells/sec so
  // persistence-of-vision fuses them. A cell = a layer index (0..3) or -1 (blank).
  frameWeave: { enabled: boolean; rate: number; cells: number[] }
  // Punctuation (S3 : inert for now).
  cadenceEvery: number
  ruptureChance: number
  monomediaChance: number
  monomediaStyle: MonomediaStyle
  // Deferred synchresis (S4): dwell becomes a MINIMUM, then the advance fires on
  // the next audio transient/onset, or a chaos modulator crossing a threshold
  //. 'off' = plain timer.
  audioAdvance: 'off' | 'transient' | 'onset' | 'chaos'
}

// ── Session persistence (brief §7) ───────────────────────────────────
// ── Metasurface draw sequencer ───────────────────────────────────────
// A drawn gesture over the 2D scene-space plane, auto-played by the render
// loop : the cursor traces the path over `timeMs`, in `way` direction, with
// `jump`% of random teleports to other spots (a jitter). Modeled on dataFLOU's
// Gesture playback (phase→playhead mapping), retargeted from a modulator to
// the surface cursor.
export interface SurfaceSequencer {
  // Recorded path, each point normalized to [0,1]² on the plane. Sampled by
  // index-fraction (drawn at ~display rate, so index ≈ even time).
  path: { x: number; y: number }[]
  // Milliseconds for the cursor to traverse the whole drawing once.
  timeMs: number
  // Play direction : forward, reversed, or a 0→1→0 triangle each loop.
  way: 'forward' | 'backward' | 'pingpong'
  // 0..100 % : chance/frequency the playhead jumps to a random spot (jitter).
  jump: number
  // 0..100 % : amplitude of a smooth sinusoidal wobble on the playhead — a
  // continuous vibrato around the traced position (vs jump's discrete teleports).
  wiggle: number
  // Closed path : connect the last point back to the first, so forward looping
  // flows around the cycle instead of teleporting end→start.
  closed: boolean
}

// ── Sonify sequencer ─────────────────────────────────────────────────
// A step timeline that evolves the Sonify engine over time (Mixer page). Each
// step either loads a whole saved preset (structural change) or, with no preset,
// just sets which of the 8 voices are on (a rhythmic on/off pattern over the
// current sound). One shared transport advances the steps.
export interface SoniSeqStep {
  voices: boolean[] // length 8 : per-voice on/off, applied when `preset` is empty
  preset: string // '' = apply the voices mask; else the name of a saved Sonify preset to load
}
export interface SoniSeq {
  on: boolean // transport running
  stepMs: number // dwell per step
  len: number // active step count (2..16)
  cur: number // current step (runtime; resets to 0 on load)
  // Step-advance mode (dataFLOU's): forward = linear loop · bounce = forward but
  // with an accelerating "bouncing-ball" rhythm each cycle · drift = a biased
  // random-walk playhead.
  mode: 'forward' | 'bounce' | 'drift'
  bounceDecay: number // 0..100 (bounce) : how hard the per-cycle rhythm accelerates
  bias: number // -100..100 (drift) : random-walk direction bias (back ↔ forward)
  edge: 'wrap' | 'reflect' // (drift) : behaviour at the ends
  steps: SoniSeqStep[] // length 16 (only the first `len` are used)
}

export interface Session {
  version: 1
  name: string
  composition: CompositionState
  // The scene bank travels with the session. It lives OUTSIDE composition:
  // recalling a scene replaces the composition without touching the bank,
  // and undo (which snapshots composition) never rewinds the bank itself.
  scenes?: SceneEntry[]
  // The active World when the session was saved (self-contained, so it resolves
  // even on another install; added to the bank on load if missing).
  world?: World | null
  // The macro-form sequencer config (session-scoped; auto-starts on load if it
  // was running). Optional for back-compat with pre-sequencer sessions.
  sequence?: SequenceState
  // Sonify config (the S page) : travels with the session. Opaque to main.
  sonify?: unknown
  // Sonify step sequencer : travels with the session so an evolving sonified
  // work is self-contained (preset steps reference machine-local preset names).
  soniSeq?: SoniSeq
  // Performance dials : the global clock multiplier + the scene-morph duration.
  // Optional for back-compat with sessions saved before they were persisted.
  globalSpeed?: number
  morphMs?: number
  // Metasurface draw sequencer : the recorded path + its playback timing.
  // The live cursor / active toggle stay runtime; only the gesture persists.
  surface?: SurfaceSequencer
  // Opaque renderer UI snapshot (theme, panel sizes, selection). The main
  // process never inspects it : it just round-trips it to disk.
  ui?: unknown
}


// ── Inbound OSC (Pandore → instrument) ───────────────────────────────
export interface OscInEvent {
  timestamp: number
  address: string
  args: Array<{ type: string; value: number | string | boolean }>
}

export interface OscListenResult {
  ok: boolean
  listening: boolean
  port: number
  addresses: string[]
  error?: string
}

/** One leaf of the OSCQuery address tree the renderer publishes to main. */
export interface OscQueryLeaf {
  full_path: string
  type?: string
  range?: { min?: number; max?: number }
  value?: number | number[]
  description?: string
  // OSCQuery ACCESS override (1 = read-only, 2 = write-only, 3 = read/write).
  // Defaults to 3 when omitted; set 1 for outbound-only leaves (e.g. vision).
  access?: number
}

// ── Autosave / crash recovery ────────────────────────────────────────
export interface AutosaveEntry {
  path: string
  name: string
  savedAt: number
}

// ── Preload surface exposed on window.api ────────────────────────────
export interface CaptureSourceInfo {
  id: string
  name: string
  isScreen: boolean
  thumbnail: string // data URL
}

// Per-frame render state pushed to the native output window (it drives its own
// Compositor from this : no WebRTC transcode).
export interface OutputFrame {
  c: CompositionState
  modValues: number[]
  modBypass?: boolean
  globalSpeed: number
  warpEnabled: boolean
  warpCorners: number[]
  warpGrid: boolean
  time: number
  // Per-layer coupled A/B mix (audio-driven) so the output window matches the
  // control window; absent when no layer is coupled.
  coupledMix?: number[] | null
  // Proximity's Context mood override (haze/blur/bloom/depth), so the output
  // window mirrors it; absent when Proximity is neutral.
  contextProx?: { haze: number; blur: number; bloom: number; depth: number } | null
  // ── Bottom-bar state, so the output window is an EXACT replica ──
  // Field macros (deterministic : the output re-applies them from these scalars).
  density?: number
  gestureTexture?: number
  coalesce?: number
  // Temperament results the output can't re-derive (audio / random / time based):
  // the exact master-FX input values Tonicity + Drift applied ({instId:{input:v}}).
  masterOverrides?: Record<string, Record<string, number>>
  // Shutter's whole-frame freeze decision (computed in the control window).
  freeze?: boolean
  // Superimposition flicker : amount + which layer was chosen "hot" this frame.
  superFlicker?: number
  flickerHot?: number
  // Frame-Weave : the lattice cell shown this frame (0..3 = layer, -1 = blank).
  // Absent = Frame-Weave off.
  weaveHot?: number
  // Strobe-safety limiter amount (0 = off) : the output window applies the same cap.
  strobeSafe?: number
  // In-flight Meta-knob gestures : [knob index, display 0..1] pairs the mirror
  // re-applies engine-side (the store only carries the settled value).
  metaGlides?: Array<[number, number]>
  // One-shot video seeks ("layer:slot" → 0..1 within trim) : the mirror's own
  // video decoders seek to the same spot (OSC /video/position).
  videoSeeks?: Array<[string, number]>
  // Shared audio texture rows (128 bytes each) : the mirror can't run the
  // audio bus, so per-element audio generators ride the same live data.
  audioRows?: { wave: number[]; spec: number[] }
  // Assemble mirroring ("layer:slot" → where the control window is in the
  // edit, plus any clip its live matcher just chose). The mirror runs its own
  // decks and has no vision bus, so without this it drifts on every load stall
  // and, in target-driven mode, plays an entirely different edit.
  assemble?: Array<{
    key: string
    idx: number
    elapsed: number
    // The full clip list, sent only when live matching changed it — so an
    // output window opened mid-performance catches up on the next cut.
    clips?: import('./assemble').AssembleClip[]
  }>
}

export interface DisplayInfo {
  id: number
  label: string
  width: number
  height: number
  isPrimary: boolean
}

// A HIVE HEVC access unit forwarded from the main process to the decoder.
export interface HiveAU {
  id: string
  key: boolean
  timestamp: number
  data: Uint8Array
}

// Connection health for a HIVE live-in source, pushed from the main process.
export interface HiveStatus {
  id: string
  ok: boolean
  error?: string
}

export interface ExposedApi {
  // Session I/O
  sessionSaveAs: (s: Session) => Promise<string | null>
  sessionSave: (s: Session, path: string) => Promise<boolean>
  sessionSaveToDefault: (s: Session) => Promise<string>
  sessionOpen: () => Promise<{ session: Session; path: string } | null>
  sessionList: () => Promise<Array<{ name: string; path: string; mtime: number }>>
  sessionLoad: (path: string) => Promise<Session>

  // Autosave / crash recovery
  autosaveCrashCheck: () => Promise<{ crashed: boolean; entries: AutosaveEntry[] }>
  autosaveList: () => Promise<AutosaveEntry[]>
  autosaveLoad: (path: string) => Promise<Session>
  // Renderer pushes the current session so the 60s autosave loop has
  // something fresh to snapshot even between manual saves.
  setCurrentSession: (s: Session) => Promise<void>

  // OSC control plane
  oscSend: (
    ip: string,
    port: number,
    address: string,
    args: Array<{ type: string; value: number | string | boolean }>
  ) => Promise<void>

  // OSC input : start/stop the listener + OSCQuery, and subscribe to messages
  oscListen: (port: number, enabled: boolean) => Promise<OscListenResult>
  onOscReceived: (cb: (batch: OscInEvent[]) => void) => () => void
  oscQueryPublish: (nodes: OscQueryLeaf[]) => Promise<void>
  // OSCQuery WebSocket value-stream: push live value diffs; be told when a
  // client is (dis)connected so the renderer only computes diffs when needed.
  oscQueryValues: (updates: Array<{ path: string; value: number | number[] }>) => void
  onOscQueryWsActive: (cb: (active: boolean) => void) => () => void

  // App lifecycle : save-before-quit handshake
  appCloseProceed: () => Promise<void>
  onAppBeforeClose: (cb: () => void) => () => void
  // Absolute path for a picked File (Electron 33 removed File.path).
  getMediaPath: (file: File) => string
  // Codec probe + ffmpeg conversion (DXV3 / HAP / ProRes… → all-intra H.264 cache).
  videoProbe: (path: string) => Promise<{
    ok: boolean
    codec: string | null
    durationSec: number
    needsConvert: boolean
    ffmpegAvailable: boolean
    error?: string
  }>
  videoConvert: (path: string) => Promise<{ ok: boolean; path?: string; cached?: boolean; error?: string }>
  onVideoConvertProgress: (cb: (p: { path: string; pct: number }) => void) => () => void
  /** The all-intra cache directory — a clip whose path is under it already scrubs smoothly. */
  videoCacheDir: () => Promise<string>
  // Collage : pick a folder, then reduce it to a pool of playable clips (one
  // entry per file, non-Chromium codecs converted through the same cache the
  // single-clip import uses).
  collagePickFolder: () => Promise<string | null>
  collageScan: (folder: string) => Promise<import('./collage').CollageScanResult>
  // The same scan, except EVERY clip is force-transcoded to 720p all-intra : the
  // wall seeks on every loop and every cut, and long-GOP files stutter it. One-
  // time cost per file, then cached; same result shape, so the pool is swapped
  // with it directly.
  collageOptimise: (folder: string) => Promise<import('./collage').CollageScanResult>
  onCollageProgress: (
    cb: (p: { done: number; total: number; file: string }) => void
  ) => () => void
  // Assemble : pick a corpus folder, then sweep it into a descriptor point cloud.
  assemblePickFolder: () => Promise<string | null>
  assembleAnalyze: (
    folder: string,
    opts?: { minUnit?: number; maxUnit?: number; sensitivity?: number }
  ) => Promise<{ ok: boolean; corpus?: import('./assemble').AssembleCorpus; error?: string }>
  onAssembleProgress: (
    cb: (p: import('./assemble').AnalyzeProgress) => void
  ) => () => void
  // Render an assemblage to a real video file (Recorded/).
  assembleExport: (
    clips: import('./assemble').AssembleClip[],
    name: string
  ) => Promise<{ ok: boolean; path?: string; error?: string }>
  onAssembleExportProgress: (cb: (p: { pct: number }) => void) => () => void
  // Screens + windows for the capture source picker.
  captureListSources: () => Promise<CaptureSourceInfo[]>
  // Output window (2nd display / projector) : mirror via WebRTC loopback.
  outputDisplays: () => Promise<DisplayInfo[]>
  outputOpen: (displayId: number, windowed?: boolean) => Promise<boolean>
  outputClose: () => Promise<boolean>
  onOutputClosed: (cb: () => void) => () => void
  outputFrame: (frame: OutputFrame) => void
  onOutputFrame: (cb: (frame: OutputFrame) => void) => () => void
  // HIVE live-in.
  hiveConnect: (id: string, host: string, port: number) => void
  hiveDisconnect: (id: string) => void
  onHiveAU: (cb: (au: HiveAU) => void) => () => void
  onHiveStatus: (cb: (s: HiveStatus) => void) => () => void
  // HIVE output (sender).
  hiveOutStart: (port: number) => Promise<{ ok: boolean; port: number }>
  hiveOutStop: () => Promise<boolean>
  hiveSendChunk: (key: boolean, data: Uint8Array) => void
  onHiveForceKey: (cb: () => void) => () => void
  // External output (NDI / Spout).
  ndiSet: (on: boolean) => Promise<boolean>
  spoutSet: (on: boolean) => Promise<boolean>
  ndiFrame: (w: number, h: number, pixels: Uint8Array) => void
  // Host resource monitor (Output HUD).
  perfStats: () => Promise<PerfStats>
  // Recording: intermediate MediaRecorder chunks streamed to main → ffmpeg
  // delivery-format transcode/remux on stop → Recorded/. Plus screenshot.
  recordingFormats: () => Promise<Array<{ id: string; label: string }>>
  recordingStart: (intermediateExt: string, codec: string) => Promise<boolean>
  recordingChunk: (data: Uint8Array) => void
  recordingStop: (formatId: string) => Promise<string | null>
  saveScreenshot: (data: Uint8Array) => Promise<string | null>
}

// A snapshot of the host resources Palinopsia is using, for the Output HUD.
// `cpu`/`ram` are Palinopsia's own share; `vram`/`gpu` are GPU-wide (per-process
// VRAM isn't reliably attributable). Any field is null when unavailable
// (e.g. no nvidia-smi).
export interface PerfStats {
  cpu: number | null // % CPU (summed across Palinopsia's processes)
  ram: number | null // % of host RAM used by Palinopsia
  vram: number | null // % of GPU VRAM in use (whole GPU)
  gpu: number | null // % GPU utilisation (whole GPU)
}
