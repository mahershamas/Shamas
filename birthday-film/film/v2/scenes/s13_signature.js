/*
  Scene 13: signature (144.4-156.0), package P7.
  144.4-145.0 (custom transition from scene 12, window 144.4-145.4): the promise knot crumbles from the top down into
  6,000 gold dust motes (each born on the ribbon where the dissolve front passes it, with an ember on the front) that
  drift upward and outward away from the plate and are gone by 145.8; the ground crossfades to night vellum. Only then
  does the bordered photograph fade in (145.5-146.3): no mote is ever drawn over the plate once it shows, nor over
  either face. The plate's braid border turns its corners under four small spiral roundels. The seat thread of
  scene 7 glows on it at 60 % (no knot glyph); 147.0-149.0 (cue 'homecoming') one bright glint runs along the thread
  from his end to hers, a soft round bead that lingers on the exposed seat at either end. 1,500 gold motes drift upward
  (never over the faces), light snow falls (the two far layers, never over the faces), the whole plate pushes in 4 %
  and a key light sweeps once across the border (147-154). 145.0: the signature (line L19a) is written with the nib
  and gilded by 147.0; 146.6: line L19b. 154.0-155.0 everything fades to 40 %; 155.4 / 155.6 / 155.8 three tiny
  sparkles rise above the plate (the jig pickup, events 'pickup'). Transition out: the gold ink bleed into scene 14
  (owned there).
  The knot's geometry is the spec's promise knot (core/knot.js promiseKnot at the scene-12 layout, 0.5 deg/s since 141.4).
*/
import { createBackdrop, createSnow } from './s06_window.js';
import { promiseKnot } from '../core/knot.js';
import { drawCaptionBands } from './s04_two_shores.js';

const T0 = 144.4;
const NK = 6000, ND = 1500;

// dissolve of scene 12's frame: knot pixels crumble top-down with an ember on the front; the ground crossfades
const TRANS_FS = `
uniform sampler2D uA, uB; uniform float uU, uW; uniform vec4 uKnot; uniform vec3 uEmber; uniform vec2 uTexel;
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
  // the knot (gold) against scene 12's ink ground, dilated by about 5 px so that its dark keyline crumbles with it
  // instead of lingering as a ghost outline
  float bright = smoothstep(0.02, 0.25, la);
  for (int i = 0; i < 8; i++){
    float an = float(i) * 0.7853982;
    vec2 off = vec2(cos(an), sin(an)) * 5.0 * uTexel;
    bright = max(bright, smoothstep(0.02, 0.25, clamp(luma(texture(uA, uv + off).rgb), 0.0, 4.0)));
  }
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
// knot dust: home on the ribbon, birth time when the front passes, then a drift upward and outward from the knot's
// centre (away from where the plate will be), short-lived; never drawn over the shown plate or the faces
const KDUST = `
uniform sampler2D uHome; uniform float uT, uU, uI, uShow; uniform vec3 uC1, uC2, uHot; uniform vec2 uKC; uniform vec4 uPlate, uFaceA, uFaceB;
float inE(vec4 e, vec2 p){ return e.z > 0.0 ? 1.0 - smoothstep(0.9, 1.25, length((p - e.xy) / e.zw)) : 0.0; }
void particle(int id, out vec2 px, out float size, out vec4 col){
  vec4 h = fetchPoint(uHome, id);                            // x, y, birth (absolute s), seed
  float e = uT - h.z;
  float r1 = h11(h.w * 13.1 + 1.0), r2 = h11(h.w * 7.7 + 2.0), r3 = h11(h.w * 3.3 + 5.0);
  float life = 0.35 + 0.4 * r1;
  if (e < 0.0 || e > life){ px = vec2(-100.0); size = 1.0; col = vec4(0.0); return; }
  vec2 out_ = h.xy - uKC; out_ = length(out_) > 1e-3 ? normalize(out_) : vec2(0.0, -1.0);
  float v = (80.0 + 60.0 * r2) * uU, vo = (40.0 + 50.0 * r3) * uU;
  vec2 drift = out_ * (vo * e + 30.0 * uU * e * e) + vec2(7.0 * uU * sin(2.1 * e + r1 * 6.28), -v * e - 60.0 * uU * e * e);
  drift += 10.0 * uU * (1.0 - exp(-e * 1.4)) * (curl2(h.xy * 0.006 + vec2(r2 * 3.0, uT * 0.05)));
  px = h.xy + drift;
  size = (1.1 + 1.4 * r2 * r2) * uU;
  float flash = exp(-e * 7.0);
  float fade = 1.0 - smoothstep(life * 0.45, life, e);
  vec2 bq = abs(px - uPlate.xy) - uPlate.zw;
  float inPlate = 1.0 - smoothstep(-6.0, 24.0, max(bq.x, bq.y));
  fade *= (1.0 - uShow * inPlate) * (1.0 - max(inE(uFaceA, px), inE(uFaceB, px)));
  vec3 c = mix(uC1, uC2, r3) * (0.8 + 0.6 * r1) + uHot * flash * 2.2;
  col = vec4(c * uI, fade);
}`;
// ambient gold dust drifting up through the scene
const ADUST = `
uniform float uT, uU, uI; uniform vec3 uC1, uC2; uniform vec4 uPlate, uFaceA, uFaceB;
float inE(vec4 e, vec2 p){ return e.z > 0.0 ? 1.0 - smoothstep(0.9, 1.25, length((p - e.xy) / e.zw)) : 0.0; }
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
  float inPlate = 1.0 - 0.85 * (1.0 - smoothstep(-8.0, 24.0, max(bq.x, bq.y)));   // the dust drifts mostly over the vellum
  inPlate *= 1.0 - max(inE(uFaceA, px), inE(uFaceB, px));                            // and never over the faces
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
    // the plate (photo width w, centred on ctr) is the last view of the photograph: large, with the signature and the
    // line below it; the three pickup sparkles rise just above the border
    this.lay = ctx.portrait
      // portrait: the from-line at 52 px (phone-width floor) and the signature at 80 px, so it stays clearly beneath it
      ? { ctr: [540, 860], w: 800, knot: [540, 860, 240], knotRib: 18, y19a: 1352, y19b: 1436, size19a: 80, size19b: 52, spark: [[440, 470], [540, 454], [640, 438]] }
      : { ctr: [960, 425], w: 740, knot: [960, 470, 170], knotRib: 14, y19a: 822, y19b: 880, size19a: 64, size19b: 38, spark: [[880, 70], [960, 56], [1040, 42]] };
    // the knot as scene 12 leaves it (rotating 0.5 deg/s after 141.4)
    const [kx, ky, R] = this.lay.knot;
    const kn = promiseKnot({ cx: kx, cy: ky, R, rotation: (0.5 * (144.4 - 141.4)) * Math.PI / 180 });
    const rnd = ctx.rng('s13.knotdust');
    const data = new Float32Array(NK * 4);
    const n = kn.pts.length / 2;
    for (let i = 0; i < NK; i++) {
      const j = Math.floor(rnd() * n);
      const a = kn.ang ? kn.ang[j] : 0;
      const off = (rnd() - 0.5) * (this.lay.knotRib - 1) * ctx.U;
      const x = kn.pts[j * 2] - Math.sin(a) * off, y = kn.pts[j * 2 + 1] + Math.cos(a) * off;
      const vert = Math.min(1, Math.max(0, (y - (ky - R)) / (2 * R)));
      const d = 0.45 * vert + 0.55 * (0.25 + 0.5 * rnd());       // the same law as the dissolve front (noise replaced by a draw)
      data[i * 4] = x; data[i * 4 + 1] = y; data[i * 4 + 2] = 144.4 + 0.6 * (d + 0.08) / 1.16; data[i * 4 + 3] = i + 0.5;
    }
    this.kHome = particles.pointsTexture(data, 4);
    const pk = ctx.events('pickup');
    this.pickup = pk.length ? pk.map(e => e.t) : [155.4, 155.6, 155.8];
  },
  fade(ctx, t) { return 1 - 0.6 * ctx.tl.seg(t, 154.0, 155.0, ctx.tl.E.inOutSine); },
  cam(ctx, t) {
    const L = this.lay, push = 1 + 0.04 * ctx.tl.seg(t, 144.4, 156.0, ctx.tl.E.inOutSine);
    const m = window.PHOTO_META, w = L.w * push, h = w * m.size[1] / m.size[0];
    return ctx.photoCamera([0, 0, m.size[0], m.size[1]], { dest: [L.ctr[0] - w / 2, L.ctr[1] - h / 2, w, h], tag: 's13' });
  },
  show(ctx, t) { return ctx.tl.seg(t, 145.5, 146.3, ctx.tl.E.inOutSine) * this.fade(ctx, t); },
  render(ctx, tau, p, target) {
    const { tl } = ctx, E = tl.E, PH = ctx.photoR, K = ctx.knot;
    const t = T0 + tau, L = this.lay, m = window.PHOTO_META;
    const F = this.fade(ctx, t);
    const show = this.show(ctx, t);
    const cam = this.cam(ctx, t);
    const r = cam.dest, faces = ctx.faceEllipses(cam);
    this.backdrop(target, { inner: this.col.vel0.map(v => v * (0.6 + 0.4 * F)), outer: this.col.vel1, center: L.ctr, radius: 0.8 });
    this.snow(target, { t: t - 100.0, I: 0.8 * F, maxLayer: 1, look: 'photo', faces: show > 0.001 ? faces : null, plateThin: 0 });
    if (show > 0.001) {
      PH.draw(target, cam, { opacity: show });
      // the homecoming glint: eased in and out so it lingers where the seat shows at his end and at hers
      const glint = t > 147.0 && t < 149.0 ? tl.seg(t, 147.0, 149.0, E.inOutSine) * m.size[0] : null;
      PH.thread(target, cam, { tip: m.size[0], steady: 0.6, I: show, glint, glintI: 2.6 * (1 - tl.seg(t, 148.7, 149.0)), fresh: 0, width: ctx.portrait ? 2.6 : 2 });
      // the braid border, its corners turned under four small spiral roundels; a key light sweeps across it once
      const rect = [r[0] - 35, r[1] - 35, r[2] + 70, r[3] + 70];
      const kx = L.ctr[0] - 420 + 840 * tl.seg(t, 147.0, 154.0, E.inOutSine);
      K.band.rect(target, { rect, width: 34, amp: 9, halfWidth: 4.6, omega: 2 * Math.PI / 46, progress: 1, roundels: true, roundelSize: 46,
        roundelProgress: [1, 1, 1, 1], look: 'photo', opacity: show, key: [kx, L.ctr[1] - 520], keyZ: 520 });
    }
    if (t >= 145.4) this.knotDust(ctx, t, target);
    ctx.particles.draw(this.P.adust, ND, { uT: t - 140.0, uU: ctx.U, uI: 0.55 * F * tl.seg(t, 145.5, 146.8), uC1: this.col.c1, uC2: this.col.c2,
      uPlate: [r[0] + r[2] / 2, r[1] + r[3] / 2, r[2] / 2 + 52, r[3] / 2 + 52], uFaceA: faces[0], uFaceB: faces[1] }, target);
    // legibility: a feathered band under each caption row keeps the drifting motes and snow out of the type
    drawCaptionBands(ctx, target, this.captions(ctx, tau), 0.4);
  },
  knotDust(ctx, t, target) {
    if (t > 145.85) return;
    const cam = this.cam(ctx, t), r = cam.dest, faces = ctx.faceEllipses(cam);
    ctx.particles.draw(this.P.kdust, NK, { uHome: this.kHome, uT: t, uU: ctx.U, uI: 0.9, uC1: this.col.c1, uC2: this.col.c2, uHot: this.col.hot,
      uKC: [this.lay.knot[0], this.lay.knot[1]], uShow: this.show(ctx, t), uPlate: [r[0] + r[2] / 2, r[1] + r[3] / 2, r[2] / 2 + 60, r[3] / 2 + 60],
      uFaceA: faces[0], uFaceB: faces[1] }, target);
  },
  transition(ctx, w, outRT, inRT, dst) {
    const t = ctx.t, L = this.lay;
    // the knot has fully crumbled by 145.0, well before the plate appears
    const u = ctx.tl.seg(t, 144.4, 145.0) * 1.16 - 0.08;
    ctx.G.draw(this.P.trans, { uA: outRT, uB: inRT, uU: u, uW: w, uKnot: [L.knot[0], L.knot[1], L.knot[2] * 1.45, 0], uEmber: this.col.ember,
      uTexel: [1 / outRT.w, 1 / outRT.h] }, dst);
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
        lineId: 'L19a', tau: t - 145.0, x: ctx.W / 2, y: L.y19a, style: { base: 'script', size: L.size19a }, enter: { base: 'nib', dur: 1.6 },
        gild: { at: 1.6, dur: 0.4, feather: 50 }, exit: { at: 9.0, kind: 'opacity', dur: 1.0 },
        gold: { look: 'photo', key: [ctx.W / 2 - 200, L.y19a - 240], keyZ: 280, keyI: 3.6 },
      }));
    }
    if (t >= 146.6 && t < 155.1) out.push({ lineId: 'L19b', tau: t - 146.6, x: ctx.W / 2, y: L.y19b, style: { base: 'narrative', size: L.size19b, color: '#EDE3D2', opacity: 0.88 },
      exit: { at: 7.4, kind: 'default', dur: 1.0 } });
    return out;
  },
  post(ctx, tau) {
    // no frame-wide anamorphic line from the homecoming glint (147-149): it reads as a gesture on the thread
    const t = T0 + tau, k = ctx.tl.seg(t, 146.8, 147.0) * (1 - ctx.tl.seg(t, 149.0, 149.2));
    const D = ctx.post.params('photo').streak;
    return Object.assign(ctx.photoR.postParams(this.cam(ctx, t)), { ca: 0.0012,
      streak: { threshold: D.threshold + (6.0 - D.threshold) * k, strength: D.strength + (0.03 - D.strength) * k } });
  },
};
export default scene;
