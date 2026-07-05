// Scene bank (brief §7, §10.7) — recallable full-instrument states.
// Chips: click = recall (undoable, hot-swap safe — feedback buffers survive),
// double-click = rename, × = delete, drag = rearrange. ⚄ saves a fresh
// Randomize-All AS a scene without touching the live state (the brief's
// randomize-into-scene). Keys 1–9 recall the first nine scenes.

import { useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { useStore } from '../store'
import { ContextMenu } from './ContextMenu'

export function SceneBank(): JSX.Element {
  const scenes = useStore((s) => s.scenes)
  const activeSceneId = useStore((s) => s.activeSceneId)
  const saveScene = useStore((s) => s.saveScene)
  const randomSceneIntoBank = useStore((s) => s.randomSceneIntoBank)
  const recallScene = useStore((s) => s.recallScene)
  const renameScene = useStore((s) => s.renameScene)
  const deleteScene = useStore((s) => s.deleteScene)
  const reorderScene = useStore((s) => s.reorderScene)
  const updateSceneFromLive = useStore((s) => s.updateSceneFromLive)
  const duplicateScene = useStore((s) => s.duplicateScene)
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [menu, setMenu] = useState<{ x: number; y: number; sceneId: string; name: string } | null>(
    null
  )
  const dragId = useRef<string | null>(null)

  function onDrop(e: DragEvent, beforeId: string | null): void {
    e.preventDefault()
    if (dragId.current) reorderScene(dragId.current, beforeId)
    dragId.current = null
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <button
        className="btn px-2 py-0.5 text-[11px]"
        onClick={saveScene}
        title="Save the current state as a scene"
      >
        + Scene
      </button>
      <button
        className="btn px-2 py-0.5 text-[11px]"
        onClick={randomSceneIntoBank}
        title="Randomize-into-scene — a fresh Randomize All saved to the bank without touching the live state"
      >
        ⚄ Random
      </button>

      {scenes.map((scene, i) => (
        <span
          key={scene.id}
          draggable={renamingId !== scene.id}
          onDragStart={() => {
            dragId.current = scene.id
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDrop(e, scene.id)}
          onContextMenu={(e: MouseEvent) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY, sceneId: scene.id, name: scene.name })
          }}
          className={`flex shrink-0 cursor-grab items-center gap-1 rounded border px-1.5 py-0.5 transition-colors ${
            activeSceneId === scene.id
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-border bg-panel2 hover:border-accent/50'
          }`}
        >
          {i < 9 && (
            <span className="font-mono text-[8px] text-muted" title={`Key ${i + 1} recalls`}>
              {i + 1}
            </span>
          )}
          {renamingId === scene.id ? (
            <input
              autoFocus
              className="input w-24 px-1 py-0 text-[11px]"
              defaultValue={scene.name}
              onBlur={(e) => {
                renameScene(scene.id, e.target.value)
                setRenamingId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                if (e.key === 'Escape') setRenamingId(null)
              }}
            />
          ) : (
            <button
              onClick={() => recallScene(scene.id)}
              onDoubleClick={() => setRenamingId(scene.id)}
              className="max-w-[140px] truncate text-[11px]"
              title={`Recall "${scene.name}" — double-click to rename`}
            >
              {scene.name}
            </button>
          )}
          <button
            onClick={() => deleteScene(scene.id)}
            className="font-mono text-[10px] text-muted hover:text-danger"
            title="Delete scene"
          >
            ×
          </button>
        </span>
      ))}

      {/* Tail drop zone — drag a chip past the end to move it last. */}
      {scenes.length > 1 && (
        <span
          className="h-5 w-6 rounded border border-dashed border-border/50"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => onDrop(e, null)}
          title="Drop here to move to the end"
        />
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          header={menu.name}
          items={[
            {
              label: 'Save scene (overwrite with live state)',
              onClick: () => updateSceneFromLive(menu.sceneId)
            },
            { label: 'Duplicate scene', onClick: () => duplicateScene(menu.sceneId) },
            { label: 'Rename scene…', onClick: () => setRenamingId(menu.sceneId) },
            { divider: true, label: '' },
            { label: 'Delete scene', onClick: () => deleteScene(menu.sceneId), danger: true }
          ]}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  )
}
