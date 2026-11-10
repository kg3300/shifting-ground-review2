// Exports the hook tour as editable SVGs for Krishna (loaded only with ?svg; see kit/hook_svg/README.md).
// For each step: hook_step<n>.svg, 1920x1080, with the base (satellite + exact grain) embedded as one image,
// and every drawn element in its own named group, carrying today's placeholder style at that step's zoom.
// Plus hook_components.svg: the text panel, hover boxes, markers, labels, buttons and swatches.
// Krishna restyles in Figma and exports back (with "Include id attribute" ticked); a reader script takes the styles from the group ids.

const W = 1920, H = 1080, PANEL = 576;
// drawn into the base image: ground, satellite and the live grain's hidden passes (live_grain.js)
const BASE_LAYERS = ["ground", "sat", "share_raster", "mask_fill"];
const r1 = v => Math.round(v * 10) / 10;
const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const strip = s => String(s ?? "").replace(/<[^>]+>/g, "");
const rad = d => d * Math.PI / 180;
function angDist(a, b) {   // great-circle distance in degrees
  const s = Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(s))) * 180 / Math.PI;
}
// the same horizons as the drawing kit: lines beyond them are on the far side of the globe
const HORIZON = { f1_globe_india: 89, f2_belt: 60, f3_punjab: 30, f4_blocks: 30 };

// evaluate the style expressions used in index.html (numbers, zoom interpolation, data interpolation)
function evaluate(v, zoom, props) {
  if (!Array.isArray(v)) return v;
  if (v[0] === "interpolate") {
    const input = v[2][0] === "zoom" ? zoom : v[2][0] === "get" ? props[v[2][1]] : NaN;
    const stops = v.slice(3);
    if (input <= stops[0]) return evaluate(stops[1], zoom, props);
    for (let i = 0; i < stops.length - 2; i += 2) {
      const [z0, a, z1, b] = [stops[i], evaluate(stops[i + 1], zoom, props), stops[i + 2], evaluate(stops[i + 3], zoom, props)];
      if (input <= z1) return a + (b - a) * (input - z0) / (z1 - z0);
    }
    return evaluate(stops[stops.length - 1], zoom, props);
  }
  return v;
}
function passes(filter, props) {
  if (!filter) return true;
  if (filter[0] === "!=") return props[filter[1][1]] !== filter[2];
  if (filter[0] === "==") return props[filter[1][1]] === filter[2];
  return true;
}

export async function exportAll(H_) {
  const { map, STEPS, MAPLAYERS, CITIES, DATA, LAYERS, jump, grain, post, wait } = H_;
  const style = map.getStyle();
  const srcData = {};
  const data = async id => { const d = style.sources[id].data;   // MapLibre hands back the loaded GeoJSON, or its URL
    return srcData[id] ||= typeof d === "string" ? await (await fetch(new URL(d, location.href))).json() : d; };

  for (let i = 0; i < STEPS.length; i++) {
    const S = STEPS[i];
    jump(i);
    const t0 = Date.now();
    do { await wait(800); } while ((!map.areTilesLoaded() || grain.op < 1) && Date.now() - t0 < 60000);
    // 1. the base: satellite + grain only
    const vis = style.layers.map(l => [l.id, map.getLayoutProperty(l.id, "visibility")]);
    for (const [id] of vis) if (!BASE_LAYERS.includes(id) && map.getLayer(id)?.type !== "custom") map.setLayoutProperty(id, "visibility", "none");
    const ticksEl = document.getElementById("ticks"); if (ticksEl) ticksEl.style.visibility = "hidden";
    document.querySelectorAll(".lbl").forEach(e => e.style.visibility = "hidden");
    await wait(600); await new Promise(r => { map.once("render", r); map.triggerRepaint(); });
    const base = map.getCanvas().toDataURL("image/jpeg", 0.88);
    for (const [id, v] of vis) map.setLayoutProperty(id, "visibility", v ?? "visible");
    document.querySelectorAll(".lbl").forEach(e => e.style.visibility = ""); if (ticksEl) ticksEl.style.visibility = "";
    await new Promise(r => { map.once("render", r); map.triggerRepaint(); });   // the well ticks are redrawn on each map frame
    await wait(300);

    // 2. the vector layers, in drawing order, each in its own group
    const zoom = map.getZoom(), centre = map.getCenter().toArray(), horizon = HORIZON[S.frame];
    const P = ll => map.project(ll);
    const path = (cs, close) => {
      let d = "", pen = false, last = "", allIn = true;
      for (const p of cs) {
        if (angDist(centre, p) > horizon) { pen = false; allIn = false; continue; }
        const q = P(p), k = r1(q.x) + "," + r1(q.y);
        if (k === last) continue; d += (pen ? "L" : "M") + k; pen = true; last = k;
      }
      return d && close && allIn ? d + "Z" : d;
    };
    const geomD = g => {
      const out = [];
      if (!g) return out;
      if (g.type === "LineString") out.push(path(g.coordinates, false));
      if (g.type === "MultiLineString") g.coordinates.forEach(l => out.push(path(l, false)));
      if (g.type === "Polygon") out.push(g.coordinates.map(r => path(r, true)).join(""));
      if (g.type === "MultiPolygon") g.coordinates.forEach(pg => out.push(pg.map(r => path(r, true)).join("")));
      return out.filter(Boolean);
    };
    const onScreen = q => q.x >= -60 && q.x <= W + 60 && q.y >= -60 && q.y <= H + 60;
    let groups = "";
    for (const L of style.layers) {
      if (map.getLayoutProperty(L.id, "visibility") === "none" || L.id.endsWith("_hit") || BASE_LAYERS.includes(L.id) || !L.source) continue;
      const gj = await data(L.source), p = L.paint || {};
      let body = "", attrs = "";
      if (L.type === "line") {
        const w = evaluate(p["line-width"], zoom, {});
        attrs = `fill="none" stroke="${p["line-color"]}" stroke-width="${r1(w)}" stroke-opacity="${evaluate(p["line-opacity"] ?? 1, zoom, {})}" stroke-linejoin="round" stroke-linecap="${p["line-dasharray"] ? "butt" : "round"}"`
              + (p["line-dasharray"] ? ` stroke-dasharray="${p["line-dasharray"].map(x => r1(x * w)).join(" ")}"` : "");
        for (const f of gj.features) if (passes(L.filter, f.properties)) for (const d of geomD(f.geometry)) body += `<path d="${d}"${f.properties.name ? ` data-name="${esc(f.properties.name)}"` : ""}/>`;
      } else if (L.type === "fill") {
        const pattern = p["fill-pattern"];
        attrs = pattern ? `fill="url(#hatch)" stroke="none"` : `fill="${p["fill-color"]}" stroke="none"`;
        for (const f of gj.features) {
          if (!passes(L.filter, f.properties)) continue;
          const op = pattern ? "" : ` fill-opacity="${r1(evaluate(p["fill-opacity"] ?? 1, zoom, f.properties) * 100) / 100}"`;
          const label = f.properties.block || f.properties.district || f.properties.name || "";
          for (const d of geomD(f.geometry)) body += `<path d="${d}"${op}${label ? ` data-name="${esc(label)}"` : ""}/>`;
        }
      } else if (L.type === "circle") {
        const rr = evaluate(p["circle-radius"], zoom, {});
        attrs = `fill="${p["circle-color"]}" fill-opacity="${p["circle-opacity"] ?? 1}" stroke="${p["circle-stroke-color"] || "none"}" stroke-width="${p["circle-stroke-width"] || 0}"`;
        for (const f of gj.features) { const q = P(f.geometry.coordinates); if (onScreen(q)) body += `<circle cx="${r1(q.x)}" cy="${r1(q.y)}" r="${r1(rr)}" data-name="${esc(f.properties.station_name || f.properties.name)}"/>`; }
      } else continue;
      if (body) groups += `<g id="${L.id}" ${attrs}>${body}</g>\n`;
    }
    // labels (in the page they are HTML; here, text)
    let labels = "";
    const lab = (txt, ll, cls) => { const q = P(ll); if (!onScreen(q)) return;
      labels += cls === "pct"
        ? `<text x="${r1(q.x)}" y="${r1(q.y)}" text-anchor="middle" font-weight="700">${esc(txt[0])}<tspan x="${r1(q.x)}" dy="15">${esc(txt[1])}</tspan></text>`
        : `<g><circle cx="${r1(q.x)}" cy="${r1(q.y)}" r="2.5" stroke="none"/><text x="${r1(q.x + 7)}" y="${r1(q.y + 4)}">${esc(txt)}</text></g>`; };
    const want = new Set(MAPLAYERS.base); S.on.forEach(k => MAPLAYERS[k].forEach(id => want.add(id)));
    const kind = S.labels || (want.has("cities") ? "cities" : null);
    if (kind === "cities") CITIES.forEach(([n, lo, la]) => lab(n, [lo, la]));
    if (kind === "towns") DATA.towns.features.forEach(f => lab(f.properties.name, f.geometry.coordinates));
    if (kind === "pct") DATA.blocks.features.forEach(f => lab([f.properties.block, Math.round(f.properties.stage_pct) + "%"], [f.properties.label_lon, f.properties.label_lat], "pct"));
    if (labels) groups += `<g id="labels_${kind}" fill="#fff" font-family="Arial, Helvetica, sans-serif" font-size="12">${labels}</g>\n`;
    const ticks = document.getElementById("ticks")?.innerHTML; if (ticks) groups += ticks + "\n";   // the well ticks, already in screen coordinates

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<!-- Hook step ${i + 1} of ${STEPS.length}: ${esc(S.title)}. Camera: ${S.frame}, map zoom ${zoom.toFixed(3)}. All styles are placeholders: restyle freely, keep the group ids. -->
<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0,8L8,0M-1,1L1,-1M7,9L9,7" stroke="#fff" stroke-opacity="0.7" stroke-width="1"/></pattern></defs>
<g id="base_DO_NOT_EDIT"><image width="${W}" height="${H}" xlink:href="${base}" href="${base}"/></g>
${groups}${panelSVG(S, i, STEPS.length, LAYERS)}
</svg>
`;
    await post(`hook_step${i + 1}.svg`, svg);
  }
  await post("hook_components.svg", componentsSVG(STEPS, LAYERS));
}

// ---------- the text panel, as laid out in the page ----------
function wrap(text, width, size) {   // rough line breaking for SVG text (about 0.5 em per character)
  const words = strip(text).split(/\s+/), lines = []; let cur = "";
  const max = Math.floor(width / (size * 0.5));
  for (const w of words) { if ((cur + " " + w).trim().length > max) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
  if (cur) lines.push(cur); return lines;
}
function textBlock(id, x, y, text, width, size, attrs) {
  const lines = wrap(text, width, size);
  return [`<text id="${id}" x="${x}" y="${y}" font-size="${size}" ${attrs}>${lines.map((l, k) => `<tspan x="${x}" dy="${k ? r1(size * 1.4) : 0}">${esc(l)}</tspan>`).join("")}</text>`, y + lines.length * size * 1.4];
}
function panelSVG(S, i, n, LAYERS) {
  const x = 28, w = PANEL - 56; let y = 46, out = "", t;
  const F = `font-family="Arial, Helvetica, sans-serif"`;
  out += `<rect id="panel_bg" width="${PANEL}" height="${H}" fill="#080a10" fill-opacity="0.82"/>`;
  out += `<text id="panel_count" x="${x}" y="${y}" font-size="11" letter-spacing="1.3" fill="#fff" fill-opacity="0.5" ${F}>STEP ${i + 1} OF ${n}</text>`; y += 40;
  [t, y] = textBlock("panel_title", x, y, S.title, w, 22, `font-weight="700" font-style="italic" fill="#fff" ${F}`); y += 10;
  out += t + `<rect id="panel_your_text_box" x="${x}" y="${y}" width="${w}" height="40" fill="none" stroke="#fff" stroke-opacity="0.2" stroke-dasharray="4 3"/>`
       + `<text id="panel_your_text" x="${x + 12}" y="${y + 25}" font-size="14" font-style="italic" fill="#fff" fill-opacity="0.5" ${F}>[Your text]</text>`; y += 70;
  if (S.fact) { [t, y] = textBlock("panel_fact", x, y, S.fact, w, 16, `fill="#fff" ${F}`); out += t; y += 6; }
  if (S.src) { [t, y] = textBlock("panel_source", x, y, "Source: " + S.src, w, 11, `fill="#fff" fill-opacity="0.5" ${F}`); out += t; y += 14; }
  const keys = S.on.filter(k => LAYERS[k].read);
  if (keys.length) {
    out += `<g id="panel_key" ${F}>`;
    for (const k of keys) { out += `<text x="${x}" y="${y}" font-size="10" font-weight="600" letter-spacing="0.8" fill="#fff">${esc(LAYERS[k].name.toUpperCase())}</text>`; y += 15;
      [t, y] = textBlock("key_" + k, x, y, LAYERS[k].read, w, 11, `fill="#fff" fill-opacity="0.75"`); out += t; y += 8; }
    out += `</g>`;
  }
  out += navSVG(i, n, x, H - 52);
  return `<g id="panel">${out}</g>`;
}
function navSVG(i, n, x, y) {
  let out = `<g id="panel_nav"><rect id="btn_prev" x="${x}" y="${y}" width="40" height="32" fill="none" stroke="#fff" stroke-opacity="0.2"/><text x="${x + 20}" y="${y + 21}" text-anchor="middle" font-size="16" fill="#fff">←</text>`;
  const cx0 = PANEL / 2 - (n - 1) * 8.5;
  for (let k = 0; k < n; k++) out += `<circle id="dot_${k + 1}${k === i ? "_current" : ""}" cx="${r1(cx0 + k * 17)}" cy="${y + 16}" r="4.5" fill="#fff" fill-opacity="${k === i ? 1 : 0.5}"/>`;
  return out + `<rect id="btn_next" x="${PANEL - 28 - 40}" y="${y}" width="40" height="32" fill="none" stroke="#fff" stroke-opacity="0.2"/><text x="${PANEL - 48}" y="${y + 21}" text-anchor="middle" font-size="16" fill="#fff">→</text></g>`;
}

// ---------- components sheet ----------
function hoverBox(id, x, y, lines) {   // [name, ...values, type, source]; values may be flagged {warn: text}
  const F = `font-family="Arial, Helvetica, sans-serif"`;
  const rows = lines.map(strip); const h = 14 + rows.length * 16;
  let out = `<g id="${id}"><rect id="${id}_bg" x="${x}" y="${y}" width="260" height="${h}" rx="3" fill="#080a10" fill-opacity="0.88"/>`;
  rows.forEach((r, k) => {
    const last = k === rows.length - 1, type = k === rows.length - 2, warn = /to verify/.test(r) && !last;
    out += `<text x="${x + 9}" y="${y + 20 + k * 16}" ${F} fill="${warn ? "#ffcf6b" : "#fff"}" fill-opacity="${k === 0 || warn ? 1 : last ? 0.5 : 0.75}"${k === 0 ? ` font-weight="700"` : ""}${type ? ` font-style="italic"` : ""} font-size="${last ? 10 : 11}">${esc(r.length > 46 ? r.slice(0, 45) + "…" : r)}</text>`;
  });
  return out + `</g>`;
}
function componentsSVG(STEPS, LAYERS) {
  const F = `font-family="Arial, Helvetica, sans-serif"`;
  const h = t => `<text x="0" y="-14" font-size="13" font-weight="700" fill="#fff" ${F}>${esc(t)}</text>`;
  const block = { block: "Barnala", district: "Barnala", stage_pct: 317.7, extraction_ham: 55867, extractable_ham: 17586, first_year: "2016–17", first_stage_pct: 255.1, category: "over-exploited" };
  const well = { station_name: "Badrukhan (m)", block: "Sangrur", last_depth_m: 38.98, last_date: "2021-01-09", slope_m_per_yr: 1.36, n: 7 };
  const wellL = { name: "Tappa", well_type: "Dug Well", well_depth_m: 28, block: "Sehna", first_year: 1988, last_year: 2023, n_years: 20, first_depth_m: 11.55, last_depth_m: 41.6, slope_m_per_yr: 0.84 };
  const hv = (k, p) => LAYERS[k].hover(p).filter(x => x !== null).map(strip);
  let ramp = "";
  for (let k = 0; k <= 30; k++) { const stage = 100 + k * 10; ramp += `<rect x="${k * 10}" y="0" width="10" height="24" fill="#e0261d" fill-opacity="${r1((0.2 + (0.75 - 0.2) * (stage - 100) / 300) * 100) / 100}"/>`; }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
<!-- Hook components: placeholders. Restyle freely; keep the ids. -->
<defs><pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0,8L8,0M-1,1L1,-1M7,9L9,7" stroke="#fff" stroke-opacity="0.7" stroke-width="1"/></pattern></defs>
<rect id="sheet_ground" width="1920" height="1080" fill="hsl(222, 56%, 4%)"/>
<g id="comp_panel" transform="translate(0,0)">${panelSVG(STEPS[4], 4, STEPS.length, LAYERS)}</g>
<g transform="translate(660,60)">${h("Hover boxes")}
  ${hoverBox("hover_block", 0, 0, hv("overdraft", block))}
  ${hoverBox("hover_well", 0, 170, hv("wells", well))}
  ${hoverBox("hover_well_long", 0, 300, hv("wellsLong", wellL))}</g>
<g transform="translate(1000,60)" ${F}>${h("Map markers")}
  <g id="marker_well_monitoring"><circle cx="10" cy="4" r="2.5" fill="#fff"/><line x1="10" y1="6.5" x2="10" y2="45" stroke="#fff" stroke-opacity="0.9" stroke-width="3"/><text x="26" y="20" font-size="12" fill="#fff">Monitoring well: tick = depth to water, 1 m = 1 px (38.5 m shown)</text></g>
  <g id="marker_well_long" transform="translate(0,60)"><circle cx="10" cy="4" r="3" fill="#fff"/><line x1="10" y1="7" x2="10" y2="16.2" stroke="#fff" stroke-opacity="0.9" stroke-width="3"/><line x1="10" y1="16.2" x2="10" y2="52.2" stroke="#fff" stroke-opacity="0.9" stroke-width="1.5" stroke-dasharray="4 3"/><text x="26" y="20" font-size="12" fill="#fff">Long-record well: solid to 1985 (9.2 m), dashed to 2023 (45.2 m)</text></g>
  <g id="label_town" transform="translate(0,40)"><circle cx="10" cy="90" r="2.5" fill="#fff"/><text x="17" y="94" font-size="12" fill="#fff">Dhuri</text></g>
  <g id="label_block_pct" transform="translate(0,40)"><text x="40" y="130" text-anchor="middle" font-size="12" font-weight="700" fill="#fff">Sunam<tspan x="40" dy="15">390%</tspan></text></g>
  <g id="swatch_hatch" transform="translate(0,40)"><rect x="0" y="180" width="120" height="60" fill="url(#hatch)" stroke="#fff" stroke-width="1.5"/><text x="130" y="214" font-size="12" fill="#fff">Hatch (belt, study area)</text></g>
  <g id="swatch_overdraft_dot" transform="translate(0,310)"><circle cx="2" cy="2" r="1.9" fill="#E00000"/><circle cx="6" cy="2" r="1.35" fill="#E00000"/><circle cx="10" cy="2" r="0.85" fill="#E00000"/><text x="20" y="6" font-size="11" fill="#fff">Overdraft dot (step 5): the same dot in red #E00000, inside the 11 blocks</text></g>
  <g id="swatch_grain_dot" transform="translate(0,340)"><circle cx="2" cy="2" r="1.9" fill="#3f8f45"/><circle cx="6" cy="2" r="1.35" fill="#3f8f45"/><circle cx="10" cy="2" r="0.85" fill="#3f8f45"/><text x="20" y="6" font-size="11" fill="#fff">Grain dot: 100%, 50%, 20% paddy (4 px pitch)</text></g>
</g>
<g transform="translate(1000,480)" ${F}>${h("Line ranking (widths at frame 4, map zoom 9.3)")}
  <g id="line_study_outline"><line x1="0" y1="10" x2="200" y2="10" stroke="#fff" stroke-width="5.25"/><text x="214" y="14" font-size="12" fill="#fff">Study area outline</text></g>
  <g id="line_state"><line x1="0" y1="40" x2="200" y2="40" stroke="#fff" stroke-opacity="0.75" stroke-width="6.61"/><text x="214" y="44" font-size="12" fill="#fff">State</text></g>
  <g id="line_district"><line x1="0" y1="70" x2="200" y2="70" stroke="#fff" stroke-opacity="0.6" stroke-width="3.3"/><text x="214" y="74" font-size="12" fill="#fff">District</text></g>
  <g id="line_block"><line x1="0" y1="100" x2="200" y2="100" stroke="#fff" stroke-opacity="0.5" stroke-width="2.11"/><text x="214" y="104" font-size="12" fill="#fff">Block</text></g>
  <g id="line_river"><line x1="0" y1="130" x2="200" y2="130" stroke="#1D4C65" stroke-opacity="0.5" stroke-width="19.35"/><text x="214" y="134" font-size="12" fill="#fff">River</text></g>
  <g id="line_canal"><line x1="0" y1="165" x2="200" y2="165" stroke="#1D4C65" stroke-opacity="0.5" stroke-width="19.35" stroke-dasharray="38.7 29"/><text x="214" y="169" font-size="12" fill="#fff">Canal</text></g>
  <g id="line_drain"><line x1="0" y1="200" x2="200" y2="200" stroke="#1D4C65" stroke-opacity="0.5" stroke-width="7.97" stroke-dasharray="8 12"/><text x="214" y="204" font-size="12" fill="#fff">Drain</text></g>
</g>
<g id="tool_buttons" transform="translate(1860,60)"><rect width="30" height="30" fill="#080a10" stroke="#fff" stroke-opacity="0.2"/><text x="15" y="20" text-anchor="middle" fill="#fff" font-size="15">⌂</text><rect y="36" width="30" height="30" fill="#080a10" stroke="#fff" stroke-opacity="0.2"/><text x="15" y="56" text-anchor="middle" fill="#fff" font-size="15">+</text><rect y="72" width="30" height="30" fill="#080a10" stroke="#fff" stroke-opacity="0.2"/><text x="15" y="92" text-anchor="middle" fill="#fff" font-size="15">−</text></g>
</svg>
`;
}
