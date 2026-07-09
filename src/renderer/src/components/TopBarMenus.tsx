// Two top-toolbar clusters :
//  · Session Loader — a dropdown of every saved session + a Load button.
//  · Generate — a dropdown of 50 visual themes + a Generate button that builds a
//    whole new (unsaved) session tethered to the theme (store.generateTheme).

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { THEME_FAMILIES, THEMES } from '../themes'

type SessionEntry = { name: string; path: string; mtime: number }

export function SessionLoader(): JSX.Element {
  const [sessions, setSessions] = useState<SessionEntry[]>([])
  const [sel, setSel] = useState('') // selected file path
  const [busy, setBusy] = useState(false)
  const loadSession = useStore((s) => s.loadSession)

  const refresh = async (): Promise<void> => {
    try {
      const list = await window.api.sessionList()
      setSessions(list)
      // Keep the current pick if it still exists, else default to the newest.
      setSel((cur) => (cur && list.some((x) => x.path === cur) ? cur : (list[0]?.path ?? '')))
    } catch (e) {
      console.error('[SessionLoader] list failed', e)
    }
  }
  useEffect(() => {
    void refresh()
  }, [])

  const load = async (): Promise<void> => {
    if (!sel || busy) return
    setBusy(true)
    try {
      const session = await window.api.sessionLoad(sel)
      if (session) {
        loadSession(session)
        // Remember the file so a later plain Save overwrites it in place.
        useStore.setState({ sessionPath: sel })
      }
    } catch (e) {
      console.error('[SessionLoader] load failed', e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-1" title="Load a saved session">
      <span className="font-mono text-[9px] uppercase text-muted">Session</span>
      <select
        className="input max-w-[150px] text-[12px]"
        value={sel}
        onFocus={() => void refresh()}
        onChange={(e) => setSel(e.target.value)}
        title="All saved sessions"
      >
        {sessions.length === 0 && <option value="">— no saved sessions —</option>}
        {sessions.map((s) => (
          <option key={s.path} value={s.path}>
            {s.name}
          </option>
        ))}
      </select>
      <button
        className="btn text-[12px]"
        onClick={() => void load()}
        disabled={!sel || busy}
        title="Load the selected session"
      >
        Load
      </button>
    </div>
  )
}

export function GenerateMenu(): JSX.Element {
  const [sel, setSel] = useState(THEMES[0].id)
  const generateTheme = useStore((s) => s.generateTheme)
  const current = THEMES.find((t) => t.id === sel)

  return (
    <div
      className="flex items-center gap-1"
      title="Generate a whole new session tethered to a visual theme"
    >
      <span className="font-mono text-[9px] uppercase text-muted">Generate</span>
      <select
        className="input max-w-[160px] text-[12px]"
        value={sel}
        onChange={(e) => setSel(e.target.value)}
        title={current?.blurb}
      >
        {THEME_FAMILIES.map((f) => (
          <optgroup key={f.family} label={f.family}>
            {f.themes.map((t) => (
              <option key={t.id} value={t.id} title={t.blurb}>
                {t.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <button
        className="btn text-[12px] text-accent2"
        onClick={() => generateTheme(sel)}
        title={current ? `Generate a “${current.name}” session : ${current.blurb}` : 'Generate'}
      >
        Generate
      </button>
    </div>
  )
}
