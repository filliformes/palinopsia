// What Palinopsia makes of an OSC address that arrives (the connections view) :
//   opsia           an advertised /opsia control (OSCQuery lists it)
//   opsia-unlisted  under /opsia but not advertised : one of the routed families
//                   (a source's or an effect's inputs, triggers…) or a typo
//   learned         a controller's own address, learned (OSC Learn) onto a control
//   alias           a controller's own address mapped onto an /opsia address
//   resolume        the Resolume mapper's (/composition…)
//   unknown         nothing : not mapped (learn it, or map it as an alias)
// Asked once per new (sender, address) while the view is open, never per message.

import { useStore } from './store'
import { oscLeafList } from './oscInput'
import { midiTargetLabel } from './midi'

export interface OscClass {
  kind: 'opsia' | 'opsia-unlisted' | 'learned' | 'alias' | 'resolume' | 'unknown'
  label: string
  detail: string
}

let leaves: Map<string, string> | null = null
let leavesAt = 0

function leafMap(): Map<string, string> {
  const now = performance.now()
  if (!leaves || now - leavesAt > 1000) {
    leaves = new Map(oscLeafList().map((l) => [l.path, l.desc]))
    leavesAt = now
  }
  return leaves
}

export function classifyOscAddress(address: string): OscClass {
  if (address.startsWith('/opsia')) {
    const desc = leafMap().get(address)
    return desc !== undefined
      ? { kind: 'opsia', label: 'opsia', detail: desc || address }
      : { kind: 'opsia-unlisted', label: 'opsia', detail: 'Under /opsia but not advertised : a routed family (an input of a source or effect, a trigger) or a misspelled address' }
  }
  if (address.startsWith('/composition')) return { kind: 'resolume', label: 'Resolume mapper', detail: 'Read by the Resolume mapper (Resolume section)' }
  const st = useStore.getState()
  for (const a of st.oscAliases) {
    if (a.on && a.address === address) return { kind: 'alias', label: `alias → ${a.target}`, detail: `Mapped onto ${a.target} (the map table)` }
  }
  for (const [map, scope] of [[st.sessionOscMap, 'this session'], [st.oscMap, 'this computer']] as const) {
    for (const [id, b] of Object.entries(map)) {
      if (b.address === address) return { kind: 'learned', label: `learned → ${midiTargetLabel(id)}`, detail: `OSC Learn, on ${scope}` }
    }
  }
  return { kind: 'unknown', label: 'not mapped', detail: 'Nothing plays this address : learn it (MIDI Learn, then move the control) or map it (map…)' }
}
