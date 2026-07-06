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

/** Control side: stream `canvas` to the output window. Returns a teardown fn.
 *  Offers only when the receiver announces 'ready', so window load order never
 *  matters (the receiver re-announces until an offer arrives). */
export function startOutputSender(canvas: HTMLCanvasElement): () => void {
  const pc = new RTCPeerConnection()
  const stream = canvas.captureStream(60)
  const track = stream.getVideoTracks()[0]
  // Sharpness over motion-smoothing for detailed visuals.
  if (track) track.contentHint = 'detail'
  // High bitrate + no downscale — WebRTC otherwise caps around 1–2 Mbps and
  // scales the resolution down, which looks lo-fi for a fullscreen VJ output.
  const tx = pc.addTransceiver(track, {
    direction: 'sendonly',
    sendEncodings: [{ maxBitrate: 80_000_000, maxFramerate: 60 }]
  })
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
    // Keep resolution when bandwidth/CPU is tight (don't degrade sharpness).
    try {
      const p = tx.sender.getParameters()
      p.degradationPreference = 'maintain-resolution'
      if (p.encodings?.[0]) {
        p.encodings[0].maxBitrate = 80_000_000
        p.encodings[0].maxFramerate = 60
      }
      await tx.sender.setParameters(p)
    } catch {
      /* setParameters unsupported/late — the sendEncodings above still apply */
    }
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
  return () => {
    off()
    pc.close()
    stream.getTracks().forEach((t) => t.stop())
  }
}

/** Output side: play the incoming stream into `video`. Returns a teardown fn.
 *  Re-announces 'ready' every 400ms until an offer arrives, then stops — so it
 *  connects whether it mounts before or after the sender starts. */
export function startOutputReceiver(video: HTMLVideoElement): () => void {
  const pc = new RTCPeerConnection()
  let gotOffer = false
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
      gotOffer = true
      clearInterval(readyTimer)
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
  const announce = (): void => {
    if (!gotOffer) window.api.outputSignal({ type: 'ready' } as Signal)
  }
  const readyTimer = setInterval(announce, 400)
  announce()
  return () => {
    off()
    clearInterval(readyTimer)
    pc.close()
  }
}
