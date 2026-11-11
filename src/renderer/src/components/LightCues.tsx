// The light scenes as a cue list : GO and back, each cue with its own fade, a
// follow time (the next one goes by itself) and the Palinopsia scene it goes
// with. On the Lights page and as a lane of the Seq page (the same list).

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { MidiLearnOverlay } from './MidiLearnOverlay'

const btn = (on: boolean): string =>
  `rounded border px-2 py-1 font-mono text-[10px] transition-colors ${
    on ? 'border-accent/60 bg-accent/15 text-accent' : 'border-border text-muted hover:text-text'
  }`

/** GO, back, and the cues following on by themselves (MIDI Learn on each). */
export function LightCueButtons({ lane = false }: { lane?: boolean }): JSX.Element {
  const run = useStore((s) => s.lightCueRun)
  const can = useStore((s) => s.lightsSession.scenes.some((c) => (c.follow ?? 0) > 0))
  const n = useStore((s) => s.lightsSession.scenes.length)
  const st = useStore.getState
  return (
    <div className="flex items-center gap-1">
      <span className="relative">
        <MidiLearnOverlay id="fire:lightsback" />
        <button className={`${btn(false)} disabled:opacity-40`} disabled={!n} onClick={() => st().goLightCue(-1)} title="The cue before">◀ back</button>
      </span>
      <span className="relative">
        <MidiLearnOverlay id="fire:lightsgo" />
        <button
          className={`rounded border px-3 py-1 font-mono text-[11px] font-semibold disabled:opacity-40 ${n ? 'border-accent bg-accent/15 text-accent hover:bg-accent/25' : 'border-border text-muted'}`}
          disabled={!n}
          onClick={() => st().goLightCue(1)}
          title="The next cue (after the last : the first)"
        >
          GO
        </button>
      </span>
      {/* (in the Seq lane, the lane's own play is this switch) */}
      {!lane && (
        <span className="relative">
          <MidiLearnOverlay id="fire:lightscues" />
          <button
            className={`${btn(run)} disabled:opacity-40`}
            disabled={!run && !can}
            onClick={() => st().setLightCueRun(!run)}
            title={can || run ? "Following on : a cue with a follow time hands over to the next one by itself (a cue without one waits for GO). The Seq page's transport starts and stops it too" : 'Give a cue a follow time first (⚙ on a cue : then)'}
          >
            {run ? '◉ following' : 'follow'}
          </button>
        </span>
      )}
    </div>
  )
}

/** The cue in now, and how far along its fade and follow it is. */
export function LightCueNow(): JSX.Element {
  const cue = useStore((s) => s.lightsSession.scenes.find((c) => c.id === s.lightCue) ?? null)
  const i = useStore((s) => s.lightsSession.scenes.findIndex((c) => c.id === s.lightCue))
  return <span className="font-mono text-[10px] text-muted">{cue ? `cue ${i + 1} · ${cue.name}` : 'no cue yet'}</span>
}

/** Seconds typed whole ("2.5" is never read as "2" then "5") : taken on Enter or
 *  when the box is left; empty : none. */
function TimeBox({ value, placeholder, max, onCommit }: { value: number | null; placeholder: string; max: number; onCommit: (v: number | null) => void }): JSX.Element {
  const [txt, setTxt] = useState<string | null>(null)
  return (
    <input
      type="text" inputMode="decimal"
      value={txt ?? (value === null ? '' : String(value))}
      placeholder={placeholder}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => {
        if (txt !== null) { const n = Number(txt.replace(',', '.')); onCommit(txt.trim() === '' ? null : Number.isFinite(n) ? Math.max(0, Math.min(max, n)) : value) }
        setTxt(null)
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); else if (e.key === 'Escape') { setTxt(null); e.stopPropagation() } }}
      className="w-14 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text"
    />
  )
}

function Progress({ id }: { id: string }): JSX.Element | null {
  const bar = useRef<HTMLSpanElement | null>(null)
  useEffect(() => {
    let raf = 0
    const f = (): void => {
      raf = requestAnimationFrame(f)
      const st = useStore.getState()
      const sc = st.lightsSession.scenes.find((c) => c.id === id)
      if (!bar.current || !sc) return
      const fade = sc.fade ?? st.lightsSession.master.fadeSec
      const total = fade + (st.lightCueRun && sc.follow ? sc.follow : 0)
      const t = (performance.now() - st.lightCueAt) / 1000
      bar.current.style.width = `${Math.max(0, Math.min(1, total > 0 ? t / total : 1)) * 100}%`
    }
    raf = requestAnimationFrame(f)
    return () => cancelAnimationFrame(raf)
  }, [id])
  return (
    <span className="absolute inset-x-0 bottom-0 h-[2px] bg-accent/10">
      <span ref={bar} className="block h-full bg-accent/70" />
    </span>
  )
}

export function LightCueList({ row = false }: { row?: boolean }): JSX.Element {
  const scenes = useStore((s) => s.lightsSession.scenes)
  const cur = useStore((s) => s.lightCue)
  const fadeDef = useStore((s) => s.lightsSession.master.fadeSec)
  const pscenes = useStore((s) => s.scenes)
  const st = useStore.getState
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  if (!scenes.length) return <p className="font-mono text-[10px] text-muted">No cues yet : set the lights, then + save.</p>
  return (
    <div className={row ? 'flex gap-1.5 overflow-x-auto pb-1' : 'flex flex-col gap-0.5'}>
      {scenes.map((sc, i) => {
        const on = sc.id === cur
        const link = sc.link ? pscenes.find((p) => p.id === sc.link) : null
        const summary = `${(sc.fade ?? fadeDef).toFixed(1)} s${sc.fade === undefined ? '' : '*'}${sc.follow ? ` · then ${sc.follow} s` : ''}${link ? ` · ↔ ${link.name}` : ''}`
        return (
          <div key={sc.id} className={`relative flex shrink-0 flex-col gap-0.5 rounded border ${on ? 'border-accent/60 bg-accent/10' : 'border-transparent'} ${row ? 'w-48 border-border p-1' : ''}`}>
            <div className="flex items-center gap-1">
              {editing === sc.id ? (
                <input
                  autoFocus
                  defaultValue={sc.name}
                  onBlur={(e) => { st().renameLightScene(sc.id, e.target.value); setEditing(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 font-mono text-[10px]"
                />
              ) : (
                <button
                  onClick={() => st().recallLightScene(sc.id)}
                  onDoubleClick={() => setEditing(sc.id)}
                  className={`flex min-w-0 flex-1 flex-col rounded px-1.5 py-0.5 text-left font-mono text-[10px] hover:bg-panel3/60 ${on ? 'text-accent' : 'text-text'}`}
                  title="Click : this cue now (over its fade) · double-click : rename"
                >
                  <span className="truncate"><span className="text-muted">{i + 1}</span> {sc.name}</span>
                  <span className="truncate text-[9px] text-muted">{summary}</span>
                </button>
              )}
              <button className={`px-1 font-mono text-[10px] ${open === sc.id ? 'text-accent' : 'text-muted hover:text-text'}`} onClick={() => setOpen(open === sc.id ? null : sc.id)} title="Its fade, its follow time, its Palinopsia scene">⚙</button>
              <button className="px-1 font-mono text-[11px] text-muted hover:text-red-400" onClick={() => st().deleteLightScene(sc.id)} title="Delete this cue">×</button>
            </div>
            {open === sc.id && (
              <div className="flex flex-col gap-1 px-1.5 pb-1 font-mono text-[9px] text-muted">
                <label className="flex items-center gap-1" title="How long it takes to come in (empty : the console's scene fade)">
                  <span className="w-12 shrink-0">fade</span>
                  <TimeBox value={sc.fade ?? null} placeholder={fadeDef.toFixed(1)} max={60} onCommit={(v) => st().updateLightScene(sc.id, { fade: v })} />
                  s
                </label>
                <label className="flex items-center gap-1" title="Once it is in, the next cue goes this long after, by itself, while the cues follow on (0 : it waits for GO)">
                  <span className="w-12 shrink-0">then</span>
                  <TimeBox value={sc.follow ?? 0} placeholder="0" max={3600} onCommit={(v) => st().updateLightScene(sc.id, { follow: v ?? 0 })} />
                  s {sc.follow ? 'to the next' : '(waits for GO)'}
                </label>
                <label className="flex items-center gap-1" title="A Palinopsia scene : recalling it brings this cue (its picture and its lights together)">
                  <span className="w-12 shrink-0">with</span>
                  <select
                    value={sc.link ?? ''}
                    onChange={(e) => st().updateLightScene(sc.id, { link: e.target.value || null })}
                    className="min-w-0 flex-1 rounded border border-border bg-panel px-1 py-0.5 text-[10px] text-text"
                  >
                    <option value="">no scene</option>
                    {pscenes.map((p, k) => <option key={p.id} value={p.id}>{k + 1} · {p.name}</option>)}
                  </select>
                </label>
              </div>
            )}
            {on && <Progress id={sc.id} />}
          </div>
        )
      })}
    </div>
  )
}
