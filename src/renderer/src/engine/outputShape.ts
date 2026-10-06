// OutputShape : the Finalizer's output shaper + background fill. Clips the whole
// finished frame into a chosen silhouette (the same 21 shapes as Transform),
// moved/sized/spun, and fills OUTSIDE the shape with a solid color OR a supplied
// texture (the Background slab, "moved" here from behind the layers). Runs as the
// very last compositor stage. No-op when shape is 0 (the compositor skips it).
// The fill is opaque; inside the shape the finished frame keeps its own alpha.

const VS = `#version 300 es
in vec2 p; out vec2 vUV;
void main(){ vUV = p * 0.5 + 0.5; gl_Position = vec4(p, 0.0, 1.0); }`

// Shape SDFs lifted from Transform.fs so the silhouettes match exactly (the heart
// included : an exact distance, lobes up, so its edge and shadow are even).
const FS = `#version 300 es
precision highp float; in vec2 vUV; out vec4 frag;
uniform sampler2D uSrc, uFill;
uniform float uUseFill, uAspect, uSize, uAngle, uDepth, uShadowAngle, uPersp, uPx, uFeather; uniform int uShape;
uniform vec2 uPos; uniform vec3 uFillColor;

float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return min(max(d.x, d.y), 0.0) + length(max(d, 0.0)); }
float sdNgon(vec2 p, float r, float sides){
  float ap = r * cos(3.14159265 / sides); float d = -1e6;
  for (int i = 0; i < 8; i++){ if (float(i) >= sides) break;
    float a = float(i) * 6.2831853 / sides + 1.5707963;
    d = max(d, dot(p, vec2(cos(a), sin(a))) - ap); }
  return d;
}
float sdStar(vec2 p, float r, float pts){
  float m = 6.2831853 / pts;
  float wed = mod(atan(p.x, p.y) + m * 0.5, m) / m;
  float rad = mix(r * 0.42, r, abs(wed - 0.5) * 2.0);
  return length(p) - rad;
}
float sdHeart(vec2 p){ p.x = abs(p.x);
  if (p.y + p.x > 1.0) return length(p - vec2(0.25, 0.75)) - 0.35355339;
  vec2 a = p - vec2(0.0, 1.0); vec2 b = p - 0.5 * max(p.x + p.y, 0.0);
  return sqrt(min(dot(a, a), dot(b, b))) * sign(p.x - p.y); }
float shapeDist(int s, vec2 p, float r){
  if (s == 1)  return length(p) - r;
  if (s == 2)  return sdBox(p, vec2(r));
  if (s == 3)  return sdBox(p, vec2(r * 1.4, r * 0.75));
  if (s == 4)  return sdNgon(p, r, 3.0);
  if (s == 5)  return sdNgon(p, r, 5.0);
  if (s == 6)  return sdNgon(p, r, 6.0);
  if (s == 7)  return sdNgon(p, r, 7.0);
  if (s == 8)  return sdNgon(p, r, 8.0);
  if (s == 9)  return abs(p.x) + abs(p.y) - r;
  if (s == 10) return sdStar(p, r, 5.0);
  if (s == 11) return sdStar(p, r, 6.0);
  if (s == 12) return length(p * vec2(1.0, 1.7)) - r;
  if (s == 13) return sdBox(p, vec2(r * 0.62)) - r * 0.3;
  if (s == 14) return min(sdBox(p, vec2(r, r * 0.33)), sdBox(p, vec2(r * 0.33, r)));
  if (s == 15) return abs(length(p) - r * 0.72) - r * 0.22;
  if (s == 16) return max(length(p) - r, -p.y);
  if (s == 17){ float hs = r * 2.17; return sdHeart(p / hs + vec2(0.0, 0.552)) * hs; }
  if (s == 18) return max(length(p) - r, -(length(p - vec2(r * 0.5, 0.0)) - r * 0.95));
  if (s == 19){ float w = mix(r * 1.2, r * 0.5, clamp((p.y + r) / (2.0 * r), 0.0, 1.0));
    return max(abs(p.x) - w, abs(p.y) - r); }
  vec2 cp = p; cp.y -= clamp(cp.y, -r * 0.5, r * 0.5); return length(cp) - r * 0.5;
}
void main(){
  vec2 uv = vUV;
  vec2 sp = (uv - 0.5) * vec2(uAspect, 1.0);
  vec2 ctr = vec2(uPos.x * uAspect, uPos.y) * 0.5;
  vec2 q = sp - ctr;
  float cs = cos(uAngle), sn = sin(uAngle);
  q = vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs);
  float r = clamp(uSize, 0.05, 1.8);
  float d = shapeDist(uShape, q, r);
  // The edge : anti-aliased over about a pixel (uPx, one pixel in these height
  // units), so it is crisp at any resolution, plus the FEATHER the user asks
  // for. It used to fade over a fixed 0.8 % of the frame height whatever the
  // resolution : ~9 px at 1080p, ~33 px on a 4096 dome master, a feather that
  // was always there. (Feather 0.05 is that old edge.)
  float fe = 0.75 * uPx + uFeather * 0.08;
  float m = 1.0 - smoothstep(-fe, fe, d);     // 1 inside the shape
  vec4 srcA = texture(uSrc, uv);
  vec3 src = srcA.rgb;
  vec3 fill = mix(uFillColor, texture(uFill, uv).rgb, uUseFill);
  // Depth: the shaped composition FLOATS over the fill : a soft drop shadow
  // cast from the shape's SDF darkens the fill. uShadowAngle sets the light
  // direction (which way the shadow falls, so the depth can read from another
  // perspective). uPersp PROJECTS that shadow onto a receding ground plane:
  // it rakes and stretches away from the shape in the fall direction, its
  // penumbra widening and its density fading with distance : a low-sun cast
  // shadow rather than a flat sticker offset.
  if (uDepth > 0.001) {
    vec2 dir = vec2(cos(uShadowAngle), sin(uShadowAngle));
    vec2 prp = vec2(-dir.y, dir.x);
    // Contact offset (grows a little with perspective : the object lifts).
    vec2 off = dir * r * (0.06 + 0.20 * uPersp) * uDepth;
    vec2 sp2 = q - off;
    // Foreshorten along the fall direction so the silhouette elongates into the
    // distance; along also drives the distance-based softness + fade.
    float along = dot(sp2, dir);
    float across = dot(sp2, prp);
    float stretch = 1.0 + uPersp * 2.2;
    vec2 sq = dir * (along / stretch) + prp * across;
    float d2 = shapeDist(uShape, sq, r);
    float soft = r * (0.12 + 0.30 * uDepth + 0.65 * uPersp);
    float shadow = uDepth * 0.8 * (1.0 - smoothstep(0.0, soft, d2));
    // Cast shadows fade along their length (far end lighter, contact darkest).
    float far = clamp(along / (r * stretch), 0.0, 1.0);
    shadow *= 1.0 - uPersp * 0.6 * far;
    fill *= 1.0 - shadow;
  }
  frag = vec4(mix(fill, src, m), mix(1.0, srcA.a, m));
}`

export class OutputShape {
  private prog: WebGLProgram
  private quad: WebGLBuffer
  private vao: WebGLVertexArrayObject
  private u: (n: string) => WebGLUniformLocation | null

  constructor(private gl: WebGL2RenderingContext) {
    const compile = (type: number, src: string): WebGLShader => {
      const s = gl.createShader(type)!
      gl.shaderSource(s, src)
      gl.compileShader(s)
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        console.error('[outputShape] compile:', gl.getShaderInfoLog(s))
      return s
    }
    this.prog = gl.createProgram()!
    gl.attachShader(this.prog, compile(gl.VERTEX_SHADER, VS))
    gl.attachShader(this.prog, compile(gl.FRAGMENT_SHADER, FS))
    gl.bindAttribLocation(this.prog, 0, 'p')
    gl.linkProgram(this.prog)
    if (!gl.getProgramParameter(this.prog, gl.LINK_STATUS))
      console.error('[outputShape] link:', gl.getProgramInfoLog(this.prog))
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
    const cache = new Map<string, WebGLUniformLocation | null>()
    this.u = (n) => {
      if (!cache.has(n)) cache.set(n, gl.getUniformLocation(this.prog, n))
      return cache.get(n)!
    }
  }

  /** Render `srcTex` clipped to the shape over the fill, into `targetFbo`. */
  apply(
    srcTex: WebGLTexture,
    fillTex: WebGLTexture | null,
    fillColor: number[],
    shape: number,
    size: number,
    angle: number,
    posX: number,
    posY: number,
    depth: number,
    shadowAngle: number,
    perspective: number,
    feather: number,
    aspect: number,
    targetFbo: WebGLFramebuffer,
    w: number,
    h: number
  ): void {
    const gl = this.gl
    gl.useProgram(this.prog)
    gl.bindVertexArray(this.vao)
    gl.bindFramebuffer(gl.FRAMEBUFFER, targetFbo)
    gl.viewport(0, 0, w, h)
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, srcTex)
    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, fillTex ?? srcTex)
    gl.uniform1i(this.u('uSrc'), 0)
    gl.uniform1i(this.u('uFill'), 1)
    gl.uniform1f(this.u('uUseFill'), fillTex ? 1 : 0)
    gl.uniform1f(this.u('uAspect'), aspect)
    gl.uniform1i(this.u('uShape'), Math.round(shape))
    gl.uniform1f(this.u('uSize'), size)
    gl.uniform1f(this.u('uAngle'), angle)
    gl.uniform2f(this.u('uPos'), posX, posY)
    gl.uniform1f(this.u('uDepth'), Math.max(0, Math.min(1, depth)))
    gl.uniform1f(this.u('uShadowAngle'), shadowAngle)
    gl.uniform1f(this.u('uPersp'), Math.max(0, Math.min(1, perspective)))
    gl.uniform1f(this.u('uFeather'), Math.max(0, Math.min(1, feather)))
    gl.uniform1f(this.u('uPx'), 1 / Math.max(1, h))
    gl.uniform3f(this.u('uFillColor'), fillColor[0] ?? 0, fillColor[1] ?? 0, fillColor[2] ?? 0)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.bindVertexArray(null)
  }

  dispose(): void {
    this.gl.deleteProgram(this.prog)
    this.gl.deleteVertexArray(this.vao)
    this.gl.deleteBuffer(this.quad)
  }
}
