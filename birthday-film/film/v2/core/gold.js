/*
  core/gold.js: the gold-leaf material of SPEC 4.3 applied to any alpha mask, drawn into an HDR target (the overlay
  pass, before bloom). Gold is never flat colour.

  Shading. A height field comes from the blurred mask (mip `lod`), its gradient gives the bevel normal (bump).
  The leaf reflects a soft overhead studio environment (bright where a bevel faces up, deep where it faces down),
  plus a GGX key light (and an optional fill), leaf crackle (Voronoi cell edges: rougher and slightly darker) and a
  fine beaten-leaf mottling. The result is a scalar radiance s that is mapped through a colour-managed ramp of the
  palette's gold-leaf stops (deep #6E4A12, base #B8862B, mid #D4A64A, orpiment #E3B341, light #E9C676, highlight
  #FFE7A3, white-hot #FFF4D6), inverted through the tonemap and grade of the scene's look so that the display shows
  the palette hexes (AgX would otherwise turn saturated gold into beige). s > 1 runs past white-hot into HDR, which
  is what the bloom catches on specular strikes.

  API
    GOLD_GLSL                    GLSL source (winter-gold ramp baked as constants) of
                                   vec3 goldLeaf(sampler2D mask, vec2 uv, vec2 duvDx, vec2 duvDy, vec2 fragPx,
                                                 vec3 keyPos, float keyI, vec3 fillPos, float fillI, float bump, float cov)
                                   vec3 goldLeafEx(..., float cov, float lod, vec4 sweep, float sweepY)
                                       lod: mip of the height field (bevel width ~ 2^lod px); sweep: x, width, I, slant
                                   float goldS(...) the scalar radiance; vec3 goldRamp(float s) the palette ramp
                                 for modules that shade their own masks (knots, borders, rosette). duvDx / duvDy are the uv
                                 steps for +1 frame px in x and in y (y down); keyPos.z is the light height (220 px default).
    GOLD_RAMPS                   {look: [[r,g,b] x 7]} scene-linear ramp stops per look (winter_gold, night_sea, photo)
    const gold = createGold(G)
    gold.draw(target, opts)      opts:
      mask        RT or Tex with mipmaps (alpha = coverage)
      rect        [x, y, w, h] frame px that the mask covers
      maskFlipY   true when the mask is a GL render target (bottom-up rows), e.g. from text.drawMask()
      textMask    true for text.drawMask() masks: coverage from r (with gild/reveal), bevel from a
      opacity     coverage multiplier (default 1)
      key         [x, y] frame px of the key light (default above-left of the rect), keyZ (default 220), keyI (default 4)
      fill        [x, y] and fillI (default 0): second light (scene 10 uses star B)
      bump        default 6;  lod (default 2; drawText picks it from the type size);  tint [r,g,b] (default 1)
      detail      0..1 leaf crackle, beaten texture and sharp speculars (default 1; drawText lowers it for small type)
      envI        environment multiplier (default 1);  look 'winter_gold' | 'night_sea' | 'photo' (ramp; default winter_gold).
                  Scenes graded with another look pass it (gold: {look: 'night_sea'}) so the leaf still displays the palette.
      sweep       null | {x, width, I, slant = 0.35, y}: a specular band centred at frame x (struck-metal strike)
      blend       'add' (default, as stage A) | 'premul' (opaque leaf over the background; drawText uses this)
    gold.drawText(target, text, entry, opts)   text.drawMask(entry) then draw; honours entry.gold, entry.sweeps,
                                 entry.glints, entry.gild (the leaf is laid left to right with a sweep riding the front
                                 and landing at the end) and entry.reveal; releases the mask; returns the layout
    gold.glint(target, {x, y, size = 28, I = 6, rot = 0, col})   a four-point star glint (additive HDR)
    gold.sweepAt(sweeps, tau, ink) -> {x, width, I, slant} | null    evaluates a sweeps list (exported for scenes)
*/
import { frag, HEADER_VS } from './glsl.js';
import { displayToScene, sceneToDisplay, DEFAULTS, LOOKS } from './post.js';

const STOPS = ['#6E4A12', '#B8862B', '#D4A64A', '#E3B341', '#E9C676', '#FFE7A3', '#FFF4D6'];
const STOP_S = [0.0, 0.26, 0.46, 0.60, 0.73, 0.87, 1.0];
function deepMerge(a, b) {
  const o = JSON.parse(JSON.stringify(a));
  (function m(d, s) { for (const k in s) { const v = s[k]; if (v && typeof v === 'object' && !Array.isArray(v) && d[k] && typeof d[k] === 'object') m(d[k], v); else d[k] = Array.isArray(v) ? v.slice() : v; } })(o, b || {});
  return o;
}
// palette hex -> scene-linear value that the look displays as that hex. Where a look cannot reach the hex (the night
// look's cool slope and lower saturation push the brightest warm stops out of gamut) the target is pulled toward its
// own luma step by step until the inversion round-trips, so the ramp stays monotonic and warm.
function invertStop(h, p) {
  const t = [0, 2, 4].map(i => parseInt(h.slice(1 + i, 3 + i), 16) / 255);
  const l = 0.2126 * t[0] + 0.7152 * t[1] + 0.0722 * t[2];
  for (let f = 0; f <= 0.81; f += 0.05) {
    const tt = t.map(v => v + (l - v) * f);
    const v = displayToScene(tt, p);
    const d = sceneToDisplay(v, p);
    if (Math.max(...d.map((x, i) => Math.abs(x - tt[i]))) < 0.012 && Math.max(...v) < 40) return v;
  }
  return displayToScene(h, DEFAULTS);
}
export const GOLD_RAMPS = {};
for (const look of ['winter_gold', 'night_sea', 'photo']) {
  const p = deepMerge(DEFAULTS, LOOKS[look]);
  GOLD_RAMPS[look] = STOPS.map(h => invertStop(h, p));
}
// white-hot: the exact inversion of #FFF4D6 is green-heavy in scene space (AgX desaturates it back to cream), which
// makes the bloom around a strike greenish; a warm scene value that displays as #FFF5D4 is used instead
GOLD_RAMPS.winter_gold[6] = [7.0, 5.6, 2.6];
// The brightest stops of the other looks are out of gamut (their inversion asks for huge red values that would flood
// the bloom and the red halation): above the light stop they reuse the winter-gold stops tinted by the per-channel
// ratio of the light stop (clamped), and no stop may be brighter than 1.25x the winter-gold one.
{
  const lum = v => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  const W = GOLD_RAMPS.winter_gold;
  for (const look in GOLD_RAMPS) {
    if (look === 'winter_gold') continue;
    const R = GOLD_RAMPS[look];
    const k = R[4].map((v, c) => Math.min(1.6, Math.max(0.7, v / Math.max(1e-4, W[4][c]))));
    for (let i = 5; i < R.length; i++) R[i] = W[i].map((v, c) => v * k[c]);
    GOLD_RAMPS[look] = R.map((v, i) => { const cap = 1.25 * lum(W[i]), l = lum(v); return l > cap ? v.map(x => x * cap / l) : v; });
  }
}
const f3 = v => `vec3(${v.map(x => x.toFixed(6)).join(', ')})`;

function shadingGLSL(rampDecl) {
  return `
${rampDecl}
// goldDetail (0..1, default 1): leaf crackle, beaten texture and sharp speculars; small type sets it lower
float goldDetail = 1.0;
vec3 goldRamp(float s){
  const float S1 = ${STOP_S[1].toFixed(3)}, S2 = ${STOP_S[2].toFixed(3)}, S3 = ${STOP_S[3].toFixed(3)}, S4 = ${STOP_S[4].toFixed(3)}, S5 = ${STOP_S[5].toFixed(3)};
  s = max(s, 0.0);
  vec3 c;
  if (s < S1) c = mix(GOLD_R0 * mix(0.45, 1.0, s / S1), GOLD_R1, pow(s / S1, 2.0));
  else if (s < S2) c = mix(GOLD_R1, GOLD_R2, (s - S1) / (S2 - S1));
  else if (s < S3) c = mix(GOLD_R2, GOLD_R3, (s - S2) / (S3 - S2));
  else if (s < S4) c = mix(GOLD_R3, GOLD_R4, (s - S3) / (S4 - S3));
  else if (s < S5) c = mix(GOLD_R4, GOLD_R5, (s - S4) / (S5 - S4));
  else if (s < 1.0) c = mix(GOLD_R5, GOLD_R6, (s - S5) / (1.0 - S5));
  else c = GOLD_R6 + GOLD_R5 * min(s - 1.0, 1.2) * 0.9;     // past white-hot: warm HDR energy for the bloom
  return c;
}
// Burnished-leaf environment and leaf texture shared with core/knot.js (which shades analytic ribbon normals).
// env: a studio sky above (bright where a bevel faces up), a deep floor below (#6E4A12 where it faces down) and a dark
// reflected horizon band just below the facing direction, which is what makes polished metal read as metal.
float goldEnv(vec3 N){
  float up = -N.y;
  float e = 0.50 + 0.66 * sign(up) * pow(abs(up), 0.75) - 0.07 * N.x;
  e *= 1.0 - 0.42 * exp(-pow((N.y - 0.16) / 0.11, 2.0));
  return max(e, 0.06);
}
// leaf tone: gold leaf is laid in overlapping squares (about 64 px here), each burnished a little differently, with a
// faint raised seam where two squares overlap; a fine crackle (Voronoi cell edges) runs through the thick leaf.
// Returns (tone multiplier, crack 0..1, seam 0..1).
vec3 goldLeafTex(vec2 fragPx, float thick){
  vec2 lp = rot2(0.035) * fragPx / 64.0;
  float row = floor(lp.y);
  lp.x += 0.5 * h11(row * 3.1 + 0.7);                        // squares offset row by row, as they are laid
  vec2 id = floor(lp), f = fract(lp);
  float hc = h12(id + 17.0);
  float tone = 0.90 + 0.17 * hc;                             // each square burnished to its own depth
  // overlap seam on the left and top edge of each square (the next square laps over it), slightly wavy
  float dEdge = min(f.x + 0.012 * sin(lp.y * 23.0 + hc * 6.0), f.y + 0.012 * sin(lp.x * 19.0 + hc * 4.0)) * 64.0;
  float seam = (1.0 - smoothstep(0.4, 1.6, dEdge)) * thick * goldDetail;
  float edge = voronoiEdge(fragPx / 15.0 + hc * 3.0);
  float crack = (1.0 - smoothstep(0.0, 0.045, edge)) * thick * goldDetail;
  // the crackle is fine and broken: only some cell walls have opened
  crack *= smoothstep(0.35, 0.65, vn(fragPx / 9.0 + 4.1));
  return vec3(mix(1.0, tone, thick * goldDetail), crack, seam);
}
float goldS(sampler2D mask, vec2 uv, vec2 duvDx, vec2 duvDy, vec2 fragPx, vec3 keyPos, float keyI, vec3 fillPos, float fillI,
            float bump, float lod, vec4 sweep, float sweepY){
  float st = exp2(lod) * 0.9;
  vec2 sx = duvDx * st, sy = duvDy * st;
  // central differences on the blurred mask, averaged over four sub-texel offsets: the bilinear mip is piecewise
  // linear, so a single difference gives flat facets one mip texel wide on a big display bevel
  float gx = 0.0, gy = 0.0;
  for (int k = 0; k < 4; k++){
    vec2 o = (vec2(k == 1 || k == 2 ? 0.5 : -0.5, k >= 2 ? 0.5 : -0.5) + vec2(0.13, -0.11)) * 0.5;
    vec2 c = uv + (duvDx * o.x + duvDy * o.y) * exp2(lod);
    gx += textureLod(mask, c + sx, lod).a - textureLod(mask, c - sx, lod).a;
    gy += textureLod(mask, c + sy, lod).a - textureLod(mask, c - sy, lod).a;
  }
  gx *= 0.25; gy *= 0.25;
  vec3 N = normalize(vec3(-vec2(gx, gy) * bump * 0.5, 1.0));      // frame coords, y down
  // thick parts of the leaf show the crackle, the squares and the beaten texture; hairlines stay clean
  float thick = smoothstep(0.45, 0.85, textureLod(mask, uv, lod + 0.5).a);
  vec3 lt = goldLeafTex(fragPx, thick);
  float crack = lt.y;
  // beaten leaf: a fine low-amplitude ripple in the normal (catches the key light as a broken sheen)
  vec2 bt = vec2(vn(fragPx * 0.30 + 1.3), vn(fragPx * 0.30 + 8.9)) - 0.5;
  N = normalize(N + vec3(bt * 0.05 * thick * goldDetail, 0.0));
  float mott = fbm(fragPx * 0.018 + 5.3, 3);
  float grain = vn(fragPx * 0.45) * thick * goldDetail;
  float rough = 0.20 + 0.22 * crack;
  float env = goldEnv(N);
  // the leaf is never perfectly flat: broad soft reflections of the room drift across it
  float broad = fbm(fragPx * 0.0065 + 2.1, 3);
  env = env * (0.64 + 0.72 * broad) * (0.93 + 0.14 * mott) * lt.x;
  // GGX key (and fill), scalar; plus a broad sheen lobe so the light reads across the whole word
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(vec3(keyPos.xy - fragPx, keyPos.z));
  float sharp = 0.12 * (0.35 + 0.65 * goldDetail);
  float spec = ggx(N, V, L, rough, vec3(1.0)).x * keyI * sharp + ggx(N, V, L, 0.70, vec3(1.0)).x * keyI * 0.09;
  if (fillI > 0.0){ vec3 L2 = normalize(vec3(fillPos.xy - fragPx, fillPos.z)); spec += ggx(N, V, L2, rough, vec3(1.0)).x * fillI * sharp + ggx(N, V, L2, 0.70, vec3(1.0)).x * fillI * 0.09; }
  spec *= mix(1.0, lt.x, 0.6);
  // speculars roll off past white-hot so small type never sparkles into noise; strikes (below) may go further
  float s = env * 0.84 + spec;
  s = s < 1.0 ? s : 1.0 + 0.35 * (1.0 - exp(-(s - 1.0) / 0.35));
  // struck-metal sweep: a slanted band of light that flashes the flat leaf and catches the bevels
  if (sweep.z > 0.0){
    float b = exp(-pow((fragPx.x - sweep.x + (fragPx.y - sweepY) * sweep.w) / max(sweep.y, 1.0), 2.0));
    float flat_ = smoothstep(0.75, 1.0, N.z);
    s += sweep.z * b * (0.35 + 0.65 * flat_) * (1.0 - 0.5 * crack) * lt.x;
  }
  // crackle: dark hairline fissures; seams: a faint raised lip (bright on the lit side, a hair of shadow under it)
  s *= (1.0 - 0.22 * crack) * (0.96 + 0.08 * grain);
  s *= 1.0 + 0.10 * lt.z * (s > 0.6 ? 1.0 : -0.8);
  return s;
}
vec3 goldLeafEx(sampler2D mask, vec2 uv, vec2 duvDx, vec2 duvDy, vec2 fragPx, vec3 keyPos, float keyI, vec3 fillPos, float fillI,
                float bump, float cov, float lod, vec4 sweep, float sweepY){
  return goldRamp(goldS(mask, uv, duvDx, duvDy, fragPx, keyPos, keyI, fillPos, fillI, bump, lod, sweep, sweepY)) * cov;
}
vec3 goldLeaf(sampler2D mask, vec2 uv, vec2 duvDx, vec2 duvDy, vec2 fragPx, vec3 keyPos, float keyI, vec3 fillPos, float fillI, float bump, float cov){
  return goldLeafEx(mask, uv, duvDx, duvDy, fragPx, keyPos, keyI, fillPos, fillI, bump, cov, 2.0, vec4(0.0), 0.0);
}`;
}

export const GOLD_GLSL = shadingGLSL(GOLD_RAMPS.winter_gold.map((v, i) => `const vec3 GOLD_R${i} = ${f3(v)};`).join('\n'));
const GOLD_GLSL_U = shadingGLSL(`uniform vec3 uRamp[7];\n` + [0, 1, 2, 3, 4, 5, 6].map(i => `#define GOLD_R${i} uRamp[${i}]`).join('\n'));

const VS = HEADER_VS + `
uniform vec4 uRect;
out vec2 vPx;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 px = uRect.xy + c * uRect.zw; vPx = px;
  gl_Position = clipOfPx(px);
}`;

const FS = frag(GOLD_GLSL_U + `
uniform sampler2D uMask; uniform vec4 uRect; uniform int uFlip, uTextMask;
uniform vec3 uKey, uFill; uniform float uKeyI, uFillI, uBump, uOpacity, uEnvI, uLod;
uniform vec3 uTint; uniform vec4 uSweep; uniform float uSweepY;   // sweep: x, width, intensity, slant
uniform float uDetail;
in vec2 vPx;
out vec4 o;
void main(){
  vec2 q = (vPx - uRect.xy) / uRect.zw;
  vec2 uv = uFlip == 1 ? vec2(q.x, 1.0 - q.y) : q;
  vec2 dx = vec2(1.0 / uRect.z, 0.0), dy = vec2(0.0, (uFlip == 1 ? -1.0 : 1.0) / uRect.w);
  goldDetail = uDetail;
  vec4 m = textureLod(uMask, uv, 0.0);
  float cov = (uTextMask == 1 ? m.r : m.a) * uOpacity;
  if (cov <= 0.0005){ o = vec4(0.0); return; }
  float s = goldS(uMask, uv, dx, dy, vPx, uKey, uKeyI, uFill, uFillI, uBump, uLod, uSweep, uSweepY);
  vec3 c = goldRamp(s * uEnvI) * uTint;
  o = vec4(c * cov, cov);
}`);

const FS_GLINT = frag(`
uniform vec4 uG;     // x, y, size, intensity
uniform float uRot; uniform vec3 uCol;
in vec2 vPx;
out vec4 o;
void main(){
  vec2 d = rot2(uRot) * (vPx - uG.xy);
  float s = uG.z;
  float r2 = dot(d, d);
  float core = exp(-r2 / (2.0 * pow(s * 0.05, 2.0)));
  float halo = exp(-sqrt(r2) / (s * 0.12)) * 0.25;
  float a1 = exp(-abs(d.y) / (s * 0.010)) * exp(-abs(d.x) / (s * 0.30));
  float a2 = exp(-abs(d.x) / (s * 0.010)) * exp(-abs(d.y) / (s * 0.30));
  vec2 e = rot2(0.785398) * d;
  float a3 = (exp(-abs(e.y) / (s * 0.008)) * exp(-abs(e.x) / (s * 0.12)) + exp(-abs(e.x) / (s * 0.008)) * exp(-abs(e.y) / (s * 0.12))) * 0.35;
  o = vec4(uCol * (core * 1.4 + halo + a1 + a2 + a3) * uG.w, 0.0);
}`);

const c01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const eInOutSine = x => -(Math.cos(Math.PI * x) - 1) / 2;

export function createGold(G) {
  const prog = G.program('gold.leaf2', FS, VS);
  const glintProg = G.program('gold.glint', FS_GLINT, VS);
  const gl = G.gl;
  const U = G.U;
  const api = { RAMPS: GOLD_RAMPS };
  api.draw = function (target, o) {
    const r = o.rect;
    const key = o.key || [r[0] + r[2] * 0.25, r[1] - r[3] * 0.8];
    const fill = o.fill || [r[0] + r[2] * 0.5, r[1] + r[3]];
    const sw = o.sweep ? [o.sweep.x, o.sweep.width || 80, o.sweep.I == null ? 6 : o.sweep.I, o.sweep.slant == null ? 0.35 : o.sweep.slant] : [0, 1, 0, 0];
    G.draw(prog, {
      uRect: r, uMask: o.mask, uFlip: o.maskFlipY ? 1 : 0, uTextMask: o.textMask ? 1 : 0,
      uKey: [key[0], key[1], o.keyZ || 220], uKeyI: o.keyI == null ? 4 : o.keyI,
      uFill: [fill[0], fill[1], o.fillZ || 220], uFillI: o.fillI || 0,
      uBump: o.bump == null ? 6 : o.bump, uOpacity: o.opacity == null ? 1 : o.opacity, uEnvI: o.envI == null ? 1 : o.envI,
      uLod: o.lod == null ? 2 : o.lod, uTint: o.tint || [1, 1, 1], uSweep: sw,
      uSweepY: o.sweep && o.sweep.y != null ? o.sweep.y : r[1] + r[3] * 0.5,
      uRamp: GOLD_RAMPS[o.look || 'winter_gold'] || GOLD_RAMPS.winter_gold, uDetail: o.detail == null ? 1 : o.detail,
    }, target, { blend: o.blend || 'add', mode: gl.TRIANGLE_STRIP, count: 4 });
  };
  api.glint = function (target, o) {
    const s = (o.size || 28) * U;
    G.draw(glintProg, { uRect: [o.x - s, o.y - s, 2 * s, 2 * s], uG: [o.x, o.y, s, o.I == null ? 6 : o.I], uRot: o.rot || 0, uCol: o.col || GOLD_RAMPS.winter_gold[6] },
      target, { blend: 'add', mode: gl.TRIANGLE_STRIP, count: 4 });
  };
  api.sweepAt = function (sweeps, tau, ink) {
    let best = null;
    for (const s of sweeps || []) {
      const dur = s.dur || 1.0, w = (s.width || 42) * U;
      const p = (tau - s.at) / dur;
      if (p < -0.05 || p > 1.05) continue;
      const a = (s.from == null ? ink[0] : s.from) - 2 * w, b = (s.to == null ? ink[1] : s.to) + 2 * w;
      const I = (s.I == null ? 0.8 : s.I) * Math.min(1, c01(p / 0.08), c01((1 - p) / 0.08));
      const cand = { x: a + (b - a) * eInOutSine(c01(p)), width: w, I, slant: s.slant == null ? 0.25 : s.slant };
      if (!best || cand.I > best.I) best = cand;
    }
    return best;
  };
  api.drawText = function (target, text, entry, o = {}) {
    const m = text.drawMask(entry);
    const lay = m.lay;
    if (m.lineOpacity > 0) {
      const ink = text.inkExtent(lay);
      const tau = entry.tau;
      let sweep = api.sweepAt(entry.sweeps, tau, ink);
      if (entry.gild && lay.anim.shown) {
        const gs = text.gildState(lay), g = entry.gild;
        const end = g.at + (g.dur || 1.2);
        const I = (g.sweep == null ? 0.8 : g.sweep) * (tau < end ? 0.5 + 0.5 * gs.p : Math.exp(-(tau - end) / 0.25));
        const gsw = { x: Math.min(gs.front - gs.feather * 0.6, gs.ix1), width: 46 * U, I, slant: gs.slant };
        if (I > 0.02 && (!sweep || gsw.I > sweep.I)) sweep = gsw;
      }
      if (sweep && sweep.y == null) sweep.y = lay.rows[0].y - lay.line.xh * 0.5;
      const size = lay.line.size;
      // bevel width ~ 2^lod px: display sizes keep a narrow, crisp struck bevel (a wide one reads as a soft pillow)
      const lod = Math.min(2.0, Math.max(0.5, Math.log2(size / 40)));
      const bump = size >= 160 * U ? 8.5 : 6;
      const look = (entry.gold && entry.gold.look) || o.look;
      api.draw(target, Object.assign({
        mask: m.rt, rect: m.rect, maskFlipY: true, textMask: true, lod, bump, blend: 'premul', detail: Math.min(1, Math.max(0, (size - 50 * U) / (60 * U))),
        key: [ink[0] + (ink[1] - ink[0]) * 0.2, lay.rows[0].y - size * 2.2], keyZ: size * 2.5 + 120 * U, keyI: 4,
      }, entry.gold || {}, o, { opacity: m.lineOpacity * (entry.gold && entry.gold.opacity != null ? entry.gold.opacity : 1), sweep, look }));
      for (const gp of entry.glints || []) {
        const dur = gp.dur || 0.22;
        const p = (tau - gp.at) / dur;
        if (p < 0 || p > 1) continue;
        let x = gp.x, y = gp.y;
        if (gp.glyph != null) {
          const L = lay.line, i = gp.glyph;
          const row = lay.rows.find(r => i >= r.i0 && i < r.i1) || lay.rows[0];
          x = row.ox + L.glyph[i * 4] + (L.glyph[i * 4 + 1] - L.glyph[i * 4]) * 0.62;
          y = row.y - L.xh * 1.05;
        }
        const env = Math.sin(Math.PI * Math.pow(p, 0.6));
        api.glint(target, { x, y, size: gp.size || 30, I: (gp.I == null ? 5 : gp.I) * env * m.lineOpacity, rot: gp.rot || 0.12 });
      }
    }
    text.releaseMask(m);
    return lay;
  };
  return api;
}
