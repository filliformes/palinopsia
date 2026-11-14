// Run by CI before a release build (a v* tag) : what a public release must carry.
// Fails while the Buy Me a Coffee address is not set (npm run support-link <username>).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => (fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), 'utf8') : '')
const problems = []
const m = /export const SUPPORT_URL = '(https:\/\/[^']+)'/.exec(read('src/shared/links.ts'))
if (!m) problems.push('the support address is not set : run `npm run support-link <username | https://…>` and commit')
else {
  const url = m[1]
  if (!/buy_me_a_coffee:|custom:/.test(read('.github/FUNDING.yml'))) problems.push('.github/FUNDING.yml is missing')
  for (const [p, n] of [['README.md', 2], ['docs/index.html', 2]]) {
    const count = read(p).split(url).length - 1
    if (count < n) problems.push(`${p} links the support page ${count} time(s), expected ${n} : run \`npm run support-link\` again`)
  }
}
// The installer copies the description into each Windows shortcut's comment, which
// Windows cuts near 260 characters while keeping the full length : every field after
// it then shifts and the shortcut's icon breaks (a blank page on the desktop and the
// taskbar, every install up to v1.3.3). Keep it to one short sentence.
const description = String(JSON.parse(read('package.json') || '{}').description ?? '')
if (description.length > 200) problems.push(`package.json's description is ${description.length} characters : keep it under 200 (a longer one breaks the Windows shortcuts' icon)`)
if (problems.length) {
  console.error('release check failed :\n  - ' + problems.join('\n  - '))
  process.exit(1)
}
console.log('release check ok')
