// A small rotating log file : <userData>/logs/palinopsia.log (2 MB, then one
// previous copy as palinopsia.1.log). A packaged build used to write no log at
// all, so a failure in an unattended installation left nothing to diagnose.
//
// installLogging() copies main's console warnings and errors into it, catches
// main-process exceptions (logged, never Electron's error box on the screen),
// and windows can forward their own console errors with logFrom().

import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync } from 'fs'
import { join } from 'path'

const MAX_BYTES = 2 * 1024 * 1024
let dir: string | null = null
let written = 0

function file(): string | null {
  if (!dir) {
    try {
      dir = join(app.getPath('userData'), 'logs')
      mkdirSync(dir, { recursive: true })
      written = (() => { try { return statSync(join(dir!, 'palinopsia.log')).size } catch { return 0 } })()
    } catch {
      return null
    }
  }
  return join(dir, 'palinopsia.log')
}

function write(line: string): void {
  const f = file()
  if (!f) return
  try {
    if (written > MAX_BYTES) {
      renameSync(f, join(dir!, 'palinopsia.1.log'))
      written = 0
    }
    const s = `${new Date().toISOString()} ${line}\n`
    appendFileSync(f, s)
    written += s.length
  } catch {
    /* the log must never take the app down */
  }
}

const text = (args: unknown[]): string =>
  args
    .map((a) => (a instanceof Error ? `${a.message}\n${a.stack ?? ''}` : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a) } catch { return String(a) } })()))
    .join(' ')
    .slice(0, 4000)

// The same message again within a minute is counted, not written (a warning
// repeated every frame would fill the file in minutes); the count is written
// with its next appearance after that.
const recent = new Map<string, { at: number; n: number }>()
function once(line: string): void {
  const now = Date.now()
  const r = recent.get(line)
  if (r && now - r.at < 60_000) {
    r.n++
    return
  }
  if (recent.size > 400) recent.clear()
  recent.set(line, { at: now, n: 0 })
  write(r && r.n ? `${line} (and ${r.n} more times in the minute before)` : line)
}

/** One line in the log. */
export function log(level: 'info' | 'warn' | 'error', ...args: unknown[]): void {
  once(`[${level}] ${text(args)}`)
}

/** A window's own console message (errors and warnings only). WebGL's own
 *  performance hints (one per frame on some drivers) are left out. */
export function logFrom(source: string, level: string, message: string): void {
  if (level !== 'error' && level !== 'warning') return
  if (/^performance warning:/i.test(message)) return
  once(`[${level === 'error' ? 'error' : 'warn'}] (${source}) ${message.slice(0, 4000)}`)
}

/** Copy main's console warnings / errors into the log, and catch what would
 *  otherwise be an uncaught exception dialog. Call once, early. */
export function installLogging(): void {
  const origErr = console.error.bind(console)
  const origWarn = console.warn.bind(console)
  console.error = (...a: unknown[]): void => { origErr(...a); log('error', ...a) }
  console.warn = (...a: unknown[]): void => { origWarn(...a); log('warn', ...a) }
  process.on('uncaughtException', (e) => {
    origErr('[main] uncaught exception', e)
    log('error', '[main] uncaught exception', e)
  })
  process.on('unhandledRejection', (e) => {
    origErr('[main] unhandled rejection', e)
    log('error', '[main] unhandled rejection', e)
  })
  log('info', `Palinopsia ${app.getVersion()} started (Electron ${process.versions.electron}, ${process.platform} ${process.arch})`)
}
