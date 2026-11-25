# Palinopsia : the dataflou node

A small N-API addon on **dataflou**'s C interface (`dataflou_c.h`, API 0.6, core 9.3), so
Palinopsia is a node of the mesh with the core's own code. It runs in the Electron **main**
process (`src/main/dataflou/`), each node on a thread of its own : see the head of
`df_addon.cc`, and `docs/dataflou-9.3.md` for what was decided and measured.

`df_addon.cc` exposes `version()`, `skuFromSeed(seed)`, `feature(name)`, `open(options,
wake)` → a handle, `go(handle)`, `drain(handle)` → what the node said, `call(handle, id,
op, args)` and `close(handle)`. JavaScript's side is `src/main/dataflou/addon.ts`.

`sdk/` is vendored, pinned and unchanged : see [VENDOR.md](VENDOR.md).

## Build

The built `build/Release/dataflou.node` is git-ignored : build it after cloning. No network is
needed beyond Electron's headers, and no npm package. N-API : it does not depend on
Electron's ABI. Windows needs Visual Studio 2022 or later with *Desktop development with C++*
(node-gyp 12 finds VS 2026; CI uses node-gyp 11 on VS 2022); macOS 13.3 or later's tools;
Linux a C++23 compiler (gcc 13).

```sh
cd native/dataflou
npx --yes node-gyp@12 rebuild --target=$(node -p "require('electron/package.json').version") --dist-url=https://electronjs.org/headers --arch=x64
# macOS : --arch=arm64, then : codesign --force --sign - build/Release/dataflou.node
node -e "console.log(require('./build/Release/dataflou.node').version())"
```

Without the module the dataflou section says **MISSING** and everything else runs.

`node tools/dataflou-test/run.mjs` (from the repository) runs the node against itself in a
private universe; with a number, a soak of that many minutes after.
