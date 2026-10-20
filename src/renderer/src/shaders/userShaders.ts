// Your own shaders (the Source Editor) in the running app : each is entered
// in SHADER_BY_ID under `user-<name>`, so every lookup (the compositor's
// sources, the Inspector's controls, OSC) finds it like a built-in; the menus
// add them as "my shaders" from the store's list. Saving a new version of one
// that plays asks the compositor to load it again (it only reloads on an id
// change otherwise).

import { SHADER_BY_ID, type IsfShader } from './isf'
import { invalidateInputs } from './isf/inputs'
import { USER_PREFIX, userShaderId } from '@shared/userShaderId'

export { USER_PREFIX, userShaderId }

export interface UserShaderInfo {
  id: string
  name: string
  category: 'Generator' | 'FX'
  fromSession?: boolean // carried by a session, not (yet) a file in the Shaders folder
}

export const isUserShader = (id: string | null | undefined): boolean => !!id && id.startsWith(USER_PREFIX)

/** A generator or an effect : an effect reads the picture under it (an image
 *  input named inputImage) or says it is one (CATEGORIES). */
export function categoryOf(source: string): 'Generator' | 'FX' {
  const m = source.match(/\/\*\s*(\{[\s\S]*?\})\s*\*\//)
  if (!m) return 'Generator'
  try {
    const j = JSON.parse(m[1]) as { INPUTS?: Array<{ NAME?: string; TYPE?: string }>; CATEGORIES?: string[] }
    if ((j.INPUTS ?? []).some((i) => i.NAME === 'inputImage' && i.TYPE === 'image')) return 'FX'
    if ((j.CATEGORIES ?? []).some((c) => /^(fx|effect|filter|stylize)$/i.test(c))) return 'FX'
  } catch { /* a broken header : it reads as a generator until fixed */ }
  return 'Generator'
}

const reloads = new Set<string>()

/** Enter (or update) one of your shaders. A new source for an id already
 *  playing is reloaded on the next frame. */
export function registerUserShader(name: string, source: string, fromSession = false): UserShaderInfo {
  const id = userShaderId(name)
  const category = categoryOf(source)
  const prev = SHADER_BY_ID[id]
  SHADER_BY_ID[id] = { id, name, category, source, user: true } as IsfShader
  invalidateInputs(id)
  // a new source, or one coming back after a delete : where it plays loads it
  if (!prev || prev.source !== source) reloads.add(id)
  return { id, name, category, fromSession }
}

export function unregisterUserShader(id: string): void {
  if (!isUserShader(id)) return
  delete SHADER_BY_ID[id]
  invalidateInputs(id)
  reloads.add(id)
}

/** The ids whose source changed since the last call (the App loop hands them
 *  to the compositor). */
export function takeShaderReloads(): string[] {
  if (!reloads.size) return []
  const a = [...reloads]
  reloads.clear()
  return a
}

/** A copy of `value` with its shader ids renamed (`map` : old id → new) : a
 *  session's own version of a shader you also have, played under its own id. */
export function remapShaderIds<T>(value: T, map: Map<string, string>): T {
  const walk = (v: unknown, depth: number): unknown => {
    if (!v || typeof v !== 'object' || depth > 12) return v
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1))
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = k === 'shaderId' && typeof x === 'string' && map.has(x) ? map.get(x) : walk(x, depth + 1)
    }
    return out
  }
  return walk(value, 0) as T
}

/** Every one of your shaders a value refers to (any `shaderId` in it, deep) :
 *  what a session must carry. */
export function userShaderIdsIn(value: unknown, out = new Set<string>()): Set<string> {
  const walk = (v: unknown, depth: number): void => {
    if (!v || typeof v !== 'object' || depth > 12) return
    if (Array.isArray(v)) { for (const x of v) walk(x, depth + 1); return }
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'shaderId' && typeof x === 'string' && isUserShader(x)) out.add(x)
      else if (x && typeof x === 'object') walk(x, depth + 1)
    }
  }
  walk(value, 0)
  return out
}
