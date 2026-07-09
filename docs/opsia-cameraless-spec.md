# Opsia — Cameraless / *Direct Film* Spec

> **`docs/opsia-cameraless-spec.md`** · v0.1 (draft — design intent)
> Date: 2026-07-08 · Author: Vincent Fillion · Co-designed with Claude Opus 4.8
>
> **Status (2026-07-09): substrate BUILT** — the native Cameraless stage (§2–3)
> ships as `engine/cameraless.ts`, params on the Finalizer (`film*`, applied
> natively like `out*`): draw clock + hold (both **film-hold** and **freeze**
> modes) + boil + flutter + blank (§3.1–3.2) and the full **émulsion** family —
> dust · scratch · granulation · splice (§3.3). The three **World presets** (§6,
> Griffé/Peint/Pressé) carry the film character via a new optional `World.finalizer`.
> The **Shutter** (Transport) is reconciled as the distinct *global full-freeze*
> stop-motion. The **Direct Marks** (§4.1, `direct-marks`) and **Dye Field** (§5.1,
> `dye-field`, subtractive + internal crystallise feedback) sources are now BUILT
> too (a mockup comparison confirmed Op-Art can't do the dot/scratch marks and
> Congeal is additive where Dye needs subtractive). Still open: superimposition
> flicker (§5.2); `drawSync` BPM division (§3.1); the animated-sound loop (§4.4, with S4).
> Companion to `opsia-convolution-spec.md` (T = M·K). This spec covers the
> **cameraless / direct-on-film** family: making the continuous procedural engine
> read as hand-made, frame-by-frame film after Brakhage, McLaren, and Len Lye.

---

## 1. Concept — the actual problem

Two lineages, near-opposite in surface, identical in the underlying challenge.

- **McLaren** (*Begone Dull Care*, *Blinkity Blank*, *Lines*, *Dots*) — graphic,
  rhythmic, tightly music-synced. Ruled lines, dots, clean-edged washes,
  scratch-into-black staccato. And crucially: he **drew the optical soundtrack** —
  tone synthesized directly from painted marks (*animated / graphical sound*).
- **Brakhage** (*Dante Quartet*, *Black Ice*, *Chartres*, *Mothlight*, *The Garden
  of Earthly Delights*) — dense, gestural, silent by conviction. Dye and ink as
  *substance*, pressed organic material, hypnagogic flicker.

**The engine resists both for the same reason.** Palinopsia is continuous, smooth,
60 fps, procedural. These artifacts are discrete, hand-made, frame-by-frame, and
*material*. The homage is not "abstract colour" — it is manufacturing the four
qualities the engine actively smooths away:

1. **Discreteness** — a drawn frame rate, held, not interpolated.
2. **Registration jitter** — gate weave + hand-registration error (*the boil*).
3. **Flicker** — density flutter, blank frames, superimposition strobe.
4. **Materiality** — dust, hair, scratch, splice, dye granulation, leader flash.

Nail these and a mediocre field reads as film; skip them and the best field reads
as a screensaver. This is also the guardrail insurance: **materiality + restraint
is exactly what separates Brakhage from cheap psychedelia** (brief §1).

---

## 2. Architecture — one native *Cameraless* stage + two modes

Build the **shared substrate once**, as a curated native stage beside
Grain/Vibe/Context — *not* scattered across shaders. Two aesthetic **modes**
(Griffé / Peint) then reuse it via World presets + a couple of curated sources.

### 2.1 Pipeline placement

Current composite order (from SKILL.md):

```
Background slab → 4 layers blend → master rack (Vibe → Context → Finalizer)
   → Finalizer output-shape stage → xfade → present
```

Insert the Cameraless stage **after the Finalizer output-shape stage, before
xfade/present** — it is the last thing, "now this is a strip of film":

```
   … → Finalizer output-shape stage → [ CAMERALESS ] → xfade → present
```

### 2.2 Why native (not an ISF FX), and how it stays feedback-safe

The draw-rate hold needs **frame-hold state** and a fixed pipeline position, so it's
a native node in the `convNodes.ts` / `outputShape.ts` mould: **header-only ISF for
the auto-UI**, TS class doing the GL, params flowing through the same
`inputsForShader` path so Inspector / M / modulation / curated all work for free.
Modulated writes to any `cf*` field are **mirrored onto the native fields in
`setFxInput`** (same fix pattern as `outShape`→`fz*`).

**Critical invariant — the hold is output resampling only.** It reads the *live*
graded composite and refreshes its displayed copy **only on a draw tick**. It never
freezes layer or Context feedback buffers — those keep integrating continuously
underneath (correct: hand-drawn trails *should* appear stepped because you're
sampling a live continuous process at low rate). This honours the hot-swap /
feedback-preservation principle: nothing internal is reset to black. Distinct from
`Compositor.setFreeze` (holds *everything*, for Monomedia) and Global Speed (scales
integrated `dt` continuously). The draw clock is genuinely new.

### 2.3 FBO layout

```
  liveGraded  ── (per tick, if tick) ─▶  heldFrame (PERSISTENT FBO)
                                              │
  each render frame:                          ▼
     draw heldFrame  ─▶  [boil affine + flutter + blank]  ─▶  camA
     camA            ─▶  [émulsion pass: dust · scratch · granulation]  ─▶  out
```

- `heldFrame` — one PERSISTENT FBO. Written from `liveGraded` **only on a tick**.
- The boil/flutter/blank are a single cheap present pass (affine sample of
  `heldFrame`). All jitter uniforms are re-rolled **per tick**, held between ticks.
- Émulsion is a second pass so dust/scratch reseed on their **own** cadences
  (dust = per tick; scratch = every N ticks; see §3.5).

### 2.4 Null state (guardrail: "0 is passthrough")

At `drawRate ≥ renderFps` the hold updates every frame ⇒ smooth ⇒ effectively off.
With `boil=flutter=blankChance=emulsion=0` the stage is a clean passthrough, exactly
like every Context param at 0. The whole family has a genuine null.

---

## 3. The shared substrate — params + GLSL

Fixed, curated param set (Context/Vibe topology, never an open pile of knobs).

| Param | Type | Range | Curated | Notes |
|---|---|---|---|---|
| `drawRate` | float | 1–60 fps | **2–12** | the linchpin. Also accepts a `drawSync` long: *free* / BPM division (¼,⅛,…) for musically-metered ticks (very McLaren). |
| `drawJitter` | float | 0–1 | 0–0.4 | irregularity of the tick interval (±%). Hand timing is never metronomic. |
| `boil` | float | 0–1 | 0–0.5 | registration jitter amount (XY + micro-rot/scale), re-rolled per tick. |
| `flutter` | float | 0–1 | 0–0.35 | per-tick density/luminance pump. |
| `blankChance`| float | 0–1 | 0–0.25 | probability a tick shows leader instead of the frame. |
| `blankMode` | long | black / white / both | — | Blinkity gap (black) vs clear-leader flash (white). |
| `emulsion` | float | 0–1 | 0–0.6 | master amount for the direct-film artifact family (§3.5). |
| `dust` | float | 0–1 | 0–0.5 | dirt/hair specks (fast reseed = the "sparkle" of dirt on old prints). |
| `scratch` | float | 0–1 | 0–0.4 | tramline scratches (slow reseed = they persist). |
| `granule` | float | 0–1 | 0–0.5 | dye granulation / pooling (coarse coloured value noise). |
| `spliceChance`| float | 0–1 | 0–0.12 | rare whole-frame flash + horizontal bar. |

### 3.1 The draw clock (TS, in the native stage)

```ts
// Called each render frame with real dt. Returns true on a DRAW TICK.
private tickAcc = 0;
private nextInterval = 0;   // seconds, re-jittered each tick
private tick(dt: number, p: CameralessParams): boolean {
  const base = (p.drawSync === Sync.Free)
    ? 1 / clamp(p.drawRate, 1, 60)
    : this.bpmDivSeconds(p.drawSync);          // reuse the modulator clock idiom
  if (this.nextInterval === 0) this.nextInterval = base;
  this.tickAcc += dt;
  if (this.tickAcc < this.nextInterval) return false;
  this.tickAcc -= this.nextInterval;
  const j = p.drawJitter * 0.5;                // ± up to 50% of the interval
  this.nextInterval = base * (1 + (hash1(this.seed++) * 2 - 1) * j);
  return true;
}
// On a tick: blit liveGraded → heldFrame; re-roll boil/flutter/blank/émulsion seeds.
```

### 3.2 Boil + flutter + blank — present pass (GLSL)

Uniforms are set by the TS stage **on the tick** and held between ticks, so the
jitter is per-drawn-frame, not per-render-frame (this is the whole point — tie it to
the hold or it's just continuous shake).

```glsl
/*{
  "ISFVSN":"2","DESCRIPTION":"Cameraless present — boil/flutter/blank (native-fed)",
  "CATEGORIES":["Utility"],
  "INPUTS":[{"NAME":"inputImage","TYPE":"image"}]
}*/
// uniforms fed natively (not ISF INPUTS — set per tick by the stage):
uniform vec2  uBoil;       // registration offset, normalized
uniform float uBoilRot;    // micro-rotation, radians
uniform float uBoilScale;  // ~0.998..1.002 breathing
uniform float uFlutter;    // density multiplier, ~0.85..1.15
uniform float uBlank;      // 0 show, 1 leader this tick
uniform vec3  uBlankCol;   // black or white

void main() {
    vec2 uv = isf_FragNormCoord;                 // 0..1
    vec2 c  = uv - 0.5;
    float s = sin(uBoilRot), co = cos(uBoilRot);
    c = mat2(co, -s, s, co) * (c / uBoilScale);  // rotate + breathe about centre
    vec2 warped = c + 0.5 + uBoil;               // + registration offset
    vec4 col = IMG_NORM_PIXEL(inputImage, warped);
    col.rgb *= uFlutter;                         // uneven hand-painted density
    gl_FragColor = mix(col, vec4(uBlankCol, 1.0), uBlank);
}
```

### 3.3 Émulsion pass — dust, scratch, granulation (GLSL)

```glsl
/*{ "ISFVSN":"2","DESCRIPTION":"Émulsion — direct-on-film artifact family",
    "CATEGORIES":["Texture"],
    "INPUTS":[{"NAME":"inputImage","TYPE":"image"}] }*/
uniform float uDust;      // amount
uniform float uScratch;
uniform float uGranule;
uniform float uSeedFast;  // reseeds every tick
uniform float uSeedSlow;  // reseeds every N ticks (scratch persistence)

float h1(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float vnoise(vec2 p){
    vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
    float a=h1(i), b=h1(i+vec2(1,0)), c=h1(i+vec2(0,1)), d=h1(i+vec2(1,1));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}

void main() {
    vec2 uv = isf_FragNormCoord;
    vec4 col = IMG_NORM_PIXEL(inputImage, uv);

    // — dust & hair: sparse dark specks, reseeded fast (flicks frame to frame) —
    if (uDust > 0.0) {
        float d = h1(floor(uv * 220.0) + uSeedFast);
        float speck = step(1.0 - uDust * 0.012, d);     // very sparse
        col.rgb *= 1.0 - speck * 0.9;                   // dark dirt
        // occasional bright emulsion pit
        float pit = step(1.0 - uDust * 0.004, h1(floor(uv*180.0) + uSeedFast*1.7));
        col.rgb = mix(col.rgb, vec3(0.95), pit);
    }

    // — tramline scratches: near-vertical, PERSISTENT across ticks (slow seed) —
    if (uScratch > 0.0) {
        float lane = h1(vec2(floor(uv.x * 60.0), uSeedSlow));
        float on   = step(1.0 - uScratch * 0.08, lane);
        float wob  = (vnoise(vec2(uv.y * 8.0, uSeedSlow)) - 0.5) * 0.004; // slight wander
        float line = smoothstep(0.0015, 0.0, abs(fract(uv.x*60.0)-0.5-wob*60.0)/60.0);
        col.rgb = mix(col.rgb, vec3(1.0), on * line * 0.7);   // white scratch
    }

    // — dye granulation / pooling: coarse coloured value noise, clumped —
    if (uGranule > 0.0) {
        float g = vnoise(uv * 90.0 + uSeedFast) * vnoise(uv * 23.0);  // clumped
        col.rgb *= 1.0 - uGranule * 0.35 * (g - 0.5);   // density mottle, subtractive
    }
    gl_FragColor = col;
}
```

Notes: `IMG_NORM_PIXEL`'s coord is always a bare identifier (`uv`, `warped`) —
computed coords hoisted to a `vec2` first, per the recurring ISF gotcha. Splice
flash is a cheap uniform-driven whole-frame lerp + a horizontal bar, folded into the
present pass on the rare tick where `spliceChance` fires.

### 3.4 Relationship to existing Grain

This is a **new physical family**, not a duplicate. The rebuilt Grain covers
film=clumped / digital=sensor(shot·read·PRNU) / parasites=CRT·VHS. The émulsion set
is the missing **direct-on-film** family: scratch, dust/hair, splice, dye
granulation, leader flash. Extends `docs/research-ideas.md`'s grain taxonomy; runs
in the Cameraless stage (after the Finalizer grain), because these live on the
*print/handling* layer, above the exposure.

---

## 4. Mode A — McLaren / *Griffé* (graphic, rhythmic, synced)

### 4.1 Direct Marks generator (ISF source)

Flat, hard-edged, no radial symmetry (guardrail). Ruled lines + dots + scratches,
gated on the beat.

```glsl
/*{ "ISFVSN":"2","DESCRIPTION":"Direct Marks — ruled lines / dots / scratches",
   "CATEGORIES":["Generator"],
   "INPUTS":[
     {"NAME":"markType","TYPE":"long","LABELS":["lines","dots","scratch"],
      "VALUES":[0,1,2],"DEFAULT":0},
     {"NAME":"angle","TYPE":"float","MIN":0,"MAX":6.2832,"DEFAULT":0},
     {"NAME":"density","TYPE":"float","MIN":2,"MAX":120,"DEFAULT":24},
     {"NAME":"weight","TYPE":"float","MIN":0.01,"MAX":0.5,"DEFAULT":0.12},
     {"NAME":"gate","TYPE":"float","MIN":0,"MAX":1,"DEFAULT":1},   // ← coupling/audio
     {"NAME":"ink","TYPE":"color","DEFAULT":[0.9,0.9,0.85,1]},
     {"NAME":"paper","TYPE":"color","DEFAULT":[0.04,0.04,0.05,1]}
   ]}*/
void main(){
   vec2 uv = isf_FragNormCoord - 0.5;
   float s=sin(angle), c=cos(angle);
   vec2 r = mat2(c,-s,s,c)*uv;
   float m = 0.0;
   int mt = int(markType);                    // long → int cast, per gotcha
   if (mt==0) m = step(1.0-weight, abs(fract(r.x*density)*2.0-1.0));      // lines
   else if (mt==1){ vec2 g=fract(r*density)-0.5; m=step(length(g),weight);} // dots
   else { float j=fract(sin(floor(r.x*density)*91.7)*4373.0);            // scratch
          m = step(1.0-weight*0.6, abs(fract(r.x*density)*2.0-1.0))*step(0.6,j);}
   m *= step(0.5, gate + fract(sin(floor(r.y*density)*12.9)*4373.0)*(gate)); // beat gate
   gl_FragColor = mix(paper, ink, clamp(m,0.0,1.0));
}
```

### 4.2 Rhythm — reuse the coupling engine

McLaren's whole grammar is *the mark appears on the beat*. Don't reinvent it:

- **`gate`** is driven by **modulator slot 8 (audio)** or by the **coupling engine**.
  `cut` (transient flash + release) is already essentially *Blinkity Blank*'s
  staccato appearance; `gate` (loud→B) swaps mark sets on level.
- **Blinkity blanks** = the substrate's `blankChance` (black `blankMode`) at a
  musical `drawSync` division — marks appear intermittently with true empty frames
  between, i.e. intermittent animation, not just fade.

### 4.3 *Begone Dull Care* stack (topology, nothing new)

Soft colour **wash on the Background slab** (its own slow 0.25× clock) + hard marks
on a layer over it, **multiply** blend (ink over wash). Vibe split-tone finishes the
flat-field palette.

### 4.4 Animated / graphical sound — the thesis-deep move (research)

McLaren *drew the soundtrack*. The literal homage is closing the loop over OSC:
sample a scanline/region of the Direct Marks output → map to a control/audio
envelope → send to **Pandore** (`/opsia/av/mark-signal`, outbound). A single drawn
gesture is then simultaneously image *and* sound — **synchrèse at the level of the
mark itself**. Slots directly into the open **outbound-OSC / AVU relation-score
(S4)** work. Flagged research; not MVP.

---

## 5. Mode B — Brakhage / *Peint* (dense, gestural, silent)

### 5.1 Dye Field generator (ISF source, feedback-friendly)

Not a fluid sim (leave that for the WebGPU phase). Domain-warped value noise +
**subtractive** dye tint, disciplined toward **decay and pooling**, not bloom. Runs
happily under per-layer feedback for the crystallizing look (*Black Ice*).

```glsl
// domain warp (2-tap) → subtractive dye density; PERSISTENT-pass friendly
vec2 q = uv + 0.15*vec2(vnoise(uv*3.0+t), vnoise(uv*3.0+7.0));
vec2 w = uv + 0.35*vec2(vnoise(q*4.0+1.7), vnoise(q*4.0+9.2));
float dens = pow(vnoise(w*6.0 + t*0.05), 1.6);        // pooling, not glowing
vec3 dye  = mix(paperWhite, pigment, dens);           // subtractive over leader
gl_FragColor = vec4(dye, 1.0);
```

### 5.2 Superimposition flicker (engine behavior, near coupling/World)

Brakhage layered painted passes; the hypnagogic strobe is layers cross-cutting fast.
Add a **flicker** behavior that, **on each draw tick**, picks which layer(s) show via
a weighted choice (weights from World). It writes layer opacities post-sync so it
self-releases; wrap auto-changes in `undo.runSilently` (same discipline as the
sequencer overlays). Reuses the 4-layer stack + per-layer feedback you already have.

### 5.3 The landmine — subtractive, not additive-glow-on-black

**Brakhage-on-black is one slider from the forbidden additive-glow-on-black (brief
§1).** Keep it **pigment/dye with density over near-black-as-emulsion**, never
black-as-void-for-neon. Vibe split-tone + Finalizer levels hold it in dye/mid-tone
territory. The Cameraless granulation + boil are what sell "paint," not brightness.

### 5.4 *Mothlight* = a scan job, not a shader

Pressed material is a **video/still source**, not procedural. Flatbed-scan leaves /
wings / seeds (or CC0 botanical scans) → import as a source → high-contrast key +
Cameraless (émulsion + boil) → reads as pressed-in-tape. This is exactly the
existing "synthify imported video with the rack FX" path. Optional later: a collage
source scattering keyed silhouettes (seed from the Transform-Shapes SDF set).

---

## 6. World presets (the curated home for the two modes)

World is literally "bias the whole composition," Finishing-safe (bloom ≤.35, haze
≤.28, depth ≤.5) — the right place, keeps it curated rather than a knob pile.

| World | Coupling character | Cameraless | Palette / notes |
|---|---|---|---|
| **Griffé** (McLaren) | tight `cut` / `gate`, high `tightness` | `drawSync`=⅛, blank(black) low, low boil, scratch mid | flat 2–3-stop, high-contrast ink-on-paper |
| **Peint** (Brakhage) | `drift` / `lean`, low tightness, **audio decoupled** ("silent") | free `drawRate` 4–8, heavy boil + flutter, granule high | dye split-tone, near-black emulsion |
| **Pressé** (Mothlight)| `drift`, video-source-led | émulsion high, boil mid, scratch high | keyed material over leader |

Vibe (your palette) is always left alone by World, as built.

---

## 7. Guardrail check (enforce at every step)

- ✅ Seed voice preserved — this is glitch/digital-arts *material*, not new-age plasma.
- ✅ **No radial/kaleidoscope symmetry** — Direct Marks and Dye Field are both linear/
  domain-warp, never polar.
- ✅ **No additive-glow-on-black** — Peint is subtractive dye over emulsion (§5.3).
- ✅ Feedback disciplined toward **decay/displacement**, not blooming neon (dye pooling).
- ✅ **Randomize within curated ranges** (table §3) — and Randomize **skips** the
  Cameraless stage's structural params (like it skips `pbr*` / Text), rolling only
  amounts within curated bounds. Native → excluded from the dice by default.
- ✅ Fixed topology — one stage + two sources + three Worlds, no open pile.
- ✅ "0 is passthrough" — genuine null state (§2.4).

## 8. What Opsia is still NOT (after this)

Still not analog-video-synth-defined, not cheap psychedelia, not a media-server VJ
app. Cameraless is **one optional family**, gated by taste, off by default.

---

## 9. Implementation order (recommended)

1. **Draw clock + hold + boil** (§3.1–3.2) — nothing reads as film until this exists;
   ship it first, play-test alone over existing content.
2. **Émulsion pass** (§3.3) — dust → scratch → granulation, in that order.
3. **`blankChance` + splice** — the Blinkity/leader punctuation.
4. **Direct Marks source** + wire `gate` to coupling/audio (§4).
5. **Dye Field source** + superimposition flicker (§5.1–5.2).
6. **Three World presets** (§6).
7. *(research)* **Animated-sound outbound loop** (§4.4) — with S4.

Each round: `npm run typecheck && npm run build` green, descriptive multi-line
commit (local only — don't push), relaunch `npm run dev`, report per item.

---

## 10. Références / thesis-notes seed (bilingue)

*Cette section double comme amorce de notes de thèse. Le geste central : le retour
de **la main** et de **la résistance matérielle du médium** dans un instrument
numérique — le film peint « répond », il a sa propre voix. C'est un geste de
résonance (Rosa) avant d'être un shader, et il prolonge le cadrage de la maîtrise
(« une famille d'instruments de transformation où un signal d'origine externe est
re-façonné par un opérateur interne ») : ici l'opérateur interne est la **matière
simulée du film** — grain, granulation, griffe, battement d'exposition.*

**Cinéma sans caméra / direct animation**
- Stan Brakhage — *Mothlight* (1963), *The Dante Quartet* (1987), *Black Ice*,
  *The Garden of Earthly Delights*; *Metaphors on Vision* (1963) — la « vision à
  l'œil fermé », le hypnagogique, le silence comme parti pris.
- Norman McLaren / ONF — *Begone Dull Care* (1949, av. Evelyn Lambart),
  *Blinkity Blank* (1955, gravure sur émulsion noire, animation intermittente),
  *Lines: Vertical/Horizontal*, *Dots*, *Loops*, *Hen Hop*.
- Len Lye — *A Colour Box* (1935), *Free Radicals* (1958, gravure directe) — le
  troisième pilier du film direct, souvent oublié.
- Harry Smith — *Early Abstractions* (peinture à la main, batik sur pellicule).
- Caroline Leaf, Pierre Hébert (ONF) — gravure/geste, filiation québécoise.

**Son dessiné / graphical sound (pour §4.4 — la boucle image→son)**
- Norman McLaren — *animated sound* : synthèse de la bande optique par marques
  peintes/gravées. Le cœur du geste synchrèse « à même la marque ».
- Evgeny Sholpo — *Variophone* ; Rudolf Pfenninger — *Tönende Handschrift* ;
  Oskar Fischinger — sound ornaments ; Daphne Oram — **Oramics** (dessin → son).
  → amorce directe pour un lien Opsia↔Pandore où un même geste est image *et* son.

**Cadre théorique (relations audiovisuelles + résonance)**
- Michel Chion — *synchrèse*, *audio-vision* ; déjà porté dans le coupling engine
  (cut/gate/drift = catalogue de synchrèse) et le mode World (diégèse).
- Hartmut Rosa — *Résonance* : relation résonante vs. relation muette/instrumentale
  au monde. La main qui revient, la matière qui résiste = résonance.
- Trevor Wishart — *On Sonic Art* ; Denis Smalley — spectromorphologie : penser la
  granulation/le battement comme *morphologies* visuelles (attaque, grain, texture).
- Myriam Boucher / Jean Piché — schéma de scène (Diégèse · Synchrèse · Espace-temps ·
  Climat), déjà encodé dans `SceneEntry.tags` ; les modes Griffé/Peint/Pressé s'y
  lisent comme des *Climats*.

**Repères techniques in-repo**
- `docs/opsia-convolution-spec.md` — Transfert (Module 2) ; le boil/hold partage la
  même logique de nœud natif (header ISF + classe TS + FBO persistant).
- `docs/research-ideas.md` — taxonomie de grain (film/capteur/CRT-VHS) ; l'émulsion
  est la **famille direct-film manquante**.
- `references/research-audiovisual-relations.md` — la théorie derrière le coupling /
  World / Proximity que Griffé/Peint réutilisent.
