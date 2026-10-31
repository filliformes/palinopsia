// The whole trigger vocabulary as one grouped, searchable list : midi.ts's first
// set (the dice, the transport, scenes, Sonify, sessions) and actions.ts's
// (the layers, the triggers of what is loaded, the effects, Worlds, Generate,
// Macro, modulators, Feel, tempo and sound, the output). The Body page's rule
// builder and the MIDI panel's "learn an action" both pick from it, so a body
// and a pad play the same instrument.

import type { SearchOption } from './components/SearchSelect'
import { actionIds, actionInfo } from './actions'
import { midiTargetLabel } from './midi'
import { useStore } from './store'

type St = ReturnType<typeof useStore.getState>

const SONI_VOICE_NAMES = ['Spectra', 'Orbit', 'Flow', 'Events', 'Raster', 'Transmission', 'Filter', 'Chord', 'Collage', 'Signal', 'Assemblage']

// The picker's headings, in order (an unknown one goes last)
const ORDER = [
  'Randomize', 'Layer 1', 'Layer 2', 'Layer 3', 'Layer 4', 'Triggers (what is loaded)', 'Effects', 'Scenes', 'Worlds',
  'Generate', 'Macro', 'Modulators', 'Feel', 'Tempo and sound', 'Sonify', 'Transport', 'Output', 'Session'
]

/** Every trigger worth offering now, grouped in the picker's order. */
export function triggerOptions(st: St = useStore.getState()): SearchOption[] {
  const groups = new Map<string, SearchOption[]>()
  const put = (o: SearchOption): void => {
    const g = o.group ?? ''
    const arr = groups.get(g)
    if (arr) arr.push(o)
    else groups.set(g, [o])
  }
  const core = (group: string, ids: string[]): void => ids.forEach((id) => put({ value: id, label: midiTargetLabel(id), group }))
  core('Randomize', [
    'fire:randomize', 'rand:all', 'rand:sources', 'rand:sourcefx', 'rand:layerfx', 'rand:mods', 'rand:finishing',
    'rand:bg', 'rand:master', 'rand:meta', 'rand:inspector', 'rand:sonify', 'rand:resolume', 'fire:vary',
    'rand:layer:0', 'rand:layer:1', 'rand:layer:2', 'rand:layer:3'
  ])
  core('Effects', ['master:chain'])
  core('Scenes', ['scene:next', 'scene:prev'])
  core('Tempo and sound', ['fire:tap'])
  for (const id of actionIds(st)) {
    const a = actionInfo(id, st)
    if (!a) continue
    const layer = /^act:layer:(\d+):/.exec(id)
    put({ value: id, label: a.label, group: a.group, title: a.title, keywords: layer ? [`L${Number(layer[1]) + 1}`] : undefined })
  }
  st.scenes.forEach((s, i) => put({ value: `scene:${i}`, label: `SCENE ${i + 1}${s.name ? ' · ' + s.name : ''}`, group: 'Scenes' }))
  put({ value: 'fire:sonify', label: midiTargetLabel('fire:sonify'), group: 'Sonify' })
  SONI_VOICE_NAMES.forEach((n, i) => put({ value: `sonify:voice:${i}`, label: `SONIFY ${n} on/off`, group: 'Sonify' }))
  core('Transport', ['fire:flush', 'fire:freeze', 'fire:record', 'fire:seq', 'fire:soniseq', 'fire:keyseq', 'fire:undo', 'fire:redo'])
  core('Session', ['session:new', 'session:load', 'session:open'])
  const named = [...groups.keys()]
  const rank = (g: string): number => (ORDER.includes(g) ? ORDER.indexOf(g) : ORDER.length)
  return named.sort((a, b) => rank(a) - rank(b)).flatMap((g) => groups.get(g)!)
}

/** A trigger's name, saying "(gone)" when what it points at is not there now
 *  (a scene slot past the bank, an effect no longer loaded, a deleted World). */
export function triggerLabel(id: string, st: St = useStore.getState()): string {
  if (id === 'none') return 'nothing'
  const a = actionInfo(id, st)
  if (a) return a.label
  const sc = /^scene:(\d+)$/.exec(id)
  if (sc) {
    const s = st.scenes[Number(sc[1])]
    return s ? `SCENE ${Number(sc[1]) + 1}${s.name ? ' · ' + s.name : ''}` : `SCENE ${Number(sc[1]) + 1} (gone)`
  }
  return midiTargetLabel(id)
}
