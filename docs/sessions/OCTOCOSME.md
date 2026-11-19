# OCTOCOSME in Palinopsia : one controller, one session

`octocosme-one-controller.opsia.json` plays one OCTOCOSME controller in Palinopsia, the way
the installation's Max patch (`OCTOVID_1Inst`) and its Resolume composition (`Octo_2024.avc`)
do. It is a starting point : the shapes, the layout and the mapping follow the patch; the
look of the Resolume stage is rebuilt with Palinopsia's own effects and is meant to be
tuned with the controller in hand.

## Before playing

1. **OSC in, port 1988** (Connect tab, OSC : the port the controller's Teensy sends to).
   The port is set per computer; the session does not change it.
2. **The voices' levels on the same port.** In the installation, the Pure Data sound patch
   sends `/audio1/peak` … `/audio4/peak` (and `/touch/…`) to port **1984**, the controller
   to **1988**. Palinopsia listens on one port : send the Pd patch's messages to **1988**
   too (one number in its `udpsend`), or the shapes never appear (they show while their
   voice sounds).
3. **Load the session.** Its mapping comes with it : OSC's **map** pane lists 48 aliases
   marked **SESSION**.

Output : 1920 × 1080, as the patch renders. Spout / Syphon / NDI from the Output section,
as the patch's Spout sender `left` did.

## What it holds

- **Four layers, one Grid Mesh each**, at the patch's places (x −2.5, −0.85, +0.85, +2.5;
  camera 22 away, 10° lens), the first normal and the three above in **difference** (the
  patch's `co.difference` chain). They start on the patch's mesh bank slots 1 to 4 at rest.
- **The master rack in place of Resolume** (before the three finishers) : 1 Colorizer
  (Resolume's Tint : black stays black, mids magenta, lights red-pink), 2 Grade, 3 Light
  Trails, 4 Chroma Shift (RGB Delay), 5 Posterize, 6 Pixelate (Lo-Rez), 7 Distort
  (turbulence, for Goo), 8 Displace, 9 Grain (Noisy), 10 Hue Rotate.

## The mapping (the patch's DataScale ranges)

Every controller message starts with two values (its address and an id), so the four voices'
values are arguments 2 to 5 (pitch), 6 to 9 (modA), 10 to 13 (modB).

| Controller | Palinopsia (voice n = layer n) | Range |
|---|---|---|
| `/A/strips/switches` instr (0..7) | `…/source/A/preset` : the look, OCTOCOSME 1..8 | instrument n → preset n + 1 |
| `/A/strips/pots` modA | `spinAxes` (8 combinations) and `spinSpeed` | 10 → 100 °/s |
| `/A/strips/pots` modB | `noiseBlend` | −1 → 3 |
| `/A/strips/pots` pitch | `turn` | 0 → 90° |
| `/B/strips/pots` volume | `level` | 0 → 1 |
| `/B/strips/switches` kill | layer **mute** (inverted : 1 plays) | |
| `/audioN/peak` | layer **opacity** : shown while the voice sounds | 0.002 → 0.02 |
| `/A/global/pots` ambiance | Colorizer bias (the ground washes in), Light Trails, Grade saturation down | |
| `/A/global/pots` filtre | Grade brightness and contrast | |
| `/A/global/pots` mouvement | Distort amount (Goo) | 0 → 0.2 |
| `/A/global/pots` delai | Chroma Shift amount | |
| `/A/global/pots` distortion | Posterize (fewer tones), Pixelate (bigger cells), Grain at the top | |
| `/B/global/pots` notes | Hue Rotate (the tint's hue) | |
| `/B/global/pots` vitesse | the four layers' speed (slower turns as it rises, the patch's 1 → 0.2) | |
| `/touch/bend` | Displace | |

Each row is an alias in the **map** pane : its argument, ranges, curve and invert can be
changed there, and saving the session keeps the change.

## Approximations, and what is left to do

- **Peak into the noise** : in the patch the voice's level also adds to its noise blend
  (`peakRemap` → `Shape02NoiseBlend`). An alias drives one value, so here modB alone sets
  the blend. A modulator (audio from the voice, or an OSC controller modulator) could add it;
  or, with the voices' sound on Palinopsia's audio input, Grid Mesh's own **audio** knob (it
  adds the sound's level to the deform). The session leaves it at 0.
- **A noise burst on each peak** (the patch's per-voice peak driving a burst of noise) :
  an envelope can now be fired by another modulator or by the sound (the ↯ on a Ramp or
  ADSR card), so this takes a few clicks and no change to the session file :
  1. a free modulator slot (say M5) set to **controller**, its INPUT learned on
     `/audio1/peak` (press **learn**, let the voice sound), or played straight in as
     `/opsia/mod/5/in` by the Pd patch;
  2. M6 an **adsr** (a short attack, a decay of a few hundred ms, a low sustain), its
     **↯** on **M5**, **AT** just above the voice's quiet level (watch the live bar),
     **HOLD** about 100 ms so one note fires once;
  3. M6 bound (the M on the control) to layer 1's `noiseBlend`, Replace, a positive depth.
  Each time the voice peaks, its shape bursts into noise and settles back. With the
  voices' sound on the audio input instead, the ↯ can listen to **the sound** in the
  voice's own frequency band. Repeat for voices 2 to 4 : the four take all eight slots (a
  controller and an envelope each), so keep the bursts for the voices that need them when
  slots are wanted for other things.
- **Pitch and interval** : the patch's `hauteur` and `intervalle` scale a master rotation
  (`MeshRotaMaster`) whose exact effect was not traced; pitch turns the mesh here, interval
  is not mapped.
- **variation, mode, touch, the touch pad** : not mapped yet (variation was the tint's
  white hue).
- **The Resolume stage** : its effects are Resolume's own (closed); the chain above takes
  their place with the saved values at rest, and was never compared with the wall live.
- **Grid Mesh against Max** : the shapes, layout, draw modes and lights were matched on
  the patch's raw output at rest; the noises are not `jit.bfg`'s own, and the cube's fan
  and the cone's centre still differ a little. The level and the color's alpha count once,
  as in the patch (half level : about a quarter of the color over black).
- **Two controllers** : one session (and one Palinopsia) per controller. Aliases do not
  filter by sender; with two controllers on one network, mute the other one's sender in
  OSC's **links** pane.
