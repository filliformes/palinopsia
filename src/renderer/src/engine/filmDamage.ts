// Film damage : dust, fibres and scratches, modelled on what
// real prints do (research : Ivanova et al., Eurographics 2023, 12k hand-labelled
// flaws on 4K scans; a film stock maker's handling notes; Joyeux et al. on scratch
// motion; the commercial film-damage plug-ins as the professional baseline). Runs after the
// Cameraless stage, whenever dust / scratch is up, Film Hold or not.
//
// What makes it read as film rather than as noise :
//   - a FILM CLOCK (24 fps, Super 8 18), separate from the draw clock : dust lives
//     exactly one film frame and lands somewhere new on the next; a drawing held
//     for three frames still passes three different dirty frames;
//   - sizes in frame heights, scaled by the gauge (the same particle covers ~4x
//     more of a Super 8 frame than of a 35 mm one), on a power law (mostly tiny,
//     rarely big; the big ones mottled clumps, not ink drops), irregular rotated
//     outlines, sharp (emulsion side) or soft (base side), and specks smaller
//     than a pixel fade instead of flickering, so 1080p and an 8K master match;
//   - print dirt shows dark (slightly warm), negative dirt prints as white
//     sparkle (slightly cool) : never pure 0 or 1;
//   - the count changes every frame (Gamma), clumps (a noise density map) and
//     comes in occasional bursts;
//   - scratches are objects with a lifetime, continuous along the strip : s =
//     frame + (1 - y) gives in one stroke the slight slant, the continuity from
//     frame to frame, the partial first/last frame and the slow sinusoidal
//     wander of a roller scratch; gaps, width and strength vary along them;
//   - dirt and scratches sit on the film, so they ride the Cameraless boil.
// The grid below only decides WHERE a particle spawns, never its shape.

export interface FilmDamageParams {
  dust: number // 0..1 : specks per film frame on a curve (0.15 ~1, 0.5 ~17, 1 ~80)
  scratch: number // 0..1 : how often a scratch starts (0.5 ~1.4 live at once, 1 ~5)
  gauge: number // 0 35 mm · 1 16 mm · 2 Super 8
  dirt: number // 0 print (dark) · 1 mixed · 2 negative (white sparkle)
}

/** The Cameraless boil this frame (offset in uv, rotation, scale); identity when off. */
export interface FilmWeave {
  x: number
  y: number
  rot: number
  scale: number
}

export const NO_WEAVE: FilmWeave = { x: 0, y: 0, rot: 0, scale: 1 }

const GAUGES = [
  { k: 1, fps: 24 }, // 35 mm : dust ~0.4 % of the frame height
  { k: 2.13, fps: 24 }, // 16 mm
  { k: 3.9, fps: 18 } // Super 8
]
// Share of specks / fibres that are white sparkle, per "dirt on".
const WHITE = [0.12, 0.4, 0.85]
// Scratch types (0 dark base-side print, 1 white from the negative, 2 colour-print
// emulsion : green → yellow → white, 3 negative emulsion printed : yellow → red →
// black), cumulative weights per "dirt on".
const SCRATCH_MIX = [
  [0.65, 0.8, 0.95],
  [0.45, 0.75, 0.9],
  [0.2, 0.75, 0.8]
]
const MAX_SCRATCH = 6
const MAX_FIBRES = 4

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

const FS = `#version 300 es
precision highp float; precision highp int;
in vec2 vUV; out vec4 frag;
uniform sampler2D uTex;
uniform vec2 uRes;          // output size (px)
uniform vec4 uWeave;        // Cameraless boil : offset xy (uv), rotation, scale
uniform float uGauge;       // size multiplier : 35 mm 1 · 16 mm 2.13 · Super 8 3.9
uniform float uWhite;       // share of specks that are white sparkle
uniform float uCount;       // expected specks this film frame
uniform uint uSaltF, uSaltC, uSaltMap; // per-film-frame salts
uniform int uFibN;
uniform vec4 uFib[${MAX_FIBRES * 2}];   // A.xy B.xy · C.xy width opacity(<0 = white)
uniform int uScrN;
uniform vec4 uScr[${MAX_SCRATCH * 3}];  // x0 amp freq phase · width type s0 s1 · drift depth seed strength

uint pcg(uint v){ uint s = v * 747796405u + 2891336453u; uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u; return (w >> 22u) ^ w; }
float hf(uint v){ return float(pcg(v)) * 2.3283064e-10; }
float rnd(inout uint h){ h = pcg(h); return float(h) * 2.3283064e-10; }
uint cellKey(ivec2 c, uint salt){ uvec2 u = uvec2(c + 32768); return pcg(u.x ^ pcg(u.y ^ salt)); }
float h2u(uvec2 k, uint seed){ return hf(pcg(k.x ^ seed) ^ k.y); }
float vn2(vec2 q, uint seed){
  vec2 i = floor(q), f = fract(q); f = f*f*(3.0-2.0*f);
  uvec2 k = uvec2(ivec2(i) + 4096);
  float a = h2u(k, seed), b = h2u(k + uvec2(1u,0u), seed), c = h2u(k + uvec2(0u,1u), seed), d = h2u(k + uvec2(1u,1u), seed);
  return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
}
float n1(float x, uint seed){ float i = floor(x); float f = x - i; f = f*f*(3.0-2.0*f); uint k = uint(int(i) + 65536); return mix(hf(pcg(k) ^ seed), hf(pcg(k + 1u) ^ seed), f); }
float dot2(vec2 v){ return dot(v, v); }
// Distance to a quadratic Bezier (the closed-form cubic solve).
float sdBez(vec2 pos, vec2 A, vec2 B, vec2 C){
  vec2 a = B - A; vec2 b = A - 2.0*B + C; vec2 c = a * 2.0; vec2 d = A - pos;
  float kk = 1.0 / max(dot(b, b), 1e-12);
  float kx = kk * dot(a, b);
  float ky = kk * (2.0*dot(a, a) + dot(d, b)) / 3.0;
  float kz = kk * dot(d, a);
  float res;
  float p = ky - kx*kx; float p3 = p*p*p;
  float q = kx*(2.0*kx*kx - 3.0*ky) + kz;
  float h = q*q + 4.0*p3;
  if (h >= 0.0) {
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0/3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    res = dot2(d + (c + b*t)*t);
  } else {
    float z = sqrt(-p);
    float v = acos(clamp(q / (p*z*2.0), -1.0, 1.0)) / 3.0;
    float m = cos(v); float n = sin(v) * 1.732050808;
    vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
    res = min(dot2(d + (c + b*t.x)*t.x), dot2(d + (c + b*t.y)*t.y));
  }
  return sqrt(res);
}

// One layer of specks (fine dust or coarse dirt). p = film position in frame
// heights, cell = spawn grid, pc = chance a cell holds a particle this frame.
// Radii follow a power law from rMin (exponent alpha) : mostly tiny, rarely big.
vec3 dustLayer(vec3 col, vec2 p, float cell, float pc, float rMin, float alpha, float rMax, bool coarse, uint salt, float px){
  ivec2 ci = ivec2(floor(p / cell));
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      ivec2 c = ci + ivec2(i, j);
      uint h = cellKey(c, salt);
      float u0 = float(h) * 2.3283064e-10;
      if (u0 >= pc * 1.65) continue;
      vec2 cc = (vec2(c) + 0.5) * cell;
      float m = mix(0.35, 1.65, smoothstep(0.2, 0.8, vn2(cc * 3.0, uSaltMap ^ salt))); // clumping, never bare
      if (u0 >= pc * m) continue;
      float ux = rnd(h);
      float uy = rnd(h);
      vec2 ctr = (vec2(c) + vec2(ux, uy)) * cell;
      float ua = max(rnd(h), 1e-4);
      float ub = max(rnd(h), 1e-4);
      float r = min(rMin * pow(ua, -1.0 / alpha), rMax);
      bool white = rnd(h) < uWhite;
      if (white) r *= 0.75;
      float el = 1.0 + 0.8 * pow(rnd(h), 3.0);
      float ang = rnd(h) * 6.2832;
      float rough = mix(0.12, 0.5, rnd(h));
      float ph2 = rnd(h) * 6.2832;
      float ph3 = rnd(h) * 6.2832;
      float ph5 = rnd(h) * 6.2832;
      bool grit = coarse && rnd(h) < 0.4;
      float blur = rnd(h) < 0.35 ? 0.0012 * uGauge * (0.3 + rnd(h)) : 0.0; // base side : out of focus
      float op = mix(0.5, 1.0, rnd(h));
      float ext = max(el * (1.0 + rough), grit ? 2.1 : 1.0);
      r = min(r, 0.9 * cell / ext); // stays inside the 3x3 neighbourhood
      float aa = max(px, 0.1 * r + blur);
      vec2 d = p - ctr;
      float reach = r * ext + 2.0 * aa;
      if (dot(d, d) > reach * reach) continue;
      float cs = cos(ang), sn = sin(ang);
      vec2 q = vec2(cs * d.x + sn * d.y, -sn * d.x + cs * d.y);
      q.x /= el;
      float th = atan(q.y, q.x);
      float wob = 1.0 + rough * (0.5 * cos(2.0 * th + ph2) + 0.33 * cos(3.0 * th + ph3) + 0.2 * cos(5.0 * th + ph5) + 0.12 * cos(7.0 * th + ph2 * 1.7));
      float sdf = (length(q) - r * wob) * sqrt(el);
      if (grit) {
        vec2 off = vec2(cos(ph3), sin(ph3)) * r * (0.9 + 0.5 * ub);
        sdf = min(sdf, length(d - off) - r * (0.35 + 0.3 * ua));
      }
      float cov = 1.0 - smoothstep(-aa, aa, sdf);
      float rp = 2.0 * r / px;
      cov *= min(1.0, rp * rp); // sub-pixel specks fade instead of flickering
      float a = cov * op * r / (r + blur);
      // Big pieces are clumps, not ink drops : uneven density inside.
      if (r > 3.0 * px) a *= mix(1.0, 0.4 + 0.6 * vn2(q / r * 2.5 + vec2(ph2, ph5) * 7.0, salt), smoothstep(3.0 * px, 14.0 * px, r));
      if (white) col = mix(col, vec3(0.93, 0.95, 0.97), a * 0.92);
      else col = mix(col, col * vec3(0.07, 0.06, 0.05), a);
    }
  }
  return col;
}

void main(){
  vec4 src = texture(uTex, vUV);
  vec3 col = src.rgb;
  float asp = uRes.x / uRes.y;
  float px = 1.0 / uRes.y;
  // Where this pixel's picture sits on the strip : the same mapping the Cameraless
  // boil samples with (rotation in square units), so dirt and scratches ride the weave.
  vec2 c0 = (vUV - 0.5) * vec2(asp, 1.0);
  float sr = sin(uWeave.z), cr = cos(uWeave.z);
  vec2 w = (mat2(cr, -sr, sr, cr) * (c0 / uWeave.w)) / vec2(asp, 1.0) + 0.5 + uWeave.xy;
  if (w.x >= 0.0 && w.x <= 1.0 && w.y >= 0.0 && w.y <= 1.0) {
    vec2 p = (w - 0.5) * vec2(asp, 1.0);
    float g = uGauge;
    if (uCount > 0.0) {
      float cF = 0.015 * g, cC = 0.06 * g;
      col = dustLayer(col, p, cF, 0.85 * uCount * cF * cF / asp, 0.0006 * g, 2.6, 0.006 * g, false, uSaltF, px);
      col = dustLayer(col, p, cC, 0.15 * uCount * cC * cC / asp, 0.0014 * g, 2.3, 0.008 * g, true, uSaltC, px);
    }
    for (int k = 0; k < ${MAX_FIBRES}; k++) {
      if (k >= uFibN) break;
      vec4 f0 = uFib[2*k], f1 = uFib[2*k+1];
      vec2 A = f0.xy, B = f0.zw, C = f1.xy;
      float wd = f1.z, op = f1.w;
      vec2 lo = min(min(A, B), C) - vec2(wd + 2.0*px), hi = max(max(A, B), C) + vec2(wd + 2.0*px);
      if (p.x < lo.x || p.y < lo.y || p.x > hi.x || p.y > hi.y) continue;
      float d = sdBez(p, A, B, C);
      float L = length(C - A);
      float tp = smoothstep(0.0, 0.2 * L, min(length(p - A), length(p - C))); // tapered ends
      // Lint is uneven : thicker and denser in places along its length.
      float var = vn2((p - A) / max(L, 1e-4) * 6.0, uSaltF + uint(k));
      float ww = wd * mix(0.3, 1.0, tp) * mix(0.55, 1.25, var);
      float cov = clamp((0.5*ww + 0.5*px - d) / px, 0.0, 1.0) * min(1.0, ww / px);
      float a = cov * abs(op) * mix(0.5, 1.0, var);
      col = op < 0.0 ? mix(col, vec3(0.93, 0.95, 0.97), a * 0.9) : mix(col, col * vec3(0.07, 0.06, 0.05), a);
    }
    // Scratches : s runs along the strip, in frames, relative to this frame.
    float s = 1.0 - w.y;
    for (int k = 0; k < ${MAX_SCRATCH}; k++) {
      if (k >= uScrN) break;
      vec4 a = uScr[3*k], b = uScr[3*k+1], cc = uScr[3*k+2];
      if (s < b.z || s > b.w) continue;
      float t = s - b.z;
      uint sd = uint(cc.z);
      // The path : straight within a frame, wandering over many. Width breathes
      // slowly; each edge is ragged on its own (a gouge, not a drawn line).
      float xs = a.x + a.y * sin(6.2832 * a.z * t + a.w) + cc.x * t;
      float wv = b.x * mix(0.6, 1.35, n1(t * 2.3, sd));
      float dx = p.x - xs;
      if (abs(dx) > wv * 2.5 + 2.0 * px) continue;
      float lo = -0.5 * wv + (n1(t * 150.0, sd + 7u) - 0.5) * 0.5 * wv;
      float hi = 0.5 * wv + (n1(t * 150.0, sd + 11u) - 0.5) * 0.5 * wv;
      float d = abs(dx - 0.5 * (lo + hi));
      float str = cc.w * mix(0.45, 1.0, n1(t * 1.3, sd + 3u)) * mix(0.65, 1.0, n1(t * 60.0, sd + 13u));
      float gap = smoothstep(0.2, 0.32, n1(t * 0.55, sd + 5u));
      float taper = smoothstep(0.0, 0.35, t) * smoothstep(0.0, 0.35, b.w - s);
      float cov = clamp(min(dx - lo, hi - dx) / px + 0.5, 0.0, 1.0) * min(1.0, max(hi - lo, 0.0) / px);
      float lobe = wv > px ? exp(-pow((d - 1.4 * wv) / (0.6 * wv), 2.0)) * 0.18 : 0.0; // faint fringe
      float amt = str * gap * taper;
      int ty = int(b.y + 0.5);
      float dp = cc.y * 3.0;
      if (ty == 0) { col = mix(col, col * 0.16, cov * amt); col = mix(col, min(col * 1.3, vec3(1.0)), lobe * amt); }
      else if (ty == 1) { col = mix(col, vec3(0.92, 0.94, 0.95), cov * amt * 0.9); col *= 1.0 - lobe * amt * 0.5; }
      else if (ty == 2) { vec3 lift = clamp(vec3(dp - 1.0, dp, dp - 2.0), 0.0, 1.0); col = mix(col, mix(col, vec3(0.95), lift), cov * amt); }
      else { vec3 drop = clamp(vec3(dp - 2.0, dp - 1.0, dp), 0.0, 1.0); col = mix(col, col * (1.0 - 0.92 * drop), cov * amt); }
    }
  }
  frag = vec4(col, src.a);
}`

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
const R = Math.random
const gauss = (): number => Math.sqrt(-2 * Math.log(1 - R())) * Math.cos(6.2832 * R())
const gamma = (k: number): number => {
  let s = 0
  for (let i = 0; i < k; i++) s -= Math.log(1 - R())
  return s
}
const poisson = (l: number): number => {
  const L = Math.exp(-l)
  let k = 0
  let p = 1
  do {
    k++
    p *= R()
  } while (p > L && k < 60)
  return k - 1
}
// Integer hash for the per-frame salts (murmur3 finalizer).
const hash32 = (x: number): number => {
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return (x ^ (x >>> 16)) >>> 0
}

interface Scratch {
  x0: number // across the frame, frame heights from centre
  amp: number // sideways wander
  freq: number // wander cycles per film frame
  ph: number
  w: number // width, frame heights
  type: number
  s0: number // start / end along the strip, in film frames
  s1: number
  drift: number // per film frame
  depth: number // emulsion scratches : how many dye layers it cuts
  seed: number
  str: number
}

export class FilmDamage {
  private prog: WebGLProgram
  private quad: WebGLBuffer
  private vao: WebGLVertexArrayObject
  private u: (n: string) => WebGLUniformLocation | null
  private out: { fbo: WebGLFramebuffer; tex: WebGLTexture } | null = null
  private w = 0
  private h = 0
  // Film clock.
  private filmT = 0
  private frame = 0
  private gaugeIdx = -1
  // Dust.
  private count = 0
  private burst = 0
  private burstMul = 1
  private burstFloor = 0 // dust floor while a TRIGGERED burst plays (0 for the random ones)
  private burstPending = false
  private fibN = 0
  private readonly fib = new Float32Array(MAX_FIBRES * 8)
  // Scratches.
  private scr: Scratch[] = []
  private lastScratch = 0
  private readonly scrBuf = new Float32Array(MAX_SCRATCH * 12)

  constructor(private gl: WebGL2RenderingContext) {
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error('[filmDamage] compile:', gl.getShaderInfoLog(s))
      return s
    }
    this.prog = gl.createProgram()!
    gl.attachShader(this.prog, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(this.prog, compile(gl.FRAGMENT_SHADER, FS))
    gl.bindAttribLocation(this.prog, 0, 'p')
    gl.linkProgram(this.prog)
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS))
      console.error('[filmDamage] link:', gl.getProgramInfoLog(this.prog))
    // Own VAO : the ISF runtime keeps its quads on the DEFAULT VAO's attribute 0,
    // which this stage must never touch (see the default-VAO landmine).
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.quad = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
    gl.bindVertexArray(null)
    const cache = new Map<string, WebGLUniformLocation | null>()
    this.u = (n) => {
      if (!cache.has(n)) cache.set(n, gl.getUniformLocation(this.prog, n))
      return cache.get(n)!
    }
  }

  private ensureTarget(w: number, h: number): void {
    if (this.out && this.w === w && this.h === h) return
    const gl = this.gl
    if (this.out) {
      gl.deleteFramebuffer(this.out.fbo)
      gl.deleteTexture(this.out.tex)
    }
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, w, h, 0, gl.RGBA, gl.HALF_FLOAT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.out = { fbo, tex }
    this.w = w
    this.h = h
  }

  private get asp(): number {
    return this.h > 0 ? this.w / this.h : 16 / 9
  }

  // ── Scratches ──────────────────────────────────────────────────────────
  private spawnScratch(p: FilmDamageParams, s0: number, age: number): void {
    if (this.scr.length >= MAX_SCRATCH) return
    const k = GAUGES[this.gaugeIdx].k
    const mix = SCRATCH_MIX[clamp(Math.round(p.dirt), 0, 2)]
    const r = R()
    const type = r < mix[0] ? 0 : r < mix[1] ? 1 : r < mix[2] ? 2 : 3
    // Log-normal lifetimes : dark base scratches ~3 s median (sometimes a minute),
    // the others shorter.
    const life = Math.max(3, (type === 0 ? 72 : 14) * Math.exp((type === 0 ? 1 : 0.8) * gauss()))
    const asp = this.asp
    const b: Scratch = {
      x0: (R() - 0.5) * asp * 0.9,
      amp: (0.0005 + 0.004 * R()) * asp,
      freq: 1 / (12 + 108 * R()),
      ph: R() * 6.2832,
      w: (0.0005 + 0.0035 * R() * R()) * k,
      type,
      s0: s0 - age,
      s1: s0 - age + life,
      drift: (R() - 0.5) * 0.0004,
      depth: 0.2 + 0.8 * R(),
      seed: Math.floor(R() * 60000),
      str: 0.5 + 0.5 * R()
    }
    this.scr.push(b)
    // Tramlines : 2-3 parallel scratches from the same roller, wandering together.
    if (R() < 0.15) {
      const n = R() < 0.5 ? 1 : 2
      let off = 0
      for (let i = 0; i < n && this.scr.length < MAX_SCRATCH; i++) {
        off += (0.003 + 0.017 * R()) * asp
        this.scr.push({ ...b, x0: b.x0 + off, seed: Math.floor(R() * 60000), w: b.w * (0.6 + 0.8 * R()), str: 0.5 + 0.5 * R() })
      }
    }
  }

  private scratchRate(p: FilmDamageParams): number {
    return 0.042 * Math.pow(clamp(p.scratch, 0, 1), 1.8)
  }

  /** Fill with the steady state, so turning scratches on shows them at once. */
  private prefillScratches(p: FilmDamageParams): void {
    this.scr = []
    if (p.scratch <= 0.001) return
    const n = poisson(this.scratchRate(p) * 119)
    for (let i = 0; i < n; i++) this.spawnScratch(p, this.frame + R(), R() * 100)
  }

  /** The filmBurst event : a dirty stretch of film reaches the gate on the next
   *  film frame. Plays even with dust at 0 (a clean print hits a dirty patch). */
  burstNow(): void {
    this.burstPending = true
  }

  /** A burst is pending or playing : the compositor keeps the stage running. */
  bursting(): boolean {
    return this.burstPending || this.burst > 0
  }

  // ── One film frame ─────────────────────────────────────────────────────
  private stepFrame(p: FilmDamageParams): void {
    const g = GAUGES[this.gaugeIdx]
    // Specks this frame : a Gamma-varied count, now and then a burst of dirt.
    if (this.burstPending) {
      this.burstPending = false
      this.burst = Math.round(g.fps * (0.6 + 0.9 * R()))
      this.burstMul = 4 + 4 * R()
      this.burstFloor = 0.3
    } else if (this.burst > 0) this.burst--
    else {
      this.burstMul = 1
      this.burstFloor = 0
      if (R() < 0.004 * clamp(p.dust, 0, 1)) {
        this.burst = Math.round(g.fps * (0.5 + 1.5 * R()))
        this.burstMul = 3 + 5 * R()
      }
    }
    const dust = Math.max(clamp(p.dust, 0, 1), this.burst > 0 ? this.burstFloor : 0)
    this.count = dust > 0.001 ? 80 * Math.pow(dust, 2.2) * (gamma(4) / 4) * (this.burst > 0 ? this.burstMul : 1) : 0
    // Fibres (lint) : thin curved strands, on the film for this one frame.
    this.fibN = this.count > 0 ? Math.min(MAX_FIBRES, poisson(this.count * 0.035)) : 0
    const asp = this.asp
    const white = WHITE[clamp(Math.round(p.dirt), 0, 2)]
    for (let i = 0; i < this.fibN; i++) {
      const cx = (R() - 0.5) * asp
      const cy = R() - 0.5
      const L = Math.min(0.3, 0.04 * g.k * (gamma(2) / 2) + 0.01)
      const a = R() * 6.2832
      const dx = Math.cos(a)
      const dy = Math.sin(a)
      const bend = (0.05 + 0.35 * R()) * L * (R() < 0.5 ? -1 : 1)
      const op = 0.25 + 0.4 * R()
      this.fib.set(
        [cx - (dx * L) / 2, cy - (dy * L) / 2, cx - dy * bend * 2, cy + dx * bend * 2,
          cx + (dx * L) / 2, cy + (dy * L) / 2, (0.0006 + 0.0012 * R()) * g.k, R() < white ? -op : op],
        i * 8
      )
    }
    // Scratches : retire the finished, maybe start one partway down this frame.
    this.scr = this.scr.filter((s) => s.s1 > this.frame)
    if (R() < this.scratchRate(p)) this.spawnScratch(p, this.frame + R(), 0)
  }

  /** Run the stage over `srcTex`; returns the damaged texture. */
  apply(srcTex: WebGLTexture, dt: number, p: FilmDamageParams, weave: FilmWeave, w: number, h: number): WebGLTexture {
    this.ensureTarget(w, h)
    const gi = clamp(Math.round(p.gauge), 0, 2)
    const fps = GAUGES[gi].fps
    if (gi !== this.gaugeIdx) {
      // Keep the frame count continuous across a gauge (fps) change.
      if (this.gaugeIdx >= 0) this.filmT = this.frame / fps
      this.gaugeIdx = gi
      this.prefillScratches(p)
    }
    if (p.scratch <= 0.001) this.scr = []
    else if (this.lastScratch <= 0.001) this.prefillScratches(p)
    this.lastScratch = p.scratch
    this.filmT += dt
    const f = Math.floor(this.filmT * fps)
    let n = 0
    while (this.frame < f && n < 4) {
      this.frame++
      this.stepFrame(p)
      n++
    }
    this.frame = Math.max(this.frame, f)

    const gl = this.gl
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.out!.fbo)
    gl.viewport(0, 0, w, h)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, srcTex)
    gl.uniform1i(this.u('uTex'), 0)
    gl.uniform2f(this.u('uRes'), w, h)
    gl.uniform4f(this.u('uWeave'), weave.x, weave.y, weave.rot, weave.scale || 1)
    gl.uniform1f(this.u('uGauge'), GAUGES[gi].k)
    gl.uniform1f(this.u('uWhite'), WHITE[clamp(Math.round(p.dirt), 0, 2)])
    gl.uniform1f(this.u('uCount'), this.count)
    const fr = this.frame >>> 0
    gl.uniform1ui(this.u('uSaltF'), hash32(fr * 2 + 1))
    gl.uniform1ui(this.u('uSaltC'), hash32(fr * 2 + 2))
    gl.uniform1ui(this.u('uSaltMap'), hash32(fr ^ 0x9e3779b9))
    gl.uniform1i(this.u('uFibN'), this.fibN)
    gl.uniform4fv(this.u('uFib'), this.fib)
    // Scratch positions along the strip go relative to this frame (small floats).
    for (let i = 0; i < MAX_SCRATCH; i++) {
      const o = i * 12
      const s = this.scr[i]
      if (!s) {
        this.scrBuf.fill(0, o, o + 12)
        continue
      }
      this.scrBuf.set(
        [s.x0, s.amp, s.freq, s.ph, s.w, s.type, s.s0 - this.frame, s.s1 - this.frame,
          s.drift, s.depth, s.seed, s.str],
        o
      )
    }
    gl.uniform4fv(this.u('uScr'), this.scrBuf)
    gl.uniform1i(this.u('uScrN'), Math.min(MAX_SCRATCH, this.scr.length))
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindVertexArray(null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    return this.out!.tex
  }

  dispose(): void {
    const gl = this.gl
    gl.deleteProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.deleteBuffer(this.quad)
    gl.bindVertexArray(null)
    gl.deleteVertexArray(this.vao)
    if (this.out) {
      gl.deleteFramebuffer(this.out.fbo)
      gl.deleteTexture(this.out.tex)
    }
    this.out = null
  }
}
