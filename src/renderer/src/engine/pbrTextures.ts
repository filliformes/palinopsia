// PBR material library for the Context finalizer's surface mapping — the
// whole composition "projected" onto a physical material (crumpled paper,
// bark, sand…). 30 CC0 material sets from ambientcg.com, shipped as 1K JPGs
// in the renderer's public dir (pbr/<AssetID>/{normal,height,ao}.jpg — AO is
// optional, some sets don't publish one).
//
// Maps load LAZILY: nothing is fetched until a material is first selected;
// while its images stream in, the neutral flat maps are served so the frame
// never stalls or flashes. Textures get REPEAT wrap (the shader tiles by
// pbrScale) + mipmaps.

import { handle, type TextureHandle } from './isfTextureBridge'

export interface PbrMaterial {
  id: string // ambientCG asset id = folder name under public/pbr/
  name: string // dropdown label (Context.fs LABELS must match this order)
}

// ORDER IS THE ENUM: Context.fs `pbrTexture` VALUES 1..30 index into this
// list (0 = off). Append only — saved sessions store the index.
export const PBR_MATERIALS: PbrMaterial[] = [
  { id: 'Paper001', name: 'paper crumpled' },
  { id: 'Paper005', name: 'paper rough' },
  { id: 'Paper006', name: 'paper fibers' },
  { id: 'Cardboard002', name: 'cardboard' },
  { id: 'Bark006', name: 'bark fine' },
  { id: 'Bark012', name: 'bark deep' },
  { id: 'Bark014', name: 'bark plates' },
  { id: 'Ground033', name: 'dry ground' },
  { id: 'Ground054', name: 'sand dunes' },
  { id: 'Ground080', name: 'sand ripples' },
  { id: 'Rock063', name: 'rock face' },
  { id: 'Rock064', name: 'rock rough' },
  { id: 'Fabric030', name: 'fabric weave' },
  { id: 'Fabric061', name: 'fabric knit' },
  { id: 'Carpet016', name: 'carpet' },
  { id: 'Plaster001', name: 'plaster' },
  { id: 'PaintedPlaster017', name: 'painted plaster' },
  { id: 'Concrete034', name: 'concrete' },
  { id: 'Concrete048', name: 'concrete rough' },
  { id: 'Bricks104', name: 'bricks' },
  { id: 'Wood051', name: 'wood planks' },
  { id: 'Wood095', name: 'wood grain' },
  { id: 'Metal063', name: 'metal worn' },
  { id: 'CorrugatedSteel009', name: 'corrugated steel' },
  { id: 'Foil002', name: 'crushed foil' },
  { id: 'Foil003', name: 'foil wrinkles' },
  { id: 'Snow010A', name: 'snow' },
  { id: 'Lava004', name: 'lava' },
  { id: 'Leather037', name: 'leather' },
  { id: 'Gravel043', name: 'gravel' }
]

export interface PbrMaps {
  normal: TextureHandle
  height: TextureHandle
  ao: TextureHandle
}

interface Loading {
  maps: PbrMaps | null // null until every map settled (loaded or fallback)
}

export class PbrLib {
  private neutral: PbrMaps
  private cache = new Map<number, Loading>()
  private owned: WebGLTexture[] = []

  constructor(private gl: WebGL2RenderingContext) {
    // Neutral 1×1 maps: flat normal (128,128,255), mid height, full AO — the
    // shader normalizes against the flat normal, so these are a passthrough.
    this.neutral = {
      normal: this.solid([128, 128, 255, 255]),
      height: this.solid([128, 128, 128, 255]),
      ao: this.solid([255, 255, 255, 255])
    }
  }

  neutralMaps(): PbrMaps {
    return this.neutral
  }

  /** Maps for 1-based material index; neutral maps while streaming in. */
  get(idx: number): PbrMaps {
    const mat = PBR_MATERIALS[idx - 1]
    if (!mat) return this.neutral
    let entry = this.cache.get(idx)
    if (!entry) {
      entry = { maps: null }
      this.cache.set(idx, entry)
      void this.load(mat, entry)
    }
    return entry.maps ?? this.neutral
  }

  private async load(mat: PbrMaterial, entry: Loading): Promise<void> {
    const base = new URL(`pbr/${mat.id}/`, document.baseURI).href
    const [normal, height, ao] = await Promise.all([
      this.fetchTex(`${base}normal.jpg`, this.neutral.normal),
      this.fetchTex(`${base}height.jpg`, this.neutral.height),
      this.fetchTex(`${base}ao.jpg`, this.neutral.ao) // optional — neutral if absent
    ])
    entry.maps = { normal, height, ao }
  }

  private fetchTex(url: string, fallback: TextureHandle): Promise<TextureHandle> {
    return new Promise((resolve) => {
      const img = new Image()
      img.onload = () => {
        const gl = this.gl
        const tex = gl.createTexture()!
        this.owned.push(tex)
        gl.bindTexture(gl.TEXTURE_2D, tex)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
        gl.generateMipmap(gl.TEXTURE_2D)
        gl.bindTexture(gl.TEXTURE_2D, null)
        resolve(handle(tex, img.naturalWidth, img.naturalHeight))
      }
      img.onerror = () => resolve(fallback) // missing map (e.g. no AO) → neutral
      img.src = url
    })
  }

  private solid(rgba: [number, number, number, number] | number[]): TextureHandle {
    const gl = this.gl
    const tex = gl.createTexture()!
    this.owned.push(tex)
    gl.bindTexture(gl.TEXTURE_2D, tex)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba))
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.bindTexture(gl.TEXTURE_2D, null)
    return handle(tex, 1, 1)
  }

  dispose(): void {
    for (const t of this.owned) this.gl.deleteTexture(t)
    this.owned = []
    this.cache.clear()
  }
}
