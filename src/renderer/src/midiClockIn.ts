// MIDI clock IN : another machine's tempo and transport, followed. A drum
// machine, a DAW or a sequencer sends 24 clock pulses (0xF8) a beat and Start /
// Continue / Stop (0xFA / 0xFB / 0xFC); with "follow MIDI clock" on (this
// computer's setting), the BPM follows the pulses and the Seq transport their
// Start and Stop. Pure : no store, no Web MIDI, so Node can test it. midi.ts
// feeds it and writes what it decides.
//
// The tempo : a least-squares line through the last 96 pulse times (4 beats,
// about 2 s at 120 BPM). One pulse's jitter (a USB frame, a busy main thread :
// a millisecond or two on a 21 ms pulse) is averaged away over the window, so
// the estimate holds to a few hundredths of a BPM. A real tempo change shows in
// the last pulses against the line (8 pulses 8 % off, or a beat 3 % off, by
// their span and by the median of their gaps) and the window starts again from
// them : a jump settles in about a beat. A gap of 300 ms (a cable pulled, a
// clock stopped) starts the window afresh. The BPM is written at most four
// times a second, rounded to 0.1 (a whole number when the clock is within 0.06
// of one), and only when it moved past 0.12 BPM, or past three times the line's
// own uncertainty when the pulses come in bunches : never 24 times a beat,
// never a flicker between two values.
//
// The beat : counted from Start (Continue goes on from the Song Position the
// sender gave, else where it was). The first pulse after a Start is beat 0, as
// the MIDI spec has it; between pulses the beat is carried on by the tempo,
// never past the next pulse, so it never runs ahead of the sender.

const RING = 96
const CHANGE: Array<[number, number]> = [[8, 0.08], [24, 0.03]]

export class ClockFollower {
  private ts = new Float64Array(RING)
  private gaps = new Float64Array(24) // (the median's scratch)
  private head = 0 // next write
  private n = 0 // pulses in the window
  private lastTick = 0
  private lastEst = 0
  /** the estimate (BPM), 0 = none yet */
  bpm = 0
  /** the estimate's standard error (BPM) */
  private bpmErr = 0
  /** ms between pulses, from the estimate */
  private period = 0
  /** pulses since Start (the beat count's source) */
  private pulses = 0
  /** Start or Continue seen, no Stop since */
  running = false
  /** a pulse arrived after the Start (before it, the beat holds at 0) */
  private counting = false
  private writtenAt = -1e9

  /** A clock pulse at `t` (ms, performance.now()'s clock). */
  pulse(t: number): void {
    const last = this.lastTick
    this.lastTick = t
    if (this.running) {
      if (this.counting) this.pulses++
      else this.counting = true // beat 0 : the first pulse after Start
    }
    if (this.n > 0) {
      const dt = t - last
      // a gap, or time running backwards : a fresh window
      if (!(dt > 0) || dt > 300) this.n = 0
    }
    this.ts[this.head] = t
    this.head = (this.head + 1) % RING
    if (this.n < RING) this.n++
    // the estimate, ten times a second at most (it is a loop over the window)
    if (t - this.lastEst >= 100 || this.bpm === 0) {
      this.lastEst = t
      this.estimate()
    }
  }

  /** The window's line : ms per pulse by least squares. */
  private estimate(): void {
    const n = this.n
    if (n < 24) return // a beat first
    const first = (this.head - n + RING) % RING
    const t0 = this.ts[first]
    // a tempo change : the last pulses stand off the line over the whole window
    // (a jump : the last 8 pulses 8 % off; a smaller change : the last beat 3 %
    // off. The window keeps only those pulses, all of the new tempo.)
    // Both the span of those pulses AND the median of their gaps must say so :
    // pulses handed over late in a bunch (no stamps, a busy thread) bend the
    // span but not the median, one pulse's jitter moves the median but not the
    // span much.
    if (this.period > 0) {
      for (const [k, tol] of CHANGE) {
        if (n <= k * 2) continue
        const a = this.ts[(this.head - 1 + RING) % RING]
        const b = this.ts[(this.head - 1 - k + RING) % RING]
        const span = (a - b) / k - this.period
        if (Math.abs(span) <= this.period * tol) continue
        const g = this.gaps.subarray(0, k)
        for (let i = 0; i < k; i++) g[i] = this.ts[(this.head - 1 - i + RING) % RING] - this.ts[(this.head - 2 - i + RING) % RING]
        g.sort()
        const med = (k % 2 ? g[(k - 1) / 2] : (g[k / 2 - 1] + g[k / 2]) / 2) - this.period
        if (Math.abs(med) > this.period * tol && med * span > 0) {
          this.n = k + 1
          if (k + 1 < 24) { this.period = (a - b) / k; return } // too few for a line : the next estimates take it
          return this.estimate()
        }
      }
    }
    let sx = 0, sy = 0
    for (let i = 0; i < n; i++) {
      sx += i
      sy += this.ts[(first + i) % RING] - t0
    }
    const mx = sx / n, my = sy / n
    let sxy = 0, sxx = 0
    for (let i = 0; i < n; i++) {
      const dx = i - mx
      sxy += dx * (this.ts[(first + i) % RING] - t0 - my)
      sxx += dx * dx
    }
    const per = sxx > 0 ? sxy / sxx : 0
    if (!(per > 0)) return
    // how sure the line is (its slope's standard error, as BPM) : pulses
    // handed over late in bunches make it wider, and the BPM then waits for a
    // bigger move before it is written
    let rss = 0
    for (let i = 0; i < n; i++) {
      const r = this.ts[(first + i) % RING] - t0 - my - per * (i - mx)
      rss += r * r
    }
    const se = Math.sqrt(rss / Math.max(1, n - 2) / sxx)
    this.period = per
    this.bpm = 60000 / (per * 24)
    this.bpmErr = (this.bpm * se) / per
  }

  /** The BPM to write now, or null (nothing new, or too soon). `cur` : the
   *  app's BPM as it is (a hand, a scene may have set it meanwhile). */
  bpmToWrite(now: number, cur: number): number | null {
    if (!(this.bpm >= 20 && this.bpm <= 999)) return null
    if (now - this.writtenAt < 250) return null
    const near = Math.round(this.bpm)
    const v = Math.abs(this.bpm - near) < 0.06 ? near : Math.round(this.bpm * 10) / 10
    if (Number.isFinite(cur) && Math.abs(this.bpm - cur) < Math.max(0.12, 3 * this.bpmErr)) return null
    if (v === cur) return null
    this.writtenAt = now
    return v
  }

  start(): void {
    this.running = true
    this.counting = false
    this.pulses = 0
  }

  /** Continue : from the Song Position Pointer (in 16ths) when one came,
   *  else where the count stopped. */
  resume(): void {
    this.running = true
    this.counting = true
  }

  /** Song Position Pointer (0xF2) : the count goes there (in 16ths). */
  songPosition(sixteenths: number): void {
    if (!Number.isFinite(sixteenths) || sixteenths < 0) return
    // the next pulse is that position : count it from just before
    this.pulses = sixteenths * 6 - 1
    this.counting = true
  }

  stop(): void {
    this.running = false
  }

  /** The beat the sender is on at `now` (null : not started). */
  beats(now: number): number | null {
    if (!this.running) return null
    if (!this.counting || this.period <= 0) return Math.max(0, this.pulses) / 24
    const frac = Math.min(1, Math.max(0, (now - this.lastTick) / this.period))
    return Math.max(0, this.pulses + frac) / 24
  }

  /** A pulse came in the last second. */
  alive(now: number): boolean {
    return this.lastTick > 0 && now - this.lastTick < 1000
  }

  /** Forget the tempo (the follow turned off, the source changed). */
  reset(): void {
    this.n = 0
    this.bpm = 0
    this.bpmErr = 0
    this.period = 0
    this.running = false
    this.counting = false
    this.pulses = 0
    this.writtenAt = -1e9
  }
}
