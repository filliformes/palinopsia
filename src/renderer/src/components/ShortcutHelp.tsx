// The keyboard cheat-sheet (opened with `?`). This app keys nearly its whole
// alphabet; without one place to see them the bindings are invisible. Kept in
// sync BY HAND with App's global onKey handler : when a shortcut changes there,
// change it here. Closes on backdrop click or Esc (App owns the Esc path).

import { SOURCE_EDITOR_KEY } from '../shaders/userShaders'

const GROUPS: Array<{ title: string; rows: Array<[string, string]> }> = [
  {
    title: 'Full-page views',
    rows: [
      ['O', 'Output / mapping (in its own window : brings it up)'],
      ['W', 'World editor'],
      ['Q', 'Sequence (macro-form)'],
      ['S', 'Sonify (image → sound)'],
      ['B', 'Body (embodied control)'],
      ['K', 'Resolume OSC mapper'],
      [SOURCE_EDITOR_KEY, 'Source Editor : write a shader, or a copy of any one, as your own (again : close it)']
    ]
  },
  {
    title: 'Right column & panels',
    rows: [
      ['M', 'Mixer ↔ Layers'],
      ['F', 'Finishing'],
      ['G', 'Feel (global macros)'],
      ['E', 'Assemble tab (again : back to the layers)'],
      ['A', 'Connect tab : audio · MIDI · OSC · Resolume · dataflou · Ableton Link · Agent (again : back to the layers)'],
      ['D', 'Fold Modulation'],
      ['X', 'Fold Master FX'],
      ['I', 'Fold Inspector'],
      ['V', 'Big preview : fold the panels under it (and back)']
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
      ['Esc', 'Close this sheet, then the top page (the Source Editor first) · exit MIDI Learn'],
      ['Esc on the output', 'Close a fullscreen output over the controls, else back to them (an installation : hold Esc or O 1.5 s)'],
      ['Ctrl ⇧O', 'Leave an installation, from any window']
    ]
  },
  {
    title: 'Session & zoom',
    rows: [
      ['?', 'This sheet (again : close it)'],
      ['Ctrl S', 'Save session'],
      ['Ctrl F', 'Fulldome output on / off'],
      ['Ctrl Z', 'Undo  ·  Ctrl ⇧Z / Ctrl Y redo'],
      ['Ctrl + / −', 'Zoom UI  ·  Ctrl 0 resets'],
      ['Ctrl wheel', 'Zoom UI']
    ]
  },
  {
    title: 'In the Source Editor',
    rows: [
      ['Ctrl S', 'Save the shader (one that plays changes live)'],
      ['Esc', 'Close it (outside the code)'],
      ['Ctrl F', 'Find and replace in the code'],
      ['Ctrl Z', 'Undo in the code  ·  Ctrl ⇧Z redo'],
      ['Ctrl /', 'Comment the line on / off'],
      ['Tab', 'Indent  ·  ⇧Tab unindent'],
      ['Alt ↑ / ↓', 'Move the line']
    ]
  },
  {
    title: 'In the World editor',
    rows: [
      ['↑ ↓ ← →', 'Step through the Worlds'],
      ['Enter', 'Apply the selected World (double-click one too)']
    ]
  },
  {
    title: 'Mouse',
    rows: [
      ['Double-click', 'A slider, fader or knob : back to its default'],
      ['Right-click a control', 'Persistent · Set in every scene (a layer : right-click the layer)'],
      ['Right-click an M', 'Clear all the modulation on that control'],
      ['Ctrl / Alt drag an effect', 'Copy it into another rack (a plain drag moves it)'],
      ['⇧ drag a knob', 'Finer (Meta knobs, the Mixer)'],
      ['Right-click Output', 'Output in a window · the Output page in a window']
    ]
  },
  {
    title: 'In Sonify & the audio tab',
    rows: [
      ['⇧ drag a slider', 'Finer : a tenth of the speed'],
      ['Click a value', "Type it (the Collage's levels and filters, the Ring cutoff, the Prism crossover : 4250, 4.2k, -6)"],
      ['Drag a Space number', 'Up / down to change it (⇧ : finer) · drag a voice on the Room map to place it'],
      ['Drag an EQ point', 'The output EQ (audio tab) : frequency across, gain up and down · wheel over it : Q · double-click : band on / off, or a new bell · Delete : band off · Esc : close']
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
          Bare letters are ignored while a text field is focused, and under the Source Editor (its keys are its own). In the Output page's own window they still play the instrument. Most of these are also MIDI-learnable : press{' '}
          <kbd className="rounded border border-border bg-panel2 px-1 font-mono text-[10px]">L</kbd>.
        </p>
      </div>
    </div>
  )
}
