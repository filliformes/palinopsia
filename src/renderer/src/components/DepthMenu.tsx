// The depth engine (2.5D) : its menu, at the head of the Performance tab's
// picture section (beside the depth and relief it fills; it sat in the top bar
// until v1.3.2), and the Inspector line under the pieces that read its map while
// it is off. The setting belongs to the computer, not the session (the store
// keeps it in localStorage : opsia.depthMode, opsia.depthRes).

import { useStore } from '../store'
import { DEPTH_RES_STEPS } from '../engine/depthEstimate'

const DEPTH_TITLE = (res: number): string =>
  `Depth engine (2.5D) : fills the depth map Parallax, Luma Blur's depth focus and Pulfrich read. off = flat (passthrough) · synth = a test depth bowl · AI = a depth model reading the picture, on the graphics card, offline (it ships with the app). AI detail = the size it reads the picture at : ${DEPTH_RES_STEPS[0]} px costs least, ${DEPTH_RES_STEPS[DEPTH_RES_STEPS.length - 1]} px is the model's own size. Now ${res} px.`

/** off / synth / AI, then the AI detail sizes (the ● on the one in use). */
export function DepthMenu(): JSX.Element {
  const depthMode = useStore((s) => s.depthMode)
  const setDepthMode = useStore((s) => s.setDepthMode)
  const depthRes = useStore((s) => s.depthRes)
  const setDepthRes = useStore((s) => s.setDepthRes)
  return (
    <select
      // (data-ctl : the search, Ctrl/Cmd+K, finds and flashes it)
      data-ctl="ui:depth"
      // (.input's own padding outranks py-* : set inline, so the menu keeps the
      // section header's one-line height)
      className="input select-compact w-24 shrink-0 text-[10px]"
      style={{ paddingLeft: 6, paddingTop: 1, paddingBottom: 1 }}
      value={depthMode}
      onChange={(e) => {
        const v = e.target.value
        // An AI detail entry sets the inference size and turns AI on.
        if (v.startsWith('res:')) {
          setDepthRes(Number(v.slice(4)))
          setDepthMode('estimate')
        } else setDepthMode(v as 'off' | 'synth' | 'estimate')
      }}
      title={DEPTH_TITLE(depthRes)}
    >
      <option value="off">depth: off</option>
      <option value="synth">depth: synth</option>
      <option value="estimate">depth: AI</option>
      <optgroup label="AI detail">
        {DEPTH_RES_STEPS.map((px, i) => (
          <option key={px} value={`res:${px}`}>
            {px === depthRes ? '● ' : ' '}
            {px} px{i === 0 ? ' : lightest' : i === DEPTH_RES_STEPS.length - 1 ? ' : finest' : ''}
          </option>
        ))}
      </optgroup>
    </select>
  )
}

/** What a depth reader does while the engine is off, or null when it reads no
 *  depth at all (Pulfrich keyed on luminance, Luma Blur on brightness). A
 *  modulated choice counts as depth : it can land there. True to the nodes
 *  (convNodes.ts) : Parallax is an exact passthrough without a map, the other
 *  two fall back to the picture's brightness. */
export function depthOffText(
  shaderId: string,
  values: Record<string, number | number[]>,
  modulated: ReadonlySet<string>
): string | null {
  const pick = (k: string, def: number): number => {
    const x = values[k]
    return typeof x === 'number' ? Math.round(x) : def
  }
  if (shaderId === 'node-parallax') return 'depth is off : nothing to read, the picture passes through'
  if (shaderId === 'node-pulfrich' && (modulated.has('source') || pick('source', 1) === 1))
    return 'depth is off : the key reads luminance instead'
  if (shaderId === 'node-lumablur' && (modulated.has('control') || pick('control', 0) === 1))
    return 'depth is off : depth focus reads brightness instead'
  return null
}

/** The Inspector's line under a depth reader while depth is off : what it does
 *  without a map, and the click that turns AI on (the same as picking depth: AI).
 *  Nothing at all while depth is on (synth or AI). `inline` drops the strip's own
 *  chrome, to sit in a row that is already there (Luma Blur's control picker). */
export function DepthOffNote({ text, inline = false }: { text: string; inline?: boolean }): JSX.Element | null {
  const off = useStore((s) => s.depthMode === 'off')
  const setDepthMode = useStore((s) => s.setDepthMode)
  if (!off) return null
  const body = (
    <>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-muted/50" />
      <span
        className={`${inline ? '' : 'min-w-0 flex-1 truncate '}font-mono text-[10px] text-muted`}
        title="The depth engine fills the depth map this piece reads. Its menu is at the head of the Performance tab's picture section."
      >
        {text}
      </span>
      <button
        className="shrink-0 rounded border border-accent/50 bg-accent/10 px-1.5 font-mono text-[10px] text-accent hover:bg-accent/20"
        onClick={() => setDepthMode('estimate')}
        title="Turn the depth engine on, set to AI (the same as depth: AI in the Performance tab's picture section) : a depth model reads the picture on the graphics card, offline. The map comes within a few seconds."
      >
        turn on AI
      </button>
    </>
  )
  if (inline) return <span className="flex items-center gap-2">{body}</span>
  return <div className="flex items-center gap-2 border-b border-border bg-panel2/40 px-2 py-1">{body}</div>
}
