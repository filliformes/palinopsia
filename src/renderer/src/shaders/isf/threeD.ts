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
// Shaders that only look 3D on a flat picture (Oil Cloud, Lattice, Relief…) take
// no part in depth, so they stay unmarked. A new 3D source or depth reader is
// added here.

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

export const is3D = (id: string | null | undefined): boolean => !!id && THREE_D_IDS.has(id)

export const THREE_D_TITLE = '3D : draws a real 3D scene or reads the depth of one'
