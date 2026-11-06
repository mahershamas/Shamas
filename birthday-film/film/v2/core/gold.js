/*
  core/gold.js: the gold-leaf material of SPEC 4.3 applied to any alpha mask texture, drawn additively into an HDR
  target (the overlay pass, before bloom). Gold is never flat colour.

  API
    GOLD_GLSL                    GLSL source of
                                   vec3 goldLeaf(sampler2D mask, vec2 uv, vec2 duvDx, vec2 duvDy, vec2 fragPx,
                                                 vec3 keyPos, float keyI, vec3 fillPos, float fillI, float bump, float cov)
                                 for modules that shade their own masks (knots, borders, rosette). duvDx / duvDy are the uv
                                 steps for +1 frame px in x and in y (y down); keyPos.z is the light height (220 px default).
    const gold = createGold(G)
    gold.draw(target, opts)      opts:
      mask        RT or Tex with mipmaps (alpha = coverage)
      rect        [x, y, w, h] frame px that the mask covers
      maskFlipY   true when the mask is a GL render target (bottom-up rows), e.g. from text.drawMask()
      opacity     coverage multiplier (default 1)
      key         [x, y] frame px of the key light (default above-left of the rect), keyZ (default 220), keyI (default 4)
      fill        [x, y] and fillI (default 0): second light (scene 10 uses star B)
      bump        default 6;  tint [r,g,b] multiplier (default 1);  envI (default 1)
      sweep       null | {x, width, I}: an extra specular band centred at frame x (struck-metal strike)
    gold.drawText(target, text, entry, opts)   convenience: text.drawMask(entry) then draw, releases the mask
*/
import { frag, HEADER_VS } from './glsl.js';

export const GOLD_GLSL = `
vec3 goldLeaf(sampler2D mask, vec2 uv, vec2 duvDx, vec2 duvDy, vec2 fragPx, vec3 keyPos, float keyI, vec3 fillPos, float fillI, float bump, float cov){
  vec2 sx = duvDx * 3.0, sy = duvDy * 3.0;
  float gx = textureLod(mask, uv + sx, 2.0).a - textureLod(mask, uv - sx, 2.0).a;
  float gy = textureLod(mask, uv + sy, 2.0).a - textureLod(mask, uv - sy, 2.0).a;
  vec3 N = normalize(vec3(-vec2(gx, gy) * bump, 1.0));          // frame coords, y down
  float edge = voronoiEdge(fragPx / 18.0);
  float crack = 1.0 - smoothstep(0.0, 0.09, edge);
  float rough = 0.28 + 0.25 * crack;
  const vec3 F0 = vec3(1.0, 0.71, 0.29);
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(vec3(keyPos.xy - fragPx, keyPos.z));
  vec3 spec = ggx(N, V, L, rough, F0) * keyI;
  if (fillI > 0.0){ vec3 L2 = normalize(vec3(fillPos.xy - fragPx, fillPos.z)); spec += ggx(N, V, L2, rough, F0) * fillI; }
  float up = -N.y * 0.5 + 0.5;
  vec3 env = F0 * mix(vec3(0.12, 0.06, 0.02), vec3(1.3, 1.0, 0.65), up);
  return (env * 0.6 + spec) * (0.92 + 0.08 * fbm(uv * 40.0, 3)) * cov;
}`;

const VS = HEADER_VS + `
uniform vec4 uRect;
out vec2 vPx;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 px = uRect.xy + c * uRect.zw; vPx = px;
  gl_Position = clipOfPx(px);
}`;

const FS = frag(GOLD_GLSL + `
uniform sampler2D uMask; uniform vec4 uRect; uniform int uFlip;
uniform vec3 uKey, uFill; uniform float uKeyI, uFillI, uBump, uOpacity, uEnvI;
uniform vec3 uTint; uniform vec3 uSweep;   // x, width, intensity
in vec2 vPx;
out vec4 o;
void main(){
  vec2 q = (vPx - uRect.xy) / uRect.zw;
  vec2 uv = uFlip == 1 ? vec2(q.x, 1.0 - q.y) : q;
  vec2 dx = vec2(1.0 / uRect.z, 0.0), dy = vec2(0.0, (uFlip == 1 ? -1.0 : 1.0) / uRect.w);
  float cov = textureLod(uMask, uv, 0.0).a * uOpacity;
  if (cov <= 0.0005){ o = vec4(0.0); return; }
  float keyI = uKeyI;
  vec3 key = uKey;
  if (uSweep.z > 0.0){ float b = exp(-pow((vPx.x - uSweep.x) / max(uSweep.y, 1.0), 2.0)); keyI += uSweep.z * b; key.xy = mix(key.xy, vec2(uSweep.x, vPx.y - 120.0), b); }
  vec3 c = goldLeaf(uMask, uv, dx, dy, vPx, key, keyI, uFill, uFillI, uBump, cov);
  o = vec4(c * uTint * mix(1.0, uEnvI, 0.5), cov);
}`);

export function createGold(G) {
  const prog = G.program('gold.leaf', FS, VS);
  const gl = G.gl;
  const api = {};
  api.draw = function (target, o) {
    const r = o.rect;
    const key = o.key || [r[0] + r[2] * 0.25, r[1] - r[3] * 0.8];
    const fill = o.fill || [r[0] + r[2] * 0.5, r[1] + r[3]];
    const sw = o.sweep ? [o.sweep.x, o.sweep.width || 80, o.sweep.I == null ? 6 : o.sweep.I] : [0, 1, 0];
    G.draw(prog, {
      uRect: r, uMask: o.mask, uFlip: o.maskFlipY ? 1 : 0,
      uKey: [key[0], key[1], o.keyZ || 220], uKeyI: o.keyI == null ? 4 : o.keyI,
      uFill: [fill[0], fill[1], o.fillZ || 220], uFillI: o.fillI || 0,
      uBump: o.bump == null ? 6 : o.bump, uOpacity: o.opacity == null ? 1 : o.opacity, uEnvI: o.envI == null ? 1 : o.envI,
      uTint: o.tint || [1, 1, 1], uSweep: sw,
    }, target, { blend: 'add', mode: gl.TRIANGLE_STRIP, count: 4 });
  };
  api.drawText = function (target, text, entry, o = {}) {
    const m = text.drawMask(entry);
    api.draw(target, Object.assign({ mask: m.rt, rect: m.rect, maskFlipY: true }, entry.gold || {}, o));
    text.releaseMask(m);
    return m.lay;
  };
  return api;
}
