// Two top-toolbar clusters :
//  · Session Loader — a dropdown of every saved session + a Load button.
//  · Generate — a dropdown of 50 visual themes + a Generate button that builds a
//    whole new (unsaved) session tethered to the theme (store.generateTheme).

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { THEME_FAMILIES, THEMES } from '../themes'
import { SearchSelect } from './SearchSelect'
import { showToast } from './Toast'

type SessionEntry = { name: string; path: string; mtime: number }

/** Save the outgoing session before it's replaced (Load / Generate) — named
 *  sessions overwrite their file, unnamed ones go to the default Sessions/<name>,
 *  so nothing is ever silently lost. Best-effort : never blocks the replace. */
async function saveBeforeReplace(): Promise<void> {
  try {
    const st = useStore.getState()
    if (st.sessionPath) await window.api.sessionSave(st.exportSession(), st.sessionPath)
    else await window.api.sessionSaveToDefault(st.exportSession())
  } catch {
    /* best-effort */
  }
}

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
        await saveBeforeReplace() // A→B→A round-trips everything (scenes included)
        loadSession(session)
        // Remember the file so a later plain Save overwrites it in place.
        useStore.setState({ sessionPath: sel })
        showToast(`Loaded · ${sessions.find((s) => s.path === sel)?.name ?? 'session'} (previous saved)`)
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
        className="input w-[104px] text-[12px]"
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
      <SearchSelect
        // Fixed width : the closed control stays theme-name wide, while the
        // popup is free to be as wide as it needs.
        className="w-[120px] text-[12px]"
        value={sel}
        menuWidth={248}
        options={THEME_FAMILIES.flatMap((f) =>
          f.themes.map((t) => ({ value: t.id, label: t.name, group: f.family, title: t.blurb }))
        )}
        onChange={(v) => setSel(v)}
        title={current?.blurb ?? 'Pick a visual theme — type to search by name or family'}
      />
      <button
        className="btn text-[12px] text-accent2"
        onClick={async () => {
          await saveBeforeReplace() // Generate wipes the session — save it first, like Load/Open/New
          generateTheme(sel)
          showToast(`Generated · ${current?.name ?? 'theme'} (previous saved)`)
        }}
        title={current ? `Generate a “${current.name}” session : ${current.blurb}` : 'Generate'}
      >
        Generate
      </button>
    </div>
  )
}
