// Plain-English hover-help for whole EFFECTS, keyed by shaderId.
//
// Shown on the effect's name in the Inspector. Each shader already carries a
// DESCRIPTION in its ISF header, but those are written for whoever is editing
// the shader — they name techniques (Sobel, macroblocks, optical flow) and list
// parameters. These say what the effect DOES TO THE PICTURE and when you would
// reach for it, in words that assume nothing.
//
// House rules for anything added here: at most four sentences, no parameter
// lists (the per-input hints in inputHints.ts do that job), and no technique
// name unless the sentence also explains it.

export const SHADER_BLURBS: Record<string, string> = {
  // ── Colour ───────────────────────────────────────────────────────────
  'fx-posterize':
    'Collapses smooth gradients into a few flat bands of tone. Skies and soft shadows become poster-like steps instead of continuous shading. One of the core building blocks for turning video into graphic, printed-looking imagery.',
  'fx-palette':
    'Throws away the original colours and re-paints the image using a gradient you choose, from two to five stops. Dark areas take the first colour, bright areas the last, everything else blends between. This is the main tool for making any source match a chosen palette.',
  'fx-grade':
    'The everyday brightness, contrast, saturation and lift control. Use it to sit a layer properly in the mix before anything else touches it. Pulling saturation down is often what makes a busy composite read clearly.',
  'fx-hue-rotate':
    'Rotates every colour around the colour wheel, so reds become greens, greens become blues, and so on. It can push the shift harder in the bright parts or the dark parts instead of evenly. Good for recolouring a source without flattening it the way a palette map does.',
  'fx-colorizer':
    'Takes the image down to brightness alone and paints it back with two colours, one for the dark end and one for the light. The mapping can be pushed until it wraps and repeats, which folds extra colour bands out of a smooth gradient. Modelled on analogue video colourisers.',
  'fx-threshold':
    'Cuts the picture into just two tones at a brightness you pick, with a softness control for how hard the edge is. Everything above the line goes white, everything below goes black. Put a Palette after it to turn those two tones into any two colours.',
  'fx-solarize':
    'Inverts only the parts of the image brighter than a chosen level, leaving the rest alone. Highlights turn inside-out while shadows stay normal, which is the strange tonal flip you see in darkroom prints. Subtle settings read as a glow; extreme ones read as a negative.',
  'fx-vibe':
    'The always-on colour finish for the whole output, and the single biggest influence on how a session looks. It stretches the picture to use its full tonal range, then grades it and can map it through a palette. Every global Randomize leaves it alone, so your chosen look survives.',

  // ── Stylize ──────────────────────────────────────────────────────────
  'fx-dither':
    'Reduces the image to very few tones, then uses a fine grid of dots to fake the shades in between. It is how old newspapers and early computers showed gradients. Gives a crisp, printed texture rather than a smooth blur.',
  'fx-pixelate':
    'Averages the picture into square blocks so detail disappears into a coarse mosaic. The blocks stay properly square regardless of the frame shape. Pairs naturally with Posterize and Dither for a fully digital-looking treatment.',
  'fx-edge':
    'Finds the outlines in the image and draws them as lines, which you can blend over the original or use alone. Flat areas go dark and anything with contrast lights up as contour. Turns a photographic source into line-work.',
  'fx-sharpen':
    'Lifts fine detail so edges bite. Most useful after something soft, where it makes dithers crisp again and snaps posterised bands back into shape. A little goes a long way.',
  'fx-grain':
    'Adds noise modelled on real media rather than generic static. Film grain clumps and sits mostly in the mid-tones; digital sensor noise behaves quite differently; the parasite modes add the interference of old broadcast gear. Choose the medium and the picture inherits its texture.',
  'fx-scanlines':
    'Darkens alternating horizontal lines across the picture, as if it were being displayed on a tube monitor. An optional slow roll drifts them upward. It only ever darkens, so it adds texture without washing the image out.',
  'fx-crt-screen':
    'Wraps the whole picture in an old television: the glass bulges, colour separates toward the corners, a fine grille sits over everything and the edges fall into shadow. It is the complete tube look in one effect rather than a single element of it. Good as a final treatment on an otherwise clean composite.',
  'fx-pixelmask':
    'Shows the picture only where a repeating pattern allows it, hiding the rest. The pattern can be a monitor grille, a shadow mask, dots, lines or noise. The image ends up looking like it is being viewed through a physical screen.',
  'fx-fold':
    'Mirrors the image once across a line you can move, with the reflected half slidable. One deliberate fold makes a composition; this is why it will not do radial or kaleidoscope symmetry. Use it to build a diptych or to answer a shape with itself.',
  'fx-transform':
    'Zooms, moves and rotates the picture inside its layer, either wrapping at the edges or holding the border pixels. It is the plain compositional tool: place and scale a source without touching the layer itself. Wrapping turns a slow pan into an endless tile.',
  'fx-abstraction':
    'One dial that carries the image away from being a picture of something toward being pure texture. As you raise it the picture is dragged along its own lines of brightness until subjects dissolve into movement. Very useful when you want a recognisable source to stop being recognisable.',
  'fx-motif':
    'Repeats the image somewhere else in the frame, moved, turned, resized and optionally mirrored. The result is the same gesture answering itself across the picture, like a phrase repeated at a different pitch. Directional rather than radial, so it never becomes a mandala.',
  'fx-force-lines':
    'Bands the picture by brightness and slides each band along the direction the image itself is heading. The picture appears to be combed along its own internal currents. Strong settings turn a photograph into flowing strata.',
  'fx-aperture':
    'Puts a projector gate in front of the image: an iris, a slit, or a film-gate rectangle. It can flicker and breathe like a real gate rather than sitting perfectly still. Reach for it when you want the image to feel projected rather than displayed.',

  // ── Distortion ───────────────────────────────────────────────────────
  'fx-displace':
    'Pushes the picture around with a slowly drifting noise field, so it ripples and wanders. The distortion is deliberately lopsided rather than symmetrical, which keeps it feeling organic. A small amount adds life; a lot dissolves the subject.',
  'fx-distort':
    'Ten different warps under one set of controls: waves, ripples, bulges, pinches, twists, glass and more. Because they share an amount, scale, centre and angle, you can audition very different distortions without relearning anything. The workhorse when you know you want the image bent but not how.',
  'fx-wavefold':
    'Drives the brightness up and reflects it back down each time it would clip, over and over. Smooth gradients get carved into hard contour bands, like a topographic map of the light. Borrowed from analogue synthesis, where the same trick turns a plain tone harsh and metallic.',
  'fx-rutt':
    'Redraws the picture as a stack of horizontal scan lines, each pushed up or down by how bright the image is there. Bright regions rise into ridges and dark ones sink, so a flat frame becomes a relief landscape. This is the classic video-synthesizer scan-processor look.',
  'fx-smear':
    'Streaks the bright parts of the image along a direction, fading as they go. Only the highlights run, so the picture keeps its structure while the lights bleed. Reads as light dragging rather than as camera blur.',
  'fx-streak':
    'Blurs everything along one direction rather than outward in all directions. Unlike Smear it treats bright and dark alike, so it reads as the whole camera dragging. Use it for speed, wind, or to soften a layer without losing its shape.',

  // ── Time ─────────────────────────────────────────────────────────────
  'fx-wide-time':
    'Averages the last several frames together, so the picture continuously blends with its own recent past. Movement smears into slow, evolving shapes rather than staying sharp. Because the blend modes brighten or darken by nature, a preserve control can anchor the exposure back to the live image.',
  'fx-light-trails':
    'Keeps the brightest value each pixel has recently had, fading it slowly. Anything bright leaves a trail behind it while dark areas stay clean. It is a long-exposure photograph that never stops being taken.',
  'fx-slit-buffer':
    'A writing head sweeps across the frame, freezing the live image into place as it passes. Every column you see was captured at a different moment, so a still subject looks normal and a moving one is stretched through time. One of the clearest ways to make time itself visible.',
  'fx-difference-bloom':
    'Shows only what changed between one frame and the next, then spreads it softly outward. Anything that holds still disappears into black; anything that moves glows. Point it at a near-static source and only the gesture survives.',
  'fx-stutter':
    'Freezes the picture in bursts instead of letting it run smoothly. Horizontal bands can hold independently of one another, so parts of the frame stall while the rest keeps moving. The result is a broken, unpredictable rhythm rather than an even stutter.',
  'fx-row-echo':
    'Picks bands of rows at random and freezes each one onto its top line, repeating it downward. Whole strips of the picture smear into flat streaks until they refresh. Reads as a display failing to redraw itself.',
  'fx-triangle-flicker':
    'Pulses the brightness up and down on a steady rhythm, with an optional hard on/off strobe. It can also shuffle the colour channels on the beat. Best used sparingly — the output limiter will keep it safe, but it is a strong device.',
  'fx-feedback-zoom':
    'Feeds the image back into itself through a zoom and a twist, so echoes march inward or outward forever. Each generation is slightly smaller and turned, building tunnels and spirals out of any source. This is the deepest version of the afterglow the instrument is named after.',

  // ── Glitch ───────────────────────────────────────────────────────────
  'fx-chroma-shift':
    'Pulls the red, green and blue versions of the picture apart along an angle. Edges pick up coloured fringes, the way a cheap lens or a mistuned signal would. Kept subtle by default, it is the house signature rather than a spectacle.',
  'fx-rgb-shift':
    'Separates the three colour channels geometrically, offsetting and scaling each one on its own. Stronger and more controllable than Chroma Shift, it can pull a picture into three drifting ghosts. Useful when you want the split to be the subject, not an accent.',
  'fx-slice-shuffle':
    'Cuts the frame into horizontal bands and jumps some of them sideways, re-rolling on a clock. Only a minority move at a time, so the picture stays readable while constantly dislocating. The classic sliced-glitch look.',
  'fx-mosh-blocks':
    'Corrupts the image in square blocks, some grabbing the wrong part of the picture and some with their colours swapped. It re-rolls on a clock so the damage keeps moving. This is the look of a compressed video breaking up.',
  'fx-byte-corrupt':
    'Crushes each colour to very few values, then scrambles the arithmetic between channels block by block. Colours turn hard, wrong and non-photographic. It is what damaged data looks like when it still almost decodes.',
  'fx-compress':
    'Reproduces the artefacts of a heavily compressed still: the picture is cut into blocks, each crushed until fine detail vanishes and edges ring. This is the keyframe look rather than the motion smear. Turn it up and the image becomes a memory of itself.',
  'fx-databend':
    'Tears horizontal bands sideways as if the file itself had been edited in the wrong program. It is about damaging the stream rather than the movement, so it sits differently from Datamosh. Sharp, abrupt and rhythmic.',
  'fx-pixelsort':
    'Finds runs of pixels within a brightness range and reorders them along an axis, so parts of the image pour into smooth streaks. Bright or dark regions can be targeted independently. The signature glitch effect, and still one of the most legible.',
  'fx-ringing':
    'Repeats faint, alternating-sign echoes just off every hard edge. It is the halo an over-sharpened or over-compressed broadcast picks up. Fine amounts add a subtle electronic crispness; heavy amounts turn edges into ripples.',
  'fx-sync-loss':
    'The picture climbs the screen, catches, and tears in horizontal bands. It is a monitor losing its hold on the signal. Use it as an event rather than a constant, or bind it to a trigger.',
  'fx-tracking':
    'The tape-tracking error of a worn VHS: a noisy band that drifts through the frame, lines shifted at random, colour bleeding at the edges. Rebuilt from a well-known model of the real fault rather than approximated. Instantly reads as domestic video.',
  'fx-decay':
    'Wears the picture down the way a tape dub or a worn print wears down: colour bleeds, blocks crush, the head switch tears the bottom of the frame. It stacks generations of loss rather than simulating one specific fault. Excellent for taking the digital newness off a source.',

  // ── Texture ──────────────────────────────────────────────────────────
  'fx-granular':
    'Shatters the frame into a grid of small overlapping grains, then scatters, rotates and delays each one. The image survives as a cloud of its own fragments. Borrowed from granular sound synthesis, where the same idea turns a note into a texture.',
  'fx-mosaic':
    'Reads the picture as a grid of cells and replaces each with its own average colour, optionally redrawn as a shape. It is analysis and resynthesis rather than simple blurring, so the result feels constructed. Coarse settings turn any source into a tiled panel.',
  'fx-optical-rain':
    'Shatters the edges of the image into vertical streaks that drift downward, each fragment carrying a little of the colour it came from. The picture appears to be dissolving into falling threads. One of the stereoscopic-texture effects, and it pairs well with the 3D stage in the Finalizer.',
  'fx-phosphene':
    'The lingering ghost you see after looking at something bright, which is what the whole instrument is named after. A bright shape burns in and then hangs there in its opposite colour once it has moved on. Slow settings leave a long, painterly memory of the image.',

  // ── Native nodes ─────────────────────────────────────────────────────
  'node-transfert':
    'Takes the MOVEMENT of another layer and imprints it onto this one. The chosen layer never appears; only its motion does, either pushing this picture around or smearing it along the direction that layer is travelling. Pick which layer to read in the Inspector.',
  'node-convolve':
    'Treats another layer as a stamp, and prints a copy of its shape at every bright point of this one. Whatever texture or glare the other layer has is transferred onto this image. Because the stamp can be a live layer, the signature it imprints keeps changing.',
  'node-reponse':
    'Sums this layer’s last several frames through a shaped envelope, so trails swell and fade with a rhythm instead of decaying evenly. It is the visual equivalent of a reverb tail. Uses only its own history, so it needs no other layer.',
  'node-feedback':
    'Points the layer at its own previous frame through a slowly drifting zoom and rotation, which is how tunnels, trails and living textures appear out of nothing. An automatic gain control holds it at the edge of chaos so it never collapses to black or blows out to white. Deliberately off-centre, so it stays organic instead of becoming a symmetrical mandala.',
  'node-datamosh':
    'Makes the picture slide along its own movement, the way a broken video file smears when its keyframes are missing. Turn the refresh down and a new scene drags the previous one around, so figures melt into and out of the image. It is the real compression behaviour rather than an imitation of it.',
  'node-scanner':
    'Works like a flatbed scanner: a head sweeps the frame and captures only the line it is crossing, holding it until the head comes round again. Anything that moves while the head travels is stretched or repeated along the sweep. Fire the trigger to start a pass, or let it run in a loop.',
  'node-autocutter':
    'Chops the frame into pieces and shuffles them among each other, like a cut-up collage, while live video keeps playing inside every piece. The cuts can bend into torn curves with ragged paper edges instead of clean rectangles. Turn the mask up and pieces fall away until a single one is left.',
  'node-chronoscan':
    'Lets every part of the picture live at a different moment. It keeps a short history and then decides, pixel by pixel, how far back to look — driven by a sweep, by the image’s own brightness, or by another layer. One frame ends up containing many different presents.',
  'node-sediment':
    'A long memory: the brightest traces of everything that has passed sink slowly back toward black over seconds or minutes. It also stores occasional snapshots that can be brought back to the surface. Built for durational work, where the picture should carry where it has been.',
  'node-parallax':
    'Gives a flat image real depth: near things shift more than far things as the camera gently sways, with focus falling off and distance sinking into haze. It needs the depth engine switched on in the header to know what is near and what is far. With depth off it passes the picture through untouched.',
  'node-eternalism':
    'Holds two frames a moment apart and alternates them across a black shutter, so a slice of time hangs there moving without ever going anywhere. It is persistence of vision turned into a signal path. Slower rates shimmer; faster ones fuse into a single strange image.',
  'node-afterimage':
    'Where a bright shape has been and then left, its ghost blooms back in the opposite colour. This is what your eye does on its own after staring at something, described by Goethe two centuries ago. The ghost can be a plain dark subtraction or a full complementary colour.',
  'node-pulfrich':
    'Creates real depth out of sideways movement by delaying one eye slightly behind the other. It is the illusion that appears when you watch a moving picture with one eye darkened. Needs the anaglyph stage in the Finalizer, and a source that moves laterally.',
  'node-corrode':
    'Eats the picture away slowly and never repairs it. Blotches seed, then creep outward frame after frame, so over minutes the image is consumed. It only resets when you deliberately exhume it, which makes it a device for long pieces rather than a moment.',
  'node-decimate':
    'Grabs a fresh frame only now and then and holds it in between, so the picture steps through time instead of flowing. It is the time-lapse or stop-motion feel that a smooth sixty frames a second erases. It can snap hard between grabs or tween continuously across them.',

  // ── The pinned finalizers ────────────────────────────────────────────
  'fx-context':
    'The always-on depth stage, and what makes an image feel like it occupies space. It adds trails that bleed colour through time, a soft key light, atmospheric haze, blur and a darkening toward the edges. Every control at zero is a clean passthrough, so it only does what you ask of it.',
  'fx-finalizer':
    'The last stage before the picture leaves the app, and the one that decides its final contrast and texture. It holds the master levels and gamma, sharpening, and film grain over everything. It also carries the output shaping, the anaglyph 3D stage and the cameraless film treatments.'
}

/** Hover text for one shader, if we have written one. */
export function blurbFor(shaderId: string | null | undefined): string | undefined {
  return shaderId ? SHADER_BLURBS[shaderId] : undefined
}
