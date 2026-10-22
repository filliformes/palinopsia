// A section's word in the left margin, in the section's color, on the first
// line of what it names : the layer strip's IN / MIX / FX / OUT, and the Body
// page's groups (Hands, Pose, Face...). A title line costs a whole row; a word
// in the margin costs a narrow column beside rows that are there anyway. The
// width is the caller's (the layer strip's three-letter words sit in 17 px, the
// Body page's in a wider column where a long name breaks onto two lines); the
// title says what the section does.

export function MarginLabel({
  word,
  color,
  title,
  className = ''
}: {
  word: string
  color: string
  title: string
  /** Width and top offset (the first line of the content it names). */
  className?: string
}): JSX.Element {
  return (
    <span
      className={`shrink-0 cursor-default select-none font-mono text-[9px] leading-[13px] ${className}`}
      style={{ color }}
      title={title}
    >
      {word}
    </span>
  )
}
