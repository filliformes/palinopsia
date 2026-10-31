// The UI tab (the last of the right column's tabs) : how the instrument itself
// looks on this computer. The slider pointer (how every bar marks its stored
// value, with a bar to try it on) and the UI theme (moved from the top bar in
// v1.3.2). Both are per machine (localStorage), never in a session. The UI zoom
// stays in the top bar.

import { useState, type ReactNode } from 'react'
import { THEME_ORDER, useStore, type ThemeName } from '../store'
import { FloatBar } from './Bar'
import { SLIDER_POINTERS, setSliderPointer, useSliderPointer, type SliderPointer } from './sliderPointer'

function Section({ title, ctl, hint, children }: { title: string; ctl: string; hint: string; children: ReactNode }): JSX.Element {
  return (
    // (data-ctl : the search, Ctrl/Cmd+K, finds and flashes it)
    <section className="flex flex-col gap-1.5 rounded-md border border-border bg-panel px-3 py-2" data-ctl={ctl}>
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 font-mono text-[9px] uppercase tracking-[0.12em] text-accent">{title}</span>
        <span className="min-w-0 truncate font-mono text-[9px] text-muted/80" title={hint}>
          {hint}
        </span>
      </div>
      {children}
    </section>
  )
}

export function UiPanel(): JSX.Element {
  const pointer = useSliderPointer()
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  // the bar to try a pointer on (it changes nothing else)
  const [tryV, setTryV] = useState(0.62)
  const hint = SLIDER_POINTERS.find((p) => p.id === pointer)?.hint ?? ''
  return (
    <div className="flex flex-col gap-2">
      <Section title="slider pointer" ctl="ui:pointer" hint="how a bar marks its stored value">
        <div className="flex min-w-0 items-center gap-2">
          <select
            className="input select-compact shrink-0 text-[12px]"
            value={pointer}
            onChange={(e) => setSliderPointer(e.target.value as SliderPointer)}
            title={hint}
            aria-label="Slider pointer"
          >
            {SLIDER_POINTERS.map((p) => (
              <option key={p.id} value={p.id} title={p.hint}>
                {p.label}
              </option>
            ))}
          </select>
          <div className="min-w-0 flex-1">
            <FloatBar
              label="try it"
              title={`${hint}. Drag it : it changes nothing else.`}
              value={tryV}
              min={0}
              max={1}
              def={0.62}
              frac={2}
              onChange={setTryV}
            />
          </div>
        </div>
        <span className="font-mono text-[9px] text-muted">{hint}</span>
      </Section>
      <Section title="ui theme" ctl="ui:theme" hint="the colors and type of the whole instrument">
        <select
          className="input select-compact self-start text-[12px]"
          value={theme}
          onChange={(e) => setTheme(e.target.value as ThemeName)}
          title="UI theme"
          aria-label="UI theme"
        >
          {THEME_ORDER.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Section>
    </div>
  )
}
