// Checks catalog/catalog.json, the list of community works (CONTRIBUTING.md) :
//   node scripts/catalog-check.mjs     (npm run check:catalog, run by CI)
//
// An entry points to a file in its author's own public GitHub repository, pinned
// to a full commit hash (what was reviewed is what people get). It must carry an
// author, a license Palinopsia's rules accept (CLAUDE.md : no non-commercial, no
// no-derivatives, no CC BY 3.0 or older, no unlicensed work), and the credits of
// anything inside it that is someone else's.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const KINDS = ['shader', 'sonify-generator', 'visual-mapper', 'effect']
// SPDX ids accepted for a community work (permissive, copyleft, public domain, and
// the Creative Commons licenses compatible with sharing and remixing).
const LICENSES = [
  'MIT', 'MIT-0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC', 'Zlib', 'Apache-2.0', '0BSD', 'Unlicense', 'CC0-1.0',
  'GPL-2.0-or-later', 'GPL-3.0-only', 'GPL-3.0-or-later', 'LGPL-2.1-or-later', 'LGPL-3.0-or-later',
  'MPL-2.0', 'CC-BY-4.0', 'CC-BY-SA-4.0'
]
const FIELDS = { id: 'string', name: 'string', kind: 'string', author: 'string', repo: 'string', path: 'string', commit: 'string', license: 'string', description: 'string', added: 'string' }

const problems = []
let cat
try {
  cat = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog/catalog.json'), 'utf8'))
} catch (e) {
  console.error(`catalog/catalog.json is not valid JSON : ${e.message}`)
  process.exit(1)
}
if (cat.format !== 1 || !Array.isArray(cat.entries)) problems.push('catalog.json must have "format": 1 and an "entries" array')
const ids = new Set()
for (const [i, e] of (cat.entries ?? []).entries()) {
  const at = `entry ${i}${e && e.id ? ` (${e.id})` : ''}`
  if (!e || typeof e !== 'object') { problems.push(`${at} is not an object`); continue }
  for (const [k, t] of Object.entries(FIELDS)) if (typeof e[k] !== t || !String(e[k]).trim()) problems.push(`${at} : "${k}" is missing`)
  for (const k of Object.keys(e)) if (!(k in FIELDS) && !['credits', 'homepage', 'min_palinopsia', 'preview'].includes(k)) problems.push(`${at} : unknown field "${k}"`)
  if (typeof e.id === 'string') {
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)) problems.push(`${at} : "id" must be lowercase-with-dashes`)
    if (ids.has(e.id)) problems.push(`${at} : the id "${e.id}" is already taken`)
    ids.add(e.id)
  }
  if (e.kind && !KINDS.includes(e.kind)) problems.push(`${at} : "kind" must be one of ${KINDS.join(', ')}`)
  if (e.repo && !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(e.repo)) problems.push(`${at} : "repo" must be owner/name on GitHub`)
  if (e.commit && !/^[0-9a-f]{40}$/.test(e.commit)) problems.push(`${at} : "commit" must be a full 40-character commit hash (not a branch or tag)`)
  if (e.path && (/^\/|\.\.|\\/.test(e.path))) problems.push(`${at} : "path" must be a plain path inside the repository`)
  if (e.kind === 'shader' && e.path && !/\.(fs|frag|glsl|isf)$/i.test(e.path)) problems.push(`${at} : a shader's "path" ends in .fs, .frag, .glsl or .isf`)
  if (e.license && !LICENSES.includes(e.license)) problems.push(`${at} : license "${e.license}" is not accepted (see CONTRIBUTING.md : ${LICENSES.join(', ')})`)
  if (e.added && !/^\d{4}-\d{2}-\d{2}$/.test(e.added)) problems.push(`${at} : "added" is a date, YYYY-MM-DD`)
  if (e.credits !== undefined && !(Array.isArray(e.credits) && e.credits.every((c) => typeof c === 'string' && c.trim()))) problems.push(`${at} : "credits" is a list of lines (who and what, with their license)`)
}
if (problems.length) {
  console.error(`catalog check failed (${problems.length}) :\n  - ` + problems.join('\n  - '))
  process.exit(1)
}
console.log(`catalog ok : ${cat.entries.length} entries`)
