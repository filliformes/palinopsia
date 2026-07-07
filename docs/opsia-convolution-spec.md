# Palinopsia — Visual Convolution Spec (v0.2)

Two sidechained effect nodes + one future capture system, for the Palinopsia (Opsia)
WebGL2 + ISF engine. Concept: treat another layer as an *impulse response* — spatially
(texture/glare signature) or temporally (gesture/energy signature) — and imprint it
onto the host layer.

**Theoretical frame (thesis link).** Seitz & Baker's *Filter Flow* (ICCV 2009) models
any image transformation as a space-variant linear filter T applied per pixel, with
global convolution as the special case where all per-pixel filters are identical
("Convolution Constraint"), and factors the general transformation as **T = MK**
(geometric motion × photometric kernel). Opsia's modules are the two factors, run in
the *forward* (synthesis) direction — the filter as chosen/captured compositional
material — where the CV literature only runs the *inverse* (analysis) direction:
- `ConvolveSpatial` = K, space-invariant end of the axis
- `MotionTransfer` (Déplacement + Traînée modes) = M, space-variant end
- `Réponse` (Module 3) = extending the kernel through time (cf. 3D CNN factorized
  spatiotemporal convolutions)

**Implementation note:** both effects require multi-pass rendering with dynamic pass
counts and persistent FBO state. Do NOT implement as ISF shaders. Implement as
**native engine effect nodes** (TypeScript classes in the render engine) that expose
the same parameter/UI surface as ISF effects in the chain, plus one extra input:
a **sidechain layer picker** (any of the 4 layers, or an imported still/clip).

---

## Module 1 — `ConvolveSpatial` (FFT image ⊛ kernel-image convolution)

The Unreal "convolution bloom" model generalized: the sidechain frame is the kernel
(point-spread function). Every bright pixel in the host image "stamps" a scaled copy
of the kernel. Transfers glare shape, texture signature, energy distribution.

### Pipeline (per frame)

```
host frame ──► luma boost ──► pad/downsample to N×N ──► FFT ──┐
                                                              ├─► complex multiply ─► IFFT ─► fftshift ─► mix(dry, wet)
kernel frame ─► preprocess ─► pad/downsample to N×N ─► FFT ───┘   (cached)
```

1. **Working resolution N**: 256 or 512 (user param `quality`). Power of two. RGBA16F
   FBOs (`EXT_color_buffer_float` — already required by the feedback engine; verify
   at init and hard-fail with a UI notice if absent).
2. **Complex packing**: process luma-only in RG (real, imag) for the cheap path;
   full-color path runs the FFT per channel-pair (RG = ch0, BA = ch1, second batch
   for ch2) — start with luma-only + chroma passthrough, it looks 90% as good.
3. **FFT**: Stockham radix-2, ping-pong between two FBOs.
   - Horizontal: log2(N) passes, then vertical: log2(N) passes.
   - One fragment shader, uniforms: `uStage`, `uDirection (h/v)`, `uInverse`.
   - IFFT = same shader with conjugate/sign-flip + 1/N² normalization on final pass.
   - 512²: 2 × 9 passes × 2 (fwd host + inverse) + kernel when dirty ≈ ~40 tiny
     passes worst case — fine on desktop GPU, still budget it behind a per-node
     enable flag.
4. **Kernel spectrum cache**: recompute kernel FFT only when (a) sidechain layer
   content is flagged dirty AND `kernelFreeze == false`, or (b) every
   `kernelRefresh` frames (param, default 1 = live, can set 0 = frozen). A live
   video kernel = animated impulse response = the fun zone, but expensive; freeze
   is the default.
5. **fftshift** the result (kernel is centered).

### Kernel preprocessing pass (single shader, before kernel FFT)

- `threshold` (0–1): kill low-luma pixels so the kernel stays sparse
- `kernelBlur` (0–8 px separable)
- `kernelGamma` (0.25–4)
- **normalize: divide by total energy** (reduction via mipmap of the preprocessed
  kernel, read top mip) → energy-conserving, no frame blowout
- `centerOffset` (xy): where the "point source" sits in the kernel image

### Host-side params

- `boostThreshold` / `boostGain`: pre-multiply host highlights before FFT
  (UE-style boost min/multiplier) so only hot pixels bloom
- `scale`: kernel scale (implemented as UV scale on kernel before FFT)
- `mix` (dry/wet), `additive` toggle (add convolved on top vs. replace)

### Fallback / cheap mode

`quality = "direct"`: skip FFT, downsample kernel to 9×9 or 15×15 taps, brute-force
convolution in one pass. Ugly-cheap but useful on weak GPUs and for subtle blurs.

---

## Module 2 — `MotionTransfer` (optical-flow displacement, sidechained)

Extract the *movement* of sidechain layer B, apply it as a displacement/modulation
field to host layer A. This is the "recreate an energy, a gesture" effect.

### Passes (per frame)

1. **Luma + downsample** of B's current frame → `flowRes` (default 256², RG16F
   history kept: `prevLuma` FBO).
2. **Flow estimation** — single-pass gradient method (poor-man's Lucas–Kanade):

```glsl
// flow.fs — inputs: uCur, uPrev (luma), output RG = flow vector
vec2 texel = 1.0 / uResolution;
float c  = texture(uCur,  vUV).r;
float p  = texture(uPrev, vUV).r;
float dx = texture(uCur, vUV + vec2(texel.x, 0)).r - texture(uCur, vUV - vec2(texel.x, 0)).r;
float dy = texture(uCur, vUV + vec2(0, texel.y)).r - texture(uCur, vUV - vec2(0, texel.y)).r;
float dt = c - p;
vec2 grad = vec2(dx, dy) * 0.5;
float mag2 = dot(grad, grad) + uLambda;   // uLambda ~ 0.001, regularizer
vec2 flow = -dt * grad / mag2;
fragColor = vec4(clamp(flow, -uClamp, uClamp), 0.0, 1.0);
```

3. **Flow conditioning**: separable blur (`flowBlur`, big default ~8px — raw
   gradient flow is noisy) + **temporal smoothing**: `flow = mix(prevFlow, flow,
   uResponse)` into a persistent flow FBO. `uResponse` 0.05–1.0 — low values give
   the flow *inertia*, which reads as weight/momentum. This param is the soul of
   the effect; put it front and center as **Inertie**.
4. **Displacement pass** on host A at full res:
   - `uv' = uv + flow * amount` (flow upsampled with linear filtering)
   - `channelSpread`: per-RGB-channel multipliers on `amount` (chromatic pull)
   - `magnitudeGamma`: shape response to flow strength
   - `modTargets` (v2): optionally route |flow| as a modulation signal into the
     host layer's existing param-mod system instead of / in addition to
     displacement — this is where it becomes a *modulator*, not just an effect.
5. **Feedback integration**: optional `smear` (0–1) writes the displaced result
   into the layer's existing ping-pong feedback FBO with decay — motion trails
   that follow B's gesture.

### Mode 2 — « Traînée » (flow-steered line blur, poor-man's SepConv)

Same flow passes (1–3), different application shader. Inspired by SepConv's
spatially adaptive separable kernels: per pixel, blur the host along a 1D line
oriented by the sidechain's flow vector — direction from flow angle, length from
flow magnitude. Motion blur painted by another layer's movement; a per-pixel
kernel field without any network.

```glsl
// trainee.fs — host in uHost, conditioned flow in uFlow
vec2 f = texture(uFlow, vUV).rg * uAmount;          // steering vector
float len = length(f);
vec2 dir = len > 1e-5 ? f / len : vec2(0.0);
len = pow(len, uMagnitudeGamma);
vec3 acc = vec3(0.0);
float wsum = 0.0;
for (int i = -TAPS; i <= TAPS; i++) {                // TAPS = 8..16
  float t = float(i) / float(TAPS);                  // -1..1
  float w = 1.0 - abs(t) * uFalloff;                 // triangular window
  acc  += texture(uHost, vUV + dir * t * len).rgb * w;
  wsum += w;
}
fragColor = vec4(acc / wsum, 1.0);
```

Extra params: `taps` (quality), `falloff` (kernel window shape), `bidirectional`
toggle (smear both ways vs. trailing only: `t` in 0..1). Modes share the node —
UI dropdown **Déplacement / Traînée**, both can be active (displace then smear).

### Params summary
`mode (déplacement | traînée)`, `amount`, `inertia (uResponse)`, `flowBlur`,
`flowScale`, `invert`, `channelSpread`, `magnitudeGamma`, `smear`, `flowRes`,
`taps`, `falloff`, `bidirectional`.

---

## Module 3 (later) — Temporal IR / « Réponse » capture system

Own window. Convolution-reverb workflow: capture → browse → shape → load.

- **Capture**: record 1–2 s from any layer. Two artifacts per capture:
  (a) mean-luma-per-frame envelope (the *temporal IR*, an array of 30–60 floats),
  (b) optionally the flow-field sequence (heavier, v2).
- **Frame-echo convolution**: ring buffer of N history frames of the host layer
  (N = 16 default; **half-res RGBA8** — 32 × 1080p × RGBA16F would be ~½ GB, don't),
  output = Σ history[i] × envelope[i], normalized. Trails that pulse with the
  captured rhythm.
- **IR editor**: trim, gain, attack/decay envelope overlay, reverse, stretch.
- **Library**: JSON + PNG/therm strip thumbnails in the user data dir; IRs are
  assignable to any ConvolveSpatial kernel slot (stills) or frame-echo node
  (envelopes).

---

## Engine integration checklist

- [ ] Effect-node base class gains optional `sidechainSource: LayerRef | AssetRef`
- [ ] Dirty-flag propagation from layers → dependent kernel caches
- [ ] FBO pool: FFT ping-pongs (2×N² RGBA16F), flow (3×flowRes² RG16F), shared
      across nodes of the same type where possible
- [ ] Node UIs in the standard chain panel; French display names:
      **Convolution** (spatial), **Transfert** (motion), **Réponse** (temporal IR)
- [ ] Perf guardrails: per-node ms readout in the debug HUD; auto-drop
      `kernelRefresh` when frame time > budget

## Build order

1. `MotionTransfer` first (Déplacement mode) — no FFT, ~4 small passes,
   immediately expressive, validates the sidechain-picker plumbing.
2. Traînée mode — reuses flow passes, one new shader.
3. `ConvolveSpatial` luma-only, frozen kernel → then live kernel → then color.
4. Module 3 once 1–3 tell you which captures feel musical.

---

## Références (graine de notes de thèse — « convolution visuelle »)

### Mécanisme (vision/graphics — l'opérateur sans l'esthétique)

- **Seitz, S. M. & Baker, S. (2009). « Filter Flow ». ICCV 2009, 143–150.**
  Texte fondateur de l'opérateur : toute transformation d'image comme filtre
  linéaire variant dans l'espace ; la convolution globale comme cas particulier
  (« Convolution Constraint ») ; factorisation T = MK (mouvement géométrique ×
  noyau photométrique) ; le centroïde du filtre de mouvement *est* le flux
  optique. Limite avouée : résolution du problème *inverse* en heures (LP).
  → Opsia inverse la direction : problème *direct*, temps réel, noyau choisi.
- Ravi, S. N. et al. (2017). « Filter Flow Made Practical ». CVPR 2017.
  (Parallélisation GPU du cadre ; confirme le verrou computationnel côté analyse.)
- **Niklaus, S., Mai, L. & Liu, F. (2017). « Video Frame Interpolation via
  Adaptive Separable Convolution ». ICCV 2017.** Noyaux séparables 1D estimés
  par pixel — flux et synthèse fusionnés dans la convolution : *le noyau encode
  le mouvement*. L'erratum de l'auteur reconnaît Filter Flow comme antécédent.
  → base du mode Traînée.
- Hertzmann, A. et al. (2001). « Image Analogies ». SIGGRAPH 2001.
  (Transfert de transformation apprise d'une paire vers une nouvelle source.)
- Gatys, L. et al. (2016) + Ruder, Dosovitskiy & Brox (2016/2018). Transfert de
  style neuronal, extension vidéo par contrainte temporelle sur flux optique.
- « Learning to Transfer Visual Effects from Videos to Images » (2020) —
  transfert de l'*effet spatio-temporel* (mouvement, déformation) distinct du
  style ; le plus proche du « transfert d'énergie » visé.
- Tran, D. et al. (C3D) ; Carreira & Zisserman (I3D, 2017) ; Feichtenhofer et
  al. (SlowFast, arXiv:1812.03982). Convolutions 3D spatio-temporelles ;
  factorisation spatiale/temporelle (≈ split ConvolveSpatial / Réponse) ;
  « temporal extent » ≈ longueur d'IR ; SlowFast : asymétrie espace/temps —
  redécouverte ingénieure de la distinction geste/texture.
- Unreal Engine, « Bloom Convolution » (doc Epic) — précédent industriel :
  image-noyau comme PSF (réponse impulsionnelle *visuelle*), convolution FFT
  temps réel. Aucune théorisation esthétique.

### Esthétique (théorie audiovisuelle — le vocabulaire sans l'opérateur)

- Smalley, D. (1997). « Spectromorphology: explaining sound-shapes ».
  *Organised Sound* 2(2). (Geste/texture, énergie-mouvement.)
- Garro, D. — extension de la spectromorphologie à la vidéo (« From Sonic Art
  to Visual Music », *Organised Sound*).
- Cooke, G. & Wilcox, F. (2023). « Audiovisual gesture and spectromorphology:
  the Invalid Data W.E.S.T. project ». *IJPADM* 19(2), 158–.
- Hyde, J. ; Knight-Hill, A. — « musique concrète thinking » appliqué à l'image ;
  cf. appel *Organised Sound* sur l'intermédialité audiovisuelle (en cours).
- Wishart, T. *On Sonic Art* ; Roads, C. *Microsound* / *Computer Music
  Tutorial* (convolution comme cross-synthèse, imprégnation d'un signal par un
  autre — le modèle audio transposé).

### La thèse en une ligne

La vision par ordinateur a construit l'opérateur complet de la convolution
visuelle pour *mesurer* les images (direction inverse, analyse) ; la théorie
audiovisuelle possède le vocabulaire du transfert d'énergie sans l'opérateur ;
personne n'a encore traité le filtre lui-même comme *matériau compositionnel*
(direction directe, synthèse, lutherie). Opsia occupe ce vide.
