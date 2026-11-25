// node scripts/vendor-dataflou.mjs <dataflou checkout> <commit> <dependencies folder>
//
// Refreshes native/dataflou/sdk : the dataflou core, its desktop platform layer and
// its C interface at one pinned commit, with the libraries they compile (etl, QCBOR,
// cJSON, asio, mdns) at the tags dataflou's own CMakeLists pins. Only the files the
// addon compiles are taken : the sources listed below and every header they reach
// (the #include lines are followed whatever their #if, so the other platforms'
// headers come too). Nothing is downloaded : <dependencies folder> holds
// etl-src, qcbor-src, cjson-src, asio-src and mdns-src, as a CMake configure of the
// dataflou checkout fetches them (its _deps folder). See native/dataflou/VENDOR.md.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const [checkout, commit, deps] = process.argv.slice(2)
if (!checkout || !commit || !deps) {
  console.error('usage : node scripts/vendor-dataflou.mjs <dataflou checkout> <commit> <dependencies folder>')
  process.exit(1)
}
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(repo, 'native', 'dataflou', 'sdk')

// the commit's own files, whatever the checkout's working tree and line endings
const src = fs.mkdtempSync(path.join(os.tmpdir(), 'df-vendor-'))
const tar = path.join(src, 'a.tar')
execFileSync('git', ['-C', checkout, 'archive', '--format=tar', '-o', tar, commit, 'LICENSE', 'CMakeLists.txt', 'include', 'src', 'capi'])
execFileSync('tar', ['-xf', 'a.tar'], { cwd: src })
fs.rmSync(tar)

const LIBS = {
  dataflou: { root: src, include: ['include', 'src/pal', 'capi/include'], license: 'LICENSE', tag: null },
  etl: { root: path.join(deps, 'etl-src'), include: ['include'], license: 'LICENSE', tag: 'etl' },
  qcbor: { root: path.join(deps, 'qcbor-src'), include: ['inc'], license: 'LICENSE', tag: 'qcbor' },
  cjson: { root: path.join(deps, 'cjson-src'), include: ['.'], license: 'LICENSE', tag: 'cjson' },
  asio: { root: path.join(deps, 'asio-src'), include: ['asio/include'], license: 'LICENSE_1_0.txt', tag: 'asio' },
  mdns: { root: path.join(deps, 'mdns-src'), include: ['.'], license: 'LICENSE', tag: 'mdns' }
}
const CORE = ['param', 'world_view', 'protocol', 'config_loader', 'node', 'node_peers', 'node_messages', 'node_storage', 'node_connections', 'node_populations', 'node_picks', 'node_signals', 'node_instances', 'node_streams', 'node_clock', 'stream_codec', 'memory_config']
const PAL = ['tcp_asio', 'udp_asio', 'mdns_mjansson', 'clock_std', 'storage_file', 'platform_desktop', 'world_json', 'config_json', 'state_json']
const CAPI = ['node', 'params', 'world', 'connections', 'populations', 'state', 'mesh']
const START = [
  ...CORE.map((f) => ['dataflou', `src/core/${f}.cpp`]),
  ...PAL.map((f) => ['dataflou', `src/pal/desktop/${f}.cpp`]),
  ['dataflou', 'src/pal/apple/mdns_dnssd.cpp'],
  ['dataflou', 'src/pal/desktop/fine_timer.h'],
  ...CAPI.map((f) => ['dataflou', `capi/src/${f}.cpp`]),
  ['qcbor', 'src/UsefulBuf.c'], ['qcbor', 'src/ieee754.c'], ['qcbor', 'src/qcbor_decode.c'], ['qcbor', 'src/qcbor_encode.c'], ['qcbor', 'src/qcbor_err_to_str.c'],
  ['cjson', 'cJSON.c']
]

const seen = new Set()
const queue = []
const take = (lib, rel) => {
  rel = path.posix.normalize(rel)
  const k = `${lib}\n${rel}`
  if (seen.has(k) || !fs.existsSync(path.join(LIBS[lib].root, rel))) return seen.has(k)
  seen.add(k)
  queue.push([lib, rel])
  return true
}
for (const [lib, rel] of START) if (!take(lib, rel)) throw new Error(`${lib}/${rel} is not there`)
while (queue.length) {
  const [lib, rel] = queue.pop()
  const text = fs.readFileSync(path.join(LIBS[lib].root, rel), 'utf8')
  for (const m of text.matchAll(/^[ \t]*#[ \t]*include[ \t]*[<"]([^>"\n]+)[>"]/gm)) {
    const inc = m[1]
    if (take(lib, path.posix.join(path.posix.dirname(rel), inc))) continue
    for (const [l, c] of Object.entries(LIBS)) {
      if (c.include.some((d) => take(l, path.posix.join(d, inc)))) break
    }
  }
}

fs.rmSync(out, { recursive: true, force: true })
const counts = {}
const copy = (lib, rel) => {
  const to = path.join(out, lib, rel)
  fs.mkdirSync(path.dirname(to), { recursive: true })
  // (LF, as the sources have them : a checkout's line endings do not matter)
  fs.writeFileSync(to, fs.readFileSync(path.join(LIBS[lib].root, rel), 'utf8').replace(/\r\n/g, '\n'))
  counts[lib] = (counts[lib] ?? 0) + 1
}
for (const k of seen) copy(...k.split('\n'))
for (const [lib, c] of Object.entries(LIBS)) copy(lib, fs.existsSync(path.join(c.root, c.license)) ? c.license : 'asio/LICENSE_1_0.txt')

// the pins, read from what was taken
const cmake = fs.readFileSync(path.join(src, 'CMakeLists.txt'), 'utf8')
const tagOf = (name) => new RegExp(String.raw`FetchContent_Declare\(${name}\s+GIT_REPOSITORY\s+(\S+)\s+GIT_TAG\s+(\S+)`).exec(cmake)
const head = (d) => {
  try {
    return execFileSync('git', ['-C', d, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return '?'
  }
}
const full = execFileSync('git', ['-C', checkout, 'rev-parse', commit], { encoding: 'utf8' }).trim()
const rows = Object.entries(LIBS).map(([lib, c]) => {
  const t = c.tag ? tagOf(c.tag) : null
  return `| ${lib} | ${t ? `${t[2]} (${head(c.root).slice(0, 12)})` : full} | ${t ? t[1] : 'the dataflou repository (private gitlab)'} | ${counts[lib]} |`
})
fs.writeFileSync(path.join(out, 'PINS.md'), `# What is vendored here\n\nWritten by scripts/vendor-dataflou.mjs. No file is changed (line endings aside).\n\n| library | version | from | files |\n|---|---|---|---|\n${rows.join('\n')}\n`)
fs.rmSync(src, { recursive: true, force: true })
console.log(counts)
