// This computer's address on the network, as the others reach it : the one the
// default route goes out from, else a plain adapter's.

import * as dgram from 'dgram'
import { networkInterfaces } from 'os'

export async function primaryIPv4(): Promise<string> {
  const via = (host: string, port: number): Promise<string | null> =>
    new Promise((res) => {
      const s = dgram.createSocket('udp4')
      const done = (v: string | null): void => {
        try { s.close() } catch { /* closed */ }
        res(v)
      }
      s.once('error', () => done(null))
      try {
        // (a UDP connect sends nothing : it only picks the route)
        s.connect(port, host, () => {
          try {
            const a = s.address().address
            done(a && a !== '0.0.0.0' && !a.startsWith('127.') ? a : null)
          } catch {
            done(null)
          }
        })
      } catch {
        done(null)
      }
    })
  const routed = (await via('8.8.8.8', 53)) ?? (await via('224.0.0.251', 5353))
  if (routed) return routed
  const virt = /vethernet|virtualbox|vmware|hyper-v|wsl|loopback|bluetooth|tailscale|zerotier|docker/i
  let fallback = '127.0.0.1'
  for (const [name, list] of Object.entries(networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family !== 'IPv4' || ni.internal || ni.address.startsWith('169.254.')) continue
      if (!virt.test(name)) return ni.address
      fallback = ni.address
    }
  }
  return fallback
}
