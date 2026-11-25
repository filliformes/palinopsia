// The Model source's file readers : glTF 2.0 (.glb, and .gltf with its buffers and
// images embedded or beside it), OBJ (with its MTL colors and first color map), STL
// (binary and text) and PLY (text, binary little and big endian, vertex colors, point
// clouds). Our own small readers, written from the published formats; no library.
// They run in workers/modelWorker.ts and hand a RawMesh to modelMesh.ts's prepareMesh.
//
// What they leave out, on purpose : glTF Draco and meshopt compression (the file says
// so and is refused with that reason), skins and morph targets (the model stands in
// its rest pose), every material but the base color (factor, vertex colors, the first
// base color texture), lines; OBJ curves and free-form surfaces; STL colors.
//
// third-party: glTF 2.0 specification
// third-party: OBJ and MTL formats
// third-party: STL format
// third-party: PLY format

import { GrowF32, GrowU32, GrowU8, MAX_POINTS, MAX_TRIS, type RawMesh } from './modelMesh'

export interface ParseCtx {
  /** A file beside the model, by the relative name the model gives it. */
  fetchRel(uri: string): Promise<ArrayBuffer>
  /** An image's bytes as a texture (null when the format can't be decoded). */
  image(bytes: Uint8Array, mime: string): Promise<ImageBitmap | null>
}

export const MODEL_EXT = /\.(glb|gltf|obj|stl|ply|xyz|pts)$/i

// The images the Model reads as a texture (what the media scheme serves and the
// browser decodes); another (.tga, .bmp, .tif) is said to be in a format it does not read.
const IMAGE_OK = /\.(png|jpe?g|webp)$/i
const imageRefused = (name: string): string | null => {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]
  return ext && !IMAGE_OK.test(name) ? `its texture ${name} is a .${ext.toLowerCase()} image, which the Model does not read (png, jpg or webp)` : null
}

// A damaged or hostile file must never keep the reader busy for ever : a glTF scene
// that names its nodes over and over (children [1, 1] at every depth doubles the
// work each step) is cut at this many node visits and drawn parts, and the vertices
// a file can pile up stop at the Model's own limits.
const MAX_VISITS = 200_000
const MAX_PRIMS = 100_000
const MAX_VERTS = MAX_TRIS * 3
const MAX_PILED_POINTS = MAX_POINTS * 4

export async function parseModel(name: string, buf: ArrayBuffer, ctx: ParseCtx): Promise<RawMesh> {
  const ext = (name.split('.').pop() ?? '').toLowerCase()
  const head = new Uint8Array(buf, 0, Math.min(4, buf.byteLength))
  if (head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46) return parseGLB(buf, ctx)
  if (ext === 'gltf') return parseGLTF(JSON.parse(new TextDecoder().decode(buf)), [], ctx, 'glTF')
  if (ext === 'obj') return parseOBJ(new TextDecoder().decode(buf), ctx)
  if (ext === 'stl') return parseSTL(buf)
  if (ext === 'ply') return parsePLY(buf)
  if (ext === 'xyz' || ext === 'pts' || ext === 'csv') return parseXYZ(new TextDecoder().decode(buf), ext)
  if (ext === 'glb') throw new Error('not a glTF binary (its header is wrong)')
  throw new Error(`${ext ? '.' + ext : 'this file'} is not a model the Model reads (glb, gltf, obj, stl, ply, xyz, pts)`)
}

// ── glTF 2.0 ────────────────────────────────────────────────────────────────────

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

function parseGLB(buf: ArrayBuffer, ctx: ParseCtx): Promise<RawMesh> {
  const dv = new DataView(buf)
  if (dv.getUint32(4, true) !== 2) throw new Error('a glTF 1.0 file : the Model reads glTF 2.0')
  const total = Math.min(dv.getUint32(8, true), buf.byteLength)
  let off = 12
  let json: Json | null = null
  let bin: Uint8Array | null = null
  while (off + 8 <= total) {
    const len = dv.getUint32(off, true), type = dv.getUint32(off + 4, true)
    const body = new Uint8Array(buf, off + 8, Math.min(len, total - off - 8))
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(body))
    else if (type === 0x004e4942 && !bin) bin = body
    off += 8 + len + ((4 - (len % 4)) % 4)
  }
  if (!json) throw new Error('a glTF binary with no description in it')
  return parseGLTF(json, bin ? [bin] : [], ctx, 'GLB')
}

const COMP_SIZE: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const N_COMP: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }

function readComp(dv: DataView, o: number, type: number, normalized: boolean): number {
  switch (type) {
    case 5126: return dv.getFloat32(o, true)
    case 5121: { const v = dv.getUint8(o); return normalized ? v / 255 : v }
    case 5123: { const v = dv.getUint16(o, true); return normalized ? v / 65535 : v }
    case 5125: return dv.getUint32(o, true)
    case 5120: { const v = dv.getInt8(o); return normalized ? Math.max(v / 127, -1) : v }
    case 5122: { const v = dv.getInt16(o, true); return normalized ? Math.max(v / 32767, -1) : v }
  }
  return 0
}

function parseGLTF(g: Json, glbBin: Uint8Array[], ctx: ParseCtx, format: string): Promise<RawMesh> {
  return (async () => {
    if (!g.asset || String(g.asset.version ?? '').split('.')[0] !== '2') throw new Error('not a glTF 2.0 file')
    const req: string[] = [...(g.extensionsRequired ?? [])]
    if (req.includes('KHR_draco_mesh_compression')) throw new Error('compressed with Draco, which the Model does not read : export it again without compression')
    if (req.includes('EXT_meshopt_compression') || req.includes('KHR_meshopt_compression')) throw new Error('compressed with meshopt, which the Model does not read : export it again without compression')
    const notes: string[] = []
    // the buffers : the binary chunk, embedded (data:) or a file beside it
    const bufs: Uint8Array[] = []
    for (let i = 0; i < (g.buffers ?? []).length; i++) {
      const b = g.buffers[i]
      if (b.uri === undefined) {
        if (!glbBin[0]) throw new Error('a buffer with no data')
        bufs.push(glbBin[0])
      } else bufs.push(new Uint8Array(await ctx.fetchRel(b.uri)))
    }
    const accessor = (ai: number): { data: Float32Array; n: number; count: number } => {
      const acc = g.accessors?.[ai]
      if (!acc) throw new Error('the file is damaged : a missing accessor')
      const n = N_COMP[acc.type] ?? 1
      const count = Number(acc.count)
      const size = COMP_SIZE[acc.componentType]
      if (!size) throw new Error('the file is damaged : an unknown number type')
      // (checked before anything is made : a count the file cannot hold is damage)
      if (!Number.isInteger(count) || count < 0) throw new Error('the file is damaged : an accessor with a wrong count')
      let out: Float32Array
      if (acc.bufferView !== undefined) {
        const bv = g.bufferViews?.[acc.bufferView]
        if (!bv) throw new Error('the file is damaged : a missing buffer view')
        if (bv.extensions?.EXT_meshopt_compression || bv.extensions?.KHR_meshopt_compression) throw new Error('compressed with meshopt, which the Model does not read : export it again without compression')
        const buf = bufs[bv.buffer]
        if (!buf) throw new Error('the file is damaged : a missing buffer')
        const stride = bv.byteStride || size * n
        const base = buf.byteOffset + (bv.byteOffset || 0) + (acc.byteOffset || 0)
        if (count * n * size > buf.byteLength || (count > 0 && base + stride * (count - 1) + size * n > buf.byteOffset + buf.byteLength)) throw new Error('the file is damaged : data past the end of its buffer')
        out = new Float32Array(count * n)
        if (acc.componentType === 5126 && stride === 4 * n && base % 4 === 0) {
          out.set(new Float32Array(buf.buffer, base, count * n))
        } else {
          const dv = new DataView(buf.buffer)
          const norm = !!acc.normalized
          for (let i = 0; i < count; i++) for (let j = 0; j < n; j++) out[i * n + j] = readComp(dv, base + i * stride + j * size, acc.componentType, norm)
        }
      } else {
        // (no data of its own : zeros, a sparse accessor's few elements given below)
        if (count * n > MAX_VERTS * 4) throw new Error('the file is damaged : an accessor with a wrong count')
        out = new Float32Array(count * n)
      }
      // sparse : a few elements given apart from the rest
      if (acc.sparse) {
        const sp = acc.sparse
        if (!(Number.isInteger(sp.count) && sp.count >= 0 && sp.count <= count)) throw new Error('the file is damaged : a sparse accessor with a wrong count')
        const ibv = g.bufferViews[sp.indices.bufferView], vbv = g.bufferViews[sp.values.bufferView]
        const ib = bufs[ibv.buffer], vb = bufs[vbv.buffer]
        const idv = new DataView(ib.buffer), vdv = new DataView(vb.buffer)
        const ibase = ib.byteOffset + (ibv.byteOffset || 0) + (sp.indices.byteOffset || 0)
        const vbase = vb.byteOffset + (vbv.byteOffset || 0) + (sp.values.byteOffset || 0)
        const isz = COMP_SIZE[sp.indices.componentType]
        if (!isz) throw new Error('the file is damaged : an unknown number type')
        for (let k = 0; k < sp.count; k++) {
          const at = readComp(idv, ibase + k * isz, sp.indices.componentType, false)
          if (at >= count) continue
          for (let j = 0; j < n; j++) out[at * n + j] = readComp(vdv, vbase + (k * n + j) * size, acc.componentType, !!acc.normalized)
        }
      }
      return { data: out, n, count }
    }
    // the base color texture : the first one a drawn primitive uses
    let texImage: number | null = null
    let texture: ImageBitmap | null = null
    const imageOfTexture = (ti: number): number | null => {
      const t = g.textures?.[ti]
      if (!t) return null
      const src = t.source ?? t.extensions?.EXT_texture_webp?.source ?? t.extensions?.KHR_texture_basisu?.source
      return typeof src === 'number' ? src : null
    }
    const loadImage = async (ii: number): Promise<ImageBitmap | null> => {
      const im = g.images?.[ii]
      if (!im) return null
      let bytes: Uint8Array | null = null
      let mime = im.mimeType ?? ''
      if (im.bufferView !== undefined) {
        const bv = g.bufferViews[im.bufferView], b = bufs[bv.buffer]
        bytes = new Uint8Array(b.buffer, b.byteOffset + (bv.byteOffset || 0), bv.byteLength)
      } else if (typeof im.uri === 'string') {
        // (a format it does not read is said so, never looked for)
        if (!/^data:/.test(im.uri) && !/ktx2|basis/i.test(mime) && !/\.(ktx2|basis)$/i.test(im.uri)) {
          const no = imageRefused(im.uri.split(/[\\/]/).pop() ?? im.uri)
          if (no) { notes.push(no); return null }
        }
        if (/\.(ktx2|basis)$/i.test(im.uri)) mime = 'image/ktx2'
        else bytes = new Uint8Array(await ctx.fetchRel(im.uri))
        if (!mime) mime = /\.png$/i.test(im.uri) ? 'image/png' : /\.webp$/i.test(im.uri) ? 'image/webp' : 'image/jpeg'
      } else return null
      if (/ktx2|basis/i.test(mime)) { notes.push('its texture is in a compressed GPU format the Model does not read'); return null }
      return bytes ? ctx.image(bytes, mime || 'image/png') : null
    }

    const P = new GrowF32(1 << 16), N = new GrowF32(1 << 16), UV = new GrowF32(1 << 15), C = new GrowU8(1 << 16), I = new GrowU32(1 << 16)
    const pts = new GrowF32(0)
    let allNormals = true, anyUV = false, anyColor = false
    let skippedLines = false, skippedPoints = false, multiTex = false, shortNormals = false
    const mul = (m: number[], a: number[]): number[] => {
      const o = new Array(16).fill(0)
      for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += m[k * 4 + r] * a[c * 4 + k]
      return o
    }
    const local = (nd: Json): number[] => {
      if (Array.isArray(nd.matrix) && nd.matrix.length === 16) return nd.matrix
      const [tx, ty, tz] = nd.translation ?? [0, 0, 0]
      const [qx, qy, qz, qw] = nd.rotation ?? [0, 0, 0, 1]
      const [sx, sy, sz] = nd.scale ?? [1, 1, 1]
      const xx = qx * qx, yy = qy * qy, zz = qz * qz, xy = qx * qy, xz = qx * qz, yz = qy * qz, wx = qw * qx, wy = qw * qy, wz = qw * qz
      return [
        (1 - 2 * (yy + zz)) * sx, 2 * (xy + wz) * sx, 2 * (xz - wy) * sx, 0,
        2 * (xy - wz) * sy, (1 - 2 * (xx + zz)) * sy, 2 * (yz + wx) * sy, 0,
        2 * (xz + wy) * sz, 2 * (yz - wx) * sz, (1 - 2 * (xx + yy)) * sz, 0,
        tx, ty, tz, 1
      ]
    }
    const prims: Array<{ prim: Json; m: number[] }> = []
    let visits = 0
    const tooMany = (): Error => new Error('the file is damaged : its scene repeats its parts too many times to draw')
    const visit = (ni: number, parent: number[], depth: number): void => {
      const nd = g.nodes?.[ni]
      if (!nd || depth > 64) return
      if (++visits > MAX_VISITS) throw tooMany()
      const m = mul(parent, local(nd))
      if (nd.mesh !== undefined) {
        for (const prim of g.meshes?.[nd.mesh]?.primitives ?? []) {
          prims.push({ prim, m })
          if (prims.length > MAX_PRIMS) throw tooMany()
        }
      }
      if (Array.isArray(nd.children)) for (const c of nd.children) visit(c, m, depth + 1)
    }
    const I4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    const scene = g.scenes?.[g.scene ?? 0]
    if (scene) for (const r of scene.nodes ?? []) visit(r, I4, 0)
    else if (g.meshes) for (const mesh of g.meshes) for (const prim of mesh.primitives ?? []) prims.push({ prim, m: I4 })
    for (const { prim } of prims) if (prim.attributes?.NORMAL === undefined) allNormals = false

    for (const { prim, m } of prims) {
      if (prim.extensions?.KHR_draco_mesh_compression && prim.attributes?.POSITION === undefined) throw new Error('compressed with Draco, which the Model does not read : export it again without compression')
      const mode = prim.mode ?? 4
      if (mode === 1 || mode === 2 || mode === 3) { skippedLines = true; continue }
      const at = prim.attributes ?? {}
      if (at.POSITION === undefined) continue
      const pos = accessor(at.POSITION)
      if (pos.n < 3) throw new Error('the file is damaged : its positions are not points in space')
      if (mode === 0) {
        if (pts.n / 3 + pos.count > MAX_PILED_POINTS) throw new Error(`more than ${(MAX_PILED_POINTS / 1e6).toFixed(0)} million points : too many for the Model`)
        for (let i = 0; i < pos.count; i++) {
          const x = pos.data[i * 3], y = pos.data[i * 3 + 1], z = pos.data[i * 3 + 2]
          pts.push3(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14])
        }
        continue
      }
      const base = P.n / 3
      if (base + pos.count > MAX_VERTS) throw new Error(`more than ${(MAX_VERTS / 1e6).toFixed(0)} million vertices : the Model draws up to ${(MAX_TRIS / 1e6).toFixed(0)} million triangles (simplify it in a 3D editor first)`)
      // the normals' matrix : the cofactors of the upper 3x3 (the inverse transpose up to a scale)
      const a = m[0], b = m[4], c = m[8], d = m[1], e = m[5], f = m[9], h = m[2], i2 = m[6], k = m[10]
      const nm = [e * k - f * i2, f * h - d * k, d * i2 - e * h, c * i2 - b * k, a * k - c * h, b * h - a * i2, b * f - c * e, c * d - a * f, a * e - b * d]
      const det = a * (e * k - f * i2) - b * (d * k - f * h) + c * (d * i2 - e * h)
      for (let v = 0; v < pos.count; v++) {
        const x = pos.data[v * 3], y = pos.data[v * 3 + 1], z = pos.data[v * 3 + 2]
        P.push3(m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14])
      }
      if (allNormals) {
        const nr = accessor(at.NORMAL)
        // (a normal list shorter than the points, or not three numbers each : the
        // file's normals are left out, the Model makes its own)
        const good = nr.n === 3 && nr.count >= pos.count
        if (!good) shortNormals = true
        for (let v = 0; v < pos.count; v++) {
          if (!good) { N.push3(0, 0, 0); continue }
          const x = nr.data[v * 3], y = nr.data[v * 3 + 1], z = nr.data[v * 3 + 2]
          N.push3(nm[0] * x + nm[1] * y + nm[2] * z, nm[3] * x + nm[4] * y + nm[5] * z, nm[6] * x + nm[7] * y + nm[8] * z)
        }
      }
      // the material : its base color, the first base color texture
      const mat = prim.material !== undefined ? g.materials?.[prim.material] : null
      const pbr = mat?.pbrMetallicRoughness ?? {}
      const fac: number[] = pbr.baseColorFactor ?? [1, 1, 1, 1]
      const bct = pbr.baseColorTexture
      let textured = false
      let texCoord = 0
      if (bct && typeof bct.index === 'number') {
        const ii = imageOfTexture(bct.index)
        if (ii !== null) {
          if (texImage === null) {
            texImage = ii
            texture = await loadImage(ii).catch((e: unknown) => { notes.push(`its texture ${(e as Error)?.message ?? 'could not be read'}`); return null })
          } else if (texImage !== ii) multiTex = true
          textured = texImage === ii && !!texture
          texCoord = bct.texCoord ?? 0
        }
      }
      const uvAcc = at[`TEXCOORD_${texCoord}`] ?? at.TEXCOORD_0
      if (uvAcc !== undefined) {
        anyUV = true
        const uv = accessor(uvAcc)
        const ok = uv.n >= 2 && uv.count >= pos.count
        for (let v = 0; v < pos.count; v++) { UV.push(ok ? uv.data[v * uv.n] : 0); UV.push(ok ? uv.data[v * uv.n + 1] : 0) }
      } else for (let v = 0; v < pos.count; v++) { UV.push(0); UV.push(0) }
      const vc0 = at.COLOR_0 !== undefined ? accessor(at.COLOR_0) : null
      const vc = vc0 && vc0.n >= 3 && vc0.count >= pos.count ? vc0 : null
      if (vc || fac.some((x, j) => j < 3 && x < 0.999)) anyColor = true
      for (let v = 0; v < pos.count; v++) {
        let r = fac[0], gg = fac[1], bb = fac[2]
        if (vc) { r *= vc.data[v * vc.n]; gg *= vc.data[v * vc.n + 1]; bb *= vc.data[v * vc.n + 2] }
        // (glTF colors are linear : the texture and the screen are sRGB)
        C.push(Math.round(Math.pow(Math.max(0, Math.min(1, r)), 1 / 2.2) * 255))
        C.push(Math.round(Math.pow(Math.max(0, Math.min(1, gg)), 1 / 2.2) * 255))
        C.push(Math.round(Math.pow(Math.max(0, Math.min(1, bb)), 1 / 2.2) * 255))
        C.push(textured ? 255 : 0)
      }
      // the triangles (a strip or a fan turned to a list), turned over in a mirrored node
      const flip = det < 0
      const idx = prim.indices !== undefined ? accessor(prim.indices).data : null
      const nI = idx ? idx.length : pos.count
      const at_ = (j: number): number => base + (idx ? idx[j] : j)
      const tri = (p: number, q: number, r: number): void => { if (flip) { I.push(p); I.push(r); I.push(q) } else { I.push(p); I.push(q); I.push(r) } }
      if (I.n / 3 + nI > MAX_TRIS * 3) throw new Error(`more than ${(MAX_TRIS / 1e6).toFixed(0)} million triangles : the Model draws up to ${(MAX_TRIS / 1e6).toFixed(0)} million (simplify it in a 3D editor first)`)
      if (mode === 4) for (let j = 0; j + 2 < nI; j += 3) tri(at_(j), at_(j + 1), at_(j + 2))
      else if (mode === 5) for (let j = 0; j + 2 < nI; j++) { if (j % 2) tri(at_(j + 1), at_(j), at_(j + 2)); else tri(at_(j), at_(j + 1), at_(j + 2)) }
      else if (mode === 6) for (let j = 1; j + 1 < nI; j++) tri(at_(0), at_(j), at_(j + 1))
      if (I.n / 3 > MAX_TRIS) throw new Error(`more than ${(MAX_TRIS / 1e6).toFixed(0)} million triangles : the Model draws up to ${(MAX_TRIS / 1e6).toFixed(0)} million (simplify it in a 3D editor first)`)
    }
    if (skippedLines) notes.push('its lines are left out (the Model draws faces and points)')
    if (shortNormals && allNormals) notes.push('its normals are damaged : the Model made its own')
    if (multiTex) notes.push('only its first texture is used')
    if (!I.n) {
      if (pts.n) return { pos: pts.done(), format, notes }
      throw new Error('the file holds no faces or points to draw')
    }
    if (pts.n) skippedPoints = true
    if (skippedPoints) notes.push('its loose points are left out')
    return {
      pos: P.done(), nrm: allNormals && !shortNormals ? N.done() : null, uv: anyUV ? UV.done() : null, col: anyColor || texture ? C.done() : null,
      idx: I.done(), texture, format, notes
    }
  })()
}

// ── OBJ (+ MTL) ─────────────────────────────────────────────────────────────────

interface Mtl { kd: [number, number, number]; map: string | null }

function parseMTL(text: string, into: Map<string, Mtl>): void {
  let cur: Mtl | null = null
  for (const line0 of text.split('\n')) {
    const line = line0.trim()
    if (line.startsWith('newmtl')) { cur = { kd: [1, 1, 1], map: null }; into.set(line.slice(6).trim(), cur) }
    else if (cur && /^Kd\s/.test(line)) { const t = line.split(/\s+/); cur.kd = [Number(t[1]) || 0, Number(t[2] ?? t[1]) || 0, Number(t[3] ?? t[1]) || 0] }
    else if (cur && /^map_Kd\s/.test(line)) { const t = line.split(/\s+/); cur.map = t[t.length - 1] || null }
  }
}

async function parseOBJ(text: string, ctx: ParseCtx): Promise<RawMesh> {
  const V = new GrowF32(1 << 16), VT = new GrowF32(1 << 15), VN = new GrowF32(1 << 16), VC = new GrowF32(0)
  const cv: number[] = [], ct: number[] = [], cn: number[] = []
  const fv = new GrowU32(1 << 16), ft = new GrowU32(1 << 16), fnn = new GrowU32(1 << 16), fm = new GrowU32(1 << 16)
  const mtlNames: string[] = []
  const matIds = new Map<string, number>()
  let mat = 0
  let hasVC = false
  let pos = 0
  const L = text.length
  const NONE = 0xffffffff
  while (pos < L) {
    let end = text.indexOf('\n', pos)
    if (end < 0) end = L
    const c0 = text.charCodeAt(pos), c1 = text.charCodeAt(pos + 1)
    if (c0 === 118 /* v */) {
      const t = text.slice(pos, end).trim().split(/\s+/)
      if (c1 === 32 || c1 === 9) {
        V.push3(+t[1] || 0, +t[2] || 0, +t[3] || 0)
        if (t.length >= 7) { hasVC = true; while (VC.n < (V.n / 3 - 1) * 3) VC.push(1); VC.push3(+t[4], +t[5], +t[6]) }
      } else if (c1 === 116 /* t */) { VT.push(+t[1] || 0); VT.push(+t[2] || 0) }
      else if (c1 === 110 /* n */) VN.push3(+t[1] || 0, +t[2] || 0, +t[3] || 0)
    } else if (c0 === 102 /* f */ && (c1 === 32 || c1 === 9)) {
      const t = text.slice(pos + 2, end).trim().split(/\s+/)
      cv.length = 0; ct.length = 0; cn.length = 0
      const nv = V.n / 3, nt = VT.n / 2, nn = VN.n / 3
      for (const tok of t) {
        if (!tok) continue
        const s = tok.split('/')
        let a = parseInt(s[0], 10)
        if (!a) continue
        a = a < 0 ? nv + a : a - 1
        let b = s[1] ? parseInt(s[1], 10) : 0
        b = b ? (b < 0 ? nt + b : b - 1) : -1
        let c = s[2] ? parseInt(s[2], 10) : 0
        c = c ? (c < 0 ? nn + c : c - 1) : -1
        cv.push(a); ct.push(b); cn.push(c)
      }
      for (let k = 1; k + 1 < cv.length; k++) {
        for (const j of [0, k, k + 1]) { fv.push(cv[j]); ft.push(ct[j] < 0 ? NONE : ct[j]); fnn.push(cn[j] < 0 ? NONE : cn[j]); fm.push(mat) }
      }
    } else if (text.startsWith('usemtl', pos)) {
      const nm = text.slice(pos + 6, end).trim()
      if (!matIds.has(nm)) matIds.set(nm, matIds.size + 1)
      mat = matIds.get(nm)!
    } else if (text.startsWith('mtllib', pos)) {
      mtlNames.push(text.slice(pos + 6, end).trim())
    }
    pos = end + 1
  }
  const corners = fv.n
  if (!corners) {
    if (V.n) return { pos: V.done(), format: 'OBJ', notes: ['no faces : drawn as points'] }
    throw new Error('the file holds no geometry')
  }
  // its materials' colors, and the first color map one of them names
  const mtls = new Map<string, Mtl>()
  for (const nm of mtlNames) {
    try { parseMTL(new TextDecoder().decode(await ctx.fetchRel(nm)), mtls) } catch { /* a missing MTL : white */ }
  }
  const notes: string[] = []
  if (mtlNames.length && !mtls.size) notes.push('its material file was not found beside it')
  const byId: Array<Mtl | null> = [null]
  for (const [nm] of matIds) byId.push(mtls.get(nm) ?? null)
  let texture: ImageBitmap | null = null
  let texMap: string | null = null
  for (const m of byId) if (m?.map) { texMap = m.map; break }
  const texRefused = texMap ? imageRefused(texMap) : null
  if (texRefused) notes.push(texRefused)
  else if (texMap) {
    try {
      const bytes = new Uint8Array(await ctx.fetchRel(texMap))
      texture = await ctx.image(bytes, /\.png$/i.test(texMap) ? 'image/png' : /\.webp$/i.test(texMap) ? 'image/webp' : 'image/jpeg')
      if (!texture) notes.push(`its texture ${texMap} could not be decoded`)
    } catch { notes.push(`its texture ${texMap} was not found beside it`) }
  }
  // one vertex per distinct (position, texture place, normal, material)
  const nT = VT.n / 2, nN = VN.n / 3, nM = matIds.size + 1
  const exact = (V.n / 3) * (nT + 1) * (nN + 1) * nM < 2 ** 52
  const map = new Map<number | string, number>()
  const hasUV = nT > 0, allN = nN > 0
  const P = new GrowF32(corners), N = new GrowF32(allN ? corners : 0), U = new GrowF32(hasUV ? corners : 0), C = new GrowU8(corners)
  const I = new Uint32Array(corners)
  let missingN = false
  const anyColor = hasVC || byId.some((m) => m && (m.kd[0] < 0.999 || m.kd[1] < 0.999 || m.kd[2] < 0.999)) || !!texture
  for (let i = 0; i < corners; i++) {
    const v = fv.a[i], m = fm.a[i]
    // (a texture place or a normal the file does not have : none, never a number read past its list)
    const t = ft.a[i] < nT ? ft.a[i] : NONE, n = fnn.a[i] < nN ? fnn.a[i] : NONE
    if (v >= V.n / 3) throw new Error('the file is damaged : a face points past its vertices')

    const tt = t === NONE ? 0 : t + 1, nn = n === NONE ? 0 : n + 1
    const key = exact ? ((v * (nT + 1) + tt) * (nN + 1) + nn) * nM + m : `${v}/${tt}/${nn}/${m}`
    let o = map.get(key)
    if (o === undefined) {
      o = P.n / 3
      map.set(key, o)
      P.push3(V.a[v * 3], V.a[v * 3 + 1], V.a[v * 3 + 2])
      if (allN) { if (n === NONE) { missingN = true; N.push3(0, 0, 0) } else N.push3(VN.a[n * 3], VN.a[n * 3 + 1], VN.a[n * 3 + 2]) }
      if (hasUV) { U.push(t === NONE ? 0 : VT.a[t * 2]); U.push(t === NONE ? 0 : 1 - VT.a[t * 2 + 1]) }
      const mt = byId[m]
      let r = mt ? mt.kd[0] : 1, g = mt ? mt.kd[1] : 1, b = mt ? mt.kd[2] : 1
      if (hasVC && v * 3 + 2 < VC.n) { r *= VC.a[v * 3]; g *= VC.a[v * 3 + 1]; b *= VC.a[v * 3 + 2] }
      C.push(Math.round(Math.max(0, Math.min(1, r)) * 255)); C.push(Math.round(Math.max(0, Math.min(1, g)) * 255)); C.push(Math.round(Math.max(0, Math.min(1, b)) * 255))
      C.push(texture && mt?.map === texMap ? 255 : 0)
    }
    I[i] = o
  }
  return {
    pos: P.done(), nrm: allN && !missingN ? N.done() : null, uv: hasUV ? U.done() : null, col: anyColor ? C.done() : null,
    idx: I, texture, format: 'OBJ', notes
  }
}

// ── STL ─────────────────────────────────────────────────────────────────────────

function parseSTL(buf: ArrayBuffer): RawMesh {
  const dv = new DataView(buf)
  const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : -1
  if (n >= 0 && 84 + n * 50 === buf.byteLength) {
    const pos = new Float32Array(n * 9)
    for (let t = 0; t < n; t++) {
      const o = 84 + t * 50 + 12
      for (let k = 0; k < 9; k++) pos[t * 9 + k] = dv.getFloat32(o + k * 4, true)
    }
    const idx = new Uint32Array(n * 3)
    for (let i = 0; i < idx.length; i++) idx[i] = i
    return { pos, idx, format: 'STL', zUp: true }
  }
  const text = new TextDecoder().decode(buf)
  if (!/^\s*solid/.test(text) || !/facet/.test(text)) throw new Error('not an STL file (neither binary nor text)')
  const P = new GrowF32(1 << 16)
  const re = /vertex\s+(\S+)\s+(\S+)\s+(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) P.push3(+m[1] || 0, +m[2] || 0, +m[3] || 0)
  const nt = Math.floor(P.n / 9)
  const pos = P.done().slice(0, nt * 9)
  const idx = new Uint32Array(nt * 3)
  for (let i = 0; i < idx.length; i++) idx[i] = i
  return { pos, idx, format: 'STL', zUp: true }
}

// ── PLY ─────────────────────────────────────────────────────────────────────────

interface PlyProp { name: string; type: string; list?: { count: string; item: string } }
interface PlyElem { name: string; count: number; props: PlyProp[] }

const PLY_SIZE: Record<string, number> = {
  char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2,
  int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8
}

function plyRead(dv: DataView, o: number, t: string, le: boolean): number {
  switch (t) {
    case 'char': case 'int8': return dv.getInt8(o)
    case 'uchar': case 'uint8': return dv.getUint8(o)
    case 'short': case 'int16': return dv.getInt16(o, le)
    case 'ushort': case 'uint16': return dv.getUint16(o, le)
    case 'int': case 'int32': return dv.getInt32(o, le)
    case 'uint': case 'uint32': return dv.getUint32(o, le)
    case 'float': case 'float32': return dv.getFloat32(o, le)
    case 'double': case 'float64': return dv.getFloat64(o, le)
  }
  throw new Error(`a PLY number type it does not know : ${t}`)
}

function parsePLY(buf: ArrayBuffer): RawMesh {
  const bytes = new Uint8Array(buf)
  // the header, up to end_header : found in the bytes themselves (decoded and encoded
  // again, a byte that is not text in it would move where the data starts)
  const lim = Math.min(bytes.length, 1 << 16)
  let headerEnd = -1, headerLen = 0
  const END = [101, 110, 100, 95, 104, 101, 97, 100, 101, 114] // "end_header"
  for (let i = 0; i + END.length < lim && headerEnd < 0; i++) {
    let k = 0
    while (k < END.length && bytes[i + k] === END[k]) k++
    if (k < END.length) continue
    const j = i + END.length
    if (bytes[j] === 10) { headerEnd = i; headerLen = j + 1 }
    else if (bytes[j] === 13 && bytes[j + 1] === 10) { headerEnd = i; headerLen = j + 2 }
  }
  const probe = new TextDecoder().decode(bytes.subarray(0, Math.max(0, headerEnd)))
  if (!probe.startsWith('ply') || headerEnd < 0) throw new Error('not a PLY file')
  const lines = probe.split(/\r?\n/)
  let format = ''
  const elems: PlyElem[] = []
  for (const l of lines) {
    const t = l.trim().split(/\s+/)
    if (t[0] === 'format') format = t[1]
    else if (t[0] === 'element') elems.push({ name: t[1], count: Math.max(0, parseInt(t[2], 10) || 0), props: [] })
    else if (t[0] === 'property' && elems.length) {
      const e = elems[elems.length - 1]
      if (t[1] === 'list') e.props.push({ name: t[4], type: 'list', list: { count: t[2], item: t[3] } })
      else e.props.push({ name: t[2], type: t[1] })
    }
  }
  if (!['ascii', 'binary_little_endian', 'binary_big_endian'].includes(format)) throw new Error(`a PLY format it does not know : ${format}`)
  const vert = elems.find((e) => e.name === 'vertex')
  if (!vert || !vert.count) throw new Error('the PLY file has no vertices')
  const nv = vert.count
  const pi = (n: string): number => vert.props.findIndex((p) => p.name === n)
  const ix = pi('x'), iy = pi('y'), iz = pi('z')
  if (ix < 0 || iy < 0 || iz < 0) throw new Error('the PLY file has no x, y, z')
  const inx = pi('nx'), iny = pi('ny'), inz = pi('nz')
  const iu = [pi('u'), pi('s'), pi('texture_u'), pi('texture_s')].find((i) => i >= 0) ?? -1
  const iv = [pi('v'), pi('t'), pi('texture_v'), pi('texture_t')].find((i) => i >= 0) ?? -1
  const ir = [pi('red'), pi('diffuse_red'), pi('r')].find((i) => i >= 0) ?? -1
  const ig = [pi('green'), pi('diffuse_green'), pi('g')].find((i) => i >= 0) ?? -1
  const ib = [pi('blue'), pi('diffuse_blue'), pi('b')].find((i) => i >= 0) ?? -1
  const hasN = inx >= 0 && iny >= 0 && inz >= 0
  const hasUV = iu >= 0 && iv >= 0
  const hasC = ir >= 0 && ig >= 0 && ib >= 0
  const colScale = (p: PlyProp): number => (p.type === 'float' || p.type === 'float32' || p.type === 'double' || p.type === 'float64' ? 255 : p.type === 'ushort' || p.type === 'uint16' ? 1 / 257 : 1)
  // the counts the header gives, checked against the data before anything is made :
  // each element at least as many bytes as its fixed numbers and list counts (binary),
  // or as many words as it has numbers (text)
  const cut = (): Error => new Error('the PLY file is cut short (its header counts more than its data holds)')
  const isAscii = format === 'ascii'
  let tok: string[] = []
  if (isAscii) {
    tok = new TextDecoder().decode(bytes.subarray(headerLen)).split(/\s+/).filter((s) => s.length)
    let words = 0
    for (const e of elems) words += e.count * e.props.length
    if (words > tok.length) throw cut()
  } else {
    let need = 0
    for (const e of elems) {
      let per = 0
      for (const p of e.props) {
        const sz = PLY_SIZE[p.list ? p.list.count : p.type]
        if (!sz) throw new Error(`a PLY number type it does not know : ${p.list ? p.list.count : p.type}`)
        per += sz
      }
      need += e.count * per
    }
    if (headerLen + need > buf.byteLength) throw cut()
  }
  const pos = new Float32Array(nv * 3)
  const nrm = hasN ? new Float32Array(nv * 3) : null
  const uv = hasUV ? new Float32Array(nv * 2) : null
  const col = hasC ? new Uint8Array(nv * 4) : null
  const I = new GrowU32(1 << 16)
  const vals = new Float64Array(vert.props.length)
  const putVertex = (i: number): void => {
    pos[i * 3] = vals[ix]; pos[i * 3 + 1] = vals[iy]; pos[i * 3 + 2] = vals[iz]
    if (nrm) { nrm[i * 3] = vals[inx]; nrm[i * 3 + 1] = vals[iny]; nrm[i * 3 + 2] = vals[inz] }
    if (uv) { uv[i * 2] = vals[iu]; uv[i * 2 + 1] = 1 - vals[iv] }
    if (col) {
      col[i * 4] = Math.max(0, Math.min(255, Math.round(vals[ir] * colScale(vert.props[ir]))))
      col[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(vals[ig] * colScale(vert.props[ig]))))
      col[i * 4 + 2] = Math.max(0, Math.min(255, Math.round(vals[ib] * colScale(vert.props[ib]))))
      col[i * 4 + 3] = 0
    }
  }
  const putFace = (list: number[]): void => {
    for (let k = 1; k + 1 < list.length; k++) { I.push(list[0]); I.push(list[k]); I.push(list[k + 1]) }
  }
  const isFaceList = (e: PlyElem, p: PlyProp): boolean => e.name === 'face' && !!p.list && (p.name === 'vertex_indices' || p.name === 'vertex_index')
  if (isAscii) {
    let k = 0
    for (const e of elems) {
      if (!e.props.length) continue // (nothing to read in it)
      for (let r = 0; r < e.count; r++) {
        if (k >= tok.length) throw cut()
        let face: number[] | null = null
        for (let j = 0; j < e.props.length; j++) {
          const p = e.props[j]
          if (p.list) {
            const c = Math.max(0, parseInt(tok[k++], 10) || 0)
            if (k + c > tok.length) throw cut()
            const l: number[] = []
            for (let q = 0; q < c; q++) l.push(parseInt(tok[k++], 10) || 0)
            if (isFaceList(e, p)) face = l
          } else {
            const v = Number(tok[k++])
            if (e === vert) vals[j] = v
          }
        }
        if (e === vert) putVertex(r)
        else if (face) putFace(face)
      }
    }
  } else {
    const le = format === 'binary_little_endian'
    const dv = new DataView(buf)
    let o = headerLen
    for (const e of elems) {
      if (!e.props.length) continue // (nothing to read in it)
      for (let r = 0; r < e.count; r++) {
        let face: number[] | null = null
        for (let j = 0; j < e.props.length; j++) {
          const p = e.props[j]
          if (o >= buf.byteLength) throw cut()

          if (p.list) {
            const c = plyRead(dv, o, p.list.count, le)
            o += PLY_SIZE[p.list.count]
            const isz = PLY_SIZE[p.list.item]
            if (!isz) throw new Error(`a PLY number type it does not know : ${p.list.item}`)
            if (!(c >= 0) || o + c * isz > buf.byteLength) throw cut()
            if (isFaceList(e, p)) {
              face = []
              for (let q = 0; q < c; q++) face.push(plyRead(dv, o + q * isz, p.list.item, le))
            }
            o += c * isz
          } else {
            const sz = PLY_SIZE[p.type]
            if (!sz) throw new Error(`a PLY number type it does not know : ${p.type}`)
            if (e === vert) vals[j] = plyRead(dv, o, p.type, le)
            o += sz
          }
        }
        if (e === vert) putVertex(r)
        else if (face) putFace(face)
      }
    }
  }
  const idx = I.n ? I.done() : null
  return { pos, nrm, uv, col, idx, format: 'PLY', notes: idx ? [] : ['a point cloud : drawn as points'] }
}


// ── XYZ and PTS point clouds ───────────────────────────────────────────────────
// Plain text, one point a line : what scanners, photogrammetry and science export
// (a CSV of points reads the same once renamed .xyz : the media scheme serves no
// .csv, which could be any table on the disk).
// The columns by their count : 3 x y z; 4 x y z and an intensity; 6 x y z r g b;
// 7 x y z, an intensity, r g b (PTS : its first line, a lone count, is skipped).
// A header line of names (x, y, z, r / red, g / green, b / blue, i / intensity /
// value) places the columns by name instead. Colors 0..255, or 0..1 when no value
// passes 1; an intensity is a grey (0..1, 0..255 or a scanner's -2048..2047).
// Separated by spaces, tabs, commas or semicolons; lines starting with # or // and
// lines that are not numbers are left out.
function parseXYZ(text: string, ext: string): RawMesh {
  // every point's values, flat, in the first point line's column count
  const flat = new GrowF32(1 << 16)
  let n0 = 0
  let names: string[] | null = null
  let skipped = 0
  let count = 0
  const SEP = /[\s,;]+/
  let start = 0
  while (start < text.length) {
    let end = text.indexOf('\n', start)
    if (end < 0) end = text.length
    const line = text.slice(start, end).trim()
    start = end + 1
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    const cells = line.split(SEP).filter((c) => c.length)
    const vals = cells.map(Number)
    if (vals.some((v) => !Number.isFinite(v))) {
      // a header of names (only before any point), or a line to leave out
      if (!count && !names && cells.every((c) => /^[a-z_"' ]+$/i.test(c))) names = cells.map((c) => c.replace(/["']/g, '').toLowerCase())
      else skipped++
      continue
    }
    if (vals.length === 1 && !count) continue // the PTS count
    if (vals.length < 3) { skipped++; continue }
    if (!n0) n0 = Math.min(vals.length, 7)
    if (vals.length < n0) { skipped++; continue }
    if (count >= MAX_PILED_POINTS) throw new Error(`more than ${(MAX_PILED_POINTS / 1e6).toFixed(0)} million points : too many to read`)
    for (let j = 0; j < n0; j++) flat.push(vals[j])
    count++
  }
  if (!count) throw new Error(`the .${ext} file holds no line of three numbers (x y z)`)
  const F = flat.done()
  // where each value sits
  let ix = 0, iy = 1, iz = 2, ir = -1, ig = -1, ib = -1, ii = -1
  if (names && names.length >= n0) {
    const at = (...k: string[]): number => { const i = names!.findIndex((nm) => k.includes(nm)); return i < n0 ? i : -1 }
    ix = at('x'); iy = at('y'); iz = at('z')
    if (ix < 0 || iy < 0 || iz < 0) { ix = 0; iy = 1; iz = 2 }
    ir = at('r', 'red'); ig = at('g', 'green'); ib = at('b', 'blue')
    ii = at('i', 'intensity', 'value', 'scalar')
  } else if (n0 >= 7) { ii = 3; ir = 4; ig = 5; ib = 6 }
  else if (n0 >= 6) { ir = 3; ig = 4; ib = 5 }
  else if (n0 === 4) ii = 3
  const hasRGB = ir >= 0 && ig >= 0 && ib >= 0
  let maxC = 0, minI = Infinity, maxI = -Infinity
  for (let p = 0; p < F.length; p += n0) {
    if (hasRGB) maxC = Math.max(maxC, F[p + ir], F[p + ig], F[p + ib])
    if (ii >= 0) { minI = Math.min(minI, F[p + ii]); maxI = Math.max(maxI, F[p + ii]) }
  }
  const cK = maxC > 1.0001 ? 1 : 255
  const useI = !hasRGB && ii >= 0 && maxI > minI
  const pos = new Float32Array(count * 3)
  const col = hasRGB || useI ? new Uint8Array(count * 4) : null
  const c8 = (v: number): number => Math.max(0, Math.min(255, Math.round(v * cK)))
  for (let i = 0, p = 0; i < count; i++, p += n0) {
    pos[i * 3] = F[p + ix]; pos[i * 3 + 1] = F[p + iy]; pos[i * 3 + 2] = F[p + iz]
    if (col) {
      const k = i * 4
      if (hasRGB) { col[k] = c8(F[p + ir]); col[k + 1] = c8(F[p + ig]); col[k + 2] = c8(F[p + ib]) }
      else col[k] = col[k + 1] = col[k + 2] = Math.round(((F[p + ii] - minI) / (maxI - minI)) * 255)
      col[k + 3] = 255
    }
  }
  const notes: string[] = []
  if (skipped) notes.push(skipped === 1 ? 'one line that is not a point left out' : `${skipped.toLocaleString('en-US')} lines that are not points left out`)
  return { pos, col, format: ext.toUpperCase(), notes }
}
