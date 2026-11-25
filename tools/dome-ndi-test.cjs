// Dome + NDI, measured : the sender in an ISOLATED test copy, a bare NDI receiver
// beside it (no player, no window), and the numbers of both.
//
//   OPSIA_UNTHROTTLED=1 bash tools/test-build.sh 9585        (the copy, from this checkout)
//   node tools/dome-ndi-test.cjs                             the usual table (light scene + 3 themes, 4096², 2048², flat)
//   node tools/dome-ndi-test.cjs --scenes light,dome-aurora  these scenes only ('light', or a Generate theme id)
//   node tools/dome-ndi-test.cjs --soak 300                  one scene for that many seconds : memory growth, worst gap
//   node tools/dome-ndi-test.cjs --ops                       what a show does to it : on/off 20 times, dome sizes,
//                                                            rates, formats, a session load, a reload, minimized, flat
//   bash tools/test-build.sh 9585 stop
//
// Options : --port 9585 · --secs 10 · --fps 60 · --size 4096 · --format uyvy|rgbx · --norecv · --quick
//           --comps <dir> : keep each scene's composition there, and reuse it on the next
//           run (two builds compared on the very same pictures) · --json <file>
// The source is named "Opsia test dome" and the receiver connects to that name
// only : never to a real source on the network. Nothing here touches the user's
// app or settings. Needs the NDI runtime.

const fs = require('fs')
const path = require('path')
const { spawn, execFileSync } = require('child_process')

const NAME = 'Opsia test dome'
const argv = process.argv.slice(2)
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1] }
const has = (k) => argv.includes('--' + k)

// ── The receiver (a child process) ───────────────────────────────────────────

function runtimePath() {
  for (const v of ['NDI_RUNTIME_DIR_V6', 'NDI_RUNTIME_DIR_V5']) if (process.env[v] && process.platform === 'win32') return path.join(process.env[v], 'Processing.NDI.Lib.x64.dll')
  if (process.platform === 'win32') return 'C:/Program Files/NDI/NDI 6 Runtime/v6/Processing.NDI.Lib.x64.dll'
  return process.platform === 'darwin' ? '/usr/local/lib/libndi.dylib' : 'libndi.so.6'
}

function receiver(name, secs) {
  const koffi = require(path.join(__dirname, '..', 'node_modules', 'koffi'))
  const L = koffi.load(runtimePath())
  koffi.struct('F', { show: 'bool', g: 'const char *', ips: 'const char *' })
  koffi.struct('S', { name: 'const char *', url: 'const char *' })
  koffi.struct('R', { src: 'S', cf: 'int', bw: 'int', fields: 'bool', n: 'const char *' })
  koffi.struct('V', { xres: 'int', yres: 'int', cc: 'uint32_t', N: 'int', D: 'int', ar: 'float', ft: 'int', tc: 'int64_t', p: 'void *', stride: 'int', md: 'const char *', ts: 'int64_t' })
  koffi.struct('Q', { v: 'int64_t', a: 'int64_t', m: 'int64_t' })
  const init = L.func('bool NDIlib_initialize()')
  const fc = L.func('void *NDIlib_find_create_v2(const F*)')
  const fw = L.func('bool NDIlib_find_wait_for_sources(void*,uint32_t)')
  const fsrc = L.func('void *NDIlib_find_get_current_sources(void*,_Out_ uint32_t*)')
  const rc = L.func('void *NDIlib_recv_create_v3(const R*)')
  const cap = L.func('int NDIlib_recv_capture_v2(void*,_Out_ V*,void*,void*,uint32_t)')
  const fr = L.func('void NDIlib_recv_free_video_v2(void*,V*)')
  const perf = L.func('void NDIlib_recv_get_performance(void*,_Out_ Q*,_Out_ Q*)')
  init()
  const f = fc({ show: true, g: null, ips: null })
  let src = null
  const t0 = Date.now()
  while (!src && Date.now() - t0 < 12000) {
    fw(f, 500)
    const n = [0]
    const p = fsrc(f, n)
    if (n[0]) for (const s of koffi.decode(p, koffi.array('S', n[0]))) if (String(s.name).endsWith('(' + name + ')')) src = s
  }
  if (!src) { console.log(JSON.stringify({ error: 'source not found' })); process.exit(1) }
  const r = rc({ src, cf: 100, bw: 100, fields: true, n: 'Opsia test receiver' })
  // wait for the first frame, then count for `secs`
  let n = 0, w = 0, h = 0, last = 0, N = 0, D = 1, lastTc = 0n, back = 0, start = 0
  const gaps = [], tcs = [], sizes = new Set()
  const t1 = Date.now()
  for (;;) {
    const v = {}
    const t = cap(r, v, null, null, 100)
    const now = performance.now()
    if (t === 1) {
      if (!start) start = now
      else { gaps.push(now - last); n++ }
      last = now
      w = v.xres; h = v.yres; N = v.N; D = v.D
      sizes.add(`${w}x${h}`)
      const tc = BigInt(v.tc)
      if (tc < lastTc) back++
      else if (lastTc) tcs.push(Number(tc - lastTc) / 10000)
      lastTc = tc
      fr(r, v)
    }
    if (start && now - start > secs * 1000) break
    if (!start && Date.now() - t1 > 15000) break
  }
  const a = {}, b = {}
  perf(r, a, b)
  const qq = (arr) => { const g = arr.slice().sort((x, y) => x - y); return (k) => (g.length ? +g[Math.min(g.length - 1, Math.floor(g.length * k))].toFixed(1) : 0) }
  const q = qq(gaps), qt = qq(tcs)
  console.log(JSON.stringify({
    got: n, fps: +(n / Math.max(0.001, (last - start) / 1000)).toFixed(1), w, h, rate: +(N / D).toFixed(2), sizes: [...sizes],
    p50: q(0.5), p95: q(0.95), p99: q(0.99), worst: q(1), over100: gaps.filter((x) => x > 100).length, tcP50: qt(0.5), tcP95: qt(0.95), tcBack: back,
    seen: String(a.v), dropped: String(b.v)
  }))
  process.exit(0)
}

if (argv[0] === 'recv') receiver(argv[1], +argv[2] || 10)
else main().catch((e) => { console.error(e); process.exit(1) })

// ── The driver ───────────────────────────────────────────────────────────────

async function connect(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
  const t = list.find((p) => p.type === 'page' && !/#output|^about:/.test(p.url))
  if (!t) throw new Error('no control page on ' + port)
  const ws = new WebSocket(t.webSocketDebuggerUrl)
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j })
  let id = 0
  const pending = new Map(), errors = []
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return }
    if (m.method === 'Runtime.exceptionThrown') errors.push('EXC ' + String(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300))
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('ERR ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 300))
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('LOG ' + String(m.params.entry.text).slice(0, 300))
  })
  const send = (method, params = {}) => new Promise((res, rej) => {
    const i = ++id
    pending.set(i, (m) => (m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result)))
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  await send('Runtime.enable')
  await send('Log.enable')
  errors.length = 0 // what was logged before this run is another run's
  const ev = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error('eval: ' + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text))
    return r.result.value
  }
  const st = (x) => ev(`(()=>{const s=__store.getState();${x};return 1})()`)
  return { send, ev, st, errors }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ps = (cmd) => execFileSync('powershell', ['-NoProfile', '-Command', cmd], { encoding: 'utf8' }).trim()
const kids = (port) => `$k=Get-CimInstance Win32_Process -Filter "Name='electron.exe'"|Where-Object{$_.CommandLine -like '*opsia-testbuild-${port}-userdata*'};`

/** The copy's memory : private MB of its processes (by its settings folder), and
 *  the graphics card's, MB. */
function memory(port) {
  let mb = 0
  if (process.platform === 'win32') {
    try {
      mb = +ps(kids(port) + `$p=@($k|ForEach-Object{$_.ProcessId})+@($k|ForEach-Object{$_.ParentProcessId})|Sort-Object -Unique;$s=0;foreach($x in $p){$g=Get-Process -Id $x -ErrorAction SilentlyContinue;if($g.ProcessName -eq 'electron'){$s+=$g.PrivateMemorySize64}};[math]::Round($s/1MB)`) || 0
    } catch { /* unknown */ }
  }
  let vram = 0, util = 0
  try {
    const [m, u] = execFileSync('nvidia-smi', ['--query-gpu=memory.used,utilization.gpu', '--format=csv,noheader,nounits'], { encoding: 'utf8' }).trim().split(',').map((x) => +x)
    vram = m; util = u
  } catch { /* no NVIDIA */ }
  return { mb, vram, util }
}

async function main() {
  const port = +opt('port', 9585)
  const secs = +opt('secs', 10)
  const fps = +opt('fps', 60)
  const size = +opt('size', 4096)
  const format = opt('format', 'uyvy')
  const comps = opt('comps', '')
  const c = await connect(port)
  const recvOn = !has('norecv')
  const gapProbe = `(()=>{const b=[...document.querySelectorAll('button')].find(x=>/discard/i.test(x.textContent));b&&b.click();if(!window.__gapProbe){window.__gapProbe=1;window.__gaps=[];let l=0;(function t(n){if(l)window.__gaps.push(n-l);l=n;requestAnimationFrame(t)})(performance.now())}return 1})()`
  console.log('gpu :', await c.ev(`(()=>{const g=__comp.gl;const e=g.getExtension('WEBGL_debug_renderer_info');return g.getParameter(e.UNMASKED_RENDERER_WEBGL)})()`))
  await c.ev(gapProbe)
  await c.st(`s.setNdi({enabled:false,name:${JSON.stringify(NAME)},fps:${fps},format:'${format}',maxSize:0});s.setMorphMs(0);if(s.outputPageOpen)s.setOutputPageOpen(false)`)

  const recv = (s) => {
    const p = spawn(process.execPath, [__filename, 'recv', NAME, String(s)])
    let out = ''
    p.stdout.on('data', (d) => { out += d })
    return new Promise((r) => p.on('exit', () => { try { r(JSON.parse(out)) } catch { r({ error: out || 'no answer' }) } }))
  }
  /** One measurement : `s` seconds of the app's own clock, NDI's status, the receiver. */
  const measure = async (label, s = secs, withRecv = recvOn) => {
    const r = withRecv ? recv(s + 1) : null
    if (r) await sleep(4000) // found, connected, first frames
    await c.ev(`(()=>{window.__gaps.length=0;window.__sk=__comp.backlogSkips;window.__sm=[];clearInterval(window.__iv);window.__iv=setInterval(()=>{const n=__store.getState().ndiStatus;window.__sm.push({...n,app:__perfRates.fps()})},1000);return 1})()`)
    await sleep(s * 1000)
    const a = JSON.parse(await c.ev(`(()=>{clearInterval(window.__iv);const g=window.__gaps.slice().sort((a,b)=>a-b),q=k=>+(g[Math.min(g.length-1,Math.floor(g.length*k))]||0).toFixed(1);
      const sm=window.__sm,avg=k=>sm.length?+(sm.reduce((a,b)=>a+(b[k]||0),0)/sm.length).toFixed(1):0,mx=k=>sm.length?+Math.max(...sm.map(x=>x[k]||0)).toFixed(1):0,sum=k=>sm.reduce((a,b)=>a+(b[k]||0),0);
      const last=sm[sm.length-1]||{};
      return JSON.stringify({app:avg('app'),rafP50:q(.5),rafP95:q(.95),rafMax:q(1),guard:__comp.backlogSkips-window.__sk,sent:avg('fps'),captured:avg('captured'),skipped:sum('skipped'),late:sum('dropped'),resent:sum('resent'),sendMs:mx('sendMs'),latency:avg('latencyMs'),path:last.path||'',size:(last.width||0)+'x'+(last.height||0),conn:last.connections,state:last.state,paths:[...new Set(sm.map(x=>x.path))].join('+'),caps:[...__comp.captures.keys()].join(' '),perf:Object.fromEntries(Object.entries(__perf.read()).filter(e=>e[1]>0.3).map(e=>[e[0],+e[1].toFixed(1)]))})})()`))
    const b = r ? await r : null
    const m = memory(port)
    console.log(`${label.padEnd(28)} app ${a.app} (rAF p95 ${a.rafP95} max ${a.rafMax}, guard ${a.guard}) · sent ${a.sent} captured ${a.captured} skipped ${a.skipped} late ${a.late} resent ${a.resent} · send max ${a.sendMs} ms · ${a.path} ${a.size} latency ${a.latency}` +
      (b ? (b.error ? ` · RECV ${b.error}` : ` · recv ${b.fps} fps ${b.w}x${b.h} p95 ${b.p95} worst ${b.worst} dropped ${b.dropped}/${b.seen} tc ${b.tcP50}/${b.tcP95} back ${b.tcBack}`) : '') + ` · mem ${m.mb} MB, vram ${m.vram} MB, gpu ${m.util}%`)
    console.log('     cpu ms', JSON.stringify(a.perf), a.caps ? `WebGL captures : ${a.caps}` : '', a.paths !== a.path ? `paths ${a.paths}` : '')
    return { label, ...a, recv: b, mem: m }
  }

  const square = (on) => c.st(on ? `s.squareCompForDome(2048,2048);s.setDome({enabled:true,res:${size},aperture:210,mode:'fisheye',fit:'fill',grid:false})` : `s.setDome({enabled:false})`)
  const scene = async (id) => {
    const f = comps ? path.join(comps, id + '.json') : ''
    if (f && fs.existsSync(f)) {
      await c.ev(`(()=>{__store.setState({composition:${fs.readFileSync(f, 'utf8')}});return 1})()`)
    } else if (id === 'light') {
      await c.st(`s.newSession()`)
      await sleep(500)
      await c.st(`s.setSourceShader(0,'A','drift-field')`)
    } else {
      await c.st(`s.generateTheme('${id}')`)
    }
    await sleep(4000)
    if (f && !fs.existsSync(f)) {
      fs.mkdirSync(comps, { recursive: true })
      fs.writeFileSync(f, await c.ev(`JSON.stringify(__store.getState().composition)`))
    }
  }
  const ndi = async (on) => { await c.st(`s.setNdi({enabled:${on}})`); await sleep(on ? 4000 : 1500) }
  const scenes = String(opt('scenes', 'light,dome-aurora,oil-cloud,chrome-idol')).split(',').filter(Boolean)
  const rows = []

  if (has('soak')) {
    const s = +opt('soak', 300)
    await scene(scenes[0]); await square(true); await sleep(3000); await ndi(true)
    const m0 = memory(port)
    const samples = []
    const iv = setInterval(() => samples.push(memory(port)), 20000)
    rows.push(await measure(`soak ${s} s · ${scenes[0]} ${size}²`, s))
    clearInterval(iv)
    const m1 = memory(port)
    console.log(`memory ${m0.mb} -> ${m1.mb} MB (private), vram ${m0.vram} -> ${m1.vram} MB`)
    console.log('     every 20 s (MB/VRAM) :', samples.map((x) => `${x.mb}/${x.vram}`).join(' '))
  } else if (has('ops')) {
    await scene(scenes[0]); await square(true); await sleep(3000); await ndi(true)
    rows.push(await measure('start'))
    console.log('… 20 times off and on, a receiver connected')
    const r = recv(25)
    await sleep(4000)
    for (let i = 0; i < 20; i++) {
      await c.st(`s.setNdi({enabled:false})`); await sleep(120 + (i % 5) * 130)
      await c.st(`s.setNdi({enabled:true})`); await sleep(250 + (i % 4) * 200)
    }
    await sleep(2000)
    console.log('     state', await c.ev(`JSON.stringify(__store.getState().ndiStatus)`))
    console.log('     receiver', JSON.stringify(await r))
    rows.push(await measure('after 20 toggles'))
    console.log('… master sizes, rates, formats, caps while live')
    for (const x of [`s.setDome({res:2048})`, `s.setNdi({fps:30})`, `s.setNdi({maxSize:1920})`, `s.setNdi({format:'rgbx'})`, `s.setDome({res:4096})`, `s.setNdi({maxSize:0,format:'uyvy',fps:60})`, `s.setDome({grid:true})`, `s.setDome({grid:false})`, `s.setDome({enabled:false})`, `s.setDome({enabled:true})`]) { await c.st(x); await sleep(1500) }
    rows.push(await measure('after the changes'))
    console.log('… sessions loaded while live')
    const r2 = recv(14)
    await sleep(5000)
    for (const id of [scenes[1] ?? scenes[0], scenes[2] ?? scenes[0]]) { await c.st(`s.generateTheme('${id}')`); await sleep(4000) }
    console.log('     receiver', JSON.stringify(await r2))
    rows.push(await measure('after the session loads'))
    console.log('… a page reload while live')
    await c.send('Page.reload')
    await sleep(10000)
    await c.ev(gapProbe)
    await scene(scenes[0]); await square(true); await sleep(3000)
    rows.push(await measure('after the reload'))
    if (process.platform === 'win32') {
      console.log('… minimized')
      const win = (cmd) => ps(`Add-Type -Name W -Namespace U -MemberDefinition '[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);';` + kids(port) + `$p=@($k|ForEach-Object{$_.ParentProcessId})|Sort-Object -Unique;foreach($x in $p){$g=Get-Process -Id $x -ErrorAction SilentlyContinue;if($g -and $g.MainWindowHandle -ne 0){[U.W]::ShowWindow($g.MainWindowHandle,${cmd})|Out-Null;"$x"}}`)
      console.log('     window', win(7))
      await sleep(3000)
      rows.push(await measure('minimized'))
      win(4)
      await sleep(2000)
      rows.push(await measure('shown again'))
    }
    await ndi(false); await square(false); await sleep(2000); await ndi(true)
    rows.push(await measure('flat'))
  } else {
    for (const s of scenes) {
      await scene(s); await square(true); await sleep(4000); await ndi(false)
      rows.push(await measure(`${s} ${size}² NDI off`, secs, false))
      await ndi(true)
      rows.push(await measure(`${s} ${size}² NDI ${fps}`))
    }
    if (!has('quick')) {
      await scene(scenes[0]); await c.st(`s.setDome({res:2048})`); await sleep(3000)
      rows.push(await measure(`${scenes[0]} 2048² NDI ${fps}`))
      await ndi(false); await square(false); await sleep(3000); await ndi(true)
      rows.push(await measure(`${scenes[0]} flat NDI ${fps}`))
    }
  }
  await c.st(`s.setNdi({enabled:false});s.setDome({enabled:false})`)
  await sleep(1500)
  console.log('console errors :', c.errors.length, JSON.stringify(c.errors.slice(0, 6)))
  if (opt('json', '')) fs.writeFileSync(opt('json', ''), JSON.stringify(rows, null, 1))
  process.exit(0)
}
