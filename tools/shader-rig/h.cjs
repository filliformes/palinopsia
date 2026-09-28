// Shader rig CLI (see README.md). node h.cjs <port> quit : close the rig.
// node h.cjs <port> check id1,id2 [inputsJSON]
// node h.cjs <port> fxcheck fxid1,fxid2 [inputsJSON]   (FX : fed a moving test card)
// node h.cjs <port> shot id t out.png [inputsJSON] [warm] [w] [h]
// node h.cjs <port> scrub id input a b [t] [inputsJSON]
// node h.cjs <port> reload            (after rebuilding bundle.js)
// node h.cjs <port> eval "<js>"
const fs = require('fs')
const [port, cmd, ...args] = process.argv.slice(2)
async function main() {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const t = list.find((p) => p.type === 'page')
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  let id = 0; const pend = new Map()
  ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.id && pend.has(j.id)) { pend.get(j.id)(j); pend.delete(j.id) } }
  await new Promise((r) => (ws.onopen = r))
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.result && r.result.exceptionDetails) return { exception: r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text }
    return r.result?.result?.value
  }
  let out
  if (cmd === 'quit') {
    // Close the whole rig (Vincent : never leave test instances running).
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
    const bws = new WebSocket(v.webSocketDebuggerUrl)
    await new Promise((r) => (bws.onopen = r))
    bws.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
    await new Promise((r) => setTimeout(r, 300))
    console.log('closed'); ws.close(); return
  }
  if (cmd === 'reload') { await send('Page.reload', { ignoreCache: true }); await new Promise((r) => setTimeout(r, 1500)); out = await ev('typeof H') }
  else if (cmd === 'check') out = await ev(`H.check(${JSON.stringify(args[0].split(','))}, ${args[1] || 'null'})`)
  else if (cmd === 'fxcheck') out = await ev(`H.fxcheck(${JSON.stringify(args[0].split(','))}, ${args[1] || 'null'})`)
  else if (cmd === 'scrub') out = await ev(`H.scrub(${JSON.stringify(args[0])}, ${JSON.stringify(args[1])}, ${+args[2]}, ${+args[3]}, ${args[4] ? +args[4] : 1800}, ${args[5] || 'null'})`)
  else if (cmd === 'shot') {
    const r = await ev(`H.shot(${JSON.stringify(args[0])}, ${+args[1]}, ${args[3] || 'null'}, ${args[4] ? +args[4] : 30}, ${args[5] ? +args[5] : 1920}, ${args[6] ? +args[6] : 1080})`)
    if (r && r.url) { fs.writeFileSync(args[2], Buffer.from(r.url.split(',')[1], 'base64')); out = 'wrote ' + args[2] } else out = r
  } else if (cmd === 'eval') out = await ev(args[0])
  console.log(JSON.stringify(out, null, 1))
  ws.close()
}
main().catch((e) => { console.error(String(e)); process.exit(1) })
