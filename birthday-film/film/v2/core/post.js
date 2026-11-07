/*
  core/post.js: the post chain of SPEC 4.4, in order.
    1 scene HDR (RGBA16F) x 2^exposure
    2 bloom: 6-level dual filter (Kawase/Bjorge), Karis average on the first down, soft-knee threshold,
      level weights [0.6, 0.8, 0.9, 1.0, 1.2, 1.4] normalised.  hdr' = hdr*(1 - mix*[thr==0]) + bloom*(mix + add)
      (threshold 0: energy-conserving mix; threshold > 0: additive glow of the thresholded energy)
    3 anamorphic streak: threshold at quarter resolution (3-tap vertical soften), then a horizontal-only pyramid
      (7 levels, W/4 .. W/256, 1-3-3-1 down, tent up) summed with weights STREAK_W: a sum of Gaussians of doubling
      width, so the profile falls off smoothly (monotone, no flat top, no hard ends; visible to about +-600 px), tint
    4 ghosts and halo from bloom mip 2 (only when params.ghosts > 0: scenes with a point light in frame), gated off on
      dark frames (mean luma of bloom mip 6 below about 0.03), where they read as dust on the lens
    5 lens dirt: seeded Canvas texture (300 discs, 25 hexagons, 6 smudges) x (mip4 + mip5)/2 x dirt, gated by
      smoothstep(0.15, 1.2, luma) so that dim fields never show the dust (only point lights and flashes do)
    6 halation: mip1 x (1.0, 0.28, 0.08) x halation x smoothstep(0.6, 2.0, luma(mip1))
    7 chromatic aberration: radial and isotropic in frame px, shift = ca * min(W,H) * r^3 px (r = distance from the
      centre / half-diagonal, so 1 in the corners; portrait is no worse than landscape), R outward and B inward, each
      averaged over two taps (a short smear rather than a split dot). Skipped where the shift is under 0.05 px.
      Gold-leaf text is exempt: run(..., {noCA: rt}) takes a coverage target (alpha) of the HDR text, and where it
      covers (at the pixel or at either shifted tap) the unshifted scene is used. Captions are drawn after the post.
    8 vignette: aspect-aware, params.vignette
    9 AgX, then the look: CDL (slope/offset/power) + saturation in AgX display space, split tone in linear display,
      face-ellipse hue protection (photo look), sRGB encode  -> display target (RGBA16F, sRGB-encoded values)
      The tonemap and grade are baked per frame into a 48^3 RGBA16F 3D LUT over AgX's log2 range (rebuilt only when
      the grade changes), so the full-res composite does one LUT fetch instead of the AgX/CDL maths.
      Steps 2 (last upsample) to 6 are summed at half resolution into one glow texture, so the full-resolution
      composite reads only the scene (3 taps for CA), the glow and the LUT.
   11 TPDF dither +-1 LSB in the same composite pass, output to the canvas
   10 captions are then composited by core/text.js onto the canvas (display space, after the grade). Deviation from
      the spec order: the dither is applied before the captions (saves one full-resolution pass, about 40 ms on the
      software rasteriser); caption edges are anti-aliased 8-bit coverage, so they need no dither.

  API
    const post = createPost(G)
    post.params(lookName | [{look, w}], ...overrides) -> params    (deep-merged; see DEFAULTS and LOOKS)
    post.lerp(paramsA, paramsB, w) -> params                     (numeric deep lerp; used across transitions)
    post.run(hdrRT, params, frameIndex, {noCA})                  whole chain to the canvas (dithered, sRGB); draw captions after
                                                                 noCA: optional RT whose alpha marks pixels exempt from CA
    post.mips                                                    {d1..d6} bloom down levels of the last run (read-only)
    displayToScene(rgbOrHex, params = DEFAULTS) -> [r,g,b]       linear scene HDR value that the tonemap + grade turn into
                                                                 the given display sRGB colour (centre of frame, no bloom);
                                                                 lets scenes hit the palette hexes exactly. Pure JS.
    sceneToDisplay([r,g,b], params) -> [r,g,b]                   the forward model (sRGB 0..1), mirrors the shader
    DEFAULTS, LOOKS                                              exported for scenes that want to read the numbers

  Params (all optional in overrides):
    exposure (EV), bloom {threshold, knee, mix, add}, streak {threshold, strength, tint}, ghosts (strength),
    dirt, halation, ca, vignette, grade {slope, offset, power, sat, splitShadow, splitHigh, splitAmt},
    faces: [[cx, cy, rx, ry], ...] frame-px ellipses (max 2) where the grade may not shift hue, faceProtect 0..1,
    lift [r,g,b] linear display lift added before encode (rarely needed).
*/
import { frag } from './glsl.js';
import { mulberry32 } from './timeline.js';

export const DEFAULTS = {
  exposure: 0,
  bloom: { threshold: 0, knee: 0.5, mix: 0.05, add: 0 },
  streak: { threshold: 2.0, strength: 0.06, tint: [1.0, 0.85, 0.62] },
  ghosts: 0,                 // scenes opt in only where verified clean
  dirt: 0.5,
  halation: 0.06,
  ca: 0.0015,                // px shift in the corners = ca * min(W,H) (about 1.6 px); scenes may go to 0.003 (0.004 at the flash)
  vignette: 0.6,
  grade: {
    slope: [1.03, 1.00, 0.95], offset: [0.004, 0, 0.012], power: [1, 1, 1.03], sat: 0.95,
    splitShadow: [0.94, 0.99, 1.08], splitHigh: [1.06, 1.0, 0.90], splitAmt: 1,
  },
  faces: [],
  faceProtect: 0,
  lift: [0, 0, 0],
};
export const LOOKS = {
  winter_gold: {},
  night_sea: { grade: { slope: [0.95, 1.0, 1.08], sat: 0.85 } },
  photo: { grade: { splitAmt: 0.5 }, faceProtect: 1, ca: 0.0012 },
};
const LEVEL_W = [0.6, 0.8, 0.9, 1.0, 1.2, 1.4];
// streak pyramid level weights (W/4 .. W/256): heavier on the wide levels so the streak is long but soft-ended
const STREAK_W = [0.0, 0.02, 0.05, 0.10, 0.18, 0.30, 0.35];

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function merge(dst, src) {
  if (!src) return dst;
  for (const k in src) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object' && !Array.isArray(dst[k])) merge(dst[k], v);
    else dst[k] = Array.isArray(v) ? v.slice() : v;
  }
  return dst;
}
function lerpAny(a, b, w) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * w;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length === b.length && a.every(x => typeof x === 'number')) return a.map((x, i) => x + (b[i] - x) * w);
    return w < 0.5 ? clone(a) : clone(b);
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') { const o = {}; for (const k in a) o[k] = k in b ? lerpAny(a[k], b[k], w) : a[k]; return o; }
  return w < 0.5 ? a : b;
}

const SRC_DOWN = frag(`
uniform sampler2D uSrc; uniform vec2 uSrcTexel; uniform int uFirst; uniform float uThr, uKnee, uExpo;
out vec4 o;
vec3 pre(vec3 c){
  c *= uExpo;
  if (uThr > 0.0){
    float br = max(c.r, max(c.g, c.b));
    float rq = clamp(br - uThr + uKnee, 0.0, 2.0 * uKnee); rq = rq * rq / (4.0 * uKnee + 1e-5);
    c *= max(rq, br - uThr) / max(br, 1e-5);
  }
  return c;
}
void main(){
  vec2 uv = screenUV(); vec2 h = uSrcTexel;   // half a destination texel = one source texel
  vec3 b = texture(uSrc, uv + vec2(-h.x, -h.y)).rgb, c = texture(uSrc, uv + vec2(h.x, -h.y)).rgb;
  vec3 d = texture(uSrc, uv + vec2(-h.x, h.y)).rgb, e = texture(uSrc, uv + vec2(h.x, h.y)).rgb;
  if (uFirst == 1){
    // 4 bilinear taps (a 4x4 source footprint), Karis-weighted against fireflies
    b = pre(b); c = pre(c); d = pre(d); e = pre(e);
    float wb = 1.0 / (1.0 + luma(b)), wc = 1.0 / (1.0 + luma(c)), wd = 1.0 / (1.0 + luma(d)), we = 1.0 / (1.0 + luma(e));
    o = vec4((b * wb + c * wc + d * wd + e * we) / (wb + wc + wd + we), 1.0);
  } else {
    vec3 a = texture(uSrc, uv).rgb;
    o = vec4((a * 4.0 + b + c + d + e) / 8.0, 1.0);
  }
}`);

const SRC_UP = frag(`
uniform sampler2D uLow, uCur; uniform vec2 uLowTexel; uniform float uLowW, uCurW; uniform int uFast;
out vec4 o;
void main(){
  vec2 uv = screenUV(); vec2 h = uLowTexel * 0.5;
  if (uFast == 1){   // 4 diagonal bilinear taps: a tent of the (already smooth) lower level
    vec3 s4 = texture(uLow, uv + vec2(-h.x, h.y)).rgb + texture(uLow, uv + vec2(h.x, h.y)).rgb
            + texture(uLow, uv + vec2(h.x, -h.y)).rgb + texture(uLow, uv + vec2(-h.x, -h.y)).rgb;
    o = vec4(s4 * 0.25 * uLowW + texture(uCur, uv).rgb * uCurW, 1.0); return;
  }
  vec3 s = texture(uLow, uv + vec2(-h.x * 2.0, 0.0)).rgb + texture(uLow, uv + vec2(h.x * 2.0, 0.0)).rgb
         + texture(uLow, uv + vec2(0.0, h.y * 2.0)).rgb + texture(uLow, uv + vec2(0.0, -h.y * 2.0)).rgb
         + 2.0 * (texture(uLow, uv + vec2(-h.x, h.y)).rgb + texture(uLow, uv + vec2(h.x, h.y)).rgb
                + texture(uLow, uv + vec2(h.x, -h.y)).rgb + texture(uLow, uv + vec2(-h.x, -h.y)).rgb);
  o = vec4(s / 12.0 * uLowW + texture(uCur, uv).rgb * uCurW, 1.0);
}`);

const SRC_STREAK_PRE = frag(`
uniform sampler2D uSrc; uniform vec2 uSrcTexel; uniform float uThr;
out vec4 o;
vec3 tap(vec2 uv){ vec3 c = texture(uSrc, uv).rgb; float br = max(c.r, max(c.g, c.b)); return c * max(br - uThr, 0.0) / max(br, 1e-5); }
void main(){
  // 2x2 source texels per tap (bilinear), three rows: a 1-2-1 vertical soften so the streak has no blocky edge
  vec2 uv = screenUV(); vec2 h = uSrcTexel; float dy = 1.0 / uRes.y;
  vec3 c = (tap(uv - vec2(0.0, dy)) + 2.0 * tap(uv) + tap(uv + vec2(0.0, dy))) * 0.25;
  o = vec4(c, 1.0);
}`);

// horizontal 2x downsample, 1-3-3-1 over four source texels (taps on texel centres)
const SRC_STREAK_DOWN = frag(`
uniform sampler2D uSrc; uniform float uSrcW;
out vec4 o;
void main(){
  vec2 uv = screenUV(); float dx = 1.0 / uSrcW;
  vec3 c = (texture(uSrc, uv + vec2(-1.5 * dx, 0.0)).rgb + texture(uSrc, uv + vec2(1.5 * dx, 0.0)).rgb) * 0.125
         + (texture(uSrc, uv + vec2(-0.5 * dx, 0.0)).rgb + texture(uSrc, uv + vec2(0.5 * dx, 0.0)).rgb) * 0.375;
  o = vec4(c, 1.0);
}`);

// horizontal tent upsample of the coarser sum, plus this level times its weight
const SRC_STREAK_UP = frag(`
uniform sampler2D uLow, uCur; uniform float uLowW, uLowK, uCurK;
out vec4 o;
void main(){
  vec2 uv = screenUV(); float dx = 0.5 / uLowW;
  vec3 up = texture(uLow, uv).rgb * 0.5 + (texture(uLow, uv - vec2(dx, 0.0)).rgb + texture(uLow, uv + vec2(dx, 0.0)).rgb) * 0.25;
  o = vec4(up * uLowK + texture(uCur, uv).rgb * uCurK, 1.0);
}`);

const SRC_GHOST = frag(`
uniform sampler2D uSrc;
out vec4 o;
vec3 thr(vec2 uv){ vec3 c = texture(uSrc, uv).rgb; return min(max(c - 1.0, 0.0), vec3(8.0)); }
vec3 sampleCA(vec2 uv, vec2 dir, float k){
  return vec3(thr(uv + dir * k).r, thr(uv).g, thr(uv - dir * k).b);
}
void main(){
  vec2 uv = screenUV();
  vec2 tc = 1.0 - uv;
  vec2 gv = (0.5 - tc) * 0.42;
  vec3 acc = vec3(0.0);
  for (int i = 0; i < 4; i++){
    vec2 s = tc + gv * float(i);
    if (any(lessThan(s, vec2(0.0))) || any(greaterThan(s, vec2(1.0)))) continue;
    float w = pow(max(1.0 - length(vec2(0.5) - s) / 0.7071, 0.0), 6.0);
    vec3 tint = i == 1 ? vec3(0.9, 0.95, 1.05) : (i == 2 ? vec3(1.05, 0.95, 0.85) : vec3(1.0));
    acc += sampleCA(s, normalize(gv + 1e-6), 0.0015) * w * tint;
  }
  vec2 hv = normalize(gv + 1e-6) * 0.46;
  vec2 hs = tc + hv;
  if (all(greaterThan(hs, vec2(0.0))) && all(lessThan(hs, vec2(1.0)))){
    float hw = pow(max(1.0 - length(vec2(0.5) - hs) / 0.7071, 0.0), 10.0);
    acc += sampleCA(hs, normalize(gv + 1e-6), 0.004) * hw * 0.6;
  }
  o = vec4(acc, 1.0);
}`);

const SRC_GLOW = frag(`
uniform sampler2D uU2, uD1, uStreak, uGhost, uDirt, uMip4, uMip5, uMip6;
uniform vec2 uLowTexel; uniform float uW1, uBloomAdd, uStreakK, uGhostK, uDirtK, uHalK;
uniform vec3 uStreakTint;
out vec4 o;
void main(){
  vec2 uv = screenUV(); vec2 h = uLowTexel * 0.5;
  // last bloom upsample (4 diagonal taps of level 2) + level 1
  vec3 up = (texture(uU2, uv + vec2(-h.x, h.y)).rgb + texture(uU2, uv + vec2(h.x, h.y)).rgb
           + texture(uU2, uv + vec2(h.x, -h.y)).rgb + texture(uU2, uv + vec2(-h.x, -h.y)).rgb) * 0.25;
  vec3 m1 = texture(uD1, uv).rgb;
  vec3 c = (up + m1 * uW1) * uBloomAdd;
  c += texture(uStreak, uv).rgb * uStreakTint * uStreakK;
  if (uGhostK > 0.0){
    // ghosts only on frames with some light in them: on a near-black frame they read as dust on the lens
    float mean = luma(texture(uMip6, vec2(0.5)).rgb + texture(uMip6, vec2(0.2, 0.25)).rgb + texture(uMip6, vec2(0.8, 0.25)).rgb
                    + texture(uMip6, vec2(0.2, 0.75)).rgb + texture(uMip6, vec2(0.8, 0.75)).rgb) * 0.2;
    c += texture(uGhost, uv).rgb * uGhostK * smoothstep(0.02, 0.06, mean);
  }
  vec3 m45 = (texture(uMip4, uv).rgb + texture(uMip5, uv).rgb) * 0.5;
  c += texture(uDirt, vec2(uv.x, 1.0 - uv.y)).rgb * m45 * uDirtK * smoothstep(0.15, 1.2, luma(m45));   // dirt shows only under bright light
  c += m1 * vec3(1.0, 0.28, 0.08) * uHalK * smoothstep(0.6, 2.0, luma(m1));
  o = vec4(c, 1.0);
}`);

const SRC_COMPOSITE = frag(`
uniform sampler2D uScene, uGlow, uNoCA; uniform int uHasNoCA;
uniform highp sampler3D uLut, uLutBase; uniform float uLutA, uLutB;
uniform float uExpo, uBloomBase, uCA, uVig, uFaceProtect;
uniform uint uFrameIdx;
uniform vec4 uFace[2]; uniform int uFaceN;
out vec4 o;
void main(){
  vec2 uv = screenUV();
  vec2 d = uv - 0.5;
  vec3 c;
  // chromatic aberration, isotropic in frame px: shift = uCA * min(W,H) * r^3 (r = 1 in the corners)
  vec2 dp = d * uFrame;
  float r = length(dp) / length(0.5 * uFrame);
  float sh = uCA * min(uFrame.x, uFrame.y) * r * r * r;
  vec3 c0 = texture(uScene, uv).rgb;
  c = c0;
  if (sh > 0.05){
    vec2 du = dp / max(length(dp), 1e-3) * sh / uFrame;     // the full shift in uv
    vec2 uR = uv + du, uB = uv - du;
    float cr = (texture(uScene, uv + du * 0.5).r + texture(uScene, uR).r) * 0.5;
    float cb = (texture(uScene, uv - du * 0.5).b + texture(uScene, uB).b) * 0.5;
    float keep = 0.0;
    if (uHasNoCA == 1) keep = clamp(max(texture(uNoCA, uv).a, max(texture(uNoCA, uR).a, texture(uNoCA, uB).a)), 0.0, 1.0);
    c.r = mix(cr, c0.r, keep);
    c.b = mix(cb, c0.b, keep);
  }
  c = c * uExpo * uBloomBase + texture(uGlow, uv).rgb;
  // vignette (aspect-aware: distance normalised so the corners are 1)
  vec2 q = d * vec2(uFrame.x / uFrame.y, 1.0);
  float rv = length(q) / length(vec2(0.5 * uFrame.x / uFrame.y, 0.5));
  float vg = smoothstep(0.25, 1.05, rv);
  c *= 1.0 - uVig * vg * vg;
  // AgX + look via the per-frame 3D LUT (log2 shaper over AgX's range), face-ellipse hue protection
  vec3 enc = clamp((log2(max(c, vec3(1e-10))) + 12.47393) / 16.4999, 0.0, 1.0) * uLutA + uLutB;
  vec3 g = texture(uLut, enc).rgb;
  if (uFaceN > 0 && uFaceProtect > 0.0){
    vec2 px = framePx(); float m = 0.0;
    for (int i = 0; i < 2; i++){ if (i >= uFaceN) break;
      vec2 e = (px - uFace[i].xy) / uFace[i].zw; m = max(m, 1.0 - smoothstep(0.75, 1.0, length(e))); }
    if (m > 0.0){
      vec3 base = texture(uLutBase, enc).rgb;
      vec3 keepHue = base * (luma(g) / max(luma(base), 1e-5));
      g = mix(g, keepHue, m * uFaceProtect);
    }
  }
  // TPDF dither, +-1 LSB
  uvec2 h1 = pcg2d(uvec2(gl_FragCoord.xy) + uvec2(uFrameIdx * 1973u, uFrameIdx * 9277u));
  vec3 r1 = vec3(float(h1.x & 255u), float((h1.x >> 8u) & 255u), float((h1.x >> 16u) & 255u)) / 255.0;
  vec3 r2 = vec3(float(h1.y & 255u), float((h1.y >> 8u) & 255u), float((h1.y >> 16u) & 255u)) / 255.0;
  o = vec4(clamp(g + (r1 + r2 - 1.0) / 255.0, 0.0, 1.0), 1.0);
}`);

const SRC_LUT = frag(`
uniform float uZ, uN; uniform int uBase;
uniform vec3 uSlope, uOffset, uPower, uSplitS, uSplitH, uLift;
uniform float uSat, uSplitAmt;
out vec4 o;
void main(){
  vec3 enc = vec3(floor(gl_FragCoord.xy), uZ) / (uN - 1.0);
  vec3 c = exp2(enc * 16.4999 - 12.47393);
  c = mix(vec3(0.0), c, step(0.5 / (uN - 1.0), enc));        // the bottom cell is true black
  vec3 a = agx(c);
  vec3 g;
  if (uBase == 1) g = agxEotf(a);
  else {
    g = agxEotf(agxLook(a, uSlope, uOffset, uPower, uSat));
    float l = luma(g);
    g *= mix(mix(vec3(1.0), uSplitS, uSplitAmt), mix(vec3(1.0), uSplitH, uSplitAmt), smoothstep(0.02, 0.6, l));
  }
  o = vec4(lin2srgb(g + uLift), 1.0);
}`);

// ---------- JS mirror of the tonemap and grade (for palette inversion)
const M_AGX = [[0.842479062253094, 0.0784335999999992, 0.0792237451477643], [0.0423282422610123, 0.878468636469772, 0.0791661274605434], [0.0423756549057051, 0.0784336, 0.879142973793104]];
const M_INV = [[1.19687900512017, -0.0980208811401368, -0.0990297440797205], [-0.0528968517574562, 1.15190312990417, -0.0989611768448433], [-0.0529716355144438, -0.0980434501171241, 1.15107367264116]];
const mv = (M, v) => M.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const lum = c => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lin2s = c => c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
export function sceneToDisplay(rgb, p = DEFAULTS) {
  const lo = -12.47393, hi = 4.026069;
  let v = mv(M_AGX, rgb.map(x => Math.max(0, x)));
  v = v.map(x => { const l = Math.min(hi, Math.max(lo, Math.log2(Math.max(x, 1e-10)))); const y = (l - lo) / (hi - lo); const y2 = y * y, y4 = y2 * y2; return 15.5 * y4 * y2 - 40.14 * y4 * y + 31.96 * y4 - 6.868 * y2 * y + 0.4298 * y2 + 0.1191 * y - 0.00232; });
  const g = p.grade;
  const l0 = lum(v);
  let w = v.map((x, i) => Math.pow(Math.max(0, x * g.slope[i] + g.offset[i]), g.power[i]));
  w = w.map(x => l0 + g.sat * (x - l0));
  let c = mv(M_INV, w).map(x => Math.pow(Math.max(0, x), 2.2));
  const l = lum(c), k = sstep(0.02, 0.6, l);
  c = c.map((x, i) => x * ((1 + (g.splitShadow[i] - 1) * g.splitAmt) * (1 - k) + (1 + (g.splitHigh[i] - 1) * g.splitAmt) * k));
  return c.map(x => lin2s(x + 0));
}
export function displayToScene(target, p = DEFAULTS) {
  // damped Newton in log space (the tonemap is steep in the toe), numeric Jacobian
  const t = typeof target === 'string' ? [0, 2, 4].map(i => parseInt(target.replace('#', '').slice(i, i + 2), 16) / 255) : target;
  let y = t.map(() => Math.log(0.01));
  const F = yy => sceneToDisplay(yy.map(Math.exp), p).map((v, i) => v - t[i]);
  for (let it = 0; it < 80; it++) {
    const f = F(y);
    if (Math.max(...f.map(Math.abs)) < 2e-6) break;
    const J = [0, 1, 2].map(j => { const yp = y.slice(); yp[j] += 1e-4; const fp = F(yp); return fp.map((v, i) => (v - f[i]) / 1e-4); });
    const A = [0, 1, 2].map(i => [J[0][i], J[1][i], J[2][i]]);
    const det = A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) - A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) + A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
    let step;
    if (Math.abs(det) < 1e-14) step = f.map(v => Math.sign(v) * 0.5);
    else {
      const inv = [
        [(A[1][1] * A[2][2] - A[1][2] * A[2][1]) / det, (A[0][2] * A[2][1] - A[0][1] * A[2][2]) / det, (A[0][1] * A[1][2] - A[0][2] * A[1][1]) / det],
        [(A[1][2] * A[2][0] - A[1][0] * A[2][2]) / det, (A[0][0] * A[2][2] - A[0][2] * A[2][0]) / det, (A[0][2] * A[1][0] - A[0][0] * A[1][2]) / det],
        [(A[1][0] * A[2][1] - A[1][1] * A[2][0]) / det, (A[0][1] * A[2][0] - A[0][0] * A[2][1]) / det, (A[0][0] * A[1][1] - A[0][1] * A[1][0]) / det]];
      step = mv(inv, f);
    }
    y = y.map((v, i) => Math.min(6, Math.max(-25, v - Math.max(-2, Math.min(2, step[i])))));
  }
  return y.map(Math.exp);
}

function makeDirt(w, h) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const x = cv.getContext('2d');
  const rnd = mulberry32(0xD1A7);
  x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 300; i++) {           // discs (dust): mostly small, a few large and faint
    const r = (2 + 26 * Math.pow(rnd(), 2.2)) * w / 960, cx = rnd() * w, cy = rnd() * h;
    const a = (0.05 + 0.25 * rnd()) * (r > 14 ? 0.5 : 1);
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgba(255,250,240,${a})`); g.addColorStop(0.7, `rgba(255,250,240,${a * 0.8})`); g.addColorStop(1, 'rgba(255,250,240,0)');
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  }
  for (let i = 0; i < 25; i++) {            // faint hexagons (aperture-shaped dust)
    const r = (10 + 30 * rnd()) * w / 960, cx = rnd() * w, cy = rnd() * h, rot = rnd() * Math.PI;
    x.fillStyle = `rgba(255,245,230,${0.04 + 0.06 * rnd()})`;
    x.beginPath();
    for (let k = 0; k < 6; k++) { const an = rot + k * Math.PI / 3; x.lineTo(cx + r * Math.cos(an), cy + r * Math.sin(an)); }
    x.closePath(); x.fill();
  }
  x.filter = `blur(${Math.round(18 * w / 960)}px)`;
  for (let i = 0; i < 6; i++) {             // smudges: big soft elongated ellipses
    const cx = rnd() * w, cy = rnd() * h, rx = (80 + 160 * rnd()) * w / 960, ry = rx * (0.2 + 0.3 * rnd()), rot = rnd() * Math.PI;
    x.fillStyle = `rgba(255,248,235,${0.06 + 0.08 * rnd()})`;
    x.beginPath(); x.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2); x.fill();
  }
  x.filter = 'none';
  return cv;
}

export function createPost(G) {
  const { gl, W, H } = G;
  const P = {
    down: G.program('post.down', SRC_DOWN), up: G.program('post.up', SRC_UP),
    spre: G.program('post.streakpre', SRC_STREAK_PRE), sdown: G.program('post.streakdown', SRC_STREAK_DOWN), sup: G.program('post.streakup', SRC_STREAK_UP),
    ghost: G.program('post.ghost', SRC_GHOST), glow: G.program('post.glow', SRC_GLOW), comp: G.program('post.comp', SRC_COMPOSITE), lut: G.program('post.lut', SRC_LUT),
  };
  const dirt = G.texture(makeDirt(960, Math.round(960 * H / W)), { mips: false });
  const black = G.target('post.black', 1, 1); G.clear(black, [0, 0, 0, 1]);
  const d = []; for (let i = 1; i <= 6; i++) d[i] = G.target('post.d' + i, W / (1 << i), H / (1 << i));
  const u = []; for (let i = 2; i <= 5; i++) u[i] = G.target('post.u' + i, W / (1 << i), H / (1 << i));
  const glow = G.target('post.glow', W / 2, H / 2);
  // the anamorphic streak: quarter height throughout, a horizontal pyramid from quarter width down to W/256
  const SQ = STREAK_W.length;
  const sq = [], su = [];
  for (let i = 0; i < SQ; i++) {
    sq[i] = G.target('post.sq' + i, Math.max(2, Math.round(W / (4 << i))), H / 4);
    if (i < SQ - 1) su[i] = G.target('post.su' + i, Math.max(2, Math.round(W / (4 << i))), H / 4);
  }
  const gh = G.target('post.ghost', W / 8, H / 8);
  const wsum = LEVEL_W.reduce((a, b) => a + b, 0);

  // ---------- 3D LUTs (graded and base AgX), rebuilt only when the grade changes
  const N = 48;
  function make3D() {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texStorage3D(gl.TEXTURE_3D, 1, G.hasFloat ? gl.RGBA16F : gl.RGBA8, N, N, N);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const fbos = [];
    for (let z = 0; z < N; z++) {
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, z);
      fbos.push({ fbo: f, w: N, h: N, scale: 1 });
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { tex, fbos, key: '' };
  }
  const lut = make3D(), lutBase = make3D();
  function buildLut(L, p, base) {
    const g = p.grade;
    const key = base ? 'base' : JSON.stringify([g, p.lift]);
    if (L.key === key) return;
    for (let z = 0; z < N; z++) {
      G.draw(P.lut, { uZ: z, uN: N, uBase: base ? 1 : 0, uSlope: g.slope, uOffset: g.offset, uPower: g.power, uSat: g.sat,
        uSplitS: g.splitShadow, uSplitH: g.splitHigh, uSplitAmt: g.splitAmt, uLift: p.lift || [0, 0, 0] }, L.fbos[z]);
    }
    L.key = key;
  }

  const api = { mips: { d1: d[1], d2: d[2], d3: d[3], d4: d[4], d5: d[5], d6: d[6] }, DEFAULTS, LOOKS };

  api.params = function (look, ...overrides) {
    let p;
    if (Array.isArray(look)) {
      const parts = look.map(l => merge(merge(clone(DEFAULTS), LOOKS[l.look] || {}), l.over || {}));
      p = parts.reduce((acc, q, i) => i === 0 ? q : lerpAny(acc, q, look[i].w), null);
    } else p = merge(clone(DEFAULTS), LOOKS[look] || {});
    for (const o of overrides) merge(p, o);
    return p;
  };
  api.lerp = (a, b, w) => lerpAny(a, b, w);

  // Runs the whole chain from the HDR frame to the canvas (dithered). Captions are drawn on the canvas afterwards.
  api.run = function (hdr, p, frameIndex = 0, opts = {}) {
    const expo = Math.pow(2, p.exposure || 0);
    // 2 bloom pyramid
    let src = hdr;
    for (let i = 1; i <= 6; i++) {
      G.draw(P.down, { uSrc: src, uSrcTexel: [1 / src.w, 1 / src.h], uFirst: i === 1 ? 1 : 0, uThr: p.bloom.threshold, uKnee: Math.max(1e-3, p.bloom.knee), uExpo: expo }, d[i]);
      src = d[i];
    }
    for (let i = 5; i >= 2; i--) {
      const low = i === 5 ? d[6] : u[i + 1];
      G.draw(P.up, { uLow: low, uCur: d[i], uLowTexel: [1 / low.w, 1 / low.h], uLowW: i === 5 ? LEVEL_W[5] : 1, uCurW: LEVEL_W[i - 1], uFast: 0 }, u[i]);
    }
    // 3 streak (from mip 1)
    const sk = p.streak.strength || 0;
    let streak = black;
    if (sk > 0) {
      G.draw(P.spre, { uSrc: d[1], uSrcTexel: [1 / d[1].w, 1 / d[1].h], uThr: p.streak.threshold }, sq[0]);
      for (let i = 1; i < SQ; i++) G.draw(P.sdown, { uSrc: sq[i - 1], uSrcW: sq[i - 1].w }, sq[i]);
      // sum = sum_i STREAK_W[i] * level i (the coarsest level is the start of the sum, weighted in the first up pass)
      for (let i = SQ - 2; i >= 0; i--) {
        const low = i === SQ - 2 ? sq[SQ - 1] : su[i + 1];
        G.draw(P.sup, { uLow: low, uCur: sq[i], uLowW: low.w, uLowK: i === SQ - 2 ? STREAK_W[SQ - 1] : 1, uCurK: STREAK_W[i] }, su[i]);
      }
      streak = su[0];
    }
    // 4 ghosts
    const gk = p.ghosts || 0;
    if (gk > 0) G.draw(P.ghost, { uSrc: d[2] }, gh);
    // LUTs
    buildLut(lut, p, false);
    const faces = (p.faces || []).slice(0, 2);
    const useFaces = faces.length > 0 && (p.faceProtect || 0) > 0;
    if (useFaces) buildLut(lutBase, p, true);
    // 5-11 composite, grade, dither -> canvas
    const bloomBase = 1 - (p.bloom.threshold > 0 ? 0 : p.bloom.mix);
    // half-res glow: the last bloom upsample (level 1), streak, ghosts, lens dirt, halation
    G.draw(P.glow, { uU2: u[2], uD1: d[1], uStreak: streak, uGhost: gk > 0 ? gh : black, uDirt: dirt, uMip4: d[4], uMip5: d[5], uMip6: d[6],
      uLowTexel: [1 / u[2].w, 1 / u[2].h], uW1: LEVEL_W[0], uBloomAdd: (p.bloom.mix + (p.bloom.add || 0)) / wsum,
      uStreakK: sk, uStreakTint: p.streak.tint, uGhostK: gk, uDirtK: p.dirt, uHalK: p.halation }, glow);
    const faceArr = new Float32Array(8); faces.forEach((f, i) => faceArr.set(f, i * 4));
    G.draw(P.comp, {
      uScene: hdr, uGlow: glow, uNoCA: opts.noCA || black, uHasNoCA: opts.noCA ? 1 : 0,
      uExpo: expo, uBloomBase: bloomBase, uCA: p.ca, uVig: p.vignette, uFaceProtect: useFaces ? p.faceProtect : 0,
      uFace: faceArr, uFaceN: useFaces ? faces.length : 0, uFrameIdx: frameIndex >>> 0,
      uLutA: (N - 1) / N, uLutB: 0.5 / N, uLut: lut.tex, uLutBase: lutBase.tex,
    }, null);
    return null;
  };
  return api;
}
