// Sets Vincent's Buy Me a Coffee address everywhere it appears, from one username :
//
//   npm run support-link <username>        (the part after buymeacoffee.com/)
//
// - src/shared/links.ts : SUPPORT_URL (the app's ☕ button in the top bar);
// - .github/FUNDING.yml : GitHub's Sponsor button on the repository;
// - README.md : a line under the introduction and one in Credits & license;
// - docs/index.html : a link in the site's top bar and a line under the downloads.
// Run it again with another username to change it. scripts/release-check.mjs
// fails a release build while any of these is missing.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const user = String(process.argv[2] ?? '').trim().replace(/^https?:\/\/(www\.)?buymeacoffee\.com\//i, '').replace(/\/+$/, '')
if (!/^[A-Za-z0-9_-]{2,64}$/.test(user)) {
  console.error('usage : npm run support-link <username>   (the part after buymeacoffee.com/)')
  process.exit(1)
}
const url = `https://buymeacoffee.com/${user}`
const file = (p) => path.join(ROOT, p)
function block(p, tag, body) {
  const s = fs.readFileSync(file(p), 'utf8')
  const re = new RegExp(`(<!-- ${tag} -->)[\\s\\S]*?(<!-- /${tag} -->)`)
  if (!re.test(s)) throw new Error(`${p} has no <!-- ${tag} --> block`)
  fs.writeFileSync(file(p), s.replace(re, `$1${body}$2`))
}

const links = fs.readFileSync(file('src/shared/links.ts'), 'utf8')
fs.writeFileSync(file('src/shared/links.ts'), links.replace(/export const SUPPORT_URL = '[^']*'/, `export const SUPPORT_URL = '${url}'`))
fs.mkdirSync(file('.github'), { recursive: true })
fs.writeFileSync(file('.github/FUNDING.yml'), `# GitHub's Sponsor button (set by npm run support-link)\nbuy_me_a_coffee: ${user}\n`)
block('README.md', 'support-top', `\n**Palinopsia is free and open source.** If it plays a part in your work, you can\n[buy its author a coffee ☕](${url}).\n`)
block('README.md', 'support', `\nIf Palinopsia plays a part in your work : [buy me a coffee ☕](${url}).\n`)
block('docs/index.html', 'support-nav', `<a class="link" href="${url}">☕ Support</a>`)
block('docs/index.html', 'support', `<div class="note">Palinopsia is free and open source, made by one person. If it plays a part in your work, you can <a href="${url}">buy its author a coffee ☕</a>.</div>`)
console.log(`support link set : ${url}`)
