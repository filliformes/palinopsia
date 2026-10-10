/*{
  "DESCRIPTION": "Lowercase : machine-cut marks on a stepped clock. Hard rectangles, bars, ticks and sprocket ladders land on a step and hold, never sweep : the picture changes between frames and is still in between. FIGURE picks the vocabulary, from a dense data matrix down to one white slab with bars cut out of it. It carries its own clock (RATE, divided by STEP), so it pulses the moment you pick it; bind GATE to a Euclid, a Spastic or an audio transient and it plays that rhythm instead. HOLD is how many steps a deal survives, JUMP how far it moves on each deal, SCROLL whether a deal is a fresh draw or the last one slid a cell along, SHEAR knocks rows sideways, FLIP inverts the whole frame for one step. SMEAR leaves the previous step trailing behind, the way a filmed projection does. ACCENT marks a regular lattice of cells in its own color, so it reads as meaning and not as noise. Flat and hard-edged, never radial, never a gradient.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["Generator", "Geometry"],
  "INPUTS": [
    { "NAME": "figure",  "TYPE": "long", "VALUES": [0, 1, 2, 3, 4, 5, 6, 7], "LABELS": ["matrix", "blocks", "bars", "ticks", "rule", "grid", "ladder", "slab"], "DEFAULT": 0 },
    { "NAME": "cells",   "TYPE": "float", "MIN": 3.0,  "MAX": 512.0, "DEFAULT": 14.0, "LABEL": "cells" },
    { "NAME": "density", "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.55, "LABEL": "density" },
    { "NAME": "split",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.6,  "LABEL": "split" },
    { "NAME": "rate",    "TYPE": "float", "MIN": 0.0,  "MAX": 120.0, "DEFAULT": 6.0,  "LABEL": "rate" },
    { "NAME": "quant",   "TYPE": "float", "MIN": 1.0,  "MAX": 64.0,  "DEFAULT": 1.0,  "LABEL": "step" },
    { "NAME": "gate",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 1.0,  "LABEL": "gate" },
    { "NAME": "hold",    "TYPE": "float", "MIN": 1.0,  "MAX": 32.0,  "DEFAULT": 1.0,  "LABEL": "hold" },
    { "NAME": "jump",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.35, "LABEL": "jump" },
    { "NAME": "scroll",  "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.0,  "LABEL": "scroll" },
    { "NAME": "shear",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.0,  "LABEL": "shear" },
    { "NAME": "flip",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.0,  "LABEL": "flip" },
    { "NAME": "smear",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.25, "LABEL": "smear" },
    { "NAME": "halo",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.18, "LABEL": "halation" },
    { "NAME": "accentAmt", "TYPE": "float", "MIN": 0.0, "MAX": 1.0,  "DEFAULT": 0.0,  "LABEL": "accent" },
    { "NAME": "accentEvery", "TYPE": "float", "MIN": 2.0, "MAX": 16.0, "DEFAULT": 5.0, "LABEL": "accent every" },
    { "NAME": "seed",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.0,  "LABEL": "seed" },
    { "NAME": "audio",   "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.0,  "LABEL": "audio gate" },
    { "NAME": "ink",     "TYPE": "color", "DEFAULT": [0.92, 0.95, 0.94, 1.0] },
    { "NAME": "accent",  "TYPE": "color", "DEFAULT": [0.95, 0.22, 0.10, 1.0] },
    { "NAME": "ground",  "TYPE": "color", "DEFAULT": [0.03, 0.03, 0.035, 1.0] },
    { "NAME": "side",    "TYPE": "float", "MIN": 0.0,  "MAX": 1.0,   "DEFAULT": 0.0,  "LABEL": "sidechain" },
    { "NAME": "sideTex", "TYPE": "image" },
    { "NAME": "audioTex", "TYPE": "image" }
  ]
}*/

// The clock is an INTEGRATED phase, not TIME * rate : turning rate mid-show
// changes the pace from here on instead of flinging the picture (authoring
// rules §1). `quant` divides it into coarser steps without touching the phase,
// so a step division stays a clean ratio of the same clock.
uniform float PH_rate;

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }

// One cell's draw for deal `t`. Each deal is a FRESH draw : the deal count is
// a dimension of the hash of its own. Added to the cell index instead (as it
// first was), the next deal was the same field moved one cell along, so the
// figure scrolled and never dealt again. SCROLL keeps that look as a choice :
// toward 1 one draw slides a cell per deal for longer runs before a fresh one
// (up to 16 deals), and at 1 it only ever slides, a stream of data. Every
// input stays a floored integer well under 1e4 (§2).
float deal(vec2 c, float t, vec2 salt, vec2 dir) {
  float run = scroll > 0.995 ? 65536.0 : 1.0 + floor(scroll * 15.0 + 0.5);
  float d = floor(t / run);
  return hash13(vec3(c + salt + dir * (t - d * run), mod(d, 4093.0)));
}

// A hard-edged rectangle, anti-aliased over `e` and never thinner than a pixel.
// A sub-pixel mark breaks into dashes and shimmers at 1080p, which reads as a
// broken shader rather than a fast one (§3). `e` is also the halation knob :
// widen it and the same rectangle grows a soft skirt instead of a hard edge.
float rectCov(vec2 q, vec2 hw, float e) {
  vec2 d = abs(q) - max(hw, vec2(e * 0.5));
  float o = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  return 1.0 - smoothstep(-e, e, o);
}

// One deal of one figure. `S` is the step index, so the same function draws the
// PREVIOUS step for the smear with no buffer to keep : the figure is a pure
// function of its step, which is what makes a stateless trail possible.
// `soft` scales the edge width, which is how halation is sampled (one extra
// call with a fat edge) rather than by blurring a buffer.
float figureCov(vec2 q, float aspect, float S, float px, float dens, vec2 sideLA, int fig, float soft, out float isAcc) {
  isAcc = 0.0;
  float hand = floor(seed * 997.0);
  // Every hash input stays floored and under ~1e4 (§2) : S is wrapped by the
  // caller, `hand` is a small integer, cell indices are bounded by `cells`.
  float n = max(3.0, floor(cells + 0.5));
  float pxc = n * px;      // one pixel, in cell units
  // How many pixels a cell gets. Under about six it can no longer hold a mark
  // AND a margin, and anti-aliasing averages the pair into flat grey : at 512
  // cells on a 1080-line frame the whole field was one grey slab. `solid` grows
  // the mark to fill its own cell instead, so the top of the range is crisp
  // 1-bit static rather than mush, and the way there is continuous.
  float cellPx = 1.0 / max(pxc, 1e-6);
  float solid = 1.0 - smoothstep(2.5, 7.0, cellPx);
  float e = pxc * soft;    // the anti-aliased edge, widened for halation
  float eq = px * soft;    // the same, in frame-height units

  // SHEAR knocks whole ROWS sideways. Per row, not per pixel, or it stops being
  // a structural fault and becomes a blur.
  float row0 = floor(q.y * n);
  float sh = (hash12(vec2(row0, floor(S * 0.5) + hand + 71.0)) - 0.5) * shear * 2.0;
  vec2 qs = vec2(q.x + sh, q.y);

  // JUMP re-places the whole field on each deal : at 0 the lattice holds still
  // and only its cells change, at 1 it lands somewhere new on every step.
  vec2 off = (vec2(hash12(vec2(S, hand + 11.0)), hash12(vec2(S, hand + 29.0))) - 0.5) * jump;

  vec2 g = (qs + off) * n;
  vec2 ci = floor(g);
  vec2 f = fract(g) - 0.5;

  // Per-cell gate. AUDIO GATE leans each cell toward the spectrum band at its
  // own column (bass at the left), so cells answer the sound where they stand
  // rather than all pulsing together (§5).
  // Read at the cell's CENTER : read per pixel, a band edge crossing a cell
  // lit one part of it and not the other. Not read at all at 0.
  vec2 cc = (ci + 0.5) / n - off;
  vec2 ac = vec2(clamp(cc.x / aspect, 0.0, 1.0), 0.75);
  float band = 0.0;
  if (audio > 0.001) band = IMG_NORM_PIXEL(audioTex, ac).r;
  float g1 = clamp(mix(dens, band, audio), 0.0, 1.0);

  // SIDECHAIN : sampled once in main and handed in, because it is a SPATIAL
  // lookup and so the same for the live deal, the smear's previous deal and the
  // halation pass. Sampling it in here instead cost five texture fetches a
  // pixel and 4 ms of a 4K frame even with the control at zero.
  // Weighted by the layer's alpha : where it is transparent (or when no layer
  // is picked, which reads the bridge's transparent texel) the cell keeps its
  // own density. Unweighted, a sidechain with nothing in it emptied the frame.
  g1 = clamp(mix(g1, sideLA.x, side * sideLA.y), 0.0, 1.0);
  float lit = step(1.0 - g1, deal(ci, floor(S * 0.37), vec2(hand, hand + 3.0), vec2(1.0, 0.0)));

  // ACCENT rides a REGULAR lattice, not a sprinkle. A random scatter of color
  // reads as noise; a periodic one reads as meaning, which is the whole point
  // of keeping to a single accent.
  // The lattice is periodic in BOTH axes, so it marks one cell in per² rather
  // than one in per. Measured against the references : a combined index hit 20%
  // of cells at per 5 and the frame turned into confetti; they carry nearer 5%.
  float per = max(2.0, floor(accentEvery + 0.5));
  float accHit = step(mod(ci.x + floor(S * 0.25), per), 0.5)
               * step(mod(ci.y + floor(S * 0.17), per), 0.5);
  isAcc = accHit * lit;

  float cov = 0.0;

  if (fig == 0) {
    // MATRIX : the signature. Each lit cell carries one to three NARROW bars.
    // The subdivision is what makes the field read as data instead of a
    // checkerboard, and it is the thing the references have that a plain grid
    // of squares does not.
    float nb = mix(1.0 + floor(deal(ci, floor(S * 0.11), vec2(hand + 5.0, 0.0), vec2(0.0, 1.0)) * 3.0 * split), 1.0, solid);
    float bf = fract((f.x + 0.5) * nb) - 0.5;
    vec2 hwm = mix(vec2(0.30 / nb, 0.26), vec2(0.5, 0.5), solid);
    cov = rectCov(vec2(bf / nb, f.y), hwm, e) * lit;
  } else if (fig == 1) {
    // BLOCKS : the cell filled whole, with a margin so the lattice breathes.
    cov = rectCov(f, mix(vec2(0.33), vec2(0.5), solid), e) * lit;
  } else if (fig == 2) {
    // BARS : full-height columns on quantized widths. Rows play no part here.
    // with JUMP's offset, like every other grid figure (without it, jump did
    // nothing here)
    float col = floor((qs.x + off.x) * n);
    float lx = fract((qs.x + off.x) * n) - 0.5;
    float onc = step(1.0 - g1, hash12(vec2(col, floor(S * 0.41) + hand)));
    float w = 0.12 + 0.30 * hash12(vec2(col + 7.0, hand + floor(S * 0.13)));
    cov = (1.0 - smoothstep(w - e, w + e, abs(lx))) * onc;
    // BARS has no row index, so its lattice is one-dimensional : the period is
    // squared here to keep an accent as rare as it is in the other figures.
    isAcc = step(mod(col + floor(S * 0.25), per * per), 0.5) * onc;
  } else if (fig == 3) {
    // TICKS : short dashes, mostly empty frame. The density is deliberately
    // scaled down : this figure is about what is NOT there.
    float sparse = step(1.0 - g1 * 0.35, deal(ci, floor(S * 0.29), vec2(hand, 17.0), vec2(1.0, 0.0)));
    cov = rectCov(f, mix(vec2(0.34, 0.055), vec2(0.5), solid), e) * sparse;
    isAcc *= sparse;
  } else if (fig == 4) {
    // RULE : one or two full-width hairlines at stepped heights. The scan bar.
    // Width is floored at a pixel and measured in height units, never in
    // scanlines : a one-pixel rule moires through every later resample (§3).
    float k = 0.0;
    for (int i = 0; i < 2; i++) {
      float fi = float(i);
      float on2 = step(fi, 0.5 + split); // the second rule only above split 0.5
      float on3 = step(1.0 - g1, hash12(vec2(S + fi * 31.0, hand + 57.0)));
      float y = floor(hash12(vec2(S + fi * 31.0, hand + 13.0)) * n) / n + 0.5 / n;
      float w = max(0.9 * px, 0.004 + 0.010 * split);
      k = max(k, (1.0 - smoothstep(w - eq, w + eq, abs(qs.y - y))) * on2 * on3);
    }
    cov = k;
  } else if (fig == 5) {
    // GRID : the thin lattice, with segments dropping out. Lines are measured
    // in HEIGHT units so the mesh stays square at any aspect (§3).
    float w = max(1.2 * pxc, 0.02 + 0.05 * split);
    float lx = 1.0 - smoothstep(w - e, w + e, abs(f.x));
    float ly = 1.0 - smoothstep(w - e, w + e, abs(f.y));
    float keepX = step(1.0 - g1, deal(ci, floor(S * 0.19), vec2(hand + 2.0, 0.0), vec2(0.0, 1.0)));
    float keepY = step(1.0 - g1, deal(ci, floor(S * 0.23), vec2(0.0, hand + 8.0), vec2(1.0, 0.0)));
    cov = max(lx * keepX, ly * keepY);
  } else if (fig == 6) {
    // LADDER : sprocket and optical-track columns down the edges, the middle
    // left almost empty. The columns sit at fixed fractions of the WIDTH so
    // they stay at the edges whatever the aspect.
    float u = qs.x / aspect;
    float k = 0.0;
    float rows = n * 1.6;
    // GATE plays the sprockets too (at 1 they show as they always did), and a
    // rung stays under 60 % of its pitch : at a fixed height the rungs merged
    // into one solid column from about 29 cells up.
    float gt = clamp(gate, 0.0, 1.0);
    float rh = min(0.010, 0.3 / rows);
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float cu = fi < 2.0 ? 0.045 + fi * 0.075 : 0.880 + (fi - 2.0) * 0.075;
      float cx = cu * aspect;
      float ri = floor(qs.y * rows);
      float rf = (fract(qs.y * rows) - 0.5) / rows;
      float onr = step(1.0 - 0.82 * gt, hash12(vec2(ri, floor(cu * 37.0) + hand + floor(S * 0.07))));
      k = max(k, rectCov(vec2(qs.x - cx, rf), vec2(0.016, rh), eq) * onr);
    }
    // A few dashes adrift in the dark middle.
    float mid = step(0.18, u) * step(u, 0.86);
    float sparse = step(1.0 - g1 * 0.12, deal(ci, floor(S * 0.31), vec2(hand, 23.0), vec2(1.0, 0.0)));
    k = max(k, rectCov(f, vec2(0.30, 0.045), e) * sparse * mid);
    cov = k;
    isAcc *= mid;
  } else {
    // SLAB : one white field with bars cut OUT of it. The only inverted figure,
    // and the only one where the ink is the ground.
    //
    // Every knob means here what it means in the grids, so the figure is not a
    // one-shape special case : DENSITY is how much frame the slab covers, CELLS
    // is how many bars are cut from it, SPLIT makes the comb uneven and can turn
    // it on its side, JUMP moves and resizes it on each deal.
    float cover = clamp(density, 0.0, 1.0);
    float sz = 1.0 + (hash12(vec2(S, hand + 97.0)) - 0.5) * jump * 0.7;
    vec2 hw = vec2(mix(0.16, 0.46, cover) * aspect, mix(0.13, 0.44, cover)) * sz;
    vec2 ctr = vec2(aspect, 1.0) * 0.5
             + (vec2(hash12(vec2(S, hand + 61.0)), hash12(vec2(S, hand + 83.0))) - 0.5)
               * jump * vec2(aspect * 0.42, 0.38);
    vec2 c = qs - ctr;
    float body = rectCov(c, hw, eq);

    // Bars run across the slab's short axis by default, and SPLIT above half
    // lets a deal turn them sideways instead : the references use both, and one
    // orientation on its own reads as a logo rather than a vocabulary.
    float turn = step(1.0 - (split - 0.5) * 1.6, hash12(vec2(S, hand + 131.0)));
    float along = mix(c.x / max(hw.x, 1e-4), c.y / max(hw.y, 1e-4), turn);
    float across = mix(c.y / max(hw.y, 1e-4), c.x / max(hw.x, 1e-4), turn);

    float nb = clamp(floor(cells * 0.25), 1.0, 192.0);
    float t = along * 0.5 + 0.5;
    float bi = floor(t * nb);
    float bf = fract(t * nb) - 0.5;
    // An uneven comb : each bar keeps its own width and sits a little off its
    // slot. At split 0 they are a perfect ruled comb, which is the plain look.
    float jw = (hash12(vec2(bi, floor(S * 0.3) + hand)) - 0.5) * split * 0.22;
    float jp = (hash12(vec2(bi + 41.0, hand + floor(S * 0.3))) - 0.5) * split * 0.30;
    float w = clamp(0.17 + jw, 0.03, 0.42);
    float halfLen = mix(hw.x, hw.y, turn);              // the axis bars count along
    float e2 = eq * nb / max(2.0 * halfLen, 1e-4);      // one pixel, in bar units
    float cut = (1.0 - smoothstep(w - e2, w + e2, abs(bf - jp)))
              * step(abs(across), 0.80);
    // GATE is the chance a deal shows the slab at all, so a rhythm bound to it
    // plays the slab as it plays the grids (it did nothing here)
    float shown = step(1.0 - clamp(gate, 0.0, 1.0), hash12(vec2(S, hand + 151.0)));
    cov = max(body - cut, 0.0) * shown;
    isAcc = 0.0;
  }

  return clamp(cov, 0.0, 1.0);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 q = vec2(uv.x * aspect, uv.y);
  float px = 1.0 / RENDERSIZE.y;

  // The stepped clock. Wrapped before it ever reaches a hash : a step index that
  // grows all night lands in float32's gaps and the field freezes into stripes
  // (§1, §2). 32749 is prime, so the wrap does not beat against the divisions.
  float qn = max(1.0, floor(quant + 0.5));
  float S = mod(floor(PH_rate / qn), 32749.0);
  // HOLD keeps one deal alive for several steps, which is what turns a strobe
  // into a stutter against the same clock.
  float Sh = floor(S / max(1.0, floor(hold + 0.5)));

  float dens = clamp(density * clamp(gate, 0.0, 1.0), 0.0, 1.0);
  int fig = int(figure);

  // ONE sample per cell of the sidechain layer, at the cell's own centre on the
  // base grid (before jump and shear, which move the field by under a cell and
  // would only add a fetch). Per CELL rather than per pixel is the whole idea :
  // the picture arrives as a field of lit and unlit cells on this clock, a
  // 1-bit halftone of it, rather than as a blurred copy of itself. Dark areas
  // drop cells, bright areas fill them.
  vec2 sideLA = vec2(0.0);
  if (side > 0.001) {
    float nC = max(3.0, floor(cells + 0.5));
    float hC = floor(seed * 997.0);
    // The LIVE deal's own cell, through the same SHEAR and JUMP as figureCov.
    // Read on the base grid instead, a cell was cut wherever a base cell's edge
    // crossed it, half lit and half not.
    float shC = (hash12(vec2(floor(q.y * nC), floor(Sh * 0.5) + hC + 71.0)) - 0.5) * shear * 2.0;
    vec2 offC = (vec2(hash12(vec2(Sh, hC + 11.0)), hash12(vec2(Sh, hC + 29.0))) - 0.5) * jump;
    vec2 cc = (floor((vec2(q.x + shC, q.y) + offC) * nC) + 0.5) / nC - offC;
    vec2 sc = vec2(clamp((cc.x - shC) / aspect, 0.0, 1.0), clamp(cc.y, 0.0, 1.0));
    vec4 sTex = IMG_NORM_PIXEL(sideTex, sc);
    sideLA = vec2(dot(sTex.rgb, vec3(0.2126, 0.7152, 0.0722)), sTex.a);
  }

  float accNow = 0.0;
  float cov = figureCov(q, aspect, Sh, px, dens, sideLA, fig, 1.0, accNow);

  // SMEAR : the PREVIOUS deal, trailing behind and dimmed. A filmed projection
  // trails its moving cells, and that trail is half of why the references read
  // as photographed rather than rendered. Three taps rather than a persistent
  // buffer : the figure is a pure function of its step, so the past is simply
  // recomputed, which costs no 8-bit decay and no multipass frame of lag (§4).
  if (smear > 0.001) {
    float t = 0.0;
    float accPrev = 0.0;
    for (int i = 1; i <= 3; i++) {
      float fi = float(i);
      float a2 = 0.0;
      vec2 qo = vec2(q.x + fi * 0.012 * smear, q.y);
      t = max(t, figureCov(qo, aspect, Sh - 1.0, px, dens, sideLA, fig, 1.0, a2) * (1.0 - fi / 4.0));
      accPrev = max(accPrev, a2);
    }
    float ghost = t * smear * 0.55 * (1.0 - cov);
    accNow = max(accNow, accPrev * step(0.02, ghost));
    cov = max(cov, ghost);
  }

  // HALATION : the same figure re-read with a FAT edge, kept only where the
  // hard mark is not. So it widens a mark that exists and can never light empty
  // frame, which is the line between film halation and the additive glow on
  // black the brief warns off.
  if (halo > 0.001) {
    float aH = 0.0;
    float wide = figureCov(q, aspect, Sh, px, dens, sideLA, fig, 1.0 + 14.0 * halo, aH);
    cov = clamp(cov + max(wide - cov, 0.0) * halo * 0.5, 0.0, 1.0);
  }

  // FLIP : the whole frame inverts for the length of one step. The flash, and
  // the one control here that can strobe, so its curated dice range is kept
  // shallow and the app's own flash limiter still sits downstream.
  float fl = step(1.0 - flip, hash12(vec2(Sh, 613.0)));
  cov = mix(cov, 1.0 - cov, fl);

  vec3 inkCol = mix(ink.rgb, accent.rgb, clamp(accNow * accentAmt, 0.0, 1.0));
  // Straight alpha (§6). With the ground's own alpha at 0 the marks composite
  // over the layers below; at 1 it is the filmed-on-black ground of the
  // references. The color is the two layers composited and divided back out
  // by the alpha : mixing the ground's color in by coverage alone darkened
  // every anti-aliased edge over a transparent ground (a dark fringe). With an
  // opaque ground this is exactly the plain mix.
  float aOut = cov + ground.a * (1.0 - cov);
  vec3 rgbOut = (inkCol * cov + ground.rgb * ground.a * (1.0 - cov)) / max(aOut, 1e-4);
  gl_FragColor = vec4(rgbOut, aOut);
}
