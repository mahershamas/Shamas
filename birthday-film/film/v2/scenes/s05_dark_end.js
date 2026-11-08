/*
  Scene 5: dark-end (54.0-64.5), package P6.
  A midwinter dusk loch painted as a matte: four receding ridges (1D fbm with authored envelopes, analytic AA,
  aerial perspective, mist pooling at their feet, a backlit rim near the sun), a dusk sky (horizon band, warm glow
  around the sun's azimuth, thin stratus lit from below, the first stars), a low sun in the notch of the far ridge
  (disc with limb darkening and the Mie halo), two mist layers drifting left at 6 and 9 px/s, and mirror water at the
  horizon with filtered ripples, wind-ruffled streaks, Fresnel and a glitter path under the sun.
  60.0 (cue 'gold'): the glitter path turns molten (its front runs out from the horizon on the harp glissando,
  11 notes 35 ms apart), 3,000 closed-form motes rise from it, 1,200 of them stream into the last word of line L7b
  left to right (60.25-61.7), which forms in gold leaf under them and takes a specular sweep 61.8-62.6.
  The sun sets into the notch by 62.5 leaving one limb point; 63.0-64.5 the camera pushes into that point (scale
  1.03 -> 6, easeInExpo) while the landscape falls 3 EV and the point grows into the gold orb that lands at the bottom
  centre of scene 6's border.

  Passes: ridge LUT (W x 1, the four ridge tops per screen column) -> mist/cloud field (quarter res) -> the land and sky
  (full res, rows above the horizon) -> the mirrored land and sky (half res, mipmapped) -> ripple field (half res) ->
  water (full res, rows below the horizon) -> overlay: motes, the last-light point and orb; captions: L7a, L7b
  (its first words in cream, its last word and full stop in gold leaf as an hdr entry).

  Exported: dusk(ctx) -> layout numbers, orbAt(ctx, t) -> {x, y, core, glow, I} (the orb scene 6 picks up at 64.5).
*/
import { drawCaptionBands } from './s04_two_shores.js';
import { atRes } from '../core/glsl.js';

const T0 = 54.0;

export function dusk(ctx) {
  if (ctx.portrait) return {
    W: 1080, hz: 1150, notch: [700, 1096], sun0: 1074, sun1: 1118, R: 22, textX: 540, yA: 615, yB: 697, size: 56,
    orbEnd: [540, 1248], colW: 0.03 * 1080,
    ridges: [
      { base: 1166, amp: 70, par: 1.0, f: 0.0042, seed: 11.3, floor: 0.0, det: 2.2, bumps: [[0, 170, 1.05], [1080, 120, 0.7], [-60, 260, 0.2], [1120, 260, 0.15]] },
      { base: 1141, amp: 50, par: 0.6, f: 0.0050, seed: 27.1, floor: 0.0, det: 1.0, bumps: [[90, 200, 1.0], [1050, 140, 0.75], [330, 120, 0.25], [0, 0, 0]] },
      { base: 1116, amp: 34, par: 0.35, f: 0.0058, seed: 3.9, floor: 0.15, det: 0.5, bumps: [[230, 200, 0.85], [1000, 150, 0.6], [470, 90, 0.2], [0, 0, 0]] },
      { base: 1101, amp: 22, par: 0.15, f: 0.0068, seed: 41.7, floor: 0.55, det: 0.3, bumps: [[160, 180, 0.35], [460, 140, 0.3], [700, 75, 0.45], [980, 150, 0.35]] },
    ],
  };
  return {
    W: 1920, hz: 594, notch: [1190, 540], sun0: 518, sun1: 562, R: 22, textX: 960, yA: 300, yB: 372, size: 54,
    orbEnd: [960, 928], colW: 0.03 * 1920,
    ridges: [
      { base: 610, amp: 70, par: 1.0, f: 0.0036, seed: 11.3, floor: 0.0, det: 2.2, bumps: [[40, 300, 1.05], [1910, 190, 0.8], [460, 160, 0.45], [1620, 140, 0.3]] },
      { base: 585, amp: 50, par: 0.6, f: 0.0043, seed: 27.1, floor: 0.0, det: 1.0, bumps: [[250, 280, 1.0], [1830, 230, 0.85], [700, 150, 0.4], [1530, 110, 0.45]] },
      { base: 560, amp: 34, par: 0.35, f: 0.0050, seed: 3.9, floor: 0.12, det: 0.5, bumps: [[470, 320, 0.9], [1720, 260, 0.75], [880, 130, 0.5], [1420, 110, 0.4]] },
      { base: 545, amp: 22, par: 0.15, f: 0.0058, seed: 41.7, floor: 0.55, det: 0.3, bumps: [[300, 280, 0.35], [760, 220, 0.3], [1190, 80, 0.45], [1600, 300, 0.45]] },
    ],
  };
}

// ------------------------------------------------------------------ shared GLSL
const CAM = `
uniform vec2 uF, uO; uniform float uS, uHz, uTau;
vec2 toLayout(vec2 px){ return uF + (px - uO) / uS; }
vec2 toScreen(vec2 q){ return uO + (q - uF) * uS; }
`;

// ridge tops per screen column (global layout y), one texel per column
const LUT_FS = CAM + `
uniform vec4 uM;                         // per-layer forward-drift zoom
uniform vec4 uRB, uRA;                   // bases, amplitudes
uniform vec4 uRN[4];                     // freq, seed, floor, detail px
uniform vec4 uBump[16];                  // centre x, half width, height (4 per ridge)
uniform vec3 uNotch;                     // x, y, (unused)
out vec4 o;
float vn1(float x){ float i = floor(x), f = fract(x); float u = f * f * (3.0 - 2.0 * f); return mix(h11(i), h11(i + 1.0), u); }
float fbm1(float x){ float a = 0.5, s = 0.0, n = 0.0; for (int i = 0; i < 5; i++){ s += a * vn1(x); n += a; x = x * 2.03 + 17.1; a *= 0.5; } return s / n; }
float ridgeTop(int i, float x){
  vec4 N = uRN[i];
  float env = N.z;
  for (int b = 0; b < 4; b++){ vec4 B = uBump[i * 4 + b]; if (B.y > 0.0) env += B.z * exp(-pow((x - B.x) / B.y, 2.0)); }
  float n = fbm1(x * N.x + N.y);
  float sh = env * (0.25 + 1.25 * n);
  // softly rounded crests: hills, not saw teeth
  float y = uRB[i] - uRA[i] * sh;
  y += N.w * ((vn1(x * 0.29 + N.y) - 0.5) + 0.55 * (vn1(x * 0.71 + N.y * 3.0) - 0.5) + 0.3 * (vn1(x * 1.6 + N.y * 5.0) - 0.5));
  if (i == 3){
    // the notch of the far ridge: a soft U whose floor is exactly at the notch y
    float dx = x - uNotch.x;
    float notch = uNotch.y - 19.0 * (1.0 - exp(-dx * dx / (30.0 * 30.0)));
    float w = exp(-dx * dx / (95.0 * 95.0));
    y = mix(y, max(notch, min(y, uNotch.y - 17.0)), w);
    y = mix(y, notch, exp(-dx * dx / (55.0 * 55.0)));
  }
  return y;
}
void main(){
  float x = framePx().x;
  vec4 r;
  for (int i = 0; i < 4; i++){
    float m = uM[i];
    float qx = uF.x + (x - uO.x) / (uS * m);
    float top = ridgeTop(i, qx);
    r[i] = uF.y + (top - uF.y) * m;
  }
  o = r;
}`;

// mist (two layers) and stratus density, quarter resolution
const MIST_FS = CAM + `
out vec4 o;
void main(){
  vec2 px = framePx(); vec2 q = toLayout(px);
  float y = q.y;
  float pa = exp(-0.5 * pow((y - (uHz - 33.0)) / 12.0, 2.0));
  float na = fbm(vec2((q.x + uTau * 6.0) / 210.0, y / 22.0) + vec2(3.1, 7.7), 4);
  float ma = pa * smoothstep(0.46, 0.78, na);
  float pb = exp(-0.5 * pow((y - (uHz - 7.0)) / 9.5, 2.0));
  float nb = fbm(vec2((q.x + uTau * 9.0) / 170.0, y / 18.0) + vec2(9.4, 1.3), 4);
  float mb = pb * smoothstep(0.42, 0.76, nb);
  float e = (uHz - y) / 600.0;
  vec2 cp = vec2((q.x + uTau * 2.5) / 560.0, (uHz - y) / 30.0);
  cp.x += 0.45 * fbm(cp * vec2(0.8, 0.45) + 4.0, 3);
  float nc = fbm(cp + vec2(1.7, 0.0), 4);
  float cl = smoothstep(0.56, 0.82, nc) * smoothstep(0.10, 0.18, e) * (1.0 - smoothstep(0.40, 0.62, e));
  float cl2 = smoothstep(0.6, 0.85, fbm(vec2((q.x + uTau * 1.5) / 900.0, (uHz - y) / 70.0) + vec2(5.0, 2.0), 3)) * smoothstep(0.42, 0.55, e) * (1.0 - smoothstep(0.75, 1.0, e));
  o = vec4(ma, mb, max(cl, cl2 * 0.6), 1.0);
}`;

// the land and the sky at a layout point (shared by the direct pass and the mirrored pass)
const ABOVE = CAM + `
uniform sampler2D uLut, uMist;
uniform vec3 uZen, uMid, uHzc, uGlowC, uSunCore, uSunRim, uSunHalo, uCloudW, uCloudC, uMistA, uMistB, uStarC;
uniform vec4 uSun;       // layout x, y, radius, disc I
uniform vec4 uSunK;      // halo I, glow I, rays I, rim I
uniform vec3 uRc[4], uRh[4];
uniform vec4 uMistK;     // mist A, mist B, clouds, stars
uniform float uBand;
float haloShape(float r){ return 0.9 / (1.0 + (r / 18.0) * (r / 18.0)) + 0.28 * exp(-r / 75.0) + 0.10 * exp(-r / 240.0) + 0.03 * exp(-r / 700.0); }
vec3 skyAt(vec2 q, vec3 m){
  float e = max(uHz - q.y, 0.0) / 600.0;
  vec3 c = mix(uHzc, uMid, 1.0 - exp(-e / uBand));
  c = mix(c, uZen, smoothstep(0.10, 0.92, e));
  float dx = q.x - uSun.x;
  c += uGlowC * uSunK.y * (exp(-abs(dx) / 480.0) * exp(-e / 0.10) + 0.30 * exp(-abs(dx) / 1300.0) * exp(-e / 0.05));
  // thin stratus, lit from below near the sun
  float near = exp(-abs(dx) / 520.0);
  vec3 cc = mix(uCloudC, uCloudW, near) * mix(1.0, 0.72, smoothstep(0.1, 0.55, e));
  c = mix(c, cc, m.b * uMistK.z);
  // the first stars, high up
  vec2 sc = floor(q / 6.0);
  vec2 hv = h22(sc + 71.0);
  if (hv.x > 0.978){
    vec2 sp = (sc + 0.35 + 0.3 * h22(sc + 13.0)) * 6.0;
    float sd = dot(q - sp, q - sp) * uS * uS;
    c += uStarC * exp(-sd / 1.3) * uMistK.w * smoothstep(0.30, 0.95, e) * (0.18 + 0.9 * hv.y * hv.y);
  }
  // sun: limb-darkened disc and the Mie halo, with faint crepuscular rays above the ridges
  vec2 d = q - uSun.xy; float r = length(d);
  float fw = max(fwidth(r), 1e-3);
  // a 1.5 px feathered edge and visible limb darkening toward the warm rim (never a flat clipped sticker)
  float disc = clamp((uSun.z - r) / (1.5 * fw) + 0.5, 0.0, 1.0);
  float mu = sqrt(max(1.0 - r * r / (uSun.z * uSun.z), 0.0));
  c += mix(uSunRim, uSunCore, pow(mu, 0.8)) * uSun.w * disc;
  c += uSunHalo * uSunK.x * haloShape(r);
  if (d.y < 0.0){
    float ang = atan(d.x, -d.y);
    float ray = vn(vec2(ang * 22.0, 3.0)) * vn(vec2(ang * 9.0 - uTau * 0.04, 8.0));
    c += uSunHalo * uSunK.z * ray * exp(-r / 380.0) * smoothstep(20.0, 90.0, r);
  }
  return c;
}
const float RIM_W[4] = float[4](200.0, 230.0, 260.0, 230.0);
const float RIM_I[4] = float[4](0.55, 0.65, 0.7, 0.75);
const float VEIL[4] = float[4](0.08, 0.16, 0.28, 0.45);
const float BASEK[4] = float[4](0.26, 0.30, 0.34, 0.36);
vec3 aboveAt(vec2 q, vec4 tops, vec3 m){
  vec3 c = skyAt(q, m);
  float halo = haloShape(length(q - uSun.xy)) * uSunK.x;
  float grain = vn(q * vec2(0.045, 0.12));
  for (int i = 3; i >= 0; i--){
    float top = tops[i];
    float dd = q.y - top;
    float fw = max(fwidth(dd), 1e-3);
    float cov = clamp(dd / fw + 0.5, 0.0, 1.0);
    float din = max(dd, 0.0);
    vec3 rc = uRc[i];
    rc = mix(rc, uRh[i], smoothstep(0.0, 1.0, din / max(uHz - top, 6.0)) * BASEK[i]);
    rc *= 0.965 + 0.07 * grain;
    float sunNear = exp(-abs(q.x - uSun.x) / RIM_W[i]);
    rc += uSunRim * exp(-din / 1.25) * sunNear * RIM_I[i] * uSunK.w;
    rc += uSunHalo * halo * VEIL[i];
    c = mix(c, rc, cov);
    if (i == 2) c = mix(c, uMistA, clamp(m.r * uMistK.x, 0.0, 1.0));
    if (i == 1) c = mix(c, uMistB, clamp(m.g * uMistK.y, 0.0, 1.0));
  }
  return c;
}
`;

const LAND_FS = ABOVE + `
out vec4 o;
void main(){
  vec2 px = framePx(); vec2 q = toLayout(px);
  vec4 tops = texture(uLut, vec2(px.x / uFrame.x, 0.5));
  vec3 m = texture(uMist, pxToUV(px)).rgb;
  o = vec4(aboveAt(q, tops, m), 1.0);
}`;
// the mirrored land and sky, stored at the screen position where the water shows it
const MIRROR_FS = ABOVE + `
out vec4 o;
void main(){
  vec2 px = framePx(); vec2 q = toLayout(px);
  vec2 qm = vec2(q.x, 2.0 * uHz - q.y);
  vec4 tops = texture(uLut, vec2(px.x / uFrame.x, 0.5));
  vec3 m = texture(uMist, pxToUV(toScreen(qm))).rgb;
  o = vec4(aboveAt(qm, tops, m), 1.0);
}`;

// ripple field: reflection offset (layout px), crest height, wind streak
const RIPPLE_FS = CAM + `
uniform float uZK, uRip, uFl;
out vec4 o;
vec3 vnd(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = h12(i), b = h12(i + vec2(1, 0)), c = h12(i + vec2(0, 1)), d = h12(i + vec2(1, 1));
  return vec3(a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y,
              du.x * (b - a + (a - b - c + d) * u.y), du.y * (c - a + (a - b - c + d) * u.x));
}
void main(){
  vec2 px = framePx(); vec2 q = toLayout(px);
  float dyw = q.y - uHz;
  if (dyw <= 0.0){ o = vec4(0.0); return; }
  float z = uZK / dyw;
  float xw = (q.x - uF.x) * z / uFl;
  vec2 w = vec2(xw, z + uTau * 0.2);
  float fpz = z / dyw / uS;
  vec2 sl = vec2(0.0); float hs = 0.0;
  vec2 fr = vec2(0.42, 1.6); float amp = 1.0;
  for (int k = 0; k < 4; k++){
    vec2 p = w * fr + vec2(float(k) * 7.3 + uTau * 0.05, uTau * (0.32 + 0.1 * float(k)));
    vec3 n = vnd(p);
    float filt = smoothstep(1.4, 0.45, fpz * fr.y);
    sl += n.yz * fr * amp * filt;
    hs += (n.x - 0.5) * amp * filt;
    fr *= 2.17; amp *= 0.5;
  }
  sl *= uRip;
  float streak = smoothstep(0.52, 0.72, fbm(vec2(xw * 0.02 + 1.3, z * 0.085 + uTau * 0.012), 3)) * smoothstep(3.0, 14.0, dyw);
  vec2 off = vec2(sl.x * 0.9, sl.y) * 2.0 * uFl * (1.0 + 0.8 * streak);
  o = vec4(off, hs, streak);
}`;

// Output scale R = 2 (atRes): the sun glitter. Near the horizon its sparkles are smaller than a frame px (ry 0.40) and
// its cell rows are thinner than one, so HD point-samples one cell per frame px and shows each lit one as a 1-frame-px
// dash at its peak. Sampled 4x as densely, R = 2 would light a different, busier set of finer sparkles (local energy
// -17% to +23% against HD). R = 2 therefore picks and weighs every sparkle at the centre gp of its frame px exactly as
// R = 1 does (same cells, flicker, density and crest), keeps the y weight of that HD sample and evaluates only the x
// profile at the physical px. The x profile (rx >= 0.9 frame px on cells >= 3 frame px wide) is resolved at HD, so a
// sharper x keeps each sparkle's energy; a sharper y (a sub-pixel split, or the natural y profile of the larger near
// sparkles) reads dimmer through the tonemap.
const GLITTER_R1 = `  if (max(dens, densM * uGl.w) > 0.0008 && uGl.x > 0.0){
    vec3 gc = mix(uGlC, uMolC, uGl.w);
    float crest = smoothstep(-0.10, 0.30, R.z);
    for (int k = 0; k < 2; k++){
      float ko = float(k);
      vec2 cs = vec2(3.0 + 10.0 * nearK, 1.0) * uS;
      float rowK = 26.0;
      vec2 g = vec2((px.x - uSunS.x) / cs.x + ko * 0.5, log(max(dyw, 0.3)) * rowK + ko * 0.5);
      vec2 cell = floor(g);
      vec2 hc = h22(cell + vec2(17.0 + ko * 41.0, 3.0));
      float tb = floor(uTau * 10.0 + hc.y * 0.999);
      vec2 hv = h22(cell + vec2(tb * 37.0 + ko * 7.0, 11.0));
      vec2 cc = cell + 0.25 + 0.5 * h22(cell + vec2(5.0 + ko, tb * 13.0 + 3.0));
      float rowPx = max(dyw, 0.3) / rowK * uS;
      float dxp = (g.x - cc.x) * cs.x, dyp = (g.y - cc.y) * rowPx;
      float rx = (0.9 + 2.6 * nearK) * uS, ry = (0.40 + 0.9 * nearK) * uS;
      float pt = exp(-(dxp * dxp / (rx * rx) + dyp * dyp / (ry * ry)));
      float on = step(1.0 - dens * (0.55 + 0.4 * uGl.w), hv.x);
      c += gc * uGl.x * on * pt * (0.5 + hv.y) * (0.45 + 0.55 * crest) * 5.0;
    }`;
const GLITTER_R2 = `  vec2 gp = floor(px) + 0.5, gq = toLayout(gp);
  float gdyw = max(gq.y - uHz, 0.0), gnK = clamp(gdyw / uSpan, 0.0, 1.0);
  float gnX = 0.5 * (gq.x - uGl2.y) / fl, gnZ = 0.5 * (gdyw - (uHz - uGl2.z)) / fl;
  float gdens = exp(-0.5 * (gnX * gnX / (sx * sx) + gnZ * gnZ / (sz * sz)));
  if (max(max(dens, gdens), densM * uGl.w) > 0.0008 && uGl.x > 0.0){
    vec3 gc = mix(uGlC, uMolC, uGl.w);
    float crest = smoothstep(-0.10, 0.30, texture(uR, pxToUV(gp)).z);
    for (int k = 0; k < 2; k++){
      float ko = float(k);
      vec2 cs = vec2(3.0 + 10.0 * gnK, 1.0) * uS;
      float rowK = 26.0;
      vec2 g = vec2((gp.x - uSunS.x) / cs.x + ko * 0.5, log(max(gdyw, 0.3)) * rowK + ko * 0.5);
      vec2 cell = floor(g);
      vec2 hc = h22(cell + vec2(17.0 + ko * 41.0, 3.0));
      float tb = floor(uTau * 10.0 + hc.y * 0.999);
      vec2 hv = h22(cell + vec2(tb * 37.0 + ko * 7.0, 11.0));
      vec2 cc = cell + 0.25 + 0.5 * h22(cell + vec2(5.0 + ko, tb * 13.0 + 3.0));
      float rowPx = max(gdyw, 0.3) / rowK * uS;
      // x at this physical px, y at the frame px centre
      float dxp = (g.x - cc.x) * cs.x + (px.x - gp.x), dyp = (g.y - cc.y) * rowPx;
      float rx = (0.9 + 2.6 * gnK) * uS, ry = (0.40 + 0.9 * gnK) * uS;
      float pt = exp(-(dxp * dxp / (rx * rx) + dyp * dyp / (ry * ry)));
      float on = step(1.0 - gdens * (0.55 + 0.4 * uGl.w), hv.x);
      c += gc * uGl.x * on * pt * (0.5 + hv.y) * (0.45 + 0.55 * crest) * 5.0;
    }`;
const WATER_FS = CAM + `
uniform sampler2D uA, uR, uMist;
uniform vec3 uDeep, uMistB, uShore, uGlC, uMolC;
uniform vec4 uGl;        // glitter I, facet slope sigma x, facet slope sigma z, molten amount
uniform vec4 uGl2;       // molten front (layout px below the horizon), sun layout x, sun layout y, focal px
uniform vec2 uSunS;      // screen x of the sun's column
uniform float uMistBK, uSpan;
uniform vec2 uMolFade;   // frame y where the molten sheen fades out (portrait: the path keeps only its sparkles there)
uniform vec3 uNearLod;   // extra reflection blur toward the frame's bottom: amount (mip levels), from frame y, to frame y (portrait)
out vec4 o;
void main(){
  vec2 px = framePx(); vec2 q = toLayout(px);
  float hzS = toScreen(vec2(0.0, uHz)).y;
  float cov = clamp(px.y - hzS + 0.5, 0.0, 1.0);
  if (cov <= 0.0) discard;
  float dyw = max(q.y - uHz, 0.0);
  vec4 R = texture(uR, pxToUV(px));
  float nearK = clamp(dyw / uSpan, 0.0, 1.0);
  vec2 look = px + R.xy * uS;
  look.y = max(look.y, hzS + 0.6);
  float lod = 0.3 + 1.1 * nearK + 1.8 * R.w;
  // portrait: the near water reflects the high sky, where its stars would break into blocky dashes; it blurs them away
  lod += uNearLod.x * smoothstep(uNearLod.y, uNearLod.z, px.y);
  vec3 refl = textureLod(uA, pxToUV(look), lod).rgb;
  // wind-ruffled streaks reflect a broad patch of sky: lighter, softer
  vec3 broad = textureLod(uA, pxToUV(vec2(look.x, look.y + 40.0 * uS)), 4.5).rgb;
  refl = mix(refl, broad * 1.08, 0.55 * R.w);
  float F = mix(0.96, 0.52, pow(nearK, 0.7));
  vec3 c = mix(uDeep, refl, F);
  // a thin luminous line where the far water meets the land
  c += uShore * exp(-(px.y - hzS) / (1.1 * uS)) * 0.55;
  // mist lying on the water near the horizon
  c = mix(c, uMistB, clamp(texture(uMist, pxToUV(px)).g * uMistBK, 0.0, 1.0));
  // sun glitter: a facet glints when its tilt mirrors the sun into this pixel; the glint probability is the
  // facet-slope density at the tilt needed (Cox-Munk style), so the path's width and length emerge from the slope
  // statistics. Hashed facets, elongated along the ripples, deterministic flicker at 10 Hz. Molten from cue 'gold'.
  float fl = uGl2.w;
  float needX = 0.5 * (q.x - uGl2.y) / fl;
  float needZ = 0.5 * (dyw - (uHz - uGl2.z)) / fl;
  float sx = uGl.y, sz = uGl.z;
  float dens = exp(-0.5 * (needX * needX / (sx * sx) + needZ * needZ / (sz * sz)));
  float zW = fl / max(dyw, 0.3);
  float xw = (q.x - uGl2.y) / max(dyw, 0.3);
  float nX = needX - 0.9 * R.x / (2.0 * fl) + 0.012 * (vn(vec2(xw * 3.0, zW * 0.7 + uTau * 0.4)) - 0.5);
  float densM = exp(-0.5 * (nX * nX / (sx * sx) + needZ * needZ / (sz * sz)));
${atRes(GLITTER_R1, GLITTER_R2)}
    // molten: liquid gold in rolling swell bands (world-anchored, filtered where they would alias)
    float mol = uGl.w * smoothstep(uGl2.x + 30.0, uGl2.x - 30.0, dyw);
    float res = 1.0 - smoothstep(0.12, 0.45, zW / max(dyw, 0.3) / uS * 1.4 / 6.283);
    // the column's edges wobble with the ripple slopes; the swell bands are warped along x, so the sheen breaks
    // into liquid tongues instead of straight bars
    float sw = 0.5 + 0.5 * sin(zW * 1.4 + 3.2 * R.z + 2.2 * vn(vec2(xw * 2.2 + 7.0, zW * 0.35)) + uTau * 1.7);
    float bands = mix(0.4, pow(sw, 3.0), res);
    // tongues of liquid gold (a small broad term), warm and saturated
    c += uMolC * mol * densM * (0.02 + 1.2 * bands) * (0.35 + 0.65 * smoothstep(-0.1, 0.3, R.z)) * 0.65 * uGl.x * (1.0 - smoothstep(uMolFade.x, uMolFade.y, px.y));
  }
  o = vec4(c * cov, cov);
}`;

// motes: 3,000 closed form, the first uNS steered into the gold word
const MOTES = `
uniform sampler2D uHome;
uniform vec2 uF, uO; uniform float uS, uHz, uColW, uExit, uU, uT0, uSpan;
uniform vec2 uSunL;
uniform vec3 uC1, uC2;
uniform int uNS;
out float vGlint;
float hh(int id, float k){ return h12(vec2(float(id) * 1.618 + k * 31.7, k * 7.3 + 0.5)); }
void particle(int id, out vec2 px, out float size, out vec4 col){
  float t = uTau; vGlint = 0.0;
  bool st = id < uNS;
  float tb = st ? uT0 + 0.30 * hh(id, 1.0) : uT0 + 2.6 * pow(hh(id, 1.0), 1.3);
  float a = t - tb;
  px = vec2(-100.0); size = 0.0; col = vec4(0.0);
  if (a < 0.0) return;
  float dep = pow(hh(id, 3.0), 1.6);
  float y0 = uHz + 3.0 + uSpan * 0.62 * dep;
  float w = uColW * (0.45 + 0.9 * dep) * (st ? 1.0 : 2.0);
  float x0 = uSunL.x + (hh(id, 2.0) - 0.5) * 2.0 * w * (0.5 + 0.5 * hh(id, 9.0));
  float vy = -(10.0 + 15.0 * hh(id, 4.0)) * (0.55 + 0.6 * dep);
  vec2 L = vec2(x0 + 7.0 * sin(a * (0.6 + hh(id, 5.0)) + hh(id, 6.0) * 6.28) * (0.3 + dep), y0 + vy * a);
  vec2 P = uO + (L - uF) * uS;
  vec3 c = mix(uC1, uC2, hh(id, 7.0));
  float tw = 0.6 + 0.4 * sin(t * (5.0 + 7.0 * hh(id, 8.0)) + hh(id, 10.0) * 6.28);
  float I = (st ? 1.6 : 2.2) * (1.0 + 2.5 * pow(hh(id, 11.0), 2.0)) * tw;
  float al = smoothstep(0.0, 0.3, a) * uExit;
  size = (1.0 + 1.5 * hh(id, 12.0)) * (0.5 + 0.7 * dep) * uU * (st ? 1.0 : 1.5);
  if (st){
    vec4 H = fetchPoint(uHome, id);
    float ta = uT0 + 0.25 + 1.4 * H.z + 0.08 * (hh(id, 13.0) - 0.5);
    float k = clamp(a / max(ta - tb, 0.05), 0.0, 1.0);
    float ke = k * k * (3.0 - 2.0 * k);
    vec2 S0 = uO + (vec2(x0, y0) - uF) * uS;
    vec2 P1 = S0 + vec2(-30.0 - 70.0 * hh(id, 14.0), -(150.0 + 130.0 * hh(id, 15.0))) * uU;
    vec2 P2 = H.xy + vec2(-(40.0 + 80.0 * hh(id, 16.0)), 34.0 + 46.0 * hh(id, 17.0)) * uU;
    float u = 1.0 - ke;
    P = u * u * u * S0 + 3.0 * u * u * ke * P1 + 3.0 * u * ke * ke * P2 + ke * ke * ke * H.xy;
    I = mix(I, 4.5, smoothstep(0.0, 0.25, k));
    size = mix(size, 1.5 * uU, ke);
    float gl = t - ta;
    if (gl >= 0.0){
      if (gl < 0.14){ vGlint = 1.0; size = 8.0 * uU; I = 4.0 * (1.0 - gl / 0.14); al = uExit; }
      else al = 0.0;
    }
  } else {
    al *= 1.0 - smoothstep(2.0 + 1.8 * hh(id, 18.0), 3.6 + 1.6 * hh(id, 19.0), a);
  }
  px = P;
  col = vec4(c * I, al);
}`;
// Output scale R = 2 (atRes): every glint here is a landing glint on a text.points home (a frame-pixel centre, a texel
// corner at R = 2). Its arms are snapped across their width by 0.35 texel (0.7 / vSize in q: s), which keeps their R = 1
// brightness to about 1 percent (unsnapped they lose a third; a full half-texel snap overshoots, as these arms are
// wider than one pixel).
const MOTE_FS = `
in vec4 vCol; in float vSize; in float vGlint;
out vec4 o;
void main(){
  vec2 q = (gl_PointCoord * 2.0 - 1.0) * (vSize + 2.0) / max(vSize, 1.0);
  float w;
  if (vGlint > 0.5){
    ${atRes('vec2 a = abs(q);', 'vec2 a = abs(q), s = max(a - 0.7 / max(vSize, 1.0), 0.0);')}
    // a soft glint with an anamorphic (horizontal) bias: the vertical arm is a third as long
    ${atRes('w = (exp(-a.y * 9.0) * max(1.0 - a.x, 0.0) + 0.6 * exp(-a.x * 9.0) * max(1.0 - 3.0 * a.y, 0.0)) * 0.9 + exp(-dot(q, q) * 7.0) * 1.2;', 'w = (exp(-s.y * 9.0) * max(1.0 - a.x, 0.0) + 0.6 * exp(-s.x * 9.0) * max(1.0 - 3.0 * a.y, 0.0)) * 0.9 + exp(-dot(q, q) * 7.0) * 1.2;')}
  } else w = exp(-dot(q, q) * 2.0);
  o = vec4(vCol.rgb * vCol.a * w, 0.0);
}`;

// the last limb point and the orb (additive, viewport-limited)
const ORB_FS = `
uniform vec2 uP; uniform vec4 uOrb;     // core radius, glow radius, I, star rays
uniform vec3 uCore, uGlow, uWhite;
out vec4 o;
void main(){
  vec2 q = framePx() - uP; float r = length(q);
  vec2 a = abs(q);
  float core = smoothstep(uOrb.x + 1.0, max(uOrb.x - 1.0, 0.0), r);
  float glow = 0.55 * exp(-r / (uOrb.y * 0.18)) + 0.30 * exp(-r / (uOrb.y * 0.45)) + 0.08 * exp(-r / uOrb.y);
  float rays = (exp(-a.y * a.y / 0.6) * exp(-a.x / 34.0) + exp(-a.x * a.x / 0.6) * exp(-a.y / 34.0));
  vec3 c = uWhite * core * 6.0 + uCore * exp(-r * r / (2.0 * max(uOrb.x, 1.0) * max(uOrb.x, 1.0))) * 3.0 + uGlow * glow + uWhite * rays * uOrb.w;
  o = vec4(c * uOrb.z, 0.0);
}`;

function lerp3(a, b, k) { return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]; }

const scene = {
  id: 's05_dark_end', t0: 54.0, t1: 64.5, internalScale: 1, look: 'winter_gold',
  async init(ctx) {
    const { G, glsl, particles, text } = ctx;
    this.D = dusk(ctx);
    const fr = s => glsl.frag(s);
    this.P = {
      lut: G.program('s05.lut', fr(LUT_FS)), mist: G.program('s05.mist', fr(MIST_FS)), land: G.program('s05.land', fr(LAND_FS)),
      mirror: G.program('s05.mirror', fr(MIRROR_FS)), ripple: G.program('s05.ripple', fr(RIPPLE_FS)), water: G.program('s05.water', fr(WATER_FS)),
      orb: G.program('s05.orb', fr(ORB_FS)),
    };
    this.motes = particles.program('s05.motes', MOTES, { fs: MOTE_FS });
    const S = h => ctx.displayToScene(h);
    const night = (h, k, blue = 1.08) => S(h).map((v, i) => v * k * (i === 2 ? blue : 1));
    this.col = {
      zen: [S('#24345A'), night('#24345A', 0.30, 1.1)], mid: [S('#8E7BA0'), night('#8E7BA0', 0.16, 1.25)], hzc: [S('#F2B26E'), night('#F2B26E', 0.13)],
      // the dusk opens darker (straight out of scene 4's navy) and warms to the build-sheet sky by 58.0
      zenEarly: S('#1A2547'), midEarly: S('#6E5F86'), hzcEarly: S('#C98E62'),
      glow: S('#F2A65A'), core: S('#FFF0C8'), rim: S('#FFC870'), halo: S('#F2A65A'),
      cloudW: S('#F4B48C'), cloudC: S('#6E6488'),
      ridge: ['#3B3F5C', '#4E5677', '#6B7395', '#8E95B0'].map(h => [S(h), night(h, 0.30, 1.15)]),
      mist: [S('#C9C3CC'), night('#C9C3CC', 0.22, 1.1)],
      deep: [S('#120F20'), night('#120F20', 0.45)],
      gl: S('#FFC870'), molA: S('#F0A548'), molB: S('#F6C76B'),
      m1: ctx.hexLin('#FFE7A3'), m2: ctx.hexLin('#D4A64A'), star: ctx.hexLin('#DCE6FF'),
      orbCore: ctx.hexLin('#FFE7A3'), orbGlow: ctx.hexLin('#FFD27A'), white: [1.0, 0.95, 0.84],
    };
    // the gold word of L7b (and its full stop) in gold leaf; mote homes on it
    const D = this.D;
    this.goldRange = text.wordRange('L7b', -1);
    const ent = this.lineB(ctx, 10);
    const gEnt = Object.assign({}, ent, { part: [this.goldRange[0], 999] });
    const pts = text.points(gEnt, { count: 1200, seed: 6001, threshold: 0.5 });
    const data = new Float32Array(1200 * 4);
    for (let i = 0; i < 1200; i++) { data[i * 4] = pts.pts[i * 2]; data[i * 4 + 1] = pts.pts[i * 2 + 1]; data[i * 4 + 2] = pts.xn[i]; }
    this._home = particles.pointsTexture(data, 4);
    this._ink = [pts.x0, pts.x1, pts.y0, pts.y1];
    void D;
  },
  // camera: push 1.00 -> 1.03 toward the notch (54-63), then 1.03 -> 6 into the last light while the point travels to
  // the orb's landing place
  cam(ctx, t) {
    const { tl } = ctx, D = this.D;
    const push = 1 + 0.03 * tl.seg(t, 54.0, 63.0, tl.E.inOutSine);
    // mostly exponential, with a little linear so the push already reads (scale about 1.9 at 64.0, 6 at 64.5)
    const pk = tl.seg(t, 63.0, 64.5);
    const k = 0.12 * pk + 0.88 * tl.E.inExpo(pk);
    const km = tl.seg(t, 63.0, 64.5, tl.E.inOutSine);
    const S = push * (1 + (6 / 1.03 - 1) * k);
    const O = [D.notch[0] + (D.orbEnd[0] - D.notch[0]) * km, D.notch[1] + (D.orbEnd[1] - D.notch[1]) * km];
    return { F: D.notch, O, S };
  },
  sunAt(ctx, t) {
    const D = this.D;
    const y = D.sun0 + (D.sun1 - D.sun0) * ctx.tl.seg(t, 54.0, 62.5, ctx.tl.E.inOutSine);
    const vis = Math.min(1, Math.max(0, (D.notch[1] - (y - D.R)) / (2 * D.R)));
    return { x: D.notch[0], y, vis };
  },
  frameState(ctx, t) {
    const { tl } = ctx, E = tl.E, C = this.col;
    const u = tl.seg(t, 54.0, 64.0, E.inOutSine);         // dusk -> night
    const sun = this.sunAt(ctx, t);
    const cam = this.cam(ctx, t);
    const tau = t - T0;
    const m = [1.0, 0.6, 0.35, 0.15].map(par => 1 + par * 0.0045 * Math.max(0, tau));
    const after = tl.seg(t, 62.3, 64.0, E.inOutSine);
    const sv = Math.sqrt(sun.vis);
    const early = 1 - tl.seg(t, 54.0, 58.0, E.inOutSine);
    return {
      t, tau, u, sun, cam, m,
      uni: {
        uF: cam.F, uO: cam.O, uS: cam.S, uHz: this.D.hz, uTau: tau,
        uZen: lerp3(lerp3(C.zen[0], C.zenEarly, early), C.zen[1], u), uMid: lerp3(lerp3(C.mid[0], C.midEarly, early), C.mid[1], u),
        uHzc: lerp3(lerp3(C.hzc[0], C.hzcEarly, early), C.hzc[1], Math.pow(u, 1.3)),
        uGlowC: C.glow, uSunCore: C.core, uSunRim: C.rim, uSunHalo: C.halo, uCloudW: C.cloudW.map(v => v * (1 - 0.7 * u)), uCloudC: C.cloudC.map(v => v * (1 - 0.75 * u)),
        uMistA: lerp3(C.mist[0], C.mist[1], u), uMistB: lerp3(C.mist[0], C.mist[1], u * 0.9),
        uSun: [sun.x, sun.y, this.D.R, 2.1 * (0.75 + 0.25 * sv)],
        uSunK: [0.88 * (0.25 + 0.75 * sv) * (1 - 0.7 * after), 0.55 * (0.3 + 0.7 * sv) * (1 - 0.6 * after), 0.035 * sv, 0.65 * (0.15 + 0.85 * sv)],
        uRc: C.ridge.map(r => lerp3(r[0], r[1], u)).flat(),
        uRh: C.ridge.map((r, i) => lerp3(lerp3(r[0], C.hzc[0], 0.32 + 0.06 * i), lerp3(r[1], C.hzc[1], 0.25), u)).flat(),
        uMistK: [0.35 * (1 - 0.3 * u), 0.35 * (1 - 0.3 * u), 0.55 * (1 - 0.4 * u), 0.15 + 0.85 * tl.seg(t, 57.0, 63.0)],
        uStarC: C.star, uBand: 0.13 - 0.07 * u,
      },
    };
  },
  render(ctx, tau, p, target) {
    const { G } = ctx, D = this.D;
    const t = T0 + tau;
    const st = this.frameState(ctx, t);
    const U = st.uni;
    const sc = target.scale == null ? 1 : target.scale;
    const W = ctx.W, H = ctx.H;
    // 1 ridge tops per column (one texel per physical column: LAND samples it at u = px.x / uFrame.x)
    const lut = G.target('s05.lut', W * sc, 1, { format: 'rgba32f', scale: sc });
    const R = D.ridges;
    const bumps = new Float32Array(64);
    R.forEach((r, i) => r.bumps.forEach((b, j) => bumps.set([b[0], b[1], b[2], 0], (i * 4 + j) * 4)));
    G.draw(this.P.lut, {
      uF: U.uF, uO: U.uO, uS: U.uS, uM: st.m, uRB: R.map(r => r.base), uRA: R.map(r => r.amp),
      uRN: R.map(r => [r.f, r.seed, r.floor, r.det]).flat(), uBump: bumps, uNotch: [D.notch[0], D.notch[1], 0],
    }, lut);
    // 2 mist and clouds (quarter res)
    const mist = G.target('s05.mist', W / 4 * sc, H / 4 * sc, { scale: 0.25 * sc });
    G.draw(this.P.mist, U, mist);
    const hzS = U.uO[1] + (D.hz - U.uF[1]) * U.uS;
    const rowsAbove = Math.min(H, Math.ceil(hzS + 2));
    // 3 land and sky (full res, rows above the horizon)
    if (rowsAbove > 0) {
      const y0 = Math.max(0, Math.floor((H - rowsAbove) * sc));
      G.draw(this.P.land, Object.assign({ uLut: lut, uMist: mist }, U), target, { viewport: [0, y0, target.w, target.h - y0] });
    }
    if (hzS < H - 0.5) {
      const top = Math.max(0, Math.floor(hzS - 2));
      // 4 the mirrored land (half res, mipmapped). The mirror and the ripples keep the HD half-res density at every
      // output scale: the water's textureLod levels (reflection blur, broad streak patch, portrait near blur) are tuned
      // for 2 frame px per texel
      const hs = sc / G.R;   // = sc at R = 1
      const A = G.target('s05.refl', W / 2 * hs, H / 2 * hs, { scale: 0.5 * hs, mips: true });
      const ah = Math.ceil((H - top) / 2 * hs);
      G.draw(this.P.mirror, Object.assign({ uLut: lut, uMist: mist }, U), A, { viewport: [0, 0, A.w, Math.min(A.h, ah + 1)] });
      G.mipmaps(A);
      // 5 ripples (half res)
      const Rt = G.target('s05.ripple', W / 2 * hs, H / 2 * hs, { scale: 0.5 * hs });
      G.draw(this.P.ripple, Object.assign({ uZK: 1745 * 1.0, uRip: 0.0022, uFl: 1745 }, U), Rt, { viewport: [0, 0, Rt.w, Math.min(Rt.h, ah + 1)] });
      // 6 water
      const tl = ctx.tl;
      const gold = tl.seg(t, 60.0, 60.4, tl.E.outCubic);
      const sunGone = st.sun.vis;
      const fade = (0.35 + 0.65 * tl.smoothstep(0, 0.3, sunGone)) * (1 - tl.seg(t, 62.0, 63.2, tl.E.inOutSine));
      const molten = gold * (1 - tl.seg(t, 62.3, 63.2, tl.E.inOutSine));
      const span = H - D.hz;
      const sunS = [U.uO[0] + (st.sun.x - U.uF[0]) * U.uS, 0];
      G.draw(this.P.water, Object.assign({
        uA: A, uR: Rt, uMist: mist, uDeep: lerp3(this.col.deep[0], this.col.deep[1], st.u), uMistB: U.uMistB, uMistBK: 0.18 * (1 - 0.3 * st.u),
        uShore: lerp3(U.uHzc, U.uMid, 0.3).map(v => v * 0.6), uGlC: this.col.gl, uMolC: lerp3(this.col.molA, this.col.molB, tl.seg(t, 60.0, 60.9)),
        uGl: [(1 + 1.2 * gold) * Math.min(1, fade), 0.0068 + 0.004 * molten, 0.040 + 0.03 * molten, molten],
        uGl2: [span * tl.seg(t, 60.0, 60.385), st.sun.x, st.sun.y, 1745], uSunS: sunS, uSpan: span,
        uMolFade: ctx.portrait ? [1500, 1700] : [1e5, 2e5],
        uNearLod: ctx.portrait ? [2.2, 1350, 1720] : [0, 1e5, 2e5],
      }, U), target, { blend: 'premul', viewport: [0, 0, target.w, Math.min(target.h, Math.ceil((H - top) * sc))] });
    }
    // the lines sit on the dusk sky (stratus, the first stars): a soft darker band under each
    drawCaptionBands(ctx, target, this.bandEntries(ctx, t), 0.38);
    // the last light and the orb live in the scene target: scene 6's 'over' entrance covers it as it takes over
    this.drawOrb(ctx, t, target);
  },
  drawOrb(ctx, t, target) {
    const { G } = ctx;
    const o = this.orbAt(ctx, t);
    if (o.I > 0.001) {
      const r = Math.ceil(o.glow * 4 + 60);
      const s = target.scale == null ? 1 : target.scale;
      const x0 = Math.max(0, Math.floor((o.x - r) * s)), x1 = Math.min(target.w, Math.ceil((o.x + r) * s));
      const y0 = Math.max(0, Math.floor((ctx.H - o.y - r) * s)), y1 = Math.min(target.h, Math.ceil((ctx.H - o.y + r) * s));
      if (x1 > x0 && y1 > y0) G.draw(this.P.orb, { uP: [o.x, o.y], uOrb: [o.core, o.glow, o.I, o.rays], uCore: this.col.orbCore, uGlow: this.col.orbGlow, uWhite: this.col.white },
        target, { blend: 'add', viewport: [x0, y0, x1 - x0, y1 - y0] });
    }
  },
  orbAt(ctx, t) {
    const { tl } = ctx, D = this.D;
    const st = this.sunAt(ctx, t);
    const cam = this.cam(ctx, t);
    // the last limb glint becomes a point at the notch, then the push grows it into the orb
    const pt = (1 - tl.smoothstep(0.0, 0.10, st.vis)) * tl.seg(t, 61.9, 62.5, tl.E.inOutSine);
    const g = tl.seg(t, 63.0, 64.5, tl.E.inCubic);
    const comp = Math.pow(2, 3 * tl.seg(t, 63.0, 64.5, tl.E.inOutSine));    // keeps the orb's brightness through the -3 EV
    return { x: cam.O[0], y: cam.O[1], core: 1.4 + 7.6 * g, glow: (14 + 66 * g) * ctx.U, I: (0.9 * pt + 0.25 * g) * comp, rays: 0.35 * pt * (1 - g) };
  },
  overlay(ctx, tau, p, target) {
    const { G, tl } = ctx, D = this.D;
    const t = T0 + tau;
    if (t >= 60.0 && t < 63.8) {
      const cam = this.cam(ctx, t);
      ctx.particles.draw(this.motes, 3000, {
        uTau: t, uHome: this._home, uF: cam.F, uO: cam.O, uS: cam.S, uHz: D.hz, uColW: D.colW, uExit: 1 - tl.seg(t, 62.6, 63.6, tl.E.inOutSine),
        uU: ctx.U, uT0: 60.0, uSpan: ctx.H - D.hz, uSunL: [D.notch[0], 0], uC1: this.col.m1, uC2: this.col.m2, uNS: 1200,
      }, target);
    }
  },
  lineB(ctx, tau) {
    const D = this.D;
    return { lineId: 'L7b', tau, x: D.textX, y: D.yB, style: { base: 'narrative', size: D.size }, opacity: 0.92, exit: { at: 2.6, kind: 'mist', dur: 1.0 } };
  },
  // one entry per line for the caption bands (the gold word is part of line L7b's row)
  bandEntries(ctx, t) {
    return this.captions(ctx, t - T0).filter(e => e.layer !== 'hdr').map(e => { const o = Object.assign({}, e); delete o.part; return o; });
  },
  captions(ctx, tau) {
    const t = T0 + tau, D = this.D;
    const out = [];
    if (t >= 54.45) out.push({ lineId: 'L7a', tau: t - 54.5, x: D.textX, y: D.yA, style: { base: 'narrative', size: D.size }, opacity: 0.92, enter: { base: 'default', stagger: 0.05, dur: 0.5 }, exit: { at: 8.1, kind: 'mist', dur: 1.0 } });
    if (t >= 59.95) {
      const b = this.lineB(ctx, t - 60.0);
      const g0 = this.goldRange[0];
      out.push(Object.assign({}, b, { part: [0, g0] }));
      const sun = this.sunAt(ctx, t), cam = this.cam(ctx, t);
      const sx = cam.O[0] + (sun.x - cam.F[0]) * cam.S, sy = cam.O[1] + (sun.y - cam.F[1]) * cam.S;
      out.push(Object.assign({}, b, {
        part: [g0, 999], layer: 'hdr', enter: 'none', opacity: 1,
        // the reveal runs past the ink's end, so the full stop forms with the last letter instead of popping after it
        reveal: { t0: 0.15, span: 1.4, dur: 0.35, lo: 0.4, hi: 1.0, x0: this._ink[0], x1: this._ink[1] + 14 * ctx.U },
        sweeps: [{ at: 1.8, dur: 0.8, I: 1.6, width: 46 }],
        glints: [{ at: 2.45, glyph: this.goldRange[0] + 1, size: 18, I: 2.5, dur: 0.35 }],
        // the gold word leaves last, with the same mist exit as the cream words
        exit: { at: 2.75, kind: 'mist', dur: 1.0 },
        gold: { look: 'winter_gold', key: [sx, sy], keyZ: 260, keyI: 4.2 },
      }));
    }
    return out;
  },
  post(ctx, tau) {
    const t = T0 + tau, tl = ctx.tl, E = tl.E;
    // the dusk opens dark (-0.8 EV, darker than scene 4's dimmed sea) and recovers to -0.2 EV by 59.5
    // (back to 0 EV by 63.2, so the push and the orb that scene 6 picks up at 64.5 are unchanged)
    const ev = -0.8 + 0.6 * tl.seg(t, 56.0, 59.5, E.inOutSine) + 0.2 * tl.seg(t, 62.4, 63.2, E.inOutSine) - 3.0 * tl.seg(t, 63.0, 64.5, E.inOutSine);
    return { exposure: ev, ca: 0.0015 };
  },
};
export default scene;
