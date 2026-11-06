/*
  core/particles.js: closed-form particle systems drawn as GL_POINTS (additive HDR), plus point-list helpers.
  Every particle is a pure function of (id, tau, uniforms): no simulation state.

  API
    const P = createParticles(G)
    P.program(key, glsl, {fs}) -> Program
        glsl must define   void particle(int id, out vec2 px, out float size, out vec4 col)
          px   frame px (top-left origin); size: diameter in frame px (min drawn 1 px); col: linear HDR rgb, a = alpha
        The vertex header gives HEADER_VS (hashes, noise, curl, easing...) plus `uniform float uTau;`
        Optional fs: a custom fragment body using `in vec4 vCol; in float vSize;` and gl_PointCoord, writing `o`.
        Default fragment: Gaussian disc, o = vec4(vCol.rgb * vCol.a * w, 0) for additive blending.
    P.draw(prog, count, uniforms, target, {blend = 'add'})    draws `count` points (gl_VertexID = particle id)
    P.pointsTexture(Float32Array data, comps = 2|4) -> Tex     RG32F/RGBA32F data texture, 1024 texels per row;
        GLSL helper fetchPoint(sampler2D t, int id) (included in the vertex header) returns vec4 (xy[zw])
    glyphPoints(source, {threshold = 0.5, count, seed, step = 1}) -> Float32Array [x0,y0, x1,y1, ...]
        source: a canvas or {data, width, height} (ImageData-like); samples pixels with alpha > threshold, seeded shuffle
    shuffle(array, seed)  in-place seeded Fisher-Yates
*/
import { HEADER_VS, frag } from './glsl.js';
import { mulberry32 } from './timeline.js';

const VS_HEAD = HEADER_VS + `
uniform float uTau;
out vec4 vCol; out float vSize;
vec4 fetchPoint(sampler2D t, int id){ return texelFetch(t, ivec2(id % 1024, id / 1024), 0); }
`;
const VS_MAIN = `
void main(){
  vec2 px; float size; vec4 col;
  particle(gl_VertexID, px, size, col);
  float s = max(size * uScale, 1.0);
  // energy conservation for sub-pixel particles: shrink alpha instead of size
  col.a *= min(1.0, (size * uScale) * (size * uScale));
  vCol = col; vSize = s;
  gl_Position = col.a <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : clipOfPx(px);
  gl_PointSize = s + 2.0;
}`;
const FS_DEFAULT = `
in vec4 vCol; in float vSize;
out vec4 o;
void main(){
  vec2 q = (gl_PointCoord * 2.0 - 1.0) * (vSize + 2.0) / max(vSize, 1.0);
  float w = exp(-dot(q, q) * 2.0);
  o = vec4(vCol.rgb * vCol.a * w, 0.0);
}`;

export function shuffle(a, seed) {
  const r = mulberry32(seed >>> 0);
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}

export function glyphPoints(src, { threshold = 0.5, count = 0, seed = 1, step = 1 } = {}) {
  let img = src;
  if (src.getContext) img = src.getContext('2d').getImageData(0, 0, src.width, src.height);
  const pts = [];
  const thr = threshold * 255;
  for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) {
    if (img.data[(y * img.width + x) * 4 + 3] > thr) pts.push(x + 0.5, y + 0.5);
  }
  const n = pts.length / 2;
  const idx = shuffle(Array.from({ length: n }, (_, i) => i), seed);
  const m = count > 0 ? count : n;
  const out = new Float32Array(m * 2);
  for (let i = 0; i < m; i++) { const k = idx[i % n]; out[i * 2] = pts[k * 2]; out[i * 2 + 1] = pts[k * 2 + 1]; }
  return out;
}

export function createParticles(G) {
  const gl = G.gl;
  const P = {};
  P.program = function (key, glsl, o = {}) {
    return G.program('particles.' + key, frag(o.fs || FS_DEFAULT), VS_HEAD + glsl + VS_MAIN);
  };
  P.draw = function (prog, count, uniforms, target, o = {}) {
    G.draw(prog, uniforms, target, { blend: o.blend || 'add', mode: gl.POINTS, count });
  };
  P.pointsTexture = function (data, comps = 2) {
    const n = data.length / comps;
    const w = Math.min(1024, n), h = Math.ceil(n / 1024);
    const buf = new Float32Array(w * h * comps); buf.set(data);
    return G.dataTexture(w, h, buf, { format: comps === 4 ? 'rgba32f' : 'rg32f' });
  };
  return P;
}
