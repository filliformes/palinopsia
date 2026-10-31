# resources/depth : the AI depth engine

**depth: AI** (the Performance tab, at the head of its picture section) reads depth
from the picture with Depth Anything V2 Small, run by Transformers.js and its
WebAssembly / WebGPU runtime (onnxruntime-web). All of it ships inside the app, so depth works offline and in
an installation : the renderer loads it from here over `opsia-asset://depth/`
(`src/main/assets.ts`), never from the network.

The files are not in git (about 95 MB). Fetch them once, before running from
source or building :

```bash
npm run fetch:depth            # download what is missing, verify everything
npm run fetch:depth -- --check # verify only
```

`scripts/fetch-depth.mjs` pins every file (Transformers.js 3.0.2,
onnxruntime-web 1.21.0-dev.20241024-d9ca84ef96, the model at a fixed revision),
downloads only from cdn.jsdelivr.net and huggingface.co, checks each file's
SHA-256 and writes `manifest.json` last. Without the manifest the app says
"run npm run fetch:depth". CI runs it before every build, and electron-builder
copies the verified files into the app's resources.

Licenses : Transformers.js and Depth Anything V2 Small are Apache-2.0,
onnxruntime-web is MIT (see `licenses/` once fetched and THIRD_PARTY_NOTICES.md).
