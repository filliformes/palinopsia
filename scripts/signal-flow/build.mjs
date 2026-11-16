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
import { N, E, W, H, IX, OX, TEXT, AUDITED } from './graph.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')
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

// ── 4. Geometry ─────────────────────────────────────────────────────────────
const anchor = (n, side, k = 0.5) => ({ l: [n.x, n.y + n.h * k], r: [n.x + n.w, n.y + n.h * k], t: [n.x + n.w * k, n.y], b: [n.x + n.w * k, n.y + n.h] })[side]
function planSides(e) {
  const a = N[e.a], b = N[e.b]
  if (b.x >= a.x + a.w - 2) return ['r', 'l']
  if (b.x + b.w <= a.x + 2) return ['l', 'r']
  return b.y > a.y ? ['b', 't'] : ['t', 'b']
}
// Several links on one side of a block spread along it, ordered by where their other end is.
const sides = new Map()
for (const e of E) {
  if (e.path) continue
  ;[e.sa, e.sb] = planSides(e)
  for (const [id, s] of [[e.a, e.sa], [e.b, e.sb]]) { const k = id + '|' + s; if (!sides.has(k)) sides.set(k, []); sides.get(k).push(e) }
}
function kpos(id, side, e) {
  const other = (x) => { const o = N[x.a === id ? x.b : x.a]; return 'lr'.includes(side) ? o.y + o.h / 2 : o.x + o.w / 2 }
  const lst = [...sides.get(id + '|' + side)].sort((p, q) => other(p) - other(q))
  return lst.length === 1 ? 0.5 : 0.18 + (0.64 * lst.indexOf(e)) / (lst.length - 1)
}
function bez(p0, p3, s0, s3) {
  const d = Math.max(40, Math.abs('lr'.includes(s0) ? p3[0] - p0[0] : p3[1] - p0[1]) * 0.5)
  const ctrl = (p, s) => ({ r: [p[0] + d, p[1]], l: [p[0] - d, p[1]], b: [p[0], p[1] + d], t: [p[0], p[1] - d] })[s]
  return [p0, ctrl(p0, s0), ctrl(p3, s3), p3]
}
function pt([[x0, y0], [x1, y1], [x2, y2], [x3, y3]], t) {
  const m = 1 - t
  return [m ** 3 * x0 + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t ** 3 * x3, m ** 3 * y0 + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t ** 3 * y3]
}
// Routes drawn round the map, for loops and long returns.
const CUSTOM = {
  'read-vision': (a, b) => { // up the gap right of the bands, along the top of the control band, into the vision bus
    const x0 = a.x + a.w * 0.8, y0 = a.y, yb = b.y + b.h * 0.35
    return [`M${x0},${y0} L${x0},${y0 - 14} L1456,${y0 - 14} L1456,82 L760,82 L760,${yb} L${b.x + b.w + 4},${yb}`, [1110, 82]]
  },
  'depth-vision': (a, b) => {
    const x0 = a.x, y0 = a.y + a.h / 2, yb = b.y + b.h * 0.8
    return [`M${x0},${y0} C900,${y0} 760,1000 760,560 L760,${yb} L${b.x + b.w + 4},${yb}`, [800, 980]]
  },
  'depth-nodes': (a, b) => {
    const x0 = a.x, y0 = a.y + a.h * 0.7, x3 = b.x + b.w / 2, y3 = b.y + b.h
    return [`M${x0},${y0} C${x0 - 160},${y0} ${x3},${y3 + 140} ${x3},${y3 + 4}`, [830, 905]]
  },
  'self-loop': (a) => {
    const { x, y, w, h } = a
    return [`M${x + w * 0.75},${y + h} C${x + w * 0.75},${y + h + 46} ${x + w * 0.25},${y + h + 46} ${x + w * 0.25},${y + h + 4}`, [x + w / 2, y + h + 50]]
  },
  sidechain: (a, b) => {
    const x0 = a.x + a.w * 0.5, y0 = a.y, x3 = b.x + b.w * 0.5, y3 = b.y + b.h
    return [`M${x0},${y0} C${x0},${y0 - 40} ${x0 - 60},${y0 - 40} 640,${y0 - 40} L470,${y0 - 40} C380,${y0 - 40} 360,${y3 + 70} ${x3},${y3 + 4}`, [660, y0 - 40]]
  },
  'osc-echo': (a, b) => { // top margin, right to left, into OSC in's left side
    const x0 = a.x + a.w * 0.5, y0 = a.y, y3 = b.y + b.h * 0.3
    return [`M${x0},${y0} L${x0},40 L12,40 L12,${y3} L${b.x - 4},${y3}`, [900, 40]]
  },
  'df-echo': (a, b) => {
    const x0 = a.x + a.w, y0 = a.y + a.h / 2, y3 = b.y + b.h / 2
    return [`M${x0},${y0} L1704,${y0} L1704,54 L20,54 L20,${y3} L${b.x - 4},${y3}`, [900, 54]]
  },
  'mcp-snap': (a, b) => {
    const x0 = a.x + a.w * 0.5, y0 = a.y + a.h, y3 = b.y + b.h / 2
    return [`M${x0},${y0} L${x0},1032 L16,1032 L16,${y3} L${b.x - 4},${y3}`, [700, 1032]]
  },
  'sound-back': (a, b) => {
    const x0 = a.x + a.w, y0 = a.y + a.h * 0.5, y3 = b.y + b.h / 2
    return [`M${x0},${y0} L1708,${y0} L1708,1058 L8,1058 L8,${y3} L${b.x - 4},${y3}`, [900, 1058]]
  },
  'camera-back': (a, b) => {
    const x0 = a.x + a.w, y0 = a.y + a.h * 0.3, y3 = b.y + b.h * 0.3
    return [`M${x0},${y0} L1714,${y0} L1714,1084 L3,1084 L3,${y3} L${b.x - 4},${y3}`, [900, 1084]]
  }
}

// ── 5. The SVG ──────────────────────────────────────────────────────────────
const TYPES = ['net', 'ctl', 'pic', 'snd', 'loop', 'phys']
const COLOR = Object.fromEntries(TYPES.map((k) => [k, `rgb(var(--f-${k}))`]))
const DASH = { loop: '6 5', phys: '2 5' }
const paths = [], labels = []
E.forEach((e, i) => {
  let d, lp
  if (e.path) {
    if (!CUSTOM[e.path]) throw new Error(`edge ${e.a} → ${e.b} : unknown path ${e.path}`)
    ;[d, lp] = CUSTOM[e.path](N[e.a], N[e.b])
  } else {
    const p0 = anchor(N[e.a], e.sa, kpos(e.a, e.sa, e))
    const p3 = anchor(N[e.b], e.sb, kpos(e.b, e.sb, e))
    const end = [p3[0] - (e.sb === 'l' ? 4 : e.sb === 'r' ? -4 : 0), p3[1] - (e.sb === 't' ? 4 : 0)]
    const bz = bez(p0, end, e.sa, e.sb)
    d = `M${f1(bz[0][0])},${f1(bz[0][1])} C${f1(bz[1][0])},${f1(bz[1][1])} ${f1(bz[2][0])},${f1(bz[2][1])} ${f1(bz[3][0])},${f1(bz[3][1])}`
    lp = pt(bz, e.lt)
  }
  const dash = DASH[e.t] ? ` stroke-dasharray="${DASH[e.t]}"` : ''
  paths.push(`<path class="e t-${e.t}${e.minor ? ' minor' : ''}" data-i="${i}" d="${d}" fill="none" stroke="${COLOR[e.t]}" stroke-width="${e.t === 'pic' ? 1.6 : 1.3}"${dash} marker-end="url(#m-${e.t})"><title>${esc(N[e.a].title)} → ${esc(N[e.b].title)}${e.label ? ' : ' + esc(e.label) : ''}</title></path>`)
  if (e.label && lp) labels.push(`<text class="el${e.always ? ' always' : ''} t-${e.t}" data-i="${i}" x="${f1(lp[0])}" y="${f1(lp[1] - 4)}" text-anchor="middle">${esc(e.label)}</text>`)
})
const nodes = Object.values(N).map((n) => {
  const tx = n.x + 12
  const t = [`<text class="nt" x="${tx}" y="${n.y + 18}">${esc(n.title)}</text>`, ...n.sub.split('\n').map((l, j) => `<text class="ns" x="${tx}" y="${n.y + 33 + j * 13}">${esc(l)}</text>`)]
  return `<g class="n k-${n.kind}" data-id="${n.id}" tabindex="0" role="button" aria-label="${esc(n.title)}: ${esc(n.sub.replace(/\n/g, ' '))}"><rect class="nb" x="${n.x}" y="${n.y}" width="${n.w}" height="${n.h}" rx="2"/><rect class="ks" x="${n.x + 1}" y="${n.y + 1}" width="3" height="${n.h - 2}"/>${t.join('')}</g>`
})
const markers = TYPES.map((k) => `<marker id="m-${k}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="${COLOR[k]}"/></marker>`).join('')
const bands = `<rect class="band" x="282" y="74" width="1162" height="476" rx="2"/>
<text class="bl" x="294" y="68">Control plane · CPU, every frame, before the picture is drawn</text>
<rect class="band" x="282" y="600" width="1162" height="414" rx="2"/>
<text class="bl" x="294" y="594">Picture path · GPU, every frame</text>
<rect class="grp" x="290" y="612" width="676" height="138" rx="2"/>
<text class="gl" x="300" y="745">× 4 layers</text>
<text class="bl" x="${IX}" y="80">In</text>
<text class="bl" x="${OX}" y="80">Out</text>`
const SVG = `<svg id="map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Palinopsia's signal flow: external inputs on the left feed the store, buses and modulators of the control plane; every frame the control plane overlays its values on the GPU picture path; the picture leaves on the right to projectors, streams, HIVE, recordings, Sonify and lights, and is read back into the vision bus and depth, closing feedback loops; dotted lines close only through the room, the network or an agent.">
<defs>${markers}</defs>
${bands}
<g class="edges">${paths.join('')}</g>
<g class="nodes">${nodes.join('')}</g>
<g class="labels">${labels.join('')}</g>
</svg>`
const DATA = JSON.stringify({
  nodes: Object.fromEntries(Object.values(N).map((n) => [n.id, { title: n.title, kind: n.kind, desc: n.desc, refs: n.refs }])),
  edges: E.map((e) => ({ a: e.a, b: e.b, t: e.t, label: e.label }))
}).replace(/</g, '\\u003c')

// ── 6. The page ─────────────────────────────────────────────────────────────
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
.intro .note { font: 11px/1.4 var(--mono); color: rgb(var(--c-muted)) }
.legend { display: flex; flex-wrap: wrap; gap: 6px; align-items: center }
.legend svg { width: 26px; height: 8px; overflow: visible }

.stage { display: grid; grid-template-columns: minmax(0, 1fr); gap: 12px; align-items: start }
/* the detail rail sits beside the map only where both fit with the map still large (about
   1340 px of its 1720); narrower, it goes under the map, which then takes the whole width */
@media (min-width: 1700px) { .stage { grid-template-columns: minmax(0, 1fr) 320px } }
figure { margin: 0; min-width: 0 }
.scroller { overflow-x: auto; border: 1px solid rgb(var(--c-border)); border-radius: 2px; background: rgb(var(--c-bg)) }
/* the map scales to its column (no horizontal scroll on a desktop); a phone keeps a floor
   and scrolls sideways */
#map { display: block; width: 100%; height: auto; font-family: var(--font-app) }
@media (max-width: 899px) { #map { min-width: 900px } }
figcaption { color: rgb(var(--c-muted)); font-size: 12px; margin-top: 8px; max-width: 100ch }

/* the map */
.band { fill: rgb(var(--c-panel) / .55); stroke: rgb(var(--c-border)); stroke-width: 1 }
.grp { fill: none; stroke: rgb(var(--f-pic) / .5); stroke-dasharray: 2 4 }
.gl { fill: rgb(var(--f-pic)); font: 500 10px var(--mono); letter-spacing: .06em; text-transform: uppercase }
.bl { fill: rgb(var(--c-muted)); font: 500 10px var(--mono); letter-spacing: .06em; text-transform: uppercase }
.n { cursor: pointer; outline: none }
.n .nb { fill: rgb(var(--c-panel2)); stroke: rgb(var(--c-border)); stroke-width: 1 }
.n:hover .nb { fill: rgb(var(--c-panel3)) }
.n .nt { fill: rgb(var(--c-text)); font-weight: 600; font-size: 12px }
.n .ns { fill: rgb(var(--c-muted)); font: 10px var(--mono) }
.k-in .ks, .k-out .ks { fill: rgb(var(--f-net)) }
.k-ctl .ks { fill: rgb(var(--f-ctl)) }
.k-bus .ks { fill: rgb(var(--f-ctl) / .45) }
.k-pic .ks { fill: rgb(var(--f-pic)) }
.n:focus-visible .nb { stroke: rgb(var(--c-accent)); stroke-width: 1.6 }
.e { transition: opacity .15s }
.e.minor { opacity: .2 }
.el { font: 10px var(--mono); paint-order: stroke; stroke: rgb(var(--c-bg)); stroke-width: 4px; stroke-linejoin: round; opacity: 0; transition: opacity .15s; pointer-events: none }
.el.always { opacity: .95 }
${TYPES.map((k) => `.el.t-${k} { fill: rgb(var(--f-${k})) }`).join(' ')}
#map.focus .e { opacity: .07 }
#map.focus .e.on { opacity: 1; stroke-width: 2.2 }
#map.focus .n { opacity: .32 }
#map.focus .n.on { opacity: 1 }
#map.focus .n.sel .nb { stroke: rgb(var(--c-accent)); stroke-width: 1.6 }
#map.focus .el { opacity: 0 }
#map.focus .el.on { opacity: 1 }
#map .off { display: none }

/* detail rail */
aside { background: rgb(var(--c-panel)); border: 1px solid rgb(var(--c-border)); border-radius: 2px; padding: 12px 14px 14px; display: grid; gap: 10px; min-width: 0 }
@media (min-width: 1700px) { aside { position: sticky; top: 12px } }
aside h3 { font-size: 15px; font-weight: 600; margin: 0 }
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
@media (prefers-reduced-motion: reduce) { .e, .el { transition: none } }
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
  <p>${TEXT.intro}</p>
  <p class="note">Secondary links are drawn faint until you pick a block: all ${E.length} links are on the map, ${minorCount} of them secondary.</p>
  <div class="legend" role="group" aria-label="Show or hide each kind of flow">
    <span class="label">Flows</span>
${[['pic', 'picture', ''], ['ctl', 'control · modulation', ''], ['snd', 'sound', ''], ['net', 'in · out of the app', ''], ['loop', 'feedback inside', ' stroke-dasharray="6 5"'], ['phys', 'loops through the room', ' stroke-dasharray="2 5"']]
  .map(([k, l, d]) => `    <button class="btn" data-t="${k}" aria-pressed="true"><svg aria-hidden="true"><line x1="0" y1="4" x2="26" y2="4" stroke="rgb(var(--f-${k}))" stroke-width="2"${d}/></svg>${l}</button>`).join('\n')}
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
    <p id="d-desc">Hover, tap or tab to any block: its connections light up here and on the map, with what flows along each one. Tap the empty map to see everything again.</p>
    <div id="d-in"></div>
    <div id="d-out"></div>
    <div class="refs" id="d-refs"></div>
  </aside>
</div>

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
  <span>Drawn from the code on branch ${AUDITED.branch} at commit ${AUDITED.commit} (${AUDITED.date}), and checked against it block by block. Each block's panel names the files and symbols it comes from.</span>
  <span>Colours, fonts and themes are Palinopsia's own. Fonts: Inter, Roboto, IBM Plex Sans and Work Sans, under the SIL Open Font License (<a href="fonts/LICENSES.txt">licenses</a>). Palinopsia is free software under the GPL-3.0-or-later · <a href="https://github.com/filliformes/palinopsia">source</a> · <a href="${SITE}">site</a></span>
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

// ── 7. Write (or check) ─────────────────────────────────────────────────────
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
