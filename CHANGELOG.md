# Changelog

All notable changes to Palinopsia. Dates are ISO. Versions follow the `v*` tags
that CI builds into cross-platform releases.

## Unreleased

### Added

- **Touch and Ripple : any picture touchable, and the picture seen through water** (Vincent :
  "build Topographic Flow, Touch, Shockwave and Ripple"; the shelf's *Touch : an FX that
  makes any picture touchable [...] from the mouse, every pinching hand, Room people or OSC,
  so all generators and every film answer the hand; absorbs the shelf Shockwave* and
  *Ripple : the picture seen through water [...] on the dome the circle rim is the
  reflecting boundary. Keep the crest shine matte, never a glossy glow*). Two native nodes,
  any rack (the master too), sharing their input points (`engine/touchInput.ts` : the
  pointer through `pointerInput.ts`, every pinching hand, the Room's people, an OSC
  finger, the effect's own point, a wandering hand; the field space is the flat frame or,
  under dome fill, the dome's disc).
  - **Touch** (`node-touch`, `engine/touchNode.ts`) : modes rings (the Shockwave, a
    first-class mode : a ring of displacement bursting from the touch and traveling out,
    a wake of rings while dragged), spread, swirl, drag (the field is carried along under
    the hand), lens, attract; follow, fade, spring (creep or jelly), soft; FIRE at the
    center / the point / anywhere, sound hits (a shockwave on the kick), people push, by
    itself, press the point; matte shade, color split. A displacement field at half the
    height (at most 720 rows, RGBA32F where it filters), relaxed by a damped spring; rings
    (16) and lenses (8) drawn over it from uniforms; one warp pass.
  - **Ripple** (`node-ripple`, `engine/rippleNode.ts`) : a wave height field (RGBA32F,
    200 to 720 rows, a third of the height), substepped so rings travel at the same speed
    at any size; rain, sound hits, the stone trigger, its own motion (luma change on the
    grid), the hand (a stone, then a finger that leaves a wake), people wade, by itself;
    reflect or absorb edges (on the dome the disc's rim is the wall); refraction with a
    color split, matte crest light, water color in the troughs.
  - `/opsia/touch x y [s]`, `/opsia/touch/hold x y`, `/opsia/touch/up` (every Touch and
    Ripple); each effect's own inputs (`fire`, `stone`, `point` …) as for every effect.
  - 14 Touch presets, 12 Ripple presets; the chain group **Touch and water** (Touch the
    Picture, Shockwave on the Kick, Jelly Picture, A Hand of Its Own, Through the Water,
    Drops on the Kick, Downpour, Water You Touch) and **Dome · Pool**; themes **Pond**,
    **A Hand in It** (Living Surfaces) and **Pool Overhead** (Dome); Ripple joins the
    dice's effects.
- **Time Glitch, Break, Key and Droste : four new effects** (Vincent, quoting a user : "a
  kind of time effect mixed with chaotic glitch, so you drop it, it warps time a bit like
  Sediment / Wide Time / trails, but then glitches those trails inside its feedback loop
  and post too"; and from the shelf : Shatter (impact fracture), one Key FX with modes, the
  Droste spiral).
  - **Time Glitch** (`fx/TimeGlitch.fs`, ISF, `fx-time-glitch`) : a memory of the recent
    past (8-bit, stochastic rounding, as Wide Time; mode lights / smear / darks, drift) in
    which a stepped clock (`PH_timeGlitch` : rate up to 16 Hz or a tempo division) damages
    blocks INSIDE the loop (moved, torn along their row, stuck, crushed, red and blue split),
    so each glitch is smeared, remembered and glitched again; `after` deals a second round
    on the way out (block jumps, row tears, the split, channels turned), not kept. A 1x1
    latch carries the layer clock and the `burst ▸` envelope (`burstLen`); `audio` per
    block column. The memory step is folded again in the output pass (no frame late). The
    split first ran a touch everywhere every frame : it streamed every trail into a
    rainbow, so it acts in the damaged blocks only; the default mode is **lights** (the
    mean smeared sparse light-on-black sources to nothing : murmuration 0.03 mean
    brightness, 0.26 with lights). 2.9 ms at 4K (shader rig).
  - **Break** (`fx/Break.fs`, ISF, `fx-break`; the frame-store Shatter keeps its name) :
    one fragment shader. Polar cells round the impact (radial cracks, rings in a geometric
    run, both wandering on value noise, a `broken` share of segments missing), the piece
    under each pixel found by walking back along the way the pieces move (14 steps), each
    piece moved / turned / tilted per **then** (hold, drift, fall, heal; fall runs out to
    the rim on the full dome through `domeDir`), its face lit from a fixed room light, the
    chamfer within a few pixels of each crack sloping outward (a mirror highlight mixed
    toward a pale room light, never added), refraction by the tilt. A 4x1 state pass keeps
    the age (16 bits), the hit count (a new crack pattern each hit), the latched impact
    point, the layer clock and the automatic step (`PH_breakAuto` : every N s or a tempo
    division). The hit : `break ▸`, a click on the preview, a pinch, or automatic, round
    `hitX` / `hitY` by `scatter`. 4.0 ms at 4K (shader rig), 60 fps at 1080p.
  - **Key** (`fx/Key.fs`, ISF, `fx-key`, Utility) : color (the angle off the key's hue in
    Cb / Cr, a minimum chroma, despill of only the excess along the key), saturation,
    edges (the brightness spread over a ring), channel (brightness / R / G / B / alpha);
    tolerance, softness, choke (min / max over the ring), feather, invert, show matte; the
    alpha goes to the layer blend. Nine reads, 0.9 ms at 4K.
  - **Droste** (`fx/Droste.fs`, ISF, `fx-droste`) : log space times
    `gamma = arms - i strands log(scale) / 2pi` (whole numbers keep it seamless), folded
    into one level against the frame's own box or a circle, `PH_zoom` / `PH_spin`
    integrated; edge line and a vanishing point that settles to the mean. 0.8 ms at 4K.
  - **The preview pointer takes ISF effects** (`pointerInput.ts`, registry field
    `pointer`) : a click on the preview sets Break's impact point and fires it, a click or
    a drag sets Droste's center (the mouse : an undoable edit; a pinch : live).
  - Key and Droste stay out of every dice (`HAND_FX` in `randomize.ts`; Droste dealt into
    six random scenes vanished into the textures or took the whole layer); Key's color,
    mode, channel and views are never rolled. Time Glitch and Break deal (Break never into
    hold).
  - 10 presets each, Inspector groups and grey-outs (`GroupedControls.tsx`), the chain
    group **Glitch** (Glitched Memory, Rotten Trails, Smashed Screen, Healing Glass,
    Outlines Only, Color Isolate) and Droste Spiral / Frames in Frames (Space), the
    Generate themes **Glitched Memory**, **Broken Glass** (Glitch / Datamosh), **Endless
    Spiral** (Optical / Op-Art), **Cut by Color** (Minimal / Structural).
  - Fulldome gate : all four PASS (60 fps flat and on the dome, p95 17-17.3 ms, 59.7
    updates a second at the defaults and at the heaviest settings).

    **A Hand in It** (Living Surfaces) and **Pool Overhead** (Dome). (Ripple first joined
    the dice's effects; the audit below kept it hand-placed.)
- **Lights : DMX fixtures on the picture, a page of their own (key `T`)** (Vincent : "une
  nouvelle page d'output de lumières complète pour pouvoir gérer le mapping de lumières";
  his rig : an Enttec DMX USB Pro). `shared/lights.ts` (the model : the RIG is this
  computer's, the LOOK the session's), `lights/lightEngine.ts` (pure CPU), `lightRuntime.ts`
  (the render loop's side), `enttec.ts`, `lightShows.ts`, `lightStore.ts`, `lightMods.ts`,
  `components/LightsPage.tsx`, `main/light.ts` (now `DmxSender`).
  - **Fixtures** (the list is called **Lights** since) : LED bars (a line of N pixels),
    spots, matrices (cols × rows, serpentine),
    placed on the picture (0..1, y down) and edited on the map over their source (drag the
    body or the ends / corners, Shift keeps a bar level, arrows nudge, Delete, Ctrl+D);
    each pixel drawn in the color it sends. Patch : output, universe, address (new ones
    auto-addressed after the last), a channel layout per pixel (presets or tokens
    `R G B W A U D S X` / a number); a pixel never straddles a universe (170 RGB a
    universe); an Enttec's channels past 512 dropped and reported.
  - **Sampling** : `Compositor.kickLights(srcs)` copies each source in use (the presented
    master, or a layer's own `texture()`) into a 1024×576 mipmapped texture and reads them
    all in one strip of 192×108 cells (`GridReadback.kickStrip`, asynchronous), so each
    texel is a trilinear box average (no flicker from point samples on fine lines); each
    pixel then averages nine taps over its `size`. Replaces `kickZones` / `takeZones`.
  - **Looks** : picture / layer / color / gradient (2..5 stops, angle, scale, offset,
    drift, or along the fixture; ping-pong, no seam) / off; effects chase, wave, pulse,
    sparkle, sound (`audioBus.feature('level')`), beat (the shared beat clock
    `soniBeats`), each capped at three changes a second at any rate and speed (the
    beat : every other beat past 180 BPM); a level. Patterns run in the room's own
    proportions (x × aspect).
  - **Tuning** per fixture : brightness, contrast, gamma (default 2 : LEDs are linear),
    saturation, hue (YIQ rotation), warmth, a black floor, smoothing (default 0.08 s);
    kept in the rig or, with `tuneScope : 'look'`, in the session and the light scenes
    (the cues, below).
  - **Masters** : grand master, speed, scene fade (the knob reads **CUE FADE** since),
    Black (down over its time, eased); the top bar's Black takes the lights down too.
    Light scenes (now the cues) fade in from what showed
    (`lightFadeEpoch` → `LightEngine.beginFade`). 14 shows (`lightShows.ts`), spatial so
    they fit any room.
  - **Outputs** : the **Enttec DMX USB Pro** through **Web Serial** in the renderer (no
    native module) : label 6 messages (`7E 06 len 00 data E7`), the Pro found among
    `navigator.serial.getPorts()` by its FTDI 0403:6001 (main grants serial devices with
    `setDevicePermissionHandler` and answers `select-serial-port`), reopened every 2 s
    after an unplug or a sleep, a write in flight skips the frame. **Art-Net** (ArtDmx,
    sequence 1..255), **sACN** (E1.31 data packets, a random CID per run, unicast or the
    universe's multicast group) and **WLED** (DNRGB, universe u = LEDs from u × 170)
    from main.
  - **Modulation** : a new target `{ kind: 'light', fixture, field }` (`LIGHT_MOD_RANGE` :
    the look's color and gradient, the effect, the level, four tuning fields, the master
    and the speed; fixture '' for the masters) through every path (modulation, the Macro
    knobs' commit, the matrix labels, the keys, Randomize's key, the base for the
    multiply / replace pick); a removed fixture takes its rows and Macro destinations
    with it. **MIDI Learn** : `lights:master` / `speed` / `fade` / `blacksec` and the
    trigger `fire:lightsblack`. **OSC** `/opsia/lights/...`. **Ctrl+K** : Lights.
  - **Persistence** : the rig in localStorage (`opsia.lightRig`; the old `opsia.lights`
    grid migrated once into a matrix + its output), the look / scenes / masters in the
    session (`lights`; an older file : every light follows the picture; New clears them).
  - The **LIGHTS** button in the Output page's header opens the page (lit while the lights
    send; the bottom bar stays as it was : Vincent, "Lights n'a pas besoin d'être dans la
    toolbar du bas"); the Output page's old light section is gone; the Performance chip and
    its meter row read the Lights. `LightConfig` and the zone grid are gone.
  - Tested : 25 Node checks of the engine and the packets (colors and layouts, universes,
    the Enttec overflow, Black, master, sampling left / right and reversed, serpentine,
    sanitizers, the Enttec message, Art-Net and sACN received on 127.0.0.1); in the test
    copy : the rig across a restart, 40 frames a second sent for a 40 fps rig, Art-Net
    packets out with the picture's colors, Black to 0, a 1 Hz square on a spot's level
    breathing it (smoothed), a session round trip with its light scenes (cues), the map's drags,
    an Enttec output with nothing plugged in (looking, no error). **Not verified : a real
    Enttec Pro** (none here).
- **Lights, closer to the lighting world (1/4) : the dimmer, the picture's colors, the
  output delay** (Vincent picked 1 to 12 of the 11-10 suggestions, from Resolume's DMX
  output and ossia score).
  - **The dimmer takes the level.** With a `D` in a layout the dimmer channel now carries
    the light's level (the brightest of its three colors, after the tuning) and the
    color goes out normalized to full, the same light on a linear fixture but with the
    dimmer's resolution : smooth low fades, and a dim color that stays its color. Before,
    `D` was held at 255 and the 8-bit color carried everything. **New tokens** : a
    letter followed by `16` is two channels, coarse and fine (`D16`, `R16`... : the
    dimmer in 65,536 steps), `C M Y` (a subtractive mix, the color's complement), `L`
    (one channel of white : the luminance, for a dimmer-only or white fixture). New
    layouts in the menu : D16RGB, D16RGBW, RGBWA, L, L16, DCMY. `tokenWidth` /
    `layoutChannels` in shared/lights.ts; `fixtureChannels` counts 16-bit tokens twice.
  - **How a pixel reads the picture** (`LightLook.sample`) : **average** (nine taps, as
    before), **vivid** (25 taps weighed by chroma cubed : a few strong colors are not
    drowned in a grey patch) or **bright** (weighed by luma to the fourth).
  - **The picture's colors** : `paletteOf(grid)` reads every cell of the master's light
    grid into twelve hue bins (weighed by chroma squared × value; greys count little),
    keeps the bins over 4 % of the strongest (2 to 5), each at full strength, ordered by
    where they sit from left to right. The gradient editor's **from the picture**, and
    a new show **Picture colors**. The master is now always in the light readback (it
    is the palette's source).
  - **Output delay** (`LightOutput.delay`, 0..1000 ms, per output) : each output's frame
    goes out that much later (an Enttec's and the network's alike), so the lights land
    with a projector's picture; **sync** on an Art-Net output closes each frame with an
    ArtSync (OpSync 0x5200, 14 bytes), new packet kind `artsync` in `DmxSender`.
  - Tested : 37 Node checks (12 new : the dimmer at 0.5 and in 16 bits, a dim orange
    keeping its color, L, L16, DCMY, the channel counts, vivid against average, bright,
    the palette and an empty one, ArtSync received on 127.0.0.1). In the test copy : the
    D16RGB spot on the wire at level 0.4 (102 102 / 0 0 255), one ArtSync per frame at 40
    fps, the delay measured from a color change to its packet (2 to 18 ms at 0, 314 to
    332 ms at 300), the palette read from the live readback of three themes.
- **Lights, closer to the lighting world (2/4) : groups, several lights at once, fixture
  profiles and Open Fixture Library files.**
  - **Picking several** (`lightPicked`) : Shift / Ctrl + click on the map or in the list;
    a drag moves them all, the arrows and Delete act on all; the inspector becomes
    **N lights** (`ManyInspector`) : the look, the tuning and the profile go to all of
    them (`setLightLooks`, `setLightTunes`, `applyLightProfile(ids)`), the values shown
    are the selected one's, no M there (one light's or a group's sliders take it). A
    show goes to the picked lights alone when several are picked (`applyLightShow(id,
    ids)`; the section title says so).
  - **Groups** (`LightRig.groups`, this computer's; `LightsSession.groups` their faders,
    the session's, kept in light scenes : the cues) : + group from the picked lights, click to pick
    them, rename, set, remove (its modulation goes with it). A group's **fader** multiplies
    its lights' levels in the engine; it is a modulation target (`{ kind: 'light',
    fixture: 'grp:<id>', field: 'level' }`, through lightBaseValue / commitLightValue
    and the Modulate panel's label), a console knob (MIDI Learn `lights:group:<id>`;
    every `lights:` id is now a continuous target) and OSC `/opsia/lights/group/<n or
    name>`.
  - **Profiles** (`shared/lightProfiles.ts`, 17 built in, generic names) and **Open
    Fixture Library files** (`lights/ofl.ts`, `readOfl`) : every mode of a file becomes
    a profile; Intensity → `D` (with a fine alias right after it : `D16`), ColorIntensity
    → R G B W A U C M Y, ShutterStrobe held at its Open (or NoFunction) range, Pan /
    Tilt at their default or 128, everything else at its default value, its NoFunction
    or first wheel slot, or 0; a dimmer-only mode's dimmer becomes `L`; a matrix block
    (per pixel) becomes the pixel layout of a bar or a matrix, the channels before and
    after it the fixture's **head** and **tail**; a per-channel matrix is left out and
    said. Imported profiles live in the rig (`LightRig.profiles`, up to 128). The patch
    shows **each channel numbered** (an imported profile's own labels : "shutter (held
    open at 8)").
  - **Head and tail** (`LightFixture.head / tail / profile`) : channels sent once before
    and after the pixels. A `D` there is the whole fixture's dimmer (its brightest
    pixel) and the pixels go out relative to it; colors there are the fixture's mean.
    A block never straddles two universes.
  - Tested : 54 Node checks (17 new : a bar's head dimmer and its pixels relative to
    it, a tail, the group faders multiplied and a light in two, group levels sanitized
    and kept in scenes, a built-in profile, an OFL file of four modes : the 11-channel
    mode's layout and its bytes on the wire, the pixel mode's head / pixels / tail, a
    dimmer-only mode, the per-channel one left out, junk files). In the test copy : four
    spots picked with Ctrl + click in the list, made a group, Sunset given to them alone,
    the group fader at 0.3 and its console knob, a built-in profile on a bar, an OFL
    file imported through the page's own file input (three modes, the channel map read
    out), the rig saved with its group and profiles.
- **Lights, closer to the lighting world (3/4) : the patch view, the test pattern, finding
  the nodes, bends and rings and the 16 matrix wirings, placing faster.**
  - **Patch view** (map | patch) : every universe in use as a 32 × 16 grid, each light in
    its color (hashed from its id), shared channels red and counted, click to select,
    drag to readdress (`fixtureSpans` in shared/lights.ts : the engine's own block
    placement, so the view and the bytes agree); **address in order** per output
    (`addressedInOrder` : one after the other, a light that would cross starts the next
    universe, a long pixel bar flows over). The inspector shows the **DIP** switches of
    the address (`dipOf`).
  - **The test pattern** (`lightTest`, the engine's `test`) : a line sweeping the room
    diagonally at 0.35 passes a second, red, green, blue, white in turn, past the
    masters, Black, the tuning and the smoothing.
  - **Finding the nodes** (`discoverLights` in main/light.ts, IPC `light:discover`) : an
    ArtPoll to every IPv4 broadcast (the socket on 6454 with reuseAddr, or any port),
    ArtPollReplies read (`parseArtPollReply` : IP, names, the output ports' 15-bit
    universes); WLED by mDNS (`_wled._tcp`, `wledFromResponse`). **find** on Art-Net,
    sACN and WLED outputs.
  - **Shapes** : `LightKind` 'ring' (a circle around (x0, y0), its first LED at (x1, y1),
    round in the room's proportions, clockwise or not); a strip's `bends` (double-click
    to add, drag, double-click to remove, straighten; LEDs evenly spaced by length in
    the room : `fixturePoints(f, aspect)`, the aspect now in the engine's geometry
    signature); a matrix's `start` corner and `byCols` with the zigzag : the 16 wirings
    (`matrixCells`; the old `reverse` still reads as before), drawn as a small path in
    the inspector. The map draws every kind from `fixturePoints`, and marks each light's
    first LED.
  - **Placing** : a rubber band on the empty map picks (Shift / Ctrl adds); **Place** for
    several lights (in a row, in a column, spread across / down, mirror left-right /
    top-bottom, bends included); **a row of N** across or down from one light
    (`rowOf` : addressed in turn, picked); a **photo** of the room under the map
    (downscaled to 1280 px JPEG, localStorage `opsia.lightPhoto`) with the picture over
    it at an opacity.
  - Tested : 81 Node checks (27 new : an L-shaped bar's LEDs evenly spaced and its
    middle on the bend, a ring's radius, first LED and direction, the matrix wirings
    including all 16 distinct, the spans of a long bar with a head and the engine's bytes
    exactly on them, an Enttec's cut, address in order with a crossing, a row of 4 and
    its addresses, DIP 37, the test pattern's red then green through Black, an
    ArtPollReply, a WLED mDNS answer, the discovery finding a fake node on 127.0.0.2). In
    the test copy : a bend by double-click and its drag, a matrix wired from the bottom
    right by columns in zigzag, a rubber band, a row of 4, an overlap in the patch view
    (72 channels red) cleared by address in order, the test pattern, a room photo through
    the page's input.
- **Lights, closer to the lighting world (4/4) : light by light, wings and fans, cues,
  presence, the sound by band.**
  - **Light by light** (`LightLook.order` : room / ltr / center / random / oddeven,
    `wings` 1 to 4) : the fixtures with the same order and wings make a set, ranked (by
    their middle from left to right, from the room's center, by a hash of their id, or
    alternating), each at (rank + 0.5) / N, folded into mirrored wings. A chase or a
    wave runs over that place (the whole light one step), a pulse ripples, a sparkle
    twinkles whole lights, the beat becomes a step chase (one distinct place a flash).
    The room order keeps everything as before.
  - **Fan** (`LightLook.fan`, -180..180°, modulatable) : a hue turn of fan × (place -
    0.5), the place along the order or across the room at the effect's direction (the
    room's four corners projected); the color wheel's way, as the color's hue slider.
  - **Presence** (effect `presence`) : 1 - depth + depth × the nearest person's
    exp(-1.5 (d / near)²), the people from the Body page (the Room tracker's boxes, or
    the pose's visible points; mirrored as the Body page is), read only while a light
    uses it.
  - **The sound by band** (`LightLook.band` : all / lows / mids / highs) : the six
    bands paired, each smoothed (60 ms).
  - **Cues** (`LightScene.fade / follow / link`; store `lightCue`, `lightCueAt`,
    `lightCueRun`, `lightFadeSec`, `goLightCue`, `setLightCueRun`, `updateLightScene`) :
    the light scenes are a cue list (`components/LightCues.tsx`, on the Lights page and
    as the Seq page's **Light cues** lane, `SeqLaneId` 'lights' : the transport starts it
    when a cue has a follow time). Each cue's own fade; while following, the next goes
    its follow time after the cue is in; a Palinopsia scene's recall brings the cue tied
    to it. MIDI `fire:lightsgo`, `fire:lightsback`, `fire:lightscues`; OSC
    `/opsia/lights/go`, `back`, `cues`.
  - **Fixed** : light scenes saved in the same millisecond (a script, OSC `save` twice)
    took the same id, so a cue list could never move past them; a saved scene now gets
    a random suffix, and a session's duplicate ids are made apart when it loads.
  - Tested : 90 Node checks (9 new : the chase from the first light to the second left
    to right, wings 2 lighting both ends together, from the center, the beat's step
    chase, presence near a person, the lows against the highs, the fan's two ends turned
    apart, the new fields sanitized, two cues with one id made apart). In the test copy :
    three cues following on (the second at 1.43 s and the third at 2.89 s for a 0.4 s
    fade and a 1 s follow), a Palinopsia scene bringing its cue, GO and back, the Seq
    lane, six spots in a light-by-light chase with wings 2 and a fan.
- **Lights : an audit, a first-time path, light setups, digital shows** (Vincent : "Run a
  full audit of the new Lights section; make sure its UI is consistent with other sections,
  and clear, useful and easy to use for a non-initiated person just wanting to set up a few
  lights all connected together in a chain on an ENTTEC DMX USB PRO. And make some more
  'digital arts' and experimental shows"; then "Make SURE the led bars work with this
  model" (a 2-pack of 1 m, 90-LED, 30-zone RGB pixel bars, modes 3 / 5 / 8 / 90 / 94), "let
  the lights setup be saved so I can reload a project visuals but switch light setup",
  "the back button should read : back to Output").
  - **Set up** (`SetupGuide`, the right panel with nothing selected) : five steps that tick
    (the interface and the chain explained; a kind and a count, `addLightChain` /
    `chainOf` : the Enttec output made if none, a row, addressed in turn; each light's
    address with its DIP switches, shared channels flagged with a **fix**; the test; a
    show). The header says in words whether the Enttec is found (`IfaceStatus`); the
    Enttec row writes its state in full ("not found yet : plug it into a USB port").
  - **The 30-zone bars** (`shared/lightProfiles.ts`) : `b:bar30-90` (30 × RGB),
    `b:bar30-94` (30 × RGB then strobe, pattern, speed, background held at 0), `b:bar-5`
    (D S R G B), `b:bar-8` (D R G B S 0 0 0), with a label per channel. The orders come
    from the listing (30 zones of 3 RGB LEDs, modes 3 / 5 / 8 / 90 / 94) and the manual of
    the same family's 12-zone bar (same menu and modes : 3 = R G B; 5 = dimmer, strobe,
    R G B; 8 = dimmer, R G B, strobe, pattern, speed, background; N × 3 = the zones; N × 3
    + 4 = the zones then strobe, pattern, speed, background). **Not verified on the bars
    themselves** (none here) : the test pattern is the check.
  - **Light setups** (`LightSetup`, `lightSetups` / `lightSetupName`, localStorage
    `opsia.lightSetups`; `main/lightSetup.ts`, IPC `light:setupSave` / `light:setupOpen`,
    `.opsialights`) : the rig and the session's lights by name; `applyLightSetup` keeps
    the one it replaces first, clears the selection, the cue and the test.
  - **The page in the app's terms** : sections with the Output page's info dot and filled
    buttons, "Lights" for the list, "kind" for a light's profile, "area" for the sampled
    patch, "picture" for the master backdrop, "CUE FADE", cues named "Cue N", **sending /
    not sending**, **← back to Output** (it opens the Output page), show names that fit
    (a wider column, "The picture"), each show with a swatch, in two groups.
  - **Digital effects and shows** (`lights/lightFx.ts`) : afterimage (a slow trace of the
    picture; where it moved on, the trace's complement), echo (a 10 Hz delay line, 0.3 to
    8 s), sample and hold, eight colors (one bit a channel, a third of a second held),
    glitch (blocks of primaries, negatives, displaced reads), tape head (the sampling
    place slides, mirrored at the edges), automaton (elementary rules with their history
    as a time-space diagram across the room, warm-started; light by light : a cell a
    light), the Game of Life (a torus over the room, a heat trail, reseeded when it
    settles), fireflies (mean-field coupled phases whose pull swells and falls over 45 s),
    clouds (two octaves of value noise), binary count. Twelve shows : Afterimage, Echo,
    Sample and hold, Eight colors, Glitch, Tape head, Rule 30, Triangles, Game of Life,
    Fireflies, Cloud field, Binary count. `LightLook.rule`. A show now clears the order,
    wings, fan and band the last one set.
  - **Fixed, from two code reviews (55 findings read against the code)** :
    - *Flash safety* : effect clocks were `clock × rate` with the master speed in both, so
      speed 4 gave a pulse at 12 Hz, and any change of rate re-phased the effect. One
      integrated phase per rate now (`phaseOf`, capped at 3 a second; a modulated rate
      integrates its own). The beat effect never flashes twice within a third of a
      second; the sound effect follows up in 70 ms and down in 330 ms (hi-hats no longer
      flash it); a gradient's drift is capped.
    - *sACN* : universe 0 was sent as 1 and collided with the real universe 1 : sACN now
      counts from 1 (`firstUniverse`). Two outputs to one place share its universes
      (buffers keyed by destination). WLED is sent as R G B on an LED boundary whatever
      the layout. A universe past the last one is an overflow.
    - *A last dark frame* : a destination that stops being fed gets one universe of zeros
      (sending off, an output off or removed, the last light gone, quitting); the Enttec
      link writes it even behind a frame in progress and closes after it.
    - *The Enttec link* : a link closed while opening lets its port go (it used to keep
      it : "already open" for ever); only the link whose port left reacts to a
      disconnect; a delayed frame is dropped when its output went off.
    - *Cues* : a cue stores every light and every group fader (one saved on the default
      look could not bring it back); a fade begun during another starts from what the
      room shows; a cue's grand master comes in over its fade; New and Open reset the cue
      in play; follow needs a follow time and counts from when it is turned on; OSC `go`
      / `back` / `save` fire on the rising edge.
    - *Patching* : the next free address comes from the real channel spans (a long bar's
      spill counted, the next universe when it would not fit : `nextSlot`); ids of lights
      made together can no longer collide; a layout is never cut inside a token (128
      tokens); a 4096-cell cap on a matrix; the patch view's click no longer readdresses,
      and lists what does not fit.
    - *Fixture files* : the pixel count comes from what the block repeats over; a fine
      channel pairs only with its own coarse one; a combined dimmer / strobe is held
      full; an unknown channel or an unreadable mode is left out and named instead of
      held at 0; 16-bit defaults read as their coarse byte.
    - *State* : a light dragged keeps what it shows (state kept when the pixel count is
      unchanged); a fader at 0 is dark whatever the contrast and the floor; identify and
      the test answer at once during a fade; a NaN from a modulator is ignored, and the
      lights' tick has its own guard; stale source pictures are dropped; the lights of
      the session are in undo; a removed light or group makes no empty undo step and its
      bindings no longer count against the cap.
    - *The page* : its keys no longer act under another page, Esc follows the app's
      order, a new light is the one selected, the test and identify end when the page
      closes, numbers and addresses are taken when typed whole, a kind change keeps a
      sensible shape, a profile without a size keeps the light's own kind, nudges and
      copies take a bar's bends along, an output with lights needs a second click to
      remove, several lights can be patched to an output at once, the map's pointer is
      right at any UI zoom, a click with a wobble moves nothing, one write a drag.
  - Left for later (said, not built) : sACN multicast on every network interface (the
    system's default one only), an output menu's undo, RDM (the Pro and these bars speak
    it : the app could find the lights and set their addresses itself).
  - Tested : 138 Node checks (48 new : the bars' four modes byte for byte, two bars on
    one Enttec at 1 and 91, the test's red band along them; the speed cap; each digital
    effect; sACN from 1; shared destinations; WLED; the next slot after a long bar; 32
    ids; kind and profile changes; a dark fader; a fade inside a fade; a setup through
    its text). In the test copy : the guide adding the bars from the Output page's LIGHTS
    button, the test's band on the map, two setups switched, back to Output. **Not
    verified : a real Enttec, the real bars.**
- **Lights : RDM, the lights answer back** (Vincent : "build RDM so the app finds the bars
  and sets their addresses"). `lights/rdm.ts` : E1.20 packets (built, read, checksums),
  the discovery's binary search over the 48-bit ids (DISC_UNIQUE_BRANCH, the answers
  decoded, a clash split, MUTE / UN_MUTE; a clash that reads as a valid id is split when
  no light answers its mute), DEVICE_INFO, labels, DMX_PERSONALITY(_DESCRIPTION),
  DMX_START_ADDRESS, IDENTIFY_DEVICE, ACK_TIMER waited. Through the Enttec Pro's own
  messages (`enttec.ts` : label 7 a request, 11 a discovery branch, 5 the answer after a
  status byte, 12 nothing in time, 10 the serial number : our id is 454E:<serial>); the
  link now reads (`EnttecReader`, a read loop closed with the port). The page : **Ask the
  lights (RDM)** under the Set up guide (find, blink, mode, address, address in a row,
  put on the map : `addLightsFromLine`, `profileForFootprint`). Tested : 21 Node checks
  against a simulated line (six bars incl. far ids, one silent, one that will not stay
  muted, 24 close ids, a NACK, an ACK_TIMER) and a simulated Pro (its labels, answers cut
  in two, noise); in the test copy through the real Web Serial path with a fake Pro on
  `navigator.serial` and two bars (found, one switched from 5CH to 90CH, addressed 1 and
  91, blink on then off when the page closed, put on the map as 30-zone bars). **Not
  verified : a real Pro, real lights.**
- **Lights : more to modulate, a grade per group, three more masters** (Vincent : "I
  should be able to modulate more stuff inside the Lights section, especially in the
  Tuning section of the groups. Also : add more master controls, like master brightness,
  master saturation and master contrast, as knobs between speed and cue fade").
  `LightsMaster.gain / saturation / contrast` (0..2, knobs BRIGHT, SATURATION, CONTRAST
  between SPEED and CUE FADE; MIDI `lights:gain`, `lights:sat`, `lights:contrast`; OSC
  `/opsia/lights/brightness`, `saturation`, `contrast`; mod fields `masterGain`,
  `masterSaturation`, `masterContrast`). `GroupTune` (`lightsSession.groupTunes`, kept
  in cues) : a grade per group over its lights' tuning, in a **Group · name** section of
  the inspector when a group is picked, each slider a target (`grp:<id>` with
  `tuneBrightness`, `tuneContrast`, `tuneSaturation`, `tuneHue`, `tuneWarmth`, and its
  fader). New targets on a light : `tuneContrast`, `tuneGamma`, `tuneBlack`,
  `tuneSmooth`, `gradSpeed`, `area`. 143 Node checks (5 new).
- **dataflou : the data view, what flows in and out live** (Vincent : "une façon de
  visualiser le data entrant et sortant de dataflou directement dans la section dataflou").
  A **data** box in the Connect tab's dataflou section, above the connections : each of our
  destinations a node feeds (↙, from node/path) and each source a node streams from us (↗,
  to node/path), the value now, an 80-point sparkline (a swatch for colors), values a
  second; grey after 2 s of silence or when the other node is gone; values SET from
  elsewhere on unwired paths show for 10 s. `DataflouNode.io()` (main) counts per path in
  `deliver()` and per stream in the pump, rolled each second; `dataflou:io` IPC, polled at
  10 Hz only while the box is open (folding remembered in `opsia.dfData`).
- **Macro : destination capsules and a range per knob** (Vincent : "add macro
  destinations capsules (like on the top of the Modulation tab) to the Macro tab" and
  "add a min max to the Macro knobs so I can use them to scale the data better"). The
  Macro title bar carries a capsule per destination, knob by knob (`MacroDests` in
  `MetaBar.tsx`; the label is the Modulation chips' own, hoisted to
  `describeModTarget`), with the count under the name; a capsule lights its knob, **×**
  takes the destination off. Each knob gets a **range** (`MetaKnobState.min` / `max`,
  optional, 0..1 of each destination's range; min above max turns it the other way) :
  a bar with two ends to drag and two numbers to type, under the curve. One `knobOut()`
  (curve, then range) serves every path a knob takes (glides, the settle-time fan-out,
  a modulator on the knob), so a drag, MIDI, OSC and a modulator land the same. The
  destinations follow a range change at once (through the knob's own overlay at rest;
  a modulated knob is left to its modulator). Sanitized on load, compared by the
  persistence gate, glided by morphs. OSC `/opsia/macro/{k}/min|max` (and in OSCQuery).
  Two more lines in the Macro row.
- **dataflou : scenes, and the visualizer of 11-11** (Vincent : "integrate the new
  dataflou packages (from the recently pulled repo) into a new version of Palinopsia").
  The dataflou core (Alexandre Burton, 518c67f) added **scenes** : sets of connections
  each node keeps for itself in 16 slots, recalled or stored by a cue the universe shares
  (Lamport counter, then the CRC32 of the sender's sku, so concurrent cues converge),
  relayed once by each node, carried by HELLO and DIGEST for late joiners, a node's
  status (none / applied / modified / missing, its slots, skipped) in its DECLARE.
  Palinopsia's TypeScript node now speaks it (`protocol.ts` : `scene` [slot, counter,
  origin] on HELLO / DIGEST, `scene_status` on DECLARE, the SCENE message, as strict as
  the core's decoder; `node.ts` : load / store / apply / merge, a restart in the same cue
  does not re-apply, hand edits after a recall read modified), both nodes, slots per
  universe in `dataflou/scenes-<universe>[-session].json`. The visualizer page rebuilt
  from dataflou's web/ at 518c67f (scenes panel, universe selector, host address,
  ip:port, undo / redo, NDI video through dataflou's own bridge); Palinopsia's server
  answers what it now asks : `universe`, `host_ips`, each node's `address` / `port` /
  `scene` in the snapshot, the `scene` message both ways, `set_universe` (the renderer
  keeps the setting, so it changes it there and reconfigures). Tested : 21 checks
  across three Palinopsia nodes (stores and recalls from both sides, hand edits, a late
  joiner, a restart), the page's own scenes panel and universe switch on the test
  copy. The reference C++ node at 518c67f does not run on this Windows PC (its Release
  build aborts at start with 0xc0000409, a stack-buffer check; its Debug build hangs
  before listening), so the cross-check against C++ is by code : an older core
  ignores the SCENE message and the new keys and keeps the connection.
- **dataflou : watch any outside value, and a data view for a connected show**
  (Vincent : "add the watch toggle to the data view" and "I see a lot of Palinopsia
  parameters that I can already monitor elsewhere [...] I want to see useful stuff for a
  dataflou connected scenario"). A **◉** on every parameter of another node streams it
  to Palinopsia only to be seen (a stream with no destination, as the visualizer's
  monitors, 30 a second, kept whether a page is open : `DataflouNode.setWatches`,
  `pollMonitors` now keeps watches beside the page's monitors); the list is the
  renderer's (localStorage `opsia.dfWatch`, per universe, IPC `dataflou:watch`). The
  data view is now **into Palinopsia** / **watching** / **from Palinopsia**; the
  streams other nodes open to MONITOR Palinopsia (a visualizer on them asks for all 256
  of its values : Macro knobs, vision, audio, body, modulators) were each a ↗ row, now
  one line (`DfIo.watchedBy`). Tested with a stand-in gloves node (2 × 6 IMU values,
  monitoring Palinopsia) on the test copy : 256 monitor rows gone to one line, two
  watched values at ~22/s with their lines, a wired one in "into Palinopsia".
- **dataflou : mapping when other nodes play Palinopsia** (Vincent picked 1 to 6 of the
  11-11 shelf : "Implement them intelligently"). (1) **→ Palinopsia…** offers **a free
  Macro knob** (no destination, no wire, no modulator, not persistent; named after the
  source, the Macro row shown) and **a free modulator** (no binding, not persistent; a
  Controller first). (2) A **Controller** modulator takes a mesh value as its input
  (`ModulatorConfig.mesh`, sanitized on load) : main streams it with no destination
  (`DataflouNode.setListens`, like the watches) and pushes it once a frame
  (`dataflou:remote`, 0..1 of the remote range through `remote01`) into `controlBus`
  `in:<slot>`, so Palinopsia's declared tree (and the C++ 128-entry limit) is
  untouched. (3) **Learn from the mesh** : `learnStart` makes every remote value stream
  (as the page's monitors), `learnPeek` answers the one that swept at least a quarter of
  its range the most; the M panel's ◈ (under "macro") puts it on a free Macro knob
  driving that control, the Controller card's ◈ makes it the card's input. (4) A wire's
  **⚙** : range (lo / hi of the destination), invert (main, `shapeWire` on the way in)
  and smoothing (renderer, a one-pole slew in ms) : `DfSub.opt` / `DfWireOpt`, kept in
  the bindings file, `cleanWireOpt`. (5) **◈ badges** (`MeshBadge`) on the controls a
  wire plays : layer opacity / mix / vary, Background opacity, the Macro tiles; lit
  while values arrive, right-click unwires. (6) **On loss** : hold, or glide back over
  N s to where the control was before the wire began (remembered at every wire's first
  value after a quiet spell, so turning the option on later still knows), after 2 s of
  quiet. Tested on the test copy with a stand-in gloves node (12 IMU values that sweep
  on cue) : 17 checks, all six features through the real interface (the free knob named
  and following, the modulator swinging L2 opacity 0.05 to 0.99 on a sweep, learn
  catching the swept axis among the resting ones, range + invert 0.296 in 0.29..0.31,
  smoothing halving the swing, three badges, the glide back to 0.9 after the gloves
  stopped).

- **Morphogen and Current : reaction-diffusion and fluid as effects** (Vincent :
  "Reaction-diffusion and fluid as effects that any layer feeds and steers, not only as
  sources"). Two native nodes in a new **Organic** group of the FX picker, both
  self-contained (any rack), both on the sources' OWN simulations, shared rather than
  forked : `engine/reactionSim.ts` (the Gray-Scott grid, step, resample and display copy,
  now used by the Reaction source too, plus an `RD_STEER` build of the same step and an
  advection pass) and `engine/fluidSolver.ts` (advection, splats, vorticity confinement,
  Jacobi pressure, stir : used by the Fluid source too); the optical-flow passes moved
  from `convNodes.ts` to `engine/pictureFlow.ts` (`PictureFlow`, a fixed 256 field) for
  both.
  - **Morphogen** (`node-reaction`, `engine/morphogenNode.ts`) : the picture's brightness
    or its warm / cool color pushes feed and kill per cell (`dark / light`), it plants V
    along its edges, where it moves or in its lights, and its motion carries the living
    state (`follow motion`). Five looks, one small program each : through, ink, emboss,
    matte, warp. A `steered by` sidechain takes over the steering. 11 presets.
  - **Current** (`node-fluid`, `engine/currentNode.ts`) : the picture is the dye (RGBA16F,
    premultiplied, up to 1080 rows); its motion drags the water toward its own velocity
    (a bounded pull), `light rises` is buoyancy from luma (to the zenith under the full
    dome, `lib/dome.glsl`), `churn` four wandering pushes, `memory` the live picture's
    refresh rate, `keep still` the sharp picture where the water is still. A `moved by`
    sidechain takes over the pushing. 10 presets.
  - Fixed grids : the pattern and the water keep their size and speed at 1080p, 4K and
    on the 4096 dome. Measured on the RTX 4070 (render + finish, median of 20) :
    Morphogen +0.2 ms at 1080p, +0.7 ms at 4K, +0.4 ms on the dome (2048Â² composition); Current +0.3, +0.3, +0.4 ms; the two together on one layer hold 60 fps at all three, and two of each on two layers hold 60 fps on the dome (3.8 ms a frame in all), 59 at 1080p, 55 at 4K.
  - The Reaction and Fluid sources run on the shared code with the same arithmetic and
    pass order (checked in the test copy : Reaction alive at 61 fps, Fluid ink, smoke and fire at 60 fps, stir still fires).
  - The **Field effects** master chains (8 : Grown Picture, Coral Print, Carved Program,
    Ink Water, Smoke Program, Wet Growth, Steered Growth, Stirred by the Top) and the
    Generate themes **Grown Over**, **Coral Print**, **Ink Current**, **Rising Smoke**
    (Organic / Reaction-Diffusion), **Noise Garden** and **Noise Water** (Node Workshop).
- **Noise : a raw noise field** (the shelf's "NOISE module : raw noise field ... Taste :
  curate ranges matte (contrast, posterized), never color plasma", with "Band-limited
  noise : an analytic 'focus' knob"). `shaders/isf/Noise.fs`, an Analog source beside
  Ramps : value, gradient, cellular, cracks, ridged, billow, warped; scale, octaves
  (fractional), rough, seed; contrast, level, steps (posterized with soft, pixel-wide band
  edges), invert, key (dark = clear), a two-field `map` (red and green) for Remap or
  Displace; drift along an angle (`PH_noiseDX/DY`), evolve (each lattice point on its own
  cycle : it morphs in place, never loops), `sync` to the tempo (a new field a bar · 1/2 ·
  1/4 · 1/8, `glide` cut to melt, at most 4 a second, `PH_noiseEvolve`). **focus** is an
  analytic defocus : each octave is attenuated by what a gaussian of the pixel footprint
  plus the focus radius leaves of it (octaves under 1 % are skipped), so it never aliases
  and costs nothing more; it is in `RANDOMIZE_SKIP` with the map, key, seamless, sync and
  tint. Under the full dome (fill) the field lies round on the disc (`domeDisc`) and its
  drift turns round the zenith (`PH_noiseTurn`); `seamless` repeats it exactly across the
  width for the wrap mode. The lattice wraps at 4096 cells an octave (hash inputs stay
  small : exact for days). Cost over a solid color : the default (gradient, 4 octaves) +0.3 ms at 1080p, +1.7 ms at 4K, +0.8 ms on the dome; warped +1.2, +4.0, +1.9 ms. 12 presets, filed as a lit ground for
  Randomize, the **Noise Matte** theme (Analog Video Synthesis).
- **Spout / Syphon input : another program's picture on this computer as a layer source**
  (Vincent : "Spout / Syphon input"; the shelf : take TouchDesigner / Resolume / Unity
  output on the same computer at full quality and low latency instead of compressing it
  through NDI or grabbing the screen). **Spout / Syphon Input…** in the source menu's live
  group (beside NDI Input…) lists the senders running here (`SharePicker.tsx`, sizes, this
  app's own output marked as a loop) and receives one into the layer like the NDI input :
  framing, People (now also on a `VideoFrame`, `personMask.ts`), FX, one receiver per
  sender shared by every layer, **Switch input** and a live readout in the Inspector
  (`ShareInReadout` : size, fps, route). mediaId `spout:<name>` (`syphon:<name>` on a
  Mac; either opens on either, `shared/shareIn.ts`). Not offered by Generate or the dice,
  like the NDI input.
  - **Windows, the GPU route (measured, used whenever it can)** : `native/spout` now
    receives too. Each receiver runs on a thread of its own with its own D3D11 device on
    the high-performance card (the SDK sleeps 67 ms when a sender closes or resizes :
    never on the app's thread); each new frame is copied on the GPU into one of four
    textures shared by NT handle (`recvRing` / `recvTake`, never writing the two slots the
    page read last), which the preload imports ONCE with Electron's
    `sharedTexture.subtle.importSharedTexture`; the page pulls a `VideoFrame` over the
    bridge each drawn frame and uploads it GPU to GPU (`texSubImage2D(vf)` : 0.2 ms at
    1080p, 0.4 ms at 4K). No pixel crosses the CPU. `src/preload/shareIn.ts`,
    `engine/shareIn.ts`, `CaptureSource.uploadShare`.
  - **The copy route** : a sender on another graphics card (`other-gpu`, the SDK follows
    it there) or a format the shared textures cannot hold (BGRX) falls back by itself :
    the receiver thread copies to a staging texture and maps it at once (not the SDK's
    two-staging read, a frame late : 33 → 18 ms at 1080p in Node), BGRA swapped to RGBA,
    then `recvRead` copies it into the page's pooled buffer on a worker thread (the NDI
    input's transfer shape, `opsia:shareinport`).
  - **Reconnection** : a sender that is not there yet, closes, restarts or changes size is
    found again by name (new shared textures, imported again; the old ones freed once
    their imports are released); looked for 20 times a second while absent. Polling
    paced on the sender's own frame interval (1 kHz cost 9.6 % of a core, now 6.8 % with a
    second, absent receiver) and the copy fence waited by sleeping, not spinning.
  - **Measured on the test copy (RTX 4070, a standalone Node sender drawing a time code
    into its pixels, read back from the layer's own texture)** : GPU route 1080p60 :
    app 60 fps, 51-53 new frames/s in the layer (newest wins), sender clock to pixels
    p50 13 ms / p95 22 ms, colors exact; 4K60 : 60 fps, p50 21 / p95 32 ms. Copy route
    (the sender on the Intel iGPU, BGRA) : 1080p 54 frames/s, p50 20 / p95 28 ms; 4K
    37 frames/s, p50 44 / p95 55 ms, the app at 60 fps. CPU (whole renderer process, one
    core = 100 %) : 18 % with the 1080p input vs 8 % without; GPU process 20 vs 18 %.
    Survived 30 s of the sender resizing every 5 s (1080p → 720p → 4K) and closing /
    reopening twice : picked up within a second each time, worst app frame 18 ms
    throughout; two layers on one sender showed the same frame 300 / 300 frames; a page
    reload stops its receivers (addon cleanup hook) and starts new ones. Under the dome
    (4096 master, 210° fill, 2048² composition) 60 fps and 51.5 new frames/s, as flat.
  - **macOS (Syphon), UNTESTED (no Mac here)** : `native/syphon` gains a client
    (`SyphonServerDirectory` + `SyphonMetalClient`, labels "app : name"), run in MAIN
    (`main/syphonIn.ts` : Syphon's notifications need its run loop) which imports each
    server's IOSurface with `sharedTexture.importSharedTexture` and sends it to the window
    once per size (`sendSharedTexture`), then a small tick per frame; the window's copy
    route reads the surface by its id (`readSurface`, `IOSurfaceLookup`). Built only on
    the mac CI leg; `build.sh` now loads the addon in Node once (a missing symbol shows
    in CI). The surface is assumed top row first (as SyphonMetalServer blits it); if a
    Mac shows it upside down, the framing's mirror fixes it.
  - Also : the preload finds the Spout / Syphon addon in a test build too (it looked one
    folder too high, so the test copy's Spout output always fell back to main);
    `open(name, format, adapter)` and `adapters()` for test senders.

### Fixed

- **A camera opens in the selfie view, and remembers its mirror** (Vincent : "when a
  Webcam or Live Input is opened, its always mirrored by default, correct this ... when I
  raise my left arm standing in front of the camera, I want to see my left arm at the
  left of the screen"). A camera arrives as others see you (a fake camera, white on its
  left half, came out white on the left : nothing in Palinopsia turned it). A Webcam, a
  Live Input or the macOS USB input now opens with the framing's mirror on
  *left-right*, and the mirror you choose is remembered per camera on this computer
  (localStorage `opsia.cameraMirror`, keyed by the camera's name;
  `setSourceCapture` / `setSourceTransform`) : a capture card set to *off* once stays
  off. Screens and NDI open as they arrive. Sessions keep the mirror they were saved
  with.

- **A slider a Macro knob drives follows the knob as it moves** (Vincent : "when you
  move the macro knob mapped to a parameter, this parameter's slider doesnt update in
  realtime, like when the Modulators are in use"). A knob's gesture plays engine-side
  and only settles in the store at its end, so the slider sat still until the release;
  the live value was in the shared map all along, but every control's live overlay
  registered only for a MODULATOR binding. One `useOnMacro()` (AutoControls) now opens
  it for a Macro destination too : the Inspector's sliders, toggles, menus and number
  boxes, an FX's opacity, the layer strip's opacity / A-B mix / blend, the Background's
  opacity / speed / shadow, a clip's speed and volume, the Audio Layer's sliders, the
  Sonify page's and the key sequencer's Every (the Mixer, the Output page and Lights
  already counted the knobs). Measured on the test copy : the layer opacity slider read
  0.1, 0.2 … 1.0 through the drag while the stored value still read 0.5.

- **dataflou : a node lost to a sleep or a disconnect comes back by itself** (Vincent :
  "quand on se déconnecte/un ordi tombe en veille, la connexion se perd (on doit fermer et
  ouvrir Max)"). The cause : mDNS raises no new event for a service seen again unchanged,
  so a peer that timed out was never dialled again; only a restart of the other side (a new
  port, a new announcement) brought it back, and the reference core never redials on its
  own. Now the node remembers where mDNS last saw each node of its universe and redials a
  lost one (the lower SKU after 2 s, the other after 6 s, then doubling up to every 30 s)
  until it answers; a goodbye (the node closed or left) forgets it. On `powerMonitor`
  resume / unlock-screen, or when the primary IPv4 changes (checked every 10 s), each node
  drops peers silent for 15 s, restarts mDNS from the current address (no goodbye), redials
  every lost node at once and re-sends its stream requests. Tested against a fake node in
  Node with its own redial switched off (like Max's core), its sockets destroyed with no
  goodbye : values flowed again after 7.2 s and 6.7 s. **Not verified : a real sleep with
  Max** (to do on his machines).

- **dataflou : the mesh mapping plays as it is set, and the mesh knows Palinopsia's
  wires** (the v1.3.3 audit, 11 findings). A smoothed or glide-back wire on the scene
  number swept through every scene on the way (each step a recall, an undo step and a
  restarted morph, and again every half second while the source held still) : `scene/recall`
  is now `discrete` (`DfDest`), played once per whole step, never smoothed nor glided
  back (the gear hides those two), and a smoothed wire's repeated value no longer plays
  again. A scene recall that made a shaped wire again made it plain : slots now keep a
  shaped wire's options as a 4th element (ours, the core never reads that file). Range and
  invert did nothing on a wire from one of Palinopsia's own sources, and such a wire was
  dead after a restart, a mesh off and on, a rename or a universe change (no local stream
  was made when the bindings came back). Smoothing and on loss followed the first shaped
  wire of a destination : they are now the destination's (the longest smoothing of its
  wires, a glide back when any asks), said so in the gear. A glide back cut short by the
  source returning remembered the mid-glide value as "before" : it keeps the place it was
  going back to. A glide back could miss its end by a rounding hair and then send the same
  value every frame forever; the 16 ms animation timer kept running while any glide-back
  wire existed : both stop when nothing glides. After a quick reconnect (inside one
  second) the watched, listened and monitored values waited up to 15 s for the keepalive :
  they are asked again on the HELLO. A learn from the mesh left running by a window reload
  streamed every remote value forever : it ends 25 s after the app last asked about it.
  Randomize re-rolled a modulator played by the mesh into another type : it is kept, with
  its bindings, like the World's. And with dataflou core 8.3 : a node's "clear"
  announcement (after its DECLARE) now empties what we knew of its connections before its
  own list follows (a wire removed while we were away no longer lingers), and Palinopsia
  follows each of its own DECLAREs the same way (a clear, then one announcement per wire
  into it), so a node that joins later sees Palinopsia's wires; older cores ignore the
  clear. Proven in Node with three nodes of our class on a private universe and the
  renderer bridge with its app modules stubbed, each check failing on master and passing
  after (scratch harness `dffix/`).
- **The new effects and the Macro range, from an audit** (Touch, Ripple, Current, Noise,
  the knob range). A held OSC finger (`/opsia/touch/hold`) whose controller stopped
  without `/opsia/touch/up` pressed on every Touch and Ripple forever, through New, Open
  and PANIC : it now lets go 3 s after the last `/hold` (`touchInput.HOLD_TIMEOUT_MS`; a
  controller that holds keeps sending it), and New, Open, Generate and PANIC let it go. A
  double click held into a drag (a heavy scene at a low frame rate) turned into a tap
  every frame (a ring or a stone per frame, the drag did nothing) : a new press clears the
  last click's ending (`TouchPoints.set`). `/opsia/macro/n/min` and `/max` moved the
  destinations only at the knob's next move, then all at once : they follow at once now,
  as the bar and the typed numbers do (`commitKnob`, unless a modulator drives the knob).
  **Randomize Meta Knobs** put the new destinations outside their good zone on a knob with
  a range (0.85 to 1 : all in their top 15 %) or a curve : a re-rolled knob starts on the
  full range, and its position is chosen through its curve (`randomize.knobPosIn`).
  **Ripple** is no longer dealt by the dice (`SELF_NODE_IDS`) : dealt into the Master FX
  or a layer's rack it took the preview's clicks and pinches from a Marbling, Sand Plate,
  Relief or Fur played by hand, with nothing to say why; the effects that take the
  pointer stay hand-placed (chains and Generate themes still use it). Modulating
  **Current**'s detail started still water at every step of it (six targets remade, the
  water never built up) : a new grid now resamples the velocity (`FluidSolver.ensure`).
  **Noise** *seamless* jumped by a cell (4096 mod the cells across) when its drift wrapped,
  within hours on an installation : it drifts on a phase of its own in frame widths,
  wrapped at the repeat (`PH_noiseSX`). Proven with esbuild checks (the double click
  held into a drag : 10 taps out of 10 frames on master, none now; the seamless field's
  largest move in a frame across the wrap : 0.97 cells at 7 across, 7.97 at 28, now one
  frame of drift; Randomize Meta Knobs on a dumped composition, knobs at 0.85..1 : 78 % of
  the destinations outside their zone on master, none now; 300 dice presses : 18 dealt a
  Ripple on master, none now) and on the test copy (`/opsia/macro/1/min 0.8` : the opacity
  0.5 -> 0.9 at once; the OSC finger held through 4 s of refreshes, gone 3.5 s after the
  last, gone after PANIC and New; Current's mean water speed across a detail step 9 to 14
  cells/s, 1.4 to 7 with the old still start; 60 fps with detail swept every frame).

### Docs

- **The docs catch up with v1.3.2** (after publishing, the sweep) : six new gallery frames
  from Generate (Liquid Metal, Clay Studio, Pelt, Singing Plate, Glasshouse, Print Shop :
  README and site), the seven interface stills retaken on the liquid-glass interface (same
  subjects and sizes; the Seq page, Sonify's families, the scene bank built from eight
  themes), and an audit of every doc against the release : the README's catalogue counts
  (50 sources, 30 nodes, 154 chains in eleven groups, 147 themes, 20 modulator types in six
  families), the Glass and Print effect groups, the loops source group, the new themes and
  chains, Ctrl+K's loops, the dome behavior of the new pieces, the Architecture map, the
  guardrails; the site's hero figures (50 / 61 / 12 / 147), its Sonify, Modulation, Seq,
  Body and click-to-play cards; the OSC reference's twelve voices; the cheat-sheet's
  click-to-play row (Relief, Fur, Sand Plate, Drape) and the rule timeline's gestures; the
  two hints Drape lacked (light angle, light height).
- **The docs for v1.3.3, the Lights release** : the release notes written out (Lights :
  setting up, playing, shows, cues, setups, outputs; dataflou; RDM); the README's Lights section in the page's own words (lights, cues,
  kind, area, **CUE FADE**, the console's group knobs and sliders), `T` in the keyboard
  table, the Lights page in the intro, the contents, the Output page and the Seq lanes;
  the OSC reference's `/opsia/lights/brightness · saturation · contrast` row and its cue
  wording; the site's **New in v1.3.3** block (held until the release is published).

## v1.3.2 — 2026-11-08

**The bar sliders are set aside, banked** (Vincent, 11-02 : "go back to the old sliders
UI, but still keep all this work in bank so it's not lost and I can work on it more
later"). The Inspector / Finishing bars, the UI tab (slider pointer, the theme moved out
of the top bar), the six pointers, the halo and the text sizes (bb6fc59, 27a8c88,
ca87277) are reverted on master : the classic sliders and the top bar's theme menu are
back, the tree as it was at 53c1a76. Everything lives on the branch `bank/bars-ui`
(with the unfinished Modulation section conversion on top, untested).

### Added

- **Print : Dither grows nine patterns and an ink, Halftone and Riso are new** (Vincent :
  "build #7 : Dither, halftone and print"). A new picker group, **Print**.
  - **Dither** (`fx/Dither.fs`, same id, the old defaults : 4x4 Bayer per channel) :
    **pattern** Bayer 2x2 / 4x4 / 8x8 (the 8x8 from the 4x4 recursed, no table), blue noise
    (white noise minus its 8 neighbors' mean, spread back to even through a tanh of its
    bell : interleaved-gradient noise drew diagonal stripes), white noise boiling on an
    integrated phase, clustered dots, line screen, cross-hatch (their thresholds remapped to
    an even spread : area share for the dots, 1 - (1 - m)^2 for the hatch, or the midtones
    print dark), and the diffusion look (local contrast, then the even threshold : a serial
    error diffusion can't be one fragment pass). **color** : colors / gray / ink on paper;
    **angle**; **boil**. Every existing preset sets the new controls to the old defaults.
  - **Halftone** (`fx/Halftone.fs`) : a turned grid, each cell's tone read at its middle,
    the dot of that coverage in five shapes (the size-for-coverage law per shape; round dots
    close up to solid past 72% as on press), each pixel taking its own cell's and its four
    neighbors' dots. Modes : ink on paper, two inks (dark + saturated part), CMYK (the
    classic separation, 15 / 75 / 0 / 45, process inks multiplied on the paper, plates slipped
    by **misregister**), color dots of light on black. **dot gain**, **soft**, **grit**.
  - **Riso** (`fx/Riso.fs`) : two or three spot inks; the separation a few rounds of
    non-negative least squares on the inks' absorbances per pixel; each plate its own
    misregistration (dealt by **seed**, wandering by **drift**), its own screen (grain, dots,
    lines at its own angle), ink **starve** in patches and drum streaks, multiply overprint
    on paper with its **tooth**.
  - Presets (Dither +11, Halftone 12, Riso 9), the chains **Newsprint**, **CMYK Press**,
    **Riso Zine**, **Ink on Paper**, the theme **Print Shop** (Living Surfaces), Inspector
    groups and grey-outs, Sonify's automatic routing hears them as signal.

- **The glass family : Glass, Rain on Glass, and a color split for Inflate's and Relief's
  glass** (Vincent : "#4 : A glass family"). A new picker group, **Glass**.
  - **Glass** (`fx/Glass.fs`, ISF) : a height per pattern (fluted columns, reeds, rippled
    cathedral noise, hammered Voronoi bowls, a fine pebble, prism facets, plain frost), its
    slope by central differences in the turned space, the picture read at the bent point,
    red / green / blue at 0.75 / 1 / 1.3 of the bend (**dispersion**), six jittered taps for
    **frost**, a sheen from the slope against a light, dark **seams** in the grooves.
    Distort's own "glass" and "corrugate" stay (a cell warp, not a pane). Hammered and
    pebbled shipped first with slopes that shattered the picture : softened to shallow
    bowls and a low stipple.
  - **Rain on Glass** (`fx/RainPane.fs`, ISF, `@dome`) : three grids of beading drops,
    each a small inverted lens with a rim and a glint; one column in four (by drops) has a
    drop sliding in stick and slip on an integrated clock (`PH_slide`), its trail clear
    through the fog and misting over with distance; the fog a six-tap scatter tinted. On
    the dome the pattern lives in the azimuth and the distance from the zenith, so drops
    slide outward.
  - **Inflate glass, Relief glass** : **glass color split** (red bends least, blue most,
    widest at the rim; the idea after Orb, MIT, no code taken) and **glass rim** (a bright edge where the glass
    turns away), both 0 by default; Inflate's preset **Prism glass**; every existing
    Relief / Inflate preset sets them to 0.
  - 10 Glass presets, 6 Rain presets, the chains **Behind Fluted Glass** and **Rainy
    Window**, the theme **Glasshouse** (Living Surfaces). 60 fps at 1080p and on the dome.

- **Foil and cavity, for Relief, Inflate and Drape** (Vincent : "#13 : Foil and finishes for
  Relief and Inflate"). `reliefShade.ts` gains material 7, a holographic foil after
  Holocloth's (MIT, credited) : flakes as cells of the frame (`uFoilScale` per frame height),
  each tilted a little its own way; the diffraction hue from the surface's own angle, the
  lamp and the place (so the rainbow runs in bands over the folds, a flake only nudging it);
  sparse glints gated by angle (`uFoilGlint`), firing as the lamp orbits; and the key move,
  the metal's color tinted by the rainbow so the reflections themselves go iridescent;
  `uFoilSat` 0 is a silver holo (the rainbow is a knob, 0.25 by default). Inflate : material
  **foil** (6); Relief : brush **foil** (8), a thin sheet pressed flat and crinkled (dents
  give its creases); Drape : material **foil** (4). New controls **foil rainbow**, **foil
  flakes**, **foil glints**, grayed out unless the foil is picked. **cavity** (Relief and
  Inflate, 0 by default : every saved look stays as it was) : the height's curvature darkens
  the creases (Relief : the Laplacian over the slope's own taps; Inflate : the divergence of
  the slope), measured on Relief clay : the joints and crossings go dark, a little grain
  catching in the cracks. Presets : Relief **Silver foil**, **Holo foil**, **Deep clay**;
  Inflate **Silver foil**, **Holo foil**, **Deep chrome**; Drape **Foil sheet**; every
  existing Relief / Inflate / Drape preset now sets the new controls to their defaults
  (presets merge). The chain **Foil Everything**, the theme **Holo Foil** (Living Surfaces).

- **Drape, a new effect : the picture on a cloth you grab** (Vincent, after the borrowing
  audit : "build #3 : Drape : a live layer on a cloth you grab (make it an FX)").
  `engine/drapeNode.ts`, native node `node-drape`, any rack. A Verlet cloth on the CPU
  adapted from Holocloth by Dmitry Kurash (MIT, credited in the file) : 44 points across,
  structural / shear / bend constraints at 1 / 0.85 / 0.35, a fixed 1/120 s step (at most 4
  a frame, on the rack's clock : a frozen layer holds its folds), 3-14 projection passes
  by stiffness, the grab re-applied after each (every point near the hit pulled toward
  the pointer by a smoothstep of its distance, keeping its offset), fold occlusion from
  how far the neighbors' mean sits in front of a point. Ours : hang / flag / float (top
  edge, left side or nothing pinned; float springs back to its rest), gravity, wind on
  each point's normal plus drag along it (a flag streams off its pole), gusts, the sound's
  onsets poking a random place, the Room's people pressing into it (their boxes, the Body
  page's mirror via `roomMirror()`), a gentle crumple at the start and on reset. Drawn
  as a mesh four times finer than the sim, each vertex a Catmull-Rom blend of 16 sim points
  from RGBA32F textures (positions, normals + fold), lit as cloth (wrapped light, sheen at
  the turning edges), satin, or Relief's plastic / chrome, the back of the sheet the print
  faint; 4x MSAA (the shared buffer), resolved into its own RGBA8 then un-premultiplied
  into the chain (an RGBA8 multisample can't resolve into the half-float chain). Square
  under dome fill. **Effects can take the pointer now** : `pointerInput.ts` routes the
  mouse and Body pinches to the selected effect, else the Master's, else from the top
  layer down its effects before its sources (`Compositor.pointerFx`, `FxRack.nodeOf`);
  an effect's gesture is live, never logged. 12 presets (Curtain, Banner, Flag, Storm
  flag, Bedsheet, Satin curtain, Black cloth, Chrome sheet, Plastic wrap, Room curtain,
  Beat cloth, Hung over the picture), master chains Hung Picture and Picture in the Wind,
  the theme **Drapery** (Living Surfaces), Inspector groups (sheet / forces / look).
  Measured on the test copy : 60 fps at 1920 x 1080 and under dome fill at 4096.

- **The loop's delay, and the Loop source** (Vincent : "build 3 and 4", the rest of the
  loop plan).
  - **Delay** (`LayerState.loopDelay` ms, `loopSync` beats : `LOOP_SYNCS` free, 1/16, 1/8,
    1/4, 1/2, 1 bar; sync wins, on the tempo / Link). `engine/loopDelay.ts` : a ring of 32
    past frames in an RGBA8 texture array, about half the layer's size inside a 64 MB budget
    (725 x 725 a slot at a 4096 dome), each slot timed; one is written every delay / 30 s so
    the ring always spans the delay, and the two slots around now - delay are crossfaded
    into a full-size target that replaces `pp.read()` as what returns (the Loop rack runs on
    it). Global clock (a layer's Speed leaves it alone : beats stay on the beat), lazy,
    freed 3 s after the delay goes back to 0, reset by PANIC. Each echo comes back through
    the small ring : it softens a little per pass (a tape echo). DELAY row in the drawer
    (slider squared over 0..4000 ms, ms box, beat menu), OSC `loopdelay` / `loopsync`, the
    Agent's `loop_delay` / `loop_sync`, morph eases the ms, a sync change hands over. Two
    recipes : **Beat echo** (1/8, lighten, shrinking off center) and **Slow echo** (400 ms,
    screen, growing and turning, hue moving); Tunnel and Echo Chamber themes deal them.
  - **Loop source** : the `SourceKind 'feedback'` types.ts had declared since phase 2 and
    nothing implemented. A slot plays a layer's picture (`feedbackLayer`, mirrored in
    `mediaId: 'layer:<i>'` so it compares and morphs like any slot), read through the
    sidechain resolver (a muted layer still renders while read) and blitted as is : its own
    layer or one above is the last frame (a loop through the slot's rack, the mix, the layer
    FX and the layer's feedback), one below is this frame. Source menu group **loops** (`↻`),
    an Inspector note, OSC / the Agent `loop 2`, Generate pools take `loop:<n>` and a theme's
    new `stackB` (per-layer B pools); new theme **Cross Loop** : layer 1 plays layer 2 on its
    B while layer 2 plays layer 1 smaller and turned (two monitors facing each other). Never
    dealt by the dice. Dome : a same-size copy of another layer, nothing to project.

- **The Loop rack : effects inside a layer's feedback** (Vincent, after the borrowing
  audit of 15 sites and Hex Composer : "build the feedback loop rack first"). A layer's
  feedback was a persistence mix AFTER its racks (`persist` : mix(new, last, amount)), so
  nothing compounded; only the Feedback node had a loop inside, with fixed controls.
  - **A fourth rack per layer**, `LayerState.loopFx` / `FxScope { kind: 'loop' }`
    (`layerRack.ts` maps the four racks for every reader : store, modulation, Macro
    smoothing, OSC, pins, morph, surface, search, Sonify's auto routing, the Agent, the
    Inspector, the Modulation panel). The engine runs it on `pp.read()` (the last
    persisted frame) on every pass, the new frame parked off the chain buffers in
    `loopHold`, then `persist` blends the two. Any effect goes in (`canHostFx` treats it as
    a layer rack); one added by hand takes `LOOP_START` values (Transform 1% zoom and a
    small turn, Hue Rotate 0.01...). It sleeps while feedback is off. The Out stage's
    feedback drawer : TRAIL, then LOOP (blend + recipe), then the rack's chips; the tab
    reads `fb 0.92 ↻` while effects run inside.
  - **Loop blends** (`LayerState.loopBlend`, `LOOP_BLENDS`) : mix (the old trail, the
    default, unchanged), add, screen, lighten, darken, multiply, difference, XOR, key.
    out = mix(new, combine(new, loop), amount), clamped to 0..1 for all but mix (add would
    climb the half-float buffer for ever). Difference and XOR are negative feedback : on a
    still picture they flip between the picture and black every frame, so they settle over
    two frames (measured : the flash limiter never engages). Key lets the loop through the
    new picture's dark and transparent parts.
  - **The dark room** : while the Loop rack runs, a part of the loop its effects left
    empty (a Transform zoomed out) counts as the dark room around the monitor where the new
    frame is there (`q.a = max(q.a, s.a)`). Without it a shrinking loop leaked its empty
    border inward on every pass and the whole layer went transparent (seen on Tunnel).
    Plain trails are untouched.
  - **Recipes** (`loopRecipes.ts`, 11) : Spiral, Tunnel, Echo key, Hue drift, Melt, Swirl,
    Drip, Rise, Chroma trail, XOR bloom, Burn, each a rack + blend + amount; the turning
    ones carry a tiny pan that sets their vortex off center, the two strongest a faint slow
    Displace (the house rule : never a centered mandala). From the drawer, `Ctrl+K`
    (**loops**, onto the selected layer), the Agent's `set_layer` / `add_effect`, Generate
    and the dice. A Contours loop (Edge inside) was tried and dropped : each pass draws the
    edges of the last pass's edges, the line count doubles and it turns to static in a
    second, threshold or not.
  - **Generate** : a theme's `loops` (+ `loopChance`) deals one to a layer that feeds back;
    Raw Feedback, Tunnel, Recursion, Echo Chamber, Palinopsia, Persistence, Wobbulator,
    Phosphor Burn, Meltwater and Melt carry some, and a new theme, **Monitor Loop**
    (Feedback / Afterimage), always does. The layer dice deal a recipe a third of the time
    they turn feedback on (never random values : they compound). Vary leaves loops alone.
  - **Everywhere else** : OSC `/opsia/layer{n}/loopblend` (advertised and mirrored) and
    `/opsia/layer{n}/loop/fx/{i}/{input}`; Body rule / dataflou actions **loop FX on/off**
    and **next loop blend** (`act:layer:<i>:loop|loopblend`), the loop's triggers
    (`act:fx:loop:<i>:…`); the Agent's racks `L1.loop`, units `L1.loop.fx.1`,
    `set_layer loop_blend`, `get_state` `loop_fx` / `loop_blend`; right-click an effect :
    **Copy to Layer N's Loop**; pins, scenes, morph (a changed loop rack or blend hands over
    by crossfade), the Metasurface, undo, sessions (old ones load with an empty Loop rack and
    the mix blend : unchanged).
  - Measured on the test copy (1920 x 1080, RTX 4070) : every recipe at 60 fps, the same as
    without the loop, the flash limiter never engaged.

- **Room : the Body page's pose for everyone in the frame** (Vincent : "improving the
  BODY tracking recognition", then "build it with the Apache 2.0 model, so it doesn't
  fuck with my licensing"). MediaPipe's pose is single-person, close range (about 4 m)
  and wants the face in view; an installation or a stage has several people, far, turning
  away. A **Room** toggle on the TRACK row (after Pose) swaps the pose for RTMO-s
  (OpenMMLab MMPose, Apache-2.0 : one-stage multi-person pose, COCO 17 points, body7
  weights, 640 x 640), run by onnxruntime-web 1.30.0 (MIT) on WebGPU in a module worker
  (`workers/poseWorker.ts` : letterboxed BGR 0..255 input, NMS 0.65, score 0.35; falls
  back to WebAssembly). `engine/roomTracker.ts` follows the people (greedy IoU matching,
  eased points, 0.7 s of grace, ids kept), picks the **main person** (the largest, 1.3x
  hysteresis), maps its 17 points onto the 33 the pose features read (`mainPose()`, so
  every pose feature, gesture and movement quality works unchanged), and adds a **Room**
  feature group (`peopleCount` (n/8), `peopleSpread`, `peopleX`, `nearestX`,
  `nearestSize`) and two Presence gestures (`personEnter` / `personLeave`, debounced 0.4 s).
  `bodyTracker.ts` runs it exactly while Pose + Room + the camera are on (one frame in
  flight, its own thread) and stops feeding MediaPipe's pose then (the silhouette's mask
  still uses it). The preview draws every person (main in blue, numbered).
  `BodyControlConfig.tracker` (`close` | `room`, absent = close). Measured on the RTX 4070
  through a fake camera : 33 to 41 ms a frame for the model, the app at 60 fps with Room
  on as off, 1.6 s to load; 1 to 7 people found on the test photos. RTMO-m was measured
  too (48 ms, 89 MB) and not shipped. `npm run fetch:pose` (`scripts/fetch-pose.mjs`)
  fetches the runtime, the model (out of OpenMMLab's zip, unpacked with zlib) and both
  licenses, pinned and SHA-256 checked, into the git-ignored `resources/pose` (63 MB);
  electron-builder ships them, CI fetches them (cached), the test build copies them.
  YOLOv8 pose was considered and refused : Ultralytics' weights are AGPL-3.0.

- **The dataflou mesh visualizer, from Palinopsia** (Vincent : "add a button in the dataflou
  section of Palinopsia to be able to launch the web page of the mesh visualiser"). The
  dataflou project's own page (Alexandre Burton's visualizer, `124_dataflou/web`) needs a node
  that serves it and answers its `/ws` socket, which only the reference C++ node did.
  `main/dataflou/visualizer.ts` does it : an HTTP server on 127.0.0.1 (an ephemeral port, on
  the first click) serving the page's files from `resources/dataflou-visualizer`, and the
  socket's protocol : a `snapshot` ten times a second (every node of our world view as a
  tree with its values and wires; two a second in the page's high performance mode),
  `subscribe` / `unsubscribe` (`subscribeRemote`), `set_value` (ours plays like an arriving
  value, another node's goes to it), `flush_node`, `identify`, `perf_mode`; parameter edits are
  refused with a toast. The node gained the reference's visualizer monitors (a STREAMREQ with no
  destination path for every remote param, at most 256, 10 Hz, kept alive and stopped when the
  last page closes) and keeps what arrives on our destinations; the renderer samples every
  source while a page is open. `scripts/build-dataflou-visualizer.mjs` (`npm run
  build:visualizer [web folder]`) builds the page from a dataflou checkout, answering the
  editor panel's imports from the Atelier project (not on this computer) with a stand-in.
  The built page is committed (`resources/dataflou-visualizer`) and ships in every build
  (electron-builder `extraResources`), included with its author's permission (Vincent,
  2026-11-07 : "Alex is ok with me including the code in my app"), credited in
  `THIRD_PARTY_NOTICES.md` with d3 (ISC). Measured in the test copy with a second node : 10 snapshots a second, the
  other node's moving value live in them, a wire made from the socket shown at once and
  Palinopsia's density following it, unwired, a delete refused with its toast; the page in a
  browser drew both nodes (`web v57 · core v8 (Palinopsia)`).
- **The Body rule list on the dataflou mesh** (Vincent : "the dropdown selector for creating a
  BODY rule : I want these options as dataflou destinations in Palinopsia"). **actions** in the
  dataflou section (`DfConfig.actions`, off by default) declares every entry of
  `triggerOptions()` as a bool destination `act/<heading>/<id>` (`dfActionPath` : short heading
  segments, the id's redundant start stripped, 1-based numbers, 32-character segments with a
  hash past that, built from the id so renaming a scene or a rule never cuts a wire); fired by
  `fireTrigger` on the rising edge. The renderer re-lists them every 1.5 s and hands main the
  list when it changed; `DataflouNode.setParams` declares the new tree (a newer version, sent to
  every peer, saved bindings restored for paths that come back). The first declaration
  version is now seconds since 2024, so a restart is always newer than the last run for nodes
  that only know us by gossip. Measured with a second node of our own class on universe
  `opsia-test` : 119 entries / 7,139 bytes off, 415 / 26,329 on (276 actions, 19 headings);
  density up by its path fired on the rise, again after an off, not twice while on; a new
  scene showed as `act/scene/1` within the 1.5 s; off took them all away. Capped at 31,500
  bytes (a desktop frame stops at 32,768) : past it the last actions are left out and the
  section says how many; it warns past 8 KB (microcontroller nodes). A reference C++ node keeps
  the first 128 entries (its store stops adding when full), so the actions go last.
  Then ALL of them, on by default (Vincent, 11-08 : "You didn't add all the body rule dropdown
  menu entries to the dataflou-controllable parameters... do it. I want them all there", "I
  want all the layers controls, transport, sonify, generate, audio, etc..."). The switch
  shipped off, so only the fixed tree showed, and a real session's list outgrows one frame.
  `DF_DEFAULT_CONFIG.actions` is now true and a stored config from before turns it on once
  (`v: 2` marks a choice made since). The list is split by heading over two nodes :
  `DF_SESSION_GROUPS` (Scenes, Worlds, Triggers, Modulators, Body rules : the headings that
  follow the session) go to a second node, `<label>-session` (`dfSessionLabel`), started
  beside the first (`syncCompanion`, one step at a time) with a SKU made from ours (a sha1
  shaped as a UUID, the same every run) and its own saved bindings
  (`bindings-<universe>-session.json`); the fixed headings stay on the first node at the same
  paths, so a wire to them is kept. Each tree is fitted on its own (`fit`), each node re-declares
  only when its share changed, both feed the same value buffer. `DfStatus.companion`; the
  section counts both, keeps the second node out of the network list, and the switch's
  tooltip says which headings live where. Turning the actions off stops the second node and
  FLUSHes it (no offline ghost). Measured on universe `opsia-test-dfall` : a fresh session
  242 actions here (23.8 KB) + 34 there (2.9 KB); with 120 scenes and 40 rules, 516 actions,
  none left out (23.8 KB + 20.4 KB). A trigger set over the mesh on the second node (the
  visualizer's `set_value` : SETVAL from the first) turned modulator 1 on; `act/l1/mute`
  on the first muted layer 1. Off / on / node off clean, no console error.
- **Liquid glass on the interface, slim sliders** (Vincent : "propose how to integrate Liquid
  Glass, used sparingly, so it looks a bit more slick and modern, less LLM-style"; "I want
  Glass+quiet sliders"; on the thin ones : "I liked it better without thin sliders, the UI was
  more colorful [...] can we try an in-between ?"). `glass.ts` : a backdrop filter whose
  displacement map comes from the element's own rounded shape (per size, cached, remade on
  resize), its filter in the element's own document so a page in its own window works, sRGB
  filtering or the map's zero would not be 0.5. Only where there is something to bend : the
  two capsules in the preview's bottom corners (`PictureCapsule.tsx`, replace the three corner
  tags : scene with its arrows and Morph at the left, size, fps and big preview at the right; split
  in two, 26 px tall and faint until hovered on his notes "too big and too visible", mostly on the
  black beside the picture; a narrow preview folds what it has no room for), a
  lens on the right column's tabs on one track, a lens for a slider's thumb while it is held
  (`installSliderLens`, also in each page window; not the Mixer's standing faders), `Ctrl+K`
  and messages. A message now passes over the top of the picture, red dot for a warning (red
  words on a moving picture can't be read), and falls back to the toolbar dock when something
  covers the picture. **interface glass** in the performance tab turns it off (`opsia.glass`,
  per computer; `html[data-glass]`, copied to page windows); off in Installation mode. Sliders :
  every plain range is now a 4 px rounded line filled in the accent (accent2 modulated) with an
  8 x 15 pill, drawn in CSS from the thumb's border image so it needs no script and follows any value;
  Sonify's main macros keep their look. Rounded on his note ("a little more rounded, especially
  at the edges, I still want this to feel playful") : round caps on the line, no gap to the pill.
  And two small animations, for state changes only, our own code after Fancy
  Components' elastic line and scramble (both MIT; no animation library added) : a held slider's
  line is a string (`glass.ts`, drawn over the slider : it bends toward the hand, then rings about
  half a second when let go, harder the faster the hand was going, not the Mixer's faders), and
  the left capsule's scene name scrambles into place (`ScrambleText.tsx`). **interface motion** in the
  performance tab turns both off (`opsia.motion`). Not tied to the system's reduce-motion : Windows
  reports it whenever its animation effects are off (they are on the AERO), which would have left
  them dead on arrival, and these only answer a hand or a change of scene. Measured on the app's own counter : 53.8 / 55.6 / 53 /
  53.2 fps, glass on / off / on / off, a difference within its wobble. The stock browser slider
  was most of the "default widget" look. Glass is DOM above the canvas : never in outputs.
- **Flowing metal, in Relief and Inflate** (`flow`, `flowSpeed`, `bands`, `split`, `ripple`; Vincent :
  "build flowing metal"). In `engine/reliefShade.ts`, `roomAt()` replaces the still room with bands
  of light running by themselves, on an integrated clock : a hard line, a dark gap, a thin line, a
  long slide to dark. They live in the direction the surface reflects, so they wrap round the real
  volume, and a little in the frame, so a flat top still shows them passing. Red and blue read the
  same bands ahead and behind, widest where the surface turns away (the color split). The band edges
  are as wide as a pixel of them (`fwidth`), so they never shimmer. Every shiny material takes it,
  tinted metal included, and 0 is the room as before. The idea of three channels reading one set of
  bands comes from Paper Shaders' `liquid-metal` (Apache-2.0); no code copied (THIRD_PARTY_NOTICES).
  5 + 5 presets (Flowing chrome, Prism flow / Prism letters, Liquid gold / Molten gold, Slow mercury,
  Racing bands), the chain Flowing Picture, the theme Mercury, in Liquid Metal and Chrome Type too.
  Hard band edges exposed what the still room hid, all fixed : Relief's height is 32-bit where the card
  can filter it (else 16); Inflate's pressure stays 32-bit, read by whole texels, relaxed from wide
  down to one pixel, and its height and slope come out into a filtered target, so normals are
  continuous across the grid's cells instead of one facet per cell (Balloon and Clay read smoother
  too); strokes step by a share of the radius when Chaos changes it (each capsule's cap pokes past
  the next one's slope, a ripple falling with the square of the step), under a frame budget so
  huge strokes with a 32-way mirror fall back to coarser steps rather than behind. Gate : 60 fps,
  59.7 updates/s on the dome, heaviest included. Also fixed in both, before release : a fresh
  Inflate read `from` alpha while its panel said bright, which blacked out an opaque picture; its
  orbit, Relief's convexity and color pick had the same mismatch.
- **Relief, a new source; Inflate and Thin Film, two new effects** (`gen-relief`,
  `node-inflate`, `fx-thinfilm`; Vincent : "Relief is also a new and great idea, implement
  it all as you proposed, with Thin Film"). Relief (`engine/ReliefSource.ts`) : a stroke is
  stamped once, capsule by capsule, into a buffer where the depth test keeps the highest
  height (it can cross itself without building up); each frame that buffer is combined over
  the settled height map by the mode (raise : a smooth union whose fillet follows the size,
  stack, plate, press, erase) and baked in when it ends, so what has been drawn costs
  nothing : one combine, one shading pass, and the whole drawing relit every frame. Eight
  brushes, each a profile and a material (`engine/reliefShade.ts`) : plasticine (a thumbprint
  skin), molten metal, carved metal (two facets and a spine), chips (molded plastic flecked
  with the palette), fused drops (each melted in as it lands), ribbed metal (up to 8 ribs
  following every bend, dashes), ink (form from width only, broken), soap film. A studio to
  reflect (a pale ceiling, a hard horizon, a softbox) that turns with the lamp. Size,
  convexity, chaos, edge roughness, dents, grain, bevel, edge glow, shadow, an oil film over
  anything shiny; mirror across, down, both or around up to 32. It draws itself : wandering
  strokes, a compass (arcs and rules, each from the places the last one made), the moving
  things of the sidechain (the Synth's finder, its own instance, no sound), the sidechain's
  outlines, the sound's hits. It lives : the lamp orbits or follows the Context light path,
  strokes sink and melt (radially on the dome). The sidechain can also get into the material
  : its colors, its reflection in the metal, or bent through the relief as glass. Mouse strokes
  join the slot's hand-made log (undo, saved with the session), a Body pinch draws live. Inflate
  (`engine/inflateNode.ts`) : a jump flood over the layer's shape, bounded at 720 rows, gives a
  rounded height lit with the same materials, plus glass : text or a silhouette as live chrome.
  Thin Film : the picture as a film's thickness, a sum over nine wavelengths of two-beam
  interference (the idea from OpenToonz's Iwa_SpectrumFx, BSD-3; our own code), in slow currents
  of its own. 14 + 12 + 11 presets, the chains Chrome Everything / Oil on Everything / Soap
  Picture / Studio Relief, the Generate themes Liquid Metal / Clay Studio / Engraver / Geometer /
  Soap Skin / Chrome Type / Oil on Water (Generate over a Relief starts on a blank page). Fulldome
  gate : 60 fps flat and on the dome, updates 59+/s, heaviest included.
- **Fur, a new source** (`gen-fur`; Vincent : "Brushable fur sounds great haha ! Let's do
  it also"). Native (`engine/FurSource.ts`) : up to 1.5 million real strands, each one
  instance of a tapered triangle strip with no attributes (its root and look from
  gl_InstanceID, its lean from a grid), bent from root to tip, gathering into tufts,
  depth-tested and multisampled in the buffer it now shares with Marbling
  (`engine/sharedMsaa.ts`), lit by Kajiya-Kay's fiber model so the tone follows the
  hair's direction against the lamp : combed marks read as on velvet, light one way and
  dark the other. The groom is two small half-float grids : the nap (combed by the
  pointers, healing toward the rest field over HEAL seconds, for good at the end of the
  slider) and the lean (a damped spring toward the nap plus the wind, its neighbors
  coupled so ripples travel). AUDIO : the mids gust through it, hits re-part it. MARKS :
  spots, stripes, patches. SIDECHAIN colors the coat from another layer or grows the hair
  only where it is bright, so letters or a silhouette come out furry. A click parts the
  coat, a drag combs it, a Body pinch too. Under full-dome fill the hair grows out from a
  crown at the zenith. 17 presets, the chains Studio Hide / Flash Photo / Faded Rug, the
  Generate themes Pelt / Big Cat / Gale / Furred Letters (a theme's `reads` now reaches a
  source's sidechain too).
- **Sand Plate, a new source** (`gen-sandplate`; Vincent : "Implement Chladni sand as a
  new source. Make it able to look like this (this is sand on a metal plate), so maybe
  have a few different surfaces sand can go onto" · "add a Rotation parameter, so that the
  plate can rotate clockwise or counterclockwise, affecting the sand"). Native
  (`engine/SandPlateSource.ts`) : up to a million grains in a float texture, on a half-float
  field of the plate's modes (square : cos m pi x cos n pi y +- swapped, ringing at
  m^2 + n^2; round : J_n(k r) cos n t from a Bessel table, ringing at (n + 2s)^2). The
  physics is static friction : a grain moves while |phi| x shake beats its own grip, so
  sand stops in a band round each still line, thin where the plate is steep and piled up
  at the crossings, with a few grains too stuck to move as the strays. Where more sand
  gathers than can stand it slides (an angle of repose read from the sand's own mips, only
  while the plate shakes), which is what makes the lines solid and continuous. ORDER,
  TONES, WARP (the imperfection that makes the lines loop instead of the textbook
  symmetry), a redraw on a timer, a beat or asked for; AUDIO lets the loudest frequencies
  pick the modes, redrawn on the next accent (a held note after 2.5 s), and the level shake
  the plate (silence : everything rests). Seven surfaces, each with its own hold on the
  sand : black steel, spun metal, rust, slate, black glass, paper, felt. ROTATION either
  way, up to half a turn a second : the figure and the resting sand go round with the plate,
  grains in the air slip behind, and spun fast the pull outward beats the grip and the sand
  flies off in spiral rings, landing again as fresh sand. On a rectangular frame the sand
  past its edges appears on the first turn (up to 2.1M grains in all) and keeps finding its
  lines out of sight, so no corner comes round bare; on the full dome it turns about the
  zenith, tilt falls outward. Plate opacity 0 leaves the sand alone over the layers below,
  SIDECHAIN colors it from another layer, dragging on the preview (or a pinch) is a finger
  through it. 14 presets, the master chains Macro Plate / Blueprint / Wet Print, the Generate
  themes Singing Plate / Listening Plate / Sand Over. Named Sand Plate under the app-copy rule
  (no names in the app); searching "chladni" finds it.
- **Signal's knobs take modulators and MIDI Learn** (Vincent : "add the chips and MIDI
  Learn"). Ten new Sonify targets (`signalSens`, `signalPicture`, one `signalD*` per
  PICTURE row) in `shared/types.ts`, `SONIFY_MOD_DESCS`, `withSonifyParam` /
  `sonifyParamOf`; `signalModOf` answers the SynthPlayer's slot names with Signal's own,
  and the sense reaches the finder live. Every row has its **M**, its live number and
  its binding row, and sense and PICTURE have theirs. MIDI / OSC Learn
  (`sonify:param:<p>`) now covers the whole card : those ten, and the eight older Signal
  sliders that had a chip but no Learn (decay, tone, fm, rate, spread, thresh, density,
  snap). Names in one place (`SIGNAL_PARAM_LABEL`). Checked in the test copy with a
  square LFO, hits logged against its state : the wave row 1 wave / 5 waves, PICTURE 0
  every pan, decay and tone flat / spread, the decay row, the chance row 137 / 99 hits,
  sense 0.44 / 2.66 things found (2.8 unbound); by clicks : 15 chips, 15 overlays, CC 0 /
  127 → the ends, an OSC fader learned on a row; the 240 px column overflows nothing.
- **Signal's Picture Play** (Vincent : "update Signal so that it can be played like
  Synth, in the same principles" · "I don't want it to sound really different : I just
  want to be able to drive it with the visuals' parameters like Synth : movement,
  brightness, etc. Make this an option, so the old ''read head'' behaviour can be still
  accessible" · notes : "A switch for both" · the 10th row : Chance). Signal's card has a
  **PLAY** switch, READ HEADS (as it was, the default : old sessions unchanged) or
  PICTURE PLAY. `audio/signalPlay.ts` : Signal's own `SynthPlayer` (the Synth's finder
  and tracker, its own instance) through an adapter (`signalPlayerCfg` : the read
  height / keyboard / radial, sense, PICTURE, eight rows in the Synth's slots 0..7, poly,
  free grid, no slide), `signalHit` (a thing's mods → the hit : decay, tone and fm around
  their knobs, the wave stepped from the one picked by up to four, the rate a power of
  two 1/4..4, pan from the row or else x, chance, the held level), the default rows
  (speed → velocity, size → decay, brightness → tone, texture → fm, speed → rate, x →
  pan) and the section's dice (`randomSignalPatchbay`). `sonify.ts
  analyzeSignalPicture` : pitch = the thing's scale note, SNAP blending in the free
  frequency at its place; STRIKE ticks on Signal's clock in quarter steps (the clock is
  now one `signalClock` both ways share), each thing from the quarter step after it
  appears, every 1/2/4/8/16 quarters by its rate row, each tick by its chance row; free,
  a new thing also strikes at once (synced it waits for the grid). TIE : a held grain per
  thing, re-struck at each new scale note, let go when it stops; every frame its pitch,
  level, pan, tone and fm follow. A change of tap, source, read or STRIKE ↔ TIE, Signal
  off, back to the heads or Sonify off lets every hold go (`{t:'sigpp', all}`). Worklet :
  a `sigpp` message (hits [t, freq, amp, pan, wave, decay, tone, fm, holdId], `off`,
  `set`); every grain now carries its own wave, length, tone and fm (a read head's takes
  the knobs at its strike, as before), a held grain keeps its envelope (pip / ping wait
  at the window's peak), is the last to be stolen, and lets go by itself after 1.5 s
  without word from its thing. OSC `/opsia/sonify/signal/{play,pmode,tie,sens,picture}`
  and `/patch/<row>/{source,depth}` (OSCQuery too); the voice's dice rolls the Picture
  Play read when it is on (the rows and PLAY stay). Checked in the test copy (moving
  particles, Signal alone) : the heads as before (144 grains in 3 s), STRIKE 158 hits in
  4 s free and 106 in 3 s synced (pitch 294 Hz .. 6.3 kHz by height, pan by x), the wave
  row spreading hits over seven waves, TIE 119 holds each let go at its next strike with
  669 follow-ups; a frozen picture silent within 0.5 s (damped and held pip), TIE off,
  Signal off and back to the heads each one all-off, no hold left; the card fits its
  column, no errors.
- **Init, Generate's first entry** (Vincent : "Make the most basic, totally blank, INIT
  session, with a set of 8 basic modulators, so the least experienced user can start from
  there and not be confused. Put this in Generate, as the FIRST option on the list").
  Not a theme (nothing drawn) : `themes.ts GEN_INIT` (the first option, group Start, and
  the menu's selection at launch), `store.ts makeInitComposition` (the default
  composition with the bottom layer normal, the Vibe at mixSrc 1, Context's bloom and
  depth 0, the Finalizer's grain and dust 0, and the eight modulators : sine 0.2 Hz,
  triangle, square, saw, random, smooth random, a looping ADSR, an 8 s ramp, all on, free
  clock, linear, no bindings) and `generateInit` (Generate's write path : unsaved, the
  relay morph, undoable, pins and mappings ride, a new Audio Layer, scenes and sequence
  cleared, Feel neutral with no shutter or flicker; no World applied, each adds a mood and
  an audio modulator : the label reads Incongruent, the World of uncoupled layers). In
  Ctrl+K (first among the themes) and as `act:gen:init` (GENERATE Init : MIDI, a Body
  rule). Checked in the test copy from the toolbar : the menu opens on Init under START,
  Generate builds it (four empty layers, eight modulators moving, no bindings), and a
  generator on layer 1 comes out the same with the finish on as with it off (1 of 255).
- **Sonify's state made persistent** (Vincent : "add a new right-click option to Sonify
  : Make current state persistent. This is enabled so that when I have a cool Sonify
  state, I can make it persist when I switch between Scenes that were saved with a
  different set of Sonify parameters"). A pin like the others (`persist.ts SONIFY_PIN`
  = 'sonify', in the session's `pins` : saved with it, New clears it, the ◆ list names
  it "Sonify, its whole state"); Sonify is not in the composition, so the gate is the
  recall's : `recallScene` and `sequenceTo` (the scene sequencer, the pad) skip the
  scene's Sonify while it is pinned. `components/sonifyPin.ts` gives the two items
  (**Make current state persistent** / **✓ Persistent**, and **Set this Sonify in every
  scene** : `setSonifyInEveryScene`, as a scene saves it, never its on-state or device)
  to the Transport's Sonify button right-click (after its two window items) and to the
  Sonify page's header bar right-click; the button wears the pin's gold, the page a
  **● persistent** chip that lets go. Checked in the test copy with two scenes saved with
  different Sonify states : a recall changed it; pinned from the button's item, a recall
  and the sequencer left it (dorian / 7 held); let go from the page's menu, the recall
  changed it again (minor / 4 with the Chord); Set in every scene wrote it in both and
  Ctrl+Z took it back; the session export carries the pin.
- **A MIDI or OSC control as a modulator, and a takeover of any modulator** (Vincent :
  "what if any incoming set of OSC or MIDI device could entirely replace one of the 8
  modulators ? any modulation would still be bound to it; but it could then affect a
  lot of parameters at the same time", then "Both, one input per slot, glide back to
  the generator, and #4 : yes"). A binding points at a modulator SLOT, never at its
  type, so the slot's bindings, depths, modes and shaping all stay. **The input** :
  two Learn targets per slot, `mod:in:<i>` (the new `controller` type) and
  `mod:take:<i>` (a takeover), continuous for MIDI / OSC Learn (`isContinuousTarget`)
  with a pad allowed too; `applyContinuous` and a pad's note on / note off (a new
  note-off path in `onMessage`, only for these) write `engine/controlBus.ts`
  (`in:<i>` / `take:<i>` : value, last-moved time, gate, velocity; live, never saved).
  `/opsia/mod/<n>/in · take` (+ `/note`) play it straight in. One input per slot :
  `setMidiBinding` / `setOscBinding` drop the other kind in the same scope
  (`dropOtherKind`) and clear the bus on forget; the card's **learn** arms Learn for
  that input alone (`learnModInput`, `learnOnce` : Learn goes off once it is learned);
  **✕** forgets it in both scopes (`forgetModInput`). **The engine** (`modulation.ts`) :
  `playInput` plays a fader (one-pole `smooth`, frame-rate independent) or a pad (a
  linear attack / release envelope times its velocity, or full); the `controller` type
  is that value (it holds when quiet). The TAKEOVER blends before the curve, for every
  type but controller : a fader's weight comes in over 120 ms (`TAKE_CATCH_MS`), holds
  `holdMs` after the last move, falls over `backMs`; a pad's weight is its envelope, the
  pull toward its velocity. `ModulatorConfig.controller` (merged onto
  `DEFAULT_CONTROLLER` at load) and the optional `takeover` (`DEFAULT_TAKEOVER`). **The
  card** : a `played` family in the type menu; the controller's rows INPUT (learned
  control · learn · ✕) then SMOOTH, or A / R / VEL for a pad; the header's **✋** (lit
  when a control is learned, a Learn overlay of its own) flips the card to its
  takeover side (TAKE, then HOLD / BACK / SMOOTH or A / R / VEL), inside the fixed
  silhouette. Generate and the dice never deal a controller (TYPE_POOL). Checked in the
  test copy, MIDI through the manager's own handler (thru off), OSC by real UDP : the
  card's learn took CC 74 and switched Learn off; the CC played 0 → 1; a pad (vel 100)
  rose to 0.787 and fell over 600 ms; a CC took an LFO over in 200 ms, held 1.2 s,
  was half way back 1 s later and gone at 2.2 s; a pad (vel 127) pulled it to 1 and
  handed it back over 1.2 s; `/opsia/mod/1/in 0.25` → 0.25; OSC Learn onto the same
  input dropped its MIDI control and played; every card side fits (scrollHeight 107 of
  107).
- **Black's button draws its fade** (Vincent : "Like in dataflou_compositor, I would
  need the Black button to show the amount of time it takes to fade out or fade in (so
  the morph time), but visually : a clockwise line filling the rectangle in the N
  amount of morph time"). `components/BlackButton.tsx` (the button moved out of
  App.tsx) : at each press a `FadeLine` (keyed on the store's new `blackFadeAt`, with
  `blackFadeMs`, the Morph time at the press) draws one SVG path round the button's
  edge, clockwise from the middle of its top, corners as `.btn`'s, `pathLength` 1 and
  a dash run 0 → 1 by the `black-fade-line` keyframes over the fade's time, linear
  (time, not the eased level). Timed from the press (a negative delay), so a redrawn
  top bar goes on where it was and a fade already over is its end. Red on the way out
  (the edge stays plain while it runs so the line reads, lit red when it lands), the
  text color on the way back (gone at the end); a press mid-way starts a new line, as
  the fade starts over; Morph 0 draws none. Checked in the test copy at Morph 2 s and
  30 s, the animation paused at 0.25 / 0.5 / 0.75 / 1 : the dash offset 0.75 / 0.5 /
  0.25 / 0, clockwise from the top; the border plain during the fade and red after.
- **Black, at the far right of the top bar** (Vincent : "add a ''Black'' button at the
  rightmost of the top toolbar, next to Flush. This takes all the active layer's (and
  background and audio) opacity down to 0 in the Morph time", and "yes, Sonify fades
  too"). A dimmer on what leaves, not a fader write : `black.ts` holds the fade (an
  eased level from where it is to 0 or 1 over `morphMs`, a press mid-way turns it
  round), the store holds the switch (`black`, `setBlack(on | 'toggle')`, never saved :
  not in sessions, scenes or localStorage). **The picture** : the loop hands the level
  to `Compositor.setBlack`, and `render()` draws black over the finished frame at
  `1 - level` (into `blackTarget`, made on first use and let go 10 s after the show is
  back) after the scene crossfade and the freeze, BEFORE Flash safety, so the preview,
  `lastPresent` and every output (the output window, NDI / Spout / Syphon, recordings,
  the dome, the light output's zones) go black together, the master FX's grain, dust
  and grading included. The freeze captures the frame from before it (`preBlack`), so
  a frame frozen under Black comes back lit. **The sound** : each layer's film and
  Audio slot through `scaleLayerSound` (multiplied with the relay's envelope), and the
  worklet's last stage (`{ t: 'black', to, ms }`, eased on audio time : Sonify and the
  Audio Layer joined, before the limiter, on the stereo bus and every Space channel,
  so the speakers, the recordings and SpatGRIS all fade); a node made while black
  starts there. Nothing moves : the faders, pins, undo and the session are untouched,
  everything keeps playing under it and comes back as it is by then; it holds through
  scene changes and Generate. The button lights red while black and its tooltip
  gives the Morph time. Key `.` (PowerPoint's blackout key), `fire:black` (MIDI / OSC
  Learn, Body rules, the Transport group of the action pickers), `Ctrl+K` (Black),
  `/opsia/black` (≥ 0.5 black, < 0.5 back, no value : over; advertised and echoed).
  Measured in the test copy at Morph 1 s : the frame's mean 93.5 → 0.3 at 1 s → 0,
  Sonify's peak 0.32 → 0, the films' sound scale with them; back the same; a press at
  0.64 turned round without a step; `.` at Morph 0 a cut; real OSC 1 / 1 / 0 / bare /
  bare : black, black, back, black, back.
- **A dice on Sonify's Reverb / Delay** (Vincent : "Also add a randomize dice to
  Reverb/Delay too"). `autoSonify.ts randomFx(fx)` re-rolls the delay (mode, time,
  feedback, tone, mix) and the reverb (Quartz or Prism, size, decay, damp, predelay,
  shimmer, mod rate, width, low-cut, both modes' own controls, mix) inside musical
  ranges; the send stays (an off tail comes on at the default 0.05, as a voice's dice
  turns its voice on) and freeze is left as it is. The whole-instrument dice now draws
  its tail from it too (its send range unchanged).
- **OSC Learn, and MIDI / OSC mappings saved in the session** (Vincent : "yes build OSC
  learn this way" and "I'd also like the option to be able to save learned MIDI and OSC
  in the session, if i'm working on a piece which needs a custom setup specially for a
  certain session and not another one"). **One port, two doors** : every message still
  arrives on the OSC input port; `oscInput.ts route()` keeps `/opsia/…` (and Resolume's
  `/composition/…`) exactly as before, and hands every other address to
  `renderer/src/oscLearn.ts` (`oscLearn.handle(address, args, host)`, where it used to
  drop them). So a learned address can never replace or hide a built-in one, `/opsia`
  keeps playing while Learn is armed, and a learned `/1/fader3` and its
  `/opsia/layer1/opacity` twin call the same store action (last message wins).
  **Learn** reuses MIDI Learn's mode, targets, overlays and ids (`midiLearnMode` /
  `midiLearnTarget`) : an armed target binds to the first MIDI or non-`/opsia` OSC
  message, so every learnable control (knobs, rule boxes, scenes, actions from the learn
  list…) is OSC-learnable. The binding is `OscBinding { kind: 'osc', address, arg, min,
  max, int?, bool?, host }` (`shared/types.ts`), in `store.oscMap` (localStorage
  `opsia.oscMap`, the MIDI map's twin). Which value : the only number, else (a 3-value
  `/accxyz`) the one that moved most over a 300 ms window; strings are passed over, a
  message with no number is a press. An address still heard 200 ms before the click (an
  accelerometer left streaming) waits 1.5 s : any fresh address in that time wins. The
  range is calibrated (`mappingModel.ts calibrate`) : values inside 0..1 (true / false
  too) → 0..1; inside -1..1 with some below 0 → -1..1; whole numbers to 127 → 0..127;
  else the span seen with 0 in it; it keeps widening for 5 s after learning
  (`CALIBRATE_MS`, an int fader first seen at 0 and 1 becomes 0..127) and is typed per
  row after. Continuous targets get the value scaled in (`midi.ts applyContinuous`, now
  the one setter MIDI CCs and OSC share); triggers fire on the rising edge past 0.5
  (re-armed under 0.45 : a 1 then 0 button is one press), a message with no value fires
  each time, a rule's box toggles on each press. Bundles arrive unpacked (osc.js); no
  wildcards. The OSC bindings are indexed by address (`Map<address, inputs>`, rebuilt
  when a map changes) for one lookup per message, and a batch's continuous writes land
  once per control (the last value, flushed in a microtask and before any `/opsia`
  message, so the twin's order holds). **Answers** : a learned control replies
  in the controller's own address and range (ints when it sends ints, T/F when it sends
  booleans) to the IP it was learned from (`OscInEvent.host`, new : main's receiver passes
  osc.js's `rinfo.address`) on a reply port set once per controller (`store.oscReplies`,
  localStorage `opsia.oscReplies`; off until a port is set, on / off per controller), on
  change only, at most 30 a second (`ANSWER_HZ`), held off 300 ms after the input last
  spoke (`HOLD_MS` : never the value that just came in), reading the value PLAYING
  (`midi.ts readContinuous` : a modulator's live value, a Macro knob's glide target, a
  rule box's on / off), so a TouchOSC fader follows scene recalls, modulators and Generate.
  An XY pad's two values answer in one message (`lastArgs`). The `/opsia` feedback,
  OSCQuery and dataflou are unchanged : learned addresses are the controller's, never
  advertised. **Where a mapping lives**, for MIDI and OSC : **this computer** (the
  default, as before : `store.midiMap` / `oscMap` in localStorage) or **this session**
  (`store.sessionMidiMap` / `sessionOscMap`, the session file's new optional `mappings: {
  midi?, osc? }`, written only when it holds some : a session without any is the same
  file byte for byte, measured on a session saved by master). **Learn into** (`store.
  learnScope`, per computer) : a `computer | session` switch beside MIDI Learn on the top
  bar and in the MIDI section while Learn is on; each row moves between the two (↑ / ↓),
  **move all to session** and **copy to computer** on the group headers. A load brings
  the session's mappings and drops the last session's, New clears them, Generate keeps
  them (the same piece, a new look), scenes never touch them, Installation mode loads them
  with the session, autosaves carry them, the session guard sees them (a changed session
  mapping asks "Save changes?"). **Precedence** : a session mapping on an input (the same
  channel + CC or note, or the same address + value) silences this computer's mappings on
  THAT input only (`midi.ts midiTargetsFor`, `oscLearn` index); two session mappings may
  share an input. The list (the MIDI section, now the MIDI and OSC ledger) groups **this
  session**, **macro knobs**, **this computer** (silenced rows greyed, "replaced by this
  session") and **OSC controllers** (each IP, its reply port, on / off), each row tagged
  MIDI / OSC, OSC rows with the value and an editable range. A session mapping whose
  target is not here (a Body rule not on this computer) reads "(gone)" and does nothing;
  a deleted rule takes this computer's MIDI and OSC mappings with it, the session's keep
  theirs. **The Macro knobs' CCs stay on the knob** (`composition.metaKnobs[i].midiCc` :
  in the session and its scenes, as before, whatever Learn into says; they take no part
  in the precedence, so older sessions play as they did); OSC learned on a knob follows
  Learn into. The learn overlay's green is bound where Learn into points, a dashed green
  bound only in the other scope; right-click clears all of a control's mappings
  (`clearMappings`). The Sonify Synth's knobs and its ten patchbay depths
  (`sonify:param:<p>`, the depths now carry a learn overlay) and its voice toggle go
  through the same setter and reader (`sonify.ts sonifyParamOf`, the mod-matrix base's
  getter made pure and shared), so they learn MIDI and OSC alike and answer the
  controller. The Macro row's dot counts OSC-learned knobs and OSC pads. Main
  changed (the sender's IP) : restart `npm run dev`; a mapping learned before that knows
  no sender and cannot answer until learned again.
- **The Body rule timeline counts in minutes and seconds too, and takes exact values**
  (Vincent : "I also need it to not only be tied to bars and beats; I want to be able to
  choose an amount of seconds and minutes each rule will play. make it more precise").
  A **clock** switch on the rules lane, `bars | time` : `RuleTimeline.unit` (absent =
  bars, so a timeline in bars is stored byte for byte as before; `'time'` is the only
  value ever written), the length and every block in the timeline's own unit, never
  mixed. In time the run counts real seconds from `performance.now()` at its start
  (`engine/ruleSeq.ts` : `rt.unit`, `rt.startAt`; the wall clock, so a stalled window
  catches up), starts at once on play (never `soniClockStart`, and it no longer counts
  as "on the beat" for `soniClockAlsoOnBeat`, so the other sequencers keep their own
  bar 1), and neither the tempo nor Ableton Link moves it; bars mode is untouched (bar 1,
  Link's next bar, the epoch re-count). The switch converts the timeline at the tempo now
  (`convertRuleTimeline` in `engine/ruleSeqModel.ts`, one store write, so one undo step) :
  bars to time, seconds = bars x beats a bar x 60 / BPM on a 1/100 s grid (`q100`); time
  to bars, each start and end to the nearest beat (touching blocks still touch, a block
  under half a beat keeps one, overlaps melt as a drag would), the loop to whole bars,
  blocks that would start past bar 256 left out with a toast. A switch while it runs
  recounts the run onto the new clock in place (`recount` : the playhead keeps its place
  in time). Lengths : bars 4 / 8 / 16 / 32 / 64 or any whole number typed from 1 to 256
  (`RULE_MAX_BARS`, was 64); time 30 s, 1, 2, 5, 10, 30 min or typed `m:ss` from 5 s to
  120 min (`RULE_MIN_SEC` / `RULE_MAX_SEC` : a gesture study up to an installation's
  evening). Snapping : whole seconds, Shift tenths (`RULE_MIN_LEN_SEC` 0.1). A **block
  editor** (double-click a block, Enter on a selected one, or its right-click "Start and
  length…") : start and length typed exactly, `parseClock` (`90`, `1:30`, `1:30.5`,
  `1:02:30`, a comma for the point, `5m`) or `parseBarBeat` / `parseBarsBeats`
  (`5.3` = bar 5 beat 3, `2.1` = two bars and a beat, `3 beats`), read back live, kept
  inside the loop, Enter applies (one undo step, overlaps melted), Esc or a press
  elsewhere cancels. Each block's label is its length in the lane's unit (`fmtClock` :
  `1:30`, `0:00.5`; `4 bars`). Zoom is continuous : **fit** (the loop in the lane),
  ×2 / ÷2, Ctrl + wheel by √2 around the pointer, up to a bar 160 px or a second 200 px
  (`MAX_PX`), so an hour is workable to the second; the ruler picks its step from what
  fits (bars 1 to 128 a label, 22 px; time 0.1 s to 1 h, 46 px, tenths when zoomed in),
  thins its lines and draws only the labels in view. The header reads `1:23 of 5:00` in
  time (`bar 2.3 of 16` in bars). OSC `/opsia/seq/rules`, MIDI `fire:ruleseq`, Link
  start / stop, the hand that wins until the next edge, play once, sessions and the
  pruning work the same on both clocks. Ctrl + wheel now keeps the point under the
  pointer for real (the scroll was set in a frame callback that could run before the
  wider timeline was laid out, so it stayed at 0 : now a layout effect on the zoom).
  Measured in the test copy (RTX 4070, real CDP mouse and keys) : an old timeline loads
  and stays byte for byte; bars to time at 120 BPM (16 bars = 32 s, 3 blocks x 2 s a
  bar) and at 133 BPM (28.87 s), back to the same bars exactly, Ctrl+Z / Ctrl+Y on the
  switch exact; typed `10:00`, `1:30.5`, `3` (to 5 s), `130:00` (to 120 min), junk
  refused; the editor's `1:30` / `45.5`, `90` / `1:30.5`, `9.3` / `2.1` (bar 9 beat 3,
  two bars and a beat), a block cut at the loop's end, Esc and a press elsewhere cancel;
  drags snap to 13 s and Shift to 14.5 s. 10 min loop : fits at 1x (30 s labels), 8x
  keeps 5:00.1 under the pointer (5 s labels), full zoom tenths with 16 labels drawn; an
  hour at full zoom = 719,888 px wide, 16 labels, 1199.7 s under the pointer, frames p50
  16.7 / p95 16.8 ms. Running a 20 s loop for 64 s (3 passes) : 4,973 rule samples at
  20 Hz, 0 off their blocks (away from 0.12 s of an edge), started at 0.017 s 46 ms after
  the click, the playhead within 5 to 20 ms of the wall clock (p1 to p99) and a tempo
  change 120 to 90 BPM mid-run moving it by 1.1 ms on average (one 94 ms stall in the
  first 0.14 s); a dot click held its rule on from 10.55 s to the edge at 12 s (held mark
  23 / 23 samples, gone 292 / 292 after), a MIDI-sourced switch held to the loop's end.
  Play once of 6 s stopped after 6.015 s. The transport started scenes, keys and rules
  (the rules at once : 0.699 s in at 0.716 s) and stopped all three. A session round
  trip kept the timeline (the machine's), brought back the lane arms, loaded stopped and
  started at once from the file (0.496 s in after 0.506 s). A restart (after 90 s) kept
  the time timeline exactly. All lanes running on a zoomed 10 min loop : frames p50
  16.7, p95 16.8 to 16.9, p99 17.2 to 17.6 ms; 0 console errors.
- **The Seq page's live picture sits over every lane** (Vincent : "the LIVE preview
  should always be there, on top of the 3 lanes, so we can monitor how the sequencers
  are affecting the whole picture. Take it out of the Scenes lane and make it its own
  thing"). `SeqPreview` (the `captureStream` mirror of the main canvas) moved out of the
  Scenes lane's scene column to the page itself, between the transport and the
  scrolling lanes : a fixed region, never scrolled away, folded lanes or not. Its height
  is still `opsia.seqPreviewH`, dragged at its foot now (down = taller), at most half the
  page in the page's own pixels (UI zoom and its own window included) so the lanes keep
  their room; the video sizes from the stream's own aspect (it was forced to 16:9, a
  dome's square sat letterboxed), centered. A corner reads which lanes are playing
  (`▶ scenes · keys · rules`, written from the window's own frames). The stream stops
  when the page closes, as before; the Climat suggestion still samples the main canvas.
  Measured : above the lanes (bottom 204 = lanes top 204) and out of the Scenes lane, a
  1920x1080 stream drawn 237x134 (no stretch), unmoved while the lanes scroll and with
  every lane folded, its foot dragged 157 to 237 px and remembered, the Climat
  suggestion still reading the picture, no horizontal scroll at 1536x864, 1280x720 and
  1100x680 nor in its own window (1348x825), the stream's track ended on closing.
- **Silhouette's fill : another layer drawn where the people are** (Vincent : "Can the
  silhouette effect be used to use another layer's visuals INSIDE the silhouette?", then
  "yes add the fill option to the Silhouette effect!" : one step, where a HOLE on a layer
  above or a MATTE into a Matte node took two). The effect's sidechain is the fill
  (`node-silhouette` joins Inspector's `NODE_INPUTS` : the same picker row and
  `setFxSidechain` path as Matte's inputs, any rack, the four layers; the Background is
  no sidechain kind, so it is not offered). New `NodeInput.noSelf` leaves the effect's own
  layer out of the menu (kept and marked when a paste put it there) and `off` greys the
  row with its reason (the matte draws no fill). With a fill and any mode but matte,
  `silhouetteNode.ts` draws through two programs of its own (`F_LOOK_FILL`,
  `F_OUT_FILL`, compiled on first use and by the prewarm, which hands every node a
  sidechain) : the fill is sampled screen-aligned; `silBody` lights it by the figure
  (hard light with b = 0.5 + (L - mean) x gain, mixed in by **shade**) and tints it
  in SHADOW (fill x shadow color, alpha x the color's alpha); `silAround` lays it on the
  picture with the people taken out in HOLE. The trail runs on the body as the cutout's
  does (`silTrail` mode 0 : each echo keeps the fill as it was, in hole the fill lingers
  where they passed; the trail color stays the matte's). SHADE's light : the frame posted
  to the model is sampled every 4th pixel (luma, ~0.03 ms) and measured inside its mask
  when it comes back (`measureLight` : mean and spread, gain 0.25 / max(sd, 0.06), followed
  at 0.3 a look), so a dim film and a bright one both read. One new input, **shade**
  (0..1, default 0.5, curated 0.3..0.8, in the LOOK column; greyed with no fill or in the
  matte : `groupDim` takes a slot context `{ side }`, the first slot-aware grey-out). No
  fill = the old programs, untouched : the 15 old presets render the SAME pixels as master
  (a fixed synthetic mask on a paused frame of the dance film, the whole 1920x1080 canvas
  hashed : 15 / 15 identical across a master build and this one; a master composition
  loaded here : identical; shade 0 and 1 with no fill : identical). A muted fill layer
  still plays (the Compositor's `sideReading`) and shows only in the people : mask 4.8 %
  of the frame, the composite lit on 5.2 % with the fill layer muted against 100 %
  unmuted, the lit pixels the fill's teal (47, 72, 78) where the film's dancer is
  (57, 44, 51). Measured on the RTX 4070 (dance film playing, caustics fill on a muted
  layer) : 1080p 60 fps in every case (p95 22.5 ms no fill, 21.8 cutout, 22.8 hole +
  trail, 22.3 shadow + trail + over; 19.5-21 looks a second either way); the Satosphère
  setup (2048² composition, 4096 master, 210° fill) 60 fps (p95 24.4 no fill, 24.1 /
  24.6 / 25.0 with; 17.5-20 looks a second). Ships with four presets for a fill (Bodies
  of light, Made of film, Stained figure, Wake; every older preset now sets shade 0.5, a
  preset never picks the layer) and the **Inhabited** Generate theme (Film Wall : the
  films on L1, a luminous field on L2 muted, the Silhouette's fill reading it, the
  Background at 0.45). Themes gained two small fields for it : `reads` (per node id, the
  layer it reads, never its own) and `muted` (layers that land muted). Generated 6
  times : the effect on L1 with its fill on the muted L2 every time, people found 6 / 6,
  caustics, fire, dye, sea or stripes inside them. No master chain : a fill needs a
  layer. Inspector panel : 128 px at 933 px wide (the look column 5 rows), 0 clipped
  numbers, 0 collisions. Fulldome gate (`domegate.sh --ids node-silhouette`, over
  Shapes : nobody to find, so it measures the effect at rest) : PASS, flat 60 fps, dome
  60 fps p95 20 ms, heaviest 60 / 60. Not built, offered : a **follow** switch (the fill
  riding the figure's bounding box instead of the screen).
- **The Sonify Synth's sound : eight engines behind the contract, 24 factory patches, a
  render harness** (`audio/synth.engine.js`, `audio/synthPatches.ts`,
  `tools/synth-render.cjs`; the play side is its own entry). Eight voices (poly steals the
  quietest released voice, then the oldest, over 5 ms; unison stacks all eight, ±15
  cents, spread in pan, about +2 dB over one voice; mono : last note, glide, a note
  stack). Each voice : engine → DC blocker → drive → tone filter → VCA, one ADSR for amp
  and filter (exponential-ish attack and decay, a release linear in level), a per-voice
  three-band 1/f drift (TinyPro5) on pitch, the 2nd oscillator and the cutoff. Everything
  that moves is set every 16 samples and ramped per sample (schwung-quark's pattern).
  The engines, each with timbre / harmonics / morph :
  **dco** (jx-move's DCO pair with exact-event BLEP / BLAMP : pulse → square → saw →
  pulse-saw; density copies after klaine/crest then the 2nd DCO's interval; free → hard
  sync → the cross-clocked metal), **ms** (aphex-move's VCO-1 + VCO-2 + ring + pink
  noise, the noise and drive pushed into the filter by morph), **swarm** (essaim-move :
  2 to 6 self-retriggering oscillators per note, each with its own SVF; morph from a
  drone to ~40 Hz chatter with envelope → FM), **fm** (schwung-hank's 2-op macro layer :
  its ratio list, crossfaded between steps, the coupled modulator envelope with its 0.30
  floor, the 7 kHz index rolloff, the bite shaper), **modal** (a 14-mode complex
  one-pole bank, string → bar → bell, a Hann mallet, damping that shortens the high
  modes first, bowed while held), **voice** (a glottal buzz and breath through five
  formants from Peterson and Barney's vowels : a e i o u, the throat, the breath),
  **fold** (a sine / triangle wavefolder with antiderivative anti-aliasing, symmetry,
  a vactrol low-pass gate) and **pluck** (Karplus-Strong with Lagrange tuning, allpass
  stiffness, steel → nylon → muted damping). Tone filters : the jx-move IR3109-style
  ladder, the aphex-move Korg-35 style HP → LP pair (its HP stage on `hpf`), a morphing
  SVF (LP → BP → HP, klaine/crest's saturating band-pass); all three self-oscillate
  bounded, seeded near the top (TinyPro5). The drive is schwung-quark's ADAA soft clip
  run 2x oversampled (a 31-tap halfband), with the FM bite in the same stage. The bus :
  jx-move's HPF, BBD chorus I / II (its line always written, so switching it on never
  steps) and output knee. Mods sent before a note are kept per id and taken at its
  strike; in mono / unison a noteOff for an id no longer sounding only leaves the stack,
  and a handover (the new noteOn, then the old noteOff, before the next render) strikes.
  Measured with `node tools/synth-render.cjs check` (at 48 and 44.1 kHz) :
  **tuning** within 0.07 cents A1..A6 on every engine (pluck and modal included);
  **aliasing**, inharmonic energy under 10 kHz, the worst note from C1 to C7 with bright
  settings : -75 to -94 dB per engine (a naive saw : -18), hard sync -70, a 10 % pulse
  -71, FM ratio 3 -73, the FM bite -55, a full-drive saw above F#6 -47 (WARN); the top
  half of the FM bite is chaos, noise by design (schwung-hank's "a lot is noise");
  **clicks** : none (on / off, steals, engine and filter switches mid-note, macro and
  filter sweeps at full speed, re-strikes, mode and chorus switches; the meter catches a
  -50 dBFS step); **DC** under -60 dBFS; **stability** : 80 minutes of random configs,
  notes and mods, no NaN / Inf, no subnormal, the peak bounded at the knee;
  **loudness** : the engines within 0.8 dB on the standard phrase (-18.7 to -19.5
  LUFS at level 0.7), the patches -19.98 to -20.60 LUFS; **CPU**, 8 voices with chorus
  II and drive : 3.4 to 7.2 % of one core in Node, the heaviest the modal bank;
  no per-sample allocation (numbers crossing calls too big to inline go through typed
  arrays : a boxed double per call had cost the dco 10.5 % against 6.1 %). Credits and
  license texts in THIRD_PARTY_NOTICES.md.
- **Sonify Synth : the moving things in the picture play it** (Vincent : "truly feel like
  the movement in the visuals on the screen is playing the synth, creating whole
  melodies"; his design : the moving things are the players, each a voice, an Aphex-style
  picture patchbay of ten rows). The PLAY side of the new voice 11 (appended : saved
  mixers, masks and MIDI bindings keep their voices); the sound (`synth.engine.js` : the
  eight engines behind the fixed interface, and the 24 factory sounds) is the entry above.
  - **Finding the players** (`audio/synthPlay.ts`, main thread, on the Synth tap's 96×96
    grids beside Flow, Events and Signal) : motion per 4 px block (Flow's frame
    difference, held 80 ms), light, Sobel edges (Events') and color; moving blocks
    joined into regions with hysteresis (a seed at `4 + (1 − sense) × 24` mean
    |difference|, grown through half of it and through blocks off a 1.5 s background,
    one-block gaps bridged so a dancer's arm and body stay one thing); a region of 40
    blocks or more (a moving camera, a screen of footage behind a dancer) split into its
    strongest cores (their own hysteresis, at most three); two thin regions facing each
    other (the two edges of a flat shape, whose inside never changes) joined into one.
    Tracking : greedy nearest centroid against the predicted place, stable
    integer ids, a note after two sightings in a row, a 0.25 s grace before a thing
    that stopped or left lets go. Poly : the 8 strongest play, a newcomer takes a voice
    only when one is free or when it is twice the weakest one that has played 0.6 s
    (one a tick); mono and unison : the strongest, another taking over after being
    1.6 times stronger for 0.2 s (its note first, then the old one's off, in one
    message : the engine takes that order as a handover and strikes the new note).
  - **Per thing**, each 0..1 and smoothed (~0.1 s) : speed (its travel and its motion),
    size, brightness, hue (folded so red meets red, grey in the middle), saturation,
    texture (Sobel under it), x, y, direction (0.5 still), age (over 4 s); the whole
    picture : motion, light, warmth, busyness and cut (a frame difference 3.5 times its
    2 s average and over 18 : 1, fading over ~1 s; the cut frame starts nothing).
  - **Pitch** on the Sonify key and scale over loOct..hiOct : height, keyboard, radial
    (aspect-true from the centre, the corners the edge; on a full dome the angle from
    the zenith over half the aperture, through `pictureToDirection`) and score (a
    playhead on the beat clock, 1 / 2 / 4 bars, Link's bars with Link on : the runs of
    rows that stand out at its column, light and edges, are the shapes, pitch by
    height). Steps : `noteOn` again on the same id at each new scale note, past
    0.5 + 0.4 of a step and 60 ms apart (no trill on a boundary). Slide : `setPitch`
    between the notes in log frequency, a double smoothstep lingering on each note. A
    key change moves every playing note to the same place on the new scale (`setPitch`,
    no strike). Timing : free, or onsets sent with their audio time at the next 1/8,
    1/16, 1/8T (the beat clock carried from the frame's start to now, the audio time
    from the context's output timestamp : its `currentTime` here moves in ~10 ms
    steps), struck by the worklet on the audio block they fall in; an end before its
    strike lets go 80 ms after it.
  - **The picture patchbay** : ten fixed destinations (vel, timbre, harmonics, morph,
    cutoff, reso, drive, env, pan, bend), each a source (none, the 10 per-thing, the 5
    whole-picture) and a depth −1..+1, all scaled by **PICTURE**. Centered rows :
    `depth × picture × (2f − 1)`; the strike's velocity 0.7 pulled toward
    `0.15 + 0.85 f` by |depth × picture| (f upside down for a negative depth), the held
    `vel` 0.5 + depth × picture × (f − f at the strike) (around its own strike); pan and
    bend absolute. PICTURE 0 sends exactly neutral mods. Each strike carries its mods
    (set before the `noteOn`, for the envelope's shape, and after); every tick each
    playing thing's mods.
  - **The worklet** (`soni.worklet.js`, NVOICE 12) : `synth.engine.js` added to the
    worklet scope first (`SYNTH_ENGINE_URL`), built from `globalThis.OpsiaSynth`; the
    static sound to `setConfig` only when a value moved; a time-ordered event queue;
    the voice's balance ramped per sample, then its mixer channel (DJ filter, gain, the
    15 ms voice fade, the FX send, recordings, Space). The meter reports its sounding
    voices.
  - **The panel** (`components/SonifySynth.tsx`, after Events) : the 24 factory sounds
    (`SYNTH_PATCHES`, three per engine : a pick sets the engine and its whole tone, the
    read, the patchbay and the levels stay), engine (8 buttons), poly /
    unison / mono, timbre / harmonics / morph with the engine's meanings under them;
    read (pitch, bars in score, range + steps / slide, sense, timing, tap); tone
    (filter, cutoff, reso, drive, hpf, fmode greyed unless morph, env amt); a 2 × 2
    envelope; life (glide, drift, chorus, level), gain, pan; PICTURE over the folded
    ten rows (source menu, depth, M). The mirror : a ring on each playing thing (size
    the velocity, color its voice, its note beside it), a dot on each thing found, the
    score playhead.
  - **Everything a voice has** : sessions and scenes (a session that never used the
    Synth saves byte for byte as before : its block, its twelfth mixer channel and
    sequencer step and its Space place are left out while untouched), the sequencer
    masks, mod targets (`synthTimbre … synthSens` and the ten depths `synthDVel …
    synthDBend`), OSC `/opsia/sonify/synth/...` (advertised, echoed), MIDI Learn on
    its knobs (a new continuous target `sonify:param:<param>`), the voice dice (a
    weighted sound and engine, half the time a factory sound, the patchbay kept), the
    whole dice, Space (one source where its playing things are, the loud ones weighing
    most : source 12, the FX return and the Collage pieces moved up by one).
  - Measured (test copy, RTX 4070, a dance film in front of a projected screen) : 59.8
    fps with the Sonify page open and 7 to 8 things playing; the players 0.3 ms a tick
    (p95 0.5, max 0.7), the whole Sonify tick 0.12 ms a frame on average; up to 8
    playing (poly), 1 in mono and unison. A square crossing left to right (keyboard) :
    a run of 15 notes, 53 to 77, one a scale step, `setMods` pan −0.52 → +0.49 and the
    right channel 0.29 → 0.71 of the sound (the mods reach the engine; measured on the
    sine stand-in the real engine replaced).
    Flashes at irregular times : onsets spread over 210 ms of the 1/8 when free, within
    3 ms of the 1/8 and of the 1/16 on a grid (10 ms before the output timestamp). Two
    of Vincent's sessions (scenes with sound patches, 10- and 11-voice masks) export
    byte for byte as master's (a625e05). Headless (the same film, 53 s) : about 10
    strikes a second, runs of 2 to 3 notes a thing; synthetic shapes : rising,
    rightward and outward moves rise in height, keyboard and radial, falling ones fall,
    a still picture plays nothing, PICTURE 0 sends exactly neutral mods, a stop or an
    exit lets go 0.4 s later, poly holds 8 of 12 things.
  - **The real engine in the worklet** (both halves merged; test copy, RTX 4070, the
    dance film alone on L1, the sound to a virtual audio cable so a real device clocks
    it) : `globalThis.OpsiaSynth` in the worklet scope is the real class (8 engines, 8
    voices), no `addModule` error, 0 console errors. Each engine at its defaults, 8 s
    from the same moment of the film : 101 to 137 strikes, RMS -22.9 to -27.2 dBFS,
    peaks -8.9 to -12 dBFS, no 100 ms window under -60 dBFS, never clipped, the limiter
    never reached, 0 non-finite samples out of the engine (again with every macro,
    resonance, drive and level at 1 and chorus II : the same, its raw peak at most
    0.99). Poly : 8 things playing, 8 voices sounding; unison : 1 thing, all 8 voices;
    mono : 1 and 1. A factory sound changes the sound (Glass Bell over the default :
    the spectral centroid 573 → 1171 Hz). The audio thread with 8 voices of the modal
    engine (the heaviest; macros 0.9, drive 0.6, chorus II) beside Spectra and the FX
    tail : 0.44 to 0.51 ms a render quantum on average (the engine 0.29 to 0.37) of
    the 2.67 ms it has, none over it in 30 s (10,875 quanta, the audio clock at 1.000
    of real time; one quantum of 2 to 3 ms in each of the two runs that switched the
    engine to modal on the way in), the picture at 60 fps (p95 19.5 ms). Beside the
    other voices at their defaults on the same film : the Synth at -25 dBFS RMS like
    the Chord, under Spectra and Orbit (-19) and Flow and Events (-14, -15).

- **The Seq page is the home of every sequencer : lanes under one transport, and a Body
  rule timeline** (Vincent : "a complete Body rule sequencer ... drag and drop rules on a
  timeline and make them active or not active for a pre-determined amount of time", then
  "what if the whole SEQ window was home to all the things that can be sequenced in the
  app"; his calls : blocks in BARS, and a toggle by hand wins until the next block edge).
  `SequencePage.tsx` is now three collapsible lanes (`collapsed['seq-lane-<id>']`) under
  one transport, each sequencer keeping its own time : **Scenes** (the macro-form
  auto-pilot exactly as it was, its play / skip / score in the lane header, its height
  dragged at its foot : `opsia.seqLaneH.scenes`), **Sonify keys** (the key sequencer's
  own component, `SonifyKeySequencer lane` : the same store, the rows in three columns,
  its M on every; edits show in both pages at once) and **Body rules** (`RuleLane.tsx`).
  The **transport** plays every lane marked "with transport" (`seqLanes.arm`, in the
  session; an older file : all) and stops them all; it shows the shared beat clock's bar
  and beat, the tempo and the LINK badge. The rule timeline (`engine/ruleSeq.ts`, model
  `engine/ruleSeqModel.ts`) counts in bars of the Sonify beat clock (`soniClock.ts` : the
  BPM, or Ableton Link's beats and bar), so it starts with the key sequencer on bar 1, or
  on Link's next bar; a new `soniClockAlsoOnBeat` hook keeps a sequencer started while
  it runs on its bars (and never zeroes the count under it). Blocks are `{ id, rule,
  start, len }` in bars on a 1/48-bar grid, melted when they overlap (touching blocks
  stay two : each edge is a moment the hand gives way); loop 4 / 8 / 16 / 32 / 64,
  loop or once (once ends at the end of the pass it is in, and stops by itself without
  telling Link). While it runs, a rule with blocks is on inside them and off outside,
  every write through `setBodyRuleActive(id, on, 'seq')`; a rule without blocks is left
  alone; stopped, it drives nothing. **The hand wins** until the next block edge on that
  rule's row : a hand is a change since the last frame from any source but 'seq'
  (`bodyRuleLastChange`), or the rule found in another state than the timeline last set
  (a write that took another road); a `held` mark shows on the row. Editing : drag a
  rule's name onto the timeline (its own row, a quarter of the loop up to 4 bars), draw
  on a row, move / resize with bar snapping (Shift : beats), Alt-drag copies, Delete or
  the right-click menu removes, double-click adds; every edit is one store write, so one
  undo step (`ruleSeq` and `seqLanes` joined the undo snapshot). The timeline is kept on
  this machine beside the rules (`opsia.ruleSeq`; the rules are `bodyControl`'s, not the
  session's), blocks naming their rule by id : a renamed rule keeps them, a deleted one
  takes them along (pruned silently, after the change that made them orphans). The
  session carries `ruleSeqOn` (an installation starts it again). Link start / stop knows
  the new lane (`PlayThing 'rules'`; a first play starts it when it has blocks and goes
  with the transport). MIDI learn `fire:transport` and `fire:ruleseq`; OSC
  `/opsia/seq/play` and `/opsia/seq/rules`. The playhead, the live blocks' glow and the
  readouts are written from the window's own frames (no React render per frame), in the
  page's own window too. Measured in the test copy at 240 BPM (a bar a second) over 3
  passes of an 8-bar loop : 355 samples of four rules, 0 off their blocks away from an
  edge; a MIDI-sourced off inside a block held to the next edge then the block took it
  back, a click outside held on to the next edge; a row-less rule untouched; play once
  stopped itself after 8.1 s; 60 fps (frame p50 16.7 ms, p95 16.8 ms) with the page open
  and the three lanes running.

- **The body modulator's clutch : a hand as a fader** (Vincent : "use my left hand,
  open, to control the opacity value in real time, like a swipe of my hand that swipes
  through the opacity fader from min to max"; then "follow only while [feature] is above
  a threshold, otherwise hold", for any feature and any parameter). `cfg.body` takes
  three optional fields : `clutch` (any body feature), `clutchAt` (0..1, 0.5 to start)
  and `clutchInvert` (follow while BELOW). While the clutch is engaged the modulator
  follows its feature with its own smoothing; let go, it holds the last value, and every
  binding of it holds (it lives in the modulator). The gate and its numbers are in
  `engine/bodyClutch.ts` (pure, tested under node) : a fixed dead band of ±0.05 around
  the threshold (engage at ≥ at + 0.05, let go at ≤ at − 0.05, clipped to 0..1; an
  open hand reads ~0.95 and a fist ~0.2, a still hand wobbles ~±0.03); a grab glides
  from the held value to the hand with a 70 ms time constant (or the card's smoothing
  if slower), ending within 0.005 of the hand or after 500 ms. Out of view holds and
  lets go : the body bus now knows which hand slots hold a hand (`setHandSides`, one
  line in the tracker's `deriveHands`) and `bodyBus.inView(feature)` asks for the
  feature's own part (its hand, both hands for handsApart, the face, the pose for the
  pose and the movement qualities; the silhouette zones, the motion field and the
  presence gates read the whole frame, never absent), so a hand that leaves while the
  other stays (its values frozen on the bus) or a frame with nobody in it (the values
  relaxing to rest) never moves the parameter; the clutch's part and the main
  feature's are both asked. Before any value is held it starts from the feature.
  No clutch = the old law, bit for bit (master's engine side by side, 5000 uneven
  frames, 3 body cards, hands in and out, a card off and on : max difference 0).
  **Card** : a CLUTCH row (feature menu with **off**, the state dot : filled following,
  a ring held, a faint ring held out of view) and, with a clutch, an ABOVE / BELOW chip
  with the threshold slider and box; the meter dims to 35 % while it holds. All 19
  types still fit the 160 px card (20 / 20 with the clutch rows, sliders 81 and 87 px
  of track at 1536 px). **Body page** : Alt+click a feature's → makes it the clutch of
  the body modulator routed last (else the last body card; a warning when there is
  none). Sanitized on every load (sessions, scenes : `normalizeComposition`); a pinned
  card, the dice and scenes carry the whole block. No card copy / paste exists, Generate
  and the dice never make body modulators, and OSC / dataflou / the agent do not expose
  modulator settings, so nothing else needed it. **Measured in the test copy** (synthetic
  body bus, no camera; M1 = handLeftX clutched by handLeftOpen > 0.5 on L2 opacity and
  the Background's, Multiply, depth 1) : the open-hand sweep lands at 0.600 on both (max
  lag 0.014); the hand closed at 0.6 holds with drift 0 while X travels to 1 and back to
  0.2; reopened at 0.2 it glides 0.600 → 0.516 → 0.450 … and is within 0.02 in 230 ms;
  nobody in frame, or only the right hand, drift 0; openness jittering ±0.03 around 0.5
  for 5 s : 0 state changes from open and from closed; BELOW follows a closed hand and
  holds open or gone; faceJawOpen clutched by handRightPinchIndex on L1 Fluid's flow :
  0.516 (expected 0.516), held through release and the face leaving, regrab 0.295
  (expected 0.295); save and reopen from disk, and a scene recall, keep the clutch; a
  v1.3.1 body block loads byte-identical and follows as before; console errors 0.
- **Body rules : each rule's on / off, played live by MIDI, actions and OSC** (Vincent :
  "I should be able to map any Body Rules' active toggle to a MIDI note, so I can toggle
  ON or OFF a rule; so inside a performance I can choose manually if a rule can be active
  or not."). ONE store write, `setBodyRuleActive(id, on | 'toggle', source)` (source
  `ui` / `midi` / `action` / `osc`, and `seq` for the rule sequencer to come;
  `bodyRuleLastChange(id)` keeps the last change and who made it, not saved), taken by the
  rule's box, MIDI, the actions and OSC; no write when nothing changes; it fires nothing.
  **MIDI learn** : each rule's box and name in the RULES list is a learn target
  (`rule:<id>`); a note turns the rule on or off on each note-on (velocity > 0; a note-off
  does nothing), a CC sets it (64 and up on, below off; counted as a continuous control,
  so that CC never also fires a trigger); its label "RULE <name> : on/off" follows a
  rename. **Actions** : `act:rule:<id>:on|off|toggle`, "RULE <name> : on / off / toggle"
  under a new **Body rules** heading after Modulators (the rule builder, MIDI learn's
  action list, any pad), following the rules as they are made, renamed and deleted
  ("(gone)" after); the builder alone offers **RULE this one : off (fires once)**
  (`act:rule:self:off`, saved as the new rule's own id). A rule changing itself or
  another only changes what the NEXT gesture does (the dispatcher reads the rules once a
  frame) : a rule armed by a gesture does not fire on that same onset, a self-off rule
  fires once, nothing loops. **OSC** : `/opsia/body/rule/{n}/active` (≥ 0.5 on; float,
  int or bool) and `/opsia/body/rule/{n}/toggle` (rising edge), `n` the rule's place in
  the list as numbered items are everywhere else, advertised in OSCQuery camera on or
  not, `active` fed back (the toggle not). Mappings are keyed by the rule's id : deleting
  or moving another rule never re-targets one, and deleting a rule drops its `rule:<id>`
  and `act:rule:<id>:*` MIDI mappings (in `setBodyControl`; stale ones on load too). The
  on / off stays where the rules live : machine-local, `opsia.bodyControl` in
  localStorage, not in the session. The box now draws its off state (a grey outline : the
  global button reset left an off box blank) and an off rule's name dims. Test builds
  expose `window.__midi` so probes drive the MIDI manager's own `onMessage`. Checked in
  the test copy (RTX 4070, camera never opened) with real CDP clicks and keys : `L` arms
  learn on the Body page, the box overlays learn note 60 (rule A) and CC 20 (rule D),
  blue then green; notes on / on / note-off / velocity 0 / on : A off, on, on, on, off;
  CC 0 / 127 / 63 / 64 / 64 / 1 : off, on, off, on, on, off; the box followed every step.
  An inactive rule fires nothing on its gesture (L1 mute unchanged, no fire) while the
  monitor still shows the gesture; fist R's rule turns A on and off; a rule arming
  another on the same gesture : the armed one did not fire on that onset, once on the
  next; a rule turning itself off fired once, stayed off 500 ms later and through two
  more gestures, once more when turned on by hand; the builder's "this one" saved as
  `act:rule:<own id>:off`; the picker listed the 21 rule actions + this one; rename (the
  list and the MIDI label follow), reversed order (note 60 still plays A), delete by its
  × (its CC and a pad action gone from the map and localStorage, A's kept; the rule
  targeting it says "(gone)" and fires harmlessly) : 43/43. After a cold relaunch : rules
  and mappings back, note 60 still plays A; OSC over UDP f 0 / 1 / 0.4, i 1, F, T, then
  toggle 1 / 1 held / 0 / 1 : off, on, off, on, off, on, off, off, off, on, the box
  following; rule 99 ignored, rule 2 reached its rule; OSCQuery advertised 7 rules
  (active + toggle); a MIDI change echoed `/opsia/body/rule/1/active 0` on the feedback
  port, no toggle echoed : 10/10. Console errors 0.
- **Body rules : each layer's opacity, and the Background's** (Vincent : "in Body, I
  should be able to select each Layer's opacity as options for creating a rule"). Five
  new actions per layer in the shared vocabulary (`actions.ts`, so the Body rule picker,
  MIDI learn and every rule get them at once) : `act:layer:<i>:opoff` / `opfull` /
  `optoggle` / `opup` / `opdown`, read "LAYER 2 opacity off / full / off / back / up /
  down", in each Layer group after punch; the same five for the Background
  (`act:bg:<verb>`, "BACKGROUND opacity …", a new **Background** heading after Layer 4,
  offered while the session has a Background, "(gone)" and doing nothing otherwise).
  Off and full are instant; **off / back** keeps the opacity it took down (per layer and
  the Background, as freeze keeps the speed) and gives it back, full when nothing an
  action did took it to 0; up / down are a tenth, clamped. One store write each
  (`setOpacity` / `setBackgroundOpacity`) : one undo step, a quick run of steps
  coalesced; the morph eases to it when one is under way; OSC feedback echoes it as any
  change (the dataflou opacity destinations are inbound only). A pinned layer, a pinned
  layer opacity (`lay:<i>:opacity`) or a pinned `bg:opacity` refuses with its toast
  ("L2 opacity is persistent : the action leaves it"). The list's search ranks them
  first for "L2 opacity" / "bg opacity" (`triggerCatalog.ts` keywords). There is no
  continuous rule kind on the Body page : a body feature drives an opacity through a
  `body` modulator bound with the opacity's **M** (both were already modulation
  targets; the README now says so). Checked in the test copy (RTX 4070, camera never
  opened, `getUserMedia` stubbed) : all 25 ids fired through the rule engine
  (`bodyBus.fireGesture` → App's dispatcher), 67/67 store + compositor checks (each
  layer from 0.6 / 0.45 / 0.8 / 0.3 : off 0, back to its value, full 1, up clamps at 1,
  down 0.9, x3 0.7, eleven downs clamp at 0, the three other layers untouched; the
  Background 0.7 → 0 → 0.7 → 1 → 0.9 → 1); undo : off from 0.5 undoes to 0.5, three
  quick ups 0.5 → 0.8 undo in one step; pins refused (control, whole layer,
  Background); a fire mid-morph (1.5 s, compositor at 0.413) settles at 0.9. In the UI
  with real CDP clicks : "L2 opacity" lists the five first, "opacity" the 25 under
  Layer 1-4 + Background, the pick saves as `act:layer:1:optoggle` (auto name "pinch L
  takes layer 2's opacity off and back", `/body/PinchLL2OpBack`), its test button takes
  L2 0.6 → 0 → 0.6 (store and compositor), the rule survives closing the page and a
  window reload and fires by its gesture after (0.35 → 0 → 0.35); MIDI learn lists the
  25 and arms `act:bg:optoggle`. A `body` modulator on a synthetic hand height bound to
  L2 and Background opacity : the compositor follows 0.2 / 0.5 / 0.9. Console errors 0.
- **Silhouette, the effect** (`node-silhouette`, Vincent : "Can the Silhouette source
  (created by a webcam with recognition) be re-created as an effect ? I want to be able to
  recognize silhouettes inside an imported video by dropping this effect on it"). A native
  node (`engine/silhouetteNode.ts`) in the FX picker's **Utility** group beside Matte, in
  any rack : it finds the people in whatever picture enters it (an imported film, a camera
  layer, an NDI input, a generator) and draws the Silhouette source's four looks on that
  picture : **cutout**, **matte**, **shadow**, **hole**, with **trail** and **trail
  color**, plus **over the picture** (the result over its input, premultiplied), **mix**,
  **people** (1-4, their masks united), **detail** (read at 384 / 512 / 768 px on the long
  side), **smooth** (the mask's time constant, 0.8·s² s) and **hold to the mask** (sync).
  The looks and the trail are ONE copy shared with the source (`engine/silhouetteLook.ts` :
  `silLook` / `silTrail` / `silOut` GLSL, the `SilTrail` ping-pong, `trailKeep`; the
  source's arithmetic is unchanged). How it finds them : its input is read back small,
  upright and over black, through an async `GridReadback` ring (pixel-pack buffers +
  fences, a 2x2 box of bilinear taps per texel), and the newest frame goes to the body
  model (MediaPipe Pose lite with segmentation masks, `bodyWorker.ts`, the model People
  and the Body page use; nothing downloaded, no camera opened) in ONE worker shared by
  every Silhouette effect (`silhouetteFinder`) : one frame in flight, the effect served
  longest ago goes next, at most 30 looks a second each, a picture that does not change (the same
  fingerprint : a paused film) looked at three times (VIDEO mode loses the bodies on a
  seek and finds them on the next look), then rested. One effect alone : VIDEO mode (the bodies followed);
  several : IMAGE mode (frames from several pictures in turn), back to VIDEO after 3 s
  alone; `numPoses` = the most any effect asks for, each merging only its own first n
  masks (`bodyWorker.ts` gained `cfg.image` and `frame.people`). The mask comes back in
  the picture's own frame (no mirror, no camera aspect), is uploaded (R8) and followed
  over time on the GPU (an R16F state), then cut with threshold / softness like the
  source. **hold to the mask** keeps a ring of RGBA8 copies of the input (as many frames
  as the measured delay + 0.7 tau needs, at most 8) and shows the one the mask was found
  in. Bypassed, or on a muted layer no other unit reads, it does nothing at all (the
  Compositor passes `live` to the nodes : a layer seen, or read last frame as a sidechain,
  a Matte's matte, a Text fill or a Sonify tap); the worker is let go after 30 s unused.
  The Inspector line says what it finds (people, looks a second, ms). 15 presets, a
  **People** group of master chains (Shadow Play, Ghost Dancer, Absence, Glass Bodies,
  Outline), four Film Wall Generate themes (Cut Out, Shadow Theatre, Absent, Afterimages),
  grouped columns (find / look / out) and grey-outs (shadow color outside shadow, trail
  color outside a matte with a trail, over in the matte), hints, keywords, a blurb.
  Measured in the test copy (RTX 4070 Laptop, a 1080p 30 fps dance film : one performer
  before a projection screen) : 13-29 ms a look in the worker (121 ms the first, the model
  warming up), 17-30 looks a second while she moves (24 on the dome's 2048² square); she
  is found in 94.3 % of the samples over the 36 s she is on stage (90.9 % on the
  Satosphère setup), the mask covering 5.2 % of the frame on average, and in 0 % over the
  title and credits (1.2 looks a second there : the still picture rests); the matte's
  centroid follows her bend (y 0.27 → 0.47 → 0.27 over 2 s). 60 fps held at 1080p (frame
  mean 16.7 ms; p95 22 ms on, 19.5 ms bypassed) and on the dome (4096 master, 59.6 fps).
  Bypassed, or its layer muted : 0 looks a second, no client. Two effects : IMAGE mode,
  8.5 looks a second each, 59.8 fps. With people at 2 a face on the film's projection
  screen counts as a person too (the hint says so). The source's four modes measured the
  same on a synthetic mask after the refactor; on held frames (6 to 38 s) she is found
  on all 8 with three looks (16 s and 30 s were missed with one). Fulldome gate
  (`domegate.sh --ids node-silhouette`, over Shapes : nobody to find, the picture stays
  empty, 0 updates a second both ways) : PASS, flat 60 fps, dome 59.8 fps p95 23.5 ms,
  heaviest settings 60 / 59.7 fps. A first run read 1 fps in every stage : the test window
  was not painting (rAF at 1 Hz while the engine drew on its fallback timer, the effect
  drawn 16 ms before); a control run (Grade, then Silhouette) and the rerun passed, and
  the same sequence re-measured held 60 fps.
- **MACRO : the Macro knobs row shows or hides, hidden by default** (Vincent : "I don't
  use it so often and I think neither will the average user for now; so I think it would
  save some UI space to be able to not see it all the time"). A **MACRO** button at the
  far right of the Modulation row, next to ACTIVE, with ACTIVE's look (`ModulationPanel.tsx`
  `MacroToggle` : off = ACTIVE's resting chip, on = accent fill and ring). The choice is
  per machine (`store.macroBar` / `setMacroBar`, localStorage `opsia.macroBar`, `'1'` =
  shown; absent = hidden), not the session's. Off, `MetaBar` renders nothing; showing it
  unfolds it (`collapsed.meta = false`), its own fold still works. Hiding is a view only :
  the smoother, the modulation path, MIDI CCs, OSC, Generate, Body rules and pads keep
  moving the knobs and their destinations. Hidden-but-moving : a small `accent2` dot on
  MACRO when a knob is driven by a live modulator binding (not muted, modulation not
  bypassed), has a MIDI CC, or is fired by a MIDI pad or an enabled Body rule
  (`act:meta:*`, `rand:meta`), the tooltip counting each; OSC and dataflou are not
  counted (nothing to read ahead). MIDI Learn mode shows the row, unfolded, while it is
  on (the per-machine choice untouched), so its knobs stay learnable; a Macro knob picked
  in `Ctrl+K` turns MACRO on; a new `Ctrl+K` command **Macro knobs** toggles it. Measured
  in the test copy (RTX 4070, emulated viewport) : hiding gives `main` back 174 px at
  1536×864 (the preview 234 → 408 px tall) and 173 px at 1024×768. At 1024 px ACTIVE and
  MACRO stay on the title line (same top, no horizontal scroll); the 39 px button plus
  its 6 px gap leaves the binding chips 45 px less room before they wrap (with this
  session's 5 bindings they wrapped at 1024 with or without it). Checked with real CDP
  mouse events : off on a fresh profile, a click shows 16 knobs (12 + the two XY pads),
  ACTIVE mutes and resumes without touching MACRO, the choice survives a relaunch both
  ways, a hidden knob still drives its destination (OSC 0.7 then 0.3 → layer opacity 0.7
  then 0.3 in the store and the compositor; a modulated hidden knob swings the layer's
  A/B mix over 0.72), the dot appears with a modulator on knob 2 and goes with it, MIDI
  Learn shows then hides the row; 0 console errors.

- **Silhouette : a trail color for the Matte's echoes** (Vincent : "I thought in Matte mode
  the trails could be of another color too"). New input `trailColor` (color, default white,
  modulatable like every color) : in Matte mode with a trail, the echoes are kept in that
  color (times its alpha) while the present body stays white; the copy out draws the kept
  coverage as `rgb * a` on opaque black, so white is to the bit the grey key it was. Shadow
  color greys out unless the mode is shadow; trail color greys out unless the mode is matte
  with a trail on (`GroupedControls.tsx` DIMS, Silhouette had none). Presets Lingering key,
  Matte comet, Cold wake. Checked in the test copy with a synthetic moving disc (no camera) :
  body 255 white in every run; far echo 170 grey (white), 170 / 34 / 16 (red), dimmed blue at
  alpha 0.5; room black.

- **Every color picker is modulatable : its color slider and both axes of its pad**
  (`engine/colorParts.ts`, `ModTarget.ch`, `AutoControls.tsx` `ColorModButton` /
  `ColorPartSwitch`, `VibePaletteStrip.tsx`). A color input (any source, effect or node,
  the Background, the Vibe's tints and palette stops, Context's atmosphere and light, the
  Finalizer's fill : 91 inputs in 46 shaders) is modulated by its parts in the picker's
  own space, HSV : the hue (the picker's slider), the saturation and the brightness (its
  pad, across and up), and alpha (not on the finishing stages, which read RGB). One **M**
  per color; the Modulate panel (the Inspector's and the Finishing column's) opens on the
  part already bound, else the hue, with a switch for the others. Each part takes
  modulators, Meta knobs (and so MIDI through a knob), depth, Multiply / Replace and
  shaping like a float. The data is an optional part on an input target (`ch : 'h' | 's' |
  'v' | 'a'`, key `<input key>#<part>`), so older sessions load unchanged. The engine keeps
  each color's parts per frame (`colorFrame`) : the stored color's HSVA, then each part a
  binding or a gliding knob moved, written whole, so several parts of one color (M1 on the
  hue, M3 on the brightness, a knob on the saturation) move it together. The hue binds in
  Replace and wraps round the wheel (depth 0.5 : once round); a Meta knob that commits the
  brightness or the saturation at 0 stores a black that keeps the hue (1/4096 above it),
  so the color comes back. The swatch paints the color played (`liveColorValues`, the live
  overlay's new `paint` subscriber) with the modulated border, the alpha thumb its part,
  the Vibe's stops and strip their played colors; the chip lists every part's modulators
  and a right-click clears them all. A pinned color holds its parts' rows and Meta
  destinations (`controlKey` in persist.ts). OSC : any color input's address plus `/hue`,
  `/saturation`, `/brightness` or `/alpha` sets that part, one `0..1` float (an unknown
  word after an input reads as before); the finishing stages' and the Background
  source's color parts are advertised in OSCQuery and fed back. Randomize and Generate
  still bind floats only. Measured in the test copy (RTX 4070, 61 fps) : an LFO on
  Interference's tint hue swept it 0.54 → 0.96 → 0.015 round the wheel while the
  saturation held at 0.889, the brightness at 0.9 and alpha at 1; with M2 on the
  saturation and M3 on the brightness of the same color, all three moved (s 0.445-0.889
  = the base x 0.5..1 at depth 0.5); the same held on Shapes' tint, a Colorizer, Fluid (a
  native source), the Background's Solid Color, the Vibe's shadow tint and a palette stop.
  Save, New, reopen kept the rows and the knob's part; Ctrl+Z / Ctrl+Y took a part
  binding off and back; one of the October sessions loaded with its 21 colors and 10
  rows identical. A color cell keeps a float cell's height (38 px).

### Changed

- **Randomize, as good as it can be** (Vincent : "Make sure the Randomize functions are as
  good as they can be (from the button)"). Measured, not guessed : 120 presses of
  Randomize All in the test copy, each frame read back (brightness, contrast, the black
  and white share, the brightest 1 %, motion, fps), then every dice source alone (4 draws
  each) and every dealt effect alone (3 draws on Membrane), and Generate (60 themes) as
  the reference for the house look. Before : 11 of 120 presses almost all black (16
  mostly black), 46 under 52 fps (32 under 45), 12.8 effects a press (up to 24). After :
  0 almost all black and 0 mostly black, 1 blown (temporal effects stacking up), 0 frozen, 0 under 52 fps, 6.3 effects a press (up to 11), median brightness 0.35 (Generate's 0.27), 0 errors; each of the 12 scopes fired 6 times from the real button (its menu, then the button) : every press changed the instrument, 0 errors, the Macro banks 1 to 4 destinations a knob, none shared, no seed.
  - **Blends by ground** (`randomize.ts` `layerGround`, `safeStack`) : most sources draw
    light on near-black (median pixel 0.02 to 0.06), so a multiply, darken, overlay, hard
    light, normal or 50 add on an upper layer blacked the whole stack below it : the
    cause of nearly every black draw. A layer above the first now takes a mode its ground
    can carry : dark (add, subtract, screen, lighten, difference, exclusion, wrap, lighter
    color), lit (normal, multiply, darken, overlay, soft / hard light, difference,
    exclusion; an additive mode there washed out to white), mid (screen, lighten,
    difference, exclusion, overlay, soft light, lighter color). The grounds are measured :
    lit = Marbling, Physarum, Dye Field, Veins, Fur, Fluid, Mycelium, Solid Color, Scan,
    Ground, Membrane, RGB Osc (median above 0.3); mid = Sync Osc, Slit-scan, Op-Art,
    Ramps, Swell, Interference, Erosion, Colony, Drift Field. Effects light a ground too
    (Riso, Thin Film, Halftone on paper; Dither on paper and Threshold : mid). The bottom
    layer : normal / add / screen / lighten, normal alone on a lit ground; the A/B mix the
    same rule plus the relation modes; New's seed the same. Applied by every scope that
    changes sources, blends or racks, after the deal, changing only an unsafe pairing.
  - **An effect budget for Randomize All** (`trimToBudget`, `DRAW_BUDGET`) : 3 to 11 over all
    racks, most presses 4 to 8, trimmed from the fullest rack (second voices first, the
    master last, pins kept). The master chain dealt with everything : 0 to 4
    (`MASTER_IN_ALL`); Randomize Master FX alone : 1 to 6 (it ran to 8).
  - **No strobes from the dice** : the random matrix and a random Macro bank never bind a
    seed or a flip (`diceTargets`; Generate already skipped them) nor the pinned Vibe and
    Finalizer (the Finalizer's opacity faded the show). Stepped modulators (S&H, random,
    arp, euclid, turing, cellular, steps; square / saw / random-step / spastic LFOs) run
    1/4 to 2 bars or at most 1.5 Hz (`diceClock`; 1/16 at 120 BPM was 8 jumps a second).
  - **Randomize Macro Knobs** (`randomMetaKnobs`) : 1 to 4 destinations per knob (was 1 to
    8), none shared between knobs, and each knob placed where every destination sits in
    its curated range (a knob maps over the whole declared range, so a blind position threw
    a dozen inputs to their extremes).
  - **The master never gets Edge** (like Threshold : the edges of the whole picture are
    mostly black), nor a closing Palette or Grade while the Vibe Palette is on (two ramps :
    the flattest draws).
  - **Loops** : the ready loops that brighten (lighten, screen; 0.7 to 0.96 of each pass
    back) only on layers drawing on black : over a lit ground they climbed to white.
  - **The pool** : Lattice and Parametric are dealt (they need nothing; 60 fps on their dice
    draws); Grown stays out (its dice draws ran at 4 fps). Difference Bloom's dice keep
    starts at 0.25 (a motion key on a slow source left the layer black, 3 draws of 3).
  - **Randomize Sonification** keeps the 0.05 touch of room on the half of its presses that
    leave the Reverb / Delay alone (it set the send to 0).
  - Test hook `__rand` (test builds only) and `DICE_FX_IDS`; the probes live in the session
    scratchpad (`rnd2.cjs` sweep, `rnd3.cjs` pieces alone, `rnd4.cjs` the real button).

- **Body tracking stops slowing the picture down** (Vincent : "using the Body features while
  generating visuals considerably seem to slow down the app. Can you look into how to deeply
  optimize Body"). Measured first, with the test copy on a fake camera and then on his own
  webcam with him in front of it (his OK), on a heavy picture (4 layers, A + B : Oil Cloud,
  Cloud Study, Fluid, Fur, Relief, Physarum...) :
  - **The models on the processor, one worker per model.** `bodyWorker.ts` now builds every
    landmarker with the CPU delegate first (the GPU only if that fails) : on the graphics card
    each detection reads its results back and waits for the whole GPU queue, the picture's
    frames included (one model took a 60 fps picture to 47; all three ran 140-230 ms a frame,
    5 a second). `bodyTracker.ts` runs a LANE per model (hands · pose + silhouette · face),
    created when first asked for, kept while the camera runs, frames joined per camera frame
    (`join`, one `process()` per frame as before, a lane's hiccup drops that frame). On his
    webcam : 12-13 tracked frames a second, 40-80 ms each, against 6-7 at ~150 ms, for the
    same frame rate (54-56 with Body, 60 without); with a light picture 30 a second (the
    camera's rate), lanes 23 ms. MediaPipe's web runtime still uploads each frame to the
    card and reads it back, so a near-limit picture still loses ~5 fps with all three on.
  - **Its own clock.** The loop ran on the window's animation frames : a window that doesn't
    paint (covered, minimized, the output over it on the same screen) got one a second, and
    the tracking fell to one a second. Now a 4 ms timer (the windows are never throttled);
    minimized, 20 tracked frames a second (Hi-res repeats stay at the display rate).
  - **Motion off the main thread.** `workers/flowWorker.ts` : the camera frame is scaled to
    64 × 48 on the card (`createImageBitmap` resize) and read back in the worker; the main
    thread's synchronous readback caused a 400 ms stall under load. Main-thread fallback kept.
  - **The Body page.** Its meters (`FeatureMeters`) move by direct writes : the whole page
    re-rendered 11 times a second for them (open, it cost 8 fps and half the main thread;
    now 1.5 fps). The preview redraws only on a new camera frame, a tracked frame or the
    Room's people moving (`version` on both trackers), and the page's own state is set only
    when it changed.
  - **Room at most 10 frames a second**, its easing per second (`EASE_HZ`) so the people
    still glide : unthrottled it took a 60 fps picture to 45 (60-200 ms a frame under load);
    capped at 12, to 50. Still the heaviest Body option, said so in the README.
  The Silhouette effect's own worker (silhouetteNode) uses the same bodyWorker, so it moves to
  the processor too. `__perfRates` (fps, backlog skips) joins the test hooks.

- **The sections get a gentler glass than the buttons** (Vincent : "add something like this to
  the other sections, like the Inspector and Master FX sections, all the layers (including BG
  and AU), and other sections [...] just so I can see where it can go"; then "merge it all").
  One rule in styles.css on every rounded, bordered box in a panel color (the layer cards BG,
  L1-L4, AU, the Inspector, Master FX, the Mixer and its columns, Feel, the finishing units, the
  Connect sections, the pages' cards) : a lit top edge, a glow fading within the first 90 px
  whatever the height, a soft lift; the top bar, the modulation strip, the bottom bar and the
  Connect sections take their top edge only. The previews (black) stay out; `.no-sheen` opts
  out; plain with interface glass off. Test copy : 11 boxes in the main view, Mixer 10, Feel
  13, finishing 8.
- **Sonify's families are boxes that hold their voices** (Vincent : "the header sections are
  smaller than the different sonify modes inside; it's confusing visually. Can you propose
  something more logical" : he picked A, a box per family, over a title per family or a
  colored band, mocked on the real page). `VoiceGroup` is one box (rounded, the family's color
  as a 3 px left edge) with the head inside it at the family size (`SectionHead size="family"` :
  32 px, a 12.5 px title instead of 9 px, the chevron and the voices-on summary bigger too);
  the cards inside drop their own colored edge (the `FamilyColor` context is gone) and sit a
  little darker than the box (`InFamily` in sonifyUi.tsx). Under 280 px the box loses its inner
  margin : with it, six cards spilled at 240 (dice, octave pickers); without, none. Overflow
  sweep with every voice on at 240 / 260 / 280 / 300 / 320 / 400 / 640 : nothing out of a card.
- **The Source Editor lists every ISF shader, A to Z** (Vincent : "make sure all shaders
  (sources and fx) are there, and always classify them in alphabetical order"). Vibe Palette,
  Context and Finalizer were missing (kept out of `FX_SHADERS` so a rack can't load a second);
  each list (my shaders, generators, effects) is sorted by name. Measured in the test build :
  34 generators, 60 effects, all in order. The native nodes have no ISF code to open.
- **Every button gets a little liquid glass** (Vincent, first on the bottom bar : "keeping the
  same button shapes, but adding a little liquid glass feel to those buttons ? No need for
  see-through stuff that slows the UI"; then : "I find it a bit bizarre to only have liquid
  glass in the lower toolbar. Can you put some on ALL the buttons in ALL the app"; after a feel
  test : "an in-between [...] it's nice that they pop out, but it's a bit too much now", so about
  half the first sheen; the tab row lost its own capsule behind the tabs, and the tabs their
  own capsules : "keep the liquid glass capsule only on the selected tab", its sliding lens). The
  bottom bar's resting buttons now read in the full text color like the top bar's ("it doesn't
  pop as well as the buttons on the top toolbar" : they used the muted idle style, which the
  layers' A / B keep to mark an empty slot). One rule in
  styles.css : a lit top rim, a sheen fading down over each control's own color, a shade at
  its foot, a softer press, on what looks like a button (`.btn`, `.btn-accent`, a bordered,
  filled or `.input` button, every dropdown, the effect and modulation chips, `.chip`); list
  rows, bare icons and the glass pieces keep their look, `.no-sheen` opts out. A ring keeps its
  shadows (the Tailwind ring variables come first); a compact dropdown's chevron rides on top
  as its own layer (`--sheen-arrow*`, set by `.select-compact`). Plain with interface glass
  off. The Mixer's small dropdowns lose an inline `backgroundImage: 'none'` left from an old
  chevron (nothing draws one there now) so they take it too. No backdrop filter : nothing is
  sampled. Measured in the test copy : 144 of the 186
  visible controls of the main view take it (the rest : section arrows, the capsules' own
  glass, the text inside chips), 0 with glass off.

- **Sonify's voices in five families, the Synth between Chord and Collage** (Vincent :
  "Synth should be between Chord and Collage in the Sonify modules order. Also : if
  other Sonify modules need reorganizing (with colored categories), do it.").
  `components/soniGroups.ts` holds the families, in the sectioned panels' colors
  (`SECTION_COLORS`) : **spectrum** accent2 (Spectra, Filter), **wave** red (Orbit,
  Raster, Transmission), **hits** amber (Flow, Events, Signal), **notes** violet (Chord,
  Synth), **films** earth (Collage, Assemblage), plus the **tail** neutral (Reverb /
  Delay). The voices view renders every card by its stored index from a `card` record
  and `SONI_GROUPS` places them, so the order lives in one list; each family is a
  `VoiceGroup` : the shared `SectionHead` (fold key `soni-group-<id>`, the voices that
  are on as its summary) and a `FamilyColor` context the `VoiceShell` reads for the
  card's 2 px left edge (`Shell`'s new `edge`). `VOICE_ORDER` is now
  `SONI_VOICE_ORDER` (the mixer, the effects sequencer, whose column letters take the
  family color, and Space's voice list), and the mixer strips carry the edge too. No
  stored index moved : sessions, mixer channels, filters, sequencer masks and MIDI
  bindings (`sonify:voice:i`) are untouched.
- **Sonify's Reverb / Delay is on by default, low** (Vincent : "by default, Chord and
  Collage should be OFF and collapsed. Delay/Reverb should be ON, but its SEND should be
  a 0.05"). `defaultSoniConfig().fx.send` 0 → 0.05, so a first launch and the ↺ reset
  start with a touch of room on everything; the card's on pill and a double-click on
  either send slider (the card's and the mixer's FX tail) bring 0.05 back too (were
  0.35). Chord and Collage already started off, and an off voice's card is folded to
  its header : unchanged. Sessions, scenes and presets carry their own send, so they
  play as saved; this computer's remembered Sonify (`opsia.sonify`) keeps its own until
  ↺.
- **The Sonify Synth's card : the sound it plays named, sections, the main knobs bigger,
  a dice for the picture** (Vincent's four : "show what preset is selected in the Sound
  dropdown when I select one", "add better organized sections (like in the Finishing and
  source/fx inspectors, with categories colorized)", "make Timbre, Harmonics and Morph
  visually different from the other sliders, so we know they are more important" and "add
  a randomize button only for the Picture section").
  **The Sound menu keeps the factory sound's name** : a pick writes it on the config,
  `SoniConfig.synth.preset` (`synthFromPatch`), absent until a sound is picked so a
  session that never picked one saves the same bytes (the Synth's export rule;
  `normalizeSynth` keeps only a name that exists). The menu (grouped by engine) shows it,
  and `synthPatchState` compares the sound fields with the patch : once one moved (a
  slider, the engine, OSC, MIDI; a modulator writes nothing, so it never counts) it reads
  **"Choir Ah · edited"** (a hidden option, so picking the sound again is a change and
  brings it back). OSC `/opsia/sonify/synth/preset` names it too; the Synth's dice, when it
  draws a factory sound (half the time), lands it whole and named, its level included (the
  factory levels are matched in loudness), and clears the name when it rolls an engine of
  its own. Sessions, scenes, presets and the reload carry the name like any Synth field.
  **Sections in the Finishing panel's look** : `FinishingSections.tsx` exports its header
  (`SectionHead` : chevron and title in the section's color, the state on the right; keys
  fold it only from the bar itself now) and its colors (`SECTION_COLORS`), and the card
  uses them : **engine** (accent) · **read** (earth) · **tone** (red) · **envelope**
  (violet) · **life** (neutral) · **picture** (accent2), each a header bar across the card
  with its state (`dco · poly`, `height · oct 3→5 · free`, `ladder`, `a.05 d.35 s.60
  r.35`, `glide 0.10 · chorus I`) and a rail of its color down its rows; folding is kept on
  this computer (`collapsed['soni-synth-<id>']`), PICTURE folded until opened. PICTURE's
  amount, its M, its learn overlay and its dice sit IN its header (a click on them never
  folds it), the ten rows under it, as before. The range row wraps its steps / slide pair
  under the octaves in a narrow column : at the column's narrowest (240 px) the card ran
  283 px of content in 204, now 204 in 204 (no overflow at 240, 320 or 640).
  **TIMBRE / HARMONICS / MORPH** are drawn as the main controls (`Slider`'s `main`) : the
  name strong on a line of its own with what the macro does on this engine beside it in
  the accent (`wave`, `density→interval`, `sync→metal` …, the line under them is gone),
  over a full-width taller track (`.soni-main` : a 6 px groove that fills in the accent up
  to the value, a 14 px thumb ringed in the card's color; accent2 while modulated, the
  fill following the live value through the live overlay). Their M chips and MIDI / OSC
  learn targets are unchanged.
  **The Picture section's own dice** (`randomSynthPatchbay`) re-rolls only the ten rows :
  velocity always gets a source (positive 85 % of the time), a row rests now and then
  (bend half the time), each row draws from the sources that suit it 70 % of the time and
  from a thing's own sources over the whole picture's, depths mostly moderate with mixed
  signs, resonance, drive and bend gentle, and the envelope keeps a sign that means
  something (quick, small or detailed things pluck; slow, big or long-playing ones
  swell). One undo step. The Synth's own dice already left the rows alone (it rolls the
  sound and the read); both tooltips now say which does what.
  Measured in the test copy (RTX 4070) through real CDP input, 51 checks : three sounds
  picked by typing into the menu each named and loaded exactly; a drag on TIMBRE reads
  "Choir Ah · edited", picking it again restores it; the name survives a reload, a session
  file round trip and a scene recall (a scene of an untouched Synth clears it); an old
  session re-exports byte for byte as the master build does (28,814 bytes, no Synth
  block); 30 Picture dice clicks changed only `synth.patch` (a diff of the whole Sonify
  config), velocity never none, the envelope's sign always meaningful, 211 thing sources
  to 36 whole-picture ones, median depth 0.49; one undo brought the rows back; 20 main
  dice clicks never touched the rows (8 factory sounds, all named, none edited); 23 learn
  overlays on the card before and after (13 knobs and the 10 depths); 0 console errors.
  Headless, 20,000 rolls : velocity never none, never all none, the envelope's sign
  always right, 84 % thing sources, median |depth| 0.50 (p90 0.79). The card is 42 px
  taller folded (745 → 787 px at 320 px), 46 px open.
- **An imported film plays at its own speed by default** (Vincent : "by default, all
  imported videos should be toggled to use their own speed, not the global speed").
  `store.setSourceVideo` (the one door every film comes through : the source menu's
  import, a desktop drop on a layer's A or B row, a dropped film converted first) writes
  `ignoreGlobalSpeed: true` on the new slot, so the transport's **global** button starts
  lit (`⊘ global`) and the film runs at its speed × its layer's whatever SPD does; one
  click hands it back to the global speed. Old sessions are left as they play : the
  field is written on the slot, and a slot without it (every film saved before) still
  reads as following the global speed, so nothing that was saved changes tempo. Another
  clip swapped into the same slot (the clip picker, the smooth copy, a relink) keeps the
  slot's choice. Import Audio, Collage, Assemble and the Audio Layer are not films in a
  slot and keep their defaults. Measured in the test copy (RTX 4070) : a film dropped on
  L1 with the code before carried no field and showed `global` unlit; now `true`, `⊘
  global` lit. With SPD at 0.25 for 2 s, a session saved by the code before (its film on
  L1, no field) advanced 0.50 s (follows the global speed, as it did), a fresh import
  beside it 2.03 s (its own speed); clicking its button gave `false` and 0.25×.
- **Number boxes are only as wide as their numbers** (Vincent, 11-02 : "why are ALL the
  float number edit boxes so wide ? Could they be a bit tighter, to not have so much blank
  black space inside ?"). Two causes : every box got a fixed width from its caller (`w-14`
  in the Inspector, `w-12` in the Finishing rows and the modulator cards, `w-16` in the
  Output EQ, `w-full` in a fixed column ...), sized for the longest value any box might
  show; and the unlayered `.input` padding (8 px a side) beat the callers' `px-1` /
  `px-0.5`, so every box also carried 16 px of empty black. Now `numberBox.ts` works out
  each box's widest text from ITS OWN range and decimals (per side of zero and per decade :
  the sign, the integer digits, the point, the decimals; a per-value rule for the Mixer
  faders and the envelope times; exact against a brute-force count over 39 ranges and 400
  random ones), and `BoundedNumberInput` writes `calc(Nch + padding + border + 2px)` before
  paint, with tabular figures and the caller's own side padding made to hold (4 px a side
  when none is given). The width never follows the current value, so it holds still under
  a drag or a modulator; while typing it widens to fit and goes back on leaving the box;
  three characters at least. A box without `maxFrac` now shows the decimals its range needs
  (`fracFor`, moved to `numberBox.ts`), so its text can never outgrow it (the layer speed
  and the Background keep their two decimals). Every caller lost its fixed width : the
  Inspector rows (and the Finishing rows, the x / y pairs, a binding's depth), the
  modulator cards (Hz, SUS, LEN, SWG, BAND, the envelope times, HOLD, every slider row),
  the shaping editor, the layer strip, the Mixer faders, the Background, the BPM, the
  Space port. The plain number fields size the same way (`numberBoxCh` + `box-content`) :
  the Output EQ's freq / gain / Q, the Output page's size, HIVE port and lights, the OSC,
  Resolume and Agent ports. Kept fixed : the Space voices' scrub boxes (a table of five
  equal cells, `fixedWidth`). Measured in the test copy (RTX 4070, 1536×890, studio
  theme) : the Inspector's 890 number boxes over all 129 panels 52.9 → 38.3 px on average
  (RATIO 56 → 37.2, THICKNESS 56 → 43.6), names cut 13 → 10, 0 clipped with every box
  stressed at its widest text, panel heights unchanged (the columns are a fixed `w-44`);
  the modulator cards' boxes 48 → 27 to 46 px and their sliders 7 to 22 px longer (the
  Hz row 94 → 102), all 19 types still 160 px; the EQ's freq and Q 64 → 43.6, the BPM
  40 → 30.8, the Mixer 35.6 → 31.6 (the layer strip was already sized in ch : unchanged).
  0 clipped too in the analog (Georgia), nature and cream (the mono readout), graphite,
  paper and pastel themes, under live modulation (the width constant over 30 frames) and
  in the Sonify page's own window.
- **Meta Controller → Macro Controller, everywhere it shows** (Vincent : "Change Meta
  Controller name to Macro Controller (in the app and everywhere)"). Every label, title,
  hint, toast and list entry : the row's title (MACRO), the knob tiles' persistence
  label, the Modulate panel's knob-chip row (MACRO, still fits its `w-8` column), the
  matrix chips (`MACRO K3 (…)`), MIDI Learn's ledger and labels (`MACRO 3 · name`,
  `RANDOMIZE Macro knobs`), the Transport scope (Randomize Macro Knobs), the shared action
  vocabulary (`actions.ts` : MACRO k up / down / random / flip, group Macro, toast "Macro k
  is persistent…"; `triggerCatalog.ts` order), the Body page's verbs and the default OSC
  token of a NEW rule (`RndMacro`, `Macro3Up`; existing rules keep their stored names),
  `Ctrl+K` (group Macro, keywords `macro k`, with `meta` kept as a hidden keyword for old
  habits), the Resolume mapper's row family and picker group, the dataflou section's
  blurb and the mesh labels (`Macro k`, group Macro knobs), the MCP `list_controls` / `osc`
  descriptions, the Performance tab, the cheat-sheet, the Space / Sonify / Mixer / Output /
  Audio Layer modulate hints, the OSC panel's example. OSC : `/opsia/macro/{1..16}` and
  `/opsia/randomize/macro` route exactly like the old `meta` forms (`oscInput.ts` : one
  case for both); OSCQuery and `list_controls` advertise the macro form (description
  `Macro knob k : <name>` when renamed); outbound feedback sends both `/opsia/macro/k`
  and the old `/opsia/meta/k` (a `Leaf.alias`, never advertised), and the Resolume
  mapper's old `osc:/opsia/meta/k` rows still read it. Kept on purpose (no migration, no
  broken session or map) : the store / session fields (`metaKnobs`, `metaXYPads`), the
  ModTarget kind `'meta'`, `META_*` constants, MIDI-learn ids `meta:<i>` / `rand:meta`,
  action ids `act:meta:*`, the Randomize scope id `'meta'`, the dataflou paths
  `meta/1..16` and `randomize/meta`, MCP tool names, `MetaBar.tsx` / `metaSmooth.ts`, and
  code comments (the headers of `MetaBar.tsx` and the types say "formerly Meta"). Docs :
  README (section, anchor `#macro-controller-16-knobs--xy-pads`, OSC table, MIDI,
  Randomize, Resolume, MCP), the site's current sections, the OSC reference (section
  `#macro`; each row notes the old form). Checked in the test copy : `/opsia/meta/1 0.7`
  and `/opsia/macro/1 0.3` (UDP to its own port) both move knob 1; `randomize/macro` and
  `randomize/meta` both re-throw the values, destinations kept; a DOM text scan (text,
  titles, placeholders, options) of the 7 right-column tabs, the 6 pages, MIDI Learn mode
  and the cheat-sheet with the row shown and the Modulate panel open found no "Meta"
  (Metasurface, metadata and the like excepted).
- **The depth menu moved from the top bar to the Performance tab's picture section**
  (`components/DepthMenu.tsx`, `Collapsible.tsx`'s new `trail`, `Inspector.tsx`,
  `searchIndex.ts`). The same select (off / synth / AI, the AI detail group with its ●,
  the same tooltip) heads the **picture** section, beside the depth and relief it fills,
  on the header line but outside its fold button (a `trail` slot : a select inside the
  button folded the section on every click), so it stays shown while the section is
  folded. `depthMode` / `depthRes` are untouched : still the computer's setting
  (localStorage), not the session's, so opening a session leaves it as it is. While depth
  is off, the Inspector of **Parallax**, **Pulfrich** (key on the depth map) and **Luma
  Blur** (control on depth focus; a modulated key or control counts) says what the piece
  does without a map, true to the nodes (Parallax lets the picture through, the other two
  read brightness), with a **turn on AI** button; Parallax and Pulfrich get a one-line
  strip (+23.8 px, only while off), Luma Blur's line joins its control-picker row (the
  panel keeps 193.4 px). **Ctrl+K** `depth` (also `ai`, `parallax`, `pulfrich`, `2.5d`)
  opens the tab, unfolds the section, scrolls to it and flashes the menu; a page or tab
  named exactly what was typed now leads the list (`depth` had it under 8 parameters
  and 6 presets). The picture readout's note and hints, the Performance chip and row,
  Parallax's hint and blurb point at the new place. The top bar lost ~100 px : it now
  holds one line down to the 1024 px minimum window (it used to wrap there). Measured in
  the test copy (RTX 4070), real clicks and keys : off → synth (depth 0.34, relief 0.71) →
  AI (ready, then 0.43 / 0.82 moving with the picture) → 252 and 518 px (the ● and the
  engine follow); turn on AI ready in 3.4 s (6.5 s the first time after a build); AI at
  518 px survived a cold relaunch; console errors 0.

### Fixed

- **The release audit (11-08)** : five reviews of everything since v1.3.1 (control and
  mapping, Sonify, the new sources, the engine, the UI and the release), no S1, every
  finding fixed :
  - **dataflou** : `configure` runs one at a time (two overlapping calls, React's double
    effect in dev or a fast on / off, each started a node and the first was lost, still
    on the mesh). The visualizer's server answers only this machine's own page : its Host
    header and the WebSocket's origin must be `127.0.0.1` / `localhost` on its port
    (another site in the browser could reach the mesh through it), a null byte in the path
    is a 400.
  - **MIDI** : a note's release always reaches the modulator inputs (it was dropped while
    Learn was on, holding the envelope open); **learn** on a modulator input leaves a Learn
    that was already on, on (it turned it off), and its stop clears only its target.
  - **The Synth's velocity row** : the engine read the held `vel` as absolute where the
    play side and Signal send it around 0.5 (as struck), so a fast thing came out 4.7 dB
    down, a slow one 1.8 dB up, the range shrank from 8.7 to 2.2 dB and every note sat
    2.4 dB low with the row at none. It reads `12 * (vel - 0.5)` now (the harness too); a
    Steps re-strike counts its expression from that strike.
  - **Score mode** : a new pass really ends every shape (they were matched again by
    height, so a horizon held one note through every pass).
  - **Signal Picture Play, TIE** : Signal's scale table is a new array only when its notes
    change (a new array reads as a key change, so held grains slid instead of striking
    while any Sonify control moved); held grains glide to their level and pan (~30 ms,
    ramped across the block) instead of stepping 30 times a second.
  - **Sonify** : MIDI Learn on Signal's rate while synced spans what plays (to 16);
    `/opsia/sonify/synth/chorus` takes its names (`off`, `i`, `ii`); the Synth's engine
    loads on its own catch, so a failure there leaves the rest of Sonify running.
  - **Relief** : once the stroke log is full, the oldest stroke leaving it no longer
    rebuilds the page on every stroke (a frame of up to 100K points, which wiped what the
    wanderers drew); a rebuild fuses each stroke at its own logged size; the dome's melt
    reads the material and color at the nearest texel (two brushes touching melted into a
    third).
  - **`pow()` of a negative base** (undefined in GLSL, NaN on some drivers : black) squared
    by hand in the thin-film color, Sand Plate's black steel and the film damage scratches'
    fringe; Glass and Inflate's glass clamp `1 - N.z`.
  - **Inflate** : cavity darkens the glass too (the glass branch replaced the lit surface
    after it).
  - **The Inspector's gray-outs** : Relief's foil, film and flow controls no longer follow
    the brush picked now (they shade every stroke of that material already drawn); rate
    and speed gray out when following the moving things; Sand Plate's surface stays live
    at plate opacity 0 (it sets the sand's grip) and `every` counts a modulated sync as on;
    Fur's scale stays live at whorls 0 (it sizes the flow's bends).
  - **Silhouette** : the source's presets all set the trail color (white where they set
    none : after Matte comet, Key matte's echoes stayed red); the effect's model is retried
    30 s after a failure, and the failed worker let go at once.
  - **The loop's delay** : its programs are rebuilt after a GPU reset (the cache was keyed
    on the context only, which a reset hands back with every program dead); its read-back
    target is 8-bit (the ring is : 130 MB for a 4096 dome layer, not 200); an emptied
    layer lets its ring go; echoes set in beats keep the beat at any global speed.
  - **PANIC clears a layer's persisted frame** (a Loop source reads it back, so it was no
    longer rewritten fresh : a self-loop or a Cross Loop survived PANIC), and the NaN
    guard falls back to black when the source itself is the bad frame (it fell back to
    the same NaN, every frame).
  - A layer pasted from one that loops on itself loops on itself (it read the old layer);
    the Agent refuses `loop N` past the session's layers (it reported success).
  - Copy : "Grayed", "gray" in the tooltips and theme blurbs, no product names in the new
    MIDI, OSC and Room tooltips.
  - **Licenses** : `THIRD_PARTY_NOTICES.md` gains MediaPipe (with
    `resources/mediapipe/LICENSE`, Apache-2.0), Holocloth (MIT, its full notice), d3's
    ISC text and Orb (the idea only); the README's credits, counts (147 themes and Init,
    61 effects, 30 native nodes) and the Glass rows (in the catalogue now) are brought up
    to date; the OSC reference documents `loop N` for a source.

- **Every layer reached the picture a frame late.** A layer's `texture()` returned
  `pp.out()` after persist had already swapped its ping-pong pair, so the blend stack and
  every sidechain read the frame before the newest : 16 ms more latency on everything, the
  camera included (found while building the Loop source; measured : a solid color changed
  between two renders still showed the old one). It now returns `pp.read()`, the frame just
  made (and, before this frame's persist, the last one).

- **A modulator on the Synth's sense did nothing.** The chip was there and its value
  moved, but the player reads the sense off the config, which never saw it : it reaches
  the finder now (things found 0.63 / 2.42 under a square LFO). A MIDI knob on it always
  worked (it writes the config).
- **Signal's pan row is continuous at depth 0** : a row with a source plays at any depth,
  0 the middle, so a modulated depth crosses 0 without a jump to where the thing is (a row
  dragged to exactly 0 used to mean that). Source `none` still means where the thing is.

- **The Sonify Synth, in tune and without its bugs** (Vincent : "Re-look at synth : make
  sure its pitch is right, and re-analyze it thoroughly to make sure it hasn't got any
  bugs"). Measured with the render harness and a reviewer's scripts (every engine from
  MIDI 24 to 96, each macro 0 to 1, at 44.1 and 48 kHz : the fundamental within a cent
  wherever the design has one; bend exactly ±2 semitones, glide on target, unison
  centred, block size bit-identical, no NaN in 1440 extreme renders). Fixed :
  - **the default bend detuned every moving note** : the patchbay's last row was
    direction → bend at 0.2 (× PICTURE 0.8 : a rising thing up to 31 cents sharp, a
    falling one as flat, each voice its own way). The default row is none;
    `normalizeSynth` turns the old default (direction, exactly 0.2) into none, so a
    saved session plays in tune too (a bend you chose stays); the Picture dice rests
    bend three times in four (was half).
  - **FM's half ratios played an octave down** : 0.5, 1.5 and 2.5 put the spectrum's
    lowest common frequency at f/2 (the f/2 line up to 31 dB over f), and the panel's
    harmonics default sits between 2.5 and 3, so size → harmonics flipped notes between
    two octaves. A half ratio's slot runs its carrier and modulator at twice
    (`fmCarrier`, the same sidebands around the note; a slot only changes ratio while
    silent). Growl Bass (ratio 0.5) now plays at its note, not an octave under it.
  - **the harmonics staircase sat between intervals** : its riser took the middle 40 %
    of each step, so the panel's default on ms (0.3) put VCO-2 at +9.5 semitones,
    Noise Lead at +15.5 (a quarter-tone off the octave), dco 0.5 a fifth 14 cents flat.
    The riser is a tenth, just past the middle (`stair` : 0.52 .. 0.62) : 90 % of the
    knob is on an interval, a half way place plays the lower, two thirds the upper (ms
    0.3 → the fifth, Noise Lead → the octave, dco 0.5 → the fifth).
  - **the same note came out up to 13 dB apart (dco, ms)** : DCO-2 / VCO-2 started at
    a random phase while near unison, so it could cancel the note (a saw leaning to its
    octave). They start within a fifth of a cycle of the first one (in phase exactly,
    two narrow pulses stacked their peaks into the filter : aliasing) : notes now
    within ~2.7 dB, each with a little colour of its own.
  - **old notes came back when the Synth was switched on again** : off, the worklet
    released the voices and stopped rendering them 15 ms later, frozen mid-release; the
    next on played those tails (seconds of a pad). `voiceStart(11)` resets the engine
    (`reset()` : every voice silent, the chorus line cleared).
  - **a stuck note when the voice mode changed during a steal** (picking a mono sound
    while a busy picture played) : the mode switch cancels a steal in flight.
  - **leaving unison mid-note made its tail 6 dB louder and mono** : the switch kept
    the ringing voices' unison place (a poly strike resets it).
  - **attack, decay and release were read at the strike only** : turning the release
    while a note held did nothing to it. The times follow the panel every control tick
    (`envTimes`, the picture's env at the strike kept).
  - **unison was louder on modal and FM** (attack +9.2 / +6.3 dB over poly, averaged
    over 24 strikes) : the eight voices started in phase. FM's unison voices start from
    their own phases, modal's mallets fall up to a period apart (3 ms at most) with
    either polarity : +0.5 / -0.1 dB now.
  The harness's legato check compares against a plain pitch move (the unison's beating
  read as an attack). All harness checks pass at 44.1 and 48 kHz; the Synth plays,
  stops and plays again in the test copy.
- **Films keep playing on the output while the control window is minimized or
  hidden** (seen testing the Sonify Synth : the projector, NDI, Spout and recordings
  went on, but a film on them showed a new frame about once a second). The film
  sources upload a frame only when `requestVideoFrameCallback` says one was presented,
  and Chromium calls back only while the page is composited : minimized or hidden,
  about once a second, while the render loop runs on in timer mode
  (`backgroundThrottling: false` was already set everywhere; the films' own clocks ran
  at 1.0, only their uploads stopped). New `engine/frameWatch.ts` : App tells it when
  the loop runs on its timer (`setPainting`), and while callbacks are quiet (that, or a
  callback 400 ms overdue while the film ran on 0.25 s) VideoSource, AssembleSource and
  the Collage's decks upload on the engine's tick once the film has moved about a frame
  (its period learned from the callbacks' `mediaTime`, 1/30 s until one comes), never
  mid-seek. The Collage's own fallback waited 120 ms between uploads (its
  `blitAt` / `blitT` are gone). Measured in the test copy on the RTX 4070 with a
  windowed output, different frames a second on the output, visible then minimized,
  before → after : a 960x540 30 fps film 29.1 / **1.4** → 30.0 / **29.4** (hidden 1.3
  → 29.5), a Collage of six films 52 / **10** → 58 / **30**, an Assemble edit 27 /
  **1.5** → 26 / **29.2** (cuts included), a 4K film 27 minimized; the output at 58-59
  fps and the loop at 60 throughout; a DXV3 and an H.264 take recorded while minimized
  change 145 and 151 times in 150 and 151 frames. Cost : the uploads a visible film
  makes (30 a second for a 30 fps film, 3.2 ms a second of render thread against 3.0
  visible; the whole copy's CPU minimized 126-130 % of a core before, 129-135 % after).
  Uploading on every tick instead took a minimized 4K film's loop to 53 fps. Visible
  playback is unchanged (30 callbacks, 30 uploads a second), reverse (the seek pump)
  moves as it does visible, a paused film holds and takes seeks, the Collage's 9-path
  probe passes. The Web Audio clock held 1.0 minimized on every sink tried ('none',
  the VB-Audio CABLE, the headphones; Sonify and the Synth playing), in the normal and
  the unthrottled test copy : the 0.66x seen on 11-02 did not come back.
- **Sonify's cards kept inside the column at any width** (Vincent : "Some parameters
  get out of the boundaries of the Sonify inspector when resized"). Measured with every
  voice on at 240, 260, 280, 300, 320, 400 and 640 px : at 240 the range rows' ♪ scale
  ran 41 px past the card (Spectra, Flow, Events), Events' blend 9, the reverb's freeze
  4, and sliders were squeezed to 0-39 px (Filter's sweep, Raster's pitch,
  Transmission's lines, the rate rows, the Synth's envelope, PICTURE's amount and its
  ten patchbay depths, the mixer's 26). `Row` takes a `fit` : its controls stay one
  group, beside the label while the row holds that many pixels of them, else on a line
  of their own under it (never squeezed, never past the card). The Synth's envelope
  goes one slider per row when two would not fit (`auto-fit` grid), PICTURE's amount
  takes its own line in the header (`SectionHead`'s new `wrap`), a patchbay row puts its
  depth under its source when narrow, and under 300 px each mixer strip is two lines
  (pill, name and filter tag over its two sliders). The Synth's chip rows (voices,
  pitch, timing, filter) and Space's output switch read in full at 240 now. After :
  nothing past a card, no slider under 40 px, at every width measured.
- **A film keeps playing when the composition size changes** (Vincent : "when changing
  from let's say 1080p to 4K UHD in composition size, a video that is playing (Imported
  video) on a layer gets replaced with another shader-based source (like Drift Field)").
  Two causes, both in the engine rebuild a new size triggers (so the render scale, the
  dome's armed square and a GPU reset did it too). (1) `App.tsx`'s launch safety net
  ("layer 1 empty : drop the first generator in") ran on EVERY engine build and tested
  `sourceA.shaderId`, which is null for a film, a camera, NDI, HIVE and an Assemble edit :
  layer 1's slot A became `GENERATORS[0]`, Drift Field. It now runs once per window, and
  only into a slot that holds nothing (`kind 'none'`, or a generator without a shader).
  (2) Every other layer's film was rebuilt from scratch : a new `<video>`, back to the
  top, transparent while it loaded (audio slots already went on where they were,
  `audioWasAt`). Now the old engine PARKS each film's `VideoSource` (`Compositor.ts`
  `parkVideo`, keyed by layer and slot, given up after 5 s) and the new engine takes it
  back for the same clip : the same element, never reloaded nor sought, its sound
  uninterrupted. After a GPU reset its textures are dead (`VideoSource.gen` ≠
  `glGeneration()`), so a fresh one starts where it was (`VideoSource.load(src,
  startAt)`). Measured in the test copy (RTX 4070), a 60 s film on L1 A (a real desktop
  drop) and on L2 A, real clicks on the Output page's size buttons. Before : 1080p → 4K
  UHD turned L1 into `generator drift-field` (the film was at 4.90 s) and restarted L2 on
  a new element (7.75 → 0.05 s); 4K → 1080p and the dome going on with its 2048² square
  armed, the same. A camera (synthetic device), HIVE and an Assemble edit on L1 A were
  replaced by Drift Field too; Collage was kept (it has a shader id). After : 1080p → 4K
  → 1080p → 1440p → dome 2048² → 1080p, the dome on (square) and off : both films the
  same element, sampled every 50 ms, never without a frame (readyState 4 throughout),
  the playhead running on (4.81 → 8.15 s across the 4K rebuild); the film's texture in
  the new engine complete and live (glError 0, the same mean color); speed 0.5, loop off,
  in / out 0.1-0.9 and fit contain kept; a render scale change, the same element; a
  simulated GPU reset, a fresh element on at 11.21 → 12.63 s (not from the top); camera,
  HIVE, Collage and Assemble on L1 A all kept through a size change. Collage's 9-path
  probe : 6 / 6 decks advancing on every path. Console errors 0 on every run without a
  simulated GPU reset. Two of four simulated resets logged one `[ISF] threw while
  loading` each, naming shaders that were in no layer (`fx-hue-rotate`, `shapes`) : the
  warm-up queue (restarted by every rebuild) compiling in the instant the context is
  gone, a path this change does not touch; left as it is.
- **The Silhouette source's trail works in Matte mode** (`engine/SilhouetteSource.ts`).
  The trail keeps its echoes in the picture's alpha (the body now or the faded past,
  whichever covers more), but the matte is opaque everywhere (white body, black room),
  so the present always won : the trail knob did nothing at all in Matte (the same
  picture, to the bit, at trail 0, 0.35, 0.6 and 1). With a trail on, the matte now
  keeps its echoes as a white shadow does and the copy out draws them back as grey on
  opaque black : echoes fading from white to black behind the body, at the same speed
  and over the same range as the other modes, a key that lingers. Trail 0 and the other
  three modes are unchanged to the bit (master's shader and the new one side by side in
  one build : 0 bytes differ for cutout, shadow, a translucent shadow and hole at every
  trail). Measured without a camera in the test copy (RTX 4070, 63 fps) : a synthetic
  disc mask crossing the frame in 1.5 s; behind it the matte read 0 at every trail
  before, now 0.39 / 0.68 / 0.86 at trail 0.35 / 0.6 / 1, the same as a white shadow
  (on the output canvas, 0 → 0.68 at 0.6 and 0 → 0.86 at 1).
- **Marbling keeps its water fluid on the dome and at 4K** (`engine/marbleModel.ts`,
  `workers/marbleWorker.ts`). Measured first in the test copy under the Satosphère setup
  (4096² master, 210° fill, 2048² composition, Marbling alone, auto 2 drops a second),
  the window's renderer held on the efficiency cores (where a background window's worker
  lands, about half as fast) : evolve 1 with comb and swirl at full moved the water 40
  times a second for 20 s, then 3 times a second (each tick 320 ms) for good; the fulldome
  gate's heaviest settings (every input at its top) moved it 5.3 times a second flat and 2
  on the dome. Two causes. A frame 2048 px tall samples its outlines as 4K does, about
  twice the points of 1080p (58K at evolve 0.3, 46-81K at evolve 1). And the currents cut
  a long frame into whole sub-steps, rounded up : a worker that slipped under ~44 updates
  a second at evolve 1 took two passes a frame (80 a second, not 60), slipped further and
  sank to the 0.25 s frame. Now :
  - The worker times its own ticks and, half a second over 10 ms, samples the flat runs of
    the outlines a notch coarser (four levels, from the picture's own spacing to 1080p's,
    never past it; far behind, straight to the coarsest), back a notch after 3 s with room
    for its points, never while the log pours back. Past the picture's own spacing an edge
    must stay within 0.25 px of its curve, so small drops, curls and comb tips keep their
    sampling. Going coarser merges the flat runs at once (every dropped point within
    0.125 px) and the budget follows the water's measured mean edge, so the same drops
    stay. Level 0 is the sampling it always was, to the bit (the headless tests run
    master's model beside it).
  - Still behind at the coarsest (or at 1080p, which has nothing coarser), the water keeps
    less paint : the budget trimmed 15 % at a time down to half (far behind, straight to
    half), eased in over 0.75 s, given back first when there is room. Only the heaviest
    settings on a slow core reach it; the defaults never do.
  - The part of a sub-step left over carries to the next frame : the passes a second never
    rise as frames slow, and outlines cross no more often (measured from 60 down to 15
    frames a second, and at comb spacing 0.03).
  - Past 1.1 × its budget the water dissolves drops faster (up to 4 ×, 0.4 s; at evolve
    0.3 a dissolve keeps its 1.5 s) : a few big combed drops fading together held the total
    at 1.5 × the budget; now 1.33 × at worst and the budget on average, with more live
    paint than before (16.6 live drops against 15.2 at 1080p, evolve 1 + comb + swirl).
  - The governor keeps its pace in seconds (a worker far behind ticks a few times a second,
    and counted in ticks a notch took most of a minute).
  After, same window, efficiency cores : the dome at evolve 0.3 updates 60 times a second
  (the coarsest level, 28-31K points, ~100 drops), at evolve 1 + comb + swirl 60 a second
  (26-29K, was 3); left to the scheduler (a fast core) the dome stays at level 0 at both,
  60 a second (57-60K and 53-69K points). 1080p (efficiency cores) : evolve 0.3 unchanged
  (level 0, the same points); evolve 1 + comb + swirl 60 a second at 27-38K points for its
  30K budget (was 49-54 at 16-44K). Render 0.2-0.4 ms, 60 fps, no errors. The fulldome
  gate : `PASS src:gen-marble flat 60 fps 59.7/s | dome 60 fps p95 17.3 60/s | heaviest
  flat 60 fps 59.7/s dome 60 fps 59.7/s`. Stills of the 4096 master at the same tick
  (exact 1/60 s ticks, seeded) : level 0 pixel-identical to before; the coarsest differs
  on 0.2-0.4 % of the pixels, along edges, and small drops and comb tips look the same at
  full size. Save, New, load : still pixel-identical at 1080p and on the dome; a picture
  made at the coarsest loads back at level 0 with the same drops (0.07 % of bytes differ,
  at edges). The worker's frame carries its `level`; `{ t: 'level', level }` pins it
  (stills and tests only). 7,487 headless assertions.

### Docs

- **The documentation catches up with v1.3.1** : the README's Architecture names the
  new pieces (the page windows, the action vocabulary, the preview's clicks, Marbling
  and its worker, the steps model, the hand shapes, depth AI's worker, my chains, a
  session as scenes, the `// @blob` outlines), the master chains sit in seven groups
  with Marbled paper, Painted lists Marbling, Living Surfaces names Marbled Paper and
  Night Bath; the site links the 1.3.1 notes, builds from source with
  `npm run fetch:depth`, and its Body, Sequencer, Sonify and MIDI text and three new
  questions (painting on the picture, keeping a chain, a set from your sessions) cover
  the release; the cheat-sheet adds right-click Load, a steps card's gestures and Pinch =
  click, and says every page window plays the instrument; the bibliography adds the
  marbling paper Marbling is built on.

- **Marbling in the gallery** : a row of three frames on the README and the site, made
  by Generate alone (Marbled Paper twice, Night Bath once) : `shot-marbling.jpg`,
  `shot-marbled-paper.jpg`, `shot-night-bath.jpg` (1280x720).

- **The OSC reference matches the site and takes about half the room** : the site's
  dark look, nav and headings (the beige light scheme is gone), and each address is one
  compact row, the address wrapping at its ` · ` and `/` with its arguments as chips
  beside it and the description beside it on a wide screen or under it on a narrow one,
  so nothing scrolls sideways at any width. An index of the 15 sections and a filter box
  sit at the top (`/` focuses it, Esc clears it). 8,421 px tall at 1280 px wide instead of
  15,921, Sonify's rows about half as tall; every address, argument and description is
  word for word the same.
  Then (Vincent) its title and description say **Palinopsia**, with a sentence on **Opsia**
  being the short name (and why every address starts with `/opsia`), and its 26 em dashes
  became colons, commas or parentheses; the site and the README have none.

## v1.3.1 — 2026-10-29

### Fixed

- **The euclid card no longer scrolls under a BPM division** (`ModulationPanel.tsx`) :
  its four rows under the division select overflowed the fixed card by 1 px (76 > 75,
  measured in all 8 slots, zoom 1 and 1.25). They sit at the ADSR card's tighter
  spacing now.

- **Depth AI works, offline : the depth model ships inside the app**
  (`engine/depthEstimate.ts`, `workers/depthWorker.ts`, `main/assets.ts`,
  `scripts/fetch-depth.mjs`). It imported Transformers.js from a CDN and the model from
  the Hugging Face hub at first use, and the page's own security policy refuses those
  downloads (`connect-src` allows only the app's files, `opsia-asset:`, blobs and data :
  measured, a fetch to huggingface.co raises a violation), so it could never load. Now
  Transformers.js 3.0.2, the onnxruntime-web WebAssembly runtime it pins
  (1.21.0-dev.20241024-d9ca84ef96) and Depth Anything V2 Small (fp16 for WebGPU, 8-bit
  for the WebAssembly fallback) are fetched at build time by `npm run fetch:depth`
  (pinned, SHA-256 checked, from cdn.jsdelivr.net and huggingface.co only, a manifest
  written last), shipped in `resources/depth` (95 MB installed, about 66 MB more in the
  installer, never in git) and served over `opsia-asset://depth/`. Remote models are off
  and every path the library can build points inside the app (the worker refuses to
  start otherwise). The model runs on a worker thread : creating its session and the
  WebAssembly fallback are synchronous, seconds of a frozen picture on the render
  thread. The frame it reads keeps the picture's shape (it was squashed to a square) at
  the size the depth menu's new **AI detail** picks (252 / 392 / 518 px on the long
  side, 392 by default; the processor reads at 252 whatever the menu says), and the map
  no longer pumps : each answer was stretched to its own min..max (twice); the map
  follows the model's range over 1.5 s, then the compositor's EMA as before. Depth off
  ends the thread and frees its graphics memory; a running engine that stops (a graphics
  reset) starts again by itself. Measured in the test copy on the RTX 4070 at 1920×1080
  : 60.0 fps off, 60.0 to 60.1 on at 252 / 392 / 518 px, 19 / 24 / 33 ms a map on WebGPU
  (median), 10 maps a second, 0.05 to 0.09 ms a frame on the render thread, loaded in
  0.98 s (2.3 s the first time); the WebAssembly fallback 0.31 s a map, still 60 fps;
  every depth request went to `opsia-asset://depth/` with http and https blocked. fp16
  stays on WebGPU : q4f16 ran 4x slower and misread a floor (r 0.37 against fp16), 8-bit
  fell back to the processor there (0.87 s); 8-bit on the processor matches fp16 (r
  0.9975 to 0.9997) and runs 1.5x faster than fp16 there. A copy without the files says
  "run npm run fetch:depth"; CI fetches them (cached) before building on all three
  platforms.
- **A right-click menu opens right against its button** (`ContextMenu.tsx`). Menus were
  placed from an estimate of their height (28 px a row plus 40) and from the cursor, so
  the Output button's menu, near the bottom of the window, opened well above the button
  (36 px at 100 %, 45 px at 125 % in a test window; more with Close Output in the list)
  and wherever on it the click was. A menu now measures itself before it shows
  (`placeMenu`) : one with an `anchor` (the Output, Body, Seq and Sonify buttons) opens
  4 px over or under its button, lined up with it, and a menu at the cursor opens under
  it, or above it with its bottom at the cursor when there is no room under it (from
  its right edge when there is none to the right), always inside its window, at any UI
  zoom.
- **The layer's A and B letters sit in the middle of their buttons** (also the
  background's BG and the Audio Layer's A and B). The toolbar look's `px-2.5` comes later
  in the stylesheet than the button's own `px-0`, so it won : 10 px each side in a 24 px
  button left the letter 2 px of room, and it sat 2 to 2.6 px right of center (now within 0.25 px).
  `!px-0` now; the buttons keep their size.
- **A small dropdown in the Inspector is as wide as its longest choice** (`CompactCluster`
  in `AutoControls.tsx`). Its fixed 48 px cut Luma Blur's and Toile's "smooth", Faultline's
  and Decimate's "free (rate)", Gooey's "brightest channel", Matte's and Corrode's
  "transparent". Measured over all 128 source, node and effect panels in a test copy : no
  dropdown is cut anywhere now, and no other column moved.
- **The Sequencer's resize edges stay under the hand at any UI zoom**
  (`SequencePage.tsx`) : the inspector column's edge and the live monitor's top edge took
  the pointer's screen pixels as page pixels, so at 125 % they ran a quarter ahead of the
  pointer. They now divide by the zoom, in the app and in the Sequencer's own window.
- **The Assemblage source's Inspector has the film transport's margins**
  (`AssembleTransport.tsx`) : its edit, transport, timeline, speed and MOD rows ran from
  edge to edge of the panel, on its border; they now sit inside it, under a rule, like a
  film's and the Framing below.

- **The Master FX chain menu names the chain that plays** (`MasterRackStrip` derives it
  from the loaded effects : the chain picked by hand or by an action while it is still
  loaded, else any chain with the same effects, else the placeholder), so a chain changed
  by a rule, a MIDI pad, a scene, a Generate or the dice no longer leaves a stale name.

### Added

- **My chains : the Master FX chain saved as a preset** (Vincent : "Right-click on the
  Master FX Chain : Save the chain as a new preset (you have to give it a name)").
  Right-click the Master FX strip (its empty space; an effect chip's menu ends with the
  same entry) → **Save chain as preset…** → a name (required, trimmed; a name you already
  have asks to replace it, or goes back to the prompt). Saved : the chain's effects in
  order (shaderId, every input, `enabled`, `opacity`), a node's layer read as
  `MasterPreset.reads` / `reads2` ('bottom' | 'top' | 'second' among the playing layers,
  `layerAsPick`; an image read, or the third of four playing layers, has no such name and
  is dropped, the toast names the effect), and the Vibe and Context inputs as `vibe` /
  `context`. Not saved : the Context's drawn light path, the Finalizer. `userChains.ts` :
  localStorage `opsia.userChains`, a sanitizer on read (malformed rows, values and picks
  left out, opacity clamped, a repeated name dropped, broken JSON = no chains, never a
  crash); `allChains()` (yours first) feeds the strip's menu (a **my chains** group
  first), Ctrl+K and the `act:chain:next / prev / rand` actions (the last chain an action
  applied is now kept by its key, so saving or deleting one of yours does not shift it);
  `chainPlaying()` is the strip's naming rule from 752ed49 with an exact pass first (every
  value a chain sets, on / off and dry / wet), so a chain of yours saved from a built-in
  one keeps its own name. Applied through `applyMasterPreset` (one undo step, the
  Persistent gate), which now also takes an effect's `enabled` / `opacity` (absent : on,
  fully wet, so the built-in chains apply as before); `playingLayers` / `pickLayer` moved
  to masterPresets.ts (the same rule). **Rename my chain ▸** (a name another chain has is
  refused) and **Delete my chain ▸** (asks first) in `components/MyChains.tsx`. Checked
  in the test copy with real mouse events : a chain of Matte (reading bottom + top), Remap
  (second), Grade off and Grain 60 % wet with a set Vibe and Context, saved, then New and
  picked from the menu : 0 differences over 4 effects, 21 inputs, 12 Vibe and 10 Context
  values and the three layer reads; undo = one step back; replace, rename, delete,
  Ctrl+K, chain next / previous cycling through your chains (and named), a Persistent
  effect kept; 10 malformed stored rows → 2 clean chains; console errors 0.

- **Add a session as scenes** (Vincent : "Load whole sessions as new scenes in the
  current session. If the previously saved session that is loaded already contains
  scenes, make a popup appear so the user can Yes or No choose to input these scenes in
  the current session, clearly re-labeled"). **Open ▾ → Add a session as scenes…** (the
  session open dialog) and right-click **Load** → **Add “X” as scenes** (the session
  picked in the list). The session on screen stays : the file's own composition becomes
  ONE scene named after the file; a file with scenes asks **“X” has N scenes. Add them
  too?** (`AskModal`, PromptModal.tsx : Yes focused, Enter = Yes, Esc = No, both keys
  stopped in the capture phase so Esc never also closes a page under it) and Yes appends
  them in order as `X_Scene1`, `X_Scene2`… `sessionScenes.ts` : every composition goes
  through `normalizeComposition` + `adoptLegacyWorldMod` like a load (one try per
  picture; a scene with no picture is counted in the toast, "(1 could not be read)");
  the file's own shaders through `adoptSessionShaders` (moved out of `loadSession`
  unchanged, limited to the ids the added pictures play : a differing copy of yours
  enters as "<name> (session)"); names never collide (" 2"); `SceneEntry.from` keeps
  where a scene came from for its chip's tooltip ("“Intro” in Alpha"); one undo step
  (`commitNow` around a single `setState`); `sessionMedia.check()` after, so the banner
  names a missing film of an added scene. Session-level settings never apply (Audio
  Layer, pins, Feel, dome, output transform, warp, speed / morph dials, Sonify,
  sequencer, Surface places); a scene keeps its own World, tags and sound patch. A file
  that is not a session, or holds no picture, says so in a toast and changes nothing.
  The toast says what came in : "Added 1 + 3 scenes from Alpha". Verified in the test
  copy through the real menus and keys : 43 checks (Yes / Enter, No / Esc, no question
  for a session without scenes, collisions, one undo, Save asks after, save and reopen,
  an older file, a broken file, a session shader, the media banner), page errors 0.

- **Marbling, a new source, and clicking the preview** (Vincent, from stills of a water
  marbling drawing app : "could we make a version of it as a new source inside
  Palinopsia ? ... Maybe this could give the way to Palinopsia supporting the mouseclick
  on the visual preview screen as an input"). `gen-marble` (native, Painterly section) :
  drops of paint on water as outlines, flat colors, crisp edges. The model
  (`engine/marbleModel.ts`, pure) applies the closed forms of mathematical marbling
  (Lu, Jaffer et al., 2012) to every point : the drop push `c + (p - c)·sqrt(1 + r²/|p - c|²)`
  (spreading in steps that add up exactly to the one-shot drop), tine lines (a `sech`
  falloff instead of the paper's `exp`, so a combed tip rounds off within a pixel and its
  two sides never cross), vortices, and the currents as plane-wave shears (each keeps
  every area exactly). Outlines are resampled (Catmull-Rom splits past ~8.6 px at 4K and
  at 1080p alike, merges under 1.2 px at 1080p, finer at sharp turns : see Changed). Spreading, pouring, dissolving and every
  hand-made event run on a fixed 60 Hz step, so a logged gesture replays to the same
  points. The water runs in a worker (`workers/marbleWorker.ts` : at 90K points the
  currents, spreading and resample cost ~5 ms a frame) which also lays out the draw : a
  stencil fan per outline and a depth-tested cover of its box, drops whose boxes are
  apart sharing one draw (a few dozen draws for 500 drops), into a 4x MSAA buffer shared
  by every Marbling slot, resolved and reused while nothing moves (`engine/MarbleSource.ts`).
  Inputs : evolve (default 0.3), currents, swirl, comb (+ spacing, angle), auto drops
  (+ sync to the beat), audio (onsets), drop size, size spread, crowding (the more paint,
  the smaller each new drop), spread time, points budget (past it the most stretched of
  the older drops dissolve), six colors + water (alpha : the layers below through),
  colors, order, click tool, sprinkle count, drop / sprinkle / clear triggers. Twelve
  presets, a **Marbled paper** chain group (Endpaper, Inked Edges, Rippled Bath, Riso
  Print), two Living Surfaces themes (Marbled Paper, Night Bath; a theme can now name
  which of a source's presets it draws from : `presets` in `themes.ts`). Measured on the
  RTX 4070 : 60 fps at 1080p and at 4K with ~480 drops and ~95K points evolving and
  spreading (vsync, p95 frame 16.8 ms); uncapped 158 to 203 fps; the source's own main
  thread cost 0.1 to 0.3 ms a frame. An hour of show at the defaults stays near 60K
  points. Headless tests : 5,734 assertions (drops stay disjoint, incremental = one-shot
  to 1e-9, comb and swirl keep every outline simple and counter-clockwise, edges within
  bounds over 1,000 random operations, the log replays to the identical points, a
  malformed log sanitizes).
  **Clicking the preview** (`pointerInput.ts`, `engine/pointerMap.ts`) : the preview canvas
  (and the big preview) is an input for a source that takes it (`pointer?` on a native
  generator) : the Inspector's selected slot first, else the topmost visible layer, the
  Background last; crosshair cursor and a hint in the preview's corner; the click mapped
  through the canvas box (CSS zoom safe), the keystone, the output transform and the
  dome's own lookup (every dome mode). A mouse gesture is one undo step and joins the
  slot's `handOps` log (sessions and scenes reopen the same picture : save, New, load
  measured pixel-identical; capped at 2,000 gestures); `clear ▸` empties it. OSC
  `/opsia/layer{n}/source/{A|B}/drop x y [size]` and `/opsia/bg/source/drop`; the drop /
  sprinkle / clear triggers are Body and MIDI actions.
  **Pinch = click** (Body page, TRACK row, off by default) : each hand's pinch is a pointer
  through the same routing (two hands at once), at the smoothed point between thumb and
  index tips, camera frame laid straight on the picture (mirrored with Mirror), the rules'
  pinch threshold with the hand shapes' hysteresis and release time (`PinchPointer` in
  `engine/handShape.ts`); rings on the preview (and the Body camera preview) show where
  each hand points. Body gestures are live, never logged. Tested with synthetic hands
  through the tracker's own `process()` (no camera) : pour, trail, two hands at once,
  Mirror on and off.

- **`steps` : a step-sequencer modulator with conditional steps and swing** (Vincent :
  "A step-sequencer modulator with conditional steps (probability, 2:4, fill, first) and
  swing"). The 19th modulator type, in the rhythms family beside arp, euclid, turing and
  cellular. Up to 16 steps (`StepsConfig` in `shared/types.ts` : `length` 1..16 and
  16-long `values` 0..1, `on`, `cond`, plus `swing` 50..75, `glide` 0..1, `rest` hold /
  zero), played one per clock tick on the shared clock row (free Hz or a BPM division).
  One condition per step, a plain string (`engine/stepSeq.ts` parses, checks and words
  them) : `always`, `p<percent>` (the menu offers 10 / 25 / 50 / 75 / 90 : quick to pick
  live, each a different feel; a session may carry any 1..99), `<a>:<b>` (pass a of every
  b, b 2..8, from the start of the run), `fill` / `!fill`, `first` / `!first`. A rest or
  a false condition holds the output (or sends it to 0 with `rest: 'zero'`); `glide`
  slides over that share of the step's own length (a half cosine). Swing makes every even
  step (2, 4, 6...) late by (swing − 50) % × 2 of a step, at most half a step, so a step
  never overtakes the next; a swung step a late frame skipped over still plays, before
  the next. On a BPM division with Ableton Link enabled the step index IS the shared
  count (floor(beats / step) mod length : the right step again after a phase jump, the
  time inside a step Link's phase; step 1 on the bar only when the length fits the bar,
  16 / 8 / 4 at 1/16, while 5, 6, 7 or 12 run across it); a Hz card ignores Link. Free,
  it keeps the wall clock like the other rhythm types, and a hitch (a long frame) moves it
  by whole steps, the skipped ones silent and counted, so the pattern stays on its beat.
  A run (pass 1, for first and A:B) starts when the card is turned on, retriggered, a
  session loads (`onSessionLoaded` in App : `restartRuns(pinned)` and FILL let go, but a
  Persistent `mod:<n>` card carries on, its FILL too; a morph's ghosts are never
  restarted) and on Ableton Link's play : `tickPlay` arms `restartRunsAt(bar)` on a real
  play (not on joining a session already playing, nor when start / stop sync is switched
  on mid-play) and each BPM-synced steps card starts its run when the beat IT reads (the
  picture's lead, latency -200..+400 ms) reaches the bar, before that step plays; Hz
  cards carry on. A run that joins Link's count mid-pattern counts its run-in as pass 0
  (first and A:B wait, not first plays) and never plays twice the step the old run already
  played there. A scene recall, the scene sequencer or the dice that replace a card's
  pattern (`samePattern` : length, values, rests, conditions) call `newPasses` : pass 1 at
  its next step 1, the clock untouched; the same pattern keeps the run. A card turned back
  on lands on its first step (no slide from the level it had). A length cut under the
  playhead plays nothing past the end and goes on from step 1 at the next tick on the free
  clock (with Link, the step the shared count says). FILL is engine state, never saved
  (`setFillHeld` / `setFillLatch`, ghosts read their card's), let go when the window loses
  the focus, when its button goes away and when the card stops being steps;
  `act:mod:<n>:fill` toggles it for Body rules and MIDI pads (offered for steps cards; on
  another type it reads "(gone)" and does nothing; triggers fire on the press only, so a
  toggle, no hold). Modulators have no OSC addresses
  beyond `/opsia/randomize/modulators`, so none was added. The card keeps the fixed
  silhouette : the clock row with **FILL** riding the rate line (held = momentary,
  Shift-click = kept on, solid while kept), a 16-step strip (bars drawn by dragging, a
  click = rest / play past a 3 px dead zone, pointers mapped through the boxes so any UI
  zoom works, a stroke written live but silently and closed as ONE undo step however long
  it pauses and however it ends : the button up, the capture lost, a move with no button
  down, the window's blur, the card going away; rests drawn as outlines, a playing step at
  0 as a 1 px baseline, the steps past the length dimmed, the playing step
  framed by one rAF writing a data attribute; a 2 px mark under each conditioned step),
  then `LEN` + `SWG` on one row and `GLIDE` under it. Right-click a step : a menu through
  the shared `ContextMenu` (which gains `keepOpen` items and a `body` slot for the
  sub-lists : the chances, and the A:B grid of 35 choices; a right-click inside it stays
  there, it used to reach the card's Persistent menu through the portal). Sessions check
  the block whole (`sanitizeSteps` in `normalizeComposition` : 16-long arrays, finite
  numbers only, known conditions, `p0` read as 1 % and `p100` as always, ranges); an
  older session without it, or a broken one, loads the defaults (length 8,
  a staircase up then down). The dice (`TYPE_POOL`, `randomSteps` : a short motif on five
  levels repeated with changes, the downbeats leaning high, about one step in seven a rest
  and one in six with a condition, 70 % straight, else 55..62 % swing) and the stepped
  Generate families draw it (a theme's steps on a BPM division : 1/8 or slower, or a glide
  of 0.2..0.5, never a hard 8 Hz flicker; the plain dice may keep 1/16). Verified : 188 headless assertions on the engine (order and
  timing at Hz and BPM divisions, A:B 1:2 / 2:4 / 3:3 / 2:2 / 1:8 over 40 passes, chances
  within 2 % over 10,000 passes, fill / not fill switching mid-run, first / not first and
  every run start, hold vs zero, glide 0 vs 0.5 / 1 with a late frame, swing 50 / 62 / 75
  at 1 ms and on uneven frames up to 170 ms with no step lost or overtaken, length changes
  mid-run, Link after a phase jump and back to free time, sessions, the dice, a morph's
  ghost); in the test copy on the RTX (real mouse events) 44 + 24 + 6 checks : a stroke with
  a 600 ms pause undone in one step, rests, every menu entry and both sub-lists, FILL held
  and kept, retrigger, the playhead in all 8 slots, the menu at the cursor at UI zoom
  1.25, a binding to L1's opacity stepping on a white layer (the picture's mean luma 16 at
  the 0.1 step, 142 at the 1.0 step), every swung step on the first frame at or after its
  due time at 120 BPM, save → New → load exact, broken and older blocks, a pinned card
  through five dice, Generate drawing it 10 times in 18 Glitch scenes, FILL fired from a
  Body rule; the per-type sweep (19 types × Hz / BPM × 8 slots, UI zoom 1 and 1.25) : every
  card 160 px, nothing overflows; console errors 0. Not verified live : Ableton Link (the
  worktree test copy has no Link addon; the engine tests cover it). After an independent
  review (no high-severity defect), a second commit fixed the Link play restart against
  the latency lead, runs across scene recalls, the stroke and FILL across a focus loss,
  the run-in pass, ghosts and pinned cards on a load, the free clock's hitch, the fill
  action on another type and Generate's 1/16 flicker : 235 headless assertions (the
  restart at latency -100 / 0 / +150 ms and a play seen late, the run-in, a replaced
  pattern, a ghost, a pinned card, an hour-long hitch, a cold start, the sanitizer).

- **Organic shapes for Lattice, Ash and Particle Drift** (Vincent : "I don't want to
  only have pills-looking dots, I want them more organic"). Each of the three sources
  has a new **irregular** control (0 = the round dots and capsules exactly as before,
  bit for bit : old sessions and presets do not change) and an **evolve** control.
  Raising irregular turns every point into an outline of its own, dealt from its own
  random numbers so no two are alike and each keeps its shape : first a soft wobble and
  stretch (up to about 0.45), then one of four kinds, sometimes crossed : ink drops
  (low harmonics, egg-ish), petals (3 to 7 rounded lobes pinched between, seeds and
  pollen), torn paper (a rough polygon with a ragged, fbm-like edge) and shards (long
  thin slivers), each turned its own way. Evolve morphs the outlines and tumbles them
  slowly (0 = frozen). One shared outline function (`shaders/isf/lib/blob.glsl`, the
  `// @blob` include, the same text in the ISF shaders and the native Lattice) keeps the
  edges anti-aliased over one pixel (distance corrected for the outline's slope and
  stretch), keeps each shape at about a round dot's mass (measured : Ash 7.1 → 7.2 mean
  level at irregular 1, trail-less Particle Drift 11.1 → 10.9), and fades lobes and
  ragged edges out on points too small to show them (no shimmer). Ash keeps its soft
  flecks (the falloff follows the outline); in Particle Drift the head takes the shape
  and the trail behind it becomes a wisp of the shape's width thinning toward its tail
  (a comet, a smear of ink : a trailed field reads about a fifth lighter at 1); Lattice
  draws it on every form (plane, volume, tunnel, sphere, torus, galaxy), held still on
  the screen while a point streaks (a streak sweeps the whole outline, as a long
  exposure would), its quads grown by the outline's reach and the shape skipped past it.
  0 is checked bit for bit against the old code (56 frames on the RTX : Ash and
  Particle Drift at several presets, 16:9 and square, 5 s and 30 min of show time, and
  all 20 Lattice presets : 0 differing bytes). Writing the new path's offset apart from
  the old distance was needed : shared, the D3D compiler re-rounded the round dots by
  one level in a few pixels. Evolve's phase is an
  integrated `PH_evolve` wrapped at 32 pi, every rate a whole number of turns per wrap.
  Cost on the RTX 4070 at 1920x1080 (the whole app, vsync off, irregular 0 → 1) : Ash
  155 → 153 fps, Particle Drift 158 → 146 (with trails), Lattice 195 → 161 on a plane of
  big dots (the worst case : its quads hold the outline's reach, the shape is skipped
  past it) and 190 → 170 on a galaxy; with vsync every case holds 60 fps, at 4K too.
  Nine new presets (Lattice : Seed floor, Pollen globe, Spore galaxy; Particle Drift :
  Pollen, Ink in water, Paper scraps; Ash : Torn confetti, Ink drops, Seed fall; 1593 →
  1602 presets), every
  older preset of the three (and the two Background presets) sets irregular 0. The dice
  draw it low (0 to 0.35 / 0.4); the Orbit theme now and then builds its figure of
  organic points, the Murmuration theme lets its drift and ash turn organic, Crystal Room
  stays a perfect lattice. Hints, keywords, blurbs, and evolve greys out while irregular
  is 0.
- **Hand shapes** (`engine/handShape.ts` : pure geometry on MediaPipe's 21 hand points,
  no new model). 24 new body features, per hand : a **curl** per finger (from joint angles
  measured on long chords, so the landmarks' jitter does not read as curling), the
  thumb's **pinch** to each fingertip (in the hand's own palms, 1 touching), the
  **angle** (roll as you see it, 0.5 upright, stops at a quarter turn each way), the
  **facing** (palm toward / away, from the palm's normal and the hand's chirality) and
  the **span** (apparent size on a log scale, a stand-in for distance). Measured in a
  square space (x and depth × the camera's aspect), on the points lightly smoothed first
  (a time constant of 70 ms that shortens as the hand moves). They stream as
  `/opsia/body/<feature>`, list in OSCQuery and the agent's `list_controls` while the
  camera runs, feed body modulators (whose menu is now grouped by body region) and the
  Resolume mapper (their own "Body · hand shape" group), and show in the monitor's new
  **HAND SHAPE** group. 20 new gestures : **fist, open, point, peace, thumb up, thumb
  down, ok, horns, call, gun**, each L and R, recognised from the curl vector with enter
  and exit thresholds, a settle (an eighth of the hold time) and a short release, so a
  held shape fires once; the global and per-gesture sensitivity widen or narrow the
  thresholds. The camera preview names the shape each hand holds. Tested on synthetic
  hands (10 shapes plus half-curled hands, at many rolls, yaws, pitches, palm or back,
  four sizes, four aspect ratios, a mirroring camera or not, Mirror on and off, a ±20 %
  depth-scale error, jitter at 2 % of a palm) : 98.7 % recognised, no shape ever taken
  for another, a half-curled hand never firing; a shape held 4 s fires once (400 of
  400). Not yet with a real camera.
- **Body, the Sequencer and Sonify in a window of their own**, like the Output page
  (`PageWindow.tsx`, which `OutputPageWindow.tsx` became, now serving the four pages; main
  allows the four window names in `PAGE_WINDOW_TITLES` and raises one with
  `pageWindow:focus`). Right-click the Body, Seq or Sonify button : **Body…** / **Body in a
  window**, **Sequencer…** / **Sequencer in a window**, **Sonify…** / **Sonify in a
  window**. The same rules as the Output page's window : never remembered
  (`bodyPageWindow` / `sequencePageWindow` / `sonifyPageWindow` reset when the page
  closes), its title says what it is, closing it closes the page, **⇲** puts it back in
  the app, `B` / `Q` / `S` bring it forward instead of closing it, `Esc` there stays
  there, the other keys play the instrument. What the two pages draw and listen to now uses the
  window they are in (`ownerWindow`) : the camera preview and its skeleton, Sonify's
  mirror overlay, meters, key-sequencer bar and Space map (its pixel ratio too), the
  Sonify `M` key, the Space boxes' typing check, the trigger pickers (`SearchSelect`) and
  their outside click. Sonify in its window keeps drawing while World, Sequence or
  Resolume is open over the instrument (`sonifyCovered(el)`), and Body or the Sequencer
  in its window no longer counts as covering Sonify, the EQ editor or World's keys.

- **Every source and effect has at least ten presets** (`shaders/isf/presets.ts`) :
  Silhouette gets its first ten (cutout, matte, shadow and hole, with and without
  echoes : its own look only, a preset never turns the camera on), and Shatter, Crawl,
  Store Zoom, Cloud Study and 14 older pieces are filled up to ten (Grown, Veins, Slime
  Mold, Fluid, Audio, Metamorph, Differential, Aperture, the Finalizer, Remap, Luma
  Blur, Gooey, Matte, Lookup). The older Slime Mold, Veins and Fluid presets now set
  every input (zoom, ground, rate, glow, light angle), so one picked after another no
  longer keeps the last one's zoom or ground. 1542 → 1593 presets, every value checked
  against its input's range and the new ones rendered in a test copy.

- **A body plays the whole instrument.** What a Body rule fires grew from the dice, the
  transport, scenes and Sonify to some 250 (about 190 of them new), picked from the app's
  searchable list ("nothing" first) : each layer's mute, solo, FX on/off, feedback,
  freeze / run, next / previous / random source (the side you see, the dice's pool),
  A↔B over the Morph time, next blend, vary and punch (opacity up and back, no undo step);
  every trigger of the effects and sources loaded now ("L2 FX · Field Store · grab",
  found by itself); next / previous / random master chain and finishing on/off; a random
  scene; next / previous / random World or one by name; Generate a random theme, the next
  in its family or one of a family; each Meta knob up / down / random / flip; each
  modulator's retrigger and on/off; each Feel dial up / down and a reset; BPM ×2 / ÷2,
  Ableton Link play / stop, the key (a change now, a fifth or a semitone up or down), the
  Audio Layer's play / stop / mute; a screenshot, and the output turned, spinning,
  flipped or reset. Every action writes through the store (undo, the morph, Flash safety),
  leaves what is persistent alone and says so, never opens a camera, a microphone, a file
  dialog or a network source, and a rule whose target is gone says "(gone)" and does
  nothing. The same vocabulary (`actions.ts`, listed by `triggerCatalog.ts`) reaches MIDI :
  the MIDI section's new **learn** list binds a pad to any of them.

### Changed

- **Marbling's comb and swirl use far less of the computer** (`engine/marbleModel.ts`,
  `workers/marbleWorker.ts`, `engine/MarbleSource.ts`). Measured first (RTX 4070 laptop,
  Marbling alone, the worker timed inside itself over CDP) : every cost follows the point
  count, and the budget let it run away. The currents marked every drop for resampling
  every frame (a full pass, three square roots an edge, often to change nothing); evolve 1
  with comb and swirl climbed to 142-191K points for a 60K budget (dissolving drops kept
  growing) and the worker, at 54 ms a tick, moved the water 6 times a second; a tick
  slower than 300 ms got resent and piled up behind itself. Now : outlines are sampled no
  finer than the picture shows (the longest edge ~8.6 px at 4K and at 1080p alike, so
  1080p carries about half the points; 4K and the dome unchanged; sharp tips keep their
  fine sampling) and the points budget counts as 4K samples, so the same drops stay at any
  size; a drop combed or swirled into a sliver under half a pixel (2 area / perimeter)
  dissolves; a dissolving drop stops gaining points and counts half against the budget;
  only drops whose edges are due a split or a merge are resampled (an exact square-root-free
  test); every transform keeps each box exact (no extra pass a frame); the swirl's falloff
  is inline arithmetic; the worker answers every tick and is ticked at most ~70 times a
  second (an uncapped renderer drove it at its own rate), 10 a second on still water with
  auto drops, not at all when nothing can land. At 1080p, first minute from a fresh
  session : comb 1 + swirl 1 : points 60K → 31K (flat after 40 s), worker 11.5 → 5.7 ms a
  tick and now 60 ticks a second (was 50), worker 52 → 34 % of a core, renderer process
  72 → 51 %; evolve 1 + comb 1 + swirl 1 : points at most 142K → 45K, worker 54 → 8 ms a
  tick, 6 → 58 ticks a second, renderer process 102 → 60 %; 60 fps held at 1080p and 4K
  (4K comb + swirl unchanged by design : ~60K points, worker 10-11 ms). Same seed, same
  ticks : the combed picture is the same; at evolve 1 the water is sparser, since the
  budget now holds. Save → New → load pixel-identical (0 of 8.3 MB). Headless tests :
  6,604 assertions (sampling bounds per size, ~0.54 x the points at 1080p, slivers
  dissolve and stop growing, points within 1.6 x the budget at evolve 1 with no drop
  leaving before it has faded, exact boxes, the log replays identically at 1080p).

- **A lone hand goes to its own side** (`HandSlots`, `engine/handShape.ts`). With two
  hands in view nothing changes (the one on your left as the preview shows it is L).
  With one, it used to always be L (a lone right hand moved `handLeftHeight` and fired
  `pinchLeft`); now it keeps the side it had while it stays in view, else takes its own
  from MediaPipe's handedness (now passed back by the tracking worker; on an unmirrored
  camera MediaPipe's "Left" is the performer's right, and the sense is learned again
  from every frame that shows both hands, so a camera that mirrors corrects itself), so
  a lone right hand is R wherever it is. Its labels vote for a quarter second after it
  comes into view. Tested on synthetic hands on a raw and a mirroring camera with Mirror
  on and off (two hands, a lone hand anywhere, a lone hand sweeping across, a pair losing
  one, labels 15 % wrong, labels the other way round) : every case right but a few lone
  hands whose labels were made wrong (97.5 to 99.5 %).

## v1.3.0 — 2026-10-21

### Added (after the audit)

- **The Body page takes less room.** Its sections are named in the left margin, the way
  the layer strip names IN / MIX / FX / OUT : TRACK (what the camera reads, sensitivity,
  hold time, OSC out), the feature monitor's seven groups (Hands, Pose, Face, Silhouette,
  Motion field, Movement qualities, Presence, each in its own color on a faint panel of
  that color), NEW RULE (the rule builder) and RULES. No more title line per section, the
  explanations ride on the margin words' tooltips, the last gesture recognized moves to
  the page header, and the monitor holds as many columns as its width allows, at any UI
  zoom. The margin word is one shared component (`MarginLabel.tsx`); the layer strip's
  looks the same.
- **The pickers are sorted into clearer families.** Effects : a new **Frame Store** group
  (Field Store, Shatter, Crawl, Store Zoom, which were split between Time and Distortion),
  **Analog** (NTSC, Tracking, Sync Loss, Decay, Scanlines, CRT Screen, Rutt) and **Codec**
  (Codec Mosh, Datamosh, Mosh Blocks, Compress, Databend, Byte Corrupt, Ringing) take
  fourteen effects out of Glitch (29 → 15); Feedback Zoom joins Feedback; Phosphene,
  Pulfrich and Optical Rain share **Optical**; Aperture and Grain make **Film**; Scanner
  and Slit Buffer go to Time, Pixelmask to Stylize. No group holds a single effect any
  more. Sources : two new sections, **Painted** (Oil Cloud, Cloud Study) and **Geometry**
  (ten line, grid, dot and shape generators), between Organic, Analog and the rest; the
  Silhouette source gets its 👤 like the other live entries. Generate : the five store
  themes (Field Store, Revealed, Shatter, Trail Crawl, Store Zoom) are one **Frame Store**
  family (18 families), each moving exactly as before; master chains : all nine store
  chains in one **Frame Store** group. The FX group reader now keeps two-word groups.

- **Grain on the dome is film grain again** (`shaders/isf/lib/finalGrain.glsl`,
  `engine/dome.ts`, `domeSignal.ts`, `isfTextureBridge.ts`) : the Finalizer's film and
  digital grain moved into one shared include (pasted at `// @grain`, the same maths, so
  flat output is unchanged). While the Fulldome output is on (any mapping) the Finalizer
  skips it and the dome stage draws it after the mapping, in the master's own pixels
  (its size counts pixels of a 4096 master : the default 1.5 is 1 to 2 master pixels),
  only where the picture is, following the Finalizer's opacity and dry/wet. It came out
  2-4x blown up and oblong. CRT and VHS noise stay in the frame : their rows are the
  picture's own scan lines, so they bend and turn with it, like their parasites. Dither
  (a master-rack effect) is unchanged.
- **The dome reads the picture through mipmaps** (`engine/dome.ts`) : each frame the
  flat frame is copied into an 8-bit mipmapped texture (anisotropic filtering where the
  card has it), and every dome read uses that pixel's own footprint, so where the
  mapping squeezes the frame (the full dome's four corner pinches, the panorama's
  zenith, many turns) fine patterns average out instead of shimmering into moiré;
  magnified areas are as sharp as before. About 22 MB of video memory at a 2048²
  composition.
- **Rotations turn the dome, not the frame** (full dome, fill; `shaders/isf/lib/dome.glsl`,
  pasted at a `// @dome` line by one loop in `shaders/isf/index.ts`, and used by the
  Feedback node in `convNodes.ts`) : Transform's rotate turns around the zenith (its
  zoom and position stay flat); Feedback Zoom's twist and zoom and the Feedback node's
  rotate and zoom work on the disc around their wandering centre, so no frame corner
  swings into view and echoes nest as circles (edge black : rings within rings). Wrap,
  screen, cover and contain behave as before.
- **Things fall down the dome's walls** (full dome, fill, automatic, no new control; the
  same include) : down points out to the rim all around, up to the zenith, sideways
  around the dome, and at the front everything reads as it does flat. Ash falls outward
  on spokes thinning toward the zenith, Optical Rain on spokes that halve in number
  toward it, Erosion washes outward; Streak (angle 0 : a spin blur round the dome),
  Light Trails and Murmuration's wind turn with each point's place; Sync Loss rolls
  outward and its tears twist rings; Tracking's band is a ring creeping up the walls
  (its flat "up" kept). Flat output is unchanged.
- **Flash safety is tighter on the dome** (`store.ts setDome`, `OutputPage.tsx`) : left
  at mild (0.35, its default) when the dome turns on, it goes to strong (0.7), and mild
  comes back when the dome goes off (`strobeSafeDomeBack`, never saved); a level set by
  hand (any other, or one picked while the dome is on) stays. One line in the section's
  help says so. Verified in a test copy : every touched shader compiles with no console
  errors, the dome at 4096² holds 60 fps with grain on, Flash safety goes 0.35 → 0.7 →
  0.35 with the dome and a hand-set 0.5 is kept.

- **Search everything (Ctrl+K / Cmd+K)** (`searchIndex.ts`,
  `components/SearchEverything.tsx`) : a palette over the app finds sources, effects
  (yours too), presets (each shader's, yours, layer / Mixer / Background), master chains,
  Generate themes, every parameter of what is loaded (every input of every loaded source
  and effect, each effect's dry/wet, the layer and Mixer controls, the Background's
  three, the 16 Meta knobs), the full pages and right-column tabs, and commands
  (Randomize, Vary, randomize the selected unit, Panic flush, Freeze, Record, MIDI Learn,
  Fulldome, New / Open session, Undo / Redo), read from the registries and the
  composition each time it opens (new effects appear by themselves). Results come under
  headings by kind, each row with a hint of what the pick does or where it lands; a row
  that can't apply is greyed and says why. Matching is SearchSelect's own score (now
  exported, `searchScore`), so the `keywords.ts` tags work, several words narrow
  (`mosh l2`), and whole kinds rank (`reverb` lists the reverb effects before presets
  named so). Keys : ↑ ↓, PgUp / PgDn, Tab / ⇧Tab (the next kind), Enter, Esc; Ctrl+K
  again or a click outside closes; letters typed in the field never fire shortcuts, and
  bare K stays the Resolume mapper. Where a pick lands follows the selection : a source
  in the selected slot (the Background, if the source can be a ground; an effect
  selected : its own slot, a layer-rack effect's : that layer's first empty slot, else A;
  nothing : the first empty layer, else L1 A); an effect in the selected source's,
  effect's or Background's rack (nothing : the Master FX; where `canHostFx` refuses,
  the layer's own rack, else the row greys); a shader's preset onto the selected unit if
  it plays that shader, else onto one in the composition (the selection's layer first),
  else the shader loads with it; a layer preset onto the selected layer, else L1; Mixer
  and Background presets and master chains as from their menus, a Generate theme
  through the Generate button's own path (`generateFromTheme`, pulled out of
  `TopBarMenus.tsx` : it asks to save first). A parameter selects its unit in the
  Inspector (or opens the layer strip, the Mixer or the Meta bar), unfolds the big
  preview and closes full pages, then scrolls to the control (`data-ctl` on `PinZone`)
  and pulses it twice. Every pick is one undo step; with the field empty, recent picks
  come first. It opens in whichever window has the keyboard, the Output page's own window
  included (`focusedHostDocument`). The cheat-sheet lists Ctrl+K and the keys inside the
  search. Measured outside the app : 2,113 results on a two-layer scene, about 2 ms of
  ranking a keystroke. Verified in a test copy : it opens, finds, picks into the
  selected source's FX, one Ctrl+Z undoes the pick, Esc closes without acting.

- **Shatter** (`shaders/isf/fx/Shatter.fs`, Time) : motion shown as texture. A still is
  grabbed again and again (**grab rate** 0 to 8 Hz; **sync** free, 1 bar, 1/2, 1/4 or
  1/8 of the tempo; **grab ▸**, a held button or a modulator grabbing once on its rising
  edge) and a 1-bit **pattern** switches each pixel between it and the live picture :
  checker, lines, columns, diagonals, bricks, dither, cells, or key (the picture's own
  darks show the still, so a bright moving subject leaves its last grab behind). Still
  areas look untouched, anything that moves breaks into the pattern. **scale** is in
  1080p pixels; **density** is the exact share of pixels showing the still, and **flip**
  (0 to 6 Hz) and **slide** keep it, so a fine pattern never shifts the average
  brightness Flash safety measures (measured : exactly half of the changed pixels at
  0.5, after a flip, a slide and with every pattern; key ignores flip). ISF shaders
  could not read the tempo : `engine/tempoSignal.ts`, hooked in
  `Compositor.syncFromState`, the integrands in `phases.ts`; like Decimate it follows
  the tempo on the layer's clock, not the shared beat grid (1/4 at 120 BPM : 4 grabs in
  2 s; capped at 8 a second).
- **Crawl** (`shaders/isf/fx/Crawl.fs`, Time) : colours each place by how long ago it
  last changed. A pixel that changes past the **threshold** is stamped with the time and
  the stamps' age is read through a palette, so motion leaves bands of colour behind it,
  each band the places it passed at the same moment, and **cycle** (±0.5 turns a second)
  makes them crawl. **band** (seconds of history in one turn), **steps** (hard bands, 0 :
  smooth), **palette** a ramp of 2 to 5 **color stops** (slate to amber to bone by
  default, no rainbow) or **picture** (each place's own colour from near-black to pale),
  **fade** up to 60 s back to live, **clear ▸**, **ground** live / black / clear.
  Pixels still changing show the live picture; inserting it stamps nothing; at cycle 0
  a stamp keeps its colour. The dice roll its colours as one ramp.
- **Store Zoom** (`shaders/isf/fx/StoreZoom.fs`, Distortion) : the picture read through
  the address counters of a low-resolution frame store, with no state. One **zoom** (0.5
  to 12; below 1 it shrinks and repeats) enlarges and cuts into uneven blocks at once
  (zoom 1.6 : runs of 2, 2, 1, 2, 1, 2, 2); **magnify** 0 keeps the picture in place and
  only mosaics it; **stretch** makes tall or wide blocks; **pan** and **scroll** on both
  axes wrap around the frame; **mirror** (left / right or top / bottom, one axis) folds
  where the address runs off the end, so it moves with pan and zoom (at pan 0 and zoom
  above 1 it is off-frame until you pan : its hint says so); **lines** (256) and **pixel
  width** (1.5) are the store's own. It matched a JS model of the counters pixel for
  pixel.
- For the three : eight presets each, a **Frame Store** group of six master chains (Store ·
  Shatter, Catch-up, Trail Crawl, Crawl Mosaic, Uneven Zoom, Mirror Scroll; they keep
  the scene's palette mix), three Generate themes each putting its effect on the bottom
  layer over moving sources (**Shatter**, **Trail Crawl**, **Store Zoom**, in the Frame
  Store family), dice ranges (the staging
  switches sync, flip, ground, mirror and scroll in `RANDOMIZE_SKIP`), hints, keywords,
  blurbs, Inspector column groups and grey-outs. Nothing special on the dome : Shatter
  and Crawl work per pixel with patterns scaled to the frame height, Store Zoom zooms
  about the frame centre. Run on the ISF runtime outside the app with test cards;
  verified in a test copy : the three compile with no console errors.

- **Field Store, a key-gated store that never fades** (`engine/fieldStore.ts`, a native
  node behind a header-only ISF) : one low-resolution store (**store size** 64, 128, 256
  or 512 square, 8 bits a channel, blocky; stretched over the frame : wide cells on
  16:9, square on the dome; empty cells transparent) holds a copy of the picture,
  written only where a 1-bit **key** per cell lets the live picture through
  (brightness, edges, motion against the previous frame, sidechain through a new **key
  from** picker (none : this layer), transparency, or none; **key level**, **invert
  key**), each channel floored to 2 to 8 bits as it is written (**depth**). Nothing in
  it ever fades. **mode** : trail (the keyed parts; the live figure in front of its
  stamps), color trail (one flat ink per grab, stepping in hue : **ink hue**, **ink
  step**), ghost (the stamps at half over the live picture), catch-up (the whole frame;
  the keyed live figure running ahead of it), mosaic (the store over the picture),
  reveal (the store alone), protect (all but the key written : the keyed parts vanish
  into what was there before), acquire (each cell written once, first come); **show**
  overrides the display (over, under, instead, double, inside). The **capture** clock :
  every frame, every N frames, bursts (N on, 2N off), every bar, 1/4, 1/8, 1/16, or hold,
  with **grab ▸** and **clear ▸**; it runs on the layer's own time (speed scales it,
  freeze stops it). **slide X / Y** : a speed on the store's address (a dead zone around
  zero, a steep curve), wrapping around the edges; at full speed it strobes like wagon
  wheels. **survive scene changes** (`keep`) : a replaced Field Store parks its store for
  two minutes, and the next one with keep on takes it within its first 30 s (at once if
  it has written nothing yet, else the old store crumbles in under its own stamps);
  Panic flush empties the parking (`Compositor.panic`). Flash safety : clear crumbles
  the store away cell by cell over 0.4 s, a display or key change crossfades over
  0.25 s, a carried-over store crumbles in over 0.4 s, a size change resamples at most
  every 0.25 s. Ten presets (Hard trail, Beat stamps, Color stamps, Strobe ghost,
  Catch-up, Live mosaic, Motion reveal, Vanish, First arrivals, Drifting lattice), three
  master chains in the Frame Store group (**Hard Memory**, **Sixteen Levels**, **Strobe
  Ghost**), two Generate themes in the Frame Store family (**Field Store**, **Revealed**),
  hints for all 17 inputs, keywords, a blurb, Inspector columns (mode / key / clock /
  store; ink hue and step grey out outside color trail, key level and invert with key
  none, N unless the clock counts frames), the Orbit voice in auto-Sonify. Any rack
  (`fxScopes.ts`); Randomize never deals it (reveal and protect can blank or hide a
  layer). Verified in a test copy : it compiles with no console errors.

- **NDI® audio in : an Audio Layer slot plays an NDI source's sound** (`preload/ndi.ts`,
  `audio/ndiAudio.worklet.js`, `audio/ndiAudioIn.ts`). A third slot kind beside a sound
  file and a live input (`AudioLayerSlot` kind `'ndi'` : `ndiName`, `chL` / `chR`) : a
  DAW's NDI audio plug-in on another computer, NDI Tools, OBS, any NDI source with sound,
  picked from the video input's own source list (`NdiPicker`, **NDI® source…** in the
  slot menu; `store.setAudioLayerNdi`). It joins the slot's volume / pan / meter chain,
  so the layer's mix, Sonify's output, the recordings, Space and the audio tab's "Audio
  Layer" input have it. The preload opens one audio-only receiver per slot on the video
  input's NDI library and discovery, through NDI's frame sync (it resamples to the audio
  context's rate and to the pull pace), pulled every ~5 ms (a timer plus each processor
  report), sized by the time since the last pull and trimmed toward the processor's
  buffer target by at most 300 ppm; planar float, every channel (up to 16), transferred
  over a private `MessageChannel` straight to the slot's AudioWorklet (the page only
  hands the port on; a token per open, so an old processor never closes a new one). The
  worklet is the jitter buffer : a 50 ms target; an underrun fades out, refills, fades
  in and raises the target by 20 ms (up to 120 ms), 20 s steady steps it back down; an
  excess over the target + 25 ms is skipped under a crossfade, so the latency never
  grows. It plays a stereo pair or one channel (a change crossfaded) and reports to the
  Inspector (`2 ch · buffer 45 / 50 ms`, `ran dry N×`). Armed like a live input : a
  session load or an undo never opens it (its **open** button; `armAudioLayer` at an
  installation's boot does); **lost** while the source is off the network, playing again
  when NDI finds it. A receiver lingers 2 s after a close (a rebuilt audio context takes
  it back without reconnecting); the network-change reload and the page unload close and
  reopen it like the video receivers; the new NDI functions are bound optionally (an
  older runtime still loads). Sessions save the source's name. Measured outside the app
  with a test sender : 48 kHz stereo ~45-49 ms from the sender's clock to the card's
  output, no dropout over a minute, a card 300 ppm off held 43-56 ms after 90 s, 44.1 and
  96 kHz resampled at the right pitch; in the app, connected in ~4 s, buffer 47-59 /
  50 ms, no dropout over 12 s.

- **Ableton Link start / stop sync** (`native/link`, `main/link.ts`, `renderer/src/link.ts`,
  `playEvents.ts`). The addon gains `startStopSync(on)`, `setPlaying(on, quantum)` and
  `state(q).startStop / playing / playBeat`; main configures it with the rest of Link
  (`LinkConfig.startStop`) and answers a play at once (`link:play`, preload
  `linkSetPlaying`), not at the next read. A play maps beat 0 as Link asks : with other
  apps to the first bar from now, so everyone starts there in phase; alone, to now. UI
  (Connect tab, Link section) : **start / stop sync** ENABLED / DISABLED (off by default,
  as in Live; remembered on the computer with the Link settings, never in a session) and,
  while it works, a **▶ PLAYING / ■ STOPPED** button that plays or stops every linked
  app; the LINK badge fills while the session plays; the MIDI clock pill's dot is hollow
  while its device waits for a play. Page side, one transport, Link's (`tickPlay`) : a
  play starts, on its bar, the MIDI clock's Start (`midi.ts` reads `linkPlay()` : the
  clock runs on while stopped, a play heard up to a quarter beat after its bar sends the
  missed pulses with the Start, a later one waits for the next bar) and the sequencers
  the last stop stopped (the Sonify step and key sequences, the scene sequencer). The
  first play starts only the scene sequencer, and only when the session uses it
  (`firstPlay`) : the Sonify sequencers follow Link's play once a Link stop has stopped
  them. A stop sends MIDI Stop at once and stops them. Starting one here (the store
  setters emit `playEdited`) or turning the MIDI clock on plays every linked app;
  stopping the last one still going stops them, and the next play brings it back. What
  Link's own play or stop changes is applied silently (`runSilently` : no undo step) and
  never proposed back. Fixed along the way : a linked app re-counting its bars on play
  stalled the Sonify sequencers; `soniClock.ts` now absorbs a whole-bar jump in Link's
  count (any other jump re-counts like a new bar size) and its sequencers start on the
  play's bar (`soniNextBar`); the MIDI clock renumbers its pulses on a jump. Measured
  against a Node peer : the app followed the peer's play and stop within ~30 ms, the peer
  saw the app's within 8 ms.

- **Coupling level-matching** (`engine/couplingMatch.ts`) : raw flux on ordinary music
  reads a few hundredths, so a lean on flux moved the mix by a percent or two, and a loud
  master parked a level gate on B. Each coupled layer now hears its feature against its
  own recent range before the mode, amount and tightness apply : a top follower (rising
  over 0.3 s, falling over 3 s) and a floor follower (falling over 0.15 s, rising over
  4 s), mapped `(v - floor) / max(peak - floor, minSpan)` with a minimum span per feature
  (`MIN_SPAN`; the level's grows to a third of its top, about 3 dB); a feature that holds
  still leans back to its raw value (only movement is spread). A silence gate on the
  input's level, shared by the four layers (shut under 0.01, open over 0.03), keeps
  silence and room noise still; nothing learns while it is shut, learning eases back in
  over 0.25 s after a pause (the first frame out of silence lights the whole spectrum),
  and it stays open for an OSC input that carries no level. The transient is matched
  through the flux : it fires as the flux rises past the top of its recent range
  (`TRANSIENT_ON`, re-armed under `TRANSIENT_REARM`; an input with no flux keeps the raw
  transient), so it fires on the hits of whatever plays, not only on hits loud enough to
  cross a fixed line (a World's cut on transient flashes more on busy tracks). A reset
  (another feature, band or input) glides from the raw mapping to the matched one over 1
  to 2 s (`MAP_EASE` : the gain rises slowly, falls at once); the matchers carry through
  scene recalls, New and session loads. Simulated : a lean on flux (Synthetic) moved the
  mix 1 to 2 % raw, now its full allowed swing on quiet and loud pop alike; a level gate
  stuck at 100 % on loud material now sits at 57 %. Mixer : an `auto` chip on each
  column's CPL header (no line added) turns it off for the raw feature, crossfading over
  0.25 s (`AUTO_EASE`); the CPL meter shows what the coupling hears
  (`liveCouplingFeature`). `LayerCoupling.auto` : absent is on, so older sessions and
  Worlds get matching. Mixer presets write it out (a mix saved before keeps the layer's).
  OSC `/opsia/layer{n}/coupling/auto` (≥ 0.5 on), advertised in OSCQuery and mirrored in
  feedback.

- **The Audio Layer's controls are modulation targets** (`shared/auMod.ts`,
  `engine/audioLayerMod.ts`; a new `ModTarget` kind `'au'`) : the layer's volume (a gain
  0..2) and A/B mix (0..1), each slot's volume (0..2) and pan (-1..1), and for a sound
  file its playhead (0..1 inside the trim), speed (1/16x to 16x over its octaves, 1x in
  the middle : `auSpeedToT` / `auSpeedFromT`) and trim in / out (0..1 of the file, the in
  kept before the out by 1 % : `auTrim`). A live input or an NDI slot has volume and pan
  only. Applied per frame as overrides on the audio engine, never through the store : the
  modulation pass writes `audioLayerMod.ts` (`setAuMod`), `audioLayer.ts` takes it in its
  tick (`takeAuMods`) and glides the gains and pans there over 15 ms (`setTargetAtTime`,
  `RAMP` : no zipper, no click), back to the stored value the first frame nothing
  modulates them; a store change keeps what a modulator holds (`holdMods`); mute still
  wins; the New / Generate fade keeps the layer's volume to itself. Speed is a factor over
  the stored speed (tape or kept pitch as set); the trim rides the clip player's loop
  seams. The playhead is a scrub (`ClipPlayer.setScrubMod`) : it follows the modulator's
  moves, not its value, jumping once the target is 50 ms (`SCRUB_STEP`) from where it last
  went, at most every 60 ms (`SCRUB_MS`) and never over a seek under way, then playing on
  from there : S&H cuts, a slow sweep grains, a fast one scratches, a held value plays.
  UI : M chips beside the AU strip's volume and mix (their binding row opens under the
  row), beside a slot's pan and a live input's or NDI source's volume in the Inspector,
  and the file transport's own mod row (playhead, speed, in, out, vol); modulated sliders
  tint, show the live value and move the base by the drag; the speed's number and the
  timeline's in / out handles follow the live values. Labels `AU volume`, `AU mix`,
  `AU A volume`, `AU A pan`, `AU A playhead`, `AU A speed`, `AU A in`, `AU A out`
  (`auLabel`). Meta knobs drive them too (`metaSmooth.ts` commits into the Audio Layer's
  state; a playhead knob seeks there once, as a click on the timeline). Clearing a slot
  drops its bindings, a file turned live input or NDI source drops its transport's
  (`dropAuSlotTargets`; volume and pan stay); dead rows give way when the matrix is full
  (`auTargetAlive`); Randomize never picks them; no pins (the Audio Layer is outside the
  composition). No new OSC.

- **An Output EQ preset carries the Glue** (Vincent, from the shelf) : saving stores the
  glue (on / off, amount, voice) with the bands and gains (`eqPresets.ts`, `withGlue`);
  a recall brings it back and keeps the bypass switch; presets saved before keep the glue
  playing; **flat** leaves it; the menu shows a preset's name only while the glue matches
  too. OSC `/opsia/sonify/eq/preset` recalls the same way.

- **Blend menus : our own list, always opening downward** (Vincent : the layer's blend
  menu opened upward : Chromium flips a native `<select>` that doesn't fit below).
  `components/BlendSelect.tsx` replaces the four blend-mode selects (layer A/B mode and
  OUT blend, Mixer A·B mode and LAYER blend) : the list portals into the window's menu
  host (`menuHostOf(doc)`), sits right under the button with the room left to the
  window's bottom as its max height (scrolling inside, the current mode centered),
  keyboard + type-ahead, live modulated label through the overlay loop (per window), pin
  bar kept. Readable names in `abMix.ts` (`blendLabel` : 50 add, soft light, hard light,
  luma key, lighter color...), also on the OUT tab; stored values, OSC and order unchanged.
  Right-click menus now listen to and fit the window they open in (the Output page
  window too).

- **The Feel macros belong to the session** (Vincent, after asking why a layer at
  opacity 1 still let 10 % of the one below through : it was Density at 0.4, left by a
  Generate). Density, Gesture ⇄ Texture, Coalesce, Tonicity, Drift and Flow were kept on
  the computer (localStorage) and set by 59 Generate themes, so a Generate's Density
  went on fading the upper layers (L1 to 95 %, L4 to 80 %) of every session after. Now
  `Session.feel` carries them, `loadSession` restores them (`sanitizeFeel`; an older
  file : `FEEL_NEUTRAL`), New resets them, Generate sets them for its own session, and
  the old localStorage keys are removed at launch. Shutter and Superimposition stay
  runtime (strobes), Proximity stays the computer's. Changes to them count as session
  changes (the guard prints the export).

- **50add, a blend mode** (Vincent, placed just before add) : an additive crossfade.
  Layer blend : opacity 0 the stack alone, 0.5 the layer added on it at full, 1 the
  layer alone (`B·min(1, 2−2a) + T·min(1, 2a)`); A/B mix : the same with A and B, the
  slider reads A↔B. Shader index 19 (`modeIndex`), second in `BLEND_MODES` (so OSC
  indices after normal moved up one); dealt by Randomize; the Agent's blend list.
  Measured : red under green, 0 / 0.25 / 0.5 / 0.75 / 1 give red, red + half green,
  yellow, half red + green, green.

- **Persistent controls, layers, effects, sources and modulators, and Set in every
  scene** (Vincent : a code change had
  him re-enter parameters across a set's scenes). Right-click a control → **Persistent** :
  scenes (recall, the sequencer, the scene pad), Randomize, Variation, the layer dice,
  Generate, a World and the Mixer / layer / background / master presets leave it as it
  plays. `persist.ts` : pins are keys (a control's `modTargetKey`, `lay:<i>:speed`,
  `layer:<i>`), held in the store (`pins`), saved with the session (`Session.pins`), in undo,
  cleared by New, kept by Generate, never in a scene. One gate, `keepPersistent(incoming,
  live, pins)`, runs at every bulk write BEFORE the morph starts (a pinned value is the
  same at both ends : measured, a pinned opacity stays flat through a 2 s recall while
  the next layer fades); the scene pad grafts per frame (App.tsx). A source's control
  holds where the arriving slot plays the same shader, an effect's where the same unit id
  is; the finishing units take the live one's id when something on them is pinned
  (`adoptLockedIds` : Generate builds them anew). A pinned control keeps its matrix rows
  and Meta destinations, a pinned layer all of its own (over the 32-row cap, arriving
  rows give way); a pinned Meta knob comes whole. Randomize modulation skips pinned
  targets; the dice, Init, presets and Paste on a pinned layer refuse with a toast (a
  modulator firing its Vary is ignored quietly). **Set in every scene** writes the live
  value (or layer) into every scene through the same graft, one undo step, with a count
  of the scenes that lacked it. UI (`Pin.tsx`) : `PinZone` (a `display: contents` wrapper,
  so no layout moves) on every auto-generated control, the layer strip's opacity / mix /
  blend / speed, the Mixer's faders, crossfader, hue, blend and column header, the
  Background's opacity / speed / shadow and the Meta knobs; a 2 px gold bar
  (`[data-pinned]`, `--c-pin`), a gold border on a pinned layer, **◆ n persistent** in
  the scene bank with the list (`describePin`). `modTargetKey` moved to `modKey.ts` (the
  store re-exports it). Then (steps 2 and 3) : a **whole effect** (`fxunit:<rack>:<id>`,
  the rack spelled as control keys spell it), a **whole source slot** (`src:<i>:<A|B>` :
  a control key always has a fourth part, its input) and a **modulator card**
  (`mod:<n>`), through the same gate. An effect lands whole in its own rack at the place
  it has now (kept before the finishing units), whether the arriving rack had it or not
  (a scene holding it elsewhere has it moved there), with its matrix rows and Meta
  destinations (the arriving rows on it give way); a finishing unit is replaced in place
  and takes the live id (so it survives Generate), a pinned Context or Finalizer keeps
  its World keys; a rack that can't hold it (the Background off, a source rack on an
  empty slot) holds nothing; the dice keep it and deal around it; dragging it to another
  rack by hand moves its pins, the control pins on it too (`movePins`). A slot keeps its
  source (kind, shader or film, inputs, framing, transport) and its rack, with all their
  rows and Meta destinations; a pinned empty B stays empty; a hand swap keeps the pin
  (it is the slot that is pinned) and the new source is what it holds; **Randomize
  effects for source A / B** on it refuses with a toast, the layer dice and presets deal
  around it. A modulator card keeps its configuration only : bindings follow their own
  rules, so a pinned control's carried binding now runs its own pinned card; pinning a
  World's modulator makes it yours (`togglePin`). Order : slots, effects, controls,
  layers, Meta knobs last; a whole pin wins over the control pins inside it. UI :
  **Persistent effect** / **Set this effect in every scene** on effect chips and the FX
  Inspector header (a gold border on the chip); a source card's right-click opens the
  layer menu with **Persistent source** / **Set this source in every scene** on top
  (header "Layer n · source A"), the source Inspector header too (a 1 px gold outline);
  modulator cards gain a right-click menu, **Persistent modulator** / **Set this
  modulator in every scene** (a gold border and a gold M name). The ◆ list names them
  ("L1 FX · Shatter, the whole effect", "L1 A · sea.mov, the whole source", "M3 (lfo),
  the modulator"). Undo covers the toggles, sessions save them, no layout moves (border
  colors and box shadows only). 58 scenario checks pass (and step 1's 15); a scene-pad
  frame costs 0.05 µs with no pins, about 35 µs with three to eight. Verified in a test
  copy : a pinned source-FX unit, layer-FX unit, master unit, source slot and live
  modulator all kept through two Generates and the dice (all, sources, master, layer
  FX, source FX) while the rest re-rolled; New clears them. Known edges : a pinned
  modulator that is off and drives nothing still counts as free for a World's audio
  routing (the World's binding then rides the pinned card); a scene saved before a
  pinned effect was dragged to another rack carries two units with the same id; Generate
  doesn't remove a freshly dealt copy of a pinned effect beside it (the dice do). Not
  yet : Sonify's controls.

- **The gate hair is removed** (Vincent : "I don't want any gate hair"; it first went
  hand-only, the Peint and Pressé Worlds and the Nitrate and Projection Booth themes no
  longer setting it). The slider and the feature are gone : the Finalizer's `filmHair`
  input and its pass (`Finalizer.fs`), the hair's uniforms and state in
  `engine/filmDamage.ts`, the Compositor's `fdHair`, the World film key (`worlds.ts` : the
  film keys, `FILM_OFF`, `FILM_MARKS`, the editor row and description), the Finishing
  section's row, its hint and New's film key list. Older sessions are migrated on load
  (`normalizeComposition`) : their `filmHair` value, the modulation rows and Meta
  destinations aimed at it and its World fade keys are dropped, and so is a pin on it.
  Dust, scratches, gauge, dirt and burst are unchanged.

- **The layer strip, compact : the Rail** (`LayerPanel.tsx`, layout C of two compact mockups,
  Vincent : feedback must not change the height, Speed and Vary on one line). The stage
  boxes, their title lines, the arrows and the merge lines are gone (they cost ~130 px);
  the four steps are numbered badges on a thin rail down the left (`RailBadge`, the
  step's purpose in its tooltip); the source halves lose their box (the A/B buttons say
  which is selected); the Out tabs open and close a drawer (none open by default); the
  trail stays in its row while feedback is off, dimmed; Speed and Vary share a line.
  Measured at the default column width, old strip → rail : A only 301 → 202 px, a
  typical layer 351 → 254, luma mask + feedback 471 → 322, shape mask + feedback + 5
  effects 537 → 368 (the boxed stages had been 421 / 447 / 507 / 527). Then : the % box
  as wide as "100", the speed and vary boxes as wide as "16.15" (measured : no clipping),
  the layer's "+ fx" the size of the sources', a thin line between A and B. Then : an
  effect chip's ← → move arrows show on hover only, as a small tab over its top edge
  (`FxRackPanel.tsx`, every rack : they took ~30 px per chip, so two effects now share a
  line in a source's half), and FB is back in the layer header beside S and ⊘ (the
  feedback tab keeps its state and trail). Typical layer 257 → 232 px, luma mask +
  feedback 351 → 326 (the old strip : 383 / 474). Then (Vincent, from three mockups) :
  each step on a soft panel of its own color (styles.css `--c-step1..4`, blue, orange,
  violet, teal, at a tenth : the same in every theme), the badges in those colors, the
  rail gone; each panel takes 2 px of the gaps above and below, so the height is
  unchanged (232 px); the Out drawer sits inside step 4's panel (326 → 323). Then
  (Vincent : the old strip's words in the margin said what each part did) : the badges
  become words, **IN**, **MIX**, **FX**, **OUT**, each in its step's color, centered on
  the step's first line (`StepLabel`, as narrow as the badge, the tooltips kept);
  heights unchanged (typical 228 px, luma mask + feedback 320).
- **The layer strip, rebuilt in four numbered stages** (`LayerPanel.tsx`, layout 2 of the
  three Vincent saw as mockups, Speed and Vary kept out of the tabs at his request) : 1
  Sources (A and B as side-by-side cards, `SourceRow card` : the picker over its effects,
  "+ fx" leading them; drops and click-to-select on the whole card), an SVG of the two
  running down into 2 Mix (A–B slider, the mode menu, ≈, M; the mode's word and value in
  the stage title), 3 Layer FX, 4 Out (tabs blend · mask · feedback, each labelled with
  its state, one drawer open : the shape mask's place on an X/Y pad, the feedback on/off
  beside its trail). FB left the header (it is the feedback tab). Speed and Vary under a
  line, always visible; their readouts rounded. `Stage` / `StageArrow` / `XYPad` helpers.
  Then (Vincent) : a card's picker and "+ fx" share one line (the picker's menu keeps its
  own width); a source's effects are led by a **power** button (`ChainSwitch`, store
  `toggleRackChain(scope)` : all off when every unit is on, else all on; half lit when
  some are off), Layer FX too; the mix has an editable percent box beside its slider
  (one decimal).
- **The Mixer takes the A/B harmony and the coupling** (`MixerPanel.tsx` rewritten, Vincent
  picked it from mockups) : each column top to bottom A·B (mode, an A–B crossfader with
  the mode's word and value and a white line where the coupling puts the mix, painted
  from `coupling.ts liveCoupledMix` by one rAF loop), HUE (a −1..1 slider, swatches of
  A's color and where B lands), CPL (mode, feature, a band picker for band, a live meter
  of the feature, amt / tight knobs), LAYER (opacity + speed faders side by side, blend;
  readouts rounded : the opacity box showed `0.60955231832…`). M chips open `AssignRow`
  under the columns (a column is too narrow for it). The header's **≈ coupling** is a
  new master switch (store `couplingOn`, transient, on at launch; `applyCoupling(...,
  enabled)`; the audio tab's coupling button is the same switch now, it used to only
  show the CPL rows; OSC `/opsia/coupling`). Mixer presets also keep each layer's mix,
  mode, harmony and coupling (older presets leave them). The layer strips lose the ⚖
  slider and the CPL row (`showCoupling` gone); their MIX row names what the slider
  means in each mode (`abMix.ts` : A↔B, blend, depth, key, hunger), dims without a B and
  shows a ≈ chip while coupled (click : the Mixer). Its mode menu is as wide as its
  longest mode (no fixed width : "lightercolor" was cut), the same width in every mode.
  Then (Vincent : nothing said whether a layer had anything on it) : beside each
  column's LAYER title, **active** or **inactive** (`ActiveTag`), by the compositor's
  own rule : a source in A or B, not muted (or soloed, when any layer is), opacity
  above 0. The tooltip names the reason (no source, muted, opacity at 0, another layer
  soloed).
- **The A/B harmony is relative to A** (`engine/abHarmony.ts`) : it rotated B's hue by a
  fixed angle whatever A was (so "consonant" did nothing, and a red A with a cyan B
  became consonant at 1). Now −1 pulls B's mean hue onto A's, 1 onto A's complement, 0
  leaves B untouched (sessions keep their look; 1.2 values are 0..1, the clash side).
  The sources' colors come from a 2 x 1 pass (`MEANS_FS` : an 8 x 8 grid weighted by
  brightness, a plain mean of a figure on black was black) run only when a layer's
  harmony is set or the Mixer's swatches want it, read back for the swatches through
  the async capture. A grey B takes the target as a tint, a grey A greys B on the match
  side. Weave now follows the harmony too. Harmony is a layer modulation target (`A/B
  hue`, the knob's middle = untouched), OSC `/opsia/layer{n}/harmony` (0.5 = untouched),
  MIDI Learn, the agent's `set_layer` (−1..1).
- **Coupling fixes** (`coupling.ts`) : **cut** fires as the feature rises past 0.4 and
  re-arms under 0.3 (a held level or pitch parked the layer on B); **gate**'s tightness
  hardens the edge (it slid the threshold); the **band** feature listens to the band the
  layer picks (`LayerCoupling.band`, OSC `/opsia/layer{n}/coupling/band`; it was always
  the lowest); a scene recall keeps a drifting layer's momentum (`resetCouplingState(true)`
  : the mix snapped back while the rest eased); OSC's feature list gains `noisiness`
  (appended, the indices before keep their meaning). The dead `coupledMix` field is gone.
- **Oil Cloud source** (`shaders/isf/OilCloud.fs`, an ISF generator in two passes) : one
  billowing volume, after the volumetric cloud Vincent showed, ray-traced and painted.
  The field is a core plus turbulence (`|2n-1|` : round crests, sharp creases), four
  octaves of value noise turned between octaves, a one-lookup stir (a push whose heading
  turns through the space : a twist about the vertical sheared it into bands and blew
  the lighting to white and blue), DENSITY 2 weighing the fine octaves. The march only
  gathers coverage (sphere-bounded, strides outside sized by the field, and past the
  first two octaves an upper bound lets clearly-empty space skip the fine ones); the
  light is read once per ray where it is half hidden : the field's slope toward the
  light, one shadow look, a crease look straight outward, a cool back light. Lighting
  per step cost 24 fps at 4K : once per ray, 60. The paint pass is Cloud Study's
  strokes, palette per stroke and relief, with premultiplied color so strokes paint
  the silhouette, then straight alpha over GROUND (transparent : no dark fringe). On
  the dome the trace is full size up to about 2100 px a side (`$DOME_FILL` in the pass
  size : the runtime reads a uniform there, and replaces each `$WIDTH` / `$HEIGHT` only
  once), so it stays crisp; the spin and churn are integrated clocks. Ten presets, hints,
  keywords, a blurb, grouped Inspector columns (shape / view / paint), the **Warm and
  Cool** master chain, the **Oil Cloud** Generate theme (Space). Verified in a test copy
  : 60 fps at 1080p and 4K flat, on the dome from 1080p and 2048², 58 at 2880²; crisp
  1:1 crops flat and on the dome; every preset; no shader errors.
- **The dome's grid on output is no longer remembered** (`loadDome`, `setDome` in
  `store.ts`) : the whole dome setup lived in localStorage, the grid with it, so once
  turned on it came back with every dome toggle and every launch, burned into the
  master. It now starts off at launch and turning the dome off turns it off.
- **Cloud Study source** (`shaders/isf/CloudStudy.fs`, an ISF generator in two passes) : a
  volumetric cloud ray-marched at half resolution into the `cloud` target (30 steps,
  longer strides through open sky, 4 octaves of value noise normalized so COVERAGE is
  the share of sky; one look toward the sun for the shade plus a multiple-scattering
  floor so backlit cores never go dark; a soft shoulder over the highlights), then
  repainted at full resolution : a jittered field of strokes (5 x 5 cells, the top one
  wins) laid along the luminance contours, each taking the color under its middle
  quantized to the palette (MIX), pulled toward the color under it (wet in wet), dry-brush
  streaks at its tail, its relief (a soft rise from the rim, bristle grooves) lit from
  the upper left, over a basket-weave canvas. Integrated clocks `PH_drift` / `PH_evolve`
  wrapped at the noise period; `DOME_FILL` keeps the view and the strokes square on the
  dome. Nine presets, hints, keywords, a blurb, grouped Inspector columns (cloud / light
  / paint), the **Oil on Canvas** master chain (Toile paint + grade + grain), the **Oil
  Sky** Generate theme. Verified in a test copy : 60 fps at 1080p and 4K, flat and on the
  dome master, no shader errors. (A first version smeared the cloud along its contours
  with a line integral : it read as blur, not paint; strokes with closed ridges read as
  cobblestones : the rim ridge became a soft rise.)
- **Lattice : four more forms** (`engine/LatticeSource.ts`; `form` 2-5) : **tunnel** (rings
  of points along the flight, wrapped round the camera like the plane's cells, 2.5
  lattices long; height = radius; well = a throat ahead, ripple along it, audio round
  the wall), **sphere** (a Fibonacci globe), **torus** (rolled through itself by fly) and
  **galaxy** (two log-spiral arms turning as one while points stream out along them and
  fade back in at the core, so the arms never wind up; well = a flattened bulge of its
  own points). The three shapes sit at the world's centre and the camera orbits them
  (tilt / turn / height = distance, spin carries it round), their streak from their own
  turn. The grid forms' code moved unchanged into `gridPoint`, the new ones in
  `shapePoint`; a `uReach01` uniform because `uReach` is in world units. **On the full
  dome** (fisheye + fill, `domeFill() > 0`) : stretched like any source, but the view is
  kept square (`uSquare` : x not divided by the aspect, since fill spreads the frame's
  width and height over the same circle) and the sphere, torus and galaxy stand back
  (distance x 1.8) to sit in the middle, overhead and round, clear of the bent rim. (A
  first version drew every point at its true direction on the dome; Vincent wanted the
  stretched look, framed in the middle : replaced.) Ten presets, two Generate themes
  (Warp Tunnel, Orbit), hints, keywords, the reach grey-out. Verified in a test copy :
  every form flat and on the dome master (grid), plane and volume unchanged, no shader
  errors, 60 fps.
- **Perspective on the full dome** keeps its proportions : under fill (`DOME_FILL > 0`) its
  view is square, the rest as before.
- **Right-click the Output button** (`Transport.tsx`, the shared ContextMenu) : Open Output
  in a window (main's `openOutputWindow(-1, true)` : the screen the control window is on),
  Close Output while one is open, Output page…. Verified : the menu, the window opening
  (`#output` target) and closing.
- **The Output page in a window of its own** (`OutputPageWindow.tsx`) : the control
  window opens a blank page of its own (`window.open('', OUTPUT_PAGE_FRAME)`, the only
  window main's open handler allows) and draws `OutputPage` into it through a React
  portal : one store, one engine, every control live. It copies the control window's
  styles (again on every head change : hot updates), its theme attributes and its UI
  zoom, forwards keys not typed into a field to the instrument, and shows the toast at
  its own bottom (`Toaster undocked`). The window survives a remount (StrictMode, hot
  updates : its close waits a tick), remembers its place (`opsia.outputPageBounds`;
  main puts it back on a screen if that one is gone), closes with the control window or
  on its reload, and denies navigation. Store : `outputPageWindow` (remembered), with
  `outputPageOpen` still meaning "the page shows"; O / Output page… raise its window
  (`outputPage:focus`). Opened only from the Output button's menu (Output page in a
  window), never remembered : closing the page resets it, so it otherwise always opens
  in the app (Vincent). ⇲ back into the app in the window's header. `liveOverlay` and `Blink` work in the element's own
  document. Verified in a test copy : styles, live mirror, HUD, dome simulator, a click
  and a forwarded key (M), dock back and out again, closing from the window, O reopening
  it, a reload closing it.

- **The modulator type menu in five families** (`MOD_GROUPS` in `ModulationPanel.tsx`,
  `<optgroup>`s) : waves (lfo, ramp, adsr), rhythms (arp, euclid, turing, cellular), random
  (random, sh, slew, chaos), gestures (organic, motion, physics), listening (audio, vision,
  body, homeostat), instead of one alphabetical list.
- **Shaping a modulation binding** (`ModAssignment.shape`, `engine/modShape.ts`) : per
  binding, between the modulator and depth / mode, in this order : **combine** with one or
  two other modulator slots (+ − × min max, clamped 0..1), **threshold** (cut : the part
  above the line opened back to 0..1; gate : 0/1 with 0.04 hysteresis), **integrate**
  (flow : position += value × rate × dt; step : one notch per rising hit, past 0.5 after
  falling under 0.25, eased in over 60 ms; bounce or wrap; integrators per binding id, at
  0.5 on load, ⟲ resets, pruned when bindings go). `applyModulation` times its frames for
  it. Editor under the binding's row (`components/ModShapeEditor.tsx` : the ⌇ toggle in
  `AssignRow`, a raw / shaped meter with the threshold tick, rows that fit the narrow
  Modulate column), ⌇ on the matrix chips with a summary. `setAssignmentShape` (a patch;
  editing a World's binding makes it yours); `sanitizeModShape` on load (own slot,
  duplicates and out-of-range slots dropped, ranges clamped, all-off = none). Older
  sessions unchanged. Verified : 21 unit checks of the math (combine, cut, gate
  hysteresis, flow holding, step per hit, bounce, wrap, threshold + step, sanitize, reset);
  in the app a square LFO through gate + step climbs a notch per pulse, bounces, and holds
  when the modulator stops; a session round trip sanitizes a hand-edited shape; undo.

### Fixed (audit round 2)

A second audit of everything since v1.2.10, about 95 fixes in seven areas. Vincent's calls :
fix them all except the room EQ (a session keeps carrying its own output EQ and glue; the
`eqPresets.ts` header now says so), and remove the gate hair (above). Checked in a test copy
where a machine can : the BPM box (typing leaves 120, Escape restores it, 140 + Enter then
one Ctrl+Z gives 120), the dome grid after loading a session saved with it on, an older
session with `filmHair` and a binding on it, `impasto`, a pin menu on a dimmed control, a
0..65535 control, the Lattice tunnel, Oil Cloud, Cloud Study, Codec Mosh and the harmony
(no console or compile errors; Oil Cloud 60 fps at 1080p, 58-60 at 4K, 54-56 at 2880², as
before).

- **Sound** : the Filter voice's line-in opens its input only once armed
  (`sonify.ts armLineIn` : its **line-in** button, or an installation's boot) : a session, a
  scene, a Sonify preset or a sequencer step's patch, or an undo never opens the
  microphone, an open line-in stays open through them, and the button shows a closed one
  (a dim ring, "Click : open it"; `SonifyPage.tsx`); at launch a saved line-in waits for
  one click, OSC `linein 1` and the MIDI voice toggles reopen it only once armed by hand.
  A sound analysis cut short (ffmpeg stalled and killed or exiting with an error, the app
  quitting) is no longer cached for good : the run uses what it read, the next launch
  analyzes again (`main/audioAnalysis.ts`, which also packs its frames and waveform in
  growing typed arrays and reuses its pitch buffer : far less memory on long files).
  Sonify switched off while the Audio Layer holds the engine fades the Collage and
  Assemblage voices out first (no click). The output EQ editor's keys and the Sonify
  loops rest under the Source Editor (`sonifyUi.tsx` : Esc and Delete reached the hidden
  EQ). Audio Layer live inputs (`audio/audioLayer.ts`) : an armed input that fails with
  its device present tries again by itself (5, 10, 20, 40 s, then every minute); one whose
  graph fails to build lets its device go; another channel pair rewires in place under a
  short dip instead of reopening the device; one not open yet starts no sound engine and
  does not light the audio tab's "Audio Layer". Import Audio files resume where they were
  when the engine is rebuilt (render scale, composition size, GPU reset; `AudioSource.ts`,
  `Compositor.ts`). New and Generate fade the Audio Layer out over the Morph time instead
  of cutting it (an undo during the fade brings it back). The Audio Layer's sound is
  analyzed once a frame when the audio tab's input and an `AU all` modulator both read it
  (`engine/audioIn.ts`, the pitch correlation buffer per analyzer).
- **Tempo and control** : Escape in a number box goes back to the value from before the
  edit and commits nothing, and leaving a box you emptied does the same
  (`BoundedNumberInput.tsx` : dirty cleared before the blur), so a half-typed BPM never
  reaches Ableton Link (Escape in the BPM box sent about 20 BPM to every peer). The BPM box
  keeps what you type to itself until Enter or blur (`Transport.tsx`, `onChange` now
  optional; the `tempoTyping` flag in `tempoEvents.ts` is gone) : no dip to 20 while
  typing, and undo records one step from the old BPM to the settled one. The Link
  session's tempo is written through `undo.writeLinkTempo` (no flush of a pending edit in
  its quiet window, throttled to 10 Hz during a ramp), so a peer's ramp no longer splits
  your drag into one step per frame; a content-equal composition copy is no change for
  undo. With Link peers the engine runs at the session tempo, not the scene pad's or a
  morph's blended BPM (modulators, video grain sync, Sonify). A non-finite BPM : `tickLink`
  skips it, `propose` checks and clamps 20..999, `normalizeComposition` defaults it to 120
  (a session saved without one stalled Link and the Sonify sequencers), the Sonify clock
  never latches NaN (`soniClock.ts`). MIDI clock out follows Link's beat when Link is on,
  and Start (and a resync) waits for the next Link bar (`midi.ts`). Link reads redraw the
  badge and section only when what they show changed (`link.ts`). OSC (`oscInput.ts`) :
  `coupling/band` is advertised and mirrored as an int 0..5 (as a 0..1 float, a fader built
  from the advertisement sent 1.0 at the top : band 1), `coupling/feature` as an int 0..6,
  and a 0..1 float spreads over the first six features again (noisiness by index 6 or
  name); feedback no longer streams `/opsia/audiolayer/play` (a destination sending its
  state back restarted both files mid-show; the per-slot `play` still goes); an unknown
  name on `/opsia/layer{n}/source/{A|B}` leaves the slot as it is (`none` empties it); the
  OSCQuery tree is published again (at most twice a second) when its leaf list changes
  (sources, effects, videos, the Body camera), not only when OSC in starts;
  `/opsia/audio/noisiness` is accepted and advertised. MIDI Learn : the A/B hue is a
  continuous target (`MidiPanel.tsx` : a pad could bind to it and then did nothing). Undoing a
  pin toggle says "Undone · persistent" (`undo.ts`).
- **Store, sessions and Persistent** (`persist.ts`, `store.ts`) : the Meta dice and
  Randomize Meta leave a pinned knob alone, and a dice glide leaves pinned destinations
  alone on its way and at settle (`metaSmooth.ts metaGlideComposition`; a hand on a knob
  still moves them). A World amount below 1 no longer pulls a pinned Context or film key
  (the graft carries the live `worldBase` / `worldShift` entry of a pinned key). The World
  page's edit, reset and delete of the active World go through the gate. The Inspector's
  dice (and its MIDI pad) and the Finishing stages' dice and reset leave pinned inputs
  (`Inspector.tsx`, `FinishingTouches.tsx`; a preset stays a hand action). Layer Vary
  anchors on the grafted layer when the layer holds a pin. A pinned Meta knob drops
  destinations that are another source's control or a gone unit's in the arriving
  composition, and keeps its Context and Finalizer destinations through a Generate (the
  finishing units adopt the live id for its targets). Opening a session no longer turns on
  the dome's alignment grid : it keeps this computer's grid, and saves never carry it on.
  Sequencer steps with a sound patch no longer record an undo step each. The graft skips
  the rebuild when the arriving rows already match; **Set in every scene** leaves a scene
  whose full matrix would lose rows as it is and says so, and no longer counts a scene that
  already had the value as set. **Init background** respects pins. Relink, Collect and
  rebuild also rewrite the Variation baseline (`sessionMedia.ts`). A hand source swap drops
  that slot's pinned inputs (layer slots, the Background). The pin list (`SceneBank.tsx`)
  says "Background shadow", shows "not in the picture" for a Background input the source
  lacks, and describes pins only while open. `impasto` sessions, scenes and presets load as
  Cloud Study. Dead bindings to Stutter's removed fire input are dropped on load. The pos
  pair axes and the COMPACT toggles can be pinned (`AutoControls.tsx`). The rack dice and
  Randomize keep pinned effect units in place and deal the rest around them (Generate
  builds its effects anew).
- **Engine and shaders** : Lattice (`LatticeSource.ts`) : the TUNNEL's throat squared by
  hand (`pow` of a negative base is undefined : the far part of the tunnel could vanish);
  the GALAXY's stream along the arms is its own phase (the arms jumped 13 % every 100
  turns); SWELL's phase wraps at 5120 (it re-dealt itself at every wrap on the tunnel, the
  sphere and the plane). Cloud Study (`CloudStudy.fs`) : the wind rides each octave times
  1, 2, 4, 8, outside the 2.03 scaling (the finer billows re-randomized when DRIFT or
  EVOLVE wrapped). Oil Cloud (`OilCloud.fs`) : under dome fill each trace side caps itself
  at 2100 (a wide frame was traced nearly full width and cut to about half its height);
  a cheaper march for the same picture (each noise wraps its cell once, the fine octaves
  are skipped deep inside once the light point is found, the stir at SWIRL 0), Cloud Study
  too. A/B harmony (`abHarmony.ts`) : the means ease over time per layer (a cut lands at
  once) and the turn's direction holds near the antipode (B's hue flickered there);
  `atan(0, 0)` and NaN samples guarded; the Mixer swatch follows. Relay morph (`morph.ts`,
  `Compositor.ts`) : a layer with the same sound on both sides hands over in place (one
  copy, no restart; its picture dips at mid-morph instead of a live crossfade), outgoing
  and incoming sounds fade with their pictures instead of being cut. Mod shaping
  (`modShape.ts`) : a gate with a threshold under 0.04 closes again; a morph's ghost
  binding keeps its integrator and gate (a FLOW or STEP binding holds its position through
  a scene change) and combines with the old modulators. Coupling GATE : a Schmitt edge at
  high tightness (`coupling.ts` : no A/B chatter on the threshold). Codec Mosh
  (`codecMosh.ts`) : back from idle or a failure, the input passes through until the new
  decoder's first frame (it flashed an old one); a clean keyframe that never reached the
  decoder is asked for again (the mosh could sit frozen).
- **Source Editor and the Agent (MCP)** (`SourceEditor.tsx`) : each mount makes its own
  canvas, so StrictMode's second mount no longer gets the GL context the first cleanup
  lost (in the dev app every compile reported an error : the "error in the Source Editor");
  the context is still released when the editor really closes. The preview is rebuilt on
  `webglcontextrestored` (or "restart it") after a GPU reset, and compiles are not reported
  as errors against a lost context. A `long` with MIN / MAX and no VALUES is a menu only up
  to 64 entries, else an integer slider (`inputs.ts longShape`, read alike by the
  Inspector, OSC, modulation and the agent's `toValue` : a wide range froze or crashed the
  app); the editor caps its option list and sits in its own error boundary. Saving code
  that does not compile writes the file but keeps the last good version playing ("Saved,
  not loaded : it has errors"); **use** refuses code with errors. Opening another shader
  starts a fresh editor state (Ctrl+Z brought the previous shader's text back under the
  new name). The editor notices its shader changed elsewhere (the agent, another save, a
  session) : "changed elsewhere : reload / keep mine", Save asks before writing over it,
  and **use** never plays a version that is not on screen. A save or delete still in
  flight when another shader opens no longer grafts the old name and id onto the new
  draft. The replace question uses the name main saves under (`fileNameOf`, now in
  `shared/userShaderId.ts`) and also asks before replacing a session's own shader. Link
  and vertex-stage errors are read from their own logs (`shaderCheck.ts` : never
  "[object Object]"). An input's optional `"HINT"` in the ISF header is its hover help, in
  the editor and the Inspector (`inputHints.ts`). Alt+E ignores key repeat (held, it
  flickered the editor open and shut); on a Mac it is Cmd+Option+E (`main/index.ts`), so
  Option+E types the acute accent again. Every overwritten or deleted shader version is
  kept in `Shaders/.history/<name>/` (the newest 30; `main/userShaders.ts`). A session's
  "<name> (session)" copy never overwrites a shader of yours of that name : it takes the
  next free "(session 2)". Installation boot waits for the Shaders listing before loading
  its session, so the session's own version of a shader stays its own. Agent
  (`mcp/tools.ts`, `shared/mcpTools.ts`) : its `undo` takes back only its own steps, runs in
  the write queue, and says so when a change made no undo step (a saved shader file, the
  output transform); `write_shader` refuses to write over one of the performer's shaders
  (or a session's) unless `replace: true`, and may rewrite its own; the `osc` tool sends
  numbers as 0..1 floats, ints only to index addresses or as `{"int": n}` (so `1` is the top
  of a menu, not index 1).
- **Panels** : right-click menus open in one host per window at the end of the zoomed
  chrome (`ContextMenu.tsx` portal, a `MenuHost` in App and in the Output page window) :
  on a grayed-out control they were dimmed, buried under neighbors or covered by a stray
  tooltip; now opaque, above every page and modal. The Mixer coupling knobs and the Meta
  knobs (`MetaBar.tsx`) capture the pointer on their own box and end the drag on lost
  capture (dragged to 0, a knob stayed stuck to the mouse, the cursor hidden). The layer
  blend's modulation overlay attaches to the blend drawer's menu whenever it opens, and
  the blend tab shows the mode playing now. The layer strip's number boxes are sized to
  their longest number in their own font (mix % "33.3", speed "12.35", Vary two
  decimals), in every theme; Mixer faders show one decimal from 10 up. The OUT tabs size
  to their words (the blend mode alone, "no mask", "fb 0.85" : the feedback amount was
  cut; `LayerPanel.tsx`). The Mixer's CPL puts the mode on its own line, the feature (and
  band) under it, so "transient" and "centroid" are no longer clipped. Mixer opacity
  follows its modulation (thumb and number), the blend menu its live mode, and the active
  tag reads the live opacity. The pinned bar joins a control's ring and inset shadow
  instead of replacing them (`styles.css`). Modulated layer and Mixer sliders (opacity,
  A/B mix, HUE, OPA) : a drag moves the base by as much as the thumb moves, and on release
  the thumb follows the modulator again (`useModSlide.ts`, FloatControl's rule). The Vibe
  palette's stops and stop count can be pinned. The palette strip draws at its on-screen
  width under the UI zoom (`VibePaletteStrip.tsx`). The Mixer loop writes the mix words
  only when they change, into spans React never fills. The Vary M chip's title names what
  it modulates.
- **Worlds, Output and the app** : the gate hair removed (see above). **Watch the Output
  in a window** (renamed from "Open Output in a window", which read like "Output page in a
  window") never takes a fullscreen or spanned output off its projector : main refuses
  (`main/index.ts`) and a toast says why. In the Output page window, Esc, Enter, the
  arrows, Delete and Backspace stay there (Esc still leaves MIDI Learn) instead of closing
  or stepping pages on the other screen, and Alt+E is caught there too (not on macOS); the
  World page's keys no longer fire under a page drawn over it, nor throw on an event sent
  to the window. The Output page window's dome simulator, live slider overlay, resource
  HUD and shaping meter run on that window's own rAF, the simulator on its DPR
  (`DomeSim.tsx`, `liveOverlay.ts`, `ModShapeEditor.tsx`) : they stay live with the
  instrument minimized, sharp on a screen with another scale. Edits in the Output page
  window count as your hands on the controls (`sessionGuard.ts watchUserInput`), so
  leaving after opening a session asks to save. The Oil on Canvas, Warm and Cool, Codec
  Rot and Keyframe Hunger chains leave Vibe `mixSrc` alone (`masterPresets.ts` : their
  warm and cool live in the split-tone, which works over any palette). Oil Cloud and Cloud
  Study stay out of the Randomize source pool and the Background dice (`randomize.ts`;
  still in every picker, on OSC and in their themes).

### Fixed (the v1.3.0 audit)

A full audit of everything new since v1.2.10 (seven reviews, ~110 findings, each one
verified before fixing), then the fixes, checked in a test copy where a machine can.

- **Privacy** : a session (Open, Recent, a drop, crash Restore, kiosk boot) no longer
  reopens a saved live input of the Audio Layer : live slots load closed
  (`audioLayerArmed`, runtime only), an **open** button arms them, installation boot arms
  them. The audio tab's input has a request token (a pending open after Audio off, or a
  device switch mid-open, no longer leaves a microphone or an AudioContext behind). Verified :
  0 getUserMedia calls on load.
- **Agent (MCP)** : sandboxed pages (`Origin: null`) refused, JSON content type required
  (no preflight-free post); turning it off closes kept-alive connections and bumps a
  generation (old connections get 503); `set_controls` on an effect merges (it reset the
  others); writes are serialised and restore the selection with `setState` (no Inspector
  expand); `set_layer` / `edit_effect` validate everything first; color alpha read alone;
  `write_shader` reports a failed `use` after saving; the `osc` tool resets the trigger
  edge (`resetOscEdge`); `destructiveHint` on edit_effect, write_shader, scenes; client
  responses get 202.
- **Source Editor** : `setDraft` updates the ref at once (opening another shader kept the
  previous name, so Ctrl+S overwrote it); one id rule shared by main and page
  (`shared/userShaderId.ts`, a hash for non-Latin names); main replaces twin files of the
  same id and lists the newest; a session's differing copy is entered as
  "<name> (session)" with its ids remapped (`remapShaderIds`); deleting a playing shader
  keeps it registered as from-the-session; a shader saved after a delete reloads where it
  plays; the preview loses its GL context on close; the live-picture input uses the
  engine canvas (`engine/outputCanvas.ts`) at its size; shortcuts wait under the editor;
  Alt+E by `code` too; event names escaped in the linter.
- **Audio Layer / clip audio** : films dropped on a slot play their soundtrack
  (`audio:playable` takes films); an unplugged input shows **lost** and comes back on
  `devicechange`; loop off holds at the out point; New / Generate empty the layer; OSC
  play on the rising edge; in Space the layer joins after the master (no 100× boost on a
  sharp pull, audible at master 0); undo covers the layer (never opening an input);
  15 ms fades on clear / swap; a pending synced start cancels on pause; a device change
  resets channels to 1+2, no invented labels; seeks wait for a loading file; clip flux
  judges jumps by the clip's own speed; the file slot volume reaches 200 %; failed
  analyses retry (10 s, doubling to 5 min).
- **World** : `sanitizeWorld` everywhere (storage, sessions, scenes, the JSON editor,
  take) and an error boundary around the page (a bad value crashed the app on every
  launch); the amount fades only the World's own change (`composition.worldShift`), so
  hand edits, modulators and macros keep working below 1, switches step at 0.5 only while
  still where the World put them; the found mood re-captured on each apply (Generate
  after its theme); the World's modulator tracked by its binding ids, yours once edited,
  the old-session guess once at load; switching Worlds over MORPH eases (coupling taken
  ahead, no layer relay); responsive columns (two below 840 px, one below 560, scrolling
  there); save as mine keeps the picture and names uniquely; a full matrix says so;
  keys (filter, Enter on buttons, repeat); take from composition reads every film key;
  finalizer defaults; worldBase validated; worlds persisted after undo; Randomize skips
  the flagged modulator wherever it is.
- **Sonify** : the Assemblage Ring bank follows a key glide (`stepGlides` 'ra'); its
  resonator notes glide; the cut accent strikes on the new note; bands over the ceiling
  fold down an octave (octave 9 no longer whistles) and makeup is measured where they
  ring; clips carry their original (`AssembleClip.src`), live mode included, old sessions
  through the bank; the next clip's player is loaded ahead and the edit's files prepared
  ahead; Space : an 11th color, the Assemblage follows its clips, the pieces row states
  its limit; full Assemblage OSCQuery; the Collage card needs films.
- **Assemble** : new / vary / picking an edit keep the slot's FX, framing, speed and
  bindings; the tab picks up the selected slot's edit (save, export, vary); unnamed edits
  are "new edit" (the Inspector showed nothing); messages for a folder with no usable
  video, and a vary from another folder.
- **Fulldome** : the panorama's back seam stays behind the audience under rotate / spin;
  Space inverts the fill offset's disc map exactly (verified to 1e-12° on 2000 random
  settings); the offset sliders map square-to-disc (no dead travel); DOME_FILL follows
  the scale; films default to cover under fill in the Inspector too, Reset clears the
  fit; the Satosphère square composition only while the dome is on, the previous size
  back when it goes off.
- **Ableton Link** : a typed BPM reaches Link on Enter / blur only (it sent 20 BPM at each
  keystroke; verified with a second peer : it saw 120, then 130); a peer's tempo never
  becomes an undo step, undoing a hand tempo edit sends it; redo survives non-edits
  (undo/redo commit `snap()`; the sound reapplied only when it changed); no "Save
  changes?" when peers come and go; the Sonify bars re-align on a quantum change and
  follow Link's bar; a stall keeps the step grid; wall-clock stamps on both sides; Sonify
  ignores the picture's latency lead; MISSING shown at startup and switchable off;
  `closeLink()` on relaunch; `_HAS_EXCEPTIONS=1` on Windows (built and loaded locally).
- **Codec Mosh** : one config key (no restart loop in bitrate mode); the decoder prefers
  software, resets alone on an error (the mosh holds, resumes at the next keyframe),
  falls back on a configure failure; chunks matched by timestamp; readback only when the
  encoder can take it; the codec closes after 2 s unrendered (a disabled unit) and
  reopens clean; a 10 kb/s floor and retries instead of a permanent stop.
- **Session media** : relink touches only missing paths and only toward files that exist,
  scores candidates by matching trailing path parts, maps a found folder's children
  through it; converted copies recognised by name in any `video-cache` folder (another
  computer's); collect checks size + date or first / last MB before reusing a copy,
  copies through `.part`, repoints folders only after a successful run with something
  copied, unique names for same-name folders, the deepest holder for nested ones; EDL
  clips record their original, rebuild covers scenes and edits; status cleared on New /
  Generate, late results dropped; 100,000 paths checked in batches; NFC names; main
  checks every collect destination and media type.
- **GUI** : the sized preview never hides its sizer (max-height); both windows navigate
  only to the app (a drop on the output window did); a session file opens from any drop
  target, an empty folder drop leaves the slot alone, a drop on an FX chip passes
  through; folders warm only after a load is accepted; the Finishing grey-outs respect a
  modulated character / outside fill.
- **License** : LICENSE, LICENSE-EXCEPTIONS.md and THIRD_PARTY_NOTICES.md ship in every
  build's resources.

### Added

- **Agent (MCP)** : Palinopsia is an MCP server for an agent on this computer
  (`src/main/mcp.ts` : Streamable HTTP, plain JSON responses, no session ids so a client
  survives an app restart, GET 405, notifications 202, protocol versions 2025-11-25 back to
  2024-11-05; 127.0.0.1 only, Origin and Host checked against DNS rebinding; 4 MB bodies;
  calls forwarded to the page over `mcp:call` / `mcp:result` with a 30 s timeout). Fifteen
  tools (`src/shared/mcpTools.ts`, run by `src/renderer/src/mcp/tools.ts`) : get_state,
  snapshot (JPEG of the output canvas, `registerAgentCanvas`), list_shaders,
  describe_shader, set_source, set_controls, set_layer, add_effect, edit_effect,
  write_shader, preview_shader, scenes, list_controls, osc (`/opsia/…` only, through
  `routeOsc`), undo. Units addressed `L1.A`, `L1.fx.2`, `master.context`, `bg`…; values
  in the control's units, clamped, labels for menus, 0-255 colors accepted, events fire
  for 80 ms; every value is resolved against the shader BEFORE anything changes. Each
  write is one undo step (`undo.ts commitNow` before and after) and the Inspector
  selection is restored. No tool reaches `strobeSafe`. Compile + error mapping moved out
  of the Source Editor into `shaders/shaderCheck.ts` (`lintIsf`, `compileIsf`,
  `renderStill` : a still on a private WebGL2 context, a stock generator under an
  effect, 12 frames leading up to the time). Connect tab **Agent (MCP)** section (on/off,
  port, the address with copy, last client, the last calls) and the top bar's **AGENT**
  light; per machine (`opsia.mcp`), off by default. Verified over HTTP in a test copy :
  handshake, notifications 202, GET 405, a foreign Origin 403, every tool, a broken
  shader's error on its line then the fixed one saved and played, three changes undone
  one step each, the selection kept, bad values refused with nothing changed.
- **Solid Color greys out what it is not using** (`DIMS['solid-color']`) : gradient off, the
  three stops, angle, midpoint and dither; gradient on, the flat color.

- **The Source Editor** (`Alt+E`, caught in the main process's `before-input-event` so the
  default menu's Alt+E (Edit) never opens; or `{ }` in the Transport) : a full page
  (`components/SourceEditor.tsx`) to write ISF shaders. CodeMirror 6 (pinned :
  `codemirror` 6.0.2, `@codemirror/view` 6.43.13, `state` 6.7.6, `language` 6.12.4,
  `legacy-modes` 6.5.4 for GLSL, `lint` 6.9.7, `search` 6.7.2, `commands` 6.11.1,
  `autocomplete` 6.20.3, `@lezer/lr` 1.4.10, `@lezer/highlight` 1.2.5) with the app's
  colors; templates (generator with `PH_speed`, effect, feedback with a persistent pass);
  any built-in opens as a copy; open any ISF file. Compiles 400 ms after typing on its own
  WebGL2 preview (`makeRedirectableGL`), the last good renderer keeps playing. The ISF
  runtime throws the GLSL log away, so a failed build is recompiled by hand and its lines
  mapped back through `ISFParser.fragmentShaderSkeleton` + the model's `uniformDefs`; a
  header JSON error is placed on its line; lints for `IMG_NORM_PIXEL` with a computed
  coordinate, an event compared with a number, no `gl_FragColor`. Header controls play
  the preview; an effect reads a generator or the live picture (~15 fps). The draft
  persists (`opsia.sourceDraft`). Saving (button or `Ctrl/Cmd+S`, which the App then leaves
  to the editor) writes `<name>.fs` to `Shaders/` beside Sessions and Recorded
  (`main/userShaders.ts` : `shaders:list/save/delete/openFile/reveal`); each one is
  registered in `SHADER_BY_ID` as `user-<slug>` (`shaders/userShaders.ts`,
  `IsfShader.user`), listed under "my shaders" in the source menu and the FX add menu
  (`canHostFx` takes user effects in every rack), its inputs re-read
  (`invalidateInputs`). A new version of one that plays reloads it everywhere
  (`takeShaderReloads` → `Compositor.reloadShader` : slots, racks, master, background).
  Sessions carry the sources of the user shaders they play (`Session.userShaders`, from
  the composition and the scenes) and register them on load (marked `fromSession` when
  not in the folder). Use buttons : the selected source slot, the selected layer's FX,
  the master FX. Verified : error on its exact line, recovery, save + list + play on L1 A,
  a new version reloads the playing layer, an effect into the master rack, a session
  restoring a shader this computer lacks, Alt+E, Ctrl+S saving the shader (no session
  dialog).

- **Sonify's Assemblage voice** (voice 10, `cfg.assemblage`, a second `CollageVoice` on the
  worklet's new input 3 with its own `Leveler` + `RingBank`; `NVOICE` 11) : each Assemblage
  source is one piece whose film is the clip on screen (`AssembleSource.soundInfo` : the
  live deck's video, the clip's ORIGINAL file = the slot's corpus folder (`mediaPath`, now
  set by `setSourceAssemble`) + its file name, its unit, a cut serial; `Compositor.
  assembleSounds`). Placed by its unit on the Assemble map (`assemble/place.ts unitPlace`,
  registered with `sonifyEngine.setUnitPlace`; a hash place without the corpus) : note from
  the map centre distance, pan from x. `CollageVoiceCfg` gains `accent` (a 12 ms noise strike
  into the piece's band-passes at every `set.cut`) and `tape` (`preservesPitch` off). Card
  built from the Collage's (+ cut accent, pitch tape/keep), mixer / sequencer / MIDI / Body /
  Performance lists, mods `asmReso · asmRing · asmWidth · asmAccent · asmBank`, OSC
  `/opsia/sonify/assemblage/*` (the Collage's controls + accent, tape) and OSCQuery, the dice,
  the suggestion (on when an Assemblage plays). Space : voice index 10, source 11 from 1 (the FX return and the
  pieces move up one). A Collage fed by saved edits now hears their original files too
  (`CollageEdl.folder`). Measured with three tone films : the players walk the three files at
  their in points (tape pitch), the voice alone peaks 0.22, off releases them.
- **The film voices grey out with nothing to hear** : the Collage card and mixer row while
  no Collage source is on a layer or the background, the Assemblage's while no Assemblage is
  on a layer (still playable). Verified both ways.

- **The World page, ten ways better** (`components/WorldPage.tsx`, `worlds.ts`,
  `engine/worldAmount.ts`) :
  1. an **apply sets** line (`worldEffects`) saying what Apply changes;
  2. Apply **morphs** over MORPH (`beginSceneMorph`), like a scene recall;
  3. **take from composition** (`worldFromComposition`, store `takeWorldFromComposition`;
     a built-in gets a new World);
  4. **layers** L1..L4 (`World.layers`; a layer left out keeps its coupling);
  5. everything a World holds is editable : the **film character** (`WORLD_FILM_KEYS`)
     and Context's light, void and material beside trails/bloom/depth/haze
     (`WORLD_CONTEXT_KEYS`); audio routing targets gain depth, light, void;
  6. the visualizer reads **your layers**' generators and the **live sound**;
  7. edited built-ins show **● changed** with **save as mine** and **reset**
     (`builtinChanged`, `resetWorld`);
  8. a **filter**, descriptions in the list, **arrow keys** + **Enter**, double-click
     applies;
  9. the JSON folded by default (remembered), now with layers and film;
  10. the **World amount** (store `worldAmount`, `ModTarget {kind:'world'}`, Meta knobs,
     OSC `/opsia/world/amount`) : blends the World's Context and film keys from
     `composition.worldBase` (the mood the first World found) frame by frame after the
     field macros. The World's audio modulator now goes to the first free slot from M8
     down (`fromWorld` flag; an older session's M8 routing is recognized), never a user's.
  Verified : the summary, L2 left alone, M8 kept (the routing took M6), base captured,
  changed / reset, take (haze 0.42), film hold applied, arrows + Enter, your-layers
  material, live sound, trails 0.22 → 0 → 0.11 at amount 1 / 0 / 0.5, the morph running.
  The editor sits in three columns (coupling + film · Context + audio routing · the
  preview + JSON) so it fits a screen with no scrollbar (measured : 0 px overflow with a
  film World open); a column that still runs long scrolls with the wheel, no bar shown
  (`.no-scrollbar`).

- **Codec Mosh** (`engine/codecMosh.ts`, `node-codecmosh`) : a native node that runs the
  layer through a real H.264 round trip (WebCodecs : baseline `avc1.42001f`, annexb,
  realtime, per-frame `quantizer` when the encoder takes it, else a bitrate; graphics card
  first, the processor after a hardware refusal). The input is read back through a
  `GridReadback` ring (premultiplied over black; a second cell for the sidechain), encoded
  at a small size, decoded, and the newest frame uploaded (rows stay bottom-up end to
  end : no flip). Each encode carries an intent (clean / mosh / normal) matched to its
  chunk : mosh keyframes, and the encoder's own keyframes while a mosh holds, are
  withheld from the decoder; bloom re-decodes each delta up to 3 more times; drop skips
  deltas; motion-from encodes the sidechain after a clean keyframe of the host (and
  re-seats on a mode change or mosh ▸). Triggers : mosh ▸ / clean ▸ (rising edges), cuts
  (a sparse luma diff on the readback, 0.3 s cooldown), a pulse clock, the hold timer
  (refresh). Size / bitrate changes restart the codec at most every 0.4 s, a broken codec
  retries after 1 s. Verified live : 640x368 on the graphics card with per-frame quality,
  60 fps; a cut with refresh 0 carves the new generator out of the old one's colors until
  clean ▸; bloom + drop tear into macroblocks; motion from another layer drags this one.
  10 presets, master chains **Codec Rot** and **Keyframe Hunger**, Generate theme **Codec
  Rot** (and in Bitrate Starve, Discorrelated), Inspector groups, hints, blurb, keywords,
  Sonify affinity. Not in the Randomize pools (each instance holds an encoder).

- **Ableton Link** (`native/link`, `src/main/link.ts`, `src/renderer/src/link.ts`,
  `components/LinkSection.tsx`). The Ableton Link SDK 4.1.1 (and asio 1.38.2), vendored
  and compiled into a small N-API addon in the main process : one Link instance, polled
  (`state(quantum)` → peers, tempo, beat, phase) and pushed to the page 30 times a
  second, stamped on the shared `performance.timeOrigin + now()` clock; the page
  extrapolates the beat between reads, with a latency lead. Tempo : with peers, Link's
  wins every frame over anything but a deliberate edit (`tempoEvents.ts` : the BPM box,
  tap, MIDI tap / `transport:bpm`, `setBpm` for OSC and dataflou), which is proposed to
  the session; alone, Opsia leads. Phase : `modEngine.tick(…, linkBeats)` nudges every
  BPM-synced clock onto the grid (`lockToLink` : lfo / motion phases, the
  `*LastAdvanceAt` step clocks, ~0.3 s settle) and pins the Euclid step index; the
  Sonify beat clock becomes Link's beats (a whole-bar offset keeps the count) and
  starts sequencers on the next Link bar. The session guard ignores a tempo set by
  peers. The Connect tab's **Ableton Link** section (Enabled / Disabled per Ableton's
  integration guidelines, apps linked, tempo, bar dots, bar 2·3·4·6·8, latency) and a
  **LINK n** badge beside the BPM. CI builds the addon on all three platforms
  (non-blocking), electron-builder ships it unpacked; the test build copies built
  addons in. Verified against a second Link peer : phases within ~1 ms, peer tempo →
  Opsia, Opsia's BPM edit → peer, a non-deliberate tempo change pulled back, a 1/1 LFO
  and the Sonify clock on the Link bar.

- **Drag and drop from the desktop** (`components/fileDrop.ts`) : a film onto a layer's A
  or B row imports it (converted if it must be), a sound file there is Import audio, a
  folder makes the slot a Collage of its films (`collageFromFolder` : the Collage's own
  scan, `path:kind` IPC tells a folder from a file); a sound (or a film, for its
  soundtrack) onto an Audio Layer slot; a session file anywhere on the window opens it
  (with the Save changes? question); anything else says where things go. The target
  lights while a file is over it; effect-chip drags are untouched. Verified with real
  file drops (CDP `Input.dispatchDragEvent`) : all six cases.
- **Open ▾ : recent sessions** (`recentSessions.ts`, localStorage, the newest ten) :
  every open, load, save and drop puts the file on top; × takes one off; a file that is
  gone when picked is said and removed.
- **The preview can be sized and made big** : a bar under it to drag (remembered;
  double-click : automatic), the panels below scrolling; **V** or **⤢ big** folds them
  away. In automatic mode the preview keeps at least 160 px (a video's tall Inspector had
  squeezed it to 2 px).
- **Session media : missing files found again, everything collected beside the session**
  (`sessionMedia.ts`, `components/SessionMedia.tsx`, `main/mediaRefs.ts`). A loaded
  session's files (films, sound files, Collage folders and clips, Audio Layer files,
  the scenes' copies included) are checked on disk; when some are gone an amber banner
  under the top bar names them (Relink… · Details · ✕). **Relink** : pick a folder, the
  missing files are found in it by name (a bounded walk of the folders under it, case
  ignored), and whatever sat in the same folder as a found file follows it. **Make
  converted copies again** : a converted copy (a film the player can't read) missing on
  this computer is remade from its original, a Collage's clips rescanned. **Collect into
  the session's folder** copies every original into `<session> media` beside the session
  file (a Collage folder keeps its own subfolder), never overwriting (" (2)" on a name
  clash, a copy already there is reused) and points the session at the copies; save to
  keep. Open ▾ → Session media… opens the list. Verified end to end : a moved media folder
  (5 missing, banner), relink (0 missing, film still playing, scenes rewired), a missing
  converted copy remade, collect (4 files copied, paths rewritten), collect again (no
  duplicates).

- **Output EQ presets.** A menu on the EQ card and in its editor (`EqPresetMenu`) :
  flat, the saved EQs, save as (a name; an existing one asks before replacing), delete
  the one in use. A preset is the twelve bands + the input and output gains
  (`audio/eqPresets.ts`, localStorage `opsia.eqPresets`, machine-local like the EQ);
  a recall keeps the bypass switch and the glue; the menu names the preset while the EQ
  matches it exactly. OSC `/opsia/sonify/eq/preset <name | n>` (case-insensitive name,
  1-based index, 0 / flat). Verified through the menu itself : save, flat, recall (40 Hz
  low cut, -4.5 dB bell, -2 / +1.5 dB gains back, bypass and glue kept), the name
  dropping after an edit, replace asked, delete leaving the EQ; OSC by name and by 0.
- **Sonify's Filter voice can play the Audio Layer.** Its source is now **noise ·
  line-in · AU** (`filter.lineFrom: 'layer'`, OSC `/opsia/sonify/filter/linefrom
  input|layer`) : the layer's slots summed before its volume and mute, downmixed to mono
  (a `send` GainNode off the layer's new `bus`), into the worklet's input 0 in place of a
  microphone (`setLayerSend` / `syncLayerLine`, relinked on every start and on a healed
  context). Measured : with the layer muted the Filter still plays it (0.098 RMS against
  0), no getUserMedia; muting the slot leaves only the Filter's own quarter noise.
- **The output EQ and the glue moved to the audio tab** (Audio section, an **Output EQ &
  glue** part under USB denoise; the Sonify mixer points there) : they shape everything
  that leaves, Sonify and the Audio Layer. The Output levels gained an **Audio Layer** row
  (its volume to 200 % and its mute, the same as its strip). Hints say what they process
  now. Verified : the Audio Layer joins after Sonify's delay and reverb (dry) : the gaps
  of a click track stayed as silent with the FX tail at full as with it off.
- **The Audio Layer as the audio tab's input.** The input menu offers **Audio Layer
  (what it plays)** (`LAYER_INPUT`) : the audio bus reads the layer's analyser (its whole
  sound after its volume, `audioLayer.analyser()`, re-found when the layer rebuilds) with
  the shared `analyseFrame` instead of opening a device, so the coupling and every audio
  modulator on the audio input follow the layer; the spectrum and waveform bytes (the
  Parametric generator) come from it too. No getUserMedia (counted : 0); an empty or muted
  layer reads 0; Both mode keeps OSC first; the input monitor and the denoiser are greyed
  (the layer already plays). Back on a device, the microphone opens as before.
- **Audio Layer : play both together, and `AU all`.** A **▶** in the MIX row (between
  the A and B buttons) starts both file slots from their in points at the same moment :
  each player is held, cued (paused at its in point until it can play,
  `ClipPlayer.cue`), then all started in the same task (`audioLayer.syncStart`); ⏸
  pauses both; OSC `/opsia/audiolayer/play`. Measured over 4 starts : 13 to 31 ms after
  the press, the two playheads equal to the millisecond a second later. A modulator's
  FROM offers **`AU all`** (`src {layer: -1, slot: 'all'}`) : the layer's whole sound,
  analysed live on its output (an AnalyserNode with the audio input's settings) by the
  audio input's own maths, now one shared function (`analyseFrame` in `audioIn.ts`, the
  bus refactored onto it), run only while a modulator reads it. The same tone read 0.442
  through the audio input and 0.443 through `AU all`; 0 muted or empty.
- **The audio section's dot lights while sound is going on** (Sonify on, or something in
  the Audio Layer, unmuted), with what plays named beside it. Clicking it still toggles
  the input analysis only : it never opens the microphone by itself.
- **The Audio Layer** (`AU`, the layers tab, under Layer 4; `audio/audioLayer.ts`,
  `components/AudioLayerPanel.tsx`) : two slots, each a sound file or a live audio input,
  its own volume (to 2×), pan and mute, the A/B mix (the middle plays both whole :
  `min(1, 2(1-m))` / `min(1, 2m)`), the layer's volume and mute, meters (AnalyserNodes
  after each slot and on the layer). It plays into Sonify's worklet as a **third input**,
  joined after Sonify's master and before the limiter, so the output EQ, the limiter, the
  recordings and Space have it (Space : with the FX return for now). Sonify off, the
  engine runs for it with every voice masked off (`setLayerWanted`); Sonify's context
  rebuilt (a heal), the layer starts over on the new one, its files where they were. A
  file plays through `engine/clipPlayer.ts` (the Import audio transport, now shared :
  `AudioSource` runs on it too) into a MediaElementSource; a live input opens with no voice
  processing, as many channels as the driver gives, a splitter / merger taking a pair or
  one channel (mono on both sides), found again by its name when its id changed. The file
  slots reuse the video transport (`VideoTransport` `ops`), publish their playheads under
  layer -1 (seeks, the level meter, a modulator FROM `AU A/B`). Saved with the session
  (`audioLayer`, sanitized; an older file : empty). OSC `/opsia/audiolayer/volume · mix ·
  mute` and `/opsia/audiolayer/{A|B}/volume · pan · mute · play · loop · ignoreglobal ·
  keeppitch · speed · position · in · out`, advertised in OSCQuery. Measured : 60 fps
  steady with a file and a live input playing, no frame over 30 ms when loading,
  selecting or clearing a slot; a file at 1.00 s/s, the global speed followed or ignored,
  the layer and slot mutes and the mix ends silent, a modulator FROM the layer's file
  0.61 on a song; a fake stereo input with a silent right channel read 0 on channel 2
  alone and the tone on channel 1.
- **Ignore global speed** (the transport's `global` toggle, `ignoreGlobalSpeed`, video and
  audio slots) : the clip plays at its own speed × its layer's, whatever the global speed,
  so a sound keeps its pitch and tempo while the composition slows or rushes. OSC
  `/opsia/layerN/video/{A|B}/ignoreglobal`.

- **An audio modulator listens FROM a layer's clip.** Its new FROM row offers the audio
  input (as before) or any slot holding a film or a sound file : the clip's sound is read
  at its **playhead**. Main analyses the sound once (`main/audioAnalysis.ts` : ffmpeg
  decodes mono 48 kHz floats on a pipe; a copy of the live analyser, 2048-point Blackman
  FFT, smoothing 0.5, the byte dB scale -100..-30, its bands, flux, centroid, noisiness and
  pitch, the correlation by FFT, 60 frames a second; cached as `<key>.aa` in the video
  cache, 13 bytes a frame + the waveform's min / max at 400 a second, about 2.8 MB an
  hour), and `engine/clipAudio.ts` reads it where the playhead is : flux is the most of
  what the playhead crossed since the last read (a fast clip skips no onset), a jump reads
  the new place, a playhead still for 150 ms is silence, the transient decays in real time.
  Measured against Chromium's own AnalyserNode on the same file as it plays : mean level,
  centroid and the six bands equal to the third decimal, correlation 0.95-0.99 on music;
  a 26 s film analysed in 0.39 s (about 1.5 % of real time), a cached one back in 2 ms.
  In the app, a film with bursts twice a second gave a level of 0.041 (0.040 expected),
  0.036 reversed, 8 onsets in 4 s, 0 paused.
- **Import audio** (`🔊`, kind `audio`, `engine/AudioSource.ts`) : a sound file played in
  the layer like a film (the video transport : play, stop, loop, in / out, speed 1/16× to
  16×, tape-like unless `keep pitch`, the playhead scrubbed or modulated, the folder's
  other sound files, the same OSC addresses), its waveform drawn from the analysis's peak
  pyramid (one RG8 texture, each level an eighth of the one below : a column reads at most
  8 texels however long the file) : view whole / loop / scroll, style filled / outline /
  bars, the played part lit. Its look is the `gen-audio` header (presets, modulation, OSC
  reach it; kept out of the generator pools : it needs a file). Seven presets, three master
  chains in a new **Sound** group (Phosphor, Tape Floor, Relief). Plays on Sonify's output
  device through its own `<audio>`; a muted (or soloed-out) layer is silent; a format
  Chromium can't decode plays from its audio-only m4a copy. The media scheme now serves
  sound files. Not in recordings yet (the Live Audio Input job brings outside sound into
  Sonify's mix and its recordings). 60 fps with it on screen.
- **The film's level and volume** (the transport's new **level** row) : a meter of the
  clip's sound at the playhead (RMS bar, held peak, -60..0 dBFS) and its RMS as a number,
  read from the analysis (its new true RMS / peak bytes), so it shows whether the clip has
  sound right there even while the film plays silent. **vol** (`videoVolume`, 0 = silent,
  the default : films stay as they were) lets the film's own sound play on Sonify's device
  while it plays natively forward (reverse, pendulum, the grains or a modulated playhead
  stay silent : they would stutter), silent with its layer muted. A modulation target
  (`vol`) and OSC `/opsia/layerN/video/{A|B}/volume` (an audio slot's sets its volume).

### Changed

- **The Ring bank's cutoff reaches an octave over its highest band** (Collage and
  Assemblage; worklet `cn = -6 + cutoff · (span + 18)`, was `span + 12`) : at the top
  the bank is open (its top band ~94 %; the old top, half an octave over, left it at
  80 %). The reach follows the range, whose top now goes to **oct 9** for both voices
  (OSC octave span too); a cutoff past 20 kHz reads `open`. Measured : the default
  range's top reads 4.98 kHz (2.79 before), oct 9 reads open. A saved cutoff below the
  top now sits a few semitones higher.
- **Assemblage from the source menu stays on the layers** (`assemble/place.ts`) : it puts
  the latest saved edit on the slot (or a fresh cut when the corpus is in memory) and
  selects it, instead of jumping to the assemble tab. The Inspector gains an **edit**
  picker (the bank), **new** / **vary** (greyed, with why, until the corpus is loaded)
  and an **assemble tab ▸** button. Tested : placed and selected with the view
  unchanged, the button opens the tab, an empty bank says so.
- **The side tabs run layers · mixer · finishing · feel · connect · performance ·
  assemble** (assemble moved to the end).
- **License : GPL-3.0-or-later** (was MIT), with an additional permission for the NDI®
  runtime (`LICENSE-EXCEPTIONS.md`); bundling Ableton Link needs it. Releases up to
  v1.2.10 keep MIT. `package.json`, README, the site and `THIRD_PARTY_NOTICES.md`
  (Ableton Link, asio) follow.
- **The audio/midi/osc tab is now "Connect"** (key `A` unchanged), with Ableton Link
  under dataflou.

- **The top bar's session controls are one group** : the session list and Load, then
  New, Open ▾, Save, Save As (New / Open / Save / Save As used to sit at the far right).

- **More "does nothing right now" graying in Vibe and Context**, read from the shaders :
  the chord's hue / chroma / spread with the chord off; at source mix 1, everything that
  only shapes the palette (the strip, bands↔smooth, dither, auto-levels, gamma, sharpen;
  contrast and saturation stay live); haze color with haze 0 (unless the surface material
  is tinted by it through its field depth); light color with glow 0 and no surface
  material; the surface's raking, scale, field depth and evolution at relief 0. Every
  rule (the Finalizer's too) now counts a parameter a modulator, a Meta knob or a Context
  performance macro is driving as live (`DimCtx.driven` : the matrix and Meta targets,
  plus Context's macro values polled off the engine).

- **Vibe and Context read at a glance** : every Finishing section without a switch now
  says its state in its header (palette, tone, split-tone; softness, distance, light),
  like the Finalizer's. Color rows across the three stages are a swatch and its hex value
  (`AutoControls rgbOnly` : the transparency slider beside each did nothing, the shaders
  read RGB only).
- **The Vibe's palette is one strip** (`VibePaletteStrip`) : its gradient drawn with
  Vibe.fs's own palette map (stops, bands↔smooth, a chord's colors via a port of
  `chordColor`), the stops as swatches at their places (click to pick), stops used as
  2 · 3 · 4 · 5 with its M. It replaces the five stop rows and the stops slider.
- **Stutter has no fire button** : its punch-in event (`trig`) is gone from the effect;
  saved values for it are ignored.

- **The Master FX strip's layout** : a header line (chain on, the dice, chain presets and
  + fx, the two menus now the same width) with the finishing units at its right end, and
  the effects underneath across the whole width, under the finishing too (they used to
  share one wrapping row with the menus, which drifted apart as it wrapped).
- **Meta knobs show their value live** : what the knob sends now through its curve
  (`shapeCurve(display, curve)`, 0.00 format), in the gap at the bottom of the dial,
  following drags, glides, MIDI and modulators (accent2 while modulated).
- The audio tab's hint lost its "prefer transient / flux over level" advice.

### Fixed

- **The dome, from a fulldome audit of every source and effect** :
  - a **square composition** for full-dome fill : `dome 2048²` / `dome 2880²` sizes, and
    the **Satosphère** button sets 2048² (fill spreads width and height over the same
    diameter, so 16:9 drew circles as ovals 1.78× longer front to back);
  - **`DOME_FILL`** (`engine/domeSignal.ts`) : a plain uniform uploaded beside the
    integrated phases (the horizon's radius on the disc, 180 / aperture, while fisheye +
    fill, else 0). **Context**'s depth now falls from just above the horizon to the rim
    and its void erodes from the rim, measured on the disc (Fong square→disc) : round,
    the walls keep their light. **CRT Screen** drops its bezel and corners and moves its
    vignette below the horizon. Verified on a 210° master : round, no ring;
  - a **film on the default fit covers** the frame under full-dome fill (stretched into a
    square composition it came out squashed);
  - the **panorama's back seam** blends over 12° (each side toward the other, halfway at
    the seam) when the turns don't land the picture back on itself; `top` resets to 90
    like its default.

- **The ADSR modulator's times read in full** (`ModulationPanel.tsx` MiniSlider) : their
  boxes were 36 px against SUS's 40, so "0.96" or "3.45" clipped. Same width as SUS now,
  and one decimal from 10 s ("45.2"); measured : every readout fits its box.

- **A moved full-dome fill stays perfectly round** (`engine/dome.ts`). Fill's offset was a
  plain shift of the picture's disc, so any offset (or a modulator on it) slid that disc
  off the rim and the two circles cut the dome into a lens, pointed at the sides. It is
  now a disc automorphism (complex `(z − a) / (1 − conj(a)·z)`, |a| ≤ 0.9) : the
  picture's centre moves to the offset, the rim stays the rim. Verified at offset y 0.27 :
  a full round master. Cover and contain still slide the frame. The offset sliders say so.

- **The audio input no longer goes silent on a remembered device that is gone.** The
  audio tab kept the chosen input by its id only; an id that changed (the installed app
  and the dev app number devices differently, another USB port) or a device unplugged
  left the analyser silent, with no message in Both mode, the menu reading "Default
  input" : the audio modulators read nothing, even from the laptop's microphone. Now
  the device is remembered with its name (`audioDeviceLabel`) and found again by it, else
  the default input plays, said in a message and in the menu (`… (not here : the default
  input plays)`); a failure to open anything is said in every mode. Picking another
  device while the input runs reopens it (it waited for the input to be switched off and
  on).

- **Import audio plays AIFF files** (and WMA / CAF). The player can't decode them, and
  their audio-only copy was asked through the Collage's handler, which takes films only :
  the slot stayed silent. A sound file now has its own path (`audio:playable` : the file
  itself, or the copy made once by ffmpeg), asked before playing for those formats, and
  forced for a file the player refuses anyway (ALAC in an m4a).


### Docs

- **The 10-21 batch** : the README (56 effects with Shatter, Crawl and Store Zoom, 27
  native nodes with Field Store, 119 Generate themes, 125 master chains in six groups
  with Store, 20 blend modes in Contents; Search everything (`Ctrl+K`) with the global
  Ctrl keys moved out of the Sonify table; Persistent for whole effects, sources and
  modulators; the dome's rotations, gravity, mipmaps and grain; Flash safety on the
  dome; the architecture map), the release notes and the cheat-sheet's Persistent row.

- **Everything caught up with v1.3.0** : the README (sources 46 = 45 generators + the
  Audio source, 53 effects, 26 native nodes, 114 Generate themes in 17 families, 116 master
  chains, 11 Sonify voices; Contents reaches the Mixer, the four-step strip, shaping,
  World amount, the Output window, session media and Persistent; modulation targets,
  MIDI, OSC, Agent and the architecture map), the OSC reference (the `layer{n}` form,
  harmony, `/opsia/coupling`, coupling band and noisiness feature, World amount, scene
  recall, the Assemblage voice, 19 blend modes by name, real ranges; `/opsia/audio/noisiness`
  removed : never handled), the release notes (older-session notes, install, license, for
  developers), the cheat-sheet (Source Editor, World editor and mouse groups) and a hover
  hint on every control (81 added : 1169 inputs in 128 shaders). New pictures : Oil Cloud,
  Orbit and Oil Sky in the gallery, the compositor with the new strip, the Mixer, the
  Source Editor. The bibliography gains the papers the organic sources cite.

## v1.2.10 — 2026-10-15

### Added

- **The key sequencer's Every can move.** In free time, **every** has Sonify's M (a
  modulator or a Meta knob : the `keyEvery` target, 0..1 on the slider's own log map,
  250 ms to 5 min, so a swing moves it by ratios) and its readout and thumb follow the
  modulation; **vary** (`freeVary`, 0..1) draws each wait between Every / 4^vary and
  Every x 4^vary, even in log (as many shorter waits as longer). A modulated Every
  stretches the wait running from the last change. The wait running shows beside the
  key. Measured, Every 1 s : vary off 0.97 to 1.04 s (frame grain); vary 1, twenty waits
  from 0.32 to 3.77 s (mean 1.16 s); M1 bound : readout 2.0 → 6.4 → 4.8 s, waits down
  to 0.3 s as it swung. OSC `/opsia/sonify/keyseq/every` (seconds) and `/vary`.
- **Picture on your own keys** (Picture → **keys** : pool · list) : up to 8 written keys
  (`picSteps`, `picLen`, their own list, apart from List mode's), the picture picking
  the nearest : each key where its root sits on the circle of fifths (its color) and
  its scale among the list's moods, spread bright to dark (its light); a grey picture
  keeps the root where the list allows; the key it is on stays until another is
  clearly nearer (0.08). Drawn as dots on Picture's wheel. The dice draws new keys for
  it from the pool. Measured, four written keys over 40 s : 11 changes, all four
  visited, none outside the list. OSC `/opsia/sonify/keyseq/keys`.
- **The sequencers fold** : a chevron left of each sequencer's play button folds the
  card to its header (it keeps playing); remembered on this machine (`Shell`'s
  `collapsed` / `onCollapse`, the store's `collapsed` sections `soni-fxseq`,
  `soni-keyseq`).

### Changed

- **Sonify's modulation works like the Inspector's.** The M chip shows the modulators
  bound (M1·3) and a right-click clears all its modulation (bindings and Meta knobs);
  a click opens the Inspector's own binding row (`AssignRow` : M1–8 with depth and
  mode, the Meta knobs) right under its parameter, where the old mini panel opened at
  the top of the column, out of sight under a long voice or a sequencer. A modulated
  slider's number now moves with the modulation (`LiveNum`, on the shared live loop;
  only its thumb did), so does the Transmission's line rate. A new Sonify binding
  still swings around the value (replace : `assignMod` picks it for Sonify targets,
  which a multiply on a zero base would leave still).
- **The Modulation strip's count** (bindings in use of 32) sits under its name, so the
  bindings start at the row's left edge; red when the matrix is full.

### Docs

- The site's **New in 1.2.9** (no more clicks, sharp enlargement, empty layers, steadier
  controls, the Collage stand-in, the measured frame rate) and its links to the 1.2.9
  notes; the README's Architecture says an empty layer costs nothing; the OSC reference
  says a synced Spectra gives its own rate back when sync goes off.

## v1.2.9 — 2026-10-15

### Added

- **Sharp enlargement** (Output → Render scale, off by default) : the projector window
  enlarges a frame rendered below its size through a Catmull-Rom cubic over the 4x4
  texels around each point, instead of the bilinear blend of 4, clamped to the 4 nearest
  texels so a hard edge never rings (a dark line inside a white surround). The warp,
  its anti-aliased edges and the feather are unchanged; the compositor never uses it,
  and off, the window draws exactly as before. Measured on an M2 at render scale 0.75
  to a 1920x1080 projector : 41.6 fps off, 40.9 on (noise). `WARP_SHARP_FS`
  (warpQuad.ts), `OutputPresenter.setSharp`, `outSharp` in the store (localStorage
  `opsia.outSharp`) and in the output window's warp message.
- **A ¾ render scale preset** beside ½, 1×, 1⅓× and 2×.

### Changed

- **An empty layer costs nothing.** A layer with no source, no effect switched on and
  no trail drew transparent black every frame : a clear, a persist and a blend into the
  stack that changed nothing (mix(B, c, 0) is B). Once both of its persisted buffers
  hold that black (two frames), the three passes are skipped (`ISFLayer.skipBlank`,
  `drawLayer`; Consume still runs, it keeps a field). Verified on an installation
  session at 1440x810 : both empty layers skipped, their texture all zeros, and the
  skipped blend reproduces the real composite to the bit in add, normal, multiply and
  screen (0 of 4,665,600 values). 40.1 → 41.6 fps (M2, GPU 99 → 97 %).

### Fixed

- **Sonify's clicks are gone** (measured on its output, 10 s per case, a click = the
  waveform's curvature jumping far over its local level; Collage cases on two test films,
  the test clip with a steady tone : the worst case for hearing a step) :
  - **The Chord** (122 clicks while still, 129 with its count modulated, 30 at on / off;
    now 0, 0, 0) : each note's level and pan ramp sample by sample instead of stepping once
    a block; a smaller count fades the notes it leaves out (30 ms) instead of cutting
    them, and the notes that stay glide to their new pitch (60 ms); `setChordFreqs` takes
    both the config's and the modulator's counts. (Its first version also zeroed a RISING note
    under 0.003, which kept quiet bands from ever starting and the whole Chord silent at
    swell >= 0.9 s : the floor now applies only to a note fading out; measured, the
    levels are v1.2.8's to the tenth of a dB. And the spread's centre is searched within
    [-1, 1] : at a hard voice pan it drifted to the edge and snapped back to 0.)
  - **A voice switching off rang its mixer filter's tail out abruptly** : the engine
    stopped running a voice the moment its fade ended, cutting the filter's ring (a step
    at off, and another at the next on from its stale state, on any voice whose mixer
    filter is engaged). `DJFilter.busy()` keeps the voice running until the filter is
    silent; the on / off fade is 15 ms (5 ms thumped on a low note).
  - **The Collage voice** (82 clicks on a wall doing nothing, 32 muting its layer on and
    off, 279 with every film re-cut every 1.2 s and a deal every 1.6 s; now 0, 0, about
    10 rare decoder-level glitches) : a film's sound starts silent and fades in once its
    position has really moved on (the ready state said "sounding" ~30 ms after play(),
    before the sound reached the graph); it fades out before it pauses (its picture
    paused or hidden); a piece that changes films outside a deal crossfades instead of
    being rewired mid-wave; the speed follows the picture's but never in small nudges
    (each playbackRate change restarts the element's time-stretch : a click per nudge),
    drift being pulled in by a crossfaded re-sync past 0.15 s; the file's own loop point
    ducks; the voice switching off fades before it is released. Every fade is a
    `setTargetAtTime` scheduled 10 ms ahead : a curve started from `param.value` (which
    lags the audio thread) jumped by the difference, and a linear ramp on a gain with no
    automation event yet ramps from time 0 (an instant jump).
- **The audit of everything added since v1.2.7, the sound** (each measured the same way,
  on the output, before and after) :
  - **The output EQ and the glue no longer click** when a band moves, changes type or
    slope, or the EQ is bypassed (25 clicks in a Node run of the worklet, now 0) : a
    band's coefficients glide sample by sample across the block, a new band layout
    crossfades from the old one over 20 ms (the sections that stay keep their state),
    the bypass crossfades, and the input / output gains and the glue's gain are smoothed
    (they stepped once a block).
  - **Every path to the speakers goes through one output gain** that ducks around a
    change : Space on / off, the headphones preview, a new channel count, the Collage's
    piece groups, another output device. Rewired live, each one clicked. **Sonify off**
    fades out (15 ms) before the engine ends, instead of cutting the sound mid-wave.
  - **Space** : a new speaker matrix glides in over 12 blocks (about one update of the
    places) instead of one, then held : a moving voice's gains stepped 30 times a second,
    a buzz on held notes. Switched on, its sub filter and limiter start clean (not from
    the last time); the sub level ramps; a gain under -80 dB no longer counts as a
    speaker (the dust of a wide spread filled every list). An imported setup with a gap
    of 180° or more sends a voice outside every pair to the nearest speaker instead of
    silencing it. The headphones preview re-aims only the virtual speakers that moved
    (each one was re-automated 30 times a second) and its limiter sits at -3 dB (peaks
    near 0 dBFS got through). The speaker layout is looked up only when it changes (it
    was rebuilt and stringified 30 times a second), and a new OSC renderer (host, port,
    protocol, numbering) hears every object at once instead of only the moving ones.
  - **The Chord** : each note's place in the spread fan glides (60 ms) when the count
    changes, instead of jumping to its new place.
  - **The Collage voice** : a film with no sound at all gets no player (one decoded the
    whole video, all show long, to play silence); a modulated film speed splices to a
    fresh player instead of re-rating an audible one (a click per change); a piece that
    appears starts at its note, Q and place (it glided from 350 Hz while fading in : a
    chirp); a hidden piece fades after its resonators, not before them (dropped while
    they still rang : a click per hidden piece); the oldest retiring piece, past the cap,
    fades for 3 ms before it goes; a re-roll faster than the films load no longer
    restarts the wait for ever (the deck stuck on its old clip). Its leveler starts at
    the film's level when switched on (from 0 it let a loud film through 1 to 3 dB over)
    and a stray NaN no longer sticks it at full makeup. **Ring In** ramps across the
    block.
  - **Sound device** : a device picked while Sonify was off is applied (it came back on
    the old one); after the sound card restarts, the line-in opens again on the new
    context (it stayed held by the dead one, the Filter voice nearly silent).
  - **A recalled scene keeps the room's EQ and glue**, like a preset (a scene saved
    before the EQ existed reset it to flat).
  - **The key sequencer's Picture mode** learns only from frames really read : when
    nothing samples the picture, the last one was learned over and over and the palette
    shrank onto it.
  - **Tempo sync** (Spectra's sweep, SSTV's line rate) follows the tempo in the per-tick
    overlay : each tempo step pushed the whole config (30 a second from an OSC tempo
    stream; measured after, 60 steps, no push), and the rate you had set was lost to the
    last synced one (now it comes back when sync goes off).
  - **The Collage voice's notes glide** when the key sequencer moves to a scale of
    another length (minor's 7 notes to a pentatonic's 5) : they jumped, every other
    voice glided.
  - **Self-heal** spaces out its rebuilds when a device stays dead (5, then 10, then
    20 s; it rebuilt and logged every 5 s), and starts over once the sound runs.
- **The audit of everything added since v1.2.7, the GUI** :
  - **The EQ editor** no longer costs the picture : its curves are worked out once per
    change of the EQ instead of every frame (up to 9 ms a frame with steep bands, on the
    thread that drives the picture). It opens over the whole app (it took the voice
    column's 65 % dimming while the sound was off), hides while another page covers
    Sonify, and keeps the keyboard : `M` switched the view and closed it, `S` closed
    Sonify, `1` to `9` recalled scenes, `0` flushed. A point moves only once dragged past
    3 px, held where it was grabbed (a click a few pixels off moved it, or switched it on
    between the two clicks of a double-click); the right button no longer drags; the
    wheel sets Q over a point only and never scrolls the editor too (elsewhere it
    scrolls, with Ctrl it zooms the UI); `Backspace` in the slope menu no longer turns
    the band off; a press in the panel released on the backdrop no longer closes it.
    The number boxes go back to the value on an empty or unreadable entry (a cleared
    frequency jumped to 20 Hz) and take "1.5k". The card redraws only when the EQ
    changes; the meters stop drawing while the page is covered; the canvases are sharp
    at any UI zoom.
  - **A Shift-drag on a Sonify slider** wrote back the whole config of its grab on
    every move, undoing whatever changed meanwhile (the key sequencer, a Meta knob,
    MIDI; switching the sound back on). Every write now starts from the config as it is.
  - **Space** : clicking a voice on the room map no longer stops it following and
    jumps it (it moves once dragged, held where grabbed, left button only); Shift
    pressed mid-drag on a number box slows what comes next instead of jumping the value
    back; a refused host (a name, not an IPv4 address) keeps the address before and
    says so (it fell back to this computer, silently); the number boxes keep their
    figures in a narrow column and show their drag hint; the map reads the theme once
    per theme and rests while covered; a modulation box no longer follows to another
    view.
  - **The key sequencer** shows the scale's name, cut short before the progress bar
    is squeezed, and its scale chips keep their names whole in a narrow column.
  - **Arrow keys** move the Collage's "films in", "ring in" and "hp" sliders (each
    press snapped back).
  - **The warp feather** is saved once the slider rests, and a full storage no longer
    stops the slider. **A session saved before the output EQ** keeps this room's EQ and
    glue instead of flattening them.
- **The audit of everything added since v1.2.7, the picture** (measured on the test
  copy with the window never throttled : a 12-piece Collage wall with every Sonify voice,
  the EQ and the glue on, the page closed or open in every view, the EQ editor open,
  Space on a dome over headphones : 60 fps, the 99th percentile frame at 16.9 ms, the
  worst at 18.5 ms, no long task) :
  - **The warp feather** only applies with the warp on : left set, it faded the
    projector's frame, and a domemaster's rim, with the warp off or the dome on, while
    the control window showed sharp edges.
  - **The Collage's lazy films** : a piece on a film still loading (a jump in `cuts`
    from a knob, OSC, a morph) shows a loaded film until its own first frame lands,
    instead of black or a frozen frame of the deck's previous film at the wrong crop
    (measured : 2 to 12 pieces at once, no black). A churning film that has just lost
    its piece is dealt, not loaded and let go 1.5 s later. The pile's piece-ID target is
    freed after 5 s unused (33 MB at 4K, 67 on the dome) and its draw buffers are no
    longer rebuilt each frame.
  - **The warp** : corners crossed or pushed in fall back to the plain corners instead
    of drawing a stretched double wedge through infinity, and a side of a few pixels no
    longer smears the edge.
  - **The Sonify taps** read one stacked strip of a fixed size : a voice switching its
    second tap on or off resized it, and the whole readback ring was made again.
  - **The render loop** : the Sonify and Space ticks are each guarded (a throw skipped
    the shader warm-up and the FPS meter, and flooded the log 30 times a second); the
    warp sent to the output window is compared value by value (a string was built every
    frame).
  - **Performance** : a **Frame capture** row (recording, NDI, Spout, the projector
    stream, the dome preview) apart from **GPU wait**, where a whole 4K frame's copy hid.
  - **Collage films' sound copies** : each ffmpeg run has a time limit (a film on an
    offline share held the queue, and every film after it, for ever), and a film
    ffmpeg could not open is no longer marked silent for good.

## v1.2.8 — 2026-10-15

### Added

- **18 scales** (Sonify's key, the key sequencer's pool and steps) : the set of Berklee's
  scale reference. New : harmonic minor, ionian, mixolydian, aeolian, locrian, major
  pentatonic, major blues (1 2 b3 3 5 6), minor blues (1 b3 4 b5 5 b7), diminished W-H
  and H-W; `pentatonic` (its id kept) shows as the minor pentatonic it always was. The
  ids keep their old indices over OSC (0..7), the new ones follow (8..17); a name can be
  sent as its id or its label (`scaleFromName`). Menus follow the reference's order
  (`SCALE_ORDER`, `SCALE_LABEL`), the pool's chips sit six to a row (`SCALE_ABBR`).
  Major / ionian and minor / aeolian are the same notes : the sequencer's pool keeps one
  name per set of notes and its modes compare scales by their notes (`sameNotes`), so a
  change is never to the same notes under another name (0 in 48 steps over OSC). Pivot
  walks all seven degrees (mixolydian V and locrian VII join), the brightness order holds
  all 17 sounds (`BRIGHT`), the dice draws from the new ones too, and the Pivot ladder
  and the Picture moods shrink to fit 17.
- **The Collage voice's comp** (Sonify → Collage, after lp) : ONE leveler on the films'
  whole bus inside the worklet (`Leveler`), before the Ring bank, its gain applied to the
  Space piece groups too : never one per film. A power detector over both sides (30 ms up,
  400 ms down), a 10 dB soft knee, one knob taking the threshold from -8 to -30 dB and the
  ratio from 1.5:1 to 6:1, the makeup 80 % of what a -16 dB film loses; the gain is
  computed every 16 samples and smoothed per sample. Measured in the test build : two
  films 26 dB apart come out 22.7 dB apart off, 16.1 at 50 %, 6.4 at 100 %; 0.02 % THD on
  a 40 Hz sine (wind never ripples it); 0.12 % of one core. A ported freeware bus
  compressor (MIT) was measured first and turned down : settled, it over-compresses (louder in,
  quieter out above about -12 dB) and takes one to two seconds to catch a loud film. Its
  reduction is live beside the label (`collageCompGr`). OSC `/opsia/sonify/collage/comp`.
- **Glue** (Sonify → mixer, under the output EQ) : one compressor on the whole Sonify
  mix in the `soni-eq` worklet, after the EQ's bands and before its output gain and the
  soft ceiling, running with the EQ bypassed too : the port of Loopex's master glue
  (peak detector, threshold 0 to -12 dB and ratio 1.5:1 to 4:1 on one knob, soft knee,
  automatic makeup) with five voicings from its EQ table : **clean** 3 / 300 ms, 5 dB
  knee; **warm** 3 / 400, a drive that grows with the reduction; **punch** 3 / 200, the
  detector's thrust tilt (the highs over the lows at 632 Hz) and an odd-sided drive;
  **bite** 1 / 200, a 2 dB knee; **slow** 30 / 600, a 10 dB knee. The gain is computed
  every 8 samples (it was 0.9 to 4.5 % of a core per sample, now 0.1 to 0.55 %), the
  drive is the rational tanh, and on / off crossfades over 20 ms. Saved in `SoniEq.glue`
  (`normalizeEq` fills it, the EQ's reset keeps it). A GR bar on the card (`glueGr`).
  OSC `/opsia/sonify/glue/on · amount · voice`. Measured (amount 1, clean) : -30 dB in
  → -25.9 out, -3 → -6.4.
- **The Chord's voices are a modulation target** (`chordVoices`, 2..16, whole notes) :
  a modulated count reaches the worklet as the chord's notes alone (`t: 'chord'`), only
  when the count changes, and the slider's count comes back when the modulator lets go.
  Measured : an LFO walked it 2..16 and back; released, 7 again.
- **The Collage Ring bank's cutoff reads in Hz** (the worklet's own mapping : half an
  octave under the lowest band to one over the highest, on the key), and can be typed.
- **The Collage voice's films in** (Sonify → Collage), for windy or hot recordings :
  **films in** (-24..+12 dB on each piece's input, before the resonators), **hp** (each
  film's deck bus → two Butterworth high-pass sections, 24 dB/oct, 20 Hz..1 kHz) and
  **lp** (two Butterworth low-pass sections, 24 dB/oct, 1..20 kHz, its slider in 0.3 %
  steps and its readout to 10 Hz) before every piece of that film, and **ring
  in** (-24..+12 dB into the Ring bank : it scales the bank's input and the dry level its
  follower matches, so the wet and the bands' clip both follow it; scaled on the input
  alone, the follower undid it). OSC `/opsia/sonify/collage/input · hp · lp · ringin`.
  Measured on the test clip : films in -12 dB, the voice -12 dB; hp 300 Hz, -12 dB (its
  energy is low rumble); ring in -12 dB at full wet, the bank off its clip. Web Audio
  reads a low- or high-pass `Q` in DECIBELS : the Butterworth sections take -5.33 and
  +2.32 dB (0.5412 and 1.3066 given as plain numbers rang, +3.8 dB below the corner).
  Measured (`getFrequencyResponse`) : lp 2 kHz flat to 1 kHz, -3.0 dB at 2, -24.7 at 4,
  -51.4 at 8; hp 200 Hz flat from 400, -3.0 at 200, -24.1 at 100, -48.2 at 50.

- **Space : Sonify in the room** (Sonify → ◎ space). The worklet gains a second output
  of up to 32 channels fed by a gain matrix (each voice's left and right, and the FX
  tail's return, to every channel), with the subwoofers' low end (two cascaded
  Butterworth low-passes) and one limiter over every channel; the stereo master is
  untouched and still feeds the recordings. **speakers** pans each voice onto a layout
  with VBAP and an MDAP span (`shared/spatial.ts` : the speaker hull as the convex hull
  of the speaker directions, closed by a virtual nadir under a dome, coplanar faces
  fanned once); built-in quad / rings / domes, or an imported **SpatGRIS speaker setup**
  (`SPEAKER_SETUP` XML : speaker n on channel n, gains, muted left out, direct-out =
  subwoofers). **objects** sends each voice on its own channel(s) and its position over
  OSC : SpatGRIS `/spat/serv deg` (port 18032) or ADM-OSC `/adm/obj/n/aed` + `/w`, only
  what moved, everything every 2 s. A voice **follows** the picture (what Sonify reads :
  sweeps, probes, the latest onsets, the Collage pieces) through the inverse of the
  dome mapping in every mode, the dome stage's spin included (checked against the
  shader : 0.0000° worst error over 5,000 points), or sits **fixed**; width, span, spin
  per voice; turn / mirror / glide for the scene; a live **Room** map. The venue setup
  is per computer (`opsia.space`), the voices' places travel with the session
  (`spaceVoices`). Clean-room : no SpatGRIS code (GPL-3.0), only its OSC and file
  format. Measured in the test build on a Dome 8 + 4 + 1 : zenith → the top speaker
  alone; 90° on the horizon → speakers 3 and 4 even; width 90 → 2 to 5; turned 180° →
  7 and 8; objects in pairs → the Chord on channels 15-16 and `/spat/serv deg 15/16`;
  back to stereo → the EQ path and 2 channels again. On the Satosphère's own setup (93 +
  5 subs) : 185 triangles in 53 ms, every speaker alone at its own direction, unit
  power to 1e-15, a voice under the horizon on the lowest ring.
- **Space, played** : each voice's place (az, el, width, span, spin) is a Sonify
  modulation target (`space.<voice>.<field>`, a `SonifyModParam`) : modulators, Meta
  knobs (their commit lands in `store.space`), the M chips of the Space view's voice
  sliders, labeled `SPACE <voice> <field>` in the matrix. Azimuth modulates over two
  turns and wraps (a sweep spins a voice instead of clamping at 180; measured : an
  LFO on the Chord's azimuth turned it round). OSC `/opsia/space/mode · turn · glide ·
  mirror · headphones · pieces` and `/opsia/space/{voice}/az · el · width · span · spin ·
  follow`, in OSCQuery. The venue setup is saved a moment after the last change.
- **Space : headphones** : the worklet's spatial output split per channel, each through
  a Web Audio `PannerNode` (HRTF) at its speaker's or object's direction, summed to
  stereo on Sonify's output (`sonify.ts` `setSpacePreviewDirs`). Measured : a voice at
  90° right, 0.17 / 0.07 right / left; at -90°, 0.18 / 0.07; at the zenith even.
- **Space : Collage pieces as sources** (0 to 30) : the Collage voice's output is now a
  32-channel merger (its stereo bus on 0-1, piece groups on 2..31), each piece chain's
  deal crossfade moved before its panner so its mono can be tapped; a piece takes an
  empty group or joins the nearest one (by this update's running centroids). In the
  worklet the Ring bank gives its wet alone and the dry's share per sample, so the
  voice's own pair keeps only the bank and every group leaves at the dry's share,
  through the voice's gate and gain. Each group sounds where its pieces are, through the
  dome mapping. Measured : 8 groups on a Dome 25 reach 8 speakers (the voice as one
  pair : 6); as objects, the 8 piece channels after the voices all sound and the
  voice's pair is silent with the bank off.
- **Satosphère** in the Fulldome section : 4096², 210°, full dome (fill), NDI at 60 fps
  (UYVY, native size), Sonify as objects to SpatGRIS. Dome and NDI on / off untouched.

- **Sonify output EQ** (mixer view, under the FX tail) : twelve bands after all of
  Sonify, to tune the room : low cut, low shelf, eight bells, high shelf, high cut,
  each with frequency, gain, Q and a slope of 6, 12, 24 or 36 dB per octave. A
  miniature curve on the card with input and output meters, and a pop-out editor :
  the curve over the live spectrum before and after, points to drag, the wheel for Q,
  input and output gain (±24 dB) with their meters. A soft ceiling keeps the output
  under 0 dB. Speakers only (recordings are taken before it); presets, the
  sequencer and ↺ default leave it alone. Measured against the curve it draws :
  within 0.4 dB across nine settings, bypass exact.
- **Feather for the projection warp** (Output → Mapping) : the warped frame's edges
  fade into the black over 0 to 200 projector pixels, rounded at the corners. Saved
  with the warp (this computer's, or the session's when the warp travels with it),
  applied on the projector window and on the control window's own warped preview.

### Changed

- **Sonify's sliders dial finely** : Shift-drag moves any of them at a tenth of the
  speed (relative to where the drag starts; a track is a hundred-odd pixels, about 2 %
  of a log frequency range per pixel). The Collage voice's films in, hp, lp and ring in
  take a **typed** value (click the readout : `4250`, `4.2k`, `4.25 kHz`, `off`, `-6 dB`;
  the shortcuts stay quiet while typing). Measured with real input at UI zoom 115 % :
  Shift-drag 60 px, lp 2000 → 2220 Hz (a plain drag : 6450); typed `4250` → 4250,
  `3.1k` → 3100.
- **The Collage filters' slope is a choice : 12 or 24 dB/oct** (a chip right of the hp
  and lp labels, inside the label column so every track still lines up; 24 by default).
  12 = one Butterworth section (Q -3.01 dB) and the second section an all-pass (flat :
  the films' audio is never rewired, so a switch never clicks). Measured : lp 2 kHz at
  12, -3.0 dB at 2 k, -12.6 at 4 k, -25.7 at 8 k; hp 200 Hz at 12, -12.3 at 100. OSC
  `/opsia/sonify/collage/hpslope · lpslope` (12 / 24, or >= 0.5 = 24). A Sonify slider
  takes a `lead` (shown inside its label column).
- **The Prism reverb's crossover reads in Hz** : its low split (400 Hz at the default,
  `400 x 4^(x - 0.3)`, as the worklet computes it), both splits on hover, and a typed
  frequency (`250`) sets it.
- **The Collage's Ring bank controls grey out while its wet is 0** (they shape the
  bank, so nothing changes until it is up; still playable), and **wet** now heads the
  section.

### Fixed

- **The Sonify bar holds one row again at 100 %.** The 18 scales' full names widened the
  scale menu (a native select is as wide as its longest option : 121 px), which pushed
  the bar onto two rows. The menu now shows short names no wider than the old ones
  (`SCALE_SHORT` : 85 px against the old 86; the full name in its tooltip and in the
  key sequencer), and the bar is tighter : "S / Esc closes" moved into the close
  button's tooltip, shorter master slider and meter, the output menu capped at 150 px
  (ellipsis), narrower preset box and gaps. Measured with a 25-character output name :
  one row down to a 1,420 px window (it needed about 1,625).
- **The key sequencer's Picture follows the picture.** It read the root off a frame's
  chroma-weighted mean hue, and that hardly moves : it is the footage's cast (measured
  over time on eight generated looks : 5 to 30° of drift in 12 s, 1 to 4 roots; a
  Collage of one clip 2° in 20 s; the same for the most present hue, the hue that
  stands out and the hue of what moves), so a piece sat on one or two roots, a warm one
  on C, G and D, flickering between neighbours. It now reads against the piece's own
  palette (`soniKeySeq.ts` `updatePicture` / `pictureView`) : the reading smoothed over
  0.6 s, a 40 s memory of the palette (its circular mean and spread, saturation
  weighted : a grey picture moves neither) and of the light (mean and deviation), the
  distance from the palette's centre stretched so two deviations fill the half circle
  (never squeezed; a still picture's jitter never past 12°), the light's in its own
  deviations; **range** (`picRange`, default 1) blends from the plain wheel (0). A root
  or a mood changes only past 0.4 of a step beyond the border. One look for 60 s, range
  0 → 1 : hand-painted 2 → 6 roots, datamosh 2 → 3; no back-and-forth in either. The
  visual draws the palette's arc, the picture's own color as a tick, the dot where the
  key reads it. OSC `/opsia/sonify/keyseq/range · hold`.
- **The Chord's spread no longer leans left.** Its notes alternated up from the bass with
  every left note wider than its right neighbour and the top note (often the brightest
  band, a sky) hard left at 7 voices : one bright top band sat 19 dB left at full
  spread, a sky 3.8 dB. The notes now open in mirrored pairs counted from the top (the
  bass, and for an even count the note above it, in the middle), and the fan is
  recentred on the notes' levels : the centre that balances the two sides' power, the
  pans' hard edges included, found by halving about 90 times a second and glided over
  0.3 s. Measured in the worklet : every single bright band and a sky at 0.0 dB, the
  width kept (side / mid -5.2 dB at full spread, -6.2 before), the voice's own pan the
  same at any spread.
- **Switching Sonify off no longer leaves it running.** Its two worklets were only
  disconnected; with the audio context kept warm between takes, each off / on left the
  whole last patch playing to nobody in the audio thread, and its meter messages landed
  on the new engine's (the glue's reading flickered to "off", the EQ meters to zero).
  `stop()` now sends both processors `end` (their `process` returns false) and drops
  their ports' handlers. Measured : 68 messages in 2 s from a stopped engine before, 0
  after.
- **A typed Sonify value commits the field's own text** : Enter right after the last
  keystroke could commit the text from before it.
- **Space on headphones no longer distorts.** The binaural sum of the virtual speakers
  went straight to the device : the speakers near a voice add up almost in phase at the
  ears, so it ran 7.7 dB over the stereo mix with peaks to 1.13 to 1.41, clipped by the
  sound card (the engine's limiter sits before the panners). It is now trimmed to the
  stereo mix's level (0.41, measured on a Dome 25 with Orbit, Chord and the Collage :
  0.7 dB over stereo, peak 0.64) and limited (a `DynamicsCompressorNode`, -1.5 dB,
  20 : 1) before the device.

- **The output EQ's points drag again** (at any UI zoom). The editor turned the pointer
  into canvas pixels with the device pixel ratio, but the UI zoom is a CSS zoom, under
  which the canvas (sized from `clientWidth`) and the pointer disagree : every grab
  landed beside its point, and only the wheel, which falls back to the selected band,
  still worked. It now maps through the canvas's box on screen. Measured with real
  mouse input at UI zoom 115 % : the 1 kHz bell dragged right and up came on at
  1995 Hz, +9.7 dB; the wheel took its Q to 1.57.
- **Space, easier to play** : the numbers in the voices' table drag (up / down, Shift
  finer; a click types : 40 px up = +40° measured); a voice's dot drags on the Room
  map (the Chord from the zenith to the right edge : fixed at 90°, 0°); the Collage
  pieces playing show as small pink dots there (`spaceEngine.pieceDots`). "hear on :
  headphones · the output" sits under the output (the headphones toggle was easy to
  miss), and the too-few-channels warning offers headphones in one click. A voice's
  name has a ▸, an M badge when something is bound, and its assign box opens right
  under it (it opened at the top of the column, often scrolled away).

- **The piled Collage walls draw in about half the GPU time, bit for bit the same
  picture.** With the FX before the shapes, torn, shaped and stacked walls tested
  every piece's outline at every pixel in both passes. Now the films-only pass skips
  the shadows and edges it used to work out and drop, and the shapes pass reads the
  films pass's answer (the top piece, and a mosaic's nearest seeds, one 32-bit word
  per pixel) instead of searching again. Proven on a fixed wall (one deal seed,
  every film paused on the same frame), the build before against this one, read
  back as float : 0 of 8,294,400 values differ, all four shapes, FX first or not.
  (Working each piece's tilt and lobes out once per piece was tried and dropped :
  the CPU's rounding moved one boundary pixel a frame onto its neighbour's film.)
  GPU ms per frame at 1920x1080, 10 pieces, FX before shapes, on an M2 : shaped
  10.2 to 5.9, torn 14.0 to 7.6, stacked mosaic 10.9 to 6.5, stacked cut-up 5.6 to
  4.5.
- **Toile costs 60 % less at PAINT 0, bit for bit the same picture.** Its painterly
  pass (an anisotropic Kuwahara) ran every frame and was then mixed in at zero
  weight : an installation used Toile for its line work alone, 7.9 ms a frame at
  1080p of which 4.8 drew nothing. At PAINT 0 the pass is skipped (and a 1x1 black
  stands in for its target), no shader changed. 7.9 to 3.1 ms; the old and new
  builds' output on a real frame compared value by value, six settings (paint 0,
  0.5, 1, crisp and smooth strokes, radius 0 to 1, line 0 to 1) : 0 of 8,294,400
  differ. (Three shader rewrites that saved 0.2 ms more were dropped : each changed
  how the compiler rounded, 2 to 36 values a frame off by under 0.03 of an 8-bit
  step.)
- **A Collage loads only the films a piece can show.** Every deal loaded, sought and
  decoded a frame of every film of the `films` count, though pieces take their films
  in a fixed order and a wall of n pieces can only show the first n : at 30 films
  for 10 pieces, 20 files a deal for nothing. Now a film loads when a piece can reach
  it (the pieces now, plus one, plus the most a modulated count reached in the last
  two to four minutes) and lets go 1.5 s after its last piece. Every deal still draws
  from the whole folder. An installation's wall (30 films, 10 pieces, cuts and deal
  modulated) : 11 films loaded instead of 30, 2.2 loads a second instead of 3.8, the
  longest a piece waited for its film 0.25 s instead of 1.1; at 55 films, 0.5 s
  instead of 10.3. A fast auto deal (rate under a second) still loads every film,
  the ones on screen first and the rest one every 120 ms. The `films` hint says so.
- **Sonify's Collage voice reads a hundredth of the data.** It heard each film from
  its original file, and an `<audio>` element playing a video file reads the whole
  file to get at its sound : 15 to 36 Mbit/s of iPhone picture per piece for 0.15 of
  sound. Each film now plays an audio-only copy (its first sound track stream-copied
  when it is AAC, AAC 192k otherwise; about 0.2 s to make, in the background, the
  whole pool as soon as the voice sees it). Measured : the same sound sample for
  sample (0 difference, 0 offset), 648 KB instead of 59.8 MB for a 30 s clip, and
  ten films playing cost the main process 0.5 % of a core instead of 6.1 %. A film
  with no sound is noted once and never probed again.
- **Sonify's Collage voice glides only what moves.** Every piece sent its twelve
  parameter glides about 30 times a second whether they changed or not, each a new
  event on the audio thread (about 1,440 a second for 4 pieces); now about 5. The
  same curves : a repeated glide to the same target traces the same approach.
- **The Performance tab no longer blames Sonify for a full GPU.** A read of a picture
  the GPU already drew (the projector stream, the Sonify taps, vision, depth, lights,
  mark) waits for the GPU process, and with the GPU full that wait is milliseconds
  whoever asks. It was charged to the row that asked : an installation read Sonify at
  8 to 30 ms a frame, and a CPU profile put 63 to 142 ms of every second inside its
  read, nearly all of it waiting. The wait now has its own row, **GPU wait**, taken
  out of the others : on that installation's session Sonify reads 0.3 to 0.6 ms a
  frame and the output stream 0.1, with about 35 ms of GPU wait per frame between
  them.
- **The Collage voice reuses its players.** A film jumping within its clip (a window
  loop, a re-cue) built a new audio player for every jump, opening and decoding its
  file again, and threw the old one away. The old one now stays loaded as the film's
  spare and takes the next jump : in a forced test, 14 of 24 jumps on 8 films were
  served by a spare, every one taking over and playing. Its rare error is now logged
  by name instead of as `[object DOMException]`.
- **The media keys and the Now Playing panel leave the instrument alone.** Every film
  the Collage voice plays is a media element, so the app announced itself to the
  system's Now Playing about once a second (50 to 86 times a minute in an
  installation's system log, none now), and a keyboard's play / pause key could have
  paused the instrument's own sound.
- **A keystoned projector edge no longer steps.** The warp drew its quad bare, so a
  nearly vertical side became a staircase of very long one-pixel steps : measured on
  an installation's projector, the left side ran from x 111 to 119 down 1080 rows, 9
  steps of about 120 rows and not one blended pixel, which read on the wall as long
  lines down the sides. The quad is now drawn 2 px larger, with the same perspective
  mapping carried past its corners, and the shader turns each pixel's distance to the
  frame's edge (in output pixels, from the screen-space rate of the texture
  coordinates, so it holds under any keystone) into coverage. Measured through the
  same corners on a 1280x692 projector window : 644 of 679 rows now blend their edge
  pixel (0 before), the rest falling exactly on a pixel boundary, over a 1 px ramp at
  feather 0 and 17 px at feather 20. The warp now lives in one module
  (`engine/warpQuad.ts`) shared by the compositor and the projector window, which had
  each kept a copy.

- **The iPhone feed costs a third as much.** It was scaled to fit 1920 px on its LONG
  side, so a portrait phone arrived 887x1920, nearly twice the height of the picture
  it is drawn into, and every frame (6.8 MB) was copied to the GPU through the same
  command queue the picture's readbacks wait on : on an installation, the phone's
  frames caused about half of the window's blocked readback time. A frame now fits
  inside 1920x1080 (the addon's open() takes a box) : a portrait iPhone X arrives
  499x1080, a landscape 1080p camera or capture card unchanged.

- **Sonify reads its two taps in one readback.** Each tap read the picture back on its
  own, and on a GPU that shares memory with the processor collecting a read is a
  synchronous round trip that waits behind everything queued before it, whatever its
  size : the two 96x96 taps blocked an installation's window about 90 ms a second.
  Both sources are now drawn side by side into one 192x96 strip and read once a tick
  (`GridReadback.kickStrip`, `Compositor.readSonifyGrids`); two taps on one source share
  its cell. Measured : both taps update every tick (21 of 21), each with its own picture
  (all 9216 cells differ between a master tap and a layer tap).

### Docs

- **The documentation catches up with v1.2.8** : the README opens on the sound and the
  dome, Space's places join the list of Sonify modulation targets, the contents name
  the output EQ, the Collage voice's row says its films play from audio-only copies and
  stay out of the media keys and Now Playing; the release notes get their intro, the
  older-sessions note, the install table, the notes on the 32 channels and the venue,
  and the developer notes for Space. The site's "New in 1.2.8" waits for the release.
- **The documentation catches up with the late 1.2.8 work** : the cheat-sheet (`?`) and
  the README's shortcuts get the Sonify gestures (Shift-drag, typed values, the EQ's
  points, the Space drags); the README's contents name the 18 scales and the glue, the
  Chord's voices, noise and air join the Sonify modulation targets, and its OSC list
  gains the glue, the key sequencer and the scale by name; a brand name leaves the
  release notes. The site's "New in 1.2.8" (held for the release) names the comp, the
  glue, the 18 scales, the Chord's modulated voices and the Picture that follows.

## v1.2.7 — 2026-10-13

### Added

- **Mirror in a source's framing** (webcam, live input, NDI, screen, video, Assemble,
  HIVE), on the fit row : off · left-right (the selfie view) · upside down · both. One more uniform in
  the framing blit (`XFORM_FS`) turning the picture over where it is read, so fit,
  zoom, pan, crop and feather stay in what you see and the People mask turns with the
  picture. Saved on the slot (`mirror`); Reset framing leaves it alone.

- **Output transform** : the whole finished frame moved as one picture on the flat
  output, the way the fulldome mapping moves it on a dome. Offset x / y, scale (0 to
  2), rotate, spin (integrated, so a new speed never jumps), feather, flip x / y and the
  edge (black, repeat, mirror), in one fragment pass after the flash limiter and before
  the keystone (`engine/outXform.ts`, `shared/outXform.ts`), skipped at identity and
  while the dome is on. The canvas and every capture (projector stream, NDI, Spout,
  recording, stills) show it; `lastPresent` stays the unmoved frame for the crossfade
  and freeze copies, vision, depth and Sonify. A new modulation target kind (`outx`)
  gives every slider an M (modulators and Meta knobs); OSC `/opsia/output/x · y ·
  scale · rotate · spin · feather · flipx · flipy · edge · reset`, in OSCQuery too.
  Saved with the session; New and older files load at identity. Output page →
  Output transform. Measured at 1080p : 60 fps unmoved, 59 moved, 57 spinning with
  mirrored edges.
- **More dataflou destinations, and every randomize over OSC.** dataflou gains
  `layer/1..4/mute`, `bg/opacity`, fifteen `randomize/...` triggers (the Transport's
  scopes, then master FX parameters, Meta knobs, the selected Inspector unit, the
  Sonify patch, the Resolume pins and the Background's dice, which only MIDI Learn
  could fire before) and the output transform (`output/...`). OSC gains the same
  randomizes as `/opsia/randomize/masterparams · meta · inspector · sonify · resolume ·
  background` (MIDI Learn's own triggers, so all three fire the same action). The
  DECLARE leaves out every field whose value is what all the mesh's decoders read for
  a missing key (the core, its TypeScript port and ours, checked field by field on all
  119 entries : no mismatch), so it shrinks from 86 entries / 7,316 bytes to 119 /
  7,119, under the 8 KB a Teensy node takes. The `bpm` destination now spans 20 to 800,
  like OSC.

- **Vary over OSC and dataflou.** `/opsia/vary` fires the global Vary (the Transport's,
  at its spread) and `/opsia/layer{1..4}/vary` a layer's Vary (at its own amount), on
  the rising edge like the other triggers (a held value fires once), each listed in
  the OSCQuery tree. The dataflou node declares them as Palinopsia destinations,
  `scene/vary` and `layer/1..4/vary` (bools), so any node on the mesh can vary the
  whole scene or one layer. The DECLARE grows from 81 entries / 6,932 bytes to 86 /
  7,316 (measured with the node's own encoder), still under the 8 KB a
  microcontroller node takes. Tested : two `/opsia/vary` presses fired the global
  Vary twice and a held value once, `/opsia/layer2/vary` varied layer 2 alone.

- **Collage : two new shapes, `stack` and `warp`.** `shape` gains **torn** (ragged
  paper scraps, tilted up to 24°, each around its cell of the cut-up partition and
  padded past it by its deepest bite so the wall stays covered; the outline is a
  tapered box displaced by three noise octaves and a cubed low-frequency bite, scaled
  with the scrap) and **shaped** (an ellipse around the tilted cell, its radius
  modulated by 2, 3 and 5-lobe harmonics of per-piece size and phase). Both are always
  a pile. **`stack`** (0..1) grows every piece past its cut (cut-up : per side, up to
  0.42 of its smaller side and 0.4 of the mean piece; mosaic : all round, up to 0.24
  of the mean seed spacing, measured against the borders shared with the pixel's three
  nearest seeds, so grown shards keep straight sides) and gives each piece a height
  (a per-id draw, also now the torn-paper over/under order, so a modulated `cuts`
  never reshuffles it). The highest present piece holding a pixel shows; higher pieces
  cast a penumbra shadow offset 0.05 x stack x the height gap toward the bottom right
  plus a contact shade; lower pieces dim up to 20 %; a 1.5 px rim lights or shades the
  edges by their facing. Masked pieces drop out of the pile, the runner-up shows
  through a fading one, and a shadow past every piece reaches the layers below as
  alpha. The film of a grown, torn or shaped piece is cover-cropped to its new rect
  (torn and shaped tilt the film with the piece), never stretched. **`warp`** (0..1)
  bends every shape its own way and every piece differently : the cut-up's partition
  is bowed around a per-deal point plus three per-deal swells (fading at the frame, a
  one-to-one map) and every cut-up or mosaic piece lenses its own film (bulge, pinch,
  swirl or ripple, by its draw); mosaic seeds carry per-seed weights (curved borders,
  unequal shards); torn scraps curl along, across or into an S; shaped cut-outs swirl
  or bend into a crescent. The pile programs (four shapes x torn edge) compile on
  first use through `KHR_parallel_shader_compile` and the wall draws its flat cut
  until they link, so nothing hitches; a wall with stack 0 on cut-up or mosaic runs
  the flat programs. Measured on the Aero (1080p, one clip, 14 to 64 pieces, every
  shape, stack, torn edge and warp) : 56 to 60 fps. Ten new presets (*Pile*, *Torn
  pile*, *Shard pile*, *Scrapbook*, *Torn scraps*, *Torn heap*, *Cut-outs*, *Swirled
  cut-outs*, *Bent wall*, *Curved shards*); the others now set stack and warp to 0. A
  **Paste-Up** Generate theme (Film Wall family) piles your films; Film Wall also
  deals torn walls, Contact Sheet and Projection Booth stay flat.

- **`Ctrl/Cmd+F` turns the Fulldome output on and off** from anywhere in the
  control window (not while typing in a field), with a toast saying which. In the
  cheat-sheet (`?`) and the README's shortcut table. Plain `F` still opens the
  Finishing column.

- **An iPhone or iPad by USB as a live input (macOS).** Plug it in, trust the
  computer, open its Camera app : the Live Input picker lists it (`📱 usb`) and its
  screen plays in the layer, by cable, nothing to install on the phone. macOS shows
  that camera only to an app that opts in, and as a muxed (sound-and-picture) device
  that Chromium's enumeration skips (it asks AVFoundation for video-type devices only),
  so a new addon captures it natively : `native/avcapture` (AVFoundation, N-API, the
  same recipe as OBS's mac-avcapture), run in a capture process of its own (an
  Electron utility process, see Fixed), frames scaled to a 1920 long side with vImage,
  BGRA to RGBA, sent to the window and moved on to the page.
  It lists every video and muxed device AVFoundation sees, so any camera Chromium
  misses comes through too. A device that is missing, unplugged or rebooted is opened
  again every 2 s for as long as a layer shows it, with a readout in the Inspector.
  Camera access is asked by the main process (a Mac mini with no camera of its own
  may never have been asked). CI builds the addon on the macOS job
  (`native/avcapture/build.sh`, which also loads it once and lists the devices); a
  failure there leaves the input unavailable, never blocks a release.

- **Framing : fit, a real crop, feather.** A video or capture source's **fit** is
  *stretch* (the default and the old look), *cover* or *contain* (the aspect kept,
  from the picture's own size). **Crop** now CUTS the edges away where they are (it
  used to stretch what was left over the whole layer, so a session that cropped a
  source now shows the same picture cut instead of stretched : zoom fills again).
  **Feather** (0..0.5 of the layer height) softens the remaining edge, measured in
  output pixels from the shader's derivatives; at 0 the edge is crisp and
  anti-aliased. Measured : crop left 0.3 leaves the kept 70 % pixel-identical (mean
  difference 0) and the cut side transparent; feather 0.1 at 1080p ramps the alpha
  over about 115 px.
- **People : who is in a video or capture source.** A mode under the framing finds
  the people in the slot's own frames (`engine/personMask.ts` : its own body worker,
  MediaPipe Pose lite, the shipped model, 1 to 4 people with their masks merged, a
  320-wide feed, one frame in flight) and keeps the newest mask as an R8 texture in
  the picture's coordinates : **cut out**, **blur** (the background, nine taps on the
  picture's mip chain, rebuilt only while blur is on), **remove**, **matte**; **edge**
  softness, a readout (people found, ms a look). The body worker learned
  `cfg.people` (numPoses) and `frame.full` (an unhalved mask); the Body page's calls
  keep their defaults. Measured on a webcam clip : 1 person found, 10 ms a look; the
  matte and the cut out cover the same 13.7 % of the frame and remove the other
  86.3 %; the blur brings the background's mean gradient from 0.74 to 0.16.

- **Finalizer output shape : post warp, z tilt, z turn.** With **post warp** the
  shape is measured on the projector, after the Mapping warp : each pixel goes
  through the warp's homography (`warpHomography`, Heckbert's square-to-quad, the
  same projective map as the warp's quad) and the shape is evaluated in the
  projector's proportions (the output window's size, asked of main once a second
  through `output:size`; the composition's own without one), so the warp lands it as
  an exact circle. It is still cut in the frame, so the fill, the Background fill,
  the shadow and the feather all work; the edge is anti-aliased from the distance's
  own screen rate (fwidth), right under any warp. Off a domemaster only. **z tilt** /
  **z turn** lean the shape's own plane into depth (a fixed lens) : a circle becomes
  any perspective ellipse; the spin stays in the shape's plane. Measured under a
  lopsided warp, on the projector raster : post warp off 1.22 between the longest
  and shortest radius, on 1.008; z tilt 50° shrinks the height to 0.65 (cos 50° =
  0.64), z turn 40° the width to 0.77; with no warp, post warp on equals the old shape
  (max difference 0.0005).

- **The projector warp can travel with the session.** Output → Mapping →
  **save with session** (a per-computer choice, persisted) : on, a saved session
  carries the warp (on / off and the four corners, `Session.warp`) and opening a
  session that has one uses it, Installation boots included (`warpFromSession`);
  edits made then are the session's. The computer's own warp stays in
  localStorage, untouched, and comes back with a session that has none, with New,
  or when the option is turned off. Off (the default), the warp stays the
  computer's, as before. The unsaved-changes check counts the warp only when it is
  the session's. Measured : on, the corners round-trip exactly and an edit leaves
  the computer's warp alone; a session without one, or the option turned off,
  brings the computer's back.

### Changed

- **A randomize sent over OSC or dataflou now plays at the Transport's intensity**,
  like the dice and MIDI Learn (it always ran at full intensity).

- **The top bar stays on one line** in a window that is not full screen (it wrapped
  its right half onto a second line below about 1560 px at 100 % zoom; the default
  window is 1400). The header is a size container and its row gives up room in steps
  as it narrows, in its own CSS pixels so the UI zoom counts : the SESSION / GENERATE
  labels and some spacing first (the Load and Generate buttons say it), then width in
  the session name and the two menus, then the zoom readout and the "Learn" of MIDI
  Learn (Ctrl+= / Ctrl+- still zoom), then button padding and the title's letter
  spacing. Every button stays. Measured at 100 % zoom : one line at 1700, 1560, 1440,
  1384, 1300, 1200 and 1100 px; only the 1024 px minimum still wraps.
- **Every shader now has hover help** : the last nine (Erosion, Membrane, Swell, Dye
  Field, Ground, Scan, Mycelium, Grown, Posterize) explain every control, read off
  their code (what each does, which way it goes, what restarts the growth). Grown's
  "color" was a saturation amount, now labeled so (like Scan's). Erosion, Membrane
  and Ground grey out their light angle at relief 0, and Ground its drying unless the
  kind is cracked mud. Scan's description no longer names the library its scans come
  from.
- **The Inspector takes the least room in the most useful order.** An XY pad no
  longer sits in the flow of controls, where it stretched its whole row and left the
  rest of it blank (Ramps' center) : it stands at the right and the other controls
  wrap beside it, as the FX band already did. Grouped panels are as tall as their
  longest column, so the columns are now balanced : Colony 153 to 83 px, Perspective
  153 to 115, Reaction 118 to 85, Veins 114 to 76, Direct Marks 114 to 85, Mycelium 82
  to 66, Fluid 152 to 132 (measured on every source, node and FX : 121 panels, each
  loaded and its cells measured). Inside a column an x / y pair is two rows of its
  own, aligned and each with its M (Perspective's shift, Text's and Transform's pos,
  the latter now labeled). And a number box shows only the decimals its range needs
  (a range of 100 or more none, 10 one, 1 two, 0.1 three, less four), where a
  randomized 4.316481 overflowed it; the stored value keeps every digit.
- **Hover help for Slime Mold, Fluid, Reaction, Colony and Veins**, which had none :
  every control says what it does, which way it goes and when it waits for a regrow
  (Slime Mold's pattern size and Fluid's detail start over; Reaction keeps its living
  pattern). Read off each engine's code. The Colony, Toile, Granular and Tiles
  descriptions no longer name the researchers behind their models.
- **Twenty more Inspectors sorted into columns, inert controls greyed out.** An
  audit of every source and FX (124 shaders, read off their code) gave columns to
  the ones that read as a jumble in one row : Lattice (points · camera · well),
  Lowercase (figure · clock · deal · color), Text (type · place · motion), Direct
  Marks (marks · blink · hand), the whole organic family so it reads alike, always
  ending on the same LIGHT column (Slime Mold, Fluid, Reaction, Veins, Colony,
  Mycelium, Dye Field, Scan), the nodes Feedback (loop · motion · trails · key),
  Datamosh (mosh · motion · texture · bursts), Sillage, Autocutter (the Collage's
  pieces · edges, then recut), Mosaique, Transfert, and the FX Perspective (view ·
  surface · tiling · depth) and Transform (frame · mask). FX and nodes take columns
  in their own band now. The lighter ones stay one row. And 32 shaders grey out
  the inputs that provably do nothing in the current state (each rule read off the
  shader's code) : Feedback's keyer while it is off, its delay controls at delay
  echo 0; Palette's unused stops; Transfert's trail column in displace mode; light
  angle at relief 0 across the organic family; Lattice's camera height in a volume;
  Lowercase's split, scroll and accents per figure; Fluid's second ink, glow and
  relief per kind; and more. A greyed control still works, and an input driven by
  a modulator or a Meta knob never counts as off (its base can sit at 0 while it
  moves). The table lives in `GroupedControls.tsx` (`CONTROL_GROUPS`, `DIMS`); the
  two-row FX layout greys out too. Labels fixed on the way : Palette's colors read
  stop 1 to stop 5 (they showed colorA..E); Granular's "grain size" ran backwards
  (now "fineness"); Perspective's pair reads "shift", "waves" is "wave count";
  Tracking's band and rate are "band height" and "flutter rate"; Wide Time's drift
  and hue are "zoom drift" and "hue turn"; Datamosh's "motion gate" and "pulse (Hz)"
  are "motion floor" and "bloom rate (Hz)"; Autocutter's are "auto cut (Hz)" and
  "crossfade (s)" like the Collage; Chronoscan's "sweep speed" and "time curve";
  Parallax's "flip depth"; Transfert's "both ways"; Scanner's "rip size"; Sillage's
  "streak length"; Reaction's and Slime Mold's grid "pattern size" (beside their
  display zoom); two controls that were both named "accent" or "blade" now differ
  (accent color, blade amount); Ten Print's and Slabs' accent tint, Mycelium's
  "threads", Dye Field's "ground", Scan's "saturation" (it was "color"), Direct
  Marks' "marks", "count" and "hand", Differential's "layers"; four labels too long
  for a column shortened. **Slime Mould is Slime Mold** (American spelling), and two
  source descriptions no longer name the researchers behind their models. Names
  (OSC, sessions, presets, modulation) are unchanged.
- **The Collage's controls are sorted into four columns** : FILMS (feed, films,
  window, speed, speed spread, zoom), PIECES (shape, cuts, stack, warp, rotate, mask),
  EDGES (seams, torn paper, contour, curve length, contour mode, FX before shapes) and
  DEAL (deal, auto deal, crossfade, churn, freeze), one control per line, where they
  were one unordered wrapping row. Curve length and contour mode grey out while
  contour is at 0 (contour mode stays live while warp bends a cut-up). The grouping is
  a table (`SOURCE_GROUPS`, `GroupedControls.tsx`) any source can join; an input no
  group names lands in a last "more" column, so none can go missing. An `event` input
  (the deal button) now has a one-line form.
- **Collage holds up to 100 films** (was 50). The deck array keeps its 80 MB
  budget by itself (100 films get the smallest layer edge, 384 px : 59 MB). A film
  decodes only while a piece shows it and the wall has at most 64 pieces, so past
  64 the extra films wait in the pool and rotate in through churn and deal.
  Measured on the RTX 4070 with a 1080p clip : 50 films, 50 decoding, 60 fps; 100
  films, 64 decoding (64 cuts), 60 fps.
- **The right column fits its seven tabs on one line, exactly** : its width is
  measured from the tab row itself (the system monospace differs per computer), no
  wider, where it was a fixed 320 px and the tabs wrapped. A width dragged with the
  handle is kept (`opsia.layersWidthSet`); a double-click on the handle fits it
  again (it reset to 320). Widths saved before this fit again too. Measured from a
  hidden one-line copy of the row (gaps and the font's rounding at the current
  zoom included), with the scrollbar's room always kept (`scrollbar-gutter:
  stable` : without it the fitted width flipped between two values, a render
  loop caught in the test build). Measured : one line with 2 px to spare at UI
  zoom 0.8, 1 and 1.2; a dragged 530 px kept; a double-click back to 435.
- **Install scripts are allowed by name** (`package.json` → `allowScripts`, npm 11) :
  ffmpeg-static, koffi and esbuild run theirs on a fresh install (without it npm 11
  skipped them, so a clean clone had no ffmpeg); serialport's native build and
  electron-winstaller's are refused (unused here). Entries are unpinned so a version
  bump cannot silently block them, the trap that once left Electron without its
  binary.
- **The modulation matrix holds 32 bindings (was 12).** Twelve for a whole
  session filled up quickly by hand. The automatic binders (Randomize's modulation,
  Generate's motion, a World's audio route) keep the old budget (`AUTO_MOD_BUDGET`
  = 12), so a randomized session carries the same amount of motion as before and
  the other 20 stay for the hand.

### Fixed

- **An iPhone by USB shows up.** On a Mac mini M2 with an iPhone X it never did : the
  Live Input picker said "no video input devices" with the phone plugged in, unlocked
  and trusted, while QuickTime showed it. Three causes, each measured on that pair :
  - **The phone's arrival was never heard.** It appears a moment AFTER an app opts in
    (it switches its USB connection over first), and CoreMediaIO announces that
    through the main thread's run loop, which a Cocoa app like QuickTime runs all the
    time and Electron's helper processes never do; it has no setting to use a thread
    of its own (Core Audio does). The addon's new `pump()` runs that loop for a moment,
    and the capture process calls it while it looks for a device and a little all the
    time. Before : nothing, with QuickTime listing the phone. After : listed, and
    captured at 48 to 60 frames a second (887x1920 from the phone's 1126x2436 screen,
    about a third of a core in the capture process).
  - **A second asker loses.** The picker woke Chromium's own camera service and the
    USB input within a second of each other, and the second process to ask while the
    phone switches over misses it for good. The picker now asks the USB input first,
    and the capture process looks again for 3 s before answering "none".
  - **A process that let go of the phone wedged it for the next one** : after it
    quit, a new process waited 5 s for the opt-in and saw nothing, until about a
    minute had passed or the phone was replugged. The captures now live in a utility
    process of their own (`src/main/avcaptureWorker.ts`, started by
    `avcaptureHost.ts`), shared by the windows and alive for the whole session, so a
    window reload no longer lets go of it. The preload keeps the same API for the
    page.

- **The light output and MARK no longer cost the frame rate.** They were the last two
  readers still pulling the picture back from the GPU synchronously (v1.2.5 left them
  so) : the light output's zone colors (ArtNet/DMX, WLED) and the scanline behind
  `/opsia/av/mark-signal`. Where the GPU shares the computer's memory, each such read
  waits for the whole pipeline to drain, however little it asks for. Both now go
  through the ring of pixel-pack buffers and fences the vision features, the Sonify
  taps and the depth input already use (`engine/gridReadback.ts`, which now reads any
  width and height, and a region of the canvas as drawn) : the read is queued, then
  collected and sent the frame it lands. The values are unchanged : on a held frame,
  all 432 channels of a 16 x 9 zone grid and all 32 strip values matched a synchronous
  read of the same frame exactly, in the old build and the new one. Only the timing
  moved : a grid leaves about 16 ms after its frame was drawn instead of about 12 (the
  time the stalled read itself took), measured at 4 grids a second. Measured in an
  isolated test copy on an 8 GB computer with an integrated GPU, 60 Hz display, a
  light scene holding 60 fps, Performance tab open, three runs of each build : with
  the lights on, the tab's **Light output** row went from **5.9 to 6.9 ms per frame
  to 0.3 to 0.5**, blocking readback time from **354 to 363 ms of every second to 0**,
  the worst frame from **33 ms to 22**; with the lights and MARK together, blocking
  reads from **545 to 568 ms a second to 0** and the worst frame from **35 to 37 ms to
  22**. The light rate holds (30 grids a second under the default 40 fps cap at
  60 Hz), and so does MARK's (about 26 strips a second). The main process's own light
  limiter now leaves half an interval of slack : two grids can now arrive a frame
  apart, and a full interval there dropped about one grid in 40. The Performance tab
  gains a **Mark signal** row (0.5 ms per frame, nearly all of it collecting the
  landed row); the synchronous read it replaced showed in no row at all.

- **Two NDI or USB-input layers opening together no longer go black.** A session
  with two such layers asked the window for its frame channel twice in one tick;
  the second answer closed the first channel while both listeners took it, so
  every NDI (and USB-input) layer stayed black for the whole run. The channel is
  asked for once (`ndiIn.ts`, `avfIn.ts`).
- **Audit of the work since v1.2.6** (three independent reviews, each fix checked
  in a test build) :
  - People is released whenever its slot stops showing a camera or a film (a
    generator picked, the slot emptied, a New / Generate hand-over), where its
    model kept running; its readout follows a layer that moves; a new clip forgets
    the old silhouette; grain mode reads the voice on screen; NDI and USB frames
    are scaled down sample by sample before the model (a 4096 frame was copied
    whole on the main thread at every look) and a repeated frame is not looked at
    again.
  - Post warp on a square composition (letterboxed on the projector) uses the
    square's proportions : it came out an ellipse.
  - Framing (fit, zoom, crop, feather) reaches Assemble and HIVE sources : the
    controls showed but did nothing.
  - Modulation : an emptied slot counts as dead; the full state counts live
    bindings only; Assign-and-randomize says when the matrix is full; random
    modulation skips what Randomize leaves to the hand (the output shape, the film
    stage, blur).
  - USB input : a capture can no longer be opened for a receiver already let go;
    a start that delivers nothing is retried after 15 s; a frame's size is checked
    with its bytes (a phone turned mid-copy); the picker no longer lists Chromium's
    own USB cameras twice (their names carry " (vid:pid)"); the microphone is asked
    with the camera (macOS may refuse a sound-and-picture device without it).
  - A webcam missing at launch is found again by name only when its own id is gone
    and the name is unique (two identical cameras : never the other layer's).
  - The Finalizer says why post warp waits while the dome is on.
- **A full modulation matrix no longer swallows clicks.** The matrix holds 12
  bindings; once full, binding a modulator (an M chip's 1 to 8, a Meta bar slot, a
  Sonify row) silently did nothing, which read as "modulation stopped working"
  while the bindings already there kept running and the Meta knobs (outside the
  matrix) still worked. Binding now first lets go of DEAD bindings (an effect since
  removed, a source slot since emptied : they counted against the cap); if the
  matrix is still full, the modulator buttons grey out and say so, and a click
  says how to make room. Measured : 9 live + 3 dead → a new binding goes in (10);
  12 live → refused, with the message.
- **An imported video plays in its layer again.** The plain video source loads its
  clip from `opsia-media://` without asking for CORS, so the element was "tainted" (the
  page and the scheme are different origins) and WebGL refused every frame : a
  SecurityError on upload, the layer black. The Collage and Assemble films already ask
  (`crossOrigin = 'anonymous'`, the scheme answers with `Access-Control-Allow-Origin`
  since the Electron 44 fix); the video source and its grain voices now do too.
  Measured in a test build : the upload failed on every frame before, a clip uploads
  and plays after.
- **A camera that is not there at launch is looked for until it appears.** The
  reconnection only covered a camera that dropped out after it had started; one that
  powered up after the computer (an installation) failed once and stayed black. It
  now gets the same retries (2, 4, 8… up to 30 s, and at once when a device appears),
  found again by the name it was picked under.

- **Lowercase's accent and ground colors explain themselves on hover**, like every
  other control (they shipped in v1.2.5 without a hint).

### Docs

- **Caught up with the work since v1.2.6** : Generate's theme count (109, with
  Paste-Up) and Film Wall's description; the Inspector's columns, balanced panels,
  grey-outs and hover help; the right column's fitted width and the one-line top bar;
  Randomize and Vary fired over OSC and dataflou (every scope now, at the Transport's
  intensity); what a session file carries (output transform, framing and mirror, the
  optional projector warp); `outXform.ts` in the architecture map; the OSC reference's
  randomize rows. The site gets its **New in 1.2.7** section, 109 recipes and the
  1.2.7 release notes link.

- **Caught up with v1.2.6** : the README's source and effect counts (43 / 53, the
  Sources heading and its anchor), the modulation-target list (the layer Vary, the
  Background, every Fulldome mapping slider, Sonify, the Meta knobs), the native
  generators, dome stage and capture rings in the Architecture map, and a gallery row
  from the Space themes (Gravity Well, Line Wall, Crossing); the site's figures (43
  sources, 53 effects, 10 Sonify voices, 108 recipes) and the same three frames in its
  gallery.

## v1.2.6 — 2026-10-12

### Added

- **Fulldome spin reaches 360°/s** either way (a full turn a second; it stopped at
  30 on the slider and for modulation, 90 in saved settings). The angle is integrated,
  so even at that speed a change of spin never jumps the dome.

- **Fulldome : every mapping slider can be modulated.** A new modulation target
  (`{ kind: 'dome', field }`, ranges in `shared/dome.ts` `DOME_MOD_RANGE`) : rotate,
  spin, feather, turns, top, bottom, azimuth, elevation, width, roll, surround, scale,
  offset x / y. Each dome slider has an **M** (the assign row : modulators and Meta
  knobs; right-click clears) and, while bound, turns the modulated color (accent2) and
  follows the live value. A final override
  on the dome stage (`Compositor.setDomeParam`, the base back from the store every
  frame), so the stored settings never move; Meta commits land in the dome settings.
  Aperture and resolution are left out : they describe the venue, and the 3D preview
  maps the master with the stored aperture. Measured : a 1 Hz LFO on the screen's width
  swings it 54 → 100° while the stored value stays 100; dome off, the row moves nothing.

- **A Space family in Generate, and a Space group of master chains**, so the three new
  pieces are reached from Generate and the chain menu, not only from their pickers.
  Eight themes : **Gravity Well**, **Starfield**, **Crystal Room**, **Dot Sea**, **Spectral
  Floor** (Lattice), **Line Wall** and **Data Floor** (Lowercase laid on a plane by
  Perspective), **Crossing** (slant). Nine chains : Floor, Corridor, Ribbon, Horizon,
  Curved Screen, Data Wall (threshold, then the wall), Halftone Floor (Pixelmask dots,
  then the floor), Scan Relief (Rutt, then the floor), Starlight. Three recipe fields
  make them hold : **`stackFx`** (per-layer effects that close that layer's rack : the
  Perspective a Line Wall cannot do without, kept out of the chance draws of `layerFx`),
  **`bgOpacity`** (in group mode the Background shows through every dark part of the
  layers, so points of light on the drift-field ground read as mottle : the Space themes
  keep it at 0.2) and a motion recipe's **`skip`** (inputs a theme never binds : a moving
  count / cells re-deals every point, a moving repeat re-tiles the plane; side and audio
  do nothing until routed). **`flip` joins `seed` in the inputs no theme may sweep** : a
  modulated Lowercase flip inverted the whole frame on every swing (a strobe, seen while
  testing the chains). Starfield runs in the synthetic World : the sublimated one's haze,
  bloom and trails washed its small stars into a grey veil (mean 42-62, no black left).
  Measured in the test build, each theme generated three times : the theme's source on
  the bottom layer every time, Perspective closing the rack every time it is demanded,
  2-5 modulation rows, no console messages, getError 0; every chain applied over a still
  scene.

- **Lattice**, a new native source (`gen-lattice`, `engine/LatticeSource.ts`) : a
  lattice of points in space through a moving camera, a **plane** of dots or a
  **volume** the camera flies through. Each point is one instance of a 4-vertex strip
  whose cell comes from `gl_InstanceID` (no vertex data : a count change is a uniform),
  drawn as a capsule from where it sits back to where it sat **streak** seconds ago,
  anti-aliased over a pixel, floored at 1.5 px across (dimmer, not smaller) and capped
  near the lens (a passing star swelled into a ball a sixth of the frame tall). MAX
  blending into an 8-bit coverage map, then ink over ground in straight alpha : overlaps
  never add into a glow. Infinite : the cells wrap around the camera, whose position
  wraps at 4096 cells where every per-point draw and the swell noise repeat, so flying
  never ends and the wrap is seamless; the lattice's edge always fades. **well** /
  **reach** / **ripple** / **rings** / **pace** / **swell** / **audio** (the shared spectrum by
  distance from the well, read with `texelFetch` in the vertex shader) / **sidechain**
  (another layer's brightness where each point appears, read once per point). The
  registry contract gains an optional `feed(audio, side)` the Compositor calls before
  render (the Background feeds sound only); the Inspector's sidechain row now serves
  Lattice too, with its own hint. Measured on the RTX at 1080p : 57.7 fps at the
  default (200² = 40 000 points), 59.1 fps at 256² on the plane and 56³ (175 000
  points) in a volume; getError 0; no compile messages; the camera parked at 4095.5
  cells flew through the wrap with no step in the picture's brightness. Ten presets,
  hints, keywords, a blurb; the dice never colors its ink or ground.

- **Perspective**, a new effect : the layer laid on a plane in space and seen through a
  lens. **tilt** / **turn** / **roll** place the plane (up to 80 degrees, where it is
  almost edge on), **lens** is the focal length from a 9 degree telephoto to an 80 degree
  wide angle, with the plane kept at the focal distance so it fills the frame at any lens
  and only the convergence changes; **zoom** and **shift** move it. **bend** (a parabola,
  flat beyond 2.5 half lengths so a tiled plane stays a halfpipe) and **wave** (a sine
  that can travel, integrated so turning its rate never jumps the picture) shape it along
  **bend axis**. **repeat** : once (a card, transparent around it, its edge anti-aliased
  over one screen pixel at any distance), tile or mirror to the horizon. **travel** /
  **drift** slide the picture along the plane on integrated clocks, **fog** fades the far
  side into transparency, **shade** darkens by the true surface normal, **soften** filters
  over the pixel's footprint (four premultiplied taps along its long side; 0 lets the far
  side shimmer). A bent or waved surface is found by marching the ray across the band the
  surface can occupy (24 steps, first crossing kept so folds hide what lies behind) and
  six halvings; a plain fixed-point solve was tried first and never settled where the
  surface turns steeply toward a grazing ray (holes in the ribbon, slivers beside it).
  Measured on the RTX at 4K : 1.0 ms flat, 2.6 ms bent and waved; in the app at 1080p,
  Lowercase through a waved Perspective 59.9 → 59.8 fps. The dice leans it gently and
  always tiles (never "once"), so a roll reframes the picture in depth without opening a
  hole. Ten presets, hints for every control, keywords, a hover blurb.

- **Lowercase : a ninth figure, slant.** Full-height bars that each lean their own way and
  cross into X shapes and fans, dealt on the step and held like every other figure.
  **split** is how far a bar may lean (0 stands them upright, 1 crosses them steeply),
  **density** how many of the slots stand, **cells** how many slots; widths are drawn
  thin-leaning, so a few fat bars stand among many narrow ones. Each bar's stand, lean and
  width come from one draw, so a bar changes as one object. **scroll** slides it,
  **shear** breaks bars into steps, the accent marks one slot in every per² like the bars
  figure. Three presets : Crossing, Leaning comb, Fallen bars. The search for nearby bars
  covers exactly how far the lean can carry one, and nothing in the new branch reads a
  texture : a read there made the compiler run every figure for every pixel (measured on
  the RTX at 4K : all figures 1.9 → 12.5 ms). Measured at 4K : matrix 1.9 → 2.0 ms, bars
  1.9 → 2.2, slab 2.5 → 2.6 (within noise), slant 4.4 ms (about 1.1 ms at 1080p).

### Fixed

- **No more readback warning flooding the console.** The picture's read-back buffers
  (the vision, Sonify and depth grids, and every output capture : projector, NDI,
  Spout / Syphon, recording, the dome preview) were created as READ-usage buffers, for
  which Chromium copies the data into shared memory at every fence to serve the read
  from there. Our reads never used that copy, so each fence threw the previous one away
  and printed "READ-usage buffer was written, then fenced, but written again before
  being read back" : 256 times in 20 idle seconds from boot, which also used up WebGL's
  32-message console budget, so a real GL error after that would never have been shown.
  The buffers now carry a COPY usage hint, so Chromium makes no shadow copy at all.
  Measured in the test build : 256 warnings → 0 (idle and under stress), "too many
  errors" gone; a 1280-wide newest-frame capture 7.3 → 2.6 ms median (10.6 → 5.2 ms
  95th percentile), the grids unchanged at about 0.5 ms a read and landing more often
  (163 of 180 polls, was 143). Found with an isolated lab page on the same Electron :
  read-usage 38 warnings in 20 read cycles at 0.5 ms a read, copy-usage none at 0.2 ms,
  however long the read waited after the fence.

- **Fulldome feather works in every mode.** It only softened the master's rim (15°
  under the horizon on a 210° dome, usually black or out of view), never the picture's
  own edges. It now also softens the screen's border, the panorama's bottom (and top
  under a black zenith) and a cropped or contained full-dome frame, and **defaults to
  0** : every edge crisp but anti-aliased over about a pixel and a half of the master
  (at 0 the rim and the band edges were hard steps, and the screen kept a fixed 1.5 %
  softness of its own, 8 px on a 2K master). Measured on a white frame at 0.2 : screen
  border 168 px across, panorama bottom 428, a contained frame 522.
- **The Mapping grid no longer sits over a domemaster on the projector window.** Dome
  mode stopped sending the keystone to the output window but still sent the Mapping
  section's grid flag, so a grid left on from a projector setup stayed over the master
  there, with nothing in the Fulldome section to take it off (and never in the 3D
  preview, which reads the master itself). The Mapping section now says it sits out
  while the dome is on.
- **Top / bottom in Screen mode** shape the dimmed surround behind the screen (they did,
  745 pixels change for a top of 70° → 30° at surround 0.5, but sat among the screen's
  own sliders and read as dead). They now appear under *behind the screen*, only while
  there is a surround.
- **Dome spin is integrated.** It was rotate + spin × the show's elapsed time, so any
  change of spin swung the dome by spin × hours; the angle now accumulates frame by
  frame. Measured at 20 → 22°/s : the picture moves 2.8 across the change, 3.5 in a
  plain frame step.

## v1.2.5 — 2026-10-10

### Added

- **Lowercase**, a new source : machine-cut marks on a stepped clock. Eight figures, from
  a dense data matrix whose cells subdivide into one to three narrow bars, through blocks,
  columns, ticks, a scan rule and a thin lattice, to sprocket ladders down the frame edges
  and a single white slab with bars cut out of it. Everything lands on a step and holds,
  so the picture changes between frames and is still in between, which is what separates
  it from the optical fields of Op-Art and the hand-made edges of Direct Marks. It carries
  its own divided clock (rate up to 120 steps a second, divided by STEP up to 64, a deal
  held for up to 32 steps), so it pulses the moment you pick it, and its gate is a
  modulation target, so a Euclid, a Spastic or an audio transient plays it instead.
  HOLD, JUMP, SCROLL, SHEAR and FLIP decide how it reacts. Every deal is a fresh draw
  (measured over 119 steps : 44 new deals, no slides); SCROLL turns that by degrees into
  the same draw slid one cell per deal, up to only ever sliding, the field read as a
  stream of data. SMEAR recomputes the previous step and trails it behind, the way a
  filmed projection does, with no buffer to keep. CELLS runs
  to 512 : as cells fall below a pixel the grid figures stay crisp 1-bit static instead of
  averaging into gray, and the slab becomes a barcode of about 128 bars. A SIDECHAIN reads
  another layer one sample per cell, so a film arrives as a 1-bit halftone of cells on
  this clock; it is weighed by the layer's alpha, so where that layer is transparent (or
  when none is picked) the cells keep their own density. A single accent color marks a
  regular lattice of cells (one in a period squared, so it reads as meaning rather than
  as confetti). Flat, hard-edged, never radial. It holds its structure with no lattice
  or banding at 24 hours of show time.
  Cost on an Apple M2 : about 6.8 ms for a 4K frame (under 2 ms at 1080p), against 4.0
  for Direct Marks; the sidechain and the audio gate add under half a millisecond.

- **Signal**, a new Sonify voice, before Chord : read heads walk the picture on a
  clock and every cell they cross that is brighter than a threshold fires one
  micro-grain. It is a picture-driven version of the author's Signal instrument,
  and the one thing it drops is the thing that instrument needed most : its 35
  stored rhythms. Here the picture is the pattern, so a field of machine marks
  plays as data (point it at a Lowercase layer and the two close a loop). Kept :
  the micro-synth, as nine grains (pip, damped, noise, click, fm, square, tri,
  pink, ping) from a 0.2 ms tick to a 500 ms ring; and the polymeter, as one to
  four heads whose sweeps SPREAD pulls to 12, 10 and 7 sixteenths of each other.
  Pitch from the place along the bar, with a SNAP from free frequency to the
  scale whose middle is microtonal. Onsets land on their exact sample instead of
  the 128-sample audio block, which is what keeps a fast grid a grid : rendered
  offline, a grain placed 37 samples into a block started on that sample, where
  block quantizing would have moved it 101 samples early. All nine grains sound,
  none ever NaN, every one within 5 dB of the pip after trimming (pink had come
  out 13 dB under). All eight of its controls are modulation targets that move
  the sound, the scan's included : it reads the modulated values itself, where a
  detector reading only its base config would have ignored them.
  Every grain plays a fixed 50 ms after its step, so the grains keep the clock's
  spacing whatever the frame times do : 83.33 ms apart at 12 steps a second, with
  0.8 ms of jitter. Synced, it runs on the beat clock both Sonify sequencers share
  (125.0 ms apart at four steps a beat and 120 BPM). Each read takes the brightest
  point of its whole cell, so a mark thinner than the gap between two steps (a
  Lowercase barcode bar) still fires. The effects sequencer holds it and Auto picks
  it, for machine marks.
  Voices are stored BY INDEX (mixer channel, DJ filter, sequencer mask, MIDI
  binding), so Signal is appended as voice 9 and only SHOWN before Chord : no
  saved session's settings move to another voice.

- **A Vary for each layer**, under Speed : the global Vary aimed at one layer
  alone, with its own amount. Its button is a modulation target that fires on
  the crossing, so a Euclid or a Spastic can re-vary a layer on a pattern; an
  auto-fire stays out of the undo history. Each fire is a fresh variant around the
  layer as it stood before the first, as the global Vary works around its baseline,
  so a modulator can fire it all night and the layer circles your settings instead
  of wandering off. Every driver of one layer counts as one : two modulators fire
  4 times in 4 s, not on every frame, and a Meta knob on it leaves the blend alone.

- **Per-rack dice** on a layer's right-click menu : randomize the effects of
  source A, of source B, or the layer FX, leaving the sources and the other
  racks alone. Only the modulation aimed at the units that went is dropped. An
  empty source's rack is not offered. A new rack is a new starting point for the
  global Vary (so is Randomize layer), which used to deal the old rack back.

- **Every fired action blinks** : the Vary buttons, the global Randomize (button,
  R key, MIDI pad, OSC, every scope) and the six return-to-default buttons, each in
  the color of its kind of action. A return-to-default that disables or hides its
  own button as it acts still shows its blink, and reopening a panel never
  replays an old one.

### Changed

- **The frame rate is shown against the display's refresh rate**, in the Performance tab
  header and in the corner of the preview : `50 fps / 50 Hz`. The render is locked to the
  vsync of the display the window is on, so that rate is the ceiling, and a bare frame
  rate cannot be read without it. A fixed 60 was the reference before, which called a
  perfect 24-of-24 on a 24 Hz display a fault and sent a whole debugging session after
  it. The low-frame-rate warning turns red below 85% of the refresh rate rather than
  below a fixed 40, and the CPU frame-budget figures are measured against one frame on
  that display (20.0 ms at 50 Hz) instead of 16.7 ms. The rate is printed to two
  decimal places only when it needs them, because the platform reports a mode set to a
  round rate a hair off it (60.000003814697266 for 60 Hz) and a bare integer test let
  that through as `60.00 Hz`. Fractional rates that are real, like 59.94 and 23.98,
  keep their decimals.

- **The frames the GPU backlog guard dropped are now counted**, as `skips` beside the
  frame rate. The guard skips a frame whenever the fence from two frames back has not
  signaled, which keeps the driver's queue from running away under load. Those frames
  return before the frame counter runs, so they could never appear in the frame rate :
  nothing showed that the guard was throttling. A steady count there says it is; near
  zero says the frame rate is the display's own pace.

- **Dealt racks reach four effects** on both sources and the layer (they stopped
  at 2, 2 and 3, and a source rack was empty about half the time). Over 200,000
  deals : source A 0.70 to 1.65 effects on average, source B 0.55 to 1.48, the
  layer 0.95 to 1.77.

### Fixed

- **The picture readout no longer costs the frame rate.** Everything that reads the
  composed picture back as control data (the 17 vision features, the Sonify taps, the
  depth estimator's input frame) pulled its grid with a synchronous `readPixels`. That
  call cannot return until the GPU has finished every command queued ahead of it, so it
  drains the whole pipeline, and the drain costs the same whether you ask for one pixel
  or 64K of them : on a GPU that shares memory with the processor and resolves its render
  passes lazily, each read measured about 17 ms (1x1 and 256x256 alike). Opening the
  Performance tab turns the vision readout on, which read at 30 Hz, so the instrument
  spent 391 to 650 ms of every second stopped inside the graphics driver, and the cost
  showed nowhere in the frame budget because the stall happens below the app. The reads
  now go through a ring of pixel-pack buffers with fences, the same way the frame capture
  already did : the read is queued and collected one or two frames later, and nothing
  ever waits on the GPU. Measured on an 8 GB Apple-silicon Mac Mini, blank 1920x1080
  session, 50 Hz display, Performance tab open : **41.9 to 50.0 fps before (three runs),
  50.0 fps in all three after**; the app's own meter reads **1.4 ms of CPU per frame
  instead of 14.2**, of which the vision return is **1.0 ms instead of 13.5**; the worst
  single frame went from **42.8 ms to 5.5 ms**; blocking readback time per second went
  from **560 ms (mean) to 0.1 ms**. The picture is unchanged : the same passes, the same
  formats, the same resolution. Only when the bytes come back moved, and every consumer
  of them already sampled at 11 to 30 Hz, slower than the latency this adds. The queued
  read is submitted to the GPU only when nothing else will submit it : a window that is
  painting does that on its own a moment later, and a submit into a full command queue
  blocks until a slot frees, so submitting by hand there charged the wait to whichever
  section had queued the read (measured at 11.5 ms in the vision section of a scene
  holding the GPU at 98%, once its reads had all gone asynchronous). Measured on a 60 Hz
  display, that removed 26 flush calls per second, exactly one per queued read, and left
  the frame rate at a flat 60. Two readers still read synchronously, both off unless you
  use them : the light output's zone colors and the strip behind `/opsia/av/mark-signal`.
  A queued read hands its grid out once, so two Sonify taps on one source share each
  frame's read (the second found nothing and went silent; both now update 27 times in
  a second), and a tap back from a pause drops what it left in flight, so its first
  grid is the picture now.

- **The GPU and VRAM meters work on a Mac.** They shelled out to a discrete-card driver
  tool that does not exist there, so both read "-" for the whole session. Where the GPU
  shares system memory, they now come from the accelerator statistics the operating
  system already publishes (no privileges, no helper to install), and report utilization
  and the driver's share of total memory. The sampler stops asking after one unanswered
  query instead of spawning a helper every second forever.

- **The capture picker says when the system is refusing it the screen.** On a Mac,
  reading the screen needs a permission granted by hand in the system settings, and no
  app is allowed to prompt for it. Denied, the enumeration still succeeds : it just
  returns a black picture for every screen and strips every window of its name, so the
  picker was a grid of black rectangles with nothing to explain them. It now asks the
  system first, and when the answer is no it says so, opens the right settings pane on a
  click, and states the one thing nothing else does : the permission is read once at
  launch, so granting it only takes effect the next time the app starts. A camera or a
  video file was never affected. Windows and Linux have no such gate and see no change.

- **A fullscreen output closes on Esc** when it covers the control window and is not an
  installation. Its keys were armed only for a kiosk launch, so a plain fullscreen output
  on one display could only be left with Cmd+W. Where the control window is reachable
  (a projector on another display, a span, a framed window), Esc hands focus back to it
  and the show goes on : the output takes focus as it opens, so an Esc meant for the
  Output page would otherwise end it. An installation no longer prints its exit keys on
  the projector for its audience to read.

- **An edit made just before an automatic change stays undoable.** A sequencer step, a
  key-sequencer step or a modulated Vary lands in the history silently, and it became
  the baseline with any edit still inside its 300 ms grouping window folded into it :
  a drag finished just before a step could not be undone. The pending edit is now
  committed first.

## v1.2.0 — 2026-10-08

### Added

- **Sonify's output device in the audio/midi/osc tab** : right under the audio input
  menu, the same size (the two stacked in one column beside the meters; alone at full
  width while the analyser is off), the same menu as the Sonify page's (both drive
  `sonify.sinkId`). One `AudioOutputSelect` now
  serves the Sonify page, that row and the input monitor's row; its list follows
  `devicechange`, a device saved in a session but not plugged in reads "(not
  connected)" instead of "default", and the system's own "default" entry folds into
  "default output".

- **A Picture readout** (Performance tab, its own **picture** section) : all 17 vision
  features live, grouped (light and color, texture, motion, where and how deep), with
  what 0 and 1 mean, swing bars for the signed ones, a dot for the bright mass and a
  color swatch, each row's `/opsia/vision/…` address on hover. Drawn from refs at
  15 Hz; it registers on the vision bus (`visionBus.want`) so the App loop samples the
  picture while it is open, and releases it when folded.

- **Palinopsia is a dataflou node.** A new **dataflou** section in the audio/midi/osc tab
  (ON THE MESH pill, name, universe) joins the decentralized parameter mesh its sibling
  instruments speak, and monitors it : every node on the network (online, remembered,
  forget), its parameters with pickers to wire them to Palinopsia or from it, and every
  connection on the mesh with ✕ to unwire. Palinopsia declares 81 entries (6.9 KB, under
  the 8 KB a microcontroller node can receive) : 38 destinations that play like their
  `/opsia` OSC address (Meta knobs, layer opacity / speed / mix, the feel macros, scene
  recall / next / randomize, BPM) and 31 sources sampled at 30 Hz only while someone
  listens (audio, picture, body, the 8 modulators; Meta knobs are both). The node is a
  TypeScript port of dataflou's reference core in main (`src/main/dataflou/` : a CBOR
  codec with QCBOR's strict typing and preferred float widths, the proto 2 messages, the
  stream_codec UDP plane, gossip / digest / keepalive / range mapping), with its own
  mDNS responder on multicast-dns : bonjour-service's announcements put the service-type
  PTR before our A record, and the reference parser then took 127.0.0.1 every other
  packet (5 reconnects in 45 s, 0 after). Tested against the reference `dataflou-node`
  (built for Windows) : discovery both ways, DECLARE decoded on both sides, values
  streamed both ways (947 values in 45 s), SETVAL, SUBREQ, SUBANNOUNCE, STREAMSTOP,
  gossip relay to a third node, reconnection after a restart with the wires restored.
  Identity : one SKU per install (`userData/dataflou/identity.json`), wires per universe
  beside it. `multicast-dns` is now a direct dependency (it already shipped with
  bonjour-service).

- **The key sequencer draws each mode** (a stage under the mode strip, after dataFLOU's
  per-mode sequencer previews), in one color language : a key's hue is its place on the
  circle of fifths, the key playing glows, pops and ripples when it changes. **List** :
  the written keys as tiles, the playing one lit, a trail behind (bounce, drift).
  **Circle** : the circle of fifths, majors outside and relative minors inside, the pool
  lit, the key and its last four, the lean as an arrow as long as the leap, the relative
  hop as a dashed link. **Affinity** : a constellation around the key, closer = more shared
  notes, bigger = likelier at this smoothness (the engine's own law, `affinityWeight`),
  hollow = ruled out by no repeat or the tour, the three likeliest named. **Pivot** : the
  twelve notes as a clock with the scale lit and its targets ringed, beside the degrees
  (same notes) or the bright-to-dark ladder (same tonic). **Picture** : the picture's hue
  on a wheel (the marker's distance is its saturation), its brightness against the pool's
  moods, the key they give; on cuts, the motion strip with the spikes past the cut line.
  The vision bus is fed in Picture mode while the sequencer runs or the Sonify page is
  open.
- **An OSC monitor, and an OSC section in two halves** (audio/midi/osc tab) : **↙ IN**
  (listen, port, where to send, the last message) and **↗ OUT** (destination, FEEDBACK,
  MARK, a note that the body rules' OSC goes there and the Resolume mapper has its own),
  each with a traffic light and msg/s, both also in the folded header. OUT no longer
  hides until the input is on (it never depended on it). **monitor** shows every message
  both ways (time, direction, address, values, destination), filters by direction and
  address, pauses and clears; **latest** keeps one row per address. Every UDP send now goes
  through one tap (`oscMonitor.ts` : sendOsc / sendOscBatch, used by the feedback mirror,
  MARK, the body rules and the Resolume mapper) and the inbound stream is counted once;
  messages are kept (500, ring) only while a monitor is open. Measured in a test copy :
  in 21/s from a test sender, out 106/s of feedback, both listed, a value coming in and
  FEEDBACK mirroring it back out side by side.
- **The Resolume mapper (K) is a pin board** : a connection is a pin colored by its
  signal's family (modulators, Meta knobs, audio, vision, body, OSC), sized by its amount,
  with a halo that follows what it carries; each column group has its own hue (band, tint,
  separators); rows show their pin count and a live bar in their color; a status line under
  the board describes what is under the cursor and what a click does; an empty page offers
  Open .avc and Learn. It wears the app's own look : the full pages' title bar (RESOLUME ·
  MAPPER, mono, spaced), the theme's UI font, the toolbar buttons. Light themes get deeper
  shades. The canvas draws at dpr × the UI zoom, so it stays sharp zoomed.
- **A dice for the Resolume pins** (🎲, MIDI-learnable as `rand:resolume`) : every row gets
  none, one or two new pins (35 / 45 / 20 %) at amounts 0.4..1, among the unfolded groups'
  float and toggle columns : never a trigger (no clip or column launches at random) nor the
  composition master (no blackout). **↶** puts the previous pins back. Measured : 19 pins
  over 18 rows, none on a trigger, the master or a folded group.
- **Sonify's mixer and sequencers look like its voices** : one set of parts
  (`components/sonifyUi.tsx` : the voice card, the label column, the on / play pill,
  option chips, slider rows, the stepper, the dice / reset buttons) builds all three
  views. The mixer is a voice card per channel (pill, name, volume, filter) and an FX tail
  card; the effects and key sequencers are voice cards with a play pill, their rows in
  the voices' label column, and the key sequencer shows the key now on its own row.
  The two sequencer cards are roomier (more padding and space between rows, thin dividers
  between their groups, bigger mode / root / scale targets).
- **Sonify's level meter tells the truth at a glance.** It did measure the real output
  (after the master and the limiter, films included) but drew the raw amplitude on a
  linear width, so an ordinary -20 dB level filled a tenth of it, the limiter's -1 dB
  ceiling never reached the end, and it jumped between 10 Hz readings. The worklet now
  sends per-channel peak and RMS; the meter draws L and R on a -54..0 dB scale (lines at
  -36 / -18 / -6), RMS as the bar, the peak as a tick held 1.2 s, both falling at 24 dB/s,
  a dB readout beside it, yellow above -9 dB, orange while the limiter works.
- **The sequencers' buttons are the voices' buttons, and the cards resize.** Choices are
  full-width segments (Seg / Toggle in sonifyUi, like Events' spatial / motion / blend),
  the rate is a full-width menu with the free time on its own **every** row, the step
  menus read whole. Each sequencer card has a grip at its foot : drag down / up for more
  or less air between its rows (the card follows the pointer : the drag is shared among
  its gaps, its step list at 3/4), its left corner widens the sequencers' column, which
  now has its own width (280–900 px, `opsia.soniSeqW`; air per card in
  `opsia.soniSpace.fx|key`).
- **The key sequencer runs on free time by default, 5 s**, and free time now reaches
  5 minutes (it stopped at 2); minutes read as `2m30`, double-click the slider for 5 s.
- **A Resolume section in the audio/midi/osc tab** : SENDING / OFF (a click toggles it),
  where it sends, the pin count and messages a second, and **mapper ▸** to open the page
  (it replaces the small Resolume button in the OSC header).
- **Spastic HOLD** (LFO) : how long each throw stays up, separate from the rate. With
  HOLD on, the coin only decides whether it RISES on a tick; the rise holds for HOLD ms,
  then drops to the bottom (the next frame) and rests there until the next rise; a rise
  while up starts the hold again; float throws to a level of its own. 0 (absent) = the
  original. `ModulatorConfig.spasticHold`. Simulated 60 s at 2 Hz : HOLD 100 rose on 68
  of 120 ticks, up 100-117 ms each (frame-quantized), down otherwise; HOLD 5 = one frame;
  HOLD 0 unchanged (up 51 %, runs of 500-2500 ms). The LFO card's params still fit its
  fixed height (85 of 85 px).
- **The key sequencer** (Sonify, seq view) : composes the root, scale and octave of the
  whole instrument over time. Five modes : **List** (written keys, forward / bounce /
  drift), **Circle** (a walk on the circle of fifths : flats / sharps lean, leap 1-3,
  relative major / minor hops), **Affinity** (the next key weighted by shared notes,
  Jaccard over pitch-class sets, `exp(6·smooth·(2a−1))`; no-repeat, tour of the pool),
  **Pivot** (same notes on a new degree : I major, II dorian, III phrygian, IV lydian,
  VI minor; or same tonic, brighter / darker) and **Picture** (hue around the circle of
  fifths, brightness to the mood; on the clock or at scene cuts, with a hold). Rate
  (1 beat … 16 bars or free ms), chance, an optional Euclidean gate, a pool of roots and
  scales, glide 0-4 s, home on stop (a key set by hand while it runs becomes home).
  Effects-sequencer preset steps keep the key while it runs. Sessions carry
  `soniKeySeq` + `soniKeySeqOn` (Installation mode starts it); MIDI `fire:keyseq`; OSC
  `/opsia/sonify/keyseq/on|next|mode|glide|chance`. Measured in a test copy at 240 bpm :
  every mode steps on the beat (250 ms), Circle walks G D A E B F# C# G# D# A#, Pivot
  C major → D dorian → E phrygian → F lydian → A minor, Euclid 3/8 falls 750 / 750 /
  500 ms apart, chance 0 never changes, a hand-set E minor became home and came back
  on stop, the picture's green + dark gave E phrygian and its red C phrygian.
- **Key glide** : a key change can slide every pitch instead of jumping. The worklet
  glides its pitch tables (Spectra, Chord, Filter, Ring bank) per block, eased
  (smoothstep) in log frequency, and Orbit / Raster's single pitch from where it was;
  the Collage resonators glide on the main thread. A table re-sent unchanged (every
  slider move re-sends them) leaves a glide alone; the Ring bank's make-up gain is
  measured every 16th block while it moves. Measured : Orbit C3 → B2 jumps within one
  analysis frame at glide 0 and eases over 1.96 s at glide 2; the Chord's middle note
  F3 → B3 follows the curve (≈224 Hz at 2.8 s of 4 s); the level holds at −12 dB through
  jumps and glides.
- **The Sonify beat clock** : the effects sequencer gains beat / bar rates (1 beat …
  16 bars, free stays its default) on one clock shared with the key sequencer; one
  started while the other runs on the beat waits for the next bar (measured : the
  effects steps then land on the key changes' downbeats).
- **Chord noise** (Sonify) : a smooth pink noise blended into the Chord voice, one
  band-pass on each note (two pink generators, so it is stereo), each band riding its
  note's swell, fade and WAVES like the tone, so the noise breathes with the chord.
  **noise** (0 = the plain chord) and **air** (Q 40 → 1.2 : a pitched breath to a wide
  wash; the band gain follows sqrt(Q), so the level holds at any width). Both are
  modulation targets and OSC (`/chord/noise`, `/chord/air`). Measured : at noise 1 the
  bands sit as loud as the tones (+3 dB overall), flatness 0.007 plain → 0.021 (air 0) …
  0.042 (air 1), level within 0.6 dB across air.
- **Installation mode looks after itself.** Start with the computer (macOS : a
  LaunchAgent that also restarts a crashed app; Windows : a login item and a scheduled
  check every 5 minutes; only one copy ever runs, and a leftover entry with Installation
  mode off quits at once and removes itself). The display never sleeps while an
  installation runs or an output window is open. A crashed, hung (20 s) or frozen (no
  new frame for 45 s) control window reloads with a backoff, and the app relaunches after
  5 failures in 10 minutes, 3 GPU crashes, or no WebGL (at most 6 relaunches in 30
  minutes). A crashed output reloads, a closed output reopens, and the output moves back
  to its projector when displays change (matched by name when Windows renumbers it).
  The default menu shortcuts are off, the output stays on top, the crash-restore
  question never waits, and the exit keys must be held for 1.5 s. Measured in a test
  copy : a control crash, an output crash, a closed output and a renderer stuck in a
  loop all came back with the picture flowing; Ctrl+R did nothing; a second launch quit.
- **An installation plays its sound.** A session now records whether Sonify and its step
  sequence were playing; Installation mode turns them back on at boot and after every
  self-heal reload (opening a session by hand still never starts the sound). Turning
  Sonify on or off now counts as an unsaved change.
- **A log file** : `logs/palinopsia.log` in the app's data folder (2 MB, one previous
  copy) records main-process errors and exceptions (never an error box on screen),
  every window's errors and warnings, crashes, hangs and recoveries; a message repeated
  within a minute is counted, not repeated.
- **Cameras reconnect.** A camera whose track ends (unplugged, reset by USB power
  saving) is tried again at 2, 4, 8… up to 30 s, and at once when a device appears,
  found again by name under another id. Measured with a fake camera : back in 2 s.

- **Recordings carry the Sonify sound, DXV3 included, whenever Sonify plays.** A DXV3
  take now has a PCM sound track (16-bit little-endian, written natively as the frames
  go, in the layout libavformat uses; measured : the sound present, 0 decode errors).
  Every take holds Sonify's audio context open for its length, so the sound is
  recorded when Sonify is switched on before or during the take, or off and on again,
  with silence in between, in sync with the picture (it used to be recorded only if
  Sonify was on at the start, and a restart mid-take lost it for good). A take during
  which Sonify never played is saved with no sound stream at all.

- **Collage : FX before shapes.** A toggle in the Collage's Inspector : the source's
  FX rack processes the films alone, then the seams, contours, torn paper and mask
  holes are drawn over the processed films, crisp. Measured with a coarse Pixelate in
  the rack and seams on : off, the seam is pixelated away (its darkest pixel 29-76 on
  a ~115 median); on, it stays a clean ~22 px black line at 1080p. Works on a layer's
  A or B and on the background, with crossfades and torn paper (which reads the
  neighbouring film mirrored across the tear).

- **A Ring bank on Sonify's Collage voice**, inspired by the S-4 : one 48-band
  resonant filterbank per side over the whole voice, its bands snapped to the key and
  scale across the voice's octave range (one per semitone over the default four
  octaves). wet (mix or send; 0 = the voice as before), decay (12 ms to 10 s, every band
  ringing as long; sustain shapes what goes into the bands, choke what comes out),
  cutoff, peak, slope (LP, BP, HP), tone, tilt, waves and noise (a travelling sine and a
  random level across the bands, each with a rate that is free or locked to the tempo :
  straight, triplet, dotted), detune (a slow wobble plus a random walk, the two sides
  apart), and five voicings from Loopex's filters (Clean, SEM, MS-20, Steiner, K35; the
  last three clip the ring). The filters are Cytomic state-variable band-passes, stable
  up to Nyquist at any sharpness. A make-up computed from the bank's own summed response
  and a slow level follower (held while the films are silent, so the rings decay) keep
  it at the plain voice's level (measured -1 dB; it was +11 dB on tones landing on a
  band). Tuning measured on films : the scale's notes stand 12 to 22 dB over the notes
  between, against 6 to 8 dB without. About 150 µs per 2.7 ms audio block. Five of its
  controls are modulation targets; OSC `/sonify/collage/{bank,decay,cutoff,peak,slope,
  waves,noise,detune,voicing,...}`.
- **Waves on the Chord voice** : the same travelling level across the chord's notes
  (each note swings about 55 dB, measured), free or tempo-locked, so a held chord keeps
  moving inside. A modulation target and `/sonify/chord/waves`.

- **Sonify's Filter voice gets a `loop`** : it replays one frozen stretch of its noise,
  a few hundred milliseconds (a flutter) down to a few milliseconds (a buzz); 0 is free
  noise. Its quantized band centres get their own octave range, Flow gets a pan slider,
  and OSC gains the taps (`/sonify/tap/a|b`), each voice's `/tap`, `/looct` and `/hioct`,
  `/spectra/sync`, `/orbit/shape` and `/filter/loop`.

- **Effects travel between racks.** Right-click an effect's chip for **Copy to Master FX**
  or **Copy to Layer N FX**; or drag a chip from one rack onto another (a chip, or the
  `+ fx` box for the end) to move it, its modulation following, and hold Ctrl or Alt to
  copy instead. Right-clicking the `+ fx` box pastes a copied effect into an empty rack.
  An effect the rack can't host is refused with a popup that says why (`Transfert can't
  go in the Master FX : Transfert is layer-only.`), and the drop marker turns red over it.

- **Sonify : a Collage voice**, the films of a Collage source heard all at once as a
  sound collage. Every film plays its own sound in its own loop window and speed, held
  to its picture (each film gets a hidden player of its ORIGINAL file, resynced on every
  seek and nudged a percent or two to stay within ±15 ms : measured), so a wall of
  optimised clips, whose caches carry no audio, still sings. Every piece is its own
  voice : panned by its place in the frame, then rung through a harmonic resonator
  (band-passes on a note and its 2nd and 3rd harmonics) tuned to the Sonify key and scale
  by its distance from the frame's centre, low in the middle and rising to the edges in
  every direction, up to 64 pieces. resonance (plain films to only the rings, loudness
  matched within 1 dB at any ring, calibrated on noise), ring, harmonics, range, width,
  gain, pan; its own mixer channel, sequencer column, OSC `/opsia/sonify/collage/…` and
  three modulation targets. Masked pieces fall silent; a muted or hidden layer goes quiet,
  a fading one fades. Auto-Sonify switches it on for a composition with a Collage.

- **New and Generate morph over the MRPH time**, live. The plain morph could only snap a
  whole new composition (and a dissolve froze the outgoing picture), so they hand over
  layer by layer, top first, staggered : a slot free in both compositions hosts the new
  layer while the old fades (a true crossfade, after which the engine swaps the two
  slots' Layers, nothing reloads); without a free slot the old fades out and the new in;
  same shaders ease their settings; Vibe, Context and Finalizer ease all along. A new
  layer fades in only once compiled (else the old shader flashed), and the fades are
  applied after every modulator so none overrides them. MRPH 0 : a cut once compiled.
  Measured over 4 s (integrated graphics) : no still frames, brightness steady through the hand-over.

- **Context's light moves** : the light pad (now the composition's shape, and larger)
  takes the Metasurface's draw sequencer. **✎ draw** a path, **▶ play**, and the light
  travels it : direction (forward, backward, ping-pong), **⟳ loop**, **time** (0.2 to
  60 s per pass), **jump** (random teleports) and **wiggle** (a vibrato). Dragging the
  pad places the light and stops the path. The path lives on the Context unit, so it is
  saved with the session and recalled with scenes. The Metasurface and the light share
  one playhead and one transport, so they trace alike.

- **Veins** (Organic) : leaf veins and roots grown by the space-colonization model
  botanists use for real leaves (Runions et al.). A blade grows from its margin and
  calls its veins; open leaves branch, closed leaves fuse into loops, roots reach down
  through the soil; widths follow the pipe model. It grows, holds, fades and starts a
  new one. Six presets (Green leaf, Ginkgo, Skeleton leaf, Autumn, Roots, Fine roots).

- **NDI input** : a layer's source menu → **NDI Input…** lists every NDI® source on the
  network and plays the one you pick like a webcam (framing, FX, blend) : a camera, a
  phone's NDI camera app, OBS, NDI Tools, another Palinopsia. Received through the same
  NDI runtime as the sender (no virtual-webcam hop), full quality, shared when several
  layers show one source; a session remembers the source by name and reconnects when it
  appears. Always the newest frame (NDI's frame sync : skipped, never queued, so it can't
  drift behind), copied off the main thread and turned the right way up on the GPU; the
  Inspector shows size, fps and delay. Measured (on the laptop's integrated graphics,
  a floor) : a 1080p source ~45 ms behind at full
  rate; a 4096×4096 source ~110 ms behind with the app at 53 fps (the first version :
  580 ms behind and the whole app down to 17 fps). Listing never touches the camera.

- **Slime Mould** (Organic) : a slime mould's transport network, grown live by
  hundreds of thousands of agents (Jones' Physarum model). A fine mesh within seconds
  matures into a web of veins that thicken, prune and reroute; seeded as a disc it
  contracts, then migrates and forages with branching fronts. Six presets.

- **Fluid** (Organic) : a real fluid, solved live. **Ink** blooms and folds in still
  water, **smoke** rises from vents into eddies and spreads under the ceiling,
  **fire** is hot gas that lifts, puffs and glows by its temperature, soot above it.
  Stable fluids on the GPU with vorticity confinement, a grid kept to the frame
  height (4K and the dome look like 1080p), fixed steps on the layer clock. Flow,
  sources, wander, swirl, buoyancy, viscosity, fade, detail, `stir ▸` and `clear ▸`;
  seven presets (Ink in water, Indigo bloom, Marbling, Smoke column, Incense,
  Campfire, Candle). About 1 to 1.5 ms a frame.

- **Context : surface material evolution.** A new **evolution** slider in the surface
  material (Finishing > Context) keeps the surface from sitting perfectly still, as if a
  little wind moved the projector or the camera filming it : the material drifts a few
  pixels under the image in a slow, irregular sway with light gusts, turns and breathes
  very slightly, and the raking light shifts with it. 0 (the default) is perfectly
  still, so existing sessions look the same.

- **Click a modulation chip to turn it off** (and again to turn it back on) : the
  assignment stays with its depth, its parameter sits at its own value meanwhile.
- **Video : stop, scrub and browse.** A **■ stop** button (pause and back to the in
  point); click or drag anywhere on the timeline to move the playhead, playing or
  paused; a **clip** row (◀ / ▶ and a dropdown) steps through the other videos in the
  clip's folder, keeping speed, direction, loop and grain. The **◇ smooth** button
  lights up when the settings will strobe on an ordinary clip.
- **Finishing : default** on Vibe, Context and Finalizer puts the stage back as a New
  session starts it, every parameter included (Context's hidden surface relief too).
- **Link a folder of sessions** : right-click the Session **Load** button, pick a folder,
  and every session in it (subfolders included) joins the dropdown, grouped under the
  folder's name and listed in name order. Linked, not copied : sessions saved there
  later show up too. The same menu lists the linked folders (click to jump, × to unlink).
- **Movement qualities** (Body page, with Pose on) : HOW the body moves, not only where.
  Six features read from the pose, measured against the body's own size so near and far
  read alike : **energy** (still to vigorous), **expansion** (folded in to limbs spread
  wide), **fluidity** (a shake or a stop-go reads jerky, a sweep smooth), **suddenness**
  (sustained to sudden), **directness** (circles and meanders to straight to the point)
  and **symmetry** (left against right). Two new gestures : **impulse**, a burst out of
  calm, and **freeze**, a quick stop held still. The camera's own jitter is learned and
  taken off, so a still body reads still on any camera. Streamed over OSC with the other
  body features (`/opsia/body/moveEnergy` …).
- **Silhouette source** (listed with the live inputs in the source picker) : the body
  in front of the Body camera, cut out of the room, as a picture on any layer.
  **Cutout** shows the camera where you are and nothing elsewhere (background removal,
  no green screen), **matte** a white body on black (to key another layer or feed a
  Matte node), **shadow** a flat colored silhouette, **hole** the room with you taken
  out. Threshold and softness shape the edge, and **trail** leaves fading echoes of the
  body behind it. It never turns the camera on by itself : its Inspector line says
  whether the camera is live and offers the click that turns it on. When nobody is in
  frame the silhouette empties rather than freezing on the last shape.
- **Motion field** (Body page, **Motion** toggle) : the camera's optical flow (a
  pyramidal Lucas–Kanade on a small copy of each frame, no body model) read as nine
  features : how much moves, which way, whether it **spreads out or closes in** (someone
  approaching, arms opening), whether it **turns**, whether it moves **as one or in every
  direction**, where, and how much of the frame. New gestures : swipe L / R / up / down,
  approach, withdraw, turn cw / ccw, and **stillness** (a moving room holding still). It
  follows anything that moves, a crowd or a curtain as well as a body. The picture itself
  gains the same reading on the vision bus (`flowX`, `flowY`, `divergence`, `curl`,
  `coherence`), and body features now stream over OSC as `/opsia/body/<feature>`.
- **Three new Generate families** :
  - **Dome** (Aurora, Canopy, Flock Overhead, Strata, Deep Water) : made for a fulldome,
    no vignette, nothing framing the edges, slow motion overhead;
  - **Film Wall** (Film Wall, Contact Sheet, Nitrate, Projection Booth) : your own films
    through a Collage, graded and damaged. It plays the Collage folder of the session, or
    the last one picked on this computer; with none yet it stands in with painted sources
    and says how to pick a folder;
  - **Node Workshop** (Gooey Blobs, Borrowed Palette, Layer Matte, Displaced, Focus Pull,
    Fault Line) : one recipe node per theme, on the layer that reads the others.
- **25 new master chains**, in three groups of the chain presets menu :
  - **Time & memory** : Echo Memory, Sediment, Time Map, Eternal Pair, Ghost Complement,
    Low Frame Rate, Oxidized and Slow Loop (Réponse, Sediment, Chronoscan, Eternalism,
    Afterimage, Decimate, Corrode and Feedback on the master bus);
  - **Node recipes** : Fault Lines, Gooey, Luma Focus, Live Palette, Layer Matte,
    Remapped, Imprint, Stamp, Live Mosaic, Wake and Painterly (the layer-reading nodes
    are wired to layers in use);
  - **Dome** : Clean, Film, Drift, Glow, Memory and Sky, with Context's vignette off
    (it darkens the rim of a fisheye) and nothing that frames the edges.

  They keep the scene's palette mix (a generated scene keeps its colors and its level)
  instead of dropping to the raw sources as the older chains do.
- **Chain presets can wire the nodes that read another layer.** A master chain preset
  says which layer a node reads (the bottom, top or second layer in use), resolved when
  it is applied, so Lookup, Matte, Remap, Transfert, Convolution and Mosaïque work
  inside presets. A preset can also set Context (a dome-safe chain turns its vignette off).
- **Generated scenes move.** Every Generate theme now binds a few modulators across its
  layers, in its family's way of moving : slow breathing for Organic, Living Surfaces and
  Cinematic, drawn cadences for film, stepped and on the beat for Glitch and Data, sine
  and saw sweeps for Analog. Every active layer gets at least one moving parameter; the
  master (the theme's color and finish) and the World's audio route are left alone, and
  the Feel studies stay still so each one isolates its macro. A theme can bend its
  family's recipe (`motion` in themes.ts).
- **Generate uses the whole instrument.** Ten Print, Congeal, Metamorph and Text (with
  words from the theme) join the themes they fit; the eleven effects it never picked
  (Abstraction, Aperture, Difference Bloom, Force Lines, Granular, Tiles, Motif, Slit
  Buffer, Smear, Solarize, Triangle Flicker) and fourteen native nodes now land too.
  Nodes that read another layer (Lookup, Matte, Remap, Convolution, Transfert, Mosaïque)
  are handed a layer that is actually in the scene. LighterColor, weave, lumakey and
  consume join the blends. A new **Living Surfaces** family : Lichen, Rust, Mold Culture,
  Burning Paper, Dry Earth and Grown, real surfaces that grow, crack and rust.
- **Finalizer `dirt burst ▸`** (film damage) : a dirty stretch of film passes the gate,
  four to eight times the dust for about a second, then clean again. Works even with
  dust at 0. Fire it on a beat or an onset (bind M, MIDI or OSC).

- **Time and feedback controls** : Light Trails `knee` and `clear`, Wide Time `burn` and
  `clear`, Difference Bloom `hold` and `soft`, Feedback Zoom `center`, `drift`, `edge` and
  `clear`, Force Lines `slide`, crawl `rate`, `vary` and `audio`, Granular `stagger`,
  `sizeVar`, `edges` and `audio`, Slit Buffer `angle` and `grab`, Smear / Streak `smooth`,
  Decay `headSwitch`, Abstraction `rate` and `coherence`. Tooltips for the color and
  geometry effects.

- **New node controls** (defaults keep today's look) : Feedback `clear`, Sediment
  `snapshot`, Eternalism `freeze`, Réponse and Chronoscan `stride` (longer memory),
  Chronoscan ping-pong sweep, Parallax sway rate and a smooth depth-of-field disc,
  Scanner audio lines, Afterimage `dwell`, Melt `mix`, Faultline and Decimate beat
  `sync`, Sillage `scan` / `ground` / swirl center / `clear`, Toile smooth strokes,
  Pulfrich zero plane, Corrode eat-to-transparent, Luma Blur smooth quality and `mix`,
  Matte transparent cut-out.

- **Phase wrap** : a shader can declare `uniform float PH_x; // wrap <period>` so a
  periodic phase stays precise over day-long shows. Finalizer `film grab` (re-draw or
  re-freeze on a trigger). Context `smoothing`. `tools/shader-rig build.cjs --out` for
  parallel rigs.

- **New effect controls** (defaults keep today's look) : per-column / per-band audio on
  Byte Corrupt, Databend, Mosh Blocks, Row Echo, Slice Shuffle, Tiles, Distort (audio
  rings) and Motif (band echoes); `fire` on Databend and Row Echo; Threshold `alpha key`;
  Pixel Sort `angle`; Pixelate and Tiles `average`; Compress `vary`; Databend `wrap`; CRT
  Screen `lines` and `moire`; Scanlines `moire`; Rutt `relief` (hanging or mountain);
  Grade `gamma`; Hue Rotate `rate`; Palette `cycle`; RGB Shift wobble rate; Edge `ink`;
  Transform `cutout`; Wavefold and Colorizer `invert` (the old negative look).

- **Collage** : `speed spread` (each piece plays at its own rate) and `freeze`.

- **Text** : crawl (a ticker along the baseline), shrink to fit, letter drift,
  typewriter reveal, and one line at a time with `next line`.

- **New source controls** from the generator audit, every default keeping
  today's look :
  - Drift Field `strata angle` and `reseed`;
  - Slabs `spectrum light`;
  - Contour `index lines` and `audio swell`;
  - Ten Print arcs as a second `style`;
  - Particle Drift `trail fade`, `density` and `audio pulse`;
  - Column Scan `audio trace`;
  - Murmuration `heading` and `veer`;
  - Filaments `audio sway`;
  - Congeal `clear` and `audio sparks`;
  - Ramps `mirror` and a movable center;
  - RGB Oscillators `chroma` and `audio FM`;
  - Recurse `drift angle` and per-level `audio`;
  - Shapes `density` and `spin`;
  - Op-Art `audio`;
  - Direct Marks `boil`, `fps`, a `seed` for a new hand, and `audio gate`;
  - Metamorph `birth` (at rate 0, births happen only on the trigger);
  - Sync Osc `audio FM`;
  - Differential `audio bands`.

  Every non-obvious input now has a tooltip, and there are new presets and
  search words.

- **tools/shader-rig** : checks any generator or effect offscreen, with no app
  window : a 24-hour show in one step, knob scrubs, 4K cost, stills at 16:9 and
  square, and a moving test card for effects (`tools/shader-rig/README.md`).
  **tools/test-build.sh** builds and launches an isolated copy of the app for
  automated tests, beside the real one, with its own settings.

- **Grown** (Organic) : a texture that grows itself. A tiny neural cellular
  automaton, trained offline on a real photographed surface (lava, mossy rock,
  bark : `tools/nca`, CC0 scans), grows that texture cell by cell from an empty
  grid and keeps it alive. DAMAGE cuts a hole that heals within a second (the
  cells were trained to heal wounds), REGROW starts over. Cells, speed, drift,
  color, brightness; six presets. Paced by the layer clock (Speed and freeze
  apply).

- **Scan** (Organic) : a real photographed surface. The 30 CC0 ambientCG
  material scans now ship their colour maps too (4 MB, re-encoded), laid across
  the frame with hex tiling (Mikkelsen 2022 : shifted, blended tiles, so a 1K
  scan never visibly repeats) and relit by the organic relief light. Colony's
  new transparent `ground` grows lichen or rust over it. Ten presets.

- **Colony** (Organic) : living matter growing across a surface. One generator,
  four kinds : lichen on granite, mould on agar, burning paper, rust on steel
  (verdigris on copper). Seeds spread cell by cell with the rough front measured
  on real growth (burning paper, bacterial colonies), slowed by poor ground,
  stopping short of each other; each colony ages (lichen crusts crack into
  areolae, mould sporulates in rings, char turns to ash, rust pits and flakes).
  Lit as a relief. Regrow on a button or on a cycle; ten presets.

- **Ground** (Organic) : the surfaces under the living things, lit as a relief.
  Cracked mud drying (cracks widening, edges curling, a second generation late),
  sand ripples migrating with the wind, rock strata, wood end grain, bark; each
  with an alternate palette. Ten presets.

- **Fulldome output** (Output page). The engine renders a square **domemaster**
  (equidistant fisheye, front at the bottom) at 2K / 4K / 8K from the flat
  composition, aperture 180–230° (210° default, the SAT Satosphère), and it
  replaces the frame everywhere : preview, projector window, NDI, Spout,
  recording, stills. Three ways to fit a 2D picture : **full dome** (the whole
  frame over the whole 210°, nothing cropped, no black; or cover / contain),
  **panorama** (wrapped around the room, up to the zenith) and **screen** (a flat
  virtual screen re-projected to read undistorted from the centre); rotate, spin,
  rim feather, flip and an
  alignment grid burned into the output. A **3D dome simulator** (ported from the
  TouchDesigner FulldomeSimulator) shows the live master on a dome, from the seat
  or as an outside cutaway, with tilt, template and sweet spot.

- **Resolume OSC mapper** (new page, key `K`). Read a Resolume composition
  (`.avc`) : its layers, groups, columns, clips, effects and dashboard links become
  the columns of a matrix whose rows are Palinopsia's signals (modulators, Meta
  knobs, audio / vision / body features, any `/opsia` address). Click / paint to
  connect, per-cell amount, float / toggle / trigger columns with range and
  smoothing, **Learn** addresses off Resolume's own OSC output, scene → column
  triggers, 8 snapshots, a **lock**, and the whole mapping saved with the session.

- **TouchDesigner recipes** as native nodes, in any rack : **Remap**, **Luma Blur**
  (with a depth-of-field mode on the depth map), **Gooey** (blur then threshold),
  **Matte** (three inputs) and **Lookup** (a live layer as the palette). Nodes can
  now take a second layer input.

- **LighterColor** blend mode (whole-pixel lighter-wins).

- **NDI output, built in** (Output page). Replaces the old optional sender stub:
  Palinopsia now publishes an NDI source itself, calling the NDI runtime directly
  (bundled with the build, or the machine's NDI Tools / Runtime / SDK, or the copy
  TouchDesigner, Resolume or vMix carries). Sends the clean picture or the
  domemaster : **4096×4096 at 30 fps** into a receiver, measured with a GPU-bound
  scene and with the window minimized. Name, rate (25 to 60, 29.97 / 59.94
  exact), size cap, UYVY (GPU-converted) or RGB; Discovery Server, network card,
  extra IPs and groups for venue networks, private to Palinopsia and applied live;
  receiver status, sent rate, ON AIR / PREVIEW tally. `npm run ndi:bundle` ships
  an installed official runtime inside the next build.

- **NDI on a computer with no NDI** : one click installs NDI's official runtime
  (downloaded from NDI over HTTPS, signature checked, NDI's own installer opened),
  and the NDI source goes live by itself when the install finishes.

- **DXV3 recording, in real time** (Resolume's GPU codec) : the graphics card
  compresses each frame (DXT1), a few workers write the DXV3 frames and the file
  is written as it goes, so there is nothing to convert after and **no size limit**
  from a video encoder : the **4096² fulldome master records at full size** (a
  bigger master is scaled to 4096). Constant 30 or 60 fps, the clean picture.
  Checked against FFmpeg's DXV decoder and Resolume's own file layout.

- **Record location** : Output → Record → **location…** picks where takes,
  screenshots and Assemble exports go (checked writable, remembered on this
  computer, ↺ back to Recorded/, click the path to open it). A chosen folder that
  can't be reached (an unplugged drive) falls back to Recorded/ with a warning,
  instead of losing the take.

- **Recording formats know their limits** : the hardware video encoder takes up to
  3840×2160 on this machine (measured), so above that (the 4K dome) the other
  formats show greyed out and a take records DXV3; the MIDI record toggle now uses
  the chosen format too (it always recorded "Fast"). "Fast · no re-encode" is now
  labelled for what it is : MKV, H.264 as captured.

- **Syphon output (macOS)**, the twin of Spout : a built-in Syphon (Metal) server
  named Palinopsia, for Resolume, MadMapper, TouchDesigner, VDMX, OBS on the same
  Mac. Built from the Syphon framework's source in CI.

### Changed

- **The docs catch up.** The OSC reference (docs/opsia-osc-reference.html) gains the
  video transport (`layer{n}/video/…`), the Background's new rows (speed 0..4×, shadow,
  group, randomize, grounds only), `flow` and the temperament dials, the key
  sequencer, the MARK stream and the OSC monitor; the README's outbound section names
  MARK and the picture readout; the `?` cheat-sheet calls the `A` tab what it holds
  (Audio · MIDI · OSC · Resolume · dataflou); the landing page lists the Background,
  the Picture readout and the audio output.

- **The Background, audited.** Its strip is first in the Layers column (Background, then
  Layers 1 to 4 : the stack read bottom to top) and collapsible like a layer's, with
  opacity, M and dice in the header and a summary when folded. Fixes :
  - **group** (was "isolate") is a real group now : the layers composite on
    transparency (`bgWork` pair) and sit over the Background by `GROUP_FS`
    (`grp + bg × (1 − max(grp.rgb))`); it only forced Layer 1 to 'normal', so an opaque
    Layer 1 hid the Background entirely;
  - **blend in** under a fading Background : Layer 1 is taken onto the whole Background
    in its mode and alone, mixed by the opacity (it switched at 0.001 : a multiply
    Layer 1 went black at a low opacity, and a morph popped at its halfway point);
  - the **outside fill** follows the Background's opacity (over the fill color) and is
    graded with the picture : the Background takes the shape's outside before the
    master stages, the graded frame becomes the fill, the shape is still cut last so
    the film dust stays inside (it was the raw Background);
  - its **dice** drops modulation aimed at the old source and rack (bg-fx rows dangled on
    dead ids and ate the 12-row cap); **Init background** empties it entirely (it only
    cleared the source); built-in presets keep the shadow and mode;
  - **speed** is 0 to 4× everywhere (the slider stopped at 2, OSC at 1×; OSCQuery
    advertised 0.5); opacity, speed and **shadow** (the "Depth" control, renamed for
    what it is) are modulation targets (`{ kind: 'bg' }`), Meta destinations and
    MIDI-learnable;
  - OSC `/opsia/bg/source` accepts only grounds (an effect name was taken, an unknown
    name cleared it), `/opsia/bg/randomize` and `/opsia/bg/shadow` are new;
  - Generate lays its themed Background in **group** (Layer 1 lands opaque 'normal', so in
    blend the ground was hidden; grouped it shows through the dark parts), and never
    puts an empty Collage in it (Film Wall did); New's seed
    layer lets the ground show (screen / lighten / add, or 'normal' at 0.6 to 0.8)
    instead of covering it at 85 % 'normal';
  - an older session's Background gets the fields it lacks.
  Measured : multiply over a fading green ground goes white → green with no black step;
  in group, the dark side of a black-to-white layer shows the red ground (149,63,66 vs
  40,43,47); the fill moves with the Finalizer's gamma and the Background's opacity.

- **Every change morphs, without the flick.** A scene recall, Randomize, Variation or the
  sequencer used to hide every structural change (a source, an effect, a blend mode, a
  switch) behind a 320 ms dissolve of a FROZEN frame, whatever the Morph time : the
  "flick" at each scene change. `beginSceneMorph` (morph.ts) now picks : the same
  structure on both sides (sources, racks, blends, mute/solo/feedback, mask kind,
  coupling mode, and every bool/long input of the sources and effects) eases every number
  over the whole morph (masks, coupling and harmony too); anything else goes through the
  relay New and Generate use, so changed layers crossfade live. Sessions now relay over
  the Morph time too (Morph 0 keeps the hold-then-dissolve). Modulation : ModEngine runs
  16 slots, a morph forks the 8 modulators into ghost slots 8..15 (`forkGhosts`) so the
  old assignments fade out on the old motion while the new ones fade in, and a morph that
  starts mid-morph starts from what is showing. Relay fixes : a borrowed host must sit
  right beside the layer (with a visible layer between, the new content composited over it
  then dropped under it at the hand-over, one frame 3x brighter); a host slot no longer
  overwrites the borrowed content with its own empty layer; and a slot the old content
  just left stays dark 400 ms (its stale frames flashed at full opacity for four frames).
  Measured frame by frame with the picture held still : no frozen frame, no flash at the
  hand-overs; what remains is each source's own motion.

- **Body tracking runs on its own thread.** MediaPipe Hands / Pose / Face (and the
  Silhouette mask) now run in a worker that loads MediaPipe's own bundle over
  `opsia-asset://` (`resources/mediapipe/vision_bundle.js`, the package's
  `vision_bundle.cjs`; keep it the wasm's version). The main thread only copies each new
  camera frame to an ImageBitmap and turns the landmarks that come back into features,
  gestures and the silhouette, exactly as before. One frame is in the worker at a time;
  the motion field still reads every camera frame. If the worker cannot start or build
  its models, the tracker falls back to the main thread for the session. Measured on the
  RTX 4070, synthetic camera, Mycelial at 1080p : main-thread cost per frame hands
  3.1 -> 0.1 ms, hands + pose 4.4 -> 0.1, + face 5.4 -> 0.09, + silhouette + motion
  4.7 -> 0.03 (the worker itself takes 8 to 17 ms a frame, off the picture's thread);
  60 fps with everything on (55.8 on the main thread). A fast off / on comes back
  tracking with the silhouette.
- **A modulation keeps its full swing at the edge of a range.** A base at its minimum
  (a Collage's `cuts` at 2) lost half the cycle : Replace held the edge half the time
  and only ever rose, Multiply never moved. When the span a modulation sweeps fits in
  the range but crosses an edge, it now shifts inside (Vincent's choice). Measured over
  an LFO cycle : cuts at 2, Replace 0.5 → 2..64 with no time held at the edge (was
  2..33, held 50 %); Multiply 0.5 → 2..3 (was stuck at 2); mid-range swings unchanged;
  a swing wider than the range and Multiply's over-drive keep their clamp. A Replace
  depth of 0.5 or more sweeps a span as wide as the range, so it now covers the whole
  range whatever the base; sessions whose modulations hugged an edge swing further.
- **Sonify has a seq view** (voices · mixer · seq) : the effects sequencer moved there
  from under the mixer, room for the sequencers to grow.
- **Every Sonify parameter explains itself on hover**, like the Inspector's : 45 sliders
  (every voice's gain and pan, Spectra's rate / contrast / breath, Orbit's radius / drive
  / smooth, Flow's sense / density / grain / breath, Events' sense / density / decay /
  highs, Raster's smooth / tone, Transmission's transpose / tick, Filter's resonance /
  noise / contrast, the FX tail's send / delay / reverb / size / predelay / mod rate)
  showed only their value; each row's label now carries the same info.
- **The Output button lights while the external output is on** (◉ Output), like Sonify's
  while its sound runs.
- **Electron 44** (from 33), with electron-builder 26, Vite 7, electron-vite 5 and
  plugin-react 5; CI builds on Node 22. Adapted to it :
  - the app's own file schemes (`opsia-media://` for films, `opsia-asset://` for the
    MediaPipe models) are CORS-enabled and answer every request with
    `Access-Control-Allow-Origin` : Chromium 152 refuses a cross-origin request to a
    custom scheme otherwise, which left every Collage, Assemble and Collage-voice film
    unloaded (readyState 0) and hand / pose / face tracking unable to load;
  - screen capture asks for the `display-capture` permission (Electron 36), which the
    permission handler now grants;
  - file pickers (Collage and Assemble folders, Open Session, Link a folder of
    sessions) open where they were last used, remembered across launches : since
    Electron 43 a picker without a starting folder always opened in Downloads;
  - `postcss.config.js` is now `postcss.config.mjs` (the build's module-type warning).
  Checked on the upgrade : the HEVC and occlusion feature switches still reach Chromium
  with their case (Electron 36 documents `app.commandLine` as lowercasing), hardware
  HEVC decode + encode, Spout, OSC in, recordings with sound, the discrete GPU.
- **The sound card stays awake.** Sonify's audio context opens a few seconds after
  launch and stays running, silent, instead of closing whenever the sound and the
  recordings stop. A sound card idle for a few seconds goes to sleep, and waking it
  held the audio clock still for up to 3 s : every take after a pause started a second
  after REC, and Sonify was slow to sound. Measured : a take starts in 46 to 68 ms after
  any pause (was 1.1 to 1.2 s), Sonify sounds within 0.1 s.

- **Messages dock in the bottom toolbar** : a warning or a confirmation (a refused effect
  drop, a saved recording) appears centered in the toolbar's empty middle, over no
  control, instead of at the window's bottom center, which the side panels made land on
  the toolbar's buttons. A long instruction grows upward from there; too narrow a window
  falls back to the old place.
- **A, B and BG are buttons** : the layer's source selectors and the background's look
  like the toolbar buttons (Output, Sonify, World), lit when selected, instead of plain
  letters nobody would think to click.

- **The Finalizer's output shape comes last**, after the film hold, boil and film damage
  (only the scene dissolve, freeze, Flash safety and the dome follow it). It used to come
  first, so dust, hairs and scratches landed on the fill outside the shape; now the film
  gathers them inside a fixed aperture and the outside stays clean (measured : 97-122
  specks on the black fill over 20 frames before, 0 after).
- **Torn paper tears like real paper** (Collage and the Autocutter). It used to paint the same off-white
  band on both sides of every cut (and along the frame's edges), which read as a seam.
  Now, as in a torn-magazine collage, one piece of each tear lies over the other : only
  its ripped edge shows the white core of the paper, a hairline for long stretches and
  then deep bites, ragged at every scale (the fine raggedness stays the paper's fiber
  size, so a deep bite never turns furry), with a thin translucent rim, a few loose
  fibers, a faint ink line where the printed skin broke, and a soft shadow longer away
  from the light. A tear over a masked hole drops its shadow on the layers beneath; the
  frame's edges stay clean cuts. The torn code compiles into its own programs, so torn
  at 0 runs only the plain shader; on (4K, RTX 4070) it costs about the old torn's 0.3 ms
  in Collage, and the Autocutter got cheaper both ways (3.7 to 3.1 ms off, 4.1 to 3.6 ms
  on), its plain program no longer carrying the torn branch.
- **Performance has its own tab**, right of the setup tab, always open there (and
  metering only while shown). The setup tab is now **audio/midi/osc**, its sections in
  that order.
- **Context's blur is yours alone.** It starts at 0, and New, Randomize (every scope and
  the Context dice), Variation, Generate and Worlds no longer set it : the picture only
  softens when you move the slider (or a modulator, MIDI or OSC you bound to it). The
  World editor drops its blur row. Saved sessions keep their blur.
- **Mycelium grows for real.** Its threads used to be contour lines of noise : closed
  loops that never had tips, never branched and never fused. It is now a colony of
  hyphal tips (native) : they run out from spores, branch, bend toward fresh ground,
  fuse where they meet the network and eat the soil, so it advances as a front,
  bundles into cords, stalls, dissolves and starts again elsewhere. Same controls, so
  sessions keep theirs, plus **regrow ▸** and a ground color.

- **Reaction runs natively, at full precision.** Its chemistry lived in the shader
  runtime's 8-bit buffer, which stalls the slow terms and bands the pattern; it now
  runs in 32-bit floats on its own grid. The pattern keeps its size in the frame at
  1080p, 4K and on the dome, runs the same at any frame rate, `rate` goes up to 3
  (the old explicit step broke past 1.2), a `scale` change reshapes the living
  pattern instead of restarting it, and **regrow ▸** starts it over. Same inputs, so
  sessions keep their settings. It costs about 0.7 ms a frame at 4K. Built on a new
  registry for native generators (Grown moved onto it), the base for the next organic
  engines.

- **Context's "surface" section is now "surface material"** (plain "surface" also named
  the Metasurface). The material once called **rock rough** is now **stacked stone**,
  which is what it is (layered stone blocks); sessions keep it.
- **Flash safety holds softly** : a held region now fades out over most of a cell
  instead of a quarter of one, so it reads as a soft patch rather than a 6x6 grid of
  blocks (dragging a slider fast, e.g. texture scale, used to show the grid). The held
  cells are limited exactly as before; their neighbours a little more.

- **Context shows what the picture actually gets** : Proximity (toward far), Coalesce
  (toward mass), Flow, Gesture⇄Texture and the sequencer's Breathe / Arc add blur,
  haze, trails or depth ON TOP of Context's sliders, so every slider at 0 could still
  soften the image with nothing on screen saying why. A line under Context's header now
  reads e.g. `live blur 0.23 · haze 0.13 ← Proximity, Coalesce` whenever the engine
  uses more than the sliders, and **neutral** puts those macros back to 0.5. Proximity
  and the field macros are remembered on the computer between sessions.
- **Fulldome is much lighter on the graphics card** (after two blue screens, 0x116
  VIDEO_TDR_FAILURE with the driver out of resources, in dome output) : the main canvas
  no longer carries a multisampled colour buffer and a depth buffer it never used, which
  at a 4096² master cost hundreds of MB of video memory (the dome now adds ~300 MB
  instead of ~750, measured). The live dome tops out at 4K (a live 8K master added
  ~1.9 GB); the shared-output capture never exceeds 4096; and the engine skips a frame
  instead of queueing more work when the card falls two frames behind. A few small
  graphics-memory leaks are closed (a failed shader load, the light-output zones).
- **The Body camera tracks each camera frame once** : the models used to run again on
  every display frame, twice or more per picture. Tracking now costs about half. **Hi-res**
  (Body page) runs them on every display frame as before, for a fast camera or the
  finest landmarks. Body motion reads as it did.
- **The "Test" family in Generate is now "Feel Studies"**, at the end of the list : one
  theme per Feel macro, each keeping everything else still so the macro can be heard.
- **An Analog section in the source pickers** (layers and Background), after Organic :
  RGB Oscillators, Sync Osc, Slit Scan, Ramps, Column Scan, Differential and Interference,
  the analog video-synth lineage in one place. Generate's Analog Video Synthesis themes
  draw on all of it.
- **Finishing panel in labelled sections.** Vibe Palette, Context and Finalizer
  were each one long list of sliders; each is now split into named families
  with a thin coloured header and a matching rail down the left :
  - Vibe Palette : palette · color chord · tone · split-tone
  - Context : softness · distance · light · surface
  - Finalizer : grade · character · 3D · hand-made film · film damage · output shape
  - A section's master switch (character, 3D stereo, film hold, output shape,
    PBR surface, color chord) sits in its header, and a section whose switch
    is off folds itself away until you turn it on (or click its header).
  - Rows drop only the words their header already says ("film dust" is "dust"
    under film damage); the modulation lists and OSC keep the full names.
  - Rows that do nothing right now are greyed with the reason in the tooltip
    (parasites outside crt / vhs, palette stops beyond "stops used" or under a
    color chord, the fill color when the Background fills the outside).
  - Colors, dropdowns and toggles now sit on one line like the sliders.
  - The "Finishing on · Vibe · Context · Finalizer" line at the top of the tab
    is gone (the same toggle is in the Master FX strip).

- **CRT / VHS parasites, rebuilt** (Finalizer character and the Grain FX). They
  were small rectangles : one band out of 60 across the frame (18 px tall at
  1080p) with a hard-edged dash in it. Now counted in real scanlines (480, so a
  dropout is one line tall at any output size) :
  - **VHS** : line edges wobble (no time-base corrector), the head-switch tear
    frays the last lines at the bottom, and **dropouts** (the head losing the
    tape for an instant) turn a single scanline white from where they hit,
    fading over a tail as the signal recovers, a few dark, in bursts, a new
    set every field. Pushed high, a **tracking band** of torn, snowy lines
    drifts through the picture, coming and going.
  - **CRT** : a soft **hum bar** rolling up the screen, a faint **RF weave**
    that comes and goes, and short **impulse specks** on single lines.
  - One shared implementation (`shaders/isf/lib/analogParasites.glsl`).

- **The Organic family, made physical** (research : noise and growth models,
  wave physics, flame colour; every change measured at 60 fps at 4K) :
  - **An Organic section** in the source picker : the living generators first.
  - **Relief lighting** on Reaction, Erosion, Membrane, Mycelium and Dye Field :
    none of them had any light, which is the main thing that made them read
    flat. `relief` and `light angle` : one low raking light, soft shadows, a
    cavity term, matte (0 = the old flat print).
  - **Swell** rebuilt : 24 wave trains, each at the speed its length gives it on
    deep water (longer waves faster), spread around the wind; shaded like water
    (dark body, sky mirror, sun glitter, whitecaps and wind streaks).
  - **Organic water** : the caustics are now sunlight focused by real waves onto
    the bed (the refraction's Jacobian), not a ridge of two noises.
  - **Organic fire** : flames accelerate and stretch as they rise, puff out of
    phase (the real flicker rhythm), coloured by temperature on the blackbody curve.
  - **Reaction** : the field wraps around (no seams when zoomed out), keeps its
    size in the frame at 4K and on the dome, holds its rate under the stability
    limit, and no longer seeds new critters in rows (its hash repeated).
  - **Dye Field** : pools are round, no longer stretched sideways at 16:9.
  - A shared **organic toolkit** (`shaders/isf/lib/`) : sine-free hashes, gradient
    noise with derivatives, exact Voronoi borders, blackbody colour, relief lighting.

- **Film dust and film scratch, rebuilt from how real film gets damaged** (Finalizer).
  The dust used to be little black and white squares : one cell of a fixed grid
  switched on, all the same size, far too many, held for a whole drawn frame, and
  only when Film Hold was on. It is now its own stage (`engine/filmDamage.ts`),
  on whenever dust, scratch or hair is up :
  - **Dust** changes every **film frame** (24 fps, Super 8 18), not every drawn
    frame. Mostly tiny specks, rarely a big one (a power law), with irregular
    rotated outlines, sharp or out of focus, big pieces mottled like real clumps.
    Dark on the print, white sparkle from the negative, never pure black or white.
    The count changes every frame, bunches up and comes in occasional bursts.
    Specks smaller than a pixel fade instead of flickering, so a 1080p render and
    an 8K dome master look the same. The odd **fibre** too : thin, curved,
    tapered, uneven.
  - **Scratches** run along the strip : each lasts from a fraction of a second to
    a minute, stays straight within a frame, wanders slowly sideways, starts and
    ends partway down a frame, breaks up, and has ragged edges. Mostly dark (the
    print), some white (the negative), some green / yellow (a colour print's
    emulsion), sometimes two or three running together.
  - New : **gate hair** (a hair caught in the projector gate, hanging in from an
    edge and trembling, for seconds to a minute), **film gauge** (35 mm / 16 mm /
    Super 8 : the same dust is ~4x bigger on Super 8) and **dirt on** (print /
    mixed / negative).
  - Dirt and scratches ride the Film Hold boil; the gate hair doesn't.
  - Under half a millisecond per frame at 4096² (measured).
  - Griffé, Peint and Pressé retuned; Randomize no longer dirties the Finalizer
    (dust, scratch, hair, gauge and dirt are left as they are).
  - Older sessions and scenes keep their look : Randomize used to roll dust and
    scratch values that stayed invisible without Film Hold, so a session saved
    before this change with the hold off opens with them at zero (once).

- **Output page order**, top to bottom : Composition size, Render scale, Mapping,
  Fulldome, Fullscreen output, Record, Spout / Syphon, NDI, HIVE, Flash safety,
  Lights, Installation mode. The Spout section is now **Spout / Syphon** and shows
  the one this computer uses. Flash safety starts collapsed (it stays on).

- **App text** uses American spelling throughout, and names, presets and tooltips no
  longer carry third-party brand or artist names (the Colorizer film-stock presets, a
  Palette and a master preset are renamed descriptively).

- **No em dashes in the app text.** Empty menu choices read plainly (`none`, `nothing`,
  `solid color`, `voices`, `no saved sessions`) instead of being wrapped in dashes; an
  empty readout (FPS, frame time, CPU / GPU %, the Assemble clip counter) shows `-`, an
  idle MIDI input says `no MIDI received yet`, and Sonify's centered mixer filter shows
  `off`. Toasts, tooltips, Study blurbs and the OSC panic description use a colon or
  plain punctuation, and the Body page's help and tooltip quote the new `nothing`.

- **docs/bibliography.md** : the research papers behind the instrument, cited in APA 7.

- The **window title** now carries the release version, like dataFLOU_compositor:
  `Palinopsia v1.1.0` on the main window, `Palinopsia v1.1.0 : Output` on the output
  window. Read from `package.json` at launch, so every tagged build titles itself.
  (The output windows' title was also being silently reset to plain "Palinopsia" by
  the shared page `<title>`; it now holds.)

### Fixed

- **The Resolume mapper's scrollbars flickered** : the canvas sat inside the scroll area,
  so a redraw could add and remove the scrollbars frame after frame. It is laid over the
  scroll area now and never changes what scrolls (measured : one scroll-area size over 2 s
  of frames).
- **A click in the Resolume mapper toggled a pin far to its left** at any UI zoom below
  100 % (and to its right above) : the matrix compared viewport pixels with its own. Hit
  tests now divide by the effective zoom. Measured in a test copy : four clicks at 80 %,
  100 % and 125 % each toggled exactly the clicked pin. The msg/s readout no longer
  shows 0 for its first second.
- **The Body pip sits in the lower right** of the full-page views (Sonify, Output,
  World, Sequence, Resolume), where it no longer covers Sonify's tap menu. On the main
  view it steps aside : it covered the tap-tempo end of the toolbar, whose lit Body
  button is the tell there.
- **Development (`npm run dev`) : a hot update no longer leaves a second engine
  running.** Editing the sound engine, the audio input or the body tracker re-runs
  that module with a fresh copy, and the old one played on with nothing left to stop
  it : Sonify off and the sound still going (its audio context is kept open now), a
  line-in monitor still on the speakers, or two trackers on one camera (lag, and the
  camera driver's "Failed to reserve output capture buffer"). The new copy now shuts
  the old one down. Compiled out of a real build, which never had the problem.
- **A modulated on/off button now looks modulated** (accent2, blue in the Studio theme,
  like a modulated slider or menu) and shows its LIVE state, ON and OFF flipping with
  the modulator (a Collage's `freeze` driven by an LFO); a click still sets the stored
  state. The shared live overlay gained a paint-it-yourself subscriber for it.
- **The Ring bank's driven voicings rasped like a ring modulator.** MS-20, Steiner and
  K35 soft-clipped the WHOLE mix of the Collage's pieces before the bank; the loud low
  pieces (the centre of the frame gets the lowest notes) intermodulated there, sums and
  differences of their notes. The drive now pushes each band's own clip instead : the
  grit stays (every band still clips, harder), the rasp goes. Measured offline on the
  worklet's own RingBank (low scale tones + film noise, the Kamouropsia settings) : 2.22 %
  of the MS-20 output fell off every note, 0.09 % now (Steiner 0.84 → 0.06, K35 1.45 →
  0.08, Clean 0.04); peaks unchanged; 0.2-0.55 ms per audio block.
- **Sonify heals itself after an audio device error.** Its audio context now stays open
  for the whole session, so a device error (an interface unplugged, the output switched,
  a driver hiccup : twice in one Windows run) could leave it closed, suspended or
  silently stalled for good. It now listens for the device's error and state changes and
  checks every 5 s that its clock still moves; then it resumes, or rebuilds the context
  and restarts the sound. Never in the middle of a take (its sound track belongs to the
  context) : right after it. Measured : suspended → back in 0.45 s; closed → a new
  context, sound on; closed during a take → the take saved, rebuilt as it ended.
- **Double-clicking a modulation depth slider resets it to 0.5** (the depth a new binding
  starts at), like every other slider : in the Inspector's modulate panel, the Modulation
  panel, a Meta knob's binding and Sonify's targets. Their tooltips say so.
- **After a GPU crash the engine came back broken.** A GPU reset hands back the SAME
  WebGL context object with every program, texture and vertex array dead, and five
  caches keyed by it kept serving the dead objects (the shader bridge's blank texture
  and cleanup VAO, Collage, Text, Parametric, the native nodes) : "object does not
  belong to this context" on every frame, shaders failing to load, then no WebGL at all
  until a restart (seen twice in a Kamouropsia run). A GL generation
  (`engine/glGeneration.ts`), bumped when a context is lost AND when it is restored, now
  invalidates them all; the old engine stops drawing at the loss. Measured with a
  simulated reset : no GL error after the restore (it was a steady stream), the Collage
  playing and the picture moving. The Collage also stopped asking the GPU four blocking
  questions per render (twice a frame with FX before shapes). An ISF load error now
  logs its message instead of "[object Object]".
- **macOS installation** : the control window (which renders the picture the output
  shows) now keeps full speed while the fullscreen output covers it (Chromium's Mac
  occlusion tracking is off, like Windows' already was, in the SAME switch : a second
  `disable-features` would have replaced the first), the app opts out of App Nap
  (`NSAppSleepDisabled`), and the installation output's always-on-top is Windows only
  (on macOS it could fight the fullscreen Space). The README gains a Mac checklist.
- **OSC video speed now matches the slider.** `/opsia/layer{n}/video/speed` mapped 0..1
  across 1/28× to 128× (log) while the transport slider runs from 1/64×, so a
  controller's value and the slider disagreed (outbound feedback too). Both use 1/64×
  to 128× now : a controller mapped to the old range lands a little slower at the low
  end. Two app texts were also out of date : the Record section said DXV3 has no sound,
  and the toast after leaving an installation named a "launch on restart" button that is
  now "Enable on next restart".
- **A reloaded window froze the projector.** The frame link between the control window
  and the output was wired once, at the output's first load : a reloaded control window
  (a crash self-heal, Ctrl+R) or output never got a new one, and a reloaded control
  window forgot the output was open. It is wired on every load, and a reloaded control
  window streams to the open output again (measured : frames flowing after a control
  reload and after an output crash).
- **Cmd+Q on macOS left the app half-dead.** The subsystems stopped on `before-quit`,
  before the Save prompt : cancelling it left OSC, autosave and the senders dead. A quit
  now closes the window through its prompt first; everything stops on `will-quit`.
- **macOS output** : moving a fullscreen output to another display rebuilds it (macOS
  ignored the new bounds), and a span may cover several screens.
- **The macOS app is signed again (ad hoc).** electron-builder 26 no longer signs an app
  ad hoc by itself : the CI build skipped signing entirely, and Apple Silicon refuses to
  run unsigned code ("Palinopsia is damaged"). `identity: "-"` signs it, the hardened
  runtime is off (it would silently block the camera and the microphone without
  notarization), and CI now verifies the signature, the bundled ffmpeg included. The
  app also declares why it asks for the camera, the microphone, the screen, Documents
  and the local network (macOS 15 silently blocks OSC, NDI and light output without
  that last one), and the build is pinned to arm64. The install steps (Applications
  first, then `xattr -cr` or Open Anyway; right-click → Open stopped working in macOS
  15) are in the README, the release notes and the site.
- **A toggle could not be modulated : the Collage's freeze never froze under a
  modulator.** A toggle was assigned Multiply, whose law keeps a zero base at zero, so a
  modulator on a switch stored off did nothing at all; a switch stored on stayed on at
  the default depth; and even Replace never flipped one under depth 0.5. Toggles now
  follow one law in both modes (the chip reads `tgl`) : at depth 1 the toggle follows the
  modulator (on in its upper half), and less depth leans toward the stored state.
  Measured on a Collage with a 0.5 Hz sine : freeze stored off, default depth, frozen
  0 % of the time before and 34 % now, 50 % at depth 1; stored on, default depth, 100 %
  before and 68 % now; every film resumes after. Saved sessions' toggle assignments
  start working too. A menu sitting on its first choice is now also assigned Replace
  (Multiply could never move it off that choice).
- **The first take after launching the app could come out empty.** The hardware H.264
  encoder took 1.5 to 2.5 s to deliver its first frames the first time it was used, so a
  first MP4 or ProRes take shorter than that saved nothing (1 cold start in 3, measured).
  The app now warms the encoder up a few seconds after launch with a short hidden
  recording of an offscreen canvas (no file, no toast) : the first take's first data now
  arrives after about 0.6 s, 4 cold launches out of 4.
- **The output shape always looked feathered.** Its edge faded over a fixed 0.8 % of the
  frame height whatever the resolution : ~7 px at 1080p and about 33 px on a 4096 dome
  master, a soft edge you could not turn off. It is now anti-aliased over about one pixel
  (measured : the fill-to-picture ramp at 1080p went from 6-7 px to under 1), and a new
  **feather** control on the output shape softens it on purpose (0.05 is the old edge,
  0.5 a 54 px fade at 1080p).

- **Collage : lighter and sturdier.** Frame uploads now share a 4 ms main-thread budget
  per frame, round-robin (50 films at a speed of 2 uploaded every film every frame,
  ~15 ms); the upload staging cache holds 16 frame sizes under 160 MB instead of 4 (a
  mixed folder re-created a texture on every upload). Auto deals faster than a second
  re-cut the wall and re-shuffle the films already playing instead of reloading files
  (a reload storm froze pieces on their old frame; measured : 8 re-cuts in 3 s, 0 file
  loads; a 2 s Strobe deal still loads new films). A file that fails to load or decode
  is never dealt again and its piece moves to another film (it used to stay frozen, a
  re-deal re-cueing the same file); the folder scan now converts the containers and
  codecs Chromium doesn't open (.avi, .mxf, .mpg; MPEG-1, MPEG-4 part 2, WMV). A deal on
  a stopped wall (layer or global Speed 0) shows its new films; a window ending at the
  file's end no longer seeks twice per loop; a new file re-arms its frame callback (a
  stranded one dropped the film to the ~8 fps fallback); a background Collage that
  isn't shown stops decoding after a second. Measured on the RTX 4070 : 60 fps with 12
  films (wall 2.9 ms) and with 24 films at speed 2 (6.2 ms).

- **Dragging a modulated slider moves its base by as much as you drag.** The thumb
  shows the live (modulated) value, so grabbing it set the base to wherever the
  modulator happened to be (in Multiply mode the base sank a little with every grab),
  and after the release the thumb stayed frozen until something else took the focus.
  Now a drag or an arrow key moves the base relative to where the thumb was grabbed
  (measured : the thumb at 2, the base at 20, a +3 drag → 23), and the slider lets go
  of the focus on release. Counts (Collage `cuts`, `films`) step and read in whole
  numbers, and the modulation depth slider is five times finer.

- **Collage : `cuts` and `films` can be modulated.** Every whole-number step of `cuts`
  re-drew the whole partition and its film assignment from one random stream, so an
  LFO reshuffled the wall every frame (86-100 % of the frame changed film per step).
  The partition is now stable : each piece's choices hang on the piece (the cut-up's
  n-1 splits are the same whatever the count; the mosaic seeds are a best-candidate
  sequence whose every prefix is evenly spread), films go to the least-used film in
  creation order, and the mask order and rotations are per piece. Measured : 0-13 % of
  the frame changes film per step (cut-up), 2-14 % (mosaic). The count steps with a
  little hysteresis (0 rebuilds with a modulator hovering at 12.5) and the deck array
  is sized from the stored count, never the modulated one (a slow modulator used to
  reallocate up to 80 MB). A film no piece plays keeps running 1.5 s before it pauses,
  a `films` step no longer restarts every film (measured : they play on), the churn
  re-rolls no longer repeat after each change, a modulated `window` applies while it
  moves (every 0.3 s), and morphs (Randomize, Variation, scenes) take `films`, `shape`
  and `feed` straight to the target instead of building a decoder per step. The mosaic
  shader now searches every seed (60 fps at 64 shards with torn paper, RTX 4070).

- **Menus open on their anchor at any UI zoom.** A source picker's list and every
  right-click menu were placed in screen pixels inside the zoomed interface, so the zoom
  was applied twice : at 80 % a layer's source list opened hundreds of pixels to the left
  of its button. They now open on the button (or the cursor) at 80, 100 and 125 %
  (within 2 px, measured), and follow it when you zoom with a menu open.

- **Sonify's Collage voice crossfades instead of cutting.** At every deal the sound
  dropped to silence for 100 to 200 ms (measured), because a film loading its new clip
  reads as paused and the voice paused its sound with it; and each piece was rewired to
  its new film on the spot. Now a deal crossfades every piece (the old places and notes
  fade out as the new ones come in, equal power) over the Collage's own crossfade time,
  30 ms at 0; a film taking a new clip, or jumping (a window loop, a re-cue), hands over
  between two players once the new one sounds. Over three deals the quietest 10 ms now
  stays within 3 dB of the median, as with no deal at all. Deals faster than the
  crossfade shorten it, so the fades never pile up.

- **The Sonify audit** (three passes : the audio engine, the page and its links, the DSP) :
  - **The noise repeated every 218 ms.** The noise generator's arithmetic lost its low
    bits, so every seed fell into the same 10,466-sample cycle : the Filter voice's wind
    was a 4.6 Hz loop (correlation 1.0 at that lag). It is true noise now; the loop is
    the Filter's new `loop` knob if you miss it.
  - **The reverb mix did nothing** : both reverb sliders, the `fxReverb` modulation and
    OSC `/fx/reverbmix` were ignored. It works now, with 0.6 (the default) at exactly the
    level the reverb always had.
  - **Switching a voice clicked** (the sequencer did it in rhythm) : the jump at a
    toggle measured 0.49, 4.7x the largest normal sample step; with a 5 ms fade, 0.06.
    A voice coming back no longer restarts at its old level or fires the notes queued
    while it was off.
  - **Every slider move, OSC message and sequencer step wiped the modulation** for up to
    50 ms (a modulated pitch or probe snapped to its base) : the modulated values now
    follow every config.
  - **The FX tail stopped mid-echo** after one quiet block, and the stranded echo came
    back when the send rose again : it now plays out (stops once quiet for longer than
    the delay time) and clears.
  - **Events** : a busy frame let the onsets due in one block overwrite the same note
    (only the last of five sounded); a stolen note cut with a click. Now each lands on
    its own voice and a stolen note fades over 3 ms.
  - **Notes past Nyquist** folded back out of key (a raised root octave put Spectra's top
    partial at 59.7 kHz, heard at 11.7 kHz) and an Events note could run its phase away
    into a thump and a dropout : Spectra and Chord partials past it go silent, Flow and
    Events notes drop an octave; Filter bands above its ceiling drop by octaves instead
    of stacking into one whistle.
  - **Prism's freeze dulled** after any size change (a float32 glide stalled a fraction
    of a sample short); the Orbit's Lissajous jumped every few minutes at high pitches;
    the frame crossfade could jump (the Orbit now crossfades per sample); the master,
    delay mix and voice gains stepped; Raster's tone switched hard into its open setting;
    Flow ignored its pan; new Flow and Events onsets replaced still-pending ones; the
    reverb's buffers clamped at 96 kHz; a NaN (from OSC) could silence a voice until a
    restart.
  - **The audio thread works a third as hard** : the oscillators and Flow's grains read
    wave tables (the same sound within -120 dB, measured) : Flow 533 to 108 µs per block,
    Spectra 191 to 73, Chord 68 to 17.
  - **Turning Sonify on then off quickly** (a double tap, a momentary OSC button) left the
    engine running under a page that said off; line-in never reopened after a restart;
    two quick line-in requests could sum the mic twice; a failed start leaked an audio
    context per retry; a voice switched on burst with motion against a stale frame; the
    image ticks ran at an uneven 24-30 Hz; the sequencer drifted late; a step whose
    preset was deleted or missing on this machine did nothing (it plays its voices now).
    The Collage voice played a new film's first moments before syncing and left dropped
    pieces attached to their film.
  - **The page** : the probes were drawn and dragged over the mirror's black bars, not on
    the picture (a held line at x 0 sat on the left bar); a held line dragged by x
    whatever its path; the sweeps were drawn at the stored rate, not the synced or
    modulated one; the Orbit drew a circle whatever its shape; a modulated Raster rect
    couldn't be grabbed where it showed, and jumped its center onto the pointer.
    The mixer's double-click reset every voice to 0.5 (now each one's default); older
    sessions showed Flow's color at 0 while it played 0.6. Suggest could pick a voice set
    silent on a still frame, and missed a Collage on the background or fed by assemblages.
  - **OSC** advertised index addresses as floats over their raw range, so a client
    following the advertisement sent 4.0 for octave 4 and got octave 6 : they are
    advertised and sent as integers now. A NaN float is read as 0.
  - **Copy** : the Sonify page names no tools or artists in its tooltips, spells color
    and center, has no em dashes, and its sequencer columns are two letters (F/F and C/C
    were twins). The Body page's gesture list can toggle the Collage voice, and the
    MIDI label says Transmission.

- **Sonify's stereo field.** The Chord, Flow and Events voices panned their notes with a
  linear law, so a note in the middle lost 3 dB against one at the side (measured), and
  Chord's spread put the root note hard left. They now pan with equal power (every note
  within 0.6 dB wherever it sits), and Chord's spread keeps the bass in the middle and
  fans the notes above alternately right and left, the highest widest. The Collage
  voice's pieces only balanced their stereo films : a centred piece kept the film's own
  width (a left-only tone stayed 34 dB left) and an edge piece got louder. Each piece is
  now a point source, the film folded to mono and placed by its position with equal power.
- **Palinopsia could run on a laptop's integrated graphics.** Windows picks a hybrid
  laptop's graphics card per program, and leaves one it doesn't know on the integrated
  chip unless its graphics settings say otherwise; the WebGL contexts' power preference
  alone didn't move it. The app now asks Chromium for the discrete GPU at launch.
  Measured from a path Windows had put on the Intel Iris Xe : the RTX 4070 with the
  switch, the Iris Xe without it, about 15x apart.
- **Context's Vibe Color button picked a color that wasn't on screen.** It read the
  Vibe's five manual stops whatever the mode : with a color chord on (whose stops
  replace them) or only two stops active, it usually landed on white and the light
  looked unchanged. It now takes the colors the Vibe is actually painting with (the
  chord's, or the active stops), at full brightness, and turns the light up to 0.25 if
  it was off. One shared helper for the Context section and the Inspector.
- **The previous session kept playing after a session change.** Loading a session (or
  New) compiles its shaders a few per frame, and every layer still waiting its turn kept
  drawing the OLD session's generator, so the projector showed the old visuals for
  seconds, swapping layer by layer. Now the picture holds still until the new session
  has compiled (spending more per frame while nobody watches it assemble), then
  dissolves into it over 0.5 s. Measured (integrated graphics) with 21 shaders to compile : 2.2 s of old
  visuals still playing (14 to 20 different frames) became about 1 s of still frame and
  the dissolve (1.5 s to the new picture on the projector, at most 6 s held).
- **A session could be overwritten without asking.** Load, Open, New, Generate and
  quitting silently saved the outgoing session into its file, so an experiment or a
  dice roll replaced the saved work. And after a crash **Restore** forgot which file
  the work came from, so the next switch wrote it into `Sessions/<the name inside the
  session>`, which a Save As copy shares with its original : another session was
  overwritten. Now a session file only changes when you save it : switching asks
  **Save changes?** (Save · Don't save · Cancel) when something changed, Don't save
  keeps a recovery copy (`Sessions/.history/_unsaved`), a MIDI-triggered switch
  never asks and never writes the file, Restore reconnects to its file, Save As names
  the session after the file, and **every overwrite keeps the previous version**
  (right-click Load → **Earlier versions**). The autosave ring keeps the last hour
  (it kept ten minutes).

- **Surface materials keep their proportions** : seven of the 30 scans are not square
  (bricks, concrete, corrugated steel, painted plaster, rock face, wood grain, paper
  crumpled) and were squeezed into square tiles, stretched to about twice their height,
  in Context's surface material and in the Scan source alike. They now tile at their
  real proportions. **Paper crumpled** also lost a streak of dark pits in its scan that
  repeated across the frame as vertical lines, and now tiles cleanly.

- **Video above 8x froze on real footage** : each frame was an exact seek, which on an
  ordinary (long-GOP) clip decodes from the previous keyframe : 0.5-3 s per seek on
  heavy 1080p / 4K (measured), so the picture held for seconds. ffmpeg now indexes a
  clip's keyframes once in the background, and when a clip's seeks run slow the player
  steps keyframe to keyframe (each such seek decodes one frame) : 14-18 pictures a
  second at 16-64x on camera-like 1080p, about 3 on clips with a keyframe only every 10
  s. Reverse uses it too. The ◇ smooth copy still gives the most (about 40).
- **Video speed** : 8× froze an ordinary (long-GOP) clip outright, and anything slower
  than 1/16× silently played at 1/16×. A clip now drops to frame-stepping when its
  decoder stalls at speed, and slow motion runs down to 1/64× (measured : 1/64, 1/28,
  8 and 64 all play at their set rate).
- **Video grain was upside down** (the voices were flipped twice), and while a grain
  voice was still loading its placeholder formed a GL feedback loop that dropped the
  whole grain picture for those frames.
- **A paused video ignored seeks** (OSC `/video/position`, modulation) : it now lands
  and shows the frame.

- **Context no longer softens the picture with its sliders at 0** : with the surface
  texture off, its hidden relief (default 0.5) still ran the surface stage on the
  flat maps, which are 8-bit and so a hair off flat : the whole frame shifted and
  darkened slightly, a soft blur nothing visible could turn off. Texture off is now an
  exact passthrough (measured identical to Context bypassed).

- Materials without an ambient-occlusion map no longer log a "file not found" error
  each time they load (12 of the 30 ship none; the neutral map is used, as before).
- **The heart shape** (Transform and the Finalizer's output shape) stood upside down,
  tip up, and its edge smudged at the sides and the cusp (it was an implicit curve, not
  a distance). It is now an exact heart, lobes up, with an edge as clean as every other
  shape and the same width as before. Rotate it by 180° for the old inverted one.

- **Weave, lumakey and consume now work as layer blend modes.** They were offered in the
  layer BLEND menu (and reachable by a modulated blend) but only existed in the A/B
  source mixer, so on a layer they quietly acted as normal. Against the stack below :
  weave displaces the two by each other's brightness and interleaves them, lumakey keys
  out the layer's near-black background, and consume runs the mixer's living competition
  field between the layer and the stack (the brighter side eats, they embrace at the
  front).

- **Context's material relief works, and the master no longer skips frames.** An image
  pushed into an effect outside its draw (Context's PBR maps) could be replaced on its
  texture unit by any renderer drawing in between. So Context read a random buffer as its
  brick or bark relief, and when that buffer was its own target, WebGL dropped the
  pass: Vibe and Context were silently bypassed about 13 times a second, even with no
  material selected. Image inputs now bind at draw time. A session saved with a Context
  material now shows that material's relief, which it never did before.

- **Console noise** : a shader swap waiting on the compile budget no longer logs
  "No uniform named ..." for every input the new shader brings.

- **Time and feedback effects (11).** Light Trails and Wide Time never faded back to
  black (an 8-bit stall left a permanent fog of everything that passed); they now fade
  fully, with stochastic rounding so the long trails keep their length. Wide Time froze
  at a quarter of its input, flickered at 30 Hz in difference mode and blew out in add /
  screen (the blowout is kept as a `burn` mode). Feedback Zoom, Light Trails, Decay and
  Slit Buffer showed last frame instead of this one. Difference Bloom blinked on video
  that updates slower than the display. Granular's grains never re-rolled their angle.
  Force Lines' taps were silently miscompiled; its old vertical slide is kept as the
  default. Smear and Streak keep their stepped ghost copies, with a `smooth` knob for
  the clean streak.

- **Every multi-pass effect sampled a black input on its first frame** (a pushed texture
  landed on a unit the pass buffers take), which also stored garbage in persistent
  buffers; and any shader whose last pass renders to a buffer crashed on draw. Both
  fixed in the shader bridge.

- **Native effect nodes (all 25).** Every node forced an opaque output; they now keep
  the layer's transparency. Feedback's brightness control lifted near-black grounds into
  a gray fog and its add blend clipped to white (now it targets the live layer, keeps
  headroom and turns rigidly at 16:9); Sediment's memory never faded (a half-float
  stall); Datamosh's actant mask never cleared and its first frame jolted; Réponse's
  gain did nothing; Chronoscan showed the present at quarter resolution; Eternalism's
  HOLD frames were always one apart; Parallax's fog darkened the near planes; Pulfrich's
  delay mapping wrapped; Melt never crept; Corrode ate the frame in seconds instead of
  minutes (bury is now the time to full corrosion, one minute to an hour) and left a dot
  grid; Sillage's noise collapsed into stripes over long shows; Toile cost 14 ms at 4K
  (now about 3); Mosaïque's tiles stretched at 16:9; Luma Blur and Gooey stepped at 4K;
  Decimate juddered. Nodes restart cleanly after insert, PANIC or a re-enable, follow
  the frame step, and compile lazily. Their signature looks (Feedback's heat, Datamosh's
  melt, the Autocutter's torn paper, the stepped ghosts) are kept.

- **Flash safety now does its job.** The limiter measured per frame on gamma-encoded
  light, so a 10 Hz black / white strobe got through at the default setting (and at
  144 Hz nothing was limited). It now counts flashes per second in real luminance, with
  a saturated-red term, per region of the frame, as flash-safety guidance does : a
  10 Hz strobe comes out with no flashes at the default 0.35, while ordinary content
  (pans, scrolling stripes, cuts, every generator tested) passes through bit for bit.
  Film flutter on a very bright scene can now be softened, since it counts as flashing.

- **The finishing chain.** Vibe mapped pure white to the wrong color stop (clipped
  highlights went gray or black); Context put the whole master one frame late and its
  trails could leave a permanent ghost; digital grain size did nothing; sharpening was
  lost in 3D; torn VHS lines smeared the frame edge. Context's ring-shaped blur and
  bloom stay the default look, with a new `smoothing` knob for the soft version.

- **Finalizer opacity** : the old "A" slider (which reached no output) is now a real
  fade to black, labeled "opacity". A session saved with it below 1 now looks darker.

- **Output stages** : Cameraless could re-show an old frozen frame and its draw clock
  could bank debt; the depth shadow fell the wrong way; the output shaper's edge was
  undefined; Frame-Weave jumped when its rate moved; the superimposition flicker ran
  at 7.5 Hz and now lands on the drawn film frames.

- **Native effect nodes run on their layer's clock** (Speed, freeze, global speed and
  the background's slow clock apply; they used the wall clock), see "no depth" when
  Depth is off (so their brightness fallbacks work), and can read the audio. The depth
  estimator now sees the picture upright. PANIC also clears the trail buffers of the
  rack effects, which could hold a ghost for good.

- **Randomize and Variation** leave deliberate settings alone : anaglyph 3D, film hold,
  the output shape and Vibe's chord mode are never rolled; a pinned dice range now
  keeps the current value (it used to force one); the walk and Variation respect the
  same rules. Palettes (Palette, Colorizer, Vibe) roll as one hue from near-black to
  pale instead of five clashing colors; Lookup no longer gets a random palette layer.

- **Effects audit, glitch / analog / color / geometry (41 effects).** Fixed what was
  broken and kept what gives character (the corrupted-data smears, the stepped blocks,
  the CRT moiré, the edge fringes stay the default look; the clean variants are options).
  - Texture reads that the shader loader silently rewrote : Databend's rotated bands
    read the frame diagonal, Compress never saw vertical edges, Aperture's blur and
    Optical Rain's stereo taps went diagonal.
  - Transparency : Compress, Databend, Pixel Sort, Tiles, CRT Screen, Rutt, Optical Rain
    and Phosphene turned a transparent layer into an opaque black slab.
  - Knobs that did nothing : Pixel Sort's length (capped at 96 px), the Compress grid at
    small blocks, the Pixelmask grid, digital grain size; Row Echo's fade worked
    backwards.
  - Rutt drew no lines in bright areas; Phosphene burned in for good and white left no
    afterimage; Wavefold and Colorizer's fold turned dark grounds white; Palette mapped
    pure white to the wrong color; Distort's bulge and pinch were swapped; Fold's "Floor
    fold" smeared a third of the frame.
  - Knobs that jumped the picture (NTSC field crawl, Scanlines roll, Optical Rain).
  - Presets set every input, so one no longer leaks into the next; 20 Colorizer presets
    named after films, film stocks and brands renamed descriptively.
  - Sizes follow the frame height, so 4K and the dome keep the 1080p look.

- **The picture could freeze when a Parametric slot was switched away** : its
  disposal broke every shader draw. Parametric, Text and Collage now own their
  vertex setup and survive a GPU reset.

- **Collage** :
  - Churn re-rolls were identical, so the wall collapsed onto one film.
  - Churn and window only applied at the next deal.
  - Optimise was ignored on a running wall.
  - Mosaic pieces smeared edge pixels.
  - Crossfades restarted from a stale frame.
  - An aborted seek could leave a piece stuck.
  - Pieces went soft at 4K, because tile size now follows the output.
  - Presets leaked into each other.
  - Layer Speed and the background's slow clock were ignored.
  - Every Collage started from the same seed.
  - A minimized control window froze the wall.

- **Text** :
  - The weight dial did nothing on most fonts; each face is now declared at
    its real weights, and the dial grays out when a font has only one.
  - Modulating size or spacing redrew the whole frame every frame and moved in
    visible steps; Text now uses a glyph atlas, so it is smooth and cheap.
  - Stretch went soft.
  - A Text layer was an opaque black slab in Normal blend.
  - Presets forced the first font.

- **Parametric** :
  - Raster ignored the audio.
  - The frequency axis wasted three quarters of the spectrum; it now uses 512
    log columns.
  - The spectrogram blurred as it scrolled, and its speed depended on frame
    rate.
  - Bars mode ignored `scale`.
  - OSC-audio mode now draws the six bus bands.

- **Source generators, after an audit of all 23.**
  - Every rate-driven source now integrates its rate, so a knob never jumps the picture.
  - Each one still moves, unrepeating, after 24 hours. Before, Slabs froze after about
    3 hours and its cuts looped every 9 s; Particle Drift collapsed into a lattice, Ten
    Print into vertical stripes, and Ash into evenly spaced strings.
  - Lines keep a constant pixel width with a 1-px floor.
  - The 1-px scanlines, which turned into moiré when resampled, are gone.
  - Aspect is correct at 16:9 and on the square dome.
  - Highlights:
    - Murmuration's birds accelerated forever and became strobing dots after about
      10 minutes; they now move in bounded, heading-aligned travelling waves.
    - Congeal never faded back to black (a flat fog).
    - Sync Osc's shape knob had a gray dead zone, and "frozen horizontal" was diagonal.
    - Metamorph had a notch on every blob and a parent that popped out.
    - Differential's fast layers strobed and its presets formed rosettes.
    - Direct Marks' gate swept across the marks as a wave.
    - Ash sliced flecks at column edges.
    - Filaments and Column Scan lost the peaks of their lines.
    - Shapes cut shapes at cell borders.
    - Solid Color's gradient never reached its end colors.
    - Presets now set every input, so one preset no longer leaks into the next.
    - Dice no longer paint the dark grounds a bright color.

- **Knobs no longer jump the picture.** Motion that ran on `time × rate` jumped
  whenever the rate moved : half an hour into a show a small nudge flung the
  picture, and an LFO, a Morph or MIDI on the rate turned it into strobing noise.
  Rates are now integrated frame by frame (a shader declares `PH_rate` and the
  engine accumulates it on the layer's own clock, so Speed, freeze and reverse
  still apply) : the Organic family (Fire / Water / Nature, Membrane, Mycelium,
  Erosion, Dye Field, Swell, Ground, Scan, Colony) and the glitch effects
  (Aperture, Byte Corrupt, Databend, Displace, Distort, Granular, Mosh Blocks,
  Row Echo, Slice Shuffle, Slit Buffer, Stutter, Sync Loss, Tracking, Triangle
  Flicker).

- **Long shows.** The old shader hash lost precision as time grew, so glitch
  effects, the Finalizer's grain and CRT / VHS parasites settled into fixed
  patterns within an hour or two. A precise hash and wrapped seeds everywhere.

- **Audio-reactive generators read the wrong row.** The shared audio texture's
  waveform and spectrum rows were swapped whenever a shader had loaded since the
  last video frame (the shader runtime leaves the upload flip on). The spectrum
  row is now log-spaced 30 Hz to 16 kHz, so it spreads musically across elements
  instead of bunching into the left fifth. Any generator that declares the audio
  input gets it, on the background slab too.

- **Freeze-proofing.** The video source and the film, output-shape,
  flash-safety and depth-shadow stages now each own their vertex setup, so none
  of them can break every shader draw when it is disposed; the effect nodes
  rebuild after a GPU reset; photo materials no longer load upside down
  depending on load order.

- **Fresh installs started with the wrong defaults** : Flash safety off (meant
  to be on, mild, at 0.35), the Flow macro fully engaged instead of neutral,
  Morph at 0 ms, the audio monitor muted.

- **Mosaïque** never matched anything : its matcher named a variable `patch`, a
  reserved word in GLSL ES 3.00, so the matching program never compiled and the
  node could not choose tiles. Found by compiling every engine shader in a plain
  WebGL2 context.

- **The output stage no longer stalls the render loop.** Measured at a 4K
  composition :
  - the projector window : 25-27 fps with it open, now 60 (its readback was
    synchronous; the frame is now read back asynchronously and posted to the
    window from a worker, where the cross-process copy no longer costs the loop);
  - the Output page with the 4096² dome simulator : 47-49 fps, now 60;
  - **Spout delivered 0 frames per second at 4K** (its two-slot readback dropped
    every frame whose fence was late); it now sends ~58 fps of the clean picture
    from the window's own process, top-down (no CPU flip);
  - projector + Spout + a DXV3 take together : 57-60 fps.

- **HIVE output could never start** : its encoder settings asked Windows' hardware
  encoder for 60 fps, which it refuses at every size (measured). It starts now.

- The projector window no longer receives the whole render state every frame
  (left from when it ran its own renderer) : just the keystone, when it changes.

- A recording the encoder never fed no longer leaves an empty file behind.

- **Recording can always be stopped.** When the video encoder refused a take (the
  4096² dome master is beyond it), the take died silently and STOP waited forever for
  it, so the REC pill never went away. Stop now always ends the take, a second click
  joins the first, and a take that dies ends by itself with a message saying why.

- **Minimizing the window no longer stalls the show.** A minimized window gets
  (almost) no animation frames from Chromium, so the render loop, and with it the
  projector stream, Spout, Sonify and OSC out, dropped to about one frame a
  second. The loop now notices and runs on a timer until the window paints again,
  and that timer waits for the GPU to finish each frame : without rAF's pacing, a
  heavy scene let the loop run seconds ahead of the GPU, and NDI starved behind
  the queue (measured : 0 to 1 fps, now it follows the render rate).

## v1.1.0 — 2026-09-18

The "played by the room" release: embodied control, sound in both directions, and
the instrument reaching out into the space around it (projectors, DMX, MIDI clock).

### Added

- **Body: embodied control (new full-page mode, key `B`).** Opt-in webcam →
  MediaPipe **Hands + Pose + Face + Silhouette** into a live body bus.
  - **Features → modulators:** every tracked quantity (hand height / openness,
    body lean / motion / stance, face blendshapes + head pose, and the silhouette
    zone coverages) is a `body` modulator source, routed with one click.
  - **Rule builder:** author actions from one gesture or a two-gesture combo
    (together `+` or in sequence `→`, with exclusive combos), drawn from the shared
    MIDI/keyboard trigger vocabulary (Randomize scopes, transport, scenes, Sonify
    voices, sessions, undo/redo). Auto-named, with a custom `/body/<name>` OSC out.
  - **Silhouette zones:** the pose segmentation mask reduced to a 3×3 screen grid —
    each zone a continuous feature and a `cover …` occlusion gesture.
  - **Presence** enter/leave triggers (body / hands / face), debounced: the
    installation trigger for someone walking into or out of frame.
  - **Per-gesture sensitivity** on single-gesture rules (global slider is the default).

- **Colour ↔ sound.** An `audio` **noisiness** (spectral flatness) feature and
  `vision` **hue** + **saturation** features, so sound can tint the picture and
  the picture's colour can drive any Sonify parameter through the mod matrix. The
  Sequencer's **Climat** tag takes a "from picture" suggestion off the live palette.

- **Installation / kiosk mode.** Boot a session fullscreen on a chosen display,
  with renderer-crash self-heal and an exit hatch. Custom composition size and
  **multi-projector span** for wide outputs.

- **Light output.** ArtNet/DMX + WLED: push the picture's colour into the room.

- **MIDI output.** 24-PPQN clock + transport and a thru/merge path to drive an
  Ableton Move (or any gear) over USB; the Randomize dice, master-FX chain and
  session buttons are now MIDI-learnable.

- **Audio input** monitoring / passthrough with separate Sonify and monitor levels,
  and an adaptive USB-noise **denoiser** (learn the noise, multi-notch filter).

- **Performance** sub-tab: per-section GPU / CPU / RAM load, with units and tooltips.

### Changed

- Sequencer page: clearer visual sections and hover overviews; a colour-coded,
  aligned Body feature monitor.

- Documentation: full Body section in the README, and the GitHub Pages quickstart
  reworked into a landing page with a download section.

## v1.0.2 — 2026-09-09

- Maintenance and packaging fixes.

## v1.0.1 — 2026-09-09

- Windows app-icon fix.

## v1.0.0 — 2026-09-09

- First public release: the four-layer ISF/WebGL compositor, modulation brain +
  Meta knobs, curated Randomize + Generate, video / capture / HIVE sources, Output
  + warp + Spout/NDI, OSC + OSCQuery, the Sonify image-to-sound engine, MIDI Learn,
  and the Assemble automatic video editor. Windows + macOS + Linux.
