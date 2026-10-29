// Add a session as scenes (Open ▾, or right-click Load) : another session
// file's pictures join the scene bank of the session on screen, which stays as
// it is. What that file opens on becomes one scene named after it; its own
// scenes follow, when you say Yes, as <Name>_Scene1, <Name>_Scene2 … in their
// order. Only pictures come in : the file's Audio Layer, pins, dome, output
// transform, warp, Feel, speed and morph dials, sequencer and Sonify settings
// stay those of the session on screen. Each picture goes through the same migrations as a load
// (normalizeComposition, the World's legacy modulator), the shaders it plays
// enter by the load's rule ("<name> (session)" for a copy that differs from
// yours), its files join the media check. One undo step; Save keeps it.

import type { CompositionState, SceneEntry, Session } from '@shared/types'
import { adoptSessionShaders, normalizeComposition, useStore } from './store'
import { adoptLegacyWorldMod } from './worlds'
import { remapShaderIds, userShaderIdsIn } from './shaders/userShaders'
import { commitNow } from './undo'
import { sessionMedia } from './sessionMedia'
import { showToast } from './components/Toast'

/** "Add them too?" : App answers it with its own Yes / No prompt. */
type Asker = (title: string, detail: string) => Promise<boolean>
let asker: Asker | null = null
export function registerScenesAsker(a: Asker | null): void {
  asker = a
}

const stem = (p: string): string =>
  (p.split(/[\\/]/).pop() ?? p).replace(/\.opsia\.json$/i, '').replace(/\.json$/i, '')

const hasLayers = (c: unknown): boolean =>
  !!c && typeof c === 'object' && Array.isArray((c as CompositionState).layers)

/** `name`, or "name 2", "name 3"… when a scene already has it (`taken` grows). */
export function freeSceneName(name: string, taken: Set<string>): string {
  let out = name
  for (let n = 2; taken.has(out); n++) out = `${name} ${n}`
  taken.add(out)
  return out
}

let busy = false

/** Pick a session file (the Open dialog, or `path` from the session list) and
 *  add it as scenes. A file that is not a session says so; nothing changes. */
export async function addSessionAsScenes(path?: string): Promise<void> {
  if (busy) return
  busy = true
  try {
    let session: unknown
    let file = path ?? ''
    try {
      if (path) session = await window.api.sessionLoad(path)
      else {
        const res = await window.api.sessionOpen()
        if (res === null) return // the dialog was cancelled
        session = res?.session
        file = res?.path ?? ''
      }
    } catch {
      session = undefined
    }
    const label = file ? stem(file) : ''
    if (!session) {
      showToast(`Couldn't read ${label || 'that file'} : it is gone, damaged or not a session`, 'warn', 6000)
      return
    }
    const s = session as Partial<Session>
    await addSessionScenes(s, label || (typeof s.name === 'string' && s.name.trim()) || 'Session')
  } finally {
    busy = false
  }
}

/** Add a session already read. False when nothing was added. */
export async function addSessionScenes(s: Partial<Session>, name: string): Promise<boolean> {
  if (!s || typeof s !== 'object' || !hasLayers(s.composition)) {
    showToast(`Couldn't add ${name} : the file holds no picture to make a scene of`, 'warn', 6000)
    return false
  }
  const own = Array.isArray(s.scenes)
    ? s.scenes.filter((sc): sc is SceneEntry => !!sc && typeof sc === 'object' && hasLayers(sc.composition))
    : []
  // Asked before anything changes, so the whole import is one undo step.
  let withScenes = false
  if (own.length && asker) {
    const n = own.length
    withScenes = await asker(
      `“${name}” has ${n} scene${n === 1 ? '' : 's'}. Add them too?`,
      `Yes adds them after “${name}” as ${name}_Scene1${n > 1 ? `${n === 2 ? ' and' : ' to'} ${name}_Scene${n}` : ''}. No adds “${name}” alone.`
    )
  }

  // What comes in : the picture the file opens on, then its scenes in order.
  // A scene keeps its own World, tags and sound patch (that is the scene); the
  // session's picture takes only its World (the label : the picture already
  // carries its effect). Places on the Surface stay behind (another plane).
  const picked: Array<{ composition: CompositionState; base: Omit<SceneEntry, 'id' | 'name' | 'composition'>; name: string }> = [
    { composition: s.composition as CompositionState, base: { world: s.world ?? null, from: `the session ${name}` }, name }
  ]
  if (withScenes)
    own.forEach((sc, i) => {
      const was = typeof sc.name === 'string' && sc.name.trim() ? sc.name.trim() : ''
      picked.push({
        composition: sc.composition,
        base: {
          world: sc.world ?? null,
          ...(sc.tags ? { tags: sc.tags } : {}),
          ...(sc.sonify ? { sonify: sc.sonify } : {}),
          from: was ? `“${was}” in ${name}` : name
        },
        name: `${name}_Scene${i + 1}`
      })
    })

  // Its own shaders, only those these pictures play, by the load's rule.
  const remap = adoptSessionShaders(s.userShaders, userShaderIdsIn(picked.map((p) => p.composition)))
  // (a scene of the file with no picture in it : not asked about, counted here)
  let failed = withScenes && Array.isArray(s.scenes) ? s.scenes.length - own.length : 0
  let mainIn = 0 // (the session's own picture read : the "1 +" of the toast)
  const ready: typeof picked = []
  for (const [i, p] of picked.entries()) {
    try {
      const c = remap.size ? remapShaderIds(p.composition, remap) : p.composition
      ready.push({ ...p, composition: adoptLegacyWorldMod(normalizeComposition(c)) })
      if (i === 0) mainIn = 1
    } catch (e) {
      failed++
      console.warn(`[session] ${p.name} could not be read:`, (e as Error).message)
    }
  }
  if (!ready.length) {
    showToast(`Couldn't add ${name} : its pictures could not be read`, 'warn', 6000)
    return false
  }

  commitNow() // an edit still settling stays its own step
  useStore.setState((st) => {
    const taken = new Set(st.scenes.map((x) => x.name))
    const added: SceneEntry[] = ready.map((p) => ({
      id: crypto.randomUUID(),
      ...p.base,
      name: freeSceneName(p.name, taken),
      composition: p.composition
    }))
    return { scenes: [...st.scenes, ...added] }
  })
  commitNow() // the whole import : one step

  // its films, sound files and Collage folders join the session's media check
  void sessionMedia.check()

  const scenesIn = ready.length - mainIn
  const count = withScenes ? (mainIn ? `1 + ${scenesIn}` : `${scenesIn}`) : '1'
  const total = ready.length
  showToast(
    `Added ${count} scene${total === 1 ? '' : 's'} from ${name}${failed ? ` (${failed} could not be read)` : ''}`,
    failed ? 'warn' : 'ok',
    failed ? 6000 : 3400
  )
  return true
}
