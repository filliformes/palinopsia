// CollageSource : the Autocutter's cut-up, but every piece is its own film.
//
// The Autocutter FX partitions the frame and shuffles the pieces of ONE image.
// This is the same partition driving a WALL of simultaneous videos : each piece
// shows a different clip, cover-cropped to its own shape, looping and speed-
// stretched, re-dealt on a trigger or a clock. It is a SOURCE, not an effect :
// the whole mosaic is one layer, so the normal rack / blend / finishing stack
// sits on top of it unchanged.
//
// Three decisions carry the design:
//
//  1. **A 2D ARRAY TEXTURE, not N samplers or an atlas.** Every deck owns one
//     layer of a `sampler2DArray`, so the fragment shader picks a film with an
//     index instead of a 16-way branch, and there is no tile-packing maths and
//     no bleeding between neighbours. Layers must share a size, so each frame is
//     CONTAIN-fitted into a square layer (its content rect recorded on the CPU
//     at blit time) and the per-cell COVER crop is then computed against that
//     content rect : which is what makes portrait, landscape and 4K clips
//     interchangeable. The layer edge follows the output size and the piece
//     count (a 2-piece wall at 4K needs far more texels per film than 50 pieces
//     at 1080p), inside a fixed memory budget.
//
//  2. **Decks are a pool, cells are a mapping.** More cuts than films is normal
//     and desirable : several cells then show the same film at different crops
//     and rotations, which reads as collage rather than repetition. The pool
//     size is what costs decoder bandwidth, not the number of cuts; a deck no
//     piece shows is paused and never blitted.
//
//  3. **Whole films by default, windows on request.** `hold` (the "window"
//     knob, 0 by default) loops the WHOLE file : the element's native loop, no
//     seeking at all, which is both the smoothest path and the least surprising.
//     Setting it non-zero loops a short window instead, which is how you stop a
//     30-minute take from reducing a cell to one slow moment; the cost is a hard
//     cut backwards every window, so it is opt-in. `churn` then decides how many
//     decks re-roll on a fast clock instead of waiting for the next deal : the
//     span from "every piece holds" to "every piece is its own little montage".
//     Both apply live, not at the next deal.
//
// Time : the wall runs on the LAYER clock the compositor hands `render()` (the
// layer's Speed x the global speed, or the background's slow clock), so every
// timer here (auto deal, churn, crossfade) is in layer seconds and every film's
// playback rate follows the same multiplier.
//
// Measured on the target machine (RTX 4070) before designing this : 11 clips,
// including a 3840x2160 and a portrait 1200x1920, decoded simultaneously at
// their native rates with the app still at 55-60 fps, and uploading all of them
// every frame cost ~3.5 ms. Uploads here are gated on a fresh decoded frame
// (requestVideoFrameCallback), so the steady-state cost is well under that.

import type { CollageClip, CollageEdl } from '@shared/collage'
import { uploadVideoFrame } from './VideoSource'
import { AssembleSource } from './AssembleSource'
import type { CollageSoundDeck, CollageSoundPiece } from '../audio/collageVoice'

/** Same piece cap as the Autocutter : the shader's uniform arrays are sized 64. */
const MAX_CELLS = 64
/** Hard ceiling on simultaneous decoders. */
export const MAX_DECKS = 50
/** Mosaic rows the shader's neighbour search can index. */
const MAX_ROWS = 16
/** Chromium refuses playback rates outside roughly this band. */
const RATE_MIN = 0.0625
const RATE_MAX = 16
/** Array-layer edges the wall picks from (quantised so a modulated `cuts`
 *  can't reallocate the array on every frame). */
const TILE_STEPS = [384, 512, 640, 768, 1024, 1280, 1536, 2048]
/** Memory the deck array may use, whatever the wall. */
const ARRAY_BUDGET = 80 * 1024 * 1024
/** Distinct frame sizes kept as upload staging textures (LRU). */
const STAGING_MAX = 4

/** The array-layer edge for a wall : a piece covers about 1/cuts of the frame
 *  (the biggest cut-up pieces about half as much again), and its cover crop out
 *  of a contain-fitted 16:9 film is ~1/1.8 of the layer edge. So this keeps a
 *  piece near one texel per output pixel, capped by the memory budget shared by
 *  every layer (16 x 1024^2 or 50 x 512^2 both land near 64 MB). */
function tileFor(layers: number, cuts: number, w: number, h: number, maxTex: number): number {
  const piece = Math.sqrt((1.5 * w * h) / Math.max(1, Math.min(cuts, MAX_CELLS)))
  const want = piece * 1.8
  const cap = Math.min(maxTex, Math.sqrt(ARRAY_BUDGET / (4 * Math.max(1, layers))))
  let t = TILE_STEPS[0]
  for (const s of TILE_STEPS) {
    if (s > cap) break
    t = s
    if (s >= want) break
  }
  return t
}

/** A frame of this aspect contain-fitted in a square layer. */
function containRect(w: number, h: number): [number, number, number, number] {
  const av = w > 0 && h > 0 ? w / h : 16 / 9
  const cw = av >= 1 ? 1 : av
  const ch = av >= 1 ? 1 / av : 1
  return [(1 - cw) / 2, (1 - ch) / 2, cw, ch]
}

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

// Contain-fit blit of one decoded frame into its array layer. Runs once per
// deck per DECODED frame, not per rendered frame. When the film is bigger than
// its layer (a 4K clip into a 1024 layer), a 3x3 box of bilinear taps spans
// the texels one layer texel covers, so the shrink doesn't alias.
const FS_TILE = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uSrc;
uniform vec4 uContent;   // where the picture sits inside the square layer
uniform vec2 uFoot;      // one layer texel, in the source frame's UV
uniform int uBox;        // 1 = minifying : box-filter the read
void main(){
  vec2 uv = (vUV - uContent.xy) / uContent.zw;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  vec3 c;
  if (uBox == 1){
    c = vec3(0.0);
    for (int j = -1; j <= 1; j++)
      for (int i = -1; i <= 1; i++)
        c += texture(uSrc, uv + vec2(float(i), float(j)) * uFoot * 0.3333).rgb;
    c *= 1.0 / 9.0;
  } else {
    c = texture(uSrc, uv).rgb;
  }
  o = vec4(c, 1.0);
}`

// The collage itself. The partition, the contour warp, the torn-paper fringe and
// the mask are the Autocutter's in behaviour (same dials, same look), with the
// single difference that a cell samples its own film out of the deck array
// instead of sampling a source rect of the host image. Everything spatial is
// measured in HEIGHT units (x scaled by the aspect), so seams, fringes, warps and
// mosaic shards come out the same width in every direction at 16:9 and on a
// square dome. Compiled TWICE, once per shape (MOSAIC 0/1) : sharing one program
// behind a uniform branch cost the cut-up path ~1.5x in register pressure.
const FS_COLLAGE = (mosaic: boolean, torn: boolean): string => `#version 300 es
#define MOSAIC ${mosaic ? 1 : 0}
#define TORN ${torn ? 1 : 0}
precision highp float;
// GLSL ES 3.00 gives sampler2D a default precision in the fragment stage but
// NOT sampler2DArray : without this line the whole program fails to compile.
precision highp sampler2DArray;
in vec2 vUV; out vec4 o;
uniform sampler2DArray uDecks;
uniform int uCount;
uniform vec4 uCell[64];    // piece rect (x,y,w,h) in output UV (mosaic : the shard's bounding box)
uniform vec4 uCrop[64];    // film rect inside the deck's layer (cover crop)
uniform vec4 uContent[64]; // the deck's picture rect inside its layer; reads mirror inside it
uniform vec4 uMeta[64];    // x deck layer · y quarter turns · z mask rank (survivor 2.0)
uniform vec4 uSite[64];    // mosaic seed (xy, height units)
uniform vec4 uRows[16];    // mosaic rows : x first seed index, y seed count
uniform int uRowCount;
uniform float uGap, uSeed, uContour, uTorn, uMask, uCurve, uAspect, uTexel, uPx;
uniform int uContourMode; // 0 = normal (warp edges only), 1 = warped (warp content too)
uniform int uStraight;    // 1 = straight alpha (drawn straight into the layer), 0 = premultiplied
float vhash(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + uSeed);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p){
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(vhash(i), vhash(i + vec2(1.0, 0.0)), f.x),
             mix(vhash(i + vec2(0.0, 1.0)), vhash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// CONTOUR : a continuous domain warp of the cell lookup. Because every pixel
// still resolves to exactly ONE (warped) cell, the pieces stay a perfect
// tessellation while their boundaries wander and fray like torn paper.
// CURVE LENGTH picks the warp's wavelength : low = many small waves, high = few
// long sweeping curves.
vec2 tearWarp(vec2 p){
  vec2 A = vec2(uAspect, 1.0);
  vec2 q = p * A;
  float fc = mix(12.0, 2.2, clamp(uCurve, 0.0, 1.0));
  float ff = fc * 5.2;
  float fray = (0.25 + 0.2 * max(uContour - 1.0, 0.0)) * (1.0 - 0.7 * uCurve);
  vec2 w = (vec2(vnoise(q * fc), vnoise(q * fc + 31.7)) - 0.5) * (1.0 - fray)
         + (vec2(vnoise(q * ff + 11.3), vnoise(q * ff + 71.9)) - 0.5) * fray;
  return p + w * uContour * 0.045 * (1.0 + uCurve * 1.1) / A;
}
vec2 rot90(vec2 p, float r){
  p -= 0.5; int ri = int(r + 0.5);
  if (ri == 1) p = vec2(-p.y, p.x);
  else if (ri == 2) p = -p;
  else if (ri == 3) p = vec2(p.y, -p.x);
  return p + 0.5;
}
// One piece's film at sUV. Where a piece runs past the film (a frayed NORMAL
// edge, a shard corner) the read MIRRORS back into the picture instead of
// clamping, so an overrun shows real film, never a smeared edge row. The mirror
// sits a texel inside the picture so the black padding never bleeds in.
vec3 film(int i, vec2 sUV){
  vec4 d = uCell[i];
  vec2 luv = rot90((sUV - d.xy) / d.zw, uMeta[i].y);
  vec4 cr = uCrop[i], ct = uContent[i];
  vec2 lo = ct.xy + uTexel;
  vec2 span = max(ct.zw - 2.0 * uTexel, vec2(1e-4));
  vec2 t = (cr.xy + luv * cr.zw - lo) / span;
  t = 1.0 - abs(mod(t, 2.0) - 1.0);
  // An explicit LOD : torn paper reads a neighbour's film inside per-pixel
  // branches, where implicit derivatives are undefined. The decks have no
  // mipmaps, so level 0 is exactly what texture() read.
  return textureLod(uDecks, vec3(lo + t * span, uMeta[i].x), 0.0).rgb;
}
// Seams : a dark cut along every border (height units), floored at a pixel so
// thin cuts never break into dashes.
vec3 seam(vec3 col, float ed){
  if (uGap > 0.001) col *= smoothstep(0.0, max(uGap * 0.02, uPx), ed);
  return col;
}
#if TORN
// TORN PAPER, modelled on a real torn-magazine collage. Along every tear one
// piece lies OVER its neighbour (a per-piece order; a masked piece is a hole and
// always lies under) : only that upper piece shows the white core of the paper,
// where the tear stripped its printed skin at an angle; the other side is just
// covered. The rip line is ragged at every scale, the white is a hairline for
// long stretches and then bites in deep (a heavy-tailed width), its outer rim is
// thin and fibrous (the picture below shows through), a few loose fibres stick
// out past it, the printed skin ends in a faint ink line, and the upper piece
// casts a soft shadow on what lies below, longer on the side away from the light
// (top left). A tear over a hole drops its shadow onto the layers underneath.
// Frame borders are cuts, not tears : no fringe there.
// C : this pixel's piece, N : the piece across the nearest border, ed : distance
// to that border (height units), dir : unit normal from C toward N (height
// units). Returns STRAIGHT colour + alpha.
float order(int i){ return vhash(vec2(float(i) * 1.618 + 0.37, 4.21)); }
vec4 tornPaper(int C, int N, vec3 colC, float keepC, float ed, vec2 dir, vec2 qa, vec2 sUV){
  float keepN = smoothstep(uMask - 0.06, uMask, uMeta[N].z);
  float zC = keepC > 0.5 ? order(C) : -1.0;
  float zN = keepN > 0.5 ? order(N) : -1.0;
  if (zC < 0.0 && zN < 0.0) return vec4(0.0);
  bool upC = zC >= zN;
  float s = upC ? ed : -ed; // signed distance into the upper piece
  float keepU = upC ? keepC : keepN;
  float keepL = upC ? keepN : keepC;
  float T = uTorn;
  float along = dot(qa, vec2(-dir.y, dir.x)); // position along the tear
  // Width : long hairline stretches broken by broad bites.
  float bite = pow(vnoise(vec2(along * 5.0 + 13.7, 3.1)), 3.0);
  float rag = vnoise(vec2(along * 70.0, 9.4));
  float fw = max(T * 0.0095 * (0.10 + 2.8 * bite + 0.55 * rag), 1.5 * uPx);
  // The rip line itself, ragged at every scale. The fine raggedness is the
  // paper's own fibre size, the same however deep the bite (scaling it with the
  // width turned a broad tear furry).
  float ff = min(600.0, 0.5 / uPx);
  float jag = (vnoise(vec2(along * 140.0, 1.7)) - 0.5) * 0.35 * fw
            + (vnoise(vec2(along * ff, 5.3)) - 0.5) * (0.0010 * min(T, 1.5) + 1.2 * uPx);
  // The white sits partly past the cut (the upper piece overlaps its neighbour).
  float eOut = -fw * (0.2 + 0.45 * vnoise(vec2(along * 11.0, 7.7))) + jag;
  float ePrint = eOut + fw;
  if (s >= ePrint){
    // The upper piece's printed skin; a faint ink line where it broke off.
    vec3 cu = upC ? colC : film(N, sUV);
    float ink = 1.0 - 0.16 * min(T, 1.0) * (1.0 - smoothstep(0.0, 0.15 * fw + 1.5 * uPx, s - ePrint));
    return vec4(cu * ink, keepU);
  }
  vec3 cl = upC ? film(N, sUV) : colC; // the lower piece, under the white and the shadow
  // Paper core : warm off-white, a fine fibrous grain, a little greyer where the
  // bevel turns under the print.
  float fq = min(330.0, 0.33 / uPx);
  vec3 paper = vec3(0.95, 0.935, 0.90) * (0.88 + 0.12 * vnoise(qa * 260.0));
  paper *= 1.0 - 0.06 * smoothstep(0.55, 0.95, vnoise(vec2(along * fq, s * 2.0 / fw)));
  if (s >= eOut){
    float t = (s - eOut) / fw;
    paper *= mix(1.0, 0.92, smoothstep(0.55, 1.0, t));
    // The thin fibrous rim (a fibre's width, not a share of the bite) lets the picture through.
    float a = mix(0.55, 1.0, smoothstep(0.0, min(0.35 * fw, 0.0018) + uPx, s - eOut));
    vec4 under = vec4(cl * keepL, keepL);
    vec4 r = vec4(paper, 1.0) * a + under * (1.0 - a);
    return vec4(r.a > 0.002 ? r.rgb / r.a : vec3(0.0), r.a);
  }
  // Past the torn edge : the lower piece, loose fibres, and the upper piece's shadow.
  float past = eOut - s;
  vec2 away = upC ? dir : -dir; // from the upper piece toward the lower
  float lit = 0.3 + 0.7 * max(0.0, dot(away, vec2(0.55, -0.835))); // light from the top left
  float shw = (0.0025 + 0.009 * min(T, 1.5)) * lit;
  float sh = 0.5 * min(T, 1.0) * exp(-past / max(shw, uPx)) * (0.45 + 0.55 * lit);
  // A few loose fibres, short and sparse : paper, not fur.
  float fl = 0.06 * fw + 0.0009 * min(T, 1.5);
  float fib = smoothstep(0.86, 0.98, vnoise(vec2(along * fq, past / max(fl, uPx) * 0.7)))
            * exp(-past / max(fl, uPx)) * 0.7 * min(T * 1.5, 1.0);
  vec4 under = vec4(cl * keepL * (1.0 - sh), keepL + (1.0 - keepL) * sh * 0.85);
  vec4 r = vec4(paper, 1.0) * fib + under * (1.0 - fib);
  return vec4(r.a > 0.002 ? r.rgb / r.a : vec3(0.0), r.a);
}
#endif
void main(){
  vec2 A = vec2(uAspect, 1.0);
  vec3 col = vec3(0.0);
  float keep = 0.0;
  vec2 wUV = uContour > 0.001 ? clamp(tearWarp(vUV), 0.0001, 0.9999) : vUV;
  // CONTOUR MODE : the tear warp always bends where a cell BEGINS (membership +
  // seam/fringe), so the cut edges fray either way. WARPED also samples the film
  // through the warped coordinate (the whole clip inside the cut ripples); NORMAL
  // samples through the un-warped vUV (only the edge frays, the picture stays
  // straight). Membership stays on wUV so the pieces still tessellate.
  vec2 sUV = uContourMode == 1 ? wUV : vUV;
  vec2 qa = wUV * A;

#if MOSAIC
  {
    // MOSAIC : each pixel belongs to its nearest seed, so the pieces are
    // irregular polygons; the border distance (2nd-nearest - nearest) drives the
    // same seams / torn fringe / mask the rectangles use. Seeds sit in rows, so
    // past 16 shards only the neighbouring rows and columns are searched.
    int mi = 0, mi2 = 0; float d1 = 1e9, d2 = 1e9;
    if (uCount <= 16 || uRowCount < 1){
      for (int i = 0; i < 64; i++){
        if (i >= uCount) break;
        float dd = distance(qa, uSite[i].xy);
        if (dd < d1){ d2 = d1; mi2 = mi; d1 = dd; mi = i; }
        else if (dd < d2){ d2 = dd; mi2 = i; }
      }
    } else {
      int r0 = clamp(int(wUV.y * float(uRowCount)), 0, uRowCount - 1);
      for (int dr = -1; dr <= 1; dr++){
        int r = r0 + dr;
        if (r < 0 || r >= uRowCount) continue;
        vec4 R = uRows[r];
        int b = int(R.x + 0.5);
        int k = int(R.y + 0.5);
        int c0 = clamp(int(wUV.x * R.y), 0, k - 1);
        for (int dc = -2; dc <= 2; dc++){
          int c = c0 + dc;
          if (c < 0 || c >= k) continue;
          float dd = distance(qa, uSite[b + c].xy);
          if (dd < d1){ d2 = d1; mi2 = mi; d1 = dd; mi = b + c; }
          else if (dd < d2){ d2 = dd; mi2 = b + c; }
        }
      }
    }
    keep = smoothstep(uMask - 0.06, uMask, uMeta[mi].z);
    float ed = 0.5 * (d2 - d1);
    col = film(mi, sUV);
#if TORN
    if (uCount > 1 && mi2 != mi && ed < uTorn * 0.035 + 0.02){
      vec2 dv = uSite[mi2].xy - uSite[mi].xy;
      vec4 tp = tornPaper(mi, mi2, col, keep, ed, dv / max(length(dv), 1e-5), qa, sUV);
      col = tp.rgb; keep = tp.a;
    }
#endif
    col = seam(col, ed);
  }
#else
  {
    // CUT-UP : find the rectangle, then read its film ONCE outside the loop (a
    // texture read inside the divergent search loop cost ~2x).
    int hit = 0;
    for (int i = 0; i < 64; i++){
      if (i >= uCount) break;
      vec4 d = uCell[i];
      if (wUV.x >= d.x && wUV.x < d.x + d.z && wUV.y >= d.y && wUV.y < d.y + d.w){ hit = i; break; }
    }
    vec4 d = uCell[hit];
    keep = smoothstep(uMask - 0.06, uMask, uMeta[hit].z);
    vec2 elo = (wUV - d.xy) * A;
    vec2 ehi = (d.xy + d.zw - wUV) * A;
    float ed = elo.x; vec2 dir = vec2(-1.0, 0.0);
    if (ehi.x < ed){ ed = ehi.x; dir = vec2(1.0, 0.0); }
    if (elo.y < ed){ ed = elo.y; dir = vec2(0.0, -1.0); }
    if (ehi.y < ed){ ed = ehi.y; dir = vec2(0.0, 1.0); }
    col = film(hit, sUV);
#if TORN
    if (ed < uTorn * 0.035 + 0.02){
      // The piece just across the nearest border (none past the frame : a cut,
      // not a tear). Only pixels near a border pay for this second search.
      vec2 pr = wUV + dir * (ed + 0.5 * uPx) / A;
      int nb = -1;
      if (pr.x > 0.0 && pr.x < 1.0 && pr.y > 0.0 && pr.y < 1.0){
        for (int i = 0; i < 64; i++){
          if (i >= uCount) break;
          vec4 c = uCell[i];
          if (i != hit && pr.x >= c.x && pr.x < c.x + c.z && pr.y >= c.y && pr.y < c.y + c.w){ nb = i; break; }
        }
      }
      if (nb >= 0){
        vec4 tp = tornPaper(hit, nb, col, keep, ed, dir, qa, sUV);
        col = tp.rgb; keep = tp.a;
      }
    }
#endif
    col = seam(col, ed);
  }
#endif
  // Masked pieces leave TRANSPARENT holes, so the layers underneath show through.
  vec3 c = clamp(col, 0.0, 1.0);
  o = uStraight == 1 ? vec4(keep > 0.0 ? c : vec3(0.0), keep) : vec4(c * keep, keep);
}`

// Fold : scale one premultiplied wall by uAmt (blended onto another with a
// constant-alpha blend, it re-captures a crossfade frozen mid-way).
const FS_FOLD = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uTex; uniform float uAmt;
void main(){ o = texture(uTex, vUV) * uAmt; }`

// Show : the premultiplied wall (or a dissolve of two, which premultiplied
// buffers make a plain mix) back to the STRAIGHT alpha the blend stack reads.
const FS_SHOW = `#version 300 es
precision highp float; in vec2 vUV; out vec4 o;
uniform sampler2D uCur; uniform sampler2D uPrev;
uniform float uT; uniform int uFading;
void main(){
  vec4 c = texture(uCur, vUV);
  if (uFading == 1) c = mix(texture(uPrev, vUV), c, uT);
  o = c.a > 0.002 ? vec4(min(c.rgb / c.a, vec3(1.0)), c.a) : vec4(0.0);
}`

interface CollageGL {
  tile: WebGLProgram
  collage: WebGLProgram // cut-up
  mosaic: WebGLProgram
  // The torn-paper variants : the torn code is compiled only into the programs
  // that use it, so a collage with torn at 0 runs exactly the plain programs.
  // Linked with the rest, never mid-show (a first torn turn must not hitch).
  torn: { collage: WebGLProgram; mosaic: WebGLProgram; uColl: (n: string) => WebGLUniformLocation | null; uMos: (n: string) => WebGLUniformLocation | null }
  fold: WebGLProgram
  show: WebGLProgram
  vao: WebGLVertexArrayObject
  quad: WebGLBuffer
  uTile: (n: string) => WebGLUniformLocation | null
  uColl: (n: string) => WebGLUniformLocation | null
  uMos: (n: string) => WebGLUniformLocation | null
  uFold: (n: string) => WebGLUniformLocation | null
  uShow: (n: string) => WebGLUniformLocation | null
}

// Programs, the quad and its OWN vertex array are shared per context and never
// deleted. The ISF runtime keeps its quads on the DEFAULT vertex array's
// attribute 0, which this source must never rewire (see the default-VAO
// landmine). After a GPU reset the same context object comes back with every
// program dead, so a cached set is only reused while its program is live.
const shared = new WeakMap<WebGL2RenderingContext, CollageGL>()
function collageGL(gl: WebGL2RenderingContext): CollageGL {
  const hit = shared.get(gl)
  if (hit && gl.isProgram(hit.collage) && gl.isProgram(hit.mosaic) && gl.isProgram(hit.torn.collage) && gl.isVertexArray(hit.vao)) return hit
  const compile = (type: number, src: string): WebGLShader => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
      console.error('[collage] shader compile:', gl.getShaderInfoLog(s))
    return s
  }
  const link = (fs: string): WebGLProgram => {
    const p = gl.createProgram()!
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs))
    gl.bindAttribLocation(p, 0, 'p')
    gl.linkProgram(p)
    if (!gl.getProgramParameter(p, gl.LINK_STATUS))
      console.error('[collage] link:', gl.getProgramInfoLog(p))
    return p
  }
  const tile = link(FS_TILE)
  const collage = link(FS_COLLAGE(false, false))
  const mosaic = link(FS_COLLAGE(true, false))
  const tornColl = link(FS_COLLAGE(false, true))
  const tornMos = link(FS_COLLAGE(true, true))
  const fold = link(FS_FOLD)
  const show = link(FS_SHOW)
  const vao = gl.createVertexArray()!
  gl.bindVertexArray(vao)
  const quad = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, quad)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0)
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  gl.bindVertexArray(null)
  gl.bindBuffer(gl.ARRAY_BUFFER, null)
  const cacheOf = (p: WebGLProgram): ((n: string) => WebGLUniformLocation | null) => {
    const c = new Map<string, WebGLUniformLocation | null>()
    return (n) => {
      if (!c.has(n)) c.set(n, gl.getUniformLocation(p, n))
      return c.get(n)!
    }
  }
  const g: CollageGL = {
    tile, collage, mosaic, fold, show, vao, quad,
    uTile: cacheOf(tile), uColl: cacheOf(collage), uMos: cacheOf(mosaic),
    uFold: cacheOf(fold), uShow: cacheOf(show),
    torn: { collage: tornColl, mosaic: tornMos, uColl: cacheOf(tornColl), uMos: cacheOf(tornMos) }
  }
  shared.set(gl, g)
  return g
}

const num = (v: number | number[] | undefined, d: number): number => (typeof v === 'number' ? v : d)
const clampf = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v)
/** The window length the wall actually uses : under ~0.4 s a window seeks back so
 *  often the decoder never settles, so it means "whole film". Quantised so a
 *  slow knob turn re-windows in steps, not every frame. */
const holdQ = (hold: number): number => (hold > 0.4 ? Math.round(hold * 10) / 10 : 0)

/** Deterministic PRNG so a seed replays the same deal. */
function mulberry32(a: number): () => number {
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** The file behind an opsia-media:// URL (null for anything else). */
function pathFromMediaUrl(url: string | undefined): string | null {
  const pfx = 'opsia-media://local/'
  if (!url || !url.startsWith(pfx)) return null
  try { return decodeURIComponent(url.slice(pfx.length)) } catch { return null }
}

/** Does an assemblage deck have a decoded frame waiting? AssembleSource.upload()
 *  hands back its texture every frame whether or not a new frame arrived, so
 *  read its live deck's flag instead of re-blitting a still frame 60 times a
 *  second. Falls back to "yes" if that shape ever changes. */
function asmFresh(a: AssembleSource): boolean {
  const p = a as unknown as { decks?: Array<{ pending?: boolean }>; live?: number }
  const dk = p.decks?.[p.live ?? 0]
  return dk ? dk.pending !== false : true
}

interface Deck {
  // Exactly one of these drives the deck. `asm` decks play a saved assemblage
  // (its own edit, its own cuts, its own ping-pong pair for cross-file cuts);
  // `el` decks loop a window of a single file.
  asm: AssembleSource | null
  el: HTMLVideoElement
  src: string // file currently loaded ('' = nothing)
  clip: CollageClip | null
  inSec: number // window start
  lenSec: number // window length (the whole file when looping natively)
  content: [number, number, number, number] // picture rect inside the layer, AS BLITTED
  blitted: boolean // the array layer holds a frame of this deck
  blitAt: number // performance.now() of the last blit
  blitT: number // the element's currentTime at the last blit
  pending: boolean // a decoded frame is waiting to be blitted
  rvfc: number
  seeking: boolean // gate : never queue a second seek
  seekAt: number
  pendingSeek: (() => void) | null // a deferred 'loadedmetadata' seek, replaceable
  churning: boolean // re-rolls its film on the fast clock
  nextRoll: number // layer seconds until this deck re-rolls (churn only)
  pan: [number, number] // where this deck's cells frame the picture
  panNext: [number, number] | null // framing for the film just cued, applied with its first frame
  varyU: number // -1..1 : this film's place in the speed spread
  used: boolean // at least one piece plays this deck
  shown: boolean // ... and at least one of those isn't masked out
  running: boolean // (asm decks) what the edit was last told
  needFrame: boolean // cued while frozen : play until one frame of it lands
}

interface Cell {
  x: number
  y: number
  w: number
  h: number
  deck: number
  rot: number
  rotA: number // rotate draws, fixed per partition so the dial sweeps monotonically
  rotB: number
  crop: [number, number, number, number]
}

export class CollageSource {
  private decks: Deck[] = []
  private cells: Cell[] = []
  private arr: WebGLTexture | null = null
  private arrLayers = 0
  private tile = 512
  private tilePending = 0
  private tileWait = 0
  private maxTex: number
  private fbo: WebGLFramebuffer | null = null
  private staging = new Map<string, WebGLTexture>()
  private pool: CollageClip[] = []
  private poolKey = ''
  private poolFiles = ''
  private poolRef: CollageClip[] | null = null
  private poolDirty = false
  private filesDirty = false
  private edls: CollageEdl[] = []
  private edlKey = ''
  private edlRef: CollageEdl[] | null = null
  private edlDirty = false
  private lastFeed = -1
  /** Base inputs from the store, overlaid by modulation's per-frame writes. */
  private live: Record<string, number | number[]> = {}
  private folder = '' // the pool's folder (older pools rebuild original paths from it)
  // Every instance starts from its own seed : two walls on the same folder (two
  // slots, or a layer and the background) must not deal the same wall.
  private seed = (Math.random() * 0x100000000) >>> 0
  // Churn re-rolls draw from ONE running generator, reseeded at each deal, so
  // successive re-rolls differ (a PRNG rebuilt from the same seed every frame
  // drew the same film, crop and window for every roll).
  private rollRnd = mulberry32(this.seed ^ 0x2545f491)
  private prevDeal = 0
  private dealTimer = 0
  private lastT = 0
  // The layer clock handed to render() : dt comes from it, and its rate over
  // realtime (measured over short windows) scales every film's playback rate.
  private lastClock: number | null = null
  private clockMul = 1
  private mulKnown = false
  private ringT = new Float64Array(128) // (real seconds, clock seconds) of recent frames
  private ringC = new Float64Array(128)
  private ringN = 0
  private ringI = 0
  private settleUntil = 0
  private stillFrames = 0
  private lastCuts = -1
  private lastRotate = -1
  private lastZoom = -1
  private lastFilms = -1
  private lastShape = -1
  private holdNow = 0 // the window the decks loop (quantised)
  private holdWant = 0 // a new window waiting out its debounce
  private holdWait = 0
  private cropsDirty = false
  private disposed = false
  // Crossfade : the collage draws into `cur`, then composites into the layer's
  // scratch target. `prev` holds the last SETTLED wall; on a re-deal it becomes
  // the outgoing (frozen) layer that `cur` dissolves out of. `xfade` is progress
  // 0..1 (1 = settled). Only allocated once a crossfade time is set : with none,
  // the wall draws straight into the layer.
  private cur: { tex: WebGLTexture; fbo: WebGLFramebuffer } | null = null
  private prev: { tex: WebGLTexture; fbo: WebGLFramebuffer } | null = null
  private prevValid = false
  private xfade = 1
  private xfadeDur = 0
  // Bumped on every re-cut of the wall : Sonify's Collage voice crossfades its
  // pieces on it, over xfadeDur.
  private dealSerial = 0
  private foldAt: number | null = null // a deal landed mid-fade : fold the visible mix into prev first
  // Uniform staging, allocated once.
  private cellArr = new Float32Array(MAX_CELLS * 4)
  private cropArr = new Float32Array(MAX_CELLS * 4)
  private contentArr = new Float32Array(MAX_CELLS * 4)
  private metaArr = new Float32Array(MAX_CELLS * 4)
  private siteArr = new Float32Array(MAX_CELLS * 4)
  private rowsArr = new Float32Array(MAX_ROWS * 4)
  private rowCount = 0
  private rank = new Float32Array(MAX_CELLS)

  constructor(
    private gl: WebGL2RenderingContext,
    private w: number,
    private h: number
  ) {
    this.maxTex = Math.max(1024, Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 2048)
  }

  // ── Decks ──────────────────────────────────────────────────────────────

  private makeDeck(): Deck {
    const el = document.createElement('video')
    el.muted = true
    el.loop = true
    el.playsInline = true
    el.preload = 'auto'
    el.crossOrigin = 'anonymous'
    const deck: Deck = {
      asm: null,
      el, src: '', clip: null, inSec: 0, lenSec: 0,
      content: [0, 0, 1, 1], blitted: false, blitAt: 0, blitT: -1, pending: false, rvfc: 0, seeking: false, seekAt: 0,
      pendingSeek: null, churning: false, nextRoll: 0, pan: [0.5, 0.5], panNext: null,
      varyU: 0, used: true, shown: true, running: true, needFrame: false
    }
    el.addEventListener('seeked', () => { deck.seeking = false; deck.pending = true })
    // A bad file must never wedge the wall : clear the gate and let the deck
    // sit on whatever frame it has.
    el.addEventListener('error', () => { deck.seeking = false })
    // A new src aborts any seek in flight WITHOUT a 'seeked' : clear the gate,
    // or the window loop waits on a seek that will never report back.
    el.addEventListener('emptied', () => { deck.seeking = false })
    const step = (): void => {
      deck.pending = true
      if (typeof el.requestVideoFrameCallback === 'function')
        deck.rvfc = el.requestVideoFrameCallback(step)
    }
    if (typeof el.requestVideoFrameCallback === 'function')
      deck.rvfc = el.requestVideoFrameCallback(step)
    return deck
  }

  /** An assemblage-fed deck : AssembleSource already owns playlist walking,
   *  gated seeks and the ping-pong pair that makes cross-FILE cuts free, so
   *  there is no second implementation of any of it here. */
  private makeAsmDeck(edl: CollageEdl, rnd: () => number): Deck {
    const asm = new AssembleSource(this.gl)
    asm.setPlaylist(edl.clips, true)
    asm.setPlaying(true)
    return {
      asm, el: document.createElement('video'), src: edl.id, clip: null,
      inSec: 0, lenSec: 0, content: [0, 0, 1, 1], blitted: false, blitAt: 0, blitT: -1, pending: false, rvfc: 0,
      seeking: false, seekAt: 0, pendingSeek: null, churning: false, nextRoll: 0,
      pan: [0.5, 0.5], panNext: null, varyU: rnd() * 2 - 1, used: true, shown: true,
      running: true, needFrame: false
    }
  }

  private killDeck(d: Deck): void {
    if (d.asm) {
      // The texture belongs to the AssembleSource : disposing that frees it.
      d.asm.dispose()
      d.asm = null
      return
    }
    try {
      if (d.pendingSeek) d.el.removeEventListener('loadedmetadata', d.pendingSeek)
      d.pendingSeek = null
      if (d.rvfc && typeof d.el.cancelVideoFrameCallback === 'function')
        d.el.cancelVideoFrameCallback(d.rvfc)
      d.el.pause()
      d.el.removeAttribute('src')
      d.el.load()
    } catch {
      /* teardown is best-effort */
    }
  }

  private setDeckCount(n: number, cuts: number): void {
    n = Math.max(1, Math.min(MAX_DECKS, Math.round(n)))
    while (this.decks.length > n) this.killDeck(this.decks.pop()!)
    while (this.decks.length < n) this.decks.push(this.makeDeck())
    const t = tileFor(n, cuts, this.w, this.h, this.maxTex)
    if (this.arrLayers !== n || this.tile !== t) this.allocArray(n, t)
  }

  /** One deck per selected assemblage. Rebuilt whenever the selection changes;
   *  identity is the edl id list, so re-picking the same set is a no-op. */
  private setAsmDecks(edls: CollageEdl[], cuts: number): void {
    const want = edls.slice(0, MAX_DECKS)
    for (const d of this.decks) this.killDeck(d)
    const rnd = mulberry32(this.seed ^ 0x51ed27)
    this.decks = want.map((e) => this.makeAsmDeck(e, rnd))
    this.allocArray(this.decks.length, tileFor(this.decks.length, cuts, this.w, this.h, this.maxTex))
  }

  /** The pool emptied : stop every decoder and free the array. Nothing plays
   *  until a new pool (or feed) arrives, which rebuilds from scratch. */
  private park(): void {
    if (!this.decks.length && !this.arr) return
    for (const d of this.decks) this.killDeck(d)
    this.decks = []
    this.cells = []
    if (this.arr) this.gl.deleteTexture(this.arr)
    this.arr = null
    this.arrLayers = 0
    this.lastFilms = -1
    this.lastCuts = -1
    this.lastFeed = -1
    this.prevValid = false
    this.xfade = 1
    this.foldAt = null
  }

  private allocArray(layers: number, tile: number): void {
    const gl = this.gl
    if (this.arr) gl.deleteTexture(this.arr)
    this.arr = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.arr)
    this.tile = tile
    this.tilePending = 0
    gl.texImage3D(gl.TEXTURE_2D_ARRAY, 0, gl.RGBA8, tile, tile, layers, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
    if (!this.fbo) this.fbo = gl.createFramebuffer()
    this.arrLayers = layers
    // Every deck must re-blit into the new storage.
    for (const d of this.decks) {
      d.pending = true
      d.blitted = false
    }
  }

  /** One output-sized RGBA8 target (colour + FBO) for the crossfade ping-pong. */
  private makeOut(): { tex: WebGLTexture; fbo: WebGLFramebuffer } {
    const gl = this.gl
    const tex = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.w, this.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    const fbo = gl.createFramebuffer()!
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
    gl.bindTexture(gl.TEXTURE_2D, null)
    return { tex, fbo }
  }

  private ensureOut(): void {
    if (!this.cur) this.cur = this.makeOut()
    if (!this.prev) this.prev = this.makeOut()
  }

  /** Upload one element's current frame into the staging texture for its frame
   *  size. Each blit reads its staging texture right after the upload, so decks
   *  of the same size share one (a handful in total instead of one full-size
   *  texture per deck); keeping one per SIZE means a texture is never
   *  re-specified at a different size between two decks. */
  private uploadStaged(el: HTMLVideoElement): WebGLTexture | null {
    const key = `${el.videoWidth}x${el.videoHeight}`
    const hit = this.staging.get(key) ?? null
    if (hit) this.staging.delete(key)
    else if (this.staging.size >= STAGING_MAX) {
      const oldest = this.staging.keys().next().value as string
      const t = this.staging.get(oldest)
      if (t) this.gl.deleteTexture(t)
      this.staging.delete(oldest)
    }
    const t = uploadVideoFrame(this.gl, el, hit)
    if (t) this.staging.set(key, t) // (re)insert : most recently used last
    return t
  }

  // ── Dealing ────────────────────────────────────────────────────────────

  /** Give every deck a clip and a window. `rnd` keeps a deal reproducible. */
  private deal(hold: number, churn: number): void {
    if (!this.pool.length) return
    const rnd = mulberry32(this.seed)
    const n = this.decks.length
    const nChurn = Math.round(churn * n)
    // Draw without repeats while the pool allows it, so a deal shows as many
    // different films as it can before it starts doubling up.
    const bag: CollageClip[] = []
    for (let i = 0; i < n; i++) {
      if (!bag.length) {
        bag.push(...this.pool)
        for (let k = bag.length - 1; k > 0; k--) {
          const j = Math.floor(rnd() * (k + 1))
          const t = bag[k]; bag[k] = bag[j]; bag[j] = t
        }
      }
      const clip = bag.pop()!
      const d = this.decks[i]
      // The churning decks are the FIRST `churn x n` : deterministic, so the
      // dial sweeps in a stable order instead of reshuffling who churns.
      d.churning = i < nChurn
      this.cue(d, clip, hold, rnd, false)
      d.panNext = [rnd(), rnd()]
      d.nextRoll = (0.25 + rnd() * 1.2) / Math.max(0.15, churn)
    }
    this.rollRnd = mulberry32((this.seed ^ 0x2545f491) >>> 0)
    this.holdNow = this.holdWant = holdQ(hold)
    this.holdWait = 0
  }

  /** Point one deck at a clip and a window inside it. A whole-film cue starts
   *  at the top, except a churn re-roll, which drops in anywhere (a montage of
   *  opening seconds is not a montage). */
  private cue(d: Deck, clip: CollageClip, hold: number, rnd: () => number, randomStart: boolean): void {
    const url = `opsia-media://local/${encodeURIComponent(clip.file)}`
    const dur = Math.max(0.1, clip.durSec)
    const len = hold > 0.4 ? Math.min(hold, dur) : dur
    const whole = len >= dur - 0.05
    const start = whole ? (randomStart ? rnd() * dur * 0.8 : 0) : rnd() * (dur - len)
    d.clip = clip
    d.inSec = whole ? 0 : start
    d.lenSec = whole ? dur : len
    d.varyU = rnd() * 2 - 1
    // Until its first frame lands the layer is empty; frame the crop on the
    // probed size meanwhile (the blit records the real one).
    if (!d.blitted) d.content = containRect(clip.width, clip.height)
    if (d.src !== url) this.loadInto(d, url)
    // A window that is the whole file loops natively : no seeking at all, which
    // is by far the smoothest path. Sub-windows need the gated seek below.
    d.el.loop = whole
    d.needFrame = true
    this.seekTo(d, start)
  }

  private loadInto(d: Deck, url: string): void {
    if (d.pendingSeek) d.el.removeEventListener('loadedmetadata', d.pendingSeek)
    d.pendingSeek = null
    d.seeking = false
    d.src = url
    d.el.src = url
    d.el.load()
  }

  /** Optimise re-encoded the pool : same clips (same ids), new playable files.
   *  Swap each deck onto its new file at the same moment of the film. */
  private swapFiles(): void {
    const byId = new Map(this.pool.map((c) => [c.id, c]))
    for (const d of this.decks) {
      if (d.asm || !d.clip) continue
      const nc = byId.get(d.clip.id)
      if (!nc || nc.file === d.clip.file) continue
      const t = d.el.readyState >= 1 ? d.el.currentTime : d.inSec
      d.clip = nc
      this.loadInto(d, `opsia-media://local/${encodeURIComponent(nc.file)}`)
      d.needFrame = true
      this.seekTo(d, t)
    }
  }

  /** A deck's new film, never the one it is already playing when the pool has
   *  another. */
  private pickOther(cur: CollageClip | null): CollageClip | null {
    const P = this.pool
    if (!P.length) return cur
    if (P.length === 1) return P[0]
    let i = Math.floor(this.rollRnd() * P.length)
    if (cur && P[i].id === cur.id) i = (i + 1 + Math.floor(this.rollRnd() * (P.length - 1))) % P.length
    return P[i]
  }

  /** The window knob moved : re-window every deck around where its playhead
   *  already is. No seek, no new film : the loop point just moves. */
  private rewindow(d: Deck, hold: number): void {
    if (d.asm || !d.clip) return
    const ed = d.el.duration
    const dur = Number.isFinite(ed) && ed > 0 ? ed : Math.max(0.1, d.clip.durSec)
    const len = hold > 0.4 ? Math.min(hold, dur) : dur
    if (len >= dur - 0.05) {
      d.inSec = 0
      d.lenSec = dur
      d.el.loop = true
      return
    }
    const t = d.el.readyState >= 1 ? d.el.currentTime : d.inSec
    d.inSec = clampf(t - 0.05, 0, dur - len)
    d.lenSec = len
    d.el.loop = false
  }

  /** One seek in flight per deck, with a stall safety net : a per-frame
   *  currentTime write means the decoder never settles (same law as
   *  VideoSource.seekTowardPos and AssembleSource.seekGated). */
  private seekTo(d: Deck, t: number): void {
    const now = performance.now()
    if (d.seeking && now - d.seekAt < 4000) return
    d.seeking = false
    if (d.el.readyState < 1) {
      // Metadata not in yet : defer, REPLACING any earlier deferred seek. A
      // stacked `{once}` handler fires the OLDEST first and parks the deck at a
      // window belonging to a clip it no longer plays (same bug AssembleSource
      // fixes with pendingSeek).
      if (d.pendingSeek) d.el.removeEventListener('loadedmetadata', d.pendingSeek)
      const fn = (): void => { d.pendingSeek = null; this.seekTo(d, t) }
      d.pendingSeek = fn
      d.el.addEventListener('loadedmetadata', fn, { once: true })
      return
    }
    if (Math.abs(d.el.currentTime - t) < 0.05) return
    d.seeking = true
    d.seekAt = now
    try {
      d.el.currentTime = Math.max(0, Math.min(t, (d.el.duration || t + 1) - 0.05))
    } catch {
      d.seeking = false
    }
  }

  // ── Partition ──────────────────────────────────────────────────────────

  /** Cut-up : the Autocutter's BSP, split the largest cell until `cuts` pieces.
   *  Each cell is a rect {x,y = top-left, w,h = size}. */
  private bspRects(cuts: number, rnd: () => number): Array<{ x: number; y: number; w: number; h: number }> {
    const minW = 0.06, minH = 0.06
    const rects: Array<{ x: number; y: number; w: number; h: number }> = [{ x: 0, y: 0, w: 1, h: 1 }]
    while (rects.length < cuts) {
      let idx = -1, area = -1
      for (let i = 0; i < rects.length; i++) {
        const c = rects[i]
        if (c.w >= minW * 2 || c.h >= minH * 2) {
          const a = c.w * c.h
          if (a > area) { area = a; idx = i }
        }
      }
      if (idx < 0) break
      const c = rects[idx]
      const canV = c.w >= minW * 2, canH = c.h >= minH * 2
      const vertical = canV && canH ? rnd() < c.w / (c.w + c.h) : canV
      const t = 0.35 + rnd() * 0.3
      if (vertical) {
        const sw = c.w * t
        rects.splice(idx, 1, { x: c.x, y: c.y, w: sw, h: c.h }, { x: c.x + sw, y: c.y, w: c.w - sw, h: c.h })
      } else {
        const sh = c.h * t
        rects.splice(idx, 1, { x: c.x, y: c.y, w: c.w, h: sh }, { x: c.x, y: c.y + sh, w: c.w, h: c.h - sh })
      }
    }
    return rects
  }

  /** Mosaic : jittered seeds in ROWS whose counts differ by at most one (so a
   *  cut count that isn't a rectangle never leaves one seed covering half a row),
   *  rows chosen so the shards come out roughly square at the output aspect.
   *  Each shard's cell is its real BOUNDING BOX (measured on a coarse grid), so
   *  the film is cover-cropped to the shape it actually fills. Seeds go to the
   *  shader in height units, row by row, for its neighbour search. */
  private mosaicSeeds(cuts: number, rnd: () => number): Array<{ x: number; y: number; w: number; h: number }> {
    const n = Math.min(cuts, MAX_CELLS)
    const aspect = this.w / this.h
    const rows = Math.max(1, Math.min(MAX_ROWS, n, Math.round(Math.sqrt(n / aspect))))
    const base = Math.floor(n / rows), extra = n % rows
    const sx: number[] = [], sy: number[] = []
    let idx = 0
    this.rowsArr.fill(0)
    for (let r = 0; r < rows; r++) {
      // Spread the rows that get one extra seed evenly down the frame.
      const k = base + (Math.floor(((r + 1) * extra) / rows) - Math.floor((r * extra) / rows))
      this.rowsArr[r * 4] = idx
      this.rowsArr[r * 4 + 1] = k
      for (let c = 0; c < k; c++) {
        sx.push(((c + 0.15 + rnd() * 0.7) / k) * aspect)
        sy.push((r + 0.15 + rnd() * 0.7) / rows)
        idx++
      }
    }
    this.rowCount = rows
    this.siteArr.fill(0)
    for (let i = 0; i < n; i++) {
      this.siteArr[i * 4] = sx[i]
      this.siteArr[i * 4 + 1] = sy[i]
    }
    // Bounding boxes : nearest seed on a coarse grid (exact brute force; only on
    // a deal or a cut change), padded by one grid step.
    const GW = 96, GH = Math.max(32, Math.min(160, Math.round(96 / aspect)))
    const bx0 = new Array(n).fill(1), by0 = new Array(n).fill(1)
    const bx1 = new Array(n).fill(0), by1 = new Array(n).fill(0)
    for (let gy = 0; gy < GH; gy++) {
      const v = (gy + 0.5) / GH
      for (let gx = 0; gx < GW; gx++) {
        const u = (gx + 0.5) / GW
        const qx = u * aspect
        let best = 0, bd = 1e9
        for (let i = 0; i < n; i++) {
          const dx = qx - sx[i], dy = v - sy[i]
          const dd = dx * dx + dy * dy
          if (dd < bd) { bd = dd; best = i }
        }
        if (u < bx0[best]) bx0[best] = u
        if (u > bx1[best]) bx1[best] = u
        if (v < by0[best]) by0[best] = v
        if (v > by1[best]) by1[best] = v
      }
    }
    const px = 1 / GW, py = 1 / GH
    const out: Array<{ x: number; y: number; w: number; h: number }> = []
    for (let i = 0; i < n; i++) {
      // A seed that owned no grid sample (can't happen with this jitter, but be
      // safe) gets a nominal box around itself.
      if (bx1[i] < bx0[i]) { bx0[i] = sx[i] / aspect - 0.05; bx1[i] = sx[i] / aspect + 0.05; by0[i] = sy[i] - 0.05; by1[i] = sy[i] + 0.05 }
      const x0 = Math.max(0, bx0[i] - px), x1 = Math.min(1, bx1[i] + px)
      const y0 = Math.max(0, by0[i] - py), y1 = Math.min(1, by1[i] + py)
      out.push({ x: x0, y: y0, w: Math.max(1e-3, x1 - x0), h: Math.max(1e-3, y1 - y0) })
    }
    return out
  }

  /** Rebuild the partition (cut-up rects or mosaic shards), then deal decks
   *  round-robin over it and assign the mask dropout order. */
  private rebuildCells(cuts: number, shape: number): void {
    this.dealSerial++
    const rnd = mulberry32((this.seed ^ 0x9e3779b9) >>> 0)
    let rects: Array<{ x: number; y: number; w: number; h: number }>
    if (shape === 1) rects = this.mosaicSeeds(cuts, rnd)
    else {
      rects = this.bspRects(cuts, rnd)
      this.rowCount = 0
    }
    if (rects.length > MAX_CELLS) rects = rects.slice(0, MAX_CELLS)
    const n = rects.length
    const nd = Math.max(1, this.decks.length)
    // Deal decks round-robin over a SHUFFLED cell order, so when there are more
    // cuts than films the repeats are scattered instead of landing side by side.
    const order = rects.map((_, i) => i)
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const t = order[i]; order[i] = order[j]; order[j] = t
    }
    this.cells = rects.map((r) => ({
      ...r, deck: 0, rot: 0, rotA: 1, rotB: 0, crop: [0, 0, 1, 1] as [number, number, number, number]
    }))
    for (let i = 0; i < n; i++) {
      const c = this.cells[order[i]]
      c.deck = i % nd
      // ALWAYS two draws, whatever the rotate dial : a draw taken only on a hit
      // shifted every later draw, so sweeping rotate reshuffled the mask order.
      c.rotA = rnd()
      c.rotB = rnd()
    }
    // MASK dropout order : a shuffled EVEN spacing over (0,0.90] so the dial
    // peels pieces at a steady rate. The ceiling sits below the shader's 0.06
    // fade band, and one seeded survivor holds an unreachable 2.0 : so full
    // mask always leaves exactly one piece, and every deal elects a new one.
    const drop = rects.map((_, i) => i)
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      const t = drop[i]; drop[i] = drop[j]; drop[j] = t
    }
    for (let i = 0; i < n; i++) this.rank[drop[i]] = ((i + 1) / n) * 0.9
    if (n) this.rank[Math.floor(rnd() * n)] = 2.0
    for (const d of this.decks) d.used = false
    for (const c of this.cells) if (this.decks[c.deck]) this.decks[c.deck].used = true
    this.lastCuts = cuts
    this.lastShape = shape
    this.lastRotate = -1 // re-apply the dial to the fresh draws
    this.cropsDirty = true
  }

  /** The rotate dial : the pieces whose own draw falls under it turn. */
  private applyRotate(rotate: number): void {
    for (const c of this.cells) c.rot = c.rotA < rotate ? 1 + Math.floor(c.rotB * 3) : 0
    this.lastRotate = rotate
    this.cropsDirty = true
  }

  /** Cover-crop each cell's window into its deck's picture. Cheap, CPU-side,
   *  and re-run whenever the partition, the zoom, or a deck's framed picture
   *  changes. Works on the content rect AS BLITTED, so a freshly cued film of
   *  another aspect doesn't open black bands on the old film's still frame. */
  private rebuildCrops(): void {
    const outAspect = this.w / this.h
    const z = Math.max(1, this.lastZoom > 0 ? this.lastZoom : 1)
    for (const c of this.cells) {
      const d = this.decks[c.deck]
      if (!d) continue
      const [cx, cy, cw, ch] = d.content
      // The layer is square, so the content rect's own ratio IS the clip aspect.
      const av = ch > 0 ? cw / ch : 1
      // The cell's aspect in real pixels; a quarter-turned piece frames the
      // picture through its flipped aspect.
      const raw = (c.w / c.h) * outAspect
      const ac = c.rot % 2 === 1 ? 1 / raw : raw
      let sw: number, sh: number
      if (ac >= av) { sw = cw; sh = ch * (av / ac) } else { sh = ch; sw = cw * (ac / av) }
      sw /= z
      sh /= z
      c.crop = [cx + (cw - sw) * d.pan[0], cy + (ch - sh) * d.pan[1], sw, sh]
    }
    this.cropsDirty = false
  }

  // ── Frame ──────────────────────────────────────────────────────────────

  /** Called every frame by syncFromState with the slot's BASE inputs. The tick
   *  itself runs at render time, because applyModulation lands its overrides
   *  through setInput in between : reading them here would miss a frame and,
   *  worse, make modulated `cuts` / `films` / `mask` inert. */
  update(
    pool: CollageClip[],
    edls: CollageEdl[],
    inputs: Record<string, number | number[]>,
    folder = ''
  ): void {
    this.folder = folder
    if (this.disposed) return
    // A changed pool (new folder, new selection) re-deals from scratch; the same
    // clips with new FILES (an optimise pass) swap in place. The store passes a
    // STABLE array reference until it actually changes, so a cheap reference
    // check gates the per-frame joins (~300 ids x 60 fps).
    if (pool !== this.poolRef) {
      this.poolRef = pool
      const key = pool.map((c) => c.id).join('|')
      const files = pool.map((c) => c.file).join('|')
      if (key !== this.poolKey) {
        this.pool = pool.slice()
        this.poolKey = key
        this.poolFiles = files
        this.poolDirty = true
      } else if (files !== this.poolFiles) {
        this.pool = pool.slice()
        this.poolFiles = files
        this.filesDirty = true
      }
    }
    if (edls !== this.edlRef) {
      this.edlRef = edls
      const ek = edls.map((e) => e.id).join('|')
      if (ek !== this.edlKey) {
        this.edls = edls.slice()
        this.edlKey = ek
        this.edlDirty = true
      }
    }
    this.live = { ...inputs }
  }

  /** Modulation overlay (applyModulation runs after syncFromState). */
  setInput(name: string, value: number | number[]): void {
    this.live[name] = value
  }

  /** For Sonify's Collage voice : every piece (centre, film, shown or masked)
   *  and every film (the video its sound follows, the file to hear). */
  soundInfo(): { pieces: CollageSoundPiece[]; decks: CollageSoundDeck[]; deal: number; xfade: number } | null {
    if (this.disposed || !this.cells.length) return null
    const mask = clampf(num(this.live.mask, 0), 0, 1)
    const pieces: CollageSoundPiece[] = this.cells.map((c, i) => {
      const r = this.rank[i]
      const t = Math.max(0, Math.min(1, (r - (mask - 0.06)) / 0.06))
      return { x: c.x + c.w / 2, y: c.y + c.h / 2, deck: c.deck, keep: mask <= 0 ? 1 : t * t * (3 - 2 * t) }
    })
    const decks: CollageSoundDeck[] = this.decks.map((d) => {
      if (d.asm) {
        // An assemblage deck : follow whichever of its players is on screen,
        // and hear that file.
        const a = d.asm as unknown as { decks?: Array<{ el?: HTMLVideoElement }>; live?: number }
        const el = a.decks?.[a.live ?? 0]?.el ?? null
        const p = el ? pathFromMediaUrl(el.currentSrc || el.src) : null
        return { el, path: p }
      }
      if (!d.src || !d.clip) return { el: null, path: null }
      return { el: d.el, path: this.originalOf(d.clip) }
    })
    return { pieces, decks, deal: this.dealSerial, xfade: this.xfadeDur }
  }

  /** The clip's ORIGINAL file : its own `src`, or the playable file when that
   *  IS the original (same name), or the folder + name for older pools. */
  private originalOf(clip: CollageClip): string {
    if (clip.src) return clip.src
    const base = clip.file.split(/[\\/]/).pop() ?? ''
    if (base === clip.fileName || !this.folder) return clip.file
    const sep = this.folder.includes('\\') ? '\\' : '/'
    return this.folder.replace(/[\\/]+$/, '') + sep + clip.fileName
  }

  private tick(clockSec: number | undefined): void {
    const inputs = this.live
    const now = performance.now()
    // Clamped like the compositor's own frame delta, so a hitch reads the same
    // on both sides of the clock-rate ratio below.
    const realDt = this.lastT ? Math.min(0.2, (now - this.lastT) / 1000) : 0
    this.lastT = now
    let dt = realDt
    if (typeof clockSec === 'number' && Number.isFinite(clockSec)) {
      const cd = this.lastClock === null ? 0 : clockSec - this.lastClock
      this.lastClock = clockSec
      dt = cd > 0 ? Math.min(1, cd) : 0
      // The clock's rate over realtime, for the films' playbackRate. Frames are
      // timed here at render time while the compositor times them at the top of
      // its loop, so one frame's ratio jitters by several percent (tens, on a
      // timer-driven hidden window). A least-squares slope of clock against time
      // over the last second averages every frame instead, and is adopted on a
      // move of more than 3% (then tracked closely for a second while it
      // settles), snapped to 1 within 2%. A steady clock then never rewrites a
      // playbackRate. A stopped clock (layer Speed 0) is caught exactly, in
      // three frames.
      this.stillFrames = dt > 0 ? 0 : this.stillFrames + 1
      if (cd < 0) this.ringN = 0 // the clock went backwards : start over
      if (this.stillFrames >= 3) {
        this.clockMul = 0
        this.ringN = 0
      } else {
        const R = this.ringT.length
        this.ringI = (this.ringI + 1) % R
        this.ringT[this.ringI] = now / 1000
        this.ringC[this.ringI] = clockSec
        this.ringN = Math.min(R, this.ringN + 1)
        const t0 = now / 1000, c0 = clockSec
        let n = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, span = 0
        for (let k = 0; k < this.ringN; k++) {
          const q = (this.ringI - k + R) % R
          const x = this.ringT[q] - t0
          if (x < -1) break
          const y = this.ringC[q] - c0
          n++; sx += x; sy += y; sxx += x * x; sxy += x * y
          span = -x
        }
        const den = n * sxx - sx * sx
        if (n >= 8 && span >= 0.25 && den > 0) {
          const slope = Math.max(0, (n * sxy - sx * sy) / den)
          const est = Math.abs(slope - 1) < 0.02 ? 1 : slope
          const off = Math.abs(est - this.clockMul) / Math.max(est, 0.05)
          if (!this.mulKnown || off > 0.03) {
            this.clockMul = est
            this.mulKnown = true
            this.settleUntil = now + 1000
          } else if (now < this.settleUntil && off > 0.005) {
            this.clockMul = est
          }
        } else if (this.clockMul === 0 && dt > 0 && realDt > 0) {
          // Restarting from a stop : a rough guess until the fit has a second.
          this.clockMul = Math.min(4, dt / realDt)
        }
      }
    }

    const films = clampf(num(inputs.films, 12), 1, MAX_DECKS)
    const cuts = Math.round(clampf(num(inputs.cuts, 12), 2, MAX_CELLS))
    const rotate = clampf(num(inputs.rotate, 0), 0, 1)
    const hold = clampf(num(inputs.hold, 0), 0, 30)
    const churn = clampf(num(inputs.churn, 0), 0, 1)
    const zoom = clampf(num(inputs.zoom, 1.05), 1, 3)
    const speed = clampf(num(inputs.speed, 1), 0.1, 4)
    const vary = clampf(num(inputs.vary, 0), 0, 1)
    const freeze = num(inputs.freeze, 0) >= 0.5
    const rate = clampf(num(inputs.rate, 0), 0, 60)
    const shape = Math.round(clampf(num(inputs.shape, 0), 0, 1))
    const xfadeDur = clampf(num(inputs.xfade, 0), 0, 4)
    const mask = clampf(num(inputs.mask, 0), 0, 1)
    this.xfadeDur = xfadeDur

    // feed 0 = the folder pool (one film per piece) · 1 = the Assemble bank
    // (one saved edit per piece). An empty selection falls back to the folder,
    // so switching the dial before picking anything can't blank the wall.
    const feed = this.edls.length && Math.round(num(inputs.feed, 0)) === 1 ? 1 : 0
    const poolChanged = this.poolDirty
    this.poolDirty = false
    const filesChanged = this.filesDirty
    this.filesDirty = false
    const edlChanged = this.edlDirty
    this.edlDirty = false

    // Nothing to play : stop every decoder rather than keep the old films running.
    if (feed === 0 && !this.pool.length) {
      this.park()
      return
    }

    let deckChanged = feed !== this.lastFeed
    this.lastFeed = feed
    if (feed === 1) {
      if (deckChanged || edlChanged) {
        this.setAsmDecks(this.edls, cuts)
        deckChanged = true
      }
      this.lastFilms = -1 // force a rebuild when the dial goes back to folder
    } else {
      // Leaving assemblage mode : setDeckCount only trims the tail, so kill every
      // asm deck first, else front decks keep playing (and decoding) an edit.
      if (this.decks.some((d) => d.asm)) {
        for (const d of this.decks) this.killDeck(d)
        this.decks = []
        this.lastFilms = -1
      }
      if (Math.round(films) !== this.lastFilms || deckChanged) {
        this.setDeckCount(films, cuts)
        this.lastFilms = Math.round(films)
        deckChanged = true
      }
    }
    // A structural edit (cuts / shape / deck count) rebuilds in place and SNAPS :
    // no dissolve, so the change is legible.
    if (cuts !== this.lastCuts || shape !== this.lastShape || deckChanged) {
      this.xfade = 1
      this.foldAt = null
      this.rebuildCells(cuts, shape)
    }
    // The array's layer edge follows the piece size; debounced, so a modulated
    // `cuts` settles before the array (and every deck's blit) is redone.
    const tileWant = tileFor(this.decks.length, cuts, this.w, this.h, this.maxTex)
    if (tileWant === this.tile) this.tilePending = 0
    else if (tileWant !== this.tilePending) {
      this.tilePending = tileWant
      this.tileWait = 0
    } else if ((this.tileWait += realDt) >= 0.6) {
      this.allocArray(this.decks.length, tileWant)
    }

    // A rising edge on the `deal` event, or the auto clock, re-deals everything.
    // These RESEED re-cuts (a fresh shuffle) crossfade when a xfade time is set;
    // a structural change (a new folder / deck count) snaps.
    const dealNow = num(inputs.deal, 0) > 0.5
    const dealEvent = dealNow && this.prevDeal < 0.5
    this.prevDeal = dealNow ? 1 : 0
    let reseedRecut = dealEvent
    if (rate > 0.01) {
      // At least ~0.15s between deals : a deal reloads clips, and dealing every
      // frame is a reload storm no wall can survive. Frozen, the clock waits.
      if (!freeze) this.dealTimer += dt
      if (this.dealTimer >= Math.max(rate, 0.15)) { this.dealTimer = 0; reseedRecut = true }
    } else {
      this.dealTimer = 0
    }
    const redeal = poolChanged || deckChanged || reseedRecut
    if (redeal) {
      if (reseedRecut && !poolChanged && !deckChanged) {
        this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0
        // Dissolve into the new deal when a xfade time is set. A deal landing
        // MID-fade first folds what is on screen (the mix) into the outgoing
        // wall, so a fast deal clock keeps dissolving from the live picture
        // instead of from one stale settled frame.
        if (xfadeDur > 0 && this.prevValid) {
          if (this.xfade < 1) this.foldAt = this.xfade
          this.xfade = 0
        } else {
          this.xfade = 1
        }
      } else {
        this.xfade = 1 // structural re-deals snap
        this.foldAt = null
      }
      // Assemblage decks carry their own edit and their own pace : a deal only
      // re-cuts the partition and re-shuffles which piece shows which edit.
      if (feed === 0) this.deal(hold, churn)
      this.rebuildCells(cuts, shape)
    } else if (filesChanged && feed === 0) {
      this.swapFiles()
    }
    if (rotate !== this.lastRotate) this.applyRotate(rotate)
    if (Math.abs(zoom - this.lastZoom) > 1e-4) {
      this.lastZoom = zoom
      this.cropsDirty = true
    }

    // Advance an in-flight crossfade. If the time is pulled to 0 mid-fade, snap
    // to done rather than freezing a stale outgoing wall.
    if (this.xfade < 1) this.xfade = xfadeDur > 0 ? Math.min(1, this.xfade + dt / xfadeDur) : 1

    // The window knob, live : once it has settled for a moment, every deck
    // re-windows around its own playhead.
    const hq = holdQ(hold)
    if (hq === this.holdNow) {
      this.holdWant = hq
      this.holdWait = 0
    } else if (hq !== this.holdWant) {
      this.holdWant = hq
      this.holdWait = 0
    } else if ((this.holdWait += realDt) >= 0.3) {
      this.holdNow = hq
      for (const d of this.decks) this.rewindow(d, hq)
    }

    // Which decks are on screen at all (a masked-out piece needs no fresh frames).
    for (const d of this.decks) d.shown = false
    for (let i = 0; i < this.cells.length; i++) {
      if (this.rank[i] >= mask - 0.06) {
        const d = this.decks[this.cells[i].deck]
        if (d) d.shown = true
      }
    }

    // Per-deck housekeeping : rate, play/pause, window looping, churn.
    const nChurn = Math.round(churn * this.decks.length)
    for (let i = 0; i < this.decks.length; i++) {
      const d = this.decks[i]
      if (d.seeking && now - d.seekAt > 4000) d.seeking = false // a seek that never reported back
      // speed x this film's spread x the layer clock's rate.
      const r = speed * Math.pow(2, vary * d.varyU) * this.clockMul
      if (d.asm) {
        const run = !freeze && d.used && r > 0.004
        if (run !== d.running) {
          d.asm.setPlaying(run)
          d.running = run
        }
        // AssembleSource owns the walk; the rate scales it like a layer clock.
        if (run) d.asm.tick(realDt, r)
        continue
      }
      if (!d.clip) continue
      // Churn applies live : the first round(churn x n) decks re-roll on their
      // own clock. A deck joining the churn starts at a random point of its
      // cycle so a turned dial doesn't make every piece jump at once.
      const was = d.churning
      d.churning = i < nChurn
      if (d.churning && !was) d.nextRoll = (0.1 + this.rollRnd() * 1.2) / Math.max(0.15, churn)
      const run = d.used && r > 0.004 && (!freeze || d.needFrame)
      const want = clampf(r, RATE_MIN, RATE_MAX)
      if (Math.abs(d.el.playbackRate - want) > want * 0.02) {
        try { d.el.playbackRate = want } catch { /* out-of-band rate */ }
      }
      if (run) {
        if (d.el.paused && d.el.readyState >= 2) void d.el.play().catch(() => {})
      } else if (!d.el.paused) {
        d.el.pause()
      }
      if (!run) continue
      if (d.churning && churn > 0.001 && !freeze) {
        d.nextRoll -= dt
        if (d.nextRoll <= 0) {
          // Re-roll this deck onto another film (and another window of it) :
          // this cell becomes its own little montage.
          const clip = this.pickOther(d.clip)
          if (clip) {
            this.cue(d, clip, hold, this.rollRnd, true)
            d.panNext = [this.rollRnd(), this.rollRnd()]
          }
          d.nextRoll = (0.25 + this.rollRnd() * 1.2) / Math.max(0.15, churn)
        }
      }
      // Sub-window looping : native loop only covers whole files.
      if (!d.el.loop && d.el.readyState >= 2 && !d.seeking) {
        const t = d.el.currentTime
        if (t >= d.inSec + d.lenSec || t < d.inSec - 0.25 || d.el.ended) this.seekTo(d, d.inSec)
      }
    }
  }

  /** Draw the wall into the layer's scratch target. `clockSec` is the layer's
   *  own clock (Speed x global speed; the background's slow clock); without it
   *  the wall falls back to realtime. */
  render(scratchFbo: WebGLFramebuffer, clockSec?: number): void {
    if (this.disposed) return
    const gl = this.gl
    const g = collageGL(gl)
    this.tick(clockSec)
    // Own vertex array for every draw : the default one belongs to the ISF runtime.
    gl.bindVertexArray(g.vao)
    try {
      this.draw(g, scratchFbo)
    } finally {
      gl.bindVertexArray(null)
    }
  }

  private draw(g: CollageGL, scratchFbo: WebGLFramebuffer): void {
    const gl = this.gl
    gl.disable(gl.BLEND)

    // 1) Fold every freshly decoded frame into its array layer. A deck no piece
    //    shows is skipped (its pending frame waits until it is shown again).
    if (this.arr && this.fbo) {
      let bound = false
      const T = this.tile
      const now = performance.now()
      for (let i = 0; i < this.decks.length && i < this.arrLayers; i++) {
        const d = this.decks[i]
        if (d.blitted && !d.needFrame && (!d.used || !d.shown)) continue
        let tex: WebGLTexture | null
        let vw: number, vh: number
        if (d.asm) {
          if (d.blitted && !asmFresh(d.asm)) continue
          tex = d.asm.upload()
          ;[vw, vh] = d.asm.frameSize()
        } else {
          if (d.el.readyState < 2 || !d.el.videoWidth) continue
          // rVFC only fires while the page is being composited : with the window
          // occluded or minimized (the app then runs on a timer to keep the
          // projector stream alive) it goes quiet and the wall would freeze. A
          // playing deck whose playhead has moved on since its last blit gets one
          // anyway; uploading makes the element hand over its current frame.
          if (!d.pending && (d.el.paused || now - d.blitAt < 120 || Math.abs(d.el.currentTime - d.blitT) < 0.02))
            continue
          d.pending = false
          vw = d.el.videoWidth
          vh = d.el.videoHeight
          tex = this.uploadStaged(d.el)
        }
        if (!tex || !vw || !vh) continue
        // The picture rect of THIS frame (an edit cuts between aspects; a new
        // film lands with its own) : the crops follow what the layer holds.
        const ct = containRect(vw, vh)
        if (Math.abs(ct[2] - d.content[2]) > 1e-4 || Math.abs(ct[3] - d.content[3]) > 1e-4) {
          d.content = ct
          this.cropsDirty = true
        }
        if (d.panNext) {
          d.pan = d.panNext
          d.panNext = null
          this.cropsDirty = true
        }
        d.needFrame = false
        d.blitAt = now
        d.blitT = d.asm ? -1 : d.el.currentTime
        if (!bound) {
          gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo)
          gl.viewport(0, 0, T, T)
          gl.useProgram(g.tile)
          gl.activeTexture(gl.TEXTURE0)
          gl.uniform1i(g.uTile('uSrc'), 0)
          bound = true
        }
        gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.arr, 0, i)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.uniform4f(g.uTile('uContent'), d.content[0], d.content[1], d.content[2], d.content[3])
        gl.uniform2f(g.uTile('uFoot'), 1 / (T * d.content[2]), 1 / (T * d.content[3]))
        gl.uniform1i(g.uTile('uBox'), vw / (T * d.content[2]) > 1.3 ? 1 : 0)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        d.blitted = true
      }
      if (bound) gl.bindTexture(gl.TEXTURE_2D, null)
    }
    if (this.cropsDirty) this.rebuildCrops()

    // 2) Empty wall (no films yet) : clear the scratch target and bail before
    //    touching the crossfade buffers.
    const n = Math.min(this.cells.length, MAX_CELLS)
    if (!n || !this.arr || !(this.pool.length || this.edls.length)) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, scratchFbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      this.prevValid = false
      return
    }

    // 3) The collage uniforms.
    for (let i = 0; i < n; i++) {
      const c = this.cells[i]
      this.cellArr[i * 4] = c.x; this.cellArr[i * 4 + 1] = c.y
      this.cellArr[i * 4 + 2] = c.w; this.cellArr[i * 4 + 3] = c.h
      this.cropArr[i * 4] = c.crop[0]; this.cropArr[i * 4 + 1] = c.crop[1]
      this.cropArr[i * 4 + 2] = c.crop[2]; this.cropArr[i * 4 + 3] = c.crop[3]
      // The deck's picture rect : the shader mirrors its film read inside it so
      // an over-running / frayed shape samples real film, never the padding.
      const ct = this.decks[c.deck] ? this.decks[c.deck].content : [0, 0, 1, 1]
      this.contentArr[i * 4] = ct[0]; this.contentArr[i * 4 + 1] = ct[1]
      this.contentArr[i * 4 + 2] = ct[2]; this.contentArr[i * 4 + 3] = ct[3]
      this.metaArr[i * 4] = c.deck
      this.metaArr[i * 4 + 1] = c.rot
      this.metaArr[i * 4 + 2] = this.rank[i]
      this.metaArr[i * 4 + 3] = 0
    }
    const live = this.live
    const tg = num(live.torn, 0) > 0.001 ? g.torn : g
    const prog = this.lastShape === 1 ? tg.mosaic : tg.collage
    const U = this.lastShape === 1 ? tg.uMos : tg.uColl
    gl.useProgram(prog)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.arr)
    gl.uniform1i(U('uDecks'), 0)
    gl.uniform1i(U('uCount'), n)
    gl.uniform4fv(U('uCell'), this.cellArr)
    gl.uniform4fv(U('uCrop'), this.cropArr)
    gl.uniform4fv(U('uContent'), this.contentArr)
    gl.uniform4fv(U('uMeta'), this.metaArr)
    gl.uniform4fv(U('uSite'), this.siteArr)
    gl.uniform4fv(U('uRows'), this.rowsArr)
    gl.uniform1i(U('uRowCount'), this.rowCount)
    gl.uniform1f(U('uSeed'), (this.seed & 0xffff) / 65535)
    gl.uniform1f(U('uAspect'), this.w / this.h)
    gl.uniform1f(U('uTexel'), 1 / this.tile)
    gl.uniform1f(U('uPx'), 1 / this.h)
    gl.uniform1f(U('uGap'), clampf(num(live.gap, 0), 0, 1))
    gl.uniform1f(U('uContour'), clampf(num(live.contour, 0), 0, 2))
    gl.uniform1f(U('uCurve'), clampf(num(live.curve, 0.3), 0, 1))
    gl.uniform1f(U('uTorn'), clampf(num(live.torn, 0), 0, 2))
    gl.uniform1f(U('uMask'), clampf(num(live.mask, 0), 0, 1))
    gl.uniform1i(U('uContourMode'), Math.round(clampf(num(live.contourMode, 1), 0, 1)))

    // 4a) No crossfade : the wall draws straight into the layer, in the straight
    //     alpha the blend stack reads. No extra buffers, no copy pass.
    const buffered = this.xfadeDur > 0 || this.xfade < 1
    if (!buffered) {
      gl.uniform1i(U('uStraight'), 1)
      gl.bindFramebuffer(gl.FRAMEBUFFER, scratchFbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
      this.prevValid = false
      this.foldAt = null
      return
    }

    // 4b) Crossfade : premultiplied walls in cur/prev, dissolved and turned back
    //     to straight alpha on the way into the layer.
    this.ensureOut()
    const cur = this.cur!, prev = this.prev!
    if (this.foldAt !== null && this.prevValid) {
      // A deal landed mid-fade : prev ← mix(prev, cur, t), the frame on screen.
      const t = this.foldAt
      gl.bindFramebuffer(gl.FRAMEBUFFER, prev.fbo)
      gl.viewport(0, 0, this.w, this.h)
      gl.useProgram(g.fold)
      gl.bindTexture(gl.TEXTURE_2D, cur.tex)
      gl.uniform1i(g.uFold('uTex'), 0)
      gl.uniform1f(g.uFold('uAmt'), t)
      gl.enable(gl.BLEND)
      gl.blendColor(0, 0, 0, t)
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_CONSTANT_ALPHA)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      gl.disable(gl.BLEND)
      gl.bindTexture(gl.TEXTURE_2D, null)
      gl.useProgram(prog)
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.arr)
    }
    this.foldAt = null
    gl.uniform1i(U('uStraight'), 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)

    const fading = this.xfade < 1 && this.prevValid
    gl.bindFramebuffer(gl.FRAMEBUFFER, scratchFbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.useProgram(g.show)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, prev.tex)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, cur.tex)
    gl.uniform1i(g.uShow('uCur'), 0)
    gl.uniform1i(g.uShow('uPrev'), 1)
    gl.uniform1f(g.uShow('uT'), this.xfade)
    gl.uniform1i(g.uShow('uFading'), fading ? 1 : 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, null)

    // 5) Ping-pong : once settled, the frame just drawn becomes the outgoing
    //    layer a future deal dissolves from. Held frozen while a fade runs.
    if (this.xfade >= 1) {
      this.prev = cur
      this.cur = prev
      this.prevValid = true
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    const gl = this.gl
    for (const d of this.decks) this.killDeck(d)
    this.decks = []
    // Textures and framebuffers only : the shared quad / vertex array live for
    // the context (deleting a buffer is what trips the default-VAO landmine).
    if (this.arr) gl.deleteTexture(this.arr)
    if (this.fbo) gl.deleteFramebuffer(this.fbo)
    for (const o of [this.cur, this.prev]) {
      if (o) { gl.deleteTexture(o.tex); gl.deleteFramebuffer(o.fbo) }
    }
    for (const t of this.staging.values()) gl.deleteTexture(t)
    this.staging.clear()
    this.cur = null
    this.prev = null
    this.arr = null
    this.fbo = null
  }
}
