// The pieces that belong to the 3D side of Palinopsia, marked with a small blue
// "3D" after their name in the source and effect menus (SearchSelect).
//
// - Sources that draw a real 3D scene through a camera : Model and Grid Mesh
//   (both can hand their TRUE depth to the depth readers), Point Cloud and
//   Terrain (raised from a picture's depth).
// - Effects that read the depth map (a Model's or a Grid Mesh's true depth, or
//   the depth engine's) : Parallax, Depth Scan, Luma Blur (depth focus) and
//   Pulfrich (keyed on the depth map).
//
// - 2.5D (a lighter mark) : sources that LOOK 3D on a flat picture but hand no
//   depth to anything : Oil Cloud (a ray-marched cloud), Lattice (its tunnel,
//   sphere, torus and galaxy forms) and Relief (a height map relit).
// A new 3D source or depth reader is added to THREE_D_IDS, a new look-only one to
// TWO_HALF_D_IDS.

export const THREE_D_IDS: ReadonlySet<string> = new Set([
  'gen-model',
  'gen-gridmesh',
  'gen-pointcloud',
  'gen-terrain',
  'node-parallax',
  'node-depthscan',
  'node-lumablur',
  'node-pulfrich'
])

export const TWO_HALF_D_IDS: ReadonlySet<string> = new Set(['oil-cloud', 'gen-lattice', 'gen-relief'])

export const is3D = (id: string | null | undefined): boolean => !!id && THREE_D_IDS.has(id)

/** '3D', '2.5D' or null : the mark a menu row carries. */
export const depthMark = (id: string | null | undefined): '3D' | '2.5D' | null =>
  !id ? null : THREE_D_IDS.has(id) ? '3D' : TWO_HALF_D_IDS.has(id) ? '2.5D' : null

/** Sources that show nothing without material from outside : a small grey
 *  "needs …" tag after their name in the source menus (what to give them). */
export const NEEDS: Readonly<Record<string, { tag: string; title: string }>> = {
  'gen-collage': { tag: 'needs films', title: 'Needs a folder of films (video files) : pick it in the Inspector once it is on a slot' },
  'gen-silhouette': { tag: 'needs camera', title: 'Needs the Body camera : turn it on in the Body page (B)' },
  // the layer menu's "Assemblage…" entry : an edit cut from films analysed in Assemble
  '__assemble_pick__': { tag: 'needs films', title: 'Needs films analysed in Assemble (E) : it plays an edit cut from them' }
}

export const THREE_D_TITLE = '3D : draws a real 3D scene or reads the depth of one'
export const TWO_HALF_D_TITLE = '2.5D : looks 3D on a flat picture, gives no depth to anything'
