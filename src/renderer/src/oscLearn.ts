// OSC Learn : any OSC controller (a TouchOSC layout, a Max patch, a phone's
// sensors) plays Palinopsia in its OWN addresses, learned like MIDI.
//
// One port, two doors. Every message arrives on the OSC input port :
//   /opsia/…        the built-in router (oscInput.ts route), exactly as before,
//                   also while Learn is on (never learned, never hidden)
//   /composition/…  the Resolume mapper's learn, as before
//   anything else   here : learned while MIDI Learn is armed, else played
//                   through the learned mappings
// A learned address never replaces a built-in one : the namespaces cannot
// meet. Both may drive the same control (a learned /1/fader3 on Layer 1's
// opacity and /opsia/layer1/opacity from a patch call the same store action;
// the last message wins, like MIDI and the mouse).
//
// LEARN : the same mode, targets and overlays as MIDI Learn (store
// midiLearnMode / midiLearnTarget). An armed target binds to whichever comes
// first, a MIDI message or an OSC one. Which value of the message : the only
// number there; of several (a phone's /accxyz x y z), the one that moved most
// over a short window (WINDOW_MS); strings are passed over, a message with no
// number is a press. The range comes from the values (mappingModel calibrate)
// and keeps widening for a few seconds after (CALIBRATE_MS). An address that
// was already streaming when the target was armed (an accelerometer left on)
// waits STALE_MS : anything else moved in that time wins.
//
// PLAY : one input may drive several controls (one-to-many, like MIDI). The
// session's mappings on an input (its address and value) silence this
// computer's on that input only. Continuous targets get the value scaled into
// their range (midi.ts applyContinuous); triggers fire on the rising edge past
// the middle (a button sending 1 then 0 is one press), a message with no value
// fires each time, a rule's box toggles on each press.
//
// ANSWERS : a learned control answers its controller in the controller's own
// address and range (whole numbers when it sends whole numbers), at its IP
// and the reply port set for it (store oscReplies; off until a port is set,
// and per controller), on change only, at most ANSWER_HZ, and never with the
// value that just came in (a fader is left alone while it moves : HOLD_MS).
// A TouchOSC fader then follows scene recalls, modulators and Generate. The
// built-in /opsia feedback and OSCQuery are untouched : learned addresses are
// the controller's, never advertised.

import type { MappingScope, OscBinding, OscInEvent } from '@shared/types'
import { useStore } from './store'
import { applyContinuous, fireTrigger, isContinuousTarget, readContinuous } from './midi'
import { CALIBRATE_MS, calibrate, describeAnyBinding, oscArgNumber, oscDenorm, oscNorm, type Seen } from './mappingModel'
import { sendOscBatch } from './oscMonitor'
import { triggerLabel } from './triggerCatalog'
import { showToast } from './components/Toast'

type Args = OscInEvent['args']

const WINDOW_MS = 300 // several values : how long Learn watches which one moves
const STALE_MS = 1500 // a stream flowing before the click waits this long
const STREAMING_MS = 200 // ... "flowing" : still heard this close to the click, and at
// least 3 times in the STREAM_SPAN before it (a fader let go is quiet by the time
// the next control is clicked, one message is no stream; a sensor is one)
const STREAM_SPAN = 500
const HOLD_MS = 300 // an input that just spoke is not answered for this long
const ANSWER_HZ = 30
const RISE = 0.5 // a trigger fires going up past the middle,
const REARM = 0.45 // and fires again once it has gone back under this

interface Entry {
  id: string
  b: OscBinding
  scope: MappingScope
}
// One input : an address and which value. `live` play it; `silenced` are this
// computer's mappings a session mapping on the same input stands in for.
interface Group {
  arg: number
  key: string
  live: Entry[]
  silenced: Entry[]
}

interface Cand {
  address: string
  host: string
  at: number
  fresh: boolean
  nargs: number
  seen: Map<number, Seen & { bool: boolean }>
}
interface Capture {
  target: string
  cands: Map<string, Cand>
  order: string[]
  timer: ReturnType<typeof setTimeout> | null
}

class OscLearnEngine {
  private index = new Map<string, Group[]>()
  private recent = new Map<string, number[]>() // address → its last 3 arrivals (performance.now)
  private stale = new Set<string>()
  private cap: Capture | null = null
  private widening: Array<{ id: string; scope: MappingScope; address: string; arg: number; until: number; seen: Seen }> = []
  private edges = new Map<string, boolean>()
  private heldUntil = new Map<string, number>()
  // what the controller shows, as we believe it : per input its last value
  // (heard or answered), per address its last whole message
  private shown = new Map<string, number>()
  private lastArgs = new Map<string, Args>()
  // continuous writes of one batch from main (~16 ms of messages), the last
  // value per control : a fader streaming 200 messages a second writes the
  // store once a batch, not once a message
  private pending = new Map<string, number>()
  private flushQueued = false
  private timer: ReturnType<typeof setInterval> | null = null
  private unsub: (() => void) | null = null
  private running = false

  start(): void {
    if (this.running) return
    this.running = true
    this.rebuild()
    this.unsub = useStore.subscribe((s, p) => {
      if (s.oscMap !== p.oscMap || s.sessionOscMap !== p.sessionOscMap) this.rebuild()
      if (s.midiLearnTarget !== p.midiLearnTarget) this.armed(s.midiLearnTarget)
      if (s.oscReplies !== p.oscReplies) {
        // a reply port set, changed or turned back on : that controller hears
        // everything again from the next answer
        for (const host of new Set([...Object.keys(s.oscReplies), ...Object.keys(p.oscReplies)])) {
          const a = s.oscReplies[host], b = p.oscReplies[host]
          if (a?.port !== b?.port || a?.on !== b?.on) this.forget(host)
        }
        this.schedule()
      }
    })
    this.schedule()
  }

  stop(): void {
    this.running = false
    this.unsub?.()
    this.unsub = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.cancelCapture()
  }

  /** (a dev hot update : the old copy stops before the new one starts) */
  shutdown(): void {
    this.stop()
  }

  // ── The index : address → inputs → mappings ──────────────────────────
  private rebuild(): void {
    const st = useStore.getState()
    const index = new Map<string, Group[]>()
    const add = (map: Record<string, OscBinding>, scope: MappingScope): void => {
      for (const id in map) {
        const b = map[id]
        let groups = index.get(b.address)
        if (!groups) index.set(b.address, (groups = []))
        let g = groups.find((x) => x.arg === b.arg)
        if (!g) groups.push((g = { arg: b.arg, key: `${b.address}|${b.arg}`, live: [], silenced: [] }))
        g.live.push({ id, b, scope })
      }
    }
    add(st.sessionOscMap, 'session')
    add(st.oscMap, 'computer')
    // the session's mappings on an input silence this computer's on it
    for (const groups of index.values())
      for (const g of groups)
        if (g.live.some((e) => e.scope === 'session')) {
          g.silenced = g.live.filter((e) => e.scope === 'computer')
          g.live = g.live.filter((e) => e.scope === 'session')
        }
    this.index = index
    this.schedule()
  }

  /** A computer mapping a session mapping on the same input silences. */
  silenced(id: string): boolean {
    const b = useStore.getState().oscMap[id]
    if (!b) return false
    return !!this.index.get(b.address)?.find((g) => g.arg === b.arg)?.silenced.some((e) => e.id === id)
  }

  private forget(host: string): void {
    for (const groups of this.index.values())
      for (const g of groups) if (g.live.some((e) => e.b.host === host)) this.shown.delete(g.key)
  }

  // ── A message outside /opsia ──────────────────────────────────────────
  handle(address: string, args: Args, host: string): void {
    if (address.length < 2 || address[0] !== '/') return
    const now = performance.now()
    if (this.widening.length) this.widen(address, args, now)
    const st = useStore.getState()
    if (st.midiLearnMode) {
      // learn : the armed target takes it; nothing armed, it plays nothing
      // (browsing the controller fires no scene under the overlays)
      if (st.midiLearnTarget) this.learn(st.midiLearnTarget, address, args, host, now)
      this.heard(address, now)
      return
    }
    this.heard(address, now)
    this.play(address, args, now)
  }

  private heard(address: string, now: number): void {
    const t = this.recent.get(address)
    if (!t) {
      this.recent.set(address, [now])
      if (this.recent.size > 512) for (const [a, ts] of this.recent) if (now - ts[ts.length - 1] > 5000) this.recent.delete(a)
    } else {
      t.push(now)
      if (t.length > 3) t.shift()
    }
  }

  // ── Learn ─────────────────────────────────────────────────────────────
  private armed(target: string | null): void {
    this.cancelCapture()
    if (!target) return
    // what was already streaming when the control was clicked waits its turn
    const now = performance.now()
    this.stale = new Set([...this.recent].filter(([, t]) => t.length >= 3 && now - t[2] < STREAMING_MS && now - t[0] < STREAM_SPAN).map(([a]) => a))
  }

  private cancelCapture(): void {
    if (this.cap?.timer) clearTimeout(this.cap.timer)
    this.cap = null
  }

  private learn(target: string, address: string, args: Args, host: string, now: number): void {
    if (!this.cap || this.cap.target !== target) {
      this.cancelCapture()
      this.cap = { target, cands: new Map(), order: [], timer: null }
    }
    const cap = this.cap
    const nums = args.map(oscArgNumber)
    const numeric = nums.some((v) => v !== null)
    // a fader needs a value : a press-only message can't play one
    if (isContinuousTarget(target) && !numeric) return
    let c = cap.cands.get(address)
    if (!c) {
      c = { address, host, at: now, fresh: !this.stale.has(address), nargs: args.length, seen: new Map() }
      cap.cands.set(address, c)
      cap.order.push(address)
    }
    nums.forEach((v, i) => {
      if (v === null) return
      const bool = args[i].type === 'T' || args[i].type === 'F'
      const isInt = bool || args[i].type === 'i'
      const s = c!.seen.get(i)
      if (!s) c!.seen.set(i, { min: v, max: v, allInt: isInt, bool })
      else {
        if (v < s.min) s.min = v
        if (v > s.max) s.max = v
        s.allInt = s.allInt && isInt
        s.bool = s.bool && bool
      }
    })
    // the first fresh address decides : one value (or none) binds now, several
    // are watched a moment; with only streams so far, wait for a fresh one
    const fresh = cap.order.map((a) => cap.cands.get(a)!).find((x) => x.fresh)
    if (fresh) {
      if (fresh.seen.size <= 1) return this.close()
      this.closeAt(fresh.at + WINDOW_MS, now)
    } else {
      this.closeAt(cap.cands.get(cap.order[0])!.at + STALE_MS, now)
    }
  }

  private closeAt(at: number, now: number): void {
    const cap = this.cap
    if (!cap) return
    if (now >= at) return this.close()
    if (cap.timer) clearTimeout(cap.timer)
    cap.timer = setTimeout(() => this.close(), at - now)
  }

  private close(): void {
    const cap = this.cap
    if (!cap) return
    this.cap = null
    if (cap.timer) clearTimeout(cap.timer)
    const st = useStore.getState()
    // MIDI took it meanwhile, or the control was let go
    if (!st.midiLearnMode || st.midiLearnTarget !== cap.target) return
    const cands = cap.order.map((a) => cap.cands.get(a)!)
    const c = cands.find((x) => x.fresh) ?? cands[0]
    if (!c) return
    // which value : the only number, else the one that moved most
    let arg = 0
    let seen: (Seen & { bool: boolean }) | null = null
    let best = -1
    for (const [i, s] of [...c.seen].sort((a, b) => a[0] - b[0])) {
      const moved = s.max - s.min
      if (moved > best) {
        best = moved
        arg = i
        seen = s
      }
    }
    const r = seen ? calibrate(seen) : { min: 0, max: 1, int: false }
    const b: OscBinding = {
      kind: 'osc',
      address: c.address,
      arg,
      min: r.min,
      max: r.max,
      ...(seen?.bool ? { bool: true } : r.int ? { int: true } : {}),
      host: c.host
    }
    const scope = st.learnScope
    st.setOscBinding(cap.target, b, scope)
    st.setMidiLearnTarget(null)
    if (seen) this.widening.push({ id: cap.target, scope, address: b.address, arg, until: performance.now() + CALIBRATE_MS, seen: { min: seen.min, max: seen.max, allInt: seen.allInt } })
    const range = seen ? ` · ${fmt(b.min)}..${fmt(b.max)}` : ' · each message a press'
    showToast(`OSC Learn : ${describeAnyBinding(b)}${c.nargs > 1 ? ` (value ${arg + 1} of ${c.nargs})` : ''}${range} → ${triggerLabel(cap.target)}${scope === 'session' ? ' (this session)' : ''}`, 'ok', 4000)
  }

  // A control just learned keeps calibrating its range for a few seconds :
  // it only ever widens (an int fader first seen at 0 and 1 becomes 0..127).
  private widen(address: string, args: Args, now: number): void {
    const st = useStore.getState()
    this.widening = this.widening.filter((w) => {
      if (now > w.until) return false
      if (w.address !== address) return true
      const map = w.scope === 'session' ? st.sessionOscMap : st.oscMap
      const b = map[w.id]
      if (!b || b.address !== w.address || b.arg !== w.arg) return false // moved, deleted, relearned
      const v = oscArgNumber(args[w.arg])
      if (v === null) return true
      const a = args[w.arg]
      w.seen.min = Math.min(w.seen.min, v)
      w.seen.max = Math.max(w.seen.max, v)
      w.seen.allInt = w.seen.allInt && (a.type === 'i' || a.type === 'T' || a.type === 'F')
      const r = calibrate(w.seen, b)
      const int = r.int && !b.bool
      if (r.min !== b.min || r.max !== b.max || !!b.int !== int) {
        const { int: _drop, ...rest } = b
        void _drop
        st.setOscBinding(w.id, { ...rest, min: r.min, max: r.max, ...(int ? { int: true } : {}) }, w.scope)
      }
      return true
    })
  }

  // ── Play ──────────────────────────────────────────────────────────────
  private play(address: string, args: Args, now: number): void {
    const groups = this.index.get(address)
    if (!groups) return
    this.lastArgs.set(address, args)
    const st = useStore.getState()
    for (const g of groups) {
      this.heldUntil.set(g.key, now + HOLD_MS)
      const v = g.arg < args.length ? oscArgNumber(args[g.arg]) : null
      if (v !== null) this.shown.set(g.key, v)
      for (const e of g.live) {
        if (isContinuousTarget(e.id)) {
          if (v !== null) this.queue(e.id, oscNorm(v, e.b))
          continue
        }
        // a trigger : each message with no value is a press; a value presses
        // going up past the middle
        let press = v === null
        if (v !== null) {
          const ek = `${e.scope}|${e.id}|${g.key}`
          const t = oscNorm(v, e.b)
          const was = this.edges.get(ek) ?? false
          if (!was && t >= RISE) {
            this.edges.set(ek, true)
            press = true
          } else if (was && t < REARM) this.edges.set(ek, false)
        }
        if (!press) continue
        if (e.id.startsWith('rule:')) st.setBodyRuleActive(e.id.slice(5), 'toggle', 'osc')
        else fireTrigger(e.id)
      }
    }
  }

  private queue(id: string, t: number): void {
    this.pending.delete(id) // (in the order they came)
    this.pending.set(id, t)
    if (this.flushQueued) return
    this.flushQueued = true
    queueMicrotask(() => this.flush())
  }

  /** Write what the batch so far played (oscInput calls it before an /opsia
   *  message, so between a learned control and its twin the last still wins). */
  flush(): void {
    this.flushQueued = false
    if (!this.pending.size) return
    const p = [...this.pending]
    this.pending.clear()
    for (const [id, t] of p) applyContinuous(id, t)
  }

  // ── Answers ───────────────────────────────────────────────────────────
  private schedule(): void {
    const st = useStore.getState()
    const want = this.running && this.index.size > 0 && Object.values(st.oscReplies).some((r) => r.on && r.port > 0)
    if (want && !this.timer) this.timer = setInterval(() => this.answer(), Math.round(1000 / ANSWER_HZ))
    else if (!want && this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private answer(): void {
    const st = useStore.getState()
    const now = performance.now()
    const out = new Map<string, { host: string; port: number; msgs: Array<{ address: string; args: Args }> }>()
    for (const [address, groups] of this.index) {
      let msg: Args | null = null
      let dest: { host: string; port: number } | null = null
      for (const g of groups) {
        // the first of its controls that has a value answers for the input
        let e: Entry | null = null
        let t: number | null = null
        for (const x of g.live) {
          t = readContinuous(x.id)
          if (t !== null) {
            e = x
            break
          }
        }
        if (!e || t === null) continue
        const rep = st.oscReplies[e.b.host]
        if (!e.b.host || !rep || !rep.on || !(rep.port > 0)) continue
        if ((this.heldUntil.get(g.key) ?? 0) > now) continue // it is moving : leave it alone
        const raw = oscDenorm(t, e.b)
        const prev = this.shown.get(g.key)
        if (prev !== undefined && same(prev, raw, e.b)) continue
        if (dest && (dest.host !== e.b.host || dest.port !== rep.port)) continue // (one controller per address)
        dest = { host: e.b.host, port: rep.port }
        // the controller's whole message, with this value in its place (an XY
        // pad answers both of its values)
        if (!msg) msg = [...(this.lastArgs.get(address) ?? [])]
        msg[g.arg] = e.b.bool ? { type: raw >= 0.5 ? 'T' : 'F', value: raw >= 0.5 } : e.b.int ? { type: 'i', value: raw } : { type: 'f', value: raw }
        this.shown.set(g.key, raw)
      }
      if (!msg || !dest) continue
      // a value never heard before this one (after a restart) : answer only a
      // message whole from the first value to the last
      let whole = true
      for (let i = 0; i < msg.length; i++) if (!msg[i]) whole = false
      if (!whole) continue
      this.lastArgs.set(address, msg)
      const k = `${dest.host}:${dest.port}`
      let o = out.get(k)
      if (!o) out.set(k, (o = { ...dest, msgs: [] }))
      o.msgs.push({ address, args: msg })
    }
    for (const o of out.values()) sendOscBatch(o.host, o.port, o.msgs)
  }
}

function same(prev: number, raw: number, b: OscBinding): boolean {
  if (b.int || b.bool) return Math.round(prev) === Math.round(raw)
  return Math.abs(prev - raw) <= (b.max - b.min) * 0.002
}

function fmt(v: number): string {
  return Number.isInteger(v) ? String(v) : String(Math.round(v * 1000) / 1000)
}

export const oscLearn = new OscLearnEngine()
if (import.meta.hot) {
  const g = globalThis as { __opsiaOscLearn?: OscLearnEngine }
  g.__opsiaOscLearn?.shutdown()
  g.__opsiaOscLearn = oscLearn
}
