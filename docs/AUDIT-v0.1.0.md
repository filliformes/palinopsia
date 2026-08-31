# Palinopsia — pre‑v0.1.0 audit & fix checklist

Deep full‑codebase audit (8 parallel subsystem reviews + global sweep), 2026‑08‑28.
Overall: engine core is healthy — no per‑frame GL leak, no steady‑state output corruption,
mod math sound, Sonify NaN guards hold, shader data layer 107/107 clean, 0 TODO markers,
0 orphaned files, 0 unused deps. Issues cluster in **packaging**, **state round‑trip / rebuild
survival**, and **a few reachable crash/NaN paths**.

**Release scope = B: fix all of Tier 0 (blockers) + all of Tier 1 (highs) before tagging v0.1.0.**
Tier 2 / Tier 3 are the tracked post‑0.1.0 backlog.

> **Progress (2026‑08‑28):** Tier 0 — **7/7 done**. Tier 1 — **9/9 done**. Tier 2 — **19/19 done**.
> Tier 3 — **done** (2 items were non‑bugs; 2 marginal edges deferred). Low‑tail sweep — **done**
> (~25 low findings that had been consolidated out, now fixed). Effectively the **entire audit is
> cleared** for v0.1.0. Caveats to verify on the first real tag build: **T0‑4** (Spout node‑gyp
> toolchain on windows‑latest) and **T0‑7** (mac signing/notarization is deferred — the draft
> release must carry the Gatekeeper right‑click‑Open note). All changes pass `npm run typecheck`
> and a full `electron-vite build`.

---

## 🔴 Tier 0 — Release blockers  *(in scope for v0.1.0)*

- [x] **T0‑1 · Linux target** — `electron-builder.yml` has only `win:`/`mac:`. Add a `linux:` block
      (`AppImage` + `deb`, `category: AudioVideo`), a `build:linux` script in `package.json`, an
      ubuntu‑latest CI job, and `*.AppImage`/`*.deb` to the artifact upload glob.
- [x] **T0‑2 · App icons** — `build/` is empty; every platform ships the default Electron icon.
      Add `build/icon.png` ≥1024² (electron‑builder derives `.ico`/`.icns`); ideally real `.ico`+`.icns`.
- [x] **T0‑3 · deb maintainer email** — DONE. Set `linux.maintainer: Vincent Fillion
      <vfillion.av@gmail.com>` in electron-builder.yml and a matching `author` object in package.json.
- [x] **T0‑4 · Spout in CI** — `native/spout/build/…spout.node` is git‑ignored; CI never builds the addon,
      so CI Windows installers silently ship without Spout. Add a `node-gyp rebuild` CI step before
      packaging. (Mac/Linux are unaffected — Spout is guarded `process.dlopen`.)
- [x] **T0‑5 · Mac per‑arch ffmpeg** — `mac.target arch: universal` on the arm64 runner packs an
      arm64‑only ffmpeg → Intel Macs lose probe/convert/record/Assemble. Split x64+arm64 dmgs or
      fetch both binaries + pick at runtime.
- [x] **T0‑6 · User‑file folder location** — Sessions/Recorded written next to the exe
      (`session.ts:47`, `recording.ts:108`, `assemble.ts:541`): inside the `.app` bundle on mac,
      wiped NSIS temp on Windows portable, read‑only squashfs on AppImage. Use `documents`/userData.
- [x] **T0‑7 · Mac signing + CI release** — dmg is unsigned/un‑notarized (Gatekeeper flags it);
      CI only uploads artifacts. Document the right‑click‑Open caveat (or add signing) and, if wanted,
      add a tag→release step.

## 🟠 Tier 1 — High‑severity bugs  *(in scope for v0.1.0)*

- [x] **T1‑1 · Session sound never restored** — `store.ts:3066` sits after `loadSession`'s `return`
      (dead code). Move the Sonify‑restore into/above the `set(...)`.
- [x] **T1‑2 · Filter voice NaN‑latches to permanent silence** — `soni.worklet.js:409,788`. Chamberlin
      SVF stable only to ~fs/6; coef cap is 21.6 kHz. Cap band centre at ~fs/6.5 (as Raster does) +
      reset `fLow/fBand` on non‑finite.
- [x] **T1‑3 · NDI/Spout output goes black after engine rebuild** — `App.tsx:274`. Effect ordering +
      missing `glEpoch` dep re‑attach the capture callback to a null compositor. Reorder / add dep /
      re‑arm after rebuild.
- [x] **T1‑4 · Capture MediaStream leak (camera LED stays on)** — `CaptureSource.ts:30`. Add a
      `disposed` guard so a pending `getUserMedia`/`getDisplayMedia` that resolves after dispose stops
      its tracks.
- [x] **T1‑5 · Randomize flips master output geometry** — `randomize.ts` long/bool branch ignores
      curated pins (`fx-finalizer.outShape/outBgSource`, `fx-transform.shape`, `fx-wide-time.mode`).
      Make the long/bool randomize branch respect the curated range.
- [x] **T1‑6 · Bad HIVE port crashes the app** — `index.ts:407`→`hive.ts:81`. Validate the port in the
      unwrapped `ipcMain.on` handler (integer 1..65535) before `net.connect`.
- [x] **T1‑7 · Crash race on output‑window close** — `index.ts:392` `output:frame` (and `ndi:frame`,
      `recording:chunk`, `hiveout:chunk`, `oscquery:values`) send to `webContents` with no
      `isDestroyed()` guard. Wrap the `.on` handlers.
- [x] **T1‑8 · `opsia-media://` arbitrary‑file‑read** — `media.ts:38` streams any absolute path.
      Restrict to the video‑extension whitelist + registered roots (cache dir, session folders,
      user‑picked paths).
- [x] **T1‑9 · Crash recovery has no UI** — `autosave.ts` rotates snapshots + computes `prevRunCrashed`,
      but the renderer never calls `autosaveCrashCheck/List/Load`. Wire the restore prompt (or remove
      the dead machinery).

---

## 🟡 Tier 2 — Medium bugs  *(DONE — all folded into v0.1.0, 2026‑08‑28)*

State round‑trip / rebuild:
- [x] Full `exportSession()` serialized over IPC on every store write — now a trailing throttle (≤1/s) on `subscribe`.
- [x] `updateSceneFromLive` now captures composition + World + Sonify (like saveScene); `sequenceTo` recalls the scene's Sonify.
- [x] Undo snapshots now include `sonify` (via setSonify), the 8 field macros, and `surface`.
- [x] `newSession` applies the active World to the fresh composition and resets `surface`.
- [x] `globalSpeed` + `morphMs` persisted (localStorage + session round‑trip + Session type).
- [x] SessionLoader Load now silently saves the outgoing session first (mirrors Open/New).
- [x] `depthModePrev` reset to `''` on engine rebuild → synth‑depth Parallax re‑applies.
- [x] `synth` depth mode now feeds the vision bus with the bowl's mean/spread (0.344 / 0.712).

Dangling refs / integrity:
- [x] The 6 replace‑style actions now `dropTargets`/`dropLayerTargets` (master keeps locked‑finalizer patching).
- [x] Sub‑100% randomize (`randomizeComposition`) prunes fx rows whose instId is absent from the mixed composition.
- [x] Mod‑depth sliders (matrix chip + knob) widened to ±10 to match AssignRow.

Interaction / audio:
- [x] ConfirmModal Enter no longer confirms regardless of focus (window Enter→onYes binding removed).
- [x] Escape page‑close branches now guard on `!inField` → cancels the field edit instead of closing the page.
- [x] Two‑scene Metasurface now crossfades (far neighbour radius doubled for n≤2; n≥3 untouched).
- [x] Sonify transpose: `snapNote` (Orbit/Raster) + free‑mode Flow/Events now apply the root‑octave shift.
- [x] Grain's 3 voice decoders released on grain‑off (`disposeVoices`).
- [x] Video‑convert failure now uses try/finally (no listener leak) and no longer direct‑plays the black clip.
- [x] Sonify OSC index params disambiguate by OSC type tag (integer = raw index).
- [x] Meta‑knob curve now shapes the modulated POSITION like the manual path (linear = no‑op).
- [x] HIVE‑send returns `{ok:false,error}` on bind failure (resolves on `listening`/`error`).

## ⚪ Tier 3 — Low / dead code / polish  *(DONE — cleared for v0.1.0, 2026‑08‑28)*

Dead code (removed — every claim verified by grep before deletion):
- [x] `mixerView` store field removed (type + 3 writes).
- [x] `AssignPopover` removed (~50 lines + orphaned scaffolding + now-unused imports).
- [x] Main‑process `ModulationEngine` no‑op interval removed; `src/main/modulators.ts` deleted.
- [x] Dead `bindDepth`→`fx-parallax` per‑frame loop removed (`clearDepth` kept).
- [x] `setMasterFx`, `renameAssemblage`, `__exportEdlForTest` removed.
- [x] `reagentProg` deleted on dispose; prewarm `warmFbo`/`warmInput`(+fbo)/`warmNode` targets now freed.
- [x] OSC `setOnSent`/`setOnError` + dead `onSent`/`onError`/`lastSendDest` machinery removed.
- [x] Stale `allowScripts` block removed from package.json (CI comment already rewritten in T0).
- [x] Dead curated entries removed (`fx-slit-buffer.direction`, `fx-mosaic.shape`, `solid-color.gradient`).
- [x] `fx-context` `pbrNormal`/`pbrHeight`/`pbrAO` input hints removed.

Low bugs (fixed):
- [x] BG SPEED number‑box max aligned to the slider's 2 (background is a deliberately slow clock).
- [~] Surface ▶ play — **not a bug**: `setSurfacePlay` already sets `active: true` on play.
- [x] `dragId` cleared on `dragend` in FxRackPanel + SceneBank (aborted drag can't leak a stale id).
- [x] Ctrl+Z/Y now guard `!inField` (native text‑undo works in fields; Ctrl+S stays global).
- [x] ADSR readout shows 0.01 s resolution (`0.55` reads "0.55", stored ms unchanged).
- [x] Recording‑stop ffmpeg added to the shared reap set (killed on quit).
- [x] OSCQuery marks `/opsia/vision/*` read‑only (ACCESS 1); audio stays writable (it's inbound).
- [x] Follower smoothing (audio/vision/homeostat) dt‑normalized (identical feel at 60 fps, rate‑independent).
- [x] Spectra free‑spread partials clamped to `sr*0.49` (no supra‑Nyquist aliasing).
- [x] `replaceClips` now `.slice()`s (matches setPlaylist's aliasing guard).
- [x] Reverb `recompute()` gated behind a size/decay/crossover/freeze/mult change‑cache.
- [x] Worklet `process()` splices replaced with allocation‑free write‑index compaction.
- [x] `orbitDrive` mod range max widened to 4 (matches UI + OSC).
- [x] `suggestSonify` auto‑voicer now includes Events + Chord (weight‑2, tie‑losing secondaries).
- [x] `warmVideoFolder` queues a second folder instead of dropping it.
- [x] `\bdxv\b` → `dxv[0-9]*` so `dxv3` matches (no black frame).
- [~] WorldPage builtin edits — **not a bug**: intentional, UI already says "edits are session‑only".
- [~] Deferred (marginal, documented): HiveSource late‑frame close (EXPERIMENTAL HEVC path);
      CaptureSource per‑frame re‑upload (perf micro‑opt only, no correctness impact).

## 🔵 Low tail — swept (items consolidated out of the first checklist, then fixed 2026‑08‑28)

A re‑analysis found ~25 LOW findings from the original 8‑agent audit had been folded out of the
tiered checklist. All fixed (or confirmed by‑design). typecheck + build green.

Store / worlds:
- [x] Malformed‑but‑v1 session file now bails cleanly (shape guard at top of `loadSession`) — no half‑applied theme/crash; App caller also try/caught.
- [x] World auto‑mod respects `MAX_MOD_ASSIGNMENTS` + reserved `WORLD_AUTOMOD_SLOT`; `normalizeComposition` pads `modulators` to 8.
- [x] `loadWorlds` validates user‑world shape (drops malformed entries; keeps valid `autoMod: null`).
- [x] `loadSession` resets stale `selection` + `vibePresetName`.
- [x] `generateTheme` resets `surface` (matching `newSession`).
- [x] `persistMacro`/`persistSonify` localStorage writes guarded against quota throw.

Main process:
- [x] mac `appQuitting` re‑armed in `createWindow` (dock‑reactivated window keeps the save‑before‑quit intercept).
- [x] `OscSender.start` resolves on bind error (window creation can't hang on a taken OSC port).
- [x] `recordingStart` deletes the old intermediate instead of orphaning it.
- [x] oscquery post‑listen error no longer nulls a live server (`stop()` can always close it).
- [x] `openOutputWindow` applies a fullscreen↔windowed / display switch instead of only focusing.
- [x] osc‑receive `stop()` can close a not‑yet‑ready socket (no bound‑port leak).
- [x] Dead `OscSender.send()` wrapper removed.

UI / Sonify / engine:
- [x] OutputPage HIVE‑port uses a draft state (no snap‑back mid‑edit).
- [x] Event FIRE's 140 ms reset cancelled on shader/slot swap (no stray key on the new shader).
- [x] ContextMenu Escape uses capture‑phase `stopPropagation` (doesn't also fire app Escape).
- [x] Short (7‑entry) `mixFilter` presets padded to 8 instead of discarded.
- [x] `spectraX`/`filterX` mod chips greyed + tooltipped while the voice is sweeping (inert‑state shown).
- [x] OSCQuery Orbit pitch reports the real free‑mode note (`freqNote`), not a hardcoded 45.
- [x] `coupling.ts` `clamp01` NaN‑safe (a partial coupling block can't blank a layer).
- [x] AutocutterNode wraps its GL_BLEND draw in try/finally (blend always restored).
- [x] `gen-text` background warns once instead of a silent blank (a full handler was disproportionate).
- [x] Dead `CollageSource.setAsmDecks` branch removed.
- [x] Escape close‑order now matches page stacking (closes the visually topmost overlay first).
- [~] `modBypass` vs manual Meta glides — left as‑is (by‑design: a mute of automated modulators
      shouldn't freeze the user's own hand on a macro).

---

## Verified clean (no action)
ISF ping‑pong/feedback buffers · 19 native nodes · all 17 modulator types + bounds · dice safety
(340 draws, 0 mutes) · ffmpeg child reaping · atomic session writes ·
FX‑tail NaN self‑heal · Raster SVF cap · 107/107 shader presets/keywords/blurbs in‑range ·
no dead IPC channels · message‑shape parity sonify.ts↔worklet · mixFilter index↔render order.
