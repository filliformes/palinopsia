// node tools/dataflou-test/run.mjs [soak minutes]
//
// The dataflou node against itself : two nodes (and a third in a process of its own,
// killed) in a private universe, on the built module (native/dataflou/build). Needs the
// network's multicast, as the mesh does. With a number : a soak of that many minutes after.

import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..')
const out = path.join(tmpdir(), `opsia-df-test-${process.pid}.cjs`)
await build({
  entryPoints: [path.join(here, 'mesh.ts')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  alias: { '@shared': path.join(repo, 'src', 'shared') },
  logLevel: 'error'
})
spawn(process.execPath, ['--expose-gc', out, ...process.argv.slice(2)], { stdio: 'inherit', env: { ...process.env, DF_ADDON: process.env.DF_ADDON ?? path.join(repo, 'native', 'dataflou', 'build', 'Release', 'dataflou.node') } }).on('exit', (c) => process.exit(c ?? 1))
