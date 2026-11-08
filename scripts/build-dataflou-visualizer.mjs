// npm run build:visualizer [path to a dataflou checkout's web/ folder]
//
// Builds the dataflou project's mesh visualizer page into
// resources/dataflou-visualizer, where Palinopsia serves it (the dataflou section's
// "visualizer" button, src/main/dataflou/visualizer.ts). Default source : the
// dataflou checkout beside this repo (../124_dataflou/web).
//
// The page's editor panel comes from a sibling project of dataflou (Atelier) :
// when that project is not there, its imports are answered by a small stand-in
// (scripts/dataflou-visualizer-atelier-stub.ts) and the page runs without the panel.
//
// The output is committed and ships with the app : the page belongs to the
// dataflou project and travels with Palinopsia with its author's permission
// (2026-11-07; see THIRD_PARTY_NOTICES.md). Rebuild it when dataflou's page changes.

import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { execFileSync } from 'child_process'
import { fileURLToPath } from 'url'

const here = dirname(fileURLToPath(import.meta.url))
const repo = resolve(here, '..')
const web = resolve(process.argv[2] ?? join(repo, '..', '124_dataflou', 'web'))
const out = join(repo, 'resources', 'dataflou-visualizer')
const stub = join(here, 'dataflou-visualizer-atelier-stub.ts')

if (!existsSync(join(web, 'index.html')) || !existsSync(join(web, 'src', 'main.ts'))) {
  console.error(`no dataflou visualizer at ${web} (give the path to a dataflou checkout's web/ folder)`)
  process.exit(1)
}
const atelier = resolve(web, '..', '..', '125_atelier', 'editor', 'src', 'editor.ts')
const withAtelier = existsSync(atelier)

rmSync(out, { recursive: true, force: true })
mkdirSync(join(out, 'js'), { recursive: true })
for (const f of ['index.html', 'style.css', 'lib']) cpSync(join(web, f), join(out, f), { recursive: true })

await build({
  entryPoints: [join(web, 'src', 'main.ts')],
  bundle: true,
  format: 'esm',
  outfile: join(out, 'js', 'app.js'),
  external: ['d3'],
  logLevel: 'warning',
  plugins: withAtelier
    ? []
    : [{ name: 'atelier-stand-in', setup(b) { b.onResolve({ filter: /125_atelier[\\/]editor[\\/]src[\\/](editor|types[\\/]messages)$/ }, () => ({ path: stub })) } }]
})

let commit = 'unknown'
try {
  commit = execFileSync('git', ['-C', web, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
} catch {
  /* not a git checkout */
}
writeFileSync(
  join(out, 'SOURCE.md'),
  `# dataflou mesh visualizer\n\nThe dataflou project's web visualizer, by Alexandre Burton (Artificiel), built from\n` +
    `the dataflou repository's web/ folder at commit ${commit}${withAtelier ? '' : ', without the Atelier editor panel (that project was not there)'}.\n` +
    `Served by Palinopsia (src/main/dataflou/visualizer.ts). Not part of Palinopsia's own code : it travels\n` +
    `with Palinopsia with its author's permission (see THIRD_PARTY_NOTICES.md). d3 (lib/) : ISC License, Mike Bostock.\n`
)
console.log(`visualizer built into ${out} from ${web} @ ${commit}${withAtelier ? '' : ' (Atelier panel left out)'}`)
