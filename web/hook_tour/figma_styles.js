// Applies Krishna's Figma styles (styles.json, written by style_reader.py) on top of the hook's placeholders.
// Called once per step: colours, opacity and dashes are taken from that step; line widths are read at every step a layer
// appears in and grow smoothly between those steps' zoom levels. All pixel sizes scale with the frame (s).

const hexRGBA = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

export async function loadFigmaStyles(url) {
  try { const r = await fetch(url, { cache: "no-store" }); return r.ok ? await r.json() : null; } catch { return null; }
}

// the style for this step, or else the step at the nearest zoom
function pick(steps, n, zoomNow) {
  if (steps[n]) return steps[n];
  return Object.values(steps).sort((a, b) => Math.abs(a.zoom - zoomNow) - Math.abs(b.zoom - zoomNow))[0];
}
function widthExpr(steps, n, cur, s, dz) {
  const byZoom = {};
  for (const [k, v] of Object.entries(steps)) if (v.width != null) {
    const z = v.zoom.toFixed(3);
    if (!(z in byZoom) || k === n) byZoom[z] = v.width;   // steps sharing a camera: the current step's width wins
  }
  const stops = Object.entries(byZoom).map(([z, w]) => [+z + dz, w * s]).sort((a, b) => a[0] - b[0]);
  if (stops.length < 2) return cur.width * s;
  return ["interpolate", ["linear"], ["zoom"], ...stops.flat()];
}

const loadedPatterns = new Set();
export async function applyFigmaStyles(F, { map, step, s, dz, TICK, dots, base }) {
  if (!F) return;
  const n = String(step + 1), zoomNow = map.getZoom() - dz;
  for (const [id, entry] of Object.entries(F.layers || {})) {
    const cur = pick(entry.steps, n, zoomNow); if (!cur) continue;
    if (id === "wells_ticks") { if (cur.width) TICK.width = cur.width; if (cur.stroke) TICK.colour = cur.stroke; if (cur.stroke_opacity != null) TICK.opacity = cur.stroke_opacity; continue; }
    if (id === "wells_long_ticks") { continue; }   // the first (solid) part shares the tick width; the dashed part keeps its placeholder
    if (id.startsWith("labels_")) { continue; }    // labels: styled from the components sheet
    const L = map.getLayer(id); if (!L) continue;
    if (L.type === "line") {
      if (cur.stroke) map.setPaintProperty(id, "line-color", cur.stroke);
      if (cur.stroke_opacity != null) map.setPaintProperty(id, "line-opacity", cur.stroke_opacity);
      if (cur.width != null) map.setPaintProperty(id, "line-width", widthExpr(entry.steps, n, cur, s, dz));
      if (cur.dash && cur.width) map.setPaintProperty(id, "line-dasharray", cur.dash.map(d => d / cur.width));   // MapLibre dashes are in line widths
    } else if (L.type === "fill") {
      if (cur.fill_pattern_image && cur.fill_pattern_image !== "vector") {
        const name = "fig_" + id;
        if (!loadedPatterns.has(name)) { const img = await map.loadImage(base + cur.fill_pattern_image); map.addImage(name, img.data); loadedPatterns.add(name); }
        map.setPaintProperty(id, "fill-pattern", name);
      } else if (cur.fill && !L.paint?.["fill-pattern"] && !map.getPaintProperty(id, "fill-pattern")) {
        map.setPaintProperty(id, "fill-color", cur.fill);
        if (cur.fill_opacity != null) map.setPaintProperty(id, "fill-opacity", cur.fill_opacity);
      }
    } else if (L.type === "circle") {
      if (cur.fill) map.setPaintProperty(id, "circle-color", cur.fill);
      if (cur.radius) map.setPaintProperty(id, "circle-radius", cur.radius * s);
      if (cur.fill_opacity != null) map.setPaintProperty(id, "circle-opacity", cur.fill_opacity);
    }
  }
  // components: grain colours, panel, labels, hover box
  const C = F.components || {};
  if (C.swatch_grain_dot?.fill) dots.green = C.swatch_grain_dot.fill;
  if (C.swatch_overdraft_dot?.fill) dots.redColour = C.swatch_overdraft_dot.fill;
  const css = [];
  if (C.panel_bg?.fill) css.push(`--panel: ${hexRGBA(C.panel_bg.fill, C.panel_bg.fill_opacity ?? 1)};`);
  const text = (sel, c) => c && css.push(`} ${sel} { ${c.fill ? `color: ${hexRGBA(c.fill, c.fill_opacity ?? 1)};` : ""} ${c.font_family ? `font-family: ${c.font_family};` : ""}
     ${c.font_size ? `font-size: ${c.font_size}px;` : ""} ${c.font_weight ? `font-weight: ${c.font_weight};` : ""} ${c.font_style ? `font-style: ${c.font_style};` : ""}
     ${c.letter_spacing ? `letter-spacing: ${c.letter_spacing}px;` : ""}`);
  text("#count", C.panel_count); text("#title", C.panel_title); text("#yours", C.panel_your_text); text("#fact", C.panel_fact); text("#src", C.panel_source);
  text(".lbl", C.label_town); text(".lbl.pct", C.label_block_pct);
  if (C.hover_block_bg?.fill) css.push(`} .hov .maplibregl-popup-content { background: ${hexRGBA(C.hover_block_bg.fill, C.hover_block_bg.fill_opacity ?? 1)};`);
  let el = document.getElementById("figma-css");
  if (!el) { el = document.createElement("style"); el.id = "figma-css"; document.head.append(el); }
  el.textContent = `:root { ${css.join("\n")} }`;
  map.triggerRepaint();
}
