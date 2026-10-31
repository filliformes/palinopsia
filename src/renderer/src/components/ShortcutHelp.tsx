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
      ['Q', 'Sequence (macro-form; in its own window : brings it up)'],
      ['S', 'Sonify (image → sound; in its own window : brings it up)'],
      ['B', 'Body (embodied control; in its own window : brings it up)'],
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
      ['V', 'Big preview : fold the panels under it (and back)'],
      ['Click the preview', 'Play on a source that takes a click (Marbling : a drop · hold : pour · drag : a trail; its comb tool : drag a stylus, ⇧-drag a five-tine comb) · Body’s Pinch = click : a pinch does the same']
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
      ['Ctrl K', 'Search everything : sources, effects, parameters, presets, themes, pages, commands (again : close it)'],
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
    title: 'In the search (Ctrl K)',
    rows: [
      ['↑ ↓', 'Choose  ·  PgUp / PgDn by eight'],
      ['Tab', 'The next kind (sources, effects, parameters…)  ·  ⇧Tab the one before'],
      ['Enter', 'Pick it : a source goes in the selected slot, an effect in the selected rack, a parameter is shown and flashed'],
      ['Esc', 'Close it  ·  with the field empty, your recent picks come first']
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
      ['Right-click a control', 'Persistent · Set in every scene (a whole layer, effect chip, source card or modulator card : right-click it)'],
      ['Right-click an M', 'Clear all the modulation on that control'],
      ['Ctrl / Alt drag an effect', 'Copy it into another rack (a plain drag moves it)'],
      ['⇧ drag a knob', 'Finer (Macro knobs, the Mixer)'],
      ['Right-click Output', 'Watch the Output in a window · the Output page in a window'],
      ['Right-click Body, Seq or Sonify', 'The page in a window of its own'],
      ['Right-click the Master FX', 'Save the chain as one of yours (my chains) · rename or delete them'],
      ['Right-click Load', 'Add the picked session as scenes · its earlier versions · link a folder of sessions'],
      ['A steps card', 'Drag : draw the bars · click : rest / play · right-click a step : its condition · hold FILL (⇧-click : keep it on)']
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
          Bare letters are ignored while a text field is focused, and under the Source Editor (its keys are its own). In a page's own window (Output, Body, Sequencer, Sonify) they still play the instrument. Most of these are also MIDI-learnable : press{' '}
          <kbd className="rounded border border-border bg-panel2 px-1 font-mono text-[10px]">L</kbd>.
        </p>
      </div>
    </div>
  )
}
