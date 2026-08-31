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
    rate: 'How often a new form is born from inside the old one.',
    size: 'The organism’s resting size.',
    wobble: 'Boil on the outline : the silhouette’s rim churns.',
    complexity: 'Body warp : from a soft blob toward a carved, asymmetric figure.',
    drift: 'How far the lineage wanders around the frame between generations.',
    inner: 'Faint interior shading so the form reads as a body, not a flat sticker.'
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
    parasites: 'CRT/VHS interference (head-switch tear, dropouts) : only with the crt/vhs character.',
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
    filmDust: 'Direct-on-film dirt & hair : sparse dark specks that sparkle frame to frame (+ rare bright emulsion pits).',
    filmScratch: 'Tramline scratches : near-vertical white lines that persist across several drawn frames.',
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
  }
}
