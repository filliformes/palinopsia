// The dataflou node's integration test (run.mjs bundles and runs it).

import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DfNative, dfAddonError, loadDfAddon, type DfEvent } from '../../src/main/dataflou/addon'
import { DataflouNode, type World } from '../../src/main/dataflou/node'
import { Wires, migrateOldWires, nodeDir } from '../../src/main/dataflou/wires'
import { dfTreeJson, dfWireKey, inputTree, palinopsiaTree, type DfAction, type DfListen, type DfParam, type DfSessionWire, type DfValue } from '../../src/shared/dataflou'

if (!loadDfAddon(process.env.DF_ADDON!)) {
  console.error('no module : ' + dfAddonError())
  process.exit(1)
}

// (the module never holds a process alive : the test does)
setInterval(() => {}, 1000)

const UNI = process.env.DF_UNI ?? `opsia-test-${process.pid}`
const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
async function until(f: () => boolean | Promise<boolean>, ms = 8000): Promise<boolean> {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (await f()) return true
    await wait(20)
  }
  return false
}
let passed = 0
const failed: string[] = []
function ok(name: string, cond: unknown, detail: unknown = ''): void {
  if (cond) passed++
  else failed.push(name)
  console.log(`${cond ? 'ok  ' : 'FAIL'} ${name}${detail !== '' ? ` : ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`)
}

// ── a plain node of another program ──
const P = (path: string, p: Partial<DfParam>): DfParam => ({
  path, kind: 'param', type: 'number', mode: 'discrete', flow: 'source', access: 'readwrite', rate: 0, min: 0, max: 1, init: 0, unit: '', label: path, desc: '', nature: 'lin', topology: 'span', ...p
})
const G = (path: string): DfParam => P(path, { kind: 'group' })
const PEER_TREE: DfParam[] = [
  G('k'), P('k/fader', { flow: 'bidir', max: 127 }), P('k/stream', { mode: 'streaming', rate: 60 }), P('k/on', { type: 'bool' }), P('k/hit', { type: 'trigger' }), P('k/dest', { flow: 'destination', max: 100 }),
  P('k/bands', { type: 'array', size: 6, flow: 'destination' }), P('k/band3', { flow: 'destination' }), P('k/fired', { type: 'trigger', flow: 'destination' }), P('k/text', { type: 'string' })
]
class Peer {
  n: DfNative
  got: DfEvent[] = []
  constructor(public name: string, public sku: string, public dir: string) {
    this.n = new DfNative((l) => {
      for (const e of l) {
        if (e.k !== 'log') this.got.push(e)
        else if (process.env.DF_LOG) console.log(`      ${Date.now() % 1e6} ${this.name}: ${e.text}`)
      }
    })
  }
  async start(universe = UNI): Promise<void> {
    await this.n.open({ name: this.name, sku: this.sku, product: 'test', universe, dir: this.dir, config: dfTreeJson(PEER_TREE) })
    this.n.post('triggers', { s: ['k/fired'] })
    this.n.post('watch', { s: PEER_TREE.filter((p) => p.flow !== 'source' && p.kind === 'param').map((p) => p.path) })
    this.n.go()
  }
  set(path: string, v: DfValue | null): void {
    this.n.post('set', { sets: [[path, v]] })
  }
  async fire(path: string): Promise<void> {
    await this.n.call('setRemote', { s: [this.sku, path, 'fire'] })
  }
  async world(): Promise<{ nodes: Array<{ sku: string; online: boolean; params: { children?: unknown[] }; connections?: unknown[] }> }> {
    return JSON.parse((await this.n.call<string>('world')) ?? '{"nodes":[]}')
  }
  async paths(sku: string): Promise<string[]> {
    const r = await this.n.call<Record<string, Array<[string]>>>('params', { s: [sku] })
    return (r?.[sku] ?? []).map((x) => x[0])
  }
  values(path: string): DfValue[] {
    return this.got.filter((e): e is Extract<DfEvent, { k: 'value' }> => e.k === 'value' && e.path === path).map((e) => e.value!)
  }
  fires(path: string): number {
    return this.got.reduce((n, e) => n + (e.k === 'fire' && e.path === path ? e.times : 0), 0)
  }
  stop(): void {
    this.n.close()
  }
}

// ── Palinopsia's side, without Electron ──
const ACTS: DfAction[] = [
  { id: 'a', path: 'act/l1/mute', label: 'L1 mute', group: 'Layer 1' },
  { id: 'b', path: 'act/l1/vary', label: 'L1 vary', group: 'Layer 1' }
]
class Opsia {
  node: DataflouNode | null = null
  values: Array<{ path: string; value: DfValue }> = []
  fired: Record<string, number> = {}
  dests: Array<{ path: string; state: string; origin: string }> = []
  session: DfSessionWire[] = []
  publish = ['g:meta', 'g:audio', 'g:scene', 'g:act:Layer 1', 'p:bpm']
  listens: DfListen[] = []
  extra: string[] = []
  stands = new Map<string, DfValue>()
  wires: Wires
  scenes: Array<[string, number]> = []
  constructor(public sku: string, public base: string) {
    this.wires = new Wires(() => this.base, () => this.sku, { log: (_l, m) => console.log('   ', m), sessionChanged: (l) => (this.session = l), changed: () => {}, refreshTree: () => this.refresh() })
  }
  tree(): DfParam[] {
    const pub = new Set(this.publish)
    this.extra = this.wires.sessionHere().map((w) => w.dest).filter((d) => !d.startsWith('act/') && !pub.has(`g:${d.split('/')[0]}`) && !pub.has(`p:${d}`))
    const acts = ACTS.filter((a) => pub.has(`g:act:${a.group}`) || this.wires.sessionHere().some((w) => w.dest === a.path))
    return [...palinopsiaTree(acts, [...this.publish, ...this.extra.map((p) => `p:${p}`)]), ...inputTree(this.listens)]
  }
  private sig = ''
  refresh(): void {
    const t = this.tree()
    const s = JSON.stringify(t)
    if (!this.node || s === this.sig) return
    this.sig = s
    void this.node.setParams(t, this.stands)
    this.wires.treeChanged()
  }
  async start(universe = UNI): Promise<void> {
    migrateOldWires(this.base, universe, (_l, m) => console.log('   ', m))
    this.wires.setUniverse(universe)
    const t = this.tree()
    this.sig = JSON.stringify(t)
    const n = new DataflouNode({ sku: this.sku, label: 'opsia', universe, product: 'Palinopsia', dir: nodeDir(this.base, universe), params: t }, {
      log: (m) => process.env.DF_LOG && console.log(`      ${Date.now() % 1e6} opsia: ${m}`),
      onValues: (l) => this.values.push(...l),
      onFire: (p, k) => (this.fired[p] = (this.fired[p] ?? 0) + k),
      onDest: (path, d) => this.dests.push({ path, state: d.state, origin: d.origin }),
      onLocate: () => {}, onHalt: () => {},
      onScene: (op, slot) => this.scenes.push([op, slot]),
      onChange: () => {}, onWorld: (w: World) => this.wires.world(w.mine), onStopped: (w) => console.log('STOPPED', w)
    })
    this.node = n
    await n.start(this.stands, (w) => this.wires.attach(n, universe, w.mine))
  }
  stop(): void {
    this.wires.detach()
    this.node?.stop()
    this.node = null
  }
  last(path: string): DfValue | undefined {
    return this.values.filter((v) => v.path === path).pop()?.value
  }
  state(path: string): string {
    const d = this.node?.dests.get(path)
    return d ? `${d.state}/${d.origin}` : 'none'
  }
}

async function main(): Promise<void> {
  const base = mkdtempSync(join(tmpdir(), 'opsia-df-'))
  const d = (n: string): string => {
    const x = join(base, n)
    mkdirSync(x, { recursive: true })
    return x
  }
  const OSKU = '11111111-1111-4111-8111-111111111111'
  const PSKU = '22222222-2222-4222-8222-222222222222'
  const CSKU = '33333333-3333-4333-8333-333333333333'
  const opsia = new Opsia(OSKU, d('opsia'))
  const peer = new Peer('peer', PSKU, d('peer'))

  // ── what v1.3.5 had saved ──
  writeFileSync(join(opsia.base, `bindings-${UNI}.json`), JSON.stringify({
    'meta/1': [{ sku: PSKU, path: 'k/fader', opt: { lo: 0.25, hi: 0.75, invert: true, slewMs: 200 } }],
    'feel/density': [{ sku: PSKU, path: 'k/stream' }]
  }))
  writeFileSync(join(opsia.base, `scenes-${UNI}.json`), JSON.stringify({ v: 1, slots: { 2: [['meta/2', PSKU, 'k/fader']] } }))

  await Promise.all([opsia.start(), peer.start()])
  ok('they meet', await until(() => opsia.node!.nodes.some((n) => n.sku === PSKU && n.online && n.params.length > 5)))
  ok('old files kept beside', existsSync(join(opsia.base, `bindings-${UNI}.json.v135`)) && !existsSync(join(opsia.base, `bindings-${UNI}.json`)))
  ok('a saved wire is there, shaped', await until(() => {
    const s = opsia.wires.subs()['meta/1']?.[0]
    return !!s && s.opt?.lo === 0.25 && s.opt?.hi === 0.75 && s.opt?.invert === true && s.opt?.slewMs === 200
  }), opsia.wires.subs())
  ok('a saved wire into what is not published waits', opsia.wires.parked().includes('feel/density'), opsia.wires.parked())
  ok('bound', await until(() => opsia.state('meta/1').startsWith('bound')), opsia.state('meta/1'))
  peer.set('k/fader', 127)
  ok('range and invert : 127 of 127 lands at 0.25', await until(() => Math.abs(Number(opsia.last('meta/1')) - 0.25) < 1e-3), opsia.last('meta/1'))
  peer.set('k/fader', 0)
  ok('... and 0 at 0.75', await until(() => Math.abs(Number(opsia.last('meta/1')) - 0.75) < 1e-3), opsia.last('meta/1'))
  ok('setOpt back to plain', await opsia.wires.setOpt('meta/1', PSKU, 'k/fader', null))
  peer.set('k/fader', 63.5)
  ok('plain : the middle', await until(() => Math.abs(Number(opsia.last('meta/1')) - 0.5) < 1e-3), opsia.last('meta/1'))
  peer.set('k/fader', null)
  await wait(300)
  ok('unknown is held', Math.abs(Number(opsia.last('meta/1')) - 0.5) < 1e-3)

  // ── by sku, by name ──
  ok('a connection by sku, another range', await opsia.node!.connect(OSKU, 'bpm', PSKU, 'k/fader'))
  await wait(200)
  peer.set('k/fader', 127)
  ok('127 of 127 is 800 BPM', await until(() => Number(opsia.last('bpm')) === 800), opsia.last('bpm'))
  await peer.n.call('listen', { s: ['k/dest', 'opsia', 'meta/5'] })
  ok('by name', await until(() => (opsia.node!.listeners['meta/5'] ?? []).length > 0))
  opsia.node!.setValues({ 'meta/5': 0.42 })
  ok('0.42 of a Macro is 42 of 100 there', await until(() => peer.values('k/dest').some((v) => Math.abs(Number(v) - 42) < 0.01)), peer.values('k/dest').slice(-1))
  ok('a param of ours reads as it stands', await until(async () => (await peer.n.call<Record<string, Array<[string, number]>>>('params', { s: [OSKU] }))?.[OSKU]?.some((x) => x[0] === 'meta/5') ?? false))

  // ── triggers ──
  await opsia.node!.connect(OSKU, 'act/l1/vary', PSKU, 'k/hit')
  await until(() => opsia.state('act/l1/vary').startsWith('bound'))
  await wait(400)
  const before = opsia.fired['act/l1/vary'] ?? 0
  for (let i = 0; i < 200; i++) {
    // (the core sends one firing a poll of the source : one every 10 ms here)
    peer.n.post('setRemote', { s: [PSKU, 'k/hit', 'fire'] })
    await wait(10)
  }
  await until(() => (opsia.fired['act/l1/vary'] ?? 0) - before >= 200, 5000)
  await wait(500)
  ok('200 fires, none lost nor doubled', (opsia.fired['act/l1/vary'] ?? 0) - before === 200, (opsia.fired['act/l1/vary'] ?? 0) - before)
  for (let i = 0; i < 50; i++) peer.n.post('setRemote', { s: [OSKU, 'act/l1/mute', 'fire'] })
  await until(() => (opsia.fired['act/l1/mute'] ?? 0) >= 50)
  await wait(300)
  ok('50 fired from the mesh by hand', opsia.fired['act/l1/mute'] === 50, opsia.fired['act/l1/mute'])

  // a fader and a switch into a trigger : the rising edge
  const f0 = opsia.fired['scene/next'] ?? 0
  peer.set('k/on', false)
  await opsia.node!.connect(OSKU, 'scene/next', PSKU, 'k/on')
  await wait(800)
  ok('a wire made fires nothing', (opsia.fired['scene/next'] ?? 0) === f0, opsia.fired['scene/next'])
  for (let i = 0; i < 10; i++) {
    peer.set('k/on', true)
    await wait(60)
    peer.set('k/on', false)
    await wait(60)
  }
  await wait(300)
  ok('a switch pressed 10 times fires 10', (opsia.fired['scene/next'] ?? 0) - f0 === 10, (opsia.fired['scene/next'] ?? 0) - f0)
  const v0 = opsia.fired['scene/vary'] ?? 0
  peer.set('k/stream', 0)
  await opsia.node!.connect(OSKU, 'scene/vary', PSKU, 'k/stream')
  await wait(500)
  for (let i = 0; i <= 60; i++) {
    peer.set('k/stream', 0.5 - 0.5 * Math.cos((i / 60) * Math.PI * 2 * 3))
    await wait(25)
  }
  await wait(1500)
  ok('a fader up and down 3 times (then held, streaming) fires 3', (opsia.fired['scene/vary'] ?? 0) - v0 === 3, (opsia.fired['scene/vary'] ?? 0) - v0)

  // ── arrays ──
  await peer.n.call('connect', { s: [PSKU, 'k/bands', OSKU, 'audio/bands'] })
  await peer.n.call('connect', { s: [PSKU, 'k/band3', OSKU, 'audio/bands/3'] })
  await until(() => (opsia.node!.listeners['audio/bands'] ?? []).length > 0)
  for (let i = 0; i < 20; i++) {
    opsia.node!.setValues({ 'audio/bands': [0.1, 0.2, 0.3, 0.4, 0.5, 0.6] })
    await wait(30)
  }
  ok('the six bands as one array', peer.values('k/bands').some((v) => Array.isArray(v) && v.length === 6 && Math.abs(v[2] - 0.3) < 1e-4), peer.values('k/bands').slice(-1))
  ok('one band alone', peer.values('k/band3').some((v) => Math.abs(Number(v) - 0.3) < 1e-4), peer.values('k/band3').slice(-1))

  // ── the session's wires ──
  ok('not published yet', !(await peer.paths(OSKU)).includes('output/x'))
  opsia.wires.setSession([
    { universe: UNI, dest: 'output/x', sku: PSKU, path: 'k/stream', opt: { lo: 0.1, hi: 0.2 } },
    { universe: UNI, dest: 'meta/1', sku: PSKU, path: 'k/stream' },
    { universe: 'elsewhere', dest: 'meta/3', sku: PSKU, path: 'k/fader' }
  ])
  ok('a session publishes what it needs', await until(async () => (await peer.paths(OSKU)).includes('output/x')))
  ok('its wire plays', await until(() => opsia.state('output/x').startsWith('bound')), opsia.state('output/x'))
  await wait(600)
  ok('shaped as the session says', opsia.wires.subs()['output/x']?.[0].opt?.lo === 0.1, opsia.wires.subs()['output/x'])
  ok("the computer's wire on its destination is set aside", !opsia.wires.subs()['meta/1']?.some((s) => s.path === 'k/fader') && opsia.wires.silenced().some((s) => s.dest === 'meta/1'), opsia.wires.silenced())
  const fileOf = (): { session: string[]; silenced: Record<string, unknown[]> } => JSON.parse(readFileSync(join(opsia.base, `wires-${UNI}.json`), 'utf8'))
  ok('the file says which are the session\'s', fileOf().session.includes(dfWireKey('output/x', PSKU, 'k/stream')))
  // unwired from the mesh : it leaves the session too
  await peer.n.call('disconnect', { s: [OSKU, 'output/x', PSKU, 'k/stream'], n: [1] })
  ok('unwired on the mesh, it leaves the session', await until(() => !opsia.session.some((w) => w.dest === 'output/x') && opsia.session.length === 2), opsia.session)
  ok('... and its parameter is withdrawn', await until(async () => !(await peer.paths(OSKU)).includes('output/x')))
  opsia.wires.setSession([{ universe: UNI, dest: 'output/x', sku: PSKU, path: 'k/stream' }])
  ok('a session with it again', await until(() => opsia.state('output/x').startsWith('bound')))
  ok('... the other session\'s is undone', await until(() => !opsia.wires.subs()['meta/1']?.some((s) => s.path === 'k/stream')) && !opsia.wires.silenced().some((s) => s.dest === 'meta/1' && s.path === 'k/stream'), opsia.wires.silenced())
  ok('... the computer\'s wire is back', await until(() => !!opsia.wires.subs()['meta/1']?.some((s) => s.path === 'k/fader')), opsia.wires.subs()['meta/1'])
  await wait(400)
  const spurious = opsia.values.filter((v) => v.path === 'output/x' && v.value === 0.5).length
  ok('declared again : its rest value is not an event', spurious === 0, spurious)
  // a crash while the session is open : its wires do not outlive it
  opsia.stop()
  const again = new Opsia(OSKU, opsia.base)
  await again.start()
  ok('a start without that session : none of its wires', await until(() => !again.wires.subs()['output/x'] && (again.wires.subs()['meta/1']?.length ?? 0) === 1), again.wires.subs())
  ok('the same sku, its connections back', await until(() => again.state('meta/1').startsWith('bound')), again.state('meta/1'))
  ok('and none published for it', !again.node!.declared('output/x'))
  const t0 = Date.now()
  peer.set('k/fader', 30)
  ok('values flow after the restart', await until(() => again.values.some((v) => v.path === 'meta/1')), `${Date.now() - t0} ms`)

  // the other way : what listens to us hears us again (not at the next keepalive)
  let outMs: number[] = []
  for (let i = 0; i < Number(process.env.DF_RESTARTS ?? 6); i++) {
    const n0 = peer.values('k/dest').length
    const to = Date.now()
    const heard = await until(async () => {
      again.node!.setValues({ 'meta/5': ((Date.now() % 900) + 50) / 1000 })
      await wait(30)
      return peer.values('k/dest').length > n0
    }, 20_000)
    outMs.push(heard ? Date.now() - to : -1)
    if (process.env.DF_LOG) console.log('RESTART', i, outMs[i])
    again.stop()
    await wait(i % 2 ? 1500 : 300)
    await again.start()
    await until(() => !!again.node!.nodes.find((n) => n.sku === PSKU)?.online)
  }
  ok('what listens to us hears us again at once, 6 restarts', outMs.every((x) => x >= 0 && x < 2500), outMs)

  // triggers after a restart : what the sources hold fires nothing
  await wait(500)
  ok('a restart fires nothing', Object.keys(again.fired).length === 0, again.fired)

  // ── a modulator's mesh input ──
  again.listens = [{ sku: PSKU, path: 'k/fader', slot: 2 }]
  again.wires.setListens(again.listens)
  ok('a mesh input is declared and fed', await until(() => again.state('input/3').startsWith('bound')))
  peer.set('k/fader', 127)
  ok('... 0..1 of its source', await until(() => again.values.some((v) => v.path === 'input/3' && v.value === 1)))
  again.listens = []
  again.wires.setListens([])
  ok('... and withdrawn', await until(async () => !(await peer.paths(OSKU)).includes('input/3')))

  // ── scenes ──
  ok("v1.3.5's scene 2 is there", again.node!.nodes.length > 0)
  peer.n.post('scene', { s: ['recall'], n: [2] })
  peer.n.post('scene', { s: ['recall'], n: [2] })
  ok('a mesh scene recalled : its connections', await until(() => !!again.wires.subs()['meta/2'] && !again.wires.subs()['bpm']), again.wires.subs())
  ok('... and said', again.scenes.some(([op, n]) => op === 'recall' && n === 2), again.scenes)

  // ── a source killed ──
  const child: ChildProcess = spawn(process.execPath, [process.argv[1], 'child', CSKU, d('child')], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, DF_UNI: UNI } })
  await new Promise((r) => child.once('message', r))
  ok('a third node', await until(() => again.node!.nodes.some((n) => n.sku === CSKU && n.online && n.params.length > 3)))
  await again.node!.connect(OSKU, 'meta/9', CSKU, 'k/fader')
  ok('it plays', await until(() => again.values.some((v) => v.path === 'meta/9')))
  child.kill('SIGKILL')
  const killed = Date.now()
  const seenWaiting = await until(() => again.dests.some((x) => x.path === 'meta/9' && x.state === 'waiting'), 45_000)
  const tw = Date.now() - killed
  ok('killed : waiting', seenWaiting, `${tw} ms`)
  ok('... then free, lost', await until(() => again.state('meta/9') === 'free/lost', 5000), again.state('meta/9'))
  const held = again.last('meta/9')
  await wait(500)
  ok('its value is held', again.last('meta/9') === held, held)
  ok('its connection is kept', !!again.wires.subs()['meta/9'])
  const child2: ChildProcess = spawn(process.execPath, [process.argv[1], 'child', CSKU, join(base, 'child')], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, DF_UNI: UNI } })
  await new Promise((r) => child2.once('message', r))
  const tb = Date.now()
  ok('back : bound again by itself', await until(() => again.state('meta/9').startsWith('bound'), 15_000), `${Date.now() - tb} ms`)
  child2.kill('SIGKILL')

  // ── a universe change ──
  again.stop()
  await again.start(`${UNI}-b`)
  ok('another universe : no peer, no wire', again.node!.nodes.length === 1 && Object.keys(again.wires.subs()).length === 0, Object.keys(again.wires.subs()))
  again.stop()
  await again.start(UNI)
  ok('back : its peer and its wires', await until(() => again.node!.nodes.some((n) => n.sku === PSKU && n.online) && !!again.wires.subs()['meta/9']))

  // ── reconnection : the peer gone and back on another port, 5 times ──
  let back = 0
  for (let i = 0; i < 5; i++) {
    peer.stop()
    await until(() => !again.node!.nodes.find((n) => n.sku === PSKU)?.online, 5000)
    peer.n = new Peer('peer', PSKU, peer.dir).n
    const p2 = new Peer('peer', PSKU, peer.dir)
    await p2.start()
    peer.n = p2.n
    peer.got = p2.got
    if (await until(() => !!again.node!.nodes.find((n) => n.sku === PSKU)?.online, 10_000)) back++
  }
  ok('a peer restarted 5 times is back 5 times', back === 5, back)

  // ── a flood, main busy ──
  await again.node!.connect(OSKU, 'meta/1', PSKU, 'k/fader')
  await wait(500)
  const n0 = again.values.length
  for (let i = 0; i < 2000; i++) peer.n.post('set', { sets: [['k/fader', i % 127]] })
  const busy = Date.now()
  while (Date.now() - busy < 1500) { /* the JavaScript thread stuck */ }
  await wait(1000)
  ok('1.5 s stuck : the node lived through it', again.node!.nodes.find((n) => n.sku === PSKU)?.online, `${again.values.length - n0} values`)

  const minutes = Number(process.argv[2] ?? 0)
  if (minutes > 0) await soak(again, peer, minutes)
  const st = await again.node!.stats()
  console.log('thread', st)
  again.stop()
  peer.stop()
  rmSync(base, { recursive: true, force: true })
}

async function soak(opsia: Opsia, peer: Peer, minutes: number): Promise<void> {
  console.log(`soak, ${minutes} min`)
  await peer.n.call('connect', { s: [PSKU2(), 'k/bands', opsia.sku, 'audio/bands'] })
  opsia.values.length = 0
  const t0 = Date.now()
  const mem: string[] = []
  let i = 0
  let values = 0
  let sessions = 0
  await opsia.node!.stats()
  const first = { rss: 0 }
  while (Date.now() - t0 < minutes * 60_000) {
    i++
    peer.set('k/fader', i % 127)
    peer.set('k/stream', (i % 100) / 100)
    opsia.node!.setValues({ 'audio/bands': [0, 1, 2, 3, 4, 5].map((k) => ((i + k) % 60) / 60), 'meta/5': (i % 50) / 50 })
    if (i % 8 === 0) peer.n.post('setRemote', { s: [PSKU2(), 'k/hit', 'fire'] })
    // a session opened and closed every 2 s : parameters published and withdrawn
    if (i % 120 === 0 && !process.env.DF_NO_SESSIONS) {
      sessions++
      opsia.wires.setSession(sessions % 2 ? [{ universe: UNI, dest: 'output/x', sku: PSKU2(), path: 'k/stream' }, { universe: UNI, dest: 'output/y', sku: PSKU2(), path: 'k/fader' }] : [])
    }
    await wait(16)
    if (i % 60 === 0) {
      values += opsia.values.length
      opsia.values.length = 0
      opsia.dests.length = 0
      peer.got.length = 0
    }
    if (i % 1800 === 0) {
      global.gc?.()
      const m = process.memoryUsage()
      if (!first.rss) first.rss = m.rss
      mem.push(`${Math.round((Date.now() - t0) / 60000)} min rss ${(m.rss / 1e6).toFixed(1)} MB heap ${(m.heapUsed / 1e6).toFixed(1)}`)
      console.log('   ', mem[mem.length - 1], `values ${values} sessions ${sessions}`, JSON.stringify(await opsia.node!.stats()))
    }
  }
  const end = process.memoryUsage().rss
  ok('soak : memory', end - first.rss < 15e6, `${(first.rss / 1e6).toFixed(1)} -> ${(end / 1e6).toFixed(1)} MB over ${minutes} min, ${values} values, ${sessions} sessions`)
}
function PSKU2(): string {
  return '22222222-2222-4222-8222-222222222222'
}

// a process of its own, to be killed
if (process.argv[2] === 'child') {
  const p = new Peer('killed', process.argv[3], process.argv[4])
  void p.start().then(() => {
    let i = 0
    setInterval(() => p.set('k/fader', (i = (i + 7) % 127)), 30)
    process.send?.('up')
  })
} else {
  void main().then(() => {
    console.log(`\n${passed} passed, ${failed.length} failed${failed.length ? ` : ${failed.join('; ')}` : ''}`)
    process.exit(failed.length ? 1 : 0)
  })
}
