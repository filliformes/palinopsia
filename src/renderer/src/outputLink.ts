// outputLink — mirror the control window's canvas to the fullscreen output
// window over a WebRTC loopback (both are local Electron renderers; signalling
// is relayed by the main process). Hardware-encoded on the GPU, ~1 frame of
// latency, and — crucially — it captures the ALREADY-composited/warped canvas,
// so there's no second render pipeline and no double camera/device access.
//
// Handshake: the receiver (output window) announces 'ready' once mounted; the
// sender (control window) answers that by creating and sending the offer, so
// the offer can't race ahead of the receiver being live.

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Signal {
  type: 'ready' | 'offer' | 'answer' | 'ice'
  sdp?: RTCSessionDescriptionInit
  candidate?: RTCIceCandidateInit
}

/** Control side: stream `canvas` to the output window. Returns a teardown fn. */
export function startOutputSender(canvas: HTMLCanvasElement): () => void {
  const pc = new RTCPeerConnection()
  const stream = canvas.captureStream(60)
  stream.getTracks().forEach((t) => pc.addTrack(t, stream))
  pc.onicecandidate = (e) => {
    if (e.candidate) window.api.outputSignal({ type: 'ice', candidate: e.candidate.toJSON() } as Signal)
  }
  let offered = false
  const makeOffer = async (): Promise<void> => {
    if (offered) return
    offered = true
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    window.api.outputSignal({ type: 'offer', sdp: offer } as Signal)
  }
  const off = window.api.onOutputSignal(async (raw) => {
    const d = raw as Signal
    if (d?.type === 'ready') await makeOffer()
    else if (d?.type === 'answer' && d.sdp) await pc.setRemoteDescription(d.sdp)
    else if (d?.type === 'ice' && d.candidate) {
      try {
        await pc.addIceCandidate(d.candidate)
      } catch {
        /* ignore late/duplicate candidates */
      }
    }
  })
  // In case the receiver was already 'ready' before we started listening.
  void makeOffer()
  return () => {
    off()
    pc.close()
    stream.getTracks().forEach((t) => t.stop())
  }
}

/** Output side: play the incoming stream into `video`. Returns a teardown fn. */
export function startOutputReceiver(video: HTMLVideoElement): () => void {
  const pc = new RTCPeerConnection()
  pc.ontrack = (e) => {
    video.srcObject = e.streams[0]
    void video.play().catch(() => {})
  }
  pc.onicecandidate = (e) => {
    if (e.candidate) window.api.outputSignal({ type: 'ice', candidate: e.candidate.toJSON() } as Signal)
  }
  const off = window.api.onOutputSignal(async (raw) => {
    const d = raw as Signal
    if (d?.type === 'offer' && d.sdp) {
      await pc.setRemoteDescription(d.sdp)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      window.api.outputSignal({ type: 'answer', sdp: answer } as Signal)
    } else if (d?.type === 'ice' && d.candidate) {
      try {
        await pc.addIceCandidate(d.candidate)
      } catch {
        /* ignore */
      }
    }
  })
  // Announce we're live so the sender creates the offer.
  window.api.outputSignal({ type: 'ready' } as Signal)
  return () => {
    off()
    pc.close()
  }
}
