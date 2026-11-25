// The Model source's row in the Inspector : the model file (open one, read it again,
// back to the built-in shape), what was read (triangles, its texture, what was left
// out, or why it could not be read), and the layer it wears as its skin (its
// sidechain : the PICTURE control mixes it in).

import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { SidechainRef } from '@shared/types'
import { useStore } from '../store'
import { modelLoader, type ModelState } from '../engine/modelLoad'
import { showToast } from './Toast'

export type ModelTarget = { kind: 'layer'; layer: number; slot: 'A' | 'B' } | { kind: 'background' }

export const MODEL_ACCEPT = '.glb,.gltf,.obj,.stl,.ply,.xyz,.pts,.las,.laz'
export const MODEL_FILE_EXT = /\.(glb|gltf|obj|stl|ply|xyz|pts|las|laz)$/i

const baseOf = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

/** Read a model file, then put it on the slot (one undo step, once it is read : a file
 *  that cannot be read leaves the slot as it was, and says why). `files` : the files
 *  the session carries for it (read again with them); `before` : run on success just
 *  before the slot takes the file, in the same undo step (a drop that makes the slot a
 *  Model). */
export function loadModelInto(
  target: ModelTarget,
  path: string,
  name = baseOf(path),
  opts: { files?: readonly string[]; before?: () => void } = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    const done = (st: ModelState): boolean => {
      if (st.state === 'loading') return false
      if (st.state === 'error') {
        showToast(`${name} : ${st.message}`, 'warn', 7000)
        resolve(false)
        return true
      }
      opts.before?.()
      useStore.getState().setSourceModel(target, { path, name, files: st.read })
      const i = st.mesh.info
      showToast(`${name} : ${i.points ? `${i.verts.toLocaleString('en-US')} points` : `${i.tris.toLocaleString('en-US')} triangles`}${i.hasTex ? ', its texture' : ''}${i.notes.length ? ` (${i.notes.join('; ')})` : ''}`, i.notes.length ? 'warn' : 'ok', i.notes.length ? 7000 : 3400)
      resolve(true)
      return true
    }
    modelLoader.reload(path, opts.files ?? [])
    if (done(modelLoader.peek(path) ?? { state: 'loading' })) return
    showToast(`${name} : reading the model…`)
    const off = modelLoader.subscribe(() => {
      const st = modelLoader.peek(path)
      if (st && done(st)) off()
    })
  })
}

function useModelState(path: string | undefined, files: readonly string[] | undefined): ModelState | null {
  const st = useSyncExternalStore(
    (fn) => modelLoader.subscribe(fn),
    () => (path ? modelLoader.peek(path) ?? null : null)
  )
  // (a session's file the engine has not asked for yet : read it, to say what it is)
  useEffect(() => {
    if (path && !modelLoader.peek(path)) modelLoader.get(path, files ?? [])
  }, [path, files])
  return st
}

export function ModelStrip({
  target,
  path,
  name,
  files,
  side,
  setSide,
  hostLayer,
  onFile
}: {
  target: ModelTarget
  path?: string
  name?: string
  files?: string[]
  side: SidechainRef | null
  setSide: ((r: SidechainRef | null) => void) | null
  hostLayer: number
  onFile: boolean
}): JSX.Element {
  const input = useRef<HTMLInputElement | null>(null)
  const st = useModelState(path, files)
  const pick = (f: File): void => {
    let p = ''
    try { p = window.api.getMediaPath(f) } catch { /* unavailable */ }
    if (!p) { showToast(`${f.name} : the Model reads files on disk (this one has no path)`, 'warn', 5000); return }
    void loadModelInto(target, p, f.name)
  }
  const info = st?.state === 'ready' ? st.mesh.info : null
  const line = !path
    ? null
    : !st || st.state === 'loading'
      ? <span className="shrink-0 text-[10px] text-muted">reading…</span>
      : st.state === 'error'
        ? <span className="min-w-0 truncate text-[10px] text-danger" title={st.message}>{st.message}</span>
        : (
          <span className="shrink-0 font-mono text-[10px] text-accent2" title={[info!.format, ...info!.notes].join(' · ')}>
            {info!.points ? `${Math.round(info!.verts / 1000)}K points` : `${info!.tris >= 1e4 ? Math.round(info!.tris / 1000) + 'K' : info!.tris} tris`}
            {info!.hasTex ? ' · texture' : ''}
            {info!.notes.length ? ' · !' : ''}
          </span>
        )
  return (
    <div className="flex items-center gap-2 border-b border-border bg-panel2/40 px-2 py-1">
      <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-muted">model</span>
      <input
        ref={input}
        type="file"
        accept={MODEL_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (f) pick(f)
        }}
      />
      <button
        className="btn shrink-0 text-[11px]"
        onClick={() => input.current?.click()}
        title="Open a model file : glTF 2.0 (.glb, or .gltf with its files beside it), OBJ (with its MTL colors and color map), STL, PLY (vertex colors, point clouds), a text point cloud (.xyz, .pts : x y z per line, with colors or an intensity; a .csv of points renamed .xyz), or a LiDAR scan (.las, .laz). It is centered and sized to fit, up to 2 million triangles. Draco or meshopt compressed glTF cannot be read : export it again uncompressed. You can also drop a model file on the layer."
      >
        open…
      </button>
      <span className={`min-w-0 flex-1 truncate text-[11px] ${onFile ? 'text-fg' : 'text-muted'}`} title={path || undefined}>
        {path ? (name || baseOf(path)) + (onFile ? '' : ' (not on the file now)') : <span className="text-muted">no file</span>}
      </span>
      {line}
      {path && (
        <button className="btn shrink-0 text-[11px]" onClick={() => void loadModelInto(target, path, name, { files })} title="Read the file again (it changed on disk)">
          ↻
        </button>
      )}
      {path && (
        <button className="btn shrink-0 text-[11px]" onClick={() => useStore.getState().setSourceModel(target, null)} title="Forget the file : back to the built-in shapes">
          ×
        </button>
      )}
      {setSide && (
        <>
          <span
            className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-accent2"
            title="A layer the model wears, by SIDECHAIN : wrapped round it, projected on it, reflected in it or as its lit sphere (PICTURE AS). Raise PICTURE to see it."
          >
            skin
          </span>
          <select
            className="input select-compact text-[11px]"
            value={side?.kind === 'layer' ? `layer:${side.layer}` : ''}
            onChange={(e) => {
              const v = e.target.value
              setSide(v.startsWith('layer:') ? { kind: 'layer', layer: Number(v.slice(6)) } : null)
            }}
          >
            <option value="">none</option>
            {[0, 1, 2, 3].map((li) => (
              <option key={li} value={`layer:${li}`}>
                Layer {li + 1}
                {li === hostLayer ? ' (self)' : ''}
              </option>
            ))}
          </select>
        </>
      )}
    </div>
  )
}
