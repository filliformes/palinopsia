// What the preview's corners used to hold, two small pieces of glass in its bottom corners,
// mostly on the black beside the picture : the scene and the Morph time at the left, the
// output's size, the frame rate and the big preview's switch at the right. Quiet until a hand
// comes near (styles.css). A narrow preview folds what it has no room for.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { useGlass, type GlassShape } from '../glass'
import { stepScene } from './SceneBank'
import { ScrambleText } from './ScrambleText'

const SHAPE: GlassShape = { bezel: 8, scale: 14, blur: 1.6, saturate: 1.25 }

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

function Arrow({ dir }: { dir: 1 | -1 }): JSX.Element {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" {...stroke} aria-hidden="true">
      <path d={dir < 0 ? 'M8.5 3 4.5 7l4 4' : 'M5.5 3l4 4-4 4'} />
    </svg>
  )
}

function Rule(): JSX.Element {
  return <span className="h-3 w-px shrink-0 bg-white/15" />
}

function morphLabel(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

// The preview's width each piece needs beside the rest, a long scene name included.
const ROOM_MORPH = 490
const ROOM_SIZE = 390
const ROOM_SCENE = 330

export function PictureCapsule({
  big,
  onBig,
  output,
  outputTitle,
  fps
}: {
  big: boolean
  onBig: () => void
  output: string
  outputTitle: string
  fps: ReactNode
}): JSX.Element {
  const leftRef = useRef<HTMLDivElement | null>(null)
  const rightRef = useRef<HTMLDivElement | null>(null)
  const [room, setRoom] = useState(9999)
  useEffect(() => {
    const parent = rightRef.current?.parentElement
    if (!parent) return
    const ro = new ResizeObserver(() => setRoom(parent.clientWidth))
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])
  const hasScene = room >= ROOM_SCENE
  const hasMorph = room >= ROOM_MORPH
  useGlass(leftRef, SHAPE, hasScene)
  useGlass(rightRef, SHAPE)
  const scenes = useStore((s) => s.scenes)
  const activeSceneId = useStore((s) => s.activeSceneId)
  const morphMs = useStore((s) => s.morphMs)
  const active = scenes.find((s) => s.id === activeSceneId)
  const none = scenes.length === 0
  const sceneName = active ? active.name : none ? 'no scenes' : `${scenes.length} scene${scenes.length === 1 ? '' : 's'}`
  const stepClass = `flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full ${
    none ? 'opacity-30' : 'opacity-85 hover:bg-white/15 hover:opacity-100'
  }`
  const shell = 'glass glass-capsule absolute bottom-2 z-[5] flex h-[26px] items-center gap-1.5 whitespace-nowrap font-app text-[11px] leading-none'
  return (
    <>
      {hasScene && (
        <div ref={leftRef} className={`${shell} left-2 pl-1 ${hasMorph ? 'pr-2.5' : 'pr-1'}`}>
          <button type="button" className={stepClass} disabled={none} onClick={() => stepScene(-1)} aria-label="Previous scene" title="The scene before this one">
            <Arrow dir={-1} />
          </button>
          <ScrambleText
            text={sceneName}
            className={`${room < 360 ? 'max-w-[84px]' : 'max-w-[120px]'} text-center`}
            title={active ? `Scene : ${active.name}` : 'The scene bank, under the preview'}
          />
          <button type="button" className={stepClass} disabled={none} onClick={() => stepScene(1)} aria-label="Next scene" title="The scene after this one">
            <Arrow dir={1} />
          </button>
          {hasMorph && (
            <>
              <Rule />
              <span className="flex shrink-0 cursor-help items-baseline gap-1" title="Morph : how long a scene or a Generate takes to arrive. Set it in the bottom bar.">
                <span>Morph</span>
                <span className="font-mono text-[10px]">{morphLabel(morphMs)}</span>
              </span>
            </>
          )}
        </div>
      )}
      <div ref={rightRef} className={`${shell} right-2 pl-2.5 pr-1`}>
        {room >= ROOM_SIZE && (
          <span className="shrink-0 cursor-help font-mono text-[10px]" title={outputTitle}>
            {output}
          </span>
        )}
        <span className="shrink-0 font-mono text-[10px]">{fps}</span>
        <Rule />
        <button
          type="button"
          onClick={onBig}
          className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full opacity-85 hover:bg-white/15 hover:opacity-100"
          aria-label={big ? 'Bring the panels back' : 'Big preview'}
          title={big ? 'Bring the panels back under the preview (V)' : 'Big preview : fold the panels under it away (V)'}
        >
          <svg width="10" height="10" viewBox="0 0 14 14" {...stroke} strokeWidth={1.5} aria-hidden="true">
            <path d={big ? 'M11.5 5.5h-3v-3M2.5 8.5h3v3M8.5 5.5 12 2M5.5 8.5 2 12' : 'M8.5 2.5h3v3M5.5 11.5h-3v-3M11.5 2.5 8 6M2.5 11.5 6 8'} />
          </svg>
        </button>
      </div>
    </>
  )
}
