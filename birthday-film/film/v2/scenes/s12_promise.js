/*
  Scene 12: promise (137.8-145.4), package P8.
  Ink ground #07080C with a faint warm vignette (#1A120C at the knot) and an almost invisible vellum fibre. One
  endless knot (core/knot.js promiseKnot: four lobes, three turns, ONE closed strand, verified at init: parity,
  alternation, one component), a 14 px gold-leaf ribbon with an umber keyline and true over/under gaps (2.2 ribbon
  widths at every under-crossing), precomputed into the 8B data texture.
  138.0-141.0 the pen tip travels the whole strand (arc-length reveal, easeInOutSine) and returns to its own beginning
  at exactly 141.000 (cue 'knot_close', the E major downbeat): no loose end. 141.0-141.4 a specular flare sweeps the
  knot, a soft star lights the closing point, and a ring of light pulses out (+120 px, fading over 0.8 s).
  After 141.4 the knot turns at 0.5 deg/s and the key light orbits it once every 6 s.
  141.0 line L18 below the knot: opacity only over 0.9 s, perfectly still; holds to 144.0, fades 144.0-144.8.
  137.8-138.6 the ocean of scene 11 dissolves into this ink, closing in from the frame edges toward the knot (custom); 144.4-145.4 cross-fade to scene 13.
*/
import { promiseKnot } from '../core/knot.js';

const T0 = 137.8;
const DEG = Math.PI / 180;

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
  return ctx.portrait ? { c: [540, 860], R: 190, textY: 1200, size: 48.6, bgR: 520 } : { c: [960, 470], R: 170, textY: 760, size: 54, bgR: 470 };
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
    this.knotData = promiseKnot({ cx: L.c[0], cy: L.c[1], R: L.R });
    const v = ctx.verifyKnot(this.knotData, { ribbon: 14, gapFactor: 2.2 });
    if (!v.ok || v.components !== 1) throw new Error('promise knot failed its checks: ' + JSON.stringify(v));
    this.verify = v;
    this.kt = ctx.knot.texture(this.knotData, { ribbon: 14, gapFactor: 2.2 });
    this.start = ctx.knot.tipAt(this.kt, 0);
    const D = h => ctx.displayToScene(h);
    this.col = { inC: D('#1A120C'), outC: D('#07080C') };
    // the key light: high above the left of the knot; it starts orbiting from there at 141.4
    this.key0 = [L.c[0] - 260 * L.R / 170, L.c[1] - 320 * L.R / 170];
    this.keyA0 = Math.atan2(this.key0[1] - L.c[1], this.key0[0] - L.c[0]);
    this.keyR = Math.hypot(this.key0[0] - L.c[0], this.key0[1] - L.c[1]);
  },
  // 137.8-138.6: the sea of scene 11 dissolves into this ink, closing in from the edges toward the knot's centre
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
    // handing over to scene 13 (144.4-145.4): the knot goes into this scene's own frame, which scene 13's transition
    // crumbles into dust
    if (ctx.layer && ctx.layer.role === 'out' && T0 + tau > 144.0) this.drawKnot(ctx, T0 + tau, target);
  },
  overlay(ctx, tau, p, target) {
    if (ctx.layer && ctx.layer.role === 'out' && T0 + tau > 144.0) return;
    this.drawKnot(ctx, T0 + tau, target);
  },
  drawKnot(ctx, t, target) {
    const { tl } = ctx, E = tl.E, L = this.L;
    const prog = this.progress(ctx, t);
    if (prog <= 0) return;
    const rot = Math.max(0, t - 141.4) * 0.5 * DEG;
    const ka = this.keyA0 + (t > 141.4 ? 2 * Math.PI * (t - 141.4) / 6.0 : 0);
    const key = [L.c[0] + this.keyR * Math.cos(ka), L.c[1] + this.keyR * Math.sin(ka)];
    const flare = t >= 141.0 && t < 141.4 ? (t - 141.0) / 0.4 : 0;
    // the closing breath: the leaf brightens a little as the strand closes, then settles
    const close = t >= 141.0 ? Math.exp(-(t - 141.0) / 0.6) : 0;
    ctx.knot.draw(target, this.kt, { progress: prog, rotation: rot, center: L.c, key, keyZ: 400, keyI: 4 + 1.5 * close, flare, flareI: 3.2, tipI: 4.5 * tl.seg(t, 138.0, 138.6, E.inOutSine) });   // the nib lights up as the ink settles
    if (t >= 141.0 && t < 142.0) {
      const k = (t - 141.0) / 0.8;
      if (k < 1) ctx.knot.ring(target, { center: L.c, r: (L.R + 14) + 120 * E.outCubic(k), width: 3.2, I: 0.5 * Math.pow(1 - k, 2) });
      const g = (t - 141.0) / 0.5;
      if (g < 1) ctx.gold.glint(target, { x: this.start[0], y: this.start[1], size: 52, I: 3.2 * Math.sin(Math.PI * Math.pow(g, 0.4)), rot: 0.2 });
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
