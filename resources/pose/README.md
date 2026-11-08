# resources/pose : the Room tracker

The Body page's **Room** tracker finds every person in the camera's frame (near or
far, facing the camera or not) with RTMO-s, a one-stage multi-person pose model
(OpenMMLab MMPose, Apache-2.0), run by onnxruntime-web on the graphics card
(WebGPU). It ships inside the app, so it works offline and in an installation :
the renderer loads it from here over `opsia-asset://pose/` (`src/main/assets.ts`),
never from the network.

The files are not in git (about 63 MB). Fetch them once, before running from
source or building :

```bash
npm run fetch:pose            # download what is missing, verify everything
npm run fetch:pose -- --check # verify only
```

`scripts/fetch-pose.mjs` pins every file (onnxruntime-web 1.30.0, the RTMO-s ONNX
export OpenMMLab publishes), downloads only from cdn.jsdelivr.net,
download.openmmlab.com and raw.githubusercontent.com, checks each file's SHA-256
and writes `manifest.json` last. Without the manifest the Body page says the Room
tracker is missing.
