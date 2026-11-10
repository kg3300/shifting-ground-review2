// Live, exact grain for the hook (Krishna, 8 Nov: "exact dots while moving").
// One dot every 4 screen px at every zoom, tilt and on the globe, so the grain never drifts or stretches.
//
// How it works, inside each frame MapLibre draws:
//   1. share_raster: the paddy share as data tiles (grey = share; web/tiles/render_share_tiles.py), drawn in true map projection;
//   2. cap_share:    copies that frame off the screen into a texture, then wipes the screen;
//   3. mask_fill:    the 11 blocks in white (for the red overdraft dots);
//   4. cap_mask:     copies that into a second texture, then wipes the screen;
//   5. the real map starts: ground, satellite;
//   6. cap_sat:      copies the satellite (for the grey globe cells);
//   7. live_dots:    for every 4 px cell on screen: the mean paddy share under it (16 samples) -> a dot of area = share;
//                    at globe scale, a 3 px grey square of the satellite under it instead (the cell mosaic).
// Nothing in steps 1-4 is ever seen: the screen is wiped before the visible map is drawn.

const VS = `attribute vec2 a; void main(){ gl_Position = vec4(a * 2.0 - 1.0, 0.0, 1.0); }`;
const FS = `precision highp float;
uniform sampler2D uShare, uMask, uSat;
uniform vec2 uRes; uniform float uP, uR, uMix, uRed, uOp;
uniform vec3 uGreen, uRedC;
void main() {
  vec2 fc = gl_FragCoord.xy;
  vec2 c = (floor(fc / uP) + 0.5) * uP;                    // centre of this 4 px cell
  float sh = 0.0;
  for (int i = 0; i < 4; i++) for (int j = 0; j < 4; j++)  // mean paddy share over the cell
    sh += texture2D(uShare, (c + (vec2(float(i), float(j)) - 1.5) * uP * 0.25) / uRes).r;
  sh /= 16.0;
  vec4 sat = vec4(0.0);
  for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++)  // mean satellite grey over the cell (alpha 0 = space beyond the globe)
    sat += texture2D(uSat, (c + (vec2(float(i), float(j)) - 0.5) * uP * 0.5) / uRes);
  sat /= 4.0;
  float inBlocks = step(0.5, texture2D(uMask, c / uRes).r);
  // dot: area proportional to share (radius = rmax * sqrt(share)), soft 1 px edge; none below 2% paddy, as in the stills
  float r = uR * sqrt(sh), d = length(fc - c);
  float dotA = clamp(r - d + 0.5, 0.0, 1.0) * step(0.02, sh);
  vec3 dotC = mix(uGreen, uRedC, uRed * inBlocks);
  // globe-scale cell: a square 3/4 of the pitch, grey = luminance of the satellite under it
  vec2 q = abs(fc - c); float hw = uP * 0.375;
  float cellA = clamp(hw - max(q.x, q.y) + 0.5, 0.0, 1.0) * step(0.99, sat.a);
  float lum = dot(sat.rgb, vec3(0.2126, 0.7152, 0.0722));
  vec4 cell = vec4(vec3(lum) * cellA, cellA), dot_ = vec4(dotC * dotA, dotA);
  gl_FragColor = mix(cell, dot_, uMix) * uOp;              // premultiplied
}`;
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255);

class Capture {
  constructor(id, wipe) { this.id = id; this.type = "custom"; this.renderingMode = "2d"; this.wipe = wipe; this.w = 0; this.h = 0; }
  onAdd(map, gl) { this.gl = gl; this.tex = gl.createTexture(); }
  render(gl) {
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex);
    if (w !== this.w || h !== this.h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]])
        gl.texParameteri(gl.TEXTURE_2D, k, v);
      this.w = w; this.h = h;
    }
    gl.copyTexSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 0, 0, w, h);
    if (this.wipe) { gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); }
  }
}

class Dots {
  constructor(o) { this.id = "live_dots"; this.type = "custom"; this.renderingMode = "2d"; Object.assign(this, o); this.op = 1; this.red = 0; }
  onAdd(map, gl) {
    this.map = map;
    const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(p);
    this.prog = p; this.U = n => gl.getUniformLocation(p, n);
    this.buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  }
  render(gl) {
    if (this.op <= 0.001) return;
    const dpr = gl.drawingBufferWidth / this.map.getCanvas().clientWidth, s = this.scale();
    const z = this.map.getZoom(), mix = Math.min(1, Math.max(0, z - (3.5 + this.dz())));   // cells -> dots between zoom 3.5 and 4.5
    gl.useProgram(this.prog); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const a = gl.getAttribLocation(this.prog, "a"); gl.enableVertexAttribArray(a); gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    [[this.share, 0, "uShare"], [this.mask, 1, "uMask"], [this.sat, 2, "uSat"]].forEach(([c, u, n]) => {
      gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, c.tex); gl.uniform1i(this.U(n), u); });
    gl.uniform2f(this.U("uRes"), gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.uniform1f(this.U("uP"), this.pitch * s * dpr); gl.uniform1f(this.U("uR"), this.rmax * s * dpr);
    gl.uniform1f(this.U("uMix"), mix); gl.uniform1f(this.U("uRed"), this.red); gl.uniform1f(this.U("uOp"), this.op);
    gl.uniform3fv(this.U("uGreen"), hex(this.green)); gl.uniform3fv(this.U("uRedC"), hex(this.redColour));
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.activeTexture(gl.TEXTURE0);
  }
}

// map: a loaded MapLibre map whose style has layers "ground" (background), "sat" (satellite) and `before` (first layer above the grain)
export function addLiveGrain(map, { before, blocksSource, shareTiles, green, redColour, rmax = 1.9, pitch = 4, scale, dz }) {
  const first = map.getStyle().layers[0].id;   // everything for the hidden passes goes underneath the visible map
  map.addSource("paddy_share", { type: "raster", tileSize: 256, minzoom: 4, maxzoom: 12, tiles: [shareTiles] });
  map.addLayer({ id: "share_raster", type: "raster", source: "paddy_share", paint: { "raster-fade-duration": 0, "raster-resampling": "linear" } }, first);
  const capShare = new Capture("cap_share", true), capMask = new Capture("cap_mask", true), capSat = new Capture("cap_sat", false);
  map.addLayer(capShare, first);
  // opacity just under 1: a fully opaque fill is drawn in MapLibre's early opaque pass, out of order, and would hide the share layer
  map.addLayer({ id: "mask_fill", type: "fill", source: blocksSource, paint: { "fill-color": "#fff", "fill-opacity": 0.999, "fill-antialias": false } }, first);
  map.addLayer(capMask, first);
  map.addLayer(capSat, before);
  const dots = new Dots({ share: capShare, mask: capMask, sat: capSat, green, redColour, rmax, pitch, scale, dz });
  map.addLayer(dots, before);
  return dots;
}
