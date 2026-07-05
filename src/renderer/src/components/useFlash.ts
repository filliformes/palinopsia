// useFlash — brief visual acknowledgement for a fired action (the ⚄ dice).
// Returns [flashing, flash]; flash() turns flashing on for `ms`, so the dice
// and its section can pulse red to confirm "this section was randomized".

import { useCallback, useEffect, useRef, useState } from 'react'

export function useFlash(ms = 450): [boolean, () => void] {
  const [on, setOn] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const flash = useCallback(() => {
    setOn(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOn(false), ms)
  }, [ms])
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])
  return [on, flash]
}
