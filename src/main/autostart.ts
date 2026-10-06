// "Start with the computer" for an installation : after a reboot or a power cut
// the app comes back by itself, and it comes back after a crash too.
//
// - macOS : a LaunchAgent (~/Library/LaunchAgents) that starts it at login and
//   starts it again if it dies (KeepAlive on a failed exit only : quitting it
//   normally stays quit).
// - Windows : a login item, plus a scheduled task that launches it every 5
//   minutes (an installation runs one copy : a launch while it runs quits at
//   once, see the single-instance lock in index.ts).
//
// Every launch from here carries --watchdog : a watchdog launch while
// Installation mode is OFF quits at once and removes the stale entry, so a
// leftover can never open windows on a machine back in normal use.

import { app } from 'electron'
import { execFile, spawn } from 'child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { dirname, join } from 'path'
import { log } from './log'

export const WATCHDOG_ARG = '--watchdog'
const LABEL = 'com.vincentfillion.palinopsia.installation'
const TASK = 'Palinopsia installation watchdog'

export interface AutostartStatus {
  on: boolean
  supported: boolean
  why?: string
}

/** The program to start, or why it can't be. */
function target(): { path?: string; why?: string } {
  if (!app.isPackaged) return { why: 'only in the installed app (not in a development run)' }
  if (process.platform === 'win32') {
    // The portable exe unpacks itself to a temp folder : start the exe itself.
    return { path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath }
  }
  if (process.platform === 'darwin') {
    const p = process.execPath
    if (p.includes('/AppTranslocation/') || p.startsWith('/Volumes/')) {
      return { why: 'move Palinopsia into Applications first (and run xattr -cr on it), then turn this on' }
    }
    return { path: p }
  }
  return { why: 'not available on this system' }
}

const plistPath = (): string => join(homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`)

function plist(exe: string): string {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${esc(exe)}</string><string>${WATCHDOG_ARG}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><dict><key>SuccessfulExit</key><false/></dict>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>LimitLoadToSessionType</key><string>Aqua</string>
</dict>
</plist>
`
}

/** schtasks, its arguments passed verbatim (the /TR value carries its own quotes). */
function schtasks(args: string[]): Promise<{ ok: boolean; out: string }> {
  return new Promise((res) =>
    execFile('schtasks', args, { windowsHide: true, windowsVerbatimArguments: true }, (err, stdout, stderr) =>
      res({ ok: !err, out: `${stdout}${stderr}`.trim() })
    )
  )
}

/** Remove the entries at once, before quitting : a watchdog launch found
 *  Installation mode off (the entry outlived it). */
export function removeAutostartNow(): void {
  try {
    if (process.platform === 'darwin') {
      if (existsSync(plistPath())) unlinkSync(plistPath())
    } else if (process.platform === 'win32') {
      const t = target()
      if (t.path) {
        try { app.setLoginItemSettings({ openAtLogin: false, path: t.path, args: [WATCHDOG_ARG] }) } catch { /* not ready yet */ }
      }
      spawn('schtasks', ['/Delete', '/F', '/TN', `"${TASK}"`], {
        detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true
      }).unref()
    }
  } catch {
    /* best effort */
  }
}

export async function autostartStatus(): Promise<AutostartStatus> {
  const t = target()
  if (!t.path) return { on: false, supported: false, why: t.why }
  if (process.platform === 'darwin') return { on: existsSync(plistPath()), supported: true }
  const login = app.getLoginItemSettings({ path: t.path, args: [WATCHDOG_ARG] }).openAtLogin
  const task = (await schtasks(['/Query', '/TN', `"${TASK}"`])).ok
  return { on: login || task, supported: true }
}

export async function setAutostart(on: boolean): Promise<AutostartStatus> {
  const t = target()
  if (!t.path) return { on: false, supported: false, why: t.why }
  try {
    if (process.platform === 'darwin') {
      if (on) {
        mkdirSync(dirname(plistPath()), { recursive: true })
        writeFileSync(plistPath(), plist(t.path))
      } else if (existsSync(plistPath())) {
        unlinkSync(plistPath())
      }
    } else {
      app.setLoginItemSettings({ openAtLogin: on, path: t.path, args: [WATCHDOG_ARG] })
      if (on) {
        const r = await schtasks([
          '/Create', '/F', '/TN', `"${TASK}"`, '/SC', 'MINUTE', '/MO', '5',
          '/TR', `"\\"${t.path}\\" ${WATCHDOG_ARG}"`
        ])
        if (!r.ok) log('error', `[autostart] the watchdog task could not be created : ${r.out}`)
      } else {
        await schtasks(['/Delete', '/F', '/TN', `"${TASK}"`])
      }
    }
    log('info', `[autostart] ${on ? 'on' : 'off'} (${t.path})`)
  } catch (e) {
    log('error', '[autostart] could not change it', e)
  }
  return autostartStatus()
}
