/*
  Scene 8: honest (90.0-108.0), package P7.
  90.0-92.95 the photograph recedes from full bleed back into its gilded plate (the window layout of scene 6, the
  border gathering round it as it arrives, 90.1-90.9), eases on to 0.6 of that size and sinks into darkness (-3 EV over
  91.0-92.5) while ink closes in round it (a soft, fbm-broken vignette that stops outside the faces; the faces then
  fade out whole). The seat thread of scene 7 stays faintly lit on it as it goes.
  Then a deep ink ground with an almost imperceptible vellum fibre and one ornament: a short tapering gold hairline
  70 px over the cap height of line L12 (93.0-98.4), in upright roman. 99.0: line L13a in roman; from 101.7 a faint warm
  glow rises behind line L13b and follows the nib as it is written 102.0-104.0 in iron-gall ink (the scratch in the
  score follows the same nib profile). 104.0: the
  frame holds absolutely still for 0.3 s (cue 'heart_cry'); then gold leaf is laid on the wet ink from left to right,
  its specular sweep landing at 105.2 (cue 'gild'). Both lines fade 106.6-107.6 and the gold glints once as it goes.
  Transition out: the ink bleed into scene 9 (107.4-108.6, owned by scene 9).
*/
import { windowLayout, bandAround, createBackdrop } from './s06_window.js';
import { cam7, fullRect, createMist } from './s07_beside_you.js';

const T0 = 90.0;

// the hairline: gold, never flat (a soft specular glint travels along it), tapering strongly to fine points
const HAIR_FS = `
uniform vec4 uSeg; uniform float uW, uI, uT; uniform vec3 uCore, uGlow, uSpec;
out vec4 o;
void main(){
  vec2 p = framePx();
  float hl = uSeg.z * 0.5;
  float along = clamp(abs(p.x - uSeg.x) / max(hl, 1.0), 0.0, 1.0);
  float taper = 1.0 - 0.9 * smoothstep(0.4, 1.0, along);
  float hw = uW * 0.5 * (0.45 + 0.55 * taper);
  float dx = max(abs(p.x - uSeg.x) - hl, 0.0), dy = abs(p.y - uSeg.y);
  float d = length(vec2(dx, dy));
  float fw = 0.75;
  float core = 1.0 - smoothstep(hw - fw, hw + fw, d);
  // a specular travelling along the leaf (left to right, about 3 s a pass) and a faint leaf grain
  float u = (p.x - uSeg.x) / max(uSeg.z, 1.0) + 0.5;
  float sp = exp(-pow((u - fract(uT * 0.33) * 1.6 + 0.3) / 0.08, 2.0));
  float grain = 0.97 + 0.06 * fbm(vec2(p.x / 6.0, 3.1), 2);
  float glow = exp(-d * d / 18.0) * 0.35 + exp(-d / 9.0) * 0.12;
  o = vec4(((uCore * grain + uSpec * sp * 0.6) * core + uGlow * glow) * taper * uI, 0.0);
}`;
// ink closing in round the receding plate: premultiplied ink outside a soft, fbm-broken circle
const INK_FS = `
uniform vec2 uC; uniform float uR, uF, uA; uniform vec3 uInk;
out vec4 o;
void main(){
  vec2 p = framePx();
  float d = length(p - uC) + (fbm(p / 60.0 + 5.3, 4) - 0.5) * 2.0 * uF;
  float a = uA * smoothstep(uR - uF, uR + uF, d);
  o = vec4(uInk * a, a);
}`;
const GLOW_FS = `
uniform vec4 uE; uniform vec3 uC; uniform float uI;
out vec4 o;
void main(){
  vec2 q = (framePx() - uE.xy) / uE.zw;
  float r2 = dot(q, q);
  float n = 0.9 + 0.2 * fbm(framePx() / 90.0 + 3.0, 3);
  o = vec4(uC * uI * exp(-r2 * 2.2) * n, 0.0);
}`;

const scene = {
  id: 's08_honest', t0: 90.0, t1: 108.0, internalScale: 1, look: 'photo',
  async init(ctx) {
    const { G, glsl } = ctx;
    this.Lw = windowLayout(ctx);
    this.backdrop = createBackdrop(ctx);
    this.mist = createMist(ctx);
    this.P = { hair: G.program('s08.hair', glsl.frag(HAIR_FS)), glow: G.program('s08.glow', glsl.frag(GLOW_FS)), ink: G.program('s08.ink', glsl.frag(INK_FS)),
      scrim: G.program('s08.scrim', glsl.frag(`uniform vec2 uY; uniform float uA; out vec4 o;
void main(){ float y = framePx().y; float k = clamp((y - uY.x) / (uY.y - uY.x), 0.0, 1.0); k = k * k * (3.0 - 2.0 * k) * 0.55 + k * 0.45; o = vec4(0.0, 0.0, 0.0, uA * 0.58 * k); }`)) };
    const pw = ctx.post.params('winter_gold');
    const S = h => ctx.displayToScene(h, pw);
    this.col = { ink: S('#07080C'), ink2: S('#0B0A0D'), core: S('#C9A25A').map(v => v * 0.75), spec: S('#FFE7A3'), glowH: S('#6E4A12').map(v => v * 0.5), warm: S('#2A1A10') };
    this.full = fullRect(cam7(ctx, 90.0));
    const L = this.Lw, m = window.PHOTO_META;
    const ph = L.plateW * m.size[1] / m.size[0];
    this.plate = [L.plateC[0] - L.plateW / 2, L.plateC[1] - ph / 2, L.plateW, ph];
    const k = 0.6;
    this.small = [L.plateC[0] - L.plateW * k / 2, L.plateC[1] - ph * k / 2, L.plateW * k, ph * k];
    this.lay = ctx.portrait
      ? { x: 540, hair: 806, y12: 900, y13a: 900, y13b: 1010, size: 45, script: 65, breaks12: [4] }
      : { x: 960, hair: 458, y12: 560, y13a: 500, y13b: 610, size: 50, script: 72, breaks12: null };
  },
  // the receding photo rect at time t
  rectAt(ctx, t) {
    const { tl } = ctx, E = tl.E;
    const a = tl.seg(t, 90.0, 91.8, E.inOutSine), b = tl.seg(t, 91.6, 92.9, E.inOutSine);
    const r1 = this.full.map((v, i) => v + (this.plate[i] - v) * a);
    return r1.map((v, i) => v + (this.small[i] - v) * b);
  },
  render(ctx, tau, p, target) {
    const { G, tl } = ctx, E = tl.E, PH = ctx.photoR, K = ctx.knot;
    const t = T0 + tau, Ly = this.lay;
    this.backdrop(target, { inner: this.col.ink2, outer: this.col.ink, center: [ctx.W / 2, ctx.H / 2], radius: 0.95, fibre: 0.015 });
    if (t < 93.0) {
      const r = this.rectAt(ctx, t);
      const leave = 1 - tl.seg(t, 90.0, 91.0, E.inOutSine);            // portrait: scene 7's warm mist and soft edges
      if (ctx.portrait) this.mist(target, t, leave);
      const sink = tl.seg(t, 91.0, 92.5, E.inOutSine);
      const fade = 1 - tl.seg(t, 92.3, 92.95, E.inOutSine);
      const cam = ctx.photoCamera([0, 0, window.PHOTO_META.size[0], window.PHOTO_META.size[1]], { dest: r, tag: 's08' });
      PH.draw(target, cam, { exposure: -3 * sink, opacity: fade, edgeFade: ctx.portrait && leave > 0 ? { top: 80 * leave, bottom: 80 * leave } : null });
      // the seat thread (no knot glyph), quieter once the plate is small
      const small = tl.seg(t, 91.6, 92.9, E.inOutSine);
      PH.thread(target, cam, { tip: window.PHOTO_META.size[0], steady: 0.7, I: Math.pow(2, -3 * sink) * fade * (1 - 0.6 * small), fresh: 0 });
      // the gilded border gathers round the photo as it arrives in the window layout, then sinks with it
      // (portrait: only once its sides are inside the frame, never as two bare full-width bars)
      const bo = tl.seg(t, 90.1, 90.9, E.inOutSine) * fade * (ctx.portrait ? 1 - tl.seg(r[2] * 1.2, 1000, 1150) : 1);
      if (bo > 0.002) K.band.rect(target, bandAround(ctx, r, { progress: 1, opacity: bo, tint: [1, 1, 1].map(v => v * Math.pow(2, -3 * sink)),
        key: [r[0] - 0.3 * r[2], r[1] - 0.8 * r[3]], keyZ: 500 * r[2] / 1000 }));
      // ink closes in round the plate (91.8-92.9), centred between the faces and stopping just outside them
      const ia = tl.seg(t, 91.8, 92.3, E.inOutSine);
      if (ia > 0.002) {
        const fe = ctx.faceEllipses(cam);
        const mid = [(fe[0][0] + fe[1][0]) / 2, (fe[0][1] + fe[1][1]) / 2];
        const F = 30 * ctx.U;
        const rMin = Math.max(...fe.map(e => Math.hypot(e[0] - mid[0], e[1] - mid[1]) + 0.8 * Math.max(e[2], e[3]))) + 2 * F;
        const diag = Math.hypot(r[2], r[3]);
        const R = 1.2 * diag + (rMin - 1.2 * diag) * tl.seg(t, 91.8, 92.9, E.inOutSine);
        G.draw(this.P.ink, { uC: mid, uR: R, uF: F, uA: ia, uInk: this.col.ink2 }, target, { blend: 'premul' });
      }
      // scene 7's caption scrim leaves with the full bleed
      const sa = 1 - tl.seg(t, 90.0, 90.8, E.inOutSine);
      if (!ctx.portrait && sa > 0) G.draw(this.P.scrim, { uY: [800, 1080], uA: sa }, target, { blend: 'premul' });
    }
    // the hairline over line L12: drawn from the centre outward, then gone with the line
    const hd = tl.seg(t, 93.0, 94.2, E.outCubic), hx = 1 - tl.seg(t, 97.6, 98.4, E.inOutSine);
    if (hd > 0 && hx > 0) {
      const len = 200 * ctx.U * hd;
      G.draw(this.P.hair, { uSeg: [Ly.x, Ly.hair, len, 0], uW: 1.6, uI: hx, uT: t - 93.0, uCore: this.col.core, uGlow: this.col.glowH, uSpec: this.col.spec }, target,
        { blend: 'add', viewport: vp(ctx, target, [Ly.x - 140, Ly.hair - 30, 280, 60]) });
    }
    // the faint warm glow behind line L13b: it rises just before the nib and widens with the written front (still
    // through the held breath at 104.0)
    const gw = tl.seg(t, 101.7, 103.2, E.inOutSine) * (1 - tl.seg(t, 106.6, 107.6, E.inOutSine));
    if (gw > 0) {
      const nf = tl.seg(t, 102.0, 104.0, E.inOutSine), U = ctx.U;
      const ex = Ly.x - 340 * U + 340 * U * nf, ew = (120 + 220 * nf) * U;
      G.draw(this.P.glow, { uE: [ex, Ly.y13b - 22, ew, 75 * U], uC: this.col.warm, uI: gw }, target,
        { blend: 'add', viewport: vp(ctx, target, [Ly.x - 760, Ly.y13b - 230, 1520, 420]) });
    }
  },
  captions(ctx, tau) {
    const t = T0 + tau, Ly = this.lay, out = [];
    const roman = { base: 'roman', size: Ly.size };
    if (t >= 93.0 && t < 98.5) out.push({ lineId: 'L12', tau: t - 93.0, x: Ly.x, y: Ly.y12, style: roman, breaks: Ly.breaks12, enter: { base: 'opacity', dur: 1.0 }, exit: { at: 4.6, kind: 'opacity', dur: 0.8 } });
    if (t >= 99.0 && t < 107.7) out.push({ lineId: 'L13a', tau: t - 99.0, x: Ly.x, y: Ly.y13a, style: roman, enter: { base: 'opacity', dur: 1.0 }, exit: { at: 7.6, kind: 'opacity', dur: 1.0 } });
    if (t >= 102.0 && t < 107.7) {
      const e = {
        lineId: 'L13b', tau: t - 102.0, x: Ly.x, y: Ly.y13b, style: { base: 'script', size: Ly.script }, enter: { base: 'nib', dur: 2.0 },
        exit: { at: 4.6, kind: 'opacity', dur: 1.0 },
        // the held breath: nothing moves 104.0-104.3, then the leaf is laid and its sweep lands at 105.2
        gild: { at: 2.3, dur: 0.9 },
        glints: [{ at: 4.85, x: Ly.x + 150 * ctx.U, y: Ly.y13b - 30 * ctx.U, size: 26, I: 3.2, dur: 0.45 }],
        gold: { look: 'winter_gold', key: [Ly.x - 260, Ly.y13b - 260], keyZ: 300, keyI: 4 },
      };
      out.push(...ctx.text.nibEntries(e));
    }
    return out;
  },
  lookAt(ctx, tau) {
    const w = ctx.tl.seg(T0 + tau, 92.4, 93.0);
    return w <= 0 ? 'photo' : w >= 1 ? 'winter_gold' : [{ look: 'photo', w: 1 - w }, { look: 'winter_gold', w }];
  },
};
function vp(ctx, target, r) {
  const s = target.scale == null ? 1 : target.scale;
  const x0 = Math.max(0, Math.floor(r[0] * s)), x1 = Math.min(target.w, Math.ceil((r[0] + r[2]) * s));
  const y0 = Math.max(0, Math.floor((ctx.H - r[1] - r[3]) * s)), y1 = Math.min(target.h, Math.ceil((ctx.H - r[1]) * s));
  return [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
}
export default scene;
