// Draws Palinopsia's signal-flow map (scripts/signal-flow/graph.mjs) into
// docs/signal-flow.html, the page the site links to, in the app's own look : its UI
// themes and fonts are read from src/renderer/src/styles.css and store.ts here, so the
// map follows them when they change.
//
//   npm run signal-flow            write docs/signal-flow.html and docs/fonts/
//   npm run signal-flow -- --check fail if docs/signal-flow.html is not what this writes
//
// Fonts : the site loads nothing from outside, so the page serves the app's own UI
// fonts (Inter, Roboto, IBM Plex Sans, Work Sans) from docs/fonts/, copied here from
// src/renderer/src/fonts with their license (licenses/fonts.txt, OFL-1.1.txt).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { N, E, W, H, IX, OX, TEXT, BOOKKEEPING } from './graph.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
// the support page, from the one place the app reads it (npm run support-link sets it)
const SUPPORT_URL = (/export const SUPPORT_URL = '([^']*)'/.exec(read('src/shared/links.ts')) ?? [])[1] ?? ''
const CHECK = process.argv.includes('--check')
const OUT = 'docs/signal-flow.html'
const SITE = 'https://filliformes.github.io/palinopsia/'
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1)

// ── 1. The app's themes ─────────────────────────────────────────────────────
const CSS = read('src/renderer/src/styles.css')
const ORDER = [...read('src/renderer/src/store.ts').match(/THEME_ORDER: ThemeName\[\] = \[([^\]]*)\]/)[1].matchAll(/'(\w+)'/g)].map((m) => m[1])
const KEYS = ['bg', 'panel', 'panel2', 'panel3', 'border', 'accent', 'accent2', 'muted', 'text', 'active', 'danger', 'success', 'input-bg']
const THEMES = {}
for (const t of ORDER) {
  const m = CSS.match(new RegExp(`(?::root)?\\[data-theme='${t}'\\]\\s*\\{([^}]*)\\}`))
  if (!m) throw new Error(`theme ${t} : no [data-theme='${t}'] block in styles.css`)
  const v = {}
  for (const k of KEYS) v[k] = m[1].match(new RegExp(`--c-${k}:\\s*([\\d ]+);`))[1].trim().split(/\s+/).map(Number)
  v.font = m[1].match(/--font-app:\s*([^;]+);/)[1].trim()
  const inset = m[1].match(/--input-inset:\s*([^;]+);/)
  v.inset = inset ? inset[1].trim() : null
  THEMES[t] = v
}

// ── 2. Six flow colours per theme ───────────────────────────────────────────
// picture = the theme's accent (what plays), control = its accent2 (the colour the
// app's modulated controls wear), out of the app = muted, through the room = danger;
// sound and inside-feedback get a hue tuned to the theme's lightness. A colour too
// faint on the background (under 3:1) keeps its hue and moves in lightness; one too
// close to a colour already chosen is replaced by the next candidate hue.
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 }
const delin = (c) => { c = Math.max(0, Math.min(1, c)); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055) }
function toLab([r8, g8, b8]) {
  const r = lin(r8), g = lin(g8), b = lin(b8)
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s]
}
function fromLch(L, C, h) {
  let a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180), rgb
  for (let i = 0; i < 40; i++) {
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
    rgb = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s]
    if (rgb.every((x) => x >= -0.001 && x <= 1.001)) break
    a *= 0.92; b *= 0.92
  }
  return rgb.map((x) => Math.round(delin(x)))
}
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
const contrast = (c1, c2) => { const [a, b] = [lum(c1), lum(c2)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05) }
const dist = (c1, c2) => Math.hypot(...toLab(c1).map((v, i) => v - toLab(c2)[i]))
const lch = (c) => { const [L, a, b] = toLab(c); return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360] }
function hueGap(c1, c2) {
  const [, C1, h1] = lch(c1), [, C2, h2] = lch(c2)
  if (C1 < 0.06 || C2 < 0.06) return 180
  const d = Math.abs(h1 - h2) % 360
  return Math.min(d, 360 - d)
}
const MIN_D = 0.11, MIN_C = 3, MIN_HUE = 28
const HUES = { ctl: [230, 160, 280, 200], phys: [25, 0, 345, 45], snd: [305, 285, 330, 150], loop: [100, 85, 130, 160] }
const FLOWS = {}
for (const t of ORDER) {
  const v = THEMES[t], bg = v.bg, dark = lum(bg) < 0.2, L0 = dark ? 0.8 : 0.5
  const reach = (c) => {
    let [L, C, h] = lch(c)
    for (let i = 0; i < 30 && contrast(c, bg) < MIN_C; i++) { L += dark ? 0.025 : -0.025; c = fromLch(L, C, h) }
    return c
  }
  const chosen = { pic: reach(v.accent) }
  const ok = (c) => contrast(c, bg) >= MIN_C && lch(c)[1] >= 0.07 && Object.values(chosen).every((o) => dist(c, o) >= MIN_D && hueGap(c, o) >= MIN_HUE)
  const pick = (slot, first) => {
    if (first) { const c = reach(first); if (ok(c)) return (chosen[slot] = c) }
    for (const h of HUES[slot])
      for (const L of [L0, L0 + (dark ? 0.06 : -0.06), L0 - (dark ? 0.08 : -0.08)]) { const c = fromLch(L, 0.15, h); if (ok(c)) return (chosen[slot] = c) }
    console.warn(`signal-flow : theme ${t}, no distinct colour found for ${slot}`)
    return (chosen[slot] = fromLch(L0, 0.15, HUES[slot][0]))
  }
  pick('ctl', v.accent2); pick('phys', v.danger); pick('snd', null); pick('loop', null)
  chosen.net = contrast(v.muted, bg) >= MIN_C ? v.muted : v.muted.map((x, i) => Math.floor((x + v.text[i]) / 2))
  FLOWS[t] = chosen
}
const trip = (c) => c.join(' ')
function themeVars(t) {
  const v = THEMES[t], f = FLOWS[t]
  return KEYS.map((k) => ` --c-${k}: ${trip(v[k])};`).join('') + ` --font-app: ${v.font};` + (v.inset ? ` --input-inset: ${v.inset};` : ' --input-inset: none;') +
    ['pic', 'ctl', 'snd', 'net', 'loop', 'phys'].map((k) => ` --f-${k}: ${trip(f[k])};`).join('') + ` color-scheme: ${lum(v.bg) < 0.2 ? 'dark' : 'light'};`
}
// Studio, the app's default, unless a theme is picked.
const THEME_CSS = [`:root {${themeVars('studio')} }`, ...ORDER.map((t) => `:root[data-theme="${t}"] {${themeVars(t)} }`)].join('\n')

// ── 3. Fonts : the app's UI faces, served by the site itself ────────────────
const FONT_FILES = fs.readdirSync(path.join(ROOT, 'src/renderer/src/fonts')).filter((f) => /^(inter|roboto|worksans|plexsans)-\d+\.woff2$/.test(f)).sort()
const FAMILY = { inter: 'Inter', roboto: 'Roboto', worksans: 'Work Sans', plexsans: 'IBM Plex Sans' }
const FONT_CSS = FONT_FILES.map((f) => {
  const [, fam, wt] = f.match(/^(\w+)-(\d+)\./)
  return `@font-face { font-family: '${FAMILY[fam]}'; font-weight: ${wt}; font-style: normal; font-display: swap; src: url('fonts/${f}') format('woff2'); }`
}).join('\n')

// ── 4. Sizes : three, by role ───────────────────────────────────────────────
// The spine (the longest chain of picture links : sources, A/B mix, layer FX, stack,
// master and finalizers, presentation, transform, keystone) is drawn large; bookkeeping
// (graph.mjs BOOKKEEPING, and blocks whose every link is secondary) small, as labels;
// everything else medium. The map's titles are set in IBM Plex Sans, whatever the theme.
const MAP_FONT = 'IBM Plex Sans'
// Its advance widths (docs/fonts/plexsans-500 and -600), in thousandths of an em,
// measured once in Chromium, so each block fits its title.
const GLYPHS = ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~·→×↔…²←±’'
const ADV = {
  500: '234,297,453,672,594,953,703,250,344,344,516,594,281,406,281,422,594,594,594,594,594,594,594,594,594,594,313,313,594,594,594,484,891,656,656,641,688,594,563,703,719,406,531,656,516,813,719,719,625,719,656,594,578,688,625,922,641,609,594,328,422,328,594,563,594,547,594,516,594,563,344,531,578,266,266,547,281,875,578,563,594,594,391,500,359,578,516,797,531,516,484,359,359,359,594,344,1000,594,1000,844,344,1000,594,281',
  600: '234,313,469,656,594,953,719,266,344,344,563,594,297,406,297,438,594,594,594,594,594,594,594,594,594,594,313,313,594,594,594,500,906,672,656,641,688,594,578,719,719,422,547,672,516,813,719,719,641,719,656,609,578,688,641,953,656,625,594,328,438,328,594,563,594,563,594,516,594,563,344,547,594,281,281,563,297,891,594,563,594,594,391,500,375,594,531,813,547,531,500,359,375,359,594,344,1000,594,1000,875,344,1000,594,297'
}
for (const k in ADV) ADV[k] = ADV[k].split(',').map(Number)
const textW = (s, wt, px) => ([...s].reduce((a, c) => { const i = GLYPHS.indexOf(c); return a + (i < 0 ? 600 : ADV[wt][i]) }, 0) * px) / 1000
const SZ = {
  L: { h: 48, fs: 16, wt: 600, pl: 17, pr: 17, rx: 17 },
  M: { h: 32, fs: 14.5, wt: 500, pl: 25, pr: 13, rx: 11 },
  S: { h: 22, fs: 13, wt: 500, pl: 17, pr: 9, rx: 11 }
}
const picNext = (id) => E.filter((e) => e.a === id && e.t === 'pic' && N[e.b].kind === 'pic').map((e) => e.b)
const picPrev = (id) => E.filter((e) => e.b === id && e.t === 'pic' && N[e.a].kind === 'pic').map((e) => e.a)
const depth = (step) => { const m = new Map(); const f = (id) => { if (!m.has(id)) m.set(id, 1 + Math.max(0, ...step(id).map(f))); return m.get(id) }; return f }
const after = depth(picNext), before = depth(picPrev)
const PIC = Object.values(N).filter((n) => n.kind === 'pic').map((n) => n.id)
const LONGEST = Math.max(...PIC.map(after))
const SPINE = new Set(PIC.filter((id) => before(id) + after(id) - 1 === LONGEST))
const SMALL = new Set(Object.keys(N).filter((id) => BOOKKEEPING.has(id) || E.filter((e) => e.a === id || e.b === id).every((e) => e.minor)))
for (const n of Object.values(N)) {
  n.size = SPINE.has(n.id) ? 'L' : SMALL.has(n.id) ? 'S' : 'M'
  const z = SZ[n.size]
  n.w = Math.round(textW(n.title, z.wt, z.fs) + z.pl + z.pr)
  n.h = z.h
  n.x = n.kind === 'in' ? n.ax - n.w : n.kind === 'out' ? n.ax : Math.round(n.ax - n.w / 2)
  n.y = n.ay - n.h / 2
}
// blocks must keep a little air between them
const NL = Object.values(N)
NL.forEach((a, i) => NL.slice(i + 1).forEach((b) => {
  if (a.x < b.x + b.w + 6 && b.x < a.x + a.w + 6 && a.y < b.y + b.h + 4 && b.y < a.y + a.h + 4) console.warn(`signal-flow : ${a.id} and ${b.id} overlap`)
}))

// ── 5. Links : curves, weighted by what they carry ──────────────────────────
const cx = (n) => n.x + n.w / 2, cy = (n) => n.y + n.h / 2, right = (n) => n.x + n.w, bottom = (n) => n.y + n.h
// the two bands and the layer group, wrapped round their blocks
const box = (ids, px, top, bot = top) => {
  const ns = ids.map((id) => N[id])
  const x0 = Math.min(...ns.map((n) => n.x)) - px, x1 = Math.max(...ns.map(right)) + px
  const y0 = Math.min(...ns.map((n) => n.y)) - top, y1 = Math.max(...ns.map(bottom)) + bot
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
const byKind = (...k) => Object.values(N).filter((n) => k.includes(n.kind)).map((n) => n.id)
const CB = box(byKind('ctl', 'bus'), 22, 22)
const PB = box(byKind('pic'), 26, 52, 36)
const LG = box(['p-srcA', 'p-srcB', 'p-rackA', 'p-rackB', 'p-mix', 'p-lrack', 'p-loop'], 14, 40, 44)
const anchor = (n, side, k = 0.5) => ({ l: [n.x, n.y + n.h * k], r: [n.x + n.w, n.y + n.h * k], t: [n.x + n.w * k, n.y], b: [n.x + n.w * k, n.y + n.h] })[side]
function planSides(e) {
  if (e.sides) return [e.sides[0], e.sides[1]]
  const a = N[e.a], b = N[e.b]
  if (b.x >= a.x + a.w - 2) return ['r', 'l']
  if (b.x + b.w <= a.x + 2) return ['l', 'r']
  return b.y > a.y ? ['b', 't'] : ['t', 'b']
}
for (const e of E) e.spine = e.t === 'pic' && SPINE.has(e.a) && SPINE.has(e.b)
// Links on one side of a spine block spread along it, ordered by where their other end is.
const sides = new Map()
for (const e of E) {
  if (e.path) continue
  ;[e.sa, e.sb] = planSides(e)
  for (const [id, s] of [[e.a, e.sa], [e.b, e.sb]]) { const k = id + '|' + s; if (!sides.has(k)) sides.set(k, []); sides.get(k).push(e) }
}
function kpos(id, side, e) {
  const other = (x) => { const o = N[x.a === id ? x.b : x.a]; return 'lr'.includes(side) ? o.y + o.h / 2 : o.x + o.w / 2 }
  const lst = [...sides.get(id + '|' + side)].sort((p, q) => other(p) - other(q))
  // the spine's blocks take their links side by side; the others gather theirs at one point, like streams
  if (lst.length === 1 || N[id].size !== 'L') return 0.5
  return 0.22 + (0.56 * lst.indexOf(e)) / (lst.length - 1)
}
// a cubic from side to side, its handles as long as the way is far
function bez(p0, p3, s0, s3) {
  const along = 'lr'.includes(s0) ? 0 : 1
  const dp = Math.abs(p3[along] - p0[along]), ds = Math.abs(p3[1 - along] - p0[1 - along])
  const d = Math.min(320, Math.max(26, dp * 0.5 + ds * 0.14))
  const ctrl = (p, s) => ({ r: [p[0] + d, p[1]], l: [p[0] - d, p[1]], b: [p[0], p[1] + d], t: [p[0], p[1] - d] })[s]
  return [p0, ctrl(p0, s0), ctrl(p3, s3), p3]
}
function pt([[x0, y0], [x1, y1], [x2, y2], [x3, y3]], t) {
  const m = 1 - t
  return [m ** 3 * x0 + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t ** 3 * x3, m ** 3 * y0 + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t ** 3 * y3]
}
const bezLen = (bz) => { let l = 0, p = bz[0]; for (let i = 1; i <= 32; i++) { const q = pt(bz, i / 32); l += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q } return l }
// A way through several points with every corner turned into a wide arc.
function smooth(pts, r) {
  let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const [p, c, q] = [pts[i - 1], pts[i], pts[i + 1]]
    const l1 = Math.hypot(c[0] - p[0], c[1] - p[1]), l2 = Math.hypot(q[0] - c[0], q[1] - c[1])
    const k = Math.min(r, l1 / 2, l2 / 2), m = 0.552
    const a = [c[0] + ((p[0] - c[0]) * k) / l1, c[1] + ((p[1] - c[1]) * k) / l1]
    const b = [c[0] + ((q[0] - c[0]) * k) / l2, c[1] + ((q[1] - c[1]) * k) / l2]
    d += ` L${f1(a[0])},${f1(a[1])} C${f1(a[0] + (c[0] - a[0]) * m)},${f1(a[1] + (c[1] - a[1]) * m)} ${f1(b[0] + (c[0] - b[0]) * m)},${f1(b[1] + (c[1] - b[1]) * m)} ${f1(b[0])},${f1(b[1])}`
  }
  const z = pts[pts.length - 1]
  return d + ` L${f1(z[0])},${f1(z[1])}`
}
// Routes drawn round the map, for loops and long returns. Each gives its way and where its label sits.
const CUSTOM = {
  'read-vision': (a, b) => { // up between the finalizers and the film, along under the control plane, into the vision bus
    const x0 = N['p-final'].x + N['p-final'].w + (N['p-film'].x - right(N['p-final'])) / 2, y = bottom(b) + 46
    return [smooth([[a.x, cy(a)], [x0, cy(a)], [x0, y], [right(b) + 50, y], [right(b) + 50, cy(b) - 5], [right(b) + 2, cy(b) - 5]], 34), [(x0 + right(b)) / 2 + 40, y]]
  },
  'depth-vision': (a, b) => { // up between the stack and the master FX
    const x0 = right(N['p-stack']) + (N['p-master'].x - right(N['p-stack'])) / 2, y = bottom(b) + 56
    return [smooth([[a.x + 16, a.y], [a.x + 16, a.y - 30], [x0, a.y - 44], [x0, y], [right(b) + 62, y], [right(b) + 62, cy(b) + 6], [right(b) + 2, cy(b) + 6]], 30), [x0 - 70, y]]
  },
  'depth-nodes': (a, b) => { // back under the spine, into the layer FX from below
    const x0 = a.x, y0 = cy(a) + 4, x3 = cx(b), y3 = bottom(b) + 2
    return [`M${f1(x0)},${f1(y0)} C${f1(x0 - 190)},${f1(y0 + 10)} ${f1(x3)},${f1(y3 + 120)} ${f1(x3)},${f1(y3)}`, [x0 - 120, y0 + 20]]
  },
  'self-loop': (a) => { // a small ring over the loop
    const { x, y, w } = a
    return [`M${f1(x + w * 0.3)},${y} C${f1(x + w * 0.2)},${y - 40} ${f1(x + w * 0.8)},${y - 40} ${f1(x + w * 0.7)},${y - 2}`, [x + w / 2, y - 34]]
  },
  sidechain: (a, b) => { // under the two lanes, back to source B
    const x0 = a.x + a.w * 0.3, y = bottom(b) + 30, x3 = b.x + b.w * 0.7
    return [smooth([[x0, bottom(a)], [x0, y], [x3, y], [x3, bottom(b) + 2]], 24), [(x0 + x3) / 2, y]]
  },
  'osc-echo': (a, b) => { // over the top, right to left, into OSC in from the left
    const x0 = a.x + 30
    return [smooth([[x0, a.y], [x0, 40], [56, 40], [56, cy(b)], [b.x - 2, cy(b)]], 60), [900, 40]]
  },
  'df-echo': (a, b) => [smooth([[right(a), cy(a)], [W - 8, cy(a)], [W - 8, 24], [40, 24], [40, cy(b)], [b.x - 2, cy(b)]], 60), [900, 24]],
  'mcp-snap': (a, b) => [smooth([[cx(a), bottom(a)], [cx(a), H - 20], [36, H - 20], [36, cy(b)], [b.x - 2, cy(b)]], 150), [700, H - 20]],
  'sound-back': (a, b) => [smooth([[right(a), cy(a)], [W - 8, cy(a)], [W - 8, H - 34], [50, H - 34], [50, cy(b)], [b.x - 2, cy(b)]], 150), [900, H - 34]],
  'camera-back': (a, b) => [smooth([[right(a), cy(a)], [W - 20, cy(a)], [W - 20, H - 48], [64, H - 48], [64, cy(b)], [b.x - 2, cy(b)]], 150), [900, H - 48]],
  'sound-under': (a, b, e) => { // the long ways of sound to the speakers, side by side under the picture path
    const k = E.filter((x) => x.path === 'sound-under').indexOf(e), x0 = right(a) + 16 + k * 6, x3 = b.x - 22 - k * 6, y = PB.y + PB.h + 14 + k * 7
    return [smooth([[right(a) + 2, cy(a)], [x0, cy(a)], [x0, y], [x3, y], [x3, cy(b)], [b.x - 2, cy(b)]], 40), [520 + k * 240, y]]
  }
}

// ── 6. The SVG ──────────────────────────────────────────────────────────────
const TYPES = ['net', 'ctl', 'pic', 'snd', 'loop', 'phys']
const COLOR = Object.fromEntries(TYPES.map((k) => [k, `rgb(var(--f-${k}))`]))
// stroke width by what a link carries : the picture's spine widest, sound medium, control fine
const WIDTH = { pic: 2.8, snd: 1.9, ctl: 1.2, net: 1.1, loop: 1.7, phys: 1.7 }
const SPINE_W = 6
const DASH = { loop: '7 6', phys: '0.1 6' }
// light drifting along the picture's way : a soft wave of light leaves the sources every
// PERIOD seconds and travels the spine at SPEED units a second, lighting each block and link
// as it passes (off under prefers-reduced-motion)
const SPEED = 90, PERIOD = 30, PEAK = 0.05
const waveDelay = (s) => ((((s / SPEED - PEAK * PERIOD) % PERIOD) + PERIOD) % PERIOD - PERIOD).toFixed(2) + 's'
const paths = [], labels = [], drifts = []
const reach = new Map([...SPINE].filter((id) => before(id) === 1).map((id) => [id, 0]))
E.map((e, i) => [e, i]).sort(([p], [q]) => (SPINE.has(p.a) ? before(p.a) : 99) - (SPINE.has(q.a) ? before(q.a) : 99)).forEach(([e, i]) => {
  let d, lp, bz = null
  if (e.path) {
    if (!CUSTOM[e.path]) throw new Error(`edge ${e.a} → ${e.b} : unknown path ${e.path}`)
    ;[d, lp] = CUSTOM[e.path](N[e.a], N[e.b], e)
  } else {
    const p0 = anchor(N[e.a], e.sa, kpos(e.a, e.sa, e))
    const p3 = anchor(N[e.b], e.sb, kpos(e.b, e.sb, e))
    const g = e.spine ? -1 : 2 // the spine runs into its blocks; other links stop at their arrow
    const end = [p3[0] + (e.sb === 'l' ? -g : e.sb === 'r' ? g : 0), p3[1] + (e.sb === 't' ? -g : e.sb === 'b' ? g : 0)]
    bz = bez(p0, end, e.sa, e.sb)
    d = `M${f1(bz[0][0])},${f1(bz[0][1])} C${f1(bz[1][0])},${f1(bz[1][1])} ${f1(bz[2][0])},${f1(bz[2][1])} ${f1(bz[3][0])},${f1(bz[3][1])}`
    lp = pt(bz, e.lt)
  }
  const w = e.spine ? SPINE_W : WIDTH[e.t]
  const dash = DASH[e.t] ? ` stroke-dasharray="${DASH[e.t]}"` : ''
  const cls = `e t-${e.t}${e.spine ? ' sp' : ''}${e.minor ? ' minor' : ''}`
  paths[i] = `<path class="${cls}" data-i="${i}" d="${d}" style="--w:${w}"${dash}${e.spine ? '' : ` marker-end="url(#m-${e.t})"`}><title>${esc(N[e.a].title)} → ${esc(N[e.b].title)}${e.label ? ' : ' + esc(e.label) : ''}</title></path>`
  if (e.label && lp) labels.push([i, `<text class="el${e.always ? ' always' : ''} t-${e.t}" data-i="${i}" x="${f1(lp[0])}" y="${f1(lp[1] - 6)}" text-anchor="middle">${esc(e.label)}</text>`])
  // the glint passes through each block of the spine and on to the picture's outputs
  if (bz && e.t === 'pic' && SPINE.has(e.a) && (SPINE.has(e.b) || N[e.b].kind === 'out') && reach.has(e.a)) {
    const start = reach.get(e.a) + N[e.a].w, len = bezLen(bz)
    if (SPINE.has(e.b)) reach.set(e.b, Math.max(reach.get(e.b) ?? 0, start + len))
    drifts.push(`<path d="${d}" style="stroke-width:${w};animation-delay:${waveDelay(start + len / 2)}"/>`)
  }
})
const nodes = Object.values(N).map((n) => {
  const z = SZ[n.size], my = n.y + n.h / 2, base = f1(my + z.fs * 0.35)
  const body = n.size === 'L'
    ? `<rect class="nt-tint" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${z.rx}"/>${reach.has(n.id) ? `<rect class="glow" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${z.rx}" style="animation-delay:${waveDelay(reach.get(n.id) + n.w / 2)}"/>` : ''}<text class="nt" x="${f1(n.x + n.w / 2)}" y="${base}" text-anchor="middle">${esc(n.title)}</text>`
    : `<circle class="kd" cx="${n.x + (n.size === 'S' ? 8.5 : 13)}" cy="${my}" r="${n.size === 'S' ? 2.6 : 3.3}"/><text class="nt" x="${n.x + z.pl}" y="${base}">${esc(n.title)}</text>`
  return `<g class="n s-${n.size} k-${n.kind}" data-id="${n.id}" tabindex="0" role="button" aria-label="${esc(n.title)}: ${esc(n.sub)}"><rect class="nb" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="${z.rx}"/>${body}</g>`
})
const MK = { pic: 10, snd: 9, ctl: 8, net: 8, loop: 8.5, phys: 8.5 }
const markers = TYPES.map((k) => `<marker id="m-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="${MK[k]}" markerHeight="${MK[k]}" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M1,1 L9.4,5 L1,9 Q3,5 1,1 z" fill="${COLOR[k]}"/></marker>`).join('')
const rect = (c, b, rx) => `<rect class="${c}" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${rx}"/>`
const bands = `${rect('band', CB, 28)}
<text class="bl" x="${CB.x + 14}" y="${CB.y - 9}">Control plane · on the CPU, every frame, before the picture is drawn</text>
${rect('band', PB, 28)}
<text class="bl" x="${PB.x + 14}" y="${PB.y + PB.h - 12}">Picture path · on the GPU, every frame</text>
${rect('grp', LG, 22)}
<text class="gl" x="${LG.x + LG.w - 14}" y="${LG.y + LG.h - 10}" text-anchor="end">× 4 layers</text>
<text class="bl" x="${IX}" y="${CB.y - 9}" text-anchor="end">In</text>
<text class="bl" x="${OX}" y="${CB.y - 9}">Out</text>`
const SVG = `<svg id="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Palinopsia's signal flow: external inputs on the left feed the store, buses and modulators of the control plane; every frame the control plane overlays its values on the GPU picture path, drawn as a thick spine from the sources to the presentation; the picture leaves on the right to projectors, streams, HIVE, recordings, Sonify and lights, and is read back into the vision bus and depth, closing feedback loops; dotted lines close only through the room, the network or an agent.">
<defs>${markers}</defs>
${bands}
<g class="edges">${paths.join('')}</g>
<g class="drifts t-pic" aria-hidden="true">${drifts.join('')}</g>
<g class="nodes">${nodes.join('')}</g>
<g class="labels">${labels.sort(([p], [q]) => p - q).map(([, s]) => s).join('')}</g>
</svg>`
const DATA = JSON.stringify({
  nodes: Object.fromEntries(Object.values(N).map((n) => [n.id, { title: n.title, sub: n.sub, kind: n.kind, desc: n.desc, refs: n.refs }])),
  edges: E.map((e) => ({ a: e.a, b: e.b, t: e.t, label: e.label }))
}).replace(/</g, '\\u003c')

// ── 7. The page ─────────────────────────────────────────────────────────────
const LOOP_ST = { inside: ['in', 'inside'], room: ['ph', 'through the room'], network: ['ph', 'through the network'], agent: ['ph', 'through the agent'], 'not wired': ['no', 'not wired'] }
const phases = TEXT.phases.map((p) => `<div class="phase" style="--strip: rgb(var(--f-${p.flow}))"><span class="label">${p.title}</span><ol>${p.items.map((li) => `<li>${li}</li>`).join('')}</ol></div>`).join('\n    ')
const loops = TEXT.loops.map((r) => `<tr><td>${r.name}</td><td class="path">${r.path}</td><td><span class="st ${LOOP_ST[r.st][0]}">${LOOP_ST[r.st][1]}</span></td></tr>`).join('\n      ')
const minorCount = E.filter((e) => e.minor).length

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Palinopsia Signal Flow</title>
<meta name="description" content="How a signal moves through Palinopsia, and how it comes back: every input, the control plane, the picture path, the sound's paths, every output and every feedback loop, drawn from the code.">
<meta property="og:title" content="Palinopsia Signal Flow">
<meta property="og:description" content="Every input, the control plane, the picture path, the sound's paths, every output and every feedback loop of Palinopsia, drawn from the code.">
<meta name="theme-color" content="rgb(${trip(THEMES.studio.panel)})">
<meta name="generator" content="scripts/signal-flow/build.mjs : do not edit by hand, run npm run signal-flow">
<style>
/* Palinopsia's own UI fonts and themes (--c-* as RGB triples, --font-app per theme), read
   from the app's styles.css, plus the map's six flow colours per theme (--f-*). Studio,
   the app's default, unless a theme is picked. */
${FONT_CSS}
${THEME_CSS}
:root { --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
* { box-sizing: border-box }
html, body { margin: 0; background: rgb(var(--c-bg)); color: rgb(var(--c-text)) }
body { font: 13px/1.5 var(--font-app); font-feature-settings: 'ss01', 'cv11'; -webkit-text-size-adjust: 100% }
a { color: rgb(var(--c-accent)); text-decoration: none }
a:hover { text-decoration: underline }
button, select { font: inherit; color: inherit }
::-webkit-scrollbar { width: 10px; height: 10px }
::-webkit-scrollbar-thumb { background: rgb(var(--c-panel3)); border-radius: 2px }
::-webkit-scrollbar-track { background: transparent }

/* the app's parts */
.label { font: 500 10px/1.2 var(--mono); text-transform: uppercase; letter-spacing: .06em; color: rgb(var(--c-muted)) }
.btn { display: inline-flex; align-items: center; gap: 8px; padding: 4px 8px; border-radius: 2px; border: 1px solid rgb(var(--c-border)); background: rgb(var(--c-panel2)); color: rgb(var(--c-text)); font-size: 12px; white-space: nowrap; cursor: pointer }
.btn:hover { background: rgb(var(--c-panel3)); text-decoration: none }
.btn[aria-pressed="false"] { opacity: .4 }
.btn[aria-pressed="false"] svg { filter: grayscale(1) }
.input { background: rgb(var(--c-input-bg)); border: 1px solid rgb(var(--c-border)); border-radius: 2px; padding: 4px 22px 4px 8px; font-size: 12px; outline: none; box-shadow: var(--input-inset, none) }
.input:focus { border-color: rgb(var(--c-accent)) }
select.input { appearance: none; -webkit-appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath fill='none' stroke='%23888' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' d='M1 1l4 4 4-4'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 7px center; background-size: 8px 5px; cursor: pointer }
.chip { display: inline-flex; align-items: center; gap: 4px; font: 500 10px/1.2 var(--mono); text-transform: uppercase; letter-spacing: .06em; padding: 3px 6px; border-radius: 2px; background: rgb(var(--c-input-bg)); border: 1px solid rgb(var(--c-border)); color: rgb(var(--c-muted)) }
:focus-visible { outline: 2px solid rgb(var(--c-accent)); outline-offset: 2px }

/* top bar, as in the app */
.topbar { background: rgb(var(--c-panel)); border-bottom: 1px solid rgb(var(--c-border)) }
.tb-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 8px max(16px, env(safe-area-inset-right, 0px)) 8px max(16px, env(safe-area-inset-left, 0px)); max-width: 1760px; margin: 0 auto }
.wordmark { margin: 0; font: 600 15px/1 var(--mono); text-transform: uppercase; letter-spacing: .2em; text-shadow: .5px 0 rgb(var(--c-accent) / .5), -.5px 0 rgb(var(--c-accent2) / .5); user-select: none }
.wordmark a { color: inherit }
.wordmark a:hover { text-decoration: none }
.tb-row .grow { flex: 1 }
.tb-row label { display: inline-flex; align-items: center; gap: 6px }

.wrap { padding: 18px max(16px, env(safe-area-inset-right, 0px)) 48px max(16px, env(safe-area-inset-left, 0px)); max-width: 1760px; margin: 0 auto; display: grid; gap: 22px }
.intro { display: grid; gap: 10px; max-width: 980px }
.intro h2 { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: -.005em; text-wrap: balance }
.intro p { margin: 0; color: rgb(var(--c-muted)); max-width: 80ch }
.legend { display: flex; flex-wrap: wrap; gap: 6px; align-items: center }
.legend svg { width: 26px; height: 8px; overflow: visible }

.stage { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start }
/* the detail rail sits beside the map from 1440 px (narrowing to 260 px on a mid-size
   window, so the map keeps about 70 % of its 1720 or more); narrower, it goes under the map,
   which then takes the whole width */
@media (min-width: 1440px) { .stage { grid-template-columns: minmax(0, 1fr) clamp(260px, 18vw, 320px) } }
figure { margin: 0; min-width: 0 }
.scroller { overflow-x: auto; border: 1px solid rgb(var(--c-border) / .6); border-radius: 14px; background: rgb(var(--c-bg)) }
/* the map scales to its column (no horizontal scroll on a desktop); a phone keeps a floor
   and scrolls sideways */
#map { display: block; width: 100%; height: auto; font-family: var(--font-app) }
@media (max-width: 899px) { #map { min-width: 1000px } }
figcaption { color: rgb(var(--c-muted)); font-size: 12px; margin-top: 8px; max-width: 100ch }

/* the map : soft bands, three sizes of block, links weighted by what they carry */
#map { --map-font: '${MAP_FONT}', var(--font-app) }
.band { fill: rgb(var(--c-panel) / .45); stroke: rgb(var(--c-border) / .5); stroke-width: 1 }
.grp { fill: rgb(var(--f-pic) / .04); stroke: rgb(var(--f-pic) / .38); stroke-dasharray: 1 6; stroke-linecap: round; stroke-width: 1.4 }
.gl { fill: rgb(var(--f-pic)); font: 500 13px var(--map-font) }
.bl { fill: rgb(var(--c-muted)); font: 500 14px var(--map-font) }
.n { cursor: pointer; outline: none }
.n .nb { fill: rgb(var(--c-panel2)); stroke: rgb(var(--c-border) / .75); stroke-width: 1 }
.n:hover .nb { fill: rgb(var(--c-panel3)) }
.n .nt { fill: rgb(var(--c-text)); font: 500 14.5px var(--map-font) }
.s-L .nb { fill: rgb(var(--c-bg)); stroke: rgb(var(--f-pic) / .75); stroke-width: 1.5 }
.s-L .nt-tint { fill: rgb(var(--f-pic) / .16); pointer-events: none }
.s-L:hover .nb { fill: rgb(var(--c-panel2)) }
.s-L .nt { font: 600 16px var(--map-font) }
.s-S .nb { fill: rgb(var(--c-bg) / .6); stroke: none }
.s-S .nt { fill: rgb(var(--c-text) / .8); font: 500 13px var(--map-font) }
.s-S:hover .nb { fill: rgb(var(--c-panel2)); stroke: rgb(var(--c-border)) }
.kd { fill: rgb(var(--f-net)) }
.k-ctl .kd { fill: rgb(var(--f-ctl)) }
.k-bus .kd { fill: none; stroke: rgb(var(--f-ctl)); stroke-width: 1.5 }
.k-pic .kd { fill: rgb(var(--f-pic)) }
.n:focus-visible .nb { stroke: rgb(var(--c-accent)); stroke-width: 2 }
.e { fill: none; stroke-width: var(--w); stroke-linecap: round; stroke-linejoin: round; opacity: .5; transition: opacity .2s }
${TYPES.map((k) => `.e.t-${k} { stroke: rgb(var(--f-${k})) }`).join(' ')}
.e.t-net { opacity: .42 }
.e.t-snd { opacity: .62 }
.e.t-pic, .e.t-loop { opacity: .78 }
.e.t-phys { opacity: .72 }
.e.sp { opacity: .92 }
.e.minor { opacity: .14 }
.drifts path { fill: none; stroke: rgb(var(--c-text)); stroke-linecap: round; opacity: 0; animation: wave ${PERIOD}s ease-in-out infinite; pointer-events: none }
.glow { fill: rgb(var(--f-pic)); opacity: 0; animation: glow ${PERIOD}s ease-in-out infinite; pointer-events: none }
@keyframes wave { 0% { opacity: 0 } ${PEAK * 100}% { opacity: .42 } ${PEAK * 300}% { opacity: 0 } 100% { opacity: 0 } }
@keyframes glow { 0% { opacity: 0 } ${PEAK * 100}% { opacity: .3 } ${PEAK * 300}% { opacity: 0 } 100% { opacity: 0 } }
.el { font: 400 12.5px var(--map-font); paint-order: stroke; stroke: rgb(var(--c-bg)); stroke-width: 4px; stroke-linejoin: round; opacity: 0; transition: opacity .2s; pointer-events: none }
.el.always { opacity: .95 }
${TYPES.map((k) => `.el.t-${k} { fill: rgb(var(--f-${k})) }`).join(' ')}
#map.focus .e { opacity: .06 }
#map.focus .e.on { opacity: 1; stroke-width: calc(var(--w) + .8) }
#map.focus .drifts, #map.focus .glow, #map .t-pic.off ~ .nodes .glow { visibility: hidden }
#map.focus .n { opacity: .32 }
#map.focus .n.on { opacity: 1 }
#map.focus .n.sel .nb { stroke: rgb(var(--c-accent)); stroke-width: 2 }
#map.focus .s-S.sel .nb { fill: rgb(var(--c-panel2)) }
#map.focus .el { opacity: 0 }
#map.focus .el.on { opacity: 1 }
#map .off { display: none }

/* detail rail */
aside { background: rgb(var(--c-panel)); border: 1px solid rgb(var(--c-border)); border-radius: 2px; padding: 12px 14px 14px; display: grid; gap: 10px; min-width: 0 }
@media (min-width: 1440px) { aside { position: sticky; top: 12px } }
aside h3 { font-size: 15px; font-weight: 600; margin: 0 }
aside .sub { font-size: 12px; color: rgb(var(--c-muted)); margin-top: -6px }
aside .sub:empty { display: none }
aside p { margin: 0 }
aside ul { list-style: none; margin: 4px 0 0; padding: 0; display: grid; gap: 3px }
aside li { font-size: 12px; color: rgb(var(--c-muted)); display: flex; gap: 8px; align-items: baseline }
aside li b { color: rgb(var(--c-text)); font-weight: 500 }
.sw { display: inline-block; width: 10px; height: 2px; flex: none; transform: translateY(-3px) }
.refs { font: 11px/1.5 var(--mono); color: rgb(var(--c-muted)); overflow-wrap: anywhere; border-top: 1px solid rgb(var(--c-border)); padding-top: 8px }
.refs:empty { display: none }

/* frame order, loops */
section { display: grid; gap: 10px; min-width: 0 }
section h2 { font-size: 15px; font-weight: 600; margin: 0 }
section > p { color: rgb(var(--c-muted)); margin: 0; max-width: 84ch }
.frame { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 8px }
.phase { background: rgb(var(--c-panel)); border: 1px solid rgb(var(--c-border)); border-radius: 2px; padding: 10px 12px; min-width: 0; box-shadow: inset 0 2px 0 var(--strip) }
.phase .label { display: block; margin-bottom: 8px; color: var(--strip) }
.phase ol { margin: 0; padding-left: 20px; display: grid; gap: 5px; font-size: 12.5px }
.phase ol li::marker { font: 10px var(--mono); color: rgb(var(--c-muted)) }
.phase small, .phase code { color: rgb(var(--c-muted)); font: 10.5px var(--mono) }
.tablewrap { overflow-x: auto; border: 1px solid rgb(var(--c-border)); border-radius: 2px; background: rgb(var(--c-panel)) }
.loops { width: 100%; border-collapse: collapse; font-size: 12.5px; min-width: 780px }
.loops th, .loops td { text-align: left; padding: 8px 12px; border-bottom: 1px solid rgb(var(--c-border)); vertical-align: top }
.loops th { background: rgb(var(--c-panel2)) }
.loops tr:last-child td { border-bottom: 0 }
.loops td:first-child { font-weight: 600; white-space: nowrap }
.path { font: 11.5px/1.55 var(--mono); color: rgb(var(--c-muted)) }
.st { display: inline-block; font: 500 10px/1 var(--mono); text-transform: uppercase; letter-spacing: .06em; padding: 4px 6px; border-radius: 2px; white-space: nowrap; border: 1px solid currentColor }
.st.in { color: rgb(var(--f-loop)) }
.st.ph { color: rgb(var(--f-phys)) }
.st.no { color: rgb(var(--c-muted)) }
footer { color: rgb(var(--c-muted)); font: 11px/1.6 var(--mono); border-top: 1px solid rgb(var(--c-border)); padding-top: 12px; display: grid; gap: 4px }
@media (prefers-reduced-motion: reduce) { .e, .el { transition: none } .drifts, .glow { display: none } }
</style>
</head>
<body>
<header class="topbar"><div class="tb-row">
  <h1 class="wordmark"><a href="${SITE}" title="Back to the Palinopsia site">Palinopsia</a></h1>
  <span class="chip">Signal flow</span>
  <span class="label">drawn from the code</span>
  <span class="grow"></span>
  <a class="btn" href="${SITE}">← Site</a>
  <label class="label" for="theme">Theme <select id="theme" class="input" title="Theme : the app's own UI themes">${ORDER.map((t) => `<option value="${t}">${t}</option>`).join('')}</select></label>
</div></header>

<main class="wrap">
<div class="intro">
  <h2>How a signal moves through Palinopsia, and how it comes back</h2>
  <p>${TEXT.lede}</p>
  <div class="legend" role="group" aria-label="Show or hide each kind of flow">
    <span class="label">Flows</span>
${[['pic', 'picture', 4, ''], ['ctl', 'control · modulation', 1.6, ''], ['snd', 'sound', 2.4, ''], ['net', 'in · out of the app', 1.6, ''], ['loop', 'feedback inside', 2, ' stroke-dasharray="5 4"'], ['phys', 'loops through the room', 2.4, ' stroke-dasharray="0.1 5"']]
  .map(([k, l, w, d]) => `    <button class="btn" data-t="${k}" aria-pressed="true"><svg aria-hidden="true"><line x1="2" y1="4" x2="24" y2="4" stroke="rgb(var(--f-${k}))" stroke-width="${w}" stroke-linecap="round"${d}/></svg>${l}</button>`).join('\n')}
  </div>
</div>

<div class="stage">
  <figure>
    <div class="scroller">
${SVG}
    </div>
    <figcaption>${TEXT.caption}</figcaption>
  </figure>
  <aside id="detail" aria-live="polite">
    <span class="label" id="d-kind">How to read it</span>
    <h3 id="d-title">Pick a block</h3>
    <p id="d-sub" class="sub"></p>
    <p id="d-desc">Hover, tap or tab to any block: its connections light up here and on the map, with what flows along each one. Tap the empty map to see everything again.</p>
    <div id="d-in"></div>
    <div id="d-out"></div>
    <div class="refs" id="d-refs"></div>
  </aside>
</div>

<section>
  <h2>Reading the map</h2>
  <p>${TEXT.intro}</p>
  <p>The thick line is the spine, the path the picture really takes; the small labels are bookkeeping. Secondary links are drawn faint until you pick a block: all ${E.length} links are on the map, ${minorCount} of them secondary.</p>
</section>

<section>
  <h2>One frame, in order</h2>
  <p>${TEXT.frame_lede}</p>
  <div class="frame">
    ${phases}
  </div>
</section>

<section>
  <h2>Where the loops close</h2>
  <p>Palinopsia is a feedback instrument: its output comes back in through several paths. Some close inside the app, some only through the room, the network or an agent.</p>
  <div class="tablewrap"><table class="loops">
    <thead><tr><th class="label">Loop</th><th class="label">Path</th><th class="label">Closes</th></tr></thead>
    <tbody>
      ${loops}
    </tbody>
  </table></div>
</section>

<footer>
  <span>Palinopsia is free software under the GPL-3.0-or-later · <a href="https://github.com/filliformes/palinopsia">source</a> · <a href="${SITE}">site</a> · <a href="${SUPPORT_URL}">Donate</a> to keep it going and free.</span>
</footer>
</main>

<script>
const DATA = ${DATA};
const map = document.getElementById('map');
const COL = ${JSON.stringify(COLOR)};
const KIND = { in: 'Input', ctl: 'Control plane', bus: 'Bus', pic: 'Picture path', out: 'Output' };
const hidden = new Set();
let sel = null;
const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
function list(title, items) {
  if (!items.length) return '';
  return '<span class="label">' + title + '</span><ul>' + items.map(([e, other]) =>
    '<li><span class="sw" style="background:' + COL[e.t] + '"></span><span><b>' + esc(DATA.nodes[other].title) + '</b>' + (e.label ? ' · ' + esc(e.label) : '') + '</span></li>').join('') + '</ul>';
}
function show(id) {
  sel = id;
  const n = DATA.nodes[id];
  map.classList.add('focus');
  map.querySelectorAll('.n').forEach((g) => { const on = g.dataset.id === id; g.classList.toggle('on', on); g.classList.toggle('sel', on) });
  const ins = [], outs = [];
  map.querySelectorAll('.e').forEach((p) => {
    const e = DATA.edges[+p.dataset.i];
    const on = !hidden.has(e.t) && (e.a === id || e.b === id);
    p.classList.toggle('on', on);
    const lab = map.querySelector('.el[data-i="' + p.dataset.i + '"]');
    if (lab) lab.classList.toggle('on', on);
    if (on) {
      map.querySelector('.n[data-id="' + (e.a === id ? e.b : e.a) + '"]').classList.add('on');
      if (e.b === id && e.a !== id) ins.push([e, e.a]);
      if (e.a === id) outs.push([e, e.b]);
    }
  });
  document.getElementById('d-kind').textContent = KIND[n.kind];
  document.getElementById('d-title').textContent = n.title;
  document.getElementById('d-sub').textContent = n.sub;
  document.getElementById('d-desc').textContent = n.desc;
  document.getElementById('d-in').innerHTML = list('Receives', ins);
  document.getElementById('d-out').innerHTML = list('Sends', outs);
  document.getElementById('d-refs').textContent = n.refs ? 'Code · ' + n.refs : '';
}
function clear() {
  sel = null;
  map.classList.remove('focus');
  map.querySelectorAll('.on,.sel').forEach((x) => x.classList.remove('on', 'sel'));
}
map.querySelectorAll('.n').forEach((g) => {
  g.addEventListener('mouseenter', () => show(g.dataset.id));
  g.addEventListener('focus', () => show(g.dataset.id));
  g.addEventListener('click', (ev) => { ev.stopPropagation(); show(g.dataset.id) });
  g.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); show(g.dataset.id) } });
});
map.addEventListener('mouseleave', () => { if (window.matchMedia('(hover: hover)').matches) clear() });
map.addEventListener('click', (ev) => { if (!ev.target.closest('.n')) clear() });
document.querySelectorAll('.legend .btn').forEach((c) => c.addEventListener('click', () => {
  const t = c.dataset.t, on = c.getAttribute('aria-pressed') === 'true';
  c.setAttribute('aria-pressed', String(!on));
  if (on) hidden.add(t); else hidden.delete(t);
  map.querySelectorAll('.t-' + t).forEach((el) => el.classList.toggle('off', on));
  if (sel) show(sel);
}));
// Theme : the app's own list, Studio first; remembered on this browser only.
const pickT = document.getElementById('theme');
const applyT = (t) => { document.documentElement.dataset.theme = t };
try { const saved = localStorage.getItem('opsia-flow-theme'); if (saved && pickT.querySelector('option[value="' + saved + '"]')) { pickT.value = saved; applyT(saved) } } catch (e) {}
pickT.addEventListener('change', () => { applyT(pickT.value); try { localStorage.setItem('opsia-flow-theme', pickT.value) } catch (e) {} });
</script>
</body>
</html>
`

// ── 8. Write (or check) ─────────────────────────────────────────────────────
const FAM_LICENSE = FONT_FILES.map((f) => {
  const fl = read('licenses/fonts.txt').replace(/\r\n/g, '\n')
  const i = fl.indexOf(`${f} :`)
  if (i < 0) throw new Error(`${f} is not in licenses/fonts.txt`)
  return fl.slice(i).split('\n\n')[0]
}).join('\n\n')
const LICENSES = `Fonts served by this page (signal-flow.html), the same files the Palinopsia app ships
(src/renderer/src/fonts). Copied here by scripts/signal-flow/build.mjs.

${FAM_LICENSE}

------------------------------------------------------------------------------
${read('licenses/OFL-1.1.txt').replace(/\r\n/g, '\n').trim()}
`
const want = [[OUT, page], ['docs/fonts/LICENSES.txt', LICENSES]]
if (CHECK) {
  const stale = want.filter(([p, s]) => !fs.existsSync(path.join(ROOT, p)) || read(p).replace(/\r\n/g, '\n') !== s).map(([p]) => p)
  for (const f of FONT_FILES) if (!fs.existsSync(path.join(ROOT, 'docs/fonts', f))) stale.push('docs/fonts/' + f)
  if (stale.length) { console.error(`signal-flow : stale, run npm run signal-flow and commit :\n  ${stale.join('\n  ')}`); process.exit(1) }
  console.log('signal-flow ok')
} else {
  fs.mkdirSync(path.join(ROOT, 'docs/fonts'), { recursive: true })
  for (const f of FONT_FILES) fs.copyFileSync(path.join(ROOT, 'src/renderer/src/fonts', f), path.join(ROOT, 'docs/fonts', f))
  for (const [p, s] of want) fs.writeFileSync(path.join(ROOT, p), s)
  console.log(`wrote ${OUT} (${Object.keys(N).length} blocks, ${E.length} links, ${ORDER.length} themes) and docs/fonts/ (${FONT_FILES.length} files)`)
}
