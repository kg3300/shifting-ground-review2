// Hook -> soil section (Krishna, 10 Nov): on the last slide, -> plays one move, about 2.3 s, then opens the section.
//   1. everything fades to white (the map, the grain, the red blocks, the other lines, the text panel): 0-1.0 s;
//   2. only the Sangrur-Barnala outline stays, darkening from white to black as the background whitens;
//   3. the outline turns in 3D about a horizontal axis (with perspective) until it is edge-on: one line, 0.5-2.0 s;
//      while it turns, every point slides to its longitude on the section, so the outline's west and east tips land on the
//      section's west and east ends, at the height of its ground line (section/geometry.js).
//   4. the section opens with ?from=hook, starting from that same line, and builds itself (layers, wells, labels).
import { SECTION, frameToScreen } from "../section/geometry.js";

const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;

// freezeAt (seconds, for checking only): draw that one moment, stay on the page, and return the overlay so it can be removed
export async function flipToSection(map, { url = "../section/index.html?from=hook", fromWidth = 3, freezeAt = null } = {}) {
  const fc = await map.getSource("area").getData();
  const rings = [];
  for (const f of fc.features || [fc]) {
    const g = f.geometry;
    if (g.type === "Polygon") rings.push(g.coordinates[0]);
    if (g.type === "MultiPolygon") g.coordinates.forEach(p => rings.push(p[0]));
  }
  const box = map.getContainer().getBoundingClientRect();
  const pts = rings.map(r => r.map(([lon, lat]) => { const p = map.project([lon, lat]); return { lon, x: p.x + box.left, y: p.y + box.top }; }));
  const all = pts.flat(), W = Math.min(...all.map(p => p.lon)), E = Math.max(...all.map(p => p.lon));
  const cx = (Math.min(...all.map(p => p.x)) + Math.max(...all.map(p => p.x))) / 2;
  const cy = (Math.min(...all.map(p => p.y)) + Math.max(...all.map(p => p.y))) / 2;
  const F = frameToScreen(), ty = F.y(SECTION.G), tx = lon => F.x(SECTION.X0 + (lon - W) / (E - W) * (SECTION.X1 - SECTION.X0));
  const toW = SECTION.GROUND_W * F.s, D = Math.max(innerWidth, innerHeight) * 1.2;   // viewer distance for the perspective

  const veil = Object.assign(document.createElement("div"), { style: "position:fixed;inset:0;background:#fff;opacity:0;z-index:50;pointer-events:none" });
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("style", "position:fixed;inset:0;width:100vw;height:100vh;z-index:51;pointer-events:none");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("fill", "none"); path.setAttribute("stroke-linejoin", "round"); path.setAttribute("stroke-linecap", "round");
  svg.append(path); document.body.append(veil, svg);

  const t0 = performance.now();
  await new Promise(done => {
    const frame = now => {
      const t = freezeAt ?? (now - t0) / 1000, a = ease(t / 1.0), u = ease((t - 0.5) / 1.5), th = u * Math.PI / 2;
      const cyN = lerp(cy, ty, u);
      const d = pts.map(ring => ring.map((p, i) => {
        const dx = p.x - cx, dy = p.y - cy, k = D / (D + dy * Math.sin(th));        // top edge tips away, bottom toward
        const x = lerp(cx + dx * k, tx(p.lon), u), y = cyN + dy * Math.cos(th) * k;
        return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1);
      }).join(" ") + " Z").join(" ");
      const c = Math.round(255 * (1 - a));
      path.setAttribute("d", d);
      path.setAttribute("stroke", `rgb(${c},${c},${c})`);
      path.setAttribute("stroke-width", lerp(fromWidth, toW, u).toFixed(2));
      veil.style.opacity = a;
      if (freezeAt == null && t < 2.15) requestAnimationFrame(frame); else done();
    };
    requestAnimationFrame(frame);
  });
  if (freezeAt != null) return { remove: () => { veil.remove(); svg.remove(); }, d: path.getAttribute("d") };
  location.href = url;
}
