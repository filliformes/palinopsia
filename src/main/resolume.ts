// Resolume composition (.avc) reader for the OSC mapper.
//
// An .avc is plain XML, often tens of MB because every clip embeds a base64
// thumbnail. We don't need a DOM : one pass of a tag tokenizer with a parent
// stack is enough to learn the layout (layers, groups, columns, the current
// deck's clips, every chain's effects and every dashboard's links). Resolume
// only writes parameters that differ from their default, so an effect's param
// list here is what the set actually touched; the mapper's LEARN mode catches
// the rest straight off Resolume's OSC output.

import { ipcMain, dialog, app } from 'electron'
import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join, basename } from 'path'
import type { ResoFx, ResoLink, ResoParseResult, ResoSession, ResoTrack } from '@shared/resolume'
import { resoSlug } from '@shared/resolume'

interface Node {
  tag: string
  a: Record<string, string>
}

const TAG = /<(\/)?([A-Za-z_][\w.-]*)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/)?>/g
const ATTR = /([\w:.-]+)\s*=\s*"([^"]*)"/g
// A parameter element (Param, ParamRange, ParamChoice, …) but not a Params block.
const isParam = (tag: string): boolean => tag !== 'Params' && /^Param/.test(tag)

function attrs(s: string): Record<string, string> {
  const o: Record<string, string> = {}
  ATTR.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = ATTR.exec(s))) {
    o[m[1]] = m[2]
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
  }
  return o
}

export function parseAvc(xml: string, path: string): ResoSession {
  const s: ResoSession = {
    name: basename(path).replace(/\.avc$/i, ''),
    path,
    version: '',
    width: 0,
    height: 0,
    decks: [],
    currentDeck: 0,
    columns: 0,
    layers: [],
    groups: [],
    composition: { dashboard: [], effects: [] },
    clips: []
  }
  const stack: Node[] = []
  let groupCount = 0
  // The track (composition / group / layer) whose chain or dashboard we are in.
  const trackOf = (depthFromTop: number): { kind: 'comp' | 'group' | 'layer'; t: ResoTrack | null } | null => {
    const n = stack[depthFromTop]
    if (!n) return null
    if (n.tag === 'Composition') return { kind: 'comp', t: null }
    if (n.tag === 'Group') return { kind: 'group', t: s.groups[s.groups.length - 1] ?? null }
    if (n.tag === 'Layer') return { kind: 'layer', t: s.layers[s.layers.length - 1] ?? null }
    return null
  }
  // Effect being read (so its inner Params can be attributed to it).
  let fx: ResoFx | null = null
  let fxDepth = -1
  let fxSlugs = new Map<string, number>()
  let clip: { layer: number; column: number; name: string } | null = null
  let clipDepth = -1

  TAG.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = TAG.exec(xml))) {
    const closing = !!m[1]
    const tag = m[2]
    if (closing) {
      // Pop to the matching tag (tolerant of any imbalance).
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break }
      }
      if (fx && stack.length <= fxDepth) { fx = null; fxDepth = -1 }
      if (clip && stack.length <= clipDepth) { clip = null; clipDepth = -1 }
      continue
    }
    const a = attrs(m[3] || '')
    const selfClose = !!m[4]
    const parent = stack[stack.length - 1]
    const depth = stack.length

    if (tag === 'Composition' && depth === 0) {
      s.currentDeck = Number(a.currentDeckIndex ?? 0) || 0
      s.columns = Number(a.numColumns ?? 0) || 0
    } else if (tag === 'versionInfo' && depth === 1) {
      s.version = `${a.name ?? 'Resolume'} ${a.majorVersion ?? ''}.${a.minorVersion ?? ''}.${a.microVersion ?? ''}`.trim()
    } else if (tag === 'CompositionInfo' && depth === 1) {
      if (a.name) s.name = a.name
      s.width = Number(a.width ?? 0) || 0
      s.height = Number(a.height ?? 0) || 0
    } else if (tag === 'DeckInfo' && parent?.tag === 'CompositionInfo') {
      s.decks.push(a.name ?? `Deck ${s.decks.length + 1}`)
    } else if (tag === 'Group' && depth === 1) {
      groupCount++
      s.groups.push({ index: groupCount, name: '', group: null, dashboard: [], effects: [] })
    } else if (tag === 'Layer' && depth === 1) {
      const gi = a.layerGroup !== undefined ? Number(a.layerGroup) + 1 : null
      s.layers.push({ index: (Number(a.layerIndex ?? s.layers.length) || 0) + 1, name: '', group: gi, dashboard: [], effects: [] })
    } else if (tag === 'Clip' && !m[4] && parent?.tag === 'Deck' && Number(parent.a.deckIndex ?? -1) === s.currentDeck) {
      // (a self-closing <Clip/> is an empty slot : only loaded clips count)
      clip = { layer: (Number(a.layerIndex ?? 0) || 0) + 1, column: (Number(a.columnIndex ?? 0) || 0) + 1, name: '' }
      s.clips.push(clip)
      clipDepth = depth
    } else if (tag === 'Param' && a.name === 'Name' && parent?.tag === 'Params' && parent.a.name === 'Params') {
      // A name belongs to whatever owns this Params block.
      const owner = stack[stack.length - 2]
      const v = a.value ?? ''
      if (owner?.tag === 'Layer' && depth === 3) { const t = s.layers[s.layers.length - 1]; if (t) t.name = v }
      else if (owner?.tag === 'Group' && depth === 3) { const t = s.groups[s.groups.length - 1]; if (t) t.name = v }
      else if (owner?.tag === 'Clip' && clip && depth === clipDepth + 2) clip.name = v
    } else if (isParam(tag) && parent?.tag === 'Params' && parent.a.name === 'Dashboard' && /^Link \d+$/.test(a.name ?? '')) {
      const tr = trackOf(stack.length - 2)
      const link: ResoLink = { n: Number(a.name!.slice(5)), name: a.altName ?? '' }
      if (tr?.kind === 'comp' && depth === 2) s.composition.dashboard.push(link)
      else if (tr?.t && depth === 3) tr.t.dashboard.push(link)
    } else if (tag === 'RenderPass' && parent?.tag === 'RenderPass' && parent.a.name === 'RenderPassChain') {
      // An effect slot in a chain : only the composition's / a group's / a
      // layer's own chain (a clip's chain sits under Deck > Clip and is skipped).
      const vt = stack[stack.length - 2]
      const tr = vt?.tag === 'VideoTrack' ? trackOf(stack.length - 3) : null
      const base = a.baseType ?? ''
      if (tr && (tr.kind === 'comp' || tr.t) && (base === 'DryWetEffect' || base === 'TransformEffect' || base === 'Effect')) {
        const list = tr.kind === 'comp' ? s.composition.effects : tr.t!.effects
        if (list.length === 0) fxSlugs = new Map()
        const root = resoSlug(a.name ?? 'effect')
        const k = (fxSlugs.get(root) ?? 0) + 1
        fxSlugs.set(root, k)
        fx = { name: a.name ?? 'Effect', slug: k > 1 ? `${root}${k}` : root, dryWet: base === 'DryWetEffect', params: [] }
        list.push(fx)
        fxDepth = depth
      }
    } else if (fx && isParam(tag) && parent?.tag === 'Params' && a.name) {
      // Effect parameters : a wrapped effect's live in its inner RenderPass
      // (dwType="Effect"); Transform's in its own Params. Skip the wrapper's own
      // (opacity / blend), which the dry/wet outputs already cover.
      const owner = stack[stack.length - 2]
      const inner = owner?.tag === 'RenderPass' && owner.a.dwType === 'Effect'
      const own = owner?.tag === 'RenderPass' && depth === fxDepth + 2 && !fx.dryWet
      if ((inner || own) && !fx.params.includes(a.name)) fx.params.push(a.name)
    }

    if (!selfClose) stack.push({ tag, a })
  }
  for (const t of [...s.layers, ...s.groups]) t.dashboard.sort((x, y) => x.n - y.n)
  s.composition.dashboard.sort((x, y) => x.n - y.n)
  s.clips.sort((x, y) => x.layer - y.layer || x.column - y.column)
  return s
}

/** Resolume's own composition folder, if it exists (the open dialog starts there). */
function compositionsDir(): string | undefined {
  const docs = app.getPath('documents')
  for (const p of [join(docs, 'Resolume Arena', 'Compositions'), join(docs, 'Resolume Avenue', 'Compositions')]) {
    if (existsSync(p)) return p
  }
  return undefined
}

export function registerResolume(): void {
  ipcMain.handle('resolume:pick', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Open a Resolume composition',
      defaultPath: compositionsDir(),
      filters: [{ name: 'Resolume composition', extensions: ['avc'] }],
      properties: ['openFile']
    })
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0]
  })
  ipcMain.handle('resolume:parse', async (_e, path: string): Promise<ResoParseResult> => {
    try {
      if (typeof path !== 'string' || !/\.avc$/i.test(path)) return { ok: false, error: 'not an .avc file' }
      const xml = await readFile(path, 'utf8')
      if (!/<Composition\b/.test(xml.slice(0, 4096))) return { ok: false, error: 'no <Composition> in this file' }
      return { ok: true, session: parseAvc(xml, path) }
    } catch (err) {
      return { ok: false, error: (err as Error).message }
    }
  })
}
