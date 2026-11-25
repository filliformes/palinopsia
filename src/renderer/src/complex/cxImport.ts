// Complex Output : a setup read from an AdvancedOutput.xml file. The format is not
// documented : this reads what the files themselves show (screens, their size and
// display, slices with an input and an output rectangle, the Bezier net and the
// projective map that bend them) and leaves out what it does not know, saying how
// much. Pure (a string in, a setup out).

import { CX_MAX_CELLS, newScreen, newSlice, sanitizeSetup, type CxSetup, type CxWarp } from '@shared/complexOut'
import { apply3, bounds, quadSound, quadToQuad, resampleWarp, type M3 } from './cxMath'

interface Node {
  tag: string
  at: Record<string, string>
  kids: Node[]
}

const NAMED: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescapeXml = (s: string): string =>
  s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (_m, d?: string, x?: string, n?: string) => {
    if (n) return NAMED[n.toLowerCase()]
    const c = parseInt(d ?? x ?? '', d ? 10 : 16)
    return Number.isFinite(c) && c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ''
  })

/** The tags and their attributes (text between them is not used in these files). */
function parse(xml: string): Node {
  const root: Node = { tag: '', at: {}, kids: [] }
  const stack = [root]
  const src = xml.replace(/<!--[\s\S]*?-->/g, '')
  const re = /<(\/?)([A-Za-z_][\w.-]*)([^<>]*?)(\/?)>/g
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m[1]) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === m[2]) {
          stack.length = i
          break
        }
      }
      continue
    }
    const n: Node = { tag: m[2], at: {}, kids: [] }
    for (const a of m[3].matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) n.at[a[1]] = unescapeXml(a[2])
    stack[stack.length - 1].kids.push(n)
    if (!m[4] && stack.length < 64) stack.push(n)
  }
  return root
}
const find = (n: Node | undefined, tag: string): Node | undefined => n?.kids.find((k) => k.tag === tag)
function deep(n: Node | undefined, tag: string): Node | undefined {
  for (const k of n?.kids ?? []) {
    if (k.tag === tag) return k
    const d = deep(k, tag)
    if (d) return d
  }
  return undefined
}
const num = (s: string | undefined, d: number): number => {
  const v = Number(s)
  return s !== undefined && s !== '' && Number.isFinite(v) ? v : d
}
const verts = (n: Node | undefined): number[] => (n ? n.kids.filter((k) => k.tag === 'v').flatMap((k) => [num(k.at.x, 0), num(k.at.y, 0)]) : [])
const param = (n: Node, name: string): string | undefined => {
  for (const ps of n.kids) {
    if (ps.tag !== 'Params') continue
    for (const p of ps.kids) if (p.at.name === name && p.at.value !== undefined) return p.at.value
  }
  return undefined
}

const same = (a: number[], b: number[], e: number): boolean => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= e)

/** The net and the projective map after it (px) as one of our warps, in the
 *  screen's 0..1. */
function readWarp(slice: Node, out: number[], w: number, h: number): CxWarp {
  const unit = (p: number[]): number[] => p.map((v, i) => v / (i % 2 ? h : w))
  const plain: CxWarp = { type: 'corners', cols: 1, rows: 1, pts: unit(out) }
  const warper = find(slice, 'Warper')
  const bez = find(warper, 'BezierWarper')
  const homo = find(warper, 'Homography')
  const src = verts(find(homo, 'src')), dst = verts(find(homo, 'dst'))
  const H: M3 | null = src.length === 8 && dst.length === 8 && quadSound(src) && quadSound(dst) ? quadToQuad(src, dst) : null
  const through = (p: number[]): number[] => {
    const o: number[] = []
    for (let i = 0; i < p.length; i += 2) o.push(...(H ? apply3(H, p[i], p[i + 1]) : [p[i], p[i + 1]]))
    return o
  }
  const cw = num(bez?.at.controlWidth, 0), ch = num(bez?.at.controlHeight, 0)
  const net = verts(find(bez, 'vertices'))
  const okNet = cw >= 4 && ch >= 4 && (cw - 1) % 3 === 0 && (ch - 1) % 3 === 0 && net.length === cw * ch * 2
  if (!okNet) return H ? { ...plain, pts: unit(through(out)) } : plain
  const cols = (cw - 1) / 3, rows = (ch - 1) / 3
  if (cols > CX_MAX_CELLS || rows > CX_MAX_CELLS) return plain
  // an untouched net (evenly spaced, an affine square) is only its corners
  const cs = [0, 1, (cw - 1) * 2, (cw - 1) * 2 + 1, net.length - 2, net.length - 1, (ch - 1) * cw * 2, (ch - 1) * cw * 2 + 1].map((i) => net[i])
  const even = resampleWarp({ type: 'corners', cols: 1, rows: 1, pts: cs }, 'bezier', cols, rows)
  const affine = Math.hypot(cs[0] - cs[2] + cs[4] - cs[6], cs[1] - cs[3] + cs[5] - cs[7]) < 0.75
  if (affine && same(even.pts, net, 0.75)) return { type: 'corners', cols: 1, rows: 1, pts: unit(through(cs)) }
  const b = bounds(net)
  const far = H ? Math.max(Math.abs(H[6]) * b.w, Math.abs(H[7]) * b.h) / Math.max(1e-9, Math.abs(H[6] * b.x + H[7] * b.y + H[8])) : 0
  if (far < 1e-3) return { type: 'bezier', cols, rows, pts: unit(through(net)) } // an affine map carries the net exactly
  // a perspective after the curves : the surface itself, sampled closely
  const g = resampleWarp({ type: 'bezier', cols, rows, pts: net }, 'curve', Math.min(CX_MAX_CELLS, cols * 8), Math.min(CX_MAX_CELLS, rows * 8))
  return resampleWarp({ ...g, pts: unit(through(g.pts)) }, 'bezier', Math.min(CX_MAX_CELLS, cols * 2), Math.min(CX_MAX_CELLS, rows * 2))
}

/** Null : not such a file. `skipped` : how many things in it were not read. */
export function importAdvancedOutput(xml: string): { setup: CxSetup; skipped: number } | null {
  if (typeof xml !== 'string' || xml.length > 16 * 1024 * 1024) return null
  const root = deep(parse(xml), 'ScreenSetup')
  if (!root) return null
  const size = find(root, 'CurrentCompositionTextureSize')
  const cw = Math.max(1, num(size?.at.width, 1920)), ch = Math.max(1, num(size?.at.height, 1080))
  let skipped = 0
  const screens = (find(root, 'screens')?.kids ?? []).filter((k) => k.tag === 'Screen').map((sn, i) => {
    const outDev = find(sn, 'OutputDevice')
    const disp = deep(outDev, 'OutputDeviceDisplay')
    const dev = disp ?? outDev?.kids[0]
    const w = Math.max(16, Math.round(num(dev?.at.width, 1920))), h = Math.max(16, Math.round(num(dev?.at.height, 1080)))
    const slices = (find(sn, 'layers')?.kids ?? []).flatMap((n, k) => {
      const inp = n.tag === 'Slice' ? verts(find(n, 'InputRect')) : [], out = n.tag === 'Slice' ? verts(find(n, 'OutputRect')) : []
      if (inp.length !== 8 || out.length !== 8) {
        skipped++
        return []
      }
      const input = inp.map((v, j) => v / (j % 2 ? ch : cw))
      const r = bounds(input)
      const square = same(input, [r.x, r.y, r.x + r.w, r.y, r.x + r.w, r.y + r.h, r.x, r.y + r.h], 1e-4)
      return [newSlice(param(n, 'Name') || `Slice ${k + 1}`, { input, inKind: square ? 'rect' : 'quad', warp: readWarp(n, out, w, h) })]
    })
    return newScreen(param(sn, 'Name') || sn.at.name || `Screen ${i + 1}`, {
      w, h, slices, target: disp ? { kind: 'display', label: disp.at.name, dw: w, dh: h } : { kind: 'none' }
    })
  })
  return { setup: sanitizeSetup({ v: 1, screens }), skipped }
}
