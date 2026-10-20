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
//     piece shows is paused and never blitted. And a deck no piece CAN show is
//     not even loaded : pieces take their films in a fixed order of the decks,
//     so a wall of n pieces plays the first n decks of that order whatever the
//     film count, and every deal used to open, seek and decode a frame of every
//     film for nothing (30 films for 10 pieces : 20 files a deal, measured).
//     Each deal still draws from the whole folder.
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
import { glGeneration } from './glGeneration'

/** Same piece cap as the Autocutter : the shader's uniform arrays are sized 64. */
const MAX_CELLS = 64
// The films pass's draw buffers (made once : new arrays each frame, twice)
const DRAW_WITH_ID = [0x8ce0, 0x8ce1] // COLOR_ATTACHMENT0, COLOR_ATTACHMENT1
const DRAW_PLAIN = [0x8ce0]
// The top-piece target goes after this long unused (33 MB at 4K, 67 on the dome)
const ID_IDLE_MS = 5000
/** Hard ceiling on simultaneous decoders (Vincent, 2026-10-13 : 50 → 100). */
export const MAX_DECKS = 100
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
/** Distinct frame sizes kept as upload staging textures (LRU), and the memory
 *  they may hold. 4 thrashed on a mixed folder (5+ sizes uploading in turn :
 *  every upload deleted and re-specified a texture). */
const STAGING_MAX = 16
const STAGING_BUDGET = 160 * 1024 * 1024
/** Main-thread time the frame uploads may take per frame (the rest wait their
 *  turn, round-robin) : 50 films at a speed of 2 used to upload every film every
 *  frame, ~15 ms, the whole frame budget. */
const UPLOAD_BUDGET_MS = 4
/** Auto deals faster than this re-cut the wall among the films already playing
 *  instead of loading new ones (a reload every half second froze pieces on their
 *  old frame and starved the decoders). A pressed deal always loads new films. */
const FAST_DEAL_S = 1

/** The array-layer edge for a wall : a piece covers about 1/cuts of the frame
 *  (the biggest cut-up pieces about half as much again), and its cover crop out
 *  of a contain-fitted 16:9 film is ~1/1.8 of the layer edge. So this keeps a
 *  piece near one texel per output pixel, capped by the memory budget shared by
 *  every layer (16 x 1024^2 or 50 x 512^2 both land near 64 MB; 100 films get
 *  the smallest edge, 100 x 384^2 = 59 MB). */
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
// square dome. Compiled once per shape (SHAPE 0 cut-up, 1 mosaic, 2 torn, 3
// shaped) : sharing one program behind a uniform branch cost the cut-up path
// ~1.5x in register pressure. TORN (the torn-paper edge) and STACK (the pile)
// are compiled variants too, so a wall without them runs none of their code.
// The torn and shaped pieces are always a pile (FORM).
const FS_COLLAGE = (shape: number, torn: boolean, stack = false): string => `#version 300 es
#define SHAPE ${shape}
#define MOSAIC ${shape === 1 ? 1 : 0}
#define FORM ${shape >= 2 ? 1 : 0}
#define TORN ${torn ? 1 : 0}
#define STACK ${stack || shape >= 2 ? 1 : 0}
precision highp float;
// GLSL ES 3.00 gives sampler2D a default precision in the fragment stage but
// NOT sampler2DArray : without this line the whole program fails to compile.
precision highp sampler2DArray;
in vec2 vUV; layout(location = 0) out vec4 o;
uniform sampler2DArray uDecks;
#if FORM || (STACK && MOSAIC)
// The piled pieces (torn, shaped, a stacked mosaic) : the films pass (1)
// writes what it found at each pixel to a second target, and the shapes pass
// (2) of the same frame reads it back (uHasId) instead of searching every
// piece again. That search was half of what each pass cost. One 32-bit word :
// the top piece +1 (0 = none), and for the mosaic the runner-up +1 and the
// three nearest seeds (7, 7, 6, 6, 6 bits; 64 pieces at most). See
// CollageSource.draw.
layout(location = 1) out uvec4 oId;
uniform highp usampler2D uId;
uniform int uHasId;
#endif
uniform int uCount;
uniform vec4 uCell[64];    // piece rect (x,y,w,h) in output UV (mosaic : the shard's bounding box; STACK : grown; FORM : the film rect, untilted)
uniform vec4 uCrop[64];    // film rect inside the deck's layer (cover crop)
uniform vec4 uContent[64]; // the deck's picture rect inside its layer; reads mirror inside it
uniform vec4 uMeta[64];    // x deck layer · y quarter turns · z mask rank (survivor 2.0) · w height in the pile
uniform vec4 uSite[64];    // mosaic seed (xy, height units) · z (STACK) how far the shard grows past its cut · w its WARP weight
uniform vec4 uRows[16];    // mosaic rows : x first seed index, y seed count
uniform int uRowCount;
uniform float uGap, uSeed, uContour, uTorn, uMask, uCurve, uAspect, uTexel, uPx, uStack, uWarp;
uniform int uContourMode; // 0 = normal (warp edges only), 1 = warped (warp content too)
uniform int uStraight;    // 1 = straight alpha (drawn straight into the layer), 0 = premultiplied
// FX BEFORE SHAPES : 0 the whole wall · 1 its films only, every piece whole (the
// source's FX rack runs on that next) · 2 its shapes (seams, torn paper, holes)
// drawn crisp over uFx, the films after the FX
uniform int uPass;
uniform sampler2D uFx;
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
// WARP bends the pieces, each shape its own way, and every piece a little
// differently.
#if SHAPE == 0
// Cut-up : the whole cut bows around a point, as if the wall were bent over it
// (straight cuts become arcs), and three smaller swells and dips (some pushing,
// some pulling) bend each stretch of cut its own way. All of it moves with each
// deal. No fold : the map stays one-to-one, and inside the frame.
vec2 bendGrid(vec2 p){
  vec2 A = vec2(uAspect, 1.0);
  vec2 c = vec2(0.3 + 0.4 * vhash(vec2(3.7, 1.1)), 0.3 + 0.4 * vhash(vec2(8.3, 2.9)));
  vec2 d = (p - c) * A;
  float r2 = dot(d, d);
  vec2 q = c * A + d * (1.0 - uWarp * 0.4 * r2 / (1.0 + r2));
  // (the swells fade out toward the frame, which stays where it is)
  vec2 edge = smoothstep(0.0, 0.15, min(p, 1.0 - p));
  for (int k = 0; k < 3; k++){
    float fk = float(k);
    vec2 ck = vec2(0.15 + 0.7 * vhash(vec2(5.1 + fk * 3.3, 7.7)), 0.15 + 0.7 * vhash(vec2(2.9 + fk * 4.1, 9.3))) * A;
    vec2 dk = p * A - ck;
    float sk = vhash(vec2(fk * 1.7, 6.6)) < 0.5 ? -1.0 : 1.0;
    q += uWarp * sk * 0.35 * dk * exp(-4.0 * dot(dk, dk)) * edge;
  }
  return clamp(q / A, 0.0001, 0.9999);
}
#endif
#if MOSAIC
// Mosaic : every seed carries its own weight (uSite.w), so the borders curve
// (hyperbolas, not straight bisectors) and the shards come out unequal.
float wdist(int i, vec2 q){ return distance(q, uSite[i].xy) - uWarp * uSite[i].w; }
#endif
vec2 rot90(vec2 p, float r){
  p -= 0.5; int ri = int(r + 0.5);
  if (ri == 1) p = vec2(-p.y, p.x);
  else if (ri == 2) p = -p;
  else if (ri == 3) p = vec2(p.y, -p.x);
  return p + 0.5;
}
#if FORM
// A torn or shaped piece is tilted : x its tilt (radians), y z w its own shape
// draws. Its film rect (uCell) is untilted, centred on it.
uniform vec4 uForm[64];
// (The tilt and the lobes stay per pixel, on the GPU : computed once per piece
// on the CPU they rounded differently, and one boundary pixel a frame took its
// neighbour's film. Measured 2026-10-14, old build vs new, bit for bit.)
vec2 rotv(vec2 v, float a){ float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
vec2 centreOf(int i){ vec4 d = uCell[i]; return (d.xy + 0.5 * d.zw) * vec2(uAspect, 1.0); }
// Half its film rect, height units : its shape fits inside.
vec2 halfOf(int i){ return 0.5 * uCell[i].zw * vec2(uAspect, 1.0); }
// q (height units) in the piece's own frame : centred on it, untilted, and
// bent by WARP (the film is printed on the piece, so it bends along) : a torn
// scrap curls into a curved strip, a shaped cut-out swirls into a hook. Each
// piece bends its own way and amount.
vec2 localOf(int i, vec2 q){
  vec2 lp = rotv(q - centreOf(i), -uForm[i].x);
  if (uWarp > 0.0){
    float b = fract(uForm[i].w * 17.31) * 2.0 - 1.0;
    b = sign(b) * (0.35 + 0.65 * abs(b));
    float kind = fract(uForm[i].w * 5.77);
    vec2 h = halfOf(i);
#if SHAPE == 2
    // a curl along its length, across it, or an S
    if (kind < 0.4) lp.y -= uWarp * b * 0.9 * lp.x * lp.x / max(h.x, 0.05);
    else if (kind < 0.7) lp.x -= uWarp * b * 0.9 * lp.y * lp.y / max(h.y, 0.05);
    else lp.y -= uWarp * b * 1.2 * lp.x * lp.x * lp.x / max(h.x * h.x, 0.0025);
#else
    // a swirl, or a crescent bend
    if (kind < 0.55) lp = rotv(lp, uWarp * b * 2.4 * min(length(lp) / max(max(h.x, h.y), 0.05), 1.5));
    else lp.y -= uWarp * b * 0.8 * lp.x * lp.x / max(h.x, 0.05);
#endif
  }
  return lp;
}
#endif
// One piece's film at sUV. Where a piece runs past the film (a frayed NORMAL
// edge, a shard corner) the read MIRRORS back into the picture instead of
// clamping, so an overrun shows real film, never a smeared edge row. The mirror
// sits a texel inside the picture so the black padding never bleeds in.
vec3 film(int i, vec2 sUV){
  vec4 d = uCell[i];
#if FORM
  // the picture is tilted with its piece
  sUV = (centreOf(i) + localOf(i, sUV * vec2(uAspect, 1.0))) / vec2(uAspect, 1.0);
#endif
  vec2 luv = rot90((sUV - d.xy) / d.zw, uMeta[i].y);
#if !FORM
  // WARP : every piece bends its own film its own way (a bulge, a pinch, a
  // swirl or a ripple, its own amount), drawn from its height draw.
  if (uWarp > 0.0){
    float h = uMeta[i].w;
    float amt = uWarp * (0.4 + 0.6 * fract(h * 53.7));
    int kind = int(fract(h * 17.9) * 4.0);
    vec2 q = luv - 0.5;
    float r2 = dot(q, q);
    if (kind == 0) q *= 1.0 - amt * 0.45 * (1.0 - min(r2 * 4.0, 1.0));
    else if (kind == 1) q *= 1.0 + amt * 0.5 * (1.0 - min(r2 * 4.0, 1.0));
    else if (kind == 2) { float a = amt * 3.0 * (0.5 - min(sqrt(r2), 0.5)) * (fract(h * 91.3) < 0.5 ? -1.0 : 1.0); float cs = cos(a), sn = sin(a); q = vec2(cs * q.x - sn * q.y, sn * q.x + cs * q.y); }
    else q.x += amt * 0.07 * sin(q.y * 12.566 + 6.2832 * fract(h * 7.3));
    luv = q + 0.5;
  }
#endif
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
// A piece's height in the pile : which one lies over which along a torn edge,
// and with STACK how far above the others it stands. Drawn per piece on the CPU
// (per piece id), so a modulated cut count never reshuffles who lies on top.
float order(int i){ return uMeta[i].w; }
// How much of a piece the mask leaves (0 = a hole).
float keepOf(int i){ return smoothstep(uMask - 0.06, uMask, uMeta[i].z); }
#if TORN
// The piece across a tear. Over FX'd films (pass 2) there is no second film to
// read : mirror across the tear into the neighbour's own (processed) pixels.
vec3 neighbour(int N, vec2 sUV, vec2 dir, float ed){
  if (uPass == 2) return textureLod(uFx, clamp(vUV + dir * (2.0 * ed + 2.0 * uPx) / vec2(uAspect, 1.0), 0.0, 1.0), 0.0).rgb;
  return film(N, sUV);
}
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
vec4 tornPaper(int C, int N, vec3 colC, float keepC, float ed, vec2 dir, vec2 qa, vec2 sUV){
  float keepN = keepOf(N);
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
    vec3 cu = upC ? colC : neighbour(N, sUV, dir, ed);
    float ink = 1.0 - 0.16 * min(T, 1.0) * (1.0 - smoothstep(0.0, 0.15 * fw + 1.5 * uPx, s - ePrint));
    return vec4(cu * ink, keepU);
  }
  vec3 cl = upC ? neighbour(N, sUV, dir, ed) : colC; // the lower piece, under the white and the shadow
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
#if STACK
// STACK : the pieces are cut-outs lying at different heights, a pile rather
// than one flat sheet. Every piece is grown past its cut (uCell holds the grown
// rect; a mosaic shard grows by uSite.z), so neighbours overlap, and where they
// do the higher one (uMeta.w) lies on top. A higher piece drops a shadow on
// whatever lies lower, longer and softer the higher it stands above it, plus a
// little contact shade along its edge; the low pieces sit in a little less
// light. A masked piece is gone : what lay under it shows, or the layers below.
// TORN and SHAPED pieces are a pile at any stack : each is a scrap of its own
// shape around its cell of the cut-up, tilted, big enough to cover the cell,
// lying over or under its neighbours; the stack only lifts them apart.
const vec2 SHADOW = vec2(0.55, -0.835); // where shadows fall : light from the top left, as torn paper's
// Signed distance to a piece's rect, height units (negative inside).
float sdBox(vec2 q, int i){
  vec4 d = uCell[i];
  vec2 A = vec2(uAspect, 1.0);
  vec2 e = abs(q - (d.xy + 0.5 * d.zw) * A) - 0.5 * d.zw * A;
  return length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
}
// What a piece standing dz above this pixel casts on it : sdHere = the distance
// to its edge, sdCast = the same from where its shadow is thrown (off = how far).
float castShade(float sdHere, float sdCast, float dz, float off, float k){
  float pen = 0.0012 + 0.45 * off;
  float sh = (1.0 - smoothstep(-pen, pen, sdCast)) * (0.55 - 0.25 * dz);
  float ao = 0.3 * exp(-max(sdHere, 0.0) / (0.0012 + 0.12 * off)) * min(dz * 5.0, 1.0);
  return max(sh, ao) * k * smoothstep(0.0, 0.2, uStack);
}
#if MOSAIC
// How far q lies past the straight border between shard i and shard n (n's
// side positive) : the distance to their bisector. dqi, dqn : q's distances to
// the two seeds.
float pastBorder(int i, int n, float dqi, float dqn){
  float b = (dqi * dqi - dqn * dqn) / (2.0 * max(distance(uSite[i].xy, uSite[n].xy), 1e-4));
  // weighted (WARP) the border is a curve : half the distance gap, near it
  return mix(b, 0.5 * (dqi - dqn), clamp(uWarp * 3.0, 0.0, 1.0));
}
// How far q lies past shard i's cell (negative inside) : against the borders
// it shares with the three seeds nearest this pixel, so a grown shard keeps
// straight sides and sharp corners.
float pastCell(int i, vec2 q, int j0, int j1, int j2){
  float di = wdist(i, q);
  float s = -1e9;
  if (j0 != i) s = max(s, pastBorder(i, j0, di, wdist(j0, q)));
  if (j1 != i) s = max(s, pastBorder(i, j1, di, wdist(j1, q)));
  if (j2 != i) s = max(s, pastBorder(i, j2, di, wdist(j2, q)));
  return s;
}
#endif
#if SHAPE == 2
// TORN : a scrap torn out of a page. A box (one end a little wider) whose
// outline wanders in long waves, is ragged at every scale and now and then
// bitten deep. Form y = the taper (its sign : which end widens), z = the rag's
// scale (a small scrap tears finer), w = its own noise. Signed distance, height
// units.
float sdPiece(int i, vec2 q){
  vec4 f = uForm[i];
  vec2 lp = localOf(i, q);
  float ks = f.z;
  vec2 R = halfOf(i) - 0.02 * ks;
  vec2 h = vec2(R.x / (1.0 + abs(f.y)), R.y);
  lp.x /= 1.0 + abs(f.y) * clamp(0.5 + sign(f.y) * lp.y / (2.0 * h.y), 0.0, 1.0);
  vec2 e = abs(lp) - h;
  float sd = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
  vec2 n = lp / ks + f.w * 61.0;
  float rag = (vnoise(n * 9.0) - 0.5) * 0.03 + (vnoise(n * 60.0 + 7.1) - 0.5) * 0.008
            + (vnoise(n * 220.0 + 3.3) - 0.5) * 0.0025 - pow(vnoise(n * 4.0 + 5.3), 3.0) * 0.035;
  return sd - rag * ks;
}
// Its outward normal at q (the nearest side's), world.
vec2 normalOf(int i, vec2 q){
  vec2 lp = localOf(i, q);
  vec2 h = halfOf(i);
  vec2 n = abs(lp.x) * h.y > abs(lp.y) * h.x ? vec2(sign(lp.x), 0.0) : vec2(0.0, sign(lp.y));
  return rotv(n, uForm[i].x);
}
#elif SHAPE == 3
// SHAPED : a rounded abstract cut-out. An ellipse whose radius swells and dips
// with the angle (two, three and five lobes, each its own size and turn), so it
// comes out a bean, a kidney, a soft blob, never a polygon. Form y z w : the
// lobes' draws.
float sdPiece(int i, vec2 q){
  vec4 f = uForm[i];
  float a2 = 0.05 + 0.15 * fract(f.y * 7.13), a3 = 0.15 * f.z, a5 = 0.08 * f.w;
  vec2 R = halfOf(i) / (1.0 + a2 + a3 + a5);
  vec2 u = localOf(i, q) / R + 1e-6;
  float th = atan(u.y, u.x);
  float m = 1.0 + a2 * cos(2.0 * th + 6.2832 * f.y) + a3 * cos(3.0 * th + 6.2832 * fract(f.z * 13.7))
          + a5 * cos(5.0 * th + 6.2832 * fract(f.w * 29.3));
  return (length(u) - m) * min(R.x, R.y);
}
vec2 normalOf(int i, vec2 q){
  vec2 R = halfOf(i);
  return normalize(rotv(localOf(i, q) / (R * R), uForm[i].x) + 1e-9);
}
#endif
#if FORM
// The highest piece holding q (a masked one only where none still in is),
// skipping one; -1 : none does.
int topAt(vec2 q, int skip){
  int t = -1; float kt = -1.0;
  for (int i = 0; i < 64; i++){
    if (i >= uCount) break;
    if (i == skip || distance(q, centreOf(i)) > length(halfOf(i))) continue;
    if (sdPiece(i, q) > 0.0) continue;
    float key = uMeta[i].w + (keepOf(i) > 0.0 ? 2.0 : 0.0);
    if (key > kt){ kt = key; t = i; }
  }
  return t;
}
#endif
#endif
void main(){
  vec2 A = vec2(uAspect, 1.0);
  vec3 col = vec3(0.0);
  float keep = 0.0;
  vec2 wUV = uContour > 0.001 ? clamp(tearWarp(vUV), 0.0001, 0.9999) : vUV;
#if SHAPE == 0
  if (uWarp > 0.0) wUV = bendGrid(wUV);
#endif
  // CONTOUR MODE : the tear warp always bends where a cell BEGINS (membership +
  // seam/fringe), so the cut edges fray either way. WARPED also samples the film
  // through the warped coordinate (the whole clip inside the cut ripples); NORMAL
  // samples through the un-warped vUV (only the edge frays, the picture stays
  // straight). Membership stays on wUV so the pieces still tessellate.
  vec2 sUV = uContourMode == 1 ? wUV : vUV;
  vec2 qa = wUV * A;

#if STACK
  {
    // The piece on top here : the highest one still in (a masked one only where
    // none is : its film still feeds the films-only pass) whose shape holds this
    // pixel. The runner-up shows through a top piece the mask fades.
    int top = 0, sec = -1; float kt = -1.0, ks = -1.0;
#if MOSAIC
    // A shard grown by g holds every point less than g past its cell.
    int mi = 0, mi2 = 0, mi3 = 0; float d1 = 1e9, d2 = 1e9, d3 = 1e9;
    if (uPass == 2 && uHasId == 1){
      // the films pass already found them (oId)
      uint w = texelFetch(uId, ivec2(gl_FragCoord.xy), 0).r;
      int c = int(w & 127u) - 1;
      if (c >= 0){ top = c; kt = 1.0; }
      sec = int((w >> 7u) & 127u) - 1;
      mi = int((w >> 14u) & 63u); mi2 = int((w >> 20u) & 63u); mi3 = int(w >> 26u);
    } else {
    for (int i = 0; i < 64; i++){
      if (i >= uCount) break;
      float dd = wdist(i, qa);
      if (dd < d1){ d3 = d2; mi3 = mi2; d2 = d1; mi2 = mi; d1 = dd; mi = i; }
      else if (dd < d2){ d3 = d2; mi3 = mi2; d2 = dd; mi2 = i; }
      else if (dd < d3){ d3 = dd; mi3 = i; }
    }
    for (int i = 0; i < 64; i++){
      if (i >= uCount) break;
      if (pastCell(i, qa, mi, mi2, mi3) > uSite[i].z) continue;
      float key = uMeta[i].w + (keepOf(i) > 0.0 ? 2.0 : 0.0);
      if (key > kt){ sec = kt >= 0.0 ? top : -1; ks = kt; top = i; kt = key; }
      else if (key > ks){ sec = i; ks = key; }
    }
    }
#elif FORM
    if (uPass == 2 && uHasId == 1){
      // the films pass already found it (oId); only pass 0 reads sec
      int c = int(texelFetch(uId, ivec2(gl_FragCoord.xy), 0).r) - 1;
      if (c >= 0){ top = c; kt = 1.0; }
    } else {
    for (int i = 0; i < 64; i++){
      if (i >= uCount) break;
      if (distance(qa, centreOf(i)) > length(halfOf(i)) || sdPiece(i, qa) > 0.0) continue;
      float key = uMeta[i].w + (keepOf(i) > 0.0 ? 2.0 : 0.0);
      if (key > kt){ sec = kt >= 0.0 ? top : -1; ks = kt; top = i; kt = key; }
      else if (key > ks){ sec = i; ks = key; }
    }
    }
#else
    for (int i = 0; i < 64; i++){
      if (i >= uCount) break;
      vec4 d = uCell[i];
      if (wUV.x >= d.x && wUV.x < d.x + d.z && wUV.y >= d.y && wUV.y < d.y + d.w){
        float key = uMeta[i].w + (keepOf(i) > 0.0 ? 2.0 : 0.0);
        if (key > kt){ sec = kt >= 0.0 ? top : -1; ks = kt; top = i; kt = key; }
        else if (key > ks){ sec = i; ks = key; }
      }
    }
#endif
    // (torn and shaped scraps can leave a gap no piece covers : a hole)
    bool none = kt < 0.0;
    int C = top;
#if MOSAIC
    oId = uvec4(uint(none ? 0 : C + 1) | (uint(sec + 1) << 7u) | (uint(mi) << 14u) | (uint(mi2) << 20u) | (uint(mi3) << 26u), 0u, 0u, 0u);
#elif FORM
    oId = uvec4(none ? 0u : uint(C + 1), 0u, 0u, 0u);
#endif
    keep = none ? 0.0 : keepOf(C);
    bool hole = keep <= 0.0;
    float zC = hole ? -0.05 : uMeta[C].w;
    col = uPass == 2 ? textureLod(uFx, vUV, 0.0).rgb : none ? vec3(0.0) : film(C, sUV);
    if (uPass == 0 && !hole && keep < 1.0 && sec >= 0){
      float k2 = keepOf(sec);
      if (k2 > 0.0){
        float a = keep + k2 * (1.0 - keep);
        col = (col * keep + film(sec, sUV) * k2 * (1.0 - keep)) / a;
        keep = a;
      }
    }
    // Everything below (edges, shadows, shade, torn paper, seams) is drawn by
    // the whole wall (pass 0) or by the shapes over the processed films (pass
    // 2); the films-only pass (1) used to work all of it out and drop it.
    if (uPass != 1){
    // The nearest edge in sight : this piece's own (it lies over what is past
    // it) or a higher piece's close by (that one lies over this one).
    float ed; vec2 dir; int N = -1; bool own = true;
#if MOSAIC
    {
      // its own border : the one of the three it is furthest past
      float dC = wdist(C, qa), sb = -1e9; int jb = mi2;
      for (int k = 0; k < 3; k++){
        int j = k == 0 ? mi : k == 1 ? mi2 : mi3;
        if (j == C) continue;
        float sj = pastBorder(C, j, dC, wdist(j, qa));
        if (sj > sb){ sb = sj; jb = j; }
      }
      ed = uSite[C].z - sb;
      dir = normalize(uSite[jb].xy - uSite[C].xy + 1e-6);
      N = sec >= 0 ? sec : jb;
    }
#elif FORM
    ed = none ? 1e9 : -sdPiece(C, qa);
    dir = none ? vec2(1.0, 0.0) : normalOf(C, qa);
#else
    vec4 d = uCell[C];
    vec2 elo = (wUV - d.xy) * A;
    vec2 ehi = (d.xy + d.zw - wUV) * A;
    ed = elo.x; dir = vec2(-1.0, 0.0);
    if (ehi.x < ed){ ed = ehi.x; dir = vec2(1.0, 0.0); }
    if (elo.y < ed){ ed = elo.y; dir = vec2(0.0, -1.0); }
    if (ehi.y < ed){ ed = ehi.y; dir = vec2(0.0, 1.0); }
    // Past this piece's own edge : the frame (a cut, nothing lies beyond).
    vec2 pr = wUV + dir * (ed + 0.5 * uPx) / A;
    bool atFrame = pr.x <= 0.0 || pr.x >= 1.0 || pr.y <= 0.0 || pr.y >= 1.0;
#endif
    float edOwn = ed;
    // Every higher piece : its edge if it is the nearest, its shadow, its shade.
    float shade = 0.0;
    for (int i = 0; i < 64; i++){
      if (i >= uCount) break;
      float ki = keepOf(i);
      float dz = uMeta[i].w - zC;
      if (i == C || ki <= 0.0 || dz <= 0.0) continue;
      float off = uStack * 0.05 * dz;
#if MOSAIC
      float sd = pastCell(i, qa, mi, mi2, mi3) - uSite[i].z;
      // (near enough a distance : a shard farther than its shadow reaches
      // casts nothing here)
      if (sd > 2.0 * off + 0.04) continue;
      float sdC = pastCell(i, qa - SHADOW * off, mi, mi2, mi3) - uSite[i].z;
      vec2 toward = normalize(uSite[i].xy - uSite[mi].xy + 1e-6);
#elif FORM
      if (distance(qa, centreOf(i)) > length(halfOf(i)) + 2.0 * off + 0.04) continue;
      float sd = sdPiece(i, qa);
      float sdC = sdPiece(i, qa - SHADOW * off);
      vec2 toward = -normalOf(i, qa);
#else
      float sd = sdBox(qa, i);
      float sdC = sdBox(qa - SHADOW * off, i);
      vec4 c = uCell[i];
      vec2 e = abs(qa - (c.xy + 0.5 * c.zw) * A) - 0.5 * c.zw * A;
      vec2 toward = -sign(qa - (c.xy + 0.5 * c.zw) * A) * max(e, 0.0);
      toward /= max(length(toward), 1e-6);
#endif
      if (sd < ed){ ed = sd; N = i; dir = toward; own = false; }
      shade = max(shade, castShade(sd, sdC, dz, off, ki));
    }
    // Light and shadow on this piece (before torn paper : a higher piece's white
    // edge lies over its own shadow, not under it).
    if (uPass != 1) col *= (1.0 - uStack * 0.2 * (1.0 - max(zC, 0.0))) * (1.0 - shade);
#if TORN
    if (uPass != 1 && ed < uTorn * 0.035 + 0.02){
      int nb = N;
#if FORM
      // Past this piece's own edge : whatever lies highest there.
      if (own) nb = none ? -1 : topAt(qa + dir * (ed + 0.5 * uPx), C);
#elif !MOSAIC
      if (own){
        nb = -1;
        if (!atFrame){
          float kb = -1.0;
          for (int i = 0; i < 64; i++){
            if (i >= uCount) break;
            vec4 c = uCell[i];
            if (i != C && pr.x >= c.x && pr.x < c.x + c.z && pr.y >= c.y && pr.y < c.y + c.w){
              float key = uMeta[i].w + (keepOf(i) > 0.0 ? 2.0 : 0.0);
              if (key > kb){ kb = key; nb = i; }
            }
          }
        }
      }
#endif
      if (nb >= 0){
        vec4 tp = tornPaper(C, nb, col, keep, ed, dir, qa, sUV);
        col = tp.rgb; keep = tp.a;
      }
    }
#else
    // The paper's thickness : a hairline catching the light on the edges that
    // face it, in shade on the others.
#if MOSAIC || FORM
    bool rimOK = own && !hole;
#else
    bool rimOK = own && !hole && !atFrame;
#endif
    if (uPass != 1 && rimOK){
      float f = (1.0 - smoothstep(0.0, max(1.5 * uPx, 0.0008), edOwn)) * smoothstep(0.0, 0.2, uStack);
      col *= 1.0 + f * (dot(dir, SHADOW) < 0.0 ? 0.22 : -0.3);
    }
#endif
    if (uPass != 1){
      col = seam(col, ed);
      // Shadow falling past every piece (a hole) lands on the layers underneath.
      float a = keep + (1.0 - keep) * shade * 0.85;
      col = a > 0.002 ? col * keep / a : vec3(0.0);
      keep = a;
    }
    }
  }
#elif MOSAIC
  {
    // MOSAIC : each pixel belongs to its nearest seed, so the pieces are
    // irregular polygons; the border distance (2nd-nearest - nearest) drives the
    // same seams / torn fringe / mask the rectangles use. Seeds sit in rows, so
    // past 16 shards only the neighbouring rows and columns are searched.
    int mi = 0, mi2 = 0; float d1 = 1e9, d2 = 1e9;
    if (uCount <= 16 || uRowCount < 1){
      for (int i = 0; i < 64; i++){
        if (i >= uCount) break;
        float dd = wdist(i, qa);
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
          float dd = wdist(b + c, qa);
          if (dd < d1){ d2 = d1; mi2 = mi; d1 = dd; mi = b + c; }
          else if (dd < d2){ d2 = dd; mi2 = b + c; }
        }
      }
    }
    keep = keepOf(mi);
    float ed = 0.5 * (d2 - d1);
    col = uPass == 2 ? textureLod(uFx, vUV, 0.0).rgb : film(mi, sUV);
#if TORN
    if (uPass != 1 && uCount > 1 && mi2 != mi && ed < uTorn * 0.035 + 0.02){
      vec2 dv = uSite[mi2].xy - uSite[mi].xy;
      vec4 tp = tornPaper(mi, mi2, col, keep, ed, dv / max(length(dv), 1e-5), qa, sUV);
      col = tp.rgb; keep = tp.a;
    }
#endif
    if (uPass != 1) col = seam(col, ed);
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
    keep = keepOf(hit);
    vec2 elo = (wUV - d.xy) * A;
    vec2 ehi = (d.xy + d.zw - wUV) * A;
    float ed = elo.x; vec2 dir = vec2(-1.0, 0.0);
    if (ehi.x < ed){ ed = ehi.x; dir = vec2(1.0, 0.0); }
    if (elo.y < ed){ ed = elo.y; dir = vec2(0.0, -1.0); }
    if (ehi.y < ed){ ed = ehi.y; dir = vec2(0.0, 1.0); }
    col = uPass == 2 ? textureLod(uFx, vUV, 0.0).rgb : film(hit, sUV);
#if TORN
    if (uPass != 1 && ed < uTorn * 0.035 + 0.02){
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
    if (uPass != 1) col = seam(col, ed);
  }
#endif
  // Films only : every piece whole and opaque, so the FX see one full picture.
  if (uPass == 1) keep = 1.0;
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
  // The pile programs (STACK, and the torn and shaped pieces), per shape and
  // torn edge : compiled the first time a wall asks for one, in the background
  // where the driver can (KHR_parallel_shader_compile); until it is linked the
  // wall draws its flat cut.
  piles: Map<string, PileGL>
  fold: WebGLProgram
  show: WebGLProgram
  vao: WebGLVertexArrayObject
  quad: WebGLBuffer
  gen: number // the GL generation it was built in (glGeneration.ts)
  uTile: (n: string) => WebGLUniformLocation | null
  uColl: (n: string) => WebGLUniformLocation | null
  uMos: (n: string) => WebGLUniformLocation | null
  uFold: (n: string) => WebGLUniformLocation | null
  uShow: (n: string) => WebGLUniformLocation | null
}

interface PileGL {
  prog: WebGLProgram
  u: (n: string) => WebGLUniformLocation | null
  state: 0 | 1 | -1 // compiling · linked · failed (never asked again)
}

// Programs, the quad and its OWN vertex array are shared per context and never
// deleted. The ISF runtime keeps its quads on the DEFAULT vertex array's
// attribute 0, which this source must never rewire (see the default-VAO
// landmine). After a GPU reset the same context object comes back with every
// program dead, so a cached set is only reused while its program is live.
const shared = new WeakMap<WebGL2RenderingContext, CollageGL>()
function collageGL(gl: WebGL2RenderingContext): CollageGL {
  const hit = shared.get(gl)
  // Valid until a GPU reset bumps the generation. (It used to ask gl.isProgram x3
  // + isVertexArray, four blocking GPU round trips, on every render : twice a
  // frame with FX before shapes.)
  if (hit && hit.gen === glGeneration()) return hit
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
  const collage = link(FS_COLLAGE(0, false))
  const mosaic = link(FS_COLLAGE(1, false))
  const tornColl = link(FS_COLLAGE(0, true))
  const tornMos = link(FS_COLLAGE(1, true))
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
  const g: CollageGL = {
    tile, collage, mosaic, fold, show, vao, quad, gen: glGeneration(), piles: new Map(),
    uTile: cacheOf(gl, tile), uColl: cacheOf(gl, collage), uMos: cacheOf(gl, mosaic),
    uFold: cacheOf(gl, fold), uShow: cacheOf(gl, show),
    torn: { collage: tornColl, mosaic: tornMos, uColl: cacheOf(gl, tornColl), uMos: cacheOf(gl, tornMos) }
  }
  shared.set(gl, g)
  return g
}

function cacheOf(gl: WebGL2RenderingContext, p: WebGLProgram): (n: string) => WebGLUniformLocation | null {
  const c = new Map<string, WebGLUniformLocation | null>()
  return (n) => {
    if (!c.has(n)) c.set(n, gl.getUniformLocation(p, n))
    return c.get(n)!
  }
}

/** The pile program for a shape (and torn edge) once it is linked, else null
 *  (the wall draws its flat cut a few frames longer). Its first request queues
 *  the compile, with its torn twin, and asks nothing back : a status query would
 *  wait for it. With KHR_parallel_shader_compile each later call polls
 *  COMPLETION_STATUS, which never waits; without it the link status is read on
 *  the next frame, by when the GPU process has usually compiled it. */
function pileGL(gl: WebGL2RenderingContext, g: CollageGL, shape: number, torn: boolean): PileGL | null {
  const par = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null
  const key = `${shape}${torn ? 't' : ''}`
  let pg = g.piles.get(key)
  if (!pg) {
    for (const t of [torn, !torn]) {
      const k = `${shape}${t ? 't' : ''}`
      if (g.piles.has(k)) continue
      const p = gl.createProgram()!
      for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS_COLLAGE(shape, t, true)]] as const) {
        const sh = gl.createShader(type)!
        gl.shaderSource(sh, src)
        gl.compileShader(sh)
        gl.attachShader(p, sh)
      }
      gl.bindAttribLocation(p, 0, 'p')
      gl.linkProgram(p)
      g.piles.set(k, { prog: p, u: cacheOf(gl, p), state: 0 })
    }
    return null
  }
  if (pg.state === 1) return pg
  if (pg.state === -1) return null
  if (par && !gl.getProgramParameter(pg.prog, par.COMPLETION_STATUS_KHR)) return null
  if (gl.getProgramParameter(pg.prog, gl.LINK_STATUS)) {
    pg.state = 1
    return pg
  }
  pg.state = -1
  console.error('[collage] pile link:', key, gl.getProgramInfoLog(pg.prog))
  for (const sh of gl.getAttachedShaders(pg.prog) ?? [])
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) console.error('[collage] pile shader compile:', key, gl.getShaderInfoLog(sh))
  return null
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

/** A draw in [0,1) for (seed, key) that doesn't depend on any other draw : the
 *  partition's per-piece choices hang on the piece, not on how many pieces were
 *  drawn before it, so one more cut leaves every other piece as it was. */
function hash01(seed: number, key: number): number {
  let h = (seed ^ Math.imul(key + 1, 0x9e3779b1)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

type Rect = { x: number; y: number; w: number; h: number; id: number }

/** Cover-crop a piece's window into its film : the film rect (inside the deck's
 *  layer) a piece of `raw` aspect (real pixels) frames, quarter-turned pieces
 *  through the flipped aspect, `pan` placing it, `zoom` cropping tighter. */
function coverCrop(
  content: [number, number, number, number],
  pan: [number, number],
  raw: number,
  rot: number,
  zoom: number,
  out: Float32Array | number[],
  o: number
): void {
  const [cx, cy, cw, ch] = content
  // The layer is square, so the content rect's own ratio IS the clip aspect.
  const av = ch > 0 ? cw / ch : 1
  const ac = rot % 2 === 1 ? 1 / raw : raw
  let sw: number, sh: number
  if (ac >= av) { sw = cw; sh = ch * (av / ac) } else { sh = ch; sw = cw * (ac / av) }
  sw /= zoom
  sh /= zoom
  out[o] = cx + (cw - sw) * pan[0]
  out[o + 1] = cy + (ch - sh) * pan[1]
  out[o + 2] = sw
  out[o + 3] = sh
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
  unusedAt: number // when no piece played it any more (0 = in use) : paused after a grace
  bad: boolean // its file failed to load or decode : re-cued onto another film
  onFrame: (() => void) | null // its frame callback (re-armed when a new file loads)
  cueStart: number // where its cue starts playing (loaded later when a piece takes it)
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
  // STACK : the piece's height in the pile (0..1) and its four growth draws
  // (left, right, bottom, top; a mosaic shard uses the first), per piece id.
  z: number
  grow: [number, number, number, number]
  // TORN / SHAPED : the tilt draw and three shape draws, per piece id.
  form: [number, number, number, number]
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
  private cutsAt = 0 // when the piece count last changed (a modulated count steps at most this often)
  private badClips = new Set<string>() // files that failed : never dealt again
  private stagingBytes = new Map<string, number>()
  private soundFiles: string[] = [] // the pool's originals, for Sonify's Collage voice
  private soundFilesKey = ''
  private upStart = 0 // round-robin start of the frame uploads
  private hiddenAt = 0 // (the background) when it stopped being drawn
  private baseCuts = 12 // the stored count (the modulated one never resizes the deck array)
  private filmsAt = 0
  private lastRotate = -1
  private lastZoom = -1
  private lastFilms = -1
  private lastShape = -1
  private holdNow = 0 // the window the decks loop (quantised)
  private holdWant = 0 // a new window waiting out its debounce
  private holdWait = 0
  private cropsDirty = false
  private stackOn = false // the last films pass drew the pile
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
  private formArr = new Float32Array(MAX_CELLS * 4)
  // The piled pieces (torn, shaped, a stacked mosaic) : what the films pass
  // found at each pixel, written by it and read
  // by the shapes pass of the same frame (see the shader's oId).
  private idTex: WebGLTexture | null = null
  private idReady = false
  private idUsedAt = 0
  private siteArr = new Float32Array(MAX_CELLS * 4)
  private rowsArr = new Float32Array(MAX_ROWS * 4)
  private rowCount = 0
  private rank = new Float32Array(MAX_CELLS)
  // LAZY FILMS (see the header) : each deck's place in the order pieces take
  // films under the current seed, the most pieces the wall has had lately, and
  // whether every deck stays loaded anyway (a fast auto deal re-cuts among the
  // films already playing; an assemblage feed owns its decks).
  private deckRank = new Int32Array(0)
  private reachHigh = 0
  private reachPrev = 0
  private reachAt = 0
  private eager = true
  private reserveAt = 0 // when the last reserve film was loaded

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
      varyU: 0, used: true, shown: true, running: true, needFrame: false, unusedAt: 0, bad: false, onFrame: null,
      cueStart: 0
    }
    el.addEventListener('seeked', () => { deck.seeking = false; deck.pending = true })
    // A bad file must never wedge the wall : clear the gate, and flag it so the
    // next tick puts this deck on another film (it used to sit on its last frame
    // for good : a re-deal with the same seed re-cued the same broken file).
    el.addEventListener('error', () => {
      deck.seeking = false
      if ((el.error?.code ?? 0) >= 2) deck.bad = true
    })
    // A new src aborts any seek in flight WITHOUT a 'seeked' : clear the gate,
    // or the window loop waits on a seek that will never report back.
    el.addEventListener('emptied', () => { deck.seeking = false })
    const step = (): void => {
      deck.pending = true
      if (typeof el.requestVideoFrameCallback === 'function')
        deck.rvfc = el.requestVideoFrameCallback(step)
    }
    deck.onFrame = step
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
    asm.setFolder(edl.folder ?? null)
    asm.setPlaying(true)
    return {
      asm, el: document.createElement('video'), src: edl.id, clip: null,
      inSec: 0, lenSec: 0, content: [0, 0, 1, 1], blitted: false, blitAt: 0, blitT: -1, pending: false, rvfc: 0,
      seeking: false, seekAt: 0, pendingSeek: null, churning: false, nextRoll: 0,
      pan: [0.5, 0.5], panNext: null, varyU: rnd() * 2 - 1, used: true, shown: true,
      running: true, needFrame: false, unusedAt: 0, bad: false, onFrame: null, cueStart: 0
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

  /** The top-piece target (R32UI, output-sized), made on first use. */
  private idTarget(): WebGLTexture {
    if (this.idTex) return this.idTex
    const gl = this.gl
    const t = gl.createTexture()!
    gl.activeTexture(gl.TEXTURE2)
    gl.bindTexture(gl.TEXTURE_2D, t)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32UI, this.w, this.h, 0, gl.RED_INTEGER, gl.UNSIGNED_INT, null)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.activeTexture(gl.TEXTURE0)
    this.idTex = t
    return t
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
    const bytes = el.videoWidth * el.videoHeight * 4
    const hit = this.staging.get(key) ?? null
    if (hit) this.staging.delete(key)
    else {
      // evict the least recently used while over the count or the memory cap
      let total = 0
      for (const b of this.stagingBytes.values()) total += b
      while (this.staging.size && (this.staging.size >= STAGING_MAX || total + bytes > STAGING_BUDGET)) {
        const oldest = this.staging.keys().next().value as string
        const t = this.staging.get(oldest)
        if (t) this.gl.deleteTexture(t)
        this.staging.delete(oldest)
        total -= this.stagingBytes.get(oldest) ?? 0
        this.stagingBytes.delete(oldest)
      }
    }
    const t = uploadVideoFrame(this.gl, el, hit)
    if (t) {
      this.staging.set(key, t) // (re)insert : most recently used last
      this.stagingBytes.set(key, bytes)
    }
    return t
  }

  // ── Dealing ────────────────────────────────────────────────────────────

  /** Give every deck a clip and a window. `rnd` keeps a deal reproducible. */
  private deal(hold: number, churn: number, structural = false): void {
    if (!this.pool.length) return
    const rnd = mulberry32(this.seed)
    const n = this.decks.length
    const nChurn = Math.round(churn * n)
    this.rankDecks((this.seed ^ 0x9e3779b9) >>> 0)
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
      let clip = bag.pop()!
      // a file that failed once is skipped while the pool has others
      for (let k = 0; this.badClips.has(clip.id) && k < this.pool.length; k++) {
        if (!bag.length) break
        clip = bag.pop()!
      }
      const d = this.decks[i]
      // The churning decks are the FIRST `churn x n` : deterministic, so the
      // dial sweeps in a stable order instead of reshuffling who churns.
      d.churning = i < nChurn
      // A STRUCTURAL re-deal (another film count, a new pool...) keeps the same
      // seed, so a deck draws the clip it already plays : it plays on (it used to
      // be cued back to its first frame, so every film restarted on every step
      // of a modulated `films`). The draws are still taken, in the same order.
      const keep = structural && d.clip?.id === clip.id && !!d.src
      this.cue(d, clip, hold, rnd, false, keep, this.wants(i, true))
      const pn: [number, number] = [rnd(), rnd()]
      if (!keep) d.panNext = pn
      d.nextRoll = (0.25 + rnd() * 1.2) / Math.max(0.15, churn)
    }
    // The churn generator restarts on a NEW deal only : restarted on structural
    // re-deals too, it repeated the same re-rolls after every change.
    if (!structural) this.rollRnd = mulberry32((this.seed ^ 0x2545f491) >>> 0)
    this.holdNow = this.holdWant = holdQ(hold)
    this.holdWait = 0
  }

  /** Each deck's place in the order pieces take films under `seed` : the same
   *  draws and the same tie-break as rebuildCells, so a wall of n pieces plays
   *  exactly the decks ranked under n. */
  private rankDecks(seed: number): void {
    const nd = this.decks.length
    const k = Array.from({ length: nd }, (_, d) => hash01(seed, 5000 + d))
    const order = Array.from({ length: nd }, (_, d) => d).sort((a, b) => k[a] - k[b] || a - b)
    if (this.deckRank.length !== nd) this.deckRank = new Int32Array(nd)
    order.forEach((d, r) => { this.deckRank[d] = r })
  }

  /** Should deck `i` hold its film loaded : a piece plays it, or the piece
   *  count reaches it (the stored count, or the most the wall had lately,
   *  plus one). `ignoreUsed` : at a deal, before the new partition is cut. */
  private wants(i: number, ignoreUsed = false): boolean {
    if (this.eager) return true
    const d = this.decks[i]
    if (!d || (!ignoreUsed && d.used)) return true
    const reach = Math.max(this.cells.length, Math.round(this.baseCuts), this.reachHigh, this.reachPrev) + 1
    return (this.deckRank[i] ?? 0) < reach
  }

  /** Unload a deck's film (its decoder and buffers go) but keep its cue : it
   *  loads again when a piece takes it. */
  private release(d: Deck): void {
    if (d.asm || !d.src) return
    if (d.pendingSeek) d.el.removeEventListener('loadedmetadata', d.pendingSeek)
    d.pendingSeek = null
    d.seeking = false
    d.pending = false
    d.needFrame = false
    try {
      d.el.pause()
      d.el.removeAttribute('src')
      d.el.load()
    } catch {
      /* best-effort */
    }
    d.src = ''
    // its layer holds the last frame of the film it let go : a piece dealt onto
    // it before its next film lands shows a stand-in (shownDeck), not that
    d.blitted = false
  }

  /** The deck a piece shows : its own once its film has a frame; until then a
   *  loaded one stands in (a piece on a film still loading drew black, or a
   *  frozen frame of the deck's previous film at the wrong crop). */
  private shownDeck(i: number): number {
    const nd = this.decks.length
    if (nd === 0 || this.decks[i]?.blitted) return i
    for (let k = 1; k < nd; k++) {
      const j = (i + k) % nd
      if (this.decks[j].blitted) return j
    }
    return i
  }

  /** Load a released deck's film at its cue, as cue() would have. */
  private realize(d: Deck): void {
    if (!d.clip || d.asm) return
    this.loadInto(d, `opsia-media://local/${encodeURIComponent(d.clip.file)}`)
    const dur = Math.max(0.1, d.clip.durSec)
    d.el.loop = d.lenSec >= dur - 0.05
    d.needFrame = true
    const t = d.cueStart >= d.inSec && d.cueStart < d.inSec + d.lenSec ? d.cueStart : d.inSec
    this.seekTo(d, t)
  }

  /** Point one deck at a clip and a window inside it. A whole-film cue starts
   *  at the top, except a churn re-roll, which drops in anywhere (a montage of
   *  opening seconds is not a montage). */
  private cue(d: Deck, clip: CollageClip, hold: number, rnd: () => number, randomStart: boolean, keep = false, want = true): void {
    const url = `opsia-media://local/${encodeURIComponent(clip.file)}`
    const dur = Math.max(0.1, clip.durSec)
    const len = hold > 0.4 ? Math.min(hold, dur) : dur
    const whole = len >= dur - 0.05
    const start = whole ? (randomStart ? rnd() * dur * 0.8 : 0) : rnd() * (dur - len)
    if (keep) {
      // Same film : keep its playhead, re-window it around where it is.
      rnd() // the varyU draw, taken all the same
      this.rewindow(d, hold)
      return
    }
    d.clip = clip
    d.inSec = whole ? 0 : start
    d.lenSec = whole ? dur : len
    d.varyU = rnd() * 2 - 1
    // Until its first frame lands the layer is empty; frame the crop on the
    // probed size meanwhile (the blit records the real one).
    if (!d.blitted) d.content = containRect(clip.width, clip.height)
    d.cueStart = start
    if (!want) {
      // No piece can show it yet : dealt (the same draws, so the wall is the
      // one every film loaded would have dealt) but not loaded.
      this.release(d)
      return
    }
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
    d.bad = false
    d.src = url
    d.el.src = url
    d.el.load()
    // Re-arm the frame callback on the new file (as VideoSource.load does) : one
    // left pending on the old source can be stranded, and the deck then fell
    // back to the slow ~8 fps poll.
    if (d.onFrame && typeof d.el.requestVideoFrameCallback === 'function') {
      if (d.rvfc && typeof d.el.cancelVideoFrameCallback === 'function') d.el.cancelVideoFrameCallback(d.rvfc)
      d.rvfc = d.el.requestVideoFrameCallback(d.onFrame)
    }
    d.pending = true
  }

  /** Optimise re-encoded the pool : same clips (same ids), new playable files.
   *  Swap each deck onto its new file at the same moment of the film. */
  private swapFiles(): void {
    const byId = new Map(this.pool.map((c) => [c.id, c]))
    for (const d of this.decks) {
      if (d.asm || !d.clip) continue
      const nc = byId.get(d.clip.id)
      if (!nc || nc.file === d.clip.file) continue
      if (!d.src) { d.clip = nc; continue } // not loaded : it loads the new file when taken
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
    const good = this.pool.filter((c) => !this.badClips.has(c.id))
    const P = good.length ? good : this.pool
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
  private bspRects(cuts: number, seed: number): Rect[] {
    const minW = 0.06, minH = 0.06
    // A piece keeps its id when it splits (the first half); the new half takes
    // the split's number. Each split's draws hang on its number, so the first
    // n-1 splits are the same whatever the count : one more cut is ONE more split.
    const rects: Rect[] = [{ x: 0, y: 0, w: 1, h: 1, id: 0 }]
    for (let s = 1; rects.length < cuts; s++) {
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
      const vertical = canV && canH ? hash01(seed, 2 * s) < c.w / (c.w + c.h) : canV
      const t = 0.35 + hash01(seed, 2 * s + 1) * 0.3
      if (vertical) {
        const sw = c.w * t
        rects.splice(idx, 1, { x: c.x, y: c.y, w: sw, h: c.h, id: c.id }, { x: c.x + sw, y: c.y, w: c.w - sw, h: c.h, id: s })
      } else {
        const sh = c.h * t
        rects.splice(idx, 1, { x: c.x, y: c.y, w: c.w, h: sh, id: c.id }, { x: c.x, y: c.y + sh, w: c.w, h: c.h - sh, id: s })
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
  private mosaicSeeds(cuts: number, seed: number): Rect[] {
    const n = Math.min(cuts, MAX_CELLS)
    const aspect = this.w / this.h
    // Best-candidate sampling : each seed is the farthest from the earlier
    // ones of a dozen candidates, so ANY first n seeds spread evenly : one more
    // cut adds one shard and the others barely move. (Seeds jittered in rows were
    // re-laid for every count : a modulated `cuts` reshuffled the whole mosaic.)
    const sx: number[] = [], sy: number[] = []
    for (let k = 0; k < n; k++) {
      let bx = 0, by = 0, bd = -1
      const C = k === 0 ? 1 : 12
      for (let c = 0; c < C; c++) {
        const x = (0.03 + 0.94 * hash01(seed, 1000 + k * 32 + c * 2)) * aspect
        const y = 0.03 + 0.94 * hash01(seed, 1001 + k * 32 + c * 2)
        let dmin = 1e9
        for (let j = 0; j < k; j++) { const dx = x - sx[j], dy = y - sy[j]; const d = dx * dx + dy * dy; if (d < dmin) dmin = d }
        if (dmin > bd) { bd = dmin; bx = x; by = y }
      }
      sx.push(bx); sy.push(by)
    }
    // The shader searches every seed (64 distances a pixel, nothing on a GPU) :
    // no row table, so the seeds can sit anywhere.
    this.rowsArr.fill(0)
    this.rowCount = 0
    this.siteArr.fill(0)
    // WARP weights : a seed's own pull, up to about half the mean spacing.
    const spacing = Math.sqrt(aspect / Math.max(1, n))
    for (let i = 0; i < n; i++) {
      this.siteArr[i * 4] = sx[i]
      this.siteArr[i * 4 + 1] = sy[i]
      this.siteArr[i * 4 + 3] = spacing * 0.5 * hash01(seed, 13000 + i)
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
    const out: Rect[] = []
    for (let i = 0; i < n; i++) {
      // A seed that owned no grid sample (can't happen with this jitter, but be
      // safe) gets a nominal box around itself.
      if (bx1[i] < bx0[i]) { bx0[i] = sx[i] / aspect - 0.05; bx1[i] = sx[i] / aspect + 0.05; by0[i] = sy[i] - 0.05; by1[i] = sy[i] + 0.05 }
      const x0 = Math.max(0, bx0[i] - px), x1 = Math.min(1, bx1[i] + px)
      const y0 = Math.max(0, by0[i] - py), y1 = Math.min(1, by1[i] + py)
      out.push({ x: x0, y: y0, w: Math.max(1e-3, x1 - x0), h: Math.max(1e-3, y1 - y0), id: i })
    }
    return out
  }

  /** Rebuild the partition (cut-up rects or mosaic shards), then deal decks
   *  round-robin over it and assign the mask dropout order. */
  private rebuildCells(cuts: number, shape: number): void {
    this.dealSerial++
    const seed = (this.seed ^ 0x9e3779b9) >>> 0
    let rects: Rect[] = shape === 1 ? this.mosaicSeeds(cuts, seed) : this.bspRects(cuts, seed)
    if (shape !== 1) this.rowCount = 0
    if (rects.length > MAX_CELLS) rects = rects.slice(0, MAX_CELLS)
    const n = rects.length
    const nd = Math.max(1, this.decks.length)
    // Everything about a piece hangs on its id (its order of creation), so a
    // modulated count only adds or removes the newest pieces :
    // FILMS : each piece, in that order, takes the film fewest pieces play yet
    // (ties : a fixed per-film draw), so a wall shows as many films as it can
    // before repeating, and one more cut never moves another piece's film. (A
    // piece that splits keeps its film in its first half.)
    this.rankDecks(seed)
    const deckOf = new Int32Array(n)
    const uses = new Int32Array(nd)
    for (let id = 0; id < n; id++) {
      let best = 0, bu = 1e9, bk = 2
      for (let d = 0; d < nd; d++) {
        const k = hash01(seed, 5000 + d)
        if (uses[d] < bu || (uses[d] === bu && k < bk)) { bu = uses[d]; bk = k; best = d }
      }
      deckOf[id] = best
      uses[best]++
    }
    // MASK dropout order : the pieces peel in a fixed order of their own draws,
    // at an even spacing over (0,0.90] (the dial peels at a steady rate); the
    // ceiling sits below the shader's 0.06 fade band, and the piece with the
    // highest draw holds an unreachable 2.0 : full mask leaves exactly one piece,
    // and every deal elects a new one. One more piece shifts the spacing a hair,
    // never the order.
    const ids = Array.from({ length: n }, (_, i) => i)
    ids.sort((a, b) => hash01(seed, 9000 + a) - hash01(seed, 9000 + b))
    const rankOf = new Float32Array(n)
    for (let i = 0; i < n; i++) rankOf[ids[i]] = ((i + 1) / n) * 0.9
    if (n) rankOf[ids[n - 1]] = 2.0
    this.cells = rects.map((r) => ({
      x: r.x, y: r.y, w: r.w, h: r.h, deck: deckOf[r.id],
      // ROTATE draws, per piece : sweeping the dial turns pieces in a fixed order
      rot: 0, rotA: hash01(seed, 7000 + 2 * r.id), rotB: hash01(seed, 7001 + 2 * r.id),
      crop: [0, 0, 1, 1] as [number, number, number, number],
      z: hash01(seed, 11000 + r.id),
      grow: [0, 1, 2, 3].map((k) => hash01(seed, 11100 + 4 * r.id + k)) as [number, number, number, number],
      form: [0, 1, 2, 3].map((k) => hash01(seed, 11500 + 4 * r.id + k)) as [number, number, number, number]
    }))
    for (let i = 0; i < n; i++) this.rank[i] = rankOf[rects[i].id]
    for (const d of this.decks) d.used = false
    for (const c of this.cells) if (this.decks[c.deck]) this.decks[c.deck].used = true
    for (const d of this.decks) if (d.used) d.unusedAt = 0
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
      const d = this.decks[this.shownDeck(c.deck)] // (a stand-in's picture while its film loads)
      if (!d) continue
      coverCrop(d.content, d.pan, (c.w / c.h) * outAspect, c.rot, z, c.crop, 0)
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
      // (their files too : an edit relinked, or its converted copies made again,
      // plays the new files)
      const ek = edls.map((e) => `${e.id}:${(e.clips ?? []).map((c) => c.file).join(',')}`).join('|')
      if (ek !== this.edlKey) {
        this.edls = edls.slice()
        this.edlKey = ek
        this.edlDirty = true
      }
    }
    this.live = { ...inputs }
    this.baseCuts = clampf(num(inputs.cuts, 12), 2, MAX_CELLS)
  }

  /** Modulation overlay (applyModulation runs after syncFromState). */
  setInput(name: string, value: number | number[]): void {
    this.live[name] = value
  }

  /** For Sonify's Collage voice : every piece (centre, film, shown or masked)
   *  and every film (the video its sound follows, the file to hear). */
  soundInfo(): { pieces: CollageSoundPiece[]; decks: CollageSoundDeck[]; deal: number; xfade: number; files: string[] } | null {
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
        // (the clip's ORIGINAL file when the edit knows its corpus folder : a
        // converted copy has no sound)
        const si = d.asm.soundInfo()
        if (si && si.el) return { el: si.el, path: si.path }
        const a = d.asm as unknown as { decks?: Array<{ el?: HTMLVideoElement }>; live?: number }
        const el = a.decks?.[a.live ?? 0]?.el ?? null
        const p = el ? pathFromMediaUrl(el.currentSrc || el.src) : null
        return { el, path: p }
      }
      if (!d.src || !d.clip) return { el: null, path: null }
      return { el: d.el, path: this.originalOf(d.clip) }
    })
    // every film the wall may deal, as heard : one array until the pool changes
    if (this.soundFilesKey !== this.poolFiles) {
      this.soundFilesKey = this.poolFiles
      this.soundFiles = this.pool.map((c) => this.originalOf(c))
    }
    return { pieces, decks, deal: this.dealSerial, xfade: this.xfadeDur, files: this.soundFiles }
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

    // CUTS / FILMS step with a little hysteresis (±0.75 around the count in
    // use) and at most every 120 / 300 ms : a modulator hovering on a .5 used
    // to flip the wall every frame.
    const cutsRaw = clampf(num(inputs.cuts, 12), 2, MAX_CELLS)
    let cuts = this.lastCuts > 0 ? this.lastCuts : Math.round(cutsRaw)
    if (Math.abs(cutsRaw - cuts) >= 0.75 && now - this.cutsAt >= 120) { cuts = Math.round(cutsRaw); this.cutsAt = now }
    const filmsRaw = clampf(num(inputs.films, 12), 1, MAX_DECKS)
    let films = this.lastFilms > 0 ? this.lastFilms : Math.round(filmsRaw)
    if (Math.abs(filmsRaw - films) >= 0.75 && now - this.filmsAt >= 300) { films = Math.round(filmsRaw); this.filmsAt = now }
    const rotate = clampf(num(inputs.rotate, 0), 0, 1)
    const hold = clampf(num(inputs.hold, 0), 0, 30)
    const churn = clampf(num(inputs.churn, 0), 0, 1)
    const zoom = clampf(num(inputs.zoom, 1.05), 1, 3)
    const speed = clampf(num(inputs.speed, 1), 0.1, 4)
    const vary = clampf(num(inputs.vary, 0), 0, 1)
    const freeze = num(inputs.freeze, 0) >= 0.5
    const rate = clampf(num(inputs.rate, 0), 0, 60)
    this.eager = Math.round(num(inputs.feed, 0)) === 1 || (rate > 0.01 && rate < FAST_DEAL_S)
    const shape = Math.round(clampf(num(inputs.shape, 0), 0, 3))
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
    // The array's layer edge follows the piece size of the STORED count (never
    // the modulated one : a slow modulator used to reallocate up to 80 MB and
    // re-blit every film); debounced on top.
    const tileWant = tileFor(this.decks.length, Math.round(this.baseCuts), this.w, this.h, this.maxTex)
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
    let fastRecut = false // an auto deal too quick to load films : re-cut only
    if (rate > 0.01) {
      // At least ~0.15s between deals : a deal reloads clips, and dealing every
      // frame is a reload storm no wall can survive. Frozen, the clock waits.
      if (!freeze) this.dealTimer += dt
      if (this.dealTimer >= Math.max(rate, 0.15)) {
        this.dealTimer = 0
        if (!reseedRecut) fastRecut = rate < FAST_DEAL_S
        reseedRecut = true
      }
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
      // A FAST auto deal re-cuts the wall and re-shuffles the films already
      // playing over the new pieces : no file loads (see FAST_DEAL_S).
      if (feed === 0 && !(fastRecut && !poolChanged && !deckChanged)) this.deal(hold, churn, !reseedRecut || poolChanged || deckChanged)
      this.rebuildCells(cuts, shape)
    } else if (filesChanged && feed === 0) {
      this.swapFiles()
    }
    if (rotate !== this.lastRotate) this.applyRotate(rotate)
    // The most pieces the wall has had lately (a modulated count : this two-
    // minute window and the one before) : the films that many pieces reach
    // stay loaded (LAZY FILMS).
    if (now - this.reachAt > 120000) {
      this.reachPrev = this.reachHigh
      this.reachHigh = 0
      this.reachAt = now
    }
    this.reachHigh = Math.max(this.reachHigh, this.cells.length)
    if (Math.abs(zoom - this.lastZoom) > 1e-4) {
      this.lastZoom = zoom
      this.cropsDirty = true
    }

    // Advance an in-flight crossfade. If the time is pulled to 0 mid-fade, snap
    // to done rather than freezing a stale outgoing wall.
    if (this.xfade < 1) this.xfade = xfadeDur > 0 ? Math.min(1, this.xfade + dt / xfadeDur) : 1

    // The window knob, live : every deck re-windows around its own playhead, at
    // most every 0.3 s while the knob moves. (It used to wait for the knob to
    // STOP for 0.3 s, so a modulated window only changed at the modulator's
    // turning points.)
    const hq = holdQ(hold)
    if (hq === this.holdNow) this.holdWait = 0
    else if ((this.holdWait += realDt) >= 0.3) {
      this.holdNow = this.holdWant = hq
      this.holdWait = 0
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
      if (d.bad) {
        // Its file failed : never deal it again, put this deck on another film.
        this.badClips.add(d.clip.id)
        d.bad = false
        const other = this.pickOther(d.clip)
        if (other && other.id !== d.clip.id) this.cue(d, other, hold, this.rollRnd, false, false, this.wants(i))
      }
      // LAZY FILMS : load a film a piece can now reach; let go of one no piece
      // has played for a while (the same 1.5 s grace as the pause below). A
      // film a piece shows loads at once; the others (a fast deal's reserve)
      // one every 120 ms : 19 at once held the films on screen up for 3.5 s.
      if (!d.src) {
        if (!this.wants(i)) continue
        if (!d.used) {
          if (now - this.reserveAt < 120) continue
          this.reserveAt = now
        }
        this.realize(d)
      } else if (!d.used && d.unusedAt && now - d.unusedAt > 1500 && !this.wants(i)) {
        this.release(d)
        continue
      }
      // Churn applies live : the first round(churn x n) decks re-roll on their
      // own clock. A deck joining the churn starts at a random point of its
      // cycle so a turned dial doesn't make every piece jump at once.
      const was = d.churning
      d.churning = i < nChurn
      if (d.churning && !was) d.nextRoll = (0.1 + this.rollRnd() * 1.2) / Math.max(0.15, churn)
      // A film no piece plays any more keeps running 1.5 s before it pauses : a
      // modulated `cuts` dipping under `films` used to pause and replay films
      // on every step.
      if (!d.used && !d.unusedAt) d.unusedAt = now
      const inUse = d.used || now - d.unusedAt < 1500
      // A film just cued runs until its first frame lands, even on a stopped
      // wall (freeze, or a layer / global Speed of 0 : a deal used to never show).
      const run = inUse && (d.needFrame || (!freeze && r > 0.004))
      const want = clampf(r, RATE_MIN, RATE_MAX)
      if (Math.abs(d.el.playbackRate - want) > want * 0.02) {
        try { d.el.playbackRate = want } catch { /* out-of-band rate */ }
      }
      if (!run) {
        if (!d.el.paused) d.el.pause()
        continue
      }
      if (d.churning && churn > 0.001 && !freeze) {
        d.nextRoll -= dt
        if (d.nextRoll <= 0) {
          // Re-roll this deck onto another film (and another window of it) :
          // this cell becomes its own little montage.
          const clip = this.pickOther(d.clip)
          if (clip) {
            // (a film that just lost its piece is dealt, not loaded : it was
            // loaded only to be let go 1.5 s later)
            this.cue(d, clip, hold, this.rollRnd, true, false, this.wants(i))
            d.panNext = [this.rollRnd(), this.rollRnd()]
          }
          d.nextRoll = (0.25 + this.rollRnd() * 1.2) / Math.max(0.15, churn)
        }
      }
      // Sub-window looping : native loop only covers whole files. Checked BEFORE
      // play() : on an ended window, play() rewinds to 0 first and the window
      // then seeked again (two seeks per loop).
      if (!d.el.loop && d.el.readyState >= 2 && !d.seeking) {
        const t = d.el.currentTime
        if (t >= d.inSec + d.lenSec || t < d.inSec - 0.25 || d.el.ended) this.seekTo(d, d.inSec)
      }
      if (d.el.paused && d.el.readyState >= 2) void d.el.play().catch(() => {})
    }
  }

  /** (The background) not drawn this frame : after a second, stop the decoders
   *  (a background Collage at opacity 0 kept every film decoding for nothing).
   *  The next render() plays them again. */
  idle(): void {
    const now = performance.now()
    if (!this.hiddenAt) { this.hiddenAt = now; return }
    if (now - this.hiddenAt < 1000) return
    for (const d of this.decks) {
      if (d.asm) { if (d.running) { d.asm.setPlaying(false); d.running = false } }
      else if (!d.el.paused) d.el.pause()
    }
  }

  /** FX BEFORE SHAPES : the source's FX rack processes the films alone, and the
   *  seams, contours, torn paper and holes are drawn afterwards, crisp, over the
   *  processed films (Compositor : render(…, true) → the rack → renderShapes). */
  get fxFirst(): boolean {
    return num(this.live.fxFirst, 0) >= 0.5
  }

  /** Draw the wall into the layer's scratch target. `clockSec` is the layer's
   *  own clock (Speed x global speed; the background's slow clock); without it
   *  the wall falls back to realtime. `filmsOnly` : draw just the films, every
   *  piece whole (the FX-before-shapes first pass). */
  render(scratchFbo: WebGLFramebuffer, clockSec?: number, filmsOnly = false): void {
    if (this.disposed) return
    const gl = this.gl
    const g = collageGL(gl)
    this.hiddenAt = 0
    this.idReady = false
    this.tick(clockSec)
    // Own vertex array for every draw : the default one belongs to the ISF runtime.
    gl.bindVertexArray(g.vao)
    try {
      this.draw(g, scratchFbo, filmsOnly ? 1 : 0, null)
    } finally {
      gl.bindVertexArray(null)
    }
  }

  /** The FX-before-shapes second pass : the wall's shapes over `fxTex` (the
   *  films after the source's FX), into `fbo`. Same frame as the render() just
   *  before it : nothing is ticked or uploaded again. */
  renderShapes(fxTex: WebGLTexture, fbo: WebGLFramebuffer): void {
    if (this.disposed) return
    const gl = this.gl
    const g = collageGL(gl)
    gl.bindVertexArray(g.vao)
    try {
      this.draw(g, fbo, 2, fxTex)
    } finally {
      gl.bindVertexArray(null)
    }
  }

  private draw(g: CollageGL, scratchFbo: WebGLFramebuffer, pass: number, fxTex: WebGLTexture | null): void {
    const gl = this.gl
    gl.disable(gl.BLEND)

    // 1) Fold every freshly decoded frame into its array layer. A deck no piece
    //    shows is skipped (its pending frame waits until it is shown again).
    if (pass !== 2 && this.arr && this.fbo) {
      let bound = false
      const T = this.tile
      const now = performance.now()
      // Round-robin under a time budget : the films that miss this frame go
      // first next frame.
      const nDeck = Math.min(this.decks.length, this.arrLayers)
      let spent = 0, uploads = 0
      for (let k = 0; k < nDeck; k++) {
        const i = (this.upStart + k) % nDeck
        if (uploads >= 2 && spent > UPLOAD_BUDGET_MS) { this.upStart = i; break }
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
          const t0 = performance.now()
          tex = this.uploadStaged(d.el)
          spent += performance.now() - t0
          uploads++
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
        if (!d.blitted) this.cropsDirty = true // its pieces leave their stand-in
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
      if (pass !== 1) this.prevValid = false
      return
    }

    // 3) The collage uniforms. With STACK every piece grows past its cut (a
    //    cut-up piece by its own draw on each side, a mosaic shard all round),
    //    up to a share of its smaller side and of the mean piece, and its film is
    //    cover-cropped to the grown shape, so it frames the whole piece unstretched.
    //    A torn or shaped piece is its own scrap around its cell instead (below).
    const live = this.live
    const stack = clampf(num(live.stack, 0), 0, 1)
    const shape = this.lastShape
    const tornOn = num(live.torn, 0) > 0.001
    // (the shapes pass draws what the films pass drew, even on the frame the
    // pile program comes ready between the two)
    const sg = (stack > 0.001 || shape >= 2) && (pass !== 2 || this.stackOn) ? pileGL(gl, g, shape, tornOn) : null
    if (pass !== 2) this.stackOn = !!sg
    const aspect = this.w / this.h
    const mean = Math.sqrt(aspect / n) // a piece's mean side, height units
    const zoomNow = Math.max(1, this.lastZoom > 0 ? this.lastZoom : 1)
    for (let i = 0; i < n; i++) {
      const c = this.cells[i]
      let x = c.x, y = c.y, w = c.w, h = c.h
      const di = this.shownDeck(c.deck)
      const dk = this.decks[di]
      if (sg && dk && shape >= 2) {
        // The tilted piece's covering rect : the cell, turned, still inside it.
        const ang = (c.form[0] - 0.5) * (shape === 2 ? 0.84 : 0.6)
        const cs = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang))
        const cw = c.w * aspect, ch = c.h
        const W = cw * cs + ch * sn, H = cw * sn + ch * cs
        let rx: number, ry: number
        if (shape === 2) {
          // TORN : the paper past the cell by its deepest bite (some scraps
          // bigger than they need be), the film rect past the paper by the
          // widened end and the rag's outward reach. Must match sdPiece.
          const ks = clampf(Math.min(W, H) / 0.35, 0.3, 1)
          const taper = (c.form[1] - 0.5) * 0.5
          const extra = 1 + 0.25 * c.form[2]
          const px = (W / 2) * extra + 0.055 * ks, py = (H / 2) * extra + 0.055 * ks
          rx = px * (1 + Math.abs(taper)) + 0.02 * ks
          ry = py + 0.02 * ks
          this.formArr.set([ang, taper, ks, c.form[3]], i * 4)
        } else {
          // SHAPED : an ellipse around the turned rect (a little more for the
          // lobes' dips), the film rect out to the lobes' furthest reach.
          const fy = c.form[1], fz = c.form[2], fw = c.form[3]
          const a2 = 0.05 + 0.15 * (fy * 7.13 - Math.floor(fy * 7.13)), a3 = 0.15 * fz, a5 = 0.08 * fw
          const sum = a2 + a3 + a5
          const k = Math.SQRT2 * (1 + 0.5 * sum) * (1 + sum)
          rx = (W / 2) * k
          ry = (H / 2) * k
          this.formArr.set([ang, fy, fz, fw], i * 4)
        }
        const cx = c.x + c.w / 2, cy = c.y + c.h / 2
        x = cx - rx / aspect; y = cy - ry; w = (2 * rx) / aspect; h = 2 * ry
        coverCrop(dk.content, dk.pan, rx / ry, c.rot, zoomNow, this.cropArr, i * 4)
      } else if (sg && dk) {
        if (shape === 1) {
          const gr = stack * mean * 0.24 * (0.35 + 0.65 * c.grow[0])
          this.siteArr[i * 4 + 2] = gr
          // The shard's box, padded past the growth (its edge bows out a little
          // between seeds); the film read mirrors anything beyond.
          const gx = (1.5 * gr) / aspect, gy = 1.5 * gr
          const x0 = Math.max(0, x - gx), x1 = Math.min(1, x + w + gx)
          const y0 = Math.max(0, y - gy), y1 = Math.min(1, y + h + gy)
          x = x0; y = y0; w = x1 - x0; h = y1 - y0
        } else {
          const m = Math.min(w * aspect, h)
          const side = (k: number): number => stack * Math.min(m * (0.12 + 0.3 * c.grow[k]), 0.4 * mean)
          // Clamped to the frame : the outer edges stay the frame's cut.
          const x0 = Math.max(0, x - side(0) / aspect), x1 = Math.min(1, x + w + side(1) / aspect)
          const y0 = Math.max(0, y - side(2)), y1 = Math.min(1, y + h + side(3))
          x = x0; y = y0; w = x1 - x0; h = y1 - y0
        }
        coverCrop(dk.content, dk.pan, (w / h) * aspect, c.rot, zoomNow, this.cropArr, i * 4)
      } else {
        this.cropArr[i * 4] = c.crop[0]; this.cropArr[i * 4 + 1] = c.crop[1]
        this.cropArr[i * 4 + 2] = c.crop[2]; this.cropArr[i * 4 + 3] = c.crop[3]
      }
      this.cellArr[i * 4] = x; this.cellArr[i * 4 + 1] = y
      this.cellArr[i * 4 + 2] = w; this.cellArr[i * 4 + 3] = h
      // The deck's picture rect : the shader mirrors its film read inside it so
      // an over-running / frayed shape samples real film, never the padding.
      const ct = dk ? dk.content : [0, 0, 1, 1]
      this.contentArr[i * 4] = ct[0]; this.contentArr[i * 4 + 1] = ct[1]
      this.contentArr[i * 4 + 2] = ct[2]; this.contentArr[i * 4 + 3] = ct[3]
      this.metaArr[i * 4] = di
      this.metaArr[i * 4 + 1] = c.rot
      this.metaArr[i * 4 + 2] = this.rank[i]
      this.metaArr[i * 4 + 3] = c.z
    }
    const tg = tornOn ? g.torn : g
    const prog = sg ? sg.prog : shape === 1 ? tg.mosaic : tg.collage
    const U = sg ? sg.u : shape === 1 ? tg.uMos : tg.uColl
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
    gl.uniform1f(U('uWarp'), clampf(num(live.warp, 0), 0, 1))
    if (sg) gl.uniform1f(U('uStack'), stack)
    if (sg && shape >= 2) gl.uniform4fv(U('uForm'), this.formArr)
    gl.uniform1i(U('uContourMode'), Math.round(clampf(num(live.contourMode, 1), 0, 1)))
    gl.uniform1i(U('uPass'), pass)
    // The piled pieces : the films pass writes the top-piece target, the shapes
    // pass reads it on unit 2 (and nothing is bound there otherwise : the films
    // pass renders INTO it, and an active sampler on a bound target would be a
    // feedback loop).
    const useId = !!sg && shape !== 0
    const readId = useId && pass === 2 && this.idReady
    if (useId) this.idUsedAt = performance.now()
    else if (this.idTex && performance.now() - this.idUsedAt > ID_IDLE_MS) {
      gl.deleteTexture(this.idTex)
      this.idTex = null
    }
    if (useId) {
      gl.uniform1i(U('uId'), 2)
      gl.uniform1i(U('uHasId'), readId ? 1 : 0)
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, readId ? this.idTex : null)
      gl.activeTexture(gl.TEXTURE0)
    }
    gl.uniform1i(U('uFx'), 1) // its own unit, never the deck array's
    // Unit 1 holds the processed films in pass 2, and NOTHING otherwise : uFx is
    // an active sampler, so whatever was left bound there (the layer's own target)
    // would be a feedback loop and fail the draw.
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, pass === 2 && fxTex ? fxTex : null)
    gl.activeTexture(gl.TEXTURE0)

    // 4a) No crossfade : the wall draws straight into the layer, in the straight
    //     alpha the blend stack reads. No extra buffers, no copy pass.
    // (The films-only pass never dissolves : the shapes pass after the FX does.)
    const buffered = pass !== 1 && (this.xfadeDur > 0 || this.xfade < 1)
    if (!buffered) {
      gl.uniform1i(U('uStraight'), 1)
      gl.bindFramebuffer(gl.FRAMEBUFFER, scratchFbo)
      gl.viewport(0, 0, this.w, this.h)
      const writeId = useId && pass === 1
      if (writeId) {
        // the layer's own target keeps its color; the top-piece target rides
        // along as a second attachment for this one draw
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.idTarget(), 0)
        gl.drawBuffers(DRAW_WITH_ID)
      }
      gl.drawArrays(gl.TRIANGLES, 0, 3)
      if (writeId) {
        gl.drawBuffers(DRAW_PLAIN)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, null, 0)
        this.idReady = true
      }
      if (readId) {
        gl.activeTexture(gl.TEXTURE2)
        gl.bindTexture(gl.TEXTURE_2D, null)
        gl.activeTexture(gl.TEXTURE0)
        this.idReady = false
      }
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
      if (pass === 2) {
        gl.activeTexture(gl.TEXTURE1)
        gl.bindTexture(gl.TEXTURE_2D, null)
        gl.activeTexture(gl.TEXTURE0)
      }
      if (pass !== 1) {
        this.prevValid = false
        this.foldAt = null
      }
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
    if (pass === 2 && fxTex) {
      // the fold above rebound unit 0; the processed films stay on unit 1
      gl.activeTexture(gl.TEXTURE1)
      gl.bindTexture(gl.TEXTURE_2D, fxTex)
      gl.activeTexture(gl.TEXTURE0)
    }
    gl.uniform1i(U('uStraight'), 0)
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fbo)
    gl.viewport(0, 0, this.w, this.h)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null)
    if (readId) {
      gl.activeTexture(gl.TEXTURE2)
      gl.bindTexture(gl.TEXTURE_2D, null)
      gl.activeTexture(gl.TEXTURE0)
      this.idReady = false
    }

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
    if (this.idTex) gl.deleteTexture(this.idTex)
    this.idTex = null
    this.cur = null
    this.prev = null
    this.arr = null
    this.fbo = null
  }
}
