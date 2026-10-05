// Strobe-safety limiter (Flash safety) : a photosensitive-safety net on the FINAL
// presented frame (after the finalizer, Cameraless, film damage, xfade and freeze).
//
// It follows the common flash-safety guidance (WCAG 2.2 "three flashes or below
// threshold", ITU-R BT.1702) :
//   - a flash is a pair of opposing changes of 10 % or more in RELATIVE LUMINANCE
//     (linear light, the darker state below 0.8), or in the saturated-red measure
//     (R-G-B where R/(R+G+B) >= 0.8);
//   - it only matters over an area of roughly a ninth of the screen or more;
//   - more than three flashes in any one second is the hazard.
//
// So, all on the GPU (no readback stall) :
//   1) MEASURE : every pixel is decoded to linear light (Rec.709 luminance + the red
//      measure) and box-reduced to a 6x6 grid of cells. Every pixel counts exactly
//      once, so moving stripes or grain can't alias into fake swings.
//   2) DETECT : each window of 2x2 cells (a third of the frame each way, sliding by
//      one cell) counts the opposing swings of the SOURCE over the last second : a
//      window of transition ages advanced by the real frame time, so 60, 120 and
//      144 Hz behave alike (the old cap was per frame).
//   3) LIMIT : only when a window reaches the count does it engage. Its cells then
//      show a blend of the previous shown frame and the live one (in linear light)
//      that holds each cell's brightness inside a narrow band that drifts slowly
//      after the content, so further swings stay under the threshold : the strobe
//      survives as a gentle pulse. It releases as soon as the source stops flashing
//      (the window empties).
// Everything else (cuts, pans, stripes, grain, video, a strobe that has only just
// started) passes through untouched, bit for bit. Strength trades how many swings
// pass before it engages and how narrow the band is.

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const G = 6 // measurement grid (cells per side); windows are 2x2 cells

// Linear-light measures of one pixel : r = relative luminance, g = saturated red.
const MEASURE_FNS = `
vec3 toLin(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec2 measure(vec3 c){
  vec3 l = toLin(c);
  float lum = dot(l, vec3(0.2126, 0.7152, 0.0722));
  float s = l.r + l.g + l.b;
  float red = (s > 1e-4 && l.r >= 0.8 * s) ? max(l.r - l.g - l.b, 0.0) : 0.0;
  return vec2(lum, red);
}`

// Level 0 : exact 4x4 box of the frame, per pixel (texelFetch : no filtering, so
// the average is exact whatever the stripes or their phase).
const F_L0 = `#version 300 es
precision highp float; out vec4 frag;
uniform sampler2D uTex; uniform ivec2 uSize;
${MEASURE_FNS}
void main(){
  ivec2 b = ivec2(gl_FragCoord.xy) * 4;
  vec2 acc = vec2(0.0);
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) {
    ivec2 q = min(b + ivec2(x, y), uSize - 1);
    acc += measure(texelFetch(uTex, q, 0).rgb);
  }
  frag = vec4(acc / 16.0, 0.0, 1.0);
}`

// Further levels : a 4x4 box from four bilinear taps on texel corners (the data
// is already linear, so averaging is exact).
const F_DOWN = `#version 300 es
precision highp float; out vec4 frag;
uniform sampler2D uTex; uniform vec2 uSrcSize;
void main(){
  vec2 b = floor(gl_FragCoord.xy) * 4.0;
  vec4 acc = texture(uTex, (b + vec2(1.0, 1.0)) / uSrcSize) + texture(uTex, (b + vec2(3.0, 1.0)) / uSrcSize)
           + texture(uTex, (b + vec2(1.0, 3.0)) / uSrcSize) + texture(uTex, (b + vec2(3.0, 3.0)) / uSrcSize);
  frag = acc * 0.25;
}`

// The G x G cells : average the last level over each cell (8x8 taps; the level is
// already heavily averaged, so the fixed pattern adds no motion aliasing).
const F_CELLS = `#version 300 es
precision highp float; out vec4 frag;
uniform sampler2D uTex;
void main(){
  vec2 c = floor(gl_FragCoord.xy);
  vec2 acc = vec2(0.0);
  for (int y = 0; y < 8; y++) for (int x = 0; x < 8; x++) {
    vec2 uv = (c + (vec2(float(x), float(y)) + 0.5) / 8.0) / ${G}.0;
    acc += texture(uTex, uv).rg;
  }
  frag = vec4(acc / 64.0, 0.0, 1.0);
}`

// State update (G x G texels, 4 targets) :
//   S0 cell   : D lum, C lum, D red, C red   (D = shown level, C = band center)
//   S1 window : E lum, P lum, E red, P red   (last extreme and the one before)
//   S2 window : ages 0..3 of the last transitions (seconds)
//   S3        : age 4, age 5 (window), cell alpha, window engaged
// Window (i, j) covers cells i..i+1, j..j+1 and lives in texel (i, j).
const F_STATE = `#version 300 es
precision highp float;
layout(location = 0) out vec4 o0;
layout(location = 1) out vec4 o1;
layout(location = 2) out vec4 o2;
layout(location = 3) out vec4 o3;
uniform sampler2D uCells, uS0, uS1, uS2, uS3;
uniform float uDt, uTh, uThR, uBand, uBandR, uRate, uSeed; uniform int uK;
const int G = ${G};

vec2 winMeas(ivec2 w){
  return 0.25 * (texelFetch(uCells, w, 0).rg + texelFetch(uCells, w + ivec2(1, 0), 0).rg
               + texelFetch(uCells, w + ivec2(0, 1), 0).rg + texelFetch(uCells, w + ivec2(1, 1), 0).rg);
}
// One detector : extreme E, previous extreme P (direction = sign(E - P)). A swing of
// th against the direction is a transition; returns 1 when it counts.
float detect(inout float E, inout float P, float L, float th, bool lumRule){
  float dir = E > P + 1e-5 ? 1.0 : (E < P - 1e-5 ? -1.0 : 0.0);
  bool flip = false;
  if (dir > 0.0) { if (L > E) E = L; else if (L < E - th) flip = true; }
  else if (dir < 0.0) { if (L < E) E = L; else if (L > E + th) flip = true; }
  else if (abs(L - E) >= th) flip = true;
  if (!flip) return 0.0;
  float counts = (!lumRule || min(E, L) < 0.8) ? 1.0 : 0.0; // two bright states don't flash
  P = E; E = L;
  return counts;
}
// Advance window w; returns engaged, and its new state through the outs.
bool windowStep(ivec2 w, out vec4 s1, out vec4 s2, out vec2 s3){
  vec2 m = winMeas(w);
  s1 = texelFetch(uS1, w, 0);
  s2 = texelFetch(uS2, w, 0);
  s3 = texelFetch(uS3, w, 0).xy;
  if (uSeed > 0.5) { s1 = vec4(m.x, m.x, m.y, m.y); s2 = vec4(9.0); s3 = vec2(9.0); return false; }
  float E = s1.x, P = s1.y, Er = s1.z, Pr = s1.w;
  float t = max(detect(E, P, m.x, uTh, true), detect(Er, Pr, m.y, uThR, false));
  s1 = vec4(E, P, Er, Pr);
  s2 = min(s2 + uDt, vec4(9.0));
  s3 = min(s3 + uDt, vec2(9.0));
  if (t > 0.5) { s3 = vec2(s2.w, s3.x); s2 = vec4(0.0, s2.xyz); }
  float n = dot(step(s2, vec4(0.9999)), vec4(1.0)) + dot(step(s3, vec2(0.9999)), vec2(1.0));
  return n >= float(uK) - 0.5;
}

void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 w1 = vec4(0.0), w2 = vec4(9.0); vec2 w3 = vec2(9.0);
  bool ownEng = false;
  bool eng = false;
  for (int dy = -1; dy <= 0; dy++) for (int dx = -1; dx <= 0; dx++) {
    ivec2 w = c + ivec2(dx, dy);
    if (w.x < 0 || w.y < 0 || w.x > G - 2 || w.y > G - 2) continue;
    vec4 a1, a2; vec2 a3;
    bool e = windowStep(w, a1, a2, a3);
    eng = eng || e;
    if (dx == 0 && dy == 0) { w1 = a1; w2 = a2; w3 = a3; ownEng = e; }
  }
  vec2 L = texelFetch(uCells, c, 0).rg;
  vec4 s0 = texelFetch(uS0, c, 0);
  float alpha = 1.0;
  if (uSeed > 0.5 || !eng) {
    s0 = vec4(L.x, L.x, L.y, L.y); // free : show the live level, the band sits on it
  } else {
    float D = s0.x, C = s0.y, Dr = s0.z, Cr = s0.w;
    float st = uRate * uDt;
    C += clamp(L.x - C, -st, st);
    Cr += clamp(L.y - Cr, -st, st);
    float tl = clamp(L.x, C - uBand, C + uBand);
    float tr = clamp(L.y, Cr - uBandR, Cr + uBandR);
    float al = abs(L.x - D) < 1e-5 ? 1.0 : clamp((tl - D) / (L.x - D), 0.0, 1.0);
    float ar = abs(L.y - Dr) < 1e-5 ? 1.0 : clamp((tr - Dr) / (L.y - Dr), 0.0, 1.0);
    alpha = min(al, ar);
    s0 = vec4(mix(D, L.x, alpha), C, mix(Dr, L.y, alpha), Cr);
  }
  o0 = s0;
  o1 = w1;
  o2 = w2;
  o3 = vec4(w3, alpha, ownEng ? 1.0 : 0.0);
}`

// Output : each pixel takes the lowest alpha of the engaged cells around it. An
// engaged cell is limited all over (the safety guarantee); outside it the hold
// fades over most of a cell on a smootherstep curve, so a held region reads as a
// soft patch breathing with the content rather than a grid of hard-edged blocks
// (it used to fade over a quarter cell, and fast moves showed the 6x6 grid).
// Neighbours get partly held : more limiting, never less. Alpha 1 = the live frame.
const F_LIMIT = `#version 300 es
precision highp float; in vec2 vUV; out vec4 frag;
uniform sampler2D uSrc, uSafe, uS3;
const int G = ${G};
const float FEATHER = 0.9; // in cells : the 3x3 neighbourhood below reaches 1 cell
vec3 toLin(vec3 c){ c = clamp(c, 0.0, 1.0); return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 toSrgb(vec3 l){ l = clamp(l, 0.0, 1.0); return mix(l * 12.92, 1.055 * pow(l, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, l)); }
void main(){
  vec4 src = texture(uSrc, vUV);
  vec2 g = vUV * float(G);
  ivec2 ci = ivec2(floor(g));
  float a = 1.0;
  for (int dy = -1; dy <= 1; dy++) for (int dx = -1; dx <= 1; dx++) {
    ivec2 cc = ci + ivec2(dx, dy);
    if (cc.x < 0 || cc.y < 0 || cc.x >= G || cc.y >= G) continue;
    float ac = texelFetch(uS3, cc, 0).z;
    if (ac >= 0.9999) continue;
    vec2 d = max(max(vec2(cc) - g, g - vec2(cc + 1)), 0.0);
    float f = clamp(length(d) / FEATHER, 0.0, 1.0);
    a = min(a, mix(ac, 1.0, f * f * f * (f * (f * 6.0 - 15.0) + 10.0)));
  }
  if (a >= 0.9999) { frag = src; return; }
  vec4 safe = texture(uSafe, vUV);
  frag = vec4(toSrgb(mix(toLin(safe.rgb), toLin(src.rgb), a)), mix(safe.a, src.a, a));
}`

const F_COPY = `#version 300 es
precision highp float; in vec2 vUV; out vec4 frag; uniform sampler2D uTex;
void main(){ frag = texture(uTex, vUV); }`

type Prog = { prog: WebGLProgram; u: (n: string) => WebGLUniformLocation | null }
type Target = { fbo: WebGLFramebuffer; tex: WebGLTexture; w: number; h: number }
type StateSet = { fbo: WebGLFramebuffer; tex: WebGLTexture[] }

export class StrobeLimiter {
  private quad: WebGLBuffer
  private vao: WebGLVertexArrayObject
  private l0: Prog
  private down: Prog
  private cells: Prog
  private state: Prog
  private limit: Prog
  private copy: Prog
  private safe: [Target, Target] | null = null
  private levels: Target[] = []
  private cellT: Target | null = null
  private states: [StateSet, StateSet] | null = null
  private w = 0
  private h = 0
  private cur = 0
  private seeded = false

  constructor(private gl: WebGL2RenderingContext) {
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    // Own VAO : the ISF runtime owns attribute 0 of the DEFAULT VAO (every ISF
    // draw reads whatever quad is wired there), so this stage never touches it.
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    this.l0 = this.build(F_L0)
    this.down = this.build(F_DOWN)
    this.cells = this.build(F_CELLS)
    this.state = this.build(F_STATE)
    this.limit = this.build(F_LIMIT)
    this.copy = this.build(F_COPY)
  }

  private build(fs: string): Prog {
    const gl = this.gl
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src); gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error('[strobe] compile:', gl.getShaderInfoLog(s))
      return s
    }
    const prog = gl.createProgram()!
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(prog, 0, 'p')
    gl.linkProgram(prog)
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) console.error('[strobe] link:', gl.getProgramInfoLog(prog))
    const cache = new Map<string, WebGLUniformLocation | null>()
    return { prog, u: (n) => { if (!cache.has(n)) cache.set(n, gl.getUniformLocation(prog, n)); return cache.get(n)! } }
  }

  private mkTex(w: number, h: number, linear: boolean): WebGLTexture {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    const f = linear ? gl.LINEAR : gl.NEAREST
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    return tex
  }

  private mkTarget(w: number, h: number, linear = true): Target {
    const gl = this.gl
    const tex = this.mkTex(w, h, linear)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    return { fbo, tex, w, h }
  }

  private mkStateSet(): StateSet {
    const gl = this.gl
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    const tex: WebGLTexture[] = []
    for (let i = 0; i < 4; i++) {
      const t = this.mkTex(G, G, false)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0)
      tex.push(t)
    }
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1, gl.COLOR_ATTACHMENT2, gl.COLOR_ATTACHMENT3])
    return { fbo, tex }
  }

  private free(t: Target | null): void {
    if (!t) return
    this.gl.deleteFramebuffer(t.fbo); this.gl.deleteTexture(t.tex)
  }
  private freeState(s: StateSet): void {
    this.gl.deleteFramebuffer(s.fbo)
    for (const t of s.tex) this.gl.deleteTexture(t)
  }
  private freeAll(): void {
    if (this.safe) { this.free(this.safe[0]); this.free(this.safe[1]); this.safe = null }
    for (const l of this.levels) this.free(l)
    this.levels = []
    this.free(this.cellT); this.cellT = null
    if (this.states) { this.freeState(this.states[0]); this.freeState(this.states[1]); this.states = null }
  }

  private ensure(w: number, h: number): void {
    if (this.safe && this.w === w && this.h === h) return
    this.freeAll()
    this.safe = [this.mkTarget(w, h), this.mkTarget(w, h)]
    // The reduction pyramid : /4 per level until it is small.
    let lw = Math.ceil(w / 4), lh = Math.ceil(h / 4)
    this.levels.push(this.mkTarget(lw, lh))
    while (Math.max(lw, lh) > 32) {
      lw = Math.ceil(lw / 4); lh = Math.ceil(lh / 4)
      this.levels.push(this.mkTarget(lw, lh))
    }
    this.cellT = this.mkTarget(G, G, false)
    this.states = [this.mkStateSet(), this.mkStateSet()]
    this.w = w; this.h = h; this.cur = 0; this.seeded = false
  }

  /** Forget the history (the stage was off) : the next frame re-seeds. */
  reset(): void {
    this.seeded = false
  }

  private use(p: Prog): void {
    const gl = this.gl
    gl.useProgram(p.prog)
    gl.bindVertexArray(this.vao)
  }
  private draw(fbo: WebGLFramebuffer, w: number, h: number): void {
    const gl = this.gl
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); gl.drawArrays(gl.TRIANGLES, 0, 3)
  }
  private bind(unit: number, tex: WebGLTexture): void {
    const gl = this.gl
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex)
  }

  /** Limit flashes in `srcTex`. `strength` 0..1 (the Flash-safety slider), `dt` the
   *  real frame time in seconds. Returns the texture to present. */
  apply(srcTex: WebGLTexture, strength: number, dt: number, w: number, h: number): WebGLTexture {
    const gl = this.gl
    this.ensure(w, h)
    const safe = this.safe!, states = this.states!, cellT = this.cellT!
    const s = Math.max(0, Math.min(1, strength))

    // 1) measure : linear luminance + saturated red, box-reduced to G x G cells.
    this.use(this.l0)
    this.bind(0, srcTex); gl.uniform1i(this.l0.u('uTex'), 0)
    gl.uniform2i(this.l0.u('uSize'), w, h)
    this.draw(this.levels[0].fbo, this.levels[0].w, this.levels[0].h)
    this.use(this.down)
    gl.uniform1i(this.down.u('uTex'), 0)
    for (let i = 1; i < this.levels.length; i++) {
      const src = this.levels[i - 1], dst = this.levels[i]
      this.bind(0, src.tex)
      gl.uniform2f(this.down.u('uSrcSize'), src.w, src.h)
      this.draw(dst.fbo, dst.w, dst.h)
    }
    this.use(this.cells)
    this.bind(0, this.levels[this.levels.length - 1].tex); gl.uniform1i(this.cells.u('uTex'), 0)
    this.draw(cellT.fbo, G, G)

    // 2) detect + decide, per window and per cell (strength sets how many swings
    //    pass per second and how narrow the band is once engaged).
    const seed = !this.seeded
    const read = states[1 - this.cur], write = states[this.cur]
    this.use(this.state)
    this.bind(0, cellT.tex); gl.uniform1i(this.state.u('uCells'), 0)
    for (let i = 0; i < 4; i++) {
      this.bind(1 + i, read.tex[i])
      gl.uniform1i(this.state.u('uS' + i), 1 + i)
    }
    gl.uniform1f(this.state.u('uDt'), Math.max(0, Math.min(0.25, dt)))
    gl.uniform1i(this.state.u('uK'), Math.max(2, Math.min(6, Math.round(6 - 4 * s))))
    gl.uniform1f(this.state.u('uTh'), 0.1 - 0.03 * s)
    gl.uniform1f(this.state.u('uThR'), 0.0625 - 0.02 * s)
    gl.uniform1f(this.state.u('uBand'), 0.04 - 0.025 * s)
    gl.uniform1f(this.state.u('uBandR'), (0.04 - 0.025 * s) * 0.6)
    gl.uniform1f(this.state.u('uRate'), 0.3 - 0.2 * s)
    gl.uniform1f(this.state.u('uSeed'), seed ? 1 : 0)
    this.draw(write.fbo, G, G)

    const safeRead = safe[1 - this.cur], safeWrite = safe[this.cur]
    if (seed) {
      // Seed both shown frames with the live one.
      this.use(this.copy)
      this.bind(0, srcTex); gl.uniform1i(this.copy.u('uTex'), 0)
      this.draw(safe[0].fbo, w, h); this.draw(safe[1].fbo, w, h)
      this.seeded = true
      this.cur = 1 - this.cur
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.bindVertexArray(null)
      return srcTex
    }

    // 3) the shown frame : live where free, held toward the last shown frame where engaged.
    this.use(this.limit)
    this.bind(0, srcTex); gl.uniform1i(this.limit.u('uSrc'), 0)
    this.bind(1, safeRead.tex); gl.uniform1i(this.limit.u('uSafe'), 1)
    this.bind(2, write.tex[3]); gl.uniform1i(this.limit.u('uS3'), 2)
    this.draw(safeWrite.fbo, w, h)

    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindVertexArray(null)
    this.cur = 1 - this.cur
    return safeWrite.tex
  }

  /** Test hook : how many windows are engaged right now (reads back a tiny
   *  texture; not for the render loop). */
  debugEngaged(): { windows: number; minAlpha: number } {
    const gl = this.gl
    if (!this.states) return { windows: 0, minAlpha: 1 }
    const set = this.states[1 - this.cur] // the one written last
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, set.fbo)
    gl.readBuffer(gl.COLOR_ATTACHMENT3)
    const px = new Float32Array(G * G * 4)
    gl.readPixels(0, 0, G, G, gl.RGBA, gl.FLOAT, px)
    gl.readBuffer(gl.COLOR_ATTACHMENT0)
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null)
    let windows = 0, minAlpha = 1
    for (let i = 0; i < G * G; i++) { windows += px[i * 4 + 3] > 0.5 ? 1 : 0; minAlpha = Math.min(minAlpha, px[i * 4 + 2]) }
    return { windows, minAlpha }
  }

  dispose(): void {
    const gl = this.gl
    for (const p of [this.l0, this.down, this.cells, this.state, this.limit, this.copy]) gl.deleteProgram(p.prog)
    gl.deleteVertexArray(this.vao)
    gl.deleteBuffer(this.quad)
    this.freeAll()
  }
}
