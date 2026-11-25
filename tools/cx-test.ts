// Complex Output's geometry and reader, checked in node :
//   npx esbuild tools/cx-test.ts --bundle --platform=node --alias:@shared=./src/shared --outfile=%TEMP%/cx-test.cjs && node %TEMP%/cx-test.cjs
import { blendLight, blendValue, evalWarp, invWarp, meanValueMap, movePoint, quadSound, quadToQuad, apply3, resampleWarp, squareToQuad, warpMesh, warpFolded, maskCover, polyDistance, maskOnScreen, inputMap, polyInput, insidePoly, rectWarp, flattenMask, bounds } from '../src/renderer/src/complex/cxMath'
import { copySlice, cxBaseValue, cxSetValue, findSlice, newScreen, newSlice, newMask, patchSlice, rectPts, sanitizeSetup, sliceNumber, type CxWarp } from '../src/shared/complexOut'
import { findProblems } from '../src/renderer/src/complex/cxProblems'
import { autoBlend } from '../src/renderer/src/complex/cxBlend'
import { importAdvancedOutput } from '../src/renderer/src/complex/cxImport'
import { readFileSync, existsSync } from 'fs'

let n = 0, bad = 0
const ok = (c: boolean, m: string): void => { n++; if (!c) { bad++; console.log('FAIL', m) } }
const near = (a: number, b: number, e: number, m: string): void => ok(Math.abs(a - b) <= e, `${m} : ${a} vs ${b}`)

// ── homography
const Q = [0.1, 0.05, 0.9, 0.12, 0.8, 0.95, 0.2, 0.8]
{
  const m = squareToQuad(Q)
  const C = [[0, 0], [1, 0], [1, 1], [0, 1]]
  C.forEach(([s, t], i) => { const p = apply3(m, s, t); near(p[0], Q[i * 2], 1e-12, 'corner x'); near(p[1], Q[i * 2 + 1], 1e-12, 'corner y') })
  // the diagonals meet where the square's middle goes (the mark of a true perspective)
  const mid = apply3(m, 0.5, 0.5)
  const [x1, y1, x2, y2, x3, y3, x4, y4] = [Q[0], Q[1], Q[4], Q[5], Q[2], Q[3], Q[6], Q[7]]
  const d = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
  const ix = ((x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)) / d
  const iy = ((x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)) / d
  near(mid[0], ix, 1e-12, 'diagonals x'); near(mid[1], iy, 1e-12, 'diagonals y')
  ok(Math.hypot(mid[0] - (Q[0] + Q[2] + Q[4] + Q[6]) / 4, mid[1] - (Q[1] + Q[3] + Q[5] + Q[7]) / 4) > 0.005, 'not the bilinear middle')
  // inverse
  const w: CxWarp = { type: 'corners', cols: 1, rows: 1, pts: Q }
  for (const [s, t] of [[0.2, 0.3], [0.9, 0.1], [0.5, 0.99]]) { const p = evalWarp(w, s, t); const q = invWarp(w, p[0], p[1])!; near(q[0], s, 1e-9, 'inv s'); near(q[1], t, 1e-9, 'inv t') }
  ok(invWarp(w, 0.01, 0.99) === null, 'outside')
  ok(!quadSound([0, 0, 1, 1, 1, 0, 0, 1]), 'crossed corners refused')
  ok(quadSound([0, 0, 1, 0, 1, 1, 0, 1]), 'identity sound')
  const A = [0, 0, 2, 0, 2, 1, 0, 1], m2 = quadToQuad(A, Q)!
  A.forEach((_, i) => { if (i % 2) return; const p = apply3(m2, A[i], A[i + 1]); near(p[0], Q[i], 1e-9, 'q2q') })
  // affine
  const par = [0, 0, 1, 0.5, 1.5, 1.5, 0.5, 1], ma = squareToQuad(par)
  ok(ma[6] === 0 && ma[7] === 0, 'parallelogram is affine')
}
// ── grid, curve, bezier
{
  const c: CxWarp = { type: 'corners', cols: 1, rows: 1, pts: rectPts(0.1, 0.2, 0.6, 0.5) }
  for (const type of ['grid', 'curve', 'bezier'] as const) {
    const w = resampleWarp(c, type, 3, 2)
    for (const [s, t] of [[0, 0], [1, 1], [0.31, 0.77], [0.5, 0.5], [0.99, 0.01]]) {
      const p = evalWarp(w, s, t)
      near(p[0], 0.1 + 0.6 * s, 1e-6, `${type} flat x`); near(p[1], 0.2 + 0.5 * t, 1e-6, `${type} flat y`)
    }
    ok(w.pts.length === (type === 'bezier' ? 10 * 7 : 4 * 3) * 2, `${type} count`)
    ok(!warpFolded(w), `${type} not folded`)
  }
  // curve : passes through its points, smooth between them
  const g = resampleWarp(c, 'curve', 4, 3)
  g.pts[(2 * 5 + 2) * 2 + 1] += 0.07
  g.pts[(1 * 5 + 1) * 2] += 0.03
  for (let r = 0; r <= 3; r++) for (let k = 0; k <= 4; k++) { const p = evalWarp(g, k / 4, r / 3); near(p[0], g.pts[(r * 5 + k) * 2], 1e-9, 'through x'); near(p[1], g.pts[(r * 5 + k) * 2 + 1], 1e-9, 'through y') }
  const h = 1e-5
  const slope = (w: CxWarp, s: number, t: number, e: number): number => (evalWarp(w, s + e, t)[1] - evalWarp(w, s, t)[1]) / e
  near(slope(g, 0.5, 0.6, h), slope(g, 0.5, 0.6, -h), 1e-3, 'curve : one slope across a point')
  const gg: CxWarp = { ...g, type: 'grid' }
  ok(Math.abs(slope(gg, 0.5, 2 / 3, h) - slope(gg, 0.5, 2 / 3, -h)) > 0.05, 'grid : a crease at a point')
  // to bezier and back : the same shape within half a 1080p pixel
  let e1 = 0
  const b = resampleWarp(g, 'bezier', 4, 3)
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) { const p = evalWarp(g, i / 40, j / 40), q = evalWarp(b, i / 40, j / 40); e1 = Math.max(e1, Math.hypot((p[0] - q[0]) * 1920, (p[1] - q[1]) * 1080)) }
  ok(e1 < 0.5, `curve as bezier, ${e1.toFixed(3)} px`)
  // corners (a perspective) as a bezier
  const P: CxWarp = { type: 'corners', cols: 1, rows: 1, pts: Q }
  const pb = resampleWarp(P, 'bezier', 4, 4)
  let e2 = 0
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) { const p = evalWarp(P, i / 40, j / 40), q = evalWarp(pb, i / 40, j / 40); e2 = Math.max(e2, Math.hypot((p[0] - q[0]) * 1920, (p[1] - q[1]) * 1080)) }
  ok(e2 < 0.5, `perspective as bezier, ${e2.toFixed(3)} px`)
  // another number of cells
  const b2 = resampleWarp(b, 'bezier', 8, 6)
  let e3 = 0
  for (let i = 0; i <= 40; i++) for (let j = 0; j <= 40; j++) { const p = evalWarp(b, i / 40, j / 40), q = evalWarp(b2, i / 40, j / 40); e3 = Math.max(e3, Math.hypot((p[0] - q[0]) * 1920, (p[1] - q[1]) * 1080)) }
  ok(e3 < 0.5, `bezier with more cells, ${e3.toFixed(3)} px`)
  for (const w of [gg, g, b]) for (const [s, t] of [[0.1, 0.2], [0.62, 0.4], [0.95, 0.9]]) { const p = evalWarp(w, s, t); const q = invWarp(w, p[0], p[1])!; ok(!!q && Math.hypot(q[0] - s, q[1] - t) < 1e-3, `${w.type} inverse`) }
  // bezier : a knot takes its handles, a handle turns its twin
  const n4 = 13
  const k = (1 * 3) * n4 + 3
  const m1 = movePoint(b, k, 0.05, 0.02)
  near(m1.pts[(k + 1) * 2] - b.pts[(k + 1) * 2], 0.05, 1e-12, 'handle follows')
  near(m1.pts[(k + n4 - 1) * 2 + 1] - b.pts[(k + n4 - 1) * 2 + 1], 0.02, 1e-12, 'twist follows')
  const m2 = movePoint(b, k + 1, 0.0, 0.05)
  const ang = (a: number, c2: number): number => Math.atan2(m2.pts[a * 2 + 1] - m2.pts[c2 * 2 + 1], m2.pts[a * 2] - m2.pts[c2 * 2])
  near(Math.abs(ang(k + 1, k) - ang(k, k - 1)), 0, 1e-9, 'handles in line')
  const m3 = movePoint(b, k + 1, 0, 0.05, true)
  near(m3.pts[(k - 1) * 2 + 1], b.pts[(k - 1) * 2 + 1], 0, 'alt : the twin stays')
  // mesh
  const me = warpMesh(P, 2 / 1080)
  ok(me.idx.length === 6, 'a perspective is two triangles')
  let wmin = 9
  for (let i = 0; i < 4; i++) wmin = Math.min(wmin, me.v[i * 5 + 2])
  ok(wmin > 0, 'weights positive')
  const mg = warpMesh(b, 2 / 1080)
  ok(Math.max(...mg.idx) < mg.v.length / 5, 'indices in range')
  const folded = resampleWarp(c, 'grid', 2, 2)
  folded.pts[4 * 2] = 1.5
  ok(warpFolded(folded), 'a fold is found')
  ok(bounds(rectWarp(b, 0.2, 0.3, 0.4, 0.5).pts).w - 0.4 < 1e-6, 'rectWarp')
}
// ── polygons
{
  const out = [0.1, 0.1, 0.9, 0.2, 0.8, 0.9, 0.5, 0.55, 0.2, 0.8] // concave
  const inp = out.map((v, i) => (i % 2 ? v * 0.5 + 0.2 : v * 0.7 + 0.1))
  for (const [x, y] of [[0.5, 0.3], [0.3, 0.3], [0.75, 0.5], [0.22, 0.6]]) {
    const q = meanValueMap(out, inp, x, y)
    near(q[0], x * 0.7 + 0.1, 1e-9, 'mvc reproduces an affine x'); near(q[1], y * 0.5 + 0.2, 1e-9, 'mvc reproduces an affine y')
  }
  const inp2 = [0, 0, 1, 0, 1, 1, 0.5, 0.6, 0, 1]
  for (let i = 0; i < 5; i++) { const q = meanValueMap(out, inp2, out[i * 2], out[i * 2 + 1]); near(q[0], inp2[i * 2], 1e-9, 'mvc pins') }
  const a = meanValueMap(out, inp2, (out[0] + out[2]) / 2, (out[1] + out[3]) / 2)
  near(a[0], 0.5, 1e-9, 'mvc straight on a side'); near(a[1], 0, 1e-9, 'mvc straight on a side y')
  const e = meanValueMap(out, inp2, 0.5, 0.15 + 1e-7)
  near(e[0], 0.5, 1e-4, 'mvc continuous at the side')
  ok(insidePoly(out, 0.5, 0.3) && !insidePoly(out, 0.5, 0.7), 'concave inside')
}
// ── masks
{
  const sq = rectPts(100, 100, 200, 100)
  near(polyDistance(sq, 200, 150), 50, 1e-9, 'distance inside')
  near(polyDistance(sq, 90, 150), -10, 1e-9, 'distance outside')
  near(maskCover(0, 0), 0.5, 1e-9, 'the edge is half')
  near(maskCover(0.5, 0), 1, 1e-9, 'hard one pixel'); near(maskCover(-0.5, 0), 0, 1e-9, 'hard one pixel out')
  near(maskCover(0, 40), 0.5, 1e-9, 'soft middle'); near(maskCover(20, 40), 1, 1e-9, 'soft in'); near(maskCover(-20, 40), 0, 1e-9, 'soft out')
  let prev = -1
  for (let d = -25; d <= 25; d += 0.5) { const v = maskCover(d, 40); ok(v >= prev, 'soft rises'); prev = v }
  const m = newMask('m', rectPts(0, 0, 1, 1))
  const w: CxWarp = resampleWarp({ type: 'corners', cols: 1, rows: 1, pts: Q }, 'grid', 2, 2)
  const on = maskOnScreen(w, m)
  near(on[0], Q[0], 1e-9, 'mask corner'); ok(on.length > 8, 'sides follow the bends')
  ok(flattenMask({ pts: rectPts(0, 0, 1, 1), smooth: true }).length === 80, 'smooth outline')
}
// ── input : flips, turns
{
  const s = newSlice('a', { input: rectPts(0.2, 0.4, 0.5, 0.3) })
  const at = (o: object, u: number, v: number): [number, number] => apply3(inputMap({ ...s, ...o }), u, v)
  const is = (p: [number, number], x: number, y: number, m: string): void => { near(p[0], x, 1e-9, m); near(p[1], y, 1e-9, m) }
  is(at({}, 0, 0), 0.2, 0.4, 'plain TL'); is(at({}, 1, 1), 0.7, 0.7, 'plain BR')
  is(at({ flipX: true }, 0, 0), 0.7, 0.4, 'flip x'); is(at({ flipY: true }, 0, 0), 0.2, 0.7, 'flip y')
  is(at({ turn: 1 }, 0, 0), 0.2, 0.7, 'quarter clockwise : TL shows BL'); is(at({ turn: 1 }, 1, 0), 0.2, 0.4, 'TR shows TL')
  is(at({ turn: 2 }, 0, 0), 0.7, 0.7, 'half'); is(at({ turn: 3 }, 0, 0), 0.7, 0.4, 'three quarters')
  const p = polyInput({ input: [0, 0, 1, 0, 0.5, 1], flipX: true, flipY: false, turn: 0 })
  is([p[0], p[1]], 1, 0, 'poly flip')
}
// ── soft edges : two ramps add up to one light
{
  let worst = 0
  for (const power of [1, 1.5, 2, 3, 6]) for (const gamma of [1, 1.8, 2.2, 2.6]) for (let i = 0; i <= 200; i++) {
    const x = i / 200
    const l = Math.pow(blendValue(x, { power, gamma, lum: 0.5 }), gamma) + Math.pow(blendValue(1 - x, { power, gamma, lum: 0.5 }), gamma)
    worst = Math.max(worst, Math.abs(l - 1))
  }
  ok(worst < 1e-12, `blend sums to 1 (worst ${worst})`)
  near(blendLight(0.5, 2, 0.5), 0.5, 1e-12, 'middle'); near(blendLight(0, 2, 0.5), 0, 0, 'outer'); near(blendLight(1, 2, 0.5), 1, 0, 'inner')
  ok(blendLight(0.5, 2, 0.7) > 0.69, 'luminance raises the middle')
  // after 8 bits, still within 1.5 %
  let q = 0
  for (let i = 0; i <= 400; i++) { const r = (v: number): number => Math.round(v * 255) / 255; const x = i / 400; q = Math.max(q, Math.abs(Math.pow(r(blendValue(x, { power: 2, gamma: 2.2, lum: 0.5 })), 2.2) + Math.pow(r(blendValue(1 - x, { power: 2, gamma: 2.2, lum: 0.5 })), 2.2) - 1)) }
  ok(q < 0.015, `8-bit sum ${q}`)
}
// ── model
{
  ok(sanitizeSetup(null).screens.length === 0, 'nothing')
  ok(sanitizeSetup({ screens: 'x' }).screens.length === 0, 'rubbish')
  const s = sanitizeSetup({ screens: [{ w: 1e9, h: -4, slices: [{ input: [1, 2], warp: { type: 'grid', cols: 3, rows: 3, pts: [1] }, opacity: 'a' }, { inKind: 'poly', input: [0, 0, 1, 0, 1, 1], warp: { type: 'poly', pts: [0, 0, 1, 0, 1, 1] } }, { id: 'a' }, { id: 'a' }, null], masks: [{ pts: [1, 2] }] }] })
  ok(s.screens[0].w === 8192 && s.screens[0].h === 16, 'size bounded')
  ok(s.screens[0].slices[0].warp.type === 'corners' && s.screens[0].slices[0].opacity === 1, 'bad warp becomes corners')
  ok(s.screens[0].slices[1].warp.type === 'poly', 'a polygon is kept')
  ok(s.screens[0].slices[2].id !== s.screens[0].slices[3].id, 'ids are unique')
  ok(s.screens[0].slices.length === 5 && s.screens[0].masks.length === 0, 'null slice read, bad mask dropped')
  const again = sanitizeSetup(JSON.parse(JSON.stringify(s)))
  ok(JSON.stringify(again) === JSON.stringify(s), 'reading twice changes nothing')
  const id = s.screens[0].slices[1].id
  ok(sliceNumber(s, id) === 2, 'number')
  ok(findSlice(cxSetValue(s, id, 'opacity', 0.25), id)!.slice.opacity === 0.25, 'set opacity')
  ok(cxSetValue(s, 'gone', 'opacity', 0.2) === s, 'gone : unchanged')
  ok(cxBaseValue(s, s.screens[0].id, 'on') === 1 && cxSetValue(s, s.screens[0].id, 'on', 0).screens[0].on === false, 'screen on/off')
  const c = copySlice(s.screens[0].slices[1])
  c.warp.pts[0] = 9
  ok(s.screens[0].slices[1].warp.pts[0] === 0 && c.id !== id, 'a copy is its own')
  ok(patchSlice(s, 'zz', { on: false }) === s, 'patch nothing')
}
// ── problems and the auto blend
{
  const disp = [{ id: 1, label: 'A', width: 1920, height: 1080, isControl: true, isPrimary: true }, { id: 2, label: 'B', width: 1280, height: 800, isControl: false, isPrimary: false }]
  const left = newSlice('L', { input: rectPts(0, 0, 0.6, 1) }), right = newSlice('R', { input: rectPts(0.4, 0, 0.6, 1) })
  let st = { v: 1 as const, screens: [newScreen('One', { slices: [left], target: { kind: 'display' as const, displayId: 2, label: 'B', dw: 1280, dh: 800 } }), newScreen('Two', { slices: [right] })] }
  const ks = (): string[] => findProblems(st, disp, { live: true, states: {}, allowOwn: false, layers: [true, true, true, true] }).map((p) => p.kind)
  ok(ks().includes('nowhere'), 'a screen going nowhere')
  ok(ks().includes('size'), 'resolution mismatch')
  ok(ks().includes('noblend'), 'overlap without a blend')
  st = autoBlend(st) as typeof st
  ok(!ks().includes('noblend'), 'the auto blend answers it')
  const e = st.screens[0].slices[0].edges
  near(e.r, 1 / 3, 1e-9, 'width of the shared third'); ok(e.on && e.l === 0, 'on that side only')
  near(st.screens[1].slices[0].edges.l, 1 / 3, 1e-9, 'and its twin')
  const off = { ...left, warp: { ...left.warp, pts: rectPts(2, 0, 1, 1) } }
  st = { v: 1, screens: [newScreen('One', { slices: [off], target: { kind: 'display', displayId: 1, label: 'A', dw: 1920, dh: 1080 } })] }
  ok(ks().includes('offscreen'), 'off its screen'); ok(ks().includes('own'), 'over the controls')
  st = { v: 1, screens: [newScreen('One', { slices: [], target: { kind: 'display', displayId: 9, label: 'gone', dw: 1920, dh: 1080 } })] }
  ok(ks().includes('missing') && ks().includes('empty'), 'display unplugged, no slice')
}
// ── the import
{
  const xml = `<?xml version="1.0"?><ScreenSetup name="ScreenSetup"><CurrentCompositionTextureSize width="2000" height="1000"/><screens><Screen name="S1" uniqueId="1"><Params name="Params"><Param name="Name" T="STRING" value="Left &amp; right"/></Params><layers>
  <Slice uniqueId="2"><Params name="Common"><Param name="Name" value="Wall"/></Params><InputRect orientation="0"><v x="0" y="0"/><v x="1000" y="0"/><v x="1000" y="500"/><v x="0" y="500"/></InputRect><OutputRect orientation="0"><v x="0" y="0"/><v x="960" y="0"/><v x="960" y="540"/><v x="0" y="540"/></OutputRect>
  <Warper><BezierWarper controlWidth="4" controlHeight="4"><vertices>${Array.from({ length: 16 }, (_, i) => `<v x="${(i % 4) * 320}" y="${Math.floor(i / 4) * 180}"/>`).join('')}</vertices></BezierWarper><Homography><src><v x="0" y="0"/><v x="960" y="0"/><v x="960" y="540"/><v x="0" y="540"/></src><dst><v x="10" y="0"/><v x="900" y="50"/><v x="960" y="540"/><v x="0" y="500"/></dst></Homography></Warper></Slice></layers>
  <OutputDevice><OutputDeviceDisplay name="Display 5" fullscreen="1" width="1920" height="1080"/></OutputDevice></Screen></screens></ScreenSetup>`
  const r = importAdvancedOutput(xml)
  ok(!!r && r.setup.screens.length === 1, 'import : a screen')
  const sc = r!.setup.screens[0], sl = sc.slices[0]
  ok(sc.name === 'Left & right' && sl.name === 'Wall' && sc.w === 1920, 'import : names and size')
  near(sl.input[4], 0.5, 1e-9, 'import : input'); near(sl.input[5], 0.5, 1e-9, 'import : input y')
  ok(sl.warp.type === 'corners', 'import : an untouched net with a perspective is four corners')
  near(sl.warp.pts[2] * 1920, 900, 1e-6, 'import : TR'); near(sl.warp.pts[3] * 1080, 50, 1e-6, 'import : TR y')
  ok(importAdvancedOutput('<html/>') === null, 'import : something else')
  const own = process.argv[2]
  if (own && existsSync(own)) {
    const f = importAdvancedOutput(readFileSync(own, 'utf8'))!
    console.log('own file :', f.setup.screens.map((s) => `${s.name} ${s.w}x${s.h} ${s.slices.map((l) => `${l.name}:${l.warp.type}`).join(' ')}`).join(' | '), 'skipped', f.skipped)
    const l = f.setup.screens[0].slices[0]
    // the first slice's top left, bezier then homography by hand
    const src = [81.951171875, 460.590667724609375, 596.8033447265625, 460.590667724609375, 596.8033447265625, 1072.2420654296875, 81.951171875, 1072.2420654296875]
    const dst = [81.9511566162109375, 460.6759033203125, 596.141845703125, 459.50311279296875, 610.08746337890625, 1230.655029296875, 81.95116424560546875, 1074.269287109375]
    const H = quadToQuad(src, dst)!
    const want = apply3(H, 81.95116424560546875, 617.54290771484375)
    const got = evalWarp(l.warp, 0, 0)
    near(got[0] * 1920, want[0], 0.5, 'own file x'); near(got[1] * 1080, want[1], 0.5, 'own file y')
  }
}
console.log(bad ? `${bad} of ${n} FAILED` : `${n} checks passed`)
process.exit(bad ? 1 : 0)
