// What happens to the session on screen when something is about to replace it
// (Load, Open, New, Generate, an earlier version, quitting). One rule :
// a session FILE only changes when you save it.
//
// - Unchanged since it was loaded or saved : nothing is written, nothing asked.
// - Changed, and you are at the controls : "Save changes to X?" Save writes its
//   file (Save As when it has none), Don't save keeps a recovery copy in
//   Sessions/.history/_unsaved, Cancel stays.
// - Changed, from MIDI / OSC (a show can't stop for a dialog) : no question, and
//   no session file touched either : the recovery copy only.
//
// It used to save the outgoing session silently, into its own file or, with no
// file known (after a crash restore), into Sessions/<the name inside the
// session> : so an experiment, a dice roll or a restored snapshot overwrote a
// session without asking, sometimes ANOTHER session that shared the name.
// Every overwrite now also keeps the previous version (main/session.ts history).

import { useStore } from './store'

function fnv(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(36)}:${s.length}`
}

// Ableton Link on : the tempo is the network's, not the piece's (./link.ts
// registers the test; no import, which would loop through the store).
let tempoShared: () => boolean = () => false
export function setTempoShared(fn: () => boolean): void {
  tempoShared = fn
}

interface Prints {
  full: string
  /** without the tempo, for while Ableton Link is on */
  noTempo: string
}

function prints(): Prints {
  // The warp counts only when it is the session's own : turning "save with
  // session" on or off, or nudging this computer's warp, changes no piece.
  // Nor does the tempo while Ableton Link is on : any linked app may set it,
  // and apps coming or going (alone yours leads, linked theirs wins) must not
  // turn the session "changed". Both prints are kept for the clean session, so
  // Link turned on or off since is compared against the right one.
  const st = useStore.getState()
  const { warp, ...rest } = st.exportSession()
  const print = (o: typeof rest): string => fnv(JSON.stringify(st.warpFromSession ? { ...o, warp } : o))
  const full = print(rest)
  return { full, noTempo: rest.composition ? print({ ...rest, composition: { ...rest.composition, bpm: 0 } }) : full }
}

let baseline: Prints | null = null
let lastInput = 0
let settleTimer: ReturnType<typeof setTimeout> | null = null

// Your own hands on the controls : what separates an edit from the engine
// settling a freshly loaded session (collage pools rescanned, defaults filled).
// The Output page's own window listens too (watchUserInput).
const touch = (): void => {
  lastInput = performance.now()
}
/** Count a window's pointer, keys and wheel as your hands on the controls.
 *  Returns the undo. */
export function watchUserInput(w: Window): () => void {
  w.addEventListener('pointerdown', touch, true)
  w.addEventListener('keydown', touch, true)
  w.addEventListener('wheel', touch, { capture: true, passive: true })
  return () => {
    w.removeEventListener('pointerdown', touch, true)
    w.removeEventListener('keydown', touch, true)
    w.removeEventListener('wheel', touch, { capture: true })
  }
}
if (typeof window !== 'undefined') watchUserInput(window)

/** The session on screen now matches its file (just loaded or saved), or is a
 *  fresh New / Generate not worth asking about. Changes the engine makes while
 *  it settles over the next 1.5 s are absorbed unless you touched something. */
export function markClean(): void {
  baseline = prints()
  const at = performance.now()
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    settleTimer = null
    if (lastInput < at) baseline = prints()
  }, 1500)
}

/** The session on screen differs from any file (a crash restore, an earlier
 *  version brought back) : leaving it always asks. */
export function markDirty(): void {
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = null
  baseline = null
}

export function isDirty(): boolean {
  if (baseline === null) return true
  const now = prints()
  return tempoShared() ? now.noTempo !== baseline.noTempo : now.full !== baseline.full
}

export type LeaveChoice = 'save' | 'discard' | 'cancel'
type Asker = (title: string, detail: string) => Promise<LeaveChoice>
let asker: Asker | null = null
export function registerSessionAsker(a: Asker | null): void {
  asker = a
}

const fileName = (p: string): string => p.split(/[\\/]/).pop()?.replace(/\.opsia\.json$/i, '') ?? p

/** Call before replacing the session on screen. Resolves true to go ahead,
 *  false when the user cancelled (stay). `why` completes "before …". */
export async function leaveSession(why: string, interactive = true): Promise<boolean> {
  if (!isDirty()) return true
  const st = useStore.getState()
  const session = st.exportSession()
  const keep = async (): Promise<void> => {
    try {
      await window.api.sessionKeepRecovery(session)
    } catch {
      /* best-effort */
    }
  }
  if (!interactive || !asker) {
    await keep()
    return true
  }
  const name = st.sessionPath ? fileName(st.sessionPath) : st.name || 'this session'
  const choice = await asker(
    `Save changes to “${name}” before ${why}?`,
    st.sessionPath
      ? `Save writes ${fileName(st.sessionPath)} (its previous version is kept). Don't save leaves the file as it was.`
      : 'It has no file yet : Save asks where to put it. Don’t save keeps a recovery copy only.'
  )
  if (choice === 'cancel') return false
  if (choice === 'save') {
    try {
      if (st.sessionPath) {
        await window.api.sessionSave(session, st.sessionPath)
        return true
      }
      return (await window.api.sessionSaveAs(session, null)) != null
    } catch (e) {
      console.error('[session] save failed:', (e as Error).message)
      return false
    }
  }
  await keep()
  return true
}
