// Run by CI before a release build (a v* tag) : what a public release must carry.
// Fails while the Buy Me a Coffee address is not set (npm run support-link <username>).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (p) => (fs.existsSync(path.join(ROOT, p)) ? fs.readFileSync(path.join(ROOT, p), 'utf8') : '')
const problems = []
const m = /export const SUPPORT_URL = '(https:\/\/buymeacoffee\.com\/[A-Za-z0-9_-]+)'/.exec(read('src/shared/links.ts'))
if (!m) problems.push('the Buy Me a Coffee address is not set : run `npm run support-link <username>` and commit')
else {
  const url = m[1]
  if (!read('.github/FUNDING.yml').includes('buy_me_a_coffee:')) problems.push('.github/FUNDING.yml is missing')
  for (const [p, n] of [['README.md', 2], ['docs/index.html', 2]]) {
    const count = read(p).split(url).length - 1
    if (count < n) problems.push(`${p} links the support page ${count} time(s), expected ${n} : run \`npm run support-link\` again`)
  }
}
if (problems.length) {
  console.error('release check failed :\n  - ' + problems.join('\n  - '))
  process.exit(1)
}
console.log('release check ok')
