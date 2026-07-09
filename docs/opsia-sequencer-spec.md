# Opsia — Generative Scene / Relation Sequencer (macro-form engine)

**Status:** spec / not built. The one structural subsystem the research shelf points at
hardest and Opsia doesn't have yet: a **relation-state timeline that evolves over time**.

## Why this one

It is the shared dependency of ~8 untouched shelf ideas — building it unlocks all of them:

| Shelf item | What the sequencer gives it |
|---|---|
| Basanta #9 — generative scene sequencer | the whole thing |
| Basanta #2 — isomorphy = tonic / cadence | "resolve-to-sync" punctuation on a transition |
| Boucher/Piché — Anchoring · Delayed · Expected (deferred synchresis) | audio-armed / deferred scene advance |
| Boucher/Piché — Monomedia drop | a transition punctuation (drop one medium) |
| Knight-Hill C#6 — Repose–Disturbance–Repose arc | the Climate-arc overlay |
| Knight-Hill C#9 — Catastrophe rupture | the Rupture punctuation |
| Boucher D#2 — Parcours dynamique | the umbrella model (this IS it) |
| Boucher D#3 — Compression/decompression "Breathe" | the Espace-temps overlay |
| Boucher D#4 — Scene-tag schema (Diégèse·Synchrèse·Espace-temps·Climat) | the DATA MODEL below |

## Design stance

- **Not a node graph, not a DAW timeline.** A *fixed, curated* auto-pilot over the existing
  **scene bank**, driven by each scene's **relation tags** — a "coherent flux in continual
  movement" (Boucher's *parcours dynamique*), not a hand-drawn automation lane.
- **Reuse, don't rebuild.** Transitions = `morph.ts` (already does structural-snap + numeric-
  ease + framebuffer crossfade). Diégèse = the existing **Worlds**. Couplings = `coupling.ts`.
  No-exact-repeat = `varyComposition`. Advance triggers = the **audio bus**. Clock = BPM /
  `globalSpeed`. The sequencer only *orchestrates* these.
- **One write path.** The sequencer calls `recallScene(id)` (goes through morph + undo + the
  single store write path); its continuous overlays (Breathe / Arc / cadence) write straight
  to the Compositor **post-modulation**, exactly like `applyProximity` / `applyCoupling` — zero
  React churn at 60 Hz.
- **Guardrails:** dwell long enough to *read* before it varies (Garro's establish-then-
  articulate); transitions curated (never strobe); Rupture must *resolve*; overlays stay in
  Finishing-safe bands; the param set is fixed + curated (no open matrix).

---

## 1. Data model

### 1a. Scene tags — the Boucher/Piché × Boucher schema (D#4)

Extends `SceneEntry` (optional, auto-derived on first tag, editable):

```ts
export interface SceneTags {
  world: WorldMode                 // Diégèse — one of the 6 built worlds
  synchresis: CouplingMode[]       // Synchrèse — the coupling character(s) this scene reads as
  spaceTime: number                // Espace-temps — 0 compressed/dense/full · 0.5 neutral · 1 decompressed/void
  climate: SceneClimate            // Climat — the affective charge
}
export type SceneClimate = 'tension' | 'expectation' | 'release' | 'resolution'

// SceneEntry gains:  tags?: SceneTags
```

**Auto-derive** defaults when a scene is first tagged: `world` = the scene's saved World,
`synchresis` = its layers' coupling modes (deduped), `spaceTime` from mean layer-opacity +
Context haze/depth, `climate` = 'release' (neutral). All editable in the UI.

### 1b. Sequencer state — a session-level sibling (NOT inside `composition`)

Lives beside `scenes` in the store (session-scoped, saved with the session; must not sit
inside a `CompositionState` a scene contains — that would recurse):

```ts
export interface SequenceState {
  enabled: boolean
  running: boolean

  // Pacing
  clock: 'bars' | 'seconds'
  dwell: number                    // hold per scene (bars or s)
  dwellJitter: number              // 0..1 humanise (± on dwell)

  // Transition
  transition: 'morph' | 'cut' | 'auto'   // auto = pick per the destination's Synchrèse
  crossfadeMs: number              // reuses global morph

  // Selection
  mode: 'weighted' | 'arc' | 'shuffle'
  noRepeat: number                 // avoid the last N scenes
  variation: number                // 0..1 → varyComposition intensity per recall (no exact repeat)

  // Macro-form overlays (continuous)
  breathe: { amount: number; periodBars: number }   // Espace-temps oscillator (D#3)
  arc: { enabled: boolean; lengthBars: number }      // Repose–Disturbance–Repose (C#6)

  // Punctuation (per-transition probabilities / cadences)
  cadenceEvery: number             // resolve-to-isomorphy every N steps (0 = off)  (A#2)
  ruptureChance: number            // 0..1 controlled-chaos burst then resolve       (C#9)
  monomediaChance: number          // 0..1 drop one medium as a tension marker       (Boucher)

  // Audio arming (deferred synchresis: Anchoring / Delayed / Expected)
  audioAdvance: 'off' | 'transient' | 'onset'
}
```

---

## 2. Selection — weights from tags, not a hand-authored matrix

A full N×N Markov matrix is off the "curated fixed topology" spirit and unmaintainable. Instead
derive a transition weight per candidate scene from its tags + the current arc phase:

```
weight(dest) =
    base
  × worldBias        // same World as current → ×1  ·  world change → ×worldChangeCost (rarer, bigger punctuation)
  × arcBias(dest)    // if arc on: mid-arc favours climate=tension/expectation; ends favour release/resolution
  × spaceTimeBias    // prefer a modest step in Espace-temps, not a jarring dense→void jump
  × noRepeatMask     // 0 for the last `noRepeat` scenes, else 1
```

- `mode: 'shuffle'` → all biases off except noRepeat (plain no-repeat random).
- `mode: 'weighted'` → world + spaceTime biases (a smooth wander).
- `mode: 'arc'` → adds the Climate-arc bias (the parcours has a shape).

Optional later: a per-scene manual `weightBias` the user nudges. Not in v1.

---

## 3. The four playable axes / overlays

### 3a. Breathe — Espace-temps (D#3)
A slow oscillator (period `breathe.periodBars`) centred on the *current scene's* `spaceTime`
tag, co-articulating a **curated** set toward dense↔void:
`{ layer opacities feel, Context haze + depth + vignette, Vibe brightness, global event-density }`.
Applied each frame post-modulation (a writer like `applyProximity`). `amount` scales the swing.
This is also the natural home for **Density (Basanta #6)** — same macro, different label.

### 3b. Climate arc — Repose–Disturbance–Repose (C#6)
One scalar `arcPhase` 0→1→0 over `arc.lengthBars`. Biases: scene selection (§2), Rupture
probability (peaks mid-arc), coupling dissonance, Context intensity. Turns a flat shuffle into a
*shaped* set with a build and a comedown. Off by default (manual sets).

### 3c. Cadence / Anchoring — resolve to isomorphy (A#2, B-Anchoring)
Every `cadenceEvery` transitions, fire a **cadence pulse**: momentarily force all layer couplings
toward isomorphy (amount→1, high tightness, A/B mix pulled to lock) that decays over ~1 bar — a
felt *arrival* after drift. Implemented in `coupling.ts` as a transient override (like the cut
release), not a stored state.

### 3d. Punctuation — Rupture (C#9) & Monomedia drop (B)
- **Rupture** — a controlled-chaos burst (a chaos modulator slammed onto displacement / byte-
  corrupt / feedback for a beat) that then **resolves** by morphing into the next scene.
  "Break-through, not breakdown." Transport-triggerable *and* auto-fireable (`ruptureChance`,
  arc-weighted), audio-armable. Sibling to the Monomedia drop.
- **Monomedia drop** — briefly drop one "medium" on a transition: master fades to near-black (or
  freezes the last frame) for a beat while audio continues, then the new scene cuts/morphs in.
  A tension marker built from the *expectation* of both media. Respects the matte/near-black
  aesthetic by construction.

---

## 4. Engine & runtime

`engine/sequencer.ts` — ticked in the App render loop after `applyProximity` (peer of
coupling/proximity). Holds runtime state the store never sees:

```
tick(now, seq, scenes, bpm):
  if !seq.running: return
  advanceClock(now, bpm)                 // bars from BPM×globalSpeed, or seconds
  if dwellElapsed:
    const next = pickNext(scenes, seq, arcPhase)     // §2
    maybe punctuation (rupture / monomedia / cadence)  // §3c/3d
    store.recallScene(next.id)            // morph + single write path
    if seq.variation>0: store.applyVariationTo(next, seq.variation)   // no exact repeat
  writeBreathe(comp, seq, currentSpaceTime, breathePhase)   // §3a, post-mod overlay
  writeArc(comp, seq, arcPhase)                              // §3b
```

Transitions choose morph vs cut: `transition:'cut'` → `crossfadeMs≈0`; `'morph'` → the set
`crossfadeMs`; `'auto'` → cut when the destination's Synchrèse is `cut`/`hocket`, morph
otherwise. `resetCouplingState()` already runs inside `recallScene`.

Audio-armed advance: when `audioAdvance≠'off'`, the dwell timer becomes a *minimum* and the actual
step fires on the next transient/onset from the audio bus after it — giving Anchoring / Delayed /
Expected their felt "falling-together."

---

## 5. UI — a "Sequence" page (peer of World / Output; key `S`)

- **Scene rail** — the scene bank shown as tagged cards: a World chip, a Climat colour dot, an
  Espace-temps mini-bar, the Synchrèse mode(s). Click a card → tag editor (4 fields, auto-filled).
- **Transport** — play/stop, clock (bars/s) + dwell + jitter, transition (morph/cut/auto),
  selection mode (weighted/arc/shuffle), no-repeat, variation.
- **Macro-form** — Breathe (amount + period), Climate-arc (enable + length) with a live arc-phase
  meter; the punctuation trio (cadence-every, rupture-chance, monomedia-chance).
- **Now / Next** — current scene, the weighted next candidates, a countdown to the next step,
  and an arc-phase readout. A manual "skip →" and "rupture now" for live play.

All OSC-addressable (`/opsia/seq/{run|dwell|advance|rupture|…}`) so Pandore can drive the macro-form.

---

## 6. Phased build

| Phase | Scope | Shelf items unlocked |
|---|---|---|
| **S1 · Skeleton** | tags + tag editor · weighted/shuffle selection · morph/cut · dwell clock · auto-variation · Sequence page | Basanta #9 · Boucher #2, #4 · no-exact-repeat (Basanta #8 in spirit) |
| **S2 · Macro-form** | Breathe (Espace-temps) · Climate arc + arc-guided selection | Boucher D#3 · Knight-Hill C#6 · Basanta #6 (Density) |
| **S3 · Punctuation** ✅ | Cadence/Anchoring · Rupture · Monomedia drop (black + freeze) | Basanta #2 · Boucher/Piché Anchoring + Monomedia · Knight-Hill C#9 |
| **S4 · Deferred + score** ⬜ | audio-armed advance · export/notate the run as an ordered AVU relation-score (Boucher/Piché "future work") | deferred synchresis (Anchoring/Delayed/Expected) · representational score |

**S1 + S2 + S3 built.** Only S4 (audio-armed deferred advance + AVU relation-score export)
remains. `engine/sequencer.ts` holds all runtime timers; punctuation overlays write
post-sync each frame so they self-release; `Compositor.setFreeze` backs the freeze drop.

---

## 7. Decisions (locked 2026-07)

1. **Clock = seconds** (default). `dwell`, `breathe.periodSec`, `arc.lengthSec` all in seconds.
   Bars/BPM-lock is an optional later toggle.
2. **Auto-variation subtle by default** — `variation` defaults to **~0.15**; every recall gets a
   light `varyComposition` jitter so long sets never loop verbatim (Basanta no-exact-repeat).
3. **Tags** auto-derived on first tag + editable.
4. **Monomedia = offer BOTH** styles: near-black fade *and* freeze-frame hold (a `monomediaStyle`
   option). (S3.)
5. **Sequencer travels in the session file**; auto-start on load if it was running.

**Build order chosen: S1 + S2 together** — skeleton auto-pilot + Breathe + Climate-arc in one push.
S3 (punctuation: cadence / rupture / monomedia-both) and S4 (deferred + score) follow.
