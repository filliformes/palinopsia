// node build.cjs : bundle entry.js (the live registry, with its ?raw shader imports) into bundle.js.
// Re-run after every shader or registry edit, then `node h.cjs <port> reload`.
const fs = require('fs'), path = require('path')
const root = path.resolve(__dirname, '../..')
const esbuild = require(path.join(root, 'node_modules/esbuild'))
const raw = {
  name: 'raw',
  setup(b) {
    b.onResolve({ filter: /\?raw$/ }, (a) => ({ path: path.resolve(a.resolveDir, a.path.replace(/\?raw$/, '')), namespace: 'raw' }))
    b.onLoad({ filter: /.*/, namespace: 'raw' }, (a) => ({ contents: fs.readFileSync(a.path, 'utf8'), loader: 'text' }))
  }
}
esbuild.build({
  entryPoints: [path.join(__dirname, 'entry.js')], bundle: true, outfile: path.join(__dirname, 'bundle.js'),
  format: 'iife', plugins: [raw], loader: { '.fs': 'text', '.glsl': 'text', '.vs': 'text' }, logLevel: 'error',
  nodePaths: [path.join(root, 'node_modules')]
}).then(() => console.log('built')).catch((e) => { console.error(String(e).slice(0, 2000)); process.exit(1) })
