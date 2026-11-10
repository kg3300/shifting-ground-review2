// Hook tuning panel (Krishna, 10 Nov): press T. For the slide you are on: every line layer (inside the belt and outside it)
// can be shown or hidden and given a weight, a pattern, a colour (white / black / grey only: colour is data) and an opacity;
// every place (capitals, Punjab district headquarters, belt towns) can be shown or hidden.
// Untouched settings keep the page's own design ("as designed"). Changes are saved in this browser (localStorage "hookTune");
// "Copy settings" puts them on the clipboard to send to Claude, who bakes them into hook_tune.json (loaded first, if present).

// the line layers, in two groups. id = MapLibre layer id
export const TUNE_LINES = [
  ["Inside the belt (Sangrur–Barnala)", [
    ["area_line", "Study-area outline"], ["district_line", "District lines (Sangrur, Barnala)"], ["block_line", "Block lines (11 blocks)"],
    ["canals", "Canals (OSM)"], ["drains", "Drains (OSM)"], ["rivers_osm", "Rivers and streams (OSM)"]]],
  ["Outside the belt", [
    ["districts_ph", "District lines, Punjab + Haryana"], ["state_lines", "State lines, India"], ["punjab_line", "Punjab outline"],
    ["belt_line", "Punjab + Haryana outline"], ["india_line", "India outline"], ["countries", "Country borders"],
    ["canals_main", "Main canals, Punjab and around"], ["drains_ph", "Drains, Punjab + Haryana (OSM)"], ["rivers_ne", "Rivers (Natural Earth)"]]],
];
const COLOURS = { white: "#ffffff", black: "#000000", grey: "#9a9a9a" };   // presets; any colour can also be picked (Krishna, 10 Nov)
const colourOf = (col, fallback) => col === "as" ? fallback : (COLOURS[col] || col);
const hexOf = col => col && col.startsWith && col.startsWith("#") ? col : (COLOURS[col] || "#ffffff");
// the hatched areas: Punjab + Haryana (slide 2) and the study area (slide 3)
export const TUNE_HATCHES = [["belt_hatch", "Hatch: Punjab + Haryana"], ["area_hatch_f3", "Hatch: Sangrur–Barnala study area"]];
const HATCH_DEF = { sp: 8, w: 1, dir: "/", col: "#ffffff", op: 0.7 };      // the page's own hatch: white diagonals 8 px apart, 70%
function hatchImage(c, dpr) {   // one tile of the pattern, drawn at device resolution so it stays crisp
  const n = Math.max(2, Math.round(c.sp * dpr)), cv = document.createElement("canvas"); cv.width = cv.height = n;
  const g = cv.getContext("2d"); g.strokeStyle = c.col; g.lineWidth = c.w * dpr; g.lineCap = "square"; g.beginPath();
  const diag = flip => { const L = (x1, y1, x2, y2) => { g.moveTo(flip ? n - x1 : x1, y1); g.lineTo(flip ? n - x2 : x2, y2); };
    L(0, n, n, 0); L(-n, n, n, -n); L(0, 2 * n, 2 * n, 0); };   // the main diagonal plus its neighbours, so the tile repeats seamlessly
  if (c.dir === "/" || c.dir === "x") diag(false);
  if (c.dir === "\\" || c.dir === "x") diag(true);
  if (c.dir === "-" || c.dir === "+") { g.moveTo(0, n / 2); g.lineTo(n, n / 2); }
  if (c.dir === "|" || c.dir === "+") { g.moveTo(n / 2, 0); g.lineTo(n / 2, n); }
  g.stroke();
  return g.getImageData(0, 0, n, n);
}
const PATTERNS = { dash: [4, 3], dot: [0.1, 2.2] };          // in line widths (MapLibre's unit for dashes)
// Mask outside Punjab (Krishna, 10 Nov): one fill over the whole world with Punjab's outline cut out of it, drawn above
// everything (satellite, paddy grain, lines, hatches), so what lies inside Punjab stands out. Layer settings are untouched.
// Black at opacity a = everything outside at (1 - a) against the dark background. The Punjab outline is kept above the mask.
const MASK_DEF = { on: false, op: 0.6, col: "#000000" };
const signedArea = r => r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + (p[0] * q[1] - q[0] * p[1]); }, 0) / 2;

export function initTune({ map, steps, getStep, defaultOn, defaultHatch, places, defaultPlaces, scale }) {
  const KEY = "hookTune";
  const EMPTY = () => ({ lines: {}, places: {}, hatches: {}, mask: {} });
  let saved = EMPTY();
  try { saved = Object.assign(saved, JSON.parse(localStorage.getItem(KEY) || "{}")); } catch (e) {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch (e) {} };
  const ids = TUNE_LINES.flatMap(g => g[1].map(x => x[0]));

  // the page's own design for each line, captured once, so "as designed" can be restored
  const orig = {};
  for (const id of ids) {
    if (!map.getLayer(id)) continue;
    orig[id] = { color: map.getPaintProperty(id, "line-color"), width: map.getPaintProperty(id, "line-width"),
                 opacity: map.getPaintProperty(id, "line-opacity"), dash: map.getPaintProperty(id, "line-dasharray"),
                 cap: map.getLayoutProperty(id, "line-cap") };
  }
  const lineCfg = (id, st) => ({ on: defaultOn(id, st), w: null, pat: "as", col: "as", op: null, ...((saved.lines[id] || {})[st] || {}) });
  const placeOn = (name, st) => { const v = (saved.places[name] || {})[st]; return v === undefined ? defaultPlaces(name, st) : v; };

  // ---------- applying a slide's settings to the map ----------
  function applyLines(st) {
    for (const id of ids) {
      if (!map.getLayer(id)) continue;
      const c = lineCfg(id, st), o = orig[id];
      map.setLayoutProperty(id, "visibility", c.on ? "visible" : "none");
      map.setPaintProperty(id, "line-color", colourOf(c.col, o.color));
      map.setPaintProperty(id, "line-opacity", c.op == null ? o.opacity : c.op);
      map.setPaintProperty(id, "line-width", c.w == null ? o.width : c.w * scale());
      if (c.pat === "as") { map.setPaintProperty(id, "line-dasharray", o.dash ?? null); map.setLayoutProperty(id, "line-cap", o.cap || "round"); }
      else if (c.pat === "solid") { map.setPaintProperty(id, "line-dasharray", null); map.setLayoutProperty(id, "line-cap", "round"); }
      else { map.setPaintProperty(id, "line-dasharray", PATTERNS[c.pat]); map.setLayoutProperty(id, "line-cap", c.pat === "dot" ? "round" : "butt"); }
    }
  }
  const markers = places.features.map(f => {
    const e = document.createElement("div");
    e.className = "lbl place-" + f.properties.kind; e.textContent = f.properties.name; e.style.display = "none";
    const m = new maplibregl.Marker({ element: e, anchor: "left" }).setLngLat(f.geometry.coordinates).addTo(map);
    return { name: f.properties.name, kind: f.properties.kind, el: e, m };
  });
  function applyPlaces(st) { for (const p of markers) p.el.style.display = placeOn(p.name, st) ? "" : "none"; }
  const hatchCfg = (id, st) => ({ on: defaultHatch(id, st), ...HATCH_DEF, ...((saved.hatches[id] || {})[st] || {}) });
  function applyHatches(st) {
    const dpr = devicePixelRatio || 1;
    for (const [id] of TUNE_HATCHES) {
      if (!map.getLayer(id)) continue;
      const c = hatchCfg(id, st), name = `${id}|${c.sp}|${c.w}|${c.dir}|${c.col}|${dpr}`;
      map.setLayoutProperty(id, "visibility", c.on ? "visible" : "none");
      if (!map.hasImage(name)) map.addImage(name, hatchImage(c, dpr), { pixelRatio: dpr });
      map.setPaintProperty(id, "fill-pattern", name);
      map.setPaintProperty(id, "fill-opacity", c.op);
    }
  }
  const maskCfg = st => ({ ...MASK_DEF, ...((saved.mask.punjab || {})[st] || {}) });
  let maskReady = null;
  function ensureMask() {           // built once, from the page's own Punjab outline (kit/data/punjab.geojson)
    return maskReady ||= (async () => {
      const fc = await map.getSource("punjab").getData();
      const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];          // counter-clockwise
      const holes = [];
      for (const f of fc.features || [fc]) {
        const g = f.geometry, polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
        for (const p of polys) { const r = p[0].slice(); if (signedArea(r) > 0) r.reverse(); holes.push(r); }   // holes run clockwise
      }
      map.addSource("punjab_mask", { type: "geojson", data: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, ...holes] } } });
      map.addLayer({ id: "punjab_mask", type: "fill", source: "punjab_mask", layout: { visibility: "none" }, paint: { "fill-color": "#000", "fill-opacity": 0 } });
      if (map.getLayer("punjab_line")) map.moveLayer("punjab_line");                         // outline above the mask
    })();
  }
  function applyMask(st) {
    ensureMask().then(() => {
      const c = maskCfg(st);
      map.setLayoutProperty("punjab_mask", "visibility", c.on ? "visible" : "none");
      map.setPaintProperty("punjab_mask", "fill-color", c.col);
      map.setPaintProperty("punjab_mask", "fill-opacity", c.op);
    }).catch(e => console.warn("mask:", e));
  }
  function apply(st = getStep()) { applyLines(st); applyHatches(st); applyPlaces(st); applyMask(st); }

  // ---------- the panel ----------
  const panel = document.createElement("div");
  panel.id = "tune";
  document.body.append(panel);
  const css = document.createElement("style");
  css.textContent = `
    #tune { position:absolute; right:50px; top:10px; width:360px; max-height:calc(100vh - 20px); overflow-y:auto; z-index:6; display:none;
            background:rgba(8,10,16,.94); color:#fff; border:1px solid rgba(255,255,255,.3); padding:10px 12px; font:12px/1.35 Arial, sans-serif; box-sizing:border-box; }
    #tune.on { display:block; }
    #tune h3 { margin:12px 0 6px; font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:#ffcf6b; }
    #tune .slide { font-weight:700; font-size:13px; }
    #tune .row { border-top:1px solid rgba(255,255,255,.12); padding:6px 0; }
    #tune .row label.nm { display:flex; gap:6px; align-items:center; cursor:pointer; }
    #tune .ctl { display:grid; grid-template-columns: 1fr 1fr; gap:4px 8px; margin:5px 0 0 20px; }
    #tune .ctl.off { opacity:.35; pointer-events:none; }
    #tune select, #tune input[type=range] { width:100%; font:inherit; }
    #tune .ctl span { color:rgba(255,255,255,.6); font-size:11px; }
    #tune .places { columns:2; column-gap:12px; }
    #tune .places label { display:block; break-inside:avoid; cursor:pointer; }
    #tune .kind { color:rgba(255,255,255,.6); margin:8px 0 2px; font-size:11px; }
    #tune button { font:inherit; background:none; color:#fff; border:1px solid rgba(255,255,255,.35); padding:3px 8px; margin:4px 4px 0 0; cursor:pointer; }
    #tune .note { color:rgba(255,255,255,.55); font-size:11px; margin-top:6px; }`;
  document.head.append(css);

  const set = (bucket, key, st, patch) => { saved[bucket][key] = saved[bucket][key] || {}; saved[bucket][key][st] = { ...(saved[bucket][key][st] || {}), ...patch }; save(); };
  function build() {
    const st = getStep();
    let h = `<div class="slide">Slide ${st + 1}: ${steps[st].title}</div><div class="note">Settings for this slide only. T hides the panel; ← → change slide.</div>`;
    for (const [group, list] of TUNE_LINES) {
      h += `<h3>${group}</h3>`;
      for (const [id, name] of list) {
        if (!map.getLayer(id)) continue;
        const c = lineCfg(id, st);
        h += `<div class="row" data-id="${id}"><label class="nm"><input type="checkbox" data-k="on" ${c.on ? "checked" : ""}>${name}</label>
          <div class="ctl ${c.on ? "" : "off"}">
            <span>Weight ${c.w == null ? "(as designed)" : c.w + " px"}</span><span>Opacity ${c.op == null ? "(as designed)" : c.op}</span>
            <input type="range" data-k="w" min="0.25" max="8" step="0.25" value="${c.w ?? 1}"><input type="range" data-k="op" min="0" max="1" step="0.05" value="${c.op ?? 1}">
            <select data-k="pat">${[["as", "pattern as designed"], ["solid", "solid"], ["dash", "dashed"], ["dot", "dotted"]].map(([v, t]) => `<option value="${v}" ${c.pat === v ? "selected" : ""}>${t}</option>`).join("")}</select>
            <select data-k="col">${[["as", "colour as designed"], ["white", "white"], ["black", "black"], ["grey", "grey"], ["custom", "custom (pick →)"]].map(([v, t]) => `<option value="${v}" ${(c.col === v || (v === "custom" && c.col.startsWith("#"))) ? "selected" : ""}>${t}</option>`).join("")}</select>
            <span>Colour</span><input type="color" data-k="hex" value="${hexOf(c.col === "as" ? (typeof orig[id].color === "string" ? orig[id].color : "#ffffff") : c.col)}">
          </div></div>`;
      }
    }
    h += `<h3>Hatches</h3>`;
    for (const [id, name] of TUNE_HATCHES) {
      if (!map.getLayer(id)) continue;
      const c = hatchCfg(id, st);
      h += `<div class="row" data-hatch="${id}"><label class="nm"><input type="checkbox" data-k="on" ${c.on ? "checked" : ""}>${name}</label>
        <div class="ctl ${c.on ? "" : "off"}">
          <span>Spacing ${c.sp} px</span><span>Line weight ${c.w} px</span>
          <input type="range" data-k="sp" min="3" max="30" step="1" value="${c.sp}"><input type="range" data-k="w" min="0.25" max="5" step="0.25" value="${c.w}">
          <span>Opacity ${c.op}</span><span>Direction</span>
          <input type="range" data-k="op" min="0" max="1" step="0.05" value="${c.op}">
          <select data-k="dir">${[["/", "diagonal /"], ["\\", "diagonal \\"], ["x", "cross-hatch ×"], ["-", "horizontal"], ["|", "vertical"], ["+", "grid +"]].map(([v, t]) => `<option value="${v}" ${c.dir === v ? "selected" : ""}>${t}</option>`).join("")}</select>
          <span>Colour</span><input type="color" data-k="col" value="${c.col}">
        </div></div>`;
    }
    const mk = maskCfg(st);
    h += `<h3>Mask outside Punjab</h3><div class="row" data-mask="punjab"><label class="nm"><input type="checkbox" data-k="on" ${mk.on ? "checked" : ""}>Dim everything outside Punjab's outline</label>
      <div class="ctl ${mk.on ? "" : "off"}">
        <span>Opacity ${mk.op}</span><span>Colour</span>
        <input type="range" data-k="op" min="0" max="1" step="0.05" value="${mk.op}"><input type="color" data-k="col" value="${mk.col}">
      </div></div>`;
    h += `<h3>Places</h3>`;
    for (const [kind, label] of [["capital", "Capitals and big cities"], ["hq", "Punjab district headquarters"], ["belt", "Belt towns"]]) {
      h += `<div class="kind">${label} <button data-all="${kind}">all</button><button data-none="${kind}">none</button></div><div class="places">`;
      for (const p of markers.filter(p => p.kind === kind)) h += `<label><input type="checkbox" data-place="${p.name}" ${placeOn(p.name, st) ? "checked" : ""}> ${p.name}</label>`;
      h += `</div>`;
    }
    h += `<h3>Save</h3><button id="tuneCopy">Copy settings</button><button id="tuneResetSlide">Reset this slide</button><button id="tuneResetAll">Reset all slides</button>
      <div class="note">Your changes stay in this browser. Copy settings and paste them to Claude to make them the page's defaults.</div>
      <div class="note">District lines: geoBoundaries 2021, which predates Malerkotla and Charkhi Dadri. Drains: OpenStreetMap (volunteer-mapped, coverage uneven).</div>`;
    panel.innerHTML = h;
  }
  panel.addEventListener("input", e => {
    const row = e.target.closest(".row"), st = getStep();
    if (row && row.dataset.mask) {                      // the mask
      const k = e.target.dataset.k, v = k === "on" ? e.target.checked : k === "op" ? +e.target.value : e.target.value;
      set("mask", row.dataset.mask, st, { [k]: v });
      applyMask(st);
      if (k === "op") row.querySelectorAll(".ctl span")[0].textContent = `Opacity ${v}`;
      return;
    }
    if (row && row.dataset.hatch) {                     // a hatch control
      const k = e.target.dataset.k, v = e.target.type === "checkbox" ? e.target.checked : ["sp", "w", "op"].includes(k) ? +e.target.value : e.target.value;
      set("hatches", row.dataset.hatch, st, { [k]: v });
      applyHatches(st);
      const lab = { sp: [0, `Spacing ${v} px`], w: [1, `Line weight ${v} px`], op: [2, `Opacity ${v}`] }[k];
      if (lab) row.querySelectorAll(".ctl span")[lab[0]].textContent = lab[1];
      return;
    }
    if (row) {
      let k = e.target.dataset.k, v = e.target.type === "checkbox" ? e.target.checked : (k === "w" || k === "op") ? +e.target.value : e.target.value;
      if (k === "hex") { k = "col"; row.querySelector("select[data-k=col]").value = "custom"; }          // picking a colour = custom
      if (k === "col" && v === "custom") v = row.querySelector("input[data-k=hex]").value;
      set("lines", row.dataset.id, st, { [k]: v });
      applyLines(st);
      if (k === "col") return;
      if (k === "on") build();
      else if (k === "w" || k === "op") row.querySelectorAll(".ctl span")[k === "w" ? 0 : 1].textContent = k === "w" ? `Weight ${v} px` : `Opacity ${v}`;
      return;
    }
    if (e.target.dataset.place) { set("places", e.target.dataset.place, st, undefined); saved.places[e.target.dataset.place][st] = e.target.checked; save(); applyPlaces(st); }
  });
  panel.addEventListener("change", e => { if (e.target.dataset.k === "on" || (e.target.tagName === "SELECT" && e.target.dataset.k !== "col")) build(); });
  panel.addEventListener("click", e => {
    const st = getStep(), kAll = e.target.dataset.all, kNone = e.target.dataset.none;
    if (kAll || kNone) { for (const p of markers.filter(p => p.kind === (kAll || kNone))) { saved.places[p.name] = saved.places[p.name] || {}; saved.places[p.name][st] = !!kAll; }
      save(); applyPlaces(st); build(); }
    if (e.target.id === "tuneCopy") navigator.clipboard.writeText(JSON.stringify(saved)).then(() => { e.target.textContent = "Copied"; }, () => { e.target.textContent = "Copy failed: see console"; console.log(JSON.stringify(saved)); });
    if (e.target.id === "tuneResetSlide") { for (const b of ["lines", "places", "hatches", "mask"]) for (const k in saved[b]) delete saved[b][k][st]; save(); apply(st); build(); }
    if (e.target.id === "tuneResetAll" && confirm("Reset every slide to the page's own design?")) { saved = EMPTY(); save(); apply(st); build(); }
  });
  const toggle = () => { panel.classList.toggle("on"); if (panel.classList.contains("on")) build(); };
  return { apply, toggle, refresh: () => { if (panel.classList.contains("on")) build(); }, load: s => { saved = Object.assign(EMPTY(), s); save(); apply(); } };
}
