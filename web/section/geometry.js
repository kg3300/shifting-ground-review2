// Where the soil section draws its ground line, in px of a 1920 x 1080 frame (the section's SVG viewBox, scaled to fit and centred).
// Shared by section/index.html and hook_tour/flip.js, so the hook's flipped outline lands exactly on the section's ground line.
// Values from Krishna's Figma board (11 Nov 2026): ground line x 104-1663 at y 64.
export const SECTION = { X0: 104, X1: 1663, G: 64, GROUND_W: 3 };

// Where each section well stands on the ground line (frame px): its longitude across the study area (W..E, the outline's
// westmost and eastmost longitudes), then wells closer than MINGAP px nudged apart with their west-to-east order kept.
// MINGAP 71.6 reproduces the well spacing on Krishna's board to within 1 px.
export const MINGAP = 71.6;
export function wellXs(wells, W, E) {
  const xs = wells.map(w => SECTION.X0 + (w.lon - W) / (E - W) * (SECTION.X1 - SECTION.X0));   // wells sorted west to east
  for (let pass = 0; pass < 40; pass++)
    for (let i = 1; i < xs.length; i++) { const d = xs[i] - xs[i - 1]; if (d < MINGAP) { const k = (MINGAP - d) / 2; xs[i - 1] -= k; xs[i] += k; } }
  return xs;
}
export const WELL_ICON = { r: 4.75, stroke: 2 };   // the well's icon on the ground line (board): a white dot with a black rim

// 1920 x 1080 frame px -> screen px (same as the SVG's preserveAspectRatio="xMidYMid meet")
export function frameToScreen(W = innerWidth, H = innerHeight) {
  const s = Math.min(W / 1920, H / 1080), ox = (W - 1920 * s) / 2, oy = (H - 1080 * s) / 2;
  return { s, x: fx => ox + fx * s, y: fy => oy + fy * s };
}
