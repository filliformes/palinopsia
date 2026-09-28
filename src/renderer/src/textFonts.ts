// Text-source font registry : the single source of truth for the Text
// generator's font list. Families must match the @font-face declarations in
// styles.css exactly (all bundled OFL/Apache, no CDN). ORDER MATTERS: a slot's
// `font` input stores an INDEX, so the original six stay first (saved sessions
// keep their face) and new families append after.
export const TEXT_FONTS = [
  // Original six : indices 0-5 are persisted in sessions/scenes.
  'Inter',
  'Space Grotesk',
  'JetBrains Mono',
  'Playfair Display',
  'Bebas Neue',
  'VT323',
  // Expansion (alphabetical).
  'Abril Fatface',
  'Alfa Slab One',
  'Anton',
  'Archivo Black',
  'Bangers',
  'Bungee',
  'Caveat',
  'Cinzel',
  'Comfortaa',
  'Cormorant',
  'Courier Prime',
  'Creepster',
  'Crimson Pro',
  'DM Sans',
  'DM Serif Display',
  'EB Garamond',
  'Fira Code',
  'Fraunces',
  'Josefin Sans',
  'Lexend',
  'Libre Baskerville',
  'Lobster',
  'Major Mono Display',
  'Manrope',
  'Monoton',
  'Orbitron',
  'Oswald',
  'Outfit',
  'Pacifico',
  'Permanent Marker',
  'Pixelify Sans',
  'Press Start 2P',
  'Raleway',
  'Righteous',
  'Rubik',
  'Rubik Mono One',
  'Shrikhand',
  'Silkscreen',
  'Special Elite',
  'Staatliches',
  'Syne',
  'Tektur',
  'Unbounded',
  'Zilla Slab'
]

// The weights each face really has : [lightest, heaviest]. Variable files carry
// a weight axis (the range below is that axis, read from the font's fvar table);
// static files have ONE weight. styles.css declares each @font-face at exactly
// this range, and the Text source clamps its weight dial into it, so the browser
// never fakes a bold (a static face declared 100-900 used to ignore the dial).
const TEXT_FONT_WEIGHTS: Record<string, [number, number]> = {
  Inter: [400, 700], // four static cuts : 400 / 500 / 600 / 700
  'Space Grotesk': [300, 700],
  'JetBrains Mono': [100, 800],
  'Playfair Display': [400, 900],
  Caveat: [400, 700],
  Cinzel: [400, 900],
  Comfortaa: [300, 700],
  Cormorant: [300, 700],
  'Crimson Pro': [200, 900],
  'DM Sans': [100, 900],
  'EB Garamond': [400, 800],
  'Fira Code': [300, 700],
  Fraunces: [100, 900],
  'Josefin Sans': [100, 700],
  Lexend: [100, 900],
  'Libre Baskerville': [400, 700],
  Manrope: [200, 800],
  Orbitron: [400, 900],
  Oswald: [200, 700],
  Outfit: [100, 900],
  'Pixelify Sans': [400, 700],
  Raleway: [100, 900],
  Rubik: [300, 900],
  Syne: [400, 800],
  Tektur: [400, 900],
  Unbounded: [200, 900]
}

/** [lightest, heaviest] weight of the face at `idx` (static faces : [400, 400]). */
export function textFontWeightRange(idx: number): [number, number] {
  return TEXT_FONT_WEIGHTS[TEXT_FONTS[idx] ?? ''] ?? [400, 400]
}
