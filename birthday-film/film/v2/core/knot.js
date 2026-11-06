/*
  core/knot.js: knotwork. STUB (package P2 replaces the drawing internals; these signatures are final).

  Pure geometry (no GL):
    closedKnot(P, thMax, {samples = 3000}) -> Knot
        P(theta) -> [x, y] frame px, theta in [0, thMax). Resampled by arc length.
        Knot = {pts: Float32Array [x,y,...] (samples), s: Float32Array cumulative arc length, L,
                crossings: [{a, b, sa, sb, x, y, overIsA}]  (segment indices, arc lengths, position, which pass is over)}
        Over/under is assigned by walking the strand and alternating at every crossing passage.
    verifyKnot(knot) -> {ok, parity, alternation, components, crossings}
        parity: every crossing has exactly one over and one under; alternation: passages alternate along the strand;
        components: number of closed strands (1 for a single closed curve sampled from one parameterisation)

  GL (createKnot(G, gold)):
    K.band.rect(target, {rect:[x,y,w,h] (band centreline rectangle), width = 54, strands = 3, amp = 14, omega = 2*PI/72,
                         halfWidth = 7, gap = 2.5, progress = 1, start: [x,y] (reveal origin on the rectangle; both ways),
                         key, keyI, opacity})
    K.band.annulus(target, {center:[x,y], r0, r1, strands = 2, progress = 1, startAngle = -PI/2, rotation = 0,
                            key, keyI, fill, fillI, tincture: '#hex', opacity})
    K.texture(knot, {w, h, ribbon = 14, gapFactor = 2.2, outline = '#2A1A06'}) -> Tex
        data texture: R height, G coverage, B/A 16-bit arc length (fraction of L) for arc-length reveals
    K.draw(target, tex, {rect:[x,y,w,h], progress = 1, key, keyI, flare = 0, opacity = 1})
  The stub draws plain gold-leaf strokes (no braid weave, no gaps) so scenes can be laid out now.
*/
import { frag, HEADER_VS } from './glsl.js';

export function closedKnot(P, thMax, { samples = 3000 } = {}) {
  const N0 = samples * 8, raw = [];
  for (let i = 0; i <= N0; i++) raw.push(P(thMax * i / N0));
  const acc = [0];
  for (let i = 1; i <= N0; i++) acc.push(acc[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]));
  const L = acc[N0];
  const pts = new Float32Array(samples * 2), s = new Float32Array(samples);
  let j = 0;
  for (let i = 0; i < samples; i++) {
    const target = L * i / samples;
    while (j < N0 - 1 && acc[j + 1] < target) j++;
    const f = (target - acc[j]) / Math.max(1e-9, acc[j + 1] - acc[j]);
    pts[i * 2] = raw[j][0] + (raw[j + 1][0] - raw[j][0]) * f;
    pts[i * 2 + 1] = raw[j][1] + (raw[j + 1][1] - raw[j][1]) * f;
    s[i] = target;
  }
  // self-crossings (segment i: pts[i] -> pts[i+1 mod n])
  const n = samples, cr = [];
  const P2 = i => [pts[(i % n) * 2], pts[(i % n) * 2 + 1]];
  for (let a = 0; a < n; a++) {
    const [ax, ay] = P2(a), [bx, by] = P2(a + 1);
    for (let b = a + 2; b < n; b++) {
      if (a === 0 && b === n - 1) continue;
      const [cx, cy] = P2(b), [dx, dy] = P2(b + 1);
      const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (Math.abs(den) < 1e-12) continue;
      const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
      const v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
      if (u >= 0 && u < 1 && v >= 0 && v < 1) cr.push({ a, b, sa: s[a] + u * (L / n), sb: s[b] + v * (L / n), x: ax + u * (bx - ax), y: ay + u * (by - ay) });
    }
  }
  // walk the strand: passages sorted by arc length alternate over / under
  const pass = [];
  cr.forEach((c, k) => { pass.push({ s: c.sa, k, isA: true }); pass.push({ s: c.sb, k, isA: false }); });
  pass.sort((p, q) => p.s - q.s);
  pass.forEach((p, i) => { const over = i % 2 === 0; if (p.isA) cr[p.k].overIsA = over; else cr[p.k].overIsB = over; });
  return { pts, s, L, crossings: cr, _passes: pass };
}

export function verifyKnot(k) {
  const parity = k.crossings.every(c => c.overIsA !== c.overIsB);
  let alternation = true;
  for (let i = 0; i < k._passes.length; i++) {
    const p = k._passes[i], q = k._passes[(i + 1) % k._passes.length];
    const op = p.isA ? k.crossings[p.k].overIsA : k.crossings[p.k].overIsB;
    const oq = q.isA ? k.crossings[q.k].overIsA : k.crossings[q.k].overIsB;
    if (op === oq) alternation = false;
  }
  return { ok: parity && alternation, parity, alternation, components: 1, crossings: k.crossings.length };
}

const VS = HEADER_VS + `
uniform vec4 uRect;
out vec2 vPx;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 px = uRect.xy + c * uRect.zw; vPx = px;
  gl_Position = clipOfPx(px);
}`;
const FS_BAND = frag(`
uniform vec4 uBand;      // rect x, y, w, h (centreline)
uniform vec4 uRing;      // center x, y, r0, r1 (annulus mode when uMode == 1)
uniform int uMode; uniform float uWidth, uProgress, uOpacity, uKeyI;
uniform vec2 uKey;
in vec2 vPx;
out vec4 o;
void main(){
  float d, s, L;
  if (uMode == 1){
    vec2 q = vPx - uRing.xy; float r = length(q);
    d = abs(r - 0.5 * (uRing.z + uRing.w)) - 0.5 * (uRing.w - uRing.z);
    float a = atan(q.x, -q.y);                 // 0 at top, both ways
    s = abs(a) / PI; L = 1.0;
  } else {
    vec2 c = uBand.xy + 0.5 * uBand.zw;
    d = abs(sdBox(vPx - c, 0.5 * uBand.zw)) - 0.5 * uWidth;
    vec2 q = vPx - vec2(c.x, uBand.y + uBand.w);   // reveal from the bottom centre, both ways
    float per = uBand.z + uBand.w;
    float along = abs(q.x) <= 0.5 * uBand.z && abs(q.y) < 0.5 * uWidth + 1.0 ? abs(q.x)
                : (vPx.y > uBand.y + 0.5 * uWidth ? 0.5 * uBand.z + (uBand.y + uBand.w - vPx.y) : 0.5 * uBand.z + uBand.w + abs(vPx.x - c.x));
    s = along / per; L = 1.0;
  }
  float cov = (1.0 - smoothstep(-0.75, 0.75, d)) * step(s, uProgress) * uOpacity;
  if (cov <= 0.0){ o = vec4(0.0); return; }
  float rib = 0.5 + 0.5 * cos(clamp(-d / 7.0, 0.0, 1.0) * PI);
  vec3 F0 = vec3(1.0, 0.71, 0.29);
  vec3 L3 = normalize(vec3(uKey - vPx, 220.0));
  float sp = pow(max(L3.z * 0.5 + 0.5, 0.0), 24.0) * uKeyI;
  o = vec4(F0 * (0.25 + 0.6 * rib + sp) * cov, cov);
}`);
const FS_KNOT = frag(`
uniform sampler2D uTex; uniform vec4 uRect; uniform float uProgress, uOpacity, uKeyI, uFlare; uniform vec2 uKey;
in vec2 vPx;
out vec4 o;
void main(){
  vec2 uv = (vPx - uRect.xy) / uRect.zw;
  vec4 k = texture(uTex, uv);
  float s = k.b + k.a / 256.0;
  float cov = k.g * step(s, uProgress) * uOpacity;
  if (cov <= 0.0){ o = vec4(0.0); return; }
  vec3 F0 = vec3(1.0, 0.71, 0.29);
  o = vec4(F0 * (0.3 + 0.7 * k.r + uFlare) * cov * (1.0 + 0.2 * uKeyI), cov);
}`);

export function createKnot(G, gold) {
  const gl = G.gl;
  const band = G.program('knot.band', FS_BAND, VS);
  const kp = G.program('knot.draw', FS_KNOT, VS);
  const K = { band: {} };
  K.band.rect = function (target, o) {
    const r = o.rect, w = o.width || 54;
    G.draw(band, { uRect: [r[0] - w, r[1] - w, r[2] + 2 * w, r[3] + 2 * w], uBand: r, uMode: 0, uWidth: w, uProgress: o.progress == null ? 1 : o.progress,
      uOpacity: o.opacity == null ? 1 : o.opacity, uKey: o.key || [r[0], r[1]], uKeyI: o.keyI == null ? 1 : o.keyI }, target, { blend: 'add', mode: gl.TRIANGLE_STRIP, count: 4 });
  };
  K.band.annulus = function (target, o) {
    const [cx, cy] = o.center, r1 = o.r1;
    G.draw(band, { uRect: [cx - r1 - 4, cy - r1 - 4, 2 * r1 + 8, 2 * r1 + 8], uRing: [cx, cy, o.r0, r1], uMode: 1, uProgress: o.progress == null ? 1 : o.progress,
      uOpacity: o.opacity == null ? 1 : o.opacity, uKey: o.key || [cx, cy - r1], uKeyI: o.keyI == null ? 1 : o.keyI }, target, { blend: 'add', mode: gl.TRIANGLE_STRIP, count: 4 });
  };
  K.texture = function (knot, { w, h, ribbon = 14, x0 = 0, y0 = 0 } = {}) {
    // stub raster: coverage + arc length along the polyline (no over/under gaps yet)
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const x = cv.getContext('2d');
    x.lineWidth = ribbon; x.lineCap = 'round'; x.lineJoin = 'round';
    const n = knot.pts.length / 2;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n, f = knot.s[i] / knot.L;
      const b = Math.floor(f * 255), a = Math.floor((f * 255 - b) * 255);
      x.strokeStyle = `rgb(255,255,${b})`; x.globalAlpha = 1;
      x.beginPath(); x.moveTo(knot.pts[i * 2] - x0, knot.pts[i * 2 + 1] - y0); x.lineTo(knot.pts[j * 2] - x0, knot.pts[j * 2 + 1] - y0); x.stroke();
      void a;
    }
    return G.texture(cv, { mips: false });
  };
  K.draw = function (target, tex, o) {
    G.draw(kp, { uRect: o.rect, uTex: tex, uProgress: o.progress == null ? 1 : o.progress, uOpacity: o.opacity == null ? 1 : o.opacity,
      uKey: o.key || [o.rect[0], o.rect[1]], uKeyI: o.keyI == null ? 1 : o.keyI, uFlare: o.flare || 0 }, target, { blend: 'add', mode: gl.TRIANGLE_STRIP, count: 4 });
  };
  void gold;
  return K;
}
