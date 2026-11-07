/*
  Scene 2: forge-name (12.0-22.5), package P5. Hero scene.
  12.000 one flash (kilonova) with camera shake, bloom/streak/CA spike; a two-component ejecta (blue polar lobes,
  gold-red equatorial shell with r-process fingers and a 2 px chromatic rim); 18,000 closed-form gold grains burst
  from the merger, rest as glittering ejecta, then stream into the title name pen-wise, left to right (each one
  curving in from the left of its home), and the gold-leaf name resolves per pixel under them on the same clock
  (each grain glints once on landing); 18.0-19.0 a specular strike (the key light sweeps across the struck metal);
  19.0-20.0 56 red-lead dots ring the capital, one every 18 ms; 20.0-22.5 hold, starfield to 50 percent, the
  6,000 grains of ejecta dust that were not used drift at 4 px/s. The line L1a is set above it from 15.0.
  Music sync: the gold-dust harp harmonics (events 'gold_dust') each light one glint in the ejecta; the strike
  shimmer (events 'strike') and the rubrication ticks ('rubric_ticks') fall on the strike and on every 7th dot.

  Passes: nebula (half res, shared with scene 1) -> ejecta (half res, skipped once faded) -> main (vellum, stars,
  ejecta upsample, flash) -> overlay: grains + dust (one GL_POINTS draw), rubrication dots; the name itself is an
  'hdr' caption entry (gold leaf, additive so grains and glints stay visible on it).

  Exported for scene 3 (which dissolves this name): layoutOf(ctx), GRAIN_GLSL (the dust closed form), and the scene
  object keeps its caches (scene._name, scene._dots, scene._home) after init.
*/
import { SKY_GLSL, NEB_FS, skyColours, camAt, vnoise } from './s01_forge_orbit.js';

const T0 = 12.0;
const N_NAME = 18000, N_DUST = 6000;

// layout per orientation (SPEC scene 2 composition and portrait notes)
export function layoutOf(ctx) {
  const P = ctx.portrait;
  return {
    C: P ? [540, 960] : [960, 540],
    nameC: P ? [540, 990] : [960, 560],
    nameSize: P ? 320 : 300,                   // portrait: the title fills about half the width
    capsY: P ? 780 : 388,                      // portrait: clear of the particle cloud
    capsX: P ? 540 : 960,
  };
}
// the title name entry (gold leaf); tau = seconds since 15.0
export function nameEntry(ctx, L, tau) {
  const st = { base: 'displayItalic', size: L.nameSize };
  if (!L._nameXY) {
    const m = ctx.text.measure({ lineId: 'L1b', style: st });
    // centre the INK box on nameC (italic overhangs make the advance box off-centre)
    L._nameXY = [Math.round(L.nameC[0] - (m.inkL + m.inkR) / 2), Math.round(L.nameC[1] + (m.asc - m.desc) / 2)];
  }
  return { lineId: 'L1b', tau, x: L._nameXY[0], y: L._nameXY[1], align: 'left', style: st, layer: 'hdr', enter: 'none' };
}

// shared closed form of the ejecta grains (name grains and dust). uTau is ABSOLUTE time t in these programs.
export const GRAIN_GLSL = `
uniform sampler2D uHome;          // name grains: xy home (frame px), z = xn across the ink, w unused
uniform vec2 uC, uShake;
uniform float uU, uPush, uDustI, uNameI, uSeed;
uniform vec3 uC1, uC2, uC3, uHot;
uniform float uEv[32]; uniform int uNEv;
uniform vec4 uInk;                // ink x0, x1 of the name; y top; y of the writing front
uniform vec4 uGShield; uniform float uGShieldK;   // caption shield for the grains (x0, y0, x1, y1 frame px), strength
out float vGlint;
out vec4 vStr;                    // motion streak: unit direction, half-length px, core size px (z = 0: round sprite)
// 1 outside the caption rect, 1 - uGShieldK inside (feathered 30 px): no gold grain may sit in a line of type
float grainShield(vec2 px){
  if (uGShieldK <= 0.0 || uGShield.z <= uGShield.x) return 1.0;
  vec2 d = max(uGShield.xy - px, px - uGShield.zw);
  return 1.0 - uGShieldK * (1.0 - smoothstep(0.0, 30.0 * uU, length(max(d, 0.0))));
}
float hh(int id, float k){ return h12(vec2(float(id) * 1.618 + k * 31.7, k * 7.3 + 0.5)); }
// burst position of grain id (frame px). The gold is thrown out mostly in the equatorial plane (the gold-red shell):
// directions favour the horizontal; half the grains ride one of 96 radial filaments; the speed is lumped by the same
// direction-only finger noise that shapes the ejecta shell, so grains and gas share one structure.
vec2 burstVel(int id, bool dust){
  float a = hh(id, 1.0) * TAU;
  if (hh(id, 16.0) < 0.5){ float st = floor(a / TAU * 96.0); a = (st + 0.5) / 96.0 * TAU + (hh(id, 17.0) - 0.5) * 0.07 + 0.4 * (h11(st * 3.1) - 0.5) / 96.0 * TAU; }
  vec2 d = normalize(vec2(cos(a), sin(a) * 0.62));
  float fing = fbm(vec2(cos(a), sin(a)) * 3.2 + vec2(7.1, 2.3), 4);
  float sp = dust ? mix(120.0, 950.0, pow(hh(id, 2.0), 0.85)) : mix(200.0, 700.0, pow(hh(id, 2.0), 0.9));
  sp *= (0.6 + 0.8 * fing * fing) * (1.0 + 0.7 * pow(hh(id, 20.0), 5.0));
  return d * sp * uU;
}
vec2 burstPos(int id, float e, bool dust){
  vec2 v = burstVel(id, dust);
  float ee = max(e, 0.0);
  return uC + uShake + v * (1.0 - exp(-1.6 * ee)) + v * 0.05 * (1.0 - exp(-0.4 * ee));
}
vec3 grainCol(int id){
  float c = hh(id, 3.0);
  return c < 0.2 ? uC1 : (c < 0.7 ? uC2 : uC3);         // 2 : 5 : 3
}
vec2 swirl(vec2 p, float tau){ return 40.0 * uU * curl2(p * 0.004 / uU + vec2(uSeed, tau * 0.07)); }
// a dust grain's position before the push (gid: global id)
vec2 dustPos(int gid, float e){
  vec2 B = burstPos(gid, e, true);
  B += swirl(B, e) * smoothstep(0.0, 1.2, e) * 0.8;
  return B;
}
// most grains are faint, a few carry the light: about a fifth of them hold most of it
float grainBri(int id){ return 0.15 + 2.0 * pow(hh(id, 8.0), 6.0); }
float grainSize(int id){ return mix(0.9, 2.6, pow(hh(id, 8.0), 4.0)); }
// the cloud feathers out toward its rim (frame-height units, the cloud's own flattened metric) instead of ending as a disc
float cloudFeather(vec2 px){
  vec2 q = (px - uC) / (1080.0 * uU);
  return smoothstep(0.62, 0.28, length(vec2(q.x, q.y / 0.75)));
}
`;

const GRAINS = GRAIN_GLSL + `
uniform int uNName;
void particle(int id, out vec2 px, out float size, out vec4 col){
  float t = uTau, e = t - ${T0.toFixed(1)};
  vGlint = 0.0;
  bool dust = id >= uNName;
  vec3 c = grainCol(id);
  float spark = step(hh(id, 5.0), 0.03);
  float born = smoothstep(0.05, 0.5, e);
  float hot = exp(-2.2 * max(e, 0.0));                    // fresh ejecta are white-hot
  c = mix(c, uHot, 0.65 * hot);
  // most grains are faint, a few are bright (a power law reads as depth and glitter, not as a uniform dot field)
  float bri = grainBri(id);
  vStr = vec4(0.0);
  // radial motion streak of the burst (decays with the ejecta's speed)
  float sLen = 6.0 * uU * exp(-1.6 * max(e, 0.0)) * step(0.0, e);
  if (!dust){
    vec4 H = fetchPoint(uHome, id);
    float s = 14.6 + 2.2 * H.z + 0.2 * hh(id, 4.0);
    vec2 B = burstPos(id, e, false);
    B += swirl(B, e) * smoothstep(0.0, 1.2, e);
    B = uC + rot2(-0.035 * max(e - 0.5, 0.0)) * (B - uC);            // the cloud turns slowly
    // the pen: 1.4 s before its stroke a grain leaves the cloud and spirals (clockwise, flattened) into a vortex that
    // travels with the writing front F(t); it leaves the vortex on the front's left side and, in its 0.8 s window,
    // curves into its home from the left (quadratic Bezier) while the gold leaf resolves under it
    float g = clamp((t - (s - 1.4)) / 1.4, 0.0, 1.0);
    vec2 F = vec2(mix(uInk.x, uInk.y, clamp((t - 14.7) / 2.2, -0.05, 1.0)), uInk.w);
    vec2 d0 = B - F;
    float th0 = atan(d0.y, d0.x / 0.7);
    float rho0 = length(vec2(d0.x, d0.y / 0.7));
    float rho1 = (3.0 + 200.0 * pow(hh(id, 6.0), 1.25)) * uU;
    float thEnd = PI + (hh(id, 19.0) - 0.5) * 2.4;
    float thE = th0 + mod(thEnd - th0, TAU) + PI * (0.6 + 0.8 * hh(id, 7.0));   // always clockwise on screen, ends on the left side
    float ge = g * g * (3.0 - 2.0 * g);
    float gr = 1.0 - pow(1.0 - g, 2.2);
    float th = mix(th0, thE, ge);
    float rho = mix(rho0, rho1, gr);
    vec2 P1 = F + rho * vec2(cos(th), 0.7 * sin(th));
    vec2 Fs = vec2(mix(uInk.x, uInk.y, clamp((s - 14.7) / 2.2, -0.05, 1.0)), uInk.w);
    vec2 Qp = Fs + rho1 * vec2(cos(thE), 0.7 * sin(thE));
    float k = clamp((t - s) / 0.8, 0.0, 1.0);
    float ke = 1.0 - pow(1.0 - k, 3.0);
    vec2 Q = vec2(min(Qp.x, H.x) - (30.0 + 90.0 * hh(id, 21.0)) * uU, mix(Qp.y, H.y, 0.8));
    float iu = 1.0 - ke;
    px = g < 1.0 ? (g > 0.0 ? P1 : B) : iu * iu * Qp + 2.0 * iu * ke * Q + ke * ke * H.xy;
    size = mix(grainSize(id) * 1.1, 1.0, ke) * uU;
    // resting grains feather out toward the rim of the cloud; once a grain joins the pen it is fully seen
    float al = (1.0 - pow(ke, 6.0)) * born * mix(cloudFeather(px), 1.0, ge);
    al *= grainShield(px);
    if (g <= 0.0 && sLen > 0.3 * uU){ vStr = vec4(normalize(burstVel(id, false)), sLen, size); size += 3.0 * sLen; }
    // grains on their way are brighter than the resting cloud: the stream reads
    float I = (1.1 + 2.4 * hot) * (1.0 + 3.0 * spark) * mix(bri, 1.35, max(ge, step(0.0, t - s)));
    I *= 0.8 + 0.35 * sin(t * (2.0 + 5.0 * hh(id, 9.0)) + hh(id, 10.0) * TAU);
    if (spark > 0.5) size = mix(1.0, 1.6, hh(id, 11.0)) * uU;
    float gl = t - (s + 0.8);
    if (k >= 1.0){
      // one glint on landing: a 4 px cross sparkle for 120 ms
      if (gl < 0.12){ vGlint = 1.0; size = 7.0 * uU; al = 1.0; I = 1.8 * (1.0 - gl / 0.12) * (0.5 + bri); c = mix(c, uC1, 0.6); }
      else al = 0.0;
    }
    if (vGlint > 0.5) vStr = vec4(0.0);
    col = vec4(min(c * I, vec3(6.0)), al * uNameI);
    return;
  }
  // ejecta dust: never used for the name; it coasts out, then drifts at 4 px/s and glitters
  int j = id - uNName;
  vec2 B = dustPos(id, e);
  float da = hh(id, 12.0) * TAU;
  B += normalize(vec2(cos(da), sin(da) * 0.6 - 0.7)) * 4.0 * uU * max(e - 8.0, 0.0);
  px = uC + (B - uC) * uPush;
  size = mix(1.0, 2.0, hh(id, 13.0)) * grainSize(id) * uU;
  float tw = 0.55 + 0.45 * sin(t * (1.3 + 3.0 * hh(id, 14.0)) + hh(id, 15.0) * TAU);
  float I = (0.45 + 2.4 * hot) * (0.4 + 0.6 * exp(-0.3 * max(e, 0.0))) * tw * (1.0 + 3.0 * spark) * bri;
  float al = born * uDustI * cloudFeather(px) * grainShield(px);
  if (sLen > 0.3 * uU){ vStr = vec4(normalize(burstVel(id, true)), sLen, size); size += 3.0 * sLen; }
  // harp harmonics of the gold dust: event k is taken by the first of the grains k, k + 32, ... k + 160 that sits
  // inside the cloud (within 420 px of its centre) at that moment, so a glint never lights alone in empty sky
  if (j < 192){
    int k = j - (j / 32) * 32, m = j / 32;
    if (k < uNEv){
      float te = t - uEv[k];
      if (te > -0.02 && te < 0.5){
        float ek = uEv[k] - ${T0.toFixed(1)};
        bool mine = length(dustPos(id, ek) - uC) < 420.0 * uU;
        for (int mm = 0; mm < 5; mm++){
          if (mm >= m || !mine) break;
          if (length(dustPos(uNName + k + 32 * mm, ek) - uC) < 420.0 * uU) mine = false;
        }
        float env = smoothstep(-0.02, 0.0, te) * exp(-max(te, 0.0) / 0.16);
        if (mine && env > 0.02){ vGlint = 1.0; vStr = vec4(0.0); size = 11.0 * uU; I = 3.0 * env; c = mix(c, uC1, 0.7); al = born * uDustI; }
      }
    }
  }
  col = vec4(min(c * I, vec3(6.0)), al);
}`;

export const GRAIN_FS = `
in vec4 vCol; in float vSize; in float vGlint;
out vec4 o;
void main(){
  vec2 q = (gl_PointCoord * 2.0 - 1.0) * (vSize + 2.0) / max(vSize, 1.0);
  float w;
  if (vGlint > 0.5){
    // a fine four-point glint: thin tapering arms and a small hot core (not a soft diamond blob)
    vec2 a = abs(q);
    float arms = exp(-a.y * 28.0) * pow(max(1.0 - a.x, 0.0), 2.0) + exp(-a.x * 28.0) * pow(max(1.0 - a.y, 0.0), 2.0);
    w = arms * 0.9 + exp(-dot(q, q) * 18.0) * 1.2;
  } else w = exp(-dot(q, q) * 2.0);
  o = vec4(vCol.rgb * vCol.a * w, 0.0);
}`;
// the scene-2 grains: as GRAIN_FS, plus the radial motion streak of the burst (a capsule Gaussian along vStr.xy whose
// total energy matches the round sprite)
export const GRAIN_STREAK_FS = `
in vec4 vCol; in float vSize; in float vGlint; in vec4 vStr;
out vec4 o;
void main(){
  if (vStr.z <= 0.0 || vGlint > 0.5){
    vec2 q = (gl_PointCoord * 2.0 - 1.0) * (vSize + 2.0) / max(vSize, 1.0);
    float w;
    if (vGlint > 0.5){
      vec2 a = abs(q);
      float arms = exp(-a.y * 28.0) * pow(max(1.0 - a.x, 0.0), 2.0) + exp(-a.x * 28.0) * pow(max(1.0 - a.y, 0.0), 2.0);
      w = arms * 0.9 + exp(-dot(q, q) * 18.0) * 1.2;
    } else w = exp(-dot(q, q) * 2.0);
    o = vec4(vCol.rgb * vCol.a * w, 0.0);
    return;
  }
  vec2 d = (gl_PointCoord - 0.5) * (vSize + 2.0);
  // an elongated Gaussian: never thinner than about a pixel (no aliased combs), tapering at both ends, with the same
  // integral as the round sprite (sigma rs/4)
  float s0 = max(vStr.w, 1.0) * 0.25;
  float sp = max(s0, 0.6), sa = sqrt(s0 * s0 + vStr.z * vStr.z / 2.25);
  float al = dot(d, vStr.xy), pe = dot(d, vec2(-vStr.y, vStr.x));
  float w = exp(-0.5 * (pe * pe / (sp * sp) + al * al / (sa * sa))) * (s0 * s0) / (sp * sa);
  o = vec4(vCol.rgb * vCol.a * w, 0.0);
}`;

// rubrication dots: AA discs of red lead with a 1 px highlight, one every 18 ms
export const DOTS_GLSL = `
uniform sampler2D uDots; uniform float uT0, uFade, uU; uniform vec3 uRed;
out float vPop;
void particle(int id, out vec2 px, out float size, out vec4 col){
  px = fetchPoint(uDots, id).xy;
  float ta = uT0 + float(id) * 0.018;
  float a = clamp((uTau - ta) / 0.05, 0.0, 1.0);
  float since = uTau - ta;
  // every 7th dot falls on a rubrication tick of the harp: it lands with a brighter pop
  float tick = (id - (id / 7) * 7) == 0 ? 1.0 : 0.35;
  vPop = since >= 0.0 ? tick * exp(-since / 0.09) : 0.0;
  size = 4.0 * uU * (1.0 + 0.45 * vPop);
  col = vec4(uRed, a * uFade);
}`;
export const DOTS_FS = `
uniform vec3 uHi;
in vec4 vCol; in float vSize; in float vPop;
out vec4 o;
void main(){
  float S = vSize + 2.0;
  vec2 d = (gl_PointCoord - 0.5) * S;              // px from the centre
  float r = vSize * 0.5;
  float cov = clamp(r - length(d) + 0.5, 0.0, 1.0);
  // 1 px highlight toward the key light (upper left)
  float hl = exp(-dot(d - vec2(-0.55, -0.6) * r * 0.5, d - vec2(-0.55, -0.6) * r * 0.5) / 0.45);
  vec3 c = mix(vCol.rgb, uHi, clamp(hl, 0.0, 1.0) * 0.85) * (1.0 + 2.5 * vPop);
  o = vec4(c * cov * vCol.a, cov * vCol.a);
}`;

const EJECTA = `
uniform vec2 uC; uniform float uE, uU;
uniform vec3 uBlue, uIn, uOrp, uRed, uCore;
out vec4 o;
float shell(float r, float R, float w){ float x = (r - R) / w; return exp(-x * x); }
void main(){
  vec2 px = framePx();
  float unit = 1080.0 * uU;
  vec2 p = (px - uC) / unit;
  float r = length(p);
  float e = uE;
  vec2 dir = r > 1e-5 ? p / r : vec2(1.0, 0.0);
  vec3 c = vec3(0.0);
  // the remnant: a warm core that the ejecta leave behind, fading over the first seconds
  c += mix(uCore, uOrp, smoothstep(0.2, 1.5, e)) * (1.4 * exp(-r / 0.012) + 0.35 * exp(-r / 0.05)) * exp(-1.6 * e) * smoothstep(0.0, 0.08, e);
  // blue polar lobes (cos^2 to the vertical axis), gone by 13.5
  float fb = smoothstep(0.0, 0.06, e) * (1.0 - smoothstep(0.45, 1.5, e));
  if (fb > 0.0){
    float Rb = 0.16 * e, wb = 0.02 + 0.07 * e;
    float lob = dir.y * dir.y;
    float tb = fbm(rot2(0.13 * e) * p * 7.0 + 4.0, 3);
    float sb = shell(r, Rb, wb) * (0.4 + 0.9 * tb) + 0.2 * exp(-r / max(Rb, 1e-3)) * smoothstep(0.0, 0.3, e);
    c += uBlue * sb * lob * lob * fb * 1.5 / (1.0 + 5.0 * e);
  }
  // gold-red equatorial shell: a flattened (torus seen near edge-on) shell, sin^2 favoured, with r-process fingers and
  // fine filaments; colour runs from cream where it is brightest through orpiment to red lead on the outer rim; it
  // cools (deeper, redder) and is gone by 17.0
  float fr = smoothstep(0.0, 0.05, e) * (1.0 - smoothstep(1.2, 3.9, e));
  if (fr > 0.0){
    vec2 pe = p * vec2(1.0, 1.0 / 0.62);
    float re = length(pe);
    vec2 de = re > 1e-5 ? pe / re : vec2(1.0, 0.0);
    float Rr = 0.09 * e;
    float wr = 0.008 + 0.022 * e;
    float eq = dir.x * dir.x;
    float fing = fbm(de * 1.7 + vec2(7.1, 2.3), 3);
    float R = Rr * (0.6 + 0.8 * fing * fing);
    vec2 q = rot2(0.1 * e) * p * 6.0;
    float tex = fbm(q * 1.7 + 1.3, 4);
    float strand = 1.0 - abs(fbm(q * 2.6 + 9.0, 4) * 2.0 - 1.0);
    float body = 0.3 + 0.7 * tex + 1.1 * pow(strand, 4.0) * (0.4 + tex);
    // asymmetric shell: a sharp outer front, a softer inner tail; 2 px chromatic split on the rim
    float dpx = 1.0 / unit;
    vec3 x3 = (vec3(re - dpx, re, re + dpx) - R) / wr;
    x3 = mix(x3 * 0.8, x3, step(0.0, x3));
    vec3 sh = exp(-x3 * x3) * smoothstep(0.15 * Rr, 0.8 * Rr, re);   // hollow: no spokes converging on the centre
    float cool = smoothstep(0.0, 5.0, e);
    float k = exp(-0.45 * e) * fr * (0.3 + 0.7 * eq) / (0.35 + 2.8 * Rr);
    float I = sh.g * body * k;
    // colour by radiance and position: hot cream only where it is bright, orpiment in the body, red lead outside
    float rim = clamp((re - R) / wr, -3.0, 2.0);
    // dim gas reads olive through the tonemap if it is orpiment: the faint parts lean to red lead (warm, never muddy)
    vec3 rc = mix(mix(uOrp, uRed, 0.5 * (1.0 - smoothstep(0.15, 0.9, I))), uRed, smoothstep(-0.2, 1.0, rim) * (0.6 + 0.4 * cool));
    rc = mix(rc, uIn, smoothstep(0.5, 1.6, I) * (1.0 - 0.7 * cool));
    rc = mix(rc, uRed * vec3(1.0, 0.8, 0.8), 0.35 * cool);
    c += rc * sh * body * k * 1.0;
    // a faint warm veil inside the shell
    c += mix(uOrp, uRed, 0.65) * 0.05 * smoothstep(R, R * 0.1, re) * (0.3 + 0.9 * tex) * k;
  }
  o = vec4(c, 1.0);
}`;

const MAIN = SKY_GLSL + `
uniform sampler2D uNeb, uEj; uniform int uHasEj;
uniform vec2 uKC; uniform float uFlashI, uFlashMix, uNebDim;
uniform vec3 uFlashA, uFlashB;
out vec4 o;
void main(){
  vec2 px = framePx();
  vec3 c = vellum(px);
  c += texture(uNeb, pxToUV(px)).rgb * uNebDim;
  c += starField(toWorld(px)) * uVisField * starShield(px);
  if (uHasEj == 1) c += texture(uEj, screenUV()).rgb;
  if (uFlashI > 0.0){
    float r = length(px - uKC) / (1080.0 * uU);
    // energy concentrated in a white-hot centre; the outer frame stays dark (no beige fog)
    float f = 0.85 * exp(-r / 0.018) + 0.13 * exp(-r / 0.06) + 0.02 * exp(-r / 0.25);
    c += mix(uFlashA, uFlashB, uFlashMix) * f * uFlashI;
  }
  o = vec4(c, 1.0);
}`;

const scene = {
  id: 's02_forge_name', t0: 12.0, t1: 22.5, internalScale: 1, look: 'winter_gold',
  async init(ctx) {
    const { G, glsl, particles, text } = ctx;
    this.L = layoutOf(ctx);
    this.neb = G.program('s01.neb', glsl.frag(NEB_FS));
    this.ej = G.program('s02.ejecta', glsl.frag(EJECTA));
    this.main = G.program('s02.main', glsl.frag(MAIN));
    this.grains = particles.program('s02.grains', GRAINS, { fs: GRAIN_STREAK_FS });
    this.dots = particles.program('s02.dots', DOTS_GLSL, { fs: DOTS_FS });
    const D = h => ctx.displayToScene(h), Lin = h => ctx.hexLin(h);
    this.col = Object.assign(skyColours(ctx), {
      flashA: Lin('#FFF4D6'), flashB: Lin('#FFE7A3'), blue: Lin('#7FB8FF'),
      shIn: Lin('#FFF4D6'), shOrp: Lin('#E3B341'), shRed: Lin('#C2452D'),
      p1: Lin('#FFE7A3'), p2: Lin('#D4A64A'), p3: Lin('#B8862B'), hot: Lin('#FFF4D6'),
      red: D('#C2452D'), redHi: D('#FF8A6A'),
    });
    // grain homes on the name (seeded shuffle of ink pixels), with xn across the ink
    const ent = nameEntry(ctx, this.L, 10);
    const pts = text.points(ent, { count: N_NAME, seed: 1203, threshold: 0.5 });
    const data = new Float32Array(N_NAME * 4);
    for (let i = 0; i < N_NAME; i++) { data[i * 4] = pts.pts[i * 2]; data[i * 4 + 1] = pts.pts[i * 2 + 1]; data[i * 4 + 2] = pts.xn[i]; }
    this._home = particles.pointsTexture(data, 4);
    this._ink = [pts.x0, pts.x1, pts.y0, pts.y1];
    // the writing front runs along the middle of the x-height band
    this._inkU = [pts.x0, pts.x1, pts.y0, pts.y1 - (pts.y1 - pts.y0) * 0.3];
    // rubrication: 56 points 6 px off the outside of the capital (glyph 0), clockwise from the top
    const ring = text.glyphOutline(ent, 0, { offset: 6, count: 56 });
    const d4 = new Float32Array(56 * 4);
    for (let i = 0; i < 56; i++) { d4[i * 4] = ring[i * 2]; d4[i * 4 + 1] = ring[i * 2 + 1]; }
    this._dots = particles.pointsTexture(d4, 4);
    this._ring = ring;
    // the caps line's box (frame px, with a margin) for the star and grain shields
    const cm = text.measure(this.capsEntry(0));
    const half = (cm.inkR - cm.inkL) / 2 + 24 * ctx.U;
    this._capsBox = [this.L.capsX - half, this.L.capsY - cm.asc - 12 * ctx.U, this.L.capsX + half, this.L.capsY + 12 * ctx.U];
    const ev = ctx.events('gold_dust').map(e => e.t).slice(0, 32);
    this._ev = new Float32Array(32); this._ev.set(ev); this._nEv = ev.length;
  },
  // camera of act I after the merger: the scene-1 rest pose, a decaying shake, the 20.0-22.5 push
  cam(ctx, t) {
    const c = camAt(12, ctx.W);
    const e = t - T0;
    const a = 3 * ctx.U * Math.exp(-6 * Math.max(e, 0));
    const shake = [a * (vnoise(e * 20) - 0.5) * 2, a * (vnoise(e * 20 + 91.0) - 0.5) * 2];
    const push = 1 + 0.03 * ctx.tl.seg(t, 20.0, 22.5, ctx.tl.E.inOutSine);
    return { s: c.s * push, rot: c.rot, drift: [0, 0], shake, push };
  },
  render(ctx, tau, p, target) {
    const { G, tl } = ctx;
    const t = T0 + tau, e = tau;
    const cam = this.cam(ctx, t);
    const C = this.L.C;
    const dim = 1 - 0.5 * tl.seg(t, 20.0, 22.5, tl.E.inOutSine);
    const neb = G.target('s02.neb', ctx.W * 0.5 * target.scale, ctx.H * 0.5 * target.scale, { scale: 0.5 * target.scale });
    G.draw(this.neb, { uC: C, uDrift: cam.shake.map(v => -v), uCamS: cam.s, uCamRot: cam.rot, uVis: 1,
      uNebA: this.col.nebA, uNebB: this.col.nebB, uWoad: this.col.woad }, neb);
    const KC = [C[0] + cam.shake[0], C[1] + cam.shake[1]];
    let ej = null;
    if (e < 5.1) {
      ej = G.target('s02.ej', ctx.W * 0.5 * target.scale, ctx.H * 0.5 * target.scale, { scale: 0.5 * target.scale });
      G.draw(this.ej, { uC: KC, uE: e, uU: ctx.U, uBlue: this.col.blue, uIn: this.col.shIn, uOrp: this.col.shOrp, uRed: this.col.shRed, uCore: this.col.flashB }, ej);
    }
    // the flash: one swell, centre weighted (corners stay far below white); the pre-glow of the held breath decays with it
    const flash = 6.0 * Math.exp(-6 * Math.max(e, 0)) + 0.9 * Math.exp(-4 * Math.max(e, 0)) * 0.3;
    G.draw(this.main, {
      uNeb: neb, uEj: ej, uHasEj: ej ? 1 : 0, uKC: KC, uFlashI: flash, uFlashMix: tl.smoothstep(0, 0.6, e), uNebDim: dim,
      uFlashA: this.col.flashA, uFlashB: this.col.flashB,
      uC: C, uDrift: cam.shake.map(v => -v), uCamS: cam.s, uCamRot: cam.rot, uU: ctx.U,
      uTw: t - 0.15, uVisField: dim, uGround: this.col.ground, uS1: this.col.s1, uS2: this.col.s2, uS3: this.col.s3,
      uShield: this.shields(), uShieldK: 0.85 * tl.seg(t, 14.6, 15.6, tl.E.inOutSine),
    }, target);
  },
  // star shields around the name and the line above it (frame px rects)
  shields() {
    const [x0, x1, y0, y1] = this._ink, c = this._capsBox;
    return new Float32Array([x0 - 30, y0 - 20, x1 + 40, y1 + 24, c[0], c[1], c[2], c[3], 0, 0, 0, 0]);
  },
  capsEntry(tau) {
    return { lineId: 'L1a', tau, x: this.L.capsX, y: this.L.capsY, style: 'caps', enter: { base: 'caps', stagger: 0.018 } };
  },
  grainUniforms(ctx, t, extra = {}) {
    const cam = this.cam(ctx, t);
    return Object.assign({
      uGShield: this._capsBox, uGShieldK: 0.8 * ctx.tl.seg(t, 14.6, 15.6, ctx.tl.E.inOutSine),
      uTau: t, uHome: this._home, uC: this.L.C, uShake: cam.shake, uU: ctx.U, uPush: cam.push, uDustI: 1, uNameI: 1, uSeed: 3.7,
      uC1: this.col.p1, uC2: this.col.p2, uC3: this.col.p3, uHot: this.col.hot, uEv: this._ev, uNEv: this._nEv, uNName: N_NAME, uInk: this._inkU,
    }, extra);
  },
  overlay(ctx, tau, p, target) {
    const t = T0 + tau;
    ctx.particles.draw(this.grains, N_NAME + N_DUST, this.grainUniforms(ctx, t), target);
    if (t >= 19.0) {
      ctx.particles.draw(this.dots, 56, { uTau: t, uDots: this._dots, uT0: 19.0, uFade: 1, uU: ctx.U, uRed: this.col.red, uHi: this.col.redHi }, target);
    }
  },
  nameGold(ctx, t) {
    // key light: high over the left of the word; 18.0-19.0 it sweeps left to right with the strike, then drifts
    // slowly back toward the upper middle during the hold
    const [x0, x1] = this._ink;
    const w = x1 - x0;
    const sw = ctx.tl.seg(t, 18.0, 19.0, ctx.tl.E.inOutSine);
    const back = ctx.tl.seg(t, 19.0, 22.5, ctx.tl.E.inOutSine);
    const kx = t < 18.0 ? x0 + 0.2 * w : (t < 19.0 ? x0 - 0.15 * w + 1.3 * w * sw : x1 + 0.15 * w - 0.55 * w * back);
    return { blend: 'add', key: [kx, this._ink[2] - 2.2 * this.L.nameSize], keyI: 4.2 + 1.6 * Math.sin(Math.PI * sw) };
  },
  captions(ctx, tau) {
    const t = T0 + tau;
    const caps = this.capsEntry(t - 15.0);
    const name = nameEntry(ctx, this.L, t - 15.0);
    // per-pixel formation on the grains' clock: s(x) = 14.6 + 2.2 xn (+0.1, the mean of the 0.2 hash), 0.8 s arrival
    name.reveal = { t0: 14.6 + 0.1 - 15.0, span: 2.2, dur: 0.8, lo: 0.85, hi: 1.0, x0: this._ink[0], x1: this._ink[1] };
    name.sweeps = [{ at: 18.0 - 15.0, dur: 1.0, I: 1.5, width: 64 }];
    // the strike ends on one small, brief highlight on the top bevel of the last letter (not a big stock twinkle)
    name.glints = [{ at: 18.95 - 15.0, glyph: 3, size: 22, I: 3.5, dur: 0.25 }];
    name.gold = this.nameGold(ctx, t);
    return [caps, name];
  },
  post(ctx, tau) {
    const t = T0 + tau, e = Math.max(0, tau), tl = ctx.tl;
    // merger look (SPEC 4.4 / scene 2): bloom threshold 1.0, knee 0.5, add 0.25 for 12.0-13.5, eased back by 15.0
    const k = tl.seg(t, 13.5, 15.0, tl.E.inOutSine);
    const fl = Math.exp(-6 * e);
    return {
      bloom: { threshold: 1.0 * (1 - k), knee: 0.5, mix: 0.05 * k, add: 0.25 * (1 - k) },
      streak: { strength: 0.25 * fl },
      // a brief kick (2.7 px in the corners at the peak): stronger splits the background stars into RGB triplets
      ca: 0.0012 + 0.0013 * Math.exp(-5 * e),
      ghosts: 0,
    };
  },
};
export default scene;
