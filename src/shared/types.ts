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
  | 'lightercolor'
  // 50 add : an additive crossfade. Opacity 0 shows the layers below, 0.5 adds the
  // layer on top of them at full, 1 shows the layer alone (the stack faded out).
  | '50add'

export const BLEND_MODES: BlendMode[] = [
  'normal',
  '50add', // (just before add, as Vincent asked; its shader index stays 19)
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
  'consume',
  'lightercolor'
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
  // An imported sound file : played like a film (the video* transport fields),
  // the layer showing its waveform (shaderId 'gen-audio' holds the look).
  | 'audio'

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
  // For kind:'video' : the ORIGINAL file on disk (mediaId may point at a converted
  // cache copy) : the Inspector browses its folder for the next clip.
  mediaPath?: string
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
  videoVolume?: number // the film's own sound, 0..1, default 0 (silent : films always were)
  // The clip plays at its own speed (× its layer's) whatever the global speed :
  // a sound kept at pitch and tempo while the composition slows or rushes.
  ignoreGlobalSpeed?: boolean
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
  // How the whole picture sits in the layer : 'stretch' fills it whatever the
  // aspect (the default, the old look; unset under full-dome fill it is 'cover' :
  // dome.ts defaultSourceFit), 'cover' fills it with the aspect kept
  // (edges cut), 'contain' shows all of it with the aspect kept (transparent around).
  fit?: 'stretch' | 'cover' | 'contain'
  zoom?: number // scale about centre, default 1
  panX?: number // -1..1, default 0
  panY?: number // -1..1, default 0
  // The crop CUTS the picture's edges away (transparent there); what is left
  // stays where it was. (It used to stretch what was left over the whole layer.)
  cropL?: number // trim left edge 0..0.9, default 0
  cropR?: number // trim right edge 0..0.9, default 0
  cropT?: number // trim top edge 0..0.9, default 0
  cropB?: number // trim bottom edge 0..0.9, default 0
  feather?: number // softens the picture's edges (the crop's or its own), 0..0.5 of the layer's height, default 0
  // Which way the picture faces, before the framing : 'x' turned left to right (a
  // mirror : the selfie view of a webcam), 'y' upside down (a camera hung upside
  // down), 'xy' both (half a turn). Default 'off'. Not part of Reset framing : it
  // is how the camera hangs, not how the picture is framed.
  mirror?: 'off' | 'x' | 'y' | 'xy'
  // People (video + capture) : a pose model finds the people in the slot's own
  // picture (engine/personMask.ts) : 'cutout' keeps only them, 'blur' blurs what is
  // around them, 'remove' takes them out, 'matte' is them in white on black.
  person?: 'off' | 'cutout' | 'blur' | 'remove' | 'matte'
  personCount?: number // how many people to look for, 1..4, default 2
  personBlur?: number // the background's blur, 0..1, default 0.5
  personSoft?: number // the mask's edge, 0..1 (hard → soft), default 0.3
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
  // What was done by hand on the picture (Marbling : drops, combs, swirls made
  // with the mouse on the preview), one entry per gesture with its events and
  // their steps, so the session (and each scene) reopens the same picture. The
  // engine replays it; a malformed one is cut to what is valid.
  handOps?: HandGestureLog[]
}

/** One gesture made by hand on a source's picture (one undo step). `k` : the
 *  source's own record kind ('m' : Marbling), `ev` : its events, flat numbers. */
export interface HandGestureLog {
  k: string
  id: number
  ev: number[]
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
  // A second sidechain, for the three-input nodes (Matte : the matte itself).
  sidechain2?: SidechainRef | null
  // Context only : the light's drawn path (the Metasurface's draw sequencer
  // over the light pad). Points in the light's own space (0..1, y up).
  lightPath?: LightPath
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
  // Which layers its coupling goes to (L1..L4); absent = all four. A layer left
  // out keeps its own coupling.
  layers?: boolean[]
}

// Where a World's default audio modulator lands. Kept to a few safe Context
// inputs (all valid mod targets); its modulator goes to the first free slot from
// M8 down (WORLD_AUTOMOD_SLOT).
export type WorldAudioTarget = 'none' | 'haze' | 'bloom' | 'trails' | 'depth' | 'lightGlow' | 'voidEdge'
export const WORLD_AUDIO_TARGETS: WorldAudioTarget[] = ['none', 'haze', 'bloom', 'trails', 'depth', 'lightGlow', 'voidEdge']
// Modulator slot the World prefers for its audio-routing default (0-based) : it
// takes the first FREE slot from there down (a modulator it installed carries
// `fromWorld`), never one of yours.
export const WORLD_AUTOMOD_SLOT = 7
export interface LayerCoupling {
  mode: CouplingMode
  amount: number // 0..1 : depth
  tightness: number // 0..1 : vestigial (0) ↔ obvious (1)
  feature: AudioFeature // which audio feature drives the bond
  band?: number // the band feature's band (0 : the lowest, up to AUDIO_BANDS - 1)
  // Level-matching : the feature heard against its own recent range (a quiet
  // track moves the mix as far as a loud one). Absent : on; false : the raw feature.
  auto?: boolean
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
  // How far this layer's own Vary nudges it. Optional : a session saved before
  // the control existed has none, and reads as the default.
  varyAmount?: number
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
  | 'body'
  | 'homeostat'
  | 'euclid'
  | 'turing'
  | 'cellular'
  | 'steps'

// Which audio feature an `audio` modulator follows (bus in engine/audioIn.ts).
// `noisiness` (spectral flatness) is the crossmodal partner of image saturation :
// bind sound noisiness → a layer's tint saturation to make the sound colour the picture.
export type AudioFeature = 'level' | 'flux' | 'transient' | 'centroid' | 'band' | 'pitch' | 'noisiness'
/** Where an audio modulator listens instead of the audio input : a layer slot's
 *  clip (a film's soundtrack or an audio file), read at its playhead. Layer -1 :
 *  the Audio Layer's file slots, or `slot: 'all'` its whole sound, live. */
export interface ClipAudioSrc { layer: number; slot: 'A' | 'B' | 'all' }

/** One of the Audio Layer's two slots (the layers tab, under L4) : a sound file,
 *  played like an Import Audio slot (the same transport fields), a live audio
 *  input, or an NDI® source's sound. */
export interface AudioLayerSlot {
  kind: 'file' | 'live' | 'ndi'
  // a file : what plays (opsia-media://…), its name, the file on disk
  mediaId?: string
  mediaName?: string
  mediaPath?: string
  videoPlaying?: boolean // default true
  videoSpeed?: number // 1/16..16 for sound, default 1 (× the global speed)
  videoLoop?: boolean // default true
  videoIn?: number // the trim, 0..1
  videoOut?: number
  ignoreGlobalSpeed?: boolean
  keepPitch?: boolean // a changed speed keeps the pitch (default : like tape)
  // a live input : the device (its label finds it again if its id changed) and
  // the channels taken, 0-based; chR < 0 : one channel (mono, on both sides)
  deviceId?: string
  deviceLabel?: string
  chL?: number
  chR?: number
  // an NDI source : its name on the network ("MACHINE (Source)"); its channels
  // are chL / chR as a live input's
  ndiName?: string
  volume: number // 0..2 (1 = as it comes)
  pan: number // -1..1
  mute?: boolean
}

/** The Audio Layer : two slots, the mix between them (0 = A only, 0.5 = both
 *  whole, 1 = B only), its volume, its mute. */
export interface AudioLayerState {
  A: AudioLayerSlot | null
  B: AudioLayerSlot | null
  mix: number
  volume: number // 0..2
  mute: boolean
}

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
  | 'saturation' // colourfulness : 0 grey, 1 vivid (crossmodal partner of sound noisiness/timbre)
  | 'hue' // dominant hue angle 0..1 around the wheel (red→yellow→green→cyan→blue→magenta)
  | 'depth'
  | 'depthSpread'

// ── Embodied control (MediaPipe : Hands + Pose ; Face is a planned drop-in) ──
// A `body` modulator follows one of these features off the body bus (the LIVE
// WEBCAM of the performer → hand/pose landmarks → scalars). This is the FORWARD
// path : the room plays the instrument, distinct from `vision` (the composited
// output analysed back into control). Every value is normalised 0..1 and read by
// engine/modulation.ts exactly like the audio / vision buses. Bus : engine/bodyIn.ts.
export type BodyFeature =
  // Hands (per hand + two-hand relations)
  | 'handLeftHeight' // left wrist height : 0 low, 1 high
  | 'handRightHeight'
  | 'handLeftX' // left wrist horizontal : 0 left edge, 1 right edge (mirrored)
  | 'handRightX'
  | 'handLeftOpen' // finger spread : 0 fist, 1 open
  | 'handRightOpen'
  | 'handsApart' // wrist-to-wrist distance : 0 together, 1 wide (the accordion)
  | 'handsHeight' // mean of both wrists' height
  // Hand shape (engine/handShape.ts : geometry on the same 21 points, per hand).
  // Curls from joint angles, pinches in the hand's own palms, so both read the
  // same near the camera or far from it.
  | 'handLeftCurlThumb' | 'handLeftCurlIndex' | 'handLeftCurlMiddle' | 'handLeftCurlRing' | 'handLeftCurlPinky' // 0 straight, 1 curled
  | 'handRightCurlThumb' | 'handRightCurlIndex' | 'handRightCurlMiddle' | 'handRightCurlRing' | 'handRightCurlPinky'
  | 'handLeftPinchIndex' | 'handLeftPinchMiddle' | 'handLeftPinchRing' | 'handLeftPinchPinky' // thumb tip to that fingertip : 0 apart, 1 touching
  | 'handRightPinchIndex' | 'handRightPinchMiddle' | 'handRightPinchRing' | 'handRightPinchPinky'
  | 'handLeftAngle' | 'handRightAngle' // roll as you see it : 0 fingers left, 0.5 up, 1 right
  | 'handLeftFacing' | 'handRightFacing' // 0 back of the hand, 0.5 edge-on, 1 palm toward the camera
  | 'handLeftSpan' | 'handRightSpan' // apparent size : 0 far from the camera, 1 close
  // Pose (whole body)
  | 'bodyMotion' // overall landmark velocity / energy 0..1
  | 'bodyLean' // torso lean : 0 left, 0.5 centred, 1 right
  | 'bodySway' // shoulder-line tilt : 0 down-left, 0.5 level, 1 down-right
  | 'armSpan' // wrist-to-wrist over shoulder width : 0 closed, 1 spread
  | 'bodyHeight' // stance : 0 crouched, 1 tall
  | 'handsUp' // hands above the head : 0 down, 1 fully raised
  | 'weightLR' // centre-of-mass horizontal : 0 left, 0.5 centred, 1 right
  // Face (MediaPipe FaceLandmarker : blendshapes 0..1 + head pose from geometry)
  | 'faceJawOpen' // mouth open : 0 closed, 1 wide
  | 'faceSmile' // smile : 0 neutral, 1 broad
  | 'faceBrowUp' // brows raised : 0 rest, 1 high
  | 'faceBlink' // eyes closed : 0 open, 1 shut (both)
  | 'faceMouthPucker' // lips pursed : 0 rest, 1 pucker
  | 'faceHeadYaw' // head turn : 0 left, 0.5 centred, 1 right
  | 'faceHeadPitch' // head nod : 0 down, 0.5 level, 1 up
  | 'faceHeadRoll' // head tilt : 0 left, 0.5 level, 1 right
  // Silhouette (PoseLandmarker segmentation mask : how much of each screen zone the
  // body fills, 0 empty .. 1 filled). A 3×3 grid + a whole-frame coverage. The
  // shadow-theatre control : cover a region to drive a param or fire a rule.
  | 'zoneTL' | 'zoneTC' | 'zoneTR'
  | 'zoneML' | 'zoneMC' | 'zoneMR'
  | 'zoneBL' | 'zoneBC' | 'zoneBR'
  | 'bodyCover' // whole-frame silhouette coverage 0..1
  // Motion field (dense optical flow of the camera image, engine/flowField.ts) :
  // no body model, it reads whatever moves in front of the camera.
  | 'flowEnergy' // how much moves : 0 still, 1 a lot, fast
  | 'flowX' // mean horizontal motion : 0 leftward, 0.5 none, 1 rightward
  | 'flowY' // mean vertical motion : 0 downward, 0.5 none, 1 upward
  | 'flowDivergence' // 0 closing in (withdraw, arms folding), 0.5 none, 1 spreading (approach, arms opening)
  | 'flowCurl' // 0 turning counter-clockwise, 0.5 none, 1 turning clockwise
  | 'flowCoherence' // 0 scattered motion (a dance, a crowd), 1 everything one way (a sweep)
  | 'flowCenterX' // where the motion is, horizontally 0..1
  | 'flowCenterY' // where the motion is, vertically 0..1 (0 = top)
  | 'flowArea' // share of the frame that moves 0..1
  // Movement qualities (engine/effort.ts, from the pose) : HOW the body moves.
  | 'moveEnergy' // 0 still .. 1 vigorous (the weight of the movement)
  | 'moveExpansion' // 0 folded in .. 1 limbs spread far from the body
  | 'moveFluidity' // 0 jerky (a shake, a stop-go) .. 1 smooth (a sweep)
  | 'moveSuddenness' // 0 sustained .. 1 sudden
  | 'moveDirectness' // 0 wandering (circles, meanders) .. 1 straight to the point
  | 'moveSymmetry' // 0 lopsided .. 1 left and right mirror each other
  // Presence gates (smoothed 0..1)
  | 'bodyPresent'
  | 'handsPresent'
  | 'facePresent'
// The features by body region : the Body page's monitor rows and the body
// modulator's menu groups. Each hand-shape pair sits left then right.
export const BODY_FEATURE_GROUPS: Array<{ title: string; keys: BodyFeature[] }> = [
  { title: 'Hands', keys: ['handLeftHeight', 'handRightHeight', 'handLeftX', 'handRightX', 'handLeftOpen', 'handRightOpen', 'handsApart', 'handsHeight'] },
  {
    title: 'Hand shape',
    keys: [
      'handLeftCurlThumb', 'handRightCurlThumb', 'handLeftCurlIndex', 'handRightCurlIndex', 'handLeftCurlMiddle', 'handRightCurlMiddle',
      'handLeftCurlRing', 'handRightCurlRing', 'handLeftCurlPinky', 'handRightCurlPinky',
      'handLeftPinchIndex', 'handRightPinchIndex', 'handLeftPinchMiddle', 'handRightPinchMiddle',
      'handLeftPinchRing', 'handRightPinchRing', 'handLeftPinchPinky', 'handRightPinchPinky',
      'handLeftAngle', 'handRightAngle', 'handLeftFacing', 'handRightFacing', 'handLeftSpan', 'handRightSpan'
    ]
  },
  { title: 'Pose', keys: ['bodyMotion', 'bodyLean', 'bodySway', 'armSpan', 'bodyHeight', 'handsUp', 'weightLR'] },
  { title: 'Face', keys: ['faceJawOpen', 'faceSmile', 'faceBrowUp', 'faceBlink', 'faceMouthPucker', 'faceHeadYaw', 'faceHeadPitch', 'faceHeadRoll'] },
  { title: 'Silhouette (zones)', keys: ['zoneTL', 'zoneTC', 'zoneTR', 'zoneML', 'zoneMC', 'zoneMR', 'zoneBL', 'zoneBC', 'zoneBR', 'bodyCover'] },
  { title: 'Motion field', keys: ['flowEnergy', 'flowX', 'flowY', 'flowDivergence', 'flowCurl', 'flowCoherence', 'flowCenterX', 'flowCenterY', 'flowArea'] },
  { title: 'Movement qualities', keys: ['moveEnergy', 'moveExpansion', 'moveFluidity', 'moveSuddenness', 'moveDirectness', 'moveSymmetry'] },
  { title: 'Presence', keys: ['bodyPresent', 'handsPresent', 'facePresent'] }
]
export const BODY_FEATURES: BodyFeature[] = BODY_FEATURE_GROUPS.flatMap((g) => g.keys)

// Discrete body gestures : one-shot onsets (threshold + cooldown, like the audio
// bus's `transient`). An early slice of the ① trigger/event layer : each fires a
// bound GestureAction. More can be added without touching the routing.
export type BodyGesture =
  // Hands
  | 'pinchLeft' | 'pinchRight' | 'clap' | 'cross'
  // Pose (whole body)
  | 'handsUp' | 'leanLeft' | 'leanRight' | 'crouch' | 'jump' | 'armsCross' | 'tPose' | 'raiseLeft' | 'raiseRight'
  // Face (blendshapes + head pose)
  | 'mouthPop' | 'browRaise' | 'winkLeft' | 'winkRight'
  | 'smile' | 'frown' | 'browFurrow' | 'squint' | 'cheekPuff' | 'kiss'
  | 'jawLeft' | 'jawRight' | 'mouthLeft' | 'mouthRight' | 'tongueOut' | 'blinkBoth'
  | 'headLeft' | 'headRight' | 'headUp' | 'headDown' | 'tiltLeft' | 'tiltRight'
  // Hold-duration triggers : a sustained pose fires ONCE after being held for
  // `holdMs`, then re-arms when released. Not onsets — a deliberate, held move.
  | 'holdHandsUp' | 'holdPinchLeft' | 'holdPinchRight' | 'holdArmsWide' | 'holdMouthOpen'
  // Zone occlusion (silhouette) : the body's shadow covers one of the 3×3 screen
  // zones past a threshold. A screen-space, shadow-theatre trigger (needs the
  // Silhouette toggle, which runs the pose segmentation mask).
  | 'coverTL' | 'coverTC' | 'coverTR'
  | 'coverML' | 'coverMC' | 'coverMR'
  | 'coverBL' | 'coverBC' | 'coverBR'
  // Presence edges : the body / hands / face enters or leaves the frame (debounced
  // so a one-frame detection drop can't false-fire). The installation trigger :
  // someone walks in → fire ; the room empties → reset.
  | 'bodyEnter' | 'bodyLeave' | 'handsEnter' | 'handsLeave' | 'faceEnter' | 'faceLeave'
  // Motion field (the Motion toggle) : a sweep one way, an approach or a withdrawal,
  // a turn, and the room going still after moving (the stillness itself fires).
  | 'swipeLeft' | 'swipeRight' | 'swipeUp' | 'swipeDown'
  | 'approach' | 'withdraw' | 'spinCW' | 'spinCCW' | 'stillness'
  // Movement qualities (the pose) : a burst out of calm, a quick stop held still.
  | 'impulse' | 'freeze'
  // Hand shapes (engine/handShape.ts : read from the fingers' curls) : each fires
  // once when the shape is made and has held a moment, per hand, and again only
  // after the hand has let it go.
  | 'fistLeft' | 'fistRight' | 'openLeft' | 'openRight' | 'pointLeft' | 'pointRight'
  | 'peaceLeft' | 'peaceRight' | 'thumbUpLeft' | 'thumbUpRight' | 'thumbDownLeft' | 'thumbDownRight'
  | 'okLeft' | 'okRight' | 'hornsLeft' | 'hornsRight' | 'callLeft' | 'callRight' | 'gunLeft' | 'gunRight'
export const BODY_GESTURES: BodyGesture[] = [
  'pinchLeft', 'pinchRight', 'clap', 'cross',
  'handsUp', 'leanLeft', 'leanRight', 'crouch', 'jump', 'armsCross', 'tPose', 'raiseLeft', 'raiseRight',
  'mouthPop', 'browRaise', 'winkLeft', 'winkRight',
  'smile', 'frown', 'browFurrow', 'squint', 'cheekPuff', 'kiss',
  'jawLeft', 'jawRight', 'mouthLeft', 'mouthRight', 'tongueOut', 'blinkBoth',
  'headLeft', 'headRight', 'headUp', 'headDown', 'tiltLeft', 'tiltRight',
  'holdHandsUp', 'holdPinchLeft', 'holdPinchRight', 'holdArmsWide', 'holdMouthOpen',
  'coverTL', 'coverTC', 'coverTR', 'coverML', 'coverMC', 'coverMR', 'coverBL', 'coverBC', 'coverBR',
  'bodyEnter', 'bodyLeave', 'handsEnter', 'handsLeave', 'faceEnter', 'faceLeave',
  'swipeLeft', 'swipeRight', 'swipeUp', 'swipeDown', 'approach', 'withdraw', 'spinCW', 'spinCCW', 'stillness',
  'impulse', 'freeze',
  'fistLeft', 'fistRight', 'openLeft', 'openRight', 'pointLeft', 'pointRight',
  'peaceLeft', 'peaceRight', 'thumbUpLeft', 'thumbUpRight', 'thumbDownLeft', 'thumbDownRight',
  'okLeft', 'okRight', 'hornsLeft', 'hornsRight', 'callLeft', 'callRight', 'gunLeft', 'gunRight'
]

// What a gesture fires : one of the shared discrete-trigger action ids (the same
// vocabulary MIDI Learn binds and the keyboard fires — engine/midi.ts
// TRIGGER_ACTION_IDS, e.g. 'fire:randomize', 'scene:next', 'sonify:voice:0'), or
// 'none' to unbind. Routing, not new engine : adding an action is a one-liner in
// engine/midi.ts and it appears for MIDI, keys and gestures at once.
export type GestureAction = string

// A user-authored gesture rule (the Body page's rule builder). Maps ONE gesture,
// or a COMBO of two, to an action. Combos fire on top of the built-in per-gesture
// map, so set a component gesture to 'none' there if you want only the combo.
//   combo 'together' : both gestures within a short window, order-independent
//   combo 'then'     : g1 first, then g2, within the window (a sequence)
export interface GestureRule {
  id: string
  name: string
  g1: BodyGesture
  g2: BodyGesture | null // null = a single-gesture rule
  combo: 'together' | 'then'
  action: GestureAction
  // Custom OSC output name (the message sent is /body/<osc> when OSC out is on).
  // Blank at author time is baked to a truncated CamelCase default, e.g.
  // 'HandsUpRndMod'. A rule may carry only OSC (action 'none') to play the sound
  // side without touching the picture.
  osc: string
  enabled: boolean
  // Exclusive : when this combo fires, swallow the component gestures' own single
  // actions (a chord that doesn't also play its notes). Costs a small look-ahead
  // delay on those singles, so it is opt-in per rule.
  exclusive: boolean
}

// Machine-local embodied-control config (a webcam is machine-bound, like warp).
// NOT part of a session : it lives in the store's `bodyControl` slice + localStorage.
export interface BodyControlConfig {
  enabled: boolean // master : off by default (a camera : explicit opt-in)
  deviceId: string | null // chosen videoinput, or null = default camera
  hands: boolean // run the HandLandmarker
  pose: boolean // run the PoseLandmarker
  face: boolean // run the FaceLandmarker (blendshapes + head pose)
  silhouette: boolean // run the pose segmentation mask → 3×3 zone coverage features + occlusion gestures (needs pose; heavier)
  flow: boolean // read the camera's motion field (optical flow) → flow features + swipe / approach / spin / stillness gestures (no model : cheap)
  mirror: boolean // flip X so moving right moves the value right (selfie view)
  hiRes: boolean // track on every display frame, not only each new camera frame (twice the cost)
  sensitivity: number // 0..1 : global gain on gesture thresholds (higher = easier)
  gestureSensitivity: Partial<Record<BodyGesture, number>> // per-gesture override of `sensitivity` (a gesture with its own value fires at that threshold instead of the global one)
  holdMs: number // how long a pose must be held for a hold-* gesture to fire (ms)
  pinchPointer?: boolean // each hand's pinch acts as a pointer on the picture (pointerInput.ts : Marbling's drops), off by default
  oscOut: boolean // when a rule fires, also send /body/<its osc name> over OSC
  gestures: Partial<Record<BodyGesture, GestureAction>> // legacy per-gesture map (unused : all routing is rules now; kept for stored configs)
  rules: GestureRule[] // user-authored rules (single + combo) from the rule builder
}

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

/** When one step of a `steps` modulator plays (engine/stepSeq.ts reads it) :
 *  'always'; 'p<percent>' that often ('p25'); '<a>:<b>' on the a-th of every b
 *  passes through the pattern ('1:2', '3:4'), counted from the start of the run;
 *  'fill' / '!fill' only while FILL is on / off; 'first' / '!first' only on the
 *  run's first pass / on every pass but the first. */
export type StepCond = 'always' | 'fill' | '!fill' | 'first' | '!first' | `p${number}` | `${number}:${number}`

/** The `steps` modulator : a 16-step sequencer. Each array holds 16 entries
 *  (the steps past `length` keep theirs, so a shorter pattern grows back). */
export interface StepsConfig {
  length: number // 1..16 steps played
  values: number[] // each step's value (the bar's height), 0..1
  on: boolean[] // false : a rest, it never plays
  cond: StepCond[] // each step's condition
  swing: number // 50..75 % : 50 straight; every second step lands late by (swing - 50) % x 2 of a step
  glide: number // 0..1 of a step : the slide from one value to the next (0 = hard steps)
  rest: 'hold' | 'zero' // a step that does not play : the output holds, or drops to 0
}

// One modulator slot's configuration (runtime state lives in the engine).
export interface ModulatorConfig {
  type: ModulatorType
  enabled: boolean
  // Installed by a World's audio routing : the next World replaces it (yours never).
  // Cleared the moment you change it or its bindings : from then on it is yours.
  fromWorld?: boolean
  // The ids of the bindings that World installed with it : the only rows a World
  // ever removes (one you add to it is yours, and makes the modulator yours).
  worldRows?: string[]
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
  // Spastic only : how long (ms) a throw stays up before it drops back to the
  // bottom. The clock (rate) then only decides WHEN it may rise; the time up is
  // its own. 0 / absent = it holds until the next throw (the original).
  spasticHold?: number
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
  audio: { feature: AudioFeature; band: number; smooth: number; src?: ClipAudioSrc } // follows the audio bus, or a slot's clip
  organic: { variation: number } // 0 = near-LFO, 1 = very irregular (never repeats)
  physics: { motion: PhysicsMotion; damping: number } // force-driven motion
  motion: { shape: MotionShape } // named motion archetype / force behaviour
  vision: { feature: VisionFeature; smooth: number } // follows the picture (return path)
  body: { feature: BodyFeature; smooth: number } // follows the body bus (embodied control)
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
  // Step sequencer : up to 16 drawn values played in turn on the clock, each
  // step on or a rest, each with a condition (chance, some passes, fill, first),
  // swing and glide. Its own probabilities are this type's SLIP, so it has none.
  steps: StepsConfig
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
  // Signal : the synth and the scan (the scan reads them on the main thread)
  | 'signalDecay' | 'signalTone' | 'signalFm' | 'signalRate' | 'signalSpread'
  | 'signalThresh' | 'signalDensity' | 'signalSnap'
  | 'rasterSmooth' | 'rasterTone'
  | 'sstvLine' | 'sstvDev'
  | 'filterQ' | 'filterSweep'
  | 'chordTone' | 'chordSpread' | 'chordAttack' | 'chordVoices'
  | 'collageReso' | 'collageRing' | 'collageWidth'
  | 'collageBank' | 'collageDecay' | 'collageCutoff' | 'collageWaves' | 'collageDetune' | 'chordWaves' | 'chordNoise' | 'chordAir'
  | 'asmReso' | 'asmRing' | 'asmWidth' | 'asmAccent' | 'asmBank'
  | 'fxSend' | 'fxReverb' | 'fxDelay'
  // The key sequencer's Every (free time), log-mapped 0..1 like its slider
  | 'keyEvery'
  // Space : where each voice sits in the room (shared/spatial.ts)
  | import('./spatial').SpaceModParam
export const SONIFY_MOD_PARAMS: SonifyModParam[] = [
  'spectraX', 'filterX', 'orbitX', 'orbitY', 'orbitR', 'orbitPitch',
  'rasterX', 'rasterY', 'rasterW', 'rasterH', 'rasterPitch',
  'spectraGain', 'spectraGamma', 'spectraSweep', 'spectraBreath',
  'orbitDrive', 'orbitSmooth', 'flowDur', 'flowColour',
  'eventsDecay', 'rasterSmooth', 'rasterTone',
  'sstvLine', 'sstvDev', 'filterQ', 'filterSweep',
  'chordTone', 'chordSpread', 'chordAttack', 'chordVoices', 'collageReso', 'collageRing', 'collageWidth',
  'collageBank', 'collageDecay', 'collageCutoff', 'collageWaves', 'collageDetune', 'chordWaves', 'chordNoise', 'chordAir',
  'asmReso', 'asmRing', 'asmWidth', 'asmAccent', 'asmBank',
  'fxSend', 'fxReverb', 'fxDelay', 'keyEvery'
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
  // `vary` is a TRIGGER, not a value : the modulation path edge-detects it and
  // fires one variation as the modulator crosses its middle going up.
  | { kind: 'layer'; layer: number; field: 'opacity' | 'mix' | 'blend' | 'vary' | 'harmony' }
  // The Background's own controls : opacity, its clock's speed (0..4×) and the
  // contact shadow the layers cast on it ('depth'). Same final override.
  | { kind: 'bg'; field: 'opacity' | 'speed' | 'depth' }
  // The fulldome mapping's own sliders (shared/dome.ts DOME_MOD_RANGE) : a final
  // override on the dome stage, like the Background's.
  | { kind: 'dome'; field: import('./dome').DomeModField }
  // The output transform's sliders (shared/outXform.ts OUTX_MOD_RANGE) : a final
  // override on the transform stage (flat output only).
  | { kind: 'outx'; field: import('./outXform').OutXformField }
  // The World amount : how much of the active World's mood is on (0 = the mood
  // it found, 1 = all of it). A final override like the Background's.
  | { kind: 'world'; field: 'amount' }
  // The Audio Layer (session state outside the composition) : its volume and
  // A/B mix; a slot's volume and pan, and a sound file's playhead, speed and
  // trim (shared/auMod.ts). A final override on the audio engine, each frame.
  | { kind: 'au'; slot?: undefined; field: import('./auMod').AuLayerModField }
  | { kind: 'au'; slot: 'A' | 'B'; field: import('./auMod').AuSlotModField }

// The Background's clock : grounds move slowly by default, up to 4× (every
// path : the slider, the store, OSC, modulation, the Meta knobs).
export const BG_DEFAULT_SPEED = 0.25
export const BG_SPEED_MAX = 4

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
  muted?: boolean // off for now : kept with its depth, the parameter sits at its own value
  // How the modulator's value is shaped on its way here (engine/modShape.ts),
  // before depth and mode : combined with other modulators, thresholded,
  // integrated. Absent : the modulator as it is (every older session).
  shape?: ModShape
}

// The shaping stage of one binding, in this order : COMBINE (this binding's
// modulator with one or two others), THRESHOLD (only what passes the line),
// INTEGRATE (the value pushes a running position that holds where it got to).
export type ModCombineOp = 'add' | 'sub' | 'mul' | 'min' | 'max'
export interface ModShape {
  // combine : the other modulators (slots, 1 or 2) and the operator
  with?: number[]
  op?: ModCombineOp
  // threshold : 0 = off. cut : the part above the line, opened back to 0..1;
  // gate : on (1) above the line, off (0) under it
  threshold?: number
  thresholdMode?: 'cut' | 'gate'
  // integrate : off, flow (the value drives the position : louder = faster,
  // nothing = it holds) or step (each hit pushes it one notch)
  integrate?: 'off' | 'flow' | 'step'
  rate?: number // flow : turns per second at full value (0.01..4)
  step?: number // step : one notch, a fraction of a turn (0.01..0.5)
  ends?: 'wrap' | 'bounce' // past the end : around again (an angle, a hue) or back (anything else)
}

// The cap is deliberate (simplexité): bounded modulation stays followable.
/** A layer's Vary, when it has not been set. The same 15% the global Vary
 *  starts at, so one layer on its own nudges as far as all of them would. */
export const DEFAULT_LAYER_VARY = 0.15

// How many modulator bindings a session holds in all (the Meta knobs are
// outside it). It was 12, which a hand-built patch filled quickly (Vincent,
// 2026-10-13 : raise it to 32).
export const MAX_MOD_ASSIGNMENTS = 32

/** The window.open names of the pages that can open in a window of their own
 *  (the Output, Body, Seq and Sonify buttons' right-click menus) : a blank page the
 *  control window draws the page into (renderer PageWindow.tsx), which main lets
 *  open (and only these). */
export const OUTPUT_PAGE_FRAME = 'opsia-output-page'
export const BODY_PAGE_FRAME = 'opsia-body-page'
export const SONIFY_PAGE_FRAME = 'opsia-sonify-page'
export const SEQUENCE_PAGE_FRAME = 'opsia-sequence-page'
/** Each page window's title, by its window.open name. */
export const PAGE_WINDOW_TITLES: Record<string, string> = {
  [OUTPUT_PAGE_FRAME]: 'Palinopsia · Output',
  [BODY_PAGE_FRAME]: 'Palinopsia · Body',
  [SONIFY_PAGE_FRAME]: 'Palinopsia · Sonify',
  [SEQUENCE_PAGE_FRAME]: 'Palinopsia · Sequencer'
}
// What the AUTOMATIC binders may use (Randomize, Generate, a World's audio
// route) : the old 12, so a randomized session keeps the amount of motion it
// always had and the rest of the room stays for the hand.
export const AUTO_MOD_BUDGET = 12

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
  //              (additive / screen layers glow it through); as the background
  //              fades, layer 1 eases toward landing as if nothing were under it.
  //  'isolate' : GROUP (the UI's word) : the four layers composite among
  //              themselves as if alone, then the group sits over the
  //              background, which shows through where they are transparent or
  //              dark (Compositor GROUP_FS). The background never alters the
  //              inter-layer blends.
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
  // The mood a World found when it was applied (its Context / film keys, as they
  // were) : the World amount blends from these to the World's own.
  worldBase?: Record<string, number>
  // What the World changed each of those keys by (its value minus worldBase,
  // the non-zero ones) : the change the World amount fades. A morph eases it
  // with the rest, so a fade never jumps when the World or the scene changes.
  worldShift?: Record<string, number>
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

// The same draw sequencer over Context's light : a drawn path the light traces
// while `play` is on. Travels on the Context unit (sessions, scenes, undo).
export interface LightPath extends SurfaceSequencer {
  play: boolean
}

// ── Sonify sequencer ─────────────────────────────────────────────────
// A step timeline that evolves the Sonify engine over time (Mixer page). Each
// step either loads a whole saved preset (structural change) or, with no preset,
// just sets which of the voices are on (a rhythmic on/off pattern over the
// current sound). One shared transport advances the steps.
export interface SoniSeqStep {
  voices: boolean[] // length 10 (8 before the Collage voice, 9 before Signal) : per-voice on/off, applied when `preset` is empty
  preset: string // '' = apply the voices mask; else the name of a saved Sonify preset to load
}
// A sequencer's clock : `free` = its own milliseconds, or beats / bars of the
// composition's tempo on the Sonify beat clock both sequencers share.
export type SoniSeqRate = 'free' | 'b1' | 'b2' | 'bar1' | 'bar2' | 'bar4' | 'bar8' | 'bar16'

export interface SoniSeq {
  on: boolean // transport running
  rate?: SoniSeqRate // absent = 'free' (stepMs)
  stepMs: number // dwell per step (free rate)
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

// ── Sonify key sequencer ─────────────────────────────────────────────
// Composes the ROOT, SCALE and octave of the whole Sonify instrument over time
// (the Seq view). List plays written keys; the other modes choose the next key
// themselves : a walk on the circle of fifths, a pick by shared notes, a pivot
// to another mode, or a key read off the picture.
export type SoniKeyMode = 'list' | 'circle' | 'affinity' | 'pivot' | 'picture'
export interface SoniKeyStep {
  root: number // 0..11 (C..B)
  scale: string // a Sonify scale name
  oct: number // 1..6 : the root octave (3 = no shift)
}
export interface SoniKeySeq {
  on: boolean // running (runtime; sessions carry soniKeySeqOn)
  mode: SoniKeyMode
  rate: SoniSeqRate // how often a change may fall
  freeMs: number // the period when rate is 'free'
  freeVary: number // 0..1 : each free-time wait drawn between Every / 4^vary and Every x 4^vary (0 = always Every)
  chance: number // 0..1 : the odds a change falls when it may
  glide: number // seconds : the pitches slide to the new key (0 = they jump)
  returnHome: boolean // on stop : back to the key it started from
  poolRoots: boolean[] // 12 : the roots the generative modes may choose
  poolScales: string[] // the scales they may choose
  euclid: boolean // changes fall on a Euclidean rhythm of the clock's ticks
  ePulses: number
  eSteps: number
  eRot: number
  // List
  steps: SoniKeyStep[] // 8 (the first `len` play)
  len: number
  order: 'forward' | 'bounce' | 'drift'
  bias: number // -100..100 (drift)
  // Circle
  circBias: number // -1 toward the flats … +1 toward the sharps
  circLeap: number // 1..3 : the most fifths one change may move
  circRel: number // 0..1 : the odds of a hop to the relative major / minor
  // Affinity
  affSmooth: number // -100 jarring (few shared notes) … +100 smooth (many)
  affNoRepeat: boolean // never one of the last few keys
  affTour: boolean // visit every key of the pool before any comes back
  // Pivot
  pivKind: 'modes' | 'tonic' // same notes, new tonic · same tonic, new mode
  pivDir: 'up' | 'down' | 'random'
  // Picture
  picSource: 'color' | 'cuts' // the picture's color on the clock · a scene cut
  picHold: number // seconds : the shortest a key stays
  picRange: number // 0..1 : 0 = the color wheel and the light as they are · 1 = the piece's own range of them spread over every key and mood
  picKeys: 'pool' | 'list' // what the picture chooses from : the pool's roots x scales, or the keys written for it
  picSteps: SoniKeyStep[] // 8 (the first picLen are Picture's keys)
  picLen: number
}

export interface Session {
  version: 1
  name: string
  // Autosave snapshots only : the file the session on screen came from, so a
  // crash restore re-links it (never written into a session file).
  opsiaPath?: string | null
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
  // Whether the sound was playing when the session was saved (Sonify, and its
  // step sequence) : an installation boots with it playing again. Opening a
  // session by hand leaves the sound as it is on the machine.
  sonifyOn?: boolean
  soniSeqOn?: boolean
  // The key sequencer (root / scale over time) : travels like the step sequence.
  soniKeySeq?: SoniKeySeq
  soniKeySeqOn?: boolean
  // Performance dials : the global clock multiplier + the scene-morph duration.
  // Optional for back-compat with sessions saved before they were persisted.
  globalSpeed?: number
  morphMs?: number
  // Metasurface draw sequencer : the recorded path + its playback timing.
  // The live cursor / active toggle stay runtime; only the gesture persists.
  surface?: SurfaceSequencer
  // Resolume OSC mapper : the matrix (rows, columns, connections, snapshots,
  // lock) travels with the session so each piece keeps its own mapping.
  resolume?: import('./resolume').ResolumeMap
  // Fulldome mapping (the dome view of the Output page).
  dome?: import('./dome').DomeConfig
  // The output transform (the whole frame moved as one picture). Absent in older
  // files : they load at identity.
  outXform?: import('./outXform').OutXform
  // Space : where each Sonify voice sits in the room (the venue setup itself,
  // speakers / objects / OSC, belongs to the computer, not the piece).
  spaceVoices?: Record<string, import('./spatial').VoicePlace>
  // The Audio Layer's slots, mix and volume (absent in older files : none)
  audioLayer?: AudioLayerState
  // Your own shaders the session plays (Source Editor), by id : their source
  // travels with the session, so it opens where the files are not.
  userShaders?: Record<string, { name: string; source: string; category: 'Generator' | 'FX' }>
  // The projector warp (Output → Mapping), written only when "save with the
  // session" is on, and applied on load only where that option is on : the
  // warp is otherwise the computer's (its projector), not the piece's.
  warp?: { enabled: boolean; corners: number[]; feather?: number }
  // Persistence : the pinned controls and layers (renderer persist.ts keys),
  // which scenes, Randomize, Generate and the World leave alone. Absent : none.
  pins?: string[]
  // The Feel macros (field macros + temperament) : the session's own, so a
  // Generate's Density no longer follows you into every session after. Absent
  // (an older file) : neutral. Shutter and Superimposition stay out (strobes).
  feel?: { density: number; gestureTexture: number; coalesce: number; tonicity: number; drift: number; flow: number }
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

/** What the operating system says about reading the screen. macOS is the only
 *  platform that gates it, and for screen capture it answers only the first two :
 *  there is no "not yet asked" state to tell apart, because no app can ask. */
export type ScreenAccess = 'granted' | 'denied' | 'restricted' | 'unknown'

// Per-frame render state pushed to the native output window (it drives its own
// Compositor from this : no WebRTC transcode).
/** The recording folder, as main reports it (see main/recording.ts). */
export interface RecordingFolderInfo {
  path: string
  chosen: string | null
  defaultPath: string
  available: boolean
  error?: string
}

/** What the output window reads per frame now : the keystone it applies to the
 *  streamed picture (it no longer renders the composition itself). */
export type OutputWarp = Pick<OutputFrame, 'warpEnabled' | 'warpCorners' | 'warpGrid' | 'warpFeather' | 'outSharp'>

export interface OutputFrame {
  c: CompositionState
  modValues: number[]
  modBypass?: boolean
  globalSpeed: number
  warpEnabled: boolean
  warpCorners: number[]
  warpGrid: boolean
  /** Output pixels the warped frame's edge fades over (0 : crisp, anti-aliased). */
  warpFeather?: number
  /** The projector window enlarges the frame through a cubic instead of bilinear. */
  outSharp?: boolean
  time: number
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

/** Light output (ArtNet/DMX · WLED). Machine-local (venue-specific), persisted
 *  to localStorage, pushed to main which owns the UDP senders (see main/light.ts). */
export interface LightConfig {
  enabled: boolean
  protocol: 'artnet' | 'wled'
  host: string
  cols: number
  rows: number
  order: 'rgb' | 'grb' | 'brg' | 'bgr'
  brightness: number
  gamma: number
  universe: number
  startChannel: number
  serpentine: boolean
  fps: number
}

/** "Start with the computer" for an installation (main/autostart.ts). */
export interface AutostartStatus {
  on: boolean
  supported: boolean
  why?: string // why it can't be turned on here
}

/** The persisted "Installation mode" launch file (kiosk.json). */
export interface KioskLaunchConfig {
  enabled?: boolean
  sessionPath?: string
  display?: number
  // The display's name and whether it was the main one, to find it again when
  // its id changes (Windows renumbers displays across reboots and ports).
  displayLabel?: string
  displayWasPrimary?: boolean
}

export interface ExposedApi {
  // Session I/O
  /** Save As : `currentPath` seeds the dialog; the name inside follows the file. */
  sessionSaveAs: (s: Session, currentPath?: string | null) => Promise<string | null>
  sessionSave: (s: Session, path: string) => Promise<boolean>
  sessionOpen: () => Promise<{ session: Session; path: string } | null>
  sessionList: () => Promise<Array<{ name: string; path: string; mtime: number; group?: string }>>
  // Linked session folders (right-click the Session Load button).
  sessionFolders: () => Promise<string[]>
  sessionFolderAdd: () => Promise<{ folder: string; count: number } | null>
  sessionFolderRemove: (folder: string) => Promise<boolean>
  /** A copy of an unsaved / not-saved session in Sessions/.history/_unsaved. */
  sessionKeepRecovery: (s: Session) => Promise<string>
  /** Pick one of a session file's earlier versions (its .history folder). */
  sessionOpenVersion: (path: string) => Promise<{ session: Session; path: string } | null>
  sessionVersionCount: (path: string) => Promise<number>
  sessionLoad: (path: string) => Promise<Session>
  /** A session's load went through : the films beside its file are readied in
   *  the background (an exotic codec converted once). */
  sessionWarm: (path: string) => Promise<void>

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
  // Many messages to one destination in a single fire-and-forget IPC hop.
  oscSendBatch: (
    ip: string,
    port: number,
    msgs: Array<{ address: string; args: Array<{ type: string; value: number | string | boolean }> }>
  ) => void
  // Resolume mapper : pick an .avc, then read its layout (layers, groups,
  // columns, clips, effects, dashboard links).
  resolumePick: () => Promise<string | null>
  resolumeParse: (path: string) => Promise<import('./resolume').ResoParseResult>

  // OSC input : start/stop the listener + OSCQuery, and subscribe to messages
  oscListen: (port: number, enabled: boolean) => Promise<OscListenResult>
  onOscReceived: (cb: (batch: OscInEvent[]) => void) => () => void
  oscQueryPublish: (nodes: OscQueryLeaf[]) => Promise<void>
  // OSCQuery WebSocket value-stream: push live value diffs; be told when a
  // client is (dis)connected so the renderer only computes diffs when needed.
  oscQueryValues: (updates: Array<{ path: string; value: number | number[] }>) => void
  onOscQueryWsActive: (cb: (active: boolean) => void) => () => void

  // ── dataflou mesh (the dataflou section) ─────────────────────────
  dataflouConfigure: (cfg: import('./dataflou').DfConfig) => Promise<import('./dataflou').DfStatus>
  dataflouStatus: () => Promise<import('./dataflou').DfStatus>
  dataflouValues: (values: Record<string, import('./dataflou').DfValue>) => void
  dataflouBind: (b: { destSku: string; destPath: string; srcSku: string; srcPath: string; on: boolean }) => Promise<boolean>
  dataflouForget: (sku: string) => Promise<boolean>
  onDataflouStatus: (cb: (s: import('./dataflou').DfStatus) => void) => () => void
  onDataflouIn: (cb: (batch: Array<{ path: string; value: import('./dataflou').DfValue }>) => void) => () => void
  // Ableton Link (src/main/link.ts)
  linkConfigure: (cfg: Partial<LinkConfig>) => Promise<LinkState>
  /** The state without configuring anything : at startup, is Link in this build? */
  linkState: () => Promise<LinkState>
  linkSetTempo: (bpm: number) => void
  /** Start / stop sync : propose play or stop to every linked app. */
  linkSetPlaying: (on: boolean) => void
  onLinkState: (cb: (s: LinkState) => void) => () => void

  // App lifecycle : save-before-quit handshake
  appCloseProceed: () => Promise<void>
  /** The renderer is asking the user (Save changes?) : hold the forced close. */
  appCloseHold: () => Promise<void>
  /** The user cancelled the quit. */
  appCloseCancel: () => Promise<void>
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
  /** The videos in a folder (natural order), for switching a video slot to its neighbours. */
  videoListFolder: (dir: string, kind?: 'audio') => Promise<{ ok: boolean; files: Array<{ name: string; path: string }>; error?: string }>
  /** A clip's keyframe times (s, sorted), or null : lets the player seek keyframe to keyframe. */
  videoKeyframes: (path: string) => Promise<number[] | null>
  // Collage : pick a folder, then reduce it to a pool of playable clips (one
  // entry per file, non-Chromium codecs converted through the same cache the
  // single-clip import uses).
  collagePickFolder: () => Promise<string | null>
  /** A path on disk : a folder, a file, or nothing there. */
  pathKind: (path: string) => Promise<'dir' | 'file' | 'none'>
  shadersList: () => Promise<Array<{ name: string; file: string; source: string; mtime: number }>>
  shadersSave: (name: string, source: string) => Promise<{ ok: boolean; name: string; file: string; error?: string }>
  shadersDelete: (name: string) => Promise<boolean>
  shadersOpenFile: () => Promise<{ name: string; source: string } | null>
  shadersReveal: () => Promise<string>
  onAppShortcut: (cb: (name: string) => void) => () => void
  // the agent connection (MCP, src/main/mcp.ts)
  mcpConfigure: (enabled: boolean, port: number) => Promise<import('./mcpTools').McpStatus>
  mcpResult: (id: number, result: import('./mcpTools').McpResult) => void
  onMcpCall: (cb: (call: import('./mcpTools').McpCall) => void) => () => void
  onMcpClient: (cb: (name: string) => void) => () => void
  /** The session's media : what each path is now, where missing ones went
   *  (found by name under a folder, keyed by the missing path), a folder picker,
   *  and copies made into the session's "<name> media" folder. */
  mediaCheck: (paths: string[]) => Promise<Record<string, 'dir' | 'file' | 'none'>>
  mediaFind: (root: string, wants: string[]) => Promise<Record<string, { path: string; dir: boolean; score: number }>>
  mediaPickFolder: (title: string) => Promise<string | null>
  mediaCollect: (
    sessionPath: string,
    items: Array<{ src: string; dest: string }>
  ) => Promise<{ ok: boolean; map: Record<string, string>; bytes: number; refused?: number; error?: string }>
  onMediaCollectProgress: (fn: (p: { done: number; total: number; bytes: number }) => void) => () => void
  collageScan: (folder: string) => Promise<import('./collage').CollageScanResult>
  // The same scan, except EVERY clip is force-transcoded to 720p all-intra : the
  // wall seeks on every loop and every cut, and long-GOP files stutter it. One-
  // time cost per file, then cached; same result shape, so the pool is swapped
  // with it directly.
  collageOptimise: (folder: string) => Promise<import('./collage').CollageScanResult>
  // Sonify's Collage voice : a film's audio-only copy (made once, cached), or
  // `silent` when the film has no sound.
  collageAudio: (path: string) => Promise<{ ok: boolean; path?: string; silent?: boolean; error?: string }>
  // The Import Audio source : the file to play (the original, or for a format the
  // player can't decode, AIFF / WMA / CAF, its audio-only copy, made once).
  audioPlayable: (path: string, force?: boolean) => Promise<{ ok: boolean; path?: string; error?: string }>
  // A sound's analysis (a film's soundtrack or an audio file) : 60 feature frames
  // a second (level, flux, centroid, six bands, pitch, noisiness; bytes) then the
  // waveform's min / max (int8) at 400 a second. Made once, cached.
  audioAnalysis: (path: string) => Promise<{
    ok: boolean; silent?: boolean; error?: string; duration?: number; frames?: number
    rate?: number; peakRate?: number; data?: Uint8Array; peaks?: number
  }>
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
  // Whether this machine lets the app read the screen at all. Always "granted"
  // off macOS, which is the only one that gates it. Ask before trusting a
  // thumbnail : denied, the enumeration still answers, with black pictures.
  captureScreenAccess: () => Promise<ScreenAccess>
  // Open the settings pane that grants it (macOS). The app has to be started
  // again afterwards.
  captureOpenScreenSettings: () => Promise<boolean>
  // Output window (2nd display / projector) : mirror via WebRTC loopback.
  outputDisplays: () => Promise<DisplayInfo[]>
  // A string : refused, and why (-1 never takes a fullscreen or span output off
  // its projector).
  outputOpen: (displayId: number, windowed?: boolean) => Promise<boolean | string>
  // Multi-projector span : one borderless output window across several displays'
  // union bounds (each projector a separate, adjacent monitor).
  outputOpenSpan: (displayIds: number[]) => Promise<boolean>
  outputClose: () => Promise<boolean>
  /** Bring a page's own window (Output, Body, Sonify, Sequencer : its window.open name) to the front. */
  pageWindowFocus: (frame: string) => Promise<boolean>
  // What Esc does in the output window : 'hold' (an installation : held 1.5 s),
  // 'close' (a fullscreen output covering the control window : a tap closes it)
  // or 'return' (the control window is reachable : focus goes back to it).
  outputEscMode: () => Promise<'hold' | 'close' | 'return'>
  /** Esc in the output window : closes it or returns focus, per outputEscMode. */
  outputEscape: () => Promise<'hold' | 'close' | 'return'>
  onOutputClosed: (cb: () => void) => () => void
  outputFrame: (frame: OutputWarp) => void
  onOutputFrame: (cb: (frame: OutputWarp) => void) => () => void
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
  // NDI : one call carries on/off + name/groups/network; status streams back.
  // (Frames reach the preload over a private MessageChannel, not this API.)
  ndiConfigure: (cfg: import('./ndi').NdiConfig) => Promise<import('./ndi').NdiStatus>
  onNdiStatus: (cb: (s: import('./ndi').NdiStatus) => void) => () => void
  /** NDI sources on the network, by name (ok false : no runtime, with why). */
  ndiInFind: (waitMs?: number) => Promise<{ ok: boolean; sources: string[]; message: string }>
  /** Start (or share) receiving one NDI source; frames flow to the page. */
  ndiInOpen: (name: string) => Promise<boolean>
  ndiInClose: (name: string) => void
  /** NDI audio in : start (or take back) slot `id`'s receiver for one source's
   *  sound at `rate`; its port arrives as the window message
   *  { t: 'opsia:ndiaudioport', token }. False : no runtime, or refused. */
  ndiAudioOpen: (id: string, name: string, rate: number, token: string) => Promise<boolean>
  ndiAudioClose: (id: string, token: string) => void
  /** USB input (macOS) : the cameras AVFoundation sees, an iPhone by USB included
   *  (ok false off a Mac or without the module, with why). */
  avfList: () => Promise<{ ok: boolean; devices: import('./avf').AvfDevice[]; message: string }>
  /** Start (or share) capturing one; frames flow to the page. False : not possible here. */
  avfOpen: (id: string) => boolean
  avfClose: (id: string) => void
  avfStatus: (id: string) => import('./avf').AvfStatus | null
  // No NDI on this computer : download + verify + open NDI's official installer.
  ndiInstallRuntime: () => Promise<{ ok: boolean; message: string }>
  onNdiInstallProgress: (cb: (p: import('./ndi').NdiInstallProgress) => void) => () => void
  platform: string
  shareSet: (on: boolean) => Promise<{ ok: boolean; local: boolean; topDown: boolean; error?: string }>
  shareFrame: (w: number, h: number, pixels: Uint8Array) => void
  // Light output (ArtNet/DMX · WLED) : push config, then zone frames.
  lightConfig: (cfg: LightConfig) => void
  lightFrame: (cols: number, rows: number, pixels: Uint8Array) => void
  // Kiosk / installation mode : read the effective launch config; get/set the
  // persisted "enable on next restart" launch file; get the operator UI out.
  kioskConfig: () => Promise<{ kiosk: boolean; sessionPath?: string; display?: number; windowed?: boolean }>
  // Whether THIS session is actually running as an installation, which is not
  // what kioskConfig reports : that is the stored setting, still on after an
  // exit-kiosk. The output window's escape keys branch on this.
  kioskActive: () => Promise<boolean>
  kioskGetLaunch: () => Promise<KioskLaunchConfig>
  kioskSetLaunch: (cfg: KioskLaunchConfig) => Promise<boolean>
  // The installation's display (its id, else found again by name), from main.
  kioskTargetDisplay: () => Promise<number>
  // Start with the computer (and again after a crash) : status and switch.
  kioskAutostart: () => Promise<AutostartStatus>
  kioskSetAutostart: (on: boolean) => Promise<AutostartStatus>
  // No WebGL at all in this window : an installation relaunches.
  kioskGlFailed: (where: string) => void
  // The control window's frame count, every few seconds (the installation
  // watchdog reloads a picture that stopped advancing).
  appAlive: (frames: number) => void
  // An installation's output closed without the exit hatch : open it again.
  // Is an output window open (a reloaded control window resumes streaming to it).
  outputIsOpen: () => Promise<boolean>
  /** The output window's drawing size (the projector's proportions), null when closed. */
  outputSize: () => Promise<{ w: number; h: number } | null>
  onKioskReopenOutput: (cb: () => void) => () => void
  minimizeMain: () => void
  // Live exit from a running installation : close the fullscreen output and
  // bring the operator window back (bound to Esc / O in the output window, plus
  // a Ctrl+Shift+O global backstop). Does NOT disarm the next-restart launch.
  kioskExit: () => Promise<boolean>
  // Operator-side notice that an installation exit just happened, so the UI can
  // tell the user how to stop it launching again.
  onKioskExited: (cb: () => void) => () => void
  // Host resource monitor (Output HUD).
  perfStats: () => Promise<PerfStats>
  // Just the refresh rate of the display the window is on, for readouts that
  // want the frame-rate ceiling without paying for a whole resource sample.
  displayHz: () => Promise<number | null>
  // Recording: intermediate MediaRecorder chunks streamed to main → ffmpeg
  // delivery-format transcode/remux on stop → Recorded/. Plus screenshot.
  recordingFormats: () => Promise<Array<{ id: string; label: string; kind: 'realtime' | 'encoder' }>>
  // Where takes, screenshots and Assemble exports go : Recorded/ next to the app,
  // or a folder the player chose (remembered per machine).
  recordingFolder: () => Promise<RecordingFolderInfo>
  recordingChooseFolder: () => Promise<RecordingFolderInfo>
  recordingResetFolder: () => Promise<RecordingFolderInfo>
  recordingOpenFolder: () => Promise<string>
  recordingStart: (intermediateExt: string, codec: string) => Promise<boolean>
  recordingChunk: (data: Uint8Array) => void
  recordingStop: (formatId: string, withSound?: boolean) => Promise<string | null>
  saveScreenshot: (data: Uint8Array) => Promise<string | null>
}

// A snapshot of the host resources Palinopsia is using, for the Output HUD.
// `cpu`/`ram` are Palinopsia's own share; `vram`/`gpu` are GPU-wide (per-process
// VRAM isn't reliably attributable). Any field is null when the host has no way
// to report it.
export interface PerfStats {
  cpu: number | null // % CPU (summed across Palinopsia's processes)
  ram: number | null // % of host RAM used by Palinopsia
  // % of GPU memory in use (whole GPU). On a unified-memory machine there is no
  // separate pool, so this is the share of system memory the GPU driver holds.
  vram: number | null
  gpu: number | null // % GPU utilisation (whole GPU)
  // Refresh rate of the display the main window is on. The render loop is
  // vsync-locked to it, so it is the ceiling the FPS readout should be read
  // against : 24 fps on a 24 Hz display is every frame, not a dropped one.
  hz: number | null
}
/** Ableton Link, per machine (like OSC) : on or off, and the quantum (beats
 *  per bar the phase is aligned to). */
export interface LinkConfig {
  enabled: boolean
  quantum: number
  /** start / stop sync : play and stop shared with the apps that share theirs */
  startStop: boolean
}

/** The Link session as read in the main process, stamped with when (`at`, ms
 *  on the system's wall clock, see src/main/link.ts). */
export interface LinkState {
  available: boolean
  error?: string
  enabled: boolean
  peers: number
  tempo: number
  beat: number
  phase: number
  /** the quantum `beat` was read for (a bar change re-maps the beat count) */
  quantum?: number
  /** start / stop sync is on in the session's module */
  startStop?: boolean
  /** the session's transport (start / stop sync only) */
  playing?: boolean
  /** the beat the play or stop was set at, on `beat`'s count : a play starts
   *  on the first bar from there */
  playBeat?: number
  at: number
}
