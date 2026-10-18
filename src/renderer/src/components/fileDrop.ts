// Files dragged in from the desktop : what a drop holds (paths on disk), what
// kind each is, and a drag handler pair for a drop target that lights while a
// file drag is over it. A layer's A / B row takes a film, a sound or a folder
// (a Collage of it); an Audio Layer slot takes a sound (or a film's
// soundtrack); the window takes a session file.

import type { DragEvent } from 'react'
import { useStore } from '../store'
import { showToast } from './Toast'

export const VIDEO_EXT = /\.(mp4|m4v|mov|webm|mkv|avi|mpg|mpeg|mxf|m2v|dxv|ogv|wmv|flv|ts|mts|m2ts|3gp)$/i
export const AUDIO_EXT = /\.(wav|mp3|flac|ogg|oga|opus|aac|m4a|aif|aiff|wma|caf)$/i
export const SESSION_EXT = /\.json$/i

export type DropKind = 'video' | 'audio' | 'session' | 'other'

export function dropKind(path: string): DropKind {
  if (VIDEO_EXT.test(path)) return 'video'
  if (AUDIO_EXT.test(path)) return 'audio'
  if (SESSION_EXT.test(path)) return 'session'
  return 'other'
}

/** Is this drag carrying files from the desktop (not an effect chip, not text)? */
export function isFileDrag(e: DragEvent | globalThis.DragEvent): boolean {
  return !!e.dataTransfer && Array.from(e.dataTransfer.types).includes('Files')
}

/** The dropped files' paths on disk (empty where the OS gives none). */
export function droppedPaths(e: DragEvent | globalThis.DragEvent): Array<{ path: string; name: string }> {
  const files = Array.from(e.dataTransfer?.files ?? [])
  const out: Array<{ path: string; name: string }> = []
  for (const f of files) {
    let path = ''
    try { path = window.api.getMediaPath(f) } catch { /* unavailable */ }
    if (path) out.push({ path, name: f.name })
  }
  return out
}

/** The last segment of a path (a file's or a folder's name). */
export const baseName = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** A dropped folder onto a layer slot : the slot becomes a Collage of its
 *  films (the Collage's own folder scan : unreadable formats converted once). */
export async function collageFromFolder(layer: number, slot: 'A' | 'B', folder: string): Promise<void> {
  const st = useStore.getState()
  const cur = st.composition.layers[layer]?.[slot === 'A' ? 'sourceA' : 'sourceB']
  if (cur?.shaderId !== 'gen-collage') st.setSourceShader(layer, slot, 'gen-collage')
  showToast(`Collage : reading ${baseName(folder)}…`)
  const res = await window.api.collageScan(folder)
  if (res.ok && res.clips.length) {
    useStore.getState().setCollagePool(layer, slot, folder, res.clips)
    showToast(`Collage : ${res.clips.length} film${res.clips.length === 1 ? '' : 's'} from ${baseName(folder)}${res.skipped.length ? ` (${res.skipped.length} unreadable, skipped)` : ''}`)
  } else {
    showToast(`${baseName(folder)} : no readable film in that folder`, 'warn', 5000)
  }
}
