// The app's toolbar button look (Output, Sonify, World, Freeze...), shared so a
// control that IS a button reads as one wherever it sits (the layer's A / B and
// the background's BG selectors used to look like plain labels).
export const TBTN = 'shrink-0 rounded border px-2.5 py-1 text-[11.5px] font-semibold transition-colors'
export const TBTN_IDLE = 'border-border bg-panel2 text-muted hover:border-accent/50 hover:text-accent'
// idle, but holding something (a slot with a source) : brighter text
export const TBTN_IDLE_ON = 'border-border bg-panel2 text-text hover:border-accent/50 hover:text-accent'
export const TBTN_LIT = 'border-accent bg-accent/20 text-accent'
