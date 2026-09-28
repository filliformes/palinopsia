// node build.cjs [--out <dir>] : bundle entry.js (the live registry, with its ?raw shader
// imports) into bundle.js. Re-run after every shader or registry edit, then
// `node h.cjs <port> reload`. With --out, the runnable rig (page, main, CLI and bundle) is
// written to <dir> instead, so parallel users never overwrite each other's bundle; launch
// electron from <dir>.
const fs = require('fs'), path = require('path')
const root = path.resolve(__dirname, '../..')
const oi = process.argv.indexOf('--out')
const outDir = oi > 0 ? path.resolve(process.argv[oi + 1]) : __dirname
if (outDir !== __dirname) {
  fs.mkdirSync(outDir, { recursive: true })
  for (const f of ['index.html', 'page.js', 'main.js', 'h.cjs', 'package.json']) fs.copyFileSync(path.join(__dirname, f), path.join(outDir, f))
}
const esbuild = require(path.join(root, 'node_modules/esbuild'))
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
esbuild.build({
  entryPoints: [path.join(__dirname, 'entry.js')], bundle: true, outfile: path.join(outDir, 'bundle.js'),
  format: 'iife', plugins: [raw], loader: { '.fs': 'text', '.glsl': 'text', '.vs': 'text' }, logLevel: 'error',
  nodePaths: [path.join(root, 'node_modules')]
}).then(() => console.log('built')).catch((e) => { console.error(String(e).slice(0, 2000)); process.exit(1) })
