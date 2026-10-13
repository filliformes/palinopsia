// The key sequencer's stage : each mode drawn as it thinks (the way dataFLOU's
// cell sequencer gives every mode its own preview). One color language : a
// key's hue is its place on the circle of fifths, so neighbor keys are neighbor
// colors in every view; the key playing glows and pops when it changes.
//   list      the written keys as tiles, the playing one lit, a trail behind
//   circle    the circle of fifths (majors outside, relative minors inside) :
//             the pool, the key, its trail, the lean and the leap, the relative
//   affinity  a constellation around the key : closer = more shared notes,
//             bigger = likelier at this smoothness, hollow = ruled out
//   pivot     the twelve notes as a clock, the scale lit, and where it may pivot
//   picture   the picture's color on a hue wheel and its brightness against the
//             moods, the key they give; on cuts, the motion with its spikes

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { visionBus } from '../engine/visionIn'
import { NOTE_NAMES, BRIGHT, DIATONIC, affinity, fifthsPos, rootAtFifths, keyId, mod12, isScale, type Key } from '../audio/soniKeyModel'
import { affinityWeight, keySeqMemory, pictureKey, pool } from '../audio/soniKeySeq'
import { SCALE_STEPS, type SoniScale } from '../audio/sonify'
import type { SoniKeySeq } from '@shared/types'

const TAU = Math.PI * 2
const SCALE_ABBR: Record<string, string> = {
  chromatic: 'chr', major: 'maj', minor: 'min', pentatonic: 'pent', wholetone: 'whole', dorian: 'dor', phrygian: 'phr', lydian: 'lyd'
}
// The minor-colored scales sit on the inner ring, under their relative major.
const MINORISH = new Set<string>(['minor', 'dorian', 'phrygian', 'pentatonic'])

const keyHue = (root: number): number => (fifthsPos(root) * 30 + 18) % 360
const parseKey = (id: string): Key | null => {
  const [r, s, o] = id.split(':')
  return isScale(s) ? { root: Number(r), scale: s, oct: Number(o) } : null
}

function useLight(): boolean {
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--c-bg').trim().split(/\s+/).map(Number)
  return 0.2126 * (bg[0] || 0) + 0.7152 * (bg[1] || 0) + 0.0722 * (bg[2] || 0) > 140
}

const MUTED = 'rgb(var(--c-muted))'
const TEXT = 'rgb(var(--c-text))'
const BORDER = 'rgb(var(--c-border))'

function Stage({ children, caption }: { children: ReactNode; caption: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col gap-1 rounded border border-border/60 bg-bg/50 px-1.5 py-1.5">
      {children}
      <span className="text-center font-mono text-[8.5px] text-muted">{caption}</span>
    </div>
  )
}

export function KeySeqVisual(): JSX.Element {
  const ks = useStore((s) => s.soniKeySeq)
  const root = useStore((s) => s.sonify.root)
  const scale = useStore((s) => s.sonify.scale)
  const oct = useStore((s) => s.sonify.rootOct ?? 3)
  const curStep = useStore((s) => s.soniKeyCur)
  const light = useLight()
  const cur: Key = { root: mod12(root), scale, oct }
  const col = (h: number, a = 1): string => `hsl(${h} 80% ${light ? 42 : 62}% / ${a})`
  switch (ks.mode) {
    case 'list': return <ListVis ks={ks} curStep={curStep} col={col} />
    case 'circle': return <CircleVis ks={ks} cur={cur} col={col} />
    case 'affinity': return <AffinityVis ks={ks} cur={cur} col={col} />
    case 'pivot': return <PivotVis ks={ks} cur={cur} col={col} />
    case 'picture': return <PictureVis ks={ks} cur={cur} col={col} />
  }
}

type Col = (h: number, a?: number) => string

// ── list : the written keys as tiles ────────────────────────────────────
function ListVis({ ks, curStep, col }: { ks: SoniKeySeq; curStep: number; col: Col }): JSX.Element {
  const len = Math.max(1, Math.min(8, ks.len))
  // the last few steps played, for a fading trail (bounce and drift read by it)
  const trail = useRef<number[]>([])
  useEffect(() => {
    if (curStep < 0) { trail.current = []; return }
    if (trail.current[trail.current.length - 1] !== curStep) trail.current = [...trail.current, curStep].slice(-4)
  }, [curStep])
  const playing = ks.on && curStep >= 0
  return (
    <Stage caption={ks.order === 'forward' ? '→ in order, looping' : ks.order === 'bounce' ? '⇄ there and back' : `~ a random walk${ks.bias ? ` leaning ${ks.bias > 0 ? 'forward' : 'back'}` : ''}`}>
      <div className="flex min-h-[54px] flex-wrap items-center justify-center gap-1.5 py-1">
        {ks.steps.slice(0, len).map((st, i) => {
          const h = keyHue(st.root)
          const now = playing && i === curStep
          const ti = trail.current.indexOf(i)
          const past = playing && !now && ti >= 0
          return (
            <div
              key={`${i}-${now ? 'now' : ''}`}
              className={`flex h-[44px] w-[30px] flex-col items-center justify-center rounded-md border-[1.5px] font-mono transition-all duration-200 ${now ? 'ks-pop' : ''}`}
              style={{
                borderColor: col(h, now ? 1 : past ? 0.7 : 0.45),
                background: col(h, now ? 0.55 : past ? 0.18 + 0.12 * (ti / 4) : 0.12),
                boxShadow: now ? `0 0 10px ${col(h, 0.85)}, 0 0 22px ${col(h, 0.4)}` : past ? `0 0 5px ${col(h, 0.3)}` : 'none',
                transform: now ? 'scale(1.14)' : 'none'
              }}
              title={`Key ${i + 1} : ${NOTE_NAMES[st.root]} ${st.scale}, octave ${st.oct}`}
            >
              <span className="text-[11px] font-semibold leading-none" style={{ color: now ? TEXT : col(h) }}>{NOTE_NAMES[st.root]}</span>
              <span className="mt-0.5 text-[7.5px] leading-none text-muted">{SCALE_ABBR[st.scale] ?? st.scale}</span>
            </div>
          )
        })}
      </div>
    </Stage>
  )
}

// ── circle : the circle of fifths ───────────────────────────────────────
function CircleVis({ ks, cur, col }: { ks: SoniKeySeq; cur: Key; col: Col }): JSX.Element {
  const W = 240, H = 140, cx = 120, cy = 70, R = 50, Ri = 32
  const { roots } = pool(ks)
  const inner = MINORISH.has(cur.scale)
  // where a key sits : a major-ish on its own place, a minor-ish under its relative major
  const place = (k: Key): { x: number; y: number; ring: 'o' | 'i'; pos: number } => {
    const minor = MINORISH.has(k.scale)
    const pos = fifthsPos(minor ? k.root + 3 : k.root)
    const a = (pos / 12) * TAU - Math.PI / 2
    const r = minor ? Ri : R
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a), ring: minor ? 'i' : 'o', pos }
  }
  const p = place(cur)
  const h = keyHue(cur.root)
  const mem = keySeqMemory()
  const trail = mem.recent.map(parseKey).filter((k): k is Key => !!k && keyId(k) !== keyId(cur)).slice(-4)
  // the lean : an arc from the key, toward the sharps (clockwise) or the flats
  const leanArc = (dir: 1 | -1, alpha: number): JSX.Element => {
    const r = R + 9
    const a0 = (p.pos / 12) * TAU - Math.PI / 2
    const a1 = a0 + dir * (ks.circLeap / 12) * TAU
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0)
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1)
    // the tangent the arc travels along at its end, and the normal
    const tx = -Math.sin(a1) * dir, ty = Math.cos(a1) * dir
    const nx = Math.cos(a1), ny = Math.sin(a1)
    return (
      <g opacity={alpha}>
        <path d={`M ${x0} ${y0} A ${r} ${r} 0 0 ${dir > 0 ? 1 : 0} ${x1} ${y1}`} fill="none" stroke={col(h)} strokeWidth={1.6} strokeLinecap="round" />
        <path d={`M ${x1 - tx * 5 + nx * 3} ${y1 - ty * 5 + ny * 3} L ${x1} ${y1} L ${x1 - tx * 5 - nx * 3} ${y1 - ty * 5 - ny * 3}`} fill="none" stroke={col(h)} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
      </g>
    )
  }
  const lean = ks.circBias
  const rel = cur.scale === 'major' || cur.scale === 'minor'
  const relKey: Key = { root: mod12(cur.root + (cur.scale === 'major' ? 9 : 3)), scale: cur.scale === 'major' ? 'minor' : 'major', oct: cur.oct }
  const rp = place(relKey)
  return (
    <Stage caption={`${lean === 0 ? 'wanders around home' : lean > 0 ? 'leans toward the sharps' : 'leans toward the flats'} · up to ${ks.circLeap} fifth${ks.circLeap > 1 ? 's' : ''}${ks.circRel > 0 ? ` · ${Math.round(ks.circRel * 100)}% to the relative` : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={BORDER} strokeOpacity={0.6} />
        <circle cx={cx} cy={cy} r={Ri} fill="none" stroke={BORDER} strokeOpacity={0.4} strokeDasharray="2 3" />
        {Array.from({ length: 12 }, (_, pos) => {
          const r = rootAtFifths(pos)
          const a = (pos / 12) * TAU - Math.PI / 2
          const inPool = roots.includes(r)
          const hh = keyHue(r)
          const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a)
          const xi = cx + Ri * Math.cos(a), yi = cy + Ri * Math.sin(a)
          const xl = cx + (R + 19) * Math.cos(a), yl = cy + (R + 19) * Math.sin(a)
          return (
            <g key={pos}>
              <circle cx={x} cy={y} r={5} fill={inPool ? col(hh, 0.35) : 'none'} stroke={inPool ? col(hh, 0.9) : BORDER} strokeWidth={1.2} />
              <circle cx={xi} cy={yi} r={2.6} fill={inPool ? col(keyHue(mod12(r + 9)), 0.5) : 'none'} stroke={inPool ? 'none' : BORDER} strokeWidth={0.8} />
              <text x={xl} y={yl} textAnchor="middle" dominantBaseline="central" fontSize={8} fontFamily="ui-monospace, monospace" fill={inPool ? TEXT : MUTED} opacity={inPool ? 0.85 : 0.5}>{NOTE_NAMES[r]}</text>
            </g>
          )
        })}
        {/* the trail of the last keys */}
        {trail.length > 0 && (
          <polyline
            points={[...trail, cur].map((k) => { const q = place(k); return `${q.x},${q.y}` }).join(' ')}
            fill="none" stroke={col(h, 0.35)} strokeWidth={1.2} strokeDasharray="3 2"
          />
        )}
        {trail.map((k, i) => {
          const q = place(k)
          return <circle key={`t${i}`} cx={q.x} cy={q.y} r={3.2} fill={col(keyHue(k.root), 0.25 + (0.4 * (i + 1)) / trail.length)} />
        })}
        {/* the relative hop */}
        {rel && ks.circRel > 0 && (
          <line x1={p.x} y1={p.y} x2={rp.x} y2={rp.y} stroke={col(h)} strokeWidth={1.2} strokeDasharray="2 2" opacity={0.2 + 0.7 * ks.circRel} />
        )}
        {/* the lean and the leap */}
        {lean === 0 ? <>{leanArc(1, 0.35)}{leanArc(-1, 0.35)}</> : leanArc(lean > 0 ? 1 : -1, 0.35 + 0.6 * Math.abs(lean))}
        {/* the key */}
        <g key={keyId(cur)}>
          <circle cx={p.x} cy={p.y} r={inner ? 6.5 : 8.5} fill="none" stroke={col(h)} strokeWidth={1.5} className="ks-ring" />
          <circle cx={p.x} cy={p.y} r={inner ? 5.5 : 7.5} fill={col(h, 0.95)} className="ks-pop" style={{ filter: `drop-shadow(0 0 5px ${col(h, 0.9)})` }} />
        </g>
        <text x={cx} y={cy - 3} textAnchor="middle" fontSize={9.5} fontWeight={600} fontFamily="ui-monospace, monospace" fill={col(h)}>{NOTE_NAMES[cur.root]}</text>
        <text x={cx} y={cy + 8} textAnchor="middle" fontSize={7.5} fontFamily="ui-monospace, monospace" fill={MUTED}>{cur.scale}</text>
      </svg>
    </Stage>
  )
}

// ── affinity : a constellation around the key ───────────────────────────
function AffinityVis({ ks, cur, col }: { ks: SoniKeySeq; cur: Key; col: Col }): JSX.Element {
  const W = 240, H = 140, cx = 120, cy = 70, Rmax = 60
  const { roots, scales } = pool(ks)
  const mem = keySeqMemory()
  const cands: Array<{ k: Key; a: number; w: number; out: boolean; si: number }> = []
  for (const root of roots) {
    scales.forEach((scale, si) => {
      const k = { root, scale, oct: cur.oct }
      if (root === cur.root && scale === cur.scale) return
      const id = keyId(k)
      const out = (ks.affNoRepeat && mem.recent.includes(id)) || (ks.affTour && mem.started && mem.visited.has(id))
      const a = affinity(cur, k)
      cands.push({ k, a, w: affinityWeight(ks.affSmooth, a), out, si })
    })
  }
  const total = cands.reduce((s, c) => s + (c.out ? 0 : c.w), 0) || 1
  const maxP = Math.max(...cands.map((c) => (c.out ? 0 : c.w / total)), 1e-6)
  const top = [...cands].filter((c) => !c.out).sort((a, b) => b.w - a.w).slice(0, 3)
  const h = keyHue(cur.root)
  const pt = (c: { k: Key; a: number; si: number }): { x: number; y: number } => {
    const spread = scales.length > 1 ? (c.si - (scales.length - 1) / 2) * (0.5 / scales.length) : 0
    const ang = ((fifthsPos(c.k.root) + spread) / 12) * TAU - Math.PI / 2
    const r = 10 + (1 - c.a) * (Rmax - 10)
    return { x: cx + r * Math.cos(ang), y: cy + r * Math.sin(ang) }
  }
  return (
    <Stage caption={`closer = more shared notes · bigger = likelier (${ks.affSmooth > 0 ? 'smooth' : ks.affSmooth < 0 ? 'jarring' : 'even'} ${ks.affSmooth > 0 ? '+' : ''}${ks.affSmooth})${ks.affTour ? ' · hollow = toured' : ks.affNoRepeat ? ' · hollow = just played' : ''}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
        {[0.33, 0.66, 1].map((f) => (
          <circle key={f} cx={cx} cy={cy} r={10 + f * (Rmax - 10)} fill="none" stroke={BORDER} strokeOpacity={0.35} strokeDasharray={f === 1 ? undefined : '2 3'} />
        ))}
        {cands.map((c, i) => {
          const q = pt(c)
          const hh = keyHue(c.k.root)
          const pr = c.out ? 0 : c.w / total
          const rad = 1.4 + 5.6 * Math.sqrt(pr / maxP)
          return c.out
            ? <circle key={i} cx={q.x} cy={q.y} r={2.4} fill="none" stroke={col(hh, 0.6)} strokeWidth={0.9} strokeDasharray="1.5 1.5"><title>{`${NOTE_NAMES[c.k.root]} ${c.k.scale} : ruled out for now`}</title></circle>
            : <circle key={i} cx={q.x} cy={q.y} r={rad} fill={col(hh, 0.75)} style={{ transition: 'r 220ms ease-out' }}><title>{`${NOTE_NAMES[c.k.root]} ${c.k.scale} : ${Math.round(c.a * 100)}% shared notes, ${Math.round(pr * 100)}% likely`}</title></circle>
        })}
        {top.map((c, i) => {
          const q = pt(c)
          return <text key={`l${i}`} x={q.x + 7} y={q.y + 3} fontSize={7.5} fontFamily="ui-monospace, monospace" fill={TEXT} opacity={0.85}>{`${NOTE_NAMES[c.k.root]} ${SCALE_ABBR[c.k.scale]}`}</text>
        })}
        <g key={keyId(cur)}>
          <circle cx={cx} cy={cy} r={9} fill="none" stroke={col(h)} strokeWidth={1.5} className="ks-ring" />
          <circle cx={cx} cy={cy} r={8} fill={col(h, 0.95)} className="ks-pop" style={{ filter: `drop-shadow(0 0 6px ${col(h, 0.9)})` }} />
        </g>
        <text x={cx} y={cy + 3} textAnchor="middle" fontSize={7.5} fontWeight={700} fontFamily="ui-monospace, monospace" fill="#111">{NOTE_NAMES[cur.root]}</text>
      </svg>
    </Stage>
  )
}

// ── pivot : the notes as a clock ────────────────────────────────────────
function PivotVis({ ks, cur, col }: { ks: SoniKeySeq; cur: Key; col: Col }): JSX.Element {
  const W = 240, H = 140, cx = 66, cy = 70, R = 46
  const { roots, scales } = pool(ks)
  const set = new Set(SCALE_STEPS[cur.scale].map((s) => mod12(cur.root + s)))
  const h = keyHue(cur.root)
  const dia = DIATONIC.find(([s]) => s === cur.scale)
  const modes = ks.pivKind === 'modes' && !!dia
  // the places it may go : the other degrees (same notes) or the other modes (same tonic)
  const parent = dia ? mod12(cur.root - dia[1]) : cur.root
  const ladder: Array<{ label: string; scale: SoniScale; root: number; here: boolean }> = modes
    ? DIATONIC.filter(([s, off]) => s === cur.scale || (scales.includes(s) && roots.includes(mod12(parent + off))))
        .map(([s, off]) => ({ label: `${['I', 'II', 'III', 'IV', '', 'VI'][[0, 2, 4, 5, 7, 9].indexOf(off)] || ''} ${NOTE_NAMES[mod12(parent + off)]} ${s}`, scale: s, root: mod12(parent + off), here: s === cur.scale }))
    : BRIGHT.filter((s) => s === cur.scale || scales.includes(s)).map((s) => ({ label: `${NOTE_NAMES[cur.root]} ${s}`, scale: s, root: cur.root, here: s === cur.scale }))
  const way = ks.pivDir === 'random' ? 'any other' : modes ? `the next degree ${ks.pivDir}` : ks.pivDir === 'up' ? 'brighter' : 'darker'
  return (
    <Stage caption={`${modes ? 'same notes, a new tonic' : 'same tonic, a new mode'} · ${way}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
        <circle cx={cx} cy={cy} r={R} fill="none" stroke={BORDER} strokeOpacity={0.5} />
        {Array.from({ length: 12 }, (_, pc) => {
          const a = (pc / 12) * TAU - Math.PI / 2
          const x = cx + R * Math.cos(a), y = cy + R * Math.sin(a)
          const xl = cx + (R + 12) * Math.cos(a), yl = cy + (R + 12) * Math.sin(a)
          const lit = set.has(pc)
          const tonic = pc === cur.root
          const degree = modes && ladder.find((l) => l.root === pc && !l.here)
          return (
            <g key={pc}>
              {tonic
                ? <g key={keyId(cur)}><circle cx={x} cy={y} r={7.5} fill={col(h, 0.95)} className="ks-pop" style={{ filter: `drop-shadow(0 0 5px ${col(h, 0.9)})` }} /></g>
                : <circle cx={x} cy={y} r={lit ? 4.6 : 2.6} fill={lit ? col(h, 0.55) : 'none'} stroke={lit ? col(h, 0.9) : BORDER} strokeWidth={1} />}
              {degree && <circle cx={x} cy={y} r={7.5} fill="none" stroke={col(keyHue(pc), 0.9)} strokeWidth={1.2} strokeDasharray="2 2" />}
              <text x={xl} y={yl} textAnchor="middle" dominantBaseline="central" fontSize={7.5} fontFamily="ui-monospace, monospace" fill={lit ? TEXT : MUTED} opacity={lit ? 0.9 : 0.45}>{NOTE_NAMES[pc]}</text>
            </g>
          )
        })}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={9} fontWeight={600} fontFamily="ui-monospace, monospace" fill={col(h)}>{NOTE_NAMES[cur.root]}</text>
        <text x={cx} y={cy + 9} textAnchor="middle" fontSize={7} fontFamily="ui-monospace, monospace" fill={MUTED}>{cur.scale}</text>
        {/* where it may go */}
        <text x={136} y={12} fontSize={7} fontFamily="ui-monospace, monospace" fill={MUTED}>{modes ? 'the degrees' : 'bright'}</text>
        {ladder.map((l, i) => {
          const y = 24 + i * 15
          const hh = keyHue(l.root)
          return (
            <g key={l.label}>
              <rect x={134} y={y - 8} width={100} height={13} rx={4} fill={l.here ? col(hh, 0.5) : col(hh, 0.1)} stroke={col(hh, l.here ? 1 : 0.4)} strokeWidth={l.here ? 1.4 : 0.8} style={l.here ? { filter: `drop-shadow(0 0 4px ${col(hh, 0.7)})` } : undefined} />
              <text x={140} y={y + 1.5} fontSize={7.5} fontFamily="ui-monospace, monospace" fill={l.here ? TEXT : MUTED}>{l.label}</text>
            </g>
          )
        })}
        {!modes && <text x={136} y={24 + ladder.length * 15} fontSize={7} fontFamily="ui-monospace, monospace" fill={MUTED}>dark</text>}
      </svg>
    </Stage>
  )
}

// ── picture : the color and the brightness that choose the key ──────────
function PictureVis({ ks, cur, col }: { ks: SoniKeySeq; cur: Key; col: Col }): JSX.Element {
  const W = 240, H = 140, cx = 58, cy = 62, R = 44
  // the motion history (cuts) : a short strip, sampled 8 times a second
  const hist = useRef<number[]>([])
  const avg = useRef(0)
  const [, setTick] = useState(0)
  useEffect(() => {
    const id = window.setInterval(() => {
      if (visionBus.hasData()) {
        const m = visionBus.feature('motion')
        hist.current = [...hist.current, m].slice(-56)
        avg.current = avg.current ? avg.current * 0.95 + m * 0.05 : m
      }
      setTick((x) => x + 1)
    }, 125)
    return () => window.clearInterval(id)
  }, [])
  const has = visionBus.hasData()
  const hue = visionBus.feature('hue'), sat = visionBus.feature('saturation'), bri = visionBus.feature('brightness')
  const pk = has ? pictureKey(ks, cur) : null
  const { scales } = pool(ks)
  const moods = BRIGHT.filter((s) => s !== 'chromatic' && scales.includes(s))
  const grey = sat <= 0.08
  const ma = hue * TAU - Math.PI / 2
  const mr = R * (0.25 + 0.7 * Math.min(1, sat))
  const cuts = ks.picSource === 'cuts'
  const thr = Math.max(0.12, avg.current * 3 + 0.02)
  return (
    <Stage caption={has ? (cuts ? 'a new key at each scene cut (the spikes past the line)' : 'its color picks the root, its brightness the mood') : 'the picture is read while the sequencer plays or this page is open'}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ overflow: 'visible' }}>
        {/* the hue wheel */}
        {Array.from({ length: 24 }, (_, i) => {
          const a0 = (i / 24) * TAU - Math.PI / 2, a1 = ((i + 1) / 24) * TAU - Math.PI / 2
          const r0 = R - 4, r1 = R + 4
          const d = `M ${cx + r0 * Math.cos(a0)} ${cy + r0 * Math.sin(a0)} L ${cx + r1 * Math.cos(a0)} ${cy + r1 * Math.sin(a0)} A ${r1} ${r1} 0 0 1 ${cx + r1 * Math.cos(a1)} ${cy + r1 * Math.sin(a1)} L ${cx + r0 * Math.cos(a1)} ${cy + r0 * Math.sin(a1)} A ${r0} ${r0} 0 0 0 ${cx + r0 * Math.cos(a0)} ${cy + r0 * Math.sin(a0)} Z`
          return <path key={i} d={d} fill={`hsl(${i * 15} 70% 55% / 0.75)`} />
        })}
        {has && (
          <>
            <line x1={cx} y1={cy} x2={cx + mr * Math.cos(ma)} y2={cy + mr * Math.sin(ma)} stroke={grey ? MUTED : `hsl(${hue * 360} 80% 60%)`} strokeWidth={1.2} opacity={0.7} />
            <circle cx={cx + mr * Math.cos(ma)} cy={cy + mr * Math.sin(ma)} r={4.5} fill={grey ? MUTED : `hsl(${hue * 360} 85% 60%)`} stroke="#fff" strokeWidth={1.2} style={{ filter: grey ? undefined : `drop-shadow(0 0 4px hsl(${hue * 360} 90% 60%))` }} />
          </>
        )}
        <text x={cx} y={cy + 4} textAnchor="middle" fontSize={11} fontWeight={700} fontFamily="ui-monospace, monospace" fill={pk ? col(keyHue(pk.root)) : MUTED}>{pk ? NOTE_NAMES[pk.root] : '·'}</text>
        {grey && has && <text x={cx} y={cy + 15} textAnchor="middle" fontSize={6.5} fontFamily="ui-monospace, monospace" fill={MUTED}>grey : keeps root</text>}
        {/* the brightness against the moods */}
        <defs>
          <linearGradient id="ksBri" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#000" />
            <stop offset="1" stopColor="#fff" />
          </linearGradient>
        </defs>
        <rect x={120} y={16} width={8} height={92} rx={3} fill="url(#ksBri)" stroke={BORDER} strokeWidth={0.6} />
        {has && <polygon points={`${116},${16 + (1 - bri) * 92} ${120},${16 + (1 - bri) * 92 - 3} ${120},${16 + (1 - bri) * 92 + 3}`} fill={TEXT} />}
        {moods.map((m, i) => {
          const y = 22 + (moods.length > 1 ? (i / (moods.length - 1)) * 80 : 40)
          const here = pk?.scale === m
          return (
            <g key={m}>
              <text x={134} y={y + 2.5} fontSize={here ? 8.5 : 7.5} fontWeight={here ? 700 : 400} fontFamily="ui-monospace, monospace" fill={here ? col(keyHue(pk!.root)) : MUTED}>{m}</text>
            </g>
          )
        })}
        {pk && <text x={234} y={130} textAnchor="end" fontSize={8} fontFamily="ui-monospace, monospace" fill={col(keyHue(pk.root))}>{`→ ${NOTE_NAMES[pk.root]} ${pk.scale}`}</text>}
        {/* the motion, for cuts */}
        {cuts && (
          <g>
            <line x1={8} x2={110} y1={134 - Math.min(1, thr) * 22} y2={134 - Math.min(1, thr) * 22} stroke={MUTED} strokeDasharray="2 2" strokeWidth={0.7} />
            {hist.current.map((m, i) => {
              const x = 8 + i * (102 / 56)
              const spike = m > thr
              return <rect key={i} x={x} y={134 - Math.min(1, m) * 22} width={1.4} height={Math.max(0.5, Math.min(1, m) * 22)} fill={spike ? col(keyHue(cur.root)) : MUTED} opacity={spike ? 1 : 0.5} />
            })}
          </g>
        )}
      </svg>
    </Stage>
  )
}
