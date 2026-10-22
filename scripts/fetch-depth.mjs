// Fetch the AI depth engine into resources/depth, so the next build (npm run
// build:win / build:mac / build:linux) ships it inside the app and Depth AI
// works offline, in a kiosk, on a machine that never reached the internet.
//
//   npm run fetch:depth            download what is missing, verify everything
//   npm run fetch:depth -- --check verify only, download nothing
//
// What it fetches, pinned, from the OFFICIAL sources only :
//   - Transformers.js 3.0.2, its browser ESM build (onnxruntime-web's JavaScript is
//     bundled inside it), from its npm package on cdn.jsdelivr.net;
//   - the WebAssembly runtime that build loads (onnxruntime-web
//     1.21.0-dev.20241024-d9ca84ef96, the version Transformers.js 3.0.2 pins), from
//     onnxruntime-web's own npm package on cdn.jsdelivr.net;
//   - Depth Anything V2 Small as ONNX (onnx-community/depth-anything-v2-small at a
//     fixed revision) from huggingface.co : its config, its preprocessor config, the
//     fp16 weights (WebGPU) and the 8-bit weights (the WebAssembly fallback);
//   - the license files that travel with them.
// Every file is checked against the SHA-256 written below; a file already present
// with the right hash is skipped. huggingface.co hands large files over to its own
// CDN (*.hf.co) by redirect : redirects are followed to those hosts only.
//
// Nothing here is committed to git (resources/depth is ignored, but its README).
// Transformers.js and Depth Anything V2 Small : Apache-2.0. onnxruntime-web : MIT.

import { createHash } from 'crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'resources', 'depth')

const TFJS = '3.0.2'
const ORT = '1.21.0-dev.20241024-d9ca84ef96'
const MODEL = 'onnx-community/depth-anything-v2-small'
const REV = '4472b7362082ad9968fee890ca0f1e5aca36b93d'
const JSD = 'https://cdn.jsdelivr.net/npm'
const HF = `https://huggingface.co/${MODEL}/resolve/${REV}`
const M = `models/${MODEL}`

/** path (under resources/depth) · source URL · size in bytes · SHA-256 */
const FILES = [
  ['transformers.min.js', `${JSD}/@huggingface/transformers@${TFJS}/dist/transformers.min.js`, 748496, '495b03b846b315baab6ff2e2f048085e45684b910799e36c4d7f2b4be00cff72'],
  ['ort-wasm-simd-threaded.jsep.wasm', `${JSD}/onnxruntime-web@${ORT}/dist/ort-wasm-simd-threaded.jsep.wasm`, 21643825, '0f6fe5c40378504d1a25a77f766133464bb15705af23e01c994f185719fb080e'],
  [`${M}/config.json`, `${HF}/config.json`, 38, '3aee5b9bc4f711ee885c2526d871f0c8c6c8c4b26b8e04253d0167f6a83264f5'],
  [`${M}/preprocessor_config.json`, `${HF}/preprocessor_config.json`, 461, '03576db3c13dd0471fdf5f5e1428befcb95de063fe699879150b293dc9e0a2c6'],
  [`${M}/onnx/model_fp16.onnx`, `${HF}/onnx/model_fp16.onnx`, 49642442, '2df6223f206b5164e21f664ace61dabeb9bb6a49b8b5a3e00510b4807d0f5b04'],
  [`${M}/onnx/model_quantized.onnx`, `${HF}/onnx/model_quantized.onnx`, 27258801, 'fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d'],
  ['licenses/transformers.js-LICENSE.txt', `${JSD}/@huggingface/transformers@${TFJS}/LICENSE`, 11358, 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'],
  ['licenses/depth-anything-v2-small-README.md', `${HF}/README.md`, 1578, '2fdd0db4eb5d7725fe0f1522e03a63f0b3c7dc93c805669f3322f665fb3b4c86']
]

// Where a download may START, and where a redirect may lead (Hugging Face's CDN).
const START_HOSTS = new Set(['cdn.jsdelivr.net', 'registry.npmjs.org', 'huggingface.co'])
const hopAllowed = (host) => START_HOSTS.has(host) || host.endsWith('.huggingface.co') || host === 'hf.co' || host.endsWith('.hf.co')

const checkOnly = process.argv.includes('--check')
const mb = (n) => (n / 1048576).toFixed(1) + ' MB'

function sha256File(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej)
  })
}

async function fetchFollow(url) {
  let u = url
  for (let hop = 0; hop < 6; hop++) {
    const host = new URL(u).hostname
    if (hop === 0 ? !START_HOSTS.has(host) : !hopAllowed(host)) throw new Error(`refusing to download from ${host}`)
    const r = await fetch(u, { redirect: 'manual' })
    if (r.status >= 300 && r.status < 400 && r.headers.get('location')) {
      await r.body?.cancel()
      u = new URL(r.headers.get('location'), u).toString()
      continue
    }
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} from ${host}`)
    return r
  }
  throw new Error('too many redirects')
}

async function download(url, out, sha) {
  const part = out + '.part'
  const r = await fetchFollow(url)
  const h = createHash('sha256')
  const w = createWriteStream(part)
  try {
    for await (const chunk of r.body) {
      h.update(chunk)
      if (!w.write(chunk)) await new Promise((res) => w.once('drain', res))
    }
    await new Promise((res, rej) => w.end((e) => (e ? rej(e) : res())))
  } catch (e) {
    w.destroy()
    rmSync(part, { force: true })
    throw e
  }
  const got = h.digest('hex')
  if (got !== sha) {
    rmSync(part, { force: true })
    throw new Error(`SHA-256 mismatch : got ${got}`)
  }
  renameSync(part, out)
}

let bad = 0
let total = 0
for (const [rel, url, size, sha] of FILES) {
  const out = join(dest, rel)
  total += size
  if (existsSync(out) && statSync(out).size === size && (await sha256File(out)) === sha) {
    console.log(`ok       ${rel} (${mb(size)})`)
    continue
  }
  if (checkOnly) {
    console.log(`MISSING  ${rel}`)
    bad++
    continue
  }
  mkdirSync(dirname(out), { recursive: true })
  let err = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      process.stdout.write(`fetch    ${rel} (${mb(size)}) from ${new URL(url).hostname} ... `)
      await download(url, out, sha)
      console.log('verified')
      err = null
      break
    } catch (e) {
      err = e
      console.log(`failed (${e.message})`)
      if (attempt < 3) await new Promise((res) => setTimeout(res, 2000 * attempt))
    }
  }
  if (err) bad++
}

if (bad) {
  rmSync(join(dest, 'manifest.json'), { force: true })
  console.error(`\n${bad} file(s) missing or wrong : Depth AI will say "run npm run fetch:depth" until they are fetched.`)
  process.exit(1)
}

// The app reads this to know the engine is complete (written only when every
// file above is verified).
const manifest = {
  runtime: { 'transformers.js': TFJS, 'onnxruntime-web': ORT },
  model: { id: MODEL, revision: REV, webgpu: 'fp16', wasm: 'q8' },
  files: FILES.map(([path, , bytes, sha256]) => ({ path, bytes, sha256 }))
}
writeFileSync(join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`\nDepth engine complete in resources/depth (${mb(total)}). The next build ships it.`)
