/*
  core/glsl.js: the shared GLSL ES 3.00 header for every film shader.

  API
    HEADER                       string: '#version 300 es', precision, standard uniforms and the function library below.
    HEADER_VS                    the same for vertex shaders (no framePx/screenUV, which need gl_FragCoord).
    frag(body)                   returns HEADER + body (a fragment shader: write `out vec4 o;` yourself, or use FRAG_OUT).
    FRAG_OUT                     'out vec4 o;\n' convenience.
    VERT_TRI                     the fullscreen-triangle vertex shader (gl_VertexID, no buffers).

  Standard uniforms (set automatically by gl.js draw() when a shader declares them):
    uRes    vec2   size of the render target in texels
    uScale  float  target texels per frame pixel (internalScale of the pass; 1 at full resolution)
    uFrame  vec2   output frame size in frame pixels (1920x1080 landscape, 1080x1920 portrait)

  Coordinate helpers
    framePx()     frame pixel of this fragment, ORIGIN TOP-LEFT (layout space of the spec)
    screenUV()    gl_FragCoord.xy/uRes, origin bottom-left (use for sampling render targets)
    pxToUV(px)    frame px (top-left) -> render-target uv (bottom-left)
    clipOfPx(px)  frame px (top-left) -> clip-space position (vertex shaders, quads, points)

  Library (all pure functions, no state):
    hashing   pcg2d(uvec2) h12(vec2) h22(vec2) h13(vec3) h11(float)
    noise     vn(vec2) value noise in [0,1]; vn3(vec3); fbm(vec2 p, int oct) in ~[0,1]; fbm3(vec3, int)
              curl2(vec2) divergence-free 2D field; curl3(vec3)
    colour    srgb2lin(vec3) lin2srgb(vec3) hex helpers are JS-side (see gl.js hex()); luma(vec3) (Rec.709)
              blackbody(float kelvin) normalised linear RGB
    tonemap   agx(vec3) agxEotf(vec3) agxLook(vec3,slope,offset,power,sat)
    sdf       sdSegment(p,a,b) sdBox(p,b) sdCircle(p,r)
    easing    eInOutSine eOutCubic eInCubic eInOutCubic eInQuad eOutSine eInExpo (float -> float, input clamped)
    misc      rot2(a) (mat2), voronoiEdge(vec2) (F2-F1 distance, small at cell edges), ggx(N,V,L,rough,F0)
    sea       gerstner(vec2 xz, float t, float ampScale, out float h, out vec2 g): the 4-wave engraved swell of scene 4
*/

export const VERT_TRI = `#version 300 es
precision highp float;
out vec2 vUV;
void main(){
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUV = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const PRE = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
uniform vec2 uRes;
uniform float uScale;
uniform vec2 uFrame;
#define PI 3.14159265358979
#define TAU 6.28318530717959
vec2 pxToUV(vec2 px){ return vec2(px.x / uFrame.x, 1.0 - px.y / uFrame.y); }
vec4 clipOfPx(vec2 px){ return vec4(px.x / uFrame.x * 2.0 - 1.0, 1.0 - px.y / uFrame.y * 2.0, 0.0, 1.0); }
`;
const FRAG_HELPERS = `
vec2 framePx(){ return vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale; }
vec2 screenUV(){ return gl_FragCoord.xy / uRes; }
`;
const LIB = `

// ---------- hashing
uvec2 pcg2d(uvec2 v){
  v = v * 1664525u + 1013904223u;
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  v.x += v.y * 1664525u; v.y += v.x * 1664525u;
  v = v ^ (v >> 16u);
  return v;
}
float h12(vec2 p){ uvec2 q = pcg2d(uvec2(ivec2(floor(p)) + 32768)); return float(q.x) * (1.0/4294967296.0); }
vec2  h22(vec2 p){ uvec2 q = pcg2d(uvec2(ivec2(floor(p)) + 32768)); return vec2(q) * (1.0/4294967296.0); }
float h11(float x){ return h12(vec2(x, 17.0)); }
float h13(vec3 p){ uvec2 q = pcg2d(uvec2(ivec2(floor(p.xy)) + 32768) + uvec2(uint(int(floor(p.z)) + 32768) * 747796405u)); return float(q.x) * (1.0/4294967296.0); }

// ---------- value noise and fbm
float vn(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = h12(i), b = h12(i+vec2(1,0)), c = h12(i+vec2(0,1)), d = h12(i+vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float vn3(vec3 p){
  vec3 i = floor(p), f = fract(p);
  vec3 u = f*f*(3.0-2.0*f);
  float a = h13(i), b = h13(i+vec3(1,0,0)), c = h13(i+vec3(0,1,0)), d = h13(i+vec3(1,1,0));
  float e = h13(i+vec3(0,0,1)), g = h13(i+vec3(1,0,1)), k = h13(i+vec3(0,1,1)), l = h13(i+vec3(1,1,1));
  return mix(mix(mix(a,b,u.x), mix(c,d,u.x), u.y), mix(mix(e,g,u.x), mix(k,l,u.x), u.y), u.z);
}
const mat2 FBM_R = mat2(0.80, 0.60, -0.60, 0.80);
float fbm(vec2 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * vn(p); n += a; p = FBM_R * p * 2.03 + 17.13; a *= 0.5; }
  return s / n;
}
float fbm3(vec3 p, int oct){
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 8; i++){ if (i >= oct) break; s += a * vn3(p); n += a; p = p * 2.03 + 11.7; a *= 0.5; }
  return s / n;
}
vec2 curl2(vec2 p){
  const float e = 0.07;
  float n1 = fbm(p + vec2(0, e), 3), n2 = fbm(p - vec2(0, e), 3);
  float n3 = fbm(p + vec2(e, 0), 3), n4 = fbm(p - vec2(e, 0), 3);
  return vec2(n1 - n2, -(n3 - n4)) / (2.0 * e);
}
vec3 curl3(vec3 p){
  const float e = 0.1;
  vec3 dx = vec3(e,0,0), dy = vec3(0,e,0), dz = vec3(0,0,e);
  float a = vn3(p+dy) - vn3(p-dy), b = vn3(p+dz) - vn3(p-dz);
  float c = vn3(p+dz+31.0) - vn3(p-dz+31.0), d = vn3(p+dx+31.0) - vn3(p-dx+31.0);
  float f = vn3(p+dx+57.0) - vn3(p-dx+57.0), g = vn3(p+dy+57.0) - vn3(p-dy+57.0);
  return vec3(a - b, c - d, f - g) / (2.0 * e);
}

// ---------- colour
float luma(vec3 c){ return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 srgb2lin(vec3 c){ return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c)); }
vec3 lin2srgb(vec3 c){ c = max(c, 0.0); return mix(c * 12.92, 1.055 * pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c)); }
vec3 blackbody(float T){
  // Planckian locus approximation (Tanner Helland fit), returns linear RGB normalised to max 1
  T = clamp(T, 1000.0, 40000.0) / 100.0;
  vec3 c;
  c.r = T <= 66.0 ? 1.0 : clamp(1.29293618606 * pow(T - 60.0, -0.1332047592), 0.0, 1.0);
  c.g = T <= 66.0 ? clamp(0.39008157876 * log(T) - 0.63184144378, 0.0, 1.0) : clamp(1.12989086089 * pow(T - 60.0, -0.0755148492), 0.0, 1.0);
  c.b = T >= 66.0 ? 1.0 : (T <= 19.0 ? 0.0 : clamp(0.54320678911 * log(T - 10.0) - 1.19625408914, 0.0, 1.0));
  return srgb2lin(c);
}

// ---------- AgX (Sobotka; polynomial fit of the default contrast curve)
vec3 agxContrast(vec3 x){
  vec3 x2 = x*x, x4 = x2*x2;
  return 15.5*x4*x2 - 40.14*x4*x + 31.96*x4 - 6.868*x2*x + 0.4298*x2 + 0.1191*x - 0.00232;
}
vec3 agx(vec3 v){
  const mat3 M = mat3(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                      0.0784335999999992, 0.878468636469772, 0.0784336,
                      0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  const float lo = -12.47393, hi = 4.026069;
  v = M * max(v, 0.0);
  v = clamp(log2(max(v, 1e-10)), lo, hi);
  v = (v - lo) / (hi - lo);
  return agxContrast(v);
}
vec3 agxEotf(vec3 v){
  const mat3 Mi = mat3(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                       -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                       -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  v = Mi * v;
  return pow(max(v, 0.0), vec3(2.2));   // linear display (Rec.709)
}
vec3 agxLook(vec3 v, vec3 slope, vec3 offset, vec3 power, float sat){
  float l = luma(v);
  v = pow(max(v * slope + offset, 0.0), power);
  return l + sat * (v - l);
}

// ---------- SDF
float sdSegment(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-9), 0.0, 1.0); return length(pa - ba * h); }
float sdBox(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
float sdCircle(vec2 p, float r){ return length(p) - r; }

// ---------- easing (inputs clamped to [0,1])
float eInOutSine(float x){ x = clamp(x,0.,1.); return -(cos(PI*x) - 1.0) * 0.5; }
float eOutSine(float x){ x = clamp(x,0.,1.); return sin(x * PI * 0.5); }
float eOutCubic(float x){ x = clamp(x,0.,1.); return 1.0 - pow(1.0 - x, 3.0); }
float eInCubic(float x){ x = clamp(x,0.,1.); return x*x*x; }
float eInQuad(float x){ x = clamp(x,0.,1.); return x*x; }
float eInOutCubic(float x){ x = clamp(x,0.,1.); return x < 0.5 ? 4.0*x*x*x : 1.0 - pow(-2.0*x + 2.0, 3.0) * 0.5; }
float eInExpo(float x){ x = clamp(x,0.,1.); return x <= 0.0 ? 0.0 : pow(2.0, 10.0*x - 10.0); }

// ---------- misc
mat2 rot2(float a){ float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
float voronoiEdge(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(x, y); vec2 o = h22(i + g);
    float d = length(g + o - f);
    if (d < d1){ d2 = d1; d1 = d; } else if (d < d2){ d2 = d; }
  }
  return d2 - d1;
}
vec3 ggx(vec3 N, vec3 V, vec3 L, float rough, vec3 F0){
  vec3 H = normalize(V + L);
  float NoL = max(dot(N, L), 0.0), NoV = max(dot(N, V), 1e-4), NoH = max(dot(N, H), 0.0), VoH = max(dot(V, H), 0.0);
  float a = rough * rough, a2 = a * a;
  float dd = NoH * NoH * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * dd * dd);
  float k = (rough + 1.0); k = k * k / 8.0;
  float G = (NoL / (NoL * (1.0 - k) + k)) * (NoV / (NoV * (1.0 - k) + k));
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - VoH, 5.0);
  return D * G * F / (4.0 * NoV + 1e-4);   // times NoL folded in (NoL/(4 NoL NoV) * NoL)
}

// ---------- engraved swell (scene 4 spec): 4 Gerstner waves, lambda 18/9/4.5/2.1 m, A 0.6/0.3/0.12/0.05 m
void gerstner(vec2 xz, float t, float ampScale, out float h, out vec2 g){
  h = 0.0; g = vec2(0.0);
  const vec4 LAM = vec4(18.0, 9.0, 4.5, 2.1);
  const vec4 AMP = vec4(0.6, 0.3, 0.12, 0.05);
  const vec4 DIR = vec4(-0.35, 0.21, -0.61, 0.52);   // radians, spread within +-35 degrees
  for (int i = 0; i < 4; i++){
    float k = TAU / LAM[i];
    float w = sqrt(9.81 * k);
    vec2 d = vec2(sin(DIR[i]), cos(DIR[i]));
    float ph = k * dot(d, xz) - w * t + float(i) * 1.7;
    float a = AMP[i] * ampScale;
    h += a * sin(ph);
    g += a * k * cos(ph) * d;
  }
}
`;

export const HEADER = PRE + FRAG_HELPERS + LIB;
export const HEADER_VS = PRE + LIB;
export const FRAG_OUT = 'out vec4 o;\n';
export function frag(body) { return HEADER + body; }
