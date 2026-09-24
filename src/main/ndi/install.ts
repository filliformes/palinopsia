// One-click NDI runtime install, for a computer that has no NDI at all.
//
// NDI® is a registered trademark of Vizrt NDI AB (https://ndi.video).
//
// This is NDI's own recommended path : its SDK points applications at these
// redistributable links (NDILIB_REDIST_URL) when the runtime is missing. We
// download NDI's official runtime installer (~10 MB on Windows, ~5 MB on
// macOS), check that it came from NDI over HTTPS and carries a valid signature,
// then OPEN it : the user goes through NDI's own installer (and its licence)
// themselves. The sender retries on its own meanwhile (src/preload/ndi.ts), so
// NDI goes live the moment the install finishes, with no restart.
//
// Linux has no runtime installer : the NDI SDK for Linux ships libndi.so.

import { app, shell, type WebContents } from 'electron'
import { createWriteStream, mkdirSync, statSync, unlinkSync } from 'fs'
import { get as httpsGet } from 'https'
import { get as httpGet, type IncomingMessage } from 'http'
import { join } from 'path'
import { execFile } from 'child_process'
import { NDI_REDIST_URL, NDI_LINUX_SDK_URL, type NdiInstallProgress } from '@shared/ndi'

const INSTALLER_FILE: Partial<Record<NodeJS.Platform, string>> = {
  win32: 'NDI 6 Runtime.exe',
  darwin: 'libNDI_for_Mac.pkg'
}

/** Only NDI's own hosts, only over HTTPS : checked at every redirect. */
export const ndiHostTrusted = (u: URL): boolean =>
  u.protocol === 'https:' && /(^|\.)ndi\.(link|tv|video)$/i.test(u.hostname)

/** Download `url` to `dest`, following redirects, refusing any hop `trusted`
 *  rejects. Progress is reported as bytes received / total (0 = unknown). */
export function downloadTrusted(
  url: string,
  dest: string,
  trusted: (u: URL) => boolean,
  onProgress: (received: number, total: number) => void,
  hops = 6
): Promise<void> {
  return new Promise((resolve, reject) => {
    let u: URL
    try { u = new URL(url) } catch { reject(new Error(`bad download address : ${url}`)); return }
    if (!trusted(u)) { reject(new Error(`refused to download from ${u.origin} (not NDI's site)`)); return }
    const get = u.protocol === 'https:' ? httpsGet : httpGet
    const req = get(u, { headers: { 'User-Agent': `Palinopsia/${app?.getVersion?.() ?? 'dev'}` } }, (res: IncomingMessage) => {
      const code = res.statusCode ?? 0
      if (code >= 300 && code < 400 && res.headers.location) {
        res.resume()
        if (hops <= 0) { reject(new Error('too many redirects')); return }
        downloadTrusted(new URL(res.headers.location, u).toString(), dest, trusted, onProgress, hops - 1).then(resolve, reject)
        return
      }
      if (code !== 200) { res.resume(); reject(new Error(`the download failed (HTTP ${code})`)); return }
      const total = Number(res.headers['content-length']) || 0
      let received = 0
      let last = 0
      const out = createWriteStream(dest)
      res.on('data', (chunk: Buffer) => {
        received += chunk.length
        const now = Date.now()
        if (now - last > 120) { last = now; onProgress(received, total) }
      })
      res.pipe(out)
      out.on('finish', () => {
        onProgress(received, total)
        if (total && received !== total) reject(new Error('the download was cut short'))
        else resolve()
      })
      out.on('error', reject)
      res.on('error', reject)
    })
    req.setTimeout(30000, () => req.destroy(new Error('the download timed out')))
    req.on('error', reject)
  })
}

/** The installer must carry a valid code signature before we open it :
 *  Authenticode on Windows, a signed package on macOS. */
export function verifySignature(path: string): Promise<{ ok: boolean; signer: string; detail: string }> {
  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // The path goes in through the environment, never through the script text.
      const ps = '$s = Get-AuthenticodeSignature -LiteralPath $env:OPSIA_VERIFY; "$($s.Status)|$($s.SignerCertificate.Subject)"'
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { env: { ...process.env, OPSIA_VERIFY: path }, timeout: 30000 }, (err, stdout) => {
        const [status = '', signer = ''] = String(stdout).trim().split('|')
        resolve({ ok: !err && status === 'Valid', signer, detail: err ? err.message : status })
      })
    } else if (process.platform === 'darwin') {
      execFile('/usr/sbin/pkgutil', ['--check-signature', path], { timeout: 30000 }, (err, stdout) => {
        const out = String(stdout)
        const signer = (out.match(/1\.\s*(.+)/) ?? [])[1]?.trim() ?? ''
        resolve({ ok: !err && /Status:\s*signed/i.test(out), signer, detail: err ? err.message : out.split('\n')[1] ?? '' })
      })
    } else {
      resolve({ ok: false, signer: '', detail: 'no installer on this platform' })
    }
  })
}

let busy = false

/** Download, verify and open NDI's official runtime installer. Progress goes to
 *  the renderer as 'ndi:install-progress'. */
export async function installNdiRuntime(wc: WebContents | null): Promise<{ ok: boolean; message: string }> {
  const send = (p: NdiInstallProgress): void => { if (wc && !wc.isDestroyed()) wc.send('ndi:install-progress', p) }
  const url = NDI_REDIST_URL[process.platform]
  const file = INSTALLER_FILE[process.platform]
  if (!url || !file) {
    void shell.openExternal(NDI_LINUX_SDK_URL)
    return { ok: false, message: 'NDI has no runtime installer for Linux : install libndi from the NDI SDK for Linux (opened in your browser).' }
  }
  if (busy) return { ok: false, message: 'already installing' }
  busy = true
  const dir = join(app.getPath('temp'), 'Palinopsia-NDI')
  const dest = join(dir, file)
  try {
    mkdirSync(dir, { recursive: true })
    try { unlinkSync(dest) } catch { /* none yet */ }
    send({ phase: 'download', received: 0, total: 0 })
    await downloadTrusted(url, dest, ndiHostTrusted, (received, total) => send({ phase: 'download', received, total }))
    if (statSync(dest).size < 1_000_000) throw new Error('the downloaded installer is too small to be NDI\'s')
    send({ phase: 'verify' })
    const sig = await verifySignature(dest)
    if (!sig.ok) throw new Error(`the installer's signature did not check out (${sig.detail || 'unsigned'}) : not opening it`)
    console.log(`[ndi] runtime installer verified, signed by ${sig.signer}`)
    send({ phase: 'open' })
    const err = await shell.openPath(dest)
    if (err) throw new Error(`could not open the installer : ${err}`)
    send({ phase: 'waiting' })
    return { ok: true, message: '' }
  } catch (e) {
    const message = (e as Error).message
    send({ phase: 'error', message })
    return { ok: false, message }
  } finally {
    busy = false
  }
}
