// The silhouette's four looks and its trail, one copy for the two pieces that
// draw a body : the Silhouette source (SilhouetteSource.ts, the Body camera's
// mask) and the Silhouette effect (silhouetteNode.ts, the people found in any
// picture). Each brings its own picture and its own mask; what a mask of
// coverage m does to a picture is written once, here.
//
// CUTOUT : the picture where the body is, transparent elsewhere. MATTE : a white
// body on opaque black. SHADOW : a flat colored body. HOLE : the picture with
// the body taken out. TRAIL keeps the max of the present and the faded past, the
// color following whichever wins; the matte (opaque everywhere, so its alpha
// carries no body) keeps its echoes as a white shadow's and silOut turns that
// coverage back into color on black, the echoes in the trail color.

/** GLSL : silLook, silTrail, silOut (and the hash the trail's rounding uses). */
export const SIL_LOOK_GLSL = `
float silHash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
// Coverage m over the picture pic (straight alpha : its alpha is where there is
// picture at all). mode 0 cutout, 1 matte, 2 shadow, 3 hole.
vec4 silLook(int mode, vec4 pic, float m, vec4 color) {
  if (mode == 0) return vec4(pic.rgb, pic.a * m);
  if (mode == 1) return vec4(vec3(m), 1.0);
  if (mode == 2) return vec4(color.rgb, m * color.a);
  return vec4(pic.rgb, pic.a * (1.0 - m));
}
// The trail state : the present over the faded past (keep = this frame's share
// of the past kept), rounded stochastically so 8-bit echoes fade all the way out.
vec4 silTrail(int mode, vec4 now, float m, vec4 past, float keep, vec4 trailColor, vec2 fragXY, float frame) {
  if (mode == 1) now = vec4(1.0, 1.0, 1.0, m);
  float fa = past.a * keep;
  fa = floor(fa * 255.0 + silHash13(vec3(floor(fragXY), mod(frame, 4096.0)))) / 255.0;
  vec3 echo = mode == 1 ? trailColor.rgb * trailColor.a : past.rgb;
  return now.a >= fa ? now : vec4(echo, fa);
}
// The trail state as a picture : the matte's kept coverage on opaque black.
vec4 silOut(int mode, vec4 t) {
  return mode == 1 ? vec4(t.rgb * t.a, 1.0) : t;
}
`

/** This frame's share of the trail kept : a half-life of up to ~3 s (0 = off). */
export function trailKeep(trail: number, dt: number): number {
  return trail > 0.001 ? Math.pow(0.5, dt / (0.05 + trail * trail * 3)) : 0
}

interface Target {
  fbo: WebGLFramebuffer
  tex: WebGLTexture
}

/** The trail's RGBA8 ping-pong, made at the picture's size on first use and
 *  made again when that size changes. */
export class SilTrail {
  private t: [Target, Target] | null = null
  private w = 0
  private h = 0
  private cur = 0

  constructor(private gl: WebGL2RenderingContext) {}

  get on(): boolean {
    return !!this.t
  }

  ensure(w: number, h: number): void {
    if (this.t && this.w === w && this.h === h) return
    this.dispose()
    const gl = this.gl
    const mk = (): Target => {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      return { fbo, tex }
    }
    this.t = [mk(), mk()]
    this.w = w
    this.h = h
    this.cur = 0
    gl.bindTexture(gl.TEXTURE_2D, null)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  }

  /** The past (last frame's state). */
  read(): WebGLTexture | null {
    return this.t ? this.t[1 - this.cur].tex : null
  }

  /** Where this frame's state goes. */
  write(): Target | null {
    return this.t ? this.t[this.cur] : null
  }

  /** This frame's state becomes the past. */
  swap(): void {
    this.cur = 1 - this.cur
  }

  dispose(): void {
    if (!this.t) return
    const gl = this.gl
    for (const t of this.t) {
      gl.deleteFramebuffer(t.fbo)
      gl.deleteTexture(t.tex)
    }
    this.t = null
    this.w = 0
    this.h = 0
  }
}
