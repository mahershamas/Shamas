/*
  Scene 10: i-love-you (117.0-132.5), package P8.
  117.0 hard cut from the flight: black, a mirror-still analytic sea under the stars (core/sea.js rendered(), amp 0),
  the exposure lifting from black over 0.6 s. 118.0 (cue 'ily') line L15 in gold leaf at the rosette centre (the mask
  brightens over 1.2 s, a specular sweep lands on the full stop at 119.2) while the two stars of scene 1 (gold A,
  pearl B, the same shader terms) fade in on band A's centre radius and circle steadily, one revolution per 6.0 s, phase
  locked so they are horizontal at 120.0, 126.0 and 132.0 (no inspiral; soft 20-sample trails).
  120.0 (cue 'climax') the aurora unfolds (0 -> 0.55, easeOutCubic over 2.5 s, triNoise speed 0.06) and the sea swell
  rises 0 -> 0.15; the three-band knotwork rosette draws itself from the top both ways (A 120.0-121.5, B 121.0-122.8,
  C 122.0-124.0), its gold lit by the stars (key light = star A, fill = star B), turning 2 deg/s; 4,000 gold motes
  drift outward from band C. The overlay (rosette, stars, trails, motes) is rendered into its own target, composited
  over the scene and reflected in the sea through the same waves (Fresnel weighted), so everything is mirrored.
  125.5-126.5 the rosette dims to 55 percent; 126.0 line L16 at the centre (default entrance, mist exit 130.4-131.6).
  Camera push 1.00 -> 1.05 about the rosette centre (fov narrows, the centre stays put).
  131.5-132.5 is handed to scene 11 (custom transition): this scene keeps rendering its sea and sky with the shared
  camera (pitching down) so the ink-bleed under it stays continuous; scene 11 draws the contracting rosette.

  Exports (used by scene 11 for the hand-off and by scene 14 for the closing point):
    ilyLayout(ctx)                 per-layout numbers of the build sheet
    nightCam(ctx, t)               the sea camera for 117.0-138.6 (push, then the 131.5-133.0 pitch down and crane up)
    nightSky(ctx, t, cam)          draws the shared quarter sky + aurora for time t and returns the RT (cached per frame)
    createHeart(ctx)               {draw(target, t, {center, scale, alpha, tint}), starPos(t, center, scale)}
    createStar(ctx)                {draw(target, {p0, p1, core, halo, I, spike, haloR, norm})} the scene-1 star terms
    starColours(ctx, look)         scene-1 star colours re-expressed for a look
*/
import { _GLSL as SEA_GLSL, horizonPitch } from '../core/sea.js';

const T0 = 117.0;
const DEG = Math.PI / 180;

export function ilyLayout(ctx) {
  if (ctx.portrait) return { R0: [540, 820], bs: 0.9, hz: 1250, hzEng: 820, lySize: 96, mindSize: 48.6, west: [150, 820] };
  return { R0: [960, 430], bs: 1.0, hz: 820, hzEng: 430, lySize: 104, mindSize: 54, west: [230, 430] };
}

// the 131.5-133.0 hand-off into the engraved sea of scene 11: pitch down (horizon to the scene-4 line), crane up 2.5 -> 40 m
export function handoff(ctx, t) { return ctx.tl.seg(t, 131.5, 133.0, ctx.tl.E.inOutCubic); }
export function nightCam(ctx, t) {
  const { tl } = ctx, L = ilyLayout(ctx);
  const push = 1 + 0.05 * tl.seg(t, T0, 132.5, tl.E.inOutSine);
  const fov0 = 2 * Math.atan(Math.tan(0.3) / push);
  const hzPush = L.R0[1] + (L.hz - L.R0[1]) * push;
  const k = handoff(ctx, t);
  const hz = hzPush + (L.hzEng - hzPush) * k;
  const fov = fov0 + (0.6 - fov0) * k;
  const h = 2.5 * Math.pow(40 / 2.5, k);
  // dolly: speed eases 0 -> 2 m/s over the hand-off (scene 11 continues at 2 m/s)
  const z = t < 131.5 ? 0 : t < 133.0 ? (t - 131.5) * (t - 131.5) / 1.5 : 1.5 + 2 * (t - 133.0);
  return { h, x: 0, z, pitch: horizonPitch(hz, ctx.H, fov), fovY: fov, push, hz };
}
export function auroraAt(ctx, t) {
  const { tl } = ctx;
  const up = tl.seg(t, 120.0, 122.5, tl.E.outCubic);
  const dim = 1 - 0.75 * tl.seg(t, 131.5, 133.0, tl.E.inOutSine);
  return { I: 0.55 * up * dim, reveal: up };
}
const SKY_CACHE = { key: null, rt: null };
export function nightSky(ctx, t, cam) {
  const key = ctx.frame + ':' + t.toFixed(4);
  if (SKY_CACHE.key === key) return SKY_CACHE.rt;
  const S = ctx.sea, q = S.quarter('p8night');
  S.sky(q, { tau: t - T0, cam, top: '#050810', mid: '#070B16', horizon: '#0C1424', haze: { color: '#0E1A2A', I: 0.5 }, milky: 0.012 });
  const a = auroraAt(ctx, t);
  if (a.I > 0.001) S.aurora(q, { tau: t - T0, cam, intensity: a.I, reveal: a.reveal });
  SKY_CACHE.key = key; SKY_CACHE.rt = q;
  return q;
}

// ------------------------------------------------------------------ the scene-1 star terms (core, halo, spikes)
const STAR_FS = `
uniform vec2 uP0, uP1;            // the star at the start and the end of the shutter (frame px): arc smear chord
uniform vec3 uCore, uHalo;
uniform float uI, uSpike, uHaloR, uNorm, uU, uSpikeI, uExt;
out vec4 o;
float spikes(vec2 v, float len){
  float sh = exp(-abs(v.y) / 0.9) * pow(clamp(1.0 - abs(v.x) / len, 0.0, 1.0), 2.0);
  float sv = exp(-abs(v.x) / 0.9) * pow(clamp(1.0 - abs(v.y) / len, 0.0, 1.0), 2.0);
  return (sh + sv) * 0.25 * 2.2;
}
void main(){
  vec2 px = framePx();
  float d = sdSegment(px, uP0, uP1);
  vec2 P = 0.5 * (uP0 + uP1);
  float norm = uNorm > 0.0 ? uNorm : 6.0 / (6.0 + length(uP1 - uP0));
  float sg = 2.55 * uU;
  float c = exp(-d * d / (2.0 * sg * sg)) * 9.0 * norm;
  vec2 v = px - P;
  float hd = min(length(v), d + 0.5 * length(v));
  float hl = exp(-hd / (uHaloR * uU)) * 0.28;
  // window the halo and spikes to the drawn box (no visible box edge on a dark sky)
  float win = 1.0 - smoothstep(0.6, 1.0, max(abs(v.x), abs(v.y)) / uExt);
  o = vec4((uCore * (c + spikes(v, uSpike) * uSpikeI) + uHalo * hl) * uI * win, 0.0);
}`;
export function starColours(ctx, look = 'winter_gold') {
  const L = h => ctx.hexLin(h);
  const base = {
    aCore: L('#FFF4D6'), aHalo: L('#D4A64A'),
    bCore: L('#FFFFFF').map((v, i) => v * [0.86, 0.95, 1.14][i]), bHalo: L('#CFE0FF'),
  };
  if (look === 'winter_gold') return base;
  // keep the stars' displayed colours under another look: invert the other grade from what winter gold shows
  const pw = ctx.post.params('winter_gold'), pl = ctx.post.params(look);
  const re = c => ctx.displayToScene(ctx.sceneToDisplay(c, pw), pl);
  return { aCore: L('#FFF4D6').map((v, i) => v * [1.08, 1.0, 0.86][i]), aHalo: re(base.aHalo), bCore: L('#FFFFFF').map((v, i) => v * [0.97, 0.99, 1.02][i]), bHalo: L('#CFE0FF').map((v, i) => v * [0.92, 0.97, 1.0][i]) };
}
export function createStar(ctx) {
  const { G, glsl } = ctx;
  const prog = G.program('p8.star', glsl.frag(STAR_FS));
  return {
    draw(target, o) {
      const s = target.scale == null ? 1 : target.scale;
      const p0 = o.p0, p1 = o.p1 || o.p0;
      const ext = Math.max(o.spike || 140, (o.haloR || 60) * 5) * ctx.U + 8;
      const x0 = Math.min(p0[0], p1[0]) - ext, x1 = Math.max(p0[0], p1[0]) + ext;
      const y0 = Math.min(p0[1], p1[1]) - ext, y1 = Math.max(p0[1], p1[1]) + ext;
      const gx0 = Math.max(0, Math.floor(x0 * s)), gx1 = Math.min(target.w, Math.ceil(x1 * s));
      const gy0 = Math.max(0, Math.floor((ctx.H - y1) * s)), gy1 = Math.min(target.h, Math.ceil((ctx.H - y0) * s));
      if (gx1 <= gx0 || gy1 <= gy0 || !(o.I > 0)) return;
      G.draw(prog, { uP0: p0, uP1: p1, uCore: o.core, uHalo: o.halo, uI: o.I, uSpike: (o.spike || 140) * ctx.U, uSpikeI: o.spikeI == null ? 1 : o.spikeI,
        uHaloR: o.haloR || 60, uNorm: o.norm || 0, uU: ctx.U, uExt: ext - 4 }, target, { blend: 'add', viewport: [gx0, gy0, gx1 - gx0, gy1 - gy0] });
    },
  };
}

// ------------------------------------------------------------------ trails and motes (closed form, GL points)
const TRAIL = `
uniform vec2 uR0; uniform float uRad, uVis, uOmega, uPh0; uniform vec3 uGold, uPearl;
void particle(int id, out vec2 px, out float size, out vec4 col){
  int s = id / 20, i = id - (id / 20) * 20;
  float tt = uTau - float(i) * 0.015;
  float th = uPh0 + uOmega * tt + (s == 1 ? PI : 0.0);
  px = uR0 + uRad * vec2(cos(th), sin(th));
  float spacing = uRad * uOmega * 0.015;
  size = clamp(spacing * 1.6, 2.5, 10.0);
  float fade = 1.0 - float(i) / 20.0;
  float lead = smoothstep(1.5, 4.0, float(i));
  col = vec4(s == 1 ? uPearl : uGold, uVis * fade * fade * 0.5 * lead);
}`;
const DUST = `
uniform vec2 uR0; uniform float uRC, uSc, uVis, uU, uRate, uT0;
uniform vec3 uG1, uG2, uHot;
void particle(int id, out vec2 px, out float size, out vec4 col){
  float fi = float(id);
  float h1 = h11(fi * 1.31 + 0.7), h2 = h11(fi * 2.17 + 3.1), h3 = h11(fi * 0.73 + 9.4), h4 = h11(fi * 3.91 + 1.3), h5 = h11(fi * 5.03 + 4.2);
  float a = h1 * TAU;
  // band C's pens reach angle a (measured from the top, both ways) at tReach (easeInOutSine reveal 122.0-124.0)
  float del = abs(mod(a + 0.5 * PI + PI, TAU) - PI) / PI;
  float tReach = 122.0 + 2.0 * acos(clamp(1.0 - 2.0 * del, -1.0, 1.0)) / PI;
  float tb = max(tReach, uT0 + h2 * 10.5);
  float life = 3.5 + 3.5 * h3;
  float age = uTau - tb;
  px = vec2(-1e4); size = 0.0; col = vec4(0.0);
  if (age <= 0.0 || age >= life) return;
  float ang = a + uRate * (tb - 120.0);
  vec2 dir = vec2(cos(ang), sin(ang));
  float v = (5.0 + 15.0 * h4) * uU;
  float r = uRC + (2.0 + v * age) / max(uSc, 1e-3);
  vec2 p = uR0 + r * dir * uSc;
  p += 9.0 * uU * uSc * curl2(p * 0.005 + vec2(h1 * 7.0, uTau * 0.04)) * smoothstep(0.0, 2.5, age);
  px = p;
  float env = sin(PI * age / life); env *= env;
  bool spark = h5 > 0.96;
  size = (spark ? 1.6 : 1.3 + 1.4 * h4) * uU * max(uSc, 0.35);
  vec3 c = mix(uG1, uG2, h3);
  float tw = spark ? 0.6 + 0.4 * sin(uTau * 9.0 + h2 * 40.0) : 1.0;
  col = vec4(spark ? uHot * tw : c * 1.15, env * uVis * 0.85);
}`;

// ------------------------------------------------------------------ reflection of the overlay in the sea
const REFL_FS = `
uniform sampler2D uSrc; uniform float uAmp, uK;
out vec4 o;
void main(){
  vec2 px = framePx();
  vec3 rd = camRayL(px);
  vec3 rdx = camRayL(px + vec2(1.0, 0.0)), rdy = camRayL(px + vec2(0.0, 1.0));
  float fwy = abs(rdx.y - rd.y) + abs(rdy.y - rd.y);
  float hzCov = smoothstep(-0.5, 0.5, -rd.y / max(fwy, 1e-7));
  if (hzCov <= 0.0){ o = vec4(0.0); return; }
  vec2 xz = seaHit(rd), xzx = seaHit(rdx), xzy = seaHit(rdy);
  float fp = max(length(xzx - xz), length(xzy - xz));
  float var, curv;
  vec2 g = seaGrad(xz, uTau, uAmp, fp, var, curv);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 r = reflect(rd, N); r.y = max(r.y, 2e-4); r = normalize(r);
  float NoV = max(dot(N, -rd), 1e-3);
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  vec2 q = camProject(r);
  // the filtered slope variance smears the reflection along the vertical (a rippled mirror)
  float sm = clamp(sqrt(var) * 700.0, 0.0, 18.0) + 0.75;
  vec3 acc = vec3(0.0);
  for (int i = -2; i <= 2; i++) acc += texture(uSrc, pxToUV(q + vec2(0.0, float(i) * sm))).rgb * (i == 0 ? 0.3 : (abs(i) == 1 ? 0.22 : 0.13));
  o = vec4(acc * F * uK * hzCov, 0.0);
}`;
const COPY_FS = `uniform sampler2D uA; uniform float uK; out vec4 o; void main(){ o = texture(uA, screenUV()) * uK; }`;

// ------------------------------------------------------------------ the rosette, the stars and the motes
export function createHeart(ctx) {
  const { G, glsl, particles, tl } = ctx, E = tl.E;
  const L = ilyLayout(ctx);
  const star = createStar(ctx);
  const trail = particles.program('p8.s10.trail', TRAIL);
  const dust = particles.program('p8.s10.dust', DUST);
  const col = starColours(ctx, 'night_sea');
  const D = h => ctx.displayToScene(h, ctx.post.params('night_sea'));
  const gold = { g1: D('#E9C676'), g2: D('#D4A64A'), hot: D('#FFE7A3').map(v => v * 1.8) };
  const trailCol = { gold: col.aHalo.map(v => v * 0.9), pearl: col.aHalo.map((v, i) => v * 0.45 + col.bHalo[i] * 0.35) };
  const OMEGA = 2 * Math.PI / 6.0, PH0 = -OMEGA * 120.0;   // star A at angle 0 (right of centre) at 120.0, 126.0, 132.0
  const bands = [[280, 306, '#284B7A', 1, 120.0, 121.5], [322, 348, '#2F7D6B', 1, 121.0, 122.8], [364, 390, '#C2452D', 0.6, 122.0, 124.0]];
  const api = {
    L, OMEGA, PH0,
    starPos(t, center = L.R0, scale = 1, push = 1) {
      const r = 293 * L.bs * push * scale, th = PH0 + OMEGA * t;
      const A = [center[0] + r * Math.cos(th), center[1] + r * Math.sin(th)];
      return { A, B: [2 * center[0] - A[0], 2 * center[1] - A[1]], r, th };
    },
    rotation(t) { return Math.max(0, t - 120.0) * 2 * DEG; },
    // o: {center, scale (contraction), push, alpha (rosette), tint, starI, dustI, starHalo}
    draw(target, t, o = {}) {
      const center = o.center || L.R0, scale = o.scale == null ? 1 : o.scale, push = o.push || 1;
      const sc = scale * push;
      const st = api.starPos(t, center, scale, push);
      const prev = api.starPos(t - 1 / 60, center, scale, push), next = api.starPos(t + 1 / 60, center, scale, push);
      const rot = api.rotation(t);
      const alpha = o.alpha == null ? 1 : o.alpha;
      // rosette bands (premultiplied gold leaf; drawn first so the stars ride on top)
      if (alpha > 0.002 && t >= 120.0) {
        const com = { look: 'night_sea', key: st.A, keyZ: 120 * L.bs * Math.max(sc, 0.3), keyI: 5, fill: st.B, fillI: 3, rotation: rot,
          tint: [o.tint || 1, o.tint || 1, o.tint || 1], opacity: alpha * (o.fade == null ? 1 : o.fade), xform: { center, scale: sc }, tipI: 4.5 };
        for (const [r0, r1, tin, ta, a0, a1] of bands) {
          const pr = tl.seg(t, a0, a1, E.inOutSine);
          if (pr <= 0) continue;
          ctx.knot.band.annulus(target, Object.assign({ center, r0: r0 * L.bs, r1: r1 * L.bs, progress: pr, tincture: tin, tinctureAlpha: ta }, com));
        }
      }
      // gold motes from band C
      const dI = o.dustI == null ? 1 : o.dustI;
      if (t > 122.0 && dI > 0) particles.draw(dust, 4000, { uTau: t, uR0: center, uRC: 377 * L.bs, uSc: sc, uVis: dI, uU: ctx.U, uRate: 2 * DEG, uT0: 122.0,
        uG1: gold.g1, uG2: gold.g2, uHot: gold.hot }, target);
      // the two stars and their trails
      const sI = o.starI == null ? 1 : o.starI;
      if (sI > 0) {
        particles.draw(trail, 40, { uTau: t, uR0: center, uRad: st.r, uVis: sI * Math.min(1, scale * 3), uOmega: OMEGA, uPh0: PH0, uGold: trailCol.gold, uPearl: trailCol.pearl }, target);
        const hr = 60 * (o.starHalo || 1), sp = 140 * (o.starSpike || 1);
        star.draw(target, { p0: prev.A, p1: next.A, core: col.aCore, halo: col.aHalo, I: sI, haloR: hr, spike: sp });
        star.draw(target, { p0: prev.B, p1: next.B, core: col.bCore, halo: col.bHalo, I: sI, haloR: hr, spike: sp });
      }
      return st;
    },
  };
  return api;
}

const scene = {
  id: 's10_i_love_you', t0: T0, t1: 132.5, internalScale: 1, look: 'night_sea',
  async init(ctx) {
    const { G, glsl, text } = ctx;
    this.L = ilyLayout(ctx);
    this.heart = createHeart(ctx);
    this.refl = G.program('p8.s10.refl', glsl.frag(SEA_GLSL.SEA_LIB + SEA_GLSL.WAVES + REFL_FS));
    this.copy = G.program('p8.copy', glsl.frag(COPY_FS));
    const L = this.L;
    // Line L15: the vertical centre of the x-height on the rosette centre; the full stop's position for the sweep
    const e15 = this.lyEntry(100);
    const lay = text.layout(e15);
    this.lyBase = Math.round(L.R0[1] + lay.line.xh / 2);
    const lay2 = text.layout(this.lyEntry(100));
    const row = lay2.rows[0], g = lay2.line.glyph, n = Array.from(window.LINES.L15).length;
    this.stopX = row.ox + 0.5 * (g[(n - 1) * 4] + g[(n - 1) * 4 + 1]);
    this.inkLY = text.inkExtent ? text.inkExtent(lay2) : [L.R0[0] - 220, L.R0[0] + 220];
    const lay16 = text.layout({ lineId: 'L16', tau: 100, x: L.R0[0], y: 0, style: { base: 'narrative', size: L.mindSize } });
    this.mindBase = Math.round(L.R0[1] + lay16.line.xh / 2);
  },
  lyEntry(tau) {
    const L = this.L;
    return { lineId: 'L15', tau, x: L.R0[0], y: this.lyBase || L.R0[1], style: { base: 'display', size: L.lySize }, layer: 'hdr' };
  },
  render(ctx, tau, p, target) {
    const t = T0 + tau, S = ctx.sea;
    const cam = nightCam(ctx, t);
    const q = nightSky(ctx, t, cam);
    const amp = 0.15 * ctx.tl.seg(t, 120.0, 122.5, ctx.tl.E.inOutSine);
    S.rendered(target, { tau: t - T0, cam, amp, sky: q, stars: 1, haze: { color: '#0E1A2A', I: 0.4 }, deep: [0.004, 0.009, 0.018] });
  },
  overlay(ctx, tau, p, target) {
    const t = T0 + tau;
    if (t >= 131.5) return;                       // scene 11 draws the contracting rosette from 131.5
    if (t < 117.95) return;
    const { G, tl } = ctx, E = tl.E;
    const cam = nightCam(ctx, t);
    const ov = G.target('p8.s10.ov', ctx.W, ctx.H);
    G.clear(ov, [0, 0, 0, 0]);
    const climax = 1 + 0.55 * Math.exp(-Math.max(0, t - 120.0) / 0.45) * (t >= 120.0 ? 1 : 0);
    this.heart.draw(ov, t, {
      push: cam.push, tint: 1 - 0.45 * tl.seg(t, 125.5, 126.5, E.inOutSine), fade: 1 - 0.15 * tl.seg(t, 125.5, 126.5, E.inOutSine),
      starI: tl.seg(t, 118.0, 119.0, E.inOutSine) * climax, dustI: 1,
    });
    // composite only the box the overlay can reach (rosette + motes + star halos)
    const s = target.scale == null ? 1 : target.scale, L = this.L;
    const ext = (293 * L.bs + 316) * cam.push;          // band C + motes (470 px) and the star halos (293 + 308 px)
    const bx0 = Math.max(0, Math.floor((L.R0[0] - ext) * s)), bx1 = Math.min(target.w, Math.ceil((L.R0[0] + ext) * s));
    const by0 = Math.max(0, Math.floor((ctx.H - (L.R0[1] + ext)) * s)), by1 = Math.min(target.h, Math.ceil((ctx.H - (L.R0[1] - ext)) * s));
    G.draw(this.copy, { uA: ov, uK: 1 }, target, { blend: 'premul', viewport: [bx0, by0, bx1 - bx0, by1 - by0] });
    // the mirror image in the sea (below the horizon, under the rosette's columns only)
    const amp = 0.15 * tl.seg(t, 120.0, 122.5, E.inOutSine);
    const hz = Math.max(0, Math.floor(ctx.sea.horizonY(cam, ctx.W / 2) - 3));
    const vh = Math.ceil((ctx.H - hz) * s);
    const rx0 = Math.max(0, Math.floor((L.R0[0] - ext - 60) * s)), rx1 = Math.min(target.w, Math.ceil((L.R0[0] + ext + 60) * s));
    if (vh > 0) G.draw(this.refl, Object.assign(ctx.sea._camU(cam), ctx.sea._waveU(0.35), { uDrag: 0.28, uTau: t - T0, uAmp: amp, uSrc: ov, uK: 1 }),
      target, { blend: 'add', viewport: [rx0, 0, rx1 - rx0, vh] });
  },
  captions(ctx, tau) {
    const t = T0 + tau, L = this.L, out = [];
    if (t >= 117.95 && t < 125.6) {
      const e = this.lyEntry(t - 118.0);
      const st = this.heart.starPos(t, L.R0, 1, nightCam(ctx, t).push);
      const bright = ctx.tl.seg(t, 118.0, 119.2, ctx.tl.E.outCubic);
      e.enter = { base: 'opacity', dur: 1.2 };
      e.exit = { at: 6.6, kind: 'opacity', dur: 0.8 };
      e.sweeps = [{ at: 0.2, dur: 1.0, I: 1.6, width: 58, to: this.stopX - 2 * 58 * ctx.U }];
      e.glints = [{ at: 1.05, x: this.stopX, y: this.lyBase - 6 * ctx.U, size: 40, I: 4.5, dur: 0.45, rot: 0.1 }];
      e.gold = { look: 'night_sea', key: st.A, keyZ: 170 * L.bs, keyI: 1.5 + 3.5 * bright, fill: st.B, fillI: 2.2 };
      out.push(e);
    }
    if (t >= 125.95 && t < 131.7) {
      out.push({ lineId: 'L16', tau: t - 126.0, x: L.R0[0], y: this.mindBase, style: { base: 'narrative', size: L.mindSize }, exit: { at: 4.4, kind: 'mist' } });
    }
    return out;
  },
  post(ctx, tau) {
    const t = T0 + tau, { tl } = ctx;
    const ex = tl.E.inOutSine(tl.seg(t, T0, T0 + 0.6));
    return { ghosts: 0, ca: 0.0015, streak: { threshold: 3.5, strength: 0.05 }, exposure: Math.log2(Math.max(1e-3, ex)) };
  },
};
export default scene;
