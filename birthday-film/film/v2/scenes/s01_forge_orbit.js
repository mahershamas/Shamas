/*
  Scene 1: forge-orbit (0.0-12.0). First real pass (package P0 proof of the frame graph and post chain; P5 refines).
  Black vellum ground; a seeded starfield with gravitational-wave lensing; two stars (gold A, pearl B) spiralling in,
  locked to the harp plucks t_k = 12 - 8*0.8^k (one half-orbit per pluck); arc smear instead of strobing;
  40-sample trails; the held breath 11.85-12.0 (radius eases to 0, spikes to 600 px, +15% brightness, no twinkle).
  Passes: nebula at half resolution -> main analytic pass (full res) -> overlay trails (points).
*/
const T_HOLD = 11.85;
export function phiOf(t) { return Math.PI * Math.log((12 - t) / 8) / Math.log(0.8); }       // phi(t_k) = k*pi
export function rOf(t) { return 190 * Math.pow(Math.max(12 - t, 1e-4) / 9, 0.4); }            // px, 190 at t = 3
export function radiusAt(t) {
  if (t <= T_HOLD) return rOf(t);
  const k = Math.min(1, (t - T_HOLD) / 0.15);
  return rOf(T_HOLD) * (1 - k * k * k);
}
export function starA(t, C, rScale = 1) {
  const ph = phiOf(Math.min(t, T_HOLD)), r = radiusAt(t) * rScale;
  return [C[0] + r * Math.cos(ph), C[1] + r * Math.sin(ph)];
}

// deterministic 1D value noise for the camera micro-drift
function hash1(n) { let x = Math.imul(n | 0, 0x27d4eb2d) ^ 0x165667b1; x = Math.imul(x ^ (x >>> 15), 0x85ebca6b); x ^= x >>> 13; return ((x >>> 0) % 100000) / 100000; }
function vnoise(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return hash1(i) * (1 - u) + hash1(i + 1) * u; }

const NEB = `
uniform vec2 uC, uDrift; uniform float uCamS, uCamRot, uVis;
uniform vec3 uNebA, uNebB, uWoad;
out vec4 o;
vec2 toWorld(vec2 px){ return uC + rot2(-uCamRot) * (px - uC) / uCamS - uDrift; }
void main(){
  vec2 w = toWorld(framePx()) / uFrame.y;
  float n = fbm(w * 2.2 + vec2(3.1, 7.7), 5);
  vec3 c = mix(uNebA, uNebB, smoothstep(0.4, 0.8, n));
  float fil = 1.0 - abs(fbm(w * vec2(1.2, 2.4) + vec2(11.0, 2.0), 4) * 2.0 - 1.0);
  c += uWoad * 0.08 * pow(fil, 12.0) * smoothstep(0.3, 0.7, n);
  o = vec4(c * uVis, 1.0);
}`;

const MAIN = `
uniform sampler2D uNeb;
uniform vec2 uC, uDrift; uniform float uCamS, uCamRot;
uniform float uTau, uTw, uVisField, uVisStars;
uniform float uPh, uAmp;                 // lensing phase and amplitude
uniform float uMid, uSpan, uR, uSt, uSpike, uGlow;
uniform vec3 uGround, uAcore, uAhalo, uBcore, uBhalo, uS1, uS2, uS3;
out vec4 o;
vec2 toWorld(vec2 px){ return uC + rot2(-uCamRot) * (px - uC) / uCamS - uDrift; }
float wrapPi(float x){ return mod(x + PI, TAU) - PI; }

vec3 starLayer(vec2 w, float cs, float thr, float rmin, float rmax, float bmax, float seed){
  vec2 cell = floor(w / cs); vec2 f = w - cell * cs;
  float h = h12(cell + seed);
  if (h < thr) return vec3(0.0);
  vec2 ctr = 4.0 + (cs - 8.0) * h22(cell + seed + 101.0);
  float rn = h12(cell + seed + 211.0);
  float r = mix(rmin, rmax, rn * rn);
  float rr = max(r, 1.2);
  float d = length(f - ctr);
  float prof = exp(-d * d / (rr * rr * 0.55)) * (r * r) / (rr * rr);
  float b = mix(0.35, bmax, pow(h12(cell + seed + 307.0), 3.0));
  b *= 1.0 + 0.12 * sin(TAU * 0.3 * uTw + TAU * h12(cell + seed + 401.0));
  float k = h12(cell + seed + 503.0);
  vec3 col = k < 0.5 ? uS1 : (k < 0.78 ? uS2 : uS3);
  return col * prof * b;
}

vec3 binaryStar(vec2 px, float mid, vec3 core, vec3 halo, vec2 other){
  vec2 dp = px - uC; float rp = length(dp); float th = atan(dp.y, dp.x);
  float d;
  if (uSpan >= TAU) d = abs(rp - uR);
  else {
    float a = clamp(wrapPi(th - mid), -0.5 * uSpan, 0.5 * uSpan);
    d = length(px - (uC + uR * vec2(cos(mid + a), sin(mid + a))));
  }
  float arcLen = uR * min(uSpan, TAU);
  float norm = 6.0 / (6.0 + arcLen);
  vec2 P = uC + uR * vec2(cos(mid), sin(mid));
  vec2 v = px - P;
  vec2 u = length(other - P) > 1e-3 ? normalize(other - P) : vec2(1.0, 0.0);
  float al = dot(v, u), pe = dot(v, vec2(-u.y, u.x));
  if (al > 0.0) al /= uSt;
  float hd = min(length(vec2(al, pe)), d + 0.5 * length(v));
  float c = exp(-d * d / (2.0 * 2.55 * 2.55)) * 9.0 * norm;
  float hl = exp(-hd / 60.0) * 0.28;
  float sh = exp(-abs(v.y) / 0.9) * pow(clamp(1.0 - abs(v.x) / uSpike, 0.0, 1.0), 2.0);
  float sv = exp(-abs(v.x) / 0.9) * pow(clamp(1.0 - abs(v.y) / uSpike, 0.0, 1.0), 2.0);
  float sp = (sh + sv) * 0.25 * 2.2;
  return core * (c + sp) + halo * hl;
}

void main(){
  vec2 px = framePx();
  // vellum ground (static fibre texture)
  vec2 fq = px / uFrame.y;
  float fib = fbm(vec2(fq.x * 9.0, fq.y * 90.0), 3) * 0.6 + vn(px * 0.9) * 0.4;
  vec3 c = uGround * (0.12 + 0.5 * fib);
  // gravitational-wave lensing of the background (frame-height units)
  vec2 pn = px / uFrame.y, cn = uC / uFrame.y, dv = pn - cn;
  float r = length(dv), th = atan(dv.y, dv.x);
  vec2 q = pn + (r > 1e-5 ? dv / r : vec2(0.0)) * uAmp / (r + 0.05) * cos(2.0 * (th - uPh) + 18.0 * r) * smoothstep(1.2, 0.0, r);
  vec2 qpx = q * uFrame.y;
  c += texture(uNeb, pxToUV(qpx)).rgb;
  vec2 w = toWorld(qpx);
  vec3 st = starLayer(w, 24.0, 0.86, 0.6, 2.2, 3.2, 0.0) + starLayer(w + 7.0, 15.0, 0.905, 0.6, 1.3, 1.2, 913.0);
  c += st * uVisField;
  // the binary
  vec2 Pa = uC + uR * vec2(cos(uMid), sin(uMid)), Pb = 2.0 * uC - Pa;
  c += (binaryStar(px, uMid, uAcore, uAhalo, Pb) + binaryStar(px, uMid + PI, uBcore, uBhalo, Pa)) * uVisStars;
  c += uAcore * uGlow * exp(-length(px - uC) / 120.0);
  o = vec4(c, 1.0);
}`;

const TRAIL = `
uniform vec2 uC; uniform float uRS, uVis; uniform vec3 uGold;
float phiOf(float t){ return 3.14159265 * log((12.0 - t) / 8.0) / log(0.8); }
float rOf(float t){ return 190.0 * pow(max(12.0 - t, 1e-4) / 9.0, 0.4); }
void particle(int id, out vec2 px, out float size, out vec4 col){
  int s = id / 40, i = id - (id / 40) * 40;
  float tt = uTau - float(i) * 0.01;
  float ph = phiOf(min(tt, 11.85)) + (s == 1 ? PI : 0.0);
  float r = tt <= 11.85 ? rOf(tt) : rOf(11.85) * (1.0 - pow(clamp((tt - 11.85) / 0.15, 0.0, 1.0), 3.0));
  r *= uRS;
  px = uC + r * vec2(cos(ph), sin(ph));
  float w = 14.08 / max(12.0 - min(tt, 11.85), 0.15);       // dphi/dt
  float spacing = r * w * 0.01;
  size = clamp(spacing * 1.4, 2.5, 18.0);
  float fade = 1.0 - float(i) / 40.0;
  float a = uVis * fade * fade * 0.55 * (2.5 / size) * step(3.0, tt) * step(1.0, float(i));
  col = vec4(uGold * (s == 1 ? 0.8 : 1.0), a);
}`;

export default {
  id: 's01_forge_orbit', t0: 0.0, t1: 12.0, internalScale: 1, look: 'winter_gold',
  async init(ctx) {
    const { G, glsl, particles } = ctx;
    this.neb = G.program('s01.neb', glsl.frag(NEB));
    this.main = G.program('s01.main', glsl.frag(MAIN));
    this.trail = particles.program('s01.trail', TRAIL);
    const D = h => ctx.displayToScene(h);
    const L = h => ctx.hexLin(h);
    this.col = {
      ground: D('#07080C'), nebA: D('#07080C'), nebB: D('#0A1020'), woad: L('#284B7A'),
      s1: L('#EAF2FF'), s2: L('#FFE7A3'), s3: L('#BFD3FF'),
      aCore: L('#FFF4D6'), aHalo: L('#D4A64A'), bCore: L('#FFFFFF'), bHalo: L('#CFE0FF'), gold: L('#D4A64A'),
    };
    this.C = ctx.portrait ? [540, 960] : [960, 540];
    this.rs = ctx.portrait ? 0.9 : 1.0;
  },
  camera(ctx, tau, p) {
    const e = ctx.tl.E.inOutSine(ctx.tl.clamp01(p));
    const fadeDrift = 1 - ctx.tl.seg(tau, 10.5, T_HOLD, ctx.tl.E.inOutSine);
    const amp = 0.0015 * ctx.W * fadeDrift;
    return {
      s: 1 + 0.04 * e, rot: 1.5 * Math.PI / 180 * e,
      drift: [(vnoise(tau * 0.25) - 0.5) * 2 * amp, (vnoise(tau * 0.25 + 37.0) - 0.5) * 2 * amp],
    };
  },
  render(ctx, tau, p, target) {
    const { G, tl } = ctx;
    const t = tau;                                 // scene starts at 0: tau is absolute time
    const cam = this.camera(ctx, tau, p);
    const visField = tl.seg(t, 2.5, 4.0, tl.E.inOutSine);
    const visStars = tl.seg(t, 3.0, 4.0, tl.E.inOutSine);
    const neb = G.target('s01.neb', ctx.W * 0.5 * target.scale, ctx.H * 0.5 * target.scale, { scale: 0.5 * target.scale });
    G.draw(this.neb, { uC: this.C, uDrift: cam.drift, uCamS: cam.s, uCamRot: cam.rot, uVis: visField,
      uNebA: this.col.nebA, uNebB: this.col.nebB, uWoad: this.col.woad }, neb);
    const tc = Math.min(t, T_HOLD);
    const p1 = phiOf(Math.max(0, t - 1 / 60)), p2 = phiOf(Math.min(T_HOLD, t + 1 / 60));
    const R = radiusAt(t) * this.rs;
    const hold = tl.seg(t, T_HOLD, 12.0);
    G.draw(this.main, {
      uNeb: neb, uC: this.C, uDrift: cam.drift, uCamS: cam.s, uCamRot: cam.rot,
      uTau: t, uTw: Math.min(t, T_HOLD), uVisField: visField, uVisStars: visStars,
      uPh: phiOf(tc), uAmp: 0.002 * Math.pow(9 / Math.max(12 - t, 0.05), 0.25) * visStars,
      uMid: 0.5 * (p1 + p2), uSpan: Math.max(0, p2 - p1), uR: R, uSt: 1 + 0.8 * tl.smoothstep(60, 0, R),
      uSpike: 140 + 460 * tl.E.outCubic(hold), uGlow: 0.9 * tl.E.inQuad(hold),
      uGround: this.col.ground, uAcore: this.col.aCore, uAhalo: this.col.aHalo, uBcore: this.col.bCore, uBhalo: this.col.bHalo,
      uS1: this.col.s1, uS2: this.col.s2, uS3: this.col.s3,
    }, target);
  },
  overlay(ctx, tau, p, target) {
    const vis = ctx.tl.seg(tau, 3.0, 4.0, ctx.tl.E.inOutSine);
    if (vis <= 0) return;
    ctx.particles.draw(this.trail, 80, { uTau: tau, uC: this.C, uRS: this.rs, uVis: vis, uGold: this.col.gold }, target);
  },
  post(ctx, tau) {
    // point lights in frame: ghosts on; the held breath lifts the frame 15%
    return { ghosts: 0.03, exposure: Math.log2(1 + 0.15 * ctx.tl.seg(tau, T_HOLD, 12.0)) };
  },
  captions() { return []; },
};
