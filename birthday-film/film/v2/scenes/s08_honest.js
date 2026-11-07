/*
  Scene 8: honest (90.0-108.0), package P7.
  90.0-92.5 the photograph recedes from full bleed back into its gilded plate (the window layout of scene 6, the border
  gathering round it as it arrives), then the plate shrinks to 0.35 of that size and sinks into darkness (-3 EV over
  91.0-92.5). The seat thread of scene 7 stays lit on it as it goes.
  Then a deep ink ground with an almost imperceptible vellum fibre and one ornament: a short gold hairline over line L12
  (93.0-98.4), in upright roman. 99.0: line L13a in roman; a faint warm glow rises behind the place of line L13b, which
  is written 102.0-104.0 in iron-gall ink with a nib (the scratch in the score follows the same nib profile). 104.0: the
  frame holds absolutely still for 0.3 s (cue 'heart_cry'); then gold leaf is laid on the wet ink from left to right,
  its specular sweep landing at 105.2 (cue 'gild'). Both lines fade 106.6-107.6 and the gold glints once as it goes.
  Transition out: the ink bleed into scene 9 (107.4-108.6, owned by scene 9).
*/
import { windowLayout, bandAround, createBackdrop } from './s06_window.js';
import { cam7, fullRect, createMist } from './s07_beside_you.js';

const T0 = 90.0;

const HAIR_FS = `
uniform vec4 uSeg; uniform float uW, uI; uniform vec3 uCore, uGlow;
out vec4 o;
void main(){
  vec2 p = framePx();
  float hl = uSeg.z * 0.5;
  float dx = max(abs(p.x - uSeg.x) - hl, 0.0), dy = abs(p.y - uSeg.y);
  float d = length(vec2(dx, dy));
  float fw = 0.75;
  float core = 1.0 - smoothstep(uW * 0.5 - fw, uW * 0.5 + fw, d);
  // the ink thins towards the ends of the stroke
  float along = clamp(abs(p.x - uSeg.x) / max(hl, 1.0), 0.0, 1.0);
  float taper = 1.0 - 0.55 * smoothstep(0.55, 1.0, along);
  float glow = exp(-d * d / 18.0) * 0.35 + exp(-d / 9.0) * 0.12;
  o = vec4((uCore * core + uGlow * glow) * taper * uI, 0.0);
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
    this.P = { hair: G.program('s08.hair', glsl.frag(HAIR_FS)), glow: G.program('s08.glow', glsl.frag(GLOW_FS)),
      scrim: G.program('s08.scrim', glsl.frag(`uniform vec2 uY; uniform float uA; out vec4 o;
void main(){ float y = framePx().y; float k = clamp((y - uY.x) / (uY.y - uY.x), 0.0, 1.0); k = k * k * (3.0 - 2.0 * k) * 0.55 + k * 0.45; o = vec4(0.0, 0.0, 0.0, uA * 0.45 * k); }`)) };
    const pw = ctx.post.params('winter_gold');
    const S = h => ctx.displayToScene(h, pw);
    this.col = { ink: S('#07080C'), ink2: S('#0B0A0D'), core: S('#B8862B').map(v => v * 0.7), glowH: S('#6E4A12').map(v => v * 0.5), warm: S('#2A1A10') };
    this.full = fullRect(cam7(ctx, 90.0));
    const L = this.Lw, m = window.PHOTO_META;
    const ph = L.plateW * m.size[1] / m.size[0];
    this.plate = [L.plateC[0] - L.plateW / 2, L.plateC[1] - ph / 2, L.plateW, ph];
    const k = 0.35;
    this.small = [L.plateC[0] - L.plateW * k / 2, L.plateC[1] - ph * k / 2, L.plateW * k, ph * k];
    this.lay = ctx.portrait
      ? { x: 540, hair: 830, y12: 900, y13a: 900, y13b: 1010, size: 45, script: 65, breaks12: [4] }
      : { x: 960, hair: 490, y12: 560, y13a: 500, y13b: 610, size: 50, script: 72, breaks12: null };
  },
  // the receding photo rect at time t
  rectAt(ctx, t) {
    const { tl } = ctx, E = tl.E;
    const a = tl.seg(t, 90.0, 91.6, E.inOutCubic), b = tl.seg(t, 91.2, 92.5, E.inOutCubic);
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
      PH.thread(target, cam, { tip: window.PHOTO_META.size[0], steady: 0.7, knot: 1, I: Math.pow(2, -3 * sink) * fade, fresh: 0 });
      // the gilded border gathers round the photo as it arrives in the window layout, then sinks with it
      const bo = tl.seg(t, 90.45, 91.35, E.inOutSine) * fade;
      if (bo > 0.002) K.band.rect(target, bandAround(ctx, r, { progress: 1, opacity: bo, tint: [1, 1, 1].map(v => v * Math.pow(2, -3 * sink)),
        key: [r[0] - 0.3 * r[2], r[1] - 0.8 * r[3]], keyZ: 500 * r[2] / 1000 }));
      // scene 7's caption scrim leaves with the full bleed
      const sa = 1 - tl.seg(t, 90.0, 90.8, E.inOutSine);
      if (!ctx.portrait && sa > 0) G.draw(this.P.scrim, { uY: [760, 1080], uA: sa }, target, { blend: 'premul' });
    }
    // the hairline over line L12: drawn from the centre outward, then gone with the line
    const hd = tl.seg(t, 93.0, 94.2, E.outCubic), hx = 1 - tl.seg(t, 97.6, 98.4, E.inOutSine);
    if (hd > 0 && hx > 0) {
      const len = 240 * ctx.U * hd;
      G.draw(this.P.hair, { uSeg: [Ly.x, Ly.hair, len, 0], uW: 1.5, uI: hx, uCore: this.col.core, uGlow: this.col.glowH }, target,
        { blend: 'add', viewport: vp(ctx, target, [Ly.x - 160, Ly.hair - 30, 320, 60]) });
    }
    // the faint warm glow behind line L13b (still through the held breath at 104.0)
    const gw = tl.seg(t, 99.0, 101.5, E.inOutSine) * (1 - tl.seg(t, 106.6, 107.6, E.inOutSine));
    if (gw > 0) G.draw(this.P.glow, { uE: [Ly.x, Ly.y13b - 22, 340 * ctx.U, 75 * ctx.U], uC: this.col.warm, uI: gw }, target,
      { blend: 'add', viewport: vp(ctx, target, [Ly.x - 600, Ly.y13b - 230, 1200, 420]) });
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
