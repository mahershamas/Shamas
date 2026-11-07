/*
  Scene 3: credit-horizon (22.5-30.0), package P5.
  22.5-23.9 the title name burns away into dust (about 1.3 s): a soft noise front (biased to rise from the bottom)
  eats the gold leaf with a hot ember rim, and every one of 6,000 grains sampled from the name leaves its own pixel
  the moment the front reaches it, drifting up at 30 px/s and fading; the red dots go first (22.5-22.95) and the line
  L1a fades with the name. The brightest 600 grains fall to the centre of the rule (y = 540) and become two pen tips
  that draw a 1.5 px gold hairline outward at about 600 px/s each way (it frames the dateline by 24.0). 24.0 the
  dateline L2a is set above the rule; 25.0 the line L2b below it. 23.5-29.0 the sky pushes in slowly and lifts (the
  rule and the type stay locked). Both lines leave 27.8-28.6; 28.0-29.2 the rule runs out to the full width (pen tips
  again). 28.8-30.0 the engraved sea fades in under the rule (weight smoothstep(28.8, 30.0, t)) and from 29.0 the
  camera tilts down with scene 4's own horizon function, so the cut to scene 4 at 30.0 continues the same move.
  29.3-30.0 the hairline hands over to scene 4's horizon rule and lights (drawn with scene 4's own fx and values), and
  the post settings blend into scene 4's, so nothing pops at the cut. The grade blends winter-gold -> night-sea.

  Hand-over contract with scene 4 (package P6): this scene reads scene 4's exported shoresHz / shoresCam / shoresSea
  and its fxUniforms(ctx, t) and post(ctx, 0), so it always matches whatever scene 4 does at 30.0.
*/
import S02, { layoutOf, nameEntry, GRAIN_GLSL, GRAIN_FS, DOTS_GLSL, DOTS_FS } from './s02_forge_name.js';
import S04, { shoresHz, shoresCam, shoresSea, createShoreFx } from './s04_two_shores.js';
import { SKY_GLSL, NEB_FS, skyColours, camAt } from './s01_forge_orbit.js';

const T0 = 22.5;
const N_DIS = 6000, N_PEN = 600;
const Q_LEAD = 0.06;
const Q_DUR = 1.3;          // the burn takes about 1.3 s (it held for 4.5 s: it must not vanish in a blink)
const TL = 23.7;            // the pen grains arrive on the rule (the burn is mostly done: no rule through the letters)
const HO0 = 29.3, HO1 = 30.0;   // hand-over window to scene 4's rule, lights and post

// the dissolve field shared by the gold-leaf mask pass and the grains (frame px -> release order 0..1)
const FIELD = `
uniform vec4 uNameBox;      // x0, y0 (top), x1, y1 (bottom) of the ink
uniform float uFU;
float dissolveField(vec2 px){
  // broad noise for the shape of the front plus a fine grain so its edge is ragged dust, never a clean cut shard
  float n = fbm(px * 0.021 / uFU + 3.3, 4) + 0.16 * (vn(px * 0.22 / uFU + 7.7) - 0.5) + 0.08 * (vn(px * 0.6 / uFU + 1.9) - 0.5);
  float up = clamp((uNameBox.w - px.y) / max(uNameBox.w - uNameBox.y, 1.0), 0.0, 1.0);   // 0 at the bottom, 1 at the top
  return clamp(((n - 0.25) / 0.5) * 0.7 + up * 0.3, 0.0, 1.0);
}`;

const MASK_FS = FIELD + `
uniform sampler2D uSrc; uniform vec4 uRect; uniform float uQ;
out vec4 o;
void main(){
  vec2 uv = screenUV();
  vec4 m = texture(uSrc, uv);
  vec2 px = uRect.xy + vec2(uv.x, 1.0 - uv.y) * uRect.zw;       // mask rows are bottom-up
  float n = dissolveField(px);
  float keep = smoothstep(uQ, uQ + 0.09, n);
  // the leaf just ahead of the front thins (it lights to embers and loses body) instead of standing as solid metal
  keep *= mix(0.45, 1.0, smoothstep(uQ + 0.04, uQ + 0.28, n));
  o = vec4(m.r * keep, 0.0, 0.0, m.a);
}`;

// hot ember rim on the burning front (additive HDR, over the leaf)
const EMBER_FS = FIELD + `
uniform sampler2D uSrc; uniform vec4 uRect; uniform float uQ, uI; uniform vec3 uHot;
in vec2 vPx;
out vec4 o;
void main(){
  vec2 q = (vPx - uRect.xy) / uRect.zw;
  vec4 m = texture(uSrc, vec2(q.x, 1.0 - q.y));
  float n = dissolveField(vPx);
  float d = n - uQ;
  float rim = smoothstep(-0.01, 0.02, d) * (1.0 - smoothstep(0.02, 0.10, d));
  o = vec4(uHot * rim * m.r * uI, 0.0);
}`;
const RECT_VS = `
uniform vec4 uRect;
out vec2 vPx;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 px = uRect.xy + c * uRect.zw; vPx = px;
  gl_Position = clipOfPx(px);
}`;

// grains sampled from the name: released by the burning front; the first 600 fall to the rule and become its pen tips
const DIS = FIELD + `
uniform sampler2D uHome;
uniform float uU, uQ0, uQdur, uSeed, uLen0, uTL, uSpeed, uHalf;
uniform vec2 uLC;            // rule centre (frame px)
uniform vec3 uC1, uC2, uC3, uHot;
out float vGlint;
float hh(int id, float k){ return h12(vec2(float(id) * 1.618 + k * 31.7, k * 7.3 + 0.5)); }
void particle(int id, out vec2 px, out float size, out vec4 col){
  float t = uTau;
  vGlint = 0.0;
  vec2 h = fetchPoint(uHome, id).xy;
  float c = hh(id, 3.0);
  vec3 cc = c < 0.2 ? uC1 : (c < 0.7 ? uC2 : uC3);
  if (id < ${N_PEN}){
    // the pen grains: leave early, fall to the centre of the rule, then ride the two tips outward
    float tr = uQ0 + 0.28 * hh(id, 4.0);
    float side = (id - (id / 2) * 2) == 0 ? -1.0 : 1.0;
    float arr = uTL - 0.02 - 0.08 * hh(id, 5.0);
    float k = clamp((t - tr) / max(arr - tr, 0.05), 0.0, 1.0);
    float ke = k * k * (3.0 - 2.0 * k);
    vec2 mid = vec2(mix(h.x, uLC.x, 0.5) + side * 30.0 * uU * hh(id, 6.0), max(h.y, uLC.y) + 50.0 * uU * hh(id, 7.0));
    float iu = 1.0 - ke;
    vec2 P = iu * iu * h + 2.0 * iu * ke * mid + ke * ke * uLC;
    // on the tip: trail behind it by a seeded lag, thinning as the rule completes
    float half_ = uHalf;
    float lag = (4.0 + 70.0 * pow(hh(id, 8.0), 2.0)) * uU;
    vec2 tip = uLC + vec2(side * max(half_ - lag, 0.0), (hh(id, 9.0) - 0.5) * 3.0 * uU);
    float onTip = step(uTL, t);
    px = mix(P, tip, onTip);
    float fadeTip = 1.0 - smoothstep(uLen0 * 0.75, uLen0 * 1.02, half_);
    size = mix(2.2, 1.6, onTip) * uU;
    float I = mix(1.6 + 1.2 * ke, 2.4 * (1.0 - lag / (80.0 * uU)), onTip);
    float al = step(tr, t) * mix(1.0, fadeTip, onTip) * smoothstep(0.0, 0.06, t - tr + 0.06);
    col = vec4(min(mix(cc, uHot, 0.5) * I, vec3(6.0)), al);
    return;
  }
  // the burning front reaches this grain's pixel at tr; it lifts off at 30 px/s, curling, and fades
  float tr = uQ0 + uQdur * dissolveField(h);
  float a = t - tr;
  if (a < 0.0){ col = vec4(0.0); px = h; size = 1.0; return; }
  vec2 drift = vec2(0.0, -30.0 * uU * a) + 60.0 * uU * curl2(h * 0.006 / uU + vec2(uSeed, t * 0.12)) * min(a, 1.0);
  drift += vec2(hh(id, 10.0) - 0.5, hh(id, 14.0) - 0.7) * 70.0 * uU * (1.0 - exp(-a / 0.25));
  px = h + drift;
  size = mix(1.2, 2.4, hh(id, 11.0)) * uU;
  float I = (0.7 + 2.6 * exp(-a / 0.12)) * (0.6 + 0.8 * pow(hh(id, 12.0), 2.0));
  float al = exp(-a / (0.22 + 0.45 * pow(hh(id, 13.0), 2.0)));
  col = vec4(min(mix(cc, uHot, 0.6 * exp(-a / 0.2)) * I, vec3(6.0)), al);
}`;

// sky of act I continued, tilted with the camera (stars slide up as the horizon rises)
const SKY = SKY_GLSL + `
uniform sampler2D uNeb;
uniform float uNebDim, uHz, uBelow;
out vec4 o;
void main(){
  vec2 px = framePx();
  vec3 c = vellum(px);
  // below the forming horizon the sky gives way (the stars stay above)
  float sky = 1.0 - uBelow * smoothstep(uHz - 1.0, uHz + 60.0 * uU, px.y);
  c += texture(uNeb, pxToUV(px)).rgb * uNebDim * mix(1.0, sky, 0.7);
  if (sky > 0.002) c += starField(toWorld(px)) * uVisField * sky * starShield(px);
  o = vec4(c, 1.0);
}`;

// the gold hairline: 1.5 px AA core, 6 px glow, soft pen-tip glows of 12 px (additive HDR)
const RULE = `
uniform vec2 uLC; uniform float uHalf, uY, uI, uTipI, uU;
uniform vec3 uCore, uGlow;
out vec4 o;
void main(){
  vec2 px = framePx();
  float dx = max(abs(px.x - uLC.x) - uHalf, 0.0);
  float dy = px.y - uY;
  float d = length(vec2(dx, dy));
  float hw = 0.75 * uU;
  float fw = 0.75;                                          // one pixel AA
  float core = clamp((hw + fw - d) / (2.0 * fw), 0.0, 1.0);
  float glow = exp(-d / (3.0 * uU)) * 0.6 + exp(-d / (6.0 * uU)) * 0.4;
  // a drawn rule tapers at its ends (engraver's burin), but never under a moving pen tip
  float taper = smoothstep(0.0, 70.0 * uU, uHalf - abs(px.x - uLC.x) + 4.0 * uU);
  taper = mix(taper, 1.0, clamp(uTipI, 0.0, 1.0));
  // the two pen tips
  vec2 t1 = vec2(uLC.x - uHalf, uY), t2 = vec2(uLC.x + uHalf, uY);
  float tp = exp(-pow(length(px - t1) / (12.0 * uU), 2.0)) + exp(-pow(length(px - t2) / (12.0 * uU), 2.0));
  float tc = exp(-pow(length(px - t1) / (2.5 * uU), 2.0)) + exp(-pow(length(px - t2) / (2.5 * uU), 2.0));
  vec3 c = (uCore * core + uGlow * glow * 0.10) * uI * taper + (uGlow * tp * 0.5 + uCore * tc * 2.2) * uTipI;
  o = vec4(c, 0.0);
}`;

const scene = {
  id: 's03_credit_horizon', t0: 22.5, t1: 30.0, internalScale: 1, look: 'winter_gold',
  async init(ctx) {
    const { G, glsl, particles } = ctx;
    this.L = layoutOf(ctx);
    this.P = {
      neb: G.program('s01.neb', glsl.frag(NEB_FS)),
      sky: G.program('s03.sky', glsl.frag(SKY)),
      rule: G.program('s03.rule', glsl.frag(RULE)),
      mask: G.program('s03.mask', glsl.frag(MASK_FS)),
      ember: G.program('s03.ember', glsl.frag(EMBER_FS), glsl.HEADER_VS + RECT_VS),
      dis: particles.program('s03.dis', DIS, { fs: GRAIN_FS }),
      dust: particles.program('s03.dust', GRAIN_GLSL + `
uniform int uNName;
void particle(int id, out vec2 px, out float size, out vec4 col){
  float t = uTau, e = t - 12.0;
  vGlint = 0.0;
  int j = id;
  int gid = id + uNName;
  vStr = vec4(0.0);
  vec3 c = grainCol(gid);
  float spark = step(hh(gid, 5.0), 0.03);
  float bri = grainBri(gid);
  vec2 B = dustPos(gid, e);
  float da = hh(gid, 12.0) * TAU;
  B += normalize(vec2(cos(da), sin(da) * 0.6 - 0.7)) * 4.0 * uU * max(e - 8.0, 0.0);
  px = uC + (B - uC) * uPush;
  size = mix(1.0, 2.0, hh(gid, 13.0)) * grainSize(gid) * uU;
  float tw = 0.55 + 0.45 * sin(t * (1.3 + 3.0 * hh(gid, 14.0)) + hh(gid, 15.0) * TAU);
  float I = 0.45 * (0.4 + 0.6 * exp(-0.3 * e)) * tw * (1.0 + 3.0 * spark) * bri;
  col = vec4(min(c * I, vec3(6.0)), uDustI * cloudFeather(px - uShake) * grainShield(px));
}`, { fs: GRAIN_FS }),
      dots: particles.program('s02.dots', DOTS_GLSL, { fs: DOTS_FS }),
    };
    const Lin = h => ctx.hexLin(h);
    this.col = Object.assign(skyColours(ctx), {
      ruleCore: ctx.displayToScene('#FFE7A3'), ruleGlow: ctx.displayToScene('#D4A64A'), hot: Lin('#FFF4D6'),
      p1: Lin('#FFE7A3'), p2: Lin('#D4A64A'), p3: Lin('#B8862B'), ember: [3.2, 2.3, 1.1],
    });
    const P = ctx.portrait;
    this.geo = {
      LC: P ? [540, 960] : [960, 540],          // rule centre
      // small caps at the house minimum (30 px landscape, 34 portrait), the from-line at a readable italic size
      capsY: P ? 922 : 506, fromY: P ? 1024 : 598, x: P ? 540 : 960,
      capsSize: P ? 34 : 30, fromSize: P ? 50 : 48,
    };
    const g = this.geo;
    // the opening rule frames the dateline (its ink plus 40 px a side, at least 600 px in all)
    const dm = ctx.text.measure(this.dateEntry(0)), fm = ctx.text.measure(this.fromEntry(0));
    const dHalf = (dm.inkR - dm.inkL) / 2, fHalf = (fm.inkR - fm.inkL) / 2;
    g.half0 = Math.round(Math.min(ctx.W / 2 - 60, Math.max(300, dHalf + 40)));
    // portrait: the rule widens once more as the lines leave, then runs out to the full width
    g.halfMid = P ? Math.min(ctx.W / 2 - 30, g.half0 + 60) : null;
    // star and grain shield of the two lines (frame px)
    const hw = Math.max(dHalf, fHalf) + 30;
    g.textBox = [g.x - hw, g.capsY - dm.asc - 14, g.x + hw, g.fromY + fm.desc + 14];
    this.fx = createShoreFx(ctx);
  },
  dateEntry(tau) {
    const g = this.geo;
    return { lineId: 'L2a', tau, x: g.x, y: g.capsY, style: { base: 'caps', size: g.capsSize, tracking: 0.30 },
      enter: { base: 'caps', dur: 0.6, stagger: 0.015 }, exit: { at: 27.8 - 24.0, kind: 'default' } };
  },
  fromEntry(tau) {
    const g = this.geo;
    return { lineId: 'L2b', tau, x: g.x, y: g.fromY, style: { base: 'narrative', size: g.fromSize }, exit: { at: 27.8 - 25.0, kind: 'default' } };
  },
  // continuous act-I camera: the scene-2 rest pose (push held at 1.03), then a slow push and lift while the credit
  // holds (the sky only; the rule and the type stay locked)
  skyCam(ctx, t) {
    const c = camAt(12, ctx.W), tl = ctx.tl;
    const k = tl.seg(t, 23.5, 29.0, tl.E.inOutSine);
    return { s: c.s * 1.03 * (1 + 0.015 * k), rot: c.rot, lift: -6 * ctx.U * k, push: 1.03 * (1 + 0.015 * k) };
  },
  // the sea camera and horizon are scene 4's own functions (valid before 30.0): one move across the cut
  seaCam(ctx, t) { return shoresCam(ctx, t); },
  ruleY(ctx, t) { return shoresHz(ctx, t); },
  // hand-over weight to scene 4's rule, lights and post
  handover(ctx, t) { return ctx.tl.seg(t, HO0, HO1, ctx.tl.E.inOutSine); },
  // half-length of the rule
  ruleHalf(ctx, t) {
    const g = this.geo, tl = ctx.tl;
    let h = 0;
    if (t > TL) {
      // 700 px/s each way, easing into its half-length (complete by about 24.25, while the dateline sets)
      const lin = 700 * (t - TL), a = Math.min(180, g.half0 * 0.6);
      h = lin < a ? lin : a + (g.half0 - a) * tl.E.outCubic(tl.clamp01((lin - a) / (1.5 * (g.half0 - a))));
    }
    const full = ctx.W / 2 + 40;
    if (g.halfMid) {
      // portrait: full width by 29.3, before the hand-over to scene 4's full-width rule begins
      h += (g.halfMid - g.half0) * tl.seg(t, 28.0, 28.7, tl.E.inOutCubic);
      h += (full - g.halfMid) * tl.seg(t, 28.7, 29.3, tl.E.inOutSine);
    } else h += (full - g.half0) * tl.seg(t, 28.0, 29.2, tl.E.inOutCubic);
    return h;
  },
  render(ctx, tau, p, target) {
    const { G, tl, sea } = ctx;
    const t = T0 + tau;
    const cam = this.skyCam(ctx, t);
    const C = this.L.C;
    const w = tl.smoothstep(28.8, 30.0, t);
    const hz = this.ruleY(ctx, t);
    const dy = hz - this.geo.LC[1];                    // the sky slides with the tilt (and lifts during the hold)
    const drift = [0, (dy + cam.lift) / cam.s];
    const dim = 0.5 - 0.15 * tl.seg(t, 28.5, 30.0, tl.E.inOutSine);
    const neb = G.target('s03.neb', ctx.W * 0.5 * target.scale, ctx.H * 0.5 * target.scale, { scale: 0.5 * target.scale });
    G.draw(this.P.neb, { uC: C, uDrift: drift, uCamS: cam.s, uCamRot: cam.rot, uVis: 1,
      uNebA: this.col.nebA, uNebB: this.col.nebB, uWoad: this.col.woad }, neb);
    G.draw(this.P.sky, { uNeb: neb, uNebDim: dim, uC: C, uDrift: drift, uCamS: cam.s, uCamRot: cam.rot, uU: ctx.U,
      uShield: this.shields(ctx, t), uShieldK: 0.85 * (1 - tl.seg(t, 28.6, 29.3)), uHz: hz, uBelow: tl.seg(t, 28.2, 29.1, tl.E.inOutSine), uTw: t - 0.15, uVisField: dim, uGround: this.col.ground, uS1: this.col.s1, uS2: this.col.s2, uS3: this.col.s3 }, target);
    if (w > 0) {
      const sp = this.seaParams(ctx, t);
      sea.engraved(target, Object.assign(sp, { alpha: w, blend: 'premul' }));
    }
    // the rule: scene 3's drawn hairline, crossfading 29.3-30.0 into scene 4's own horizon rule and lights (scene 4's
    // fx with scene 4's values at 30.0), so the cut is seamless
    const half = this.ruleHalf(ctx, t);
    const ho = this.handover(ctx, t);
    if (half > 0.5 && ho < 1) {
      const tipDraw = tl.seg(t, TL, TL + 0.15) * (1 - tl.seg(t, TL + 0.5, 24.3, tl.E.inOutSine));
      const tipExt = tl.smoothstep(27.9, 28.3, t) * (1 - tl.smoothstep(29.0, 29.4, t));
      const I = (1 - ho) * (0.75 + 0.25 * tl.smoothstep(TL, TL + 0.35, t));
      G.draw(this.P.rule, { uLC: this.geo.LC, uHalf: half, uY: hz, uI: I, uTipI: (0.9 * tipDraw + 0.6 * tipExt) * (1 - ho), uU: ctx.U,
        uCore: this.col.ruleCore, uGlow: this.col.ruleGlow }, target, { blend: 'add' });
    }
    if (ho > 0) this.fx.draw(target, this.handoverFx(ctx, t, ho));
  },
  // scene 4's horizon rule and lights, weighted by the hand-over: its values at 30.0 times ho (positions at t)
  handoverFx(ctx, t, ho) {
    const has = typeof S04.fxUniforms === 'function' && S04.arc;
    const u = has ? S04.fxUniforms(ctx, t) : null, u30 = has ? S04.fxUniforms(ctx, HO1) : null;
    const hz = this.ruleY(ctx, t);
    if (!u) return { uRule: [hz, ho, 0, 0] };
    const lt = Float32Array.from(u.uLt);
    lt[2] = u30.uLt[2] * ho; lt[6] = u30.uLt[6] * ho;
    return { uRule: [u.uRule[0], u30.uRule[1] * ho, u.uRule[2], u.uRule[3]], uLt: lt, uLtS: u.uLtS, uRoll: u.uRoll || 0 };
  },
  shields(ctx, t) {
    const s2 = S02;
    const r = new Float32Array(12);
    if (t < 23.6) r.set(s2.shields().subarray(0, 8));
    else r.set(this.geo.textBox);
    return r;
  },
  // scene 4's sea at t, its lights at their 30.0 level times the hand-over weight
  seaParams(ctx, t) {
    const sp = shoresSea(ctx, t), s30 = shoresSea(ctx, HO1), ho = this.handover(ctx, t);
    sp.lights = sp.lights.map((l, i) => { const o = l.slice(); o[1] = (s30.lights[i] ? s30.lights[i][1] : 0) * ho; return o; });
    return sp;
  },
  overlay(ctx, tau, p, target) {
    const { G, tl, particles, text, gold } = ctx;
    const t = T0 + tau;
    const s2 = S02;
    // ejecta dust of scene 2 keeps drifting at 4 px/s with the sky, then fades before the sea arrives
    const dustI = 1 - tl.seg(t, 27.0, 28.6, tl.E.inOutSine);
    if (dustI > 0) {
      const cam = this.skyCam(ctx, t);
      const u = s2.grainUniforms(ctx, t, { uDustI: dustI, uNName: 18000 });
      u.uPush = cam.push; u.uShake = [0, this.ruleY(ctx, t) - this.geo.LC[1] + cam.lift];
      // grain shield: the title's caps line while it leaves, then the two credit lines
      if (t < 23.6) u.uGShieldK = 0.8 * (1 - tl.seg(t, 22.5, 23.3));
      else { u.uGShield = this.geo.textBox; u.uGShieldK = 0.8 * tl.seg(t, 23.8, 24.6) * (1 - tl.seg(t, 27.8, 28.6)); }
      particles.draw(this.P.dust, 6000, u, target);
    }
    // the burning name: front progress in field units; nothing has burned yet at 22.5 (continuity with scene 2)
    const q = (t - T0) / Q_DUR - Q_LEAD;
    const box = [s2._ink[0], s2._ink[2], s2._ink[1], s2._ink[3]];
    const fieldU = { uNameBox: box, uFU: ctx.U };
    if (q < 1.15) {
      const ent = nameEntry(ctx, this.L, t - 15.0);
      const m = text.drawMask(ent);
      if (m.lineOpacity > 0) {
        const r = m.rect;
        const mt = G.acquire(r[2], r[3], { format: 'rgba8', mips: true });
        G.draw(this.P.mask, Object.assign({ uSrc: m.rt, uRect: r, uQ: q }, fieldU), mt);
        G.mipmaps(mt);
        const size = m.lay.line.size, U = ctx.U;
        // the same bevel as gold.drawText gives the title in scene 2 (continuity at 22.5), narrowing to lod 1.5 as the
        // burn starts so no blocky islands of leaf survive
        const lod0 = Math.min(2.0, Math.max(0.5, Math.log2(size / 40)));
        const lod = lod0 + (Math.min(lod0, 1.5) - lod0) * tl.seg(t, 22.5, 22.8, tl.E.inOutSine);
        const g = s2.nameGold(ctx, t);
        gold.draw(target, { mask: mt, rect: r, maskFlipY: true, textMask: true, lod, bump: size >= 160 * U ? 8.5 : 6, blend: 'add',
          detail: Math.min(1, Math.max(0, (size - 50 * U) / (60 * U))), key: g.key, keyZ: size * 2.5 + 120 * U, keyI: g.keyI });
        G.draw(this.P.ember, Object.assign({ uSrc: m.rt, uRect: r, uQ: q, uI: 1.0, uHot: this.col.ember }, fieldU), target,
          { blend: 'add', mode: G.gl.TRIANGLE_STRIP, count: 4 });
        G.release(mt);
      }
      text.releaseMask(m);
    }
    // the red dots go first, before the front reaches the capital
    const df = 1 - tl.seg(t, 22.5, 22.95, tl.E.inCubic);
    if (df > 0) particles.draw(this.P.dots, 56, { uTau: t, uDots: s2._dots, uT0: 19.0, uFade: df, uU: ctx.U, uRed: s2.col.red, uHi: s2.col.redHi }, target);
    // grains of the name
    if (t < 26.0) {
      particles.draw(this.P.dis, N_DIS, Object.assign({
        uTau: t, uHome: s2._home, uU: ctx.U, uQ0: T0 + Q_DUR * Q_LEAD, uQdur: Q_DUR, uSeed: 5.1, uLen0: this.geo.half0, uTL: TL,
        uHalf: Math.min(this.ruleHalf(ctx, t), this.geo.half0), uLC: [this.geo.LC[0], this.ruleY(ctx, t)],
        uC1: this.col.p1, uC2: this.col.p2, uC3: this.col.p3, uHot: this.col.hot,
      }, fieldU), target);
    }
  },
  captions(ctx, tau) {
    const t = T0 + tau, g = this.geo;
    const out = [];
    // L1a (set in scene 2) leaves with the name
    if (t < 23.5) out.push({ lineId: 'L1a', tau: t - 15.0, x: this.L.capsX, y: this.L.capsY, style: 'caps', exit: { at: 22.5 - 15.0, kind: 'default' } });
    // both lines are gone by 28.6, before the sea begins to show under the rule
    out.push(this.dateEntry(t - 24.0));
    out.push(this.fromEntry(t - 25.0));
    return out;
  },
  lookAt(ctx, tau) {
    const w = ctx.tl.smoothstep(28.8, 30.0, T0 + tau);
    return w <= 0 ? 'winter_gold' : [{ look: 'winter_gold', w: 1 }, { look: 'night_sea', w }];
  },
  // chromatic aberration stays at about a pixel in the corners over the engraving; 29.3-30.0 every post setting
  // blends into scene 4's at 30.0 (its look and its post()), so the grade, bloom and lens do not jump at the cut
  post(ctx, tau) {
    const t = T0 + tau, ho = this.handover(ctx, t);
    const own = { ghosts: 0, streak: { strength: 0.0 }, ca: 0.0012 };
    if (ho <= 0 || !ctx.post || !ctx.post.lerp) return own;
    const a = ctx.post.params(this.lookAt(ctx, tau), own);
    const b = ctx.post.params(S04.lookAt ? S04.lookAt(ctx, 0) : S04.look, S04.post ? S04.post(ctx, 0) || {} : {});
    return ctx.post.lerp(a, b, ho);
  },
};
export default scene;
