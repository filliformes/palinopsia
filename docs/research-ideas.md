# Palinopsia — research ideas from the visual-music literature

Ideas mined from six texts (Vincent's master's-composition reading) and mapped onto
Palinopsia's architecture (WebGL2 / ISF, 4 layers, 8 modulators + 16 Meta knobs, OSC-in
from Pandore, the Vibe Palette + Context finalizers). Aesthetic guardrails hold
throughout: matte, near-black, one accent, glitch/digital-arts; **never** radial/
kaleidoscopic symmetry, plasma, Lissajous, or additive-glow-on-black.

## Sources

1. **Laposky, B. (1953). *Electronic Abstractions*.** The first electronic visual art —
   "oscillons": abstract figures traced on a CRT oscilloscope by summing sine/saw/square
   oscillators on the X/Y plates, dynamic and photographed at the "best-balance" moment.
   *Caveat: the figures themselves are Lissajous/harmonograph — radially symmetric — so we
   borrow the lineage and technique, never the symmetry.*
2. **Collopy, D. (2000). "Color, Form, and Motion: Dimensions of a Musical Art of Light."**
   Visual music organized along colour / form / motion, unified by rhythm; colour serves
   harmony-mood-accent (not pitch); differential dynamics; memory binds motion.
3. **Collopy, D. (2020). "Visual Synthesizer Design."** 14 performance hypotheses (H1–H14)
   of non-arbitrary music↔image correspondence, grounded in synesthesia (bouba/kiki,
   pitch–size); "purity" as a unified value+saturation axis; colour chords.
4. **Collopy, Fuhrer, Jameson (1999). "Visual Music in a Visual Programming Language"
   (Sonnet+Imager).** Rhythm decomposed as WHERE (path) / WHEN (time) / WHAT (targets);
   functors; freehand envelope paths; complementary-hue binding across objects.
5. **Forbes & Villegas (2015). "Video Granular Synthesis."** Video as an (x,y,t) cube of
   Hann-windowed grains; clone / delete / scale / rotate / shuffle / reposition; slit-scan
   from space-time swaps; variance-driven scatter; audio→grain-param mapping.
6. **Villegas & Forbes (2014). "Analysis/Synthesis Approaches for Creatively Processing
   Video Signals."** Four-stage pipeline: analyze features (corners/dither/Gaussians/
   Fourier/FFT) → match (optimal / bottleneck / sub-optimal greedy) → interpolate (Euler
   steering) → resynthesize as *other* primitives. The video phase-vocoder.

## Built from this research (v0.1)

| Feature | id | Source | What it does |
|---|---|---|---|
| **Granular** FX | `fx-granular` | VGS15 | Hann-windowed grain field over the input; per-grain rotate/scatter/scale; persistent buffer for temporal smear; density thins the field. Works on any source now, video in Phase-7. |
| **Mosaic** FX | `fx-mosaic` | AS14 §4.5 | N×M analysis grid; each cell → its own colour; tile **size follows cell luminance**; square/circle/diamond/cross + gap fill. |
| **Differential** generator | `differential` | Collopy00 / Whitney | Wave trains at **integer speed ratios** beating against each other, drawn as contour bands; per-layer skew keeps it asymmetric (non-radial). |
| **Vibe colour chords** | `fx-vibe` `harmony` | Collopy00/20 | Opt-in mode: generate the palette stops from one base hue + a relationship (analogous / complementary / triad / split / tetrad) on a dark→light ramp. Default off = manual palette. |

## Feature 5 — the synesthetic OSC patch (config, now that OSC-in exists)

These are Collopy's non-arbitrary correspondences, patchable **today** from Pandore over
OSC (values normalized 0–1; scale to each target's range automatically). Send the named
audio feature to the address; use the suggested polarity.

| Music feature (Pandore) | → OSC address | Visual result | Hyp. | Polarity |
|---|---|---|---|---|
| Pitch / note | `/opsia/layer/{n}/source/A/count` (Differential) or a source `size` | pitch → element **size/count** | H3 | invert: high pitch = small/fewer |
| Amplitude / RMS | `/opsia/layer/{n}/source/A/thickness` (Differential) | loud → **thicker** marks | H5 | direct |
| Amplitude / RMS | `/opsia/master/vibe/saturation` | loud → more **purity** (brighter/saturated), soft → muted | H4/H16 | direct |
| Spectral centroid / timbre | `/opsia/master/vibe/baseHue` (with `harmony` on) | timbre → **hue** of the colour chord | H1/H9 | curated |
| Silence / sustain gate | `/opsia/layer/{n}/opacity` | rest → layer **recedes**, activity → returns | H11 (repose→rest) | invert |
| Percussion accent (gated) | a `/opsia/meta/{k}` bound to a hue/flash macro | accent → brief colour **pulse** (not every beat) | Survage | trigger |
| Musical structure (slow) vs. detail (fast) | hue via `/opsia/master/vibe/baseHue`; purity via `/opsia/master/vibe/contrast` | big changes shift **hue**, small changes shift **purity** | H6 (Fischinger) | dual mapping |

The point (the thesis's core argument): **direct pitch→hue fails** (Collopy disproves it —
too many unrelated hues, colour blends lose identity). Map pitch to *size/register*, hue
to *timbre/harmony*, and let *purity* carry dynamics.

## Backlog — worth building next

**Video treatment (needs Phase-7 video input):** grain-delay history buffer (VGS15);
variance-driven scatter (VGS15); slit-scan space-time swap (VGS15, Phase-9 compute);
A/S resynthesis primitives — features re-rendered as other marks (AS14); the 2D-FFT phase
vocoder for video (AS14 §4.6, Phase-9).

**Colour / Vibe:** purity-as-secondary-change dual mapping (H6); monochrome ribbon —
desaturate→recolour as a compositional pivot (DeWitt); tension-release colour domains
(Evans).

**Motion / modulation:** WHERE/WHEN/WHAT "trajectory" modulator (Sonnet99); temporal-
dilation clock curve (Sonnet99); freehand macro-path editor (Sonnet99).

**Instrument / composition:** "individual vs. dividual" theme/variation layer archetypes
(Klee, H13); a **best-balance freeze + still-capture** control honouring Laposky's practice;
linked-hue binding across layers (Sonnet99).
