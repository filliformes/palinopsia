// The id one of your shaders gets from its name (the Source Editor) : shared by
// main (the Shaders folder : one file per id) and the page (SHADER_BY_ID), so
// "Waves 2", "Waves_2" and "Waves (2)" are one shader, never twins.

export const USER_PREFIX = 'user-'

export function userShaderId(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug) return USER_PREFIX + slug
  // a name with no Latin letter or digit : a short hash keeps such names apart
  let h = 2166136261
  for (const ch of name) {
    h ^= ch.codePointAt(0) ?? 0
    h = Math.imul(h, 16777619) >>> 0
  }
  return `${USER_PREFIX}shader-${h.toString(36)}`
}

/** The name a file can carry (a shader's name IS its file name) : main saves
 *  under it, so the page computes the id from it too (a long name, or one made
 *  of reserved characters, is another shader than its raw spelling says). */
export const fileNameOf = (name: string): string =>
  name.replace(/[\/:*?"<>|\x00-\x1f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'shader'
