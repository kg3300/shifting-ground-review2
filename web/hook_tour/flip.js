// Hook -> soil section (Krishna, 10 Nov): on the last slide, -> plays one move, about 4 s, then opens the section.
//   1. everything fades to white (the satellite, the grain outside, other lines, the text panel): 0-1.6 s;
//   2. INSIDE the Sangrur-Barnala outline the red blocks stay (the red dots and the white block lines, a snapshot of the map taken
//      at the press), and the outline stays, darkening from white to black as the background whitens;
//   3. outline and red turn together in 3D about a horizontal axis until edge-on, 1.0-3.4 s: the red flattens away with the plane,
//      leaving one line; meanwhile the line is carried to the section's ground line (section/geometry.js), west tip to its west end,
//      east tip to its east end. Perspective is strongest mid-turn and none at the end, so the line lands exactly.
//   4. the section opens with ?from=hook, starting from that same line, and builds itself (layers, wells, labels).
// The red snapshot is turned with a CSS 3D transform; the outline is drawn with the same maths in screen space, so its stroke
// stays visible when the plane is edge-on.
//   Also: the 15 section wells appear as dots at their places on the map, ride on the turning plane, and as it goes edge-on each
//   slides to the spot on the ground line where its well line drops in the section, so the icon ends on top of its line.
import { SECTION, frameToScreen, wellXs, WELL_ICON } from "../section/geometry.js";

const ease = t => t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
export const FLIP_TIMES = { fade: 1.6, flipStart: 1.0, flip: 2.4, hold: 0.25 };   // seconds; Krishna, 10 Nov: slower

// freezeAt (seconds, for checking only): draw that one moment, stay on the page, and return the overlay so it can be removed
export async function flipToSection(map, { url = "../section/index.html?from=hook", fromWidth = 3, freezeAt = null } = {}) {
  const T = FLIP_TIMES;
  const fc = await map.getSource("area").getData();
  const rings = [];
  for (const f of fc.features || [fc]) {
    const g = f.geometry;
    if (g.type === "Polygon") rings.push(g.coordinates[0]);
    if (g.type === "MultiPolygon") g.coordinates.forEach(p => rings.push(p[0]));
  }
  // the map as it is now, for the red inside the outline (read inside a render, while the WebGL buffer is valid)
  const snap = await new Promise(res => { map.once("render", () => { try { res(map.getCanvas().toDataURL("image/png")); } catch (e) { res(null); } }); map.triggerRepaint(); });

  const box = map.getContainer().getBoundingClientRect();
  const pts = rings.map(r => r.map(([lon, lat]) => { const p = map.project([lon, lat]); return { x: p.x + box.left, y: p.y + box.top }; }));
  // the section's wells: where they are on the map now, and where they stand on the section's ground line
  const lons = rings.flat().map(p => p[0]), W = Math.min(...lons), E = Math.max(...lons);
  let wells = [];
  try { wells = (await (await fetch("../section/wells_section.json")).json()).wells; } catch (e) {}
  const XS = wellXs(wells, W, E);
  const wpts = wells.map((w, i) => { const p = map.project([w.lon, w.lat]); return { x: p.x + box.left, y: p.y + box.top, X: XS[i] }; });
  const all = pts.flat(), minX = Math.min(...all.map(p => p.x)), maxX = Math.max(...all.map(p => p.x));
  const cx = (minX + maxX) / 2, cy = (Math.min(...all.map(p => p.y)) + Math.max(...all.map(p => p.y))) / 2;
  const F = frameToScreen(), X0s = F.x(SECTION.X0), X1s = F.x(SECTION.X1), ty = F.y(SECTION.G);
  const sx = (X1s - X0s) / (maxX - minX), txc = (X0s + X1s) / 2;
  const toW = SECTION.GROUND_W * F.s, D = Math.max(innerWidth, innerHeight) * 1.1;
  const ringPath = ring => ring.map((p, i) => (i ? "L" : "M") + p.x.toFixed(1) + " " + p.y.toFixed(1)).join(" ") + " Z";
  const NS = "http://www.w3.org/2000/svg";

  // layer 1: white veil over the page
  const veil = Object.assign(document.createElement("div"), { style: "position:fixed;inset:0;background:#fff;opacity:0;z-index:50;pointer-events:none" });
  // layer 2: the red, clipped to the outline, turned with CSS 3D (origin at the outline's centre)
  const red = document.createElementNS(NS, "svg");
  red.setAttribute("style", `position:fixed;left:0;top:0;width:100vw;height:100vh;z-index:51;pointer-events:none;transform-origin:${cx}px ${cy}px`);
  red.innerHTML = `<defs><clipPath id="flipClip"><path d="${pts.map(ringPath).join(" ")}"/></clipPath></defs>` +
    (snap ? `<image href="${snap}" x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" clip-path="url(#flipClip)" preserveAspectRatio="none"/>` : "");
  // layer 3: the outline, drawn per point with the same maths, so its stroke keeps its width when the plane is edge-on
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("style", "position:fixed;inset:0;width:100vw;height:100vh;z-index:52;pointer-events:none");
  const path = document.createElementNS(NS, "path");
  path.setAttribute("fill", "none"); path.setAttribute("stroke-linejoin", "round"); path.setAttribute("stroke-linecap", "round");
  svg.append(path);
  const dots = wpts.map(() => { const c = document.createElementNS(NS, "circle"); svg.append(c); return c; });
  document.body.append(veil, red, svg);

  const draw = t => {
    const a = ease(t / T.fade), u = ease((t - T.flipStart) / T.flip), th = u * Math.PI / 2;
    const De = D / Math.max(1e-4, Math.sin(Math.PI * u));         // perspective: none at rest and at landing, strongest mid-turn
    const TX = u * (txc - cx), TY = u * (ty - cy), S = lerp(1, sx, u);
    // the red: translate . scaleX . perspective . rotateX, about (cx, cy); same as the point maths below
    red.style.transform = `translate(${TX}px, ${TY}px) scaleX(${S}) perspective(${De}px) rotateX(${th}rad)`;
    const onPlane = p => { const dx = p.x - cx, dy = p.y - cy, k = De / (De - dy * Math.sin(th));   // top edge tips away, bottom toward
                           return [cx + TX + S * dx * k, cy + TY + dy * Math.cos(th) * k]; };
    path.setAttribute("d", pts.map(ring => ring.map((p, i) => { const [x, y] = onPlane(p); return (i ? "L" : "M") + x.toFixed(1) + " " + y.toFixed(1); })
      .join(" ") + " Z").join(" "));
    const c = Math.round(255 * (1 - a));
    // well icons: on the plane, plus a growing shift so each lands on its own spot on the ground line (the section nudges close wells)
    const wa = ease(t / 0.6);                                                                          // they appear in the first 0.6 s
    wpts.forEach((p, i) => {
      const [x, y] = onPlane(p), xEnd = txc + sx * (p.x - cx), shift = (F.x(p.X) - xEnd) * u;
      dots[i].setAttribute("cx", (x + shift).toFixed(1)); dots[i].setAttribute("cy", y.toFixed(1));
      // white with a dark rim while on the red; black with a white rim (the section's icon) over the last quarter of the turn
      const k = Math.round(255 * (1 - ease((u - 0.75) / 0.25))), rim = 255 - k;
      dots[i].setAttribute("r", (lerp(WELL_ICON.r * 1.3, WELL_ICON.r * F.s, u)).toFixed(2));
      dots[i].setAttribute("fill", `rgb(${k},${k},${k})`); dots[i].setAttribute("stroke", `rgb(${rim},${rim},${rim})`);
      dots[i].setAttribute("stroke-width", (WELL_ICON.stroke * lerp(1.3, F.s, u)).toFixed(2)); dots[i].setAttribute("opacity", wa);
    });
    path.setAttribute("stroke", `rgb(${c},${c},${c})`);
    path.setAttribute("stroke-width", lerp(fromWidth, toW, u).toFixed(2));
    veil.style.opacity = a;
  };
  if (freezeAt != null) { draw(freezeAt); return { remove: () => { veil.remove(); red.remove(); svg.remove(); }, d: path.getAttribute("d"),
                                                   wells: dots.map(d => [+d.getAttribute("cx"), +d.getAttribute("cy")]) }; }
  const end = T.flipStart + T.flip + T.hold, t0 = performance.now();
  await new Promise(done => { const frame = now => { const t = (now - t0) / 1000; draw(Math.min(t, end)); if (t < end) requestAnimationFrame(frame); else done(); }; requestAnimationFrame(frame); });
  location.href = url;
}
