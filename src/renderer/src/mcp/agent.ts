// The agent connection, page side : on/off and the port (per machine, like
// OSC : localStorage, never in a session), what the server says, which client
// last spoke, and a short log of what it did (the Connect tab shows it, the
// top bar's AGENT light flashes on each call). Calls from main run through
// ./tools.ts and their results go back the same way.

import { useSyncExternalStore } from 'react'
import { MCP_DEFAULT_PORT, type McpStatus } from '@shared/mcpTools'
import { runTool, toolWrites } from './tools'

export interface AgentSettings {
  enabled: boolean
  port: number
}
export interface AgentCall {
  at: number
  tool: string
  what: string
  ok: boolean
  writes: boolean
}

const KEY = 'opsia.mcp'
function load(): AgentSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<AgentSettings> | null
    if (raw && typeof raw === 'object') {
      const p = Math.round(Number(raw.port))
      return { enabled: !!raw.enabled, port: p >= 1024 && p <= 65535 ? p : MCP_DEFAULT_PORT }
    }
  } catch { /* defaults */ }
  return { enabled: false, port: MCP_DEFAULT_PORT }
}

let settings = load()
let status: McpStatus = { listening: false, port: 0 }
let client = ''
let log: AgentCall[] = []
let snap = { settings, status, client, log }
const listeners = new Set<() => void>()
const emit = (): void => {
  snap = { settings, status, client, log }
  for (const fn of listeners) fn()
}

const api = (): typeof window.api | null =>
  typeof window !== 'undefined' && typeof (window.api as Partial<typeof window.api> | undefined)?.mcpConfigure === 'function' ? window.api : null

async function configure(): Promise<void> {
  const a = api()
  if (!a) return
  try {
    status = await a.mcpConfigure(settings.enabled, settings.port)
  } catch (e) {
    status = { listening: false, port: 0, error: (e as Error).message }
  }
  emit()
}

export function setAgentSettings(patch: Partial<AgentSettings>): void {
  settings = { ...settings, ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(settings)) } catch { /* private storage */ }
  emit()
  void configure()
}

/** What a call was about, in a few words, for the log. */
function whatOf(args: Record<string, unknown>): string {
  const keys = ['unit', 'rack', 'layer', 'shader', 'name', 'action', 'address', 'scene']
  const out: string[] = []
  for (const k of keys) {
    const v = args[k]
    if (v === undefined || v === null || v === '') continue
    out.push(k === 'layer' && v !== 'bg' ? `L${String(v)}` : String(v))
  }
  return out.join(' ').slice(0, 60)
}

export function initAgent(): () => void {
  const a = api()
  if (!a) return () => {}
  void configure()
  const offCall = a.onMcpCall((call) => {
    void (async () => {
      const result = await runTool(call.name, call.args ?? {})
      a.mcpResult(call.id, result)
      client = call.client || client || 'an agent'
      log = [{ at: Date.now(), tool: call.name, what: whatOf(call.args ?? {}), ok: !result.isError, writes: toolWrites(call.name) }, ...log].slice(0, 12)
      emit()
    })()
  })
  const offClient = a.onMcpClient((name) => {
    client = name
    emit()
  })
  return () => {
    offCall()
    offClient()
  }
}

export function useAgent(): typeof snap {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    () => snap
  )
}
