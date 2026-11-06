// What the preview's corners used to hold, one piece of glass on the picture : the scene,
// the Morph time, the output's size, the frame rate and the big preview's switch. The same
// row in every state; a narrow preview only folds what it has no room for, last to first.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from '../store'
import { useGlass, type GlassShape } from '../glass'
import { stepScene } from './SceneBank'

const SHAPE: GlassShape = { bezel: 13, scale: 30, blur: 2.2, saturate: 1.5 }

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round'
} as const

function Arrow({ dir }: { dir: 1 | -1 }): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" {...stroke} aria-hidden="true">
      <path d={dir < 0 ? 'M8.5 3 4.5 7l4 4' : 'M5.5 3l4 4-4 4'} />
    </svg>
  )
}

function Rule(): JSX.Element {
  return <span className="h-4 w-px shrink-0 bg-white/20" />
}

function morphLabel(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`
}

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
  const ref = useRef<HTMLDivElement | null>(null)
  useGlass(ref, SHAPE)
  const scenes = useStore((s) => s.scenes)
  const activeSceneId = useStore((s) => s.activeSceneId)
  const morphMs = useStore((s) => s.morphMs)
  const [room, setRoom] = useState(9999)
  useEffect(() => {
    const parent = ref.current?.parentElement
    if (!parent) return
    const ro = new ResizeObserver(() => setRoom(parent.clientWidth))
    ro.observe(parent)
    return () => ro.disconnect()
  }, [])
  const active = scenes.find((s) => s.id === activeSceneId)
  const none = scenes.length === 0
  const sceneName = active ? active.name : none ? 'no scenes' : `${scenes.length} scene${scenes.length === 1 ? '' : 's'}`
  const stepClass = `flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
    none ? 'opacity-30' : 'opacity-85 hover:bg-white/15 hover:opacity-100'
  }`
  return (
    <div
      ref={ref}
      className="glass absolute bottom-3 left-1/2 z-[5] flex h-9 max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-2 whitespace-nowrap px-2 font-app text-[12px] font-medium leading-none"
    >
      {room >= 300 && (
        <>
          <button type="button" className={stepClass} disabled={none} onClick={() => stepScene(-1)} aria-label="Previous scene" title="The scene before this one">
            <Arrow dir={-1} />
          </button>
          <span className="max-w-[140px] truncate text-center" title={active ? `Scene : ${active.name}` : 'The scene bank, under the preview'}>
            {sceneName}
          </span>
          <button type="button" className={stepClass} disabled={none} onClick={() => stepScene(1)} aria-label="Next scene" title="The scene after this one">
            <Arrow dir={1} />
          </button>
          <Rule />
        </>
      )}
      {room >= 560 && (
        <>
          <span className="flex shrink-0 cursor-help items-baseline gap-1.5" title="Morph : how long a scene or a Generate takes to arrive. Set it in the bottom bar.">
            <span className="opacity-90">Morph</span>
            <span className="font-mono text-[11px]">{morphLabel(morphMs)}</span>
          </span>
          <Rule />
        </>
      )}
      {room >= 430 && (
        <span className="shrink-0 cursor-help font-mono text-[10.5px] opacity-90" title={outputTitle}>
          {output}
        </span>
      )}
      <span className="shrink-0 font-mono text-[10.5px] opacity-90">{fps}</span>
      <Rule />
      <button
        type="button"
        onClick={onBig}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full opacity-85 hover:bg-white/15 hover:opacity-100"
        aria-label={big ? 'Bring the panels back' : 'Big preview'}
        title={big ? 'Bring the panels back under the preview (V)' : 'Big preview : fold the panels under it away (V)'}
      >
        <svg width="13" height="13" viewBox="0 0 14 14" {...stroke} strokeWidth={1.5} aria-hidden="true">
          <path d={big ? 'M11.5 5.5h-3v-3M2.5 8.5h3v3M8.5 5.5 12 2M5.5 8.5 2 12' : 'M8.5 2.5h3v3M5.5 11.5h-3v-3M11.5 2.5 8 6M2.5 11.5 6 8'} />
        </svg>
      </button>
    </div>
  )
}
