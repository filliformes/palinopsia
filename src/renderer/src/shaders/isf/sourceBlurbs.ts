// Plain-English hover-help for whole SOURCES (generators) and for MODULATOR
// TYPES. Same idea and same rules as shaderBlurbs.ts: at most four sentences,
// no parameter lists, no technique name unless the sentence also explains it.
// Shown on the source name in the Inspector and on the modulator type name.

export const GENERATOR_BLURBS: Record<string, string> = {
  'drift-field': 'A slow directional drift of soft noise, flattened into a few matte bands over near-black. One accent color rides through it with a faint color split at the edges. The quiet default backdrop : motion you feel rather than watch.',
  'contour': 'Slow topographic contour lines march across a drifting noise basin, like a living height map. Matte line-work rather than filled shapes, sitting close to black. Good as a calm, map-like ground under busier layers.',
  'grid-drift': 'A flat grid whose rows and columns breathe gently out of alignment. Every so often the clock slips a whole lane sideways, and a few cells light up. Structure that stays legible while never quite holding still.',
  'particle-drift': 'Sparse points drift along a shared flow, each trailing a short capsule and wandering inside its own cell. A generative point-field rather than a particle explosion. Reads as dust or sparks carried on a current.',
  'interference': 'Two fine line-fields at close frequencies beat against each other, producing slow moiré. Handled as matte texture, not op-art dazzle : the angles are deliberately uneven. The shimmer of two screens almost lining up.',
  'column-scan': 'Horizontal scan lines pushed up and down by a drifting internal signal, brightening where the slope steepens. A taste of the analog scan-processor look built straight into a source. Feed it audio and each line traces the live waveform, like a stack of oscilloscope sweeps.',
  'ash': 'Sparse specks fall at their own per-column speeds, drifting sideways and flickering, with rare flecks catching the accent color. Near-black particulate weather that settles rather than storms. A quiet, steady source that can gust with the sound.',
  'erosion': 'Ridged noise washes steadily downhill, carving streaks that gather and split like sediment on a slope. Slow, geological movement rather than flow. Turns a layer into weathered, striated ground.',
  'membrane': 'One large soft mass slowly deforms in the dark, its silhouette breathing as an unseen field warps it. Interior shading gives it a sense of depth and weight. A single living body rather than a field of detail.',
  'mycelium': 'A thin branching network grows outward from an off-center seed, then dissolves and starts again elsewhere. Fine thread-like filaments spreading like fungus through soil. Organic structure that is always building and un-building itself.',
  'swell': 'An open water surface seen purely as light : several wave trains crossing, with no horizon and no sky. Crests sharpen toward foam as the chop builds. Reads unmistakably as the sea, abstracted to brightness alone.',
  'congeal': 'Bright seeds are dropped into a buffer that keeps resampling itself, so they smear, pool and set into shifting forms, then dissolve back to black. A feedback field that congeals the sparks into slow shapes. Living, self-thickening texture out of a few points, which the sound can seed and a trigger can wipe clean.',
  'gen-silhouette': 'The body in front of the Body camera, cut out of the room : the camera image where you are and nothing elsewhere, or a white matte, a colored shadow, or the room with you removed. A trail leaves fading echoes of the body. Needs the Body camera with Silhouette on.',
  'gen-nca': 'A texture that grows itself : a tiny neural network, trained on a real scan (lava, mossy rock, bark), runs in every cell of a grid. From nothing the texture of the photo emerges, stays alive and heals where you damage it.',
  'scan': 'A real photographed surface (30 CC0 scans : rock, bark, sand, steel, paper, lava, snow…) laid across the frame with hex tiling so it never visibly repeats, relit by one low raking light. Put Colony above it with a transparent ground to grow lichen or rust over it.',
  'ground': 'The surfaces under the living things, built the way the real ones form : mud cracking as it dries, sand ripples migrating with the wind, rock strata, tree rings, bark. Lit as a relief under one low raking light.',
  'colony': 'Living matter growing across a surface : lichen on granite, mould on agar, burning paper, rust on steel. Colonies spread from seeds with the rough front of real growth, stop short of each other and age as they go, lit as a relief.',
  'reaction': 'Two imaginary chemicals react and spread in a running buffer, organising themselves into drifting spots, stripes and mazes. The classic reaction-diffusion pattern, alive and never repeating. Coral, fingerprints and animal markings emerge on their own.',
  'metamorph': 'A solid organic shape lives on screen, and each cycle a new form is born from a point inside the old one and takes over. Continuous birth-from-within rather than a crossfade, on its own clock or on a trigger. Shapes endlessly becoming other shapes.',
  'filaments': 'Vertical strands sway like kelp, each a curve that leans further toward its free end at its own rate. Matte line-work with a gentle underwater motion. A forest of soft, drifting threads.',
  'murmuration': 'A flock of points steered by one shared wind that you can point and let veer, so waves of motion sweep through the crowd. Individuals surge ahead and fall back out of step with their neighbors, the way a real flock of birds ripples. Coherent movement emerging from many simple dots.',
  'slabs': 'Sparse horizontal slabs appear on a stepped clock, a few jittering sideways and the odd cell taking the accent color. Stepped, blocky time rather than smooth flow. The clean glitch-bar register.',
  'ten-print': 'The one-line maze program: every cell holds a diagonal, slash or backslash, and together they read as an endless labyrinth. Switch to arcs for a maze of winding curves. Re-deal the whole lattice with the trigger. A tiny piece of computer folklore as a source.',
  'shapes': 'Hard-edged primitives (circles, rings, bars, crosses, triangles) on a grid centered on the frame, each cell dealt its own character: filled or empty, its own breathing, its own turn. Reseed re-deals the field, and audio can scatter the sizes. A bold graphic source, or a matte and stencil to key other things through.',
  'op-art': 'Black-and-white optical-illusion fields: waves, grids, moiré and herringbone that seem to move on their own. Pure geometric dazzle, sitting at the edge of legibility. Contrast runs from soft grays to razor edges, and a grid can swell under a drifting lens. Optical art as a live source.',
  'recurse': 'A shape is drawn, then the space is shrunk, turned a little and pushed off-center, and it is drawn again, over and over. Echoes spiral inward toward one side into ornamental, arabesque geometry, and with audio each level rides its own band of the spectrum. One form multiplied into a whole pattern.',
  'ramps': 'A single clean gradient (horizontal, vertical, diagonal, radial or diamond) running exactly edge to edge at any aspect, optionally stepped into bands or mirrored into a seamless rise and fall. The quietest structured source, borrowed from analog control voltages. A wash to wipe, key against or grade through.',
  'differential': 'Several wave trains layered at stepped speed ratios, so their phases drift apart and beat like nested rhythms, drawn as even contour lines. Visual polyrhythm by differential motion, each layer able to swell with its own band of the music. Rhythms you can see rather than hear.',
  'solid-color': 'A flat color fill, or a smooth gradient across three stops at any angle. The quietest source of all: a wash to tint under, key against, or grade. Off is one solid color; on is a clean blend.',
  'rgb-osc': 'Each color channel is its own 2D oscillator: one shared waveform, but each channel with its own frequency and phase, the three slightly detuned. Pure video-synthesizer color with no photographic source at all, which a chroma control can pull back toward gray. Interference patterns in red, green and blue that audio can bend.',
  'sync-osc': 'One waveform that morphs continuously from saw through triangle to sine, with a sync control that runs the lines from scrolling, to frozen horizontal, to frozen vertical. A single morphing oscillator drawn across the whole frame. Classic analog-synth motion.',
  'slit-scan': 'Every column of the frame shows an internal oscillator at a different moment, so position across the screen is really time and the signal reads as a scrolling time-history of itself. The history is recomputed each frame, so a knob change redraws it all at once. One of the clearest ways to see time as space.',
  'direct-marks': 'Hand-drawn film marks : ruled lines, dots or scratches in flat ink, each blinking on its own, on a beat you can drive from audio, and boiling from frame to frame like a hand-made film. Cameraless animation, drawn and scratched straight onto the film strip. Marks made directly on the frame rather than filmed.',
  'dye-field': 'Colored dye pools and spreads over a near-black emulsion, mixing by subtraction the way pigment really does. Disciplined toward decay and crystallization rather than glow. Paint-on-film abstraction.',
  'organic': 'Living elemental matter (fire, water or nature) carried by a real swirling flow rather than scrolling noise, so it billows and grows instead of sliding. A season control shifts its palette and behavior. Moving matter, never a still image.',
  'gen-text': 'Turns typed words into a picture: choose the font, size, weight and placement in the Inspector. Lines can step one at a time as cues, crawl like a ticker, or type themselves on. Another layer can fill the letters, so the type becomes a window onto that image. Typography used as a visual source.',
  'gen-collage': 'A wall of films cut up like torn paper : point it at a folder and every piece plays a different clip, each cropped to fit its own shape. Portrait, landscape and 4K all mix freely. The Autocutter\'s collage, but with real video in every fragment.',
  'gen-parametric': 'Reads the live audio and draws it directly as a picture: a hard raster, a waveform trace, spectrum bars, or a scrolling spectrogram. Local audio input shows the real sound, OSC audio its six bands, and with no audio it runs a test signal. Sound turned literally into image.',
}

export const MODULATOR_BLURBS: Record<string, string> = {
  'lfo': 'A repeating wave that rises and falls forever : sine, triangle, square, saw, or the random and Spastic shapes. The everyday modulator for steady, cyclic movement. Pick the shape and the speed, and bind it to any control.',
  'ramp': 'Sweeps once from start to finish over a set time, then stops, or loops if you ask it to. A one-shot glide rather than a repeating wave. Use it for a slow build, a fade, or a single move on a trigger.',
  'adsr': 'An envelope with four stages (attack, decay, sustain and release) : the shape a note makes when it swells and dies. Fire it and a control rises, settles, and falls. Borrowed from synthesizers for shaping one gesture over time.',
  'arp': 'Steps through a row of evenly spaced levels on a clock, walking up, down, or at random. A stepped sequence rather than a smooth wave. The Slip control lets it skip beats so the rhythm turns unpredictable.',
  'random': 'Throws a fresh random value on every clock tick and holds it until the next. Jumpy, unrepeatable movement. Slip makes it skip some ticks, so the changes stop landing on an even beat.',
  'sh': 'Samples a random value and holds it, sometimes skipping a beat to keep the same value longer. The stepped, locked-in feel of a classic sample-and-hold. Optional smoothing glides between the held values instead of snapping.',
  'slew': 'Chases a target value, taking a set time to rise and a set time to fall. It rounds off sudden jumps into smooth glides. Feed it something jumpy and it comes out gentle.',
  'chaos': 'A mathematical system that never settles and never repeats, drifting between order and turbulence. Predictable in feel but never in detail. Turn it up toward the wild end for restless, organic wander.',
  'euclid': 'Spreads a handful of pulses as evenly as possible around a loop of steps, the way world rhythms are built, and fires on each. A few pulses in many steps gives sparse, lop-sided patterns. Decay turns each pulse from a hard on/off gate into a soft pluck that fades between beats, so it can drive a value continuously rather than just switch it.',
  'turing': 'A looping sequence of values that rewrites itself now and then. At zero mutation it repeats forever; nudge it up and the loop slowly mutates into a new one, never quite settling. A pattern that evolves while staying in rhythm.',
  'cellular': 'Grows a row of cells one generation per beat under a simple rule, and reads out how many are alive. Some rules make fractals, some chaos, some slow complexity. An unpredictable but structured pulse that never plays the same twice.',
  'audio': 'Follows the live sound : its loudness, its attack, its pitch or a chosen frequency band. The picture then moves with the music rather than on a fixed clock. This is how a layer breathes with what you hear.',
  'vision': 'Follows the picture itself (its brightness, motion, edges or color warmth) and feeds that back as control. The image ends up steering its own parameters. A loop where what you see becomes what moves.',
  'body': 'Follows your body through the camera : a hand’s height, how open it is, how far your arms spread, the whole frame’s motion. You play the instrument by moving. Turn it on and pick a camera on the Body page (B).',
  'homeostat': 'Watches a quality of the picture and quietly pushes a control to keep that quality steady. If the image drifts too bright or too still, it corrects. A self-regulating hand that holds the composition at a chosen balance.',
  'organic': 'A wandering wave that never quite repeats, built from several drifting layers beating against each other. Irregular and alive rather than mechanical. For movement that feels hand-made instead of clocked.',
  'physics': 'Movement with real physics : a bouncing ball losing height, a spring settling, a riser climbing. It has weight and momentum rather than following a curve. Gestures that feel governed by gravity.',
  'motion': 'Named movement gestures (rising, falling, swelling, converging) plus forces like gravity and wind. Pick a trajectory and the control traces it. For deliberate, shaped motion rather than an abstract wave.',
}

/** Hover text for one generator, if written. */
export function generatorBlurb(id: string | null | undefined): string | undefined {
  return id ? GENERATOR_BLURBS[id] : undefined
}

/** Hover text for one modulator type, if written. */
export function modulatorBlurb(type: string | null | undefined): string | undefined {
  return type ? MODULATOR_BLURBS[type] : undefined
}
