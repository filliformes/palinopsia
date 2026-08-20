// ISF shader registry. Sources are imported as raw strings (Vite `?raw`) so
// the ISF runtime can parse each one's JSON header + GLSL at load time. This
// curated seed set IS the instrument's voice (brief §1, §5): glitch /
// generative / digital-arts : never kaleidoscope, plasma, or audio-bloom.
//
// `curated` is each shader's AESTHETIC sub-range per input : what Randomize
// draws from (brief §7). Declared MIN/MAX is the legal range; curated is the
// tasteful one. This table is where the instrument's taste lives: it keeps
// randomization in the glitch register and out of kaleidoscope soup.

import driftField from './DriftField.fs?raw'
import organic from './Organic.fs?raw'
import { TEXT_FONTS } from '../../textFonts'
import slabs from './Slabs.fs?raw'
import contour from './Contour.fs?raw'
import gridDrift from './GridDrift.fs?raw'
import tenPrint from './TenPrint.fs?raw'
import particleDrift from './ParticleDrift.fs?raw'
import interference from './Interference.fs?raw'
import columnScan from './ColumnScan.fs?raw'
import ash from './Ash.fs?raw'
import murmuration from './Murmuration.fs?raw'
import filaments from './Filaments.fs?raw'
import erosion from './Erosion.fs?raw'
import membrane from './Membrane.fs?raw'
import mycelium from './Mycelium.fs?raw'
import swell from './Swell.fs?raw'
import congeal from './Congeal.fs?raw'
import slitScan from './SlitScan.fs?raw'
import ramps from './Ramps.fs?raw'
import rgbOsc from './RgbOsc.fs?raw'
import recurse from './Recurse.fs?raw'
import shapes from './Shapes.fs?raw'
import opArt from './OpArt.fs?raw'
import directMarks from './DirectMarks.fs?raw'
import dyeField from './DyeField.fs?raw'
import reaction from './Reaction.fs?raw'
import metamorph from './Metamorph.fs?raw'
import syncOsc from './SyncOsc.fs?raw'
import differential from './Differential.fs?raw'
import solidColor from './SolidColor.fs?raw'
import posterize from './fx/Posterize.fs?raw'
import dither from './fx/Dither.fs?raw'
import chromaShift from './fx/ChromaShift.fs?raw'
import pixelate from './fx/Pixelate.fs?raw'
import displace from './fx/Displace.fs?raw'
import scanlines from './fx/Scanlines.fs?raw'
import edge from './fx/Edge.fs?raw'
import grade from './fx/Grade.fs?raw'
import sliceShuffle from './fx/SliceShuffle.fs?raw'
import smear from './fx/Smear.fs?raw'
import palette from './fx/Palette.fs?raw'
import threshold from './fx/Threshold.fs?raw'
import solarize from './fx/Solarize.fs?raw'
import moshBlocks from './fx/MoshBlocks.fs?raw'
import grain from './fx/Grain.fs?raw'
import streak from './fx/Streak.fs?raw'
import sharpen from './fx/Sharpen.fs?raw'
import fold from './fx/Fold.fs?raw'
import transform from './fx/Transform.fs?raw'
import ntsc from './fx/NTSC.fs?raw'
import stutter from './fx/Stutter.fs?raw'
import slitBuffer from './fx/SlitBuffer.fs?raw'
import differenceBloom from './fx/DifferenceBloom.fs?raw'
import triangleFlicker from './fx/TriangleFlicker.fs?raw'
import colorizer from './fx/Colorizer.fs?raw'
import wavefold from './fx/Wavefold.fs?raw'
import rutt from './fx/Rutt.fs?raw'
import crtScreen from './fx/CrtScreen.fs?raw'
import pixelmask from './fx/Pixelmask.fs?raw'
import lightTrails from './fx/LightTrails.fs?raw'
import wideTime from './fx/WideTime.fs?raw'
import hueRotate from './fx/HueRotate.fs?raw'
import rgbShift from './fx/RgbShift.fs?raw'
import granular from './fx/Granular.fs?raw'
import mosaic from './fx/Mosaic.fs?raw'
import syncLoss from './fx/SyncLoss.fs?raw'
import rowEcho from './fx/RowEcho.fs?raw'
import byteCorrupt from './fx/ByteCorrupt.fs?raw'
import ringing from './fx/Ringing.fs?raw'
import tracking from './fx/Tracking.fs?raw'
import motif from './fx/Motif.fs?raw'
import decay from './fx/Decay.fs?raw'
import opticalRain from './fx/OpticalRain.fs?raw'
import phosphene from './fx/Phosphene.fs?raw'
import abstraction from './fx/Abstraction.fs?raw'
import compress from './fx/Compress.fs?raw'
import databend from './fx/Databend.fs?raw'
import pixelSort from './fx/PixelSort.fs?raw'
import feedbackZoom from './fx/FeedbackZoom.fs?raw'
import forceLines from './fx/ForceLines.fs?raw'
import aperture from './fx/Aperture.fs?raw'
import distort from './fx/Distort.fs?raw'
import vibe from './fx/Vibe.fs?raw'
import context from './fx/Context.fs?raw'
import finalizer from './fx/Finalizer.fs?raw'

export interface IsfShader {
  id: string
  name: string
  category: 'Generator' | 'FX'
  source: string
  /** Randomize's aesthetic sub-range per float input (tighter than MIN/MAX). */
  curated?: Record<string, [number, number]>
  /** Native convolution node (`node-*`): run by a TS class, not the ISF runtime.
   *  `source` is a header-only stub so the auto-UI/presets/randomize still parse
   *  its INPUTS. Excluded from the Randomize FX pool (needs a sidechain). */
  native?: boolean
}

// ── Native convolution nodes (visual-convolution spec) ──────────────────
// Registered like shaders (header-only source ⇒ auto-UI + modulation + presets +
// randomize) but the engine runs a TS class and hands it a sidechain texture.
// Kept OUT of FX_SHADERS (the Randomize pool) : added to the picker + lookups.
export const NATIVE_NODES: IsfShader[] = [
  {
    id: 'node-transfert',
    name: 'Transfert',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Transfert : imprint another layer's MOVEMENT onto this one (optical-flow transfer). Déplacement warps by the sidechain's flow; Traînée is a flow-steered line blur (motion blur painted by another layer's gesture). Pick the sidechain in the Inspector.",
      "CATEGORIES": ["FX", "Convolution"],
      "INPUTS": [
        { "NAME": "mode", "TYPE": "long", "VALUES": [0,1], "LABELS": ["deplacement","trainee"], "DEFAULT": 0, "LABEL": "mode" },
        { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.35, "LABEL": "amount" },
        { "NAME": "inertie", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "inertie" },
        { "NAME": "flowScale", "TYPE": "float", "MIN": 0.25, "MAX": 4.0, "DEFAULT": 1.0, "LABEL": "flow scale" },
        { "NAME": "flowBlur", "TYPE": "float", "MIN": 0.0, "MAX": 24.0, "DEFAULT": 8.0, "LABEL": "flow blur" },
        { "NAME": "magnitudeGamma", "TYPE": "float", "MIN": 0.25, "MAX": 4.0, "DEFAULT": 1.0, "LABEL": "mag gamma" },
        { "NAME": "channelSpread", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "chroma pull" },
        { "NAME": "taps", "TYPE": "float", "MIN": 2.0, "MAX": 24.0, "DEFAULT": 12.0, "LABEL": "taps" },
        { "NAME": "falloff", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "falloff" },
        { "NAME": "invert", "TYPE": "bool", "DEFAULT": false, "LABEL": "invert", "COMPACT": true },
        { "NAME": "bidirectional", "TYPE": "bool", "DEFAULT": true, "LABEL": "bidir", "COMPACT": true },
        { "NAME": "flowRes", "TYPE": "long", "VALUES": [0,1,2], "LABELS": ["128","256","512"], "DEFAULT": 1, "LABEL": "flow res", "COMPACT": true }
      ]
    }*/`,
    curated: {
      amount: [0.15, 0.6],
      inertie: [0.3, 0.85],
      flowScale: [0.6, 2.0],
      flowBlur: [4, 14],
      magnitudeGamma: [0.6, 1.6],
      channelSpread: [0, 0.4],
      taps: [8, 18],
      falloff: [0.2, 0.8]
    }
  },
  {
    // Module 1 : Convolution (ConvolveSpatial). The sidechain frame is the
    // KERNEL (point-spread function): every host pixel stamps a scaled copy of
    // it : transfers glare shape / texture / energy. Native (engine/convNodes).
    id: 'node-convolve',
    name: 'Convolution',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Convolution : treat another layer as a convolution kernel (impulse response). Every bright pixel of this layer stamps a scaled copy of the sidechain's shape, transferring its glare / texture / energy signature (UE convolution-bloom, run forward). Pick the kernel layer in the Inspector. Direct kernel path; a live sidechain = an animated impulse response.",
      "CATEGORIES": ["FX", "Convolution"],
      "INPUTS": [
        { "NAME": "scale", "TYPE": "float", "MIN": 0.05, "MAX": 2.0, "DEFAULT": 0.8, "LABEL": "spread" },
        { "NAME": "taps", "TYPE": "float", "MIN": 3.0, "MAX": 12.0, "DEFAULT": 7.0, "LABEL": "kernel res" },
        { "NAME": "threshold", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.1, "LABEL": "kernel thresh" },
        { "NAME": "kernelGamma", "TYPE": "float", "MIN": 0.25, "MAX": 4.0, "DEFAULT": 1.0, "LABEL": "kernel gamma" },
        { "NAME": "boost", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "highlight gate" },
        { "NAME": "gain", "TYPE": "float", "MIN": 0.0, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "wet gain" },
        { "NAME": "mix", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "mix" },
        { "NAME": "additive", "TYPE": "bool", "DEFAULT": false, "LABEL": "additive", "COMPACT": true }
      ]
    }*/`,
    curated: {
      scale: [0.3, 1.2], taps: [5, 10], threshold: [0.05, 0.4], kernelGamma: [0.6, 2.0],
      boost: [0, 0.6], gain: [0.6, 1.8], mix: [0.4, 0.9]
    }
  },
  {
    // Module 3 : Réponse (temporal frame-echo convolution). Convolves the host
    // layer's OWN recent time-history against a shaped envelope : rhythmic
    // pulsing trails / temporal smear. Native (engine/convNodes). No sidechain.
    id: 'node-reponse',
    name: 'Réponse',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Réponse : temporal convolution: this layer's last 16 frames summed through a shaped envelope (attack onset × decay tail, reversible). Trails that pulse with a captured rhythm : a convolution-reverb for image. Uses the layer's own history (no sidechain).",
      "CATEGORIES": ["FX", "Feedback", "Convolution"],
      "INPUTS": [
        { "NAME": "length", "TYPE": "float", "MIN": 2.0, "MAX": 16.0, "DEFAULT": 10.0, "LABEL": "length" },
        { "NAME": "decay", "TYPE": "float", "MIN": 0.05, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "decay" },
        { "NAME": "attack", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.1, "LABEL": "attack" },
        { "NAME": "gain", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.0, "LABEL": "gain" },
        { "NAME": "reverse", "TYPE": "bool", "DEFAULT": false, "LABEL": "reverse", "COMPACT": true },
        { "NAME": "mix", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "mix" }
      ]
    }*/`,
    curated: {
      length: [6, 16], decay: [0.2, 0.9], attack: [0, 0.4], gain: [0.6, 1.4], mix: [0.4, 0.9]
    }
  },
  {
    // Feedback engine : a video-feedback loop (edge-of-chaos). Samples its own
    // last output through a drifting-pivot transform + self-displacement, mixes
    // the layer signal, held bounded by a built-in AGC + noise floor. Native
    // (engine/convNodes FeedbackNode). No sidechain : feeds on the layer.
    id: 'node-feedback',
    name: 'Feedback',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Feedback : a video-feedback engine. The layer's own last frame is re-sampled through a drifting off-centre transform (zoom/rotate/drift) plus a self-displacement that boils the image organically, then mixed with the live layer : trails, tunnels-that-wander, reaction-diffusion textures. A built-in AGC + noise floor hold it at the edge of chaos so it never fades to black or blows to white. COUPLE runs a SECOND buffer under a diverged transform and cross-mixes it in → emergent behaviour no single loop shows. RGB DELAY shears the delay-echo channels in time; ROUTE feeds that echo back into the loop or forward onto the output only. PLACEMENT (Memory Palace) sits the spatial process on the recirculating buffer (feedback : a wandering tunnel) or on the incoming live image (painting : the source is smeared into a still accumulator). The KEYER gates on luma (key black/white) or chroma (key desat/chroma : saturation), so only the keyed region re-enters the loop; SAT DRIFT bleaches trails toward grey or intensifies them toward neon a little more each repeat. Off-centre + small transforms keep it matte, not a radial mandala.",
      "CATEGORIES": ["FX", "Feedback"],
      "INPUTS": [
        { "NAME": "feedback", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.85, "LABEL": "feedback" },
        { "NAME": "couple", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "couple (2nd buffer)" },
        { "NAME": "couple2", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 1.3, "LABEL": "2nd-buffer divergence" },
        { "NAME": "gain", "TYPE": "float", "MIN": 0.2, "MAX": 1.6, "DEFAULT": 1.0, "LABEL": "gain (exciter)" },
        { "NAME": "zoom", "TYPE": "float", "MIN": -0.1, "MAX": 0.1, "DEFAULT": 0.01, "LABEL": "zoom" },
        { "NAME": "rotate", "TYPE": "float", "MIN": -0.2, "MAX": 0.2, "DEFAULT": 0.0, "LABEL": "rotate" },
        { "NAME": "driftX", "TYPE": "float", "MIN": -0.05, "MAX": 0.05, "DEFAULT": 0.0, "LABEL": "drift x" },
        { "NAME": "driftY", "TYPE": "float", "MIN": -0.05, "MAX": 0.05, "DEFAULT": 0.0, "LABEL": "drift y" },
        { "NAME": "pivot", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "pivot drift" },
        { "NAME": "warp", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "self-warp" },
        { "NAME": "hue", "TYPE": "float", "MIN": -0.2, "MAX": 0.2, "DEFAULT": 0.0, "LABEL": "hue cycle" },
        { "NAME": "hueCurve", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "hue nonlinearity" },
        { "NAME": "sat", "TYPE": "float", "MIN": -0.15, "MAX": 0.15, "DEFAULT": 0.0, "LABEL": "sat drift/repeat" },
        { "NAME": "blur", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2, "LABEL": "softness" },
        { "NAME": "delay", "TYPE": "float", "MIN": 0.0, "MAX": 15.0, "DEFAULT": 0.0, "LABEL": "delay frames" },
        { "NAME": "delayMix", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "delay echo" },
        { "NAME": "rgbDelay", "TYPE": "float", "MIN": 0.0, "MAX": 8.0, "DEFAULT": 0.0, "LABEL": "rgb delay (shear)" },
        { "NAME": "route", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["feedback", "feedforward"], "DEFAULT": 0, "LABEL": "echo route" },
        { "NAME": "placement", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["feedback", "painting"], "DEFAULT": 0, "LABEL": "process placement" },
        { "NAME": "blend", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4], "LABELS": ["mix", "add", "screen", "difference", "lighten"], "DEFAULT": 0, "LABEL": "source blend" },
        { "NAME": "keyMode", "TYPE": "long", "VALUES": [0, 1, 2, 3, 4], "LABELS": ["off", "key black", "key white", "key desat", "key chroma"], "DEFAULT": 0, "LABEL": "keyer" },
        { "NAME": "keyThresh", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "key threshold" },
        { "NAME": "keySoft", "TYPE": "float", "MIN": 0.001, "MAX": 0.5, "DEFAULT": 0.1, "LABEL": "key softness" },
        { "NAME": "border", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "key border" },
        { "NAME": "borderHue", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "border hue" },
        { "NAME": "agc", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "auto-gain (safety)" },
        { "NAME": "noise", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "noise floor" }
      ]
    }*/`,
    curated: {
      feedback: [0.6, 0.95], gain: [0.9, 1.08], zoom: [-0.05, 0.05], rotate: [-0.08, 0.08],
      driftX: [-0.02, 0.02], driftY: [-0.02, 0.02], pivot: [0.2, 0.8], warp: [0.2, 0.8],
      hue: [-0.08, 0.08], hueCurve: [0, 0.6], sat: [-0.1, 0.1], blur: [0.05, 0.5], delay: [2, 12], delayMix: [0.2, 0.6],
      couple: [0, 0.6], couple2: [0.6, 1.6], rgbDelay: [0, 4],
      keyThresh: [0.3, 0.6], keySoft: [0.02, 0.2], border: [0, 0.5], agc: [0.3, 0.8], noise: [0.05, 0.4]
    }
  },
  {
    // Datamosh engine : the real codec-mosh look faked in real time (engine/
    // convNodes DatamoshNode). Optical flow → per-macroblock vectors → advected
    // accumulator. No sidechain needed (feeds on the layer); with one + "motion
    // transfer" on, another layer's MOTION moshes this layer's texture.
    id: 'node-datamosh',
    name: 'Datamosh',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Datamosh : the codec 'moshing' look, real-time and codec-free. The layer's own motion (optical flow, quantised to macroblocks) advects a feedback buffer every frame, so the picture keeps SLIDING along movement : the P-frame smear. Turn REFRESH (the I-frame) down and a new scene's motion drags the PREVIOUS scene's texture around : figures melt into and emerge from the image (the bloom). RESIDUAL re-injects live texture (the mosh↔mush line); RESEED snaps whole blocks back so it never fully mushes. STICKY slides each block as a crisp tile (real datamosh tearing); MELT is a softer smear. ACTANTS are sparse sticky patches that a trigger drops into the picture, drifting along the flow as autonomous frozen blocks (Perconte). MANIFEST reveals the live frame only where there's motion, so a new source completes itself out of the retained frame instead of cutting. MOSH GATE holds only the moving parts (+) or only the still ones (−); EDGE REPEL steers the smear along content edges; RE-SHARP crisps the softened result back up. With a sidechain layer + 'motion transfer' on, that layer's MOVEMENT moshes THIS layer's texture.",
      "CATEGORIES": ["FX", "Glitch", "Feedback"],
      "INPUTS": [
        { "NAME": "mode", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["melt", "sticky", "fluid"], "DEFAULT": 1, "LABEL": "mode" },
        { "NAME": "motion", "TYPE": "float", "MIN": 0.0, "MAX": 4.0, "DEFAULT": 1.0, "LABEL": "motion" },
        { "NAME": "swirl", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "flow swirl" },
        { "NAME": "flowInvert", "TYPE": "bool", "DEFAULT": false, "LABEL": "flow invert", "COMPACT": true },
        { "NAME": "block", "TYPE": "float", "MIN": 2.0, "MAX": 64.0, "DEFAULT": 16.0, "LABEL": "block size" },
        { "NAME": "decay", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.92, "LABEL": "persistence" },
        { "NAME": "refresh", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.06, "LABEL": "refresh (I-frame)" },
        { "NAME": "residual", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "residual" },
        { "NAME": "reseed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.1, "LABEL": "reseed" },
        { "NAME": "manifest", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "manifest (motion reveal)" },
        { "NAME": "thresh", "TYPE": "float", "MIN": 0.0, "MAX": 0.1, "DEFAULT": 0.012, "LABEL": "motion gate" },
        { "NAME": "moshGate", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "mosh gate (still↔move)" },
        { "NAME": "edgeRepel", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "edge repel" },
        { "NAME": "resharp", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "re-sharpen" },
        { "NAME": "bleed", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2, "LABEL": "chroma bleed" },
        { "NAME": "autoBloom", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7, "LABEL": "auto-bloom (cuts)" },
        { "NAME": "cutSense", "TYPE": "float", "MIN": 0.02, "MAX": 1.0, "DEFAULT": 0.35, "LABEL": "cut sensitivity" },
        { "NAME": "pulse", "TYPE": "float", "MIN": 0.0, "MAX": 8.0, "DEFAULT": 0.0, "LABEL": "pulse (Hz)" },
        { "NAME": "trig", "TYPE": "event", "DEFAULT": false, "LABEL": "bloom ▸" },
        { "NAME": "actant", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "actants" },
        { "NAME": "actantLife", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "actant life" },
        { "NAME": "actantRate", "TYPE": "float", "MIN": 0.0, "MAX": 8.0, "DEFAULT": 0.0, "LABEL": "actant rate (Hz)" },
        { "NAME": "actantTrig", "TYPE": "event", "DEFAULT": false, "LABEL": "actant ▸" },
        { "NAME": "sidechainFlow", "TYPE": "bool", "DEFAULT": false, "LABEL": "motion transfer", "COMPACT": true },
        { "NAME": "flowRes", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["128", "256", "512"], "DEFAULT": 1, "LABEL": "flow res", "COMPACT": true }
      ]
    }*/`,
    curated: {
      motion: [0.5, 2.0],
      swirl: [-0.4, 0.4],
      block: [8, 32],
      decay: [0.85, 0.97],
      refresh: [0.0, 0.15],
      residual: [0.05, 0.35],
      reseed: [0.0, 0.35],
      manifest: [0.0, 0.6],
      moshGate: [-0.8, 0.8],
      edgeRepel: [-0.5, 0.5],
      resharp: [0.0, 0.5],
      actant: [0.0, 0.8],
      actantLife: [0.3, 0.8],
      actantRate: [0.0, 2.0],
      thresh: [0.005, 0.03],
      bleed: [0, 0.5],
      autoBloom: [0.4, 1.0],
      cutSense: [0.2, 0.5],
      pulse: [0, 2]
    }
  },
  {
    id: 'node-scanner',
    name: 'Scanner',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Scanner : a flatbed-scanner slit-scan. A scan head sweeps the frame; the line it crosses is CAPTURED from the live signal at that instant and held until the head passes again. Because each line is grabbed at a different moment, anything MOVING during the sweep smears and tears across the scanlines — the classic 'moved the photo mid-scan' glitch, live. LOOP scans continuously; ONE-SHOT does a single pass on a trigger then holds the frozen document. DRAG shears the capture (the paper sliding under the head), WOBBLE adds a hand-wave, JITTER/TEAR rip lines, CHANNEL SPLIT misregisters the CCD's RGB. TRIGGER (scan ▸) starts a fresh pass on its rising edge — fire it from the button, over OSC, or by binding a modulator (a square LFO / sample&hold / audio edge) with M for rhythmic live re-scans. Layer-FX only.",
      "CATEGORIES": ["FX", "Scan", "Glitch"],
      "INPUTS": [
        { "NAME": "mode", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["loop", "one-shot"], "DEFAULT": 0, "LABEL": "mode" },
        { "NAME": "axis", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["down", "up", "right", "left"], "DEFAULT": 0, "LABEL": "direction" },
        { "NAME": "scanRate", "TYPE": "float", "MIN": 0.02, "MAX": 4.0, "DEFAULT": 0.4, "LABEL": "scan rate" },
        { "NAME": "drag", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "drag" },
        { "NAME": "wobble", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2, "LABEL": "wobble" },
        { "NAME": "jitter", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "line jitter" },
        { "NAME": "tear", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "tear" },
        { "NAME": "rgb", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2, "LABEL": "channel split" },
        { "NAME": "bar", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25, "LABEL": "scan bar" },
        { "NAME": "trig", "TYPE": "event", "DEFAULT": false, "LABEL": "scan ▸" }
      ]
    }*/`,
    curated: {
      scanRate: [0.1, 1.5],
      drag: [0.1, 0.7],
      wobble: [0, 0.5],
      jitter: [0, 0.5],
      tear: [0, 0.6],
      rgb: [0, 0.5],
      bar: [0.1, 0.4]
    }
  },
  {
    id: 'node-autocutter',
    name: 'Autocutter',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Autocutter : a cut-up collage. The frame is recursively split (binary space partition) into ragged rectangles, then the pieces are SHUFFLED among their slots and optionally rotated — so the picture is chopped and rearranged. The scramble LAYOUT holds still while the live video keeps playing inside every piece, so it stays kinetic. CUTS sets how many pieces, ROTATE how many are turned, SLIP nudges each piece's source, SEAMS draws dark cuts between pieces, MIX blends back toward the original. CONTOUR bends the cuts into uneven, curved tear-lines (the pieces still tessellate perfectly — no gaps, ever); TORN PAPER adds the ripped-magazine edge : a ragged off-white paper fringe along each tear over a soft collage shadow. Both re-tear on every cut, and both run past 1 into genuinely shredded territory. MASK peels pieces away one by one (transparent holes — lower layers show through); at full mask a single seeded piece survives, and every cut ▸ elects a new one, so the last shape keeps changing. SHAPE picks the piece geometry : CUT-UP is the recursive rectangles, MOSAIC is irregular Voronoi polygons (a denser, more organic mosaic) — every other control behaves the same in both. TRIGGER (cut ▸) makes a fresh cut on its rising edge (button / OSC / a modulator via M); AUTO RATE (Hz) re-cuts on its own for hands-free live rhythm, and CROSSFADE (seconds) dissolves the old layout into the new one on each auto/trigger re-cut instead of snapping. Layer-FX only.",
      "CATEGORIES": ["FX", "Glitch"],
      "INPUTS": [
        { "NAME": "shape", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["cut-up", "mosaic"], "DEFAULT": 0, "LABEL": "shape" },
        { "NAME": "cuts", "TYPE": "float", "MIN": 2.0, "MAX": 64.0, "DEFAULT": 20.0, "LABEL": "cuts" },
        { "NAME": "rotate", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "rotate" },
        { "NAME": "slip", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "slip" },
        { "NAME": "gap", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "seams" },
        { "NAME": "contour", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.0, "LABEL": "contour" },
        { "NAME": "curve", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "curve length" },
        { "NAME": "torn", "TYPE": "float", "MIN": 0.0, "MAX": 2.0, "DEFAULT": 0.0, "LABEL": "torn paper" },
        { "NAME": "mask", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "mask" },
        { "NAME": "mix", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" },
        { "NAME": "rate", "TYPE": "float", "MIN": 0.0, "MAX": 8.0, "DEFAULT": 0.0, "LABEL": "auto rate" },
        { "NAME": "xfade", "TYPE": "float", "MIN": 0.0, "MAX": 4.0, "DEFAULT": 0.0, "LABEL": "crossfade" },
        { "NAME": "trig", "TYPE": "event", "DEFAULT": false, "LABEL": "cut ▸" }
      ]
    }*/`,
    curated: {
      cuts: [6, 40],
      rotate: [0, 0.6],
      slip: [0, 0.3],
      gap: [0, 0.4],
      contour: [0.3, 1.5],
      curve: [0.1, 0.9],
      torn: [0.2, 1.4],
      mask: [0, 0.85],
      mix: [0.7, 1.0],
      rate: [0, 2],
      xfade: [0, 1.5]
    }
  },
  {
    id: 'node-chronoscan',
    name: 'Chronoscan',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Chronoscan : per-pixel time displacement. The node keeps a ring of the last ~32 frames; a CONTROL field then sets, for every pixel, how far into that history it reads — so each region of the picture lives in a DIFFERENT PRESENT. SOURCE picks the control: SLIT-SCAN sweeps a moving gradient (the classic scanner smear — an angle you set, drifting at SWEEP), LUMA lets the image's own brightness choose each region's age (bright = further back), or SIDECHAIN uses another layer's brightness as the clock. REACH sets how far back the oldest regions go, CURVE bends the time distribution, INVERT flips it, SMOOTH cross-fades between frames. The temporal twin of the convolution nodes : it convolves TIME. Layer-FX only.",
      "CATEGORIES": ["FX", "Time", "Scan"],
      "INPUTS": [
        { "NAME": "source", "TYPE": "long", "VALUES": [0, 1, 2], "LABELS": ["luma (self)", "luma (sidechain)", "slit-scan"], "DEFAULT": 2, "LABEL": "control" },
        { "NAME": "reach", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "time reach" },
        { "NAME": "angle", "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.0, "LABEL": "scan angle" },
        { "NAME": "sweep", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "sweep" },
        { "NAME": "curve", "TYPE": "float", "MIN": 0.2, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "curve" },
        { "NAME": "invert", "TYPE": "bool", "DEFAULT": false, "LABEL": "invert", "COMPACT": true },
        { "NAME": "smooth", "TYPE": "bool", "DEFAULT": true, "LABEL": "smooth", "COMPACT": true },
        { "NAME": "mix", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" }
      ]
    }*/`,
    curated: {
      reach: [0.3, 1.0],
      angle: [0, 6.2832],
      sweep: [0, 0.4],
      curve: [0.5, 2.0],
      mix: [0.6, 1.0]
    }
  },
  {
    id: 'node-sediment',
    name: 'Sediment',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Sediment : long-term image memory (the app's namesake made literal). It keeps a decaying long-exposure ACCUMULATOR — the brightest traces of the past sink slowly back to black over seconds to MINUTES (DECAY) — plus a sparse KEYFRAME store that snapshots the picture every few seconds (INTERVAL), so minutes of the past stay recallable. AGE sweeps from the recent accumulator to the oldest keyframe; RESURFACE bleeds that memory back under the live image (via BLEND: screen · lighten · under · difference); STIR drifts the memory so it SEDIMENTS rather than sitting as a frozen loop; DEPOSIT sets how strongly the present is laid down. The piece can resurface what it looked like ten minutes ago. Layer-FX only.",
      "CATEGORIES": ["FX", "Time", "Feedback"],
      "INPUTS": [
        { "NAME": "deposit", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "deposit" },
        { "NAME": "decay", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "persistence" },
        { "NAME": "resurface", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "resurface" },
        { "NAME": "age", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "age" },
        { "NAME": "interval", "TYPE": "float", "MIN": 0.5, "MAX": 30.0, "DEFAULT": 4.0, "LABEL": "keyframe (s)" },
        { "NAME": "stir", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.2, "LABEL": "stir" },
        { "NAME": "blend", "TYPE": "long", "VALUES": [0, 1, 2, 3], "LABELS": ["screen", "lighten", "under", "difference"], "DEFAULT": 0, "LABEL": "blend" },
        { "NAME": "mix", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" }
      ]
    }*/`,
    curated: {
      deposit: [0.3, 0.8],
      decay: [0.4, 0.85],
      resurface: [0.2, 0.7],
      age: [0, 0.6],
      interval: [2, 12],
      stir: [0, 0.5],
      mix: [0.6, 1.0]
    }
  },
  {
    id: 'node-parallax',
    name: 'Parallax',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Parallax : real 2.5D from the shared depth map. Near features shift more than far ones as an animated camera SWAY drifts the view, with depth-of-field blur around a FOCUS plane and a FOG that sinks the far distance toward black (aerial recession). It reads the depth the Depth engine fills — set Depth in the header (SYNTH for a test bowl, AI for estimated depth on video/capture). With Depth off (or MIX 0) it is an exact passthrough. Works on any rack; best on the MASTER chain (depth of the whole picture).",
      "CATEGORIES": ["FX", "Distortion", "Depth"],
      "INPUTS": [
        { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "parallax" },
        { "NAME": "angle",  "TYPE": "float", "MIN": 0.0, "MAX": 6.2832, "DEFAULT": 0.0, "LABEL": "angle" },
        { "NAME": "sway",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "sway" },
        { "NAME": "dof",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "depth blur" },
        { "NAME": "focus",  "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "focus" },
        { "NAME": "fog",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "depth fog" },
        { "NAME": "invert", "TYPE": "bool", "DEFAULT": false, "LABEL": "invert", "COMPACT": true },
        { "NAME": "wet",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" }
      ]
    }*/`,
    curated: { amount: [0.1, 0.6], angle: [0, 6.2832], sway: [0, 0.6], dof: [0, 0.5], focus: [0.3, 0.7], fog: [0, 0.5], wet: [0.6, 1] }
  },
  {
    id: 'node-eternalism',
    name: 'Eternalism',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Eternalism : persistence of vision made a signal path (the app's namesake). Keeps a short ring of recent frames and reads two temporal taps. HOLD (Ken Jacobs' Eternalism) alternates two frames a GAP apart across a BLACK shutter interval at RATE — an unfrozen slice of time, a held micro-motion going nowhere (sub-fusion rates shimmer; higher rates fuse). DRIFT (Sherwin/McClure phase-drift twins) superimposes two delayed copies whose delay slowly BEATS in and out of lock — coherent → double-exposed → coherent — the second copy a touch larger with an amber TINT. Matte, near-black, no bloom. Layer / source / master.",
      "CATEGORIES": ["FX", "Time", "Feedback"],
      "INPUTS": [
        { "NAME": "mode", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["hold", "drift"], "DEFAULT": 0, "LABEL": "mode" },
        { "NAME": "gap", "TYPE": "float", "MIN": 1.0, "MAX": 14.0, "DEFAULT": 4.0, "LABEL": "gap (frames)" },
        { "NAME": "rate", "TYPE": "float", "MIN": 0.5, "MAX": 20.0, "DEFAULT": 6.0, "LABEL": "flicker (Hz)" },
        { "NAME": "interval", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "black interval" },
        { "NAME": "detune", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.12, "LABEL": "detune" },
        { "NAME": "tint", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "twin tint" },
        { "NAME": "mix", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" }
      ]
    }*/`,
    curated: { gap: [2, 10], rate: [3, 12], interval: [0.1, 0.5], detune: [0.05, 0.4], tint: [0.1, 0.5], mix: [0.6, 1] }
  },
  {
    id: 'node-afterimage',
    name: 'Afterimage',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Afterimage : Goethe's complement — a bright form, once removed, leaves a ghost in its place (the eye emits the negative/complementary colour). Keeps a slowly-decaying brightness high-water of recent frames; where a bright form has DEPARTED a spot, the ghost blooms back over DECAY seconds. CHROMA sweeps the ghost from a dark subtraction (0, the pure Goethe darkening) to its complementary COLOUR (1, a red form leaves a cyan trace). AMOUNT sets its strength. The literal meaning of Palinopsia. Matte, near-black. Layer / source / master.",
      "CATEGORIES": ["FX", "Time", "Color"],
      "INPUTS": [
        { "NAME": "decay", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "persistence" },
        { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "ghost" },
        { "NAME": "chroma", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "dark ↔ colour" },
        { "NAME": "mix", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" }
      ]
    }*/`,
    curated: { decay: [0.3, 0.8], amount: [0.3, 0.8], chroma: [0, 1], mix: [0.6, 1] }
  },
  {
    id: 'node-melt',
    name: 'Melt',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Melt : a seam-local dissolve that CREEPS. It reads the picture's own light/dark edges, and inside a narrow band along each edge it dissolves the node's OWN previous frame back in, pushed one-sided along the edge normal — so the boundaries between forms soften and slowly walk outward, the image melting at its contours. Unlike Datamosh (motion-driven, whole-frame) this is edge-driven and self-feeding, a structural melt that keeps going on a still picture. WIDTH sets how far from an edge it reaches, GATE which edges qualify, DIR the creep direction and speed (0 = a static edge-ghost, ± = it walks). Layer / source / master.",
      "CATEGORIES": ["FX", "Feedback", "Distortion"],
      "INPUTS": [
        { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "melt" },
        { "NAME": "width", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "band width" },
        { "NAME": "dir", "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "creep" },
        { "NAME": "gate", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "edge gate" }
      ]
    }*/`,
    curated: { amount: [0.3, 0.8], width: [0.1, 0.5], dir: [-0.6, 0.6], gate: [0.05, 0.35] }
  },
  {
    id: 'node-pulfrich',
    name: 'Pulfrich',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Pulfrich : monocular 3D from a temporal eye-delay. One eye reads a slightly DELAYED image (a dark filter slows its neural response) so lateral motion becomes stereo depth. The delay is read per-pixel from a frame ring, keyed by the shared DEPTH map (or luminance) so far/dark planes lag more. The disparity is TEMPORAL, not spatial — a still frame is byte-exact with NO colour fringing; depth blooms only on lateral motion. ANAGLYPH gives a red/cyan pair for glasses (DESAT curbs retinal rivalry, SEPARATION widens the split); FREE is a glasses-free parallax slide, gated by motion. A matte companion to the Anaglyph stage. Layer / source / master; falls back to luminance when no depth map is live.",
      "CATEGORIES": ["FX", "Depth", "Time"],
      "INPUTS": [
        { "NAME": "mode", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["anaglyph", "free"], "DEFAULT": 0, "LABEL": "mode" },
        { "NAME": "source", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["luminance", "depth map"], "DEFAULT": 1, "LABEL": "key" },
        { "NAME": "delay", "TYPE": "float", "MIN": 1.0, "MAX": 14.0, "DEFAULT": 5.0, "LABEL": "eye delay (frames)" },
        { "NAME": "curve", "TYPE": "float", "MIN": 0.2, "MAX": 3.0, "DEFAULT": 1.0, "LABEL": "depth curve" },
        { "NAME": "separation", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "disparity" },
        { "NAME": "desat", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "desaturate" },
        { "NAME": "swap", "TYPE": "bool", "DEFAULT": false, "LABEL": "swap eyes", "COMPACT": true },
        { "NAME": "mix", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" }
      ]
    }*/`,
    curated: { delay: [3, 10], curve: [0.6, 1.8], separation: [0.2, 0.7], desat: [0.2, 0.7], mix: [0.6, 1] }
  },
  {
    id: 'node-corrode',
    name: 'Corrode',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Corrode : durational corrosion that only ever GROWS (buried / weathered — the entropy family). A blotch field seeds new corrosion as the integrated BURY level rises, and each frame it creeps outward, so the picture is eaten away slowly over minutes and never recovers until you EXHUME (reset ▸). EAT sets how deeply corroded zones are removed; TONE stains them from leader-dark to sepia; CRACKLE adds reticulation (cracked-émulsion) lines. On the Master rack it weathers the whole set. Matte, near-black. Layer / source / master.",
      "CATEGORIES": ["FX", "Time", "Cameraless"],
      "INPUTS": [
        { "NAME": "bury", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5, "LABEL": "bury rate" },
        { "NAME": "spread", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "creep" },
        { "NAME": "eat", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7, "LABEL": "eat" },
        { "NAME": "tone", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "dark ↔ sepia" },
        { "NAME": "crackle", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "reticulation" },
        { "NAME": "mix", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" },
        { "NAME": "reset", "TYPE": "event", "DEFAULT": false, "LABEL": "exhume ▸" }
      ]
    }*/`,
    curated: { bury: [0.2, 0.7], spread: [0.2, 0.7], eat: [0.4, 0.9], tone: [0.1, 0.6], crackle: [0.2, 0.7], mix: [0.6, 1] }
  },
  {
    id: 'node-decimate',
    name: 'Decimate',
    category: 'FX',
    native: true,
    source: `/*{
      "DESCRIPTION": "Decimate / Time-Lapse : sample-and-hold at a chosen rate. It grabs a fresh frame only every so often and HOLDS it between grabs, so the picture steps through time — the time-lapse / stutter register the smooth 60fps engine erases. SMOOTH crossfades the last two grabs (0 = a hard snap, 1 = a continuous tween across the whole interval → slow-motion). CLOCK mode samples at RATE; HOLD mode freezes and only re-samples on the trigger. The signature move : two rates of the SAME source across A and B (control vs lapse). Matte, no bloom. Layer / source / master.",
      "CATEGORIES": ["FX", "Time"],
      "INPUTS": [
        { "NAME": "mode", "TYPE": "long", "VALUES": [0, 1], "LABELS": ["clock", "hold"], "DEFAULT": 0, "LABEL": "mode" },
        { "NAME": "rate", "TYPE": "float", "MIN": 0.2, "MAX": 20.0, "DEFAULT": 6.0, "LABEL": "rate (Hz)" },
        { "NAME": "smooth", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "tween" },
        { "NAME": "mix", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" },
        { "NAME": "trig", "TYPE": "event", "DEFAULT": false, "LABEL": "sample ▸" }
      ]
    }*/`,
    curated: { rate: [1, 12], smooth: [0, 0.6], mix: [0.7, 1] }
  }
]

export const GENERATORS: IsfShader[] = [
  {
    id: 'drift-field',
    name: 'Drift Field',
    category: 'Generator',
    source: driftField,
    curated: {
      rate: [0.05, 0.4],
      scale: [1.2, 5],
      warp: [0.2, 1.0],
      steps: [3, 9],
      contrast: [0.9, 1.6],
      split: [0, 0.5]
    }
  },
  {
    id: 'slabs',
    name: 'Slabs',
    category: 'Generator',
    source: slabs,
    curated: {
      rate: [0.1, 0.6],
      bands: [8, 48],
      density: [0.15, 0.6],
      jitter: [0.1, 0.7],
      drift: [0, 0.6],
      accent: [0, 0.5],
      chaos: [0, 0.2],
      nonlinear: [0, 0.7]
    }
  },
  {
    id: 'contour',
    name: 'Contour',
    category: 'Generator',
    source: contour,
    curated: {
      rate: [0.03, 0.3],
      scale: [1, 5],
      levels: [5, 20],
      width: [0.05, 0.3],
      warp: [0.15, 1.1],
      fill: [0, 0.5]
    }
  },
  {
    id: 'grid-drift',
    name: 'Grid Drift',
    category: 'Generator',
    source: gridDrift,
    curated: {
      audioScatter: [0, 0.5],
      cells: [5, 24],
      rate: [0.05, 0.4],
      breathe: [0.1, 0.7],
      slip: [0.05, 0.6],
      lineW: [0.02, 0.12],
      density: [0, 0.35]
    }
  },
  {
    // Ten Print : the Commodore maze one-liner as a generator (EYESY lineage).
    // Reseed is an EVENT (bind M to fire it from an audio modulator : the
    // re-deal-on-transient gesture); audioScatter rides the shared audio
    // texture per cell.
    id: 'ten-print',
    name: 'Ten Print',
    category: 'Generator',
    source: tenPrint,
    curated: {
      cells: [10, 44],
      thickness: [0.05, 0.28],
      bias: [0.3, 0.7],
      flip: [0, 2.5],
      audioScatter: [0, 0.6],
      accent: [0, 0.4]
    }
  },
  {
    id: 'particle-drift',
    name: 'Particle Drift',
    category: 'Generator',
    source: particleDrift,
    curated: {
      count: [6, 28],
      speed: [0.1, 1.2],
      flow: [0, 6.2832],
      size: [0.04, 0.2],
      trail: [0.1, 1.6],
      jitter: [0.2, 0.9],
      vary: [0.3, 0.9]
    }
  },
  {
    id: 'interference',
    name: 'Interference',
    category: 'Generator',
    source: interference,
    // detune + skew stay small : big values tip into op-art vibration.
    curated: {
      freq: [15, 80],
      detune: [0.005, 0.08],
      angle: [0, 6.2832],
      skew: [0.03, 0.4],
      rate: [0.03, 0.4],
      contrast: [0.9, 2.2]
    }
  },
  {
    id: 'column-scan',
    name: 'Column Scan',
    category: 'Generator',
    source: columnScan,
    curated: {
      lines: [20, 80],
      amp: [0.015, 0.1],
      scale: [1, 5],
      rate: [0.05, 0.5],
      width: [0.06, 0.35]
    }
  },
  {
    id: 'ash',
    name: 'Ash',
    category: 'Generator',
    source: ash,
    curated: {
      count: [10, 45],
      speed: [0.05, 0.8],
      physics: [0, 0.85],
      size: [0.04, 0.2],
      wander: [0.15, 0.8],
      flicker: [0.1, 0.7],
      accent: [0.05, 0.6]
    }
  },
  {
    id: 'murmuration',
    name: 'Murmuration',
    category: 'Generator',
    source: murmuration,
    curated: { count: [14, 45], speed: [0.2, 1.5], cohesion: [0.4, 0.95], size: [0.04, 0.15], stretch: [0.2, 1.1] }
  },
  {
    id: 'filaments',
    name: 'Filaments',
    category: 'Generator',
    source: filaments,
    curated: { strands: [6, 28], rate: [0.1, 1], sway: [0.2, 0.8], width: [0.08, 0.4], lean: [-0.5, 0.5] }
  },
  {
    id: 'erosion',
    name: 'Erosion',
    category: 'Generator',
    source: erosion,
    curated: { rate: [0.05, 1], scale: [1.5, 5], streaks: [2, 9], carve: [0.3, 0.9], sediment: [0.15, 0.6] }
  },
  {
    id: 'membrane',
    name: 'Membrane',
    category: 'Generator',
    source: membrane,
    curated: { rate: [0.05, 0.6], mass: [0.3, 0.65], warp: [0.3, 1.2], softness: [0.04, 0.3], veins: [0.1, 0.7] }
  },
  {
    id: 'mycelium',
    name: 'Mycelium',
    category: 'Generator',
    source: mycelium,
    curated: { rate: [0.1, 0.8], scale: [2.5, 8], width: [0.06, 0.3], density: [0.3, 0.85], front: [0.15, 0.7] }
  },
  {
    id: 'swell',
    name: 'Swell',
    category: 'Generator',
    source: swell,
    curated: { rate: [0.1, 1.2], scale: [2, 8], chop: [0.15, 0.8], direction: [0, 6.2832], spread: [0.15, 0.7] }
  },
  {
    id: 'congeal',
    name: 'Congeal',
    category: 'Generator',
    source: congeal,
    curated: { rate: [0.15, 1.2], decay: [0.9, 0.99], warp: [0.15, 0.8], seed: [0.15, 0.6], scale: [1, 5] }
  },
  {
    id: 'slit-scan',
    name: 'Slit Scan',
    category: 'Generator',
    source: slitScan,
    curated: { rate: [0.2, 1.5], span: [3, 20], freq: [3, 20], bands: [3, 14] }
  },
  {
    id: 'ramps',
    name: 'Ramps',
    category: 'Generator',
    source: ramps,
    curated: { freq: [1, 6], steps: [1, 16], rate: [0, 1], angle: [0, 6.2832] }
  },
  {
    id: 'rgb-osc',
    name: 'RGB Oscillators',
    category: 'Generator',
    source: rgbOsc,
    curated: { freq: [2, 20], spread: [0.05, 0.6], symmetry: [0, 1], angle: [0, 6.2832], rate: [0.05, 1.5], level: [0.5, 0.95] }
  },
  {
    id: 'recurse',
    name: 'Recurse',
    category: 'Generator',
    source: recurse,
    curated: { iterations: [4, 9], scale: [0.68, 0.9], angle: [0.1, 0.9], drift: [0.05, 0.35], width: [0.02, 0.12], rate: [0.05, 1] }
  },
  {
    id: 'shapes',
    name: 'Shapes',
    category: 'Generator',
    source: shapes,
    curated: { count: [1, 12], size: [0.2, 0.85], soft: [0.02, 0.3], rate: [0.05, 1.2] }
  },
  {
    id: 'op-art',
    name: 'Op-Art',
    category: 'Generator',
    source: opArt,
    curated: { scale: [8, 48], warp: [0.15, 0.8], rate: [0.05, 1.2], angle: [-1.6, 1.6], contrast: [0.5, 1] }
  },
  {
    id: 'direct-marks',
    name: 'Direct Marks',
    category: 'Generator',
    source: directMarks,
    curated: { density: [8, 60], weight: [0.1, 0.42], gate: [0.35, 1], jitter: [0.1, 0.6], rate: [0.3, 4], angle: [0, 3.14] }
  },
  {
    id: 'dye-field',
    name: 'Dye Field',
    category: 'Generator',
    source: dyeField,
    curated: { rate: [0.15, 1.5], scale: [2.5, 7], warp: [0.3, 0.9], pool: [0.2, 0.8], density: [0.35, 0.8], grain: [0.15, 0.6] }
  },
  {
    id: 'reaction',
    name: 'Reaction',
    category: 'Generator',
    source: reaction,
    curated: { feed: [0.02, 0.06], kill: [0.045, 0.065], rate: [0.6, 1.2], scale: [0.2, 0.8], seed: [0.15, 0.6], sharp: [0.2, 0.8], zoom: [0.6, 2.2], panX: [-0.5, 0.5], panY: [-0.5, 0.5], rotate: [-0.5, 0.5] }
  },
  {
    id: 'metamorph',
    name: 'Metamorph',
    category: 'Generator',
    source: metamorph,
    curated: { rate: [0.05, 0.35], size: [0.15, 0.45], wobble: [0.2, 0.8], complexity: [0.2, 0.8], drift: [0.2, 0.7], inner: [0.1, 0.6] }
  },
  {
    id: 'sync-osc',
    name: 'Sync Osc',
    category: 'Generator',
    source: syncOsc,
    curated: { freq: [3, 40], shape: [0, 1], sync: [0, 1], rate: [0.05, 1.5], angle: [0, 6.2832] }
  },
  {
    id: 'differential',
    name: 'Differential',
    category: 'Generator',
    source: differential,
    curated: {
      count: [2, 6],
      ratio: [1.5, 3],
      rate: [0.1, 2],
      freq: [1.5, 8],
      thickness: [0.05, 0.3],
      lines: [3, 12],
      skew: [0.1, 0.7],
      angle: [0, 6.2832]
    }
  },
  {
    id: 'solid-color',
    name: 'Solid Color',
    category: 'Generator',
    source: solidColor,
    curated: { gradient: [0, 1], angle: [0, 6.2832], midpoint: [0.3, 0.7], dither: [0.3, 0.7] }
  },
  {
    id: 'organic',
    name: 'Organic',
    category: 'Generator',
    source: organic,
    curated: {
      rate: [0.15, 1.1],
      scale: [1.2, 5],
      detail: [0.3, 0.9],
      flow: [0.25, 0.85],
      swirl: [0.2, 0.8],
      depth: [0.2, 0.8],
      embers: [0.2, 0.7],
      vary: [0, 0.7],
      contrast: [0.8, 1.5]
    }
  },
  {
    // Native Text generator (TextSource.ts) : typography as a source, glyphs
    // fillable by a sidechain layer (the convolution move). Header-only source:
    // the auto-UI/presets parse INPUTS; the engine runs the TS class. Font
    // VALUES/LABELS order must match TEXT_FONTS in engine/TextSource.ts.
    id: 'gen-text',
    name: 'Text',
    category: 'Generator',
    native: true,
    // Header generated from TEXT_FONTS so the picker always matches the
    // registry (and the bundled @font-face set) : one source of truth.
    source: `/*${JSON.stringify({
      DESCRIPTION:
        "Text : typography as a source. Type in the Inspector; pick a font, size, weight and letter-spacing; place it with angle/position. A sidechain layer can FILL the glyphs (the letters become a matte over that layer's texture) : no sidechain = solid colour.",
      CATEGORIES: ['Generator'],
      INPUTS: [
        { NAME: 'font', TYPE: 'long', VALUES: TEXT_FONTS.map((_, i) => i), LABELS: TEXT_FONTS, DEFAULT: 1, LABEL: 'font' },
        { NAME: 'size', TYPE: 'float', MIN: 0.02, MAX: 1.0, DEFAULT: 0.25, LABEL: 'size' },
        { NAME: 'weight', TYPE: 'float', MIN: 100.0, MAX: 900.0, DEFAULT: 700.0, LABEL: 'weight' },
        { NAME: 'spacing', TYPE: 'float', MIN: -0.15, MAX: 0.8, DEFAULT: 0.0, LABEL: 'spacing' },
        { NAME: 'stretch', TYPE: 'float', MIN: 0.25, MAX: 4.0, DEFAULT: 1.0, LABEL: 'v stretch' },
        { NAME: 'angle', TYPE: 'float', MIN: -3.1416, MAX: 3.1416, DEFAULT: 0.0, LABEL: 'angle' },
        { NAME: 'posX', TYPE: 'float', MIN: -1.0, MAX: 1.0, DEFAULT: 0.0, LABEL: 'pos x' },
        { NAME: 'posY', TYPE: 'float', MIN: -1.0, MAX: 1.0, DEFAULT: 0.0, LABEL: 'pos y' },
        { NAME: 'color', TYPE: 'color', DEFAULT: [1.0, 1.0, 1.0, 1.0] }
      ]
    })}*/`,
    curated: {
      size: [0.1, 0.5],
      weight: [300, 900],
      spacing: [0, 0.3],
      stretch: [0.7, 2.2],
      angle: [-0.6, 0.6],
      posX: [-0.4, 0.4],
      posY: [-0.4, 0.4]
    }
  },
  {
    // Collage : the Autocutter's cut-up with a different FILM in every piece.
    // NATIVE (engine/CollageSource.ts) : it owns a pool of video decks and
    // composites them through the Autocutter's own partition, so the whole wall
    // is ONE layer and the usual rack / blend / finishing stack rides on top.
    // The folder lives on the slot (collageFolder / collagePool), not here.
    id: 'gen-collage',
    name: 'Collage',
    category: 'Generator',
    native: true,
    source: `/*${JSON.stringify({
      DESCRIPTION:
        "Collage : a wall of films cut up like torn paper. Point it at a folder in the Inspector and every piece of the cut-up plays a different clip, cover-cropped to its own shape so portrait, landscape and 4K mix freely. `feed` switches between that folder and a selection from the Assemble bank — with `assemblages` every piece plays one of your saved little edits instead, cutting on its own. `films` is how many play at once, up to 50 (more cuts than films is fine — the extra pieces show the same film at another crop); `window` is 0 for just playing the film on a loop (no seeking at all, the smoothest setting), or a length in seconds to loop a short window of it instead; `churn` decides how many pieces re-cut on their own fast clock, from all holding to every piece its own little montage. `deal` re-deals the wall, `rate` does it on a clock. contour / curve length / torn paper / mask are the Autocutter's dials, and behave identically.",
      CATEGORIES: ['Generator'],
      INPUTS: [
        { NAME: 'cuts', TYPE: 'float', MIN: 2.0, MAX: 64.0, DEFAULT: 12.0, LABEL: 'cuts' },
        { NAME: 'feed', TYPE: 'long', VALUES: [0, 1], LABELS: ['folder', 'assemblages'], DEFAULT: 0, LABEL: 'feed' },
        { NAME: 'films', TYPE: 'float', MIN: 1.0, MAX: 50.0, DEFAULT: 12.0, LABEL: 'films' },
        { NAME: 'hold', TYPE: 'float', MIN: 0.0, MAX: 30.0, DEFAULT: 0.0, LABEL: 'window (s)' },
        { NAME: 'churn', TYPE: 'float', MIN: 0.0, MAX: 1.0, DEFAULT: 0.0, LABEL: 'churn' },
        { NAME: 'speed', TYPE: 'float', MIN: 0.1, MAX: 4.0, DEFAULT: 1.0, LABEL: 'speed' },
        { NAME: 'zoom', TYPE: 'float', MIN: 1.0, MAX: 3.0, DEFAULT: 1.05, LABEL: 'zoom' },
        { NAME: 'rotate', TYPE: 'float', MIN: 0.0, MAX: 1.0, DEFAULT: 0.0, LABEL: 'rotate' },
        { NAME: 'gap', TYPE: 'float', MIN: 0.0, MAX: 1.0, DEFAULT: 0.0, LABEL: 'seams' },
        { NAME: 'contour', TYPE: 'float', MIN: 0.0, MAX: 2.0, DEFAULT: 0.0, LABEL: 'contour' },
        { NAME: 'curve', TYPE: 'float', MIN: 0.0, MAX: 1.0, DEFAULT: 0.3, LABEL: 'curve length' },
        { NAME: 'torn', TYPE: 'float', MIN: 0.0, MAX: 2.0, DEFAULT: 0.0, LABEL: 'torn paper' },
        { NAME: 'mask', TYPE: 'float', MIN: 0.0, MAX: 1.0, DEFAULT: 0.0, LABEL: 'mask' },
        { NAME: 'rate', TYPE: 'float', MIN: 0.0, MAX: 60.0, DEFAULT: 0.0, LABEL: 'auto deal (s)' },
        { NAME: 'deal', TYPE: 'event', LABEL: 'deal' }
      ]
    })}*/`,
    curated: {
      cuts: [4, 24],
      films: [4, 20],
      hold: [0, 10],
      churn: [0, 0.6],
      speed: [0.5, 1.6],
      zoom: [1, 1.4],
      rotate: [0, 0.35],
      gap: [0, 0.4],
      contour: [0.3, 1.5],
      curve: [0.1, 0.9],
      torn: [0.2, 1.4],
      mask: [0, 0.5],
      rate: [0, 20]
    }
  },
  {
    // Parametric : the audio-buffer→texture generator (the parametric
    // diegesis; a test-pattern raster). NATIVE (engine/ParametricSource.ts). Reads
    // the LOCAL audio bus's spectrum/waveform; a procedural signal when silent.
    id: 'gen-parametric',
    name: 'Parametric',
    category: 'Generator',
    native: true,
    source: `/*${JSON.stringify({
      DESCRIPTION:
        'Parametric : a literal audio→image reading (a test-pattern raster). Renders the LOCAL audio bus as a hard raster, a waveform trace, spectrum bars, or a scrolling spectrogram. Needs Audio ingest ON (local) to read real sound; otherwise a procedural test signal. Abstract by design : a raster/waveform/spectrogram, never an oscilloscope.',
      CATEGORIES: ['Generator'],
      INPUTS: [
        { NAME: 'mode', TYPE: 'long', VALUES: [0, 1, 2, 3], LABELS: ['raster', 'waveform', 'bars', 'spectrogram'], DEFAULT: 0, LABEL: 'mode' },
        { NAME: 'gain', TYPE: 'float', MIN: 0.0, MAX: 4.0, DEFAULT: 1.2, LABEL: 'gain' },
        { NAME: 'scale', TYPE: 'float', MIN: 0.0, MAX: 1.0, DEFAULT: 0.4, LABEL: 'scale' },
        { NAME: 'scan', TYPE: 'float', MIN: 0.0, MAX: 1.0, DEFAULT: 0.3, LABEL: 'scan' },
        { NAME: 'mono', TYPE: 'bool', DEFAULT: true, LABEL: 'mono' },
        { NAME: 'color', TYPE: 'color', DEFAULT: [0.6, 0.85, 1.0, 1.0] }
      ]
    })}*/`,
    curated: { gain: [0.6, 2.0], scale: [0.1, 0.8], scan: [0.1, 0.7] }
  }
]

// The glitch/digital-arts FX vocabulary (brief §5).
export const FX_SHADERS: IsfShader[] = [
  {
    id: 'fx-posterize', name: 'Posterize', category: 'FX', source: posterize,
    curated: { levels: [3, 10], gamma: [0.8, 1.4] }
  },
  {
    id: 'fx-dither', name: 'Dither', category: 'FX', source: dither,
    curated: { levels: [2, 5], scale: [1, 4], amount: [0.6, 1] }
  },
  {
    id: 'fx-chroma-shift', name: 'Chroma Shift', category: 'FX', source: chromaShift,
    curated: { amount: [0.002, 0.02], angle: [0, 6.2832] }
  },
  {
    id: 'fx-pixelate', name: 'Pixelate', category: 'FX', source: pixelate,
    curated: { cells: [40, 240] }
  },
  {
    id: 'fx-displace', name: 'Displace', category: 'FX', source: displace,
    curated: { amount: [0.01, 0.08], scale: [1.5, 8], rate: [0.05, 0.5] }
  },
  {
    id: 'fx-scanlines', name: 'Scanlines', category: 'FX', source: scanlines,
    curated: { count: [200, 900], darkness: [0.1, 0.5], roll: [0, 0.3] }
  },
  {
    id: 'fx-edge', name: 'Edge', category: 'FX', source: edge,
    curated: { gain: [1, 3], blend: [0.3, 1] }
  },
  {
    id: 'fx-grade', name: 'Grade', category: 'FX', source: grade,
    curated: { brightness: [-0.15, 0.15], contrast: [0.8, 1.6], saturation: [0.3, 1.3], lift: [0, 0.08] }
  },
  {
    id: 'fx-slice-shuffle', name: 'Slice Shuffle', category: 'FX', source: sliceShuffle,
    curated: { slices: [8, 64], amount: [0.02, 0.25], chance: [0.1, 0.5], rate: [0.1, 0.7] }
  },
  {
    id: 'fx-smear', name: 'Smear', category: 'FX', source: smear,
    curated: { reach: [0.02, 0.2], threshold: [0.25, 0.7], angle: [0, 6.2832] }
  },
  {
    id: 'fx-palette', name: 'Palette', category: 'FX', source: palette,
    curated: { stops: [2, 5], blend: [0, 1], dither: [0, 0.6], mixSrc: [0, 0.4] }
  },
  {
    id: 'fx-threshold', name: 'Threshold', category: 'FX', source: threshold,
    // Curated level sits LOW: the seed generators live near black, and a
    // mid threshold gates them entirely to black (the Randomize-black bug).
    curated: { level: [0.08, 0.35], soft: [0.05, 0.3] }
  },
  {
    id: 'fx-solarize', name: 'Solarize', category: 'FX', source: solarize,
    curated: { level: [0.4, 0.8], strength: [0.5, 1] }
  },
  {
    id: 'fx-mosh-blocks', name: 'Mosh Blocks', category: 'FX', source: moshBlocks,
    curated: { blocks: [10, 48], amount: [0.05, 0.3], chance: [0.1, 0.5], rate: [0.1, 0.8], freak: [0, 0.5] }
  },
  {
    id: 'fx-grain', name: 'Grain', category: 'FX', source: grain,
    curated: { amount: [0.05, 0.35], size: [1, 3], chroma: [0, 0.6], parasites: [0.05, 0.5] }
  },
  {
    id: 'fx-streak', name: 'Streak', category: 'FX', source: streak,
    curated: { reach: [0.02, 0.15], angle: [0, 6.2832] }
  },
  {
    id: 'fx-sharpen', name: 'Sharpen', category: 'FX', source: sharpen,
    curated: { amount: [0.3, 2] }
  },
  {
    id: 'fx-fold', name: 'Fold', category: 'FX', source: fold,
    // Seam kept off-centre : a centred fold is the symmetry the brief refuses.
    curated: { seam: [0.55, 0.8], offset: [-0.3, 0.3] }
  },
  {
    id: 'fx-transform', name: 'Transform', category: 'FX', source: transform,
    // crop rolls a SHALLOW bite (≤0.2 per edge) : Randomize / Vary reframe with
    // it, but four edges at their max still leave a generous 0.6×0.6 centre, so
    // a dice never chops the frame to slivers. shape stays pinned at 0.
    curated: {
      zoom: [0.7, 1.6], posX: [-0.3, 0.3], posY: [-0.3, 0.3], rotate: [-0.6, 0.6], shape: [0, 0],
      cropUp: [0, 0.2], cropDown: [0, 0.2], cropLeft: [0, 0.2], cropRight: [0, 0.2]
    }
  },
  {
    id: 'fx-stutter', name: 'Stutter', category: 'FX', source: stutter,
    curated: { rate: [2, 12], chance: [0.2, 0.7], bands: [1, 12], jitter: [0, 0.8], blackout: [0, 0.5] }
  },
  {
    id: 'fx-sync-loss', name: 'Sync Loss', category: 'FX', source: syncLoss,
    curated: { roll: [0.05, 0.8], tear: [0.02, 0.25], bands: [2, 8], rate: [0.1, 0.7] }
  },
  {
    id: 'fx-ntsc', name: 'NTSC', category: 'FX', source: ntsc,
    curated: { artifact: [0.1, 0.6], carrier: [0.2, 0.8], fringe: [0.05, 0.4], interlace: [0.1, 0.6], fieldHue: [-0.5, 0.5], fieldCrawl: [0, 0.4] }
  },
  {
    id: 'fx-row-echo', name: 'Row Echo', category: 'FX', source: rowEcho,
    curated: { rows: [20, 140], chance: [0.1, 0.6], fade: [0.1, 0.8], rate: [0.1, 0.7] }
  },
  {
    id: 'fx-byte-corrupt', name: 'Byte Corrupt', category: 'FX', source: byteCorrupt,
    curated: { depth: [3, 10], scramble: [0.15, 0.7], blocks: [4, 32], warpByte: [0, 0.6], rate: [0.1, 0.7], chaos: [0, 0.6] }
  },
  {
    id: 'fx-ringing', name: 'Ringing', category: 'FX', source: ringing,
    curated: { gap: [0.003, 0.02], intensity: [0.3, 1.3], angle: [0, 6.2832] }
  },
  {
    id: 'fx-tracking', name: 'Tracking', category: 'FX', source: tracking,
    curated: {
      band: [0.05, 0.25], position: [0, 1], roll: [0, 0.6], wobble: [0.01, 0.1],
      noise: [0.2, 0.8], rate: [0.2, 0.8], freeze: [0, 0.6], distort: [0, 0.4],
      bleed: [0, 0.5], bleedRange: [0.4, 1.4]
    }
  },
  {
    id: 'fx-motif', name: 'Motif', category: 'FX', source: motif,
    curated: {
      offX: [-0.3, 0.3], offY: [-0.25, 0.25], rotate: [-1.2, 1.2],
      scale: [0.75, 1.15], fade: [0.4, 0.8]
    }
  },
  {
    id: 'fx-feedback-zoom', name: 'Feedback Zoom', category: 'FX', source: feedbackZoom,
    curated: { zoom: [0.95, 1.08], twist: [-0.08, 0.08], amount: [0.35, 0.85] }
  },
  {
    id: 'fx-force-lines', name: 'Force Lines', category: 'FX', source: forceLines,
    curated: { lines: [4, 16], shift: [0.005, 0.04], edge: [0.2, 0.8], gate: [0.3, 0.8], amount: [0.6, 1] }
  },
  {
    id: 'fx-aperture', name: 'Aperture', category: 'FX', source: aperture,
    curated: { size: [0.3, 0.9], soft: [0.05, 0.3], flicker: [0, 0.5], rate: [4, 16], couple: [0.2, 0.8], amount: [0.7, 1] }
  },
  {
    id: 'fx-distort', name: 'Distort', category: 'FX', source: distort,
    curated: { amount: [0.1, 0.6], scale: [1, 12], angle: [0, 6.2832], rate: [0.1, 2] }
  },
  {
    id: 'fx-slit-buffer', name: 'Slit Buffer', category: 'FX', source: slitBuffer,
    curated: { rate: [0.05, 1], width: [0.01, 0.1], jitter: [0, 0.7], jumps: [0, 0.6], direction: [0, 2] }
  },
  {
    id: 'fx-difference-bloom', name: 'Difference Bloom', category: 'FX', source: differenceBloom,
    curated: { gain: [1.5, 6], spread: [0.004, 0.03], keep: [0, 0.4] }
  },
  {
    id: 'fx-triangle-flicker', name: 'Triangle Flicker', category: 'FX', source: triangleFlicker,
    curated: { rate: [1, 12], depth: [0.2, 0.9], hard: [0, 1], swap: [0, 0.6] }
  },
  {
    id: 'fx-colorizer', name: 'Colorizer', category: 'FX', source: colorizer,
    curated: { gain: [0.5, 2.5], bias: [-0.4, 0.4], fold: [0, 0.6], mixSrc: [0.15, 0.4] }
  },
  {
    id: 'fx-wavefold', name: 'Wavefold', category: 'FX', source: wavefold,
    curated: { fold: [0.1, 0.8], bias: [-0.3, 0.3], symmetry: [0, 1], wet: [0.4, 1] }
  },
  {
    id: 'fx-rutt', name: 'Rutt', category: 'FX', source: rutt,
    curated: { lines: [40, 160], amp: [0.03, 0.2], width: [0.08, 0.4], color: [0, 1] }
  },
  {
    id: 'fx-crt-screen', name: 'CRT Screen', category: 'FX', source: crtScreen,
    curated: { curve: [0.05, 0.4], aberration: [0.002, 0.02], scanline: [0.1, 0.5], vignette: [0.15, 0.7], corner: [0.02, 0.12] }
  },
  {
    id: 'fx-pixelmask', name: 'Pixelmask', category: 'FX', source: pixelmask,
    curated: { scale: [1.5, 8], amount: [0.3, 0.9] }
  },
  {
    id: 'fx-light-trails', name: 'Light Trails', category: 'FX', source: lightTrails,
    curated: { decay: [0.9, 0.99], drift: [0, 0.012], angle: [0, 6.2832] }
  },
  {
    id: 'fx-decay', name: 'Decay', category: 'FX', source: decay,
    curated: { amount: [0.3, 0.8], smear: [0.1, 0.55], chroma: [0.2, 0.75], blocks: [0.1, 0.6], dropout: [0, 0.4], jitter: [0.1, 0.6] }
  },
  {
    id: 'fx-abstraction', name: 'Abstraction', category: 'FX', source: abstraction,
    curated: { amount: [0.25, 0.85], disperse: [0.3, 0.9], posterize: [0.2, 0.8], desat: [0.2, 0.8] }
  },
  {
    id: 'fx-wide-time', name: 'Wide Time', category: 'FX', source: wideTime,
    curated: {
      width: [12, 140], amount: [0.6, 1], mode: [0, 1],
      soften: [0, 0.4], drift: [-0.006, 0.006], hue: [-0.03, 0.03],
      preserve: [0.3, 0.8]
    }
  },
  {
    id: 'fx-hue-rotate', name: 'Hue Rotate', category: 'FX', source: hueRotate,
    curated: { shift: [0, 1], byLuma: [-0.6, 0.6] }
  },
  {
    id: 'fx-rgb-shift', name: 'RGB Shift', category: 'FX', source: rgbShift,
    curated: { offset: [0.003, 0.04], scale: [0, 0.06], angle: [0, 6.2832], wobble: [0, 0.7] }
  },
  {
    id: 'fx-granular', name: 'Granular', category: 'FX', source: granular,
    curated: { grain: [0.2, 0.8], density: [0.5, 1], scatter: [0, 0.5], rotate: [0, 0.5], smear: [0, 0.6], rate: [0.1, 3] }
  },
  {
    id: 'fx-mosaic', name: 'Mosaic', category: 'FX', source: mosaic,
    curated: { grid: [0.2, 0.7], size: [0.5, 1], lumaSize: [0.2, 0.9], soft: [0.02, 0.2], shape: [0, 3], gapMix: [0, 0.4] }
  },
  {
    id: 'fx-optical-rain', name: 'Optical Rain', category: 'FX', source: opticalRain,
    curated: { amount: [0.3, 0.9], rain: [0.15, 0.7], streak: [0.2, 0.8], columns: [90, 400], disparity: [0.3, 0.9], edges: [0.3, 0.9] }
  },
  {
    id: 'fx-phosphene', name: 'Phosphene', category: 'FX', source: phosphene,
    curated: { sensitivity: [0.3, 0.8], persistence: [0.4, 0.85], strength: [0.35, 0.8], complement: [0.6, 1], threshold: [0.4, 0.7] }
  },
  {
    id: 'fx-compress', name: 'Compress', category: 'FX', source: compress,
    curated: { block: [6, 16], quality: [0.1, 0.5], ring: [0.2, 0.7], chroma: [0.3, 0.9], grid: [0, 0.3] }
  },
  {
    id: 'fx-databend', name: 'Databend', category: 'FX', source: databend,
    curated: { bands: [16, 90], shift: [0.03, 0.25], chance: [0.15, 0.5], hold: [0.2, 0.6], channel: [0.2, 0.7], rate: [0.2, 0.7] }
  },
  {
    id: 'fx-pixelsort', name: 'Pixel Sort', category: 'FX', source: pixelSort,
    curated: { low: [0.1, 0.4], high: [0.6, 0.9], length: [0.1, 0.4] }
  }
  // PHASE 9 (post-MVP experiment): Cross-FM : a source that takes ANOTHER
  // layer's frame as a video-rate FM input (an A→B→C→A cross-oscillator
  // feedback). Needs engine plumbing (a second image input bound to a layer
  // buffer), so it waits with WebGPU (brief §15.1). Not built here.
]

// The Vibe mastering stage : pinned to the master rack's end (store-locked),
// deliberately NOT in FX_SHADERS so racks and Randomize can't add a second.
export const VIBE_SHADER: IsfShader = {
  id: 'fx-vibe',
  name: 'Vibe Palette',
  category: 'FX',
  source: vibe
}

// The Context depth finalizer : pinned AFTER Vibe, also store-locked and kept
// out of FX_SHADERS. Curated ranges keep the Inspector dice tasteful.
export const CONTEXT_SHADER: IsfShader = {
  id: 'fx-context',
  name: 'Context',
  category: 'FX',
  source: context,
  curated: {
    trails: [0, 0.6],
    blur: [0, 0.4],
    bloom: [0.1, 0.7],
    depth: [0.1, 0.7],
    haze: [0, 0.5],
    lightGlow: [0, 0.6],
    lightSize: [0.3, 0.9]
  }
}

// The Finalizer : the last always-on master stage after Context (grade + grain
// + sharpen). Store-locked, kept out of FX_SHADERS.
export const FINALIZER_SHADER: IsfShader = {
  id: 'fx-finalizer',
  name: 'Finalizer',
  category: 'FX',
  source: finalizer,
  curated: {
    black: [0, 0.15],
    white: [0.85, 1],
    gamma: [0.8, 1.3],
    rGain: [0.85, 1.15],
    gGain: [0.85, 1.15],
    bGain: [0.85, 1.15],
    sharpen: [0, 0.6],
    grain: [0, 0.3],
    grainSize: [1, 2.5],
    chroma: [0, 0.4],
    parasites: [0, 0.3],
    // The output shaper is a deliberate compositional move : never randomized.
    outShape: [0, 0],
    outBgSource: [0, 0]
  }
}

export const ALL_SHADERS: IsfShader[] = [
  ...GENERATORS,
  ...FX_SHADERS,
  ...NATIVE_NODES,
  VIBE_SHADER,
  CONTEXT_SHADER,
  FINALIZER_SHADER
]

export const SHADER_BY_ID: Record<string, IsfShader> = Object.fromEntries(
  ALL_SHADERS.map((s) => [s.id, s])
)

// ── Menu ordering ─────────────────────────────────────────────────────
// Sources list alphabetically; FX group by their sub-category (from the ISF
// header CATEGORIES), colour first. These drive the pickers only : the raw
// arrays keep their authoring order for Randomize's pools.

export const GENERATORS_ALPHA: IsfShader[] = [...GENERATORS].sort((a, b) =>
  a.name.localeCompare(b.name)
)

// A shader's display group = its first CATEGORIES tag that isn't the top-level
// "FX" (Color, Glitch, Distortion, …).
function fxGroup(sh: IsfShader): string {
  const m = sh.source.match(/"CATEGORIES"\s*:\s*\[([^\]]*)\]/)
  if (!m) return 'Other'
  const cats = m[1].split(',').map((x) => x.replace(/["'\s]/g, ''))
  return cats.find((c) => c && c !== 'FX') ?? 'Other'
}

/** FX bucketed by sub-category : groups AND shaders alphabetical (matching the
 *  alphabetical sources list), so any new group (e.g. Convolution) slots in. */
export const FX_GROUPS: Array<{ group: string; shaders: IsfShader[] }> = (() => {
  const buckets = new Map<string, IsfShader[]>()
  // Native convolution nodes appear in the picker alongside FX (their own group).
  for (const sh of [...FX_SHADERS, ...NATIVE_NODES]) {
    const g = fxGroup(sh)
    if (!buckets.has(g)) buckets.set(g, [])
    buckets.get(g)!.push(sh)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([group, shaders]) => ({
      group,
      shaders: [...shaders].sort((x, y) => x.name.localeCompare(y.name))
    }))
})()

/** Source lookup the engine's syncFromState consumes. */
export function shaderSourceById(id: string): string | null {
  return SHADER_BY_ID[id]?.source ?? null
}

/** Randomize's range for one input: curated if present, else declared. */
export function curatedRange(
  shaderId: string,
  input: string,
  declared: [number, number]
): [number, number] {
  return SHADER_BY_ID[shaderId]?.curated?.[input] ?? declared
}
