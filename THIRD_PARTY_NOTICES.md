# Third-party notices

Palinopsia includes code derived from the third-party works listed below. Their
authors and licenses are credited here rather than in the app's on-screen text.

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
