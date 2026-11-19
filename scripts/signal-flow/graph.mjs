// Palinopsia's signal-flow map : WHAT it shows. Every block, link and sentence here was
// checked against the code (see AUDITED below); scripts/signal-flow/build.mjs draws it
// into docs/signal-flow.html (npm run signal-flow).
//
// When the code changes a path this map shows, change it here, re-check it against the
// code, bump AUDITED, and run npm run signal-flow.
//
//   node(id, x, y, title, subtitle, kind, description, code refs)
//     kind : in (enters the app) | ctl (control plane) | bus | pic (picture path) | out
//     x, y : place on the W × H map. y is the block's middle; x is its middle too, except
//            for inputs (their right edge, toward the map) and outputs (their left edge).
//            The block's size comes from its title and its role (build.mjs) : the spine,
//            the longest chain of picture links, is drawn large; bookkeeping is small;
//            inputs and outputs all take their column's width.
//     The subtitle is not drawn on the map : the detail panel shows it.
//   edge(from, to, type, label, alwaysLabelled, customPath, labelAt, sides)
//     type : pic (the picture) | ctl (control, modulation) | snd (sound) | net (in or out of
//            the app) | loop (feedback inside the app) | phys (a loop that closes only
//            through the room or the network)
//     customPath : a named route drawn round the map (build.mjs CUSTOM). Links from the
//                  control plane to an output are routed by build.mjs itself : to the
//                  outputs beside it through one stream, to those below by the river.
//     sides : 'bt', 'rb'… the sides the link leaves and enters by, when the automatic
//             choice reads badly.
//   MINOR : secondary links, drawn faint until a block is picked.
//   BOOKKEEPING : blocks drawn small, as labels, besides those with only secondary links.

export const AUDITED = { branch: 'claude/busy-feynman-fq8h6d', commit: 'a37abc8', date: '2026-11-15' }
export const W = 1790, H = 1100
export const IX = 214, OX = 1560

export const N = {}
export const E = []
function node(id, x, y, title, sub, kind, desc, refs = '') {
  N[id] = { id, ax: x, ay: y, title, sub, kind, desc, refs }
}
function edge(a, b, t, label = '', always = false, path = null, lt = 0.5, sides = null) {
  E.push({ a, b, t, label, always, path, lt, sides })
}


// ── Inputs ─────────────────────────────────────────────
node("in-ui", 214, 104, "UI · keyboard", "controls · keys · preview", "in", "Every slider and button writes the store through the same actions OSC and MIDI use; keyboard shortcuts call those actions directly. Clicks in the preview are touches, and the Macro knobs take their new value through a glide.", "store.ts · App.tsx onKey · pointerInput.ts")
node("in-osc", 214, 148, "OSC in", "port · multicast · aliases", "in", "UDP on the IN port and on up to 8 joined multicast groups; muted senders are dropped first. Aliases turn a controller's address into an /opsia one, before and alongside OSC Learn. /opsia addresses become store actions (scene recall is /opsia/scene); Learn plays continuous targets and triggers; /opsia/audio feeds the audio bus (Pandore's analysis); /opsia/mod/n the control bus; /opsia/macro the knobs; /opsia/touch the touch bus.", "main/osc-receive.ts · oscInput.ts initOscInput, route · oscAliases.ts · oscLearn.ts")
node("in-midi", 214, 192, "MIDI in", "Learn · CC · notes · clock", "in", "MIDI Learn bindings: a CC, the pitch bend or aftertouch plays a control, a Macro knob or a modulator input (catch waits for the control to reach the value); a note fires a trigger or plays a modulator input as an envelope. Faders land once a frame. Follow clock: a MIDI clock sets the BPM (Link wins when it has peers), Start / Stop drive the Seq transport. Messages can pass through to MIDI out.", "midi.ts MidiManager.onMessage, midiTargetsFor, applyContinuous")
node("in-df", 214, 236, "dataflou mesh", "published parameters", "in", "One node on the mesh. A value on a published destination plays exactly like its /opsia OSC address; meta/i plays Macro knob i; act/… paths fire triggers; remote values feed controller modulators.", "main/dataflou · dataflou.ts · shared/dataflou.ts DF_DESTS")
node("in-mcp", 214, 280, "Agent (MCP)", "localhost · tools · snapshot", "in", "An AI agent on this computer calls store actions and OSC routes as tools, and can ask for a snapshot of the warped output canvas.", "main/mcp.ts · mcp/tools.ts snapshot")
node("in-link", 214, 324, "Ableton Link", "tempo · beat · start/stop", "in", "Shared tempo, beat phase and start/stop with other Link apps, both ways: a BPM edit here goes out to the session, and Link play sends MIDI start/stop.", "main/link.ts startStopSync · link.ts tickLink, linkSetTempo")
node("in-audio", 214, 368, "Audio in", "interface · chosen channels", "in", "An audio interface, on the channels you pick. It is the audio bus's local source when no OSC analysis arrives, the Filter voice's line-in, and can be monitored on the speakers.", "engine/audioIn.ts startLocal · sonify.ts setLineInput")
node("in-body", 214, 412, "Body camera", "MediaPipe · Room (RTMO)", "in", "A camera read by MediaPipe (pose, hands, face, segmentation) or the Room tracker (everyone in the frame), in workers. Besides the body bus, the segmentation feeds the Silhouette source and the Room's people feed the Drape node.", "engine/bodyTracker.ts silhouette · roomTracker.ts list · SilhouetteSource.ts · drapeNode.ts")
node("in-video", 214, 548, "Live video", "camera · screen · NDI · Spout · Syphon · HIVE · iPhone (USB)", "in", "Live pictures used as layer sources: webcams and capture devices, screen capture, NDI, Spout / Syphon from other apps, HIVE streams (found by name on the network, reconnecting on their own), an iPhone over USB.", "engine/CaptureSource.ts · HiveSource · main/hive.ts")
node("in-files", 214, 592, "Files", "films · Collage · Assemble · audio files", "in", "Video and audio on disk: a slot's film, a Collage wall, the corpus Assemble edits from, the Audio Layer's files and Import Audio slots. Their sound has its own paths, apart from the picture.", "VideoSource · CollageSource · assemble/ · audioLayer.ts")

// ── Control plane : store, scenes, sync ────────────────────
node("c-store", 320, 104, "Store", "the session · all writes go through actions", "ctl", "The single source of truth (zustand). UI, OSC, MIDI, dataflou, the agent and triggers change it through the same actions. Per-frame modulation is overlaid on the engine instead, and writes back only on purpose: a Macro knob settling, a Vary fired by a modulator, the scene sequencer recalling a scene, the Seq page's steps and key, the Metasurface's drawn path.", "store.ts · metaSmooth.ts commitKnob · modulation.ts flushVaryEdges")
node("c-trig", 440, 170, "Trigger catalog", "~260 actions + scenes · rules", "ctl", "One vocabulary of named actions (a layer's Vary, Randomize, a Sonify voice…), about 260 fixed ones plus one per scene, World, rule and event input. MIDI notes, Body gestures, OSC Learn and dataflou act/ paths fire them.", "triggerCatalog.ts · midi.ts fireTrigger")
node("c-rules", 440, 330, "Body rules", "gesture → action · /body", "ctl", "Gestures (single or combos) fire an action from the trigger catalog and/or send a /body/<rule> OSC message. The Seq page's rule timeline switches them on and off.", "App.tsx Body-rules effect (fireRule, fireSingles) · engine/ruleSeq.ts")
node("c-scene", 320, 262, "Scenes", "Morph · Metasurface · Randomize · Vary · Generate", "ctl", "Chooses this frame's composition: the store's, a scene being morphed into, or the Metasurface's blend of scenes (its drawn path writes the position back). Randomize, Vary and Generate write new compositions into the store.", "App.tsx loop: consumeSceneChange, morphedComposition · surface.ts surfaceComposition")
node("c-sync", 440, 400, "Sync", "base values → every stage", "ctl", "Writes the chosen composition into the engine once a frame (sources, every rack, layers, Background, dome, output transform), before anything modulates it.", "Compositor.syncFromState")

// ── Buses ──────────────────────────────────────────────────
node("c-abus", 590, 250, "Audio bus", "level · flux · onset · pitch", "bus", "Audio features each frame, from OSC (a controller or sound computer) first, else the local source: the audio interface or the Audio Layer. Feeds audio modulators, Coupling, Proximity, Tonicity, the scene sequencer, the lights and the waveform texture generators read.", "engine/audioIn.ts audioBus.tick")
node("c-vbus", 590, 392, "Vision bus", "brightness · motion · edges", "bus", "Features of the picture itself, read back from the GPU about 30 times a second, a frame or two late (32² cells, 64² while Assemble cuts live), only while something reads them; plus the depth map's mean and spread.", "engine/visionIn.ts · Compositor.visionSample")
node("c-bbus", 590, 350, "Body bus", "pose · hands · people", "bus", "Body features (hand heights, hands apart, movement energy, presence, people in the Room) and gestures.", "engine/bodyIn.ts · bodyBus.drainGestures")
node("c-cbus", 590, 104, "Control bus", "MIDI · OSC · mesh inputs", "bus", "Raw controller inputs for controller modulators: a value that plays a modulator or takes it over while it moves; a MIDI note as an envelope.", "engine/controlBus.ts")
node("c-tbus", 590, 146, "Touch bus", "/opsia/touch · preview clicks", "bus", "Touch points from OSC and from clicks in the preview, read by the Touch and Ripple nodes.", "touchInput.ts touchBus · pointerInput.ts")
node("c-clock", 590, 192, "Clock", "BPM or Link beats", "bus", "The tempo (or Link's) and beat phase. Synced modulators, the Seq page, the MIDI clock, the lights and the Loop delay (in beats) follow it. The scene sequencer does not: it runs on seconds and on sound.", "link.ts · audio/soniClock.ts soniClockTick")
node("c-alayer", 590, 292, "Audio Layer", "audio files, played", "bus", "Audio files played inside the app. Their sound can be the audio bus's local source, goes into Sonify's mix (its second input), can be listened to by audio modulators, and its own parameters are modulation targets.", "audioLayer.ts buildOn, setAuMod · audioIn.ts LAYER_INPUT")

// ── Modulation ─────────────────────────────────────────────
node("c-mods", 800, 104, "Modulators ×8", "LFO · ADSR · steps · euclid · turing · audio · vision · body · homeostat · 20 kinds", "ctl", "Eight slots of 20 kinds: LFO, ramp, ADSR, arp, random, S&H, slew, chaos, audio, organic, physics, motion, vision, body, homeostat (negative feedback), euclid, turing, cellular, steps, controller. Audio modulators can listen to a slot's soundtrack or the Audio Layer. Evaluated every frame before render.", "engine/modulation.ts modEngine.tick · shared/types.ts ModulatorType")
node("c-matrix", 800, 150, "Mod matrix ×32", "depth ± · multiply / replace", "ctl", "Up to 32 bindings from a modulator to any target: source and FX inputs, layer opacity / mix / blend, Background, dome, output transform, World amount, Macro knobs, a layer's Vary, the Audio Layer, Sonify and Space, the lights.", "shared/types.ts ModTarget, MAX_MOD_ASSIGNMENTS · modulation.ts applyModulation")
node("c-macro", 800, 196, "Macro knobs ×16", "8 destinations each · curve", "ctl", "Sixteen knobs, each driving up to eight destinations through its own range and curve. Played from the UI, OSC, MIDI, dataflou or a modulator; they glide, then settle into the store.", "modulation.ts applyMetaGlides · metaSmooth.ts setKnobTarget, commitKnob")
node("c-feel", 800, 262, "Feel", "proximity · density · flow", "ctl", "Proximity (audio-driven when switched on), the field macros (density, gesture / texture, coalescence), then tonicity (it reads audio too), drift, flow ↔ interruption, shutter, flicker.", "engine/field.ts applyProximity, applyFieldMacros · temperament.ts")
node("c-coup", 800, 304, "Coupling", "audio → each layer's A/B mix", "ctl", "Each layer's coupling (from the composition) leans, hockets, cuts, gates or drifts the layer between its sources A and B from an audio feature.", "engine/coupling.ts applyCoupling")
node("c-world", 800, 346, "World", "applies · amount", "ctl", "Applying a World writes every layer's coupling, the Context and film inputs and an audio modulator into the store. Its amount then blends only the Context and film keys in, every frame, after the field macros.", "worlds.ts · engine/worldAmount.ts applyWorldAmount")

// ── Per-frame values and sequencers ────────────────────────
node("c-frame", 975, 392, "Frame values", "overlaid on the engine every frame", "ctl", "Everything that moves this frame (modulation, Macro glides, Coupling, Feel, World amount, the sequencer's breathing, freeze, flicker, Black) is overlaid on the engine's base values right before it renders, at every stage. The session itself stays as you set it, except for the deliberate write-backs named on the Store.", "App.tsx loop: modEngine.tick … comp.render")
node("c-seqp", 1040, 104, "Seq page", "Sonify steps · key · rules", "ctl", "Three sequencers on one bar clock: Sonify's step sequencer, the key sequencer (it can take the key from the picture) and the Body rule timeline. They write the store.", "audio/soniClock.ts · tickSonifySeq, tickKeySeq, tickRuleSeq")
node("c-seq", 1040, 150, "Scene sequencer", "dwell · onsets · chaos", "ctl", "Recalls the next scene after a dwell (seconds, with jitter), on an audio onset or transient, or when a chaos modulator fires; breathes the Context over an arc.", "engine/sequencer.ts tickSequencer, dwellMs, doRecall → sequenceTo")
node("c-time", 1110, 262, "Time", "freeze · flicker · Black", "ctl", "Freeze, flicker, frame-weave, the relay envelopes and Black, applied last before render. Black also fades Sonify and the films' sound.", "App.tsx loop: setFreeze … setBlack, scaleLayerSound · black.ts")

// ── Picture path (GPU) ─────────────────────────────────────
node("p-srcA", 311, 535, "Source A", "ISF · film · live", "pic", "The layer's first source: an ISF generator, a native engine, a film, a live input, Collage, Assemble (its live cuts follow the vision bus), Text, the Silhouette (the body camera's mask), a Model (a 3D object, built in or from a file, whose real depth can stand in for the depth map), a Grid Mesh (a grid shape torn by a still noise and by the sound, drawn point after point, wearing another layer as its skin, its real depth on request), another layer (Loop source)…", "Compositor ISFLayer.renderSource · assemble/liveMatch.ts syncLiveMatchers")
node("p-srcB", 311, 597, "Source B", "optional", "pic", "The layer's second source, mixed with A.", "Compositor.render (renderSource B)")
node("p-rackA", 446, 535, "Source FX A", "its own rack", "pic", "Effects on source A alone (ISF effects and native nodes such as Datamosh, Melt, Transfert).", "Compositor.render (rackA.apply)")
node("p-rackB", 446, 597, "Source FX B", "its own rack", "pic", "Effects on source B alone.", "Compositor.render (rackB.apply)")
node("p-mix", 577, 566, "A/B mix", "blend · harmony", "pic", "Mixes A and B by the layer's mix and blend; harmony matches or clashes their hues.", "Compositor.mixSources")
node("p-lrack", 695, 562, "Layer FX", "layer's rack", "pic", "Effects on the mixed layer. Native nodes here can read the depth map, other layers, touches and the Room's people.", "Compositor.render (rackLayer.apply) · nodeCtx")
node("p-loop", 801, 566, "Loop", "delay · Loop rack · trail · ×0.97 max", "pic", "The layer's feedback: its last frames, delayed (in frames or beats) and passed through the Loop rack's effects (which compound on every pass), blended back with the new frame, at most ×0.97.", "Compositor LoopDelayRing, rackLoop, persist")
node("p-bg", 311, 700, "Background", "its source", "pic", "The Background's own source, on a slow clock.", "Compositor.render (Background, bgFill)")
node("p-bgrack", 446, 700, "BG FX", "slow clock", "pic", "The Background's effects.", "Compositor.render (bgRack)")
node("p-stack", 901, 566, "Stack", "blend ×20 · opacity · mask · mute · solo · group: blend or isolate on the Background", "pic", "The four layers composited over the Background: each with its blend mode (20), opacity and mask. Mute and solo decide who is seen; group mode decides how the layers sit on the Background (blended or isolated).", "Compositor.render (blendInto, drawLayer, groupOver, DepthShadow)")
node("p-master", 1015, 570, "Master FX", "whole picture", "pic", "Effects on the whole composite.", "Compositor.render (masterRack.apply)")
node("p-final", 1145, 576, "Finalizers", "Vibe Palette → Context → Finalizer", "pic", "Three locked units always at the end of the master rack, in this order.", "isf/index.ts VIBE_SHADER, CONTEXT_SHADER, FINALIZER_SHADER · store.normalizeComposition")
node("p-film", 1252, 584, "Film", "hold · damage · output shape", "pic", "The Finalizer's cameraless film hold, film damage and output aperture.", "Compositor Cameraless, FilmDamage, OutputShape")
node("p-present", 1372, 596, "Presentation", "fade · freeze · Black · flash limit", "pic", "Scene crossfade, freeze, the Black fade and the flash-safety limiter on everything before it. The readbacks take the picture here.", "Compositor.render (crossfade, freeze, Black, StrobeLimiter, lastPresent)")
node("p-out", 1380, 762, "Transform · dome", "flat or dome", "pic", "The output transform (flat output) or the dome master, never both. NDI, Spout / Syphon, the projector stream and DXV recording take the picture here, before the keystone.", "Compositor OutXformStage, DomeStage · captureKick")
node("p-warp", 1380, 830, "Keystone", "the operator canvas", "pic", "The operator canvas, drawn with the keystone (or as a plain copy). HIVE, encoder recordings, MARK and the agent's snapshot read it.", "Compositor warpProg · App.tsx loop")
node("p-depth", 1050, 712, "Depth AI", "every 85 ms · late", "pic", "Depth Anything V2 estimates the depth of the presented picture in a worker. Every native node (Parallax, the master rack's too) reads it on later frames; the vision bus reads its mean and spread. While a seen layer plays a Model (or a Grid Mesh) with true depth on, the nodes read that real depth instead (drawn with it, the same frame) and the AI rests.", "engine/depthEstimate.ts · App.tsx loop depthEngine.update / take · nodeCtx.depth · Compositor.modelDepthTex")
node("p-pdepth", 640, 770, "Picture depth", "one layer's picture · every 85 ms · late", "pic", "A second copy of the depth model, for the pieces that need the depth of their OWN picture rather than of the presented one, which holds their result: the Point Cloud (the layer it lifts) and Depth Scan (the picture entering it). Running only while the depth menu is on AI and one of them asks; several take turns, and each map is smoothed into the next.", "engine/pictureDepth.ts PictureDepthReader · PointCloudSource · depthScanNode")
node("p-read", 1190, 690, "Readbacks", "vision 32² · Sonify 96² · lights · after presentation", "pic", "Small asynchronous reads of the presented picture (before transform and keystone), one or two frames late: for the vision bus, Sonify and the lights. Sonify and the lights can also tap single layers.", "Compositor visionSample, readSonifyGrids, kickLights, depthFrame")

// ── Outputs ────────────────────────────────────────────────
node("o-osc", 1560, 104, "OSC out", "destinations: feedback · MARK · /body · Space · Learn replies", "out", "Each destination picks what it gets: the live /opsia state read from the store and the vision and body features (only what changes), MARK, the Body rules' messages, Space's speaker positions for SpatGRIS / ADM. OSC Learn answers each controller at its reply port.", "oscInput.ts enumerateLeaves, pushFeedback · oscDests.ts · space.ts sendOsc")
node("o-oscq", 1560, 148, "OSCQuery", "HTTP tree · WS values", "out", "The /opsia address tree over HTTP and live values over WebSocket, answered on this computer only.", "main/oscquery.ts publishOscQuery, pushWsValues")
node("o-df", 1560, 192, "dataflou out", "audio · vision · body · mod · meta", "out", "Published sources other nodes can wire to, sent only while someone listens (every 33 ms); Macro knobs both ways as meta/i.", "dataflou.ts initDataflou")
node("o-reso", 1560, 236, "Resolume mapper", "features → OSC columns", "out", "Modulators, Macros, the audio, vision and body features and store values mapped onto Resolume parameters.", "resolume.ts resoSourceCatalogue, readSource")
node("o-midi", 1560, 280, "MIDI out", "clock · start / stop · thru", "out", "MIDI clock from the tempo, start / stop (also from Link), and MIDI thru.", "midi.ts applyOutputConfig, startClock, stopClock")
node("o-disk", 1560, 324, "Autosave · undo", "the session on disk", "out", "The session saved as you play, and the undo history.", "main/autosave.ts · undo.ts initUndo")
node("o-screen", 1560, 718, "Projector", "output window · keystone there", "out", "The output window gets the clean picture (after transform or dome) and draws the keystone itself.", "OutputPresenter.ts · window.api.outputFrame")
node("o-stream", 1560, 762, "NDI · Spout · Syphon", "before the keystone", "out", "The picture shared with other programs and computers, before the keystone.", "App.tsx loop captureHarvest(ndi, share)")
node("o-hive", 1560, 806, "HIVE out", "HEVC · the warped canvas", "out", "The operator canvas encoded to HEVC and served over TCP; late joiners wait for a keyframe, idle or stuck clients are dropped.", "hiveEncoder.ts encode · main/hiveSend.ts")
node("o-rec", 1560, 850, "Recording", "DXV clean · encoders warped", "out", "Takes to disk: DXV records the clean picture, the other encoders the canvas, with Sonify's record bus as sound.", "recorder.ts holdRecordBus · main/recording.ts")
node("o-sonify", 1560, 914, "Sonify → speakers", "voices · reverb · EQ · Space · SpatGRIS", "out", "The picture played as sound: twelve voices, most reading the readback grids; Filter takes a line-in, Collage and Assemblage play the films' sound, the Audio Layer enters the mix. Then the FX tail, the output EQ, stereo or a room of speakers.", "audio/sonify.ts · soni.worklet.js · audio/space.ts · sonifyModValues")
node("o-media", 1560, 958, "Film sound", "slots · Import Audio · monitor", "out", "Slot films' soundtracks, Import Audio slots and the input monitor play straight to the speakers, outside Sonify's mix, EQ and Space.", "mediaSink.ts · VideoSource trackMediaSink")
node("o-lights", 1560, 1002, "Lights", "Enttec · Art-Net · sACN · WLED", "out", "DMX lights placed on the picture take their colours from it, and can follow the audio, the beat, people in the Room and modulation. There is no DMX input.", "lights/lightRuntime.ts tick, lightMods, peopleNow")

// ── Links ──────────────────────────────────────────────────
edge("in-ui", "c-store", "net", "actions")
edge("in-osc", "c-store", "net", "/opsia → actions")
edge("in-midi", "c-store", "net", "CC")
edge("in-df", "c-store", "net", "as /opsia OSC")
edge("in-mcp", "c-store", "net", "tools")
edge("in-osc", "c-trig", "net", "OSC Learn")
edge("in-midi", "c-trig", "net", "notes")
edge("in-df", "c-trig", "net", "act/… paths")
edge("in-osc", "c-abus", "net", "/opsia/audio (OSC)")
edge("in-osc", "c-cbus", "net", "/opsia/mod/n")
edge("in-midi", "c-cbus", "net", "CC · note")
edge("in-df", "c-cbus", "net", "mesh values")
edge("in-osc", "c-tbus", "net", "/opsia/touch")
edge("in-ui", "c-tbus", "net", "preview clicks")
edge("in-ui", "c-macro", "net", "knob")
edge("in-osc", "c-macro", "net", "/opsia/macro")
edge("in-midi", "c-macro", "net", "CC")
edge("in-df", "c-macro", "net", "meta/i")
edge("in-link", "c-clock", "net", "tempo · beat")
edge("in-midi", "c-clock", "net", "clock · start / stop")
edge("c-store", "in-link", "net", "BPM edits · start/stop")
edge("in-audio", "c-abus", "snd", "local, if no OSC")
edge("in-body", "c-bbus", "net", "pose · hands · people")
edge("in-body", "p-srcA", "net", "silhouette mask")
edge("in-body", "p-lrack", "net", "people → Drape", false, null, 0.5, "rt")
edge("in-video", "p-srcA", "net", "live sources", true)
edge("in-video", "p-srcB", "net")
edge("in-files", "p-srcA", "net", "films")
edge("in-files", "p-bg", "net")
edge("in-files", "c-alayer", "snd", "audio files", false, "up")
edge("in-files", "c-mods", "snd", "slot soundtrack → audio mods", false, "up")
edge("c-trig", "c-store", "ctl", "fires")
edge("c-rules", "c-trig", "ctl", "actions")
edge("c-bbus", "c-rules", "ctl", "gestures")
edge("c-store", "c-scene", "ctl", "composition")
edge("c-scene", "c-sync", "ctl", "this frame")
edge("c-abus", "c-mods", "ctl")
edge("c-vbus", "c-mods", "ctl")
edge("c-bbus", "c-mods", "ctl")
edge("c-cbus", "c-mods", "ctl")
edge("c-clock", "c-mods", "ctl", "sync")
edge("c-alayer", "c-abus", "snd", "or the Audio Layer")
edge("c-alayer", "c-mods", "snd", "audio mods listen")
edge("c-mods", "c-matrix", "ctl", "bindings")
edge("c-matrix", "c-macro", "ctl", "moves knobs")
edge("c-matrix", "c-frame", "ctl", "overlay", true)
edge("c-matrix", "c-store", "ctl", "Vary fires")
edge("c-matrix", "c-alayer", "ctl", "Audio Layer targets")
edge("c-macro", "c-frame", "ctl", "destinations")
edge("c-macro", "c-store", "ctl", "settles")
edge("c-abus", "c-coup", "snd")
edge("c-abus", "c-feel", "snd", "proximity · tonicity")
edge("c-coup", "c-frame", "ctl", "A/B mix")
edge("c-feel", "c-frame", "ctl")
edge("c-world", "c-store", "ctl", "applies")
edge("c-world", "c-frame", "ctl", "amount: Context · film")
edge("c-abus", "c-seq", "snd", "onsets", false, "over")
edge("c-mods", "c-seq", "ctl", "chaos advance")
edge("c-seq", "c-store", "ctl", "recalls scene")
edge("c-seq", "c-frame", "ctl", "breathes")
edge("c-clock", "c-seqp", "ctl", "bars", false, "over")
edge("c-vbus", "c-seqp", "ctl", "key from picture")
edge("c-seqp", "c-store", "ctl", "steps · key")
edge("c-seqp", "c-rules", "ctl", "rules on / off", false, "over")
edge("c-time", "c-frame", "ctl")
edge("c-sync", "p-srcA", "ctl", "base values, every stage", true, null, 0.74)
edge("c-frame", "p-stack", "ctl", "every frame, before render", true, null, 0.86)
edge("c-abus", "p-srcA", "snd", "audio texture", false, null, 0.5, "lt")
edge("c-vbus", "p-srcA", "ctl", "Assemble live cut", false, null, 0.5, "lt")
edge("c-tbus", "p-lrack", "ctl", "Touch · Ripple")
edge("c-clock", "p-loop", "ctl", "delay in beats", false, null, 0.5, "rt")
edge("p-srcA", "p-rackA", "pic")
edge("p-srcB", "p-rackB", "pic")
edge("p-rackA", "p-mix", "pic")
edge("p-rackB", "p-mix", "pic")
edge("p-mix", "p-lrack", "pic")
edge("p-lrack", "p-loop", "pic")
edge("p-loop", "p-stack", "pic")
edge("p-bg", "p-bgrack", "pic")
edge("p-bgrack", "p-stack", "pic", "", false, null, 0.5, "rb")
edge("p-stack", "p-master", "pic")
edge("p-master", "p-final", "pic")
edge("p-final", "p-film", "pic")
edge("p-film", "p-present", "pic")
edge("p-present", "p-out", "pic")
edge("p-out", "p-warp", "pic")
edge("p-out", "o-screen", "pic", "clean", true)
edge("p-out", "o-stream", "pic")
edge("p-out", "o-rec", "pic", "DXV")
edge("p-warp", "o-hive", "pic", "canvas", true)
edge("p-warp", "o-rec", "pic", "encoders")
edge("p-warp", "o-osc", "net", "MARK strip", false, "mark")
edge("p-present", "p-depth", "pic", "", false, null, 0.5, "bt")
edge("p-present", "p-read", "pic", "", false, null, 0.5, "bt")
edge("p-read", "o-sonify", "snd", "grids → voices", true, "river")
edge("p-read", "o-lights", "pic", "colours", false, "river")
edge("c-store", "o-osc", "net", "feedback: what changed")
edge("c-vbus", "o-osc", "net", "features")
edge("c-bbus", "o-osc", "net")
edge("c-rules", "o-osc", "net", "/body/<rule>")
edge("c-store", "o-oscq", "net", "tree · values")
edge("c-abus", "o-df", "net")
edge("c-vbus", "o-df", "net")
edge("c-bbus", "o-df", "net")
edge("c-mods", "o-df", "net")
edge("c-macro", "o-df", "net")
edge("c-abus", "o-reso", "net")
edge("c-vbus", "o-reso", "net")
edge("c-bbus", "o-reso", "net")
edge("c-mods", "o-reso", "net")
edge("c-macro", "o-reso", "net")
edge("c-store", "o-reso", "net")
edge("c-clock", "o-midi", "net", "clock")
edge("in-midi", "o-midi", "net", "thru")
edge("c-store", "o-disk", "net", "autosave")
edge("c-matrix", "o-sonify", "ctl", "Sonify · Space targets")
edge("c-matrix", "o-lights", "ctl", "light targets")
edge("c-abus", "o-lights", "snd")
edge("c-clock", "o-lights", "ctl", "beats")
edge("c-bbus", "o-lights", "ctl", "people")
edge("c-alayer", "o-sonify", "snd", "into the mix")
edge("in-audio", "o-sonify", "snd", "Filter line-in", false, "river")
edge("in-files", "o-sonify", "snd", "Collage · Assemblage sound", false, "river")
edge("in-files", "o-media", "snd", "film soundtracks", false, "river")
edge("in-audio", "o-media", "snd", "monitor", false, "river")
edge("c-time", "o-sonify", "ctl", "Black")
edge("c-time", "o-media", "ctl")
edge("o-sonify", "o-osc", "net", "Space positions", false, "out-right")
edge("o-sonify", "o-rec", "snd", "record bus")
edge("p-read", "c-vbus", "loop", "the picture, read back ~30 Hz", true, "read-vision")
edge("p-depth", "c-vbus", "loop", "depth mean · spread", false, "depth-vision")
edge("p-depth", "p-lrack", "loop", "depth → nodes, later frames", true, "depth-nodes")
edge("p-mix", "p-pdepth", "pic", "a layer's picture", false, null, 0.5, "bt")
edge("p-pdepth", "p-srcB", "loop", "Point Cloud's relief", false, "picture-depth")
edge("p-pdepth", "p-lrack", "loop", "Depth Scan")
edge("p-loop", "p-loop", "loop", "returns", true, "self-loop")
edge("p-loop", "p-srcB", "loop", "layers read each other", true, "sidechain")
edge("o-osc", "in-osc", "phys", "a controller that echoes what it receives", true, "osc-echo")
edge("o-df", "in-df", "phys", "another node wired back to us", false, "df-echo")
edge("p-warp", "in-mcp", "net", "snapshot of the canvas", false, "mcp-snap")
edge("o-sonify", "in-audio", "phys", "only through a microphone or loopback", true, "sound-back")
edge("o-screen", "in-body", "phys", "the body camera sees the projection", true, "camera-back")

// Secondary links : faint until a block is picked. Every link into dataflou out and the
// Resolume mapper is secondary too.
export const MINOR = new Set([
  "p-mix>p-pdepth",
  "p-pdepth>p-srcB",
  "p-pdepth>p-lrack",
  "c-abus>o-lights",
  "c-abus>p-srcA",
  "c-alayer>c-mods",
  "c-bbus>o-lights",
  "c-bbus>o-osc",
  "c-clock>o-lights",
  "c-clock>p-loop",
  "c-macro>c-store",
  "c-matrix>c-alayer",
  "c-matrix>c-store",
  "c-matrix>o-lights",
  "c-matrix>o-sonify",
  "c-mods>c-seq",
  "c-seq>c-store",
  "c-seqp>c-store",
  "c-store>in-link",
  "c-store>o-disk",
  "c-store>o-oscq",
  "c-tbus>p-lrack",
  "c-time>o-media",
  "c-time>o-sonify",
  "c-vbus>c-seqp",
  "c-vbus>o-osc",
  "c-vbus>p-srcA",
  "c-world>c-store",
  "in-audio>o-media",
  "in-audio>o-sonify",
  "in-body>p-lrack",
  "in-df>c-macro",
  "in-files>c-mods",
  "in-files>o-sonify",
  "in-midi>c-macro",
  "in-midi>o-midi",
  "in-osc>c-macro",
  "in-osc>c-tbus",
  "in-ui>c-macro",
  "in-ui>c-tbus",
  "o-sonify>o-osc",
  "p-warp>o-osc"
])
for (const e of E) e.minor = MINOR.has(e.a + '>' + e.b) || e.b === 'o-df' || e.b === 'o-reso'

// Drawn small : the trigger catalog (a vocabulary, not a stage) and the readbacks (a
// tap on the presented picture). Blocks whose every link is secondary are small too.
export const BOOKKEEPING = new Set(["c-trig", "p-read"])

// ── The page's text ───────────────────────────────────────
export const TEXT = {
  "lede": "The picture flows left to right along the thick line, from its sources to the screen; the control plane above moves it every frame, and the dashed and dotted loops bring it back in. Hover, tap or tab to any block to follow its links.",
  "intro": "Where every signal enters, what it changes, and where it leaves: the control plane that runs on the CPU before each frame, the picture's path on the GPU, the sound's own paths, and the loops where the picture, the sound, the body and the network come back to change themselves. Hover or tap a block to follow its connections and see the code it comes from.",
  "caption": "Inputs on the left reach the store through the same actions as the interface, or the buses, the Macro knobs and the modulators directly. Every frame, the control plane chooses the composition, syncs it into the engine, then overlays modulation, Macros, Coupling, Feel, the World amount and Time on it. That overlay writes back into the session only on purpose: a Macro settling, a Vary fired by a modulator, a scene recalled by the sequencer, the Seq page's steps and key. The GPU then draws the four layers and the Background, the master rack and its finalizers, presentation, transform or dome, and the keystoned canvas. The presented picture is read back into the vision bus, depth, Sonify and the lights, a frame or two late: the dashed loops.",
  "frame_lede": "The order of App.tsx's frame loop. Everything that moves is computed before the picture is drawn, on the same frame. What is read back from the picture (vision, depth, Sonify's grids, the lights) arrives a frame or two later, which is what keeps the loops stable.",
  "phases": [
    {
      "flow": "ctl",
      "title": "1 · Choose and sync",
      "items": [
        "Skip the frame if the GPU is behind",
        "A scene change, the Metasurface's blend (its drawn path), or a scene being morphed into; Link pins the BPM",
        "Speed, warp, dome, output transform, flash limit, slot swaps, shader reloads",
        "<b>Sync</b>: the composition into every stage <code>syncFromState</code>",
        "Assemble's live matchers <code>syncLiveMatchers</code>"
      ]
    },
    {
      "flow": "ctl",
      "title": "2 · Move",
      "items": [
        "The audio bus ticks; Link; the 8 modulators run; the matrix overlays them",
        "Macro glides; Vary edges fired by modulators",
        "Context light path; film seeks",
        "<b>Coupling</b> sets each layer's A/B mix from the sound",
        "Proximity, then the <b>scene sequencer</b>, then the Seq page on the bar clock (Sonify steps, key, rules)",
        "Field macros, then the <b>World amount</b>, then tonicity, drift, flow ↔ interruption",
        "Freeze, flicker, frame-weave, relay envelopes, <b>Black</b> (it fades the films' sound too)"
      ]
    },
    {
      "flow": "pic",
      "title": "3 · Draw",
      "items": [
        "Each layer: source A → its rack, B → its rack, the A/B mix, the layer rack, the Loop (delay, Loop rack, ×0.97 max)",
        "The Background and its rack",
        "The stack over the Background: blend, opacity, mask, mute / solo, group",
        "Master rack, then Vibe Palette, Context, Finalizer; film hold, damage, output shape",
        "Presentation: scene fade, freeze, Black, flash limit",
        "Output transform <i>or</i> dome, then the keystoned operator canvas"
      ]
    },
    {
      "flow": "net",
      "title": "4 · Send, then read back",
      "items": [
        "Projector stream, NDI, Spout / Syphon, dome preview, recording <small>(clean, before the keystone)</small>",
        "MARK strip <small>(from the canvas)</small>",
        "Vision readback ~30 Hz, then Depth AI every 85 ms <small>(read on later frames)</small>",
        "The lights; the output window's keystone; HIVE <small>(the canvas)</small>",
        "Sonify, the Audio Layer, Space <small>(Sonify's grids, 1–2 frames late)</small>",
        "Between frames: OSC feedback, OSCQuery, dataflou sources, Resolume, MIDI clock"
      ]
    }
  ],
  "loops": [
    {
      "name": "The picture watches itself",
      "path": "presented picture → vision readback (~30 Hz) → vision bus → vision / homeostat modulators → mod matrix → the next frames' parameters",
      "st": "inside"
    },
    {
      "name": "Depth",
      "path": "presented picture → Depth AI (every 85 ms) → depth map → Parallax and every native node, and the vision bus (a Model's or a Grid Mesh's true depth, when one gives it, goes straight to the nodes instead : no loop)",
      "st": "inside"
    },
    {
      "name": "The depth of one picture",
      "path": "a layer's picture → Picture depth (a second model, every 85 ms) → the Point Cloud that lifts it, the Depth Scan it enters",
      "st": "inside"
    },
    {
      "name": "A layer's own trail",
      "path": "layer → delay ring (frames or beats) → Loop rack (effects compound each pass) → blended with the new frame, at most ×0.97",
      "st": "inside"
    },
    {
      "name": "Layers reading each other",
      "path": "Loop source, Text fill, native sources and FX nodes read another layer: a layer below this frame, the same layer or one above from the last frame",
      "st": "inside"
    },
    {
      "name": "Assemble follows the picture",
      "path": "vision features (64² while live) → Assemble's matchers → the next cut of the film it plays",
      "st": "inside"
    },
    {
      "name": "The picture chooses the key",
      "path": "vision bus → the Seq page's key sequencer (picture mode) → the store's root and scale → Sonify",
      "st": "inside"
    },
    {
      "name": "Modulation into the session",
      "path": "a modulator → Macro knob → glide → settles into the store; a modulator on a layer's Vary → a new layer; a chaos modulator → the scene sequencer → a scene recalled",
      "st": "inside"
    },
    {
      "name": "World and Coupling",
      "path": "a World writes each layer's coupling, the Context, film inputs and an audio modulator into the store → Coupling moves the A/B mix from the sound every frame; the World amount (a modulation target) blends only the Context and film keys",
      "st": "inside"
    },
    {
      "name": "Controllers echoing",
      "path": "OSC feedback (the store's /opsia values, only what changed) → a controller that sends it back → OSC in. Only an epsilon guard; OSC Learn replies hold 300 ms",
      "st": "room"
    },
    {
      "name": "dataflou both ways",
      "path": "our sources out → another node → a wire back into a published destination (or our own source wired to our own destination); Macros travel both ways as meta/i",
      "st": "network"
    },
    {
      "name": "The agent looks, then acts",
      "path": "the canvas → the agent's snapshot → its tools → store actions → the next frames",
      "st": "agent"
    },
    {
      "name": "The sound heard again",
      "path": "picture → Sonify → speakers → a microphone or loopback → audio in → audio modulators, Coupling, Proximity",
      "st": "room"
    },
    {
      "name": "The body sees the projection",
      "path": "projector → the body camera → body bus → body modulators, Body rules → triggers; and the Silhouette source",
      "st": "room"
    },
    {
      "name": "Sonify into the audio bus",
      "path": "Sonify's output is not wired back to the audio bus; the Audio Layer feeds both in parallel",
      "st": "not wired"
    }
  ]
}
