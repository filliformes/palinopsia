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

## Tracking effect (`src/renderer/src/shaders/isf/fx/Tracking.fs`)

The Tracking FX is rebuilt on the ISF shader "VHS Glitch" (the wandering freeze
line, the analog x-distortion and the tinted chroma bleed follow its model).

- "VHS Glitch" ISF conversion by David Lublin / VIDVOX, from the ISF-Files
  repository (https://github.com/Vidvox/ISF-Files), MIT License.
- Based on "unity-vhsglitch" by Staffan Widegarn Åhlvik
  (https://github.com/staffantan/unity-vhsglitch), licensed under the Creative
  Commons Attribution 3.0 Unported License
  (https://creativecommons.org/licenses/by/3.0/).

## "Hash without Sine" (many shaders)

The hash functions used across the generators, effects and native nodes
(`hash12`, `hash13`, `hash22` and their inlined forms, recognisable by the
`.1031` and `33.33` constants) are David Hoskins' "Hash without Sine"
(https://www.shadertoy.com/view/4djSRW), MIT License, Copyright (c) 2014
David Hoskins.
