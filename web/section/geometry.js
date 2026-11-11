// Where the soil section draws its ground line, in px of a 1920 x 1080 frame (the section's SVG viewBox, scaled to fit and centred).
// Shared by section/index.html and hook_tour/flip.js, so the hook's flipped outline lands exactly on the section's ground line.
export const SECTION = { X0: 150, X1: 1500, G: 330, GROUND_W: 3 };

// 1920 x 1080 frame px -> screen px (same as the SVG's preserveAspectRatio="xMidYMid meet")
export function frameToScreen(W = innerWidth, H = innerHeight) {
  const s = Math.min(W / 1920, H / 1080), ox = (W - 1920 * s) / 2, oy = (H - 1080 * s) / 2;
  return { s, x: fx => ox + fx * s, y: fy => oy + fy * s };
}
