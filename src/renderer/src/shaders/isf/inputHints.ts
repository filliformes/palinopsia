// Plain-English hover-help for shader inputs, keyed by shaderId → inputName.
// Surfaced by AutoControls in each control's title (appended to the label).
// Focused on the always-on finalizers (Vibe · Context · Finalizer) : the params
// a first-timer meets in Finishing and can't guess from the label alone.

export const INPUT_HINTS: Record<string, Record<string, string>> = {
  'node-eternalism': {
    mode: 'HOLD = two frames a gap apart alternated across a black shutter (Jacobs’ Eternalism — a held micro-motion). DRIFT = two delayed copies beating in and out of lock (phase-drift twins).',
    gap: 'How many frames apart the two temporal taps are (the size of the time-slice).',
    rate: 'HOLD only : the shutter flicker rate. ~3–12 Hz shimmers (sub-fusion); higher fuses.',
    interval: 'HOLD only : size of the BLACK shutter gap between the two frames (the interval that becomes an image).',
    detune: 'DRIFT only : how fast/far the two copies’ delay drifts apart → the beat in and out of sync.',
    tint: 'DRIFT only : amber cast on the second (slightly larger) twin.',
    mix: 'Dry/wet against the live image.'
  },
  'node-afterimage': {
    decay: 'How long the ghost lingers : low = a fraction of a second, high = many seconds.',
    amount: 'Strength of the afterimage ghost.',
    chroma: '0 = a dark subtraction where the bright form was (pure Goethe). 1 = its complementary colour (a red form leaves a cyan ghost).',
    mix: 'Dry/wet against the live image.'
  },
  'node-decimate': {
    mode: 'CLOCK samples a fresh frame every 1/rate seconds (the time-lapse clock). HOLD freezes the picture and only re-samples when you fire the trigger.',
    rate: 'CLOCK mode : how often it grabs a fresh frame (Hz). Low = chunky time-lapse steps, high = near-passthrough.',
    smooth: 'Tween between the last two grabs : 0 = a hard snap on each sample, 1 = a continuous morph across the whole interval (slow-motion).',
    trig: 'SAMPLE ▸ : grab a fresh frame now (rising edge). In HOLD mode this is the only way to refresh; in CLOCK mode it forces an extra sample. Bind a modulator (square/S&H/audio) to sample on the beat.',
    mix: 'Dry/wet against the live image.'
  },
  'node-corrode': {
    bury: 'How fast corrosion accumulates over time. The mask ONLY ever grows — it eats the picture slowly over minutes and never recovers until you EXHUME. On the Master rack it weathers the whole set.',
    spread: 'How fast corroded zones creep outward into clean areas (the migrating front).',
    eat: 'How deeply corroded zones are removed — from a faint stain to fully eaten to the leader colour.',
    tone: 'The corroded colour : 0 = leader-dark (near-black), 1 = a sepia / rust stain.',
    crackle: 'Reticulation : thin cracked-émulsion lines through the corroded zones.',
    reset: 'EXHUME ▸ : clears all accumulated corrosion and re-rolls the blotch pattern, starting the weathering fresh. Press it, send OSC, or bind a modulator.',
    mix: 'Dry/wet against the untouched image.'
  },
  'node-pulfrich': {
    mode: 'ANAGLYPH = a red/cyan stereo pair (needs glasses) — real depth on lateral motion. FREE = a glasses-free horizontal parallax slide, gated by motion.',
    source: 'What keys the per-pixel eye-delay : the Depth map (real 2.5D, needs the Depth engine on) or the image’s own LUMINANCE (a stylised fallback).',
    delay: 'Maximum eye-delay in frames for the most-delayed plane. Bigger = deeper 3D but more doubling on fast motion.',
    curve: 'Bends how depth maps to delay : <1 crowds the delay onto the far plane, >1 spreads it forward.',
    separation: 'ANAGLYPH : amplifies the red/cyan disparity. FREE : the horizontal slide distance.',
    desat: 'ANAGLYPH only : desaturate the eyes toward grey to curb retinal rivalry (ghosting/eye-strain) in the glasses.',
    swap: 'Flip which eye carries the lag (near ↔ far, left ↔ right). Fixes inverted or reversed depth.',
    mix: 'Dry/wet against the live image. The disparity is temporal, so a still frame is byte-exact — no colour fringing.'
  },
  'fx-force-lines': {
    lines: 'How many luminance-contour bands the picture is cut into : the lines of force.',
    shift: 'How far each ribbon slides along its contour (adjacent bands shear opposite ways).',
    edge: 'Engrave the band boundaries as dark incrust lines.',
    gate: 'Confine the cutting to where there is real structure (gradient energy) : flat areas stay untouched.',
    amount: 'Dry/wet against the untouched image.'
  },
  'fx-aperture': {
    shape: 'The gate : IRIS (circle) · vertical / horizontal SLIT · film GATE (rectangle).',
    size: 'How open the gate rests. Outside is leader-black.',
    soft: 'Feather on the gate edge.',
    flicker: 'The opening re-rolls every drawn frame (a breathing shutter). 0 = steady.',
    rate: 'The flicker cadence (drawn frames per second).',
    couple: 'Defocus ↔ gate coupling : as the aperture closes, the lens softens (the focus pull a contracting iris forces).',
    amount: 'Dry/wet against the untouched image.'
  },
  metamorph: {
    rate: 'How often a new form is born from inside the old one. 0 = births only on the birth ▸ trigger.',
    size: 'The organism’s resting size.',
    wobble: 'Boil on the outline : the silhouette’s rim churns (faster as it rises).',
    complexity: 'Body warp : from a soft blob toward a carved, asymmetric figure.',
    drift: 'How far each new generation lands from its parent : 0 = the lineage stays in place, 1 = it roams the whole frame. Also a slow sway.',
    inner: 'Faint interior shading so the form reads as a body, not a flat sticker.',
    birth: 'Fire a birth now (bind it to the beat) : a new form grows out of the old one in about half a second.'
  },
  'direct-marks': {
    gate: 'How many marks are showing : 1 = all of them, lower = fewer, each blinking on its own random clock. Drive it from audio for marks on the beat.',
    jitter: 'How far the hand strays : each mark sits a little off its ruled place (scratches wander along their length).',
    rate: 'How fast each mark blinks when gate is below 1 (each mark at its own pace).',
    boil: 'Redraws every mark on each drawn frame, the way a hand-made film never holds still. 0 = held marks.',
    fps: 'How many new drawn frames per second the boil makes (12 = drawing on twos, 24 = on ones).',
    seed: 'Deals a different hand : a new set of positions, blinks and scratches.',
    audio: 'Each mark follows the spectrum band at its own place across the frame (bass on the left) : loud bands light their marks. In silence, high values empty the frame.'
  },
  'sync-osc': {
    freq: 'How many lines fill the frame height.',
    sync: 'Like an analog sync knob : 0 → middle slows the scrolling lines to a frozen horizontal hold; middle → 1 turns the frozen lines to vertical.',
    rate: 'Scroll speed (only while sync is below the middle).',
    audioFM: 'Bends every line with the live audio waveform (the classic video-synth audio input). Silence = straight lines.'
  },
  differential: {
    count: 'How many wave trains are layered. In between whole values the next layer fades in.',
    ratio: 'Speed step between layers : layer k runs at rate × (1 + k × (ratio − 1)). Whole numbers lock into repeating cycles; in-between values never quite repeat.',
    rate: 'Speed of the slowest layer (the others run faster by the ratio steps).',
    freq: 'Wavelength of the wave trains : more waves across the frame.',
    thickness: 'Contour line width (even along the whole line).',
    lines: 'How many contour levels : more, closer lines.',
    skew: 'How far the layers fan apart in direction (always less than a right angle, so it never closes into a rosette).',
    audio: 'Each layer swells with its own band of the spectrum, bass on the slowest layer : the contours pulse with the music.'
  },
  'solid-color': {
    midpoint: 'Where colB sits along the gradient (colA at one edge, colC at the other).',
    dither: 'A faint, fine noise that stops smooth gradients banding on 8-bit outputs.'
  },
  'node-feedback': {
    couple: 'Runs a SECOND feedback buffer (fb1) under a diverged transform and cross-mixes it into the main loop. 0 = single buffer. Up = emergent structure neither loop makes alone.',
    couple2: 'How differently the 2nd buffer evolves : scales its zoom/rotate vs the main loop. 1 = same, <1 gentler, >1 wilder. The divergence is what makes the coupling interesting.',
    rgbDelay: 'Time-shear : the R/G/B channels read the delay echo from slightly different past frames → chromatic trails. Needs delay echo > 0.',
    route: 'Where the delay echo goes : FEEDBACK re-enters the loop (compounds/accumulates) · FEEDFORWARD rides on top of the output only (a clean, non-accumulating echo).'
  },
  'node-datamosh': {
    mode: 'MELT (soft per-pixel smear) · STICKY (rigid block tiles that tear at edges — the real datamosh look) · FLUID (a temporally-averaged flow → smooth liquid melt).',
    swirl: 'Rotate every motion vector → a vortex mosh (0 = none, ± = spin direction).',
    flowInvert: 'Reverse the motion direction → the smear pushes backward.',
    pulse: 'Auto-fire the bloom on a clock (Hz) — hands-free rhythmic moshing. 0 = off.',
    trig: 'Fire a BLOOM burst on the rising edge : momentarily holds the I-frame + boosts persistence so the motion drags the frozen texture (the classic datamosh hit). Press it, send OSC, or bind a modulator (square LFO / audio onset) with M to mosh on the beat.',
    manifest: 'Manifestation : instead of a clean I-frame cut, the live frame re-enters ONLY where there is motion — a new source completes itself out of the retained frame, growing in along movement. Still areas stay frozen.',
    actant: 'Actant layer strength : sparse sticky patches that FREEZE their texture and drift along the flow as autonomous frozen blocks. 0 = off. Drop them with the actant ▸ trigger or the rate clock.',
    actantLife: 'How long each actant patch persists before it fades : low ≈ a fraction of a second, high ≈ several seconds.',
    actantRate: 'Auto-spawn actant bursts on a clock (Hz) — hands-free. 0 = only the manual/OSC trigger fires them.',
    actantTrig: 'Drop a burst of actant patches on the rising edge : localized frozen blocks that stick and drift along the motion. Press it, send OSC, or bind a modulator (square LFO / audio onset) with M. Needs actants > 0.'
  },
  'fx-stutter': {
    trig: 'PUNCH-IN : while fired, every band freezes (full stutter). Press, OSC, or bind a modulator (M) to glitch on the beat. 0 = the base `chance` applies.'
  },
  'fx-mosh-blocks': {
    trig: 'PUNCH-IN : while fired, every block moshes (full). Press, OSC, or bind a modulator (M) for beat-locked bursts. 0 = the base `chance` applies.'
  },
  'fx-slice-shuffle': {
    trig: 'PUNCH-IN : while fired, every slice shuffles (full). Press, OSC, or bind a modulator (M). 0 = the base `chance` applies.'
  },
  'fx-byte-corrupt': {
    trig: 'PUNCH-IN : while fired, every block corrupts (full). Press, OSC, or bind a modulator (M) to fire on the beat. 0 = the base `scramble` applies.'
  },
  organic: {
    mode: 'Which element : fire (buoyant flames + sparks) · water (flowing caustics + deep) · nature (growing canopy + pollen).',
    rate: 'Overall speed of life : how fast the element moves / grows.',
    scale: 'Feature size : small = fine detail, large = broad masses.',
    detail: 'High-frequency texture on top of the base masses.',
    flow: 'Directional drift : the base current (flame rise · water flow · growth push).',
    swirl: 'Curl-noise turbulence : how much the flow eddies and billows (vs. smooth drift). The engine that makes it feel alive.',
    depth: 'Parallax depth : stacks a farther, dimmer layer behind (deep water · back-glow · far foliage) for volume.',
    embers: 'Drifting particle layer : rising sparks (fire) · sediment/bubbles (water) · pollen/leaves (nature). 0 = none.',
    vary: 'Season blend toward each element’s alternate : gas-blue flame · lagoon green · patchy autumn.',
    contrast: 'Tonal contrast of the element (harder vs. softer masses).'
  },
  'slit-scan': {
    rate: 'How fast time scrolls across the frame. Negative runs it the other way. Changes glide from the current picture, no jump.',
    span: 'How much time the width of the frame holds : low = a short, broad history, high = a long one packed into fine, fast-changing columns.',
    freq: 'How many waves fit across the profile (the axis the scan does not run along).',
    bands: 'How many flat brightness levels the signal is stepped into (whole numbers, from black to full tint).',
    vertical: 'Time runs down the frame instead of across it.'
  },
  ramps: {
    freq: 'How many ramps repeat across the frame. 1 = one ramp exactly edge to edge (center to farthest corner for radial and diamond).',
    steps: '1 = a smooth ramp. Higher = a staircase of that many evenly spaced flat levels.',
    rate: 'Scroll speed of the ramp. Negative runs it the other way (rings move inward instead of outward).',
    angle: 'Turns the ramp direction (linear and diamond shapes; a radial ramp looks the same at any angle).',
    mirror: 'Folds each ramp into a rise and fall (a triangle) : no hard seam, so a lumakey wipe or the Colorizer sees one smooth front.',
    center: 'Where radial and diamond ramps start from. No effect on the linear shapes.'
  },
  'rgb-osc': {
    freq: 'Stripe frequency : how many cycles fit in the frame height.',
    spread: 'Detune : how far green and blue run from red in frequency. 0 = the three channels in step (a steady color fringe), higher = faster color crawl.',
    symmetry: 'Axis blend : 0 = vertical stripes, 1 = horizontal stripes, 0.5 = a plaid of both.',
    rate: 'How fast the stripes drift. Changes glide from the current picture, no jump.',
    level: 'Plain gain on all three channels.',
    chroma: '0 = gray (the brightness the three channels make together), 1 = full oscillator color. Lower it to keep the field matte.',
    audioFM: 'Bends the stripes into the live audio waveform : vertical stripes follow it down the frame, horizontal ones across it. 0 = off.'
  },
  recurse: {
    iterations: 'How many nested levels are drawn. Fractional values fade the deepest level in, so it can be swept smoothly.',
    scale: 'How much each level shrinks : low = a fast plunge, high = many close frames.',
    angle: 'How much each level turns. Negative turns the cascade the other way.',
    drift: 'How far each level shifts off-center : what keeps it a spiral cascade rather than a centered tunnel.',
    driftAngle: 'Direction of the off-center shift : which side of the frame the cascade converges toward.',
    width: 'Line width (the deepest levels never go thinner than about a pixel and a half).',
    rate: 'Speed of the slow breathing of rotation and drift.',
    audio: 'Each level rides its own band of the live spectrum (outer frames = lows, deep frames = highs) : louder bands draw thicker, brighter lines.'
  },
  shapes: {
    count: 'How many cells fit in the frame height. The grid is centered, so changing it zooms about the middle.',
    size: 'Shape size relative to its cell. Large sizes overlap their neighbors (nothing is cut at the cell edge).',
    soft: 'Edge softness : 0 = crisp (still anti-aliased), higher = a soft halo.',
    rate: 'Speed of the breathing and turning. Each cell keeps its own pace.',
    density: 'Share of cells that hold a shape. Below 1 the seed leaves some cells empty (reseed re-deals which).',
    spin: 'Bars and crosses : 0 = all upright, higher = each cell dealt its own angle and slow turn. Triangles always turn, each its own way.',
    invert: 'Swaps shape and ground : the tint fills the frame and the shapes become holes.',
    audioScatter: 'Each cell’s size rides its own sample of the live audio waveform, so the field ripples with the sound. 0 = off.',
    reseed: 'Re-deals every cell : which are filled, their breathing, their turning.'
  },
  'op-art': {
    scale: 'Pattern density : higher = finer bands and smaller cells.',
    warp: 'Mode-dependent distortion : wave bend (waves), lens bulge (grid), grating angle (moiré), zig-zag depth (herringbone).',
    rate: 'Speed of the illusory flow. Negative reverses it.',
    contrast: '0 = soft sine grays, 1 = hard edges (kept pixel-clean at any scale).',
    audio: 'The live audio waveform bends the pattern sideways. 0 = off.'
  },
  interference: {
    detune: 'How far the second line field is off in frequency : sets the spacing of the beat bands (small = broad, slow bands; larger = tight, busy moiré).',
    skew: 'Tilts the second line field against the first (up to about 30°) : the angle mismatch turns the beat into slanted moiré bands.',
    rate: 'How fast both line fields slide. The beat bands crawl with it, slower the broader they are. Changes glide from the current picture, no jump.',
    contrast: 'Shapes the beat : higher = darker gaps and narrower bright bands.'
  },
  'column-scan': {
    amp: 'How far the internal signal pushes each line up and down (as a share of the frame height).',
    scale: 'Horizontal frequency of the internal signal : low = long slow swells, high = a nervous, busy trace.',
    rate: 'How fast the internal signal drifts. Changes glide from the current picture, no jump.',
    width: 'Line thickness as a share of the line spacing (never thinner than a pixel).',
    audio: 'Writes the live audio waveform into the lines : each line traces its own stretch of the signal, oscilloscope-style. 0 = off.'
  },
  ash: {
    speed: 'Fall speed. Changes glide from the current picture, no jump.',
    physics: 'Mass of the ash : low = heavy flecks dropping fast and straight; high = light ash falling slowly, swaying wider and floating sideways.',
    wander: 'How far each fleck drifts sideways as it falls.',
    flicker: 'Slow per-fleck brightness breathing.',
    accent: 'Share of rare flecks that carry the tint color.',
    audioScatter: 'Each column of ash gusts sideways on its own sample of the live audio waveform (neighboring columns move together, so gusts travel across the bed). 0 = off.'
  },
  murmuration: {
    speed: 'How fast the birds surge and wander. 0 holds the flock still. Changes glide from the current picture, no jump.',
    cohesion: 'How tightly the birds share one wind : high = one aligned flock, low = each region turns its own way.',
    stretch: 'How long each bird is drawn along its heading.',
    heading: 'Direction of the shared wind : steers the whole flock.',
    veer: 'How far the wind swings around the heading on its own, slowly (0 = holds the heading exactly, 1 = wanders all the way round).',
    audioScatter: 'Startles the flock with the sound : each bird jumps along its own direction by the loudness of its own frequency band, and regroups in silence. 0 = off.'
  },
  filaments: {
    rate: 'How fast the strands sway. Changes glide from the current picture, no jump.',
    sway: 'How far the strands swing (always more toward the free end).',
    width: 'Strand thickness at the root as a share of the strand spacing; strands taper toward the tip (never thinner than about a pixel and a half).',
    lean: 'Tilts the whole bed : negative leans left, positive right.',
    audioScatter: 'Pushes each strand sideways by its own sample of the live audio waveform (quick, jittery). 0 = off.',
    audioSway: 'Each strand swings wider when its own frequency band is loud (smooth : follows the energy of the music, not the raw wave). 0 = off.'
  },
  congeal: {
    rate: 'How fast the flow drifts and how often new seeds drop. Changes glide from the current picture, no jump.',
    decay: 'How long material lingers : higher = longer trails and slower dissolving (it always fades fully to black).',
    warp: 'How hard the flow drags the material each frame : low = still pools, high = long swirling streaks.',
    seed: 'Seed density : how many bright drops fall into the field (not a random seed).',
    scale: 'Size of the flow pattern : low = broad currents, high = small eddies.',
    audioSeed: 'Drops extra seeds where the live spectrum is loud, across the width (bass on the left, treble on the right). 0 = off.',
    clear: 'CLEAR ▸ : wipes the field to black at once (seeds keep falling). Press it, send OSC, or bind a modulator.'
  },
  'drift-field': {
    rate: 'How fast the field drifts. Changes glide from the current picture, no jump.',
    scale: 'Size of the flow : low = broad slow strata, high = fine grain.',
    warp: 'How much the flow folds back on itself : 0 = smooth layers, high = torn, swirling bands.',
    steps: 'How many terraces the flow is cut into : few = broad matte bands, many = fine strata.',
    contrast: 'Pushes the field toward the dark end before it is banded : higher = more dark ground and fewer bright strata.',
    split: 'Red / blue fringes at the band edges, like slightly misregistered color plates. 0 = off (and cheaper).',
    angle: 'Turns the strata and their drift (0 = horizontal).',
    reseed: 'RESEED ▸ : cut to a completely new field (rising edge). Press it, send OSC, or bind a modulator to cut on a beat.'
  },
  slabs: {
    rate: 'Cut tempo : how often the slabs re-deal. Changes take effect from the next cut, no jump.',
    bands: 'How many horizontal bands stack up the frame.',
    density: 'Share of cells lit in each band.',
    jitter: 'Share of bands thrown sideways on each cut.',
    drift: 'Slow sideways scroll of every band between cuts, each at its own speed and direction.',
    accent: 'Share of lit cells drawn in the accent tint.',
    chaos: 'Bends every cell on its own curve, and turns a growing minority of bands rogue : odd cell sizes, big throws, thin sub-stripes, a faster clock, inversions.',
    nonlinear: 'Thins each cell to its own random width and height, so the slabs break into a field of lines.',
    audioScatter: 'Each band slides sideways on its own sample of the live audio waveform : the sound ripples up the stack. 0 = off.',
    audioLight: 'Each band lights more of its cells as its own frequency band gets loud (bass at the bottom, treble at the top) : a spectrum-analyzer reading. 0 = off.',
    reseed: 'RESEED ▸ : re-deal every band (widths, picks, accents) at once. Press it, send OSC, or bind a modulator.'
  },
  contour: {
    rate: 'How fast the basin drifts. Changes glide from the current picture, no jump.',
    scale: 'Size of the terrain : low = a few wide hills, high = many small ones.',
    levels: 'How many elevation lines span the full height range.',
    width: 'Line weight, relative to the frame height : the same on-screen thickness on steep and flat ground, at any resolution.',
    warp: 'How much the terrain folds back on itself : 0 = soft rounded hills, high = contorted, swirling lines.',
    fill: 'Faint staircase shading between the lines (higher ground lighter).',
    major: 'Draws every Nth line heavier, like the index contours of a survey map.',
    audioSwell: 'Each level thickens with its own frequency band : low ground follows the bass, high ground the treble. 0 = off.'
  },
  'grid-drift': {
    cells: 'How many cells fit across the frame height.',
    rate: 'Tempo of the breathing and the slips. Changes glide from the current picture, no jump.',
    breathe: 'How far each row and column wanders out of line, each on its own slow noise.',
    slip: 'How often the stepped clock knocks a whole lane sideways.',
    lineW: 'Line weight as a share of a cell (never thinner than about a pixel and a half).',
    density: 'Share of cells filled with a matte tone, re-dealt on every slip step.',
    audioScatter: 'Each row and column shifts with its own sample of the live audio waveform (rows read the first half, columns the second). 0 = off.',
    reseed: 'RESEED ▸ : re-deal every lane and fill at once. Press it, send OSC, or bind a modulator.'
  },
  'ten-print': {
    cells: 'How many cells fit across the frame height.',
    thickness: 'Stroke weight as a share of a cell (never thinner than about a pixel and a half).',
    bias: 'Odds of / versus \\ : 0.5 = a fair coin; toward 0 or 1 the maze leans into long diagonal runs.',
    flip: 'Ticks per second of the flip clock : on each tick a sparse few cells swap their stroke. 0 = the maze holds still until you reseed.',
    audioScatter: 'Turns each diagonal (or swells each arc) by its own sample of the live audio waveform : the maze shivers apart with sound and reconnects in silence.',
    accent: 'Share of strokes drawn in the accent tint.',
    style: 'Diagonals = the classic slash maze. Arcs = a quarter circle at two opposite corners of each cell : a maze of winding curves.',
    reseed: 'RESEED ▸ : deal a whole new maze (rising edge). Bind a modulator to an audio source to re-deal on every hit.'
  },
  'particle-drift': {
    count: 'Grid size : how many particle cells fit across the frame height.',
    speed: 'How fast the field travels along the flow. Changes glide, no jump.',
    flow: 'Direction of travel, in radians : 0 = right, 1.57 = up, 3.14 = left, 4.71 = down. Turning it bends the path, no jump.',
    size: 'Point size as a share of a cell (tiny points dim instead of flickering).',
    trail: 'Length of the streak behind each point, in cells.',
    fade: 'Trail brightness from head to tail : 0 = even dashes, 1 = a bright head fading to nothing.',
    jitter: 'How far each point wanders around its place in the grid.',
    vary: 'How different the points are from each other : size, brightness, trail length and wander speed.',
    density: 'Share of cells that hold a point : 1 = every cell, lower = sparser and less grid-like.',
    audioPulse: 'Each point listens to its own frequency band and swells (size and brightness) with it. 0 = off.'
  },
  'node-parallax': {
    amount: 'Parallax strength : how far near features shift relative to far ones. Needs the Depth engine on (header).',
    angle: 'Direction the parallax pushes.',
    sway: 'Animated camera drift — gives constant parallax motion even on a still image.',
    dof: 'Depth-of-field : blur that grows with distance from the focus plane.',
    focus: 'The depth that stays sharp (the focal plane).',
    fog: 'Aerial recession : the far distance sinks toward black.',
    invert: 'Flip near ↔ far.',
    wet: 'Dry/wet against the untouched image.'
  },
  'node-chronoscan': {
    source: 'What sets each pixel’s age into the frame history : SLIT-SCAN (a moving gradient — the scanner smear) · LUMA self (the image’s own brightness) · LUMA sidechain (another layer’s brightness as the clock).',
    reach: 'How far back the oldest regions read (up to ~32 frames of history).',
    angle: 'Direction of the slit-scan gradient (slit-scan control only).',
    sweep: 'Speed the slit-scan gradient drifts (a moving slit). 0 = static.',
    curve: 'Bends the time distribution : <1 crowds regions near the present, >1 near the past.',
    invert: 'Flip the age mapping (present ↔ past).',
    smooth: 'Cross-fade between the two nearest frames (smooth) vs. snap to one (stepped).',
    mix: 'Dry/wet against the live image.'
  },
  'node-sediment': {
    deposit: 'How strongly the present is laid down into the long memory.',
    decay: 'How slowly the memory fades : low = seconds, high = many minutes (the peaks sink back to black over this time).',
    resurface: 'How much of the old memory bleeds back under the live image.',
    age: 'Which past to resurface : 0 = the recent long-exposure accumulator, → 1 = the oldest kept keyframe (minutes ago).',
    interval: 'Seconds between keyframe snapshots. 16 slots × this = how far back the recallable past reaches.',
    stir: 'Slowly drifts the resurfaced memory so it sediments and wanders, rather than sitting as a frozen loop.',
    blend: 'How the memory combines with the live image : screen · lighten · under · difference.',
    mix: 'Dry/wet against the live image.'
  },
  'node-scanner': {
    mode: 'LOOP scans forever (continuous live slit-scan) · ONE-SHOT does a single pass on a trigger, then holds the frozen document.',
    axis: 'Which way the scan head sweeps : down / up / right / left.',
    scanRate: 'How fast the head sweeps (passes per second). Slow = long time-smear; fast = a quick refresh.',
    drag: 'Steady shear of the capture — the paper sliding under the head as it scans (diagonal smear).',
    wobble: 'A slow hand-wave across the sweep : wavy, organic distortion.',
    jitter: 'Random per-line horizontal rips (the digital tear).',
    tear: 'Chunkiness of the rips : low = per-line, high = torn in fat slabs.',
    rgb: 'CCD channel misregistration : splits R/G/B sideways (colour-fringe scanner artifact).',
    bar: 'Brightness of the moving scan bar (the bright line at the head). 0 hides it.',
    trig: 'FIRE a fresh scan pass on the rising edge. Press the button, send it over OSC, or bind a modulator (M) — a square LFO / sample&hold / audio edge — for rhythmic live re-scans.'
  },
  'node-autocutter': {
    cuts: 'How many pieces the frame is chopped into (recursive splits).',
    rotate: 'What fraction of the pieces get turned 90°/180°/270°.',
    slip: 'Nudges each piece’s source region — extra displacement / tearing.',
    gap: 'Dark seams drawn between the pieces (the collage cut lines).',
    mix: 'Blend of the rearranged cut-up against the untouched original.',
    rate: 'Auto re-cut rate (Hz) : >0 re-cuts on its own for hands-free live rhythm. 0 = only on trigger.',
    trig: 'Make a fresh cut on the rising edge. Press FIRE, send OSC, or bind a modulator (M) for rhythmic cutting.'
  },
  'gen-collage': {
    cuts: 'How many pieces the frame is cut into.',
    shape: 'CUT-UP = recursive rectangles. MOSAIC = irregular polygon shards.',
    feed: 'FOLDER = every piece plays a film from the scanned folder. ASSEMBLAGES = every piece plays one of the saved edits picked under "edits…" (the folder stands in while none are picked).',
    films: 'How many films play at once (each is a decoder). More pieces than films is fine : the extra pieces show the same film at another crop.',
    hold: '0 = each piece plays its whole film on a loop, with no seeking (the smoothest). A length in seconds = each piece loops a window that long inside its film instead.',
    churn: 'Fraction of the pieces that switch to another film on their own quick clock, between deals. 0 = every piece holds; 1 = every piece is its own little montage.',
    speed: 'Playback speed of every film, on top of the layer Speed.',
    vary: 'Gives each piece its own speed around speed : 0 = all in step, 1 = anywhere from half to double.',
    freeze: 'Stops every piece on its current frame; auto deal and churn wait too. A deal still re-deals the stopped wall.',
    zoom: 'Crops tighter into each film.',
    rotate: 'What fraction of the pieces are turned 90°, 180° or 270°.',
    gap: 'Dark seams between the pieces.',
    contour: 'Bends the straight cut lines into wandering, frayed curves.',
    curve: 'Wavelength of the contour : low = many small waves, high = a few long sweeping curves.',
    contourMode: 'WARPED = contour ripples the film inside each piece too. NORMAL = only the cut edges fray; the picture stays straight.',
    torn: 'A pale, ragged torn-paper edge along every cut.',
    mask: 'Drops pieces out, leaving transparent holes the layers below show through. At 1 a single piece survives (a new one at each deal).',
    rate: 'Re-deals the whole wall every this many seconds (new films, new cut). 0 = only when you press deal.',
    xfade: 'Dissolve time from one deal to the next. 0 = a hard cut.',
    deal: 'Re-deal the wall now : new films, new cut. Press it, send OSC, or bind a modulator.'
  },
  'fx-vibe': {
    stops: 'How many palette stops (2–5) the image is re-coloured toward : the size of the colour map.',
    blend: 'Blend of the palette re-colour against the original colours.',
    dither: 'Ordered dithering : breaks up banding, adds fine texture.',
    mixSrc: 'Mix the original source colours back in over the palette map.',
    autoLevel: 'Auto-levels : stretches contrast to use the full range.',
    gamma: 'Midtone brightness (below 1 darkens mids, above 1 lifts them).',
    contrast: 'Overall contrast.',
    saturation: 'Colour intensity (0 = greyscale).',
    sharpen: 'Edge sharpening.',
    splitTone: 'Split-tone amount : tints shadows and highlights toward two hues.',
    shadowTint: 'Colour pushed into the shadows (split-tone).',
    highTint: 'Colour pushed into the highlights (split-tone).',
    harmony: 'Nudges the palette hues toward a harmonic relationship.',
    baseHue: 'Base hue the generated palette is built around.',
    chroma: 'Palette colourfulness / saturation.',
    spread: 'Hue spread across the palette stops.',
    colorA: 'Palette stop A : a colour the image is mapped toward (darkest).',
    colorB: 'Palette stop B : a colour the image is mapped toward.',
    colorC: 'Palette stop C : a colour the image is mapped toward.',
    colorD: 'Palette stop D : a colour the image is mapped toward.',
    colorE: 'Palette stop E : a colour the image is mapped toward (lightest).'
  },
  'fx-context': {
    voidEdge: 'VOID : the frame’s edges dissolve into the dark with a ragged, slowly breathing boundary (an erosion eating inward, not a clean vignette). 0 = off.',
    trails: 'Temporal colour bleed : past frames linger and drift into the distance.',
    blur: 'Soft spatial blur : takes the edge off, pushes things back in space.',
    bloom: 'Highlights glow / bleed light : dreamier, more luminous.',
    depth: 'Vignette + aerial recession that seats the image in a volume.',
    haze: 'Atmospheric veil toward the atmosphere colour : distance, air.',
    atmosphere: 'The colour the haze / aerial perspective tints toward.',
    lightGlow: "A soft key light's glow strength.",
    lightSize: 'Light spread : a tight spot (0) → a broad ambient wash (1).',
    lightColor: 'Colour of the key light.',
    light: 'Position of the key light (drag the XY pad).',
    pbrTexture: 'PBR material the whole composition is mapped onto (projector-on-surface look).',
    pbrAmount: 'RELIEF : how deep the material is — how far the image sinks into crevices and rides over bumps, and how much the surface relights it. 0 = flat passthrough.',
    pbrLight: 'RAKING : how hard the light grazes the material — independent of relief depth. Low = soft, even, front-lit. High = a low grazing light that throws long, near-black cast shadows in the crevices and hot specular sheen on the ridges (deep chiaroscuro contrast). Turn this up when the relief looks too flat.',
    pbrScale: 'Tiling scale of the PBR material : how many times it repeats across the frame.',
    pbrDepth: 'FIELD DEPTH : viewing distance. 0 = pressed against your eye (dense parallax, raking contrast). Up = you step back — the material tiles finer, the relief flattens, the light reads softer and more ambient, and the surface settles toward the atmosphere colour.'
  },
  'fx-finalizer': {
    black: 'Input black point : lifts or crushes the shadows (Levels).',
    white: 'Input white point : where the highlights clip (Levels).',
    gamma: 'Midtone brightness (Levels).',
    rGain: 'Red gain : tints the whole output.',
    gGain: 'Green gain : tints the whole output.',
    bGain: 'Blue gain : tints the whole output.',
    alpha: 'Output opacity.',
    sharpen: 'Final edge sharpening over the whole frame.',
    character: 'Grain character : digital sensor / film / CRT / VHS.',
    grain: 'Grain amount over the whole output.',
    grainSize: 'Grain particle size.',
    chroma: 'Colour noise in the grain.',
    parasites: 'Only with the crt / vhs character. VHS : wobbling line edges, the head-switch tear at the bottom, single-scanline dropouts (white, a few dark) that fade over a tail and come in bursts; high up, a drifting tracking band. CRT : a soft hum bar rolling up, a faint RF weave, short impulse specks.',
    stereo: 'Render the output as red/cyan anaglyph 3D (needs red/cyan glasses). Gray = half-colour, gentler on the eyes for abstract relief.',
    stereoDepth: 'Strength of the 3D relief : how far the red/cyan eyes separate with depth.',
    stereoConv: 'Convergence : which depth sits ON the screen plane. Negative pushes forms OUT toward you (pop-out).',
    stereoInvert: 'Flip the depth reading (dark = near instead of bright = near).',
    filmHold: 'Cameraless / direct-film: hold the output on a hand-drawn draw clock. Film-hold = live process stepped; Freeze = a held cell that still weaves in the gate. (Distinct from the Transport Shutter, which is a global full-freeze stop-motion.)',
    filmRate: 'Draw frame rate : how many drawn frames per second (2–12 reads as hand-made film).',
    filmJitter: 'Irregularity of the draw-clock interval : hand timing is never metronomic.',
    filmBoil: 'Registration jitter : gate weave + hand-registration error (the "boil"), re-rolled per drawn frame.',
    filmFlutter: 'Per-frame density/luminance pump : uneven hand-painted exposure.',
    filmBlank: 'Chance a drawn frame shows blank leader instead of the picture (Blinkity-Blank intermittence).',
    filmBlankMode: 'Leader colour for blanks : black gap, white clear-leader flash, or both.',
    filmDust: 'Dust and dirt on the film : a new set every film frame (24 fps, 18 on Super 8), mostly tiny specks, a few big ones, the odd fibre. 0.15 is a clean print, 0.5 a worn one, 1 a trashed one. Works with Film Hold off too.',
    filmScratch: 'Scratches running along the strip : each lasts from a fraction of a second to a minute, wanders slowly sideways, breaks up and fades. Mostly dark (the print), some white or coloured.',
    filmHair: 'A hair caught in the projector gate : hangs in from an edge, trembles, stays a few seconds to a minute, then goes. Higher = there more of the time.',
    filmGauge: 'Film size : the same dust is about 4 times bigger on Super 8 than on 35 mm. Also sets the film speed (24 fps, Super 8 18).',
    filmDirt: 'Which film the dirt was on : the print shows it dark, the negative prints it as white sparkle. Mixed = both.',
    filmGranule: 'Dye granulation / pooling : coarse clumped coloured mottle (the "paint" of hand-painted film).',
    filmSplice: 'Rare splice punctuation : a whole-frame flash + a bright horizontal bar.',
    outShape: 'Clip the finished frame into a silhouette (none = full frame).',
    outSize: 'Size of the output shape.',
    outAngle: 'Rotation of the output shape.',
    outPosX: 'Horizontal position of the output shape.',
    outPosY: 'Vertical position of the output shape.',
    outBgSource: "What fills OUTSIDE the shape : a solid colour or the Background layer (moved here).",
    outBgColor: "Fill colour outside the shape (when 'color' is chosen).",
    outDepth: 'Soft drop shadow : makes the shape float over the fill.',
    outShadowAngle: "Direction the shape's shadow falls (light angle).",
    outPerspective: 'Rakes the shadow onto a receding ground plane : adds depth realism.'
  },
  'gen-text': {
    font: 'The typeface. Each font has its own weight range; a font with a single weight greys out the weight dial.',
    size: 'Letter size : the em height as a share of the frame height (0.25 = a quarter of the frame).',
    weight: 'Stroke weight, 100 thin to 900 black, within what the chosen font really has : beyond its range it holds at the nearest weight (never a faked bold).',
    spacing: 'Extra space between letters, in em (0.1 = a tenth of the letter size). Negative tightens.',
    stretch: 'Stretches the letters along their own vertical axis : above 1 tall and condensed, below 1 squat.',
    angle: 'Rotation of the whole text block (radians).',
    posX: 'Horizontal position : ±1 puts the center of the text on the frame edge.',
    posY: 'Vertical position : ±1 puts the center of the text on the frame edge.',
    scroll: 'Crawls the text along its own baseline like a ticker, in frame widths per second (positive runs right to left). It loops once the text has fully left the frame. 0 = still.',
    fit: 'Shrinks the text so the whole block stays inside the frame (it never enlarges it). While crawling only the height is fitted.',
    drift: 'Each letter wanders and tilts on its own slow path : 0 = still type, 1 = restless letters.',
    reveal: 'Typewriter : the share of the characters shown, in reading order. Bind a modulator to type the words on.',
    lines: 'ALL shows every line (type \\n in the text for a new line). ONE AT A TIME shows a single line, and NEXT LINE ▸ steps to the following one : lyric or word cues.',
    line: 'NEXT LINE ▸ : show the next line, wrapping after the last (one at a time only). Rising edge : over OSC send 1 then 0.',
    color: 'Letter color; its alpha fades the letters. With a fill layer chosen, the color tints that layer inside the letters.'
  },
  'gen-parametric': {
    mode: 'RASTER = columns that light when their band is loud enough, with scanning seams. WAVEFORM = the wave as a trace. BARS = the spectrum as bars. SPECTROGRAM = the spectrum over time, newest row at the top. Frequencies run bass (left) to treble (right).',
    gain: 'Input amplification before drawing.',
    scale: 'Depends on the mode. Raster : how many columns. Waveform : trace thickness. Bars : how many bars. Spectrogram : contrast (low shows quiet detail, high keeps only the peaks).',
    scan: 'Raster : how fast the seams scroll. Spectrogram : how fast the history scrolls. No effect on waveform and bars.',
    mono: 'On : white marks. Off : marks in the color.'
  }
}
