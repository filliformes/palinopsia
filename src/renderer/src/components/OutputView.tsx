// OutputView — the fullscreen output window's entire content: a bare <video>
// that plays the control window's mirrored canvas (via the WebRTC loopback).
// Loaded when the renderer URL carries the #output hash.

import { useEffect, useRef } from 'react'
import { startOutputReceiver } from '../outputLink'

export function OutputView(): JSX.Element {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  useEffect(() => {
    if (!videoRef.current) return
    return startOutputReceiver(videoRef.current)
  }, [])
  return (
    <div className="fixed inset-0 bg-black">
      <video ref={videoRef} autoPlay muted playsInline className="h-full w-full bg-black object-contain" />
    </div>
  )
}
