// The audio engine's format, per computer : the sample rate and the buffer the
// app asks the device for. Both audio contexts take it (Sonify's, which the
// Audio Layer and a recording's sound also run on, and the input's with its
// monitor). 0 : the device's own rate / the automatic low-latency buffer.
// The system has the last word : the buffer is a request (Windows shared mode
// often holds 10 ms at the least), so what the device really gives is shown.

export interface AudioFormat { rate: number; frames: number }

export const AUDIO_FORMAT_DEFAULT: AudioFormat = { rate: 0, frames: 0 }
export const AUDIO_RATES = [0, 44100, 48000, 88200, 96000]
export const AUDIO_BUFFERS = [0, 128, 256, 512, 1024, 2048, 4096]

export const formatKey = (f: AudioFormat): string => `${f.rate}:${f.frames}`

export function parseFormat(v: unknown): AudioFormat {
  if (typeof v !== 'string') return { ...AUDIO_FORMAT_DEFAULT }
  const [r, b] = v.split(':').map(Number)
  return {
    rate: AUDIO_RATES.includes(r) ? r : 0,
    frames: AUDIO_BUFFERS.includes(b) ? b : 0
  }
}

/** The options for a new AudioContext : a buffer of `frames` at the chosen rate
 *  (48 kHz assumed for the device's own) as a latency in seconds. */
export function contextOptions(f: AudioFormat): AudioContextOptions {
  const o: AudioContextOptions = { latencyHint: f.frames ? f.frames / (f.rate || 48000) : 'interactive' }
  if (f.rate) o.sampleRate = f.rate
  return o
}

export interface LatencyInfo { rate: number; baseMs: number; outMs: number }

/** What a running context really gives : its rate, its processing latency and
 *  the output's (the device and the system, when the browser knows it). */
export function latencyOf(ctx: AudioContext | null): LatencyInfo | null {
  if (!ctx || ctx.state === 'closed') return null
  return {
    rate: ctx.sampleRate,
    baseMs: (ctx.baseLatency || 0) * 1000,
    outMs: ((ctx as AudioContext & { outputLatency?: number }).outputLatency || 0) * 1000
  }
}

export const rateLabel = (r: number): string => (r ? `${(r / 1000).toFixed(r % 1000 ? 1 : 0)} kHz` : "device's rate")
export const bufferLabel = (b: number): string => (b ? `${b} samples` : 'auto (lowest)')
