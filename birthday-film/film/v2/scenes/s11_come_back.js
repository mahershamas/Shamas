/*
  Scene 11: come-back (131.5-138.6), package P8.
  131.5-133.0 the hand-off from scene 10 (a custom transition, 131.5-132.5): the camera pitches down and cranes up
  (horizon 820 -> 430, 2.5 -> 40 m; the shared camera of scene 10), the rendered night sea turns into the engraved gold
  sea through a luminance-keyed ink bleed (the brightest hatch lines, the crests, come through first; the sky is one
  continuous sky with the aurora greying and dimming to 10 percent, 5 by 135.0), and the rosette with its two circling
  stars contracts (scale 1 -> 0.02, easeInOutSine from 131.2, s10 heartPose) while travelling left, held above the
  rising horizon, until at 133.0 it IS the west horizon light of
  scene 4. The gold arc of scene 4 comes back over the horizon in its scene-4 state (left 30 percent lit, the right
  end cooled).
  133.0-135.0 (cue 'comet') a gold comet leaves the west light and runs the arc to the east light (easeInOutSine),
  arriving at exactly 135.000 (cue 'name_peak'): white core, a 40 px warm halo, a tail of 1,200 closed-form gold
  grains shed along the path; the arc warms behind it. 135.0 the east light blooms to twice its size (spring) and
  stays bright; the whole arc glows evenly warm; the name in line L17 arrives in bright gold leaf (key light close
  above it) with a glint and a soft warm glow behind it, the brightest word on the line.
  Line L17: the words before the name enter at 132.0 with a 0.22 s stagger, the name (last word) at 135.0 in gold leaf,
  pre-positioned so nothing reflows; mist exit 137.0-137.8. The hatch fades under the line (caption shield).
  137.6-139.0 the sea dissolves into ink (the shared gold-dust dissolve, scenes/index.js).
*/
import { shoresLayout, toScene, createShoreFx, createShield } from './s04_two_shores.js';
import { ilyLayout, nightCam, nightSky, heartPose, createHeart } from './s10_i_love_you.js';

const T0 = 131.5;

const TRANS_FS = `
uniform sampler2D uA, uB; uniform float uW, uHz0, uHzK, uLumaKey;
out vec4 o;
void main(){
  vec2 px = framePx(), uv = screenUV();
  vec3 b = texture(uB, uv).rgb;
  float below = px.y - (uHz0 + uHzK * px.x);
  if (below < -1.5){ o = vec4(b, 1.0); return; }       // one continuous sky: the incoming scene's
  vec3 a = texture(uA, uv).rgb;
  float sea = smoothstep(-1.5, 1.5, below);
  // the engraving's bright lines (its crests) come through first, then its dark ground, in a sweep from the horizon
  // down toward the camera (never as stray lines in the middle of the old sea); a fine fbm breaks the front
  vec2 q = px / uFrame.y;
  float n = fbm(q * vec2(5.0, 9.0), 4);
  float key = clamp(luma(b) * 4.0, 0.0, 1.0);
  float v = (1.0 - key) * uLumaKey * 0.6 + 0.25 * n + clamp(below / (520.0 * uFrame.y / 1080.0), 0.0, 1.0);
  float m = smoothstep(v - 0.14, v + 0.14, uW * 2.3 - 0.3);
  vec3 c = mix(a, b, m);
  o = vec4(mix(b, c, sea), 1.0);
}`;

// comet head: a white core and a warm halo smeared over the shutter (the chord travelled in one frame)
const COMET_FS = `
uniform vec2 uP0, uP1; uniform vec3 uCore, uHalo; uniform float uI, uU, uExt;
out vec4 o;
void main(){
  vec2 px = framePx();
  float d = sdSegment(px, uP0, uP1);
  float len = length(uP1 - uP0);
  float k = 4.0 / (4.0 + len);                 // energy spread along the chord
  float core = exp(-d * d / (2.0 * 3.0 * 3.0 * uU * uU)) * 10.0 * k;
  float halo = (0.55 * exp(-d / (9.0 * uU)) * mix(1.0, k * 2.5, 0.5) + 0.22 * exp(-d / (40.0 * uU)));
  float win = 1.0 - smoothstep(0.6, 1.0, d / uExt);
  o = vec4((uCore * core + uHalo * halo) * uI * win, 0.0);
}`;
// the tail: 1,200 grains shed along the path 133.0-135.0; each lags behind the head and drifts down and out
const TAIL = `
uniform float uLen, uLut[17]; uniform vec2 uA, uB, uC; uniform vec3 uG1, uG2, uHot; uniform float uU, uI;
float easeIOS(float x){ x = clamp(x, 0.0, 1.0); return -(cos(PI * x) - 1.0) * 0.5; }
// arc position at arc-length fraction f (0 at A, the east light) via the bezier parameter table
vec2 bez(float t){ float u = 1.0 - t; return u * u * uA + 2.0 * u * t * uB + t * t * uC; }
float tOfS(float f){
  f = clamp(f, 0.0, 1.0);
  for (int i = 0; i < 16; i++){ if (f <= uLut[i + 1]){ float w = (f - uLut[i]) / max(uLut[i + 1] - uLut[i], 1e-6); return (float(i) + w) / 16.0; } }
  return 1.0;
}
vec2 cometAt(float t){ float f = 1.0 - easeIOS((t - 133.0) / 2.0); return bez(tOfS(f)); }
void particle(int id, out vec2 px, out float size, out vec4 col){
  float fi = float(id);
  float h1 = h11(fi * 1.37 + 0.3), h2 = h11(fi * 2.71 + 5.1), h3 = h11(fi * 0.57 + 2.9), h4 = h11(fi * 4.13 + 7.7);
  float tb = 133.0 + 2.0 * (fi + h1) / 1200.0;
  float life = 0.45 + 0.65 * h2;
  float age = uTau - tb;
  px = vec2(-1e4); size = 0.0; col = vec4(0.0);
  if (age <= 0.0 || age >= life) return;
  // each grain keeps following the path for a while (lag grows with age), then drifts down and outward
  vec2 p = cometAt(tb + age * (0.55 + 0.25 * h3));
  vec2 dir = normalize(cometAt(tb + 0.02) - cometAt(tb - 0.02) + 1e-4);
  vec2 nrm = vec2(-dir.y, dir.x);
  p += nrm * (h4 - 0.5) * 2.0 * (6.0 + 22.0 * age) * uU;
  p += vec2(0.0, 1.0) * 18.0 * age * age * uU;
  p += 6.0 * uU * curl2(p * 0.01 + vec2(h1 * 9.0, uTau * 0.5)) * age;
  px = p;
  float a = 1.0 - age / life;
  bool spark = h3 > 0.93;
  size = (spark ? 2.0 : 1.4 + 1.6 * h4) * uU;
  vec3 c = mix(uG1, uG2, h2);
  col = vec4(spark ? uHot : c, a * a * uI * (spark ? 1.8 : 1.0));
}`;

// the arc of scene 4 (quadratic Bezier), drawn in one viewport-limited pass: a 2 px gold line with a soft glow, the
// parked lit segment, the cooled east end, the warm band riding with the comet and the comet's hot trail on the line
const ARC_FS = `
uniform vec2 uA, uB, uC; uniform float uLen; uniform float uLut[17];
uniform float uOn, uLit0, uCool, uSc, uBandI, uBandH, uTailI, uTau, uLitK;
uniform vec3 uGold, uLitC, uCoolC, uHazeC, uHot;
out vec4 o;
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
float arcS(float t){ float x = t * 16.0; int i = int(min(floor(x), 15.0)); return mix(uLut[i], uLut[i + 1], x - float(i)) * uLen; }
void main(){
  vec2 p = framePx();
  vec2 bz = sdBez(p, uA, uB, uC);
  float d = bz.x, s = arcS(bz.y);
  float lit = smoothstep(uLit0 - 40.0, uLit0 + 40.0, s);
  float cool = uCool * (1.0 - smoothstep(0.18 * uLen, 0.68 * uLen, s));
  vec3 base = mix(uGold, uCoolC, cool) * mix(1.0, 0.75, cool);
  vec3 col = mix(base * 0.85, uLitC * uLitK, lit);
  float sh = 1.0 + 0.22 * (vn(vec2(s * 0.045, uTau * 0.7)) - 0.5);
  float core = smoothstep(1.55, 0.45, d);
  float gk = (1.0 + 1.6 * lit) * (1.0 - 0.6 * cool);
  float glow = 0.20 * gk * exp(-d / 2.2) + 0.05 * gk * exp(-d / 9.0);
  vec3 c = col * (core + glow) * sh;
  // warm air round the comet
  float band = uBandI * exp(-0.5 * pow((s - uSc) / 120.0, 2.0));
  c += uHazeC * band * uBandH * (exp(-0.5 * d * d / 81.0) + 0.35 * exp(-0.5 * d * d / 484.0));
  // the comet's hot trail on the line: white-gold, widening and fading behind the head
  float behind = s - uSc;
  if (uTailI > 0.0){
    float fall = behind > 0.0 ? exp(-behind / 75.0) : exp(behind / 3.0);
    float wd = 1.2 + max(behind, 0.0) * 0.035;
    c += uHot * uTailI * fall * (exp(-0.5 * d * d / (wd * wd)) * 1.4 + 0.18 * exp(-d / (4.0 + max(behind, 0.0) * 0.06)));
  }
  o = vec4(c * uOn, 0.0);
}`;
// a horizon light: 4 px white-gold core, a 40 px halo, a horizontal streak, a faint 4-point star
const LIGHT_FS = `
uniform vec2 uP; uniform float uI, uHalo, uStreak, uStar, uStreakI;
uniform vec3 uWhite, uLitC;
uniform vec2 uBox;
out vec4 o;
float star4(vec2 q, float s){
  vec2 a = abs(q);
  return exp(-a.y * a.y / 0.7) * exp(-a.x / s) + exp(-a.x * a.x / 0.7) * exp(-a.y / s);
}
void main(){
  vec2 q = framePx() - uP;
  float r = length(q);
  float core = smoothstep(2.9, 1.1, r);
  float halo = 0.75 * exp(-r / (uHalo * 0.16)) + 0.26 * exp(-r / (uHalo * 0.5));
  float streak = exp(-abs(q.x) / uStreak) * (exp(-q.y * q.y / 1.2) + 0.25 * exp(-q.y * q.y / 18.0));
  vec2 bq = abs(q) / uBox;
  float winH = 1.0 - smoothstep(0.55, 1.0, max(bq.x * uBox.x / (3.6 * uHalo), bq.y));
  float winS = 1.0 - smoothstep(0.6, 1.0, bq.x);
  vec3 c = uWhite * core * 7.0 * winH + uLitC * (halo * 1.6 * winH + streak * uStreakI * winS) + uWhite * uStar * star4(q, 26.0) * 0.6 * winH;
  o = vec4(c * uI, 0.0);
}`;
const RULE_FS = `
uniform float uY, uI; uniform vec3 uHot, uGold;
out vec4 o;
void main(){
  float d = abs(framePx().y - uY);
  float core = clamp(1.0 - d, 0.0, 1.0) * 0.75, glow = 0.30 * exp(-d / 2.0) + 0.08 * exp(-d / 6.0);
  o = vec4((uHot * core + uGold * glow) * uI, 0.0);
}`;

// a soft warm glow behind the name (additive HDR, under the gold leaf): the climax word is the brightest on the line
const NAMEGLOW_FS = `
uniform vec2 uC, uR; uniform vec3 uCol; uniform float uI;
out vec4 o;
void main(){
  vec2 d = (framePx() - uC) / uR;
  float r2 = dot(d, d);
  float win = 1.0 - smoothstep(1.6, 2.4, sqrt(r2));          // reaches zero inside the drawn box (no visible edge)
  o = vec4(uCol * uI * (0.75 * exp(-r2 * 2.5) + 0.25 * exp(-r2 * 1.0)) * win, 0.0);
}`;

const scene = {
  id: 's11_come_back', t0: T0, t1: 138.6, internalScale: 1, look: 'night_sea',
  async init(ctx) {
    const { G, glsl, particles, text } = ctx;
    this.L = shoresLayout(ctx);
    this.N = ilyLayout(ctx);
    this.fx = createShoreFx(ctx);
    this.shield = createShield(ctx, 's11', { padX: 24, padY: 14 });   // a little deeper than scene 4's (no hatch through the name)
    this.heart = createHeart(ctx);
    this.trans = G.program('p8.s11.trans', glsl.frag(TRANS_FS));
    this.cometP = G.program('p8.s11.comet', glsl.frag(COMET_FS));
    this.arcP = G.program('p8.s11.arc', glsl.frag(ARC_FS));
    this.lightP = G.program('p8.s11.light', glsl.frag(LIGHT_FS));
    this.ruleP = G.program('p8.s11.rule', glsl.frag(RULE_FS));
    this.glowP = G.program('p8.s11.nameglow', glsl.frag(NAMEGLOW_FS));
    this.tail = particles.program('p8.s11.tail', TAIL);
    const L = this.L;
    this.arc = this.fx.arc(L.east, L.ctrl, L.west);         // arc length measured from the east light
    const C = h => toScene(ctx, h);
    this.col = { white: [1.0, 0.97, 0.92], halo: C('#FFE7A3'), g1: C('#FFE7A3').map(v => v * 2.6), g2: C('#E3B341').map(v => v * 2.6), hot: [3.2, 2.8, 2.1],
      gold: C('#E3B341'), lit: C('#FFE7A3'), coolC: C('#6E4A12'), haze: C('#E39A4C'), hotW: C('#FFF4D6'), white2: [1.0, 0.93, 0.80], rule: C('#D4A64A') };
    const words = text.words('L17');
    this.nameI0 = words[words.length - 1].i0;
    this.nChars = Array.from(window.LINES.L17).length;
    this.nWords = words.length;
    const lay = text.layout({ lineId: 'L17', tau: 100, x: ctx.W / 2, y: this.L.textY, style: { base: 'narrative', size: this.L.textSize }, breaks: ctx.portrait ? [words.length - 1] : undefined });
    const row = lay.rows[lay.rows.length - 1], g = lay.line.glyph;
    this.nameX = row.ox + g[this.nameI0 * 4];
    this.nameX1 = row.ox + g[(this.nChars - 1) * 4 + 1];
    this.nameY = row.y;                                       // baseline of the row that holds the name
  },
  // horizon y (frame) for the moving camera
  hzAt(ctx, t) { return ctx.sea.horizonY(nightCam(ctx, t), ctx.W / 2); },
  cometS(ctx, t) { return this.arc.len * (1 - ctx.tl.seg(t, 133.0, 135.0, ctx.tl.E.inOutSine)); },
  // arc geometry follows the horizon while the camera settles (fixed from 133.0)
  arcPts(ctx, t) {
    const L = this.L, dy = this.hzAt(ctx, t) - L.hz;
    return { A: [L.east[0], L.east[1] + dy], B: [L.ctrl[0], L.ctrl[1] + dy], C: [L.west[0], L.west[1] + dy], dy };
  },
  lightsAt(ctx, t) {
    const { tl } = ctx, E = tl.E;
    const west = tl.seg(t, 132.7, 133.15, E.inOutSine);
    const bloom = tl.spring(t, 134.94, { zeta: 0.42, freq: 1.1 });   // already rising on the 135.000 frame
    const east = 0.85 * tl.seg(t, 132.6, 133.4, E.inOutSine) * (1 + 1.1 * bloom);
    const flash = t >= 134.96 ? Math.exp(-Math.max(0, t - 135.0) / 0.22) * Math.min(1, (t - 134.96) / 0.04) : 0;
    return { west, east, bloom, flash };
  },
  narrative(ctx, t) {
    const L = this.L, out = [];
    if (t < 131.95 || t >= 138.0) return out;
    const st = { base: 'narrative', size: L.textSize };
    const base = { lineId: 'L17', x: ctx.W / 2, y: L.textY, style: st };
    if (ctx.portrait) base.breaks = [this.nWords - 1];
    out.push(Object.assign({}, base, { tau: t - 132.0, part: [0, this.nameI0], enter: { base: 'default', stagger: 0.22 }, exit: { at: 5.0, kind: 'mist' } }));
    if (t >= 134.99) {
      const li = this.lightsAt(ctx, t);
      const east = this.arcPts(ctx, t).A;
      out.push(Object.assign({}, base, {
        tau: t - 134.985, part: [this.nameI0, this.nChars], style: Object.assign({}, st, { layer: 'hdr' }), layer: 'hdr',
        enter: { base: 'opacity', dur: 0.25 }, exit: { at: 2.015, kind: 'mist' },
        glints: [{ at: 0.0, glyph: this.nChars - 1, size: 24, I: 3.0, dur: 0.6, rot: 0.12 }],
        sweeps: [{ at: 0.1, dur: 0.9, I: 1.3, width: 40 }],
        // bright leaf: the key light close above the name (60 px), a warmer, stronger tint than the cream words
        gold: { look: 'night_sea', key: [this.nameX + 40 * ctx.U, this.nameY - 60 * ctx.U], keyZ: 150 * ctx.U, keyI: 9.0 + 2.0 * li.flash, fill: [east[0], east[1]], fillI: 2.0, envI: 1.3, tint: [1.35, 1.25, 1.05],
          opacity: 1 - ctx.tl.seg(t, 137.0, 137.8, ctx.tl.E.inOutSine) },   // fades with the rest of the line
      }));
    }
    return out;
  },
  render(ctx, tau, p, target) {
    const t = T0 + tau, S = ctx.sea, { tl } = ctx, E = tl.E;
    const cam = nightCam(ctx, t);
    const q = nightSky(ctx, t, cam);
    const li = this.lightsAt(ctx, t);
    const ap = this.arcPts(ctx, t);
    const shield = this.shield.build(this.narrative(ctx, t));
    const lights = [];
    if (li.west > 0) lights.push([ap.C[0], 1.0 * li.west, 1, 18]);
    if (li.east > 0) lights.push([ap.A[0], 1.0 * li.east, 1, 18 * (1 + 0.6 * li.bloom)]);
    S.engraved(target, { tau: t - 100.0, cam, amp: 0.6, sky: q, stars: 0.6, look: 'night_sea', lights, shield, shieldK: 0.85 });
    this.drawFx(ctx, t, target, ap, li);
    this.nameGlow(ctx, t, target);
  },
  // the name's glow: rises with the name at 135.0, swells on the arrival flash, fades with the line's mist exit
  nameGlow(ctx, t, target) {
    const { tl } = ctx, E = tl.E;
    const I = tl.seg(t, 134.99, 135.35, E.outCubic) * (1 - tl.seg(t, 137.0, 137.8, E.inOutSine)) * (1 + 0.6 * this.lightsAt(ctx, t).flash);
    if (I <= 0) return;
    const sz = this.L.textSize * ctx.U;
    const C = [(this.nameX + this.nameX1) / 2, this.nameY - 0.3 * sz], R = [(this.nameX1 - this.nameX) / 2 + 0.9 * sz, 0.95 * sz];
    const s = target.scale == null ? 1 : target.scale;
    const ex = [R[0] * 2.5, R[1] * 2.5];
    const x0 = Math.max(0, Math.floor((C[0] - ex[0]) * s)), x1 = Math.min(target.w, Math.ceil((C[0] + ex[0]) * s));
    const y0 = Math.max(0, Math.floor((ctx.H - C[1] - ex[1]) * s)), y1 = Math.min(target.h, Math.ceil((ctx.H - C[1] + ex[1]) * s));
    if (x1 > x0 && y1 > y0) ctx.G.draw(this.glowP, { uC: C, uR: R, uCol: this.col.lit, uI: 0.07 * I }, target, { blend: 'add', viewport: [x0, y0, x1 - x0, y1 - y0] });
  },
  drawFx(ctx, t, target, ap, li) {
    const { tl, G } = ctx, E = tl.E, A = this.arc, col = this.col, U = ctx.U;
    const sc = target.scale == null ? 1 : target.scale;
    const vp = (x0, y0, x1, y1) => {
      const gx0 = Math.max(0, Math.floor(x0 * sc)), gx1 = Math.min(target.w, Math.ceil(x1 * sc));
      const gy0 = Math.max(0, Math.floor((ctx.H - y1) * sc)), gy1 = Math.min(target.h, Math.ceil((ctx.H - y0) * sc));
      return gx1 > gx0 && gy1 > gy0 ? [gx0, gy0, gx1 - gx0, gy1 - gy0] : null;
    };
    const on = tl.seg(t, 132.55, 133.2, E.inOutSine);
    const cs = this.cometS(ctx, t);
    const comet = t >= 133.0 && t < 135.0 ? tl.seg(t, 133.0, 133.15) : 0;
    const after = tl.seg(t, 134.85, 135.6, E.inOutSine);
    // the arc
    if (on > 0) {
      const litStart = t < 133.0 ? 0.70 * A.len : Math.min(0.70 * A.len, cs);
      const xs = [ap.A[0], ap.B[0], ap.C[0]], ys = [ap.A[1], ap.B[1], ap.C[1]];
      const apexY = Math.min(...ys) + (Math.max(ap.A[1], ap.C[1]) - Math.min(...ys)) * 0.5 - 4;   // a Bezier peaks half way to its control point
      const v = vp(Math.min(...xs) - 60, apexY - 70, Math.max(...xs) + 60, Math.max(ap.A[1], ap.C[1]) + 40);
      if (v) G.draw(this.arcP, { uA: ap.A, uB: ap.B, uC: ap.C, uLen: A.len, uLut: A.lut, uOn: on, uLit0: litStart * (1 - after), uCool: 0.55 * Math.min(1, cs / A.len) * (1 - after),
        uSc: cs, uBandI: comet * 1.1, uBandH: 0.16, uTailI: comet, uTau: t - T0, uLitK: 1.35 + 0.2 * after,
        uGold: col.gold, uLitC: col.lit, uCoolC: col.coolC, uHazeC: col.haze, uHot: col.hotW }, target, { blend: 'add', viewport: v });
    }
    // the horizon rule
    if (on > 0) { const v = vp(0, ap.A[1] - 24, ctx.W, ap.A[1] + 24); if (v) G.draw(this.ruleP, { uY: ap.A[1], uI: 0.10 * on, uHot: col.hotW, uGold: col.rule }, target, { blend: 'add', viewport: v }); }
    // the two lights
    const light = (P, I, halo, streak, star, streakI) => {
      if (I <= 0) return;
      const bx = 5.5 * streak, by = 3.6 * halo;
      const v = vp(P[0] - bx, P[1] - by, P[0] + bx, P[1] + by);
      if (v) G.draw(this.lightP, { uP: P, uI: I, uHalo: halo, uStreak: streak, uStar: star, uStreakI: streakI, uBox: [bx, by], uWhite: col.white2, uLitC: col.lit }, target, { blend: 'add', viewport: v });
    };
    light(ap.C, li.west, 40 * U, 120 * U, 0, 0.45);
    light(ap.A, li.east, 40 * U * (1 + li.bloom), 120 * U * (1 + 0.5 * li.bloom), 0.7 * li.flash, 0.45 + 0.2 * li.bloom);
  },
  // the contracting rosette (131.5-133.25; scene 10 starts the contraction at 131.2 with the same pose): drawn by the
  // transition (straight into the frame) and then by the overlay. It lands on the west light (the arc's C end) at 133.0.
  heartAt(ctx, t, target) {
    if (t >= 133.25) return;
    this.heart.draw(target, t, heartPose(ctx, t));
  },
  transition(ctx, w, outRT, inRT, dst) {
    const t = ctx.t, cam = nightCam(ctx, t), S = ctx.sea;
    const h0 = S.horizonY(cam, 0), h1 = S.horizonY(cam, ctx.W);
    ctx.G.draw(this.trans, { uA: outRT, uB: inRT, uW: w, uHz0: h0, uHzK: (h1 - h0) / ctx.W, uLumaKey: 0.6 }, dst);
    this.heartAt(ctx, t, dst);
  },
  overlay(ctx, tau, p, target) {
    const t = T0 + tau, { tl } = ctx, E = tl.E, G = ctx.G;
    if (ctx.layer && ctx.layer.role === 'in') return;    // drawn by transition() during the hand-off
    if (ctx.layer && ctx.layer.role === 'out') return;   // fading into ink: the comet is long gone
    this.heartAt(ctx, t, target);
    // the comet
    if (t >= 132.95 && t < 135.05) {
      const ap = this.arcPts(ctx, t);
      const arc = this.fx.arc(ap.A, ap.B, ap.C);
      const at = tt => arc.at(this.cometS(ctx, Math.min(135.0, Math.max(133.0, tt))));
      const p0 = at(t - 1 / 60), p1 = at(t + 1 / 60);
      const I = tl.seg(t, 133.0, 133.18, E.outCubic) * (t <= 135.0 + 1e-6 ? 1 : 0);   // the head is still there, merging, on the 135.000 frame
      if (I > 0) {
        const ext = 220 * ctx.U;
        const x0 = Math.min(p0[0], p1[0]) - ext, x1 = Math.max(p0[0], p1[0]) + ext, y0 = Math.min(p0[1], p1[1]) - ext, y1 = Math.max(p0[1], p1[1]) + ext;
        const s = target.scale == null ? 1 : target.scale;
        const gx0 = Math.max(0, Math.floor(x0 * s)), gx1 = Math.min(target.w, Math.ceil(x1 * s)), gy0 = Math.max(0, Math.floor((ctx.H - y1) * s)), gy1 = Math.min(target.h, Math.ceil((ctx.H - y0) * s));
        G.draw(this.cometP, { uP0: p0, uP1: p1, uCore: this.col.white, uHalo: this.col.halo, uI: I * 2.6, uU: ctx.U, uExt: ext - 4 }, target, { blend: 'add', viewport: [gx0, gy0, gx1 - gx0, gy1 - gy0] });
      }
    }
    if (t >= 133.0 && t < 136.0) {
      const ap = this.arcPts(ctx, t);
      ctx.particles.draw(this.tail, 1200, { uTau: t, uLen: this.arc.len, uLut: this.arc.lut, uA: ap.A, uB: ap.B, uC: ap.C,
        uG1: this.col.g1, uG2: this.col.g2, uHot: this.col.hot, uU: ctx.U, uI: 1.0 }, target);
    }
    // the arrival: a star glint on the east light
    if (t >= 134.96 && t < 136.2) {
      const ap = this.arcPts(ctx, t);
      const k = (t - 134.96) / 1.24;
      ctx.gold.glint(target, { x: ap.A[0], y: ap.A[1], size: 64, I: 2.6 * Math.sin(Math.PI * Math.pow(k, 0.35)), rot: 0 });
    }
  },
  captions(ctx, tau) { return this.narrative(ctx, T0 + tau); },
  post(ctx, tau) {
    const t = T0 + tau, li = this.lightsAt(ctx, t);
    // portrait: lower chromatic aberration (the radial shift crosses the horizontal hatch of the lower sea there)
    return { ghosts: 0, ca: ctx.portrait ? 0.0005 : 0.0015, streak: { threshold: 4.0, strength: 0.04 }, bloom: { add: 0.05 * li.flash } };
  },
};
export default scene;
