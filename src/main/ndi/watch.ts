// NDI, main-process side : tell the sender (the main window's preload) when the
// network under it moved : another address, a cable or Wi-Fi come or gone, the
// computer back from sleep. It decides what to do (src/preload/ndi.ts). Asked
// here rather than there : listing the network cards takes milliseconds, and the
// window's thread is the one that renders.
//
// NDI® is a registered trademark of Vizrt NDI AB (https://ndi.video).

import { powerMonitor, type WebContents } from 'electron'
import { networkInterfaces } from 'os'

const EVERY_MS = 5000

const addresses = (): string => {
  try {
    return Object.values(networkInterfaces())
      .flatMap((l) => l ?? [])
      .filter((a) => !a.internal && a.family === 'IPv4' && !a.address.startsWith('169.254.'))
      .map((a) => a.address)
      .sort()
      .join(' ')
  } catch {
    return ''
  }
}

let target: WebContents | null = null
let started = false
let last = ''

/** Watch for the sender in `wc` (called each time it prepares : a reloaded or
 *  rebuilt window takes over). */
export function watchNetworkForNdi(wc: WebContents): void {
  target = wc
  if (started) return
  started = true
  last = addresses()
  const say = (why: string): void => {
    if (!target || target.isDestroyed()) return
    console.info('[ndi] the network moved :', why)
    target.send('ndi:network')
  }
  setInterval(() => {
    const a = addresses()
    if (a === last) return
    last = a
    say(a || 'no address')
  }, EVERY_MS).unref?.()
  powerMonitor.on('resume', () => say('the computer woke up'))
}
