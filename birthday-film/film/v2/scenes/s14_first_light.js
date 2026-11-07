/*
  Scene 14: first-light (155.0-183.0), package P8.
  A pre-dawn northern sea (core/sea.js rendered(): analytic plane, camera 3 m above the water, dolly 0.5 m/s),
  horizon y 540; the sun rises at the frame centre, the point where the two stars of scene 1 met.
  155.0-156.0 a gilded ink front closes in from the frame edges over scene 13 (custom; the photograph goes last). 156.0-165.6 the sky warms (keyed lerps: horizon #2A2A40 -> #E39A4C ->
  #FFD9A0 by 166), the last aurora (15 percent) fades out by 166.0, the gold dust of the signature drifts up into the sky.
  165.6 (cue 'jig_B') the sun's upper rim breaks the horizon as a sharp gold point and lifts to a sliver of at most 30 px
  by 172.0 (easeOutSine), with a subtle 8-ray diffraction star and a long horizontal streak; god rays (quarter
  resolution, mist-modulated) fan across the water; a glitter path of 5,000 gold sprites gated by the sea's own
  specular term opens toward the camera over 1.5 s, and every bodhran down-stroke ('jig_down' events) throws 40
  brighter glints on it for 150 ms.
  175.2 (cue 'coda') everything but the sun dims by 4 EV over 2.0 s (easeInOutCubic) while the sliver condenses into
  one point at the centre drawn with the scene-1 star-A terms (6 px core #FFF4D6, 60 px halo #D4A64A, four 140 px
  spikes at 25 percent; same look, same post settings), pulsing 0.92-1.08 over 2.5 s. 178.9 (cue 'last_light') one
  soft brightening (x1.4 over 0.3 s, then back). 179.0-181.0 fade to black (easeInQuad); the point lags 0.3 s and is the
  last thing seen; black from 181.3.
  Words: line L20a in cream (Cormorant Light, 84 px, display space) at 156.0 and the name L20b in gold leaf at 157.2,
  laid out as one centred line (two rows in portrait); a slow specular sweep crosses the name at 165.6, lit by the
  rising sun (key light at the sun). Both hold to 172.0 and fade 172.0-173.2 (opacity).
*/
import { createStar, starColours } from './s10_i_love_you.js';
import { IRIS_FS } from './s12_promise.js';

const T0 = 155.0;

const MUL_FS = `uniform float uK; out vec4 o; void main(){ o = vec4(vec3(uK), 1.0); }`;
// the signature's gold dust drifting up into the dawn sky
const DUST = `
uniform vec2 uC; uniform float uU, uVis, uW, uH; uniform vec3 uG1, uG2, uHot;
void particle(int id, out vec2 px, out float size, out vec4 col){
  float fi = float(id);
  float h1 = h11(fi * 1.13 + 0.4), h2 = h11(fi * 2.39 + 6.1), h3 = h11(fi * 0.61 + 3.3), h4 = h11(fi * 3.77 + 8.9), h5 = h11(fi * 5.31 + 1.7);
  float tb = 151.0 + h2 * 11.0;                    // seeded births (some already aloft when the scene opens)
  float life = 7.0 + 5.0 * h3;
  float age = uTau - tb;
  px = vec2(-1e4); size = 0.0; col = vec4(0.0);
  if (age <= 0.0 || age >= life) return;
  // rising from below the frame centre (where the bordered photograph stood), fanning out as they climb
  vec2 p0 = vec2(uC.x + (h1 - 0.5) * uW * 0.42 * (0.45 + 0.55 * h5), uC.y + uH * (0.55 + 0.6 * h4));
  float v = (45.0 + 50.0 * h5) * uU;
  vec2 p = p0 - vec2(0.0, v * age);
  p.x += (p0.x - uC.x) * 0.06 * age;
  p += 26.0 * uU * curl2(p * 0.003 + vec2(h1 * 5.0, uTau * 0.03)) * smoothstep(0.0, 3.0, age);
  px = p;
  float env = smoothstep(0.0, 1.5, age) * (1.0 - smoothstep(life - 2.5, life, age));
  bool spark = h3 > 0.93;
  size = (spark ? 2.4 : 3.0 + 3.0 * h4) * uU;
  float tw = 0.75 + 0.25 * sin(uTau * (3.0 + 4.0 * h5) + h1 * 30.0);
  col = vec4(spark ? uHot : mix(uG1, uG2, h2), env * uVis * tw * (spark ? 1.4 : 0.42));
}`;

function lerpHex(a, b, k) {
  const pa = [1, 3, 5].map(i => parseInt(a.slice(i, i + 2), 16)), pb = [1, 3, 5].map(i => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * Math.min(1, Math.max(0, k))).toString(16).padStart(2, '0')).join('');
}

function layoutOf(ctx) {
  return ctx.portrait ? { hz: 960, sx: 540, rows: [700, 800], r: 44 } : { hz: 540, sx: 960, rows: [400, 400], r: 44 };
}

const scene = {
  id: 's14_first_light', t0: T0, t1: 183.0, internalScale: 1, look: 'night_sea',
  async init(ctx) {
    const { G, glsl, particles } = ctx;
    this.L = layoutOf(ctx);
    this.mul = G.program('p8.s14.mul', glsl.frag(MUL_FS));
    this.iris = G.program('p8.iris', glsl.frag(IRIS_FS));
    this.dust = particles.program('p8.s14.dust', DUST);
    this.star = createStar(ctx);
    this.sc = starColours(ctx, 'winter_gold');
    this.pointNorm = 1.0;    // scene 1's star-A formula for a star at rest (no shutter arc): norm = 6 / (6 + 0)
    const D = h => ctx.displayToScene(h, ctx.post.params('night_sea'));
    this.dustCol = { g1: ctx.hexLin('#FFD58A').map(v => v * 1.4), g2: ctx.hexLin('#E3A341').map(v => v * 1.4), hot: ctx.hexLin('#FFF0C8').map(v => v * 2.2) };
    const jd = ctx.events('jig_down');
    this.bursts = (jd.length ? jd : []).filter(e => e.t >= 165.6).map(e => ({ tau: e.t - T0, vel: e.vel == null ? 0.5 : Math.min(1, e.vel * 2.2) }));
    const ll = ctx.events('last_light');
    this.lastLight = ll.length ? ll[0].t : ctx.cue('last_light');
    // line L20: the cream first part and the gold name, one centred line (two rows in portrait)
    const st = { base: 'display', size: 84 };
    const a = { lineId: 'L20a', tau: 100, x: this.L.sx, y: this.L.rows[0], style: Object.assign({}, st, { layer: 'caption', color: '#F4EBDD' }) };
    const b = { lineId: 'L20b', tau: 100, x: this.L.sx, y: this.L.rows[1], style: st, layer: 'hdr' };
    if (ctx.portrait) { this.pos = [[this.L.sx, this.L.rows[0], 'center'], [this.L.sx, this.L.rows[1], 'center']]; }
    else { const f = ctx.text.flow([a, b], { x: this.L.sx, gap: 0.26 }); this.pos = f.map(e => [Math.round(e.x), e.y, 'left']); }
    const lb = ctx.text.layout(Object.assign({}, b, { x: this.pos[1][0], y: this.pos[1][1], align: this.pos[1][2] }));
    this.nameInk = ctx.text.inkExtent(lb);
  },
  // 155.0-156.0: the dawn sea comes in from the frame edges, gilded at the front; the bordered photograph is the last
  // thing to go, at the sun's point
  transition(ctx, w, outRT, inRT, dst) {
    ctx.G.draw(this.iris, { uA: outRT, uB: inRT, uW: w, uGold: 0.55, uEdge: 0.0015, uC: [this.L.sx, this.L.hz - 110], uGoldC: ctx.displayToScene('#E3B341', ctx.post.params('night_sea')) }, dst);
  },
  cam(ctx, t) { return { h: 3, x: 0, z: 0.5 * (t - T0), pitch: ctx.horizonPitch(this.L.hz, ctx.H, 0.6), fovY: 0.6 }; },
  // the sun record at time t (frame position, radius, intensity); `cap` = px of the disc above the horizon
  sunAt(ctx, t) {
    const { tl } = ctx, E = tl.E, L = this.L;
    const warm = tl.seg(t, 156.0, 166.0, E.inOutSine);
    let cap = t < 165.6 ? -L.r + L.r * tl.seg(t, 160.5, 165.6, E.inOutSine) : 30 * tl.seg(t, 165.6, 172.0, E.outSine);
    const c = tl.seg(t, 175.2, 176.8, E.inOutSine);
    const r = L.r + (5 - L.r) * c;
    cap = cap + (r - cap) * c;
    // the disc itself only exists from the rim's first moment (165.6); before it only its glow warms the sky
    const I = (14 + 10 * tl.seg(t, 165.6, 170.0)) * (1 - c) * tl.smoothstep(165.52, 165.6, t);
    return { sun: { at: [L.sx, L.hz + r - cap], r, color: '#FFE2B0', I, halo: (0.4 + 0.6 * warm) * (1 - 0.85 * c), haloColor: '#FFC27A', spec: 60, soft: t < 167 ? 0.04 + 0.21 * tl.seg(t, 165.6, 167.0) : 0.25 },
      cap, warm, c, rimY: L.hz - Math.max(cap, 0) };
  },
  dimAt(ctx, t) {
    const { tl } = ctx, E = tl.E;
    // -4 EV over the spec's 2.0 s, deepened to -6.5 EV so the frame is almost black around the point (check at 177.0)
    const coda = Math.pow(2, -6.5 * E.inOutCubic(tl.seg(t, 175.2, 177.2)));
    const fade = 1 - E.inQuad(tl.seg(t, 179.0, 181.0));
    return coda * fade;
  },
  render(ctx, tau, p, target) {
    const t = T0 + tau, S = ctx.sea, { tl } = ctx, E = tl.E, L = this.L;
    const cam = this.cam(ctx, t);
    const s = this.sunAt(ctx, t), sun = s.sun, warm = s.warm;
    const q = S.quarter('p8dawn');
    const hz1 = lerpHex('#2A2A40', '#E39A4C', tl.seg(t, 156.0, 163.0, E.inOutSine));
    const hz2 = lerpHex(hz1, '#FFD9A0', tl.seg(t, 163.0, 166.0, E.inOutSine));
    S.sky(q, { tau, cam, top: '#0A1220', mid: lerpHex('#1A1C2E', '#2A2A40', warm), band: 0.035, horizon: hz2, sun,
      glow: { color: '#E39A4C', I: 0.25 * warm, width: 0.5, height: 0.08 }, haze: { color: '#3A2A30', I: 0.3 + 0.3 * warm } });
    const ai = 0.15 * (1 - tl.seg(t, 156.0, 166.0, E.inOutSine));
    if (ai > 0.002) S.aurora(q, { tau: tau + 40, cam, intensity: ai });
    S.rendered(target, { tau, cam, amp: 0.22, sky: q, stars: 1 - warm * 0.8, sun, haze: { color: '#3A2A30', I: 0.25 + 0.3 * warm }, deep: [0.004, 0.008, 0.016] });
    if (t > 165.6 && s.c < 1) {
      const k = tl.seg(t, 165.6, 167.1, E.inOutSine);
      const fade = 1 - s.c;
      S.godRays(target, { tau, cam, sun, I: (ctx.portrait ? 0.9 : 1.4) * tl.seg(t, 165.6, 168.0) * fade, color: '#FFC88A' });   // portrait: the name sits lower, in the rays
      S.glitter(target, { tau, cam, sun, amp: 0.22, open: k, I: 3 * fade, exp: 220, bursts: this.bursts });
    }
    const dim = this.dimAt(ctx, t);
    if (dim < 0.9999) ctx.G.draw(this.mul, { uK: dim }, target, { blend: 'mul' });
  },
  overlay(ctx, tau, p, target) {
    const t = T0 + tau, { tl } = ctx, E = tl.E, L = this.L;
    const s = this.sunAt(ctx, t);
    const dim = this.dimAt(ctx, t);
    // the signature's gold dust rising into the sky (fades as the light comes)
    const dv = (1 - tl.seg(t, 164.0, 168.0, E.inOutSine)) * tl.seg(t, 155.0, 155.8);
    if (dv > 0) ctx.particles.draw(this.dust, 460, { uTau: t, uC: [L.sx, L.hz], uU: ctx.U, uVis: dv * dim, uW: ctx.W, uH: ctx.H - L.hz,
      uG1: this.dustCol.g1, uG2: this.dustCol.g2, uHot: this.dustCol.hot }, target);
    // the rim: a sharp gold point the moment it breaks the horizon, then the diffraction star and the long streak
    if (t >= 165.55 && s.c < 1) {
      const birth = Math.exp(-Math.max(0, t - 165.6) / 0.5) * tl.seg(t, 165.55, 165.62);
      const on = tl.seg(t, 165.6, 167.0, E.inOutSine);
      const fade = (1 - s.c) * dim;
      const y = L.hz - Math.max(s.cap, 0) * 0.45;
      ctx.sea.flare(target, { x: L.sx, y, I: (0.15 * on + 0.5 * birth) * fade * 2.2, len: 300, rays: 8, color: '#FFF4D6', streak: (0.15 * on + 0.25 * birth) * fade, streakLen: 1200, streakColor: '#FFD27A' });
      if (birth > 0.01) ctx.gold.glint(target, { x: L.sx, y: L.hz - 1, size: 34, I: 4.0 * birth, rot: 0 });
    }
    // the closing point: star A of scene 1, condensed from the sun
    const pI = tl.seg(t, 175.6, 176.8, E.inOutSine);
    if (pI > 0) {
      const pulse = 1 + 0.08 * Math.sin(2 * Math.PI * (t - 176.8) / 2.5 - Math.PI / 2) * tl.seg(t, 176.8, 177.6);
      const ll = this.lastLight;
      const last = 1 + 0.4 * (t < ll ? 0 : t < ll + 0.3 ? E.inOutSine((t - ll) / 0.3) : 1 - E.inOutSine(Math.min(1, (t - ll - 0.3) / 0.6)));
      const lag = 1 - E.inQuad(tl.seg(t, 179.3, 181.3));
      const I = pI * pulse * last * lag;
      const P = [L.sx, L.hz];
      if (I > 0) this.star.draw(target, { p0: P, p1: P, norm: this.pointNorm, core: this.sc.aCore, halo: this.sc.aHalo, I, haloR: 60, spike: 140 });
    }
  },
  captions(ctx, tau) {
    const t = T0 + tau, { tl } = ctx, E = tl.E;
    if (t < 155.95 || t >= 173.3) return [];
    const st = { base: 'display', size: 84 };
    const out = [{ lineId: 'L20a', tau: t - 156.0, x: this.pos[0][0], y: this.pos[0][1], align: this.pos[0][2], style: Object.assign({}, st, { layer: 'caption', color: '#F4EBDD' }),
      enter: { base: 'opacity', dur: 1.4 }, exit: { at: 16.0, kind: 'opacity', dur: 1.2 } }];
    if (t >= 157.15) {
      const s = this.sunAt(ctx, t);
      const rise = tl.seg(t, 165.6, 168.0, E.inOutSine);
      const pre = tl.seg(t, 157.2, 158.4, E.outCubic);
      out.push({ lineId: 'L20b', tau: t - 157.2, x: this.pos[1][0], y: this.pos[1][1], align: this.pos[1][2], style: st, layer: 'hdr',
        enter: { base: 'opacity', dur: 1.2 }, exit: { at: 14.8, kind: 'opacity', dur: 1.2 },
        sweeps: [{ at: 165.6 - 157.2, dur: 2.6, I: 1.5, width: 54 }],
        glints: [{ at: 1.0, glyph: 4, size: 34, I: 3.0, dur: 0.45 }],
        gold: { look: 'night_sea', key: [this.nameInk[0] - 60, this.pos[1][1] - 220], keyZ: 220, keyI: (2.0 + 2.6 * pre) * (1 - 0.35 * rise),
          fill: [this.L.sx, s.rimY], fillI: 6.5 * rise, tint: ctx.portrait ? [1.55, 1.45, 1.25] : [1.3, 1.25, 1.15] },
      });
    }
    return out;
  },
  lookAt(ctx, tau) {
    const k = ctx.tl.seg(T0 + tau, 165.6, 167.6, ctx.tl.E.inOutSine);
    return [{ look: 'night_sea', w: 1 }, { look: 'winter_gold', w: k }];
  },
  post(ctx, tau) {
    const t = T0 + tau, { tl } = ctx;
    const sunrise = tl.seg(t, 165.6, 167.0) * (1 - tl.seg(t, 175.2, 176.8));
    const coda = tl.seg(t, 175.2, 177.2);
    // at the coda the post settings return to scene 1's (the closing point must match star A exactly)
    return {
      ghosts: 0, ca: 0.0015 + (0.0012 - 0.0015) * coda,
      streak: { threshold: 2.0 + 4.0 * sunrise, strength: 0.08 - 0.05 * sunrise },
    };
  },
};
export default scene;
