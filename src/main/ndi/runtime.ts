// Where is an NDI runtime on this machine ? Candidates in priority order :
//   1. the copy bundled with Palinopsia (resources/ndi, see its README : the
//      NDI licence allows shipping the runtime inside an application's folder),
//   2. the official runtime's own env vars (NDI_RUNTIME_DIR_V6 / V5 / V4),
//   3. the standard NDI install folders (Runtime / Tools / SDK),
//   4. copies other creative apps ship (Resolume, TouchDesigner, vMix,
//      MadMapper…) : a venue machine almost always has one,
//   5. (Linux) the bare soname, left to the dynamic loader.
// The sender (src/preload/ndi.ts) tries them in order until one loads AND
// initializes.

import { existsSync, readdirSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'

export interface NdiCandidate {
  path: string
  origin: string // shown in the UI : "bundled", "NDI 6 Runtime", "Resolume Arena"…
}

function libName(): string[] {
  if (process.platform === 'win32') return [process.arch === 'arm64' ? 'Processing.NDI.Lib.arm64.dll' : 'Processing.NDI.Lib.x64.dll']
  if (process.platform === 'darwin') return ['libndi.dylib', 'libndi_advanced.dylib']
  return ['libndi.so.6', 'libndi.so.5', 'libndi.so']
}

/** The machine-wide environment as the registry holds it NOW (Windows), keys
 *  upper-cased. The NDI installer sets NDI_RUNTIME_DIR_V6 there, but a process
 *  started before the install (Palinopsia, when the user installs NDI from
 *  inside it) never sees it in process.env. One `reg query` (~30 ms). */
function machineEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  if (process.platform !== 'win32') return env
  try {
    const out = execFileSync('reg', ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment'], {
      encoding: 'utf8', timeout: 3000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore']
    })
    for (const line of out.split(/\r?\n/)) {
      const m = line.match(/^\s+(\S+)\s+REG_(?:EXPAND_)?SZ\s+(.+)$/)
      if (m) env[m[1].toUpperCase()] = m[2].trim().replace(/%([^%]+)%/g, (_x, k: string) => process.env[k] ?? `%${k}%`)
    }
  } catch {
    /* no reg.exe : fall back to process.env alone */
  }
  return env
}

/** `bundledDir` : resources/ndi (packaged) or <project>/resources/ndi/<os> (dev). */
export function ndiCandidates(bundledDirs: string[]): NdiCandidate[] {
  const names = libName()
  const out: NdiCandidate[] = []
  const seen = new Set<string>()
  const add = (dir: string, origin: string): void => {
    for (const n of names) {
      const p = join(dir, n)
      if (!seen.has(p.toLowerCase()) && existsSync(p)) {
        seen.add(p.toLowerCase())
        out.push({ path: p, origin })
      }
    }
  }
  for (const d of bundledDirs) add(d, 'bundled')
  const vars = ['NDI_RUNTIME_DIR_V6', 'NDI_RUNTIME_DIR_V5', 'NDI_RUNTIME_DIR_V4']
  const machine = vars.every((v) => process.env[v]) ? {} : machineEnv()
  for (const v of vars) {
    const d = process.env[v] ?? machine[v]
    if (d) add(d, `NDI runtime (${v.slice(-2)})`)
  }
  if (process.platform === 'win32') {
    const pf = [process.env.ProgramFiles || 'C:\\Program Files', process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)']
    for (const root of pf) {
      for (const v of ['6', '5']) {
        add(join(root, 'NDI', `NDI ${v} Runtime`, `v${v}`), `NDI ${v} Runtime`)
        add(join(root, 'NDI', `NDI ${v} Tools`, 'Runtime'), `NDI ${v} Tools`)
        add(join(root, 'NDI', `NDI ${v} SDK`, 'Bin', 'x64'), `NDI ${v} SDK`)
      }
    }
    // Other apps' own copies : one level into Program Files (+ bin/), cheap.
    for (const root of pf) {
      let entries: string[] = []
      try { entries = readdirSync(root) } catch { continue }
      for (const e of entries) {
        if (/^NDI$/i.test(e)) continue
        add(join(root, e), e)
        add(join(root, e, 'bin'), e)
        // vendor folders (Derivative/TouchDesigner, NewTek/…) : one more level
        if (/^(Derivative|NewTek|Vizrt|Resolume|Magic Music Visuals|StudioCoast|Notch)$/i.test(e)) {
          let sub: string[] = []
          try { sub = readdirSync(join(root, e)) } catch { /* ignore */ }
          for (const s of sub) {
            add(join(root, e, s), `${e} ${s}`)
            add(join(root, e, s, 'bin'), `${e} ${s}`)
          }
        }
      }
    }
  } else if (process.platform === 'darwin') {
    add('/usr/local/lib', 'NDI runtime')
    add('/Library/NDI SDK for Apple/lib/macOS', 'NDI SDK')
    add('/Library/Application Support/NewTek/NDI', 'NDI')
    let apps: string[] = []
    try { apps = readdirSync('/Applications') } catch { /* ignore */ }
    for (const a of apps) {
      if (!a.endsWith('.app')) continue
      add(join('/Applications', a, 'Contents', 'Frameworks'), a.replace(/\.app$/, ''))
      add(join('/Applications', a, 'Contents', 'MacOS'), a.replace(/\.app$/, ''))
    }
  } else {
    for (const d of ['/usr/lib', '/usr/local/lib', '/usr/lib/x86_64-linux-gnu', '/usr/lib/aarch64-linux-gnu', '/opt/ndi/lib'])
      add(d, 'NDI runtime')
    // Let the dynamic loader try its own search path last.
    for (const n of names) out.push({ path: n, origin: 'system loader' })
  }
  return out
}
