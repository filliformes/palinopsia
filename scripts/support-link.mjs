// Sets Vincent's Buy Me a Coffee address everywhere it appears, from one username :
//
//   npm run support-link <username>        (the part after buymeacoffee.com/)
//   npm run support-link <https://…>       (any payment page : a Stripe Payment Link…)
//   npm run support-link <https://…> --stripe-button <buy_btn_…> <pk_live_…>
//                                          (the site shows Stripe's own button, the
//                                           link stays its fallback)
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
const arg = String(process.argv[2] ?? '').trim()
const bmc = /^https?:\/\/(www\.)?buymeacoffee\.com\//i.test(arg) || /^[A-Za-z0-9_-]{2,64}$/.test(arg)
const user = bmc ? arg.replace(/^https?:\/\/(www\.)?buymeacoffee\.com\//i, '').replace(/\/+$/, '') : ''
const url = bmc ? `https://buymeacoffee.com/${user}` : arg
if ((bmc && !/^[A-Za-z0-9_-]{2,64}$/.test(user)) || (!bmc && !/^https:\/\/[A-Za-z0-9.-]+\/[A-Za-z0-9._~\/?=&%-]*$/.test(url))) {
  console.error('usage : npm run support-link <username | https://…> [--stripe-button <buy_btn_…> <pk_live_…>]')
  process.exit(1)
}
const sb = process.argv.indexOf('--stripe-button')
const stripe = sb > 0 ? { id: String(process.argv[sb + 1] ?? ''), key: String(process.argv[sb + 2] ?? '') } : null
if (stripe && (!/^buy_btn_[A-Za-z0-9]+$/.test(stripe.id) || !/^pk_(live|test)_[A-Za-z0-9]+$/.test(stripe.key))) {
  console.error('--stripe-button needs the buy-button id (buy_btn_…) and the publishable key (pk_live_…)')
  process.exit(1)
}
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
fs.writeFileSync(
  file('.github/FUNDING.yml'),
  `# GitHub's Sponsor button (set by npm run support-link)\n${bmc ? `buy_me_a_coffee: ${user}` : `custom: ["${url}"]`}\n`
)
block('README.md', 'support-top', `\n**Palinopsia is free and open source.** If it plays a part in your work, you can\n[buy its author a coffee ☕](${url}).\n`)
block('README.md', 'support', `\nIf Palinopsia plays a part in your work : [buy me a coffee ☕](${url}).\n`)
block('docs/index.html', 'support-nav', `<a class="link" href="${url}">☕ Support</a>`)
// Stripe's own button on the site when given (its script, from js.stripe.com, only
// on the site, never in the app), the plain link beside it for a blocked script.
const button = stripe
  ? `<script async src="https://js.stripe.com/v3/buy-button.js"></script><div class="support-btn"><stripe-buy-button buy-button-id="${stripe.id}" publishable-key="${stripe.key}"></stripe-buy-button></div>`
  : ''
block('docs/index.html', 'support', `<div class="note">Palinopsia is free and open source, made by one person. If it plays a part in your work, you can <a href="${url}">buy its author a coffee ☕</a>.</div>${button}`)
console.log(`support link set : ${url}`)
