// ReliefSource : the native Relief generator (id 'gen-relief'). A drawing in materials
// with real volume : every stroke has height, strokes fuse into each other, stack on top,
// press into what is there or cut it away, and when the light turns the whole drawing is
// lit again. The lit drawing is what moves : a still height map, relit every frame.
//
// A stroke is stamped once, capsule by capsule, into a stroke buffer (the highest height
// wins, by the depth test, so a stroke can cross itself without building up); while
// strokes are running that buffer is combined over the settled height map each frame, by
// the drawing mode, and when they end it is baked in. So the cost does not grow with what
// has been drawn : one combine, one shading pass.
//
// It draws itself as well as being drawn : wandering strokes, a compass's constructions,
// the moving things in another layer (the Synth's finder, its own instance), the outlines
// of another layer, the sound's hits. It lives : the light goes round, strokes sink and
// melt. And another layer can get into the material : its color, its reflection in the
// metal, or seen through the relief as through glass.

import { EngineGL, FS_HEAD, VS, SlotClock, Edge, num, col, type Prog, type Target } from './organicGL'
import type { NativeGenerator, SourcePointer } from './nativeGenerators'
import type { HandGestureLog } from '@shared/types'
import { audioBus } from './audioIn'
import { domeFill } from './domeSignal'
import { liveLight } from '../lightPath'
import { GridReadback } from './gridReadback'
import { RELIEF_SHADE } from './reliefShade'
import { SynthPlayer, defaultSynth } from '../audio/synthPlay'

const STEP = 1 / 60
const MAX_SEGS = 6000 // stamped capsules a frame (the mirrors multiply them)
// Pixels the fine steps along a stroke may stamp in a frame. Normal drawing stays far under it;
// huge strokes with a 32-way mirror on the dome fall back to coarser steps instead of falling behind.
const FINE_FILL = 60e6
const STRIDE = 10
const HMAX = 0.3 // tallest height, frame heights (for the depth test)

// brush : the stroke's profile (stamp) and its material (shade : see reliefShade.ts)
export const RELIEF_BRUSHES = ['plasticine', 'molten', 'carved', 'chips', 'drops', 'ribbed', 'ink', 'film']

// ── The stamp : one capsule (a segment with a radius at each end) ──────────────
const STAMP_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec4 iAB;
layout(location = 1) in vec4 iR;
layout(location = 2) in vec2 iS;
uniform vec2 uFrame;
out vec2 vP;
flat out vec4 vAB;
flat out vec4 vR;
flat out vec2 vS;
void main() {
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  float R = max(iR.x, iR.y) * 1.35 + 0.002;
  vec2 ba = iAB.zw - iAB.xy;
  float L = length(ba);
  vec2 dx = L > 1e-5 ? ba / L : vec2(1.0, 0.0);
  vec2 dy = vec2(-dx.y, dx.x);
  vec2 P = (iAB.xy + iAB.zw) * 0.5 + dx * c.x * (L * 0.5 + R) + dy * c.y * R;
  vP = P;
  vAB = iAB;
  vR = iR;
  vS = iS;
  gl_Position = vec4(P / uFrame * 2.0, 0.0, 1.0);
}`

const STAMP_FS = `${FS_HEAD}
uniform float uConvex, uRough, uRibs, uDash, uBroken, uPx;
in vec2 vP;
flat in vec4 vAB;
flat in vec4 vR;
flat in vec2 vS;
out vec4 o;
void main() {
  vec2 a = vAB.xy, ba = vAB.zw - a, pa = vP - a;
  float ll = dot(ba, ba);
  float t = ll > 0.0 ? clamp(dot(pa, ba) / ll, 0.0, 1.0) : 0.0;
  vec2 rel = pa - ba * t;
  float r = mix(vR.x, vR.y, t);
  if (r <= 0.0) discard;
  float along = mix(vR.z, vR.w, t);
  float mat = floor(vS.y / 16.0), color = vS.y - mat * 16.0;
  // a rough edge : the stroke's boundary eaten by noise along its own length
  float seed = vS.x;
  float wob = uRough > 0.0 ? (og_fbm(vP * 40.0 + seed * 3.1, 2.0) - 0.5) * uRough * 0.75 : 0.0;
  float d0 = length(rel) / r;
  // (only at the very edge : on the body, a mirror would show every bite)
  float d = d0 + wob * smoothstep(0.72, 0.98, d0);
  if (d >= 1.0) discard;
  // the signed place across the stroke, -1..1 (ribs follow the line through every bend)
  vec2 tn = ll > 0.0 ? ba / sqrt(ll) : vec2(1.0, 0.0);
  float across = dot(rel, vec2(-tn.y, tn.x)) / r;
  float aa = smoothstep(1.0, 1.0 - min(0.5, 1.6 * uPx / r), d);
  float ex = mix(0.18, 0.75, uConvex);
  float dome = pow(max(0.0, 1.0 - d * d), ex);
  float h;
  if (mat < 0.5) h = dome;                                  // plasticine : soft and full
  else if (mat < 1.5) h = pow(max(0.0, 1.0 - d * d), ex * 0.8);  // molten : a full liquid body
  else if (mat < 2.5) h = (1.0 - 0.6 * d - 0.4 * d * d) * (0.22 + 0.42 * uConvex); // carved : two bellied facets, a sharp spine
  else if (mat < 3.5) h = pow(max(0.0, 1.0 - d * d), 0.22); // chips : a molded plateau
  else if (mat < 4.5) h = dome;                             // drops
  else if (mat < 5.5) {
    // ribbed : ribs along the line, polished crests over dark grooves
    float rb = abs(cos(across * 1.5708 * max(1.0, uRibs)));
    h = dome * (0.5 + 0.5 * pow(rb, 0.6));
    if (uDash > 0.0 && fract(along / (r * (2.0 + 8.0 * uDash))) > 0.72) discard;
  } else if (mat < 6.5) {
    // ink : flat, the form built only from its width; a broken line lifts off the page
    h = 0.05;
    if (uBroken > 0.0 && og_vnoise(vec2(along * 26.0 + seed, across * 2.5)) < uBroken * 0.62) discard;
  } else h = pow(max(0.0, 1.0 - d * d), 0.6);               // film : a bubble's skin
  h *= r * aa;
  gl_FragDepth = 1.0 - clamp(h / ${HMAX}, 0.0, 1.0);
  o = vec4(h, mat, color, seed);
}`

// ── The combine : the running strokes onto the settled map, by the drawing mode ──
const COMBINE_FS = `${FS_HEAD}
uniform sampler2D uH, uS;
uniform float uMode, uFuse, uLevel;
out vec4 o;
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 H = texelFetch(uH, c, 0), S = texelFetch(uS, c, 0);
  if (S.r <= 0.0) { o = H; return; }
  float h = H.r, s = S.r;
  if (uMode < 0.5) {
    // raise : they fuse, a smooth union (never against the stroke's own earlier part)
    float k = abs(H.a - S.a) < 1e-3 ? 0.0 : uFuse;
    float e = k > 0.0 ? pow(max(k - abs(h - s), 0.0), 2.0) / (4.0 * k) : 0.0;
    float top = max(h, s) + e;
    o = s >= h ? vec4(top, S.gba) : vec4(top, H.gba);
  } else if (uMode < 1.5) {
    o = vec4(h + s, S.gba);           // stack : a new layer on top
  } else if (uMode < 2.5) {
    o = vec4(uLevel + s * 0.35, S.gba); // plate : an opaque slab at one level
  } else if (uMode < 3.5) {
    o = vec4(max(0.0, h - s * 1.15), H.gba); // press : pushed down into what is there
  } else {
    o = vec4(h * (1.0 - smoothstep(0.0, 0.004, s)), H.gba); // erase
  }
}`

// ── The life of what is drawn : it sinks and melts ───────────────────────────────
const LIFE_FS = `${FS_HEAD}
uniform sampler2D uH;
uniform vec2 uFrame;
uniform float uSink, uMelt, uFill;
out vec4 o;
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  vec2 px = 1.0 / RENDERSIZE;
  vec4 c = textureLod(uH, uv, 0.0);
  vec4 res = c;
  if (uMelt > 0.0) {
    // what is tall runs fastest; down, or out from the zenith on a dome
    vec2 P = uv - 0.5;
    vec2 down = uFill > 0.5 ? normalize(P + 1e-5) : vec2(0.0, -1.0);
    // (the height coming in from uphill, read a pixel's worth ahead)
    vec4 up = textureLod(uH, uv - down * px * 2.0, 0.0);
    float v = clamp(up.r * uMelt * 90.0, 0.0, 1.0);
    res = mix(c, up, v * 0.5);
    res.gba = up.r > c.r ? up.gba : c.gba;
    // and it softens as it runs
    vec4 nb = textureLod(uH, uv + vec2(px.x, 0.0), 0.0) + textureLod(uH, uv - vec2(px.x, 0.0), 0.0)
            + textureLod(uH, uv + vec2(0.0, px.y), 0.0) + textureLod(uH, uv - vec2(0.0, px.y), 0.0);
    res.r = mix(res.r, nb.r * 0.25, min(0.5, uMelt * 2.5));
  }
  res.r *= uSink;
  if (res.r < 0.0004) res.r = 0.0;
  o = res;
}`

// ── The picture ──────────────────────────────────────────────────────────────
const SHOW_FS = `${FS_HEAD}
uniform sampler2D uC, uSide;
uniform vec2 uFrame;
uniform vec3 uGround, uEdgeCol, uPal[6];
uniform vec3 uL;
uniform float uAz, uGroundA, uRelief, uGrain, uDents, uBevel, uEdge, uFilm, uFilmNm, uSheen, uShadow, uSideAmt, uSideUse, uHasSide, uPx, uDrift;
out vec4 fragColor;
${RELIEF_SHADE}
float hAt(vec2 uv) { return textureLod(uC, uv, 0.0).r; }
void main() {
  vec2 uv = gl_FragCoord.xy / RENDERSIZE;
  vec2 P = (uv - 0.5) * uFrame;
  vec4 c = textureLod(uC, uv, 0.0);
  float h = c.r;
  vec2 px = uPx / RENDERSIZE;
  // height from the map, the slope in frame heights
  float wx = uFrame.x / RENDERSIZE.x * uPx, wy = uFrame.y / RENDERSIZE.y * uPx;
  vec2 e = px * 1.5;
  float a1 = hAt(uv + vec2(-e.x, -e.y)), a2 = hAt(uv + vec2(0.0, -e.y)), a3 = hAt(uv + vec2(e.x, -e.y));
  float b1 = hAt(uv + vec2(-e.x, 0.0)), b3 = hAt(uv + vec2(e.x, 0.0));
  float c1 = hAt(uv + vec2(-e.x, e.y)), c2 = hAt(uv + vec2(0.0, e.y)), c3 = hAt(uv + vec2(e.x, e.y));
  vec2 slope = vec2((a3 + 2.0 * b3 + c3) - (a1 + 2.0 * b1 + c1), (c1 + 2.0 * c2 + c3) - (a1 + 2.0 * a2 + a3)) / (8.0 * 1.5 * vec2(wx, wy));
  float amp = uRelief * (1.0 + uBevel * 1.4 * (1.0 - smoothstep(0.0, 0.02, h)));
  float M = floor(c.g + 0.5);
  float inRelief = h > 0.00012 ? 1.0 : 0.0;
  // the material's skin : dents the size of a thumb, a grain the size of its print
  float skin = M < 0.5 ? 1.0 : (M > 2.5 && M < 3.5) ? 0.45 : (M > 6.5 || (M > 1.5 && M < 2.5)) ? 0.0 : 0.16;
  if (inRelief > 0.5 && M > 1.5 && M < 2.5) slope *= 1.0 + (og_vnoise(vec2(h * 1100.0, c.a * 3.0)) - 0.5) * (0.12 + 0.9 * uGrain);
  if (inRelief > 0.5 && skin > 0.0) {
    if (uDents > 0.0) {
      vec3 n = og_noised(P * 34.0 + c.a * 7.0);
      slope += n.yz * uDents * skin * 0.05;
    }
    if (uGrain > 0.0) {
      float ridge = sin((og_fbm(P * 26.0 + c.a * 3.0, 2.0)) * 95.0);
      slope += vec2(dFdx(ridge) / max(wx, 1e-6), dFdy(ridge) / max(wy, 1e-6)) * uGrain * skin * 0.0016;
      slope += (vec2(og_vnoise(P * 420.0), og_vnoise(P * 420.0 + 9.0)) - 0.5) * uGrain * skin * 0.32;
    }
  }
  vec3 N = normalize(vec3(-slope * amp, 1.0));
  vec3 L = uL;
  // the shadow it throws : a short walk toward the lamp over the height map
  float shadow = 0.0;
  if (uShadow > 0.0) {
    vec2 d = normalize(L.xy + 1e-5) * 0.0035 / max(uFrame, vec2(1e-3));
    float rise = L.z / max(0.1, length(L.xy)) * 0.0035;
    float o = h + 0.0006;
    for (int i = 1; i <= 7; i++) {
      float fi = float(i);
      float t = hAt(uv + d * fi * (1.0 + fi * 0.35));
      shadow = max(shadow, clamp((t - (o + rise * fi * (1.0 + fi * 0.35))) * 90.0, 0.0, 1.0));
    }
    shadow *= uShadow;
  }
  vec3 sideC = uHasSide > 0.5 ? textureLod(uSide, uv, 0.0).rgb : vec3(0.0);
  vec3 ground = uGround;
  float groundA = uGroundA;
  // through the relief as through glass : the other layer, bent by its slope
  vec3 refl = vec3(0.0);
  float reflAmt = 0.0;
  if (uHasSide > 0.5 && uSideAmt > 0.0) {
    if (uSideUse > 0.5 && uSideUse < 1.5) {
      // reflected in the metal
      vec3 r = reflect(vec3(0.0, 0.0, -1.0), N);
      vec2 ruv = uv + r.xy * 0.34;
      refl = textureLod(uSide, ruv, 0.0).rgb * 1.2;
      reflAmt = uSideAmt;
    }
  }
  vec3 col3;
  float a = groundA;
  ground *= 1.0 - 0.6 * shadow * groundA;
  if (inRelief > 0.5) {
    float idx = clamp(c.b, 0.0, 5.0);
    int i0 = int(floor(idx));
    vec3 alb = uPal[i0];
    float shadeM = M < 0.5 ? 0.0 : M < 1.5 ? 1.0 : M < 2.5 ? 2.0 : M < 3.5 ? 3.0 : M < 4.5 ? 4.0 : M < 5.5 ? 2.0 : M < 6.5 ? 5.0 : 6.0;
    if (M > 2.5 && M < 3.5) {
      // chips : a colored body of recycled plastic, flecks of the whole palette
      vec3 v = og_voronoi(P * 62.0 + c.a * 5.0);
      float pick = fract(v.y * 7.3) * 5.0;
      alb = mix(alb, uPal[int(pick)], step(0.34, fract(v.y * 13.7)));
    }
    if (uHasSide > 0.5 && uSideAmt > 0.0 && uSideUse < 0.5) alb = mix(alb, sideC * 1.1, uSideAmt);
    float nm = uFilmNm + h * 5200.0 + (og_fbm(P * 5.0 + uDrift, 3.0) - 0.5) * 420.0;
    vec3 lit = shadeSurface(shadeM, alb, N, L, uAz, 0.3 + uSheen * 1.2, refl, reflAmt, uFilm, nm, P);
    if (M > 4.5 && M < 5.5) {
      // ribbed : the grooves go dark
      float ao = smoothstep(0.0, 0.012, h);
      lit *= 0.35 + 0.65 * ao;
    }
    lit *= 1.0 - 0.72 * shadow;
    if (uEdge > 0.0) {
      // a glow along the edges, where the side falls away
      float rim = pow(1.0 - N.z, 2.0);
      lit += uEdgeCol * rim * uEdge * 1.4;
    }
    // glass : the layer behind, bent, and only the shine of the surface on top
    if (uHasSide > 0.5 && uSideAmt > 0.0 && uSideUse > 1.5) {
      vec3 bent = textureLod(uSide, uv + N.xy * 0.11, 0.0).rgb;
      vec3 V = vec3(0.0, 0.0, 1.0);
      float fr = pow(1.0 - N.z, 3.0);
      vec3 glassC = bent * (0.86 + 0.2 * N.z) + roomAt(reflect(-V, N), uAz, P, N.z, 0.05) * (0.1 + 0.7 * fr);
      lit = mix(lit, glassC, uSideAmt);
    }
    // a soft edge where the relief meets the ground
    float cov = smoothstep(0.00012, 0.0008, h);
    col3 = mix(ground, lit, cov);
    a = mix(groundA, 1.0, cov);
  } else {
    col3 = ground;
    if (uHasSide > 0.5 && uSideAmt > 0.0 && uSideUse > 1.5) {
      // the glass's ground is the layer itself
      col3 = mix(col3, sideC * (1.0 - 0.5 * shadow), uSideAmt);
      a = mix(a, 1.0, uSideAmt);
    }
  }
  fragColor = vec4(a > 0.001 ? col3 : vec3(0.0), a);
}`

// (the sidechain to a small grid, for the moving things and the outlines)
const COPY_FS = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUV;
out vec4 o;
void main() { o = texture(uTex, vUV); }`

interface Stroke {
  x: number; y: number; along: number; acc: number; seed: number; mat: number; color: number
  size: number; r: number; started: boolean; log: number[] | null; commit?: (e: HandGestureLog) => void
  sinceDrop: number
  cx: number; cy: number; n: number // the last point given, how many (the pen is half a step behind)
}
interface Walker { x: number; y: number; a: number; left: number; stroke: Stroke | null; vary: number; prim?: Prim; t: number }
interface Prim { kind: 'arc' | 'line'; cx: number; cy: number; r: number; a0: number; a1: number; bx: number; by: number; len: number }

const GRID = 96

export class ReliefSource implements NativeGenerator {
  private g: EngineGL
  private stampP: Prog
  private combP: Prog
  private lifeP: Prog
  private showP: Prog
  private copyP: Prog
  private H: [Target, Target] | null = null
  private S: Target | null = null
  private C: Target | null = null
  private depth: WebGLRenderbuffer | null = null
  private hi = 0
  private vao: WebGLVertexArrayObject
  private buf: WebGLBuffer
  private inst = new Float32Array(MAX_SEGS * STRIDE)
  private nInst = 0
  private sDirty = false
  private clock = new SlotClock()
  private acc = 0
  private inputs: Record<string, number | number[]> = {}
  private side: WebGLTexture | null = null
  private blankTex: WebGLTexture | null = null
  private clearE = new Edge()
  private dropE = new Edge()
  private frame: [number, number] = [1, 1]
  private az = 0
  private pointers = new Map<number, Stroke>()
  private walkers: Walker[] = []
  private things = new Map<number, Stroke>()
  private player = new SynthPlayer()
  private read: GridReadback | null = null
  private cur = new Uint8Array(GRID * GRID)
  private prev = new Uint8Array(GRID * GRID)
  private rgba = new Uint8Array(GRID * GRID * 4)
  private haveGrid = false
  private lastGridAt = 0
  private strokes = 0
  private seedN = Math.random() * 40
  private prevT = 0
  private bakeIn = 0
  private drift = 0
  private rngS = Math.floor(Math.random() * 2147483646) + 1
  private applied: readonly HandGestureLog[] = []
  private pendingOps: readonly HandGestureLog[] | null = null
  private rawOps: readonly HandGestureLog[] | undefined = undefined
  private logN = 0
  private curMode = 0
  private cleared = false
  private compass: Prim[] = []
  private compassC: [number, number][] = []

  constructor(gl: WebGL2RenderingContext, private w: number, private h: number) {
    const g = (this.g = new EngineGL(gl, 'relief'))
    this.stampP = g.prog(STAMP_FS, STAMP_VS)
    this.combP = g.prog(COMBINE_FS)
    this.lifeP = g.prog(LIFE_FS)
    this.showP = g.prog(SHOW_FS)
    this.copyP = g.prog(COPY_FS, VS)
    this.vao = gl.createVertexArray()!
    gl.bindVertexArray(this.vao)
    this.buf = gl.createBuffer()!
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW)
    const b = STRIDE * 4
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, b, 0); gl.vertexAttribDivisor(0, 1)
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, b, 16); gl.vertexAttribDivisor(1, 1)
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, b, 32); gl.vertexAttribDivisor(2, 1)
    gl.bindVertexArray(null)
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
  }

  private rand(): number {
    this.rngS = (this.rngS * 16807) % 2147483647
    return (this.rngS - 1) / 2147483646
  }

  // ── Inputs ────────────────────────────────────────────────────────────────
  update(inputs: Record<string, number | number[]>): void {
    this.inputs = { ...inputs }
    if (this.clearE.fired(num(inputs, 'clear', 0))) this.cleared = true
    if (this.dropE.fired(num(inputs, 'stroke', 0))) this.newWalkerNow = true
  }

  setInput(name: string, value: number | number[]): void {
    this.inputs[name] = value
    if (typeof value !== 'number') return
    if (name === 'clear' && this.clearE.fired(value)) this.cleared = true
    if (name === 'stroke' && this.dropE.fired(value)) this.newWalkerNow = true
  }

  private newWalkerNow = false
  private dropsLanded = false // fused drops melt in as they land : baked at once
  private flowT = 0 // how far the flowing metal's bands have run (integrated : a knob never jumps them)
  private fineFill = FINE_FILL // what is left of FINE_FILL this frame

  feed(_audio: WebGLTexture | null, side: WebGLTexture | null): void {
    this.side = side
  }

  handOps(ops: readonly HandGestureLog[] | undefined): void {
    if (ops === this.rawOps) return
    this.rawOps = ops
    this.pendingOps = ops ?? []
  }

  // ── Strokes ───────────────────────────────────────────────────────────────
  private brushOf(): number {
    return Math.max(0, Math.min(RELIEF_BRUSHES.length - 1, Math.round(num(this.inputs, 'brush', 1))))
  }

  private colorIndex(): number {
    const n = Math.round(num(this.inputs, 'colorPick', 1))
    return n >= 1 && n <= 5 ? n - 1 : Math.floor(this.rand() * 5)
  }

  private baseSize(): number {
    return 0.005 + 0.13 * Math.pow(Math.max(0, Math.min(1, num(this.inputs, 'size', 0.45))), 1.5)
  }

  private beginStroke(x: number, y: number, log: boolean, commit?: (e: HandGestureLog) => void, scale = 1): Stroke {
    this.strokes++
    const mat = this.brushOf()
    this.seedN = (this.seedN + 0.61803) % 40
    const s: Stroke = {
      x, y, along: 0, acc: 0, seed: this.seedN, mat, color: this.colorIndex(), size: this.baseSize() * scale, r: 0, started: false,
      log: log ? [] : null, commit, sinceDrop: 0, cx: x, cy: y, n: 0
    }
    s.r = s.size
    if (s.log) {
      // what a replay needs : the stroke's own settings, then its points
      const I = this.inputs
      s.log.push(mat, s.color, Math.round(num(I, 'mode', 0)), s.size, s.seed)
      s.log.push(num(I, 'mirror', 0), num(I, 'fold', 6), num(I, 'chaos', 0.15), num(I, 'convex', 0.7), num(I, 'rough', 0.1), num(I, 'ribs', 4), num(I, 'dash', 0), num(I, 'broken', 0), num(I, 'fuse', 0.5))
      s.log.push(x, y)
    }
    this.emit(s, x, y, x, y, s.r, s.r)
    return s
  }

  /** To the next point, rounded over the last one : from midpoint to midpoint with the
   *  point between as a handle. A mirror shows every corner of a plain polyline. */
  private moveStroke(s: Stroke, x: number, y: number): void {
    if (s.log) s.log.push(x, y)
    const mx = (s.cx + x) * 0.5, my = (s.cy + y) * 0.5
    if (s.n === 0) this.segTo(s, mx, my)
    else {
      const x0 = s.x, y0 = s.y, cx = s.cx, cy = s.cy
      const ux = cx - x0, uy = cy - y0, vx = mx - cx, vy = my - cy
      const len = Math.hypot(ux, uy) + Math.hypot(vx, vy)
      // (capsules crease on the inside of every bend, by the angle of the bend : a fraction
      // of a degree each, or a mirror shows the teeth; a full buffer drops the finest first)
      const turn = Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy))
      const room = Math.floor((MAX_SEGS - this.nInst) / (this.copies() * 2))
      // (a radius that changes along the stroke : each capsule's round cap pokes a little past
      // the next one's slope, a ripple that falls with the square of the step, so under a pixel)
      const wobbles = num(this.inputs, 'chaos', 0.15) > 0 || s.mat === 6
      // (and the ripple goes by the step against the radius : a fixed share of it, down to under a pixel)
      const stepLen = wobbles ? Math.max(0.4 / this.h, s.size * 0.008) : Math.max(0.002, s.size * 0.4)
      const copy = this.copies()
      const cost = copy * Math.pow(2 * s.size * this.h, 2)
      const n = Math.max(1, Math.min(160, room, Math.floor(this.fineFill / cost), Math.max(Math.ceil(len / stepLen), Math.ceil(turn / 0.012))))
      this.fineFill -= n * cost
      for (let i = 1; i <= n; i++) {
        const t = i / n, a = (1 - t) * (1 - t), b = 2 * (1 - t) * t, c = t * t
        this.segTo(s, a * x0 + b * cx + c * mx, a * y0 + b * cy + c * my)
      }
    }
    s.cx = x; s.cy = y; s.n++
  }

  private segTo(s: Stroke, x: number, y: number): void {
    const dx = x - s.x, dy = y - s.y
    const dist = Math.hypot(dx, dy)
    if (dist <= 0) return
    const chaos = Math.max(0, Math.min(1, num(this.inputs, 'chaos', 0.15)))
    if (s.mat === 4) {
      // drops : laid one by one and melted into one body
      s.sinceDrop += dist
      const gap = s.size * 0.8
      let t = gap - (s.sinceDrop - dist)
      while (s.sinceDrop >= gap) {
        const k = Math.min(1, t / dist)
        const rr = s.size * (0.65 + 0.7 * this.rand() * (0.3 + chaos))
        this.seedN = (this.seedN + 0.61803) % 40
        s.seed = this.seedN
        this.emit(s, s.x + dx * k, s.y + dy * k, s.x + dx * k, s.y + dy * k, rr, rr)
        this.dropsLanded = true
        s.sinceDrop -= gap
        t += gap
      }
      s.x = x; s.y = y
      s.along += dist
      return
    }
    // the radius wanders with CHAOS, and ink swells at the ends of what it draws
    const n0 = s.along * 18 + s.seed, n1 = (s.along + dist) * 18 + s.seed
    const wob = (u: number): number => 1 + chaos * 0.55 * (Math.sin(u) * 0.6 + Math.sin(u * 2.3 + 1.1) * 0.4)
    let r0 = s.size * wob(n0), r1 = s.size * wob(n1)
    if (s.mat === 6) {
      const swell = (l: number): number => 0.55 + 0.45 * Math.min(1, l / (s.size * 7))
      r0 *= swell(s.along); r1 *= swell(s.along + dist)
    }
    // (the line wanders too, continuously : the next segment starts where this one ended)
    const j = chaos * s.size * 0.125
    this.emit(s, s.x + j * Math.sin(n0 * 0.7), s.y + j * Math.cos(n0 * 0.9), x + j * Math.sin(n1 * 0.7), y + j * Math.cos(n1 * 0.9), r0, r1)
    s.x = x; s.y = y
    s.along += dist
  }

  private endStroke(s: Stroke): void {
    if (s.n > 0) this.segTo(s, s.cx, s.cy) // the last half step
    if (s.log && s.commit) {
      this.logN++
      const entry: HandGestureLog = { k: 'stroke', id: this.logN, ev: s.log }
      s.commit(entry)
    }
    this.bakeIn = 0
  }

  /** One capsule, and its mirror images. */
  /** How many capsules the mirror lays for each of the stroke's. */
  private copies(): number {
    const m = Math.round(num(this.inputs, 'mirror', 0))
    return m === 1 || m === 2 ? 2 : m === 3 ? 4 : m === 4 ? Math.max(2, Math.min(32, Math.round(num(this.inputs, 'fold', 6)))) : 1
  }

  private emit(s: Stroke, ax: number, ay: number, bx: number, by: number, ra: number, rb: number): void {
    const push = (x0: number, y0: number, x1: number, y1: number): void => {
      if (this.nInst >= MAX_SEGS) return
      const o = this.nInst * STRIDE
      const I = this.inst
      I[o] = x0; I[o + 1] = y0; I[o + 2] = x1; I[o + 3] = y1
      I[o + 4] = ra; I[o + 5] = rb; I[o + 6] = s.along; I[o + 7] = s.along + Math.hypot(bx - ax, by - ay)
      I[o + 8] = s.seed; I[o + 9] = s.mat * 16 + s.color
      this.nInst++
    }
    push(ax, ay, bx, by)
    const m = Math.round(num(this.inputs, 'mirror', 0))
    if (m === 1 || m === 3) push(-ax, ay, -bx, by)
    if (m === 2 || m === 3) push(ax, -ay, bx, -by)
    if (m === 3) push(-ax, -ay, -bx, -by)
    if (m === 4) {
      const fold = Math.max(2, Math.min(32, Math.round(num(this.inputs, 'fold', 6))))
      for (let i = 1; i < fold; i++) {
        const t = (i / fold) * Math.PI * 2
        const c = Math.cos(t), si = Math.sin(t)
        const [p, q] = this.turn(ax, ay, c, si)
        const [u, v] = this.turn(bx, by, c, si)
        push(p, q, u, v)
      }
    }
    this.sDirty = true
  }

  /** A copy turned about the center : flat, a plain turn; on the full dome the frame is
   *  spread over its disc, so the turn happens there and stays round. */
  private turn(x: number, y: number, c: number, s: number): [number, number] {
    if (domeFill() <= 0) return [c * x - s * y, s * x + c * y]
    const sx = Math.max(-1, Math.min(1, x * 2)), sy = Math.max(-1, Math.min(1, y * 2))
    const dx = sx * Math.sqrt(1 - 0.5 * sy * sy), dy = sy * Math.sqrt(1 - 0.5 * sx * sx)
    const u = c * dx - s * dy, v = s * dx + c * dy
    const u2 = u * u, v2 = v * v, t = 2 * Math.SQRT2
    const fx = 0.5 * Math.sqrt(Math.max(0, 2 + u2 - v2 + t * u)) - 0.5 * Math.sqrt(Math.max(0, 2 + u2 - v2 - t * u))
    const fy = 0.5 * Math.sqrt(Math.max(0, 2 - u2 + v2 + t * v)) - 0.5 * Math.sqrt(Math.max(0, 2 - u2 + v2 - t * v))
    return [Math.max(-1, Math.min(1, fx)) * 0.5, Math.max(-1, Math.min(1, fy)) * 0.5]
  }

  pointer(ev: SourcePointer): void {
    const x = (ev.u - 0.5) * this.frame[0], y = (ev.v - 0.5) * this.frame[1]
    if (ev.phase === 'down') {
      const st = this.beginStroke(x, y, !!ev.commit, ev.commit)
      this.pointers.set(ev.pid, st)
    } else if (ev.phase === 'move') {
      const st = this.pointers.get(ev.pid)
      if (st) this.moveStroke(st, x, y)
    } else {
      const st = this.pointers.get(ev.pid)
      if (st) { this.endStroke(st); this.pointers.delete(ev.pid) }
    }
  }

  pointerHint(): string {
    return `drag : draw in ${RELIEF_BRUSHES[this.brushOf()]}`
  }

  status(): string {
    return `${this.strokes} stroke${this.strokes === 1 ? '' : 's'}`
  }

  event(name: string): void {
    if (name === 'clear') this.cleared = true
    else if (name === 'stroke') this.newWalkerNow = true
  }

  // ── It draws itself ─────────────────────────────────────────────────────────
  private spawn(): Walker {
    const hw = this.frame[0] / 2, hh = this.frame[1] / 2
    return {
      x: (this.rand() * 1.7 - 0.85) * hw, y: (this.rand() * 1.7 - 0.85) * hh, a: this.rand() * 6.283,
      left: 0.5 + this.rand() * 1.2, stroke: null, vary: this.rand() * 40, t: 0
    }
  }

  private wander(dt: number, speed: number, curve: number): void {
    const hw = this.frame[0] / 2, hh = this.frame[1] / 2
    for (const w of this.walkers) {
      if (!w.stroke) w.stroke = this.beginStroke(w.x, w.y, false)
      w.vary += dt
      // a curving walk, turned back at the frame's edges
      w.a += (Math.sin(w.vary * 1.3) + Math.sin(w.vary * 0.57 + 1.7)) * curve * dt * 3
      const nx = w.x + Math.cos(w.a) * speed * dt, ny = w.y + Math.sin(w.a) * speed * dt
      if (Math.abs(nx) > hw * 0.97 || Math.abs(ny) > hh * 0.97) w.a += dt * 6
      w.x = Math.max(-hw, Math.min(hw, nx))
      w.y = Math.max(-hh, Math.min(hh, ny))
      this.moveStroke(w.stroke, w.x, w.y)
      w.left -= dt * (speed / Math.max(0.05, 0.22 + 0.9 * num(this.inputs, 'length', 0.55)))
      if (w.left <= 0) { this.endStroke(w.stroke); w.stroke = null; Object.assign(w, this.spawn()) }
    }
  }

  /** The compass : arcs and rules laid down one at a time, each from the places the
   *  last one made, as a geometer builds a figure. */
  private nextPrim(): Prim {
    const hh = this.frame[1] / 2
    if (!this.compassC.length || this.compass.length > 14) {
      this.compassC = [[0, 0]]
      this.compass = []
    }
    const c = this.compassC[Math.floor(this.rand() * this.compassC.length)]
    const R = hh * (0.28 + 0.1 * Math.floor(this.rand() * 4))
    let p: Prim
    if (this.rand() < 0.78) {
      const a0 = this.rand() * 6.283
      p = { kind: 'arc', cx: c[0], cy: c[1], r: R, a0, a1: a0 + 6.283 * (this.rand() < 0.65 ? 1 : 0.5), bx: 0, by: 0, len: 0 }
      // its quarter points : where the next circles may stand (a vesica, a flower)
      for (let i = 0; i < 6; i++) {
        const t = (i / 6) * 6.283 + a0
        const q: [number, number] = [c[0] + Math.cos(t) * R, c[1] + Math.sin(t) * R]
        if (Math.abs(q[0]) < this.frame[0] * 0.45 && Math.abs(q[1]) < hh * 0.9 && this.compassC.length < 40) this.compassC.push(q)
      }
    } else {
      const o = this.compassC[Math.floor(this.rand() * this.compassC.length)]
      const len = Math.hypot(o[0] - c[0], o[1] - c[1])
      p = { kind: 'line', cx: c[0], cy: c[1], r: 0, a0: 0, a1: 0, bx: o[0], by: o[1], len: len > 0.02 ? len : R }
    }
    this.compass.push(p)
    return p
  }

  private compassStep(dt: number, speed: number): void {
    for (const w of this.walkers) {
      if (!w.prim) { w.prim = this.nextPrim(); w.t = 0 }
      const p = w.prim
      const span = p.kind === 'arc' ? Math.abs(p.a1 - p.a0) * p.r : Math.max(p.len, 0.02)
      w.t = Math.min(1, w.t + (dt * speed) / Math.max(0.02, span))
      const at = (t: number): [number, number] => p.kind === 'arc'
        ? [p.cx + Math.cos(p.a0 + (p.a1 - p.a0) * t) * p.r, p.cy + Math.sin(p.a0 + (p.a1 - p.a0) * t) * p.r]
        : [p.cx + (p.bx - p.cx) * t, p.cy + (p.by - p.cy) * t]
      const [x, y] = at(w.t)
      if (!w.stroke) { const [x0, y0] = at(0); w.stroke = this.beginStroke(x0, y0, false) }
      this.moveStroke(w.stroke, x, y)
      if (w.t >= 1) { this.endStroke(w.stroke); w.stroke = null; w.prim = undefined }
    }
  }

  /** The other layer on a small grid (two frames old : it never waits on the GPU). */
  private readSide(nowMs: number): boolean {
    const g = this.g, gl = g.gl
    if (!this.side) return false
    if (!this.read) this.read = new GridReadback(gl)
    const got = this.read.takeLatest()
    if (got) {
      this.prev.set(this.cur)
      for (let y = 0; y < GRID; y++) {
        const src = (GRID - 1 - y) * GRID * 4
        const dst = y * GRID
        for (let x = 0; x < GRID; x++) {
          const i = src + x * 4
          this.cur[dst + x] = (got.grid[i] * 77 + got.grid[i + 1] * 150 + got.grid[i + 2] * 29) >> 8
        }
      }
      this.rgba.set(got.grid)
      if (!this.haveGrid) this.prev.set(this.cur)
      this.haveGrid = true
    }
    if (nowMs - this.lastGridAt > 30) {
      this.lastGridAt = nowMs
      this.read.kick(GRID, GRID, this.side, this.copyP.p, this.copyP.u('uTex'), g.vao, false)
    }
    return !!got
  }

  /** The moving things of the other layer : each one draws its own stroke (the Synth's
   *  finder and tracker, its own instance, with no sound to play). */
  private thingsStep(dt: number, nowMs: number): void {
    if (!this.readSide(nowMs)) return
    const cfg = { ...defaultSynth(), on: true, sens: Math.max(0, Math.min(1, num(this.inputs, 'sens', 0.8))), grid: 'free' as const, voices: 'poly' as const, slide: false }
    const table = new Float32Array([110, 220, 440, 880])
    this.player.step({
      cur: this.cur, prev: this.prev, rgba: this.rgba, fresh: false, dt: Math.max(dt, 1 / 60), nowMs, cfg, table,
      aspect: this.frame[0] / this.frame[1], radial: (x, y) => Math.hypot(x - 0.5, y - 0.5) * 2, beats: 0, bpm: 120, bar: 4, mod: () => undefined
    })
    const seen = new Set<number>()
    for (const t of this.player.playingThings('height', (x, y) => Math.hypot(x - 0.5, y - 0.5) * 2)) {
      seen.add(t.id)
      const x = (t.x - 0.5) * this.frame[0], y = (0.5 - t.y) * this.frame[1]
      const st = this.things.get(t.id)
      if (!st) this.things.set(t.id, this.beginStroke(x, y, false))
      else this.moveStroke(st, x, y)
    }
    for (const [id, st] of this.things) if (!seen.has(id)) { this.endStroke(st); this.things.delete(id) }
  }

  /** Walkers that follow the other layer's outlines : along the edge of what is bright. */
  private outlineStep(dt: number, speed: number, nowMs: number): void {
    this.readSide(nowMs)
    if (!this.haveGrid) return
    const lum = (x: number, y: number): number => {
      const xi = Math.max(0, Math.min(GRID - 1, Math.round((x / this.frame[0] + 0.5) * (GRID - 1))))
      const yi = Math.max(0, Math.min(GRID - 1, Math.round((0.5 - y / this.frame[1]) * (GRID - 1))))
      return this.cur[yi * GRID + xi]
    }
    const e = this.frame[1] / GRID * 1.5
    const grad = (x: number, y: number): [number, number] => [lum(x + e, y) - lum(x - e, y), lum(x, y + e) - lum(x, y - e)]
    for (const w of this.walkers) {
      let [gx, gy] = grad(w.x, w.y)
      let mag = Math.hypot(gx, gy)
      if (mag < 24 || w.left <= 0) {
        // lost the edge : find another
        if (w.stroke) { this.endStroke(w.stroke); w.stroke = null }
        for (let k = 0; k < 24; k++) {
          const nx = (this.rand() - 0.5) * this.frame[0], ny = (this.rand() - 0.5) * this.frame[1]
          const [ax, ay] = grad(nx, ny)
          if (Math.hypot(ax, ay) > 40) { w.x = nx; w.y = ny; gx = ax; gy = ay; mag = Math.hypot(ax, ay); break }
        }
        w.left = 0.8 + this.rand() * 1.5
        w.a = this.rand() < 0.5 ? 1 : -1
        if (mag < 24) continue
      }
      // along the edge : square to the slope of the brightness
      const tx = (-gy / mag) * w.a, ty = (gx / mag) * w.a
      w.x += tx * speed * dt
      w.y += ty * speed * dt
      if (!w.stroke) w.stroke = this.beginStroke(w.x, w.y, false)
      this.moveStroke(w.stroke, w.x, w.y)
      w.left -= dt
    }
  }

  // ── GL ──────────────────────────────────────────────────────────────────────
  private blank(): WebGLTexture {
    const gl = this.g.gl
    if (this.blankTex) return this.blankTex
    const t = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.bindTexture(gl.TEXTURE_2D, null)
    this.blankTex = t
    return t
  }

  private ensure(): void {
    const g = this.g, gl = g.gl
    if (this.H) return
    // (32-bit where the card can filter it : a band's hard edge on a nearly flat top shows
    // every step of a 16-bit height, as stairs)
    const fine = !!gl.getExtension('OES_texture_float_linear')
    const m = (): Target => g.target(this.w, this.h, fine ? { linear: true } : { half: 'rgba', linear: true })
    this.H = [m(), m()]
    this.S = m()
    this.C = m()
    this.depth = gl.createRenderbuffer()!
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.depth)
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, this.w, this.h)
    gl.bindRenderbuffer(gl.RENDERBUFFER, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.S.fbo)
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, this.depth)
    gl.clearDepth(1)
    gl.clear(gl.DEPTH_BUFFER_BIT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  private clearAll(): void {
    const gl = this.g.gl
    gl.clearColor(0, 0, 0, 0)
    for (const t of [...this.H!, this.C!]) { gl.bindFramebuffer(gl.FRAMEBUFFER, t.fbo); gl.clear(gl.COLOR_BUFFER_BIT) }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.S!.fbo)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.sDirty = false
    this.nInst = 0
    this.strokes = 0
  }

  /** The capsules queued this frame into the stroke buffer. */
  private flushStamps(): void {
    if (!this.nInst) return
    const g = this.g, gl = g.gl, S = this.S!
    gl.bindFramebuffer(gl.FRAMEBUFFER, S.fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.enable(gl.DEPTH_TEST)
    gl.depthFunc(gl.LESS)
    gl.depthMask(true)
    gl.disable(gl.BLEND)
    const I = this.inputs
    this.stampP.use().f2('uFrame', this.frame[0], this.frame[1]).f2('RENDERSIZE', this.w, this.h)
      .f1('uConvex', Math.max(0, Math.min(1, num(I, 'convex', 0.7))))
      .f1('uRough', Math.max(0, Math.min(1, num(I, 'rough', 0.1))))
      .f1('uRibs', Math.max(1, Math.min(8, Math.round(num(I, 'ribs', 4)))))
      .f1('uDash', Math.max(0, Math.min(1, num(I, 'dash', 0))))
      .f1('uBroken', Math.max(0, Math.min(1, num(I, 'broken', 0))))
      .f1('uPx', 1 / this.h)
    gl.bindVertexArray(this.vao)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst.subarray(0, this.nInst * STRIDE))
    gl.bindBuffer(gl.ARRAY_BUFFER, null)
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.nInst)
    gl.bindVertexArray(null)
    gl.disable(gl.DEPTH_TEST)
    this.nInst = 0
  }

  private combine(into: Target): void {
    const g = this.g
    const fuse = this.baseSize() * (0.08 + 1.3 * Math.pow(Math.max(0, Math.min(1, num(this.inputs, 'fuse', 0.5))), 1.5))
    this.combP.use().i1('uH', 0).i1('uS', 1).f2('RENDERSIZE', this.w, this.h)
      .f1('uMode', this.curMode).f1('uFuse', fuse).f1('uLevel', 0.018)
    g.bind(0, this.H![this.hi].tex)
    g.bind(1, this.S!.tex)
    g.draw(into.fbo, this.w, this.h)
    g.bind(1, null)
  }

  /** The running strokes become part of the map. */
  private bake(): void {
    const gl = this.g.gl
    if (!this.sDirty) return
    this.combine(this.H![1 - this.hi])
    this.hi = 1 - this.hi
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.S!.fbo)
    gl.clearColor(0, 0, 0, 0)
    gl.clearDepth(1)
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    this.sDirty = false
  }

  /** A log from the session (or an undo) : the drawing rebuilt from it. */
  private replay(ops: readonly HandGestureLog[]): void {
    // what we just drew and committed comes back to us as the same log one longer
    const prev = this.applied
    const grew = ops.length >= prev.length && prev.every((p, i) => ops[i] === p)
    this.applied = ops
    // (a new empty log, and not just no log : Generate's blank page, whatever was drawn)
    const newPage = ops.length === 0 && this.rawOps !== undefined
    if (!newPage && grew && (ops.length === 0 || ops.length - prev.length <= 1) && this.logN >= ops.length) return
    if (newPage) {
      // (what was being drawn stops too : its brush belongs to the last drawing)
      this.walkers.length = 0
      this.things.clear()
    }
    this.clearAll()
    this.logN = ops.length ? Math.max(...ops.map((o) => o.id)) : 0
    const live = this.inputs, keepMode = this.curMode
    this.fineFill = Infinity // (a rebuild is one frame, and must match what was drawn)
    const HEAD = 14 // the settings logged ahead of the points : see beginStroke
    for (const op of ops) {
      if (op.k !== 'stroke' || op.ev.length < HEAD + 2) continue
      const e = op.ev
      const [mat, color, mode, size, seed] = e
      this.curMode = mode
      this.inputs = { ...live, mirror: e[5], fold: e[6], chaos: e[7], convex: e[8], rough: e[9], ribs: e[10], dash: e[11], broken: e[12], fuse: e[13] }
      const x0 = e[HEAD], y0 = e[HEAD + 1]
      const st: Stroke = { x: x0, y: y0, along: 0, acc: 0, seed, mat, color, size, r: size, started: true, log: null, sinceDrop: 0, cx: x0, cy: y0, n: 0 }
      this.emit(st, st.x, st.y, st.x, st.y, size, size)
      for (let i = HEAD + 2; i + 1 < e.length; i += 2) {
        if (this.nInst > MAX_SEGS - 2048) this.flushStamps()
        this.moveStroke(st, e[i], e[i + 1])
        if (this.dropsLanded) { this.dropsLanded = false; this.flushStamps(); this.bake() }
      }
      if (st.n > 0) this.segTo(st, st.cx, st.cy)
      this.flushStamps()
      this.bake()
      this.strokes++
    }
    this.inputs = live
    this.curMode = keepMode
  }

  render(targetFbo: WebGLFramebuffer, clockSec: number): void {
    const g = this.g
    const gl = g.gl
    if (!g.ok) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.clearColor(0, 0, 0, 1)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return
    }
    const I = this.inputs
    const fill = domeFill() > 0
    const asp = fill ? 1 : this.w / Math.max(1, this.h)
    this.frame = [asp, 1]
    const firstEnsure = !this.H
    this.ensure()
    if (firstEnsure) this.clearAll()
    const dt = this.clock.tick(clockSec)
    this.fineFill = FINE_FILL
    const nowMs = performance.now()
    if (this.pendingOps) { const o = this.pendingOps; this.pendingOps = null; this.replay(o) }
    if (this.cleared) {
      this.cleared = false
      this.clearAll()
      for (const w of this.walkers) { w.stroke = null; w.prim = undefined }
      this.things.clear()
    }

    // a change of drawing mode closes what is running under the old one
    const mode = Math.max(0, Math.min(4, Math.round(num(I, 'mode', 0))))
    if (mode !== this.curMode) { this.flushStamps(); this.bake(); this.curMode = mode }

    // ── it draws itself ──
    const draw = Math.round(num(I, 'draw', 1))
    const rate = Math.max(0, num(I, 'rate', 0.8))
    const speed = 0.05 + 1.1 * Math.pow(Math.max(0, Math.min(1, num(I, 'speed', 0.4))), 1.5)
    const wantN = draw === 0 ? 0 : Math.max(rate > 0 ? 1 : 0, Math.min(8, Math.round(rate * 3)))
    while (this.walkers.length < wantN) this.walkers.push(this.spawn())
    while (this.walkers.length > wantN) { const w = this.walkers.pop()!; if (w.stroke) this.endStroke(w.stroke) }
    if (dt > 0) {
      if (draw === 1) this.wander(dt, speed, Math.max(0, Math.min(1, num(I, 'curve', 0.45))))
      else if (draw === 2) this.compassStep(dt, speed)
      else if (draw === 3) this.thingsStep(dt, nowMs)
      else if (draw === 4) this.outlineStep(dt, speed, nowMs)
    }
    if (this.newWalkerNow) {
      this.newWalkerNow = false
      const w = this.spawn()
      const st = this.beginStroke(w.x, w.y, false)
      for (let i = 1; i <= 16; i++) { w.a += (this.rand() - 0.5) * 0.9; w.x += Math.cos(w.a) * 0.03; w.y += Math.sin(w.a) * 0.03; this.moveStroke(st, w.x, w.y) }
      this.endStroke(st)
    }
    // the sound's hits : each lands a stroke, bigger when it is louder
    const amt = Math.max(0, Math.min(1, num(I, 'audio', 0)))
    if (amt > 0) {
      const tr = audioBus.feature('transient')
      const lv = audioBus.feature('level')
      if (tr > 0.5 && this.prevT <= 0.5 && this.rand() < amt) {
        const w = this.spawn()
        const st = this.beginStroke(w.x, w.y, false, undefined, 0.7 + 2.2 * lv)
        const n = 4 + Math.floor(this.rand() * 10)
        for (let i = 1; i <= n; i++) { w.a += (this.rand() - 0.5) * 0.8; w.x += Math.cos(w.a) * 0.018; w.y += Math.sin(w.a) * 0.018; this.moveStroke(st, w.x, w.y) }
        this.endStroke(st)
      }
      this.prevT = tr
    }

    // ── the stroke buffer ──
    this.flushStamps()
    if (this.dropsLanded) { this.dropsLanded = false; this.bake() }
    // what runs for long is baked in as it goes (the stroke's own seed keeps it seamless)
    this.bakeIn -= dt
    const running = this.pointers.size + this.walkers.filter((w) => w.stroke).length + this.things.size
    if (this.sDirty && (running === 0 || this.bakeIn <= 0)) {
      this.bake()
      this.bakeIn = 1.2
    }

    // ── the life of what is drawn ──
    this.acc = Math.min(this.acc + dt, STEP * 2)
    const sinkK = Math.max(0, Math.min(1, num(I, 'sink', 0.1)))
    const melt = Math.max(0, Math.min(1, num(I, 'melt', 0)))
    while (this.acc >= STEP) {
      this.acc -= STEP
      if (sinkK <= 0 && melt <= 0) continue
      // (half-life from a minute down to two seconds)
      const half = 60 * Math.pow(1 / 30, sinkK)
      const k = sinkK > 0 ? Math.pow(0.5, STEP / half) : 1
      this.lifeP.use().i1('uH', 0).f2('RENDERSIZE', this.w, this.h).f2('uFrame', this.frame[0], this.frame[1])
        .f1('uSink', k).f1('uMelt', melt * melt * 0.5).f1('uFill', fill ? 1 : 0)
      g.bind(0, this.H![this.hi].tex)
      g.draw(this.H![1 - this.hi].fbo, this.w, this.h)
      this.hi = 1 - this.hi
    }

    // what is on the map now, the running strokes over it
    let map: Target = this.H![this.hi]
    if (this.sDirty) { this.combine(this.C!); map = this.C! }

    // ── the light, and the picture ──
    const orbit = num(I, 'orbit', 0.1)
    this.az = (this.az + orbit * 1.2 * dt) % (Math.PI * 2)
    let la = num(I, 'lightAngle', 2.36) + this.az
    let lh = Math.max(0, Math.min(1, num(I, 'lightHeight', 0.5)))
    // Context's light path, when one plays and FOLLOW asks for it
    if (Math.round(num(I, 'follow', 0)) === 1 && liveLight.on) {
      const dx = liveLight.x - 0.5, dy = liveLight.y - 0.5
      la = Math.atan2(dy, dx)
      lh = Math.max(0.08, 1 - Math.min(1, Math.hypot(dx, dy) * 1.9))
    }
    const lz = 0.15 + 1.1 * lh
    const ln = Math.hypot(1, lz)
    const pal: number[] = []
    const DEF: Array<[number, number, number]> = [[0.78, 0.8, 0.84], [0.85, 0.32, 0.18], [0.16, 0.34, 0.72], [0.92, 0.72, 0.2], [0.08, 0.08, 0.1]]
    for (let i = 0; i < 5; i++) pal.push(...col(I, `color${i + 1}`, DEF[i]))
    pal.push(...col(I, 'color1', DEF[0]))
    const [gr, gg, gb] = col(I, 'ground', [0.035, 0.035, 0.04])
    const [er, eg, eb] = col(I, 'edgeColor', [1, 0.72, 0.42])
    const sideAmt = Math.max(0, Math.min(1, num(I, 'side', 0)))
    this.drift = (this.drift + dt * 0.012) % 512
    this.flowT = (this.flowT + Math.max(-1, Math.min(1, num(I, 'flowSpeed', 0.3))) * 0.8 * dt + 8192) % 8192
    const p = this.showP
    p.use().i1('uC', 0).i1('uSide', 1).f2('RENDERSIZE', this.w, this.h).f2('uFrame', this.frame[0], this.frame[1])
      .f3('uGround', gr, gg, gb).f3('uEdgeCol', er, eg, eb)
      .f3('uL', Math.cos(la) / ln, Math.sin(la) / ln, lz / ln).f1('uAz', la)
      .f1('uGroundA', Math.max(0, Math.min(1, num(I, 'groundOp', 1))))
      .f1('uRelief', 0.25 + 1.5 * Math.max(0, Math.min(1, num(I, 'relief', 0.5))))
      .f1('uGrain', Math.max(0, Math.min(1, num(I, 'grain', 0.15))))
      .f1('uDents', Math.max(0, Math.min(1, num(I, 'dents', 0.15))))
      .f1('uBevel', Math.max(0, Math.min(1, num(I, 'bevel', 0.3))))
      .f1('uEdge', Math.max(0, Math.min(1, num(I, 'edge', 0))))
      .f1('uFilm', Math.max(0, Math.min(1, num(I, 'film', 0))))
      .f1('uFilmNm', 80 + 900 * Math.max(0, Math.min(1, num(I, 'filmThick', 0.3))))
      .f1('uSheen', Math.max(0, Math.min(1, num(I, 'gloss', 0.6))))
      .f1('uShadow', Math.max(0, Math.min(1, num(I, 'shadow', 0.6))))
      .f1('uSideAmt', sideAmt).f1('uSideUse', Math.round(num(I, 'sideUse', 0))).f1('uHasSide', this.side ? 1 : 0)
      .f1('uPx', Math.max(1, this.h / 1080)).f1('uDrift', this.drift)
      .f1('uFlow', Math.max(0, Math.min(1, num(I, 'flow', 0)))).f1('uFlowT', this.flowT).f1('uBands', Math.max(0.5, Math.min(16, num(I, 'bands', 3))))
      .f1('uSplit', Math.max(0, Math.min(1, num(I, 'split', 0.35)))).f1('uRipple', Math.max(0, Math.min(1, num(I, 'ripple', 0.3))))
    gl.uniform3fv(p.u('uPal'), new Float32Array(pal))
    g.bind(0, map.tex)
    g.bind(1, this.side ?? this.blank())
    g.draw(targetFbo, this.w, this.h)
    g.done(2)
  }

  dispose(): void {
    const g = this.g, gl = g.gl
    for (const t of [...(this.H ?? []), this.S, this.C]) g.freeTarget(t)
    this.H = null; this.S = null; this.C = null
    if (this.depth) gl.deleteRenderbuffer(this.depth)
    this.depth = null
    if (this.blankTex) gl.deleteTexture(this.blankTex)
    this.blankTex = null
    this.read?.dispose()
    this.read = null
    gl.bindVertexArray(this.vao)
    gl.deleteBuffer(this.buf)
    gl.bindVertexArray(null)
    gl.deleteVertexArray(this.vao)
    g.dispose()
  }
}
