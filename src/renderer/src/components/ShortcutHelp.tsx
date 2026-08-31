// The keyboard cheat-sheet (opened with `?`). This app keys nearly its whole
// alphabet; without one place to see them the bindings are invisible. Kept in
// sync BY HAND with App's global onKey handler — when a shortcut changes there,
// change it here. Closes on backdrop click or Esc (App owns the Esc path).

const GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'Full-page views',
    rows: [
      ['O', 'Output / mapping'],
      ['W', 'World editor'],
      ['Q', 'Sequence (macro-form)'],
      ['S', 'Sonify (image → sound)']
    ]
  },
  {
    title: 'Right column & panels',
    rows: [
      ['M', 'Mixer ↔ Layers'],
      ['F', 'Finishing'],
      ['G', 'Feel (global macros)'],
      ['E', 'Assemble tab'],
      ['A', 'I/O setup tab'],
      ['D', 'Fold Modulation'],
      ['X', 'Fold Master FX'],
      ['I', 'Fold Inspector']
    ]
  },
  {
    title: 'Inspector focus',
    rows: [
      ['P', 'Vibe Palette  ·  ⇧P cycles presets'],
      ['C', 'Context  ·  ⇧C cycles presets']
    ]
  },
  {
    title: 'Performance',
    rows: [
      ['1–9', 'Recall scene'],
      ['0', 'Panic flush (empty feedback buffers)'],
      ['R', 'Randomize (Transport’s current mode)'],
      ['H', 'Freeze / hold the output'],
      ['L', 'MIDI Learn on/off'],
      ['Esc', 'Close top overlay · exit MIDI Learn']
    ]
  },
  {
    title: 'Session & zoom',
    rows: [
      ['Ctrl S', 'Save session'],
      ['Ctrl Z', 'Undo  ·  Ctrl ⇧Z / Ctrl Y redo'],
      ['Ctrl + / −', 'Zoom UI  ·  Ctrl 0 resets'],
      ['Ctrl wheel', 'Zoom UI']
    ]
  }
]

export function ShortcutHelp({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-[640px] max-w-[92vw] overflow-y-auto rounded-lg border border-border bg-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-mono text-[13px] uppercase tracking-wide text-text">Keyboard shortcuts</h2>
          <button
            onClick={onClose}
            className="rounded px-1.5 py-0.5 font-mono text-[12px] leading-none text-muted transition-colors hover:text-accent"
            title="Close (Esc)"
          >
            ✕
          </button>
        </div>
        <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
          {GROUPS.map((g) => (
            <div key={g.title} className="min-w-0">
              <div className="mb-1 font-mono text-[9px] uppercase tracking-wide text-accent2">{g.title}</div>
              <div className="flex flex-col gap-0.5">
                {g.rows.map(([keys, label]) => (
                  <div key={keys} className="flex items-baseline gap-2">
                    <kbd className="shrink-0 rounded border border-border bg-panel2 px-1.5 py-0.5 font-mono text-[10px] text-text">
                      {keys}
                    </kbd>
                    <span className="min-w-0 text-[11px] text-muted">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 border-t border-border pt-2 text-[10px] text-muted">
          Bare letters are ignored while a text field is focused. Most of these are also MIDI-learnable — press{' '}
          <kbd className="rounded border border-border bg-panel2 px-1 font-mono text-[10px]">L</kbd>.
        </p>
      </div>
    </div>
  )
}
