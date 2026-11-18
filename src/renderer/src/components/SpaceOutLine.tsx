// The Space line : while Space drives Sonify's output (speakers or objects), a
// small line beside the Sonify meter and in the Connect tab's Audio section
// says so, with the channels it uses. Amber when the output has fewer channels
// than Space needs (the rest are dropped : only the first voices are heard),
// and one click back to stereo. Engine : audio/space.ts.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { spaceEngine } from '../audio/space'
import { showToast } from './Toast'

// the app's amber (the World page's notes); written out whole, for Tailwind to see
const AMBER_TEXT = 'text-[rgb(217_164_65)]'

/** "objects, channels 1 to 26" / "speakers, 8 channels" / "objects, on headphones". */
export function spaceLineText(mode: 'speakers' | 'objects', first: number, last: number, preview: boolean): string {
  if (preview) return `${mode}, on headphones`
  if (last < first) return mode
  if (mode === 'speakers' && first === 1) return `${mode}, ${last} channel${last === 1 ? '' : 's'}`
  return first === last ? `${mode}, channel ${first}` : `${mode}, channels ${first} to ${last}`
}

/** The same, short, for the Sonify bar ("objects 1-26"). */
function shortText(mode: 'speakers' | 'objects', first: number, last: number, preview: boolean): string {
  if (preview) return `${mode} 🎧`
  if (last < first) return mode
  return first === last ? `${mode} ${first}` : `${mode} ${first}-${last}`
}

export function backToStereo(): void {
  useStore.getState().setSpace({ mode: 'stereo' })
  showToast('Space off : Sonify plays its stereo mix again. Its settings are kept : the Space view\'s output menu brings them back.', 'ok', 5000)
}

/** `bar` : one compact chip for the Sonify bar (the problem in its tooltip);
 *  `row` : a line for the Audio section, the problem written under it.
 *  `onOpen` : a click on the label opens the Space view. */
export function SpaceOutLine({ variant, onOpen }: { variant: 'bar' | 'row'; onOpen?: () => void }): JSX.Element | null {
  const mode = useStore((s) => s.space.mode)
  const first = useStore((s) => s.space.firstChannel)
  const preview = useStore((s) => s.space.preview)
  const on = mode !== 'stereo'
  // what the engine found (its tick runs 30 times a second) : read twice a second while on
  const read = (): string => `${spaceEngine.channels}|${spaceEngine.problem}`
  const [eng, setEng] = useState(read)
  useEffect(() => {
    if (!on) return
    setEng(read())
    const id = window.setInterval(() => setEng(read()), 500)
    return () => window.clearInterval(id)
  }, [on])
  if (!on) return null
  const bar = eng.indexOf('|')
  const last = Number(eng.slice(0, bar)) || 0
  const problem = eng.slice(bar + 1)
  const m = mode as 'speakers' | 'objects'
  const what = spaceLineText(m, first, last, preview)
  const tip = [
    `Space : ${what}.`,
    preview
      ? 'Every channel is placed around your head and heard in stereo on Sonify\'s output.'
      : m === 'objects'
        ? 'Each voice leaves on its own channels (the FX return on the last ones), its place sent over OSC.'
        : 'Every voice is panned onto the speaker layout.',
    problem ? `\n${problem} ${m === 'objects' ? 'Only the voices on the output\'s channels are heard.' : 'Only the speakers on the output\'s channels play.'}` : '',
    '\nThe Sonify meter reads the stereo mix before Space.'
  ].filter(Boolean).join(' ')
  const stereoBtn = (
    <button
      onClick={backToStereo}
      className={`shrink-0 rounded border px-[3px] font-mono text-[9px] leading-[12px] transition-colors ${problem ? 'border-current text-[rgb(217_164_65)] hover:bg-[rgb(217_164_65)]/20' : 'border-border text-muted hover:border-accent/60 hover:text-accent'}`}
      title="Back to stereo : Sonify plays its stereo mix on the output again (Space's settings are kept for the next time)"
    >
      stereo
    </button>
  )
  if (variant === 'bar') {
    return (
      <span className="flex shrink-0 items-center gap-[3px]">
        <button
          onClick={onOpen}
          className={`whitespace-nowrap font-mono text-[9px] ${problem ? AMBER_TEXT : 'text-accent'} hover:underline`}
          title={`${tip}${onOpen ? '\nClick : open the Space view.' : ''}`}
        >
          {shortText(m, first, last, preview)}
        </button>
        {stereoBtn}
      </span>
    )
  }
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={tip}>
      <div className="flex min-w-0 items-center gap-1">
        <span className={`min-w-0 flex-1 truncate font-mono text-[9px] ${problem ? AMBER_TEXT : 'text-accent'}`}>
          {problem ? '⚠ ' : '◎ '}Space : {what}
        </span>
        {stereoBtn}
      </div>
      {problem && <p className={`font-mono text-[9px] leading-tight ${AMBER_TEXT}`}>{problem}</p>}
    </div>
  )
}
