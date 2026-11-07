/*
  Scene 4: two-shores (30.0-54.0), package P6.
  The engraved gold ocean (core/sea.js engraved()) under a night sky, horizon y 430. Two warm lights on the horizon
  (the west light on the left, the east light on the right) with reflection columns in the hatch; a gold arc drawn right to left between them
  (31.0-34.0, travelling pen tip); a warm band travels along it (37.0-40.4) and stays on the left 30 percent
  while the right end cools; the lit segment pulses once per bar (42.0-47.4); five meridians fall one per chime
  (events 'chimes', 48-52) and unroll across the sea as reflection columns; leader-line captions at 48 and 52;
  53.2-54.0 the scene dims toward dusk. The hatch fades under the narrative captions (a blurred caption mask).
  Continuity: 30.0-31.0 continues scene 3's tilt (the horizon slides from y 540 to 430, the gold hairline of scene 3
  is the horizon rule and fades to an engraver's faint rule by 32.0).

  Exported for scene 3 (its crossfade into this sea) and scene 9 (the same ocean in flight):
    shoresLayout(ctx)              per-layout numbers of the build sheet
    shoresHz(ctx, t)               horizon y at absolute time t (the 29.0-31.0 tilt included)
    shoresCam(ctx, t)              the scene-4 sea camera at absolute time t (valid for t < 30 too)
    shoresSea(ctx, t)              S.engraved options at absolute time t (lights faded in from 30.0)
    toScene(ctx, hex, look)        display hex -> scene linear under a look (gamut-safe)
    createShoreFx(ctx)             {draw(target, u, {viewport, smear, smearN})}: arc, lights, meridians, leaders, rule
    createShield(ctx, key)         {build(entries) -> half-res RT}: blurred caption mask for the engraved shield
*/
const T0 = 30.0;

export function shoresLayout(ctx) {
  if (ctx.portrait) return {
    hz: 820, hz0: 960, west: [150, 820], east: [930, 820], ctrl: [540, 300], merX: k => 930 - 156 * k,
    textY: 1500, capY: 742, textSize: 52 * 0.9, clamp: [54, 1026], breaks: { L4: [4], L5: [6] },
  };
  return {
    hz: 430, hz0: 540, west: [230, 430], east: [1690, 430], ctrl: [960, 70], merX: k => 1690 - 292 * k,
    textY: 880, capY: 352, textSize: 52, clamp: [96, 1824], breaks: {},
  };
}
export function shoresHz(ctx, t) {
  const L = shoresLayout(ctx);
  return L.hz0 + (L.hz - L.hz0) * ctx.tl.seg(t, 29.0, 31.0, ctx.tl.E.inOutSine);
}
export function shoresCam(ctx, t) {
  const e = t - T0;
  return { h: 40, x: 0.5 * e, z: 3 * e, pitch: ctx.horizonPitch(shoresHz(ctx, t), ctx.H, 0.6), fovY: 0.6 };
}
// light intensity envelope (both lights), the west light's arrival boost, and the 53.2-54.0 dusk dim is applied by post
function lightsAt(ctx, t) {
  const tl = ctx.tl;
  const on = tl.seg(t, 30.0, 31.4, tl.E.inOutSine);
  const westBoost = 1 + 0.5 * tl.seg(t, 40.4, 40.9, tl.E.outCubic);
  return { west: on * westBoost, east: on };
}
export function shoresSea(ctx, t) {
  const L = shoresLayout(ctx), li = lightsAt(ctx, t);
  return {
    tau: t - T0, cam: shoresCam(ctx, t), stars: 0.35, look: 'night_sea',
    lights: [[L.west[0], 1.0 * li.west, 1, 18], [L.east[0], 1.0 * li.east, 1, 18]],
  };
}

// display hex -> scene-linear value that the look shows as that hex; colours the grade cannot reach keep their hue at
// the highest reachable level
const _col = new Map();
export function toScene(ctx, h, look = 'night_sea', gain = 1) {
  const k = look + h;
  if (!_col.has(k)) {
    const P = ctx.post.params(look);
    const t = ctx.hex(h);
    let out = null;
    for (const f of [1, 0.95, 0.9, 0.85, 0.8, 0.7, 0.6, 0.5]) {
      const tf = t.map(x => x * f);
      const sc = ctx.displayToScene(tf, P);
      const back = ctx.sceneToDisplay(sc, P);
      if (Math.max(...back.map((x, i) => Math.abs(x - tf[i]))) < 5 / 255 && Math.max(...sc) < 40) { out = sc; break; }
    }
    _col.set(k, out || ctx.hexLin(h));
  }
  return _col.get(k).map(v => v * gain);
}

// ------------------------------------------------------------------ the shore overlay (additive HDR)
const FX_FS = `
uniform vec2 uA, uB, uC; uniform float uLen; uniform float uLut[17];
uniform float uProg, uArcOn, uTau, uK;
uniform vec3 uGold, uLitC, uCoolC, uHazeC, uHotC, uWhite, uMerC, uLeadC, uRuleC;
uniform vec4 uArcK;      // base I, lit I, glow, shimmer
uniform vec4 uBand;      // centre (px along the arc from the east light), sigma px, I, haze I
uniform vec4 uPark;      // lit segment start (px), trail end (px), amount, cool
uniform vec3 uTip;       // pen tip x, y, I
uniform vec4 uLt[2];     // lights: x, y, I, halo px
uniform vec4 uLtS;       // streak length px, streak I, core radius px, flare
uniform vec4 uMer[5];    // meridian x, top y, front y, I
uniform vec4 uMerF[5];   // top glint I, landing flash I, head I, horizon y
uniform vec4 uLead[2];   // leader x, y0, y1, alpha
uniform vec4 uRule;      // horizon rule: y at the frame centre, I, angle (rad), unused
uniform float uRoll;     // horizon roll (rad): the lights' streaks follow it
uniform vec2 uSmear; uniform int uSmearN;
uniform sampler2D uKnock; uniform int uHasKnock;   // caption knock-out: lines break around the captions
uniform int uPart, uIdx;  // compiled per element (PART: 1 arc, 2 light halo, 6 light streak, 3 meridian, 4 leader, 5 rule); uIdx picks the item
uniform vec2 uBoxR;       // half size of the current light's box (the halo is windowed to zero inside it)
out vec4 o;
float sq(float x){ return x * x; }
// distance to a quadratic Bezier and the parameter of the closest point (after Inigo Quilez)
vec2 sdBez(vec2 pos, vec2 A, vec2 B, vec2 C){
  vec2 a = B - A, b = A - 2.0 * B + C, c = a * 2.0, d = A - pos;
  float kk = 1.0 / dot(b, b);
  float kx = kk * dot(a, b), ky = kk * (2.0 * dot(a, a) + dot(d, b)) / 3.0, kz = kk * dot(d, a);
  float p = ky - kx * kx, q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q * q + 4.0 * p * p * p;
  if (h >= 0.0){
    h = sqrt(h);
    vec2 x = (vec2(h, -h) - q) / 2.0;
    vec2 uv = sign(x) * pow(abs(x), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    vec2 qq = d + (c + b * t) * t;
    return vec2(length(qq), t);
  }
  float z = sqrt(-p);
  float v = acos(clamp(q / (p * z * 2.0), -1.0, 1.0)) / 3.0;
  float m = cos(v), n = sin(v) * 1.732050808;
  vec3 t = clamp(vec3(m + m, -n - m, n - m) * z - kx, 0.0, 1.0);
  vec2 qx = d + (c + b * t.x) * t.x, qy = d + (c + b * t.y) * t.y;
  float dx = dot(qx, qx), dy = dot(qy, qy);
  return dx < dy ? vec2(sqrt(dx), t.x) : vec2(sqrt(dy), t.y);
}
// analytic box filters (shutter smear): antiderivatives of the line core clamp(h + 0.5 - |x|, 0, 1) and of exp(-|x|/s)
float Gc(float x, float h){
  float a = abs(x), l = h - 0.5;
  float g = a < l ? a : (a < h + 0.5 ? l + (h + 0.5) * (a - l) - 0.5 * (a * a - l * l) : h);
  return sign(x) * g;
}
float Ge(float x, float s){ return sign(x) * s * (1.0 - exp(-abs(x) / s)); }
// mean of (core(h) + g1 exp(-|x|/s1) + g2 exp(-|x|/s2)) over [x - v/2, x + v/2]
float lineBox(float x, float v, float h, float g1, float s1, float g2, float s2){
  if (v < 0.5){ float a = abs(x); return clamp(h + 0.5 - a, 0.0, 1.0) + g1 * exp(-a / s1) + g2 * exp(-a / s2); }
  float lo = x - 0.5 * v, hi = x + 0.5 * v;
  return (Gc(hi, h) - Gc(lo, h) + g1 * (Ge(hi, s1) - Ge(lo, s1)) + g2 * (Ge(hi, s2) - Ge(lo, s2))) / v;
}
float arcS(float t){ float x = t * 16.0; int i = int(min(floor(x), 15.0)); return mix(uLut[i], uLut[i + 1], x - float(i)) * uLen; }
float star4(vec2 q, float s){
  vec2 a = abs(q);
  return exp(-a.y * a.y / 0.7) * exp(-a.x / s) + exp(-a.x * a.x / 0.7) * exp(-a.y / s) + 1.6 * exp(-dot(q, q) / (0.02 * s * s + 1.0));
}
vec3 shade(vec2 p){
  vec3 c = vec3(0.0), cf = vec3(0.0);
  // the arc: gold line, the warm band and its lit trail, the cooled right end
#if PART == 1
  if (uArcOn > 0.0){
    vec2 pm = p - 0.5 * uSmear;                       // the arc at mid-shutter
    vec2 bz = sdBez(pm, uA, uB, uC);
    float d = bz.x;
    float tt = bz.y;
    vec2 Bt = mix(mix(uA, uB, tt), mix(uB, uC, tt), tt);
    vec2 tg = normalize(mix(uB - uA, uC - uB, tt) + 1e-6);
    vec2 nr = vec2(-tg.y, tg.x);
    float sd = dot(pm - Bt, nr);
    float vsw = abs(dot(uSmear, nr));
    if (d < 90.0 + vsw){
      float s = arcS(bz.y);
      float drawn = clamp((uProg * uLen - s) / 3.0 + 0.5, 0.0, 1.0);
      if (drawn > 0.0){
        float band = uBand.z * exp(-0.5 * sq((s - uBand.x) / uBand.y));
        float trail = uPark.z * smoothstep(uPark.x - 40.0, uPark.x + 40.0, s) * smoothstep(uPark.y + 30.0, uPark.y - 30.0, s);
        float lit = max(band, trail);
        float k = clamp(lit, 0.0, 1.0);
        float cool = uPark.w * (1.0 - smoothstep(0.18 * uLen, 0.68 * uLen, s));
        vec3 base = mix(uGold, uCoolC, cool) * mix(1.0, 0.75, cool);
        vec3 col = mix(base * uArcK.x, uLitC * uArcK.y, k) * (1.0 + 0.6 * max(lit - 1.0, 0.0));
        float sh = 1.0 + uArcK.w * (vn(vec2(s * 0.045, uTau * 0.7)) - 0.5);
        float gk = uArcK.z * (1.0 + 1.6 * k) * (1.0 - 0.6 * cool);
        float prof = lineBox(vsw < 0.5 ? d : sd, vsw, 1.0, 0.20 * gk, 2.2, 0.05 * gk, 9.0);
        c += col * prof * sh * drawn;
        c += uHazeC * (band + 0.3 * trail) * uBand.w * (exp(-0.5 * d * d / (9.0 * 9.0)) + 0.35 * exp(-0.5 * d * d / (22.0 * 22.0))) * drawn;
      }
    }
    // the travelling pen tip
    if (uTip.z > 0.0){
      vec2 q = p - uTip.xy; float r2 = dot(q, q);
      c += (uWhite * 3.5 * exp(-r2 / 2.5) + uLitC * (0.8 * exp(-sqrt(r2) / 3.5) + 0.07 * exp(-sqrt(r2) / 12.0))) * uTip.z;
    }
    c *= uArcOn;
  }
#endif
#if PART == 2 || PART == 6
  // the two lights: a 4 px white-gold core, a halo, a horizontal streak
  float vl = length(uSmear);
  {
    vec4 L = uLt[uIdx];
    // over the shutter a light sweeps the segment L -> L + smear: each term is evaluated at the distance to that
    // segment and scaled by the fraction of the shutter it covers a pixel (a box filter of a radial profile)
    vec2 a = p - L.xy;
    float hh = vl > 0.5 ? clamp(dot(a, uSmear) / (vl * vl), 0.0, 1.0) : 0.0;
    vec2 q = rot2(uRoll) * (a - uSmear * hh);
    float r = length(q);
    float k1 = min(1.0, (2.0 * uLtS.z + 1.0) / max(vl, 1e-3)), kh = L.w * 0.16, kw = L.w * 0.5;
    float core = smoothstep(uLtS.z + 0.9, uLtS.z - 0.9, r) * k1;
    float halo = 0.75 * exp(-r / kh) * min(1.0, 2.0 * kh / max(vl, 1e-3)) + 0.26 * exp(-r / kw) * min(1.0, 2.0 * kw / max(vl, 1e-3));
    float streak = exp(-abs(q.x) / uLtS.x) * (exp(-q.y * q.y / 1.2) * min(1.0, 2.2 / max(vl, 1e-3)) + 0.25 * exp(-q.y * q.y / 18.0) * min(1.0, 8.5 / max(vl, 1e-3)));
    // part 2 is the core and halo (a square box), part 6 the streak (a long thin box): two draws, no overlap counted twice
#if PART == 6
    core = 0.0; halo = 0.0;
#endif
    vec2 bq = abs(p - L.xy - 0.5 * uSmear) / max(uBoxR - 0.5 * abs(uSmear), vec2(1.0));
    // the halo is windowed to its square box, the streak to its own length (it runs on through the halo box)
    float winH = 1.0 - smoothstep(0.55, 1.0, max(bq.x, bq.y));
    float winS = 1.0 - smoothstep(0.55, 1.0, abs(q.x) / (5.5 * uLtS.x));
    cf += (uWhite * core * 7.0 * winH + uLitC * (halo * 1.6 * winH + streak * uLtS.y * winS) + uWhite * uLtS.w * star4(q, 26.0) * 0.6 * k1 * winH) * L.z;
  }
#endif
#if PART == 3
  // meridians: 1.5 px gold lines from the arc to the horizon with a travelling white-gold head
  {
    vec4 M = uMer[uIdx]; vec4 F = uMerF[uIdx];
    float dx = abs(p.x - M.x);
    if (M.w > 0.0){
      float inside = clamp(p.y - M.y + 0.5, 0.0, 1.0) * clamp(M.z - p.y + 0.5, 0.0, 1.0);
      float core = clamp(1.25 - dx, 0.0, 1.0);
      float glow = 0.26 * exp(-dx / 2.0) + 0.07 * exp(-dx / 6.0);
      c += uMerC * (core + glow) * inside * M.w;
      if (F.z > 0.0){ vec2 hq = p - vec2(M.x, M.z); c += (uWhite * 2.2 * exp(-dot(hq, hq) / 3.0) + uHotC * 0.35 * exp(-length(hq) / 7.0)) * F.z; }
    }
    if (F.x > 0.0) c += uHotC * star4(p - vec2(M.x, M.y), 9.0) * F.x;
    if (F.y > 0.0){ vec2 fq = p - vec2(M.x, F.w); c += uLitC * (exp(-length(fq) / 5.0) * 1.2 + 0.25 * exp(-length(fq * vec2(0.25, 1.0)) / 6.0)) * F.y; }
  }
#endif
#if PART == 4
  // leader lines (1.2 px) from each caption down to its light
  {
    vec4 L = uLead[uIdx];
    float dx = abs(p.x - L.x);
    float inside = clamp(p.y - L.y + 0.5, 0.0, 1.0) * clamp(L.z - p.y + 0.5, 0.0, 1.0);
    cf += uLeadC * (clamp(1.1 - dx, 0.0, 1.0) + 0.16 * exp(-dx / 2.0)) * inside * L.w;
  }
#endif
#if PART == 5
  // the horizon rule (scene 3's hairline, fading to an engraver's rule)
  {
    vec2 rn = vec2(-sin(uRule.z), cos(uRule.z));
    float sdr = dot(p - uSmear * 0.5 - vec2(uFrame.x * 0.5, uRule.x), rn);
    float vr = abs(dot(uSmear, rn));
    float core = lineBox(sdr, vr, 0.75, 0.0, 1.0, 0.0, 1.0), glow = lineBox(sdr, vr, 0.0, 0.30, 2.0, 0.08, 6.0);
    c += (uHotC * core + uRuleC * glow) * uRule.y;
  }
#endif
  if (uHasKnock == 1) c *= 1.0 - texture(uKnock, pxToUV(p)).a;
  return c + cf;
}
void main(){
  vec3 c = shade(framePx());
  o = vec4(c * uK, 0.0);
}`;

export function createShoreFx(ctx, look = 'night_sea') {
  const { G, glsl } = ctx;
  const progs = {};
  for (const n of [1, 2, 3, 4, 5, 6]) progs[n] = G.program('p6.shorefx.' + n, glsl.frag('#define PART ' + n + '\n' + FX_FS));
  const C = h => toScene(ctx, h, look);
  const col = {
    uGold: C('#E3B341'), uLitC: C('#FFE7A3'), uCoolC: C('#6E4A12'), uHazeC: C('#E39A4C'), uHotC: C('#FFF4D6'),
    uWhite: [1.0, 0.93, 0.80], uMerC: C('#E9C676'), uLeadC: C('#C9A24A'), uRuleC: C('#D4A64A'),
  };
  // arc length table of a quadratic Bezier (normalised at t = k/16)
  function arc(A, B, Cc) {
    const N = 256, pts = [];
    for (let i = 0; i <= N; i++) { const t = i / N, u = 1 - t; pts.push([u * u * A[0] + 2 * u * t * B[0] + t * t * Cc[0], u * u * A[1] + 2 * u * t * B[1] + t * t * Cc[1]]); }
    const cum = [0];
    for (let i = 1; i <= N; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = cum[N];
    const lut = new Float32Array(17); for (let k = 0; k <= 16; k++) lut[k] = cum[k * 16] / len;
    const at = s => { // point at arc length s (px from A)
      let i = 1; while (i < N && cum[i] < s) i++;
      const f = (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1]);
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    };
    const yAtX = x => { let best = pts[0], bd = 1e9; for (const p of pts) { const d = Math.abs(p[0] - x); if (d < bd) { bd = d; best = p; } } return best[1]; };
    return { len, lut, at, yAtX };
  }
  const empty = {
    uArcOn: 0, uProg: 0, uTip: [0, 0, 0], uLt: new Float32Array(8), uLtS: [120, 0.5, 2, 0], uMer: new Float32Array(20), uMerF: new Float32Array(20),
    uLead: new Float32Array(8), uRule: [0, 0, 0, 0], uBand: [0, 110, 0, 0], uPark: [0, 0, 0, 0], uArcK: [1, 1, 1, 0.25], uK: 1, uSmear: [0, 0], uSmearN: 1,
    uKnock: null, uHasKnock: 0, uRoll: 0, uPart: 0, uIdx: 0, uBoxR: [1, 1],
  };
  return {
    arc,
    // one viewport-limited draw per element (arc, each light, each meridian, each leader, the rule)
    draw(target, u0, o = {}) {
      const u = Object.assign({}, empty, col, u0);
      const s = target.scale == null ? 1 : target.scale;
      const sm = u.uSmear || [0, 0], ax = Math.abs(sm[0]), ay = Math.abs(sm[1]);
      const lim = o.viewport || [0, 0, ctx.W, ctx.H];
      // boxes are grown by the smear in y always, in x only when exX (boxes that tile in x pass exact edges)
      const box = (x0, y0, x1, y1, part, idx, exX = true) => {
        const gx = exX ? ax : 0;
        x0 = Math.max(x0 - gx, lim[0]); y0 = Math.max(y0 - ay, lim[1]); x1 = Math.min(x1 + gx, lim[0] + lim[2]); y1 = Math.min(y1 + ay, lim[1] + lim[3]);
        const gx0 = Math.max(0, Math.floor(x0 * s)), gx1 = Math.min(target.w, Math.ceil(x1 * s));
        const gy0 = Math.max(0, Math.floor((ctx.H - y1) * s)), gy1 = Math.min(target.h, Math.ceil((ctx.H - y0) * s));
        if (gx1 <= gx0 || gy1 <= gy0) return;
        u.uPart = part; u.uIdx = idx;
        G.draw(progs[part], u, target, { blend: 'add', viewport: [gx0, gy0, gx1 - gx0, gy1 - gy0] });
      };
      if (u.uArcOn > 0) {
        // non-overlapping x columns that hug the curve (x is monotonic along these arcs)
        const N = 64, pts = [];
        for (let i = 0; i <= N; i++) { const t = i / N, v = 1 - t; pts.push([v * v * u.uA[0] + 2 * v * t * u.uB[0] + t * t * u.uC[0], v * v * u.uA[1] + 2 * v * t * u.uB[1] + t * t * u.uC[1]]); }
        const xl = Math.min(...pts.map(q => q[0])), xr = Math.max(...pts.map(q => q[0]));
        const M = 80, C = 14, edges = [];
        for (let i = 0; i <= C; i++) edges.push(i === 0 ? xl - M - ax : i === C ? xr + M + ax : xl + (xr - xl) * i / C);
        for (let i = 0; i < C; i++) {
          const a = edges[i], b2 = edges[i + 1];
          const ys = pts.filter(q => q[0] >= a - M - ax && q[0] <= b2 + M + ax).map(q => q[1]);
          if (!ys.length) continue;
          box(a, Math.min(...ys) - M, b2, Math.max(...ys) + M, 1, 0, false);
        }
      }
      for (let i = 0; i < 2; i++) {
        const L = [u.uLt[i * 4], u.uLt[i * 4 + 1], u.uLt[i * 4 + 2], u.uLt[i * 4 + 3]];
        if (L[2] > 0) {
          const r = 3.6 * L[3];
          u.uBoxR = [r, r]; box(L[0] - r - ax, L[1] - r, L[0] + r + ax, L[1] + r, 2, i, false);
          const sx = 5.5 * u.uLtS[0], sy = 24 + Math.abs(Math.sin(u.uRoll || 0)) * sx;
          u.uBoxR = [sx, r];
          box(L[0] - sx - ax, L[1] - sy, L[0] - r - ax, L[1] + sy, 6, i, false); box(L[0] + r + ax, L[1] - sy, L[0] + sx + ax, L[1] + sy, 6, i, false);
        }
      }
      for (let k = 0; k < 5; k++) {
        const M = [u.uMer[k * 4], u.uMer[k * 4 + 1], u.uMer[k * 4 + 2], u.uMer[k * 4 + 3]], F = [u.uMerF[k * 4], u.uMerF[k * 4 + 1], u.uMerF[k * 4 + 2], u.uMerF[k * 4 + 3]];
        if (M[3] > 0 || F[0] > 0 || F[1] > 0) box(M[0] - 72, M[1] - 40, M[0] + 72, Math.max(M[2], F[3]) + 40, 3, k);
      }
      for (let i = 0; i < 2; i++) {
        const L = [u.uLead[i * 4], u.uLead[i * 4 + 1], u.uLead[i * 4 + 2], u.uLead[i * 4 + 3]];
        if (L[3] > 0) box(L[0] - 12, L[1] - 6, L[0] + 12, L[2] + 6, 4, i);
      }
      if (u.uRule[1] > 0) {
        const span = Math.abs(Math.tan(u.uRule[2])) * ctx.W / 2;
        box(0, u.uRule[0] - span - 30, ctx.W, u.uRule[0] + span + 30, 5, 0);
      }
    },
  };
}

// ------------------------------------------------------------------ caption shield: blurred caption mask (half res)
const SHIELD_FS = `
uniform sampler2D uMask; uniform vec4 uRect; uniform float uOp;
out vec4 o;
void main(){
  vec2 px = framePx();
  vec2 q = (px - uRect.xy) / uRect.zw;
  vec2 uv = vec2(q.x, 1.0 - q.y);
  float a2 = textureLod(uMask, uv, 2.0).a, a4 = textureLod(uMask, uv, 4.0).a;
  float s = clamp(a2 * 2.4 + a4 * 1.7, 0.0, 1.0) * uOp;
  o = vec4(s, s, s, s);
}`;
export function createShield(ctx, key) {
  const { G, glsl, text } = ctx;
  const prog = G.program('p6.shield', glsl.frag(SHIELD_FS));
  return {
    build(entries) {
      const rt = G.target('p6.shield.' + key, ctx.W / 2, ctx.H / 2, { scale: 0.5 });
      G.clear(rt, [0, 0, 0, 0]);
      let any = false;
      for (const e of entries) {
        const lay = text.layout(e);
        if (!lay.anim.shown) continue;
        const m = text.drawMask(e);
        if (m.lineOpacity > 0) {
          const r = m.rect, pad = 44;
          const x0 = Math.max(0, Math.floor((r[0] - pad) / 2)), x1 = Math.min(rt.w, Math.ceil((r[0] + r[2] + pad) / 2));
          const y0 = Math.max(0, Math.floor((ctx.H - (r[1] + r[3] + pad)) / 2)), y1 = Math.min(rt.h, Math.ceil((ctx.H - (r[1] - pad)) / 2));
          if (x1 > x0 && y1 > y0) {
            G.draw(prog, { uMask: m.rt, uRect: r, uOp: m.lineOpacity }, rt, { blend: 'max', viewport: [x0, y0, x1 - x0, y1 - y0] });
            any = true;
          }
        }
        text.releaseMask(m);
      }
      return any ? rt : null;
    },
  };
}

// ------------------------------------------------------------------ the scene
const scene = {
  id: 's04_two_shores', t0: 30.0, t1: 54.0, internalScale: 1, look: 'night_sea',
  async init(ctx) {
    this.L = shoresLayout(ctx);
    this.fx = createShoreFx(ctx);
    this.shield = createShield(ctx, 's04');
    this.knock = createShield(ctx, 's04caps');
    const L = this.L;
    this.arc = this.fx.arc(L.east, L.ctrl, L.west);
    this.merTop = [1, 2, 3, 4, 5].map(k => this.arc.yAtX(L.merX(k)));
    this.hereRange = ctx.text.wordRange('L4', -1);
    const ch = ctx.events('chimes').map(e => e.t);
    this.chimes = ch.length === 5 ? ch : [48, 49, 50, 51, 52];
  },
  narrative(ctx, t) {
    const L = this.L;
    const st = { base: 'narrative', size: L.textSize };
    const mk = (id, t0, extra = {}) => Object.assign({ lineId: id, tau: t - t0, x: ctx.W / 2, y: L.textY, style: st, exit: { at: 4.4, kind: 'mist' } },
      L.breaks[id] ? { breaks: L.breaks[id] } : {}, extra);
    return [
      mk('L3', 30.0),
      mk('L4', 36.0, { tints: [{ part: this.hereRange, color: '#E3B341', at: 4.4, dur: 0.6 }] }),
      mk('L5', 42.0),
    ].filter(e => e.tau > -0.01 && e.tau < 6.0);
  },
  render(ctx, tau, p, target) {
    const t = T0 + tau;
    const shield = this.shield.build(this.narrative(ctx, t));
    const o = Object.assign(shoresSea(ctx, t), { shield, shieldK: 0.94 });
    for (let k = 0; k < 5; k++) {
      const tk = this.chimes[k];
      const reach = ctx.tl.seg(t, tk + 0.45, tk + 2.4, ctx.tl.E.inOutSine);
      if (reach > 0) o.lights.push([this.L.merX(k + 1), 0.85 * this.breath(t, k), reach, 9]);
    }
    ctx.sea.engraved(target, o);
    // the arc, lights and meridians are drawn into the scene target (not the overlay) so the ink-bleed into scene 5
    // dissolves them with the sea
    this.drawFx(ctx, tau, target);
  },
  breath(t, k) {
    const tk = this.chimes[k];
    const a = 0.12 * Math.min(1, Math.max(0, (t - tk - 0.6) / 0.8));
    return 1 + a * Math.sin(2 * Math.PI * 0.25 * (t - tk) + k * 1.37);
  },
  // arc, band, lights, meridians, leaders at absolute time t
  fxUniforms(ctx, t) {
    const { tl } = ctx, E = tl.E, L = this.L, A = this.arc;
    const hz = shoresHz(ctx, t);
    const li = lightsAt(ctx, t);
    const u = { uA: L.east, uB: L.ctrl, uC: L.west, uLen: A.len, uLut: A.lut, uTau: t - T0 };
    // 31.0-34.0 the arc draws from the east light to the west light
    const prog = tl.seg(t, 31.0, 34.0, E.inOutSine);
    u.uArcOn = prog > 0 ? 1 : 0; u.uProg = prog;
    const tipI = prog > 0 && prog < 1 ? 1 : Math.max(0, 1 - (t - 34.0) / 0.35) * (t >= 34.0 ? 1 : 0);
    const tp = A.at(prog * A.len);
    u.uTip = [tp[0], tp[1], tipI * 1.3];
    // 37.0-40.4 the band travels east -> west and stays on the left 30 %
    const bc = A.len * tl.seg(t, 37.0, 40.4, E.inOutSine);
    const bandI = tl.seg(t, 37.0, 37.5) * (1 - 0.65 * tl.seg(t, 40.4, 41.2, E.inOutSine));
    u.uBand = [bc, 115, 1.15 * bandI, 0.30];
    const pulse = 1 + 0.10 * Math.cos(2 * Math.PI * (t - 42.0) / 3.0) * tl.seg(t, 41.6, 42.4) * (1 - tl.seg(t, 47.0, 47.6));
    const trail = tl.seg(t, 38.6, 39.2) * pulse;
    u.uPark = [0.70 * A.len, bc, trail, tl.seg(t, 40.4, 42.4, E.inOutSine)];
    u.uArcK = [0.85, 1.35, 1.0, 0.22];
    // lights
    const sc = ctx.U;
    u.uLt = new Float32Array([L.west[0], hz, li.west, 40 * sc, L.east[0], hz, li.east, 40 * sc]);
    u.uLtS = [120 * sc, 0.45, 2.0, 0.0];
    // meridians
    const mer = new Float32Array(20), merF = new Float32Array(20);
    for (let k = 0; k < 5; k++) {
      const tk = this.chimes[k];
      if (t < tk) continue;
      const x = L.merX(k + 1), top = this.merTop[k] + (hz - L.hz);
      const d = tl.seg(t, tk, tk + 0.6, E.outCubic);
      const fade = 1 - tl.seg(t, 53.2, 54.0, E.inOutSine) * 0.3;
      mer.set([x, top, top + (hz - top) * d, 0.95 * this.breath(t, k) * fade], k * 4);
      const head = d < 1 ? 1 : Math.max(0, 1 - (t - tk - 0.6) / 0.3);
      const flash = t > tk + 0.42 ? Math.exp(-(t - tk - 0.42) / 0.35) : 0;
      merF.set([1.3 * Math.exp(-(t - tk) / 0.45), 0.6 * flash, 1.2 * head, hz], k * 4);
    }
    u.uMer = mer; u.uMerF = merF;
    // leaders (grow 0.6 s from each caption's start; fade with the captions)
    const lead = new Float32Array(8);
    const fadeC = 1 - tl.seg(t, 53.2, 54.0, E.inOutSine);
    [[L.east[0], 48.0], [L.west[0], 52.0]].forEach(([x, ta], i) => {
      if (t < ta) return;
      const g = tl.seg(t, ta, ta + 0.6, E.outCubic);
      const y0 = L.capY + 12 * sc, len = hz - 4 * sc - y0;
      lead.set([x, y0, y0 + len * g, 0.9 * fadeC], i * 4);
    });
    u.uLead = lead;
    // horizon rule: scene 3's hairline at full strength at 30.0, an engraver's faint rule from 32.0
    const ruleI = 0.10 + 0.9 * (1 - tl.seg(t, 30.0, 32.0, E.inOutSine));
    u.uRule = [hz, ruleI, 0, 0];
    u.uK = 1;
    return u;
  },
  drawFx(ctx, tau, target) {
    const t = T0 + tau;
    const hz = shoresHz(ctx, t);
    const u = this.fxUniforms(ctx, t);
    const caps = this.captions(ctx, tau).filter(e => e.lineId === 'L6a' || e.lineId === 'L6b');
    const kn = caps.length ? this.knock.build(caps) : null;
    if (kn) { u.uKnock = kn; u.uHasKnock = 1; }
    this.fx.draw(target, u, { viewport: [0, 0, ctx.W, hz + 400] });
  },
  captions(ctx, tau) {
    const t = T0 + tau, L = this.L;
    const out = this.narrative(ctx, t);
    const cap = { base: 'caps', size: 22, tracking: 0.34 };
    if (t >= 47.9) out.push({ lineId: 'L6a', tau: t - 48.0, x: L.east[0], y: L.capY, style: cap, clampX: L.clamp, exit: { at: 5.2, kind: 'default' } });
    if (t >= 51.9) out.push({ lineId: 'L6b', tau: t - 52.0, x: L.west[0], y: L.capY, style: cap, clampX: L.clamp, exit: { at: 1.2, kind: 'default' } });
    return out;
  },
  post(ctx, tau) {
    const t = T0 + tau;
    const dim = 1 - 0.3 * ctx.tl.seg(t, 53.2, 54.0, ctx.tl.E.inOutSine);
    return { ghosts: 0.012, exposure: Math.log2(dim) };
  },
};
export default scene;
