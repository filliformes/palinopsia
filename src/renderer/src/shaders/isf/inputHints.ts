// Plain-English hover-help for shader inputs, keyed by shaderId → inputName.
// Surfaced by AutoControls in each control's title (appended to the label).
// Focused on the always-on finalizers (Vibe · Context · Finalizer) : the params
// a first-timer meets in Finishing and can't guess from the label alone.

export const INPUT_HINTS: Record<string, Record<string, string>> = {
  // ── Silhouette (the Body camera's cutout) ───────────────────────────
  'gen-silhouette': {
    mode: 'Cutout : the camera where the body is, nothing elsewhere (background removal). Matte : a white body on black, to key another layer or feed a Matte node. Shadow : a flat colored silhouette. Hole : the room with the body taken out.',
    threshold: 'Where the edge falls on the body mask : lower takes in more (hair, loose clothes, a halo), higher keeps only the certain body.',
    softness: 'How soft the edge is : 0 is a hard cut, higher feathers it.',
    trail: 'Echoes : the body leaves fading copies of itself behind as it moves. 0 = none, 1 = several seconds.',
    color: 'Color and opacity of the shadow (shadow mode).',
    fit: 'Cover fills the frame with the camera image (cropping its edges); contain shows all of it, with empty bands.'
  },
  // ── Color, tone and geometry rack FX ─────────────────────────────────
  'fx-chroma-shift': {
    amount: 'How far red and blue are pulled apart, in frame widths (0.006 ≈ 11 px at 1080p). The same length at every angle.',
    angle: 'Direction of the split (radians) : 0 = horizontal, 1.57 = vertical.'
  },
  'fx-colorizer': {
    gain: 'Contrast of the brightness signal about mid-gray before it is colored. Above 1 pushes the darks and lights out of range, where fold takes over.',
    bias: 'Shifts the brightness signal up or down before coloring : more of the picture lands on the high or the low color.',
    fold: 'What happens to the signal that gain and bias push out of range : 0 = it clips flat at the low and high colors, 1 = it reflects back in, carving extra color bands. Does nothing until gain or bias push the signal out of range.',
    mixSrc: 'Blends the original colors back over the map : 0 = pure map, 1 = the untouched source.',
    low: 'Color for the darks.',
    mid: 'Color for the mid-tones.',
    high: 'Color for the lights.',
    invert: 'Runs the map backward : darks take the high color and lights the low one, a color negative.'
  },
  'fx-grade': {
    brightness: 'Adds or removes light evenly across the whole range.',
    contrast: 'Spreads (above 1) or flattens (below 1) the tones about mid-gray.',
    saturation: '0 = grayscale, 1 = unchanged, 2 = doubled color.',
    lift: 'Raises black toward gray : a matte floor, the shadows never reach pure black.',
    gamma: 'Bends the mid-tones without moving black or white : above 1 opens them (lighter), below 1 sinks them (heavier).'
  },
  'fx-hue-rotate': {
    shift: 'How far every color turns around the color wheel : 0.5 = the complementary color, 1 = a full turn back to the start.',
    byLuma: 'Weights the shift by brightness : positive turns the lights further than the darks, negative the reverse, 0 = even.',
    rate: 'Keeps the wheel turning on its own, in turns per second (0.02 = one turn every 50 s). Back to 0, the cycle stops where it is; PANIC returns it to the start.'
  },
  'fx-palette': {
    stops: 'How many of the five colors the ramp uses, from A (darks) upward : white lands on the last one used.',
    blend: '0 = hard bands of flat color (posterized), 1 = a smooth gradient between the stops.',
    dither: 'Breaks the band edges up with an ordered dot pattern, the classic way to fake in-between shades with few colors.',
    mixSrc: 'Blends the original colors back over the map : 0 = pure map, 1 = the untouched source.',
    colorA: 'First stop : the shadows and black.',
    colorB: 'Second stop.',
    colorC: 'Third stop (the lights when stops = 3).',
    colorD: 'Fourth stop (used when stops ≥ 4).',
    colorE: 'Fifth stop (used when stops = 5).',
    cycle: 'Color cycling : slides the picture along the ramp and back, in ramp lengths per second. Back to 0, it stops where it is; PANIC returns it to the start.'
  },
  'fx-rgb-shift': {
    offset: 'How far red and blue are pushed apart along the angle, in frame widths (green holds still).',
    scale: 'Scales red and blue in opposite ways about the center (red smaller, blue larger), so the split grows toward the edges.',
    angle: 'Direction of the offset (radians) : 0 = horizontal, 1.57 = vertical.',
    wobble: 'Makes the split breathe in and out. 0 = still.',
    wobRate: 'Speed of the breathing (Hz). The default is the original slow breath.'
  },
  'fx-solarize': {
    level: 'Brightness above which the picture inverts.',
    strength: 'How far the bright side inverts : 1 = a full negative above the level.',
    soft: 'Width of the knee around the level : small = a hard line where the inversion starts, large = a gradual turn.'
  },
  'fx-wavefold': {
    fold: 'Drive into the folder (1× at 0, 6× at 1) : more drive, more reflections, more contour bands.',
    bias: 'Offsets the signal before folding : moves where the bands fall and lifts or sinks the darks.',
    symmetry: 'Bends the drive into a curve before folding : 0 = evenly spaced bands, 1 = the bands crowd toward the lights.',
    perChannel: 'Folds red, green and blue separately, tearing the color into bands. Off = folds the brightness and keeps the source hue.',
    wet: 'Dry/wet against the untouched source.',
    invert: 'Folds into the negative : the darks go light. Off = black stays black.'
  },
  'fx-fold': {
    vertical: 'Off = the fold line is vertical (the left part mirrors onto the right). On = horizontal (the bottom mirrors upward).',
    seam: 'Where the fold line sits : past it, the picture is a reflection of what lies before it. Below the middle the reflection runs past the far edge and folds again, like folded paper. One deliberate fold, never a kaleidoscope : searching "kaleidoscope" lands here on purpose.',
    offset: 'Slides the reflected half along the fold line so the mirror image does not line up : the asymmetry that keeps it from reading as a plain mirror.'
  },
  'fx-transform': {
    zoom: 'Frame mode : magnification (below 1 shrinks the picture). Shape mode : the size of the shape.',
    posX: 'Frame mode : pans the picture. Shape mode : moves the shape (±1 = the frame edge).',
    posY: 'Frame mode : pans the picture. Shape mode : moves the shape (±1 = the frame edge).',
    rotate: 'Frame mode : turns the picture (radians). Shape mode : spins the shape.',
    wrap: 'On = the picture tiles endlessly past its edges. Off = the uncovered area is empty (transparent), so the layers below show through.',
    cropUp: 'Cuts the top edge to black (to transparent with cutout). A fixed matte : it does not move with zoom or pan.',
    cropDown: 'Cuts the bottom edge to black (to transparent with cutout). A fixed matte : it does not move with zoom or pan.',
    cropLeft: 'Cuts the left edge to black (to transparent with cutout). A fixed matte : it does not move with zoom or pan.',
    cropRight: 'Cuts the right edge to black (to transparent with cutout). A fixed matte : it does not move with zoom or pan.',
    shape: 'NONE = the zoom / pan / rotate frame. Any shape instead clips the layer into that silhouette : zoom, pos and rotate then size, move and spin the shape while the picture stays put.',
    cutout: 'Makes the crop margins and the outside of the shape transparent instead of black, so a circle becomes a picture-in-picture over the layers below.'
  },
  'fx-distort': {
    mode: 'Which warp. Amount and center drive every mode. Scale : all but bulge, pinch and shear. Angle : wave, shear, glass, corrugate, pull and turbulent. Rate (motion) : wave, ripple and turbulent; the others are still.',
    amount: 'Strength of the warp.',
    scale: 'Wave and ripple frequency, swirl tightness, glass and rib count, pull falloff, turbulence grain. Unused by bulge, pinch and shear.',
    center: 'The pivot or origin of the warp (the eye of a ripple, bulge, pinch, swirl or pull; the phase origin of a wave).',
    angle: 'Orientation for wave, shear, glass, corrugate, pull and turbulent (radians).',
    rate: 'Motion speed for wave, ripple and turbulent.',
    audio: 'RIPPLE only : each ring rides its own band of the live spectrum (bass in the middle, treble outward), so the rings swell with the music and silence flattens them. 0 = plain rings.'
  },
  'fx-displace': {
    amount: 'How far the noise field pushes the picture (fraction of the frame).',
    scale: 'Noise cells per frame height : small = broad slow bends, large = fine nervous ripples.',
    rate: 'How fast the noise field drifts.'
  },
  'fx-edge': {
    gain: 'Line strength : higher catches fainter contours and thickens the lines.',
    blend: 'Mix over the source : 0 = untouched, 1 = only the lines.',
    ink: 'On = the outlines are drawn dark over the picture itself (pen and ink). Off = light lines on black.'
  },
  'fx-sharpen': {
    amount: 'Detail lift : around 1 is crisp, above 3 the edges ring with halos.'
  },
  'fx-motif': {
    copies: 'How many echoes. Each one is transposed one step further : offset, rotation and scale compound.',
    offX: 'Horizontal step from one echo to the next (frame widths).',
    offY: 'Vertical step from one echo to the next (frame heights).',
    rotate: 'Turn added per echo (radians).',
    scale: 'Size factor per echo : below 1 each echo is smaller.',
    fade: 'Strength of the first echo; each further one is fainter (fade², fade³).',
    invert: 'Mirrors the echoes left to right.',
    mode: 'How the echoes combine. OVER lays each echo on top where it has content (its dark ground lets the picture through). ADD brightens and can burn bright material to white. SCREEN brightens gently. MAX keeps the brighter of the two.',
    audio: 'Echo 1, 2 and 3 ride the low, mid and high bands of the live spectrum : a loud band brings its echo up, silence fades it by this amount. 0 = off.'
  },
  'node-eternalism': {
    mode: 'HOLD = the newest frame and the one a GAP before it, alternated across a black shutter (a held micro-motion going nowhere). DRIFT = two delayed copies beating in and out of lock (phase-drift twins).',
    gap: 'HOLD : how many frames apart the two alternating frames are (the size of the time-slice). DRIFT : the delay of the first copy.',
    rate: 'HOLD only : the shutter flicker rate. ~3–12 Hz shimmers (sub-fusion); higher fuses. Safe to modulate : the flicker speeds up or slows down, never jumps.',
    interval: 'HOLD only : size of the BLACK shutter gap between the two frames (the interval that becomes an image). On a transparent layer the shutter empties the layer instead.',
    detune: 'DRIFT only : how fast/far the two copies’ delay drifts apart → the beat in and out of sync. At 0 the twins lock exactly.',
    tint: 'DRIFT only : amber cast on the second (slightly larger) twin.',
    freeze: 'Stops recording : the ring keeps the frames it holds, so HOLD alternates the SAME pair for good (the true eternalism) and DRIFT beats among frozen frames. Off to follow the live picture again.',
    mix: 'Dry/wet against the live image.'
  },
  'node-afterimage': {
    decay: 'How long the ghost lingers : low = a fraction of a second, high = many seconds.',
    amount: 'Strength of the afterimage ghost.',
    chroma: '0 = a dark subtraction where the bright form was (pure Goethe). 1 = its complementary color (a red form leaves a cyan ghost).',
    dwell: 'How slowly the eye adapts to light : 0 = at once (every bright form leaves a full ghost), up = only forms that stayed a while leave a strong ghost, a quick flash a faint one.',
    mix: 'Dry/wet against the live image.'
  },
  'node-decimate': {
    mode: 'CLOCK samples a fresh frame every 1/rate seconds (the time-lapse clock). HOLD freezes the picture and only re-samples when you fire the trigger.',
    rate: 'CLOCK mode : how often it grabs a fresh frame (Hz). Low = chunky time-lapse steps, high = near-passthrough. In HOLD mode it still sets how long the tween lasts (one 1/rate interval).',
    sync: 'Lock the CLOCK to the tempo : a fresh frame every quarter, eighth or sixteenth note (RATE is then ignored). FREE uses RATE.',
    smooth: 'Tween between the last two grabs : 0 = a hard snap on each sample, 1 = a continuous morph across the whole interval (slow-motion).',
    trig: 'SAMPLE ▸ : grab a fresh frame now (rising edge). In HOLD mode this is the only way to refresh; in CLOCK mode it forces an extra sample and restarts the clock. Bind a modulator (square/S&H/audio) to sample on the beat.',
    mix: 'Dry/wet against the live image.'
  },
  'node-corrode': {
    bury: 'The time to full corrosion, on a log scale : 0 = about an hour, 0.5 ≈ 8 minutes, 1 = a minute. The mask ONLY ever grows : it eats the picture over that time and never recovers until you EXHUME. On the Master rack it weathers the whole set.',
    spread: 'How far the corroded zones creep outward into clean areas over the BURY time (the migrating front) : 0 = the blotches only appear, 1 = the fronts travel a quarter of the frame.',
    eat: 'How deeply corroded zones are removed, from a faint stain to fully eaten.',
    eatTo: 'What the corroded zones become : a STAIN (see TONE) or TRANSPARENT, so the layers below show through the holes (the cracks stay as dark lines).',
    tone: 'The stain color : 0 = leader-dark (near-black), 1 = a sepia / rust stain.',
    crackle: 'Reticulation : thin cracked-émulsion lines through the corroded zones.',
    reset: 'EXHUME ▸ : clears all accumulated corrosion and re-rolls the blotch pattern, starting the weathering fresh. Press it, send OSC, or bind a modulator.',
    mix: 'Dry/wet against the untouched image.'
  },
  'node-pulfrich': {
    mode: 'ANAGLYPH = a red/cyan stereo pair (needs glasses) : real depth on lateral motion. FREE = a glasses-free horizontal parallax slide, gated by motion.',
    source: 'What keys the per-pixel eye-delay : the Depth map (real 2.5D, needs the Depth engine on; with Depth off it falls back to luminance) or the image’s own LUMINANCE (bright = near).',
    delay: 'Maximum eye-delay for the nearest (or brightest) plane, in 60 Hz frames (1 = 17 ms). Bigger = deeper 3D but more doubling on fast motion.',
    curve: 'Bends how depth maps to delay : below 1 spreads the delay back into the middle and far planes, above 1 keeps it on the nearest (brightest) planes.',
    zero: 'The depth (or brightness) that gets no delay. 0 = everything lags in one eye by its depth. Raised, the planes beyond it lag in one eye and the planes before it in the other, so they sit in front of and behind the screen. ANAGLYPH mostly.',
    separation: 'ANAGLYPH : amplifies the red/cyan disparity. FREE : the horizontal slide distance.',
    desat: 'ANAGLYPH only : desaturate the eyes toward gray to curb retinal rivalry (ghosting/eye-strain) in the glasses. It also tints a still picture.',
    swap: 'Flip which eye carries the lag (near ↔ far, left ↔ right). Fixes inverted or reversed depth.',
    mix: 'Dry/wet against the live image. The disparity is temporal, so a still picture shows no color fringes.'
  },
  'node-melt': {
    amount: 'How strongly the seams dissolve, and how long the melted front holds before it fades (a fraction of a second up to about 5 s).',
    width: 'How far from an edge the melt can reach (and how wide the seam band is). Also speeds the creep.',
    dir: 'The creep : above 0 the bright side of each edge bleeds outward, below 0 the dark side eats in, a few pixels a second. 0 = no creep, only a ghost of edge motion.',
    gate: 'Which edges melt : low = even faint edges, high = only strong contrast boundaries.',
    mix: 'Dry/wet against the live image.'
  },
  'node-faultline': {
    type: 'The fault each fire throws : DROPOUT (streaks that lose lock and collapse toward black), CUT (a hard cut to the frame grabbed at the fire), TIMEBASE (scanline blocks shear sideways, the field rolls), NOISE (a band of switching static), or ROULETTE (a fresh pick each fire).',
    rate: 'How often the clock offers a chance to fire (Hz). 0 = only the trigger fires.',
    sync: 'Lock the clock to the tempo : a chance to fire every quarter, eighth or sixteenth note (RATE is then ignored). FREE uses RATE.',
    dirt: 'The odds that each clock tick actually fires : low = rare, skipping faults, 1 = every tick.',
    depth: 'Severity of each fault.',
    hold: 'How long each fault lasts, in seconds. The picture is untouched between faults.',
    trig: 'FIRE ▸ : throw one fault now (rising edge). Press it, send OSC, or bind a modulator.'
  },
  'node-ibfv': {
    flow: 'How far the dye travels along the flow : the length of the streaks.',
    inject: 'How fast fresh noise replaces the dye : low = long smears that remember, high = short trails close to the grain.',
    scale: 'The noise grain size : low = large soft blotches, high = fine grain.',
    scan: 'How fast the grain slides sideways : 1 = the classic look, horizontal tape-like streaks through the wake; 0 = the grain pulses in place, with no built-in direction (only the flow draws the streaks).',
    field: 'Strength of the always-moving curl swirl, so even a still picture streams.',
    motion: 'How much the picture’s own movement drags the dye along.',
    angle: 'Direction of the WIND (one turn over the knob).',
    push: 'Strength of the wind pushing the whole wake one way.',
    swirl: 'Rotation about the swirl point : 0.5 = none, below = one way, above = the other (a spiral).',
    swirlX: 'Horizontal position of the swirl point.',
    swirlY: 'Vertical position of the swirl point.',
    ground: 'Keeps the noise off the dark parts of the picture : 0 = the grain fills the whole frame (a gray bath), 1 = black stays black and only the wake of lit forms streams over it.',
    dye: 'Tints the noise with the picture’s own colors : 0 = gray grain, 1 = the picture’s material flowing.',
    speed: 'How fast the flow field churns and the grain changes.',
    mix: 'Dry/wet against the live image.',
    clear: 'CLEAR ▸ : restart the wake from the live frame.'
  },
  'node-toile': {
    radius: 'The brush : how big the paint strokes are (the same share of the frame at any output size).',
    sharp: 'How hard the paint flattens : low = soft, edge-preserving smoothing, high = flat poster-like patches.',
    paint: 'How far toward the painting : 0 = the untouched picture (lines only).',
    strokes: 'The paint texture : CRISP = hard-edged, blocky dabs (the classic look), SMOOTH = soft, blended strokes.',
    line: 'Inks the contours with dark outlines that follow the picture’s structure.',
    threshold: 'How strong an edge must be to get a line : low = many fine lines, high = only the main contours.',
    mix: 'Dry/wet against the live image.'
  },
  'node-remap': {
    mode: 'ABSOLUTE : the map’s red and green are the position each pixel reads from (a gradient map shows the picture, a noisy one shatters it). OFFSET : red and green around mid-gray nudge each pixel from where it is.',
    amount: 'How far toward the remapped picture : 0 = untouched.',
    scale: 'Multiplies the map’s range : above 1 zooms the coordinates out (tiles or folds with EXTEND), below 1 squeezes them.',
    offsetX: 'Slides the map’s coordinates sideways.',
    offsetY: 'Slides the map’s coordinates up or down.',
    extend: 'What lies past the frame edge : HOLD the edge pixels, REPEAT the picture, or MIRROR it.',
    swap: 'Swaps the roles : this layer becomes the map and the sidechain the picture.',
    mix: 'Dry/wet against the live image.'
  },
  'node-lumablur': {
    control: 'What sets the blur width : the BRIGHTNESS of the control (the sidechain, or this layer), or DEPTH FOCUS : the distance from the FOCUS plane in the depth map (brightness when Depth is off).',
    blackWidth: 'Blur width where the control is dark, in 1080p pixels.',
    whiteWidth: 'Blur width where the control is bright, in 1080p pixels.',
    gamma: 'Bends the control : above 1 keeps the blur on the brightest (or farthest from focus) parts, below 1 spreads it.',
    focus: 'DEPTH FOCUS : the plane that stays sharp (0 = far, 1 = near).',
    invert: 'Swaps dark and bright in the control.',
    quality: 'FAST (8 taps) and FINE (16 taps) keep stepped ghost copies of edges on wide blurs; SMOOTH melts them into an even blur (a little more costly).',
    mix: 'Dry/wet against the live image.'
  },
  'node-gooey': {
    blur: 'How far shapes reach for each other before they melt together.',
    threshold: 'The level where the blob edge falls : low = fat blobs, high = only the brightest cores.',
    softness: 'How soft the blob edge is.',
    fill: 'What the blobs show : the crisp SOURCE (the blurred color in the gaps it bridges), the BLURRED COLOR pushed to full strength, or a white MATTE.',
    key: 'What the level reads : LUMA (brightness) or the BRIGHTEST CHANNEL (saturated colors count as bright).',
    outside: 'How much of the source survives around the blobs : 0 = black (or transparent on a transparent layer).',
    invert: 'Blobs from the dark parts instead of the bright ones.',
    mix: 'Dry/wet against the live image.'
  },
  'node-matte': {
    channel: 'What the matte is read from : its brightness, one color channel, or its alpha.',
    low: 'Matte level that counts as fully dark (input 2). Raise it to choke the key.',
    high: 'Matte level that counts as fully bright (this layer). Lower it to spread the key. LOW above HIGH inverts the ramp.',
    invert: 'Swaps the bright and dark sides of the matte.',
    swap: 'Swaps this layer and input 2.',
    empty: 'With no input 2 picked : BLACK where the matte is dark (on this layer’s own transparency), or TRANSPARENT, a cut-out that shows the layers below.',
    mix: 'Dry/wet against the live image.'
  },
  'node-lookup': {
    index: 'What picks each pixel’s color from the table : its BRIGHTNESS, each channel on its own (PER CHANNEL), or its HUE (grays and near-blacks keep their own color).',
    axis: 'The direction of the line drawn across the palette layer.',
    position: 'Where the line sits on the palette layer (for the diagonal, how far it slides toward a corner).',
    band: 'Averages a stripe around the line : calmer colors from a busy palette.',
    offset: 'Cycles the table : shifts every color along it.',
    cycles: 'Repeats the table across the brightness range (MIRROR folds instead of wrapping).',
    gamma: 'Bends the index : above 1 gives more of the table to the lights, below 1 to the darks.',
    mirror: 'Folds the repeated table back and forth instead of wrapping it.',
    mix: 'Dry/wet against the live image.'
  },
  'fx-force-lines': {
    lines: 'How many luminance-contour bands the picture is cut into : the lines of force.',
    shift: 'How far each band slides (adjacent bands shear opposite ways), in frame heights.',
    edge: 'Engrave the band boundaries as dark incrust lines.',
    gate: 'Confine the cutting to where there is real structure (gradient energy) : flat areas stay untouched.',
    amount: 'Dry/wet against the untouched image.',
    slide: 'Which way the bands slide. ALONG CONTOURS : the ribbons glide inside the forms (subtle on straight edges). ACROSS : the bands shear over each other. VERTICAL : every band drops or rises, with a gritty fringe along edges (the original look).',
    rate: 'Crawl : the band boundaries travel through the tonal range, so the contours creep over the picture. 0 = still.',
    vary: 'Gives each band its own slide distance (from half to one and a half times the slide).',
    audio: 'Each band slides further with its own part of the spectrum : dark bands ride the bass, bright bands the treble.'
  },
  'fx-abstraction': {
    amount: 'The one knob : from the picture as it is (0) to moving matter (1). Scales every other control.',
    disperse: 'How far the image is pushed along its luma-driven flow.',
    posterize: 'Quantizes the color toward fewer levels (strongest near the top of the range).',
    desat: 'Drains the color toward the image’s own light.',
    rate: 'How fast the flow direction turns over time.',
    coherence: 'Reads the flow from a small neighborhood instead of single pixels : 0 = textured areas scatter grain by grain, 1 = they move as one current.'
  },
  'fx-difference-bloom': {
    gain: 'How bright a given amount of motion glows.',
    spread: 'Radius of the halo around each moving contour, in frame heights. With soft spread at 0 the halo is a ring of eight echoes.',
    keep: 'Fades the source back in behind the motion (0 = only motion shows).',
    tint: 'The color of the motion light.',
    hold: 'Afterglow : seconds for the glow to halve after the motion stops. Also bridges the repeated frames of a slower video so the key does not blink. 0 = the raw frame-to-frame key.',
    soft: '0 = the octagonal ring of echoes. 1 = a smooth falloff from the center out.'
  },
  'fx-feedback-zoom': {
    zoom: 'Per-frame zoom of the echo (at 60 fps) : above 1 the echoes march outward, below 1 they recede inward.',
    twist: 'Per-frame turn of the echo (at 60 fps) : spirals.',
    amount: 'How much of each echo survives into the next : higher = longer trails.',
    center: 'The point the tunnel turns about.',
    drift: 'How far and how fast the tunnel’s center wanders around CENTER. 0 = locked on it.',
    edge: 'What fills in where the zoomed frame leaves the picture. LIVE : the fresh image (no echo there). BLACK : a nested frame. SMEAR : the border pixels stretch inward.',
    clear: 'CLEAR ▸ : wipes the echoes (hold to keep them wiped).'
  },
  'fx-granular': {
    grain: 'Grain size : low = big grains, high = fine grains.',
    density: 'The share of grains that are lit : low values open gaps that show the smeared background.',
    scatter: 'How far each grain lands from where it was cut.',
    rotate: 'How far each grain turns.',
    smear: 'How much each grain carries over from the previous frame. The echoes compound each grain’s turn and offset, so they spiral.',
    rate: 'How often the grain field re-rolls (which grains are lit, how each turns and lands). At 0 it still re-rolls every two seconds.',
    stagger: '0 = every grain re-rolls at once (the field re-cuts). 1 = each grain re-rolls on its own beat (a shimmer).',
    sizeVar: 'Scales each grain’s content on its own : some zoom in, some zoom out.',
    edges: '0 = hard-edged grains (crisp circles where a grain ends). 1 = the grains fade into the gaps.',
    audio: 'Each grain scatters further with its own band of the spectrum.'
  },
  'fx-light-trails': {
    decay: 'How long the trails last : 1 = permanent, lower = they fade faster. Per frame at 60 fps.',
    drift: 'The trail slides as it fades (per frame at 60 fps).',
    angle: 'Direction of the drift.',
    knee: 'Only light brighter than this enters the trail : 0 = everything leaves a trail, higher = only the highlights.',
    clear: 'CLEAR ▸ : wipes the trails (hold to keep them wiped).'
  },
  'fx-slit-buffer': {
    rate: 'How fast the write head sweeps (sweeps per second).',
    width: 'Softness of the write head : how wide a band it writes. It widens on its own when the head moves faster than the band.',
    jitter: 'Breaks the seam into a ragged edge that wanders band by band.',
    jumps: 'How often and how far the whole head teleports before or after its swept position.',
    vertical: 'Sweep top to bottom instead of left to right.',
    direction: 'NORMAL / INVERTED sweep direction, or PENDULUM (back and forth, no wrap seam).',
    angle: 'Tilts the slit (radians).',
    grab: 'GRAB ▸ : writes the whole live frame at once.'
  },
  'fx-smear': {
    reach: 'Length of the streak.',
    threshold: 'Only pixels brighter than this streak : the highlights run, the rest holds.',
    angle: 'Direction of the streak.',
    smoothing: '0 = a comb of discrete ghost copies (the stepped look). 1 = a continuous streak with a fine grain.'
  },
  'fx-streak': {
    reach: 'Length of the blur.',
    angle: 'Direction of the blur.',
    smoothing: '0 = discrete ghost copies (the stepped look). 1 = a continuous blur with a fine grain.'
  },
  'fx-wide-time': {
    width: 'How far back the memory reaches, in frames at 60 fps (about width/60 seconds), the same at any frame rate.',
    amount: 'Dry/wet against the live image.',
    mode: 'How each frame accumulates. MEAN : a time average. BRIGHTEST : light persists. ADD : a brighter exposure (settles at twice the input). SCREEN : a soft lift. DIFFERENCE : only change glows. DARKEST : dark marks linger. BURN : the uncapped add, which runs to white.',
    soften: 'Blurs the memory a little each frame, so trails soften as they age.',
    drift: 'Zooms the memory in or out each frame : breathing scapes.',
    hue: 'Turns the color of the memory each frame (at 60 fps), so older trails shift hue.',
    motionBlur: 'Blurs the input where it moves (a shutter), before it enters the memory.',
    frameBlend: 'A second, smoother pass over the memory : a softer, more symmetric time blend.',
    preserve: 'Re-anchors the exposure to the live image : 0 = the raw accumulated look, 1 = the trails keep their shape but the brightness follows the live picture.',
    clear: 'CLEAR ▸ : empties the memory (hold to keep it empty).'
  },
  'fx-decay': {
    amount: 'Overall wear : saturation and contrast loss, like repeated dubs.',
    smear: 'A bounded ghost of the previous frame (capped so it never runs away).',
    chroma: 'Color pulled sideways off the picture (VHS chroma lag).',
    blocks: 'Resamples onto a coarser grid and posterizes : compression breakup (subtle at low values, blocky near the top).',
    dropout: 'Sparse scan lines that flash to black or white.',
    jitter: 'Per-line horizontal jitter, tape noise and a slow sway.',
    headSwitch: 'The torn band at the bottom of the frame where a VCR’s heads hand over.'
  },
  'fx-aperture': {
    shape: 'The gate : IRIS (circle) · vertical / horizontal SLIT · film GATE (rectangle).',
    size: 'How open the gate rests. Outside is leader-black. Fully open, the iris clears the frame corners.',
    soft: 'Feather on the gate edge.',
    flicker: 'The opening re-rolls every drawn frame (a breathing shutter). 0 = steady.',
    rate: 'The flicker cadence (drawn frames per second).',
    couple: 'Defocus ↔ gate coupling : as the aperture closes, the lens softens (the focus pull a contracting iris forces).',
    amount: 'Dry/wet against the untouched image.'
  },
  'fx-crt-screen': {
    curve: 'Barrel curvature of the glass : the picture bulges toward you.',
    aberration: 'Color fringing that grows toward the edges (red and blue pulled apart radially).',
    scanline: 'How dark the scanline grille gets.',
    vignette: 'Darkening toward the corners of the tube.',
    corner: 'Roundness of the bezel corners. Outside the glass is black (transparent where the layer is transparent).',
    lines: 'Grille lines per frame height. 540 = one dark row every other row at 1080p, the finest; lower = coarser lines, visible at any resolution.',
    moire: 'RASTER MOIRÉ : 1 keeps the curved moiré bands a fine grille beats into on the curved glass (the 1080p look, now the same at every resolution). 0 draws the grille cleanly and fades whatever is too fine to draw (lower LINES to see it).'
  },
  'fx-grain': {
    character: 'The medium : DIGITAL sensor noise · FILM clumped grain (24 fps) · CRT row snow · VHS tape smear.',
    amount: 'Noise strength.',
    size: 'Grain size in 1080p pixels : it keeps its share of the frame at 4K or on the dome.',
    chroma: 'Color in the noise : film dye-cloud grain, digital chroma blotches, CRT color speckle, VHS chroma phase error (always there on tape, pushed harder).',
    parasites: 'CRT / VHS only. CRT : rolling hum bar, RF herringbone, impulse specks. VHS : line jitter, the head-switch tear at the bottom, dropouts and, high up, a drifting tracking band.'
  },
  'fx-ntsc': {
    artifact: 'Dot crawl : fine luma detail leaks into the color subcarrier, so sharp vertical edges shimmer with rainbows.',
    carrier: 'Subcarrier frequency : low = a coarse, broadcast-like crawl, high = the finest stripes the raster can draw. It also sets which rainbow color each edge takes.',
    fringe: 'Chroma misregistered sideways : the smeared-color bleed.',
    interlace: 'Separates the two scan fields : alternate lines take a hue rotation and a small brightness offset.',
    fieldHue: 'How far, and which way, the two fields’ hues rotate apart. Needs INTERLACE.',
    fieldCrawl: 'Slides the field pattern and the subcarrier so the picture shivers. 0 = still.'
  },
  'fx-rutt': {
    lines: 'Number of scan lines over the frame height.',
    amp: 'How far brightness pushes each line.',
    width: 'Line thickness, as a share of the line spacing (never thinner than one pixel).',
    color: '0 = mono line-work, 1 = each line takes the picture’s color.',
    relief: 'Which way brightness pushes : DOWN hangs bright areas below their line (the original look), UP lifts them into hills like the classic scan processor.'
  },
  'fx-scanlines': {
    count: 'Lines per frame height.',
    darkness: 'How dark each line gets (darkening only, never a glow).',
    roll: 'Slow roll of the lines down the frame. 0 = still.',
    moire: 'RASTER MOIRÉ : 1 keeps the soft beat bands a count finer than the 1080-row raster makes (the 1080p look, now the same at every resolution). 0 draws the lines cleanly and fades them to an even dim where they get too fine to draw.'
  },
  'fx-sync-loss': {
    roll: 'Vertical-hold drift : how fast the picture rolls down the screen.',
    tear: 'How far the tearing bands shear sideways.',
    bands: 'How many horizontal bands can tear.',
    rate: 'Clock of the tears and catches : each step re-rolls which bands tear and whether the hold catches (snaps into lock for that step).'
  },
  'fx-tracking': {
    band: 'Height of the noisy tracking band.',
    position: 'Where the band sits : 0 = bottom, 1 = top.',
    roll: 'Creeps the band up the frame. 0 = parked at POSITION.',
    wobble: 'Per-line sideways wobble : strong inside the band, a whisper elsewhere.',
    noise: 'Luminance flutter and white dropout dashes inside the band.',
    rate: 'Flutter speed : how often the wobble and dashes re-roll.',
    freeze: 'A wandering freeze line : one row smeared across a stripe of the frame. 0 = off.',
    distort: 'Per-line analog x-jitter over the whole frame (the tape never sits still).',
    bleed: 'Tinted chroma bleed : the red channel dragged sideways, magenta at the edges and cyan in the middle, warbling with the scan.',
    bleedRange: 'How far the chroma bleed reaches.'
  },
  'fx-triangle-flicker': {
    rate: 'Pulses per second. Free-running : it does not lock to the tempo.',
    depth: 'How dark the trough of each pulse gets.',
    hard: '0 = smooth triangle pulse, 1 = hard on/off strobe.',
    swap: 'Shuffles the color channels on the bright half of each pulse.'
  },
  'fx-phosphene': {
    sensitivity: 'How strongly a bright stimulus burns in.',
    persistence: 'How long the ghost lingers : 0 ≈ 0.2 s, 0.6 ≈ 1.2 s, 1 ≈ 4 s (time constant). It always fades back to black.',
    strength: 'How visible the ghost is over the live image.',
    complement: '1 = the ghost takes the complementary color (red leaves cyan, white a pale gray), 0 = a plain luminance ghost.',
    threshold: 'Only stimuli brighter than this burn an afterimage.'
  },
  'fx-optical-rain': {
    amount: 'How much of the image shatters into falling streaks.',
    rain: 'Fall speed of the streaks.',
    streak: 'How far each fragment falls (streak length).',
    columns: 'Number of rain columns across the frame.',
    disparity: 'Red/cyan horizontal disparity per fragment, from its brightness : through the Finalizer’s anaglyph 3D the rain floats off the screen.',
    edges: '0 = the whole frame rains, 1 = only edges shatter and their fragments fall.'
  },
  'fx-ringing': {
    gap: 'Distance between echoes (a share of a 16:9 frame’s width, the same at every angle).',
    intensity: 'Strength of the ghost edges.',
    angle: 'Direction the echoes repeat in (radians : 0 = to the right, 1.57 = up).'
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
  'node-transfert': {
    mode: 'DISPLACE pushes this layer around by the other layer’s motion. TRAIL BLUR smears it along that motion instead (a motion blur painted by the other layer’s gesture).',
    amount: 'How far the borrowed motion moves or smears this layer.',
    inertie: 'How slowly the motion field follows the other layer : 0 = it snaps to every movement, high = it glides and keeps drifting after the motion stops.',
    flowScale: 'Multiplies the measured motion, on top of amount (up to 4×).',
    flowBlur: 'Smooths the motion field : low = every small movement pulls locally, high = broad, coherent sweeps.',
    magnitudeGamma: 'Reshapes the motion strength : below 1 lifts small motions (still areas are kept still), above 1 keeps only the big gestures.',
    channelSpread: 'DISPLACE only : pulls the red and blue channels by different amounts, so moving edges split into color fringes.',
    taps: 'TRAIL BLUR only : samples along each streak. More = smoother, longer trails.',
    falloff: 'TRAIL BLUR only : how quickly the streak fades toward its far end.',
    invert: 'Reverses the borrowed motion.',
    bidirectional: 'TRAIL BLUR only : smear both ahead of and behind the motion (on) or trailing behind it only (off).',
    flowRes: 'Resolution of the motion measurement : 128 = broad, soft motion, 512 = fine detail. It does not change the strength.'
  },
  'node-convolve': {
    scale: 'Size of the stamped kernel shape, as a share of the frame.',
    taps: 'How finely the kernel is sampled : more = a more detailed stamp, and a heavier node.',
    threshold: 'Kernel brightness below this is ignored : raise it to keep only the kernel layer’s bright shapes.',
    kernelGamma: 'Reshapes the kernel : above 1 concentrates it on its brightest points, below 1 spreads it.',
    boost: 'Highlight gate : only this layer’s bright pixels stamp the kernel. In mix mode the result can only brighten the picture.',
    gain: 'Brightness of the convolved (wet) result.',
    mix: 'Dry/wet against the untouched layer.',
    additive: 'Adds the convolved glare on top of the layer (a bloom) instead of crossfading to it.'
  },
  'node-mosaique': {
    tile: 'How many tiles across the frame (higher = smaller tiles). The tiles are square at any aspect.',
    corpus: 'How many tiles the other layer is cut into : the palette the mosaic is built from. Bigger = better matches, heavier.',
    structure: 'How much each tile’s direction of detail counts in the match, against its color.',
    orient: 'Lets tiles turn to fit : OFF keeps them upright, FLIP allows a mirror, ROTATE allows quarter turns and mirrors.',
    correct: 'Re-tints each tile toward the color of the patch it replaces : 0 = raw tiles, 1 = the picture’s colors.',
    melt: 'Blends tiles into their neighbors at the seams. 0 = hard edges.',
    stick: 'How strongly a patch keeps its tile from frame to frame : high = calm, low = the tiles boil.',
    jitter: 'A little randomness in the choice of tile, for variety.',
    shape: 'Cell layout : GRID, BRICK (offset rows), VORONOI (organic polygons) or WARP (a flowing, bent grid).',
    irregular: 'How far the cells depart from the regular grid.',
    drift: 'Animates the cell layout (VORONOI and WARP) : the seeds wobble, the warp flows. 0 = still.',
    gain: 'Brightness of the mosaic.',
    mix: 'Dry/wet against the untouched layer.'
  },
  'node-reponse': {
    length: 'How many frames the echo sums (the live frame counts as the first).',
    decay: 'How fast the echo tail fades : low = a short slap, high = a long tail.',
    attack: 'Delays the peak of the echo : 0 = the present is loudest, higher = the echo swells up from the past.',
    gain: 'Brightens (above 1) or dims (below 1) the echo before it is mixed in.',
    reverse: 'Flips the envelope : the oldest frames are strongest, a reverse-reverb swell.',
    stride: 'Keeps one past frame every N frames (of 60 Hz) : 1 = a smooth 16-frame trail, higher = seconds of history in stepped echoes.',
    mix: 'Dry/wet against the live image.'
  },
  'node-feedback': {
    feedback: 'How much of the last frame re-enters the loop : low = short trails, high = long trails and self-sustaining structure.',
    couple: 'Runs a SECOND feedback buffer (fb1) under a diverged transform and cross-mixes it into the main loop. 0 = single buffer. Up = emergent structure neither loop makes alone.',
    couple2: 'How differently the 2nd buffer evolves : scales its zoom/rotate vs the main loop. 1 = same, <1 gentler, >1 wilder. The divergence is what makes the coupling interesting.',
    gain: 'Brightness of each pass around the loop (the exciter). Above 1 the loop feeds itself, and the auto-gain reins it in.',
    zoom: 'Each pass zooms in (+) or out (−) : a tunnel that flies inward or recedes.',
    rotate: 'Each pass turns the picture : spirals.',
    driftX: 'Each pass shifts the picture sideways : trails stream left or right.',
    driftY: 'Each pass shifts the picture up or down.',
    pivot: 'How far the center of the zoom and spin wanders around the frame (keeps it off-center and organic).',
    warp: 'The loop displaces itself by its own colors : boiling, reaction-diffusion-like motion.',
    hue: 'Hue shift per pass : the trails cycle through colors as they age.',
    hueCurve: 'Makes the hue cycle uneven : the palette churns instead of drifting evenly.',
    sat: 'Saturation change per pass : trails bleach toward gray (−) or intensify toward neon (+) as they age.',
    blur: 'Softens the loop a little every pass : smoky, matte trails.',
    delay: 'How many frames back the delay echo reads.',
    delayMix: 'Strength of the delay echo.',
    rgbDelay: 'Time-shear : the R/G/B channels read the delay echo from slightly different past frames → chromatic trails. Needs delay echo > 0.',
    route: 'Where the delay echo goes : FEEDBACK re-enters the loop (compounds/accumulates) · FEEDFORWARD rides on top of the output only (a clean, non-accumulating echo).',
    placement: 'Where the zoom/spin/drift apply : FEEDBACK moves the recirculating trails (a wandering tunnel); PAINTING moves the incoming picture and lays it into a still accumulator (brush strokes).',
    blend: 'How the loop meets the live layer : MIX crossfades, ADD glows (with headroom : bright live areas leave less room), SCREEN brightens softly, DIFFERENCE inverts where they differ, LIGHTEN keeps the brighter.',
    keyMode: 'Lets the loop fill only part of the picture : KEY BLACK / WHITE on brightness, KEY DESAT / CHROMA on saturation.',
    keyThresh: 'Where the keyer cuts (brightness or saturation level).',
    keySoft: 'Softness of the key edge.',
    border: 'Draws a colored line along the key edge, which re-enters the loop and regenerates shapes.',
    borderHue: 'Color of the key border.',
    agc: 'Auto-gain : holds the loop at the brightness of the live layer, so it neither dies out nor runs away (and a near-black ground stays near-black). 0 = raw loop.',
    noise: 'A faint grain injected every pass so the loop never settles into a dead flat image.',
    clear: 'Restarts the loop from the live frame (the rising edge), for this node only.'
  },
  'node-datamosh': {
    motion: 'How far the picture slides along the measured motion each frame.',
    block: 'Macroblock size in pixels at 1080p (it scales with the render size) : the grain of the sticky tearing.',
    decay: 'Persistence : how long the smear holds before it cleans back to the live picture.',
    refresh: 'The I-frame : how quickly the live picture returns. 0 = the smear never resets on its own (the full bloom).',
    residual: 'Re-injects live texture into the smear : the line between mosh and mush.',
    reseed: 'Chance that whole blocks snap back to the live picture, so the smear never fully mushes.',
    thresh: 'Motion gate : motion smaller than this is ignored, so still areas don’t creep.',
    moshGate: 'Holds the smear only on the MOVING parts (+) or only on the STILL parts (−). 0 = everywhere.',
    edgeRepel: 'Steers the smear along the picture’s own edges : + away from bright, − toward bright.',
    resharp: 'Adds the live picture’s fine detail back on top, so the mosh stays crisp.',
    bleed: 'Codec color bleed : the red and blue channels slide apart along the motion.',
    autoBloom: 'Blooms automatically on a scene cut (a sudden change of the whole picture).',
    cutSense: 'How big a change counts as a cut for the auto-bloom : lower = more sensitive.',
    sidechainFlow: 'MOTION TRANSFER : take the motion from the sidechain layer instead of this one, so another layer’s movement moshes this layer’s texture.',
    flowRes: 'Resolution of the motion measurement : 128 = broad, blocky motion, 512 = fine detail. It does not change the strength.',
    mode: 'MELT (soft per-pixel smear) · STICKY (rigid block tiles that tear at edges : the real datamosh look) · FLUID (a temporally-averaged flow → smooth liquid melt).',
    swirl: 'Rotate every motion vector → a vortex mosh (0 = none, ± = spin direction).',
    flowInvert: 'Reverse the motion direction → the smear pushes backward.',
    pulse: 'Auto-fire the bloom on a clock (Hz) : hands-free rhythmic moshing. 0 = off.',
    trig: 'Fire a BLOOM burst on the rising edge : momentarily holds the I-frame + boosts persistence so the motion drags the frozen texture (the classic datamosh hit). Press it, send OSC, or bind a modulator (square LFO / audio onset) with M to mosh on the beat.',
    manifest: 'Manifestation : instead of a clean I-frame cut, the live frame re-enters ONLY where there is motion. A new source completes itself out of the retained frame, growing in along movement. Still areas stay frozen.',
    actant: 'Actant layer strength : sparse sticky patches that FREEZE their texture and drift along the flow as autonomous frozen blocks. 0 = off. Drop them with the actant ▸ trigger or the rate clock.',
    actantLife: 'How long each actant patch persists before it fades : low ≈ a fraction of a second, high ≈ several seconds.',
    actantRate: 'Auto-spawn actant bursts on a clock (Hz), hands-free. 0 = only the manual/OSC trigger fires them.',
    actantTrig: 'Drop a burst of actant patches on the rising edge : localized frozen blocks that stick and drift along the motion. Press it, send OSC, or bind a modulator (square LFO / audio onset) with M. Needs actants > 0.'
  },
  'fx-stutter': {
    bands: 'Splits the screen into this many horizontal bands that freeze independently. 1 = the whole frame holds at once.',
    jitter: 'Gives each band its own slightly faster or slower clock, so the freezes stop lining up. 0 = every band steps together.',
    blackout: 'Share of segments where a band goes black instead of playing or holding : the screen switching off region by region.',
    trig: 'PUNCH-IN : while fired, every band freezes (full stutter). Press, OSC, or bind a modulator (M) to glitch on the beat. 0 = the base `chance` applies.'
  },
  'fx-mosh-blocks': {
    freak: 'A minority of blocks that break the family : content grabbed from anywhere in the frame, zoomed, mirrored, sometimes inverted, held on a slower clock. 0 = none.',
    audio: 'Raises the odds of each block column corrupting with its own band of the live spectrum (bass on the left). 0 = off.',
    trig: 'PUNCH-IN : while fired, every block moshes (full). Press, OSC, or bind a modulator (M) for beat-locked bursts. 0 = the base `chance` applies.'
  },
  'fx-slice-shuffle': {
    audio: 'Raises the odds of each slice jumping with its own band of the live spectrum (bass at the bottom). 0 = off.',
    trig: 'PUNCH-IN : while fired, every slice shuffles (full). Press, OSC, or bind a modulator (M). 0 = the base `chance` applies.'
  },
  'fx-byte-corrupt': {
    depth: 'Levels per color channel after the crush : 2 = one bit (hard two-tone), 16 = four bits. Lower is harsher.',
    warpByte: 'Bends the block grid and gives every block its own rotation, zoom and offset : warped fragments instead of clean squares. 0 = square blocks.',
    chaos: 'A few regions leave the grid : their cells stretch into slivers and bars, their content shears and melts, and they always corrupt. 0 = none.',
    audio: 'Raises the odds of each block column corrupting with its own band of the live spectrum (bass on the left). 0 = off.',
    trig: 'PUNCH-IN : while fired, every block corrupts (full). Press, OSC, or bind a modulator (M) to fire on the beat. 0 = the base `scramble` applies.'
  },
  'fx-databend': {
    shift: 'How far a torn band jumps sideways, as a share of the frame width.',
    hold: 'Share of torn bands that freeze onto their top line and repeat it downward : the byte-repeat smear.',
    channel: 'Share of torn bands whose color channels rotate (red takes green, blue takes red) and drift sideways out of registration; also how far they drift.',
    wrap: 'Torn bands wrap around the frame edge, like a shifted run of bytes. Off = the edge column smears across the gap.',
    audio: 'Raises the odds of each band tearing with its own band of the live spectrum (bass at the bottom). 0 = off.',
    trig: 'PUNCH-IN : while fired, every band corrupts. Press, OSC, or bind a modulator (M) to fire on the beat. 0 = the base `chance` applies.'
  },
  'fx-row-echo': {
    fade: 'Lets each held band melt back into the live picture toward its bottom : 0 = a hard repeated line, 1 = a smear that fades out.',
    audio: 'Raises the odds of each band holding with its own band of the live spectrum (bass at the bottom). 0 = off.',
    trig: 'PUNCH-IN : while fired, every row band holds. Press, OSC, or bind a modulator (M). 0 = the base `chance` applies.'
  },
  'fx-compress': {
    block: 'Macroblock size in 1080p pixels (it scales with the output, so 4K and the dome look the same).',
    quality: 'Encoder quality : low collapses each block toward its average color and bands the tones, high keeps the detail.',
    ring: 'A diagonal ripple inside blocks that hold strong edges : the mosquito noise of a starved encoder.',
    chroma: 'How far color is averaged over each block : color bleeds across edges while the brightness stays sharp.',
    grid: 'Darkens a thin line along every block border.',
    vary: 'Gives every block its own quality, as a real encoder spends its bits unevenly : some blocks stay clean, others crush. 0 = all equal.'
  },
  'fx-pixelsort': {
    low: 'Only pixels brighter than this sort; darker ones stay put and end the runs.',
    high: 'Only pixels darker than this sort; brighter ones stay put and end the runs.',
    length: 'Longest run, as a share of the frame along the sort axis.',
    angle: 'Tilts the sort axis away from horizontal (or vertical). 0 = straight.',
    reverse: 'Flips the direction the bright values pour : off = rightward (upward when vertical), on = leftward (downward).'
  },
  'fx-pixelate': {
    average: 'Blends each cell from its center pixel (crisp, sparkles as detail moves) toward the average of the cell (calm). 0 = center pixel.'
  },
  'fx-pixelmask': {
    pattern: 'GRILLE vertical stripes · SHADOWMASK red / green / blue phosphor stripes · DOTS · GRID thin lines · NOISE a fixed random stencil.',
    scale: 'Pattern size in 1080p pixels, rounded to whole pixels (it scales with the output).',
    amount: 'How dark the unlit part of the mask goes.'
  },
  'fx-dither': {
    levels: 'Tones per color channel (whole numbers : 2 = pure on / off).',
    scale: 'Dot cell size in 1080p pixels, rounded to whole pixels (it scales with the output).'
  },
  'fx-threshold': {
    soft: 'Width of the transition around the level : 0 = a hard edge.',
    alphaOut: 'Keeps the source colors and turns the dark side transparent (the bright side with invert) : carves shapes out of the layer instead of painting black and white.'
  },
  'fx-mosaic': {
    grid: 'Number of cells : low = a few big tiles, high = a fine field.',
    lumaSize: 'How much each tile size follows the brightness of its cell : bright cells swell, dark ones shrink to small marks.',
    gapMix: 'Fills the gaps with a dim copy of the tile color. 0 = matte black gaps.',
    average: 'Blends each tile color from the cell center pixel (vivid, pops as detail moves) toward the average of the cell (calm). 0 = center pixel.',
    audio: 'Swells each column of tiles with its own band of the live spectrum (bass on the left). 0 = off.'
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
    sway: 'Animated camera drift : gives constant parallax motion even on a still image.',
    swayRate: 'Speed of the camera sway (1 = the original pace, 0 = holds still). Safe to modulate : it never jumps.',
    dof: 'Depth-of-field : blur that grows with distance from the focus plane.',
    dofShape: 'Shape of the depth blur : CROSS = four ghosted copies at wide radii (the original, graphic look), DISC = a smooth lens blur.',
    focus: 'The depth that stays sharp (the focal plane). Fog starts behind it.',
    fog: 'Aerial recession : the planes beyond the focus depth sink toward black, the farthest most.',
    invert: 'Flip near ↔ far.',
    wet: 'Dry/wet against the untouched image.'
  },
  'node-chronoscan': {
    source: 'What sets each pixel’s age into the frame history : SLIT-SCAN (a moving gradient, the scanner smear) · LUMA self (the image’s own brightness) · LUMA sidechain (another layer’s brightness as the clock).',
    reach: 'How far back the oldest regions read (up to 32 stored frames; see stride).',
    angle: 'Direction of the slit-scan gradient on screen (slit-scan control only). It always spans the whole frame.',
    sweep: 'Speed the slit-scan gradient drifts (a moving slit). 0 = static.',
    sweepMode: 'SAW : the moving slit wraps around, with a hard seam between now and the oldest past. PING-PONG : it folds back and forth, no seam.',
    curve: 'Bends the time distribution : <1 crowds regions near the present, >1 near the past.',
    invert: 'Flip the age mapping (present ↔ past).',
    smooth: 'Cross-fade between the two nearest frames (smooth) vs. snap to one (stepped).',
    stride: 'Stores one frame every N frames (of 60 Hz) : 1 = about half a second of history, higher = seconds, in coarser steps.',
    mix: 'Dry/wet against the live image.'
  },
  'node-sediment': {
    deposit: 'How strongly the present is laid down into the long memory.',
    decay: 'How slowly the memory fades : low = seconds, high = many minutes (the peaks sink back to black over this time).',
    resurface: 'How much of the old memory bleeds back into the live image.',
    age: 'Which past to resurface : 0 = the recent long-exposure accumulator, → 1 = the oldest kept keyframe (minutes ago).',
    interval: 'Seconds between keyframe snapshots. 16 slots × this = how far back the recallable past reaches.',
    stir: 'Slowly drifts the resurfaced memory so it sediments and wanders, rather than sitting as a frozen loop.',
    blend: 'How the memory combines with the live image : SCREEN brightens, LIGHTEN keeps the brighter, UNDER lets the memory show only in the dark and empty parts of the live picture, DIFFERENCE inverts where they differ.',
    mix: 'Dry/wet against the live image.',
    snap: 'SNAPSHOT ▸ : store a keyframe right now (rising edge), a moment marked to resurface later. Bind a modulator or an audio onset to snap on the beat.'
  },
  'node-scanner': {
    mode: 'LOOP scans forever (continuous live slit-scan) · ONE-SHOT does a single pass on a trigger, then holds the frozen document.',
    axis: 'Which way the scan head sweeps : down / up / right / left.',
    scanRate: 'How fast the head sweeps (passes per second). Slow = long time-smear; fast = a quick refresh.',
    drag: 'Steady shear of the capture : the paper sliding under the head as it scans (diagonal smear).',
    wobble: 'A slow hand-wave across the sweep : wavy, organic distortion, a different wave on every pass.',
    jitter: 'Random per-line horizontal rips (the digital tear).',
    tear: 'Chunkiness of the rips : low = thin lines, high = torn in fat slabs (sized on the frame height, so the same at any render size).',
    rgb: 'CCD channel misregistration : splits R/G/B sideways (color-fringe scanner artifact).',
    bar: 'Brightness of the moving scan bar (the bright line at the head). 0 hides it.',
    audio: 'Each captured line shifts with the live audio waveform at that moment : the scan records the sound like an oscilloscope. 0 = off.',
    trig: 'FIRE a fresh scan pass on the rising edge. Press the button, send it over OSC, or bind a modulator with M (a square LFO / sample&hold / audio edge) for rhythmic live re-scans.'
  },
  'node-autocutter': {
    shape: 'CUT-UP = recursive rectangles. MOSAIC = irregular Voronoi polygons.',
    cuts: 'How many pieces the frame is chopped into (recursive splits).',
    rotate: 'What fraction of the pieces get turned 90°/180°/270°. Safe to modulate : it only turns pieces, it never reshuffles which pieces the mask removes.',
    slip: 'Nudges each piece’s source region : extra displacement / tearing.',
    gap: 'Dark seams drawn between the pieces (the collage cut lines).',
    contour: 'Bends the cuts into uneven, curved tear-lines. The pieces still fit together exactly; past 1 they shred.',
    curve: 'Wavelength of the contour : low = many small waves, high = a few long sweeping curves.',
    torn: 'Torn-paper edge : a ragged off-white fringe along each cut over a soft shadow. Past 1 the edges get chewed up.',
    mask: 'Peels pieces away one by one, leaving transparent holes (the layers below show through). At full mask a single piece survives, a new one at every cut.',
    mix: 'Blend of the rearranged cut-up against the untouched original.',
    rate: 'Auto re-cut rate (Hz) : >0 re-cuts on its own for hands-free live rhythm. 0 = only on trigger.',
    xfade: 'Crossfade (seconds) from the old layout to the new one on each re-cut, instead of a snap. Capped just under the re-cut period so a fade always finishes.',
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
    torn: 'Tears the cuts like paper : one piece lies over the other and shows the white core of the paper along its ragged edge, with loose fibers and a soft shadow. Past 1, deep ripped bites.',
    mask: 'Drops pieces out, leaving transparent holes the layers below show through. At 1 a single piece survives (a new one at each deal).',
    rate: 'Re-deals the whole wall every this many seconds (new films, new cut). 0 = only when you press deal.',
    xfade: 'Dissolve time from one deal to the next. 0 = a hard cut.',
    deal: 'Re-deal the wall now : new films, new cut. Press it, send OSC, or bind a modulator.'
  },
  'fx-vibe': {
    stops: 'How many palette stops (2–5) the image is re-colored toward : the size of the color map.',
    blend: 'How the image moves from one palette stop to the next : 0 = hard posterized bands (each area takes the nearest stop), 1 = smooth gradients between stops.',
    dither: 'Ordered dithering : breaks up banding, adds fine texture (a 4x4 pattern counted in 1080p pixels).',
    mixSrc: 'Mix the original source colors back in over the palette map (1 = no palette at all).',
    autoLevel: "Auto-levels : stretches the picture between its darkest and brightest areas (smoothed over time) so it spans the whole palette. 0 = off.",
    gamma: 'Tone gamma : where the palette stops land on the image. Above 1 pushes the picture toward the dark stops, below 1 toward the light ones.',
    contrast: 'Overall contrast.',
    saturation: 'Color intensity (0 = grayscale).',
    sharpen: 'Luma sharpening BEFORE the palette map, so fine detail survives even a hard 2-stop palette.',
    splitTone: 'Split-tone amount : tints shadows and highlights toward two hues. 0 = off.',
    shadowTint: 'Color multiplied into the shadows (split-tone). Mid-gray = neutral.',
    highTint: 'Color multiplied into the highlights (split-tone). Mid-gray = neutral.',
    harmony: 'Color chord : replaces the palette stops with ones generated from one hue and a harmony (analogous, complementary, triad, split, tetrad), dark to light. Off = your own stops.',
    baseHue: 'Base hue the generated chord is built around.',
    chroma: 'Chord colorfulness : saturation of the generated stops (lighter stops ease off).',
    spread: 'Analogous chord only : how far the hues fan out around the base hue.',
    colorA: 'Palette stop A : a color the image is mapped toward (darkest).',
    colorB: 'Palette stop B : a color the image is mapped toward.',
    colorC: 'Palette stop C : a color the image is mapped toward.',
    colorD: 'Palette stop D : a color the image is mapped toward.',
    colorE: 'Palette stop E : a color the image is mapped toward (lightest).'
  },
  'fx-context': {
    voidEdge: 'VOID : the frame’s edges dissolve into the dark with a ragged, slowly breathing boundary (an erosion eating inward, not a clean vignette). 0 = off.',
    trails: 'Temporal color bleed : past frames linger and swell gently outward toward you (the drift grows with depth).',
    blur: 'Spatial blur : takes the edge off, pushes things back in space. Its sparse ring of taps shows as ghost copies at larger amounts (see ghosts↔smooth).',
    bloom: 'Highlights glow / bleed light : dreamier, more luminous. At ghosts↔smooth 0 only broad highlights glow, with a stepped halo.',
    smoothing: 'Blur and bloom texture : 0 = a ring of ghost copies and a stepped, scalloped halo (the default look), 1 = a jittered soft blur where small highlights bloom too (a fine grain in the glow).',
    depth: 'Vignette + aerial recession that seats the image in a volume.',
    haze: 'Atmospheric veil toward the atmosphere color : distance, air.',
    atmosphere: 'The color the haze / aerial perspective tints toward.',
    lightGlow: "A soft key light's glow strength.",
    lightSize: 'Light spread : a tight spot (0) → a broad ambient wash (1).',
    lightColor: 'Color of the key light.',
    light: 'Position of the key light (drag the XY pad).',
    pbrTexture: 'PBR material the whole composition is mapped onto (projector-on-surface look).',
    pbrAmount: 'RELIEF : how deep the material is. It sets how far the image sinks into crevices and rides over bumps, and how much the surface relights it. 0 = flat passthrough.',
    pbrLight: 'RAKING : how hard the light grazes the material, independent of relief depth. Low = soft, even, front-lit. High = a low grazing light that throws long, near-black cast shadows in the crevices and hot specular sheen on the ridges (deep chiaroscuro contrast). Turn this up when the relief looks too flat.',
    pbrScale: 'Tiling scale of the PBR material : how many times it repeats across the frame.',
    pbrEvolve: 'EVOLUTION : keeps the surface from sitting perfectly still, as if a little wind moved the projector or the camera filming it. The material drifts a touch under the image in a slow, irregular sway with light gusts, turns and breathes very slightly, and the raking light shifts with it. 0 = perfectly still.',
    pbrDepth: 'FIELD DEPTH : viewing distance. 0 = pressed against your eye (dense parallax, raking contrast). Up = you step back : the material tiles finer, the relief flattens, the light reads softer and more ambient, and the surface settles toward the atmosphere color.'
  },
  'fx-finalizer': {
    black: 'Input black point : lifts or crushes the shadows (Levels).',
    white: 'Input white point : where the highlights clip (Levels).',
    gamma: 'Midtone brightness (Levels).',
    rGain: 'Red gain : tints the whole output.',
    gGain: 'Green gain : tints the whole output.',
    bGain: 'Blue gain : tints the whole output.',
    alpha: 'Opacity : fades the graded picture toward black (1 = full, 0 = black), on the preview and every output alike. The output shape fill and film damage are added after it.',
    sharpen: 'Final edge sharpening over the whole frame (both eyes in 3D).',
    character: 'Grain character : digital sensor / film / CRT / VHS.',
    grain: 'Grain amount over the graded picture (the shape fill, film damage and film granulation are added after it, grain-free).',
    grainSize: 'Grain particle size, in 1080p pixels : it keeps the same size relative to the picture on a 4K or dome master.',
    chroma: 'Color noise in the grain (digital and film characters).',
    parasites: 'Only with the crt / vhs character, and grain above 0. VHS : wobbling line edges, the head-switch tear at the bottom, single-scanline dropouts (white, a few dark) that fade over a tail and come in bursts; high up, a drifting tracking band. CRT : a soft hum bar rolling up, a faint RF weave, short impulse specks.',
    stereo: 'Render the output as red/cyan anaglyph 3D (needs red/cyan glasses). Gray = half-color, gentler on the eyes for abstract relief.',
    stereoDepth: 'Strength of the 3D relief : how far the red/cyan eyes separate with depth.',
    stereoConv: 'Convergence : which depth sits ON the screen plane. Negative pushes forms OUT toward you (pop-out).',
    stereoInvert: 'Flip the depth reading (dark = near instead of bright = near).',
    filmHold: 'Cameraless / direct-film: hold the output on a hand-drawn draw clock. Film-hold = live process stepped; Freeze = a held cell that still weaves in the gate. (Distinct from the Transport Shutter, which is a global full-freeze stop-motion.)',
    filmRate: 'Draw frame rate : how many drawn frames per second (2–12 reads as hand-made film).',
    filmJitter: 'Irregularity of the draw-clock interval : hand timing is never metronomic.',
    filmBoil: 'Registration jitter : gate weave + hand-registration error (the "boil"), re-rolled per drawn frame.',
    filmFlutter: 'Per-frame density/luminance pump : uneven hand-painted exposure.',
    filmBlank: 'Chance a drawn frame shows blank leader instead of the picture (a flickering, intermittent film).',
    filmBlankMode: 'Leader color for blanks : black gap, white clear-leader flash, or both.',
    filmDust: 'Dust and dirt on the film : a new set every film frame (24 fps, 18 on Super 8), mostly tiny specks, a few big ones, the odd fiber. 0.15 is a clean print, 0.5 a worn one, 1 a trashed one. Works with Film Hold off too.',
    filmScratch: 'Scratches running along the strip : each lasts from a fraction of a second to a minute, wanders slowly sideways, breaks up and fades. Mostly dark (the print), some white or colored.',
    filmBurst: 'Burst : a dirty stretch of film passes the gate, four to eight times the dust for about a second, then clean again. Works even with dust at 0 (a clean print hits a dirty patch). Fire it on a beat or an onset (bind M or OSC).',
    filmHair: 'A hair caught in the projector gate : hangs in from an edge, trembles, stays a few seconds to a minute, then goes. Higher = there more of the time.',
    filmGauge: 'Film size : the same dust is about 4 times bigger on Super 8 than on 35 mm. Also sets the film speed (24 fps, Super 8 18).',
    filmDirt: 'Which film the dirt was on : the print shows it dark, the negative prints it as white sparkle. Mixed = both.',
    filmGranule: 'Dye granulation / pooling : coarse clumped colored mottle (the "paint" of hand-painted film).',
    filmSplice: 'Rare splice punctuation : a whole-frame flash + a bright horizontal bar.',
    filmGrab: 'Grab : draw the live picture now and restart the draw clock from it; in freeze, re-freeze the gate on the live frame. Fire it on a beat (bind M or OSC).',
    outShape: 'Clip the finished frame into a silhouette (none = full frame).',
    outSize: 'Size of the output shape.',
    outAngle: 'Rotation of the output shape.',
    outPosX: 'Horizontal position of the output shape.',
    outPosY: 'Vertical position of the output shape.',
    outBgSource: "What fills OUTSIDE the shape : a solid color or the Background layer (moved here).",
    outBgColor: "Fill color outside the shape (when 'color' is chosen).",
    outDepth: 'Soft drop shadow : makes the shape float over the fill.',
    outShadowAngle: "Direction the shape's shadow falls (light angle).",
    outPerspective: 'Rakes the shadow onto a receding ground plane : adds depth realism.'
  },
  'gen-text': {
    font: 'The typeface. Each font has its own weight range; a font with a single weight grays out the weight dial.',
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
