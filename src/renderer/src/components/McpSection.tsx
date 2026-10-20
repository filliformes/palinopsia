// Agent (MCP) section of the Connect tab, under Ableton Link : Palinopsia as an
// MCP server an agent on this computer connects to (off by default). Shows the
// address to give the agent, which client spoke last, and what it did. And
// AgentBadge, in the top bar : lit while it is on, flashing on each call.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { setAgentSettings, useAgent } from '../mcp/agent'
import { showToast } from './Toast'

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s} s`
  const m = Math.round(s / 60)
  return m < 60 ? `${m} min` : `${Math.round(m / 60)} h`
}

export function McpSection(): JSX.Element {
  const { settings, status, client, log } = useAgent()
  const collapsed = useStore((s) => !!s.collapsed['mcp'])
  const toggleSection = useStore((s) => s.toggleSection)
  const [port, setPort] = useState(String(settings.port))
  useEffect(() => setPort(String(settings.port)), [settings.port])
  const on = settings.enabled && status.listening
  const url = `http://127.0.0.1:${status.port || settings.port}/mcp`
  // a re-render every few seconds keeps the "ago" readouts honest
  const [, tick] = useState(0)
  useEffect(() => {
    if (!on || collapsed) return
    const id = window.setInterval(() => tick((n) => n + 1), 5000)
    return () => window.clearInterval(id)
  }, [on, collapsed])
  const copy = (s: string): void => {
    void navigator.clipboard?.writeText(s).then(
      () => showToast('Copied', 'ok', 1400),
      () => showToast('Could not copy', 'warn')
    )
  }
  const commitPort = (): void => {
    const p = Math.round(Number(port))
    if (p >= 1024 && p <= 65535) setAgentSettings({ port: p })
    else setPort(String(settings.port))
  }

  return (
    <div className="flex min-w-0 flex-col gap-1.5 border-t border-border bg-panel px-3 py-1.5 text-[11px]">
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={() => toggleSection('mcp')}
          className="flex shrink-0 items-center gap-1.5"
          title={collapsed ? 'Expand Agent' : 'Collapse Agent'}
        >
          <span className={`font-mono text-[9px] text-muted transition-transform ${collapsed ? '' : 'rotate-90'}`}>▶</span>
          <span className="font-mono text-[10px] uppercase tracking-wide text-muted">Agent (MCP)</span>
        </button>
        <button
          onClick={() => setAgentSettings({ enabled: !settings.enabled })}
          className={`flex shrink-0 items-center gap-1.5 rounded px-2 py-0.5 font-mono text-[10px] transition-colors ${
            settings.enabled && status.error
              ? 'bg-danger/20 text-danger ring-1 ring-danger'
              : on
                ? 'bg-accent/20 text-accent ring-1 ring-accent'
                : 'bg-panel2 text-muted hover:text-text'
          }`}
          title={
            on
              ? 'Turn the agent connection off : no agent can reach Palinopsia'
              : 'Turn the agent connection on : an AI agent on this computer (an MCP client) can read and play Palinopsia'
          }
        >
          {on && <span className="h-1.5 w-1.5 rounded-full bg-accent" />}
          {settings.enabled && status.error ? 'ERROR' : on ? 'ON' : 'OFF'}
        </button>
        {on && (
          <span className="min-w-0 truncate font-mono text-[9px] text-muted" title={client ? `The last client to connect : ${client}` : 'No agent has connected yet'}>
            {client ? client : 'no agent yet'}
          </span>
        )}
        <div className="flex-1" />
        {on && log[0] && <span className="shrink-0 font-mono text-[9px] text-muted">{ago(log[0].at)} ago</span>}
      </div>

      {!collapsed && (
        <>
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="font-mono text-[9px] uppercase text-muted">port</span>
            <input
              className="input w-16 px-1 py-0.5 font-mono text-[10px]"
              value={port}
              onChange={(e) => setPort(e.target.value.replace(/[^0-9]/g, ''))}
              onBlur={commitPort}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
              title="The port the agent connects to (this computer only)"
            />
            <span className="min-w-0 truncate font-mono text-[10px] text-text" title="The address to give your agent (MCP over HTTP)">{url}</span>
            <button className="btn px-1.5 text-[10px]" onClick={() => copy(url)} title="Copy the address">copy</button>
          </div>
          {settings.enabled && status.error && <div className="font-mono text-[10px] text-danger">{status.error}</div>}
          {on && log.length > 0 && (
            <div className="flex flex-col gap-0.5 rounded border border-border bg-panel2/40 p-1.5">
              {log.slice(0, 6).map((c, i) => (
                <div key={c.at + c.tool + i} className="flex min-w-0 items-center gap-1.5 font-mono text-[10px]">
                  <span className={c.ok ? (c.writes ? 'text-accent' : 'text-muted') : 'text-danger'}>{c.ok ? (c.writes ? '●' : '○') : '✕'}</span>
                  <span className="shrink-0 text-text">{c.tool}</span>
                  <span className="min-w-0 truncate text-muted">{c.what}</span>
                  <div className="flex-1" />
                  <span className="shrink-0 text-[9px] text-muted">{ago(c.at)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="font-mono text-[9px] leading-relaxed text-muted">
            {on
              ? 'Add this address to your agent as an MCP server (HTTP). It reads the composition, looks at the output, sets sources, controls, effects and scenes, and writes shaders of yours. Each change it makes is one undo step (Ctrl+Z); it cannot reach the Flash safety. Only this computer can connect.'
              : 'Lets an AI agent on this computer (an MCP client) read and play Palinopsia : look at the output, change sources, effects and scenes, write shaders. Off until you turn it on; only this computer can connect.'}
          </div>
        </>
      )}
    </div>
  )
}

/** Top bar : lit while the agent connection is on, flashing on each call. */
export function AgentBadge(): JSX.Element | null {
  const { settings, status, client, log } = useAgent()
  const setRightView = useStore((s) => s.setRightView)
  const [flash, setFlash] = useState(false)
  const last = log[0]?.at ?? 0
  useEffect(() => {
    if (!last) return
    setFlash(true)
    const id = window.setTimeout(() => setFlash(false), 700)
    return () => window.clearTimeout(id)
  }, [last])
  if (!settings.enabled || !status.listening) return null
  return (
    <button
      onClick={() => setRightView('io')}
      className={`shrink-0 rounded px-1.5 py-px font-mono text-[9px] transition-colors ${
        flash ? 'bg-accent text-bg' : 'bg-accent/15 text-accent ring-1 ring-accent/60'
      }`}
      title={`Agent connection on (port ${status.port})${client ? ` : ${client}` : ''}${last ? `, last call ${ago(last)} ago` : ''}. Click : the Connect tab.`}
    >
      AGENT
    </button>
  )
}
