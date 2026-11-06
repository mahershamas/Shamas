/*
  core/sea.js: seas and skies. STUB with final signatures (package P4 owns the looks and costs).
  The engraved ocean below already follows the scene-4 shader of the spec (Gerstner swell, world-space hatch lines,
  fwidth AA, sub-pixel fade); the rendered sea and the aurora are simple placeholders.

  Camera (shared by all calls): {h: height m, x, z: position m, yaw: rad, pitch: rad (positive looks down),
                                 fovY: rad (default 0.6)}.  horizonPitch(horizonY, H, fovY) gives the pitch that puts
                                 the horizon at frame y = horizonY.
  API
    horizonPitch(horizonY, H, fovY = 0.6) -> pitch
    const S = createSea(G)
    S.engraved(target, {tau, cam, spacing = 0.35, amp = 1, motionAA = 0, lineNear = '#D4A64A', lineFar = '#3A3020',
                        nearAlpha = 0.55, mist = '#0A1A22', skyTop = '#07080C', skyHorizon = '#0A1020', lights: [[x, I], ...] (frame x),
                        shield: Tex|null (blurred caption mask, frame-aligned), shieldK = 0.7, alpha = 1})
    S.rendered(target, {tau, cam, amp = 0.15, sky: RT|null (quarter-res sky/aurora to reflect), deep = [0.004,0.009,0.018]})
    S.sky(rtQuarter, {tau, cam, top, mid, horizon})         quarter-resolution sky gradient
    S.aurora(rtQuarter, {tau, cam, intensity, speed = 0.06}) quarter-resolution aurora (placeholder curtain)
    S.quarter(name) -> RT                                    a W/4 x H/4 HDR target for the above
*/
import { frag } from './glsl.js';
import { hexLin } from './gl.js';

export function horizonPitch(horizonY, H, fovY = 0.6) {
  const f = (H / 2) / Math.tan(fovY / 2);
  return Math.atan((H / 2 - horizonY) / f);
}

const CAM = `
uniform vec4 uCam;    // h, x, z, yaw
uniform vec2 uCam2;   // pitch, fovY
vec3 camRay(vec2 px){
  float f = (uFrame.y * 0.5) / tan(uCam2.y * 0.5);
  vec3 d = normalize(vec3((px.x - uFrame.x * 0.5) / f, (uFrame.y * 0.5 - px.y) / f, 1.0));
  float cp = cos(uCam2.x), sp = sin(uCam2.x);
  d = vec3(d.x, d.y * cp - d.z * sp, d.y * sp + d.z * cp);
  float cy = cos(uCam.w), sy = sin(uCam.w);
  return vec3(d.x * cy + d.z * sy, d.y, -d.x * sy + d.z * cy);
}`;

const FS_ENGRAVED = frag(CAM + `
uniform float uTau, uSpacing, uAmp, uMotionAA, uNearA, uShieldK, uAlpha;
uniform vec3 uLineNear, uLineFar, uMist, uSkyTop, uSkyHz;
uniform vec4 uLights[4]; uniform int uNL;
uniform sampler2D uShield; uniform int uHasShield;
out vec4 o;
void main(){
  vec2 px = framePx();
  vec3 rd = camRay(px);
  vec3 c;
  if (rd.y >= -1e-4){
    c = mix(uSkyHz, uSkyTop, smoothstep(0.0, 0.35, rd.y));
  } else {
    float d = uCam.x / -rd.y;
    vec2 xz = uCam.yz + rd.xz * d;
    float h; vec2 g;
    gerstner(xz, uTau, uAmp, h, g);
    float z = (xz.y + h * 1.6) / uSpacing;
    float f = abs(fract(z) - 0.5);
    float w = 0.10 + 0.12 * clamp(length(g) * 2.0, 0.0, 1.0);
    float fw = fwidth(z);
    float aa = fw + uMotionAA * fw;
    float ink = 1.0 - smoothstep(w - aa, w + aa, f);
    ink *= 1.0 - smoothstep(0.25, 0.6, fw);
    float fd = clamp(d / 400.0, 0.0, 1.0);
    vec3 line = mix(uLineNear * uNearA, uLineFar, fd);
    float refl = 1.0;
    for (int i = 0; i < 4; i++){ if (i >= uNL) break; refl += 3.0 * uLights[i].y * exp(-abs(px.x - uLights[i].x) / 18.0) * (1.0 - fd); }
    c = mix(uMist, line * refl, ink) * exp(-d * 0.004);
    c = mix(c, uMist, smoothstep(0.5, 1.0, fd) * 0.6);
    if (uHasShield == 1) c *= 1.0 - uShieldK * texture(uShield, px / uFrame).a;
  }
  o = vec4(c * uAlpha, uAlpha);
}`);

const FS_RENDERED = frag(CAM + `
uniform float uTau, uAmp; uniform vec3 uDeep; uniform sampler2D uSky; uniform int uHasSky;
out vec4 o;
void main(){
  vec2 px = framePx();
  vec3 rd = camRay(px);
  vec3 c;
  if (rd.y >= 0.0){ c = uHasSky == 1 ? texture(uSky, screenUV()).rgb : vec3(0.002, 0.003, 0.008); }
  else {
    float d = uCam.x / -rd.y; vec2 xz = uCam.yz + rd.xz * d;
    vec2 n = vec2(0.0);
    for (int i = 0; i < 5; i++){ float k = 0.6 * pow(1.7, float(i)); float a = uAmp * 0.08 / pow(1.6, float(i));
      vec2 dir = vec2(sin(float(i) * 1.3), cos(float(i) * 1.3)); n += dir * a * k * cos(k * dot(dir, xz) - sqrt(9.81 * k) * uTau); }
    vec3 N = normalize(vec3(-n.x, 1.0, -n.y));
    vec3 r = reflect(rd, N);
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(-rd, N), 0.0), 5.0);
    vec2 suv = vec2(screenUV().x + r.x * 0.02, clamp(1.0 - screenUV().y, 0.0, 1.0));   // mirror about the frame middle (stub)
    vec3 sky = uHasSky == 1 ? texture(uSky, suv).rgb : vec3(0.002, 0.003, 0.008);
    c = mix(uDeep, sky, fres);
  }
  o = vec4(c, 1.0);
}`);

const FS_SKY = frag(CAM + `
uniform vec3 uTop, uMid, uHz;
out vec4 o;
void main(){
  vec3 rd = camRay(framePx());
  float y = abs(rd.y);
  vec3 c = mix(uHz, uMid, smoothstep(0.0, 0.08, y));
  c = mix(c, uTop, smoothstep(0.08, 0.5, y));
  o = vec4(c, 1.0);
}`);

const FS_AURORA = frag(CAM + `
uniform float uTau, uI, uSpeed;
out vec4 o;
void main(){
  vec3 rd = camRay(framePx());
  float y = abs(rd.y);
  vec2 q = vec2(rd.x / max(y + 0.05, 0.05), y);
  float curtain = fbm(vec2(q.x * 1.5 + uTau * uSpeed, uTau * uSpeed * 0.5), 4);
  float band = smoothstep(0.05, 0.2, y) * (1.0 - smoothstep(0.3, 0.7, y));
  vec3 c = mix(vec3(0.05, 0.9, 0.45), vec3(0.15, 0.1, 0.7), smoothstep(0.2, 0.6, y)) * pow(curtain, 3.0) * band * uI * 2.0;
  o = vec4(c, 1.0);
}`);

function camU(cam) {
  return { uCam: [cam.h, cam.x || 0, cam.z || 0, cam.yaw || 0], uCam2: [cam.pitch || 0, cam.fovY || 0.6] };
}

export function createSea(G) {
  const P = {
    engraved: G.program('sea.engraved', FS_ENGRAVED), rendered: G.program('sea.rendered', FS_RENDERED),
    sky: G.program('sea.sky', FS_SKY), aurora: G.program('sea.aurora', FS_AURORA),
  };
  const S = {};
  S.quarter = name => G.target('sea.q.' + name, G.W / 4, G.H / 4, { scale: 0.25 });
  S.engraved = function (target, o) {
    const lights = new Float32Array(16); const L = (o.lights || []).slice(0, 4);
    L.forEach((l, i) => lights.set([l[0], l[1] == null ? 1 : l[1], 0, 0], i * 4));
    G.draw(P.engraved, Object.assign(camU(o.cam), {
      uTau: o.tau, uSpacing: o.spacing || 0.35, uAmp: o.amp == null ? 1 : o.amp, uMotionAA: o.motionAA || 0, uNearA: o.nearAlpha == null ? 0.55 : o.nearAlpha,
      uLineNear: hexLin(o.lineNear || '#D4A64A'), uLineFar: hexLin(o.lineFar || '#3A3020'), uMist: hexLin(o.mist || '#0A1A22'),
      uSkyTop: hexLin(o.skyTop || '#07080C'), uSkyHz: hexLin(o.skyHorizon || '#0A1020'), uLights: lights, uNL: L.length,
      uShield: o.shield || null, uHasShield: o.shield ? 1 : 0, uShieldK: o.shieldK == null ? 0.7 : o.shieldK, uAlpha: o.alpha == null ? 1 : o.alpha,
    }), target, { blend: o.blend || null });
  };
  S.rendered = function (target, o) {
    G.draw(P.rendered, Object.assign(camU(o.cam), { uTau: o.tau, uAmp: o.amp == null ? 0.15 : o.amp, uDeep: o.deep || [0.004, 0.009, 0.018],
      uSky: o.sky || null, uHasSky: o.sky ? 1 : 0 }), target);
  };
  S.sky = function (rt, o) {
    G.draw(P.sky, Object.assign(camU(o.cam), { uTop: hexLin(o.top || '#0A1220'), uMid: hexLin(o.mid || '#0A1020'), uHz: hexLin(o.horizon || '#12182A') }), rt);
  };
  S.aurora = function (rt, o) {
    G.draw(P.aurora, Object.assign(camU(o.cam), { uTau: o.tau, uI: o.intensity == null ? 0.5 : o.intensity, uSpeed: o.speed || 0.06 }), rt, { blend: 'add' });
  };
  return S;
}
