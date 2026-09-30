// Two top-toolbar clusters :
//  · Session Loader : a dropdown of every saved session + a Load button.
//  · Generate : a dropdown of 50 visual themes + a Generate button that builds a
//    whole new (unsaved) session tethered to the theme (store.generateTheme).

import { useEffect, useRef, useState } from 'react'
import { collageClipsFor, useStore } from '../store'
import { THEME_FAMILIES, THEMES } from '../themes'
import { SearchSelect } from './SearchSelect'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { showToast } from './Toast'
import { MidiLearnOverlay } from './MidiLearnOverlay'
import { registerLoadSession } from '../commands'

type SessionEntry = { name: string; path: string; mtime: number; group?: string }

/** A folder's last path segment (Windows or POSIX separators). */
const folderName = (p: string): string => p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p

/** Save the outgoing session before it's replaced (Load / Generate) : named
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
  const [menu, setMenu] = useState<{ x: number; y: number; folders: string[] } | null>(null)
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
  // Right-click Load : link a folder of sessions (all of them join the dropdown),
  // or unlink one.
  const openMenu = async (e: React.MouseEvent): Promise<void> => {
    e.preventDefault()
    const x = e.clientX, y = e.clientY
    let folders: string[] = []
    try { folders = await window.api.sessionFolders() } catch { /* none */ }
    setMenu({ x, y, folders })
  }
  const addFolder = async (): Promise<void> => {
    try {
      const r = await window.api.sessionFolderAdd()
      if (!r) return
      await refresh()
      showToast(`Linked · ${folderName(r.folder)} : ${r.count} session${r.count === 1 ? '' : 's'} in the dropdown`)
    } catch (err) {
      console.error('[SessionLoader] link folder failed', err)
      showToast('Could not link that folder', 'warn')
    }
  }
  const menuItems: MenuItem[] = menu
    ? [
        { label: 'Link a folder of sessions…', onClick: () => void addFolder() },
        ...(menu.folders.length ? [{ divider: true, label: '' }] : []),
        ...menu.folders.map((f) => ({
          label: folderName(f),
          // Click a linked folder : jump the dropdown to its first session.
          onClick: () => {
            const first = sessions.find((s) => s.group === folderName(f))
            if (first) setSel(first.path)
          },
          onDelete: () => {
            void window.api.sessionFolderRemove(f).then(() => refresh())
            showToast(`Unlinked · ${folderName(f)} (the files stay where they are)`)
          },
          deleteTitle: `Unlink ${f} : its sessions leave the dropdown, the files are not touched`
        }))
      ]
    : []
  // The dropdown : the Sessions folder first (newest first), then one group per
  // linked folder (in name order).
  const groups: Array<{ label: string | null; items: SessionEntry[] }> = []
  for (const s of sessions) {
    const label = s.group ?? null
    const g = groups.find((x) => x.label === label)
    if (g) g.items.push(s)
    else groups.push({ label, items: [s] })
  }
  const opt = (s: SessionEntry): JSX.Element => (
    <option key={s.path} value={s.path} title={s.path}>
      {s.name}
    </option>
  )

  // Expose "load the selected session" to the MIDI router (session:load) so a
  // learned pad fires it. A ref keeps the current closure (sel/busy live).
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    registerLoadSession(() => void loadRef.current())
    return () => registerLoadSession(null)
  }, [])

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
        {groups.some((g) => g.label)
          ? groups.map((g) =>
              g.label ? (
                <optgroup key={g.label} label={g.label}>{g.items.map(opt)}</optgroup>
              ) : (
                <optgroup key="__sessions" label="Sessions">{g.items.map(opt)}</optgroup>
              )
            )
          : sessions.map(opt)}
      </select>
      <span className="relative inline-flex">
        <MidiLearnOverlay id="session:load" />
        <button
          className="btn text-[12px]"
          onClick={() => void load()}
          onContextMenu={(e) => void openMenu(e)}
          disabled={busy}
          title="Load the selected session · right-click to link a folder of sessions (all of them join the dropdown) · MIDI-learnable"
        >
          Load
        </button>
      </span>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onClose={() => setMenu(null)}
          header={<span className="font-mono text-[10px] text-muted">Session folders</span>}
        />
      )}
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
        title={current?.blurb ?? 'Pick a visual theme (type to search by name or family)'}
      />
      <button
        className="btn text-[12px] text-accent2"
        onClick={async () => {
          await saveBeforeReplace() // Generate wipes the session : save it first, like Load/Open/New
          const standIn = !!current?.needsClips && !collageClipsFor(useStore.getState().composition)
          generateTheme(sel)
          if (standIn)
            showToast(
              `${current?.name ?? 'Film Wall'} plays your films : pick a folder in a Collage source (a layer's source → Collage). Painted sources stand in until then.`,
              'warn',
              9000
            )
          else showToast(`Generated · ${current?.name ?? 'theme'} (previous saved)`)
        }}
        title={current ? `Generate a “${current.name}” session : ${current.blurb}` : 'Generate'}
      >
        Generate
      </button>
    </div>
  )
}
