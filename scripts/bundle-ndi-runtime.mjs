// Copy the official NDI runtime into resources/ndi/<os>, so the next build
// (npm run build:win / build:mac / build:linux) ships it inside the app and
// NDI works on a machine that has never installed anything NDI.
//
//   node scripts/bundle-ndi-runtime.mjs            find an official install
//   node scripts/bundle-ndi-runtime.mjs --from DIR take it from DIR
//
// Only the OFFICIAL NDI distribution (the NDI SDK, the NDI Runtime or NDI Tools
// from ndi.video) may be redistributed, under the NDI SDK licence. That is why
// this never picks up the copies other apps carry (TouchDesigner, Resolume…),
// which the app itself happily USES at runtime but must not ship.
//
// NDI® is a registered trademark of Vizrt NDI AB (https://ndi.video).

import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const os = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
const libs =
  os === 'win' ? ['Processing.NDI.Lib.x64.dll']
    : os === 'mac' ? ['libndi.dylib']
      : ['libndi.so.6']

const fromArg = process.argv.indexOf('--from')
const dirs = []
if (fromArg > 0 && process.argv[fromArg + 1]) dirs.push(process.argv[fromArg + 1])
else {
  for (const v of ['NDI_RUNTIME_DIR_V6', 'NDI_RUNTIME_DIR_V5']) if (process.env[v]) dirs.push(process.env[v])
  if (os === 'win') {
    const pf = process.env.ProgramFiles || 'C:\\Program Files'
    dirs.push(
      join(pf, 'NDI', 'NDI 6 SDK', 'Bin', 'x64'),
      join(pf, 'NDI', 'NDI 6 Runtime', 'v6'),
      join(pf, 'NDI', 'NDI 6 Tools', 'Runtime')
    )
  } else if (os === 'mac') {
    dirs.push('/Library/NDI SDK for Apple/lib/macOS', '/usr/local/lib')
  } else {
    dirs.push(join(homedir(), 'NDI SDK for Linux', 'lib', process.arch === 'arm64' ? 'aarch64-rpi4-linux-gnueabi' : 'x86_64-linux-gnu'), '/usr/lib', '/usr/local/lib')
  }
}

const src = dirs.find((d) => libs.every((l) => existsSync(join(d, l))))
if (!src) {
  console.error(`No official NDI runtime found. Looked in:\n  ${dirs.join('\n  ')}`)
  console.error('Install the NDI SDK or NDI Tools from https://ndi.video (or pass --from <dir>), then run this again.')
  process.exit(1)
}

const dest = join(root, 'resources', 'ndi', os)
mkdirSync(dest, { recursive: true })
for (const l of libs) copyFileSync(join(src, l), join(dest, l))
// The runtime's third-party licence file travels with it.
for (const f of readdirSync(src)) {
  if (/licen[cs]e/i.test(f) && /\.(txt|md|pdf)$/i.test(f)) copyFileSync(join(src, f), join(dest, f))
}
console.log(`NDI runtime copied from ${src}\n                    to   ${dest}`)
console.log('The next build ships it (resources/ndi in the packaged app).')
