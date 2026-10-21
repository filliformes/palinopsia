// Ableton Link section of the Connect tab (under dataflou) : Enabled / Disabled
// (Ableton's wording), how many apps are linked, the session's tempo and where
// the bar is, and with start / stop sync whether the session plays (a button :
// play or stop for every linked app); open, the quantum (beats per bar the phase
// is aligned to), the latency lead and start / stop sync. And LinkBadge, beside
// the BPM in the transport : the tempo there is the session's while it is lit,
// filled while the session plays. The engine side is ../link.ts.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { linkBeats, setLinkPlaying, setLinkSettings, useLink } from '../link'

const QUANTA = [2, 3, 4, 6, 8]

/** Where the bar is : one dot per beat of the quantum, the current one lit.
 *  Redrawn by its own animation frame (the state only arrives 30 times a second). */
function BarDots({ quantum }: { quantum: number }): JSX.Element {
  const [beat, setBeat] = useState(0)
  useEffect(() => {
    let raf = 0
    const loop = (): void => {
      const b = linkBeats(performance.now())
      setBeat(b == null ? -1 : Math.floor(((b % quantum) + quantum) % quantum))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [quantum])
  return (
    <span className="flex shrink-0 items-center gap-0.5" title={beat < 0 ? '' : `beat ${beat + 1} of ${quantum}`}>
      {Array.from({ length: quantum }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 w-1.5 rounded-full ${i === beat ? (i === 0 ? 'bg-accent' : 'bg-text') : 'bg-panel2 ring-1 ring-border'}`}
        />
      ))}
    </span>
  )
}

const apps = (n: number): string => `${n} ${n === 1 ? 'app' : 'apps'}`

export function LinkSection(): JSX.Element {
  const { settings, state } = useLink()
  const collapsed = useStore((s) => !!s.collapsed['link'])
  const toggleSection = useStore((s) => s.toggleSection)
  const on = settings.enabled && state.enabled
  const missing = !state.available
  const linked = on && state.peers > 0
  // start / stop sync on and working
  const sync = on && settings.startStop && !!state.startStop
  const playing = sync && !!state.playing

  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-t border-border bg-panel px-3 py-1.5 text-[11px]">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={() => toggleSection('link')}
          className="flex shrink-0 items-center gap-1.5"
          title={collapsed ? 'Expand Ableton Link' : 'Collapse Ableton Link'}
        >
          <span className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">Ableton Link</span>
        </button>
        <button
          onClick={() => setLinkSettings({ enabled: !settings.enabled })}
          // missing : nothing to turn on, but an "enabled" left from before can
          // always be turned off
          disabled={missing && !settings.enabled}
          className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
            missing
              ? 'bg-danger/20 text-danger ring-1 ring-danger'
              : on
                ? 'bg-accent/20 text-accent ring-1 ring-accent'
                : 'bg-panel2 text-muted hover:text-text'
          }`}
          title={
            missing
              ? `Ableton Link is missing from this build : ${state.error ?? ''}${settings.enabled ? ' (click : turn it off)' : ''}`
              : on
                ? 'Disable Ableton Link : Palinopsia leaves the session and keeps its own tempo'
                : 'Enable Ableton Link : share the tempo and the bar with every Link app on this network'
          }
        >
          {on && <span className={`h-1.5 w-1.5 rounded-full bg-accent ${linked ? 'animate-pulse' : ''}`} />}
          {missing ? 'MISSING' : on ? 'ENABLED' : 'DISABLED'}
        </button>
        {on && (
          <span className="shrink-0 font-mono text-[9px] text-muted" title="Other apps in the Link session on this network">
            {linked ? `linked to ${apps(state.peers)}` : 'no other app yet'}
          </span>
        )}
        <div className="flex-1" />
        {sync && (
          <button
            onClick={() => setLinkPlaying(!playing)}
            className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
              playing ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'
            }`}
            title={
              playing
                ? 'The session plays (start / stop sync). Click : stop every linked app, the MIDI clock follower and the sequencers'
                : 'The session is stopped (start / stop sync). Click : play every linked app, on the next bar with the others'
            }
          >
            {playing ? '▶ PLAYING' : '■ STOPPED'}
          </button>
        )}
        {on && (
          <>
            <span className="shrink-0 font-mono text-[10px] text-text" title="The session's tempo">
              {state.tempo.toFixed(2)}
            </span>
            <BarDots quantum={settings.quantum} />
          </>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase text-muted">bar</span>
            {QUANTA.map((q) => (
              <button
                key={q}
                onClick={() => setLinkSettings({ quantum: q })}
                className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                  settings.quantum === q ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'
                }`}
                title={`A bar of ${q} beats : the phase every Link app agrees on (Live calls it the quantum). Sequencers started on the beat wait for its top.`}
              >
                {q}
              </button>
            ))}
            <span className="ml-2 font-mono text-[9px] uppercase text-muted">latency</span>
            <input
              type="range"
              min={-200}
              max={400}
              step={5}
              value={settings.latencyMs}
              onChange={(e) => setLinkSettings({ latencyMs: Number(e.target.value) })}
              onDoubleClick={() => setLinkSettings({ latencyMs: 0 })}
              className="w-24 accent-accent"
              title="The picture reaches the screen this late (a projector, a capture card, a long cable) : Palinopsia runs this far ahead so its beats land with the sound. Double-click : 0"
            />
            <span className="w-12 shrink-0 font-mono text-[10px] text-text">{settings.latencyMs} ms</span>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase text-muted">start / stop sync</span>
            <button
              onClick={() => setLinkSettings({ startStop: !settings.startStop })}
              disabled={missing}
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] disabled:opacity-40 ${
                settings.startStop ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'bg-panel2 text-muted hover:text-text'
              }`}
              title={
                settings.startStop
                  ? 'Disable start / stop sync : play and stop stay Palinopsia’s own'
                  : 'Enable start / stop sync : play and stop shared with the Link apps that share theirs (in Live : Start Stop Sync). A play starts the MIDI clock follower and the sequencers on the bar, a stop stops them.'
              }
            >
              {settings.startStop ? 'ENABLED' : 'DISABLED'}
            </button>
          </div>
          <div className="font-mono text-[9px] leading-relaxed text-muted">
            {missing
              ? `this build has no Ableton Link module (${state.error ?? 'not built'})`
              : on
                ? linked
                  ? 'the BPM is the session’s : any linked app can change it, and changing it here changes it for all. Modulators synced to the BPM and the Sonify sequencers follow the shared bar.'
                  : 'waiting for other Link apps on this network. Alone, Palinopsia sets the tempo.'
                : 'shares the tempo and the bar with every Link app on this network (Live, DJ software, phone apps), with no setup.'}
            {sync &&
              ' Start / stop sync : a play from any app starts, on its bar, the MIDI clock’s Start and the sequencers the last stop stopped (at first, the scene sequencer if the session uses it); a stop stops them. Starting one here, or the MIDI clock, plays every app; stopping the last one stops them all.'}
          </div>
        </>
      )}
    </div>
  )
}

/** Beside the BPM : lit while other apps are linked (the BPM is the session's). */
export function LinkBadge(): JSX.Element | null {
  const { settings, state } = useLink()
  if (!settings.enabled || !state.enabled) return null
  const linked = state.peers > 0
  // start / stop sync : filled while the session plays
  const playing = settings.startStop && !!state.startStop && !!state.playing
  return (
    <span
      className={`shrink-0 rounded px-1 py-px font-mono text-[9px] ${
        playing ? 'bg-accent text-bg ring-1 ring-accent' : linked ? 'bg-accent/20 text-accent ring-1 ring-accent' : 'text-muted ring-1 ring-border'
      }`}
      title={`${linked ? `Ableton Link : linked to ${apps(state.peers)}, the tempo is shared` : 'Ableton Link : enabled, no other app yet'}${playing ? ', the session plays' : ''}`}
    >
      LINK{linked ? ` ${state.peers}` : ''}
    </span>
  )
}
