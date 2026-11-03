// The Sonify AudioWorklet's URL. The processor itself lives in
// soni.worklet.js (plain JS) and is imported as a Vite asset URL, which works
// identically in dev (served module) and in the packaged build (emitted
// asset) — no blob indirection, no bundler config.
//
// The Synth's sound engine (synth.engine.js) is a module of its own, added to
// the same worklet scope FIRST : it hands itself over as globalThis.OpsiaSynth,
// which the soni processor builds (every module added to one AudioContext's
// worklet shares one global scope).

import workletUrl from './soni.worklet.js?url'
import synthEngineUrl from './synth.engine.js?url'

export const SONI_WORKLET_URL = workletUrl
export const SYNTH_ENGINE_URL = synthEngineUrl
