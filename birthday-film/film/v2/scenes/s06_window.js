/*
  Scene 6: window (63.0-73.0), package P7. A hero scene.
  The last light of scene 5 (its orb, arriving at the bottom centre of the border) splits into two pen tips that draw a
  gilded braid border both ways round the photograph's plate and meet at the top centre at 67.5 (cue 'border_meet') with
  a soft spark. The plate is a lit window seen from the winter dark, snow falling in front of it (never across the
  faces, sparse over the plate): the glass mists over from where the light landed as the pens draw away (64.6-66.3, a
  soft fbm-broken front; amber lamplight from inside, frost crystals bright toward the edges), then 98,304 gold grains
  leave the pen tips and forge the photograph as a gold engraving, faces first; the frost clears from between the faces
  like breath on glass (66.0-69.0: round the faces by about 66.8, a frosted margin left at the border meet, three
  droplets run down); colour blooms from both faces at once (69.0-71.6); the four wall portraits catch a glint each
  (71.0-71.6, cues 'portrait1'..'portrait4'); 71.5-72.65 the camera passes through the glass: photo and border zoom
  about one fixed point (the border, nearer the lens, a little faster) and the border leaves on a radial blur
  (71.75-72.25) before any gap opens round the photo, the snow streaks past the lens and is gone by 72.8, and the photo
  lands exactly on scene 7's first crop and holds there until the cut at 73.0 (invisible). Portrait: the border dissolves
  as the push begins (71.5-71.8), before its roundels can reach the frame's sides, while the photo's edges soften into
  scene 7's warm mist; the photo stays centred until its sides have left the frame, then glides to scene 7's crop.
  The pens' glints run with a weak anamorphic streak (64.5-67.2); the default streak is back for the meet spark.
  Transition in: kind 'over' (63.0-64.5); this scene's surround is premultiplied over scene 5 and it takes over the orb.
  Lines: L8a at 66.0 and L8b at 69.0 laid out once as one line in landscape (no reflow), two centred rows in portrait;
  L9 from 72.0 (same entry, softened and darkened band as scene 7).

  Exported (used by scenes 8 and 13 of the same package):
    windowLayout(ctx) -> {plateC, plateW, s0 (scale of the plate against the 1000 px layout), textY, textSize}
    bandAround(ctx, photoRect, opts) -> band options for knot.band.rect: the scene-6 border (54 px band, 26 px clear of
        the photo, spiral roundels) scaled to frame `photoRect` (any size), through knot's xform so that every part of
        the knotwork (keyline, fillets, roundels, leaf texture) scales with it.
    createBackdrop(ctx) -> draw(target, {inner, outer, center, radius, alpha, fibre, spill: {rect, color, I, width}})
    createSnow(ctx) -> draw(target, {t, I, minLayer, maxLayer, plate: [cx, cy, hw, hh], warm, focus, zoom, zoomV, fade, look,
        near (0..1, the near bokeh layer), plateThin (0.6: share of flakes dropped over the plate), faces (ellipses the
        flakes never cross, frame px [cx, cy, rx, ry] x 2)})
*/
import s05 from './s05_dark_end.js';
import { cam7, fullRect, l9Entry, createMist, createSoften } from './s07_beside_you.js';
import { drawCaptionBands } from './s04_two_shores.js';

const T0 = 63.0;

export function windowLayout(ctx) {
  // landscape: the full 4:3 photograph at 1000x750 centred at (960, 500). Portrait: the same composition at 0.82 so the
  // border and its roundels keep about 80 px margins on the 1080 px width, placed so that the border's bottom centre
  // (centreline 428 layout px below the plate centre) is where scene 5's orb lands (y 1248); the two lines are stacked
  // below it (textY2) instead of sharing one row.
  if (ctx.portrait) return { plateC: [540, 1248 - 428 * 0.82], plateW: 820, s0: 0.82, textY: 1394, textY2: 1477, textSize: 56 };
  return { plateC: [960, 500], plateW: 1000, s0: 1, textY: 1010, textY2: null, textSize: 46 };
}
export function bandAround(ctx, r, o = {}) {
  const s = r[2] / 1000;                                   // the border is authored for a 1000 x 750 photo
  const c = [r[0] + r[2] / 2, r[1] + r[3] / 2];
  const bw = 1000 + 2 * 53, bh = 750 + 2 * 53;             // band centreline: 26 px gap + half of the 54 px band
  return Object.assign({ rect: [c[0] - bw / 2, c[1] - bh / 2, bw, bh], xform: { center: c, scale: s }, look: 'photo' }, o);
}

// ------------------------------------------------------------------ backdrop: night or vellum ground, warm window spill
const BG_FS = `
uniform vec3 uIn, uOut, uSpillC; uniform vec2 uCtr; uniform float uR, uA, uFibre, uSpillI, uSpillW; uniform vec4 uSpill;
out vec4 o;
void main(){
  vec2 p = framePx();
  float d = length((p - uCtr) / uFrame.y) / uR;
  vec3 c = mix(uIn, uOut, smoothstep(0.0, 1.0, d));
  if (uFibre > 0.0){
    // vellum fibre: long, stretched fbm (almost imperceptible)
    float f = fbm(vec2(p.x / 700.0, p.y / 9.0) + vec2(3.7, 1.1), 4);
    float g = fbm(vec2(p.x / 180.0 + 0.3 * f, p.y / 2.6) + vec2(9.2, 4.4), 3);
    c *= 1.0 + uFibre * (1.6 * (f - 0.5) + 0.9 * (g - 0.5));
  }
  if (uSpillI > 0.0){
    vec2 q = abs(p - uSpill.xy) - uSpill.zw;
    float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    c += uSpillC * uSpillI * (0.65 * exp(-max(sd, 0.0) / uSpillW) + 0.35 * exp(-max(sd, 0.0) / (uSpillW * 3.5)));
  }
  o = vec4(c * uA, uA);
}`;
export function createBackdrop(ctx) {
  const prog = ctx.G.program('s06.bg', ctx.glsl.frag(BG_FS));
  return function draw(target, o) {
    const sp = o.spill || null;
    ctx.G.draw(prog, {
      uIn: o.inner, uOut: o.outer, uCtr: o.center, uR: o.radius || 0.9, uA: o.alpha == null ? 1 : o.alpha, uFibre: o.fibre || 0,
      uSpill: sp ? [sp.rect[0] + sp.rect[2] / 2, sp.rect[1] + sp.rect[3] / 2, sp.rect[2] / 2, sp.rect[3] / 2] : [0, 0, 1, 1],
      uSpillC: sp ? sp.color : [0, 0, 0], uSpillI: sp ? sp.I : 0, uSpillW: sp ? sp.width || 90 : 90,
    }, target, { blend: o.alpha != null && o.alpha < 1 ? 'premul' : null });
  };
}

// ------------------------------------------------------------------ snow: five closed-form layers (far to near bokeh)
// The near layer (index 4) is a dozen large out-of-focus flakes: soft Gaussian bodies with a faint rim, each its own
// opacity, warm near the lit window. Flakes never cross the faces (uFace ellipses, frame px), and over the plate only
// 40 % of the flakes are drawn (snow in front of the glass, not a veil over the photograph).
const SNOW_VS = `
uniform float uT, uI, uU, uZoom, uZoomV, uFade, uWarmK, uNearK, uPlateThin; uniform int uMinLayer, uMaxLayer;
uniform vec2 uFocus; uniform vec4 uPlate; uniform vec3 uCool, uWarm;
out vec4 vCol; out float vSize; flat out vec4 vSeg; flat out float vNear;
const int N0 = 700, N1 = 1100, N2 = 1350, N3 = 1440;
const float SZA[5] = float[5](1.1, 1.6, 2.6, 5.0, 16.0);
const float SZB[5] = float[5](1.6, 2.4, 4.0, 9.0, 30.0);
const float VA[5] = float[5](15.0, 25.0, 40.0, 66.0, 105.0);
const float VB[5] = float[5](22.0, 34.0, 54.0, 86.0, 145.0);
const float IL[5] = float[5](0.32, 0.42, 0.55, 0.42, 0.08);
const float SW[5] = float[5](5.0, 8.0, 13.0, 22.0, 38.0);
const float DP[5] = float[5](0.0, 0.2, 0.45, 0.75, 1.0);
void main(){
  int id = gl_VertexID;
  int L = id < N0 ? 0 : id < N1 ? 1 : id < N2 ? 2 : id < N3 ? 3 : 4;
  if (L < uMinLayer || L > uMaxLayer || uFade <= 0.0 || (L == 4 && uNearK <= 0.0)){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; vCol = vec4(0.0); vSize = 1.0; vSeg = vec4(0.0); vNear = 0.0; return; }
  float fi = float(id);
  float r1 = h11(fi * 1.37 + 0.5), r2 = h11(fi * 2.91 + 1.7), r3 = h11(fi * 0.613 + 3.1), r4 = h11(fi * 5.17 + 9.3), r5 = h11(fi * 7.77 + 2.2);
  float r6 = h11(fi * 3.53 + 6.1);
  float size = mix(SZA[L], SZB[L], r3) * uU;
  float v = mix(VA[L], VB[L], r4) * uU;
  float m = 60.0 * uU + size;
  vec2 span = uFrame + 2.0 * m;
  float sway = SW[L] * uU * sin(6.2831853 * (0.12 + 0.25 * r5) * uT + 6.2831853 * r1 * 7.0) + 4.0 * uU * sin(1.7 * uT + r2 * 40.0);
  vec2 p;
  p.y = mod(r2 * span.y + v * uT, span.y) - m;
  p.x = mod(r1 * span.x - (5.0 + 6.0 * DP[L]) * uU * uT + sway, span.x) - m;
  // through the glass: flakes stream outward from the focus, nearer ones faster
  float zk = 1.0 + 1.6 * DP[L];
  float Z = 1.0 + uZoom * zk;
  vec2 rel = p - uFocus;
  vec2 q = uFocus + rel * Z;
  float speed = length(rel) * uZoomV * zk;                  // px per second of the outward motion
  float len = min(speed / 60.0, 80.0 * uU);                // a 1/30 s shutter
  vec2 dir = length(rel) > 1e-3 ? normalize(rel) : vec2(0.0, 1.0);
  // warm light from the window on flakes in front of it and close to it
  vec2 bq = abs(q - uPlate.xy) - uPlate.zw;
  float sd = length(max(bq, 0.0)) + min(max(bq.x, bq.y), 0.0);
  float w = uWarmK * (sd < 0.0 ? 1.0 : exp(-sd / (170.0 * uU)));
  vec3 c = mix(uCool, uWarm, w) * (1.0 + 1.3 * w) * IL[L] * uI * uFade;
  if (L == 4) c *= mix(0.4, 1.0, r6) * uNearK;              // out-of-focus flakes: each its own opacity
  // over the plate 60 % fewer flakes (they fade in and out across its edge)
  c *= 1.0 - uPlateThin * step(r6, 0.6) * (1.0 - smoothstep(-24.0 * uU, 24.0 * uU, sd));
  float rad = size * 0.5;
  c /= 1.0 + len / (3.0 * rad + 1.0);
  float S = min(max(size, len + size) + 4.0, 300.0);
  vCol = vec4(c, min(1.0, size * size * uScale * uScale));
  vSize = S;
  vSeg = vec4(dir, len, rad);
  vNear = L == 4 ? 1.0 : 0.0;
  gl_Position = clipOfPx(q);
  gl_PointSize = S * uScale;
}`;
const SNOW_FS = `
uniform vec4 uFaceA, uFaceB;
in vec4 vCol; in float vSize; flat in vec4 vSeg; flat in float vNear;
out vec4 o;
float faceIn(vec4 e, vec2 p){ return e.z > 0.0 ? 1.0 - smoothstep(0.85, 1.15, length((p - e.xy) / e.zw)) : 0.0; }
void main(){
  vec2 q = (gl_PointCoord - 0.5) * vSize;
  float hl = vSeg.z * 0.5;
  float t = clamp(dot(q, vSeg.xy), -hl, hl);
  float r = length(q - vSeg.xy * t);
  float rad = max(vSeg.w, 0.5);
  float w;
  if (vNear > 0.5){
    // out-of-focus near flake: a Gaussian body (no hard disc edge) and a faint 1 px rim
    float body = exp(-2.4 * r * r / (rad * rad));
    float rim = exp(-pow((r - 0.86 * rad) / 1.1, 2.0));
    w = (0.85 * body + 0.3 * rim) * (1.0 - smoothstep(0.9 * rad, rad + 1.5, r));
  } else if (rad > 2.2){
    w = exp(-r * r / (rad * rad) * 1.6);
  } else {
    w = exp(-r * r / (rad * rad + 0.35) * 1.4);
  }
  // never in front of the faces
  vec2 p = framePx();
  w *= 1.0 - max(faceIn(uFaceA, p), faceIn(uFaceB, p));
  o = vec4(vCol.rgb * vCol.a * w, 0.0);
}`;
const SNOW_COUNT = 1452;                                     // 12 near-layer flakes
export function createSnow(ctx) {
  const { G, glsl } = ctx;
  const prog = G.program('s06.snow', glsl.frag(SNOW_FS), glsl.HEADER_VS + SNOW_VS);
  const cache = new Map();
  const col = (hexv, look) => { const k = hexv + look; if (!cache.has(k)) cache.set(k, ctx.displayToScene(hexv, ctx.post.params(look))); return cache.get(k); };
  return function draw(target, o) {
    const look = o.look || 'photo';
    const f = o.faces || [];
    G.draw(prog, {
      uT: o.t, uI: o.I == null ? 1 : o.I, uU: ctx.U, uZoom: o.zoom || 0, uZoomV: o.zoomV || 0, uFade: o.fade == null ? 1 : o.fade,
      uWarmK: o.warm || 0, uMinLayer: o.minLayer || 0, uMaxLayer: o.maxLayer == null ? 4 : o.maxLayer, uFocus: o.focus || [ctx.W / 2, ctx.H / 2],
      uPlate: o.plate || [-1e5, -1e5, 1, 1], uCool: col('#7D8590', look), uWarm: col('#9A7E5A', look),
      uNearK: o.near == null ? 1 : o.near, uPlateThin: o.plateThin == null ? 0.6 : o.plateThin,
      uFaceA: f[0] || [0, 0, 0, 0], uFaceB: f[1] || [0, 0, 0, 0],
    }, target, { blend: 'add', mode: ctx.gl.POINTS, count: SNOW_COUNT });
  };
}

// the travelling light: scene 5's last light, taken over at the bottom centre of the border
const ORB_FS = `
uniform vec2 uP; uniform vec4 uOrb; uniform vec3 uCore, uGlow, uWhite;
out vec4 o;
void main(){
  vec2 q = framePx() - uP; float r = length(q);
  float core = smoothstep(uOrb.x + 1.0, max(uOrb.x - 1.0, 0.0), r);
  float glow = 0.55 * exp(-r / (uOrb.y * 0.18)) + 0.30 * exp(-r / (uOrb.y * 0.45)) + 0.08 * exp(-r / uOrb.y);
  vec3 c = uWhite * core * 6.0 + uCore * exp(-r * r / (2.0 * max(uOrb.x, 1.0) * max(uOrb.x, 1.0))) * 3.0 + uGlow * glow;
  o = vec4(c * uOrb.z, 0.0);
}`;

// warm lamplight seen through the frosted pane (additive, inside the plate rect): brightest toward the lamp, the pane's
// corners about 35 % of the centre, a faint fbm mottle
const LAMP_FS = `
uniform vec4 uR; uniform vec3 uC; uniform float uI;
out vec4 o;
void main(){
  vec2 p = framePx();
  vec2 q = (p - (uR.xy + uR.zw * vec2(0.48, 0.42))) / uR.zw;
  float inside = smoothstep(0.0, 2.0, min(min(p.x - uR.x, uR.x + uR.z - p.x), min(p.y - uR.y, uR.y + uR.w - p.y)));
  float g = (0.35 + 0.65 * exp(-dot(q, q) * 2.6)) * (0.96 + 0.08 * fbm(p / 140.0, 3));
  o = vec4(uC * uI * g * inside, 0.0);
}`;
// the glass mists over from where the light landed (the border's bottom centre) as the pens draw away from it: the
// pane (drawn into a scratch target) is composited with a soft, fbm-broken front of breath-like fog
const WIPE_FS = `
uniform sampler2D uSrc; uniform vec2 uO; uniform float uR, uF;
out vec4 o;
void main(){
  vec2 p = framePx();
  float d = length(p - uO) + (fbm(p / 38.0 + 2.3, 4) - 0.5) * 2.0 * uF * 0.8;
  float m = 1.0 - smoothstep(uR - uF, uR + uF, d);
  o = texture(uSrc, screenUV()) * m;
}`;
// portrait: additive light (the grains) faded out toward the frame's left and right edges (frame px: zero at uE.x, full
// at uE.y from each edge)
const SIDEFADE_FS = `
uniform sampler2D uSrc; uniform vec2 uE;
out vec4 o;
void main(){
  float x = framePx().x;
  float m = smoothstep(uE.x, uE.y, x) * smoothstep(uE.x, uE.y, uFrame.x - x);
  o = texture(uSrc, screenUV()) * m;
}`;
function vpOf(ctx, target, r) {
  const s = target.scale == null ? 1 : target.scale;
  const x0 = Math.max(0, Math.floor(r[0] * s) - 1), x1 = Math.min(target.w, Math.ceil((r[0] + r[2]) * s) + 1);
  const y0 = Math.max(0, Math.floor((ctx.H - r[1] - r[3]) * s) - 1), y1 = Math.min(target.h, Math.ceil((ctx.H - r[1]) * s) + 1);
  return [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
}

const scene = {
  id: 's06_window', t0: 63.0, t1: 73.0, internalScale: 1, look: 'photo',
  async init(ctx) {
    const { G, glsl } = ctx;
    this.Lw = windowLayout(ctx);
    this.backdrop = createBackdrop(ctx);
    this.snow = createSnow(ctx);
    this.mist = createMist(ctx);
    this.soften = createSoften(ctx);
    this.P = { sideFade: G.program('s06.sidefade', glsl.frag(SIDEFADE_FS)), orb: G.program('s06.orb', glsl.frag(ORB_FS)), lamp: G.program('s06.lamp', glsl.frag(LAMP_FS)), wipe: G.program('s06.wipe', glsl.frag(WIPE_FS)), scrim: G.program('s06.scrim', glsl.frag(`uniform vec2 uY; uniform float uA; out vec4 o;
void main(){ float y = framePx().y; float k = clamp((y - uY.x) / (uY.y - uY.x), 0.0, 1.0); k = k * k * (3.0 - 2.0 * k) * 0.55 + k * 0.45; o = vec4(0.0, 0.0, 0.0, uA * 0.58 * k); }`)) };
    const pp = ctx.post.params('photo');
    const S = h => ctx.displayToScene(h, pp);
    this.col = { night0: S('#0E1522'), night1: S('#07080C'), spill: S('#E39A4C'), lamp: S('#6A4A2A'), orbCore: ctx.hexLin('#FFE7A3'), orbGlow: ctx.hexLin('#FFD27A'), white: [1.0, 0.95, 0.84] };
    const L = this.Lw, m = window.PHOTO_META;
    const ph = L.plateW * m.size[1] / m.size[0];
    this.plateRect = [L.plateC[0] - L.plateW / 2, L.plateC[1] - ph / 2, L.plateW, ph];
    // the dolly through the glass: from the plate to scene 7's first crop (whole-image rect), a zoom about one fixed point
    this.endRect = fullRect(cam7(ctx, 73.0));
    const r0 = this.plateRect, r1 = this.endRect;
    this.Zend = r1[2] / r0[2];
    this.Fp = [(r1[0] - this.Zend * r0[0]) / (1 - this.Zend), (r1[1] - this.Zend * r0[1]) / (1 - this.Zend)];
    const meet = ctx.events('border_meet');
    this.meetT = meet.length ? meet[0].t : ctx.cue('border_meet');
    this.portraitT = [1, 2, 3, 4].map(k => ctx.cue('portrait' + k));
  },
  bandProg(ctx, t) { return Math.pow(ctx.tl.seg(t, 64.5, this.meetT), 1.7); },
  // photo rect and the border's own zoom at time t (through the glass after 71.5)
  geom(ctx, t) {
    // eased in AND out, reaching scene 7's first crop at 72.65 and holding there (scene 7's push starts from rest), so no
    // night shows at the frame's sides in the last moments before the cut
    const g = ctx.tl.seg(t, 71.5, 72.65, ctx.tl.E.inOutCubic);
    const Z = 1 + (this.Zend - 1) * g;
    const r0 = this.plateRect, F = this.Fp;
    const rect = [F[0] + Z * (r0[0] - F[0]), F[1] + Z * (r0[1] - F[1]), r0[2] * Z, r0[3] * Z];
    const Zb = Z * (1 + 0.12 * g);
    const bandRect = [F[0] + Zb * (r0[0] - F[0]), F[1] + Zb * (r0[1] - F[1]), r0[2] * Zb, r0[3] * Zb];
    if (ctx.portrait) {
      // portrait: photo and border stay centred on the frame while the photo's sides are in view (with their soft
      // edges), then glide to scene 7's crop (its face box centred) once they have left the frame
      const cx0 = r0[0] + r0[2] / 2, cx1 = this.endRect[0] + this.endRect[2] / 2;
      const cx = cx0 + (cx1 - cx0) * ctx.tl.smoothstep((ctx.W + 80 * ctx.U) / r0[2], this.Zend, Z);
      rect[0] = cx - rect[2] / 2;
      bandRect[0] = cx - bandRect[2] / 2;
    }
    return { g, Z, Zb, rect, bandRect };
  },
  tipsAt(ctx, t) {
    const o = bandAround(ctx, this.plateRect);
    const P = ctx.knot.band.rectPerimeter(o), pr = this.bandProg(ctx, t);
    return [ctx.knot.band.rectPoint(o, pr * P / 2), ctx.knot.band.rectPoint(o, -pr * P / 2)];
  },
  keyX(ctx, t) { const r = this.plateRect; return r[0] - 300 + ctx.tl.seg(t, 63, 73) * (r[2] + 600); },
  // the cleared radius of the frost (plate diagonals): the breath opens round the faces quickly (about 0.25 by 66.8),
  // keeps a frosted margin round the edges at the border meet (about 0.4 at 67.5) and has cleared the pane by 69.0
  frostR(ctx, t) {
    const x = ctx.tl.seg(t, 66.0, 69.0);
    return 0.32 * (1 - Math.pow(1 - x, 4)) + 0.83 * x * x * x;
  },
  // the misted pane's front (frame px from the border's bottom centre), and that origin
  paneFront(ctx, t) {
    const L = this.Lw, r = this.plateRect;
    const reach = Math.hypot(r[2] / 2, r[3] + 53 * L.s0) + 200 * L.s0;
    return { o: [L.plateC[0], r[1] + r[3] + 53 * L.s0], R: reach * ctx.tl.seg(t, 64.6, 66.3, ctx.tl.E.inOutSine), F: 70 * L.s0 };
  },
  render(ctx, tau, p, target) {
    const { G, tl } = ctx, E = tl.E, PH = ctx.photoR, K = ctx.knot;
    const t = T0 + tau;
    const L = this.Lw;
    const geo = this.geom(ctx, t);
    // 1 the winter night (premultiplied over scene 5 during the 'over' entrance) with the window's warm spill. It
    // arrives late (63.8-64.5) so that scene 5's push into the last light is still visibly rushing past at 64.2.
    const bgA = tl.seg(t, 63.8, 64.5, E.inOutSine);
    const colourR = 1.2 * tl.seg(t, 69.0, 71.6, E.inOutSine);
    const lit = 0.35 * tl.seg(t, 64.6, 66.0) + 0.65 * tl.seg(t, 69.0, 71.5, E.inOutSine);
    this.backdrop(target, { inner: this.col.night0, outer: this.col.night1, center: [L.plateC[0], L.plateC[1] + 80 * L.s0], radius: 0.95, alpha: bgA,
      spill: { rect: geo.rect, color: this.col.spill, I: 0.022 * lit * (1 - geo.g), width: 110 * L.s0 } });
    // portrait: scene 7's warm mist gathers round the photo as the border dissolves and the photo flies at the lens (its
    // edges dissolve into it)
    if (ctx.portrait && geo.g > 0) this.mist(target, t, tl.seg(t, 71.6, 72.4, E.inOutSine));
    // portrait: the photo's edges soften as its border dissolves (an fbm-broken feather that widens as the photo nears
    // and lands as scene 7's 80 px); the side feathers go once the sides have left the frame
    const fe = ctx.portrait && geo.g > 0 ? 80 * (0.5 + 0.5 * geo.Z / this.Zend) * tl.seg(t, 71.5, 71.85, E.inOutSine) : 0;
    const feLR = fe * (1 - tl.seg(t, 72.1, 72.35));
    const cam = geo.g > 0 ? ctx.photoCamera([0, 0, window.PHOTO_META.size[0], window.PHOTO_META.size[1]], { dest: geo.rect, tag: 's06-glass' })
      : ctx.photoCamera([0, 0, window.PHOTO_META.size[0], window.PHOTO_META.size[1]], { dest: this.plateRect, tag: 's06' });
    // 2 the plate: frost, grains, engraving, colour
    if (t >= 64.6) {
      const frostR = this.frostR(ctx, t);
      const frostLeft = 1 - tl.seg(t, 66.0, 68.6, E.inOutSine);
      const keyX = this.keyX(ctx, t);
      // the glass mists over behind the pens, from the bottom centre outward, with a feathered fbm front
      const W = this.paneFront(ctx, t);
      const wiping = t < 66.3;                                  // the front has passed the pane's far corners by 66.3
      const vp = vpOf(ctx, target, geo.rect);
      let dst = target;
      if (wiping) { dst = G.acquire(target.w, target.h, { format: 'hdr', scale: target.scale == null ? 1 : target.scale }); G.clear(dst, [0, 0, 0, 0]); }
      PH.draw(dst, cam, {
        engrave: { reveal: t - 65.5, key: [keyX, this.plateRect[1] - 260 * L.s0] },
        edgeFade: ctx.portrait && geo.g > 0 ? { top: fe, bottom: fe, left: feLR, right: feLR }
          : frostLeft > 0.01 ? { top: 12 * frostLeft, bottom: 12 * frostLeft, left: 12 * frostLeft, right: 12 * frostLeft } : null,
        colour: { r: colourR, rim: 18, rimI: 1.1 }, frost: { r: frostR, t: t - 66.0, rAt: tt => this.frostR(ctx, 66 + tt), amount: 1 - geo.g },
      });
      // lamplight from inside, diffused by the frost: the pane reads as a lit window before the grains arrive
      if (frostLeft > 0.002) G.draw(this.P.lamp, { uR: geo.rect, uC: this.col.lamp, uI: 1.6 * frostLeft }, dst, { blend: 'add', viewport: vp });
      if (wiping) {
        G.draw(this.P.wipe, { uSrc: dst, uO: W.o, uR: W.R, uF: W.F }, target, { blend: 'premul', viewport: vp });
        G.release(dst);
      }
      if (t > 65.5 && t < 68.5) {
        const go = { t: t - 65.5, tipAt: tr => this.tipsAt(ctx, 65.5 + tr) };
        if (ctx.portrait) {
          // portrait: the plate leaves about 50 px either side, so the grains' outward spray thins out before the
          // frame's left and right edges instead of being cut by them
          const gt = G.acquire(target.w, target.h, { format: 'hdr', scale: target.scale == null ? 1 : target.scale });
          G.clear(gt, [0, 0, 0, 0]);
          PH.grains(gt, cam, go);
          G.draw(this.P.sideFade, { uSrc: gt, uE: [4 * ctx.U, 62 * ctx.U] }, target, { blend: 'add' });
          G.release(gt);
        } else PH.grains(target, cam, go);
      }
      for (let i = 0; i < 4; i++) PH.portraitGlint(target, cam, { index: i, life: tl.seg(t, this.portraitT[i] - 0.1, this.portraitT[i] + 0.5) });
    }
    // 3 the border (drawn into the scene target so its keyline and shadow sit on the night). Through the glass it leaves
    // on its radial blur (71.9-72.4) before any gap opens between it and the photo; in portrait it is gone before its
    // sides pass the frame's edges.
    if (t >= 64.5 && t < 72.3) {
      let op = 1 - tl.seg(t, 71.75, 72.25, E.inOutSine);
      if (ctx.portrait) {
        // portrait: the border dissolves as the push begins (71.5-71.8), and in any case before its roundels' outer
        // edge (597 layout px from the band's centre, at the border's scale) can reach the frame's left or right edge
        const bs = geo.bandRect[2] / 1000, bc = geo.bandRect[0] + geo.bandRect[2] / 2;
        const ext = Math.max(ctx.W / 2 - (bc - 597 * bs), bc + 597 * bs - ctx.W / 2);
        op *= 1 - Math.max(tl.seg(t, 71.5, 71.8, E.inOutSine), tl.seg(ext, 512 * ctx.U, 528 * ctx.U));
      }
      const keyX = this.keyX(ctx, t);
      const base = { progress: this.bandProg(ctx, t), key: [keyX, -150], keyZ: 500, tipI: 2.5 };
      if (geo.g <= 0) K.band.rect(target, bandAround(ctx, this.plateRect, Object.assign({ opacity: op }, base)));
      else if (op > 0.002) {
        // radial blur of about 6 px while it rushes past: three exposures spread along the zoom
        const blurPx = 6 * tl.seg(t, 71.6, 72.2);
        const half = Math.hypot(geo.bandRect[2], geo.bandRect[3]) / 2;
        const d = blurPx / Math.max(half, 1);
        const taps = d > 0.0005 ? [-1, 0, 1] : [0];
        if (ctx.R > 1 && taps.length === 3) {
          // output scale R > 1: the three exposures are blurPx frame px apart at the band's corners, which merges into
          // one soft line at HD but separates into ghost copies at 2+ physical px. Each exposure k is split into n
          // sub-exposures spread evenly over its own third of the zoom (k - 1/2 .. k + 1/2), so that they are at most
          // 1 physical px apart at the band's farthest point from the fixed point (n = 1: the three HD exposures).
          // Each keeps the exposure's over-coverage: 1 - (1 - a)^(1/n) per sub-exposure. At 1 frame px apart (71.7)
          // the 2x box-down of a thin line then gets exactly the HD 3-tap weights.
          const br = geo.bandRect, F = ctx.portrait ? [br[0] + br[2] / 2, this.Fp[1]] : this.Fp;
          const bs = br[2] / 1000, bc = [br[0] + br[2] / 2, br[1] + br[3] / 2];
          let far = 0;                                         // roundels' outer extent: 597 x 472 layout px from the centre
          for (const sx of [-1, 1]) for (const sy of [-1, 1]) far = Math.max(far, Math.hypot(bc[0] + sx * 597 * bs - F[0], bc[1] + sy * 472 * bs - F[1]));
          const n = Math.max(1, Math.min(6, Math.ceil(far * d * ctx.R - 1e-6)));
          for (const k of taps) {
            const a = op / (k === 0 ? 2.2 : 3.2);
            const b = n === 1 ? a : 1 - Math.pow(1 - a, 1 / n);
            for (let j = 0; j < n; j++) {
              const z = 1 + (k + (j + 0.5) / n - 0.5) * d;
              const r = [F[0] + z * (br[0] - F[0]), F[1] + z * (br[1] - F[1]), br[2] * z, br[3] * z];
              K.band.rect(target, bandAround(ctx, r, Object.assign({ opacity: b, shadow: 0.25 }, base)));
            }
          }
        } else
        for (const k of taps) {
          const z = 1 + k * d;
          const br = geo.bandRect, F = ctx.portrait ? [br[0] + br[2] / 2, this.Fp[1]] : this.Fp;
          const r = [F[0] + z * (br[0] - F[0]), F[1] + z * (br[1] - F[1]), br[2] * z, br[3] * z];
          K.band.rect(target, bandAround(ctx, r, Object.assign({ opacity: op / (taps.length === 3 ? (k === 0 ? 2.2 : 3.2) : 1), shadow: 0.25 }, base)));
        }
      }
    }
    // 4 the orb (scene 5's last light) and its split into the two pen tips
    this.drawOrb(ctx, t, target, bgA);
    // 5 the border-meet spark at the top centre
    const env = tl.pulse(t, this.meetT - 0.06, 0.09, 0.0, 0.75);
    if (env > 0.002) {
      const top = this.tipsAt(ctx, this.meetT)[0];
      const sp = tl.seg(t, this.meetT, this.meetT + 0.75);
      ctx.gold.glint(target, { x: top[0], y: top[1], size: 84 * ctx.U * L.s0, I: 6 * env, rot: 0.0, col: this.col.white });
      this.orbAt(ctx, target, top, 2.0 * L.s0, 46 * ctx.U * L.s0, 0.9 * env);
      ctx.knot.ring(target, { center: top, r: (12 + 80 * tl.E.outCubic(sp)) * L.s0, width: 4, I: 0.45 * env });
    }
    // 6 snow in front of the window (never across the faces, sparse over the plate); the near bokeh flakes only once
    // the night has taken over; it streaks past the lens through the glass and is gone by 72.8
    const zoomK = tl.seg(t, 71.5, 72.8, E.inQuad);
    const zv = (tl.seg(t + 1 / 60, 71.5, 72.8, E.inQuad) - tl.seg(t - 1 / 60, 71.5, 72.8, E.inQuad)) * 30;
    this.snow(target, { t: t - 50.0, I: bgA * bgA, warm: lit, plate: [geo.rect[0] + geo.rect[2] / 2, geo.rect[1] + geo.rect[3] / 2, geo.rect[2] / 2, geo.rect[3] / 2],
      focus: this.Fp, zoom: 3.5 * zoomK, zoomV: 3.5 * zv, fade: 1 - tl.seg(t, 71.9, 72.8, E.inOutSine), near: tl.seg(t, 64.3, 64.9),
      faces: t >= 64.6 ? ctx.faceEllipses(cam) : null });
    // 7 the caption scrim of scene 7 arrives with the photo, and line L9's legibility band (the same as scene 7's)
    if (!ctx.portrait && geo.g > 0) G.draw(this.P.scrim, { uY: [800, 1080], uA: geo.g }, target, { blend: 'premul' });
    // over the night (lines L8a/L8b) a feathered band under each row keeps snow and spill out of the type
    const caps = this.captions(ctx, tau), l9 = caps.filter(e => e.lineId === 'L9');
    drawCaptionBands(ctx, target, caps.filter(e => e.lineId !== 'L9'), 0.4);
    if (l9.length) { this.soften(target, l9); drawCaptionBands(ctx, target, l9, 0.5); }
  },
  orbAt(ctx, target, p, core, glow, I) {
    const s = target.scale == null ? 1 : target.scale, r = Math.ceil(glow * 4 + 60);
    const x0 = Math.max(0, Math.floor((p[0] - r) * s)), x1 = Math.min(target.w, Math.ceil((p[0] + r) * s));
    const y0 = Math.max(0, Math.floor((ctx.H - p[1] - r) * s)), y1 = Math.min(target.h, Math.ceil((ctx.H - p[1] + r) * s));
    if (x1 > x0 && y1 > y0) ctx.G.draw(this.P.orb, { uP: p, uOrb: [core, glow, I, 0], uCore: this.col.orbCore, uGlow: this.col.orbGlow, uWhite: this.col.white },
      target, { blend: 'add', viewport: [x0, y0, x1 - x0, y1 - y0] });
  },
  drawOrb(ctx, t, target, bgA) {
    const { G, tl } = ctx;
    if (t >= 65.2) return;
    const raw = s05.orbAt(ctx, Math.min(t, 64.5));
    const k = tl.seg(Math.min(t, 64.5), 63.0, 64.5, tl.E.inOutSine);
    const comp = Math.pow(2, 3 * k);
    const Iraw = raw.I / comp;                                   // what scene 5 shows after its own -3 EV
    let I;
    if (t < 64.5) {
      // keep the displayed orb continuous across the blend: scene 5's own orb is covered by (1 - bgA) and the post
      // exposure is the transition blend of both scenes' exposures (scene 5: -3k, this scene: 0)
      const Eb = -3 * k * (1 - k);
      I = bgA > 0.01 ? Math.max(0, (Iraw * Math.pow(2, -Eb) - (1 - bgA) * raw.I) / bgA) * bgA : 0;
    } else I = Iraw;
    const split = tl.seg(t, 64.5, 65.2, tl.E.inOutSine);
    I *= 1 - split;
    const core = raw.core * (1 - 0.7 * split), glow = raw.glow * (1 - 0.5 * split);
    if (I <= 0.001) return;
    const r = Math.ceil(glow * 4 + 60), s = target.scale == null ? 1 : target.scale;
    const x0 = Math.max(0, Math.floor((raw.x - r) * s)), x1 = Math.min(target.w, Math.ceil((raw.x + r) * s));
    const y0 = Math.max(0, Math.floor((ctx.H - raw.y - r) * s)), y1 = Math.min(target.h, Math.ceil((ctx.H - raw.y + r) * s));
    if (x1 > x0 && y1 > y0) G.draw(this.P.orb, { uP: [raw.x, raw.y], uOrb: [core, glow, I, 0], uCore: this.col.orbCore, uGlow: this.col.orbGlow, uWhite: this.col.white },
      target, { blend: 'add', viewport: [x0, y0, x1 - x0, y1 - y0] });
  },
  captions(ctx, tau) {
    const t = T0 + tau, L = this.Lw, out = [];
    if (t >= 66.0 && t < 72.1) {
      const st = { base: 'narrative', size: L.textSize };
      const a = { lineId: 'L8a', tau: t - 66.0, x: ctx.W / 2, y: L.textY, style: st, glowColor: '#E39A4C', glow: 0.12, exit: { at: 5.2, kind: 'default', dur: 0.8 } };
      const b = { lineId: 'L8b', tau: t - 69.0, x: ctx.W / 2, y: L.textY2 || L.textY, style: st, glowColor: '#E39A4C', glow: 0.12, exit: { at: 2.2, kind: 'default', dur: 0.8 } };
      // landscape: one row laid out once (no reflow); portrait: two centred rows
      const pair = L.textY2 ? [a, b] : ctx.text.flow([a, b], { x: ctx.W / 2, gap: 0.8 });
      out.push(pair[0]);
      if (t >= 69.0) out.push(pair[1]);
    }
    if (t >= 72.0) out.push(l9Entry(ctx, t));
    return out;
  },
  post(ctx, tau) {
    const t = T0 + tau;
    const geo = this.geom(ctx, t);
    const cam = ctx.photoCamera([0, 0, window.PHOTO_META.size[0], window.PHOTO_META.size[1]], { dest: geo.rect, tag: 's06-post' });
    // while the pens draw (64.5-67.2) their glints must not throw frame-wide anamorphic lines; the default streak is
    // back for the border-meet spark at 67.5
    const k = ctx.tl.seg(t, 64.3, 64.5) * (1 - ctx.tl.seg(t, 67.2, 67.42));
    const D = ctx.post.params('photo').streak;
    return Object.assign(ctx.photoR.postParams(cam), { streak: { threshold: D.threshold + (3.0 - D.threshold) * k, strength: D.strength + (0.025 - D.strength) * k } });
  },
};
export default scene;
