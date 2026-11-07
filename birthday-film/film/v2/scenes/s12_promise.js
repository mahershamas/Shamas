/*
  Scene 12: promise (137.8-145.4), package P8.
  Ink ground #07080C with a faint warm vignette (#1A120C at the knot) and an almost invisible vellum fibre. One
  endless knot (core/knot.js promiseKnot: four lobes, three turns, ONE closed strand, verified at init: parity,
  alternation, one component), a 14 px (portrait 18 px) gold-leaf ribbon with an umber keyline and true over/under gaps (2.2 ribbon
  widths at every under-crossing), precomputed into the 8B data texture.
  138.0-141.0 the pen tip travels the whole strand (arc-length reveal, easeInOutSine) and returns to its own beginning
  at exactly 141.000 (cue 'knot_close', the E major downbeat): no loose end. 141.0-141.4 a specular flare sweeps the
  knot, a soft star lights the closing point, and a ring of light pulses out (+70 px, gone before it reaches line L18).
  After 141.4 the knot turns at 0.5 deg/s and the key light orbits it once every 6 s.
  141.0 line L18 below the knot: opacity only over 0.9 s, perfectly still; holds to 144.0, fades 144.0-144.8.
  143.7-144.35 the knot crumbles: the outer lobes first, inward, under a soft ember front, each grain of leaf leaving
  as a gold mote that drifts outward and upward and is gone by 144.58, so neither the knot nor its dust is left when
  scene 13's photograph fades in (from 144.6) where the knot stood.
  The ocean of scene 11 dissolves into this ink in the shared gold-dust transition (scenes/index.js); 144.4-145.4 scene 13.
*/
import { promiseKnot } from '../core/knot.js';

const T0 = 137.8;
const DEG = Math.PI / 180;
// the crumble (frame time): the front runs CR0-CR1, every mote is dead by CR_END
const CR0 = 143.7, CR1 = 144.35, CR_END = 144.58, ND = 4000;
// the front law shared by the shader and the mote births: outer lobes first, broken by a fine fbm
const CRUMBLE_FS = `
uniform sampler2D uK; uniform float uU; uniform vec2 uC; uniform float uR; uniform vec3 uEmber;
out vec4 o;
void main(){
  vec2 p = framePx();
  vec4 k = texture(uK, screenUV());
  float rad = clamp(length(p - uC) / (uR * 1.15), 0.0, 1.0);
  float f = 0.55 * (1.0 - rad) + 0.45 * fbm(p / (22.0 * uR / 170.0) + 4.0, 4);
  float m = smoothstep(f - 0.05, f + 0.05, uU);              // 1 = crumbled
  float ember = exp(-pow((uU - f) / 0.035, 2.0)) * step(0.0, uU);
  float a = k.a * (1.0 - m);
  o = vec4(k.rgb * (1.0 - m) + uEmber * ember * k.a * (1.0 - 0.5 * m), a);
}`;
// the knot's dust: home on the ribbon, born when the front passes, drifting outward and upward, dead by CR_END
const KDUST = `
uniform sampler2D uHome; uniform float uU, uI, uEnd; uniform vec2 uC; uniform vec3 uC1, uC2, uHot;
void particle(int id, out vec2 px, out float size, out vec4 col){
  vec4 h = fetchPoint(uHome, id);                              // x, y, birth (s), seed
  float r1 = h11(h.w * 13.1 + 1.0), r2 = h11(h.w * 7.7 + 2.0), r3 = h11(h.w * 3.3 + 5.0);
  float e = uTau - h.z;
  float life = min(0.32 + 0.3 * r1, uEnd - h.z);
  px = vec2(-100.0); size = 1.0; col = vec4(0.0);
  if (e < 0.0 || e > life) return;
  vec2 out_ = normalize(h.xy - uC + vec2(1e-3));
  float v = (150.0 + 170.0 * r2) * uU;
  vec2 p = h.xy + out_ * v * e + vec2((r3 - 0.5) * 30.0, -110.0 - 60.0 * r1) * uU * e;
  p += 8.0 * uU * (1.0 - exp(-e * 3.0)) * curl2(h.xy * 0.006 + vec2(r2 * 3.0, uTau * 0.05));
  px = p;
  size = (1.1 + 1.5 * r2 * r2) * uU;
  float flash = exp(-e * 9.0);
  float fade = 1.0 - smoothstep(life * 0.35, life, e);
  col = vec4((mix(uC1, uC2, r3) * (0.8 + 0.6 * r1) + uHot * flash * 2.0) * uI, fade);
}`;

const BG_FS = `
uniform vec2 uCtr; uniform vec3 uIn, uOut; uniform float uR, uFib;
out vec4 o;
void main(){
  vec2 px = framePx();
  vec2 d = (px - uCtr) / vec2(uR * 1.25, uR);
  float k = exp(-dot(d, d) * 1.35);
  vec3 c = mix(uOut, uIn, k);
  vec2 fq = px / uFrame.y;
  float fib = fbm(vec2(fq.x * 9.0, fq.y * 90.0), 3) * 0.6 + vn(px * 0.9) * 0.4;
  c *= 1.0 + uFib * (fib - 0.5) * 2.0;
  o = vec4(c, 1.0);
}`;

// ink closing in from the frame edges toward a centre (fbm-broken front, a soft but clean edge, optional gilded rim);
// exported for scene 14's entrance
export const IRIS_FS = `
uniform sampler2D uA, uB; uniform float uW, uGold, uEdge; uniform vec2 uC; uniform vec3 uGoldC;
out vec4 o;
void main(){
  vec2 px = framePx(), uv = screenUV();
  vec3 a = texture(uA, uv).rgb, b = texture(uB, uv).rgb;
  vec2 d = (px - uC) / uFrame.y;
  float r = length(d * vec2(0.8, 1.0));
  float n = fbm(px / uFrame.y * 4.0 + 3.1, 4);
  float f = r * 1.1 + 0.7 * (n - 0.5);
  float thr = mix(1.35, -0.45, uW);
  float fw = max(fwidth(f), 1e-4) * 1.5 + 0.004;
  float m = smoothstep(thr - fw, thr + fw, f);
  vec3 c = mix(a, b, m);
  float e = (1.0 - smoothstep(0.0, fw * 0.8 + uEdge, abs(f - thr))) * step(0.001, uW) * step(uW, 0.999);
  o = vec4(c + uGoldC * e * uGold, 1.0);
}`;

function layoutOf(ctx) {
  // portrait: the knot about 46 percent of the frame width (R 240, ribbon, warm ground, key height and closing glint
  // scaled with it) and line L18 at 60 px, set below the furthest reach of the closing ring
  return ctx.portrait ? { c: [540, 860], R: 240, rib: 18, textY: 1290, size: 60, bgR: 640, keyZ: 505, glint: 62 }
    : { c: [960, 470], R: 170, rib: 14, textY: 760, size: 54, bgR: 470, keyZ: 400, glint: 52 };
}

const scene = {
  id: 's12_promise', t0: T0, t1: 145.4, internalScale: 1, look: 'winter_gold',
  async init(ctx) {
    const { G, glsl } = ctx;
    this.L = layoutOf(ctx);
    const L = this.L;
    this.bg = G.program('p8.s12.bg', glsl.frag(BG_FS));
    this.iris = G.program('p8.iris', glsl.frag(IRIS_FS));
    this.copy = G.program('p8.copy', glsl.frag(`uniform sampler2D uA; uniform float uK; out vec4 o; void main(){ o = texture(uA, screenUV()) * uK; }`));
    this.crumble = G.program('p8.s12.crumble', glsl.frag(CRUMBLE_FS));
    this.kdust = ctx.particles.program('p8.s12.kdust', KDUST);
    this.knotData = promiseKnot({ cx: L.c[0], cy: L.c[1], R: L.R });
    const v = ctx.verifyKnot(this.knotData, { ribbon: L.rib, gapFactor: 2.2 });
    if (!v.ok || v.components !== 1) throw new Error('promise knot failed its checks: ' + JSON.stringify(v));
    this.verify = v;
    this.kt = ctx.knot.texture(this.knotData, { ribbon: L.rib, gapFactor: 2.2 });
    this.start = ctx.knot.tipAt(this.kt, 0);
    const D = h => ctx.displayToScene(h);
    this.col = { inC: D('#1A120C'), outC: D('#07080C') };
    // the key light: high above the left of the knot; it starts orbiting from there at 141.4
    this.key0 = [L.c[0] - 260 * L.R / 170, L.c[1] - 320 * L.R / 170];
    this.keyA0 = Math.atan2(this.key0[1] - L.c[1], this.key0[0] - L.c[0]);
    this.keyR = Math.hypot(this.key0[0] - L.c[0], this.key0[1] - L.c[1]);
    // the knot's dust: homes on the ribbon as the knot stands at the crumble (0.5 deg/s since 141.4), births by the
    // same front law as CRUMBLE_FS (its fbm replaced by a seeded draw)
    const pw = ctx.post.params('winter_gold');
    this.dcol = { c1: ctx.displayToScene('#D4A64A', pw), c2: ctx.displayToScene('#E9C676', pw), hot: [1.0, 0.92, 0.75],
      ember: ctx.displayToScene('#E3B341', pw).map(v => v * 1.4) };
    const kn = this.knotData, n = kn.pts.length / 2, rnd = ctx.rng('s12.knotdust');
    const rot = 0.5 * (144.0 - 141.4) * DEG, cr = Math.cos(rot), sr = Math.sin(rot);
    const data = new Float32Array(ND * 4);
    for (let i = 0; i < ND; i++) {
      const j = Math.floor(rnd() * n);
      const a = kn.ang ? kn.ang[j] : 0;
      const off = (rnd() - 0.5) * (L.rib - 1) * ctx.U;
      const x0 = kn.pts[j * 2] - Math.sin(a) * off - L.c[0], y0 = kn.pts[j * 2 + 1] + Math.cos(a) * off - L.c[1];
      const x = L.c[0] + x0 * cr - y0 * sr, y = L.c[1] + x0 * sr + y0 * cr;
      const rad = Math.min(1, Math.hypot(x - L.c[0], y - L.c[1]) / (L.R * 1.15));
      const f = 0.55 * (1 - rad) + 0.45 * (0.25 + 0.5 * rnd());
      data[i * 4] = x; data[i * 4 + 1] = y; data[i * 4 + 2] = CR0 + (CR1 - CR0) * (f + 0.08) / 1.16; data[i * 4 + 3] = i + 0.5;
    }
    this.kHome = ctx.particles.pointsTexture(data, 4);
  },
  // the iris (used only while the 11 -> 12 record is 'custom'; it is currently the shared gold-dust dissolve)
  transition(ctx, w, outRT, inRT, dst) {
    ctx.G.draw(this.iris, { uA: outRT, uB: inRT, uW: w, uGold: 0.22, uEdge: 0.0015, uC: this.L.c, uGoldC: ctx.displayToScene('#B8862B') }, dst);
  },
  progress(ctx, t) { return ctx.tl.seg(t, 138.0, 141.0, ctx.tl.E.inOutSine); },
  render(ctx, tau, p, target) {
    const L = this.L;
    // the ground is static: rendered once into a persistent target, then copied
    if (!this.bgRT) {
      this.bgRT = ctx.G.target('p8.s12.ground', ctx.W, ctx.H);
      ctx.G.draw(this.bg, { uCtr: L.c, uIn: this.col.inC, uOut: this.col.outC, uR: L.bgR, uFib: 0.015 }, this.bgRT);
    }
    ctx.G.draw(this.copy, { uA: this.bgRT, uK: 1 }, target);
    // handing over to scene 13 (144.4-145.4): whatever is left of the crumble goes into this scene's own frame
    if (ctx.layer && ctx.layer.role === 'out' && T0 + tau > 144.0) this.drawKnot(ctx, T0 + tau, target);
  },
  overlay(ctx, tau, p, target) {
    if (ctx.layer && ctx.layer.role === 'out' && T0 + tau > 144.0) return;
    this.drawKnot(ctx, T0 + tau, target);
  },
  drawKnot(ctx, t, target) {
    if (t >= CR_END) return;
    const u = ctx.tl.seg(t, CR0, CR1) * 1.16 - 0.08;
    if (t < CR0) { this.knotNow(ctx, t, target); return; }
    // the crumble: the knot into a scratch target, composited through the dissolve front, then its dust
    const L = this.L, G = ctx.G;
    if (u < 1.08) {
      const s = target.scale == null ? 1 : target.scale, ext = L.R * 1.45;
      const ks = G.target('p8.s12.knot', Math.round(ctx.W * s), Math.round(ctx.H * s), { scale: s });
      G.clear(ks, [0, 0, 0, 0]);
      this.knotNow(ctx, t, ks);
      const x0 = Math.max(0, Math.floor((L.c[0] - ext) * s)), x1 = Math.min(target.w, Math.ceil((L.c[0] + ext) * s));
      const y0 = Math.max(0, Math.floor((ctx.H - L.c[1] - ext) * s)), y1 = Math.min(target.h, Math.ceil((ctx.H - L.c[1] + ext) * s));
      G.draw(this.crumble, { uK: ks, uU: u, uC: L.c, uR: L.R, uEmber: this.dcol.ember }, target, { blend: 'premul', viewport: [x0, y0, x1 - x0, y1 - y0] });
    }
    ctx.particles.draw(this.kdust, ND, { uTau: t, uHome: this.kHome, uU: ctx.U, uI: 0.9, uEnd: CR_END, uC: L.c, uC1: this.dcol.c1, uC2: this.dcol.c2, uHot: this.dcol.hot }, target);
  },
  knotNow(ctx, t, target) {
    const { tl } = ctx, E = tl.E, L = this.L;
    const prog = this.progress(ctx, t);
    if (prog <= 0) return;
    const rot = Math.max(0, t - 141.4) * 0.5 * DEG;
    const ka = this.keyA0 + (t > 141.4 ? 2 * Math.PI * (t - 141.4) / 6.0 : 0);
    const key = [L.c[0] + this.keyR * Math.cos(ka), L.c[1] + this.keyR * Math.sin(ka)];
    const flare = t >= 141.0 && t < 141.4 ? (t - 141.0) / 0.4 : 0;
    // the closing breath: the leaf brightens a little as the strand closes, then settles
    const close = t >= 141.0 ? Math.exp(-(t - 141.0) / 0.6) : 0;
    ctx.knot.draw(target, this.kt, { progress: prog, rotation: rot, center: L.c, key, keyZ: L.keyZ, keyI: 4 + 1.5 * close, flare, flareI: 3.2, tipI: 4.5 * tl.seg(t, 138.0, 138.6, E.inOutSine) });   // the nib lights up as the ink settles
    if (t >= 141.0 && t < 142.0) {
      // the ring pulses out at most 70 px (scaled) and is gone before it could cross line L18
      const k = (t - 141.0) / 0.8;
      if (k < 1) ctx.knot.ring(target, { center: L.c, r: (L.R + L.rib) + 70 * (L.R / 170) * E.outCubic(k), width: 3.2, I: 0.5 * Math.pow(1 - k, 2) * (1 - tl.smoothstep(0.4, 0.75, k)) });
      const g = (t - 141.0) / 0.5;
      if (g < 1) ctx.gold.glint(target, { x: this.start[0], y: this.start[1], size: L.glint, I: 3.2 * Math.sin(Math.PI * Math.pow(g, 0.4)), rot: 0.2 });
    }
  },
  captions(ctx, tau) {
    const t = T0 + tau, L = this.L;
    if (t < 140.95 || t >= 145.0) return [];
    return [{ lineId: 'L18', tau: t - 141.0, x: L.c[0], y: L.textY, style: { base: 'narrative', size: L.size }, enter: { base: 'opacity', dur: 0.9 }, exit: { at: 3.0, kind: 'opacity', dur: 0.8 } }];
  },
  post(ctx, tau) {
    const t = T0 + tau;
    const close = t >= 141.0 ? Math.exp(-(t - 141.0) / 0.5) : 0;
    // no anamorphic streak (the knot's bright edges would print horizontal copies); a soft bloom swell on the close
    return { ghosts: 0, ca: 0.0015, streak: { strength: 0.0 }, bloom: { add: 0.08 * close }, vignette: 0.7 };
  },
};
export default scene;
