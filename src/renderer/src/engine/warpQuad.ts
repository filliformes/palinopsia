// Projection warp (keystone / corner-pin), shared by the compositor's own
// present pass and the projector window (OutputPresenter), so both draw it
// identically. The composite is drawn as a quad with 4 movable corners,
// perspective-correct, with an optional alignment grid + border for lining up
// on a projector.
//
// Its edges are anti-aliased and can be feathered. Drawn as a bare quad, a
// nearly vertical side (a keystone of a few pixels over the full height) came
// out as a staircase of very long one-pixel steps : measured 2026-10-14 on an
// installation's projector, the left side ran from x 111 to 119 down 1080 rows,
// 9 steps of ~120 rows each and not one blended pixel, read on the wall as long
// lines down the sides. Now the quad is drawn a couple of pixels larger, with
// the same mapping extended past its corners, and the shader turns each pixel's
// distance to the frame's edge (in output pixels, from the screen-space rate of
// the texture coordinates, so it holds under any keystone) into coverage.

export const WARP_VS = `#version 300 es
in vec2 pos;      // clip-space corner
in vec3 uvq;      // the inverse mapping, homogeneous : uv = uvq.xy / uvq.z
out vec3 vUvq;
void main(){ vUvq = uvq; gl_Position = vec4(pos, 0.0, 1.0); }`

export const WARP_FS = `#version 300 es
precision highp float;
in vec3 vUvq; out vec4 o;
uniform sampler2D tex;
uniform float grid;    // >0.5 → draw the alignment overlay
uniform float feather; // output pixels the frame's edge fades over (0 : crisp, still anti-aliased)
void main(){
  vec2 uv = vUvq.xy / vUvq.z;
  // How far inside the frame this pixel is, in output pixels (negative outside).
  vec2 fw = max(fwidth(uv), vec2(1e-6));
  vec2 inside = min(uv, 1.0 - uv) / fw;
  // A one-pixel ramp centred on each edge, widened inward by the feather; the
  // two axes multiplied, so a feathered corner rounds off instead of creasing
  // along its diagonal (the nearer edge alone drew a mitre).
  vec2 r = clamp((inside + 0.5) / (1.0 + feather), 0.0, 1.0);
  if (feather > 0.0) r = r * r * (3.0 - 2.0 * r);
  float cov = r.x * r.y;
  vec4 c = texture(tex, clamp(uv, 0.0, 1.0));
  if (grid > 0.5){
    vec2 g = abs(fract(uv * 8.0) - 0.5);
    float line = smoothstep(0.47, 0.5, max(g.x, g.y));
    c.rgb = mix(c.rgb, vec3(0.0, 1.0, 1.0), line * 0.5);
    float edge = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
    c.rgb = mix(c.rgb, vec3(1.0, 0.2, 0.2), 1.0 - smoothstep(0.0, 0.006, edge));
  }
  // over the black the frame sits on
  o = vec4(c.rgb * cov, 1.0);
}`

/** How far past the frame the quad reaches, in output pixels : enough for the
 *  anti-aliased half pixel outside the edge. */
const MARGIN_PX = 2

type M3 = number[] // row-major 3x3

/** The projective map of the unit square (u, v) onto the quad, as uv(0,0) at
 *  BL, (1,0) at BR, (1,1) at TR, (0,1) at TL (the orientation of a GL
 *  readback, which is what both callers draw). Heckbert's closed form. */
function squareToQuad(c: number[]): M3 {
  const x0 = c[6], y0 = c[7] // BL
  const x1 = c[4], y1 = c[5] // BR
  const x2 = c[2], y2 = c[3] // TR
  const x3 = c[0], y3 = c[1] // TL
  const dx3 = x0 - x1 + x2 - x3, dy3 = y0 - y1 + y2 - y3
  if (Math.abs(dx3) < 1e-12 && Math.abs(dy3) < 1e-12) {
    return [x1 - x0, x3 - x0, x0, y1 - y0, y3 - y0, y0, 0, 0, 1]
  }
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2
  const den = dx1 * dy2 - dx2 * dy1
  const g = (dx3 * dy2 - dx2 * dy3) / den
  const h = (dx1 * dy3 - dx3 * dy1) / den
  return [x1 - x0 + g * x1, x3 - x0 + h * x3, x0, y1 - y0 + g * y1, y3 - y0 + h * y3, y0, g, h, 1]
}

function invert(m: M3): M3 | null {
  const [a, b, c, d, e, f, g, h, i] = m
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g
  const det = a * A + b * B + c * C
  if (!Number.isFinite(det) || Math.abs(det) < 1e-14) return null
  const k = 1 / det
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k
  ]
}

function intersect(a1: number[], a2: number[], b1: number[], b2: number[]): number[] | null {
  const d = (a2[0] - a1[0]) * (b2[1] - b1[1]) - (a2[1] - a1[1]) * (b2[0] - b1[0])
  if (Math.abs(d) < 1e-9) return null
  const t = ((b1[0] - a1[0]) * (b2[1] - b1[1]) - (b1[1] - a1[1]) * (b2[0] - b1[0])) / d
  return [a1[0] + t * (a2[0] - a1[0]), a1[1] + t * (a2[1] - a1[1])]
}

/** The quad pushed out by `m` pixels on every side (each side moved along its
 *  outward normal, the new corners where neighbouring sides meet), in pixels. */
function grow(p: number[][], m: number): number[][] | null {
  const cx = (p[0][0] + p[1][0] + p[2][0] + p[3][0]) / 4
  const cy = (p[0][1] + p[1][1] + p[2][1] + p[3][1]) / 4
  const sides: number[][][] = []
  for (let i = 0; i < 4; i++) {
    const a = p[i], b = p[(i + 1) % 4]
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-6) return null
    let nx = -(b[1] - a[1]) / len, ny = (b[0] - a[0]) / len
    // outward : away from the middle of the quad
    if (nx * (cx - a[0]) + ny * (cy - a[1]) > 0) { nx = -nx; ny = -ny }
    sides.push([[a[0] + nx * m, a[1] + ny * m], [b[0] + nx * m, b[1] + ny * m]])
  }
  const out: number[][] = []
  for (let i = 0; i < 4; i++) {
    const prev = sides[(i + 3) % 4], next = sides[i]
    const q = intersect(prev[0], prev[1], next[0], next[1])
    if (!q) return null
    out.push(q)
  }
  return out
}

/** 4 normalized corners (TL,TR,BR,BL; 0..1, top-left origin) → 6 verts of
 *  (clipX, clipY, u·w, v·w, w) for a perspective-correct textured quad, drawn
 *  MARGIN_PX larger than the frame on a `pxW` x `pxH` output so its edge can
 *  be anti-aliased. Identity corners give a plain full-frame fit. */
export function computeWarpVerts(c: number[], pxW: number, pxH: number): Float32Array {
  const H = squareToQuad(c)
  const inv = invert(H)
  const W = Math.max(1, pxW), Hh = Math.max(1, pxH)
  const px = [0, 1, 2, 3].map((i) => [c[i * 2] * W, c[i * 2 + 1] * Hh])
  const grown = inv ? grow(px, MARGIN_PX) : null
  // The corners to draw (normalized), and the inverse map at each : linear in
  // screen space, so the interpolation is exact, the divide in the shader.
  const pts = (grown ?? px).map((q) => [q[0] / W, q[1] / Hh])
  let uvw = pts.map((q) => {
    if (!inv) return [0, 0, 1]
    return [
      inv[0] * q[0] + inv[1] * q[1] + inv[2],
      inv[3] * q[0] + inv[4] * q[1] + inv[5],
      inv[6] * q[0] + inv[7] * q[1] + inv[8]
    ]
  })
  if (!inv || !grown) {
    // A degenerate quad (corners crossed or collapsed) : the plain corners, no margin.
    const uv = [[0, 1], [1, 1], [1, 0], [0, 0]]
    uvw = uv.map((u) => [u[0], u[1], 1])
  } else if (uvw.every((v) => v[2] < 0)) {
    uvw = uvw.map((v) => [-v[0], -v[1], -v[2]])
  }
  const idx = [0, 1, 2, 0, 2, 3]
  const out = new Float32Array(30)
  let o = 0
  for (const i of idx) {
    out[o++] = pts[i][0] * 2 - 1
    out[o++] = 1 - pts[i][1] * 2
    out[o++] = uvw[i][0]
    out[o++] = uvw[i][1]
    out[o++] = uvw[i][2]
  }
  return out
}

export const IDENTITY_CORNERS = [0, 0, 1, 0, 1, 1, 0, 1]
