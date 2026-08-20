# Opsia research imports — code-grounded triage

Two web-research passes (Aug 2026) surveyed visual-instrument prior art — Max/Jitter,
TouchDesigner, LZX, academic papers — for concepts Opsia could borrow. The passes ran against
a **stale (2026-07-09) skill snapshot**, so a large share of their "gaps" are already built.
This doc re-triages all ~40 finds against the CURRENT code: what the research validates as
already-done, what's genuinely still open (the real shelf, ranked), and what's citation-only.

Visual demos of every find: `opsia-research-plates.html` (série II) + `opsia-research-plates-I.html`
(série I), in this folder. Série I ≈ *how the image is made*; série II ≈ *how time is decided*
(the Palinopsia / Assemble seam).

---

## A. Already built (the research validates existing work)

The browser flagged these as gaps because the skill it read predated them. They're done:

- **Depth Anything V2** (real depth) → `engine/depthEstimate.ts` already loads
  `onnx-community/depth-anything-v2-small` via transformers.js/WebGPU behind the `depth: off/
  synth/AI` selector, feeding Context haze, the Finalizer anaglyph, and `depthShadow`. *Open
  sub-item:* **Video Depth Anything** (temporally-stable) — per-frame depth crawls in a
  projection, so a temporally-consistent model is a real upgrade.
- **Motion History Image** (sedimentation) → `node-sediment` IS an MHI (decaying long-exposure
  where intensity = recency). *Open sub-item:* expose Hu-moments as descriptors for Sonify/OSC.
- **Time Machine TOP / Chronos** (temporal displacement) → `node-chronoscan` = per-pixel time
  offset / slit-scan from a control field; `node-reponse` = the 16-frame ring. *Open sub-item:*
  let the offset map be a **sidechain layer / Transfert flow / SDF**, not just self-luma.
- **Rutt-Etra scan processor** (Balayage) → `fx-rutt` exists.
- **cv.jit return path** (image→control) → `engine/visionIn.ts` + the `vision` modulator +
  `/opsia/vision/*` OSC-out. Retired by the researcher in pass 2. *Open sub-item:* the descriptor
  list (elongation, orientation) may still be worth adding to the bus.
- **Sonify (image→sound)** → built, six voices, AudioWorklet. The pass-2 mapping-doctrine finds
  (vOICe, ANS, Oram, sonification taxonomy, luminance-histogram bank) are **thesis/naming
  material, not features** — except the Oramics reframe (see §C).
- **CataRT / Video Textures / corpus editing** → **Assemble** IS CataRT ported to video; the
  `palinopsia-assemble` memory already cites VIVO + Video Textures as its source papers.
  Controlled-animation-of-video-sprites (target-driven frame selection) is Assemble's live
  matcher. So the whole "Assemble" cluster is refinements to an existing system (see §B for the
  two that are real architecture upgrades).
- **Cameraless / direct film** → built (`engine/cameraless.ts`, Griffé/Peint/Pressé). Kuwahara/
  XDoG (§B) are better *implementations* of Peint/Griffé, not new stages.

## B. Genuinely new & worth building — the real shelf (ranked)

1. **The Metasurface** (Bencina, NIME 2005). Continuous scene space : place scene snapshots on a
   plane, interpolate with natural-neighbour (Voronoi) weights; dragging navigates between the
   nearest snapshots. Opsia's scene bank is discrete + `morphMs`. *Both passes' #1.* Maps onto
   Pandore's Trill Square via `/opsia/surface x y`. **Biggest instrument-feel upgrade available.**
   → a Surface view over the existing scene bank; the interpolation is `varyComposition`-adjacent
   (numeric params blend, structure snaps to the nearest snapshot).
2. **LZX Memory Palace** feedback (Eurorack). ✅ **BUILT** (f68d82f, 2026-08-20). *Triage correction:*
   this item first eyed the per-layer TRAIL (`persist`/`PERSIST_FS`), but the **`node-feedback` FX
   node was already a full Memory-Palace engine** — soft luma keyer (`keyMode`/`keyThresh`/`keySoft`
   + edge border), per-repeat hue drift (`hue`/`hueCurve`), a drifting off-centre zoom/rotate/self-warp
   transform, an RGB delay ring, dual-buffer COUPLE, and AGC. So the three genuinely-missing LZX moves
   went onto that node (not a duplicate engine on the trail): (a) **chroma key** — `keyMode` gains
   `key desat` / `key chroma` (saturation) beside luma black/white; (b) **process placement** — a
   `placement` long puts the spatial process on the recirculating buffer (feedback : wandering tunnel)
   or on the incoming live image (painting : source smeared into a still accumulator); (c) **sat
   drift/repeat** — a `sat` uniform nudges the buffer's saturation each pass (bleach→grey / intensify→
   neon). Verified live in an isolated GL2 FBO (compile+link + branch readbacks).
3. **Ableton Link** (peer tempo). BPM currently arrives over OSC master/slave; Link makes tempo/
   phase/start-stop **peer** across Opsia + Pandore + Phasma on the LAN (UDP multicast). Correct
   topology for the three-instrument ecology + *Espaces connectés*. Electron-main integration is
   straightforward; **check the GPLv2+ side against the project licence first.** Pairs with
   **Tempo Follower** (derive BPM from the room via the audio bus's flux/transient — the
   installation case where nothing is master).
4. **Hydra `modulate()` → cross-modulation FX.** `modulate(tex, amt)` uses one texture's R/G to
   offset another's UVs (a buffer can self-modulate). A curated *Modulation croisée* FX: any
   source displaces any other's sampling — cheaper than Transfert (no flow solve), glassy-
   refraction character rather than motion-imprint. Distinct from the convolution trio.
5. **IBFV — Image-Based Flow Visualization** (van Wijk, SIG 2002). Each frame = warped-previous
   blended with filtered noise; emulates LIC. Fed Transfert's flow field it gives **advected
   noise/dye that decays into structure, not neon** — exactly the feedback guardrail. A *Traînée*
   texture family that reads as material.
6. **Vsynth brightness-band splitter** (multiband image processing). Split the frame into luminance
   bands, process each band with its own chain, recombine. Native to the concrète-background idea,
   absent from every VJ app.
7. **Anisotropic Kuwahara** (Kyprianidis 2009) + **flow-based XDoG** (Kang/Lee/Chui). Structure-
   tensor-aligned painterly flattening (the temporally-coherent **Peint** upgrade) and edge-
   tangent-flow scratches (the **Griffé** upgrade that follows the image's own structure). The
   plates' clearest before/after (plate 11: isotropic DoG speckles → tangent-flow strokes).
8. **RoughCut idioms → HMM** (Leake et al., SIG 2017) — an *architecture* upgrade for Assemble.
   Re-cast the selector as a small **curated idiom vocabulary compiled into start/transition/
   emission weights** (exactly the S1–S4 tag-derived weighting): swap "speaker"→layer identity,
   "zoom"→scale/proximity, "emotional intensity"→audio energy. Legible + curated vs heuristic.
9. **Métrique mode** (Kubelka *Arnulf Rainer* metric film) — BPM-locked frame-count phrases with
   accelerating subdivision. Pass 2 relocated this from the Cameraless clock to **Assemble** (as
   the cutting-rate curve), merged with **BEAT** energy-elasticity (dwell from bar energy) and a
   shot-length *variation coefficient* (Salt/Cinemetrics) instead of an "ASL knob". **Hard flicker
   cap for gallery safety.**
10. **Wekinator** (Fiebrink) — a training layer ON TOP of MIDI Learn: map Pandore's continuous
    gestures (Trill XY, pressure) to the 16 Meta knobs by demonstration (regression), not by hand.
    Zero-code given the two-way OSC; thesis-defensible under *simplexité*.
11. **Synesthesia SSF pre-pass** — a tiny declarative frame-scope hook in the shader registry (a TS
    function returning uniforms, run each frame before the shader) so you can author frame-aware
    shaders without a full native-node class each time. An authoring-architecture refinement.
12. **Hydra networked topology** (WebRTC peer layer exchange) — the P2P variant of HIVE-in/out;
    makes *Espaces connectés #3* literal (several Opsia instances trading layers).

## C. Citation / thesis material (not features)

Levin's slit-scan catalogue · Crutchfield "Space-Time Dynamics in Video Feedback" (Physica D 1984,
also on Hydra's reading list — could name a Feedback World whose states are fixed-point/periodic/
chaotic) · *Live Visuals: History, Theory, Practice* (Routledge 2022 — the missing instrument half
of the bibliography beside Chion→Coulter→Basanta→Boucher) · vOICe (IEEE TBME 1992) + the reversed-
mapping study (npj 2026, licenses arbitrary mappings) + the sonification taxonomy (audification /
parameter-mapping / model-based — a vocabulary for Sonify's modes) · Cinemetrics/Salt + Redfern's
ASL critique · the "what reads as edited" study (spend Assemble's effort on rhythm + inter-shot
coherence, not transitions; steal EDL/XML export to finish in an NLE).

**The one conceptual reframe worth writing into the Sonify/Cameraless spec even if nothing is
built: Oramics.** Oram's marks are **control curves, not waveforms** — which is exactly Opsia's
Sonify→Pandore OSC path. It reframes Sonify from "image makes sound" to "image *draws control*",
and completes §4.4 (animated sound) of the Cameraless spec without Opsia synthesising audio at all.

---

## If building three

**Metasurface** (playability) · **Memory Palace feedback keyer+placement** (depth from existing
code) · **Ableton Link** (fixes the topology of the whole instrument ecology). Plus the **Oramics
reframe** as a one-paragraph spec note.
