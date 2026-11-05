# Third-party notices

Palinopsia includes code derived from the third-party works listed below. Their
authors and licenses are credited here rather than in the app's on-screen text.

## Ableton Link (`native/link/sdk/link`)

The Ableton Link addon compiles the Ableton Link SDK (Link-4.1.1,
https://github.com/Ableton/link) into Palinopsia.

- Copyright 2016, Ableton AG, Berlin. GNU General Public License version 2 or
  (at your option) any later version (`native/link/sdk/link/LICENSE.md`).
  Palinopsia uses it under version 3 or later, its own license.
- Ableton Link is a trademark of Ableton AG, named in the app as its
  integration guidelines ask.

## asio (`native/link/sdk/asio`)

The networking library Ableton Link is built on, asio 1.38.2 (standalone),
Copyright (c) 2003-2025 Christopher M. Kohlhoff. Boost Software License 1.0
(`native/link/sdk/asio/LICENSE_1_0.txt`).

## The AI depth engine (`resources/depth`)

**depth: AI** (the Performance tab's picture section) runs the works below. They ship inside every build in
`resources/depth`, fetched pinned and hash-checked by `npm run fetch:depth`
(`scripts/fetch-depth.mjs`); they are not in the git repository. Apache-2.0 and
MIT works may be conveyed inside a GPL-3.0 work (the Apache License 2.0 is
compatible with version 3 of the GPL), so they sit within Palinopsia's own
GPL-3.0-or-later.

- **Transformers.js** 3.0.2 (`transformers.min.js`,
  https://github.com/huggingface/transformers.js), Copyright Hugging Face.
  Apache License 2.0 : the full text ships as
  `resources/depth/licenses/transformers.js-LICENSE.txt`. Its browser build
  bundles onnxruntime-web and onnxruntime-common (MIT, below) and
  @huggingface/jinja (MIT, Hugging Face).
- **ONNX Runtime Web** 1.21.0-dev.20241024-d9ca84ef96 (its JavaScript, inside
  `transformers.min.js`, and `ort-wasm-simd-threaded.jsep.wasm`,
  https://github.com/microsoft/onnxruntime), MIT License :

  > Copyright (c) Microsoft Corporation
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy
  > of this software and associated documentation files (the "Software"), to deal
  > in the Software without restriction, including without limitation the rights
  > to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  > copies of the Software, and to permit persons to whom the Software is
  > furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in
  > all copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  > IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  > FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  > AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  > LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  > OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  > SOFTWARE.
- **Depth Anything V2 Small** (the model, `models/onnx-community/depth-anything-v2-small` :
  the ONNX conversion by onnx-community, revision 4472b736, of
  https://huggingface.co/depth-anything/Depth-Anything-V2-Small, from "Depth
  Anything V2", Lihe Yang et al., 2024). Apache License 2.0 (its model card ships
  as `resources/depth/licenses/depth-anything-v2-small-README.md`; the license text
  is the Apache License 2.0 above). Only the Small model is Apache-2.0 (the larger
  Depth Anything V2 models are not), and only Small ships.

## Tracking effect (`src/renderer/src/shaders/isf/fx/Tracking.fs`)

The Tracking FX is rebuilt on the ISF shader "VHS Glitch" (the wandering freeze
line, the analog x-distortion and the tinted chroma bleed follow its model).

- "VHS Glitch" ISF conversion by David Lublin / VIDVOX, from the ISF-Files
  repository (https://github.com/Vidvox/ISF-Files), MIT License.
- Based on "unity-vhsglitch" by Staffan Widegarn Åhlvik
  (https://github.com/staffantan/unity-vhsglitch), licensed under the Creative
  Commons Attribution 3.0 Unported License
  (https://creativecommons.org/licenses/by/3.0/).

## Flowing metal (`src/renderer/src/engine/reliefShade.ts`)

The idea of red, green and blue reading one set of moving bands a little apart, so their edges
split into color, comes from the `liquid-metal` shader of Paper Shaders
(https://github.com/paper-design/shaders, https://shaders.paper.design), Apache License 2.0. No
code was copied : Palinopsia's bands are its own, driven by the real surface's reflection.

## "Hash without Sine" (many shaders)

The hash functions used across the generators, effects and native nodes
(`hash12`, `hash13`, `hash22` and their inlined forms, recognisable by the
`.1031` and `33.33` constants) are David Hoskins' "Hash without Sine"
(https://www.shadertoy.com/view/4djSRW), MIT License, Copyright (c) 2014
David Hoskins.

## The Sonify Synth's engines (`src/renderer/src/audio/synth.engine.js`)

The Synth voice's sound engine ports parts of the MIT-licensed works below
(each block carries a short credit comment where it is used); MIT works may be
conveyed inside Palinopsia's GPL-3.0-or-later.

- **jx-move** by Vincent Fillion (Copyright (c) 2026 Filliformes), MIT License :
  the DCO pair with exact-event BLEP / BLAMP residuals, hard sync and the
  cross-clocked "metal" mode; the IR3109-style 4-pole ladder; the BBD
  chorus (I and II), its filters and output mix; the non-resonant HPF; the
  output knee; mono / unison note priority.
- **aphex-move** by Vincent Fillion (Copyright (c) 2026 Filliformes), MIT
  License : the VCO
  shapes and ring modulator of the ms engine, its pink noise, the Korg-35 style
  HP / LP filter pair (`k35.h`), the drift design (`drift.h`) and the linear
  release.
- **essaim-move** by Vincent Fillion (Copyright (c) 2026 fillioning), MIT
  License : the swarm
  voice (self-retriggering oscillators, sine → triangle → saw → square, a
  state-variable filter per oscillator drawn 50 / 30 / 20 low / band / high).
- **schwung-hank** by Charles Vestal (charlesvestal/schwung-hank), MIT License
  (stated in its README and source headers; it ships no LICENSE file) : the 2-operator FM
  macro layer, its ratio list, the index and feedback laws, the modulator
  envelope coupled to the carrier's (2.2x shorter decay, a 0.30 sustain floor),
  the index rolloff above 7 kHz and the bite shaper.
- **schwung-quark** (james-fish/schwung-quark, Copyright (c) 2026 James Fish),
  MIT License : the
  control-rate ramps, the first-order ADAA soft-clip drive, the morphing SVF's
  LP → BP → HP weights, the dual band-pass vowel pair.
- **crest** (klaine/crest, Copyright (c) 2026 Klaine), MIT License :
  per-sample shape and density smoothing, the detuned density copies, the
  4-point polyBLEP form and the saturating band-pass state of the SVF.
- **TinyPro5** (fleshinachair/TinyPro5, Copyright (c) 2026 Mathew Taylor), MIT
  License : the three-band
  1/f drift walk and the self-oscillation seeding.

Each of them is licensed under these terms :

  > Permission is hereby granted, free of charge, to any person obtaining a copy
  > of this software and associated documentation files (the "Software"), to deal
  > in the Software without restriction, including without limitation the rights
  > to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  > copies of the Software, and to permit persons to whom the Software is
  > furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in
  > all copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  > IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  > FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  > AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  > LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  > OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  > SOFTWARE.

The rest is built here from published methods : the complex one-pole modal
bank (M. Mathews and J. O. Smith, "Methods for synthesizing very high Q
parametrically well behaved two pole filters", 2003), the vowel formants
(G. E. Peterson and H. L. Barney's 1952 averages for F1 to F3), the string
(Karplus and Strong, with Lagrange fractional delay and first-order allpass
dispersion), the topology-preserving filters (V. Zavalishin, "The Art of VA
Filter Design"), antiderivative anti-aliasing for the wavefolder and the
shapers (J. D. Parker, V. Zavalishin and E. Le Bivic, 2016) and the
Kaiser-windowed halfband of the 2x drive. klaine/amino and klaine/bizar were
read for reference; no code is taken from them.
