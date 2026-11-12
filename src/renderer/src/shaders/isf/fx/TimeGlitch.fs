/*{
  "DESCRIPTION": "Time Glitch : time smeared, then broken inside its own memory. The picture keeps a memory of its recent past (TIME : from a short smear to seconds of trails; MODE : a mean, the lights held, or the darks held) and, on a stepped clock (RATE, or the tempo with SYNC), CHAOS picks blocks of that memory to damage INSIDE the loop : moved by SHIFT, torn sideways along their row, stuck (they stop taking the live picture), crushed to a few levels with their channels swapped, the colors pulled apart by SPLIT. The memory feeds back, so every glitch is smeared and remembered, and the trails it leaves are glitched again on the next step. AFTER glitches the result once more on its way out (block moves, row tears, the color split), without keeping it. BLOCKS is the grain of the damage, DRIFT breathes the memory in or out, CRUSH how hard it bit-crushes. BURST ▸ is a fit of chaos that dies away over BURST LENGTH (bind it to a beat or an onset); AUDIO raises the chaos per block column from its band of the sound. CLEAR empties the memory.",
  "CREDIT": "Palinopsia",
  "ISFVSN": "2",
  "CATEGORIES": ["FX", "Glitch", "Time", "Feedback"],
  "INPUTS": [
    { "NAME": "inputImage", "TYPE": "image" },
    { "NAME": "time",     "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.6, "LABEL": "time" },
    { "NAME": "mode",     "TYPE": "long",  "VALUES": [0, 1, 2], "LABELS": ["smear", "lights", "darks"], "DEFAULT": 1, "LABEL": "mode", "COMPACT": true },
    { "NAME": "drift",    "TYPE": "float", "MIN": -1.0, "MAX": 1.0, "DEFAULT": 0.15, "LABEL": "drift" },
    { "NAME": "chaos",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.35, "LABEL": "chaos" },
    { "NAME": "rate",     "TYPE": "float", "MIN": 0.25, "MAX": 16.0, "DEFAULT": 6.0, "LABEL": "rate (Hz)" },
    { "NAME": "sync",     "TYPE": "long",  "VALUES": [0, 1, 2, 3, 4, 5], "LABELS": ["free (rate)", "1 bar", "1/2", "1/4", "1/8", "1/16"], "DEFAULT": 0, "LABEL": "sync", "COMPACT": true },
    { "NAME": "blocks",   "TYPE": "float", "MIN": 3.0, "MAX": 64.0, "DEFAULT": 14.0, "LABEL": "blocks" },
    { "NAME": "shift",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.4, "LABEL": "shift" },
    { "NAME": "split",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "split" },
    { "NAME": "crush",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.25, "LABEL": "crush" },
    { "NAME": "inside",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.7, "LABEL": "inside" },
    { "NAME": "after",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.3, "LABEL": "after" },
    { "NAME": "burst",    "TYPE": "event", "LABEL": "burst ▸" },
    { "NAME": "burstLen", "TYPE": "float", "MIN": 0.1, "MAX": 4.0, "DEFAULT": 0.8, "LABEL": "burst length (s)" },
    { "NAME": "audio",    "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 0.0, "LABEL": "audio" },
    { "NAME": "amount",   "TYPE": "float", "MIN": 0.0, "MAX": 1.0, "DEFAULT": 1.0, "LABEL": "mix" },
    { "NAME": "clear",    "TYPE": "event", "LABEL": "clear ▸" },
    { "NAME": "audioTex", "TYPE": "image" }
  ],
  "PASSES": [
    { "TARGET": "clk", "PERSISTENT": true, "WIDTH": "1", "HEIGHT": "1" },
    { "TARGET": "mem", "PERSISTENT": true },
    { }
  ]
}*/

// The glitch clock (engine/phases.ts) : one step per whole unit, at RATE Hz or on
// a division of the tempo (SYNC), capped at 16 a second. Integrated : moving the
// rate changes the pace from here on, never re-deals the blocks at once. The
// clock is only used through mod(floor(), 4096.) : wrapped at that.
uniform float PH_timeGlitch; // wrap 4096

const vec3 LUMA = vec3(0.299, 0.587, 0.114);

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031); // precise hash : whole-number inputs, kept small
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

// 16-bit values in two 8-bit channels (the layer clock in the latch).
vec2 enc16(float x) {
  float v = floor(clamp(x, 0.0, 1.0) * 65535.0 + 0.5);
  float hi = floor(v / 256.0);
  return vec2(hi, v - hi * 256.0) / 255.0;
}
float dec16(vec2 c) {
  vec2 b = floor(c * 255.0 + 0.5);
  return (b.x * 256.0 + b.y) / 65535.0;
}

// The latch : rg the layer clock (fract(TIME)), b the burst envelope, a = written.
vec4 latch() {
  vec2 c0 = vec2(0.5);
  return IMG_NORM_PIXEL(clk, c0);
}
// This frame's step on the LAYER's clock (Speed, freeze and the background's
// slow clock carry through), in seconds.
float layerDt(vec4 s) {
  if (s.a < 0.5) return 1.0 / 60.0; // first frame, or just flushed
  return min(abs(fract(TIME - dec16(s.rg) + 0.5) - 0.5), 0.1);
}

// The memory stores straight rgb and a coverage offset by one step (1/255 .. 1) :
// alpha 0 means EMPTY (first frame, resize, panic, CLEAR). Rounded to the 8-bit
// grid stochastically (exact on average : the trails neither stall in a fog nor
// stop short), as Wide Time does.
vec4 packMem(vec4 p) {
  vec3 fc = vec3(floor(gl_FragCoord.xy), mod(float(FRAMEINDEX), 4096.0));
  float r = hash13(fc);
  float r2 = hash13(fc + vec3(0.0, 0.0, 4099.0));
  float a = clamp(p.a, 0.0, 1.0);
  vec3 rgb = a > 0.0 ? clamp(p.rgb / a, 0.0, 1.0) : vec3(0.0);
  return vec4(floor(rgb * 255.0 + r) / 255.0, floor(1.0 + 254.0 * a + r2) / 255.0);
}
vec4 unpack(vec4 s, vec4 fallback) {
  if (s.a < 0.5 / 255.0) return fallback;
  float a = max(s.a * 255.0 - 1.0, 0.0) / 254.0;
  return vec4(s.rgb * a, a);
}
vec4 premul(vec4 c) { return vec4(c.rgb * c.a, c.a); }
float inFrame(vec2 p) {
  return step(0.0, p.x) * step(p.x, 1.0) * step(0.0, p.y) * step(p.y, 1.0);
}
// The memory at p, premultiplied; outside the frame (a block moved past the
// edge) or still empty : the live picture there, never the edge row smeared in.
vec4 memAt(vec2 p, vec4 live) {
  vec4 s = IMG_NORM_PIXEL(mem, p);
  return mix(live, unpack(s, live), inFrame(p));
}

// Spectrum (row 1, log-spaced : 0 bass .. 1 treble), 0..1. Bare-identifier coord.
float spec(float u) {
  vec2 ac = vec2(clamp(u, 0.0, 1.0), 0.75);
  return IMG_NORM_PIXEL(audioTex, ac).r;
}

// The damage a block takes at this step. x : is it hit; y : which kind
// (0 move, 1 tear, 2 stick, 3 crush); zw : its way, on a coarse compass (whole
// steps, mostly sideways : the codec's rows), never zero.
vec4 damage(vec2 uv, float stepI, float seed, float share) {
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 grid = vec2(floor(blocks * aspect + 0.5), floor(blocks + 0.5));
  vec2 cell = floor(uv * grid);
  // a block holds its damage for one to three steps, so some smears run long
  float hold = floor(stepI / (1.0 + floor(hash12(cell + vec2(seed, 7.0)) * 3.0)));
  float h0 = hash12(cell + vec2(hold * 1.37 + seed, 19.0));
  float au = audio > 0.0 ? audio * spec((cell.x + 0.5) / grid.x) : 0.0;
  float hit = step(1.0 - clamp(share + au, 0.0, 1.0), h0);
  float kind = floor(hash12(cell + vec2(seed + 3.0, hold)) * 4.0);
  vec2 r2 = (vec2(hash12(cell + vec2(hold, seed + 5.0)), hash12(cell + vec2(seed + 9.0, hold))) - 0.5) * 2.0;
  vec2 dir = floor(r2 * vec2(3.0, 1.0) + 0.5);
  dir.x += step(abs(dir.x) + abs(dir.y), 0.0) * (r2.x < 0.0 ? -1.0 : 1.0);
  return vec4(hit, kind, dir);
}

// One step of the memory at uv : the damaged memory read, folded with the live
// picture. The memory pass writes it; the output pass recomputes it (the pass
// targets flip after the frame, so this is THIS frame's memory, no frame late).
vec4 memStep(vec2 uv, vec4 lat, float dts) {
  vec4 live = premul(IMG_NORM_PIXEL(inputImage, uv));
  float stepI = mod(floor(PH_timeGlitch), 4096.0);
  float burstE = lat.a > 0.5 ? lat.b : 0.0;
  float share = clamp(chaos * 0.55 + burstE * 0.6, 0.0, 1.0) * inside;
  vec4 dmg = damage(uv, stepI, 11.0, share);
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  float isMove = dmg.x * (1.0 - step(0.5, dmg.y));
  float isTear = dmg.x * step(0.5, dmg.y) * (1.0 - step(1.5, dmg.y));
  float isStick = dmg.x * step(1.5, dmg.y) * (1.0 - step(2.5, dmg.y));
  float isCrush = dmg.x * step(2.5, dmg.y);

  // DRIFT : the memory breathes about the middle (out = trails flow outward).
  vec2 c = (uv - 0.5) * (1.0 - drift * 0.012 * dts) + 0.5;
  // The damage's read position, a little further every frame while the block is
  // hit, so its memory is dragged along (the mosh smear) : a block MOVE along its
  // way, a TEAR drags its whole row sideways.
  vec2 mv = dmg.zw / max(length(dmg.zw), 1.0) * (0.0015 + 0.012 * shift);
  float rowY = floor(uv.y * floor(blocks + 0.5));
  float tear = (hash12(vec2(rowY, stepI + 3.0)) - 0.5) * (0.003 + 0.024 * shift);
  vec2 rp = c - (mv * isMove + vec2(tear * isTear, 0.0)) * dts;
  // SPLIT : red and blue read a little apart in the damaged blocks, so the
  // colors of a trail drift away from each other while the block is hit (all
  // over, the drift streamed every trail into a rainbow).
  float sp = split * 0.004 * dmg.x * dts;
  vec2 rpR = rp + vec2(sp, 0.0);
  vec2 rpB = rp - vec2(sp, sp * 0.5 * aspect);
  vec4 hm = memAt(rp, live);
  vec4 hist = vec4(memAt(rpR, live).r, hm.g, memAt(rpB, live).b, hm.a);
  // CRUSH : the remembered colors down to a few levels (posterized, dithered by
  // the block so the bands differ from block to block). The channel swap is
  // AFTER's alone : swapped in the loop it would cycle every frame.
  float lv = mix(24.0, 2.5, crush);
  vec3 hs = hist.rgb / max(hist.a, 1e-4);
  vec3 q = floor(hs * lv + hash12(floor(uv * 64.0) + stepI) * 0.6) / lv;
  hist.rgb = mix(hist.rgb, clamp(q, 0.0, 1.0) * hist.a, isCrush);

  // TIME : how much of the memory survives a 60 fps frame (a 2-frame smear to
  // about 8 seconds of trails), on the layer's clock.
  float width = mix(1.5, 480.0, time * time * time);
  float k = pow(width / (width + 1.0), dts);
  // a STUCK block stops taking the live picture : it holds what it had
  k = mix(k, 1.0, isStick);
  vec4 o;
  if (mode == 1) o = max(live, hist * k);                       // lights held
  else if (mode == 2) o = min(live, mix(vec4(1.0), hist, k));   // darks held
  else o = mix(live, hist, k);                                   // a mean
  return clamp(o, 0.0, 1.0);
}

void main() {
  vec2 uv = isf_FragNormCoord;
  vec4 lat = latch();
  float dt = layerDt(lat);
  float dts = dt * 60.0;

  if (PASSINDEX == 0) {
    // the burst envelope : full while burst ▸ is held, then down over BURST LENGTH
    float e = lat.a > 0.5 ? lat.b : 0.0;
    // (at least one 8-bit step a frame, or a fast display would stall it)
    e = burst ? 1.0 : max(e - max(dt / max(burstLen, 0.05), step(1e-6, dt) / 255.0), 0.0);
    gl_FragColor = vec4(enc16(fract(TIME)), e, 1.0);
    return;
  }
  if (PASSINDEX == 1) {
    // The very first draw samples a black input (the runtime binds the input
    // on a unit its pass buffers then take) : store EMPTY, never that black.
    if (FRAMEINDEX == 0) { gl_FragColor = vec4(0.0); return; }
    if (clear) { gl_FragColor = packMem(premul(IMG_NORM_PIXEL(inputImage, uv))); return; }
    gl_FragColor = packMem(memStep(uv, lat, dts));
    return;
  }

  // AFTER : the result glitched once more on its way out, not kept : blocks read
  // from elsewhere, rows torn, the colors split.
  vec4 live = IMG_NORM_PIXEL(inputImage, uv);
  float stepI = mod(floor(PH_timeGlitch), 4096.0);
  float burstE = lat.a > 0.5 ? lat.b : 0.0;
  float shareA = clamp(chaos * 0.55 + burstE * 0.6, 0.0, 1.0) * after;
  vec4 dmg = damage(uv, stepI, 53.0, shareA * 0.6);
  float aspect = RENDERSIZE.x / RENDERSIZE.y;
  vec2 grid = vec2(floor(blocks * aspect + 0.5), floor(blocks + 0.5));
  float rowY = floor(uv.y * floor(blocks * 2.0 + 0.5));
  float tearOn = step(1.0 - shareA * 0.35, hash12(vec2(rowY, stepI + 71.0)));
  float tear = (hash12(vec2(rowY + 5.0, stepI)) - 0.5) * (0.02 + 0.12 * shift) * tearOn;
  // a moved block shows another one, whole blocks away
  float isMove = dmg.x * (1.0 - step(1.5, dmg.y));
  float isSwap = dmg.x * step(1.5, dmg.y);
  vec2 p = uv + dmg.zw / grid * (0.5 + 1.5 * shift) * isMove + vec2(tear, 0.0);
  // reads past the frame mirror back in (no edge streaks)
  p = 1.0 - abs(1.0 - mod(p, 2.0));
  float sp = split * after * (0.002 + 0.01 * max(dmg.x, tearOn));
  vec2 pR = p + vec2(sp, 0.0);
  vec2 pB = p - vec2(sp, 0.0);
  vec4 g = memStep(p, lat, dts);
  vec4 wideP = vec4(memStep(pR, lat, dts).r, g.g, memStep(pB, lat, dts).b, g.a);
  float wa = clamp(wideP.a, 0.0, 1.0);
  vec3 wide = wa > 0.0 ? clamp(wideP.rgb / wa, 0.0, 1.0) : vec3(0.0);
  // the other blocks turn their channels (the color tear), harder with CRUSH
  wide = mix(wide, wide.gbr, isSwap * (0.35 + 0.65 * crush));
  // the trails carry their own coverage over a transparent input; an opaque
  // layer never gets a hole punched in it
  gl_FragColor = mix(live, vec4(wide, max(wa, live.a)), amount);
}
