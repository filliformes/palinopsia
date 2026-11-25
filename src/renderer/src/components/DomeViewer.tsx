// The dome viewer : DomeSim's picture with a head in it. Look by dragging, walk or
// fly with the keys or a gamepad, take a seat, read the numbers, see where you
// stand on the floor plan. It shows on the Output page, over that whole page
// (expand), or alone in a window of its own (PageWindow.tsx).
//
// The keys belong to it only while it has the focus (a click in it; the frame
// lights), and only the ones it uses : everything else, and every key once the
// focus leaves, is Palinopsia's.

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { create } from 'zustand'
import { domeRoom } from '@shared/dome'
import { useStore } from '../store'
import { formatHz } from '../perf'
import {
  clampPitch, domeCam, domeDensity, domeFrame, domeHit, keepInside, lookDir, saveDomeCam, seatDomeCam, stepDomeCam,
  type DomeInput, type DomeMove, type DomeSeat, type Vec3
} from '../engine/domeView'
import { DomeSim, type DomeSimInfo } from './DomeSim'

/** Bumped when the head's discrete state changes (a seat, walk / fly, a posture),
 *  for the buttons that show it. Moving never re-renders anything. */
export const useDomeSeat = create<{ v: number }>(() => ({ v: 0 }))
export function domeSeatChanged(): void {
  saveDomeCam()
  useDomeSeat.setState((s) => ({ v: s.v + 1 }))
}

/** Inside : from a seat, facing front, eyes a little up. Outside : behind the dome
 *  and above, looking at the front half's inner surface (the cutaway). */
export function takeDomeSeat(seat: DomeSeat | 'outside' | 'whole'): void {
  const st = useStore.getState()
  if (seat === 'outside') {
    Object.assign(domeCam, { yaw: Math.PI, pitch: 0.35, dist: 2.6 })
    st.setDomeSim({ view: 'outside' })
  } else if (seat === 'whole') {
    // the whole inside at once : backed off below the dome's opening, looking up
    seatDomeCam(domeCam, domeRoom(st.dome), 'best')
    Object.assign(domeCam, { yaw: 0, pitch: 1.25 })
    st.setDomeSim({ view: 'inside', back: 1.7, fov: 78 })
  } else {
    seatDomeCam(domeCam, domeRoom(st.dome), seat)
    st.setDomeSim({ view: 'inside', back: 0, fov: 100 })
  }
  domeSeatChanged()
}

const SEATS: Array<[DomeSeat | 'outside' | 'whole', string, string]> = [
  ['best', 'best seat', 'The center of the sphere : the one point the master is made for, where nothing is distorted (the eye is at the sphere’s center, higher than a standing one)'],
  ['center', 'center', 'Standing on the floor in the middle of the room'],
  ['back', 'back row', 'Near the back of the room, facing the front'],
  ['side', 'side', 'Near the right side of the room, facing the front'],
  ['lying', 'lying', 'On your back in the middle of the room, looking at the zenith'],
  ['whole', 'whole dome', 'The whole inside at once : the camera backs off below the dome’s opening and looks up'],
  ['outside', 'outside', 'Orbit the dome from outside (a cutaway : the near shell is hidden)']
]

/** The keys the viewer takes while it has the focus, by their place on the
 *  keyboard (the same hand on any layout). */
const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])
const num = (v: number, d = 1): string => v.toFixed(d)
const deg = (r: number): number => (r * 180) / Math.PI

export function DomeViewer({ inWindow = false, expanded = false, setExpanded, covered = false }: {
  /** Alone in its own window. */
  inWindow?: boolean
  /** Over the whole Output page. */
  expanded?: boolean
  setExpanded?: (on: boolean) => void
  /** Another page lies over it. */
  covered?: boolean
}): JSX.Element {
  const dome = useStore((s) => s.dome)
  const setDomeSim = useStore((s) => s.setDomeSim)
  const setDomeViewWindow = useStore((s) => s.setDomeViewWindow)
  const view = useStore((s) => s.domeView)
  useDomeSeat((s) => s.v)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [focused, setFocused] = useState(false)
  const keys = useRef(new Set<string>())
  const shift = useRef(false)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const padEdge = useRef(0)
  const stoppedAt = useRef(0)
  const line1 = useRef<HTMLDivElement | null>(null)
  const line2 = useRef<HTMLDivElement | null>(null)
  const line3 = useRef<HTMLDivElement | null>(null)
  const line4 = useRef<HTMLDivElement | null>(null)
  const you = useRef<SVGGElement | null>(null)
  const cone = useRef<SVGPolygonElement | null>(null)
  const mapShown = useRef('')
  const inside = dome.sim.view === 'inside'
  const room = domeRoom(dome)

  // Expanded, Esc goes back to the page first (it closed the whole Output page).
  useEffect(() => {
    if (!expanded) return
    const win = rootRef.current?.ownerDocument.defaultView ?? window
    rootRef.current?.focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      if (e.key !== 'Escape' || el?.tagName === 'INPUT' || el?.tagName === 'SELECT' || el?.tagName === 'TEXTAREA') return
      e.preventDefault()
      e.stopPropagation()
      setExpanded?.(false)
    }
    win.addEventListener('keydown', onKey, true)
    return () => win.removeEventListener('keydown', onKey, true)
  }, [expanded, setExpanded])

  const setMove = (m: DomeMove): void => {
    domeCam.move = m
    domeSeatChanged()
  }

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return
    shift.current = e.shiftKey
    if (view !== '3d') return
    if (e.code === 'Escape') {
      // (expanded : the listener above has it) let the keyboard go
      e.preventDefault()
      e.stopPropagation()
      ;(rootRef.current?.ownerDocument.activeElement as HTMLElement | null)?.blur?.()
      return
    }
    if (e.key === 'Shift') { e.stopPropagation(); return }
    if (e.code === 'KeyR' || e.code === 'KeyF') {
      e.preventDefault()
      e.stopPropagation()
      if (e.repeat) return
      if (e.code === 'KeyR') takeDomeSeat('best')
      else setMove(domeCam.move === 'walk' ? 'fly' : 'walk')
      return
    }
    if (!MOVE_KEYS.has(e.code)) return
    e.preventDefault()
    e.stopPropagation()
    keys.current.add(e.code)
  }
  const onKeyUp = (e: ReactKeyboardEvent): void => {
    shift.current = e.shiftKey
    if (keys.current.delete(e.code)) e.stopPropagation()
  }
  const dropKeys = (): void => {
    keys.current.clear()
    shift.current = false
  }

  /** The gamepad's sticks and buttons, the way most games hold them. */
  const readPad = (inp: DomeInput): void => {
    const nav = rootRef.current?.ownerDocument.defaultView?.navigator ?? navigator
    const pads = nav.getGamepads?.()
    if (!pads) return
    const dz = (v: number): number => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85)
    for (const p of pads) {
      if (!p || !p.connected || p.mapping !== 'standard') continue
      inp.side += dz(p.axes[0] ?? 0)
      inp.fwd -= dz(p.axes[1] ?? 0)
      inp.yaw += dz(p.axes[2] ?? 0) * 1.9
      inp.pitch -= dz(p.axes[3] ?? 0) * 1.4
      const on = (i: number): boolean => !!p.buttons[i]?.pressed
      if (on(0) || on(10)) inp.run = true
      if (on(5)) inp.up += 1
      if (on(4)) inp.up -= 1
      const edge = (on(1) ? 1 : 0) | (on(3) ? 2 : 0)
      if (edge & ~padEdge.current & 1) takeDomeSeat('best')
      if (edge & ~padEdge.current & 2) setMove(domeCam.move === 'walk' ? 'fly' : 'walk')
      padEdge.current = edge
      break
    }
  }

  const onStep = (dt: number): void => {
    if (view === '3d' && inside) {
      const k = keys.current
      const has = (...c: string[]): number => (c.some((x) => k.has(x)) ? 1 : 0)
      const inp: DomeInput = {
        fwd: has('KeyW', 'ArrowUp') - has('KeyS', 'ArrowDown'),
        side: has('KeyD', 'ArrowRight') - has('KeyA', 'ArrowLeft'),
        up: has('KeyE') - has('KeyQ'),
        yaw: 0, pitch: 0,
        run: shift.current
      }
      readPad(inp)
      const was = domeCam.best
      const moved = stepDomeCam(domeCam, room, inp, dt)
      if (was !== domeCam.best) {
        if (dome.sim.back > 0) setDomeSim({ back: 0 }) // walking is from where you stand
        domeSeatChanged()
      }
      if (moved) stoppedAt.current = 0.6
      else if (stoppedAt.current > 0 && (stoppedAt.current -= dt) <= 0) saveDomeCam()
    }
    // The floor plan follows, written straight to the drawing.
    const g = you.current
    if (g) {
      const el = rootRef.current
      const asp = el && el.clientHeight > 0 ? el.clientWidth / el.clientHeight : 1.6
      const half = Math.atan(Math.tan(((dome.sim.fov / 2) * Math.PI) / 180) * asp)
      const key = `${num(domeCam.x, 2)},${num(domeCam.z, 2)},${num(domeCam.yaw, 3)},${num(half, 2)}`
      if (key !== mapShown.current) {
        mapShown.current = key
        g.setAttribute('transform', `translate(${domeCam.x} ${domeCam.z}) rotate(${deg(domeCam.yaw)})`)
        const l = room.R * 0.55
        cone.current?.setAttribute('points', `0,0 ${-l * Math.sin(half)},${-l * Math.cos(half)} ${l * Math.sin(half)},${-l * Math.cos(half)}`)
      }
    }
  }

  const onInfo = (i: DomeSimInfo): void => {
    const set = (el: HTMLDivElement | null, t: string): void => { if (el && el.textContent !== t) el.textContent = t }
    const c = domeCam
    if (inside) {
      const eye: Vec3 = [c.x, c.best ? room.cy : c.y, c.z]
      const side = Math.abs(c.x) < 0.05 ? '' : `${num(Math.abs(c.x))} m ${c.x > 0 ? 'right' : 'left'}`
      const depth = Math.abs(c.z) < 0.05 ? '' : `${num(Math.abs(c.z))} m ${c.z > 0 ? 'back' : 'front'}`
      set(line1.current, `${c.best ? 'best seat' : [side, depth].filter(Boolean).join(' · ') || 'the middle'} · eye ${num(eye[1], 2)} m`)
      const h = dome.sim.back > 0.01 ? null : domeHit(room, dome.sim.tilt, eye, lookDir(c.yaw, c.pitch))
      if (!h) set(line2.current, 'backed off from the seat : no reading')
      else if (h.off) set(line2.current, 'looking under the rim')
      else {
        const dens = domeDensity(room, dome, dome.sim.tilt, eye, c.yaw, c.pitch)
        const az = Math.round(deg(h.az)), el = Math.round(90 - deg(h.theta))
        const where = `${az === 0 ? 'front' : `${Math.abs(az)}° ${az > 0 ? 'right' : 'left'}`}, ${Math.abs(el)}° ${el < 0 ? 'under the horizon' : 'up'}`
        const past = deg(h.theta) > dome.aperture / 2 + 0.01
        set(line2.current, past ? `${where} · past the ${dome.aperture}° master` : `${where} · ${dens ? `${num(dens.h)} × ${num(dens.v)} pixels per degree` : ''} · screen at ${num(h.dist)} m`)
      }
    } else {
      set(line1.current, `outside · ${num(c.dist * room.R, 0)} m away`)
      set(line2.current, `${room.R} m radius, the rim ${num(Math.abs(room.rimY), 2)} m ${room.rimY < -0.005 ? 'UNDER' : 'over'} the floor`)
    }
    const way = (v: number): string => (Math.abs(v) < 0.5 ? '' : v > 0 ? ' to the right' : ' to the left')
    // the full dome's rotate turns the master's disc, the other mappings the azimuth :
    // opposite ways round the room (and a mirrored master turns the other way)
    const spin = domeFrame.spin * (dome.mode === 'fisheye' ? -1 : 1) * (dome.flipX ? -1 : 1)
    set(line3.current, `turning ${num(Math.abs(spin), 0)}°/s set${way(spin)} · ${i.turning === null ? 'no turn to read in the picture' : `${num(Math.abs(i.turning), 0)}°/s in the picture${way(i.turning)}`}`)
    const open = Math.round(deg(room.halfAp) * 2)
    const fits = open < dome.aperture ? ` · the ${dome.aperture}° master is cut at this screen’s ${open}° rim` : open > dome.aperture ? ` · this ${open}° screen is black past the ${dome.aperture}° master` : ''
    set(line4.current, `${i.size ? `${i.size}² at ${formatHz(Math.round(i.takes))} Hz` : 'waiting for the master'}${fits}`)
  }

  // Clicking or dragging on the plan puts you there.
  const onMap = (e: ReactPointerEvent<SVGSVGElement>): void => {
    if (!(e.buttons & 1)) return
    const r = e.currentTarget.getBoundingClientRect()
    const span = room.R * 2.24
    domeCam.best = false
    domeCam.x = ((e.clientX - r.left) / r.width - 0.5) * span
    domeCam.z = ((e.clientY - r.top) / r.height - 0.5) * span
    if (domeCam.move === 'walk') domeCam.y = domeCam.eye
    keepInside(domeCam, room)
    if (dome.sim.back > 0) setDomeSim({ back: 0 })
    domeSeatChanged()
  }

  const chip = (on: boolean): string =>
    `rounded px-1.5 py-0.5 font-mono text-[10px] leading-4 transition-colors ${on ? 'bg-accent/25 text-accent' : 'text-muted hover:bg-white/10 hover:text-text'}`
  const seatOn = (s: DomeSeat | 'outside' | 'whole'): boolean =>
    s === 'outside' ? !inside : s === 'whole' ? inside && dome.sim.back > 1.5 : s === 'best' ? inside && domeCam.best && dome.sim.back < 0.01 : false
  const R = room.R

  return (
    <div
      ref={rootRef}
      tabIndex={0}
      data-dome-viewer=""
      className={`${expanded ? 'fixed inset-0 z-50' : 'absolute inset-0'} overflow-hidden bg-black outline-none`}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (rootRef.current?.contains(e.relatedTarget as Node | null)) return
        setFocused(false)
        dropKeys()
      }}
    >
      <div
        className={`absolute inset-0 ${view === '3d' ? 'cursor-grab active:cursor-grabbing' : ''}`}
        onPointerDown={(e) => {
          rootRef.current?.focus({ preventScroll: true })
          if (view !== '3d' || e.button !== 0) return
          drag.current = { x: e.clientX, y: e.clientY }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          // Inside, the picture stays under the hand : as many degrees a pixel as
          // the lens shows. Client pixels both ways, so the UI zoom cancels out.
          const h = e.currentTarget.getBoundingClientRect().height || 1
          const k = inside ? -(dome.sim.fov * Math.PI) / 180 / h : 0.008
          domeCam.yaw += (e.clientX - d.x) * k
          domeCam.pitch = clampPitch(domeCam.pitch - (e.clientY - d.y) * k)
          drag.current = { x: e.clientX, y: e.clientY }
        }}
        onPointerUp={() => { drag.current = null }}
        onLostPointerCapture={() => { drag.current = null }}
        onWheel={(e) => {
          if (view !== '3d') return
          if (inside) {
            // Zoom out : widen the lens to 120°, then keep going by backing the
            // camera away. Zoom in retraces : come forward, then narrow.
            const s = dome.sim
            if (e.deltaY > 0) {
              if (s.fov < 120) setDomeSim({ fov: Math.min(120, s.fov + 4) })
              else setDomeSim({ back: Math.min(3, Math.round((s.back + 0.1) * 100) / 100) })
            } else if (s.back > 0) setDomeSim({ back: Math.max(0, Math.round((s.back - 0.1) * 100) / 100) })
            else setDomeSim({ fov: Math.max(30, s.fov - 4) })
          } else domeCam.dist = Math.max(1.2, Math.min(8, domeCam.dist * (e.deltaY > 0 ? 1.08 : 0.93)))
        }}
        onDoubleClick={() => view === '3d' && takeDomeSeat(inside ? 'best' : 'outside')}
        title={
          view !== '3d'
            ? undefined
            : inside
              ? 'Drag to look around · wheel out widens, then backs away (wheel in comes back) · double-click : the best seat. Click, then WASD or the arrows walk, Shift runs, F walks or flies (E up, Q down), R is the best seat, Esc lets the keyboard go. A gamepad works too : sticks to move and look, A runs, B is the best seat, Y walks or flies.'
              : 'Drag to orbit · wheel = distance · double-click resets'
        }
      >
        <DomeSim cfg={dome} view={view} covered={covered} onStep={onStep} onInfo={onInfo} />
      </div>

      {/* lit : the keyboard is the viewer's */}
      {focused && <div className="pointer-events-none absolute inset-0 border border-accent/70" />}

      {/* Where from, how you move, how large : one bar. */}
      <div className="absolute left-2 top-2 flex max-w-[calc(100%-5rem)] flex-wrap items-center gap-0.5 rounded bg-black/60 p-0.5">
        {view === '3d' &&
          SEATS.map(([s, l, t]) => (
            <button key={s} onClick={() => takeDomeSeat(s)} className={chip(seatOn(s))} title={t}>{l}</button>
          ))}
        {view === '3d' && inside && (
          <>
            <span className="mx-0.5 h-3 w-px bg-border" />
            {(['walk', 'fly'] as const).map((m) => (
              <button
                key={m}
                onClick={() => { setMove(m); rootRef.current?.focus({ preventScroll: true }) }}
                className={chip(domeCam.move === m)}
                title={m === 'walk' ? 'On the floor, the eye kept at its height (F)' : 'Anywhere in the room : forward goes where you look, E up, Q down (F)'}
              >
                {m}
              </button>
            ))}
          </>
        )}
        {view === '3d' && <span className="mx-0.5 h-3 w-px bg-border" />}
        {!inWindow && setExpanded && (
          <button onClick={() => setExpanded(!expanded)} className={chip(expanded)} title={expanded ? 'Back to the Output page (Esc)' : 'Over the whole page (Esc comes back)'}>
            {expanded ? '⤡ back' : '⤢ expand'}
          </button>
        )}
        <button
          onClick={() => { setExpanded?.(false); setDomeViewWindow(!inWindow) }}
          className={chip(false)}
          title={inWindow ? 'Back onto the Output page' : 'The viewer alone in a window of its own (a second screen)'}
        >
          {inWindow ? '⇲ back into the app' : '⧉ window'}
        </button>
      </div>

      {view === '3d' && dome.sim.readings && (
        <>
          {/* the point the numbers are read at */}
          {inside && dome.sim.back < 0.01 && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-black/40" />
          )}
          <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-black/60 px-2 py-1 font-mono text-[10px] leading-4 text-white/75">
            <div ref={line1} className="text-white" />
            <div ref={line2} />
            <div ref={line3} />
            <div ref={line4} />
            {focused && <div className="text-accent">WASD or arrows move · Shift runs · F walk / fly · R best seat · Esc lets go</div>}
          </div>
          {inside && (
            <svg
              viewBox={`${-R * 1.12} ${-R * 1.12} ${R * 2.24} ${R * 2.24}`}
              className="absolute bottom-2 right-2 h-28 w-28 cursor-crosshair touch-none rounded bg-black/60"
              onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onMap(e) }}
              onPointerMove={onMap}
            >
              <title>The floor plan, the front at the top : click or drag to stand there</title>
              <circle r={R} className="fill-none stroke-muted" strokeWidth={R * 0.012} strokeDasharray={`${R * 0.06} ${R * 0.05}`} />
              <circle r={Math.max(0.1, room.rimR)} className="fill-white/5 stroke-muted" strokeWidth={R * 0.02} />
              <line x1={0} y1={-R * 1.06} x2={0} y2={-R * 0.88} stroke="#e0392b" strokeWidth={R * 0.05} />
              <g ref={you}>
                <polygon ref={cone} className="fill-accent" opacity={0.25} />
                <circle r={R * 0.06} className="fill-accent" />
              </g>
            </svg>
          )}
        </>
      )}
    </div>
  )
}

/** The viewer's own window : it alone, or what it waits for. */
export function DomeViewerPage(): JSX.Element {
  const on = useStore((s) => s.dome.enabled)
  return (
    <div className="relative min-h-0 flex-1 bg-black">
      {on ? (
        <DomeViewer inWindow />
      ) : (
        <div className="flex h-full items-center justify-center font-mono text-[11px] text-muted">The dome is off : turn it on in Output, Fulldome (Ctrl/Cmd+F).</div>
      )}
    </div>
  )
}
