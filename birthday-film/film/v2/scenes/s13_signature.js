/*
  Scene 13: signature (144.4-156.0), package P7.
  144.4-145.4 (custom transition from scene 12): the promise knot crumbles from the top down into 6,000 gold dust
  motes that drift up (each born on the ribbon where the dissolve front passes it, with an ember on the front), while
  the small bordered photograph fades in (144.6-145.6) on a night-vellum ground. The seat thread of scene 7 glows on
  it at 60 %; 147.0-148.5 (cue 'homecoming') one bright glint runs along the thread from his end to hers, hidden behind
  the people and flaring softly on the seat knot. 1,500 gold motes drift upward, light snow falls (the two far
  layers), the whole plate pushes in 3 %. 145.0: the signature (line L19a) is written with the nib and gilded by
  147.0; 146.6: line L19b. 154.0-155.0 everything fades to 40 %; 155.4 / 155.6 / 155.8 three tiny sparkles rise
  above the plate (the jig pickup, events 'pickup'). Transition out: the gold ink bleed into scene 14 (owned there).
  The knot's geometry is the spec's promise knot (core/knot.js promiseKnot at the scene-12 layout, 0.5 deg/s since 141.4).
*/
import { createBackdrop, createSnow } from './s06_window.js';
import { promiseKnot } from '../core/knot.js';

const T0 = 144.4;
const NK = 6000, ND = 1500;

// dissolve of scene 12's frame: knot pixels crumble top-down with an ember on the front; the ground crossfades
const TRANS_FS = `
uniform sampler2D uA, uB; uniform float uU, uW; uniform vec4 uKnot; uniform vec3 uEmber;
out vec4 o;
float front(vec2 p){
  float vert = clamp((p.y - (uKnot.y - uKnot.z)) / (2.0 * uKnot.z), 0.0, 1.0);
  return 0.45 * vert + 0.55 * fbm(p / 26.0 + 4.0, 4);
}
void main(){
  vec2 uv = screenUV();
  vec4 a = texture(uA, uv), b = texture(uB, uv);
  vec2 p = framePx();
  float la = clamp(luma(a.rgb), 0.0, 4.0);
  float bright = smoothstep(0.02, 0.25, la);                 // the knot (gold) against scene 12's ink ground
  vec3 c = mix(a.rgb, b.rgb, uW);
  if (bright > 0.0){
    float d = front(p);
    float fw = 0.07;
    float m = smoothstep(d - fw, d + fw, uU);
    c = mix(a.rgb, b.rgb, mix(uW, m, bright));
    float ember = exp(-pow((uU - d) / 0.035, 2.0)) * bright * step(0.001, uU) * step(uU, 1.15);
    c += uEmber * ember * (0.6 + 0.6 * la);
  }
  o = vec4(c, 1.0);
}`;
// knot dust: home on the ribbon, birth time when the front passes, then an upward drift
const KDUST = `
uniform sampler2D uHome; uniform float uT, uU, uI; uniform vec3 uC1, uC2, uHot;
void particle(int id, out vec2 px, out float size, out vec4 col){
  vec4 h = fetchPoint(uHome, id);                            // x, y, birth (absolute s), seed
  float e = uT - h.z;
  float r1 = h11(h.w * 13.1 + 1.0), r2 = h11(h.w * 7.7 + 2.0), r3 = h11(h.w * 3.3 + 5.0);
  float life = 0.6 + 0.8 * r1;
  if (e < 0.0 || e > life){ px = vec2(-100.0); size = 1.0; col = vec4(0.0); return; }
  float v = (30.0 + 45.0 * r2) * uU;
  vec2 drift = vec2((r3 - 0.5) * 18.0 * uU * e + 7.0 * uU * sin(2.1 * e + r1 * 6.28), -v * e - 7.0 * uU * e * e);
  drift += 10.0 * uU * (1.0 - exp(-e * 1.4)) * (curl2(h.xy * 0.006 + vec2(r2 * 3.0, uT * 0.05)));
  px = h.xy + drift;
  size = (1.1 + 1.4 * r2 * r2) * uU;
  float flash = exp(-e * 7.0);
  float fade = 1.0 - smoothstep(life * 0.45, life, e);
  vec3 c = mix(uC1, uC2, r3) * (0.8 + 0.6 * r1) + uHot * flash * 2.2;
  col = vec4(c * uI, fade);
}`;
// ambient gold dust drifting up through the scene
const ADUST = `
uniform float uT, uU, uI; uniform vec3 uC1, uC2; uniform vec4 uPlate;
void particle(int id, out vec2 px, out float size, out vec4 col){
  float fi = float(id);
  float r1 = h11(fi * 1.31 + 0.2), r2 = h11(fi * 2.17 + 4.1), r3 = h11(fi * 0.71 + 8.3), r4 = h11(fi * 3.9 + 1.7);
  float v = (4.0 + 9.0 * r3) * uU;
  float span = uFrame.y + 80.0 * uU;
  float y = mod(r2 * span - v * uT, span) - 40.0 * uU;
  float x = r1 * uFrame.x + 14.0 * uU * sin(0.4 * uT * (0.5 + r4) + r2 * 30.0);
  px = vec2(x, y);
  size = (0.9 + 1.6 * r4 * r4) * uU;
  float tw = 0.65 + 0.35 * sin(uT * (0.8 + 1.6 * r3) + r1 * 40.0);
  float edge = smoothstep(0.0, 120.0 * uU, y) * (1.0 - smoothstep(uFrame.y - 120.0 * uU, uFrame.y, y));
  vec2 bq = abs(px - uPlate.xy) - uPlate.zw;
  float inPlate = 1.0 - 0.85 * (1.0 - smoothstep(-8.0, 24.0, max(bq.x, bq.y)));   // the dust drifts mostly over the vellum, not the faces
  col = vec4(mix(uC1, uC2, r3) * (0.35 + 0.65 * r4) * uI * tw, edge * inPlate);
}`;

const scene = {
  id: 's13_signature', t0: 144.4, t1: 156.0, internalScale: 1, look: 'photo',
  async init(ctx) {
    const { G, glsl, particles } = ctx;
    this.backdrop = createBackdrop(ctx);
    this.snow = createSnow(ctx);
    this.P = { trans: G.program('s13.trans', glsl.frag(TRANS_FS)), kdust: particles.program('s13.kdust', KDUST), adust: particles.program('s13.adust', ADUST) };
    const pp = ctx.post.params('photo');
    const S = h => ctx.displayToScene(h, pp);
    const pw = ctx.post.params('winter_gold');
    this.col = { vel0: S('#120D09'), vel1: S('#07080C'), c1: ctx.displayToScene('#D4A64A', pw), c2: ctx.displayToScene('#E9C676', pw), hot: [1.0, 0.92, 0.75],
      ember: ctx.displayToScene('#E3B341', pw).map(v => v * 1.6) };
    this.lay = ctx.portrait
      ? { ctr: [540, 760], w: 900, knot: [540, 860, 190], y19a: 1220, y19b: 1290, size19b: 40, spark: [[430, 300], [540, 282], [650, 264]] }
      : { ctr: [960, 430], w: 640, knot: [960, 470, 170], y19a: 790, y19b: 850, size19b: 34, spark: [[876, 140], [960, 124], [1044, 108]] };
    // the knot as scene 12 leaves it (rotating 0.5 deg/s after 141.4)
    const [kx, ky, R] = this.lay.knot;
    const kn = promiseKnot({ cx: kx, cy: ky, R, rotation: (0.5 * (144.4 - 141.4)) * Math.PI / 180 });
    const rnd = ctx.rng('s13.knotdust');
    const data = new Float32Array(NK * 4);
    const n = kn.pts.length / 2;
    for (let i = 0; i < NK; i++) {
      const j = Math.floor(rnd() * n);
      const a = kn.ang ? kn.ang[j] : 0;
      const off = (rnd() - 0.5) * 13 * ctx.U;
      const x = kn.pts[j * 2] - Math.sin(a) * off, y = kn.pts[j * 2 + 1] + Math.cos(a) * off;
      const vert = Math.min(1, Math.max(0, (y - (ky - R)) / (2 * R)));
      const d = 0.45 * vert + 0.55 * (0.25 + 0.5 * rnd());       // the same law as the dissolve front (noise replaced by a draw)
      data[i * 4] = x; data[i * 4 + 1] = y; data[i * 4 + 2] = 144.4 + 0.9 * (d + 0.08) / 1.16; data[i * 4 + 3] = i + 0.5;
    }
    this.kHome = particles.pointsTexture(data, 4);
    const pk = ctx.events('pickup');
    this.pickup = pk.length ? pk.map(e => e.t) : [155.4, 155.6, 155.8];
  },
  fade(ctx, t) { return 1 - 0.6 * ctx.tl.seg(t, 154.0, 155.0, ctx.tl.E.inOutSine); },
  cam(ctx, t) {
    const L = this.lay, push = 1 + 0.03 * ctx.tl.seg(t, 144.4, 156.0, ctx.tl.E.inOutSine);
    const m = window.PHOTO_META, w = L.w * push, h = w * m.size[1] / m.size[0];
    return ctx.photoCamera([0, 0, m.size[0], m.size[1]], { dest: [L.ctr[0] - w / 2, L.ctr[1] - h / 2, w, h], tag: 's13' });
  },
  render(ctx, tau, p, target) {
    const { tl } = ctx, E = tl.E, PH = ctx.photoR, K = ctx.knot;
    const t = T0 + tau, L = this.lay, m = window.PHOTO_META;
    const F = this.fade(ctx, t);
    this.backdrop(target, { inner: this.col.vel0.map(v => v * (0.6 + 0.4 * F)), outer: this.col.vel1, center: L.ctr, radius: 0.8 });
    this.snow(target, { t: t - 100.0, I: 0.8 * F, maxLayer: 1, look: 'photo' });
    const show = tl.seg(t, 144.6, 145.6, E.inOutSine) * F;
    const cam = this.cam(ctx, t);
    const r = cam.dest;
    if (show > 0.001) {
      PH.draw(target, cam, { opacity: show });
      const gx = tl.seg(t, 147.0, 148.5, E.outQuad) * m.size[0];
      const glint = t > 147.0 && t < 148.6 ? gx : null;
      PH.thread(target, cam, { tip: m.size[0], steady: 0.6, I: show, knot: 1, knotI: 1.2, glint, glintI: 4 * (1 - tl.seg(t, 148.3, 148.6)), fresh: 0 });
      const rect = [r[0] - 35, r[1] - 35, r[2] + 70, r[3] + 70];
      K.band.rect(target, { rect, width: 34, amp: 9, halfWidth: 4.6, omega: 2 * Math.PI / 46, progress: 1, roundels: false, look: 'photo', opacity: show,
        key: [L.ctr[0] - 420 + 260 * tl.seg(t, 144.4, 156), L.ctr[1] - 520], keyZ: 520 });
    }
    if (t >= 145.4) this.knotDust(ctx, t, target);
    ctx.particles.draw(this.P.adust, ND, { uT: t - 140.0, uU: ctx.U, uI: 0.55 * F * tl.seg(t, 144.6, 146.0), uC1: this.col.c1, uC2: this.col.c2,
      uPlate: [r[0] + r[2] / 2, r[1] + r[3] / 2, r[2] / 2 + 52, r[3] / 2 + 52] }, target);
  },
  knotDust(ctx, t, target) {
    if (t > 147.6) return;
    ctx.particles.draw(this.P.kdust, NK, { uHome: this.kHome, uT: t, uU: ctx.U, uI: 0.9, uC1: this.col.c1, uC2: this.col.c2, uHot: this.col.hot }, target);
  },
  transition(ctx, w, outRT, inRT, dst) {
    const t = ctx.t, L = this.lay;
    const u = ctx.tl.seg(t, 144.4, 145.3) * 1.16 - 0.08;
    ctx.G.draw(this.P.trans, { uA: outRT, uB: inRT, uU: u, uW: w, uKnot: [L.knot[0], L.knot[1], L.knot[2] * 1.45, 0], uEmber: this.col.ember }, dst);
    this.knotDust(ctx, t, dst);
  },
  overlay(ctx, tau, p, target) {
    const t = T0 + tau, L = this.lay;
    for (let i = 0; i < 3; i++) {
      const life = ctx.tl.seg(t, this.pickup[i] - 0.02, this.pickup[i] + 0.38);
      if (life <= 0 || life >= 1) continue;
      const env = Math.sin(Math.PI * Math.pow(life, 0.5));
      ctx.gold.glint(target, { x: L.spark[i][0], y: L.spark[i][1], size: (14 + 4 * i) * ctx.U, I: 3.2 * env, rot: 0.15 + 0.2 * i, col: this.col.hot });
    }
  },
  captions(ctx, tau) {
    const t = T0 + tau, L = this.lay, out = [];
    if (t >= 145.0 && t < 155.1) {
      out.push(...ctx.text.nibEntries({
        lineId: 'L19a', tau: t - 145.0, x: ctx.W / 2, y: L.y19a, style: { base: 'script', size: 64 }, enter: { base: 'nib', dur: 1.6 },
        gild: { at: 1.6, dur: 0.4, feather: 50 }, exit: { at: 9.0, kind: 'opacity', dur: 1.0 },
        gold: { look: 'photo', key: [ctx.W / 2 - 200, L.y19a - 240], keyZ: 280, keyI: 3.6 },
      }));
    }
    if (t >= 146.6 && t < 155.1) out.push({ lineId: 'L19b', tau: t - 146.6, x: ctx.W / 2, y: L.y19b, style: { base: 'narrative', size: L.size19b, color: '#EDE3D2', opacity: 0.88 },
      exit: { at: 7.4, kind: 'default', dur: 1.0 } });
    return out;
  },
  post(ctx, tau) { return ctx.photoR.postParams(this.cam(ctx, T0 + tau)); },
};
export default scene;
