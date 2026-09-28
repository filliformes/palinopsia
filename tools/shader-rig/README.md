# Shader rig

An offscreen Electron page that loads the live shader registry, with every registry
transform and the patched runtime (texture bridge, integrated `PH_` phases), so a
generator or effect can be checked without launching the app.

```
cd tools/shader-rig
node build.cjs                                   # after every shader / registry edit
SRCH_PORT=9461 ../../node_modules/electron/dist/electron.exe . &
node h.cjs 9461 check slabs,ten-print            # generators
node h.cjs 9461 fxcheck fx-grain,fx-decay        # effects, fed a moving test card
node h.cjs 9461 quit                             # always close it when done
```

The default ids are in `src/renderer/src/shaders/isf/index.ts`.

| command | what it tells you |
|---|---|
| `check ids [inputsJSON]` | compile error, or stats at 5 s / 1 h / 24 h of show time (phases jumped as a long show), `moves` = change over 0.1 s, `ms4k` = cost at 3840×2160. A picture that should move but is frozen, striped or on a lattice at 24 h is a precision bug. |
| `fxcheck ids [inputsJSON]` | as `check`, plus `diffIn` (how much the effect changes the card), `stillMoves` (does it animate on a still input), `alphaHole` (output where the input is transparent). |
| `scrub id input a b [t]` | moves `input` from a to b at clock t. `stepChanged` must stay the same order as `stepSame`, or the knob jumps the picture. |
| `shot id t out.png [inputsJSON] [warm] [w] [h]` | one frame as a PNG. Always look at 16:9 **and** a square (1024 1024). |
| `reload` / `eval "<js>"` / `quit` | reload after `build.cjs`, run page JS, close the rig. |

Inside the page (`eval`):

- `window.INPUT` is `'card'`, `'alpha'` or `'black'`, and `window.MOVING` switches the card's motion.
- `setAudio(wave, spec)` fills the audio texture; each argument is 128 values from 0 to 255.
- `FORCE_DT` fixes `TIMEDELTA`.

The page mirrors the app on three points that tests otherwise get wrong:

- The audio texture is an R8 GL handle, pushed before every draw.
- The GL proxy ignores the runtime's `bindTexture(null)`.
- `TIMEDELTA` is forced to the simulated frame step.

For native sources and nodes (TypeScript classes) use the isolated app build instead: `bash tools/test-build.sh [port]`. It exposes `window.__store` and `window.__comp`; close it with `bash tools/test-build.sh [port] stop`.
