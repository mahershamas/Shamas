/*
  core/sea.js: seas and skies (package P4).

  What is here
    engraved()   the engraved gold ocean of scenes 3, 4, 9 and 11: world-space hatch lines on a 7-wave Gerstner swell
                 (the spec's four waves plus three detail waves under a slow interference envelope, so it never tiles).
                 Lines are box-filtered analytically over the pixel footprint AND over the camera motion of one shutter
                 (motion-widened AA from camPrev: no stair steps, no strobing, no shimmer). A hatch level of detail keeps
                 the lines world-anchored but never closer than a target spacing in px (every other line fades out where
                 they would crowd), so the engraving reaches the horizon instead of turning to mush; waves shorter than
                 two line spacings are filtered so lines follow the swell and never wiggle; the height lift is limited by
                 the local slope so lines never fold or cross. Crest-thickened (never merging), gold-ramped by a sheen
                 term (palette hexes land on screen), reflection columns for horizon lights and for vertical sources
                 (meridians) that unroll toward the camera, shimmer with the wave normal and break into dashes.
    rendered()   the analytic night sea of scenes 10, 11 and 14 (and the dusk-loch water of scene 5): an analytic plane
                 with 12 exp-sine-like waves with domain drag (no tiling), every wave filtered by its size on screen and
                 the filtered-out slope variance moved into the roughness (no shimmer; the far glitter path widens
                 correctly), Schlick Fresnel (F0 0.02), reflection of the shared quarter-res sky/aurora, of the stars and
                 of the sun (GGX), distance haze, an anti-aliased horizon. amp 0 is a perfect mirror. Mirror mode:
                 `mirror` = any frame-aligned texture of what stands above the horizon (ridges, sky), reflected with
                 ripple and Fresnel; region 'sea' leaves the pixels above the horizon untouched. Optional hashed glints
                 in a column under the sun with deterministic flicker (scene 5).
    sky()        the shared quarter-resolution sky: keyed gradient (top / mid / horizon band), horizon haze, warm glow
                 around the sun azimuth, broad Mie halo, faint milky band. The texture is FRAME-ALIGNED; rows below the
                 horizon hold the MIRRORED sky (the sky seen in the reflected direction), so the sea reads its
                 reflection next to its own pixel and is never clipped at the frame edge. Read it only through these
                 functions (they upsample it once to half resolution with Catmull-Rom).
    aurora()     curtains after the classic triangle-noise recipe (40 layers, triNoise speed 0.06) with arcs of dark
                 sky between them, palette #3DF5B0 / #1E9C8A / violet tops, rendered at W/4 x H/8 (the curtains' detail
                 is horizontal) and added into the quarter sky, both halves: one evaluation serves sky and reflection.
    stars        a seeded catalogue of 15,700 stars on the sphere drawn as additive sprites (world-fixed: they swing with
                 pitch and yaw), streaked over the shutter when camPrev is given, and reflected in the rendered sea
                 through the same waves (moved by the wave normal, stretched by the slope spread, weighted by Fresnel).
    sun          analytic disc with limb darkening, an exponential edge (no hard edge), a wide warm glow and the tight
                 Mie term; reflected via GGX; the broad halo lives in the quarter sky.
    godRays()    quarter-res crepuscular rays: glow around the sun broken by drifting mist clumps, 48-tap radial blur,
                 mist-modulated, strongest in the low air over the water, added at full resolution.
    glitter()    closed-form additive gold sprites on the sun's glitter path, gated by the sea's own specular term
                 (same waves), seeded lives, an opening front and short bright bursts (jig down-strokes).
    flare()      the sun's diffraction star (8 rays) and an optional analytic horizontal streak (viewport-limited pass).

  Camera (shared by all calls): {h: height m, x, z: position m, yaw: rad (0 looks along +z), pitch: rad (positive
                                 looks down), roll: rad (positive rolls the image clockwise), fovY: rad (default 0.6)}.
  Colours: a '#RRGGBB' string is a DISPLAY colour, converted with post.displayToScene under `look` (default 'night_sea';
           pass look: 'winter_gold' in scene 5) so palette hexes land on screen (a colour the grade cannot reach keeps
           its hue at the highest reachable level); an array [r,g,b] is used as linear scene HDR as given.

  API
    horizonPitch(horizonY, H, fovY = 0.6) -> pitch        pitch that puts the horizon at frame y = horizonY
    const S = createSea(G)
    S.ray(cam, x, y) -> [dx,dy,dz]          world direction through frame px (x, y) (same maths as the shaders)
    S.dirAt(cam, x, y)                      alias of ray (place a sun or a light at a frame position)
    S.project(cam, dir) -> [x, y] | null    frame px of a world direction (null if behind the camera)
    S.horizonY(cam, x = W/2) -> y           frame y of the horizon at frame x
    S.quarter(name) -> RT                   a W/4 x H/4 HDR target (scale 0.25) for sky() and aurora()

    S.sky(rtQ, {tau, cam, top = '#0A1220', mid = '#0A1020', horizon = '#12182A', band = 0.05 (rad, height of the
                horizon band), haze: {color, I = 0.6, width = 0.035}, glow: {color = '#E39A4C', I = 0, width = 0.6,
                height = 0.12} (warm light around the sun azimuth), sun: SUN (dir, halo used), milky = 0, look})
    S.aurora(rtQ, {tau, cam, intensity = 0.5 (spec peak 0.55), speed = 0.06, reveal = 1 (0..1: unfolds left to right
                   and down), colors: [base, body, top], topAmt = 0.35, desat = 0.3, scaleZ = 1.6, scaleX = 2.1, look})
    S.engraved(target, {tau, cam, camPrev = null (camera one frame earlier: motion AA of lines and star streaks),
                   motionAA = 0 (with camPrev: shutter fraction, 0.5-0.6 for scene 9; without camPrev it widens the AA
                   by motionAA x the footprint, the spec's formula), spacing = 0.35, amp = 1, lift = 1.6, width = 1,
                   lineSpacingNear = 9 px, lineSpacingFar = 3.2 px (hatch LOD targets),
                   lineFar = '#3A3020', lineDim = '#6E4A12', lineMid = '#B8862B', lineNear = '#D4A64A',
                   lineHot = '#FFE7A3' (the gold ramp), nearAlpha = 0.55 (scales the middle of the ramp),
                   mist = '#0A1A22', skyTop = '#07080C', skyHorizon = '#0A1020', sky: RT|null (quarter sky/aurora),
                   stars = 0 (intensity), hazeI = 1,
                   lights: [[x, I, reach = 1, width = 18], ...] (frame x of lights on the horizon),
                   columns: [[x, I, reach, width = 10], ...] (vertical sources, e.g. meridians: their column unrolls
                   toward the camera as reach goes 0 -> 1) -- lights + columns up to 8 in all,
                   shield: Tex|null (blurred caption mask, frame-aligned alpha), shieldK = 0.7, alpha = 1, blend, look})
    S.rendered(target, {tau, cam, amp = 0.15 (0 = mirror), k0 = 0.35, drag = 0.28, sky: RT|null, mirror: RT|null,
                   region: 'all'|'sea', deep = [0.004,0.009,0.018], stars = 1, sun: SUN|null,
                   haze: {color, I, width}, fog = 0.0012, glints: {I, width = 0.06 (of W), rate = 10, exp = 400}|null,
                   reflect = 1, top, mid, horizon (gradient used only without a sky RT), alpha = 1, blend, look})
    S.skyDraw(target, {tau, cam, sky: RT|null, stars = 1, sun, top, mid, horizon, haze, alpha, blend})  sky only
    S.stars(target, cam, {tau, I, camPrev, shutter = 0.5, refl = false, amp})          the star sprites alone
    S.godRays(target, {tau, cam, sun: SUN, I = 1, color = '#FFC88A', mist = 1, density = 0.9, decay = 0.965,
                   spread = 0.07})
    S.glitter(target, {tau, cam, sun: SUN, amp = 0.15 (match rendered), count = 5000, open = 1, I = 1,
                   color = '#FFE7A3', width = 0.05 (half width at the horizon, of W), widen = 0.32 (px per px below
                   the horizon), exp = 600, bursts: [{tau, vel}] (each spawns 40 bright glints for 0.15 s; 8 live)})
    S.flare(target, {x, y, I = 0.15, rays = 8, len = 300, angle = 0, color = '#FFF4D6', streak = 0, streakLen = 1200,
                   streakColor = '#FFD27A'})
    SUN = {dir: [x,y,z] | at: [frameX, frameY], r: px radius (default 22), color = '#FFF0C8', I = 20 (disc HDR),
           halo = 1 (glow and Mie), haloColor (default color), soft = 0.15 (edge e-fold, fraction of r),
           spec = 30 (gain of the sun on the water)}
    Pass order for a night-sea frame: S.sky(q) -> S.aurora(q) -> S.rendered(target, {sky: q}) (draws sky, sea, stars and
    their reflections) -> S.godRays / S.glitter / S.flare (additive).

  Measured cost (software rasteriser, 1920x1080, harness private/v2/p4): engraved 145-180 ms (with stars); rendered
  165-195 ms including the half-res sky upsample, stars and reflected stars; sky 6-17 ms; aurora 81 ms; god rays
  70 ms; glitter 5 ms; flare 6 ms.
  Determinism: every term is a function of (tau, uniforms, frame px); dithers are fixed in space, never in time; the
  star catalogue is seeded (mulberry32).
*/
import { frag, HEADER_VS } from './glsl.js';
import { hexLin } from './gl.js';
import { displayToScene, sceneToDisplay, DEFAULTS, LOOKS } from './post.js';
import { mulberry32 } from './timeline.js';

// ------------------------------------------------------------------ JS camera maths (mirrors the GLSL)
export function horizonPitch(horizonY, H, fovY = 0.6) {
  const f = (H / 2) / Math.tan(fovY / 2);
  return Math.atan((H / 2 - horizonY) / f);
}
function basis(cam, W, H) {
  const fovY = cam.fovY || 0.6, f = (H / 2) / Math.tan(fovY / 2);
  const p = cam.pitch || 0, y = cam.yaw || 0, r = cam.roll || 0;
  const cp = Math.cos(p), sp = Math.sin(p), cy = Math.cos(y), sy = Math.sin(y), cr = Math.cos(r), sr = Math.sin(r);
  const rot = ([x, yy, z]) => {
    const x1 = x * cr - yy * sr, y1 = x * sr + yy * cr;
    const y2 = y1 * cp - z * sp, z2 = y1 * sp + z * cp;
    return [x1 * cy + z2 * sy, y2, -x1 * sy + z2 * cy];
  };
  const ex = rot([1, 0, 0]), ey = rot([0, 1, 0]), ez = rot([0, 0, 1]);
  return { f, ex, ey, ez, M: [...ex, ...ey, ...ez], pos: [cam.x || 0, cam.h == null ? 10 : cam.h, cam.z || 0] };
}
const norm3 = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

// ------------------------------------------------------------------ colours
const colCache = new Map();
function lookParams(look) {
  const p = JSON.parse(JSON.stringify(DEFAULTS));
  const L = LOOKS[look] || {};
  if (L.grade) Object.assign(p.grade, L.grade);
  for (const k in L) if (k !== 'grade') p[k] = L[k];
  return p;
}
function col(v, look = 'night_sea', hot = false) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  const k = look + v + (hot ? '!' : '');
  if (colCache.has(k)) return colCache.get(k);
  // invert the tonemap + grade so the hex lands on screen. A saturated colour the grade cannot reach is found at the
  // highest reachable display level (same hue, dimmer); with hot = true it is pushed back up into HDR instead (it then
  // reads as a hot, slightly whitened version: for highlights only).
  const P = lookParams(look);
  const t = [0, 2, 4].map(i => parseInt(v.replace('#', '').slice(i, i + 2), 16) / 255);
  let out = null;
  for (const f of [1, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6, 0.5, 0.4]) {
    const tf = t.map(x => x * f);
    const sc = displayToScene(tf, P);
    const back = sceneToDisplay(sc, P);
    const err = Math.max(...back.map((x, i) => Math.abs(x - tf[i])));
    if (err < 6 / 255 && Math.max(...sc) < 60) { const up = hot ? Math.pow(1 / f, 2.4) : 1; out = sc.map(x => x * up); break; }
  }
  if (!out) out = hexLin(v);
  colCache.set(k, out);
  return out;
}
const lin = v => (typeof v === 'string' ? hexLin(v) : v);
// chroma of a display colour at a mid level under the look, normalised to unit luminance (for emissive layers whose
// brightness varies: the aurora)
function chroma(v, look = 'night_sea') {
  if (typeof v !== 'string') return v;
  const k = 'chroma' + look + v;
  if (!colCache.has(k)) {
    const t = [0, 2, 4].map(i => parseInt(v.replace('#', '').slice(i, i + 2), 16) / 255 * 0.5);
    const sc = displayToScene(t, lookParams(look));
    const l = 0.2126 * sc[0] + 0.7152 * sc[1] + 0.0722 * sc[2];
    colCache.set(k, sc.map(x => x / Math.max(l, 1e-6)));
  }
  return colCache.get(k);
}
const scl = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

// ------------------------------------------------------------------ shared GLSL
const SEA_LIB = `
uniform mat3 uCamM;      // camera -> world (columns: right, up, forward)
uniform vec3 uCamP;      // camera position (x, height, z)
uniform float uF;        // focal length in frame px
uniform vec3 uHzLine;    // horizon: frame y = x + y * frameX  (straight line)
uniform float uTau;

vec3 camRayL(vec2 px){ return normalize(uCamM * vec3((px.x - uFrame.x * 0.5) / uF, (uFrame.y * 0.5 - px.y) / uF, 1.0)); }
vec2 camProject(vec3 d){
  vec3 l = transpose(uCamM) * d;
  l.z = max(l.z, 1e-4);
  return vec2(uFrame.x * 0.5 + uF * l.x / l.z, uFrame.y * 0.5 - uF * l.y / l.z);
}
float hzY(float x){ return uHzLine.x + uHzLine.y * x; }
uvec3 pcg3d(uvec3 v){
  v = v * 1664525u + 1013904223u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  v ^= v >> 16u;
  v.x += v.y * v.z; v.y += v.z * v.x; v.z += v.x * v.y;
  return v;
}
// plane hit (sea at y = 0) for a downward ray
vec2 seaHit(vec3 rd){ float ry = min(rd.y, -1e-5); return uCamP.xz + rd.xz * (uCamP.y / -ry); }

// bicubic B-spline sample with 4 bilinear taps (smooth upsampling of the quarter-res sky)
vec4 texBicubic(sampler2D t, vec2 uv){
  vec2 res = vec2(textureSize(t, 0));
  vec2 st = uv * res - 0.5;
  vec2 i = floor(st), f = st - i;
  vec2 f2 = f * f, f3 = f2 * f;
  vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
  vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0;
  vec2 w3 = f3 / 6.0;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (i - 1.0 + w1 / g0 + 0.5) / res, h1 = (i + 1.0 + w3 / g1 + 0.5) / res;
  return g0.y * (g0.x * texture(t, vec2(h0.x, h0.y)) + g1.x * texture(t, vec2(h1.x, h0.y)))
       + g1.y * (g0.x * texture(t, vec2(h0.x, h1.y)) + g1.x * texture(t, vec2(h1.x, h1.y)));
}

// Catmull-Rom (interpolating, sharper than the B-spline) with 9 bilinear taps: the direct view of the quarter sky
vec4 texCR(sampler2D t, vec2 uv){
  vec2 res = vec2(textureSize(t, 0));
  vec2 sp = uv * res, tc = floor(sp - 0.5) + 0.5, f = sp - tc;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f)), w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f)), w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2, o12 = w2 / w12;
  vec2 t0 = (tc - 1.0) / res, t3 = (tc + 2.0) / res, t12 = (tc + o12) / res;
  vec4 r = (texture(t, vec2(t0.x, t0.y)) * w0.x + texture(t, vec2(t12.x, t0.y)) * w12.x + texture(t, vec2(t3.x, t0.y)) * w3.x) * w0.y
         + (texture(t, vec2(t0.x, t12.y)) * w0.x + texture(t, vec2(t12.x, t12.y)) * w12.x + texture(t, vec2(t3.x, t12.y)) * w3.x) * w12.y
         + (texture(t, vec2(t0.x, t3.y)) * w0.x + texture(t, vec2(t12.x, t3.y)) * w12.x + texture(t, vec2(t3.x, t3.y)) * w3.x) * w3.y;
  return max(r, 0.0);
}

// ---------- sun
uniform vec4 uSun;       // dir xyz, angular radius
uniform vec3 uSunCol;    // disc radiance (HDR, colour x I)
uniform vec3 uSunHaloCol;
uniform float uSunHalo, uSunSoft;
vec3 sunDisc(vec3 rd){
  float ca = dot(rd, uSun.xyz);
  float ang = sqrt(max(2.0 * (1.0 - ca), 0.0));
  float rr = uSun.w;
  float aa = 0.9 / uF;
  float core = smoothstep(rr + aa, rr - aa, ang);
  float mu = sqrt(max(1.0 - (ang * ang) / (rr * rr), 0.0));
  // no hard edge: past the limb the radiance falls off exponentially (about uSunSoft * r per e-fold)
  float edge = exp(-max(ang - rr, 0.0) / max(uSunSoft * rr, 1.5 / uF));
  vec3 c = uSunCol * mix(edge, 0.7 + 0.3 * mu, core);
  // wide warm glow and the tight Mie term of the cookbook (the broad part lives in the quarter sky)
  float o = max(ang - rr, 0.0);
  c += uSunHaloCol * uSunHalo * (0.3 * exp(-o / (rr * 1.6)) + 0.08 * exp(-o / (rr * 6.0)) + 0.5 * pow(max(ca, 0.0), 800.0));
  return c;
}
`;

// engraved swell: the spec's four Gerstner waves plus three detail waves; low-frequency group envelope
const SWELL = `
const float SW_LAM[7] = float[7](18.0, 9.0, 4.5, 2.1, 31.0, 6.3, 1.35);
const float SW_AMP[7] = float[7](0.6, 0.3, 0.12, 0.05, 0.22, 0.09, 0.022);
const float SW_DIR[7] = float[7](-0.35, 0.21, -0.61, 0.52, 0.08, 0.43, -0.18);
const float SW_PH[7]  = float[7](0.0, 1.7, 3.4, 5.1, 2.3, 4.4, 0.9);
void swell(vec2 xz, float t, float amp, float fpz, float lamMin, out float h, out vec2 g, out float dz, out float smax){
  h = 0.0; g = vec2(0.0); dz = 0.0; smax = 0.0;
  // swell groups: a slow interference envelope (two incommensurate long sines), so crests never repeat
  float env = 1.0 + 0.2 * sin(dot(xz, vec2(0.031, 0.047)) + t * 0.11) + 0.16 * sin(dot(xz, vec2(-0.043, 0.023)) + 1.7);
  for (int i = 0; i < 7; i++){
    float lam = SW_LAM[i];
    float filt = smoothstep(1.2, 3.5, lam / max(fpz, 1e-4)) * smoothstep(0.6, 1.4, lam / max(lamMin, 1e-4));
    if (filt <= 0.0) continue;
    float k = TAU / lam;
    float w = sqrt(9.81 * k);
    vec2 d = vec2(sin(SW_DIR[i]), cos(SW_DIR[i]));
    float ph = k * dot(d, xz) - w * t + SW_PH[i];
    float a = SW_AMP[i] * amp * env * filt;
    float s = sin(ph), c = cos(ph);
    h += a * s;
    g += a * k * c * d;
    dz += 0.3 * a * d.y * c;             // Gerstner horizontal displacement (material points bunch at crests)
    smax += a * k;
  }
}`;

// ------------------------------------------------------------------ engraved ocean
const FS_ENGRAVED = frag(SEA_LIB + SWELL + `
uniform float uSpacing, uAmp, uMotion, uFallbackAA, uLift, uWidth, uStarsI, uShieldK, uAlpha, uHazeI;
uniform vec3 uMist, uSkyTop, uSkyHz;
uniform vec3 uRamp[5];   // line colour ramp: far, dim, near, bright, hot (scene linear, from display hexes)
uniform float uTnear, uTfar;
uniform vec4 uLights[8]; uniform int uNL;
uniform mat3 uPrevM; uniform vec3 uPrevP; uniform int uHasPrev;
uniform sampler2D uSky; uniform int uHasSky;
uniform sampler2D uShield; uniform int uHasShield;
out vec4 o;

vec3 rampCol(float t){ t = clamp(t, 0.0, 1.0) * 4.0; int i = int(min(floor(t), 3.0)); return mix(uRamp[i], uRamp[i + 1], t - float(i)); }
float lineInt(float x, float w){ float fl = floor(x); return fl * 2.0 * w + clamp(x - fl - (0.5 - w), 0.0, 2.0 * w); }
float hatch(float z, float w, float b){
  float base = floor(z); float zz = z - base;
  b = max(b, 1e-3);
  return (lineInt(zz + 0.5 * b, w) - lineInt(zz - 0.5 * b, w)) / b;
}
vec3 skyOf(vec3 rd, vec2 px){
  vec3 c;
  if (uHasSky == 1) c = texture(uSky, pxToUV(px)).rgb;
  else c = mix(uSkyHz, uSkyTop, smoothstep(0.0, 0.35, max(rd.y, 0.0)));
  return c;
}
void main(){
  vec2 px = framePx();
  vec3 rd = camRayL(px);
  vec3 rdx = camRayL(px + vec2(1.0, 0.0)), rdy = camRayL(px + vec2(0.0, 1.0));
  float fwy = abs(rdx.y - rd.y) + abs(rdy.y - rd.y);
  float hzCov = smoothstep(-0.5, 0.5, -rd.y / max(fwy, 1e-7));     // sea coverage of this pixel (AA horizon)
  float hzBand = exp(-abs(rd.y) / 0.018);
  vec3 sky = vec3(0.0);
  if (hzCov < 1.0){ sky = skyOf(rd, px); sky = mix(sky, uMist, hzBand * 0.55 * uHazeI); }
  if (hzCov <= 0.0){ o = vec4(sky * uAlpha, uAlpha); return; }

  vec2 xz = seaHit(rd);
  vec2 xzx = seaHit(rdx), xzy = seaHit(rdy);
  float d = uCamP.y / max(-rd.y, 1e-5);
  float fpz = max(abs(xzx.y - xz.y), abs(xzy.y - xz.y));
  float hy = hzY(px.x);
  float below = max(px.y - hy, 0.0);
  float span = max(uFrame.y - hy, 1.0);
  float nearS = clamp(below / span, 0.0, 1.0);
  // hatch level of detail from the flat plane: world-anchored lines, every other line fades out where they would
  // crowd closer than the target spacing (level L+1 lines are a subset of level L: seamless, drifts with the world)
  float fwP = (abs(xzx.y - xz.y) + abs(xzy.y - xz.y)) / uSpacing;
  float T = mix(uTfar, uTnear, smoothstep(0.0, 1.0, nearS));       // target line spacing in px
  float Lc = max(log2(max(T * fwP, 1e-6)), 0.0);
  float Lf = floor(Lc), fr = smoothstep(0.0, 1.0, Lc - Lf);
  float s0 = exp2(Lf);
  // the swell, with waves shorter than about two line spacings filtered out (lines follow the swell, never wiggle)
  float h; vec2 g; float dzG, smax;
  swell(xz, uTau, uAmp, fpz, 2.2 * s0 * uSpacing, h, g, dzG, smax);
  // line coordinate: world z + Gerstner bunching + height lift (spec: z + h*1.6), in units of the spacing.
  // The lift is limited by the steepest slope present so that lines never fold over each other (an engraver's
  // lines never cross).
  float lift = min(uLift, max(0.82 / max(smax, 1e-4) - 0.3, 0.0));
  vec2 gz = (vec2(0.0, 1.0) + lift * g) / uSpacing;                // d(line coord)/d(xz), first order
  float z = (xz.y - dzG + h * lift) / uSpacing;
  float fw = abs(dot(gz, xzx - xz)) + abs(dot(gz, xzy - xz));      // footprint of one pixel in line units
  float mot = 0.0;
  if (uHasPrev == 1){
    vec3 rp = normalize(uPrevM * vec3((px.x - uFrame.x * 0.5) / uF, (uFrame.y * 0.5 - px.y) / uF, 1.0));
    vec2 xp = uPrevP.xz + rp.xz * (uPrevP.y / max(-rp.y, 1e-5));
    mot = abs(dot(gz, xz - xp)) * uMotion;                         // line units swept during the shutter
  }
  float b = fw * (1.0 + uFallbackAA) + mot;

  // tone: crest steepness thickens the line (engraved swell), a sheen term toward the horizon glow brightens it
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 R = reflect(rd, N);
  float steep = clamp(length(g) * 2.0, 0.0, 1.0);
  float crest = clamp(h / max(uAmp, 1e-3) * 0.9 + 0.5, 0.0, 1.0);
  float sheen = clamp(0.45 + 3.0 * (R.y + rd.y), 0.0, 1.0);          // slopes tilted toward the viewer catch the sky
  float fd = clamp(d / (uCamP.y * 28.0), 0.0, 1.0);                // aerial perspective, relative to the camera height
  float nearK = 1.0 - fd;
  float u0 = z / s0 + 0.5;
  float lineId = floor(u0) * s0;                                   // world-stable id of the nearest line

  // reflection columns: horizon lights (reach 1) and vertical sources unrolling toward the camera
  float colI = 0.0;
  for (int i = 0; i < 8; i++){
    if (i >= uNL) break;
    vec4 L = uLights[i];
    float wid = L.w * (0.45 + 1.1 * nearS);                        // columns widen toward the camera
    float sx = L.x - g.x * 12.0 * (0.3 + 0.7 * nearS);            // shimmer with the wave normal
    float reachPx = L.z * span;
    float front = 1.0 - smoothstep(reachPx - 40.0, reachPx + 4.0, below);
    float glit = 0.55 + 0.9 * clamp(0.5 + 1.6 * dot(g, vec2(clamp((px.x - sx) / max(wid, 1.0), -1.0, 1.0), 0.6)), 0.0, 1.0);
    float hl = h11(lineId * 1.37 + float(i) * 17.0);
    float dash = 0.5 + 1.4 * hl;                                    // each line catches a different length...
    float dxl = (px.x - sx - (h11(lineId * 2.11 + float(i) * 5.0) - 0.5) * wid * 0.9) / max(wid * dash, 1.0);  // ...off centre
    colI += L.y * exp(-dxl * dxl) * front * glit * (0.35 + 0.65 * sqrt(nearS));
  }
  colI = min(colI, 2.5);

  float spx = s0 / max(fw, 1e-6);                                  // px between level-Lf lines
  float wpx = (0.05 + 0.12 * steep * crest + 0.05 * crest) * T * uWidth + 0.45 * clamp(colI, 0.0, 1.5);
  // lines swell on crests but never merge (at most about 60% of the spacing is ink, like a burin's cut)
  float ink0 = hatch(u0, clamp(wpx / spx, 0.015, 0.3), b / s0);
  float ink1 = hatch(u0 * 0.5 + 0.25, clamp(wpx / (2.0 * spx), 0.015, 0.3), b / (2.0 * s0));
  float ink = mix(ink0, ink1, fr);
  // a burin's pressure: a slow variation along each line (world x), different per line
  ink *= 0.86 + 0.14 * sin(xz.x * 0.21 / s0 + h11(lineId * 0.71) * 6.283);
  ink *= 1.0 - smoothstep(0.5, 1.2, b / (s0 * 2.0));               // when motion smears lines together, become tone

  float tone = (0.38 + 0.42 * sheen + 0.12 * crest) * mix(0.5, 1.0, pow(nearK, 1.2)) + 0.55 * colI;
  vec3 line = rampCol(tone) * (1.0 + 1.6 * max(colI - 0.4, 0.0) * (0.4 + 0.6 * nearS));
  vec3 mist = uMist * (0.85 + 0.25 * fd);
  vec3 c = mix(mist, line, ink);
  c = mix(c, uMist, smoothstep(0.55, 1.0, fd) * 0.4);
  c = mix(c, uMist * 1.15, hzBand * 0.5 * uHazeI);
  if (uHasShield == 1) c *= 1.0 - uShieldK * texture(uShield, pxToUV(px)).a;
  c = mix(sky, c, hzCov);
  o = vec4(c * uAlpha, uAlpha);
}`);

// ------------------------------------------------------------------ rendered analytic sea
const NWAVE = 12;
const WAVES = `
uniform float uDrag;
uniform vec4 uWv[12];    // dir.x, dir.y, k (rad/m), omega (rad/s)
uniform vec2 uWa[12];    // amplitude weight, phase
// 16 exp-sine waves with domain drag (precomputed directions and dispersion); returns the height gradient.
// var = slope variance filtered out by the pixel footprint, curv = curvature bound (for the star blur)
vec2 seaGrad(vec2 xz, float t, float amp, float fp, out float var, out float curv){
  vec2 g = vec2(0.0); var = 0.0; curv = 0.0;
  vec2 p = xz;
  float A = amp * 0.21;
  for (int i = 0; i < 12; i++){
    vec4 wv = uWv[i];
    float k = wv.z;
    float a = A * uWa[i].x;
    float ak = a * k;
    float filt = smoothstep(2.0, 6.0, (TAU / k) / fp);
    if (filt <= 0.0){ var += ak * ak * 0.3 * 9.0; break; }           // the rest of the spectrum, summed
    float x = k * dot(wv.xy, p) - wv.w * t + uWa[i].y;
    float sx = sin(x);
    float e = 0.25 * (1.0 + sx) * (1.0 + sx);          // peaked crests, broad troughs (cheap stand-in for exp(sin-1))
    float dx = 0.5 * (1.0 + sx) * cos(x);
    g += wv.xy * (ak * dx * filt);
    p -= wv.xy * (dx * a * uDrag * filt);
    var += ak * ak * 0.3 * (1.0 - filt * filt);
    curv += ak * k * filt;
  }
  return g;
}`;

const FS_RENDERED = frag(SEA_LIB + WAVES + `
uniform float uAmp, uFog, uStarsI, uSunSpec, uReflect, uAlpha, uRegion;
uniform vec3 uDeep, uHazeCol, uTop, uMid, uHz; uniform float uHazeI, uHazeW;
uniform sampler2D uSky; uniform int uHasSky;
uniform sampler2D uMirror; uniform int uHasMirror;
uniform vec4 uGlint;      // I, half width px, rate Hz, exponent
uniform float uSunOn;
out vec4 o;

vec3 skyGrad(vec3 rd){
  float e = max(rd.y, 0.0);
  vec3 c = mix(uHz, uMid, 1.0 - exp(-e / 0.06));
  return mix(c, uTop, smoothstep(0.05, 0.75, e));
}
vec3 skyTex(vec2 px, vec3 rd){ return uHasSky == 1 ? texture(uSky, pxToUV(px)).rgb : skyGrad(abs(rd)); }
vec3 skyTexSharp(vec2 px, vec3 rd){ return skyTex(px, rd); }   // uSky is the half-res Catmull-Rom upsample
float ggxD(float NoH, float a2){ float d = NoH * NoH * (a2 - 1.0) + 1.0; return a2 / (PI * d * d); }

void main(){
  vec2 px = framePx();
  vec3 rd = camRayL(px);
  vec3 rdx = camRayL(px + vec2(1.0, 0.0)), rdy = camRayL(px + vec2(0.0, 1.0));
  float fwy = abs(rdx.y - rd.y) + abs(rdy.y - rd.y);
  float hzCov = smoothstep(-0.5, 0.5, -rd.y / max(fwy, 1e-7));
  float haze = uHazeI * exp(-abs(rd.y) / uHazeW);
  vec3 sky = vec3(0.0);
  if (hzCov < 1.0){
    sky = skyTexSharp(px, rd);
    if (uSunOn > 0.0) sky += sunDisc(rd);
    sky += uHazeCol * haze;
  }
  if (hzCov <= 0.0){
    if (uRegion > 0.5) discard;
    o = vec4(sky * uAlpha, uAlpha); return;
  }
  vec2 xz = seaHit(rd);
  vec2 xzx = seaHit(rdx), xzy = seaHit(rdy);
  float d = uCamP.y / max(-rd.y, 1e-5);
  float fp = max(length(xzx - xz), length(xzy - xz));
  float var, curv;
  vec2 g = seaGrad(xz, uTau, uAmp, fp, var, curv);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 V = -rd;
  float NoV = max(dot(N, V), 1e-3);
  vec3 r = reflect(rd, N);
  r.y = max(r.y, 2e-4);
  r = normalize(r);
  float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);

  vec3 refl;
  if (uHasMirror == 1){
    refl = texture(uMirror, clamp(pxToUV(camProject(r)), vec2(0.0), vec2(1.0))).rgb;
  } else {
    vec2 q = camProject(vec3(r.x, -r.y, r.z));                    // the mirrored half of the sky texture
    refl = skyTex(q, r);
    refl += uHazeCol * uHazeI * exp(-r.y / uHazeW);
  }
  // the sun on the water: GGX with the filtered slope variance and the sun disc folded into the roughness
  vec3 spec = vec3(0.0);
  if (uSunOn > 0.0){
    vec3 Hh = normalize(uSun.xyz + V);
    float a2 = 0.00025 + 2.0 * var + min(uSun.w * uSun.w, 0.0001);
    float NoH = max(dot(N, Hh), 0.0);
    float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(V, Hh), 0.0), 5.0);
    float vis = smoothstep(-0.02, 0.01, uSun.y);
    spec = uSunCol * (Fs * ggxD(NoH, a2) * uSunSpec * 0.0005 / (4.0 * NoV)) * vis;
    if (uGlint.x > 0.0){
      // hashed glints in a column under the sun, deterministic flicker at uGlint.z Hz
      vec2 sp = camProject(uSun.xyz);
      float hw = uGlint.y * (0.6 + 0.8 * clamp((px.y - hzY(px.x)) / max(uFrame.y - hzY(px.x), 1.0), 0.0, 1.0));
      float colm = exp(-0.5 * pow((px.x - sp.x) / hw, 2.0));
      vec2 cell = floor(px / vec2(4.0, 3.0));
      vec2 hv = h22(cell + vec2(floor(uTau * uGlint.z) * 37.0, 11.0));
      vec2 cc = (cell + 0.25 + 0.5 * hv) * vec2(4.0, 3.0);
      float pt = exp(-dot(px - cc, px - cc) / 1.1);
      float gate = pow(NoH, uGlint.w);
      spec += uSunCol * (uGlint.x * 0.02) * colm * step(0.86, fract(hv.x * 7.31 + hv.y)) * pt * (0.25 + gate * 4.0);
    }
  }
  refl = refl * uReflect + spec;
  vec3 body = uDeep * (1.0 + 0.6 * max(N.x * 0.3 + 0.7, 0.0));
  vec3 c = mix(body, refl, F) + spec * (1.0 - F);
  // horizon haze: distance fog toward the mirrored horizon sky
  float fogK = 1.0 - exp(-d * uFog);
  vec3 fogC = (uHasMirror == 1 || uHasSky == 0 ? refl : texture(uSky, pxToUV(vec2(px.x, hzY(px.x) + 2.0))).rgb) + uHazeCol * uHazeI;
  c = mix(c, fogC, fogK * 0.85);
  c += uHazeCol * haze * 0.6;
  c = mix(sky, c, hzCov);
  o = vec4(c * uAlpha, uAlpha);
}`);

// ------------------------------------------------------------------ quarter-res sky
const FS_SKY = frag(SEA_LIB + `
uniform vec3 uTop, uMid, uHz, uHazeCol, uGlowCol; uniform float uHazeI, uHazeW, uGlowW, uGlowH, uMilky, uHaloB, uBand;
out vec4 o;
void main(){
  vec2 px = framePx();
  vec3 rd = camRayL(px);
  rd.y = abs(rd.y);                                   // below the horizon: the sky seen in the mirror direction
  float e = asin(clamp(rd.y, 0.0, 1.0));
  vec3 c = mix(uHz, uMid, 1.0 - exp(-e / uBand));
  c = mix(c, uTop, smoothstep(uBand, 0.75, e));
  c += uHazeCol * uHazeI * exp(-e / uHazeW) * 0.5;
  // warm band around the sun azimuth (dawn / dusk)
  vec2 hs = normalize(uSun.xz + vec2(1e-6)), hr = normalize(rd.xz + vec2(1e-6));
  float az = acos(clamp(dot(hs, hr), -1.0, 1.0));
  c += uGlowCol * exp(-az / uGlowW) * exp(-e / uGlowH);
  // broad Mie halo (cookbook term .02/(1.0001-cos)), bounded
  float ca = dot(rd, uSun.xyz);
  c += uSunHaloCol * uHaloB * min(0.02 / (1.0001 - ca), 6.0) * 0.02;
  // a faint milky band, tilted across the sky
  if (uMilky > 0.0){
    vec3 nm = normalize(vec3(0.55, 0.35, -0.76));
    float db = dot(rd, nm);
    vec3 q = rd * 6.0;
    float cl = fbm(q.xy * 1.3 + q.z * 0.7, 4);
    float lane = smoothstep(0.35, 0.75, fbm(q.zx * 2.1 + 5.0, 3));
    c += vec3(0.55, 0.62, 0.8) * uMilky * exp(-db * db / 0.018) * (0.35 + 0.9 * cl) * (1.0 - 0.6 * lane) * smoothstep(0.02, 0.25, e);
  }
  o = vec4(c, 1.0);
}`);

// ------------------------------------------------------------------ aurora (quarter res, additive into the sky)
const FS_AURORA = frag(SEA_LIB + `
uniform float uI, uSpeed, uReveal, uTopAmt, uDesat, uScaleZ, uScaleX;
uniform vec3 uA0, uA1, uA2;
uniform mat2 uRotT;     // rotation by tau*speed (hoisted)
out vec4 o;
const mat2 M2 = mat2(0.95534, 0.29552, -0.29552, 0.95534);
float tri(float x){ float t = abs(fract(x) - 0.5); float r = max(0.04 - t, 0.0); return clamp(t + r * r * 12.5, 0.01, 0.49); }   // rounded valley: no straight creases
vec2 tri2(vec2 p){ return vec2(tri(p.x) + tri(p.y), tri(p.y + tri(p.x))); }
float triNoise2d(vec2 p){
  float z = 1.8, z2 = 2.5, rz = 0.0;
  float a = p.x * 0.06; float ca = cos(a), sa = sin(a);
  p = mat2(ca, sa, -sa, ca) * p;
  vec2 bp = p;
  for (int i = 0; i < 5; i++){
    vec2 dg = tri2(bp * 1.85) * 0.75;
    dg = uRotT * dg;
    p -= dg / z2;
    bp *= 1.3; z2 *= 0.45; z *= 0.42;
    p *= 1.21 + (rz - 1.0) * 0.02;
    rz += tri(p.x + tri(p.y)) * z;
    p = -(M2 * p);
  }
  return clamp(1.0 / pow(rz * 29.0, 1.3), 0.0, 0.55);
}
void main(){
  // rendered at W/4 x H/8 (the curtains' detail is horizontal; vertically they are smooth), so pixel coordinates are
  // derived from the target size rather than uScale
  vec2 px = vec2(gl_FragCoord.x / uRes.x * uFrame.x, (1.0 - gl_FragCoord.y / uRes.y) * uFrame.y);
  vec3 rd = camRayL(px);
  rd.y = abs(rd.y);
  vec3 ro = vec3(0.0, 0.0, -6.7);
  vec3 col = vec3(0.0); vec3 avg = vec3(0.0); float acc = 0.0;
  float dith = h12(gl_FragCoord.xy);                   // fixed in space: no shimmer between frames
  // large-scale envelope from the curtains' footprint: a few arcs with dark sky between them
  float pt0 = (0.8 - ro.y) / (rd.y * 2.0 + 0.4);
  vec2 p0 = (ro + pt0 * rd).zx * vec2(uScaleZ, uScaleX);
  float arcs = smoothstep(0.42, 0.7, fbm(p0 * vec2(0.55, 0.18) + vec2(3.7, uTau * 0.004), 3));
  float sxr = px.x / uFrame.x;
  float frontE = smoothstep(uReveal * 1.5 - 0.35, uReveal * 1.5 - 0.05, sxr + 0.25 * (1.0 - rd.y * 2.0));
  if (arcs < 0.002 || frontE > 0.999){ o = vec4(0.0); return; }   // dark sky between the arcs: nothing to add
  // the curtains' lower border undulates (never a ruler-straight bottom edge)
  float az = rd.x / max(rd.z, 0.2);
  float base = 0.8 + 0.09 * sin(az * 6.0 + uTau * 0.04) + 0.05 * sin(az * 15.0 + 1.3 - uTau * 0.03);
  for (int i = 0; i < 40; i++){
    float fi = float(i) * 1.25;                        // 40 layers spanning the recipe's 50
    float of = 0.003 * dith * smoothstep(0.0, 15.0, fi);
    float pt = ((base + pow(fi, 1.4) * 0.002) - ro.y) / (rd.y * 2.0 + 0.4) - of;
    vec2 p = (ro + pt * rd).zx * vec2(uScaleZ, uScaleX);
    p.x += 0.22 * sin(p.y * 1.3 + 0.7) + 0.1 * sin(p.y * 3.1);   // bend the folds: no straight noise creases
    float rzt = triNoise2d(p);
    rzt *= smoothstep(0.035, 0.15, rzt);                        // soft floor: dark sky between the folds
    float u = fi / 50.0;
    vec3 pal = mix(uA0, uA1, smoothstep(0.0, 0.45, u));
    pal = mix(pal, uA2 * uTopAmt * 1.3, smoothstep(0.45, 1.0, u));
    vec3 c2 = pal * rzt;
    avg = mix(avg, c2, 0.5);
    col += avg * exp2(-fi * 0.065 - 2.5) * smoothstep(0.0, 2.5, fi);
  }
  col *= clamp(rd.y * 15.0 + 0.4, 0.0, 1.0);
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  col = mix(vec3(l), col, 1.0 - uDesat);
  // unfold: a soft front sweeping across (left to right) and down the curtains
  float sx = px.x / uFrame.x;
  float front = smoothstep(uReveal * 1.5 - 0.35, uReveal * 1.5 - 0.05, sx + 0.25 * (1.0 - rd.y * 2.0));
  float grow = smoothstep(0.0, 0.25, uReveal);
  o = vec4(col * 2.9 * uI * (1.0 - front) * grow * arcs, 0.0);
}`);

// ------------------------------------------------------------------ sky only (full res)
const FS_SKYDRAW = frag(SEA_LIB + `
uniform sampler2D uSky; uniform int uHasSky; uniform float uStarsI, uAlpha, uSunOn, uHazeI, uHazeW;
uniform vec3 uTop, uMid, uHz, uHazeCol;
out vec4 o;
void main(){
  vec2 px = framePx();
  vec3 rd = camRayL(px);
  vec3 c;
  if (uHasSky == 1) c = texture(uSky, pxToUV(px)).rgb;
  else { float e = abs(rd.y); c = mix(uHz, uMid, 1.0 - exp(-e / 0.06)); c = mix(c, uTop, smoothstep(0.05, 0.75, e)); }
  if (uSunOn > 0.0) c += sunDisc(rd);
  c += uHazeCol * uHazeI * exp(-abs(rd.y) / uHazeW);
  o = vec4(c * uAlpha, uAlpha);
}`);

// ------------------------------------------------------------------ god rays
const FS_GR_SRC = frag(SEA_LIB + `
uniform vec2 uSunPx; uniform float uSpread, uMistK; uniform vec3 uRayCol;
out vec4 o;
void main(){
  vec2 px = framePx();
  vec3 rd = camRayL(px);
  float ang = sqrt(max(2.0 * (1.0 - dot(rd, uSun.xyz)), 0.0));
  float glow = exp(-ang / uSpread) + 1.5 * exp(-ang / (uSun.w * 2.0 + 0.002));
  // occluders: clumps of sea mist everywhere (slightly stretched along the horizon, drifting slowly); the gaps between
  // them let the light through, so the radial blur turns them into shafts in every direction
  vec2 rel = (px - uSunPx) / uFrame.y;
  vec2 q = vec2(rel.x * 11.0 + uTau * 0.03, rel.y * 18.0 + uTau * 0.006) + 7.3;
  float m = fbm(q, 4);
  float occ = mix(1.0, smoothstep(0.42, 0.6, m), uMistK);
  o = vec4(uRayCol * glow * occ, 1.0);
}`);
const FS_GR_BLUR = frag(SEA_LIB + `
uniform sampler2D uSrc; uniform vec2 uSunPx; uniform float uDensity, uDecay, uMistK;
out vec4 o;
void main(){
  vec2 px = framePx();
  vec2 uv = screenUV();
  vec2 suv = pxToUV(uSunPx);
  vec2 dl = (uv - suv) * (uDensity / 48.0);
  float dith = h12(gl_FragCoord.xy * 1.7);            // fixed spatial jitter of the march start
  uv -= dl * dith;
  vec3 acc = vec3(0.0); float ill = 1.0, wsum = 0.0;
  for (int i = 0; i < 48; i++){
    acc += texture(uSrc, uv).rgb * ill;
    wsum += ill;
    ill *= uDecay; uv -= dl;
  }
  acc /= wsum;
  // mist modulation: the shafts show where there is mist to scatter them
  vec2 q = vec2(px.x / uFrame.y * 1.6 - uTau * 0.015, px.y / uFrame.y * 3.0);
  float mist = 0.55 + 0.9 * fbm(q, 3);
  // the shafts live in the low air over the water: strongest around the horizon, fanning toward the camera
  float hy = hzY(px.x);
  float wy = px.y > hy ? exp(-(px.y - hy) / (uFrame.y * 0.45)) : exp(-(hy - px.y) / (uFrame.y * 0.22));
  o = vec4(acc * mix(1.0, mist, uMistK) * wy, 1.0);
}`);
const FS_UPCR = frag(SEA_LIB + `
uniform sampler2D uSrc;
out vec4 o;
void main(){ o = texCR(uSrc, screenUV()); }`);
const FS_COPY = frag(`
uniform sampler2D uSrc;
out vec4 o;
void main(){ o = vec4(texture(uSrc, screenUV()).rgb, 0.0); }`);
const FS_UPADD = frag(SEA_LIB + `
uniform sampler2D uSrc; uniform float uK;
out vec4 o;
void main(){ o = vec4(texture(uSrc, screenUV()).rgb * uK, 0.0); }`);

// ------------------------------------------------------------------ glitter sprites
const VS_GLITTER = HEADER_VS + SEA_LIB + WAVES + `
uniform float uAmp, uCount, uOpen, uI, uHW0, uHWK, uExp;
uniform vec4 uBurst[8];     // tau of the burst, vel, -, -
uniform vec3 uGCol;
out vec4 vCol; out float vSize;
float hh(uint a, uint b, uint c){ uvec3 v = pcg3d(uvec3(a, b, c)); return float(v.x) * (1.0 / 4294967296.0); }
void main(){
  int id = gl_VertexID;
  int cnt = int(uCount);
  vec2 sp = camProject(uSun.xyz);
  float env, bright, life;
  uint seedA, seedB;
  if (id < cnt){
    float per = 0.35 + 0.75 * hh(uint(id), 7u, 1u);
    float ph = hh(uint(id), 9u, 2u) * per;
    float cyc = floor((uTau + ph) / per);
    float fr = fract((uTau + ph) / per);
    env = pow(sin(PI * fr), 2.0);
    bright = 1.0; seedA = uint(id); seedB = uint(int(cyc) + 100000);
  } else {
    int k = id - cnt; int slot = k / 40;
    vec4 B = uBurst[slot];
    float dt = uTau - B.x;
    if (B.x < -1e5 || dt < 0.0 || dt > 0.15){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 1.0; vCol = vec4(0.0); vSize = 1.0; return; }
    env = pow(1.0 - dt / 0.15, 1.5) * smoothstep(0.0, 0.02, dt);
    bright = 2.6 * (0.6 + B.y); seedA = uint(k + 77777); seedB = uint(int(B.x * 1000.0) + 13);
  }
  // position on the path (frame space), then cast onto the sea
  float u1 = hh(seedA, seedB, 3u), u2 = hh(seedA, seedB, 4u), u3 = hh(seedA, seedB, 5u);
  float hzv = hzY(sp.x);
  float span = uFrame.y - hzv;
  float yv = pow(u1, 1.35);
  float y = hzv + 1.5 + span * yv;
  float hw = uHW0 * uFrame.x + uHWK * (y - hzv);
  float x = sp.x + hw * (u2 + u3 - 1.0) * 1.2;
  float openK = 1.0 - smoothstep(uOpen - 0.08, uOpen, yv);
  vec3 rd = camRayL(vec2(x, y));
  vec2 xz = seaHit(rd);
  float dd = uCamP.y / max(-rd.y, 1e-5);
  float fp = dd / (uF * max(-rd.y, 0.02));
  float var, curv;
  vec2 g = seaGrad(xz, uTau, uAmp, max(fp, 1e-4) * 0.6, var, curv);
  vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 Hh = normalize(uSun.xyz - rd);
  float gate = pow(max(dot(N, Hh), 0.0), uExp);
  gate = smoothstep(0.02, 0.6, gate);
  float a = env * bright * gate * openK * smoothstep(-0.02, 0.01, uSun.y);
  float sz = (1.2 + 2.6 * yv) * (bright > 1.5 ? 1.4 : 1.0);
  vCol = vec4(uGCol * uI * a, 1.0);
  vSize = sz * uScale;
  gl_Position = a <= 1e-4 ? vec4(2.0, 2.0, 2.0, 1.0) : clipOfPx(vec2(x, y));
  gl_PointSize = vSize * 4.0 + 2.0;
}`;
const FS_GLITTER = frag(`
in vec4 vCol; in float vSize;
out vec4 o;
void main(){
  vec2 q = (gl_PointCoord * 2.0 - 1.0) * (vSize * 2.0 + 1.0);   // in px from the centre
  float core = exp(-dot(q, q) / max(vSize * vSize * 0.35, 0.5));
  float sx = exp(-abs(q.y) * 1.6) * exp(-abs(q.x) / (vSize * 0.9)), sy = exp(-abs(q.x) * 1.6) * exp(-abs(q.y) / (vSize * 0.9));
  o = vec4(vCol.rgb * (core + 0.35 * (sx + sy)), 0.0);
}`);

// ------------------------------------------------------------------ stars (sprites: a seeded catalogue on the sphere)
// Drawn as additive points: direct (above the horizon) and, for the rendered sea, reflected through the same waves:
// each reflected star is moved by the local wave normal and stretched by the slope spread, weighted by Fresnel.
const VS_STARS = HEADER_VS + SEA_LIB + WAVES + `
uniform sampler2D uCat;        // RGBA32F: dir.xyz, packed (size, bright)
uniform sampler2D uCat2;       // RGBA32F: colour rgb, twinkle phase
uniform float uI, uRefl, uAmp, uDimHz;
uniform mat3 uPrevM; uniform int uHasPrev; uniform float uShutter;
out vec4 vCol; out vec2 vSig; out vec2 vLoc; out float vLen;
void cull(){ gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vCol = vec4(0.0); vSig = vec2(1.0); vLoc = vec2(0.0); vLen = 0.0; }
vec2 projPrev(vec3 d){
  vec3 l = transpose(uPrevM) * d; l.z = max(l.z, 1e-4);
  return vec2(uFrame.x * 0.5 + uF * l.x / l.z, uFrame.y * 0.5 - uF * l.y / l.z);
}
void main(){
  int id = gl_VertexID / 6, corner = gl_VertexID % 6;
  vec2 cq = corner == 0 ? vec2(-1, -1) : corner == 1 || corner == 4 ? vec2(1, -1) : corner == 2 || corner == 3 ? vec2(-1, 1) : vec2(1, 1);
  vec4 a = texelFetch(uCat, ivec2(id % 1024, id / 1024), 0);
  vec4 b = texelFetch(uCat2, ivec2(id % 1024, id / 1024), 0);
  vec3 dir = a.xyz;
  float r = floor(a.w) / 100.0, br = fract(a.w) * 4.0;
  vec3 l = transpose(uCamM) * dir;
  if (l.z < 0.05){ cull(); return; }
  float sig = max(r * 0.55, 0.62);
  float tw = 1.0 + 0.12 * sin(TAU * (0.3 * uTau + b.w));
  vec2 P, Pp;
  vec2 sg = vec2(sig);
  float k = br * tw * uI;
  if (uRefl < 0.5){
    P = camProject(dir);
    Pp = uHasPrev == 1 ? mix(P, projPrev(dir), uShutter) : P;    // the streak swept during the shutter
    k *= smoothstep(-0.005, 0.03, dir.y) * mix(1.0, smoothstep(0.0, 0.12, dir.y), uDimHz);
  } else {
    vec3 m = vec3(dir.x, -dir.y, dir.z);
    vec3 lm = transpose(uCamM) * m;
    if (lm.z < 0.05 || dir.y < 0.0){ cull(); return; }
    vec2 P0 = camProject(m);
    vec3 rd = m;
    vec2 xz = seaHit(rd);
    float d = uCamP.y / max(-rd.y, 1e-5);
    float fp = d / (uF * max(-rd.y, 0.02));
    float var, curv;
    vec2 g = seaGrad(xz, uTau, uAmp, max(fp, 1e-4), var, curv);
    vec3 N = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 r0 = reflect(rd, N); r0.y = max(r0.y, 1e-4);
    P = 2.0 * P0 - camProject(vec3(r0.x, -r0.y, r0.z));
    Pp = P;
    float NoV = max(dot(N, -rd), 1e-3);
    float F = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
    float spread = (2.0 * curv * fp + 2.0 * sqrt(var)) * uF;
    k *= 1.0 / (1.0 + spread * spread * 0.002);            // strongly spread reflections dissolve into the shimmer
    spread = min(spread, 10.0);
    sg = vec2(sqrt(sig * sig + 0.08 * spread * spread), sqrt(sig * sig + spread * spread));
    k *= F * smoothstep(-0.005, 0.03, dir.y) * smoothstep(-2.0, 2.0, P.y - (uHzLine.x + uHzLine.y * P.x));
  }
  vec2 mv = P - Pp;
  float len = length(mv);
  float amp = sig * sig / (sg.x * sg.y);
  amp *= (2.5066 * sg.x) / (len + 2.5066 * sg.x);           // energy spread along the streak
  vCol = vec4(b.rgb * k * amp, 1.0);
  if (vCol.r + vCol.g + vCol.b < 2e-3){ cull(); return; }
  vec2 ax = len > 1e-3 ? mv / len : vec2(1.0, 0.0);
  vec2 ay = vec2(-ax.y, ax.x);
  float ext = 3.2 * max(sg.x, sg.y) + 1.0;
  vec2 hl = vec2(0.5 * len + ext, ext);
  vLoc = cq * hl;                                           // px in the streak frame, origin at the midpoint
  vLen = 0.5 * len;
  vSig = len > 1e-3 ? vec2(sg.x) : sg;
  vec2 c = 0.5 * (P + Pp) + ax * vLoc.x + ay * vLoc.y;
  if (len <= 1e-3) { c = P + vLoc; }
  gl_Position = clipOfPx(c);
}`;
const FS_STARS = frag(`
in vec4 vCol; in vec2 vSig; in vec2 vLoc; in float vLen;
out vec4 o;
void main(){
  vec2 q = vec2(max(abs(vLoc.x) - vLen, 0.0), vLoc.y);     // distance to the streak segment
  o = vec4(vCol.rgb * exp(-0.5 * dot(q / vSig, q / vSig)), 0.0);
}`);

// ------------------------------------------------------------------ sun flare (diffraction star + streak)
const FS_FLARE = frag(`
uniform vec2 uC; uniform float uI, uLen, uRays, uAng, uStreak, uSLen; uniform vec3 uCol, uSCol;
out vec4 o;
void main(){
  vec2 q = framePx() - uC;
  float r = length(q);
  float a = atan(q.y, q.x) - uAng;
  float seg = TAU / uRays;
  float da = a - seg * floor(a / seg + 0.5);
  float perp = abs(sin(da)) * r;
  float fall = pow(clamp(1.0 - r / uLen, 0.0, 1.0), 2.2);
  float wdt = 0.9 + r * 0.004;
  float ray = exp(-perp * perp / (2.0 * wdt * wdt)) * fall * smoothstep(2.0, 10.0, r);
  vec3 c = uCol * uI * ray;
  if (uStreak > 0.0){
    float s = exp(-q.y * q.y / 3.0) * pow(clamp(1.0 - abs(q.x) / (uSLen * 0.5), 0.0, 1.0), 1.6);
    c += uSCol * uStreak * s;
  }
  o = vec4(c, 0.0);
}`);

// ------------------------------------------------------------------ JS side
function waveTables(k0) {
  const wv = new Float32Array(NWAVE * 4), wa = new Float32Array(NWAVE * 2);
  let k = k0, w = 1, it = 0;
  for (let i = 0; i < NWAVE; i++) {
    wv.set([Math.sin(it), Math.cos(it), k, Math.sqrt(9.81 * k)], i * 4);
    wa.set([w, it % (2 * Math.PI)], i * 2);
    w *= 0.74; k *= 1.36; it += 1232.399963;
  }
  return { uWv: wv, uWa: wa };
}

export function createSea(G) {
  const P = {
    engraved: G.program('sea.engraved', FS_ENGRAVED), rendered: G.program('sea.rendered', FS_RENDERED),
    sky: G.program('sea.sky', FS_SKY), aurora: G.program('sea.aurora', FS_AURORA), skyDraw: G.program('sea.skydraw', FS_SKYDRAW),
    grSrc: G.program('sea.gr.src', FS_GR_SRC), grBlur: G.program('sea.gr.blur', FS_GR_BLUR), upAdd: G.program('sea.upadd', FS_UPADD), upCR: G.program('sea.upcr', FS_UPCR), copyAdd: G.program('sea.copyadd', FS_COPY),
    glitter: G.program('sea.glitter', FS_GLITTER, VS_GLITTER), flare: G.program('sea.flare', FS_FLARE),
    stars: G.program('sea.stars', FS_STARS, VS_STARS),
  };
  const W = G.W, H = G.H;
  const STAR = {};
  // seeded star catalogue over the upper hemisphere (and a little below the horizon): about 1,400 per frame-sized
  // patch of sky at fovY 0.6 (the scene-1 density), radius 0.6-2.2 px, colours #EAF2FF / #BFD3FF / #FFE7A3,
  // plus a sparse bright layer
  const CAT = (() => {
    const rnd = mulberry32(0x5EA57A);
    const n = 15000, nb = 700, N = n + nb;
    const A = new Float32Array(1024 * Math.ceil(N / 1024) * 4), B = new Float32Array(A.length);
    const cols = ['#EAF2FF', '#BFD3FF', '#FFE7A3'].map(hexLin);
    for (let i = 0; i < N; i++) {
      const bright = i >= n;
      const u = rnd(), v = rnd();
      const y = -0.03 + 1.03 * u;                 // uniform on the sphere cap above y = -0.03
      const ph = 2 * Math.PI * v, rr = Math.sqrt(Math.max(0, 1 - y * y));
      const r = bright ? 1.4 + 1.2 * Math.pow(rnd(), 3) : 0.6 + 1.6 * Math.pow(rnd(), 3);
      const b = bright ? 0.35 + 3.2 * Math.pow(rnd(), 5) : 0.35 + 1.6 * Math.pow(rnd(), 5);
      const c = rnd(); const cc = c < 0.55 ? cols[0] : c < 0.8 ? cols[1] : cols[2];
      A.set([rr * Math.cos(ph), y, rr * Math.sin(ph), Math.round(r * 100) + Math.min(0.999, b / 4)], i * 4);
      B.set([cc[0], cc[1], cc[2], rnd() * 7], i * 4);
    }
    return { N, a: G.dataTexture(1024, A.length / 4096, A, { format: 'rgba32f' }), b: G.dataTexture(1024, A.length / 4096, B, { format: 'rgba32f' }) };
  })();
  function drawStars(target, cam, o) {
    if (!(o.I > 0)) return;
    const { u } = camUniforms(cam);
    G.draw(P.stars, Object.assign(u, waveTables(o.k0 || 0.35), {
      uCat: CAT.a, uCat2: CAT.b, uTau: o.tau || 0, uI: o.I, uRefl: o.refl ? 1 : 0, uAmp: o.amp || 0, uDrag: o.drag == null ? 0.28 : o.drag, uDimHz: o.dimHz || 0,
      uPrevM: o.camPrev ? basis(o.camPrev, W, H).M : u.uCamM, uHasPrev: o.camPrev ? 1 : 0, uShutter: o.shutter == null ? 0.5 : o.shutter,
    }), target, { blend: 'add', mode: G.gl.TRIANGLES, count: CAT.N * 6 });
  }
  // S.stars is assigned below, once S exists
  const S = {};
  S.stars = (...a) => drawStars(...a);   // stars(target, cam, {tau, I, refl, amp}) (rendered/engraved/skyDraw call it)

  function camUniforms(cam) {
    const b = basis(cam, W, H);
    // horizon line: project two horizontal directions
    const fwd = [b.ez[0], 0, b.ez[2]]; const fl = Math.hypot(fwd[0], fwd[2]) || 1;
    const f0 = [fwd[0] / fl, 0, fwd[2] / fl], side = [f0[2], 0, -f0[0]];
    const d1 = norm3([f0[0] - side[0] * 0.3, 0, f0[2] - side[2] * 0.3]), d2 = norm3([f0[0] + side[0] * 0.3, 0, f0[2] + side[2] * 0.3]);
    const p1 = projectB(b, d1), p2 = projectB(b, d2);
    let hz = [H / 2, 0];
    if (p1 && p2 && Math.abs(p2[0] - p1[0]) > 1e-6) { const sl = (p2[1] - p1[1]) / (p2[0] - p1[0]); hz = [p1[1] - sl * p1[0], sl]; }
    return { b, u: Object.assign({ uCamM: b.M, uCamP: b.pos, uF: b.f, uHzLine: [hz[0], hz[1], 0] }, STAR) };
  }
  function projectB(b, d) {
    const lx = b.ex[0] * d[0] + b.ex[1] * d[1] + b.ex[2] * d[2];
    const ly = b.ey[0] * d[0] + b.ey[1] * d[1] + b.ey[2] * d[2];
    const lz = b.ez[0] * d[0] + b.ez[1] * d[1] + b.ez[2] * d[2];
    if (lz <= 1e-6) return null;
    return [W / 2 + b.f * lx / lz, H / 2 - b.f * ly / lz];
  }
  S.ray = function (cam, x, y) {
    const b = basis(cam, W, H);
    const lx = (x - W / 2) / b.f, ly = (H / 2 - y) / b.f;
    return norm3([b.ex[0] * lx + b.ey[0] * ly + b.ez[0], b.ex[1] * lx + b.ey[1] * ly + b.ez[1], b.ex[2] * lx + b.ey[2] * ly + b.ez[2]]);
  };
  S.dirAt = S.ray;
  S.project = (cam, d) => projectB(basis(cam, W, H), norm3(d));
  S.horizonY = function (cam, x = W / 2) { const u = camUniforms(cam).u.uHzLine; return u[0] + u[1] * x; };
  S._camU = cam => camUniforms(cam).u;            // test hooks
  S._waveU = (k0 = 0.35) => waveTables(k0);
  // the quarter sky is upsampled once per use to half resolution with Catmull-Rom (9 taps at a quarter of the pixels);
  // the full-resolution passes then read it with one bilinear tap (direct view and reflection)
  function half(q) {
    if (!q) return null;
    const h = G.target('sea.skyhalf', W / 2, H / 2, { scale: 0.5 });
    G.draw(P.upCR, { uSrc: q }, h);
    return h;
  }
  S.quarter = name => G.target('sea.q.' + name, W / 4, H / 4, { scale: 0.25 });

  // sun record -> uniforms
  function sunUniforms(cam, sun, look) {
    if (!sun) return { uSun: [0, -1, 0, 0.01], uSunCol: [0, 0, 0], uSunHaloCol: [0, 0, 0], uSunHalo: 0, uSunSoft: 0.15, uSunOn: 0, uSunSpec: 0 };
    const b = basis(cam, W, H);
    const dir = sun.dir ? norm3(sun.dir) : S.ray(cam, sun.at[0], sun.at[1]);
    const rad = (sun.r == null ? 22 : sun.r) / b.f;
    const c = lin(sun.color || '#FFF0C8');
    const I = sun.I == null ? 20 : sun.I;
    const hc = lin(sun.haloColor || sun.color || '#FFC870');
    return { uSun: [...dir, rad], uSunCol: scl(c, I), uSunHaloCol: scl(hc, sun.halo == null ? 1 : sun.halo), uSunHalo: 1,
      uSunSoft: sun.soft == null ? 0.15 : sun.soft, uSunOn: 1, uSunSpec: sun.spec == null ? 30 : sun.spec };
  }
  function hazeU(o, look, def) {
    const h = o.haze || {};
    return { uHazeCol: col(h.color || def, look), uHazeI: h.I == null ? 0.6 : h.I, uHazeW: h.width || 0.035 };
  }

  S.sky = function (rt, o) {
    const look = o.look || 'night_sea';
    const { u } = camUniforms(o.cam);
    const gl = o.glow || {};
    G.draw(P.sky, Object.assign(u, sunUniforms(o.cam, o.sun, look), hazeU(o, look, o.horizon || '#12182A'), {
      uTau: o.tau || 0,
      uTop: col(o.top || '#0A1220', look), uMid: col(o.mid || '#0A1020', look), uHz: col(o.horizon || '#12182A', look),
      uGlowCol: scl(col(gl.color || '#E39A4C', look), gl.I || 0), uGlowW: gl.width || 0.6, uGlowH: gl.height || 0.12,
      uBand: o.band || 0.05, uMilky: o.milky || 0, uHaloB: o.sun ? (o.sun.halo == null ? 1 : o.sun.halo) : 0,
    }), rt);
  };

  S.aurora = function (rt, o) {
    const look = o.look || 'night_sea';
    const I = o.intensity == null ? 0.5 : o.intensity;
    if (I <= 0) return;
    const { u } = camUniforms(o.cam);
    const a = (o.tau || 0) * (o.speed || 0.06);
    const cs = o.colors || ['#3DF5B0', '#1E9C8A', '#6A4FD8'];
    const aur = G.target('sea.aurora', W / 4, H / 8, { scale: 0.25 });
    G.draw(P.aurora, Object.assign(u, {
      uScaleZ: o.scaleZ || 1.6, uScaleX: o.scaleX || 2.1,
      uTau: o.tau || 0, uI: I, uSpeed: o.speed || 0.06, uReveal: o.reveal == null ? 1 : o.reveal,
      uRotT: [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a)],
      uA0: chroma(cs[0], look), uA1: chroma(cs[1], look), uA2: chroma(cs[2], look), uTopAmt: o.topAmt == null ? 0.35 : o.topAmt, uDesat: o.desat == null ? 0.3 : o.desat,
    }), aur);
    G.draw(P.copyAdd, { uSrc: aur }, rt, { blend: 'add' });
  };

  S.engraved = function (target, o) {
    const look = o.look || 'night_sea';
    const { u } = camUniforms(o.cam);
    const lights = new Float32Array(32); let n = 0;
    for (const l of (o.lights || [])) { if (n >= 8) break; lights.set([l[0], l[1] == null ? 1 : l[1], l[2] == null ? 1 : l[2], l[3] == null ? 18 : l[3]], n * 4); n++; }
    for (const l of (o.columns || [])) { if (n >= 8) break; lights.set([l[0], l[1] == null ? 1 : l[1], l[2] == null ? 1 : l[2], l[3] == null ? 10 : l[3]], n * 4); n++; }
    let prev = { uHasPrev: 0, uPrevM: u.uCamM, uPrevP: u.uCamP };
    if (o.camPrev) { const bp = basis(o.camPrev, W, H); prev = { uHasPrev: 1, uPrevM: bp.M, uPrevP: bp.pos }; }
    const nearA = o.nearAlpha == null ? 0.55 : o.nearAlpha;
    G.draw(P.engraved, Object.assign(u, prev, {
      uTau: o.tau || 0, uSpacing: o.spacing || 0.35, uAmp: o.amp == null ? 1 : o.amp, uLift: o.lift == null ? 1.6 : o.lift,
      uMotion: o.camPrev ? (o.motionAA == null ? 0.5 : o.motionAA) : 0, uFallbackAA: o.camPrev ? 0 : (o.motionAA || 0),
      uWidth: o.width == null ? 1 : o.width,
      uRamp: [o.lineFar || '#3A3020', o.lineDim || '#6E4A12', o.lineMid || '#B8862B', o.lineNear || '#D4A64A', o.lineHot || '#FFE7A3']
        .map((h, i) => scl(col(h, look, i === 4), i === 0 || i === 4 ? 1 : nearA / 0.55)),
      uTnear: o.lineSpacingNear || 9 * G.U, uTfar: o.lineSpacingFar || 3.2 * G.U, uMist: col(o.mist || '#0A1A22', look),
      uSkyTop: col(o.skyTop || '#07080C', look), uSkyHz: col(o.skyHorizon || '#0A1020', look),
      uSky: half(o.sky), uHasSky: o.sky ? 1 : 0, uStarsI: o.stars || 0, uHazeI: o.hazeI == null ? 1 : o.hazeI,
      uLights: lights, uNL: n,
      uShield: o.shield || null, uHasShield: o.shield ? 1 : 0, uShieldK: o.shieldK == null ? 0.7 : o.shieldK, uAlpha: o.alpha == null ? 1 : o.alpha,
    }), target, { blend: o.blend || null });
    drawStars(target, o.cam, { tau: o.tau, I: (o.stars || 0) * (o.alpha == null ? 1 : o.alpha), camPrev: o.camPrev, shutter: o.motionAA == null ? 0.5 : o.motionAA });
  };

  S.rendered = function (target, o) {
    const look = o.look || 'night_sea';
    const { u } = camUniforms(o.cam);
    const gl8 = o.glints;
    G.draw(P.rendered, Object.assign(u, waveTables(o.k0 || 0.35), sunUniforms(o.cam, o.sun, look), hazeU(o, look, o.horizon || '#12182A'), {
      uTau: o.tau || 0, uAmp: o.amp == null ? 0.15 : o.amp, uDrag: o.drag == null ? 0.28 : o.drag,
      uDeep: col(o.deep || [0.004, 0.009, 0.018], look), uFog: o.fog == null ? 0.0012 : o.fog, uStarsI: o.stars == null ? 1 : o.stars,
      uReflect: o.reflect == null ? 1 : o.reflect, uAlpha: o.alpha == null ? 1 : o.alpha, uRegion: o.region === 'sea' ? 1 : 0,
      uSky: half(o.sky), uHasSky: o.sky ? 1 : 0, uMirror: o.mirror || null, uHasMirror: o.mirror ? 1 : 0,
      uTop: col(o.top || '#0A1220', look), uMid: col(o.mid || '#0A1020', look), uHz: col(o.horizon || '#12182A', look),
      uGlint: gl8 ? [gl8.I == null ? 1 : gl8.I, (gl8.width == null ? 0.06 : gl8.width) * W * 0.5, gl8.rate || 10, gl8.exp || 400] : [0, 1, 10, 400],
    }), target, { blend: o.blend || null });
    if (!o.mirror) {
      const sI = (o.stars == null ? 1 : o.stars) * (o.alpha == null ? 1 : o.alpha);
      if (o.region !== 'sea') drawStars(target, o.cam, { tau: o.tau, I: sI });
      drawStars(target, o.cam, { tau: o.tau, I: sI * (o.reflect == null ? 1 : o.reflect), refl: true, amp: o.amp == null ? 0.15 : o.amp, k0: o.k0, drag: o.drag });
    }
  };

  S.skyDraw = function (target, o) {
    const look = o.look || 'night_sea';
    const { u } = camUniforms(o.cam);
    G.draw(P.skyDraw, Object.assign(u, sunUniforms(o.cam, o.sun, look), hazeU(o, look, o.horizon || '#12182A'), {
      uTau: o.tau || 0, uSky: half(o.sky), uHasSky: o.sky ? 1 : 0, uStarsI: o.stars == null ? 1 : o.stars, uAlpha: o.alpha == null ? 1 : o.alpha,
      uTop: col(o.top || '#0A1220', look), uMid: col(o.mid || '#0A1020', look), uHz: col(o.horizon || '#12182A', look),
    }), target, { blend: o.blend || null });
    drawStars(target, o.cam, { tau: o.tau, I: (o.stars == null ? 1 : o.stars) * (o.alpha == null ? 1 : o.alpha) });
  };

  S.godRays = function (target, o) {   // spread: angular size (rad) of the glow that feeds the shafts
    const look = o.look || 'night_sea';
    const I = o.I == null ? 1 : o.I;
    if (I <= 0 || !o.sun) return;
    const { u, b } = camUniforms(o.cam);
    const su = sunUniforms(o.cam, o.sun, look);
    const sp = projectB(b, su.uSun.slice(0, 3)) || [W / 2, H / 2];
    const src = G.target('sea.gr.src', W / 4, H / 4, { scale: 0.25 }), blur = G.target('sea.gr.blur', W / 4, H / 4, { scale: 0.25 });
    const common = Object.assign(u, su, { uTau: o.tau || 0, uSunPx: sp, uMistK: o.mist == null ? 1 : o.mist });
    G.draw(P.grSrc, Object.assign({}, common, { uSpread: o.spread || 0.07, uRayCol: scl(chroma(o.color || '#FFC88A', look), 0.6) }), src);
    G.draw(P.grBlur, Object.assign({}, common, { uSrc: src, uDensity: o.density == null ? 0.9 : o.density, uDecay: o.decay == null ? 0.965 : o.decay }), blur);
    G.draw(P.upAdd, { uSrc: blur, uK: I }, target, { blend: 'add' });
  };

  S.glitter = function (target, o) {
    const look = o.look || 'night_sea';
    const I = o.I == null ? 1 : o.I;
    if (I <= 0 || !o.sun) return;
    const { u } = camUniforms(o.cam);
    const tau = o.tau || 0;
    const live = (o.bursts || []).filter(e => tau - e.tau >= 0 && tau - e.tau <= 0.15).slice(-8);
    const bu = new Float32Array(32).fill(-1e6);
    live.forEach((e, i) => bu.set([e.tau, e.vel == null ? 0.5 : e.vel, 0, 0], i * 4));
    const count = o.count == null ? 5000 : o.count;
    G.draw(P.glitter, Object.assign(u, waveTables(o.k0 || 0.35), sunUniforms(o.cam, o.sun, look), {
      uTau: tau, uAmp: o.amp == null ? 0.15 : o.amp, uDrag: o.drag == null ? 0.28 : o.drag,
      uCount: count, uOpen: o.open == null ? 1 : o.open, uI: I, uHW0: o.width == null ? 0.05 : o.width, uHWK: o.widen == null ? 0.32 : o.widen,
      uExp: o.exp || 600, uBurst: bu, uGCol: col(o.color || '#FFE7A3', look),
    }), target, { blend: 'add', mode: G.gl.POINTS, count: count + 40 * 8 });
  };

  S.flare = function (target, o) {
    const I = o.I == null ? 0.15 : o.I, len = o.len || 300, sl = o.streakLen || 1200;
    const ext = Math.max(len, o.streak ? sl * 0.5 : 0) + 4;
    const sc = target ? (target.scale == null ? 1 : target.scale) : 1;
    const th = target ? target.h : H;
    const x0 = Math.max(0, Math.floor((o.x - ext) * sc)), x1 = Math.min(Math.round(W * sc), Math.ceil((o.x + ext) * sc));
    const yTop = Math.max(0, Math.floor((o.y - len - 4) * sc)), yBot = Math.min(th, Math.ceil((o.y + len + 4) * sc));
    if (x1 <= x0 || yBot <= yTop) return;
    G.draw(P.flare, { uC: [o.x, o.y], uI: I, uLen: len, uRays: o.rays || 8, uAng: o.angle || 0, uCol: lin(o.color || '#FFF4D6'),
      uStreak: o.streak || 0, uSLen: sl, uSCol: lin(o.streakColor || '#FFD27A') }, target,
      { blend: 'add', viewport: [x0, th - yBot, x1 - x0, yBot - yTop] });
  };
  return S;
}
export const _GLSL = { SEA_LIB, SWELL, WAVES, FS_RENDERED, FS_ENGRAVED, FS_AURORA };
