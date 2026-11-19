// The Model source's file reader, off the main thread (engine/modelLoad.ts starts it).
// A model of a million triangles takes a second or two to read, to give normals to
// and to list the edges of : on the render thread that froze the picture. Here the
// page asks for a file by its path, and takes back the finished arrays (transferred,
// never copied) and its texture as an ImageBitmap.
//
// Files are read over opsia-media:// (main/media.ts), the same way films are : the
// model, then what it names beside it (a .gltf's buffers and images, an OBJ's MTL and
// its color map), each found first by its own relative name, then among the files
// the session carries for it (modelFiles : one that ends with that relative name,
// then one of the same bare name), then by its bare name beside the model (a session
// collected before each model had its own folder laid everything in one).

import { parseModel } from '../engine/modelParse'
import { prepareMesh, type MeshData } from '../engine/modelMesh'

export type ToModelWorker = { t: 'load'; id: number; path: string; files: string[] }
export type FromModelWorker =
  | { t: 'done'; id: number; mesh: MeshData; read: string[] }
  | { t: 'error'; id: number; message: string }

const g = self as unknown as {
  onmessage: ((e: MessageEvent<ToModelWorker>) => void) | null
  postMessage(m: FromModelWorker, transfer?: Transferable[]): void
}

const URL_PREFIX = 'opsia-media://local/'
const urlOf = (path: string): string => URL_PREFIX + encodeURIComponent(path)
const dirOf = (p: string): string => p.replace(/[\\/][^\\/]*$/, '')
const sepOf = (p: string): string => (p.includes('\\') ? '\\' : '/')
const baseOf = (p: string): string => p.split(/[\\/]/).filter(Boolean).pop() ?? p

async function readFile(path: string): Promise<ArrayBuffer> {
  const r = await fetch(urlOf(path))
  if (!r.ok) throw new Error(r.status === 404 ? 'not found' : r.status === 403 ? 'not a file the Model may read' : `could not be read (${r.status})`)
  return r.arrayBuffer()
}

const normRel = (p: string): string => p.normalize('NFC').replace(/\\/g, '/').toLowerCase()
/** `dir/../x` as the place it names (`dir`'s parent's x) : the list of what was read
 *  says where each file really is (the collect lays them out by it). */
function resolveDots(p: string, sep: string): string {
  const lead = /^(\\\\|\/\/|\/)/.exec(p)?.[0] ?? ''
  const out: string[] = []
  for (const s of p.slice(lead.length).split(/[\\/]+/)) {
    if (!s || s === '.') continue
    if (s === '..' && out.length > 1 && out[out.length - 1] !== '..') out.pop()
    else out.push(s)
  }
  return lead + out.join(sep)
}

async function load(path: string, files: string[]): Promise<{ mesh: MeshData; read: string[] }> {
  let buf: ArrayBuffer
  try {
    buf = await readFile(path)
  } catch (e) {
    throw new Error(`${baseOf(path)} ${(e as Error).message}`)
  }
  const dir = dirOf(path), sep = sepOf(path)
  const read: string[] = []
  // every texture made, closed unless it is the one the mesh keeps (a file that
  // fails, a second texture, one no face uses)
  const made: ImageBitmap[] = []
  const closeBut = (keep: ImageBitmap | null): void => { for (const b of made) if (b !== keep) b.close() }
  let raw: Awaited<ReturnType<typeof parseModel>>
  try {
    raw = await parseModel(path, buf, {
      async fetchRel(uri: string): Promise<ArrayBuffer> {
        if (uri.startsWith('data:')) return (await fetch(uri)).arrayBuffer()
        if (/^[a-z]+:\/\//i.test(uri)) throw new Error(`${uri} is on the network : the Model only reads files on this computer`)
        let rel = uri
        try { rel = decodeURIComponent(uri) } catch { /* as written */ }
        const tries = [resolveDots(dir + sep + rel, sep)]

        // the session's own files : the one laid out as the model names it, then one
        // of the same name
        const tail = '/' + normRel(rel).split('/').filter((s) => s && s !== '.' && s !== '..').join('/')
        for (const f of files) if (normRel(f).endsWith(tail)) tries.push(f)
        const want = baseOf(rel).normalize('NFC').toLowerCase()
        for (const f of files) if (baseOf(f).normalize('NFC').toLowerCase() === want) tries.push(f)
        tries.push(dir + sep + baseOf(rel))
        let last: unknown = null
        for (const p of [...new Set(tries)]) {
          try {
            const b = await readFile(p)
            if (!read.includes(p)) read.push(p)
            return b
          } catch (e) { last = e }
        }
        throw new Error(`${baseOf(rel)} ${(last as Error)?.message ?? 'not found'} beside the model`)
      },
      async image(bytes: Uint8Array, mime: string): Promise<ImageBitmap | null> {
        try {
          const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }), { premultiplyAlpha: 'none', colorSpaceConversion: 'none', imageOrientation: 'none' })
          made.push(bmp)
          // a huge texture is brought down to 4096 a side
          const big = Math.max(bmp.width, bmp.height)
          if (big <= 4096) return bmp
          const k = 4096 / big
          const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * k), resizeHeight: Math.round(bmp.height * k), resizeQuality: 'high' })
          bmp.close()
          made.push(small)
          return small
        } catch {
          return null
        }
      }
    })
  } catch (e) {
    closeBut(null)
    throw e
  }
  try {
    const mesh = prepareMesh(raw)
    closeBut(mesh.texture)
    return { mesh, read }
  } catch (e) {
    closeBut(null)
    throw e
  }
}

g.onmessage = (e: MessageEvent<ToModelWorker>): void => {
  const m = e.data
  if (m.t !== 'load') return
  load(m.path, m.files).then(
    ({ mesh, read }) => {
      const tr: Transferable[] = [mesh.pos.buffer, mesh.nrm.buffer, mesh.uv.buffer, mesh.col.buffer]
      if (mesh.idx) tr.push(mesh.idx.buffer)
      if (mesh.edges) tr.push(mesh.edges.buffer)
      if (mesh.edgeFaces) tr.push(mesh.edgeFaces.buffer)
      if (mesh.texture) tr.push(mesh.texture)
      // (each buffer once : a duplicate in the list refuses the whole message)
      g.postMessage({ t: 'done', id: m.id, mesh, read }, [...new Set(tr)])
    },
    (err: unknown) => g.postMessage({ t: 'error', id: m.id, message: (err as Error)?.message ?? String(err) })
  )
}
