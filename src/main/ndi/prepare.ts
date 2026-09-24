// NDI, main-process side : find the runtime and write the network config.
//
// NDI® is a registered trademark of Vizrt NDI AB (https://ndi.video).
//
// The sender itself runs in the main window's preload (src/preload/ndi.ts) :
// every way of moving a 4K frame to another process copies it slowly, so the
// frames never leave the renderer. Main only answers `ndi:prepare` with
//   · the runtime candidates (bundled copy first, then the machine's), and
//   · a private ndi-config.v1.json for the network settings (Discovery Server,
//     adapters, extra IPs), which the preload points NDI at via NDI_CONFIG_DIR
//     for its own process only : the machine's global NDI settings stay untouched.

import { app } from 'electron'
import { join } from 'path'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import type { NdiConfig } from '@shared/ndi'
import { ndiCandidates, type NdiCandidate } from './runtime'

function bundledDirs(): string[] {
  const os = process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : 'linux'
  return [join(process.resourcesPath ?? '', 'ndi'), join(app.getAppPath(), 'resources', 'ndi', os)]
}

/** The private config dir, or null when every network field is empty (NDI then
 *  uses the machine's own settings, e.g. from NDI Access Manager). */
function writeConfig(cfg: NdiConfig): string | null {
  const { discovery, adapter, extraIps } = cfg
  if (!discovery && !adapter && !extraIps) return null
  const dir = join(app.getPath('userData'), 'ndi-config')
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const list = (s: string): string[] => s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean)
    const conf = {
      ndi: {
        networks: { ips: list(extraIps).join(','), discovery: list(discovery).join(',') },
        adapters: { allowed: list(adapter) }
      }
    }
    writeFileSync(join(dir, 'ndi-config.v1.json'), JSON.stringify(conf, null, 2))
    return dir
  } catch (e) {
    console.error('[ndi] could not write ndi-config:', (e as Error).message)
    return null
  }
}

export function prepareNdi(cfg: NdiConfig): { candidates: NdiCandidate[]; configDir: string | null } {
  return { candidates: ndiCandidates(bundledDirs()), configDir: writeConfig(cfg) }
}
