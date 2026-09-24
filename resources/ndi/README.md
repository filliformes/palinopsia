# Bundled NDI runtime

Palinopsia's NDI output is built in: the sender calls the NDI runtime library
directly (no plugin, no OBS, no bridge). It looks for that library in this order:

1. **the copy bundled with the app**: whatever is in `resources/ndi/<os>/` when
   the app is built ends up in the packaged app's `resources/ndi/`,
2. the official NDI install (NDI Tools / NDI Runtime / NDI SDK),
3. the copies other creative apps carry (TouchDesigner, Resolume, vMix…).

A venue machine almost always has 2 or 3. Bundling makes the app work on a
machine with no NDI at all.

## Bundling it

Install the NDI SDK or NDI Tools from <https://ndi.video>, then:

```
node scripts/bundle-ndi-runtime.mjs
```

It copies the official library (and its licence file) into
`resources/ndi/win|mac|linux/`. These binaries are git-ignored: never commit
them. Only the official NDI distribution may be redistributed (NDI SDK licence),
which is why the script never takes a copy from another app.

Keep the bundled runtime current: re-run the script after updating NDI.

NDI® is a registered trademark of Vizrt NDI AB.
