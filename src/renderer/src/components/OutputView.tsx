// OutputView : the fullscreen output window's entire content. It runs its OWN
// WebGL Compositor and renders the exact composition the control window pushes
// each frame (composition + modulation values + warp + clock). No WebRTC, no
// transcode → pixel-perfect, full-resolution output. Loaded on the #output hash.
//
// Note: for video / capture / HIVE source slots this opens a second decode of
// its own (generators + shaders are identical); those live sources may drift a
// touch between the two windows, which is fine for a mirror.

import { useEffect, useRef } from 'react'
import type { OutputFrame } from '@shared/types'
import { Compositor } from '../engine/Compositor'
import { applyModulation } from '../engine/modulation'
import { applyFieldMacros } from '../engine/field'
import { shaderSourceById } from '../shaders/isf'
import { inputsForShader } from '../shaders/isf/inputs'

export function OutputView(): JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let comp: Compositor | null = null
    try {
      comp = new Compositor(canvas, canvas.width, canvas.height)
    } catch (e) {
      console.error('[output Compositor]', (e as Error).message)
      return
    }
    const off = window.api.onOutputFrame((f: OutputFrame) => {
      // The whole drive is guarded, mirroring the control render loop.
      try {
        comp!.setGlobalSpeed(f.globalSpeed)
        comp!.setWarp(f.warpEnabled ? f.warpCorners : null, f.warpGrid)
        comp!.syncFromState(f.c, shaderSourceById)
        applyModulation(comp!, f.c, f.modValues, inputsForShader)
        // Mirror audio-coupled A/B mixes (computed with the audio bus in the
        // control window, which the output window doesn't run).
        if (f.coupledMix) {
          for (let i = 0; i < f.coupledMix.length; i++) {
            const layer = comp!.layers[i]
            if (layer) layer.sourceMix = f.coupledMix[i]
          }
        }
        // Mirror Proximity's Context mood push.
        if (f.contextProx) {
          const ctx = f.c.master.find((x) => x.shaderId === 'fx-context')
          if (ctx) {
            const sc = { kind: 'master' as const }
            comp!.setFxInput(sc, ctx.id, 'haze', f.contextProx.haze)
            comp!.setFxInput(sc, ctx.id, 'blur', f.contextProx.blur)
            comp!.setFxInput(sc, ctx.id, 'depth', f.contextProx.depth)
            comp!.setFxInput(sc, ctx.id, 'bloom', f.contextProx.bloom)
          }
        }
        // ── Bottom-bar state, mirrored for an EXACT replica ──
        // Field macros : deterministic, re-applied from the passed scalars (same
        // order as the control loop : after modulation, before temperament).
        if (f.density !== undefined || f.gestureTexture !== undefined || f.coalesce !== undefined) {
          applyFieldMacros(comp!, f.c, f.density ?? 0.5, f.gestureTexture ?? 0.5, f.coalesce ?? 0.5)
        }
        // Temperament (Tonicity + Drift) : the exact master-FX values the control
        // window applied (can't re-derive audio / random / time here).
        if (f.masterOverrides) {
          const sc = { kind: 'master' as const }
          for (const id in f.masterOverrides) {
            const inputs = f.masterOverrides[id]
            for (const name in inputs) comp!.setFxInput(sc, id, name, inputs[name])
          }
        }
        // Shutter freeze (whole-frame hold).
        comp!.setFreeze(!!f.freeze)
        // Superimposition flicker : dim the same non-hot layers by the same amount.
        const sf = f.superFlicker ?? 0
        const hotL = f.flickerHot ?? -1
        if (sf > 0.02 && hotL >= 0) {
          comp!.layers.forEach((L, i) => { if (L && i !== hotL) L.opacity *= 1 - sf })
        }
        comp!.render(f.time)
      } catch (err) {
        console.error('[output render]', err)
      }
    })
    return () => {
      off()
      comp?.dispose()
    }
  }, [])

  return (
    <div className="fixed inset-0 bg-black">
      <canvas ref={canvasRef} width={1920} height={1080} className="h-full w-full bg-black object-contain" />
    </div>
  )
}
