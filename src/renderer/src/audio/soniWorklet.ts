// The Sonify AudioWorklet's URL. The processor itself lives in
// soni.worklet.js (plain JS) and is imported as a Vite asset URL, which works
// identically in dev (served module) and in the packaged build (emitted
// asset) — no blob indirection, no bundler config.

import workletUrl from './soni.worklet.js?url'

export const SONI_WORKLET_URL = workletUrl
