// The GL generation : bumped whenever a WebGL context of this window is lost.
//
// A GPU reset hands back the SAME context object with every program, texture,
// buffer and vertex array in it dead. A cache keyed by the context (a WeakMap)
// therefore kept serving dead objects to the rebuilt engine ("object does not
// belong to this context"), and shaders failed to load until a restart. Every
// such cache stores the generation it was built in and rebuilds when it moved.
// A number compare, where gl.isProgram is a blocking round trip to the GPU.

let generation = 0

export function glGeneration(): number {
  return generation
}

/** Call from every `webglcontextlost` handler of this window. */
export function bumpGlGeneration(): void {
  generation++
}
