# Third-party notices and credits

Palinopsia is built by Vincent Fillion. It is also built on other people's work: code,
shaders, programs, models, fonts, textures, research and ideas. **This file lists all of
it.** Every entry names its authors and its license. When a license asks for its text to
travel with the work, that text is here or in [`licenses/`](licenses/). A copy of this
file and of `licenses/` ships inside every build, beside the app.

Palinopsia itself is GPL-3.0-or-later ([LICENSE](LICENSE)), with the section 7
permission in [LICENSE-EXCEPTIONS.md](LICENSE-EXCEPTIONS.md). All the licenses below are
compatible with it: MIT, BSD, ISC, Boost, Apache-2.0, LGPL, GPL, OFL and CC0. The one
exception is the dataflou visualizer, which ships with its author's permission.

**The rule.** Whatever comes from someone else gets its entry here in the same commit that
brings it in. That covers code, shaders, an algorithm ported line by line, a binary, a
model, a font, an image, a sound or data. The code where it is used carries a comment
`third-party: <entry name>`. An idea or a published method that shaped a feature is
credited too (Part 6), even when no code was taken. Nothing whose license we cannot read,
or that does not allow this use, goes in.

`npm run check:notices` checks that this file stays complete. CI runs it on every
build, and it fails when:
- a dependency, font or shipped folder has no entry;
- a `third-party:` tag names something missing from this file;
- a file carries someone else's copyright line or a Shadertoy link without a tag.

After a dependency change, run `npm run notices` to regenerate the npm list.

**Contents**
1. Code inside Palinopsia
2. Programs, runtimes and libraries shipped with it
3. Models and the data they were trained on
4. Fonts
5. Images, textures and media
6. Ideas, methods and research (no code taken)
7. License texts

---

## 1. Code inside Palinopsia

Code that is compiled into Palinopsia, or that was copied, ported or adapted into its
source. For the MIT entries, the full MIT permission notice is at the end of this part.

### Ableton Link (`native/link/sdk/link`)

The Ableton Link addon compiles the Ableton Link SDK (Link-4.1.1,
https://github.com/Ableton/link) into Palinopsia.

- Copyright 2016, Ableton AG, Berlin. GNU General Public License version 2 or
  (at your option) any later version (`native/link/sdk/link/LICENSE.md`).
  Palinopsia uses it under version 3 or later, its own license.
- Ableton Link is a trademark of Ableton AG. The app names it as Ableton's integration
  guidelines ask.

### asio (`native/link/sdk/asio`)

asio 1.38.2 (standalone) is the networking library Ableton Link is built on. Copyright (c)
2003-2025 Christopher M. Kohlhoff. Boost Software License 1.0
(`native/link/sdk/asio/LICENSE_1_0.txt`).

### Spout2 (`native/spout/sdk`)

The Windows texture sharing (the Spout sender and receiver) compiles the Spout2 SDK sources
(https://github.com/leadedge/Spout2) into `spout.node`. Copyright (c) 2014-2024, Lynn
Jarvis (2014-2025 across its files); `SpoutCommon.h` credits Malcolm Bechard (https://github.com/mbechard). BSD
2-Clause License. Each SDK file carries the notice, and its text is in
[`licenses/Spout2-License.txt`](licenses/Spout2-License.txt). Spout is Lynn Jarvis' and
Leading Edge's project (https://spout.zeal.co).

### Syphon (Syphon-Framework)

The macOS texture sharing (the Syphon sender and client) loads the Syphon framework
(https://github.com/Syphon/Syphon-Framework, commit f4761677), built from source by
`native/syphon/build.sh` and shipped next to `syphon.node`. Copyright 2010 bangnoise (Tom
Butterworth) & vade (Anton Marini). BSD 2-Clause-style license, whose text is in
[`licenses/Syphon-Framework-License.txt`](licenses/Syphon-Framework-License.txt).

### Holocloth (`src/renderer/src/engine/drapeNode.ts`, `reliefShade.ts`)

Two features are adapted from **Holocloth** (https://github.com/dmitrykurash/holocloth),
Copyright (c) 2026 Dmitry Kurash, MIT License:
- Drape's cloth: a Verlet cloth with structural, shear and bend constraints at a fixed
  1/120 s step, with its constraint layout and weights, its grab and its fold occlusion.
- The foil finish of Relief, Inflate and Drape: micro-flakes, and a diffraction hue that
  follows the tilt.

### VIDVOX VHS Glitch (`src/renderer/src/shaders/isf/fx/Tracking.fs`)

The Tracking effect's set of features follows the ISF shader "VHS Glitch", converted by
David Lublin / VIDVOX, from the ISF-Files repository (https://github.com/Vidvox/ISF-Files).
Copyright (c) 2018 VIDVOX, MIT License. The features it shares with that shader are:
- a wandering freeze line;
- a per-line analog x-distortion;
- a tinted red chroma bleed.

VIDVOX's shader is itself based on Staffan Widegarn Åhlvik's "unity-vhsglitch"
(https://github.com/staffantan/unity-vhsglitch), which is under the Creative Commons
Attribution 3.0 Unported License. Since v1.3.4 the code of these features is Palinopsia's
own, and none of either shader's lines remain:
- the freeze line wanders on smooth value noise and holds its upper edge;
- the bleed is a one-sided exponential chroma tail;
- the tints and the drift are new.

Both works are credited here for the model they gave.

### BENDR (`src/renderer/src/engine/convNodes.ts` : the Melt node)

BENDR is a circuit-bent video processor in the browser, by Steve Blythe
(https://github.com/clickysteve/bendr). Copyright (c) 2026 Steve Blythe, MIT License.
- **The Melt node** (`F_MELT`, `MeltNode`) is adapted from BENDR's melting edge: an edge
  band and its normal, the node's own last frame dissolved back inside the band, and the
  creep.
- **Ideas only, no code taken:**
  - the NTSC effect;
  - Faultline (BENDR's dirty mixer);
  - the panic flush (key 0);
  - the Datamosh node's mosh gate, edge repel and re-sharp. The node was rewritten
    clean-room in v1.3.4; earlier versions adapted these three from BENDR's code.

### Hash without Sine (many shaders)

The hash functions used across the generators, effects and native nodes come from
**David Hoskins' "Hash without Sine"** (https://www.shadertoy.com/view/4djSRW). They are
`hash12`, `hash13`, `hash22` and their inlined forms, recognisable by the `.1031` and
`33.33` constants. Copyright (c) 2014 David Hoskins, MIT License.

### Inigo Quilez, gradient noise with derivatives (`src/renderer/src/shaders/isf/lib/organic.glsl`)

`og_noised`, gradient noise with its analytic derivatives, follows Inigo Quilez's "Noise -
Gradient - 2D - Deriv" (https://www.shadertoy.com/view/XdXBRH,
https://iquilezles.org/articles/gradientnoise). Its hash is replaced by Hoskins'.
Copyright © 2017 Inigo Quilez, MIT License.

### Inigo Quilez, Voronoi border distance (`organic.glsl`)

`og_voronoi`, the two-pass exact distance to a Voronoi cell's border, follows Inigo
Quilez's "Voronoi - distances" (https://www.shadertoy.com/view/ldl3W8,
https://iquilezles.org/articles/voronoilines). Copyright © 2013 Inigo Quilez, MIT License.

### Inigo Quilez, heart distance (`fx/Transform.fs`, `src/renderer/src/engine/outputShape.ts`)

`sdHeart`, the exact signed distance to a heart, follows Inigo Quilez's 2D distance
functions (https://iquilezles.org/articles/distfunctions2d). Copyright © Inigo Quilez. MIT
License: his site states that his code which implements an algorithm is under the MIT
license.

### Mikkelsen hex tiling (`src/renderer/src/shaders/isf/Scan.fs`)

The hex-tiling lattice in `hexTri` (its skewed triangle grid, vertex positions and blend
weights) follows Morten S. Mikkelsen's reference implementation, hextile-demo
(https://github.com/mmikk/hextile-demo). The paper behind it is "Practical Real-Time
Hex-Tiling", *Journal of Computer Graphics Techniques* 11(2), 2022. Copyright (c) 2022
mmikk (Morten S. Mikkelsen), MIT License.

### Chris Wilson PitchDetect (`src/renderer/src/engine/audioIn.ts`)

`autoCorrelate` is the autocorrelation pitch detector with RMS gate and parabolic
interpolation. It is adapted from Chris Wilson's PitchDetect
(https://github.com/cwilso/PitchDetect). Copyright (c) 2014 Chris Wilson, MIT License.

### The Sonify Synth's engines (`src/renderer/src/audio/synth.engine.js`)

The Synth voice's sound engine ports parts of the MIT-licensed works below. Each block
carries a short credit comment where it is used.

- **jx-move** by Vincent Fillion (Copyright (c) 2026 Filliformes), MIT License:
  - the DCO pair with exact-event BLEP / BLAMP residuals, hard sync and the cross-clocked
    "metal" mode;
  - the IR3109-style 4-pole ladder;
  - the BBD chorus (I and II), its filters and output mix;
  - the non-resonant HPF, the output knee, and mono / unison note priority.
- **aphex-move** by Vincent Fillion (Copyright (c) 2026 Filliformes), MIT License: the VCO
  shapes and ring modulator of the ms engine, its pink noise, the Korg-35 style HP / LP
  filter pair (`k35.h`), the drift design (`drift.h`) and the linear release.
- **essaim-move** by Vincent Fillion (Copyright (c) 2026 fillioning), MIT License: the
  swarm voice. It uses self-retriggering oscillators (sine → triangle → saw → square) and
  a state-variable filter per oscillator, drawn 50 / 30 / 20 low / band / high.
- **schwung-hank** by Charles Vestal (charlesvestal/schwung-hank), MIT License. The license
  is stated in its README and source headers; the repository ships no LICENSE file. Taken
  from it: the 2-operator FM macro layer, its ratio list, the index and feedback laws, the
  modulator envelope coupled to the carrier's (2.2x shorter decay, a 0.30 sustain floor),
  the index rolloff above 7 kHz and the bite shaper.
- **schwung-quark** (james-fish/schwung-quark, Copyright (c) 2026 James Fish), MIT License:
  the control-rate ramps, the first-order ADAA soft-clip drive, the morphing SVF's
  LP → BP → HP weights, and the dual band-pass vowel pair.
- **crest** (klaine/crest, Copyright (c) 2026 Klaine), MIT License: per-sample shape and
  density smoothing, the detuned density copies, the 4-point polyBLEP form and the
  saturating band-pass state of the SVF.
- **TinyPro5** (fleshinachair/TinyPro5, Copyright (c) 2026 Mathew Taylor), MIT License: the
  three-band 1/f drift walk and the self-oscillation seeding.

The rest of the engine is built from published methods (Part 6). klaine/amino and
klaine/bizar were read for reference; no code is taken from them.

### datamoshing-GLSL and transflow (`src/renderer/src/engine/convNodes.ts`, the Datamosh node)

- **datamoshing-GLSL** by Alexandre Rivaux (https://github.com/alexr4/datamoshing-GLSL),
  GPL-3.0: the GPU optical-flow approach the Datamosh node's flow pass starts from.
- **transflow** by Yohan Chalier (https://github.com/ychalier/transflow), GPL-3.0: the
  Datamosh node's sticky and melt modes and its stochastic reseed.

### FFmpeg dxvenc (`src/renderer/src/engine/dxvFrame.ts`)

The DXV writer's op-word layout follows FFmpeg's `libavcodec/dxvenc.c` (PUSH_OP): a fresh op
word goes in before the op's own offset bytes. FFmpeg is Copyright (c) the FFmpeg
developers (https://ffmpeg.org), and `dxvenc.c` is under the GNU Lesser General Public
License version 2.1 or later ([`licenses/LGPL-2.1.txt`](licenses/LGPL-2.1.txt)).

### Self-Organising Textures notebook (`tools/nca/train_texture_nca.py`)

The offline trainer for the Grown generator's textures follows the reference PyTorch
notebook `texture_nca_pytorch.ipynb` from google-research/self-organising-systems
(https://github.com/google-research/self-organising-systems). Copyright Google LLC, Apache
License 2.0 ([`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt)). The method is credited in
Part 6.

### The dataflou mesh visualizer (`resources/dataflou-visualizer`)

The dataflou section's **visualizer** button opens the dataflou project's own web
visualizer, by **Alexandre Burton** (Artificiel). It is built from its repository (`web/`,
commit 4561df8 of 2026-11-03) by `scripts/build-dataflou-visualizer.mjs`, without its
Atelier editor panel. Palinopsia serves it (`src/main/dataflou/visualizer.ts`), but it is
not part of Palinopsia's own code and not under its license. It is included with its
author's permission (2026-11-07), and all rights remain with its author.

- **d3** 7.9.0 (`resources/dataflou-visualizer/lib/d3.v7.min.js`, https://d3js.org),
  Copyright 2010-2023 Mike Bostock. ISC License:

  > Copyright 2010-2023 Mike Bostock
  >
  > Permission to use, copy, modify, and/or distribute this software for any purpose
  > with or without fee is hereby granted, provided that the above copyright notice
  > and this permission notice appear in all copies.
  >
  > THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
  > REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
  > FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
  > INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
  > OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
  > TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR
  > PERFORMANCE OF THIS SOFTWARE.

### The MIT License

Every MIT entry above (and in Part 2) is licensed under these terms, each with the
copyright line given in its entry:

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.
>
> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

---

## 2. Programs, runtimes and libraries shipped with it

### FFmpeg (the ffmpeg-static binary)

Recording, the delivery formats, Assemble's renders and video conversion run the **FFmpeg**
program (https://ffmpeg.org), Copyright (c) the FFmpeg developers.
- **What ships.** The binary comes from the **ffmpeg-static** package
  (https://github.com/eugeneware/ffmpeg-static, its release `b6.1.1`: FFmpeg 6.1.1). It
  sits unpacked beside the app in `node_modules/ffmpeg-static`, with the license file its
  builder supplies.
- **Who built it.** gyan.dev on Windows, John Van Sickle on Linux, osxexperts.net on Apple
  Silicon.
- **License.** These builds include x264 (VideoLAN) and x265 (MulticoreWare), so they are
  under the **GNU General Public License version 3**. Its text is Palinopsia's own
  [LICENSE](LICENSE).
- **Source code.** The source of FFmpeg 6.1.1 is at https://ffmpeg.org/releases/ (the
  `ffmpeg-6.1.1` tarball), and each builder publishes its build configuration on its
  site. On request, for three years from each Palinopsia release, Vincent Fillion will
  send the complete corresponding source of the FFmpeg binary shipped with that release
  (contact: see `package.json`).
- **Codec patents.** H.264 (x264) and HEVC (x265) are covered by patents in some
  countries. Palinopsia uses them only to write the file you ask for, on your own machine.
  If you distribute what you encode commercially, check what applies where you live.

### MediaPipe Tasks Vision (`resources/mediapipe`)

The Body page's pose, hands and face trackers, and the Silhouette source and effect, run
**MediaPipe Tasks Vision** (`@mediapipe/tasks-vision` 0.10.22-rc.20250304: `vision_bundle.js`
and its `wasm/`, https://github.com/google-ai-edge/mediapipe). Copyright Google LLC.
Apache License 2.0; the full text ships as `resources/mediapipe/LICENSE`. Its models are in
Part 3.

### The Room tracker runtime (`resources/pose`)

The Body page's **Room** tracker (the pose of everyone in the frame) runs **ONNX Runtime
Web** 1.30.0 (https://github.com/microsoft/onnxruntime). The files are
`ort.webgpu.min.mjs`, `ort-wasm-simd-threaded.asyncify.mjs` and `.wasm`. Copyright (c)
Microsoft Corporation, MIT License; the full text ships as
`resources/pose/licenses/onnxruntime-web-LICENSE.txt`.

These files and the model in Part 3 ship inside every build, in `resources/pose`.
`npm run fetch:pose` (`scripts/fetch-pose.mjs`) fetches them pinned and hash-checked;
they are not in the git repository.

### The AI depth engine (`resources/depth`)

**depth: AI** (the Performance tab's picture section) runs:
- **Transformers.js** 3.0.2 (`transformers.min.js`,
  https://github.com/huggingface/transformers.js), Copyright Hugging Face. Apache License
  2.0; the full text ships as `resources/depth/licenses/transformers.js-LICENSE.txt`. Its
  browser build bundles onnxruntime-web and onnxruntime-common (MIT, below) and
  @huggingface/jinja (MIT, Hugging Face).
- **ONNX Runtime Web** 1.21.0-dev.20241024-d9ca84ef96 (its JavaScript, inside
  `transformers.min.js`, and `ort-wasm-simd-threaded.jsep.wasm`). Copyright (c) Microsoft
  Corporation, MIT License (text in Part 1).

These ship inside every build, in `resources/depth`. `npm run fetch:depth`
(`scripts/fetch-depth.mjs`) fetches them pinned and hash-checked; they are not in the git
repository.

### The NDI® runtime (`resources/ndi`)

The NDI® runtime is not part of Palinopsia. When a build carries it, it is Vizrt's library
under Vizrt's own license; see [LICENSE-EXCEPTIONS.md](LICENSE-EXCEPTIONS.md). NDI® is a
registered trademark of Vizrt NDI AB.

### Electron and Chromium

Palinopsia runs on **Electron** (https://www.electronjs.org, MIT, Copyright (c) Electron
contributors and GitHub Inc.) and the **Chromium** browser engine it embeds. Every build
carries their notices: `LICENSE.electron.txt` and `LICENSES.chromium.html`, beside the
app.

### npm packages

The JavaScript libraries bundled into the app include:
- React (MIT, Meta Platforms);
- CodeMirror (MIT, Marijn Haverbeke and others);
- zustand, osc.js, ws, interactive-shader-format, multicast-dns, bonjour-service and koffi;
- their own dependencies.

Each one is listed with its version, license and full license file in
[`licenses/npm-dependencies.txt`](licenses/npm-dependencies.txt). That file is generated
from `package-lock.json` by `npm run notices`. The app's styles are generated by Tailwind
CSS (MIT, Tailwind Labs), whose base styles include modern-normalize (MIT, Sindre
Sorhus).

---

## 3. Models and the data they were trained on

- **MediaPipe models** (`resources/mediapipe/models/*.task`): the Pose Landmarker (lite),
  Hand Landmarker and Face Landmarker. Copyright Google LLC, Apache License 2.0.
- **RTMO-s** (`resources/pose/models/rtmo-s.onnx`: `rtmo-s_8xb32-600e_body7-640x640`):
  - **Source.** The ONNX export OpenMMLab publishes on download.openmmlab.com, from
    **MMPose** (https://github.com/open-mmlab/mmpose). Copyright 2018-2020 Open-MMLab.
  - **License.** Apache License 2.0; the full text ships as
    `resources/pose/licenses/mmpose-LICENSE.txt`.
  - **Paper.** Peng Lu et al., "RTMO: Towards High-Performance One-Stage Real-Time
    Multi-Person Pose Estimation", CVPR 2024.
  - **Training data ("body7").** Its weights were trained on seven public pose datasets:
    COCO, AI Challenger, CrowdPose, MPII, sub-JHMDB, Halpe and PoseTrack18. We thank
    their authors and the people photographed in them. Some of these datasets carry
    their own terms of use, which restrict them to research. The model's authors
    published the weights under Apache-2.0, and Palinopsia ships them unchanged.
- **Depth Anything V2 Small** (`resources/depth/models/onnx-community/depth-anything-v2-small`):
  - **Source.** The ONNX conversion by onnx-community (revision 4472b736) of
    https://huggingface.co/depth-anything/Depth-Anything-V2-Small.
  - **Paper.** "Depth Anything V2", Lihe Yang et al., 2024.
  - **License.** Apache License 2.0. Its model card ships as
    `resources/depth/licenses/depth-anything-v2-small-README.md`. Only the Small model is
    Apache-2.0 (the larger Depth Anything V2 models are not), and only Small ships.
- **The Grown generator's textures** (`src/renderer/public/nca/*.bin`). Palinopsia trained
  these small networks itself with `tools/nca`, on the ambientCG scans of Part 5 (CC0).
  The training loss reads the scans through VGG16 (torchvision, BSD-3-Clause, with its
  ImageNet weights). Nothing of VGG16 ships; only the 5,856 weights of each automaton do.

---

## 4. Fonts

The Text generator and the interface ship 62 font files (`src/renderer/src/fonts`):
- 60 are under the **SIL Open Font License 1.1** ([`licenses/OFL-1.1.txt`](licenses/OFL-1.1.txt));
- Permanent Marker and Special Elite are under the **Apache License 2.0**.

Each file's family, copyright line and license are listed in
[`licenses/fonts.txt`](licenses/fonts.txt). Thanks to their designers and to the
Google Fonts and Fontsource projects that publish them.

---

## 5. Images, textures and media

- **ambientCG material scans** (`src/renderer/public/pbr`): 30 material sets (color,
  height, normal and ambient occlusion) from ambientCG (https://ambientcg.com), by Lennart
  Demes, in the public domain under **CC0 1.0**. No attribution is required; we give it
  anyway.
- **The documentation images** (`docs/images`) are frames and screenshots of Palinopsia.
  `visual-collage.jpg` is the Collage source playing clips taken from free stock-footage
  sites and the Internet Archive, each under its own license (public domain, CC0 or the
  site's free license).
- **The app icon** (`build/icon.*`) is Palinopsia's own.

---

## 6. Ideas, methods and research (no code taken)

These works shaped features without any of their code being taken. Ideas and published
methods are free to build on; naming them is a matter of respect.

- **Orb** (MIT): splitting red, green and blue more toward the rim of a glass shape, used
  in Inflate's glass dispersion (`inflateNode.ts`).
- **Paper Shaders** (https://github.com/paper-design/shaders, https://shaders.paper.design,
  Apache License 2.0), its `liquid-metal` shader: red, green and blue reading one set of
  moving bands a little apart, so their edges split into color. Used in the flowing metal
  of `reliefShade.ts`; Palinopsia's bands are its own, driven by the real surface's
  reflection.
- **Aural Mirror** by Remo DeVico
  (https://www.remodevicocomposer.eu/experimental-tools/aural-mirror/), an instrument that
  turns a painting into sound and musical structure. Four machines read the same picture
  at once, and four of Sonify's voices follow the same division of labour:
  - its **Spectral** layer (the picture read as a spectrogram) → Sonify's Spectra;
  - its **Events** layer (edges and strokes, each played as its own sound with an attack
    and a decay) → Events;
  - its **Additive** layer (scale-tuned oscillators, one per band, following the ink) →
    Chord and its Chord bank (`sonify.ts`);
  - its **Granular** layer (grains whose sound comes from the picture's colours) → Flow
    and its colour-steered grain timbre.
  - its circular and spiral **reading paths** → the radial and spiral paths and the
    breathing sweep of Spectra and Filter.

  These were designed after Aural Mirror on 2026-08-25. Each was implemented
  independently, and no code was taken from it.
- **The image-to-sound lineage** named beside Spectra: Evgeny Murzin's **ANS**
  photoelectronic synthesizer (1958), **MetaSynth** (Eric Wenger, U&I Software) and
  Peter Meijer's **The vOICe** (1992).
- **Torso Electronics' S-4** sculpting sampler: the idea of ringing a sound through a bank
  of resonant band-passes tuned to a key, behind the Collage voice's Ring bank. No code
  taken.
- **unity-vhsglitch** by Staffan Widegarn Åhlvik and VIDVOX's **VHS Glitch**: the model of
  the Tracking effect (Part 1).
- **ffglitch** (Ramiro Polla, https://ffglitch.org; ffglitch-core LGPL-2.1+ / GPL-2+,
  ffglitch-scripts Unlicense) and **Datamosher-Pro** (Akash Bora,
  https://github.com/Akascape/Datamosher-Pro, MIT). Behind the Datamosh node:
  - motion vectors averaged, rotated and reversed;
  - the bloom fired by hand or on a pulse;
  - the triggerable glitch family.

  No code was taken.
- **Nuvotion** (Nuvotion Visuals' web VJ app): the XY pads over the Macro knobs.
- **Tixl** (https://github.com/tixl3d/tixl, MIT) and **nw_wrld**
  (https://github.com/aagentah/nw_wrld, GPL-3.0): the light output and the installation
  mode. No code taken.
- **LZX Industries**, with no code taken:
  - Videomancer's generative operators, behind the Euclid, Turing and Cellular
    modulators;
  - Memory Palace's feedback, behind the Feedback node's chroma key, placement and
    saturation drift;
  - the ramp generators and colorizers (Ramps, Colorizer).
- **The Turing Machine** by Tom Whitwell, Music Thing Modular
  (https://github.com/TomWhitwell/TuringMachine): the looping shift register whose bits flip
  by chance, behind the Turing modulator. Idea only.
- **EYESY** by Critter & Guitari (https://github.com/critterandguitari/EYESY_Modes_OSv3,
  BSD-2-Clause): the reseed gesture and per-element audio, in Ten Print, Slabs, Grid
  Drift, Shapes, Filaments and Ash. Ideas only.
- **SpatGRIS** (GRIS, Université de Montréal, https://github.com/GRIS-UdeM/SpatGRIS,
  GPL-3.0): its OSC and speaker-setup format, read so Space can talk to it. No code.
- **VBAP and MDAP** (`shared/spatial.ts`): V. Pulkki, "Virtual sound source positioning
  using vector base amplitude panning", *JAES* 45(6), 1997; V. Pulkki, "Uniform spreading
  of amplitude panned virtual sources", IEEE WASPAA, 1999.
- **The ideas behind early effects**, with no code taken:
  - Signal Culture's apps, Lumen and Cathodemer;
  - cacheflowe's haxademic (its pseudo pixel-sort, behind Smear);
  - exeldro's obs-shaderfilter (behind Scanlines);
  - libretro's common-shaders (behind Dither);
  - Hydra (the fused passes);
  - the visual work of Norman McLaren, John Whitney, Stan Brakhage, Bridget Riley, Victor
    Vasarely and Jesús Rafael Soto.
- **The Sonify Synth's published methods**, built from the sources, not from code:
  - the complex one-pole modal bank (M. Mathews and J. O. Smith, "Methods for
    synthesizing very high Q parametrically well behaved two pole filters", 2003);
  - the vowel formants (G. E. Peterson and H. L. Barney's 1952 averages for F1 to F3);
  - the string (Karplus and Strong, with Lagrange fractional delay and first-order
    allpass dispersion);
  - the topology-preserving filters (V. Zavalishin, "The Art of VA Filter Design");
  - antiderivative anti-aliasing for the wavefolder and the shapers (J. D. Parker, V.
    Zavalishin and E. Le Bivic, 2016);
  - the Kaiser-windowed halfband of the 2x drive.
- **The Sonify reverb** (`FDNReverb` in `soni.worklet.js`, the Nappe and Strates modes), written
  for Palinopsia in v1.3.4 from the published methods alone, with every length, gain law and
  constant its own:
  - the allpass section (M. R. Schroeder, "Natural sounding artificial reverberation", *JAES*
    10(3), 1962);
  - delay lines fed back through an orthogonal matrix, with several outputs for a stereo
    image (J. Stautner and M. Puckette, "Designing multi-channel reverberators", *Computer
    Music Journal* 6(1), 1982);
  - the lossless prototype and its per-line absorbent filters (J.-M. Jot and A. Chaigne,
    "Digital delay networks for designing artificial reverberators", AES 90th Convention,
    preprint 3030, 1991);
  - modulated tank delays and allpass diffusers inside the loop (J. Dattorro, "Effect Design,
    Part 1: Reverberator and other filters", *JAES* 45(9), 1997);
  - the choice of the Hadamard matrix and mutually prime lengths (V. Välimäki, J. D. Parker,
    L. Savioja, J. O. Smith and J. S. Abel, "Fifty years of artificial reverberation",
    *IEEE TASLP* 20(5), 2012).
- **Self-organising textures**: E. Niklasson, A. Mordvintsev, E. Randazzo and M. Levin,
  "Self-Organising Textures", *Distill*, 2021 (the Grown generator).
- **Hex-tiling**: M. S. Mikkelsen, "Practical Real-Time Hex-Tiling", *JCGT*, 2022 (Scan).
- **Interleaved gradient noise**: J. Jimenez, "Next Generation Post Processing in Call of
  Duty: Advanced Warfare", SIGGRAPH 2014 (dithering in Smear, Streak, Context and Solid
  Color).
- **Blackbody colour fit**: Tanner Helland's published approximation of a blackbody's
  colour by temperature (`organic.glsl`).
- **HIVE** (https://codeberg.org/gllm/HIVE): the protocol Palinopsia's HIVE client
  (`hive.ts`) speaks to exchange streams with HIVE peers.
- **Corpus-based selection**: Diemo Schwarz's CataRT model (Assemble's matching), and VIVO
  and Dimopoulos & Winkler's per-pixel warmness (Assemble's analysis).
- **The research behind the instrument**: every paper, book, thesis and talk Palinopsia
  draws on is listed, with what it shaped, in [docs/bibliography.md](docs/bibliography.md).
  That includes the theses of Corbeil-Perron, Boucher and Basanta, whose ideas the
  audiovisual-relations layer builds on.

---

## 7. License texts

| file | for |
|---|---|
| [LICENSE](LICENSE) | Palinopsia (GPL-3.0); also FFmpeg's GPL-3.0 builds, Rivaux's and Chalier's GPL-3.0 works |
| [`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt) | the Apache-2.0 entries (MediaPipe, MMPose / RTMO, Transformers.js, Depth Anything V2 Small, the NCA notebook, Permanent Marker, Special Elite) |
| [`licenses/OFL-1.1.txt`](licenses/OFL-1.1.txt) | the OFL fonts |
| [`licenses/LGPL-2.1.txt`](licenses/LGPL-2.1.txt) | FFmpeg's dxvenc |
| [`licenses/Spout2-License.txt`](licenses/Spout2-License.txt) | Spout2 |
| [`licenses/Syphon-Framework-License.txt`](licenses/Syphon-Framework-License.txt) | Syphon |
| [`licenses/fonts.txt`](licenses/fonts.txt) | each font's copyright line and license |
| [`licenses/npm-dependencies.txt`](licenses/npm-dependencies.txt) | each npm package's license file (generated) |
| `native/link/sdk/link/LICENSE.md`, `native/link/sdk/asio/LICENSE_1_0.txt` | Ableton Link (GPL-2.0-or-later), asio (Boost) |
| `resources/*/LICENSE`, `resources/*/licenses/` | the license files shipped with each runtime and model |
| Part 1 above | the MIT and ISC texts |
