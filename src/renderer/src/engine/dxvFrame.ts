// DXV3 frame builder (Resolume's codec) : a pure function, used by the DXV
// worker (workers/dxvWorker.ts) and by the offline tests.
//
// In : one frame of DXT1 blocks from the GPU (engine/frameCapture 'dxt1' : 8 bytes
// a block, rows from the top, padded to 16 pixels). Out : one DXV3 "DXT1, normal
// quality" frame, the same layout Resolume and FFmpeg write :
//   header  'DXT1' tag (le32 of MKBETAG), version 4 (DXV3), 0, 0, 0, payload size
//   payload the texture as 32-bit words : the first two raw, then for each block
//           a 2-bit op (16 ops per le32 op word, placed where the next op starts) :
//           op 1 = same as the previous block, op 2/3 = same as a block further
//           back (here : the one above), else op 0 + op 0 + both words literally.
// "Same as the previous / the block above" catches the flat and repeated areas
// (black backgrounds, a still dome rim) that make up much of a Palinopsia frame,
// at two comparisons a block. Frames decode with FFmpeg's DXV decoder (tested).


const TAG_DXT1 = ('D'.charCodeAt(0) << 24) | ('X'.charCodeAt(0) << 16) | ('T'.charCodeAt(0) << 8) | '1'.charCodeAt(0)

/** One DXV3 frame from a frame of DXT1 words (2 per block); `bpr` = blocks per
 *  row. The frame is `length` bytes at the start of a FRESH buffer, to transfer
 *  as is (a fresh allocation costs nothing until written : the OS hands out zeroed
 *  pages lazily; copying the result out instead cost ~5 ms at 4096²). One flat
 *  loop, no helper calls : a 4096² frame is a million blocks, 30 times a second. */
export function buildDxvFrame(words: Uint32Array, bpr: number): { buf: ArrayBuffer; length: number } {
  const n = words.length
  // Worst case : every block literal (2 words + 3 ops) + op words.
  const cap = 12 + n * 4 + Math.ceil(((n / 2) * 3) / 16 + 2) * 4 + 16
  const b = new Uint8Array(cap)
  const dv = new DataView(b.buffer)
  dv.setUint32(12, words[0], true)
  dv.setUint32(16, words[1], true)
  let o = 20
  // The op word being filled (0 = none yet) and its bits. As PUSH_OP in FFmpeg's
  // dxvenc : a fresh op word goes in BEFORE the op's own offset bytes, when the
  // previous one holds 16 ops.
  let opAt = 0
  let opVal = 0
  let state = 16
  // The block above, as an op : its distance in blocks is one row (bpr).
  const upOp = bpr >= 0x102 ? 3 : bpr >= 2 ? 2 : 1
  const upExtra = bpr >= 0x102 ? bpr - 0x102 : bpr - 2
  const rowWords = bpr * 2
  for (let pos = 2; pos + 2 <= n; pos += 2) {
    const c = words[pos]
    const l = words[pos + 1]
    if (c === words[pos - 2] && l === words[pos - 1]) {
      if (state === 16) { if (opAt) dv.setUint32(opAt, opVal, true); opAt = o; opVal = 0; o += 4; state = 0 }
      opVal |= 1 << (state << 1)
      state++
    } else if (pos >= rowWords && c === words[pos - rowWords] && l === words[pos - rowWords + 1]) {
      if (state === 16) { if (opAt) dv.setUint32(opAt, opVal, true); opAt = o; opVal = 0; o += 4; state = 0 }
      if (upOp === 3) { b[o] = upExtra & 255; b[o + 1] = upExtra >>> 8; o += 2 } else if (upOp === 2) b[o++] = upExtra
      opVal |= upOp << (state << 1)
      state++
    } else {
      // op 0 (no copy), op 0 + the colour word, op 0 + the index word.
      if (state === 16) { if (opAt) dv.setUint32(opAt, opVal, true); opAt = o; opVal = 0; o += 4; state = 0 }
      state++
      if (state === 16) { if (opAt) dv.setUint32(opAt, opVal, true); opAt = o; opVal = 0; o += 4; state = 0 }
      state++
      dv.setUint32(o, c, true)
      o += 4
      if (state === 16) { if (opAt) dv.setUint32(opAt, opVal, true); opAt = o; opVal = 0; o += 4; state = 0 }
      state++
      dv.setUint32(o, l, true)
      o += 4
    }
  }
  if (opAt) dv.setUint32(opAt, opVal, true)
  const size = o - 12
  // Header : tag, version 4 = DXV3 (the decoder reads it as major + 1), minor 0,
  // "raw" flag 0, reserved, then the payload size.
  dv.setUint32(0, TAG_DXT1, true)
  b[4] = 4
  b[5] = 0
  b[6] = 0
  b[7] = 0
  dv.setUint32(8, size, true)
  return { buf: b.buffer, length: o }
}
