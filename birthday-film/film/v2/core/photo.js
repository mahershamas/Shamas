/*
  core/photo.js: the photograph (SPEC 6.4 and the photo treatments of scenes 6, 7, 8 and 13).
  Landmarks come only from window.PHOTO_META (private); none are written here. Every proportion below is generic
  (fractions of the face separation, of the image diagonal, or of the frame).

  Coordinates: "source px" are in the PHOTO_META.size image (the 2x texture is sampled with uv = px / size).
  Everything is a pure function of its arguments (no clocks, no Math.random); the only seeded choice (bokeh highlight
  positions) is made once at init from a seeded mulberry32 and a GPU readback of the photo.

  Colour pipeline. The photo is a display-referred sRGB picture. PH.draw grades it in display-linear space (photo look:
  warmth, saturation -6 %, blacks lifted to night vellum, seat green kept rich, optional white balance and amber haze,
  all skin-protected: inside the face ellipses the grade keeps the source hue and only takes the graded luma), then maps
  it through an exact inverse of post.js's tonemap + grade for the scene's look (a 33^3 inverse LUT solved on the GPU
  at init), so after AgX and the look the photo displays as the graded source, not as a tonemapped (flattened,
  hue-skewed) one. Consequence: the post chain cannot shift hue anywhere on the photo, so photo scenes do not need
  post faceProtect; PH.postParams(cam) returns {faces, faceProtect: 0} for scenes that want to be explicit.
  Light passes (rim light, bokeh, thread, glints) are added in scene-linear HDR after the inverse.
  Performance: the static part of the look (retouch, grade, skin protection) is baked once into a mipmapped sRGB8
  cache at the 2x texture size (rebuilt only if the static grade options change); per frame only white balance and
  haze are applied, then the inverse LUT. On the software rasteriser every full-resolution texture fetch costs tens
  of ms, so: the people mask is fetched only for parallax/DoF, DoF of 2.5 px and more renders at half resolution,
  mild minification samples one mip level, and engraving/frost/colour passes switch off once fully cleared.
  Retouch: the source carries a fine processing texture that full-bleed magnification exposes; the cache keeps strong
  detail (eyes, lips, glasses, hair, edges) and softens low-amplitude texture, more on skin.

  API
    await loadPhoto(G) -> Photo {tex (SRGB8_ALPHA8, mipmapped, linear on sampling, no anisotropy), w, h (source px size), meta}
    photoCamera(crop, {dest, frame, layout, tag}) -> Cam      THROWS FaceBoxError when the face box is not fully visible
        crop   [x0, y0, x1, y1] source px of the image region mapped onto dest (it may extend past the image)
        dest   [x, y, w, h] frame px where that crop is drawn (default: the whole frame)
        frame  [W, H] (default the current output size);  layout 'landscape' | 'portrait' (for the log only)
        Cam = {crop, dest, sx, sy (frame px per source px), toFrame([sx,sy]) -> [x,y], toSource([x,y]) -> [sx,sy],
               visible: [x0,y0,x1,y1] source px actually on screen, margin (min px distance face box -> visible edge),
               uniforms: {uCrop: vec4, uDest: vec4}}  (for shaders: src = crop.xy + (px - dest.xy) / dest.zw * crop.zw)
        Every call is recorded in photoAssertLog (bounded) with its margin; failures throw.
    plateCamera(center, width, {frame, layout, tag}) -> Cam   the whole image as a plate of `width` frame px centred at
        `center` (scenes 6, 8, 13); asserts like photoCamera.
    lerpCrop(a, b, w) -> crop                                linear blend of two crops (camera moves)
    photoAssertLog -> {calls, minMargin, last, failures}
    faceEllipses(cam) -> [[cx, cy, rx, ry], [..]] frame px ellipses (post.params({faces}) / skin protection)

    const PH = createPhotoRenderer(G, photo)
    PH.draw(target, cam, o)       the photo pass (one shader, compiled per feature set). Options (all optional):
        retouch (0..1, default 1), cache (default true; false = per-pixel grade from the source, slower),
        lod0Max (default 1.7: texels per frame px below which one mip level is sampled),
        exposure (EV, scene space), opacity, lod (extra blur, mip levels), look ('photo' default | any post look |
        null = raw linear, the stage-A pass), alphaOut / blend (default: opaque when dest covers the whole target, else
        premultiplied 'premul' with anti-aliased plate edges; only the dest rect is rasterised)
        grade {warm = 1, sat = 0.94, green = 1 (seat green kept rich), lift = 1 (blacks to #120D09), wb = 0 (Kelvin,
               +250 = warmer), haze = 0 (amber black lift, 0.03 = 3 %), contrast = 0.05 (gentle S on luma)}
        dof {radius (frame px, 0..14+), people = 0.75 (CoC factor on the people), focus = 0 (0..1 keeps faces sharper),
             halfRes (default true: radius >= 2.5 renders at half resolution)}
        parallax [dx, dy] frame px: the background's shift relative to the people (people x1.0, background x0.55
               of the camera move; see PH.parallax). Clamped so the total stays <= 0.6 % of the frame width.
        light {I = 0.22, angle (rad, direction the light comes FROM, 0 = from the right, -PI/2 = from above),
               color = '#FFD9A0', wash = 0.7, rim = 1.0}: warm key/rim light on both heads and shoulders (feathered
               ellipses, 60 source px feather), relighting proportional to the photo's own albedo.
        engrave {reveal (seconds since the grains started; per-pixel reveal with the grain delay d(uv), faces first;
               default: fully revealed), spacing = 4.35 source px (3 px on the 1000 px plate), key [x,y] frame px
               (moving key light for the metallic lines), keyI = 1}: the gold engraving (#E3B341 hatch at 35 degrees,
               -35 degree cross-hatch below luma 0.35, Sobel edges) on night vellum #120D09.
        colour {r (bloom radius in photo diagonals, 0..1.2), edge = 0.08, rim = 12 (frame px), rimI = 1.6}: colour
               blooms from both faces at once into the engraving; a #FFE7A3 rim marks the meeting line.
               Without `colour` the engraving (if any) is fully replaced by colour; with engrave and no colour the
               plate is pure engraving.
        frost {r (cleared radius in plate diagonals, 0..1.15), amount = 1, t (seconds since clearing began, for the
               droplets), drops = 3, warp = 40 (frame px), rimPx = 30}: fogged glass over the plate (#C9D2DC at 55 %,
               4 px refraction where frosted), clearing from the faces' midpoint; three droplets run down from the rim.
        edgeFade {top, bottom, left, right (frame px)}: the plate's edges dissolve (premultiplied alpha, fbm-broken)
               into whatever the scene drew behind (scene 7 portrait: 80 px into warm mist).
        debug true: the debug mask still (people mask, face box, ellipses, seat spline, landmarks) over the photo.
    PH.grains(target, cam, {t, tipAt, arrive = 0.9, I = 1, delay = 2.0, look})
        The 98k-grain forming (362 x 272 grains on a 4x4 source-px grid). t = seconds since the forming began (scene 6:
        tau of 65.5). Grain i leaves the nearer pen tip at t_i = delay * min(|h - faceA|, |h - faceB|) / diag (+ <=0.1 s
        seeded jitter), flies 0.9 s on a curved path and lands on its home cell with the engraving's value; it then
        fades as the engraving texture appears there (PH.draw engrave.reveal uses the same delays, so they hand over
        seamlessly). tipAt(tRel) -> [[lx, ly], [rx, ry]] frame px of the two pen tips at t (sampled 17 times).
    PH.bokeh(target, cam, {I = 1, t = 0 (s, drift), drift = 6 (px/s up), size = 1, grow = 1 (0..1 disc growth)})
        about 60 warm discs (60-180 px) splatted from the photo's own highlights (seeded, never on the faces).
    PH.thread(target, cam, {tip (source x of the drawing tip, 0..w), from = 0, I = 1, steady = 0.7, glint (source x
        of a travelling glint or null), glintI = 4, knot (0..1 progress of the two-loop knot, or null), knotI = 1.6,
        occlude = true, width = 2 (frame px), look})
        The gold thread along the seat edge (Catmull-Rom spline through PHOTO_META.seatEdge, analytic SDF), hidden
        behind the people mask except at the knot; the knot (core/knot.js seatKnot, thread style) is drawn above the
        mask at PH.knotPoint(). The glint flares softly when it crosses the knot.
    PH.glint(target, cam, {at: [x, y] source px | 'pendant', life (0..1), size = 24, I = 6, rot})  four-point star
    PH.portraitGlint(target, cam, {index (0..3), life (0..1), I = 1})  light running across the glass of a wall
        portrait (PHOTO_META.wallPortraits) and a small star on its frame at the peak
    PH.parallax(cam, camRef, factor = 0.45) -> [dx, dy]  the background shift for a camera move from camRef to cam
        (0.45 = 1.0 - 0.55), clamped to 0.6 % of the frame width
    PH.postParams(cam) -> {faces, faceProtect: 0}
    PH.peopleMask() -> Tex     people silhouette (PHOTO_META.peopleUV) rasterised once, blurred 10 source px
    PH.seatPolyline() -> [[x,y],...] source px (from PHOTO_META.seatEdge);  PH.seatY(x) -> y on the spline
    PH.knotPoint() -> [x, y] source px of the seat knot (on the seat spline, between the faces)
    PH.faces() -> {a, b, mid, diag}   source px seeds of the two faces, their midpoint and the image diagonal
  Costs (software WebGL, landscape, 1-px readback sync, machine shared with other builders, load 3-4):
    window plate 1000 px with engraving + frost + grains in flight: photo ~250-350 ms, grains 50-90 ms
    window plate after the frost has cleared (colour blooming): ~200 ms; full colour: ~40 ms
    full bleed: plain ~130 ms, with parallax + light ~160-195 ms, DoF 14 px (half res) ~120-135 ms, bokeh < 5 ms
    thread + seat knot ~55-70 ms full bleed, ~8 ms on the small plate; init (inverse LUT, frost, bokeh) ~2 s, cache ~0.3 s
  Determinism: everything is a pure function of the options; the bokeh sources come from a seeded draw over a GPU
  readback of the photo made at init (identical across launches on the same machine).
*/
import { frag, HEADER_VS } from './glsl.js';
import { DEFAULTS, LOOKS, displayToScene } from './post.js';
import { createKnot, seatKnot } from './knot.js';
import { createGold } from './gold.js';
import { mulberry32 } from './timeline.js';

export class FaceBoxError extends Error {}

export async function loadPhoto(G) {
  const meta = window.PHOTO_META;
  if (!meta) throw new Error('PHOTO_META missing (private/v2/photo_meta.js not loaded)');
  const img = new Image();
  img.src = new URL(meta.src, document.baseURI).href;
  await img.decode();
  const tex = G.texture(img, { srgb: true, mips: true });
  return { tex, w: meta.size[0], h: meta.size[1], meta, img };
}

export const photoAssertLog = { calls: 0, minMargin: Infinity, last: null, failures: 0 };

export function photoCamera(crop, o = {}) {
  const meta = window.PHOTO_META;
  const W = (o.frame && o.frame[0]) || (window.FILM && window.FILM.width) || 1920;
  const H = (o.frame && o.frame[1]) || (window.FILM && window.FILM.height) || 1080;
  const dest = o.dest || [0, 0, W, H];
  const [cx0, cy0, cx1, cy1] = crop;
  const sx = dest[2] / (cx1 - cx0), sy = dest[3] / (cy1 - cy0);
  const toFrame = ([x, y]) => [dest[0] + (x - cx0) * sx, dest[1] + (y - cy0) * sy];
  const toSource = ([x, y]) => [cx0 + (x - dest[0]) / sx, cy0 + (y - dest[1]) / sy];
  // visible source region = crop ∩ image ∩ (frame mapped back)
  const f0 = toSource([0, 0]), f1 = toSource([W, H]);
  const visible = [
    Math.max(cx0, 0, f0[0]), Math.max(cy0, 0, f0[1]),
    Math.min(cx1, meta.size[0], f1[0]), Math.min(cy1, meta.size[1], f1[1]),
  ];
  const fb = meta.faceBoxUV;
  const box = [fb.x0 * meta.size[0], fb.y0 * meta.size[1], fb.x1 * meta.size[0], fb.y1 * meta.size[1]];
  const margin = Math.min((box[0] - visible[0]) * sx, (box[1] - visible[1]) * sy, (visible[2] - box[2]) * sx, (visible[3] - box[3]) * sy);
  photoAssertLog.calls++;
  photoAssertLog.minMargin = Math.min(photoAssertLog.minMargin, margin);
  photoAssertLog.last = { tag: o.tag || '', layout: o.layout || (H > W ? 'portrait' : 'landscape'), margin };
  if (!(margin >= -0.5)) {
    photoAssertLog.failures++;
    throw new FaceBoxError(`face box outside the visible crop by ${(-margin).toFixed(1)} frame px (${o.tag || 'photo'}, ${photoAssertLog.last.layout})`);
  }
  return {
    crop: crop.slice(), dest: dest.slice(), sx, sy, toFrame, toSource, visible, margin,
    uniforms: { uCrop: [cx0, cy0, cx1 - cx0, cy1 - cy0], uDest: dest.slice() },
  };
}

export function plateCamera(center, width, o = {}) {
  const meta = window.PHOTO_META;
  const w = width, h = width * meta.size[1] / meta.size[0];
  return photoCamera([0, 0, meta.size[0], meta.size[1]], Object.assign({}, o, { dest: [center[0] - w / 2, center[1] - h / 2, w, h] }));
}

export function lerpCrop(a, b, w) { return a.map((v, i) => v + (b[i] - v) * w); }

export function faceEllipses(cam) {
  const meta = window.PHOTO_META;
  const out = [];
  for (const k of ['left', 'right']) {
    const c = cam.toFrame(meta.faces[k]);
    // head-and-shoulder ellipse, about 0.13 x 0.2 of the image around each face centre
    out.push([c[0], c[1], meta.size[0] * 0.13 * cam.sx, meta.size[1] * 0.2 * cam.sy]);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ helpers
const c01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const srgb2lin1 = c => c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
const hexDisp = h => [0, 2, 4].map(i => srgb2lin1(parseInt(h.replace('#', '').slice(i, i + 2), 16) / 255));   // display-linear
function lookParams(look) {
  const p = JSON.parse(JSON.stringify(DEFAULTS));
  const L = LOOKS[look] || {};
  if (L.grade) Object.assign(p.grade, L.grade);
  if (L.lift) p.lift = L.lift.slice();
  return p;
}
const _colCache = new Map();
function sceneCol(hex, look = 'photo') {
  const k = hex + '|' + look;
  if (!_colCache.has(k)) _colCache.set(k, displayToScene(hex, lookParams(look)));
  return _colCache.get(k);
}

// Catmull-Rom (centripetal) through the seat polyline, resampled to y(x) and dy/dx on integer source x.
function seatSpline(pts, w) {
  const P = pts.map(p => p.slice());
  const ext = [[2 * P[0][0] - P[1][0], 2 * P[0][1] - P[1][1]], ...P, [2 * P[P.length - 1][0] - P[P.length - 2][0], 2 * P[P.length - 1][1] - P[P.length - 2][1]]];
  const dense = [];
  for (let i = 1; i < ext.length - 2; i++) {
    const p0 = ext[i - 1], p1 = ext[i], p2 = ext[i + 1], p3 = ext[i + 2];
    const tj = (a, b) => Math.pow(Math.hypot(b[0] - a[0], b[1] - a[1]), 0.5);
    const t0 = 0, t1 = t0 + tj(p0, p1), t2 = t1 + tj(p1, p2), t3 = t2 + tj(p2, p3);
    for (let k = 0; k < 64; k++) {
      const t = t1 + (t2 - t1) * k / 64;
      const L = (a, b, ta, tb) => [0, 1].map(j => (tb - t) / (tb - ta) * a[j] + (t - ta) / (tb - ta) * b[j]);
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      dense.push(L(B1, B2, t1, t2));
    }
  }
  dense.push(P[P.length - 1].slice());
  const n = Math.ceil(w) + 1, ys = new Float32Array(n * 2);
  let j = 0;
  for (let x = 0; x < n; x++) {
    while (j < dense.length - 2 && dense[j + 1][0] < x) j++;
    const a = dense[j], b = dense[j + 1];
    const f = c01((x - a[0]) / Math.max(1e-6, b[0] - a[0]));
    ys[x * 2] = a[1] + (b[1] - a[1]) * f;
  }
  for (let x = 0; x < n; x++) {
    const a = Math.max(0, x - 2), b = Math.min(n - 1, x + 2);
    ys[x * 2 + 1] = (ys[b * 2] - ys[a * 2]) / (b - a);
  }
  return { n, ys, y: x => { const xi = Math.max(0, Math.min(n - 1.001, x)), i = Math.floor(xi), f = xi - i; return ys[i * 2] * (1 - f) + ys[(i + 1) * 2] * f; } };
}

// ------------------------------------------------------------------------------------------------ shaders
const GLSL_COMMON = `
precision highp sampler3D;
uniform sampler2D uPhoto, uMask;
uniform vec4 uCrop, uDest; uniform vec2 uSize;
vec2 srcOf(vec2 px){ return uCrop.xy + (px - uDest.xy) / uDest.zw * uCrop.zw; }
float pmask(vec2 src){ return textureLod(uMask, src / uSize, 0.0).r; }
float ell(vec2 p, vec4 e, float feather){ vec2 q = (p - e.xy) / e.zw; float r = length(q); float f = feather / max(min(e.z, e.w), 1.0); return 1.0 - smoothstep(1.0 - f, 1.0 + f, r); }
`;

const FS_MAIN = (defs) => frag(defs + GLSL_COMMON + `
uniform sampler3D uInv; uniform int uUseInv;
uniform float uExpo, uOpacity, uLod, uCover, uRetouch; uniform int uAlphaOut;
uniform sampler2D uCache; uniform int uUseCache; uniform float uLod0Max;
uniform vec4 uSkinA, uSkinB;                 // skin-protection ellipses (source px)
uniform float uWarm, uSat, uGreen, uLiftK, uHaze, uContrast; uniform vec3 uLift, uWB, uHazeC;
uniform vec4 uEdge;                          // edge fade px: top, bottom, left, right
#if DOF
uniform float uDof, uDofPeople, uDofFocus;
#endif
#if PAR
uniform vec2 uPar;                           // background shift, source px
#endif
#if LIGHT
uniform vec4 uHeadA, uHeadB; uniform float uLightI, uLightWash, uLightRim; uniform vec2 uLightDir; uniform vec3 uLightC;
#endif
#if ENGRAVE
uniform float uRevT, uSpacing, uKeyI; uniform vec2 uKey; uniform vec2 uFaceA, uFaceB; uniform float uDiag;
uniform vec3 uVellum, uG0, uG1, uG2, uG3;
#endif
#if COLOUR
uniform float uBloomR, uBloomEdge, uRimPx, uRimI; uniform vec3 uRimC;
#endif
#if FROST
uniform sampler2D uFrost; uniform float uFrostR, uFrostAmt, uFrostT, uWarp, uRimF; uniform vec2 uMid; uniform vec3 uFrostC;
uniform vec4 uDrop[3]; uniform int uDrops;
#endif
#if DEBUG
uniform sampler2D uSeat; uniform vec4 uFaceBox; uniform vec4 uLm[8];
#endif
out vec4 o;

vec3 toScene(vec3 d){
  if (uUseInv == 0) return d;
  vec3 e = lin2srgb(clamp(d, 0.0, 1.0));
  vec3 v = texture(uInv, e * (32.0 / 33.0) + 0.5 / 33.0).rgb;
  return v * v * v;
}
float skinMask(vec2 src){ return max(ell(src, uSkinA, 40.0), ell(src, uSkinB, 40.0)); }

// the photo look, in display-linear space; s0 = the source colour (display-linear)
vec3 grade(vec3 s0, float skin){
  vec3 s = s0 * uWB;
  s *= mix(vec3(1.0), vec3(1.025, 1.0, 0.955), uWarm);
  float l = luma(s);
  // seat green kept rich: greens (g dominant over r and b) keep their saturation, everything else -6 %
  float gm = smoothstep(0.02, 0.10, s.g - max(s.r, s.b) * 0.92) * uGreen;
  s = l + mix(uSat, 1.04, gm) * (s - l);
  // gentle S on luma (perceptual), keeps mid-tones and lifts the highlights' snap
  if (uContrast > 0.0){
    float lp = pow(max(luma(s), 0.0), 1.0 / 2.2);
    float lq = lp + uContrast * (lp - 0.5) * (1.0 - abs(2.0 * lp - 1.0));
    s *= pow(max(lq, 1e-4), 2.2) / max(pow(max(lp, 1e-4), 2.2), 1e-6);
  }
  s = uLift * uLiftK + s * (1.0 - uLift * uLiftK);
  s += uHazeC * uHaze * (1.0 - clamp(s, 0.0, 1.0));
  // skin protection: inside the face ellipses keep the source hue and saturation, take the graded luma
  vec3 keep = s0 * (luma(s) / max(luma(s0), 1e-5));
  return mix(s, keep, skin);
}

vec3 photoAt(vec2 src, float lod){ return textureLod(uPhoto, src / uSize, lod).rgb; }
// the animated part of the grade, on the baked cache (display-linear, a = skin mask): white balance and amber haze
vec3 dynGrade(vec4 cc){
  vec3 s = mix(cc.rgb * uWB, cc.rgb, cc.a);
  return s + uHazeC * uHaze * (1.0 - clamp(s, 0.0, 1.0));
}
float engTone(float Lp){ return pow(smoothstep(0.08, 0.84, Lp), 1.3); }
float engWidth(float Lt){ return mix(0.035, 0.45, Lt); }

void main(){
  vec2 px = framePx();
  vec2 src = srcOf(px);
  float spx = uDest.z / uCrop.z;              // frame px per source px
  float baseLod = log2(max(2.0 / spx, 1.0));  // the texture is 2x
  // plate coverage (anti-aliased edges) and the optional dissolving edges
  vec2 dl = px - uDest.xy, dr = uDest.xy + uDest.zw - px;
  float cov = clamp(min(min(dl.x, dr.x), min(dl.y, dr.y)) + 0.5, 0.0, 1.0);
  vec2 iu = src / uSize;
  cov *= clamp(min(min(iu.x, 1.0 - iu.x) * uSize.x, min(iu.y, 1.0 - iu.y) * uSize.y) * spx + 0.5, 0.0, 1.0);
  if (uEdge.x + uEdge.y + uEdge.z + uEdge.w > 0.0){
    // distances (frame px) to the visible picture's edges: the dest rect or the image itself, whichever is nearer
    vec2 el = min(dl, iu * uSize * spx), er = min(dr, (1.0 - iu) * uSize * spx);
    float nz = (fbm(px / 90.0, 3) - 0.5) * 0.6;
    float e = 1.0;
    if (uEdge.x > 0.0) e *= smoothstep(0.0, 1.0, el.y / uEdge.x + nz * smoothstep(0.0, 0.3, el.y / uEdge.x));
    if (uEdge.y > 0.0) e *= smoothstep(0.0, 1.0, er.y / uEdge.y + nz * smoothstep(0.0, 0.3, er.y / uEdge.y));
    if (uEdge.z > 0.0) e *= smoothstep(0.0, 1.0, el.x / uEdge.z + nz * smoothstep(0.0, 0.3, el.x / uEdge.z));
    if (uEdge.w > 0.0) e *= smoothstep(0.0, 1.0, er.x / uEdge.w + nz * smoothstep(0.0, 0.3, er.x / uEdge.w));
    cov *= e;
  }
  float a = cov * uOpacity;
  if (a <= 0.0){ o = vec4(0.0); return; }

#if PAR || DOF || DEBUG
  float m = pmask(src);
#else
  float m = 0.0;
#endif
#if PAR
  // 2.5D parallax: the background moves less than the people; the shift fades out toward the silhouette (no doubling)
  src += uPar * pow(1.0 - m, 3.0);
#endif
#if CACHE && !FROST
  float skin = 0.0;
#else
  float skin = skinMask(src);
#endif

  // ---- sample (with depth of field)
  vec3 s0; vec3 disp;
#if CACHE
  {
    vec4 cc;
#if DOF
    float coc = uDof * mix(1.0, uDofPeople, m) * (1.0 - uDofFocus * skinMask(src));
    if (coc > 0.35){
      float r = coc / spx;
      float lodB = log2(max(2.0 / spx, 1.0)) + log2(max(coc * 0.5, 1.0));
      float ang = 6.2831853 * fract(52.9829189 * fract(dot(floor(gl_FragCoord.xy), vec2(0.06711056, 0.00583715))));
      vec4 acc = textureLod(uCache, src / uSize, lodB) * 1.5; float wsum = 1.5;
      for (int k = 0; k < 3; k++){
        float th = ang + float(k) * 2.0943951;
        vec4 c4 = textureLod(uCache, (src + vec2(cos(th), sin(th)) * r * 0.6) / uSize, lodB);
        float w = 1.0 + 1.5 * smoothstep(0.35, 0.9, luma(c4.rgb));
        acc += c4 * w; wsum += w;
      }
      cc = acc / wsum;
    } else
#endif
    {
      // the cache is 2 texels per source px: under mild minification (<= 1.7 texels per frame px) one bilinear level
      // is alias-free enough and costs half a trilinear fetch on the software rasteriser
      float texPerPx = 2.0 / spx;
      float lq = uLod > 0.0 ? log2(max(texPerPx, 1.0)) + uLod : (texPerPx <= uLod0Max ? 0.0 : log2(texPerPx));
      cc = textureLod(uCache, src / uSize, lq);
    }
    disp = dynGrade(cc);
    s0 = disp;
  }
#else
  {
    if (uLod > 0.0) s0 = photoAt(src, baseLod + uLod);
    else {
      s0 = texture(uPhoto, src / uSize).rgb;
      float rt = uRetouch * smoothstep(0.85, 1.6, spx);
      if (rt > 0.0){
        vec3 bl = photoAt(src, baseLod + 2.3);
        float e = abs(sqrt(luma(s0)) - sqrt(luma(bl)));
        float keep = mix(mix(0.45, 0.22, skin), 1.0, smoothstep(0.035, 0.10, e));
        s0 = mix(s0, bl + (s0 - bl) * keep, rt);
      }
    }
    disp = uUseInv == 1 ? grade(s0, skin) : s0;
  }
#endif

#if ENGRAVE
  // ---- gold engraving (display-linear), revealed per pixel with the grains' delay
  float lodE = baseLod + 0.5;
  float Ls = pow(luma(photoAt(src, lodE)), 1.0 / 2.2);
  float Lb = pow(luma(photoAt(src, lodE + 2.2)), 1.0 / 2.2);
  float st = 1.3 / spx;
  float lc = pow(luma(photoAt(src, lodE + 0.4)), 0.4545);
  float l10 = pow(luma(photoAt(src + vec2(st, 0.0), lodE + 0.4)), 0.4545), l01 = pow(luma(photoAt(src + vec2(0.0, st), lodE + 0.4)), 0.4545);
  vec2 gL = vec2(l10 - lc, l01 - lc) * 2.8;
  float Lt = engTone(Ls);
  Lt = clamp(Lt + 0.85 * (Ls - Lb), 0.0, 1.0);                 // local contrast: features read in the line work
  // Sobel edges, kept only on the brighter side of each edge (a single thin contour instead of a double band)
  float edge = smoothstep(0.16, 0.36, length(gL)) * smoothstep(0.004, 0.035, Ls - Lb);
  // primary hatch at 35 degrees; the lines bend slightly with the tone (banknote engraving)
  const vec2 N1 = vec2(-0.5735764, 0.8191520), N2 = vec2(0.5735764, 0.8191520);
  float z1 = dot(src, N1) / uSpacing + 0.45 * Lb;
  float f1 = abs(fract(z1) - 0.5);
  float aa1 = max(length(vec2(dFdx(z1), dFdy(z1))) * 0.7, 1e-4);
  float w1 = engWidth(Lt);
  float ink1 = 1.0 - smoothstep(w1 - aa1, w1 + aa1, f1);
  ink1 = mix(ink1, 2.0 * w1, smoothstep(0.45, 0.8, aa1));     // sub-pixel lines fade into their average tone
  // cross-hatch below luma 0.35: a fine mesh that keeps the shadows engraved rather than empty
  float z2 = dot(src, N2) / uSpacing - 0.30 * Lb;
  float f2 = abs(fract(z2) - 0.5);
  float aa2 = max(length(vec2(dFdx(z2), dFdy(z2))) * 0.7, 1e-4);
  float w2 = 0.085 * smoothstep(0.04, 0.14, Ls) * (1.0 - smoothstep(0.26, 0.36, Ls));
  float ink2 = (1.0 - smoothstep(w2 - aa2, w2 + aa2, f2)) * step(0.001, w2);
  ink2 = mix(ink2, 2.0 * w2, smoothstep(0.45, 0.8, aa2));
  float ink = max(ink1, ink2 * 0.6);
  ink = max(ink, edge * 0.75);
  // metallic: each line is a ridge; its cross-section normal catches the moving key light
  float across = clamp((fract(z1) - 0.5) / max(w1, 0.05), -1.0, 1.0);
  vec2 kd = normalize(uKey - px + vec2(1e-3));
  float ridge = clamp(dot(N1 * across, kd) * 0.5 + 0.5, 0.0, 1.0);
  float shade = clamp(0.12 + 0.72 * Lt + 0.35 * uKeyI * pow(ridge, 4.0) * ink1 + 0.15 * edge, 0.0, 1.0);
  vec3 gcol = shade < 0.33 ? mix(uG0, uG1, shade / 0.33) : shade < 0.66 ? mix(uG1, uG2, (shade - 0.33) / 0.33) : mix(uG2, uG3, (shade - 0.66) / 0.34);
  vec3 eng = mix(uVellum, gcol, clamp(ink, 0.0, 1.0));
  float dA = length(src - uFaceA), dB = length(src - uFaceB);
  float dly = 2.0 * min(dA, dB) / uDiag;
  float rev = smoothstep(-0.10, 0.14, uRevT - (dly + 0.9));
  eng = mix(uVellum, eng, rev);
  float cm = 0.0;
#if COLOUR
  {
    float nz = (fbm(src / 420.0 + 2.3, 2) - 0.5) * 2.0 * uBloomEdge * smoothstep(0.0, 0.45, uBloomR);
    float rr = min(dA, dB) / uDiag + nz;
    // early on the colour arrives as a soft flush over each whole face (never a spot), then a defined front
    float early = 1.0 - smoothstep(0.08, 0.4, uBloomR);
    float soft = max(max(uRimPx * 0.9 / (uDiag * spx), 0.45 * uBloomR * (1.0 - smoothstep(0.1, 0.5, uBloomR))), 0.10 * early);
    cm = 1.0 - smoothstep(uBloomR - soft * (1.0 - early), uBloomR + soft * early, rr);
    cm *= smoothstep(0.0, 0.10, uBloomR);
    disp = mix(eng, disp, cm);
    // a fine line of pale gold where colour meets engraving (about uRimPx wide), gentle while the bloom is small
    float rimW = uRimPx / (uDiag * spx);
    float x = (rr - uBloomR + 0.15 * soft) / rimW;
    float rim = exp(-x * x * 9.0) * 0.85 + exp(-x * x * 1.5) * 0.15;
    rim *= smoothstep(0.28, 0.48, uBloomR) * (1.0 - smoothstep(1.0, 1.3, uBloomR));
    disp = mix(disp, uRimC, clamp(rim * uRimI, 0.0, 1.0));
  }
#else
  disp = eng;
#endif
#endif

#if FROST
  // ---- frost on the glass (display-linear), clearing from the faces' midpoint
  {
    vec2 fuv = src / uSize;
    vec4 F = texture(uFrost, fuv);
    float plateDiag = length(uSize);
    float warp = (fbm(src / 120.0 + 3.7, 3) - 0.5) * 2.0 * uWarp / spx;
    float dd = length(src - uMid) + warp;
    float R = uFrostR * plateDiag;
    float rimS = uRimF / spx;
    float fr = max(smoothstep(R, R + rimS * 0.6, dd), 1.0 - smoothstep(0.0, 0.012, uFrostR)) * uFrostAmt;
    float rimBoost = exp(-pow((dd - R - rimS * 0.45) / (rimS * 0.5), 2.0)) * step(0.0001, uFrostR) * uFrostAmt;
    // droplets: clear trails running down from the rim
    for (int i = 0; i < 3; i++){
      if (i >= uDrops) break;
      vec4 D = uDrop[i];                       // x0, y0 (source px), head y (source px), width (source px)
      if (D.z <= D.y) continue;
      float xp = D.x + 3.0 / spx * sin(src.y * 0.045 + float(i) * 2.1) + 1.5 / spx * sin(src.y * 0.13 + float(i));
      float inY = smoothstep(D.y - 2.0, D.y + 6.0, src.y) * (1.0 - smoothstep(D.z - 1.0, D.z + 1.0, src.y));
      float w = D.w * (0.75 + 0.25 * smoothstep(D.y, D.z, src.y));
      float tr = (1.0 - smoothstep(w * 0.6, w, abs(src.x - xp))) * inY;
      fr *= 1.0 - tr;
      float hd = length((src - vec2(xp, D.z)) / vec2(w * 1.25, w * 1.5));
      fr *= smoothstep(0.7, 1.0, hd);
      rimBoost *= 1.0 - tr;
    }
    float dens = clamp(F.r + rimBoost * 0.45, 0.0, 1.4);
    if (fr > 0.0){
      vec2 g = (F.gb - 0.5) * 2.0;
      vec2 rs = src + g * (4.0 / spx) * fr;
      vec3 behind = grade(photoAt(rs, baseLod + 3.2), skin);
#if ENGRAVE
      float Lbb = pow(luma(photoAt(rs, baseLod + 3.0)), 1.0 / 2.2);
      float Ltb = engTone(Lbb);
      vec3 engB = mix(uVellum, mix(uG1, uG2, Ltb), clamp(2.0 * engWidth(Ltb), 0.0, 1.0));
      engB = mix(uVellum, engB, smoothstep(-0.10, 0.14, uRevT - (2.0 * min(length(rs - uFaceA), length(rs - uFaceB)) / uDiag + 0.9)));
#if COLOUR
      behind = mix(engB, behind, cm);
#else
      behind = engB;
#endif
#endif
      // the lines behind stay faintly legible through the rime; the room behind the glass is lamp-lit
      behind = mix(behind, disp, 0.35);
      float inner = exp(-pow(length((src - uMid) / uSize) / 0.6, 2.0));
      behind += vec3(0.060, 0.032, 0.012) * inner;
      float lb = luma(behind);
      vec3 lit = uFrostC * (0.24 + 1.1 * lb / (lb + 0.22));
      float k = clamp(0.62 * dens, 0.0, 0.8);
      vec3 frosted = behind * (1.0 - k) + lit * k;
      // needle crystals catch the light; a few of them glint
      float nd = F.a * (1.0 + rimBoost);
      frosted += uFrostC * nd * (0.07 + 0.55 * lb);
      float sp = smoothstep(0.965, 0.995, h12(floor(src * spx / 1.5) + 17.0)) * smoothstep(0.25, 0.6, nd);
      frosted += uFrostC * sp * (0.25 + 1.2 * lb);
      disp = mix(disp, frosted, fr);
    }
  }
#endif

  vec3 c = toScene(disp);

#if LIGHT
  {
    // one warm light shared by both: a soft directional wash across each head-and-shoulder ellipse, strongest
    // toward the ellipse edge that faces the light (a rim/kicker), proportional to the photo's own albedo
    vec2 qa = (src - uHeadA.xy) / uHeadA.zw, qb = (src - uHeadB.xy) / uHeadB.zw;
    float ma = ell(src, uHeadA, 60.0), mb = ell(src, uHeadB, 60.0);
    float hm = max(ma, mb);
    if (hm > 0.0){
      vec2 q = ma >= mb ? qa : qb;
      float side = dot(q, uLightDir);                                   // -1 .. 1 across the ellipse, + toward the light
      float wash = smoothstep(-0.9, 0.9, side);
      float rim = smoothstep(0.35, 0.95, length(q)) * smoothstep(0.1, 0.8, side);
      vec3 albedo = c;
      float hl = smoothstep(0.02, 0.35, luma(albedo));                  // lit surfaces take the light, deep shadows little
      c += albedo * uLightC * uLightI * hm * (uLightWash * wash + uLightRim * 1.6 * rim * hl);
    }
  }
#endif

#if DEBUG
  {
    c *= 0.55;
    vec3 add = vec3(0.0);
    add += vec3(0.0, 0.55, 0.65) * 0.5 * m;
    float me = smoothstep(0.45, 0.5, m) * (1.0 - smoothstep(0.5, 0.55, m));
    add += vec3(0.0, 1.0, 1.0) * me;
    vec4 sy = texture(uSeat, vec2(clamp(src.x / uSize.x, 0.0, 1.0), 0.5));
    float dSeat = abs(src.y - sy.r) / sqrt(1.0 + sy.g * sy.g) * spx;
    add += vec3(1.0, 0.75, 0.2) * (1.0 - smoothstep(1.0, 2.2, dSeat));
    vec2 fb0 = uFaceBox.xy, fb1 = uFaceBox.zw;
    float dBox = abs(sdBox(src - (fb0 + fb1) * 0.5, (fb1 - fb0) * 0.5)) * spx;
    add += vec3(1.0, 0.15, 0.15) * (1.0 - smoothstep(1.0, 2.5, dBox));
    float eA = abs(length((src - uSkinA.xy) / uSkinA.zw) - 1.0) * min(uSkinA.z, uSkinA.w) * spx;
    float eB = abs(length((src - uSkinB.xy) / uSkinB.zw) - 1.0) * min(uSkinB.z, uSkinB.w) * spx;
    add += vec3(1.0, 0.4, 0.9) * (1.0 - smoothstep(0.8, 2.0, min(eA, eB)));
    for (int i = 0; i < 8; i++){
      vec4 L = uLm[i]; if (L.w <= 0.0) continue;
      vec2 d = abs(src - L.xy) * spx;
      float cross_ = (1.0 - smoothstep(0.8, 1.8, min(d.x, d.y))) * step(max(d.x, d.y), 14.0);
      add += vec3(1.0, 1.0, 0.3) * cross_;
    }
    c = c * (1.0 - clamp(luma(add), 0.0, 0.8)) + add * 0.6;
  }
#endif

  c *= uExpo;
  o = (uAlphaOut == 1 || uCover < 0.5) ? vec4(c * a, a) : vec4(c * a, 1.0);
}`);

// the static photo look baked once: retouch, grade, skin protection (display-linear, a = skin mask), 1x source res
const FS_CACHE = frag(GLSL_COMMON + `
uniform vec4 uSkinA, uSkinB; uniform float uWarm, uSat, uGreen, uLiftK, uContrast, uRetouch; uniform vec3 uLift;
out vec4 o;
void main(){
  vec2 src = gl_FragCoord.xy / uRes * uSize;      // texel row 0 = image top, as the photo texture
  vec2 uv = src / uSize;
  float skin = max(ell(src, uSkinA, 40.0), ell(src, uSkinB, 40.0));
  vec3 s0 = textureLod(uPhoto, uv, 0.0).rgb;
  vec3 bl = textureLod(uPhoto, uv, 2.3).rgb;
  float e = abs(sqrt(luma(s0)) - sqrt(luma(bl)));
  float keep = mix(mix(0.45, 0.22, skin), 1.0, smoothstep(0.035, 0.10, e));
  s0 = mix(s0, bl + (s0 - bl) * keep, uRetouch);
  vec3 s = s0 * mix(vec3(1.0), vec3(1.025, 1.0, 0.955), uWarm);
  float l = luma(s);
  float gm = smoothstep(0.02, 0.10, s.g - max(s.r, s.b) * 0.92) * uGreen;
  s = l + mix(uSat, 1.04, gm) * (s - l);
  if (uContrast > 0.0){
    float lp = pow(max(luma(s), 0.0), 1.0 / 2.2);
    float lq = lp + uContrast * (lp - 0.5) * (1.0 - abs(2.0 * lp - 1.0));
    s *= pow(max(lq, 1e-4), 2.2) / max(pow(max(lp, 1e-4), 2.2), 1e-6);
  }
  s = uLift * uLiftK + s * (1.0 - uLift * uLiftK);
  vec3 keepH = s0 * (luma(s) / max(luma(s0), 1e-5));
  o = vec4(mix(s, keepH, skin), skin);
}`);

// inverse LUT: display sRGB grid -> scene-linear value that post's tonemap + look turn into it (cube-root encoded)
const FS_INV = frag(`
uniform float uZ, uN;
uniform vec3 uSlope, uOffset, uPower, uSplitS, uSplitH, uLift; uniform float uSat, uSplitAmt;
out vec4 o;
vec3 fwd(vec3 c){
  vec3 g = agxEotf(agxLook(agx(c), uSlope, uOffset, uPower, uSat));
  float l = luma(g);
  g *= mix(mix(vec3(1.0), uSplitS, uSplitAmt), mix(vec3(1.0), uSplitH, uSplitAmt), smoothstep(0.02, 0.6, l));
  return g + uLift;
}
void main(){
  vec3 enc = vec3(floor(gl_FragCoord.xy), uZ) / (uN - 1.0);
  vec3 tgt0 = srgb2lin(enc);
  vec3 best = vec3(0.0);
  if (max(tgt0.r, max(tgt0.g, tgt0.b)) < 1e-6){ o = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float sat = 1.0;
  for (int pass = 0; pass < 5; pass++){
    vec3 tgt = mix(vec3(luma(tgt0)), tgt0, sat);
    vec3 y = log(max(tgt, 1e-5) * 0.8 + 1e-5);
    float err = 1e9;
    for (int it = 0; it < 24; it++){
      vec3 F = fwd(exp(y)) - tgt;
      err = max(abs(F.r), max(abs(F.g), abs(F.b)));
      if (err < 2e-6) break;
      const float h = 1e-3;
      vec3 J0 = (fwd(exp(y + vec3(h, 0.0, 0.0))) - tgt - F) / h;
      vec3 J1 = (fwd(exp(y + vec3(0.0, h, 0.0))) - tgt - F) / h;
      vec3 J2 = (fwd(exp(y + vec3(0.0, 0.0, h))) - tgt - F) / h;
      mat3 J = mat3(J0, J1, J2);
      float det = determinant(J);
      vec3 stp = abs(det) < 1e-12 ? sign(F) * 0.5 : inverse(J) * F;
      y = clamp(y - clamp(stp, vec3(-2.0), vec3(2.0)), vec3(-25.0), vec3(1.6));
    }
    best = exp(y);
    if (err < 3e-3) break;
    sat *= 0.85;                     // out of the look's gamut: pull toward its own luma and solve again
  }
  o = vec4(pow(best, vec3(1.0 / 3.0)), 1.0);
}`);

// frost texture, in photo uv (generated once): r density, gb refraction gradient (0.5 = none), a crystal sparkle
const FS_FROST = frag(`
uniform vec2 uSize;
out vec4 o;
// frost flowers: needle crystals radiating from seeded nuclei (Voronoi), streaks constant along the radius
float flowers(vec2 p, float cell, float seed){
  vec2 i = floor(p / cell), f = fract(p / cell);
  float best = 8.0; vec2 bo = vec2(0.0), bi = vec2(0.0);
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(x, y); vec2 oo = h22(i + g + seed) * 0.8 + 0.1;
    float d = length(g + oo - f);
    if (d < best){ best = d; bo = g + oo; bi = i + g; }
  }
  vec2 rel = (f - bo) * cell; float r = length(rel);
  vec2 dir = rel / max(r, 1e-3);
  float hb = h12(bi + seed * 3.0);
  float n = vn(dir * (7.0 + 5.0 * hb) + hb * 40.0) * 0.6 + vn(dir * (17.0 + 9.0 * hb) + hb * 71.0) * 0.4;
  float needles = smoothstep(0.50, 0.80, n);
  needles *= 0.75 + 0.25 * vn(vec2(r / 7.0, hb * 13.0));
  float reach = cell * (0.35 + 0.35 * hb);
  return needles * (1.0 - smoothstep(reach * 0.2, reach, r)) * smoothstep(0.0, 3.0, r);
}
float edgeOf(vec2 uv){ float edgeD = min(min(uv.x, 1.0 - uv.x) * uSize.x, min(uv.y, 1.0 - uv.y) * uSize.y); return exp(-edgeD / 210.0); }
float fogOf(vec2 p, vec2 uv){
  float grain = vn(p / 1.2) * 0.55 + vn(p / 2.9) * 0.45;              // sugar-fine rime
  return clamp(0.20 + 0.34 * (fbm(p / 300.0, 4) - 0.5) + 0.55 * edgeOf(uv) + 0.10 * (grain - 0.5), 0.0, 1.0);
}
float needlesOf(vec2 p, vec2 uv){
  float patches = smoothstep(0.45, 0.70, fbm(p / 210.0 + 8.0, 3));
  float fl = max(flowers(p, 90.0, 1.0), 0.8 * flowers(p + 37.0, 47.0, 7.0));
  return fl * (0.10 + 1.1 * edgeOf(uv) + 0.55 * patches);
}
void main(){
  vec2 uv = screenUV();
  vec2 p = uv * uSize;
  float d = fogOf(p, uv), nd = needlesOf(p, uv);
  float e = 1.5;
  float dx = fogOf(p + vec2(e, 0.0), uv) + needlesOf(p + vec2(e, 0.0), uv) - fogOf(p - vec2(e, 0.0), uv) - needlesOf(p - vec2(e, 0.0), uv);
  float dy = fogOf(p + vec2(0.0, e), uv) + needlesOf(p + vec2(0.0, e), uv) - fogOf(p - vec2(0.0, e), uv) - needlesOf(p - vec2(0.0, e), uv);
  o = vec4(d, clamp(0.5 + vec2(dx, dy) / (2.0 * e) * 8.0, 0.0, 1.0), clamp(nd, 0.0, 1.0));
}`);

// thread along the seat: analytic distance to the spline y(x), occluded by the people mask except near the knot
const FS_THREAD = frag(GLSL_COMMON + `
uniform sampler2D uSeat;
uniform float uTip, uFrom, uI, uSteady, uHw, uGlintX, uGlintI, uOcc, uKnotR, uFresh;
uniform vec2 uKnot; uniform vec3 uCore, uGlow, uHot;
out vec4 o;
void main(){
  vec2 px = framePx();
  vec2 src = srcOf(px);
  float spx = uDest.z / uCrop.z;
  if (src.x < -2.0 || src.x > uSize.x + 2.0){ o = vec4(0.0); return; }
  vec4 sy = texture(uSeat, vec2(clamp(src.x / uSize.x, 0.0, 1.0), 0.5));
  float d = (src.y - sy.r) / sqrt(1.0 + sy.g * sy.g) * spx;      // frame px, signed
  float ad = abs(d);
  float pw = max(fwidth(d), 0.6);
  float core = clamp(0.5 - (ad - uHw) / pw, 0.0, 1.0);
  float glow = 0.55 * exp(-ad / 2.0) + 0.16 * exp(-ad / 6.5);
  // drawn span [from, tip], soft ends of 3 frame px
  float e = 3.0 / spx;
  float span = smoothstep(uFrom - e, uFrom + e, src.x) * (1.0 - smoothstep(uTip - e, uTip + e, src.x));
  float vis = 1.0 - uOcc * smoothstep(0.25, 0.75, pmask(src));
  float kd = length(src - uKnot);
  vis = max(vis, 1.0 - smoothstep(uKnotR * 0.6, uKnotR, kd));
  float behind = (uTip - src.x) * spx;                              // frame px behind the tip
  float fresh = uFresh * exp(-max(behind, 0.0) / 60.0);
  float lvl = uSteady + fresh;
  vec3 c = (uCore * core * 1.5 + uGlow * glow) * lvl;
  // tip: a small hot point while drawing
  float tdx = (src.x - uTip) * spx;
  vec4 st = texture(uSeat, vec2(clamp(uTip / uSize.x, 0.0, 1.0), 0.5));
  float tdy = (src.y - st.r) * spx;
  float tipr = length(vec2(tdx, tdy));
  float tipOn = step(uTip, uSize.x - 0.5) * step(0.5, uTip) * uFresh;
  c += uHot * tipOn * (1.6 * exp(-tipr * tipr / 6.0) + 0.35 * exp(-tipr / 9.0));
  // travelling glint
  if (uGlintI > 0.0){
    float gx = (src.x - uGlintX) * spx;
    float gk = exp(-gx * gx / (2.0 * 26.0 * 26.0));
    c += (uCore * core * 2.5 + uGlow * glow * 2.0) * gk * uGlintI;
    float gr = length(vec2(gx, d));
    c += uHot * uGlintI * 0.35 * exp(-gr * gr / 30.0);
  }
  c *= span;
  // the tip glow is not clipped by the span end
  o = vec4((c + uHot * tipOn * (0.35 * exp(-tipr / 9.0)) * (1.0 - span)) * vis * uI, 0.0);
}`);

// four-point star glint and the wall-portrait glass sweep (instanced quads over a rect)
const VS_QUAD = HEADER_VS + `
uniform vec4 uRect;   // frame px x, y, w, h
out vec2 vPx;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vPx = uRect.xy + c * uRect.zw;
  gl_Position = clipOfPx(vPx);
}`;
const FS_SWEEP = frag(`
in vec2 vPx;
uniform vec4 uGlass;   // frame px x0, y0, x1, y1 of the frame's glass
uniform float uLife, uI; uniform vec3 uCol;
out vec4 o;
void main(){
  vec2 p = vPx;
  vec2 c = (uGlass.xy + uGlass.zw) * 0.5, hs = (uGlass.zw - uGlass.xy) * 0.5;
  float box = 1.0 - smoothstep(-1.0, 1.0, sdBox(p - c, hs));
  // a diagonal band of light crossing the glass, left to right over the life
  vec2 q = (p - c) / max(hs.x, hs.y);
  float x = dot(q, normalize(vec2(1.0, -0.6)));
  float pos = mix(-1.6, 1.6, uLife);
  float band = exp(-pow((x - pos) / 0.16, 2.0)) + 0.35 * exp(-pow((x - pos + 0.32) / 0.07, 2.0));
  float env = sin(3.14159265 * clamp(uLife, 0.0, 1.0));
  // a faint lift of the whole glass while the light passes
  float sheen = 0.10 * env;
  o = vec4(uCol * uI * box * (band * env + sheen), 0.0);
}`);

// bokeh discs (instanced quads)
const VS_BOKEH = HEADER_VS + `
uniform vec4 uDisc[64]; uniform vec4 uDiscC[64];
uniform vec4 uCrop, uDest; uniform float uT, uDrift, uSizeK, uGrow;
out vec2 vQ; out vec4 vCol; out float vR;
void main(){
  vec4 D = uDisc[gl_InstanceID]; vec4 C = uDiscC[gl_InstanceID];
  vec2 ctr = uDest.xy + (D.xy - uCrop.xy) / uCrop.zw * uDest.zw;
  ctr.y -= uDrift * uT * (0.7 + 0.6 * C.a);
  ctr.x += 6.0 * sin(uT * 0.35 + C.a * 6.28);
  float r = D.z * uSizeK * mix(0.35, 1.0, uGrow);
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vQ = c * (r + 2.0); vR = r;
  float stag = clamp(uGrow * 1.6 - C.a * 0.6, 0.0, 1.0);
  vCol = vec4(C.rgb * D.w * stag, 1.0);
  gl_Position = clipOfPx(ctr + vQ);
}`;
const FS_BOKEH = frag(`
in vec2 vQ; in vec4 vCol; in float vR;
out vec4 o;
void main(){
  float r = length(vQ);
  float edge = 1.0 - smoothstep(vR - 2.2, vR + 0.8, r);
  float rn = r / max(vR, 1.0);
  // a lens disc: soft interior, a slightly brighter rim, a faint inner ring
  float body = 0.70 + 0.16 * smoothstep(0.62, 0.98, rn) - 0.08 * (1.0 - rn) * (1.0 - rn);
  o = vec4(vCol.rgb * body * edge, 0.0);
}`);

// ------------------------------------------------------------------------------------------------ renderer
export function createPhotoRenderer(G, photo) {
  const gl = G.gl;
  const meta = photo.meta;
  const PW = photo.w, PH_ = photo.h;
  const diag = Math.hypot(PW, PH_);
  const FA = meta.faces.left, FB = meta.faces.right;
  const MID = meta.faces.mid || [(FA[0] + FB[0]) / 2, (FA[1] + FB[1]) / 2];
  const sep = Math.hypot(FB[0] - FA[0], FB[1] - FA[1]);
  // skin protection ellipses: the same proportions as faceEllipses (0.13 x 0.2 of the image)
  const skinA = [FA[0], FA[1], PW * 0.13, PH_ * 0.2], skinB = [FB[0], FB[1], PW * 0.13, PH_ * 0.2];
  // head-and-shoulder light ellipses: generic proportions of the face separation
  const headA = [FA[0], FA[1], sep * 0.41, sep * 0.50], headB = [FB[0], FB[1], sep * 0.39, sep * 0.48];
  const spline = seatSpline(meta.seatEdge, PW);
  const seatTex = G.dataTexture(spline.n, 1, spline.ys, { format: 'rg32f', filter: 'linear' });
  // the seat knot sits on the seat spline between the two faces, a few px below the edge (in the visible gap)
  // the farthest image point from the faces (in diagonals) and from their midpoint (px): where bloom / frost finish
  const corners = [[0, 0], [PW, 0], [0, PH_], [PW, PH_]];
  const colourFull = Math.max(...corners.map(c => Math.min(Math.hypot(c[0] - FA[0], c[1] - FA[1]), Math.hypot(c[0] - FB[0], c[1] - FB[1])))) / diag;
  const frostFull = Math.max(...corners.map(c => Math.hypot(c[0] - MID[0], c[1] - MID[1])));
  const knotPt = [MID[0] + 0.03 * sep, spline.y(MID[0] + 0.03 * sep) + 0.012 * sep];

  let mask = null;
  const PH = {};
  PH.peopleMask = function () {
    if (mask) return mask;
    const w = Math.round(PW / 2), h = Math.round(PH_ / 2);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
    x.filter = 'blur(5px)';                    // 10 source px at half size
    x.fillStyle = '#fff'; x.beginPath();
    for (const [u, v] of meta.peopleUV) x.lineTo(u * w, v * h);
    x.closePath(); x.fill();
    mask = G.texture(cv, { mips: true });
    return mask;
  };
  PH.seatPolyline = () => meta.seatEdge.map(p => p.slice());
  PH.seatY = x => spline.y(x);
  PH.knotPoint = () => knotPt.slice();
  PH.faces = () => ({ a: FA.slice(), b: FB.slice(), mid: MID.slice(), diag });
  PH.postParams = cam => ({ faces: faceEllipses(cam), faceProtect: 0 });
  PH.parallax = function (cam, ref, factor = 0.45) {
    const p = cam.toFrame(MID), q = ref.toFrame(MID);
    let dx = (p[0] - q[0]) * factor, dy = (p[1] - q[1]) * factor;
    const lim = 0.006 * G.W, l = Math.hypot(dx, dy);
    if (l > lim) { dx *= lim / l; dy *= lim / l; }
    return [dx, dy];
  };
  PH.peopleMask();

  // ---- inverse LUTs per look (built on the GPU on first use)
  const N = 33;
  const invs = new Map();
  const invProg = G.program('photo.inv', FS_INV);
  function inverseLut(look) {
    if (invs.has(look)) return invs.get(look);
    const p = lookParams(look), g = p.grade;
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, tex);
    gl.texStorage3D(gl.TEXTURE_3D, 1, G.hasFloat ? gl.RGBA16F : gl.RGBA8, N, N, N);
    for (const k of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, k, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    for (let z = 0; z < N; z++) {
      const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
      gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tex, 0, z);
      G.draw(invProg, { uZ: z, uN: N, uSlope: g.slope, uOffset: g.offset, uPower: g.power, uSat: g.sat,
        uSplitS: g.splitShadow, uSplitH: g.splitHigh, uSplitAmt: g.splitAmt, uLift: p.lift || [0, 0, 0] }, { fbo: f, w: N, h: N, scale: 1 });
      gl.deleteFramebuffer(f);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    invs.set(look, tex);
    return tex;
  }
  inverseLut('photo');

  // ---- frost texture (once)
  const frostRT = G.rt(Math.round(PW / 2), Math.round(PH_ / 2), { format: 'rgba8', mips: true });
  G.draw(G.program('photo.frostgen', FS_FROST), { uSize: [PW, PH_] }, frostRT);
  G.mipmaps(frostRT);

  // ---- programs per feature set
  const progs = new Map();
  function mainProg(f) {
    const key = ['DOF', 'PAR', 'LIGHT', 'ENGRAVE', 'COLOUR', 'FROST', 'DEBUG', 'CACHE'].map(k => f[k] ? 1 : 0).join('');
    if (!progs.has(key)) {
      const defs = ['DOF', 'PAR', 'LIGHT', 'ENGRAVE', 'COLOUR', 'FROST', 'DEBUG', 'CACHE'].map(k => `#define ${k} ${f[k] ? 1 : 0}\n`).join('');
      progs.set(key, G.program('photo.main.' + key, FS_MAIN(defs)));
    }
    return progs.get(key);
  }
  const V = {
    vellum: hexDisp('#120D09'), g0: hexDisp('#6E4A12'), g1: hexDisp('#B8862B'), g2: hexDisp('#E3B341'), g3: hexDisp('#FFE7A3'),
    frost: hexDisp('#C9D2DC'), haze: hexDisp('#E39A4C'), lift: hexDisp('#120D09'),
  };
  // white balance gains for a colour-temperature shift (display-linear, luma-normalised)
  function wbGains(dK) {
    if (!dK) return [1, 1, 1];
    const bb = T => {   // Planckian approximation (same fit as the GLSL blackbody), linear
      T = Math.max(1000, Math.min(40000, T)) / 100;
      const r = T <= 66 ? 1 : c01(1.29293618606 * Math.pow(T - 60, -0.1332047592));
      const g = T <= 66 ? c01(0.39008157876 * Math.log(T) - 0.63184144378) : c01(1.12989086089 * Math.pow(T - 60, -0.0755148492));
      const b = T >= 66 ? 1 : (T <= 19 ? 0 : c01(0.54320678911 * Math.log(T - 10) - 1.19625408914));
      return [r, g, b].map(srgb2lin1);
    };
    const a = bb(6500 - dK), b = bb(6500);
    const k = a.map((v, i) => v / b[i]);
    const l = 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2];
    return k.map(v => v / l);
  }

  // ---- baked look cache (the 2x texture's real detail is the 1x original; the cache is at 2x so edges stay crisp)
  const cacheProg = G.program('photo.cache', FS_CACHE);
  let cache = null, cacheKey = '';
  function lookCache(gr, retouch) {
    const key = JSON.stringify([gr.warm, gr.sat, gr.green, gr.lift, gr.contrast, retouch]);
    if (cache && key === cacheKey) return cache;
    if (!cache) cache = G.rt(PW * 2, PH_ * 2, { format: 'srgb8', mips: true });
    G.draw(cacheProg, { uPhoto: photo.tex, uMask: mask, uSize: [PW, PH_], uSkinA: skinA, uSkinB: skinB, uWarm: gr.warm, uSat: gr.sat, uGreen: gr.green,
      uLiftK: gr.lift, uLift: V.lift, uContrast: gr.contrast, uRetouch: retouch }, cache);
    G.mipmaps(cache);
    cacheKey = key;
    return cache;
  }
  const upProg = G.program('photo.up', frag(`uniform sampler2D uHalf; uniform int uOpaque; out vec4 o;
void main(){ vec4 c = texture(uHalf, screenUV()); o = uOpaque == 1 ? vec4(c.rgb, 1.0) : c; }`));
  PH.draw = function (target, cam, o = {}) {
    // engraving and frost are skipped once they are entirely cleared from the image (pure geometry, no visual change)
    const colourDone = o.colour && o.colour.r >= colourFull + (o.colour.edge == null ? 0.08 : o.colour.edge) + 0.04;
    const frostDone = o.frost && o.frost.r != null && o.frost.r * diag >= frostFull + ((o.frost.warp == null ? 40 : o.frost.warp) + (o.frost.rimPx == null ? 30 : o.frost.rimPx)) / cam.sx + 4;
    const f = { DOF: !!(o.dof && o.dof.radius > 0.01), PAR: !!(o.parallax && (o.parallax[0] || o.parallax[1])), LIGHT: !!(o.light && (o.light.I == null || o.light.I > 0)),
      ENGRAVE: !!o.engrave && !colourDone, COLOUR: !!(o.engrave && o.colour), FROST: !!(o.frost && (o.frost.amount == null || o.frost.amount > 0) && !frostDone), DEBUG: !!o.debug };
    f.COLOUR = f.COLOUR && f.ENGRAVE && o.colour.r > 0;
    const look = o.look === undefined ? 'photo' : o.look;
    f.CACHE = !!(look && !f.DEBUG && o.cache !== false);
    const prog = mainProg(f);
    const tw = target ? target.w : G.W, th = target ? target.h : G.H, sc = target ? (target.scale || 1) : 1;
    const d = cam.dest;
    const cover = d[0] <= 0.5 && d[1] <= 0.5 && d[0] + d[2] >= tw / sc - 0.5 && d[1] + d[3] >= th / sc - 0.5 && !o.edgeFade && (o.opacity == null || o.opacity >= 1);
    // rasterise only the dest rect (plus a pixel), clipped to the target
    let vx0 = Math.max(0, Math.floor(d[0] * sc) - 1), vx1 = Math.min(tw, Math.ceil((d[0] + d[2]) * sc) + 1);
    let vy0 = Math.max(0, Math.floor(d[1] * sc) - 1), vy1 = Math.min(th, Math.ceil((d[1] + d[3]) * sc) + 1);
    if (vx1 <= vx0 || vy1 <= vy0) return;
    const gr = Object.assign({ warm: 1, sat: 0.94, green: 1, lift: 1, wb: 0, haze: 0, contrast: 0.05 }, o.grade || {});
    const useCache = f.CACHE;
    const U = {
      uCache: useCache ? lookCache(gr, o.retouch == null ? 1 : o.retouch) : photo.tex, uUseCache: useCache ? 1 : 0, uLod0Max: o.lod0Max == null ? 1.7 : o.lod0Max,
      uPhoto: photo.tex, uMask: mask, uSize: [PW, PH_], uInv: inverseLut(look || 'photo'), uUseInv: look ? 1 : 0,
      uExpo: Math.pow(2, o.exposure || 0), uOpacity: o.opacity == null ? 1 : o.opacity, uLod: o.lod || 0, uRetouch: o.retouch == null ? 1 : o.retouch,
      uCover: cover && !o.alphaOut ? 1 : 0, uAlphaOut: o.alphaOut ? 1 : 0,
      uSkinA: skinA, uSkinB: skinB, uWarm: gr.warm, uSat: gr.sat, uGreen: gr.green, uLiftK: gr.lift, uLift: V.lift,
      uHaze: gr.haze, uHazeC: V.haze, uWB: wbGains(gr.wb), uContrast: gr.contrast,
      uEdge: o.edgeFade ? [o.edgeFade.top || 0, o.edgeFade.bottom || 0, o.edgeFade.left || 0, o.edgeFade.right || 0] : [0, 0, 0, 0],
    };
    if (f.DOF) Object.assign(U, { uDof: o.dof.radius, uDofPeople: o.dof.people == null ? 0.75 : o.dof.people, uDofFocus: o.dof.focus || 0 });
    if (f.PAR) {
      let [dx, dy] = o.parallax; const lim = 0.006 * G.W, l = Math.hypot(dx, dy);
      if (l > lim) { dx *= lim / l; dy *= lim / l; }
      U.uPar = [-dx / cam.sx, -dy / cam.sy];
    }
    if (f.LIGHT) {
      const L = o.light, an = L.angle == null ? -2.4 : L.angle;
      // uLightDir points from the surface toward the light
      Object.assign(U, { uHeadA: headA, uHeadB: headB, uLightI: L.I == null ? 0.22 : L.I, uLightWash: L.wash == null ? 0.7 : L.wash,
        uLightRim: L.rim == null ? 1.0 : L.rim, uLightDir: [Math.cos(an), Math.sin(an)], uLightC: sceneCol(L.color || '#FFD9A0', look || 'photo').map(v => v / Math.max(...sceneCol(L.color || '#FFD9A0', look || 'photo'))) });
    }
    if (f.ENGRAVE) {
      const E = o.engrave;
      Object.assign(U, { uRevT: E.reveal == null ? 1e3 : E.reveal, uSpacing: E.spacing || 4.35, uKey: E.key || [d[0] - 200, d[1] - 300], uKeyI: E.keyI == null ? 1 : E.keyI,
        uFaceA: FA, uFaceB: FB, uDiag: diag, uVellum: V.vellum, uG0: V.g0, uG1: V.g1, uG2: V.g2, uG3: V.g3 });
    }
    if (f.COLOUR) {
      const C = o.colour;
      Object.assign(U, { uBloomR: C.r || 0, uBloomEdge: C.edge == null ? 0.08 : C.edge, uRimPx: C.rim || 12, uRimI: C.rimI == null ? 0.75 : C.rimI, uRimC: hexDisp('#FFE7A3') });
    }
    if (f.FROST) {
      const F = o.frost, t = F.t || 0;
      const plateDiag = diag, R = (F.r || 0) * plateDiag;
      const drops = [];
      const nd = F.drops == null ? 3 : F.drops;
      const rnd = mulberry32(0xF2057);
      for (let i = 0; i < 3; i++) {
        const xr = 0.18 + 0.64 * ((i + 0.5) / 3) + (rnd() - 0.5) * 0.12;
        const t0 = 0.55 + i * 0.55 + rnd() * 0.25;
        const v = 60 + 80 * rnd();                               // frame px/s
        const x0 = xr * PW;
        // the droplet forms on the lower rim of the cleared circle at its start time
        const R0 = (F.rAt ? F.rAt(t0) : (F.r || 0)) * plateDiag;
        const dx = x0 - MID[0];
        const y0 = MID[1] + Math.sqrt(Math.max(0, R0 * R0 - dx * dx)) + 14;
        const dt = Math.max(0, t - t0);
        const yh = y0 + (v * dt + 25 * dt * dt) / cam.sy;
        drops.push(t > t0 && y0 < PH_ ? [x0, y0, Math.min(yh, PH_ + 20), (6 + 3 * rnd()) / cam.sx] : [0, 0, 0, 0]);
      }
      void R;
      Object.assign(U, { uFrost: frostRT, uFrostR: F.r || 0, uFrostAmt: F.amount == null ? 1 : F.amount, uFrostT: t, uWarp: F.warp == null ? 40 : F.warp,
        uRimF: F.rimPx == null ? 30 : F.rimPx, uMid: MID, uFrostC: V.frost, uDrop: drops, uDrops: nd });
    }
    if (f.DEBUG) {
      const fb = meta.faceBoxUV;
      const lm = [FA, FB, MID, meta.pendant, knotPt].map(p => [p[0], p[1], 0, 1]);
      while (lm.length < 8) lm.push([0, 0, 0, 0]);
      Object.assign(U, { uSeat: seatTex, uFaceBox: [fb.x0 * PW, fb.y0 * PH_, fb.x1 * PW, fb.y1 * PH_], uLm: lm });
    }
    Object.assign(U, cam.uniforms);
    const blend = o.blend !== undefined ? o.blend : (cover && !o.alphaOut ? null : 'premul');
    // depth of field of 2.5 px and more renders at half resolution (the blur hides it) and is upsampled bilinearly
    if (f.DOF && o.dof.radius >= 2.5 && o.dof.halfRes !== false && !f.ENGRAVE) {
      const hw = Math.ceil(tw / 2), hh = Math.ceil(th / 2);
      const half = G.acquire(hw, hh, { format: 'hdr', scale: sc * 0.5 });
      U.uCover = 0; U.uAlphaOut = 1;
      const hv = [Math.floor(vx0 / 2), hh - Math.ceil(vy1 / 2), Math.ceil(vx1 / 2) - Math.floor(vx0 / 2), Math.ceil(vy1 / 2) - Math.floor(vy0 / 2)];
      G.clear(half, [0, 0, 0, 0]);
      G.draw(prog, U, half, { viewport: hv });
      const pre = cover && !o.alphaOut && o.blend === undefined;
      G.draw(upProg, { uHalf: half, uOpaque: pre ? 1 : 0 }, target, { blend: pre ? null : (o.blend || 'premul'), viewport: [vx0, th - vy1, vx1 - vx0, vy1 - vy0] });
      G.release(half);
    } else
    G.draw(prog, U, target, { blend, viewport: [vx0, th - vy1, vx1 - vx0, vy1 - vy0] });
    if (f.DEBUG) PH.debugOverlay(target, cam);
  };

  // debug: the wall portraits' glass rects and the bokeh sources as additive outlines
  PH.debugOverlay = function (target, cam) {
    for (let i = 0; i < meta.wallPortraits.length; i++) PH.portraitGlint(target, cam, { index: i, life: 0.5, I: 0.6 });
    for (let i = 0; i < bokehSrc.length; i++) {
      const b = bokehSrc[i], p = cam.toFrame(b);
      gold().glint(target, { x: p[0], y: p[1], size: 8, I: 1.5 });
    }
  };

  // ---- thread
  const threadProg = G.program('photo.thread', FS_THREAD);
  let K = null, seatKT = null, _gold = null;
  const gold = () => _gold || (_gold = createGold(G));
  function knotTex() {
    if (!K) K = createKnot(G, gold());
    if (!seatKT) {
      const ang = Math.atan2(spline.ys[Math.round(knotPt[0]) * 2 + 1], 1);     // along the seat edge
      const kn = seatKnot({ cx: 0, cy: 0, size: 58, rotation: ang, startNear: [-40 * Math.cos(ang), -40 * Math.sin(ang)] });
      seatKT = K.texture(kn, { ribbon: 2, gapFactor: 2.6, thread: true });
    }
    return seatKT;
  }
  PH.thread = function (target, cam, o = {}) {
    const look = o.look || 'photo';
    const tip = o.tip == null ? PW : o.tip;
    const I = o.I == null ? 1 : o.I;
    const kp = cam.toFrame(knotPt);
    const knotR = 40;                                          // source px: unoccluded zone around the knot
    // rasterise only the band around the seat curve
    const ys = meta.seatEdge.map(p => cam.toFrame(p)[1]);
    const xs = [cam.toFrame([0, 0])[0], cam.toFrame([PW, 0])[0]];
    const tw = target ? target.w : G.W, th = target ? target.h : G.H, sc = target ? (target.scale || 1) : 1;
    const pad = 40;
    const vx0 = Math.max(0, Math.floor((Math.min(...xs) - pad) * sc)), vx1 = Math.min(tw, Math.ceil((Math.max(...xs) + pad) * sc));
    const vy0 = Math.max(0, Math.floor((Math.min(...ys) - pad - 60 * cam.sy) * sc)), vy1 = Math.min(th, Math.ceil((Math.max(...ys) + pad + 60 * cam.sy) * sc));
    if (vx1 > vx0 && vy1 > vy0 && (tip > (o.from || 0) || o.glint != null)) {
      G.draw(threadProg, Object.assign({
        uMask: mask, uSize: [PW, PH_], uSeat: seatTex, uTip: tip, uFrom: o.from || 0, uI: I, uSteady: o.steady == null ? 0.7 : o.steady,
        uHw: (o.width || 2) / 2, uGlintX: o.glint == null ? -1e4 : o.glint, uGlintI: o.glint == null ? 0 : (o.glintI == null ? 4 : o.glintI),
        uOcc: o.occlude === false ? 0 : 1, uKnot: knotPt, uKnotR: knotR, uFresh: o.fresh == null ? (tip < PW ? 0.9 : 0) : o.fresh,
        uCore: sceneCol('#FFE7A3', look), uGlow: sceneCol('#D4A64A', look), uHot: sceneCol('#FFF4D6', look),
      }, cam.uniforms), target, { blend: 'add', viewport: [vx0, th - vy1, vx1 - vx0, vy1 - vy0] });
    }
    if (o.knot != null && o.knot > 0) {
      const kt = knotTex();
      let kI = o.knotI == null ? 1.6 : o.knotI;
      if (o.glint != null) kI *= 1 + 2.2 * Math.exp(-Math.pow((o.glint - knotPt[0]) / 45, 2));   // the glint flares on the knot
      K.draw(target, kt, { style: 'thread', progress: o.knot, center: kp, scale: cam.sx, width: Math.min(2, (o.width || 2) / cam.sx * 1.15),
        threadI: kI * I, look, tips: o.knot < 1, tipI: 2.2 });
      if (o.glint != null) {
        const fl = Math.exp(-Math.pow((o.glint - knotPt[0]) / 55, 2));
        if (fl > 0.01) gold().glint(target, { x: kp[0], y: kp[1], size: 30 * Math.max(0.7, cam.sx), I: 1.4 * fl * I, rot: 0.2, col: sceneCol('#FFF4D6', look) });
      }
    }
  };

  // ---- glints
  PH.glint = function (target, cam, o = {}) {
    const at = o.at === 'pendant' || !o.at ? meta.pendant : o.at;
    const life = o.life == null ? 0.5 : o.life;
    if (life <= 0 || life >= 1) return;
    const p = cam.toFrame(at);
    const env = Math.sin(Math.PI * life) ** 1.5;
    gold().glint(target, { x: p[0], y: p[1], size: (o.size || 24) * (0.75 + 0.25 * env), I: (o.I == null ? 6 : o.I) * env, rot: o.rot == null ? 0.12 : o.rot,
      col: o.col || sceneCol('#FFF4D6', o.look || 'photo') });
  };
  const sweepProg = G.program('photo.sweep', FS_SWEEP, VS_QUAD);
  PH.portraitGlint = function (target, cam, o = {}) {
    const r = meta.wallPortraits[o.index || 0];
    if (!r) return;
    const life = o.life == null ? 0.5 : o.life;
    if (life <= 0 || life >= 1) return;
    const a = cam.toFrame([r[0], r[1]]), b = cam.toFrame([r[2], r[3]]);
    // the glass sits inside the frame moulding (about 12 % of the frame's width each side)
    const ins = 0.12 * (b[0] - a[0]);
    const glass = [a[0] + ins, a[1] + ins, b[0] - ins, b[1] - ins];
    const I = o.I == null ? 1 : o.I;
    G.draw(sweepProg, { uRect: [a[0] - 2, a[1] - 2, b[0] - a[0] + 4, b[1] - a[1] + 4], uGlass: glass, uLife: life, uI: 0.55 * I, uCol: sceneCol('#FFE7A3', o.look || 'photo') },
      target, { blend: 'add', mode: gl.TRIANGLE_STRIP, count: 4 });
    const env = Math.exp(-Math.pow((life - 0.55) / 0.16, 2));
    if (env > 0.02) gold().glint(target, { x: a[0] + ins * 1.1, y: a[1] + ins * 1.1, size: 18 * Math.max(0.8, cam.sx), I: 3.2 * env * I, rot: 0.1,
      col: sceneCol('#FFF4D6', o.look || 'photo') });
  };

  // ---- bokeh: highlight sources picked once from a 1/8-size readback of the photo (seeded)
  const bokehSrc = [], bokehCol = [];
  {
    const bw = Math.round(PW / 8), bh = Math.round(PH_ / 8);
    const rt = G.rt(bw, bh, { format: 'rgba8' });
    const P0 = G.program('photo.readback', frag(`uniform sampler2D uPhoto; out vec4 o; void main(){ vec2 uv = vec2(screenUV().x, 1.0 - screenUV().y); o = vec4(lin2srgb(textureLod(uPhoto, uv, 3.5).rgb), 1.0); }`));
    G.draw(P0, { uPhoto: photo.tex }, rt);
    const px = G.readPixels(rt);
    G.free(rt);
    // rows come back bottom-up; uv.y was flipped in the shader so row r is image row r
    const lumAt = (x, y) => { const i = (y * bw + x) * 4; return [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255]; };
    const mcv = document.createElement('canvas'); mcv.width = bw; mcv.height = bh;
    const mx = mcv.getContext('2d'); mx.fillStyle = '#000'; mx.fillRect(0, 0, bw, bh); mx.fillStyle = '#fff'; mx.beginPath();
    for (const [u, v] of meta.peopleUV) mx.lineTo(u * bw, v * bh);
    mx.closePath(); mx.fill();
    const md = mx.getImageData(0, 0, bw, bh).data;
    const cand = [];
    for (let y = 2; y < bh - 2; y++) for (let x = 2; x < bw - 2; x++) {
      const c = lumAt(x, y), l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      if (md[(y * bw + x) * 4] > 40) continue;                                  // not on the people
      const sxp = (x + 0.5) * 8, syp = (y + 0.5) * 8;
      const inSkin = [skinA, skinB].some(e => Math.hypot((sxp - e[0]) / (e[2] * 1.5), (syp - e[1]) / (e[3] * 1.4)) < 1);
      if (inSkin) continue;
      const warm = c[0] > c[1] && c[1] >= c[2] * 0.9;                       // warm sources only (lamps, wood, brass)
      const w = warm ? Math.pow(Math.max(0, l - 0.28), 1.3) * (0.5 + (c[0] - c[2]) * 2.0) : 0;
      if (w > 0.002) cand.push([sxp, syp, w, c]);
    }
    const rnd = mulberry32(0xB0E7);
    const total = cand.reduce((a, c) => a + c[2], 0);
    const used = [];
    for (let k = 0; k < 1200 && used.length < 60 && cand.length; k++) {
      let r = rnd() * total, j = 0;
      while (j < cand.length - 1 && r > cand[j][2]) { r -= cand[j][2]; j++; }
      const c = cand[j];
      const sx = c[0] + (rnd() - 0.5) * 16, sy = c[1] + (rnd() - 0.5) * 16;
      if (used.some(u => Math.hypot(u[0] - sx, u[1] - sy) < 62)) continue;
      used.push([sx, sy]);
      const size = 30 + 60 * Math.pow(rnd(), 1.4);                              // radius frame px at 1080p (60-180 px discs)
      const warm = rnd();
      const tint = warm < 0.7 ? hexDisp('#E39A4C') : hexDisp('#FFD9A0');
      const col = tint;
      bokehSrc.push([sx, sy, size, (0.03 + 0.09 * Math.pow(rnd(), 1.6)) * (1.15 - 0.5 * (size - 30) / 60)]);
      bokehCol.push([...col, rnd()]);
    }
  }
  const bokehProg = G.program('photo.bokeh', FS_BOKEH, VS_BOKEH);
  PH.bokeh = function (target, cam, o = {}) {
    const I = o.I == null ? 1 : o.I;
    if (I <= 0 || !bokehSrc.length) return;
    const look = o.look || 'photo';
    const conv = bokehCol.map(c => { const s = displayToSceneCached(c, look); return [s[0], s[1], s[2], c[3]]; });
    const discs = bokehSrc.map(b => [b[0], b[1], b[2] * G.U * (o.size || 1), b[3] * I]);
    G.draw(bokehProg, Object.assign({ uDisc: pad64(discs), uDiscC: pad64(conv), uT: o.t || 0, uDrift: o.drift == null ? 6 : o.drift, uSizeK: 1, uGrow: o.grow == null ? 1 : o.grow }, cam.uniforms),
      target, { blend: 'add', mode: gl.TRIANGLE_STRIP, count: 4, instances: discs.length });
  };
  const _dc = new Map();
  function displayToSceneCached(c, look) {
    const k = c.slice(0, 3).map(v => v.toFixed(4)).join(',') + look;
    if (!_dc.has(k)) {
      const s = c.slice(0, 3).map(v => { const x = Math.max(0, Math.min(1, v)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; });
      _dc.set(k, displayToScene(s, lookParams(look)));
    }
    return _dc.get(k);
  }
  function pad64(a) { const o = a.slice(0, 64); while (o.length < 64) o.push([0, 0, 0, 0]); return o; }

  // ---- grains: the 98k-grain forming
  const GX = Math.ceil(PW / 4), GY = Math.ceil(PH_ / 4);
  const grainProg = G.program('particles.photo.grains', frag(`
in vec4 vCol; in float vSize;
out vec4 o;
void main(){
  vec2 q = (gl_PointCoord * 2.0 - 1.0) * (vSize + 2.0) / max(vSize, 1.0);
  float w = exp(-dot(q, q) * 1.6);
  o = vec4(vCol.rgb * vCol.a * w, 0.0);
}`), HEADER_VS + `
uniform float uTau;
out vec4 vCol; out float vSize;
uniform sampler2D uPhoto; uniform vec4 uCrop, uDest; uniform vec2 uSize, uFaceA, uFaceB;
uniform float uDiag, uT, uArrive, uI, uDelay, uTipT1, uSpacing; uniform vec4 uTips[17]; uniform int uGX;
uniform vec3 uHot, uG1, uG2, uG3;
void main(){
  int id = gl_VertexID;
  int gx = id % uGX, gy = id / uGX;
  vec2 jit = h22(vec2(float(gx) * 1.37 + 11.0, float(gy) * 2.11 + 5.0)) - 0.5;
  vec2 h = (vec2(gx, gy) + 0.5 + jit * 0.5) * 4.0;                     // home, source px
  float spx = uDest.z / uCrop.z;
  vec2 hp = uDest.xy + (h - uCrop.xy) / uCrop.zw * uDest.zw;           // home, frame px
  float d = uDelay * min(length(h - uFaceA), length(h - uFaceB)) / uDiag;
  float r1 = h11(float(id) * 0.731 + 3.0);
  float ti = d + 0.06 * r1;
  float k = clamp((uT - ti) / uArrive, 0.0, 1.0);
  float rev = smoothstep(-0.10, 0.14, uT - (d + 0.06 * r1 * 0.0 + uArrive));   // the engraving texture appears here
  vec4 col = vec4(0.0);
  vec2 px = hp; float size = 1.0;
  if (uT >= ti && rev < 1.0){
    // the pen tip this grain leaves from, at its launch time
    float tb = max(0.0, ti - 0.75 * h11(float(id) * 2.37 + 1.0));   // born on the band already drawn (seeded points behind the tip)
    float ft = clamp(tb / uTipT1, 0.0, 1.0) * 16.0;
    int i0 = int(floor(ft)); int i1 = min(i0 + 1, 16);
    vec4 tp = mix(uTips[i0], uTips[i1], fract(ft));
    float side = step((uFaceA.x + uFaceB.x) * 0.5 + (h11(float(id) * 3.71) - 0.5) * 0.45 * uDiag, h.x);
    vec2 birth = mix(tp.xy, tp.zw, side);
    vec2 r2 = h22(vec2(float(id), 7.0)) - 0.5;
    birth += r2 * 10.0;
    float ke = 1.0 - pow(1.0 - k, 3.0);
    vec2 path = hp - birth;
    vec2 perp = vec2(-path.y, path.x);
    float bend = (h11(float(id) * 1.913) - 0.5) * 0.55;
    px = mix(birth, hp, ke) + perp * bend * sin(3.14159265 * ke) + (1.0 - ke) * 14.0 * vec2(vn(h * 0.01 + uT * 0.8) - 0.5, vn(h * 0.01 + 9.0 + uT * 0.8) - 0.5);
    // the value this grain lands with: the engraving's average tone over its 4x4 cell
    float Lp = pow(luma(textureLod(uPhoto, h / uSize, 3.0).rgb), 1.0 / 2.2);
    float Lt = pow(smoothstep(0.08, 0.84, Lp), 1.3);
    float v = clamp(2.0 * mix(0.035, 0.45, Lt), 0.0, 1.0);
    vec3 landed = mix(uG1, mix(uG2, uG3, Lt), Lt) * v;
    float spark = step(0.97, h11(float(id) * 5.31));
    float flash = exp(-pow((k - 0.985) / 0.035, 2.0)) * 0.9 * v;
    vec3 c = mix(uHot * (0.30 + 0.45 * r1 * r1 * r1) * (1.0 + 3.0 * spark), landed * 1.5, smoothstep(0.8, 1.0, k)) + uHot * flash;
    float cell = 4.0 * spx;
    size = mix(1.5 + 0.9 * r1 + spark * 0.6, cell * 0.8, smoothstep(0.75, 1.0, k));
    col = vec4(c * uI, (1.0 - rev) * smoothstep(0.0, 0.12, k));
  }
  float s = max(size * uScale, 1.0);
  col.a *= min(1.0, (size * uScale) * (size * uScale));
  vCol = col; vSize = s;
  gl_Position = col.a <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : clipOfPx(px);
  gl_PointSize = s + 2.0;
}`);
  PH.grainCount = GX * GY;
  PH.grains = function (target, cam, o = {}) {
    const t = o.t || 0;
    if (t <= 0) return;
    const look = o.look || 'photo';
    const T1 = 1.2;
    const tips = [];
    for (let i = 0; i <= 16; i++) {
      const tt = o.tipAt ? o.tipAt(T1 * i / 16) : [cam.toFrame([0, PH_]), cam.toFrame([PW, PH_])];
      tips.push([tt[0][0], tt[0][1], tt[1][0], tt[1][1]]);
    }
    // display-linear gold stops -> scene (the grains are additive light over the vellum)
    const g = h => sceneCol(h, look);
    G.draw(grainProg, Object.assign({
      uPhoto: photo.tex, uSize: [PW, PH_], uFaceA: FA, uFaceB: FB, uDiag: diag, uT: t, uArrive: o.arrive || 0.9, uI: o.I == null ? 1 : o.I,
      uDelay: o.delay == null ? 2.0 : o.delay, uTipT1: T1, uTips: tips, uGX: GX,
      uHot: g('#FFE7A3'), uG1: g('#B8862B'), uG2: g('#E3B341'), uG3: g('#FFE7A3'),
    }, cam.uniforms), target, { blend: 'add', mode: gl.POINTS, count: GX * GY });
  };

  return PH;
}
