// window.H : test helpers for ISF source generators, driven over CDP by h.cjs
window.gl = document.getElementById('cv').getContext('webgl2', { preserveDrawingBuffer: true })
const cv = document.getElementById('cv')
// stand-in audio texture (128x2) : row 0 waveform, row 1 spectrum
const a = document.createElement('canvas'); a.width = 128; a.height = 2
const g2 = a.getContext('2d')
for (let x = 0; x < 128; x++) {
  const v = 128 + 90 * Math.sin(x / 5); g2.fillStyle = `rgb(${v},${v},${v})`; g2.fillRect(x, 0, 1, 1)
  const s = 255 * Math.exp(-x / 30); g2.fillStyle = `rgb(${s},${s},${s})`; g2.fillRect(x, 1, 1, 1)
}
window.audioCanvas = a
window.FORCE_DT = 1 / 60
// The app pushes a 128x2 R8 GL texture (row 0 = waveform at v 0.25, no flip) : mirror it
// (a canvas goes through the runtime's image path, which flips the rows).
function audioHandle() {
  const bytes = new Uint8Array(256)
  for (let x = 0; x < 128; x++) { bytes[x] = Math.round(128 + 90 * Math.sin(x / 5)); bytes[128 + x] = Math.round(255 * Math.exp(-x / 30)) }
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t)
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, 128, 2, 0, gl.RED, gl.UNSIGNED_BYTE, bytes)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  return window.texHandle(t, 128, 2)
}
let audioH = null
window.setAudio = (wave, spec) => { const bytes = new Uint8Array(256); for (let x = 0; x < 128; x++) { bytes[x] = wave[x]; bytes[128 + x] = spec[x] } gl.bindTexture(gl.TEXTURE_2D, audioH.texture); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 128, 2, gl.RED, gl.UNSIGNED_BYTE, bytes) }
// Mirror the app's GL proxy (Compositor.makeRedirectableGL) : the runtime's
// bindTexture(null) between passes is ignored, so pushed textures stay bound.
const glp = new Proxy(gl, { get(t, p) { if (p === 'bindTexture') return (a, b) => { if (b !== null) t.bindTexture(a, b) }; const v = t[p]; return typeof v === 'function' ? v.bind(t) : v } })
window.glp = glp
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// -- Input image for FX : a photo-like test card (gradients, color bars, fine
// lines, text, soft noise) with a disc that orbits, so temporal FX have motion.
// window.INPUT = 'card' | 'alpha' (left third transparent) | 'black'
window.INPUT = 'card'
window.MOVING = true
const ic = document.createElement('canvas'); ic.width = 1920; ic.height = 1080
const ig = ic.getContext('2d', { willReadFrequently: true })
function paintInput(t) {
  const W = 1920, H = 1080
  ig.clearRect(0, 0, W, H)
  if (window.INPUT === 'black') { ig.fillStyle = '#000'; ig.fillRect(0, 0, W, H); return }
  const g = ig.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#1c2a3a'); g.addColorStop(0.5, '#8a6a4a'); g.addColorStop(1, '#101010')
  ig.fillStyle = g; ig.fillRect(0, 0, W, H)
  const bars = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0']
  bars.forEach((c, i) => { ig.fillStyle = c; ig.fillRect(80 + i * 110, 80, 110, 260) })
  for (let i = 0; i < 60; i++) { ig.fillStyle = i % 2 ? '#fff' : '#000'; ig.fillRect(1000 + i * 3, 80, 2, 260) }
  ig.fillStyle = '#eee'; ig.font = 'bold 120px sans-serif'; ig.fillText('OPSIA 42', 1000, 520)
  for (let y = 600; y < 1000; y += 4) for (let x = 80; x < 900; x += 4) { const v = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1; ig.fillStyle = 'rgba(255,255,255,' + (Math.abs(v) * 0.25) + ')'; ig.fillRect(x, y, 4, 4) }
  const cx = W * (0.62 + 0.18 * Math.cos(t * 1.3)), cy = H * (0.7 + 0.15 * Math.sin(t * 1.3))
  const rg = ig.createRadialGradient(cx, cy, 0, cx, cy, 140); rg.addColorStop(0, '#fff3d0'); rg.addColorStop(0.8, '#e08030'); rg.addColorStop(1, 'rgba(224,128,48,0)')
  ig.fillStyle = rg; ig.beginPath(); ig.arc(cx, cy, 140, 0, 6.2832); ig.fill()
  if (window.INPUT === 'alpha') ig.clearRect(0, 0, W / 3, H)
}
const inGL = gl.createTexture()
gl.bindTexture(gl.TEXTURE_2D, inGL)
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1920, 1080, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
const inputH = window.texHandle(inGL, 1920, 1080)
let lastPaint = null
function uploadInput(t) {
  const key = window.INPUT + ':' + (window.MOVING ? t.toFixed(4) : 'still')
  if (key === lastPaint) return
  lastPaint = key
  paintInput(window.MOVING ? t : 0)
  gl.bindTexture(gl.TEXTURE_2D, inGL)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true) // layer textures are GL-oriented (top at v = 1)
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false)
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, ic)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
}
// The input as GL-oriented pixels (bottom row first), for comparing with readPixels.
function inputPixels() {
  const d = ig.getImageData(0, 0, 1920, 1080).data, out = new Uint8Array(d.length)
  for (let y = 0; y < 1080; y++) out.set(d.subarray((1079 - y) * 7680, (1080 - y) * 7680), y * 7680)
  return out
}
window.uploadInput = uploadInput
window.inputPixels = inputPixels

function make(id, inputs) {
  const src = window.shaderSourceById(id)
  if (!src) throw new Error('no source for ' + id)
  const r = new window.Renderer(glp)
  r.loadSource(src)
  if (!r.valid) return { err: String(r.error).slice(0, 600), line: r.errorLine }
  // Simulated frames are 1/60 s of layer time : make TIMEDELTA agree (it is wall-clock otherwise).
  { const od = r.setDateUniforms; r.setDateUniforms = function () { od.call(this); if (window.FORCE_DT) this.setValue('TIMEDELTA', window.FORCE_DT) } }
  if (r.uniforms.audioTex) { if (!audioH) audioH = audioHandle(); r.setValue('audioTex', audioH) }
  if (r.uniforms.inputImage) { uploadInput(0); r.setValue('inputImage', inputH) }
  for (const k in inputs || {}) if (r.uniforms[k]) r.setValue(k, inputs[k])
  return { r }
}
function getv(r, k) { const x = r.uniforms[k] && r.uniforms[k].value; return typeof x === 'number' ? x : typeof x === 'boolean' ? +x : 0 }
// Draw at layer-clock time t. `jump` = also set every PH_ phase as if it had
// integrated from 0 at the current input values (a long show at a fixed rate).
function drawAt(r, t, jump) {
  r.__opsiaTimeSec = t
  if (r.uniforms.inputImage) { uploadInput(t); r.setValue('inputImage', inputH) }
  if (audioH && r.uniforms.audioTex) r.setValue('audioTex', audioH) // re-push every frame, like Compositor.pushAudioTex
  r.draw(cv)
  if (jump && r.__opsiaPh) {
    const st = r.__opsiaPh
    st.names.forEach((n, i) => { st.val[i] = t * st.fns[i]((k) => getv(r, k)) })
    st.lastT = t
    if (audioH && r.uniforms.audioTex) r.setValue('audioTex', audioH)
    if (r.uniforms.inputImage) r.setValue('inputImage', inputH)
    r.draw(cv)
  }
}
function read() {
  const W = cv.width, H = cv.height, px = new Uint8Array(W * H * 4)
  gl.bindFramebuffer(gl.FRAMEBUFFER, null)
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px)
  return px
}
function stats(px) {
  const W = cv.width, H = cv.height
  let sum = 0, sum2 = 0, n = 0, mx = 0, mn = 255, al = 0
  for (let y = 0; y < H; y += 7) for (let x = 0; x < W; x += 7) {
    const i = (y * W + x) * 4, l = (px[i] + px[i + 1] + px[i + 2]) / 3
    sum += l; sum2 += l * l; n++; mx = Math.max(mx, l); mn = Math.min(mn, l); al += px[i + 3]
  }
  const m = sum / n
  return { mean: +m.toFixed(1), sd: +Math.sqrt(Math.max(0, sum2 / n - m * m)).toFixed(1), min: Math.round(mn), max: Math.round(mx), alpha: Math.round(al / n) }
}
function diff(p, q) { let d = 0, n = 0; for (let i = 0; i < p.length; i += 4 * 13) { d += Math.abs(p[i] - q[i]) + Math.abs(p[i + 1] - q[i + 1]) + Math.abs(p[i + 2] - q[i + 2]); n++ } return +(d / n / 3).toFixed(2) }
async function run(r, t0, frames, jump, dt = 1 / 60) {
  let t = t0
  drawAt(r, t, jump)
  for (let i = 0; i < frames; i++) { t += dt; drawAt(r, t, false); await wait(1) }
  return t
}
window.H = {

  // FX : compile, how much it changes the input (diffIn), motion with a moving
  // input, a 24 h show (phases jumped), a still input (does the FX drift on its
  // own?), transparent-input handling, 4K cost.
  async fxcheck(ids, inputs) {
    const out = {}
    for (const id of ids) {
      window.INPUT = 'card'; window.MOVING = true
      const m = make(id, inputs)
      if (m.err) { out[id] = { err: m.err, line: m.line }; continue }
      const r = m.r, res = {}
      try {
        let t = await run(r, 5, 30, true)
        let p = read()
        res.t5 = { ...stats(p), diffIn: diff(p, inputPixels()) }
        await run(r, t + 1 / 60, 6, false); res.t5.moves = diff(p, read())
        t = await run(r, 86400, 30, true)
        p = read(); res.t24h = { ...stats(p), diffIn: diff(p, inputPixels()) }
        await run(r, t + 1 / 60, 6, false); res.t24h.moves = diff(p, read())
        window.MOVING = false
        t = await run(r, 50, 30, false); p = read(); await run(r, t + 1 / 60, 6, false)
        res.stillMoves = diff(p, read())
        window.INPUT = 'alpha'
        await run(r, 60, 20, false); p = read()
        let aL = 0, cL = 0, n = 0
        for (let y = 0; y < 1080; y += 9) for (let x = 0; x < 600; x += 9) { const i = (y * 1920 + x) * 4; aL += p[i + 3]; cL += (p[i] + p[i + 1] + p[i + 2]) / 3; n++ }
        res.alphaHole = { alpha: Math.round(aL / n), rgb: Math.round(cL / n) }
        window.INPUT = 'card'
        cv.width = 3840; cv.height = 2160
        const one = new Uint8Array(4)
        r.draw(cv); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one)
        const t0 = performance.now()
        for (let i = 0; i < 10; i++) { r.draw(cv); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one) }
        res.ms4k = +((performance.now() - t0) / 10).toFixed(2)
        cv.width = 1920; cv.height = 1080
        res.glErr = gl.getError()
      } catch (e) { res.exc = String(e).slice(0, 400) }
      try { r.cleanup() } catch (e) {}
      window.INPUT = 'card'; window.MOVING = true
      out[id] = res
    }
    return out
  },
  // compile + look + motion at 5 s, 1 h, 24 h (phases jumped as a long show) + 4K cost
  async check(ids, inputs) {
    const out = {}
    for (const id of ids) {
      const m = make(id, inputs)
      if (m.err) { out[id] = { err: m.err, line: m.line }; continue }
      const r = m.r, res = {}
      try {
        for (const [lab, T] of [['t5', 5], ['t1h', 3600], ['t24h', 86400]]) {
          const t = await run(r, T, 30, true)
          const p = read()
          await run(r, t + 1 / 60, 6, false)
          const q = read()
          res[lab] = { ...stats(p), moves: diff(p, q) }
        }
        cv.width = 3840; cv.height = 2160
        const one = new Uint8Array(4)
        r.draw(cv); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one)
        const t0 = performance.now()
        for (let i = 0; i < 10; i++) { r.draw(cv); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, one) }
        res.ms4k = +((performance.now() - t0) / 10).toFixed(2)
        cv.width = 1920; cv.height = 1080
        res.glErr = gl.getError()
      } catch (e) { res.exc = String(e).slice(0, 400) }
      try { r.cleanup() } catch (e) {}
      out[id] = res
    }
    return out
  },
  // PNG (data URL) of one frame at clock t, after `warm` frames (persistent buffers need them)
  async shot(id, t, inputs, warm = 30, w = 1920, h = 1080) {
    const m = make(id, inputs); if (m.err) return m
    cv.width = w; cv.height = h
    await run(m.r, t, warm, true)
    const url = cv.toDataURL('image/png')
    try { m.r.cleanup() } catch (e) {}
    cv.width = 1920; cv.height = 1080
    return { url }
  },
  // Does changing `input` from a to b at clock t jump the picture? Compares one
  // frame step with the change against one without (both after warm-up).
  async scrub(id, input, a, b, t = 1800, inputs) {
    const m = make(id, Object.assign({}, inputs, { [input]: a })); if (m.err) return m
    const r = m.r
    let tt = await run(r, t, 20, true)
    const p0 = read(); tt += 1 / 60; drawAt(r, tt); const p1 = read()
    r.setValue(input, b)
    tt += 1 / 60; drawAt(r, tt); const p2 = read()
    try { r.cleanup() } catch (e) {}
    return { stepSame: diff(p0, p1), stepChanged: diff(p1, p2) }
  }
}
