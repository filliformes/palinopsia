// Fetch the Room tracker into resources/pose, so the next build (npm run
// build:win / build:mac / build:linux) ships it inside the app and the Body page's
// Room tracker works offline, in a kiosk, on a machine that never reached the
// internet.
//
//   npm run fetch:pose            download what is missing, verify everything
//   npm run fetch:pose -- --check verify only, download nothing
//
// What it fetches, pinned, from the OFFICIAL sources only :
//   - onnxruntime-web 1.30.0, its WebGPU build (the module, its loader and its
//     WebAssembly), from its npm package on cdn.jsdelivr.net;
//   - RTMO-s (OpenMMLab MMPose, one-stage multi-person pose, body7, 640 x 640) as
//     ONNX, from OpenMMLab's own download server (download.openmmlab.com) : the
//     zip it publishes, of which only end2end.onnx is kept, unpacked here with
//     Node's zlib (no unzip tool needed);
//   - the license files that travel with them (onnxruntime's from its repository at
//     v1.30.0, MMPose's at v1.3.2).
// Every file (and the zip) is checked against the SHA-256 written below; a file
// already present with the right hash is skipped. No redirect is followed.
//
// Nothing here is committed to git (resources/pose is ignored, but its README).
// onnxruntime-web : MIT. RTMO and MMPose : Apache-2.0 (see THIRD_PARTY_NOTICES.md).

import { createHash } from 'crypto'
import { createReadStream, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { inflateRawSync } from 'zlib'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'resources', 'pose')

const ORT = '1.30.0'
const JSD = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT}/dist`
const RTMO_ZIP = 'https://download.openmmlab.com/mmpose/v1/projects/rtmo/onnx_sdk/rtmo-s_8xb32-600e_body7-640x640-dac2bf74_20231211.zip'

/** path (under resources/pose) · source URL · size in bytes · SHA-256 · [zip : its size, its SHA-256, the entry] */
const FILES = [
  ['ort.webgpu.min.mjs', `${JSD}/ort.webgpu.min.mjs`, 66349, '3dffff71811bc13a3a3d9591c57ca5ee5735b8f5f3eaf789510b02bb040ae3a0'],
  ['ort-wasm-simd-threaded.asyncify.mjs', `${JSD}/ort-wasm-simd-threaded.asyncify.mjs`, 53057, '3d1c85995364bb643302fc6fd877a0c3ba5ae72401815e0f24828a53d9191e28'],
  ['ort-wasm-simd-threaded.asyncify.wasm', `${JSD}/ort-wasm-simd-threaded.asyncify.wasm`, 26781914, '39f9f0894d478800487ed9f7dbe92618498db320cf55c8e3d89adff8dce658da'],
  ['models/rtmo-s.onnx', RTMO_ZIP, 39617685, 'd0703d40d19f3921da51ae725402d5fdae4d2478c7442072d3101bd396f370d8', [36442532, '3da7ad88b209f9da8be87ba5c325610639af04de3b5c8a96649b98cd9e2848a2', 'end2end.onnx']],
  ['licenses/onnxruntime-web-LICENSE.txt', `https://raw.githubusercontent.com/microsoft/onnxruntime/v${ORT}/LICENSE`, 1073, '2f07c72751aed99790b8a4869cf2311df85a860b22ded05fa22803587a48922c'],
  ['licenses/mmpose-LICENSE.txt', 'https://raw.githubusercontent.com/open-mmlab/mmpose/v1.3.2/LICENSE', 11400, 'aa2c6f3408169b96e5547c875deb481c91502514c1885fa0acb4b596c8909cb9']
]

const HOSTS = new Set(['cdn.jsdelivr.net', 'download.openmmlab.com', 'raw.githubusercontent.com'])
const checkOnly = process.argv.includes('--check')
const mb = (n) => (n / 1048576).toFixed(1) + ' MB'
const sha = (buf) => createHash('sha256').update(buf).digest('hex')

function sha256File(path) {
  return new Promise((res, rej) => {
    const h = createHash('sha256')
    createReadStream(path).on('data', (d) => h.update(d)).on('end', () => res(h.digest('hex'))).on('error', rej)
  })
}

async function get(url) {
  const host = new URL(url).hostname
  if (!HOSTS.has(host)) throw new Error(`refusing to download from ${host}`)
  const r = await fetch(url, { redirect: 'error' })
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${host}`)
  return Buffer.from(await r.arrayBuffer())
}

/** One entry of a zip (stored or deflated), read from its central directory. */
function unzipEntry(zip, name) {
  let eocd = -1
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('not a zip')
  const count = zip.readUInt16LE(eocd + 10)
  let p = zip.readUInt32LE(eocd + 16)
  for (let n = 0; n < count; n++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip directory')
    const method = zip.readUInt16LE(p + 10)
    const csize = zip.readUInt32LE(p + 20)
    const nameLen = zip.readUInt16LE(p + 28)
    const extraLen = zip.readUInt16LE(p + 30)
    const commentLen = zip.readUInt16LE(p + 32)
    const local = zip.readUInt32LE(p + 42)
    const entry = zip.toString('utf8', p + 46, p + 46 + nameLen)
    if (entry === name) {
      if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error('bad zip entry')
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
      const data = zip.subarray(start, start + csize)
      if (method === 0) return Buffer.from(data)
      if (method === 8) return inflateRawSync(data)
      throw new Error(`zip method ${method} not handled`)
    }
    p += 46 + nameLen + extraLen + commentLen
  }
  throw new Error(`${name} not in the zip`)
}

async function fetchOne([rel, url, size, want, zip]) {
  const out = join(dest, rel)
  let buf
  if (zip) {
    const [zsize, zsha, entry] = zip
    const z = await get(url)
    if (z.length !== zsize || sha(z) !== zsha) throw new Error(`the zip's SHA-256 does not match (got ${sha(z)})`)
    buf = unzipEntry(z, entry)
  } else {
    buf = await get(url)
  }
  if (buf.length !== size || sha(buf) !== want) throw new Error(`SHA-256 mismatch : got ${sha(buf)}`)
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out + '.part', buf)
  renameSync(out + '.part', out)
}

let bad = 0
let total = 0
for (const f of FILES) {
  const [rel, url, size, want] = f
  const out = join(dest, rel)
  total += size
  if (existsSync(out) && statSync(out).size === size && (await sha256File(out)) === want) {
    console.log(`ok       ${rel} (${mb(size)})`)
    continue
  }
  if (checkOnly) {
    console.log(`MISSING  ${rel}`)
    bad++
    continue
  }
  let err = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      process.stdout.write(`fetch    ${rel} (${mb(size)}) from ${new URL(url).hostname} ... `)
      await fetchOne(f)
      console.log('verified')
      err = null
      break
    } catch (e) {
      err = e
      console.log(`failed (${e.message})`)
      rmSync(out + '.part', { force: true })
      if (attempt < 3) await new Promise((res) => setTimeout(res, 2000 * attempt))
    }
  }
  if (err) bad++
}

if (bad) {
  rmSync(join(dest, 'manifest.json'), { force: true })
  console.error(`\n${bad} file(s) missing or wrong : the Room tracker will say "run npm run fetch:pose" until they are fetched.`)
  process.exit(1)
}

// The app reads this to know the tracker is complete (written only when every
// file above is verified).
const manifest = {
  runtime: { 'onnxruntime-web': ORT },
  model: { id: 'rtmo-s_8xb32-600e_body7-640x640', source: RTMO_ZIP },
  files: FILES.map(([path, , bytes, sha256]) => ({ path, bytes, sha256 }))
}
writeFileSync(join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
console.log(`\nRoom tracker complete in resources/pose (${mb(total)}). The next build ships it.`)
