import { app } from 'electron'
import { join } from 'path'

/**
 * Base directory for user-visible app folders (Sessions, Recorded). Must be
 * writable and durable across app updates:
 *  - dev: the repo root (cwd), so files land beside the project.
 *  - Windows portable build: PORTABLE_EXECUTABLE_DIR — the real launch dir; the
 *    exe dir is a wiped NSIS temp-extraction folder.
 *  - packaged elsewhere: ~/Documents/Palinopsia — never `dirname(exe)`, which is
 *    inside the `.app` bundle on macOS (hidden, broken by signing/updates) or a
 *    read-only squashfs mount on a Linux AppImage.
 * Callers should still fall back to `<userData>/…` if this location is unwritable.
 */
export function userFilesBase(): string {
  if (!app.isPackaged) return process.cwd()
  const portable = process.env.PORTABLE_EXECUTABLE_DIR
  if (portable && portable.trim()) return portable
  return join(app.getPath('documents'), 'Palinopsia')
}
