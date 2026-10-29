// "my chains" on the Master FX strip : right-click the strip to save the chain
// as one of your chains (a name is asked; a name you already have asks to
// replace it), or to rename or delete one. The effects' own menus on the strip
// end with the same Save entry. The chains themselves live in userChains.ts.

import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { CHAIN_NAME_MAX, chainFromComposition, userChainKey, userChains, useUserChains } from '../userChains'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { ConfirmModal, PromptModal } from './PromptModal'
import { showToast } from './Toast'

type Dialog =
  | { kind: 'save'; name: string }
  | { kind: 'replace'; name: string }
  | { kind: 'rename'; from: string }
  | { kind: 'delete'; name: string }

// The one mounted MyChainDialogs (the strip's) : a chip's menu opens the same prompt.
let openDialog: ((d: Dialog) => void) | null = null

const SAVE_HINT =
  'Keep the chain as it plays now under a name : its effects in order with all their settings, on or off and dry / wet, and the Vibe and Context settings. It goes first in the chain presets menu (my chains), on this computer.'

/** "Save chain as preset…" : the strip's menu and the end of its effects' menus. */
export function useSaveChainItem(): MenuItem {
  const any = useStore((s) => s.composition.master.some((f) => !f.locked))
  return {
    label: 'Save chain as preset…',
    disabled: !any,
    title: any ? SAVE_HINT : 'Add an effect to the chain first',
    onClick: () => openDialog?.({ kind: 'save', name: '' })
  }
}

/** The strip's right-click menu : save, then rename or delete one of yours. */
export function MyChainsMenu({ x, y, onClose }: { x: number; y: number; onClose: () => void }): JSX.Element {
  const mine = useUserChains()
  const save = useSaveChainItem()
  const [view, setView] = useState<'main' | 'rename' | 'delete'>('main')
  const none = mine.length === 0
  let header = 'Master FX chain'
  let items: MenuItem[]
  if (view === 'main') {
    items = [
      save,
      { label: '', divider: true },
      {
        label: 'Rename my chain ▸',
        keepOpen: true,
        disabled: none,
        title: none ? 'No chains of yours yet' : 'Give one of your chains another name',
        onClick: () => setView('rename')
      },
      {
        label: 'Delete my chain ▸',
        keepOpen: true,
        disabled: none,
        title: none ? 'No chains of yours yet' : 'Take one of your chains off this computer (asks first)',
        onClick: () => setView('delete')
      }
    ]
  } else {
    header = view === 'rename' ? 'Rename my chain' : 'Delete my chain'
    items = [
      { label: '‹ back', keepOpen: true, onClick: () => setView('main') },
      { label: '', divider: true },
      ...mine.map((p): MenuItem => ({
        label: p.name,
        danger: view === 'delete',
        onClick: () => openDialog?.(view === 'rename' ? { kind: 'rename', from: p.name } : { kind: 'delete', name: p.name })
      }))
    ]
  }
  return <ContextMenu x={x} y={y} header={header} items={items} onClose={onClose} />
}

/** The prompts and confirms (mounted once, beside the strip). `onSaved` hears
 *  the key of a chain just saved : the menu names it at once. */
export function MyChainDialogs({ onSaved }: { onSaved: (key: string) => void }): JSX.Element | null {
  const [d, setD] = useState<Dialog | null>(null)
  useEffect(() => {
    openDialog = setD
    return () => {
      if (openDialog === setD) openDialog = null
    }
  }, [])
  if (!d) return null
  const close = (): void => setD(null)

  // The chain as it plays at the moment you confirm.
  const save = (name: string): void => {
    const { chain, dropped } = chainFromComposition(useStore.getState().composition)
    if (!chain.fx.length) {
      showToast('The chain has no effects to save', 'warn')
      return close()
    }
    userChains.save({ ...chain, name })
    onSaved(userChainKey(name))
    close()
    if (dropped.length)
      showToast(
        `Saved to my chains · ${name}. ${dropped.join(', ')} will read no layer : a chain names a layer only as the lowest, the second or the highest one playing (never an image)`,
        'warn',
        7000
      )
    else showToast(`Saved to my chains · ${name}`)
  }

  if (d.kind === 'save')
    return (
      <PromptModal
        title="Save the chain as"
        placeholder="e.g. Night grain"
        confirmLabel="Save"
        initial={d.name}
        onConfirm={(v) => {
          const name = v.slice(0, CHAIN_NAME_MAX).trim()
          if (userChains.get(name)) setD({ kind: 'replace', name })
          else save(name)
        }}
        onCancel={close}
      />
    )
  if (d.kind === 'replace')
    return (
      <ConfirmModal
        title={`You already have a chain called "${d.name}". Replace it with the chain playing now?`}
        yesLabel="Replace"
        noLabel="Another name"
        onYes={() => save(d.name)}
        onNo={() => setD({ kind: 'save', name: d.name })}
      />
    )
  if (d.kind === 'rename')
    return (
      <PromptModal
        title={`Rename "${d.from}"`}
        confirmLabel="Rename"
        initial={d.from}
        onConfirm={(v) => {
          const name = v.slice(0, CHAIN_NAME_MAX).trim()
          if (name !== d.from && userChains.get(name)) {
            showToast(`You already have a chain called "${name}"`, 'warn')
            return
          }
          userChains.rename(d.from, name)
          close()
        }}
        onCancel={close}
      />
    )
  return (
    <ConfirmModal
      title={`Delete your chain "${d.name}"? It goes from this computer.`}
      yesLabel="Delete"
      noLabel="Cancel"
      onYes={() => {
        userChains.remove(d.name)
        showToast(`Deleted · ${d.name}`)
        close()
      }}
      onNo={close}
    />
  )
}
