// Collage — the clip-pool model for the Collage video source.
//
// Assemble's plain sibling : a folder is read as a POOL, one entry per FILE,
// with no analysis and no shot detection. Nothing here is derived from the
// pixels — only what a probe already knows — so a folder becomes playable in
// the time it takes ffmpeg to open each file.
//
// Shared by both processes : main fills the pool (scan + codec bridge), the
// renderer plays it.

/** One playable film in a Collage pool. One entry per FILE (no shot detection). */
export interface CollageClip {
  id: string // stable hash of path+size+mtime
  // The PLAYABLE absolute path : the converted cache path when the original
  // codec is not Chromium-decodable, otherwise the original file itself.
  file: string
  fileName: string // basename of the ORIGINAL file, for display
  durSec: number
  width: number
  height: number
}

export interface CollageScanResult {
  ok: boolean
  clips: CollageClip[]
  skipped: string[] // file names that could not be used, with no detail
  error?: string
}
