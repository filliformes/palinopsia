// Source Editor (Alt+E) : write ISF shaders, or start from a copy of any
// built-in one, and keep them as your own ("my shaders" in the source and FX
// menus, files in the Shaders folder; a session that plays one carries its
// source). Code in the middle (GLSL colors, line numbers), the shader running
// on the right, compiled again a moment after you stop typing : an error keeps
// the last good version playing and marks its line. Your controls appear as you
// declare them in the header. A built-in is never written over : saving a copy
// asks for a name of yours.

import { useEffect, useMemo, useRef, useState } from 'react'
import { EditorView, basicSetup } from 'codemirror'
import { EditorState, StateEffect, StateField, type Extension } from '@codemirror/state'
import { Decoration, type DecorationSet, keymap } from '@codemirror/view'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { indentWithTab } from '@codemirror/commands'
import { shader as glslMode } from '@codemirror/legacy-modes/mode/clike'
import { tags as t } from '@lezer/highlight'
import { Renderer as ISFRenderer } from 'interactive-shader-format'
import { makeRedirectableGL } from '../engine/Compositor'
import { handle } from '../engine/isfTextureBridge'
import { FX_SHADERS, GENERATORS, SHADER_BY_ID } from '../shaders/isf'
import { categoryOf, registerUserShader, unregisterUserShader, userShaderId } from '../shaders/userShaders'
import { compileIsf, lintIsf, type ShaderMark } from '../shaders/shaderCheck'
import { useStore } from '../store'
import { showToast } from './Toast'

// ── templates ────────────────────────────────────────────────────────────
const TEMPLATES: Record<string, { label: string; source: string }> = {
  generator: {
    label: 'a generator',
    source: `/*{
  "DESCRIPTION": "My generator",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "speed", "TYPE": "float", "MIN": 0.0, "MAX": 4.0, "DEFAULT": 1.0 },
    { "NAME": "scale", "TYPE": "float", "MIN": 1.0, "MAX": 20.0, "DEFAULT": 6.0 },
    { "NAME": "tint", "TYPE": "color", "DEFAULT": [1.0, 0.6, 0.2, 1.0] }
  ]
}*/

// PH_speed : the time integrated at the speed (Palinopsia's phases), so
// moving the speed never makes the picture jump (TIME * speed would).
uniform float PH_speed;

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 p = (uv - 0.5) * vec2(RENDERSIZE.x / RENDERSIZE.y, 1.0) * scale;
  float t = PH_speed;
  float v = sin(p.x + t) + sin(p.y * 1.3 - t * 0.7) + sin(length(p) * 1.7 - t);
  vec3 col = tint.rgb * (0.5 + 0.5 * sin(v * 2.0));
  gl_FragColor = vec4(col, 1.0);
}
`
  },
  effect: {
    label: 'an effect',
    source: `/*{
  "DESCRIPTION": "My effect",
  "CATEGORIES": ["FX"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "amount", "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.5 },
    { "NAME": "waves", "TYPE": "float", "MIN": 0.0, "MAX": 40.0, "DEFAULT": 12.0 }
  ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  vec2 off = vec2(sin(uv.y * waves + TIME), cos(uv.x * waves - TIME)) * 0.02 * amount;
  // IMG_NORM_PIXEL wants a plain variable as its coordinate
  vec2 q = uv + off;
  gl_FragColor = IMG_NORM_PIXEL(inputImage, q);
}
`
  },
  feedback: {
    label: 'a feedback',
    source: `/*{
  "DESCRIPTION": "My feedback",
  "CATEGORIES": ["Generator"],
  "INPUTS": [
    { "NAME": "decay", "TYPE": "float", "MIN": 0.8, "MAX": 1.0, "DEFAULT": 0.96 },
    { "NAME": "spin", "TYPE": "float", "MIN": -0.05, "MAX": 0.05, "DEFAULT": 0.01 }
  ],
  "PASSES": [ { "TARGET": "trail", "PERSISTENT": true }, {} ]
}*/

void main() {
  vec2 uv = isf_FragNormCoord;
  if (PASSINDEX == 0) {
    // the last frame, turned a little and faded : the trail
    vec2 c = uv - 0.5;
    vec2 r = vec2(c.x * cos(spin) - c.y * sin(spin), c.x * sin(spin) + c.y * cos(spin)) * 0.99 + 0.5;
    vec4 old = IMG_NORM_PIXEL(trail, r) * decay;
    vec2 dot = vec2(0.5 + 0.3 * cos(TIME), 0.5 + 0.3 * sin(TIME * 1.3));
    float d = smoothstep(0.03, 0.0, distance(uv, dot));
    gl_FragColor = max(old, vec4(vec3(d), 1.0));
  } else {
    gl_FragColor = IMG_NORM_PIXEL(trail, uv);
  }
}
`
  }
}

// ── the draft (kept when the editor closes, and across a restart) ────────
interface Draft {
  name: string
  source: string
  userId: string | null // the shader of yours it edits (null : not saved yet)
  saved: string // the source as last saved ('' : never)
  from: string // what it started from (a template, a built-in), for the header
}
const DRAFT_KEY = 'opsia.sourceDraft'
function loadDraft(): Draft {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? 'null') as Draft | null
    if (d && typeof d.source === 'string' && typeof d.name === 'string') return d
  } catch { /* fresh */ }
  return { name: 'my shader', source: TEMPLATES.generator.source, userId: null, saved: '', from: 'the generator template' }
}

// ── controls from the header ─────────────────────────────────────────────
interface Ctl {
  name: string
  type: string
  min: number
  max: number
  def: unknown
  values?: number[]
  labels?: string[]
}
function headerOf(source: string): { inputs: Ctl[]; ok: boolean } {
  const m = source.match(/\/\*\s*(\{[\s\S]*?\})\s*\*\//)
  if (!m) return { inputs: [], ok: false }
  try {
    const j = JSON.parse(m[1]) as { INPUTS?: Array<Record<string, unknown>> }
    const inputs: Ctl[] = []
    for (const i of j.INPUTS ?? []) {
      const type = String(i.TYPE ?? '')
      if (type === 'image' || type === 'audio' || type === 'audioFFT') continue
      inputs.push({
        name: String(i.NAME ?? ''),
        type,
        min: typeof i.MIN === 'number' ? i.MIN : 0,
        max: typeof i.MAX === 'number' ? i.MAX : 1,
        def: i.DEFAULT,
        values: Array.isArray(i.VALUES) ? (i.VALUES as number[]) : undefined,
        labels: Array.isArray(i.LABELS) ? (i.LABELS as string[]) : undefined
      })
    }
    return { inputs, ok: true }
  } catch {
    return { inputs: [], ok: false }
  }
}
const defaultOf = (c: Ctl): unknown => {
  if (c.def !== undefined) return c.def
  if (c.type === 'color') return [1, 1, 1, 1]
  if (c.type === 'point2D') return [0.5, 0.5]
  if (c.type === 'bool' || c.type === 'event') return false
  if (c.type === 'long') return c.values?.[0] ?? 0
  return c.min + (c.max - c.min) / 2
}

type Mark = ShaderMark

// ── CodeMirror : GLSL colors in the app's palette, marked lines ──────────
const setMarks = StateEffect.define<Mark[]>()
const markField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes)
    for (const e of tr.effects) {
      if (!e.is(setMarks)) continue
      const doc = tr.state.doc
      const ranges = e.value
        .filter((m) => m.line >= 1 && m.line <= doc.lines)
        .sort((a, b) => a.line - b.line)
        .filter((m, i, a) => i === 0 || a[i - 1].line !== m.line)
        .map((m) => Decoration.line({ attributes: { class: m.level === 'error' ? 'cm-opsia-err' : 'cm-opsia-warn', title: m.msg } }).range(doc.line(m.line).from))
      deco = Decoration.set(ranges)
    }
    return deco
  },
  provide: (f) => EditorView.decorations.from(f)
})
const theme = EditorView.theme(
  {
    '&': { height: '100%', backgroundColor: 'rgb(var(--c-panel))', color: 'rgb(var(--c-text))', fontSize: '12px' },
    '.cm-scroller': { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', lineHeight: '1.5' },
    '.cm-gutters': { backgroundColor: 'rgb(var(--c-panel2))', color: 'rgb(var(--c-muted))', border: 'none' },
    '.cm-activeLine': { backgroundColor: 'rgb(var(--c-panel2) / 0.6)' },
    '.cm-activeLineGutter': { backgroundColor: 'rgb(var(--c-panel3) / 0.6)' },
    '.cm-cursor': { borderLeftColor: 'rgb(var(--c-accent))' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': { backgroundColor: 'rgb(var(--c-accent) / 0.25)' },
    '.cm-opsia-err': { backgroundColor: 'rgb(220 60 60 / 0.22)' },
    '.cm-opsia-warn': { backgroundColor: 'rgb(217 164 65 / 0.16)' }
  },
  { dark: true }
)
const highlight = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword], color: '#e8a04a' },
  { tag: [t.typeName, t.className], color: '#7fc4e8' },
  { tag: [t.number, t.bool, t.atom], color: '#c49bf0' },
  { tag: [t.comment, t.lineComment, t.blockComment], color: '#7a7f88', fontStyle: 'italic' },
  { tag: [t.string], color: '#a8d07a' },
  { tag: [t.meta, t.processingInstruction], color: '#d0a0c8' },
  { tag: [t.function(t.variableName), t.standard(t.variableName)], color: '#e6d48a' },
  { tag: [t.definition(t.variableName)], color: '#ededed' }
])

// What the preview reads as its input, for an effect.
const INPUTS_FOR_FX: Array<{ id: string; label: string }> = [
  { id: 'filaments', label: 'Filaments' },
  { id: 'op-art', label: 'Op-Art' },
  { id: 'dye-field', label: 'Dye Field' },
  { id: 'murmuration', label: 'Murmuration' },
  { id: 'ten-print', label: '10 Print' },
  { id: '__live', label: 'the live picture' }
]

const W = 480
const H = 270

export function SourceEditor(): JSX.Element {
  const close = useStore((s) => s.setSourceEditorOpen)
  const userShaders = useStore((s) => s.userShaders)
  const upsert = useStore((s) => s.upsertUserShader)
  const removeUser = useStore((s) => s.removeUserShader)
  const selection = useStore((s) => s.selection)
  const [draft, setDraftState] = useState<Draft>(loadDraft)
  const draftRef = useRef(draft)
  draftRef.current = draft
  const setDraft = (d: Draft): void => {
    setDraftState(d)
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(d)) } catch { /* private storage */ }
  }
  const [filter, setFilter] = useState('')
  const [marks, setMarksState] = useState<Mark[]>([])
  const [status, setStatus] = useState<{ ok: boolean; ms: number; at: number }>({ ok: false, ms: 0, at: 0 })
  const [vals, setVals] = useState<Record<string, unknown>>({})
  const valsRef = useRef(vals)
  valsRef.current = vals
  const [fxInput, setFxInput] = useState('filaments')
  const [confirm, setConfirm] = useState<'' | 'delete' | 'overwrite'>('')
  const dirty = draft.source !== draft.saved
  // still one of yours (its file may have gone : removed by hand, another computer)
  const mine = !!draft.userId && userShaders.some((u) => u.id === draft.userId)
  const category = categoryOf(draft.source)
  const header = useMemo(() => headerOf(draft.source), [draft.source])

  // ── CodeMirror ──
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)
  useEffect(() => {
    if (!hostRef.current) return
    const exts: Extension[] = [
      basicSetup,
      keymap.of([indentWithTab]),
      StreamLanguage.define(glslMode),
      syntaxHighlighting(highlight),
      theme,
      markField,
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return
        const d = draftRef.current
        setDraft({ ...d, source: u.state.doc.toString() })
      })
    ]
    const view = new EditorView({ state: EditorState.create({ doc: draftRef.current.source, extensions: exts }), parent: hostRef.current })
    viewRef.current = view
    if (import.meta.env.VITE_OPSIA_TEST) Object.assign(window, { __sourceEditor: { view } })
    return () => { view.destroy(); viewRef.current = null }
  }, [])
  /** Replace the editor's whole text (opening another shader, a template). */
  const loadText = (source: string): void => {
    const v = viewRef.current
    if (!v) return
    v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: source } })
  }
  useEffect(() => {
    viewRef.current?.dispatch({ effects: setMarks.of(marks) })
  }, [marks])
  const goLine = (line: number): void => {
    const v = viewRef.current
    if (!v || line < 1 || line > v.state.doc.lines) return
    const pos = v.state.doc.line(line).from
    v.dispatch({ selection: { anchor: pos }, scrollIntoView: true })
    v.focus()
  }

  // ── the preview : its own GL context, the last good program keeps playing ──
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const glRef = useRef<{
    gl: WebGL2RenderingContext
    rgl: WebGL2RenderingContext
    state: { redirect: WebGLFramebuffer | null }
    cur: ISFRenderer | null
    out: { fbo: WebGLFramebuffer; tex: WebGLTexture }
    inp: { fbo: WebGLFramebuffer; tex: WebGLTexture }
    inGen: ISFRenderer | null
    inGenId: string
    live: WebGLTexture
  } | null>(null)
  const fxInputRef = useRef(fxInput)
  fxInputRef.current = fxInput
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = W
    canvas.height = H
    const gl = canvas.getContext('webgl2', { antialias: false, preserveDrawingBuffer: false })
    if (!gl) return
    const { gl: rgl, state } = makeRedirectableGL(gl)
    const target = (): { fbo: WebGLFramebuffer; tex: WebGLTexture } => {
      const tex = gl.createTexture()!
      gl.bindTexture(gl.TEXTURE_2D, tex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      const fbo = gl.createFramebuffer()!
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0)
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      return { fbo, tex }
    }
    const live = gl.createTexture()!
    gl.bindTexture(gl.TEXTURE_2D, live)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]))
    const g = { gl, rgl, state, cur: null as ISFRenderer | null, out: target(), inp: target(), inGen: null as ISFRenderer | null, inGenId: '', live }
    glRef.current = g
    let raf = 0
    let lastLive = 0
    const onLost = (e: Event): void => { e.preventDefault(); cancelAnimationFrame(raf) }
    canvas.addEventListener('webglcontextlost', onLost)
    const loop = (): void => {
      raf = requestAnimationFrame(loop)
      const cur = g.cur
      if (!cur) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
        gl.viewport(0, 0, W, H)
        gl.clearColor(0.03, 0.03, 0.04, 1)
        gl.clear(gl.COLOR_BUFFER_BIT)
        return
      }
      try {
        // an effect's input : a generator, or the live picture (15 times a second)
        if (categoryOf(draftRef.current.source) === 'FX') {
          const want = fxInputRef.current
          if (want === '__live') {
            const now = performance.now()
            const main = [...document.querySelectorAll('canvas')].find((c) => c !== canvas && c.width > 64)
            if (main && now - lastLive > 66) {
              lastLive = now
              gl.bindTexture(gl.TEXTURE_2D, g.live)
              gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
              gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, main)
              gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
            }
            cur.setValue('inputImage', handle(g.live, W, H))
          } else {
            if (g.inGenId !== want) {
              try { g.inGen?.cleanup() } catch { /* gone */ }
              g.inGen = null
              g.inGenId = want
              const src = SHADER_BY_ID[want]?.source
              if (src) { const r = new ISFRenderer(rgl); try { r.loadSource(src) } catch { /* runtime */ } if (r.valid) g.inGen = r }
            }
            if (g.inGen) {
              state.redirect = g.inp.fbo
              g.inGen.draw({ width: W, height: H })
              state.redirect = null
            }
            cur.setValue('inputImage', handle(g.inp.tex, W, H))
          }
        }
        for (const [k, v] of Object.entries(valsRef.current)) cur.setValue(k, evNames.current.has(k) ? fired.current.has(k) : v)
        state.redirect = g.out.fbo
        cur.draw({ width: W, height: H })
        state.redirect = null
        fired.current.clear() // an event lasts one frame
        gl.bindVertexArray(null)
        gl.bindFramebuffer(gl.READ_FRAMEBUFFER, g.out.fbo)
        gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null)
        gl.blitFramebuffer(0, 0, W, H, 0, 0, W, H, gl.COLOR_BUFFER_BIT, gl.NEAREST)
        gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      } catch {
        /* a broken frame : the next one tries again */
      }
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('webglcontextlost', onLost)
      try { g.cur?.cleanup() } catch { /* gone */ }
      try { g.inGen?.cleanup() } catch { /* gone */ }
      for (const x of [g.out, g.inp]) { gl.deleteTexture(x.tex); gl.deleteFramebuffer(x.fbo) }
      gl.deleteTexture(g.live)
      glRef.current = null
    }
  }, [])
  const evNames = useRef(new Set<string>())
  const fired = useRef(new Set<string>()) // events pressed since the last frame

  /** Compile into the preview; the errors, mapped back onto your lines. */
  const compile = (source: string): void => {
    const g = glRef.current
    if (!g) return
    const t0 = performance.now()
    const lints = lintIsf(source)
    const { renderer, errors } = compileIsf(g.gl, g.rgl, source)
    if (renderer) {
      try { g.cur?.cleanup() } catch { /* gone */ }
      g.cur = renderer
      setMarksState(lints)
      setStatus({ ok: true, ms: performance.now() - t0, at: Date.now() })
      return
    }
    setMarksState([...errors, ...lints])
    setStatus({ ok: false, ms: performance.now() - t0, at: Date.now() })
  }

  // compile a moment after typing stops
  useEffect(() => {
    const id = window.setTimeout(() => compile(draft.source), 400)
    return () => window.clearTimeout(id)
  }, [draft.source])

  // the controls : keep what is set, defaults for the new ones
  useEffect(() => {
    if (!header.ok) return
    evNames.current = new Set(header.inputs.filter((c) => c.type === 'event').map((c) => c.name))
    setVals((v) => {
      const next: Record<string, unknown> = {}
      for (const c of header.inputs) next[c.name] = c.name in v ? v[c.name] : defaultOf(c)
      return next
    })
  }, [header])

  // ── the library ──
  const builtins = useMemo(() => ({
    gens: GENERATORS.filter((g) => !g.native),
    fx: FX_SHADERS.filter((f) => !f.native)
  }), [])
  const q = filter.trim().toLowerCase()
  const match = (n: string): boolean => !q || n.toLowerCase().includes(q)
  const openBuiltin = (id: string): void => {
    const s = SHADER_BY_ID[id]
    if (!s) return
    const d = { name: `${s.name} copy`, source: s.source, userId: null, saved: '', from: `a copy of ${s.name}` }
    setDraft(d)
    loadText(s.source)
  }
  const openMine = (id: string): void => {
    const s = SHADER_BY_ID[id]
    if (!s) return
    const d = { name: s.name, source: s.source, userId: id, saved: s.source, from: 'yours' }
    setDraft(d)
    loadText(s.source)
  }
  const newFrom = (k: string): void => {
    const tpl = TEMPLATES[k]
    const d = { name: 'my shader', source: tpl.source, userId: null, saved: '', from: `the ${k} template` }
    setDraft(d)
    loadText(tpl.source)
  }

  // ── save / delete / use ──
  const save = async (force = false): Promise<string | null> => {
    const d = draftRef.current
    const name = d.name.trim()
    if (!name) { showToast('Name it first.', 'warn'); return null }
    const id = userShaderId(name)
    const other = userShaders.find((u) => u.id === id && u.id !== d.userId && !u.fromSession)
    if (other && !force) { setConfirm('overwrite'); return null }
    setConfirm('')
    const r = await window.api.shadersSave(name, d.source)
    if (!r?.ok) { showToast(`Not saved : ${r?.error ?? 'the Shaders folder refused it'}`, 'warn', 6000); return null }
    const info = registerUserShader(r.name, d.source)
    upsert(info)
    setDraft({ ...draftRef.current, name: r.name, userId: info.id, saved: d.source })
    showToast(`Saved “${r.name}” in your Shaders`, 'ok')
    return info.id
  }
  const del = async (): Promise<void> => {
    const d = draftRef.current
    if (!d.userId) return
    if (confirm !== 'delete') { setConfirm('delete'); return }
    setConfirm('')
    await window.api.shadersDelete(SHADER_BY_ID[d.userId]?.name ?? d.name)
    unregisterUserShader(d.userId)
    removeUser(d.userId)
    setDraft({ ...d, userId: null, saved: '' })
    showToast(`“${d.name}” removed from your Shaders (it stays open here)`, 'ok')
  }
  // Ctrl/Cmd+S saves the shader while the editor is open (the App leaves the
  // session alone then), from the code or anywhere on the page
  const saveKeyRef = useRef(save)
  saveKeyRef.current = () => save(confirm === 'overwrite')
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.key.toLowerCase() !== 's') return
      e.preventDefault()
      void saveKeyRef.current()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  const useIt = async (where: 'slot' | 'layer' | 'master'): Promise<void> => {
    const d = draftRef.current
    let id = d.userId
    if (!id || d.source !== d.saved || !useStore.getState().userShaders.some((u) => u.id === id)) id = await save()
    if (!id) return
    const st = useStore.getState()
    const sel = selection?.type === 'source' ? selection : null
    const layer = sel?.layer ?? 0
    if (where === 'slot') {
      st.setSourceShader(layer, sel?.slot ?? 'A', id)
      showToast(`On layer ${layer + 1} ${sel?.slot ?? 'A'}`, 'ok')
    } else if (where === 'layer') {
      st.addFx({ kind: 'layer', layer }, id)
      showToast(`Added to layer ${layer + 1}'s effects`, 'ok')
    } else {
      st.addFx({ kind: 'master' }, id)
      showToast('Added to the master effects', 'ok')
    }
  }
  const openFile = async (): Promise<void> => {
    const f = await window.api.shadersOpenFile()
    if (!f) return
    setDraft({ name: f.name, source: f.source, userId: null, saved: '', from: 'a file' })
    loadText(f.source)
  }

  const errs = marks.filter((m) => m.level === 'error')
  const warns = marks.filter((m) => m.level === 'warn')
  const sel = selection?.type === 'source' ? selection : null

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-bg">
      {/* header */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border bg-panel px-4 py-2">
        <span className="font-mono text-[13px] font-semibold uppercase tracking-wide text-accent">{'{ }'} Source Editor</span>
        <input
          className="input w-56 text-[13px]"
          value={draft.name}
          onChange={(e) => { setConfirm(''); setDraft({ ...draft, name: e.target.value }) }}
          title="Its name : the file in your Shaders folder, and its name in the menus"
        />
        <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase ${category === 'FX' ? 'bg-accent2/20 text-accent2' : 'bg-accent/20 text-accent'}`} title="An effect reads the picture under it (an inputImage); a generator makes one">
          {category === 'FX' ? 'effect' : 'generator'}
        </span>
        <span className="font-mono text-[10px] text-muted">
          {mine ? (dirty ? '● changed' : 'saved') : `not saved yet · ${draft.from}`}
        </span>
        <button className="btn text-[11px]" onClick={() => void save(confirm === 'overwrite')} title="Save it in your Shaders folder under this name (a built-in is never written over)">
          {confirm === 'overwrite' ? 'replace yours ?' : 'Save'}
        </button>
        <span className="font-mono text-[9px] text-muted">use :</span>
        {category === 'Generator' ? (
          <button className="btn text-[11px]" onClick={() => void useIt('slot')} title="Save it, then play it on the selected source slot (layer 1 A when none is selected)">
            on L{(sel?.layer ?? 0) + 1} {sel?.slot ?? 'A'}
          </button>
        ) : (
          <>
            <button className="btn text-[11px]" onClick={() => void useIt('layer')} title="Save it, then add it to the selected layer's effects (layer 1 when none is selected)">
              L{(sel?.layer ?? 0) + 1} fx
            </button>
            <button className="btn text-[11px]" onClick={() => void useIt('master')} title="Save it, then add it to the master effects">master fx</button>
          </>
        )}
        <div className="flex-1" />
        <select
          className="input select-compact text-[11px]"
          value=""
          onChange={(e) => { if (e.target.value) newFrom(e.target.value) }}
          title="Start a new shader from a template"
        >
          <option value="">new from…</option>
          {Object.entries(TEMPLATES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <button className="btn text-[11px]" onClick={() => void openFile()} title="Open an ISF file (.fs, .frag, .glsl, .isf) : from the web, another app, a friend">open file…</button>
        <button className="btn text-[11px]" onClick={() => void window.api.shadersReveal()} title="Show your Shaders folder">folder</button>
        {mine && (
          <button className="btn text-[11px]" onClick={() => void del()} title="Remove it from your Shaders folder (it stays open here, unsaved)">
            {confirm === 'delete' ? 'delete ?' : 'delete'}
          </button>
        )}
        <button className="btn text-[12px]" onClick={() => close(false)} title="Close (Alt+E / Esc). What you were writing stays here.">✕ Close</button>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* the library */}
        <aside className="no-scrollbar flex w-56 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border bg-panel2/40 p-2 text-[11px]">
          <input className="input mb-1 w-full px-1.5 py-0.5 text-[11px]" placeholder="filter" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <span className="mt-1 font-mono text-[9px] uppercase tracking-wide text-muted">my shaders</span>
          {userShaders.filter((u) => match(u.name)).map((u) => (
            <button key={u.id} onClick={() => openMine(u.id)} className={`shrink-0 truncate rounded px-1.5 py-0.5 text-left hover:bg-panel3/40 ${draft.userId === u.id ? 'bg-accent/15 text-accent' : ''}`} title={u.fromSession ? 'From the session : save it to keep it in your Shaders folder' : u.category === 'FX' ? 'an effect of yours' : 'a generator of yours'}>
              {u.name}{u.fromSession ? ' · session' : ''}
            </button>
          ))}
          {!userShaders.length && <span className="px-1.5 text-[10px] text-muted">None yet : save one.</span>}
          <span className="mt-2 font-mono text-[9px] uppercase tracking-wide text-muted">generators (a copy)</span>
          {builtins.gens.filter((g) => match(g.name)).map((g) => (
            <button key={g.id} onClick={() => openBuiltin(g.id)} className="shrink-0 truncate rounded px-1.5 py-0.5 text-left text-muted hover:bg-panel3/40 hover:text-text" title="Open a copy : the built-in is never written over">{g.name}</button>
          ))}
          <span className="mt-2 font-mono text-[9px] uppercase tracking-wide text-muted">effects (a copy)</span>
          {builtins.fx.filter((f) => match(f.name)).map((f) => (
            <button key={f.id} onClick={() => openBuiltin(f.id)} className="shrink-0 truncate rounded px-1.5 py-0.5 text-left text-muted hover:bg-panel3/40 hover:text-text" title="Open a copy : the built-in is never written over">{f.name}</button>
          ))}
        </aside>

        {/* the code */}
        <main className="min-w-0 flex-1 overflow-hidden" ref={hostRef} />

        {/* the preview, the problems, the controls */}
        <aside className="no-scrollbar flex w-[420px] shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-panel p-2">
          <canvas ref={canvasRef} className="w-full rounded border border-border bg-black" style={{ aspectRatio: '16 / 9' }} />
          <div className="flex items-center gap-2 font-mono text-[10px]">
            <span className={status.ok ? 'text-success' : 'text-danger'}>
              {status.at === 0 ? 'compiling…' : status.ok ? `✓ compiled in ${Math.round(status.ms)} ms` : `✕ ${errs.length} error${errs.length === 1 ? '' : 's'} : the last good version plays`}
            </span>
            <div className="flex-1" />
            {category === 'FX' && (
              <select className="input select-compact text-[10px]" value={fxInput} onChange={(e) => setFxInput(e.target.value)} title="What the effect reads in the preview">
                {INPUTS_FOR_FX.map((i) => <option key={i.id} value={i.id}>on {i.label}</option>)}
              </select>
            )}
          </div>
          {(errs.length > 0 || warns.length > 0) && (
            <div className="flex max-h-40 flex-col gap-0.5 overflow-y-auto rounded border border-border bg-panel2/40 p-1.5">
              {[...errs, ...warns].map((m, i) => (
                <button key={i} onClick={() => goLine(m.line)} className={`text-left font-mono text-[10px] leading-snug ${m.level === 'error' ? 'text-danger' : 'text-[rgb(217_164_65)]'}`} title={m.line ? `Go to line ${m.line}` : undefined}>
                  {m.line ? `line ${m.line} : ` : ''}{m.msg}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-1 rounded border border-border bg-panel2/30 p-2">
            <span className="font-mono text-[9px] uppercase tracking-wide text-muted">controls (from the header : they try the shader here, the Inspector has them once it plays)</span>
            {!header.ok && <span className="text-[10px] text-danger">The header (the JSON between /* and */) does not read.</span>}
            {header.inputs.map((c) => (
              <CtlRow key={c.name} c={c} value={vals[c.name]} onChange={(v) => (c.type === 'event' ? fired.current.add(c.name) : setVals((x) => ({ ...x, [c.name]: v })))} />
            ))}
            {header.ok && !header.inputs.length && <span className="text-[10px] text-muted">None : declare INPUTS in the header and they appear here.</span>}
          </div>
          <p className="font-mono text-[9px] leading-relaxed text-muted">
            ISF : the JSON header declares the controls (float, long, bool, color, point2D, event; an image named inputImage makes it an effect; PASSES with PERSISTENT targets keep frames).
            Use isf_FragNormCoord, RENDERSIZE, TIME, IMG_NORM_PIXEL. A uniform float PH_name; is TIME integrated at the input called name (no jumps when it moves).
          </p>
        </aside>
      </div>
    </div>
  )
}

function CtlRow({ c, value, onChange }: { c: Ctl; value: unknown; onChange: (v: unknown) => void }): JSX.Element {
  const label = <span className="w-20 shrink-0 truncate font-mono text-[10px] text-muted" title={c.name}>{c.name}</span>
  if (c.type === 'bool')
    return <label className="flex items-center gap-2">{label}<input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} /></label>
  if (c.type === 'event')
    return <div className="flex items-center gap-2">{label}<button className="btn px-2 text-[10px]" onClick={() => onChange(true)}>fire ▸</button></div>
  if (c.type === 'long') {
    const vs = c.values ?? Array.from({ length: Math.max(1, Math.round(c.max - c.min) + 1) }, (_, i) => c.min + i)
    return (
      <div className="flex items-center gap-2">{label}
        <select className="input select-compact min-w-0 flex-1 text-[10px]" value={Number(value ?? vs[0])} onChange={(e) => onChange(Number(e.target.value))}>
          {vs.map((v, i) => <option key={v} value={v}>{c.labels?.[i] ?? v}</option>)}
        </select>
      </div>
    )
  }
  if (c.type === 'color') {
    const a = Array.isArray(value) ? (value as number[]) : [1, 1, 1, 1]
    const hex = '#' + a.slice(0, 3).map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0')).join('')
    return (
      <div className="flex items-center gap-2">{label}
        <input type="color" value={hex} onChange={(e) => { const h = e.target.value; onChange([parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255, a[3] ?? 1]) }} />
        <span className="font-mono text-[10px] text-muted">{hex}</span>
      </div>
    )
  }
  if (c.type === 'point2D') {
    const p = Array.isArray(value) ? (value as number[]) : [0.5, 0.5]
    const lo = Array.isArray(c.min) ? 0 : c.min, hi = Array.isArray(c.max) ? 1 : c.max
    return (
      <div className="flex items-center gap-2">{label}
        {[0, 1].map((k) => (
          <input key={k} type="range" min={lo} max={hi} step={(hi - lo) / 200} value={p[k]} onChange={(e) => onChange(k === 0 ? [Number(e.target.value), p[1]] : [p[0], Number(e.target.value)])} className="min-w-0 flex-1 accent-accent" />
        ))}
      </div>
    )
  }
  const v = typeof value === 'number' ? value : c.min
  return (
    <div className="flex items-center gap-2">{label}
      <input type="range" min={c.min} max={c.max} step={(c.max - c.min) / 500 || 0.01} value={v} onChange={(e) => onChange(Number(e.target.value))} className="min-w-0 flex-1 accent-accent" />
      <span className="w-12 shrink-0 text-right font-mono text-[10px] text-muted">{Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2)}</span>
    </div>
  )
}
