/*
  Scene 9: ocean-later (108.0-117.0), package P6.
  Flight low over the engraved sea of scene 4 (core/sea.js engraved(), lines #E3B341 near -> #6E4A12 far): the camera
  flies 14 m above the water at 9 m/s, forward and to the right, banking 4 degrees (right wing down), with
  motion-widened line AA from the previous frame's camera (shutter 0.6, no sub-samples). The gold arc of scene 4
  stands high and steady in the sky (left 30 percent lit, the right end cooled), both horizon lights brighter (70 px
  halo); arc and lights are world directions, so they roll with the bank and are smeared over the shutter when the
  camera turns. The build (bodhran hits 108.0-113.0 and the tipper roll 114.0-116.95) pulses the lights and the
  burin pressure of the hatch; 114.0-116.4 the swell grows 40 percent and the hatch tightens 0.35 -> 0.28 m;
  116.4-117.0 the camera pitches up 50 degrees (easeInQuad): the stars stream into frame (streaked over the shutter),
  horizon, lights and arc fall out of the bottom. 117.000 is a hard cut to scene 10 (cue 'stop').
  Line L14 at 108.0 over a caption shield; mist exit 113.6-114.8.
*/
import { shoresLayout, toScene, createShoreFx, createShield } from './s04_two_shores.js';

const T0 = 108.0;
// the shared engraved shader turns lines that the shutter smears together into mist; during the whip-tilt this pass
// adds back their mean gold (the duty cycle of the hatch), so the sea leaves the frame as a blurred gold engraving
const TONE_FS = `
uniform float uHzC, uAng, uK, uSpan; uniform vec3 uCol, uColC; uniform vec4 uLx;   // light columns: x0, x1, width, I
out vec4 o;
void main(){
  vec2 p = framePx();
  float below = (p.y - uHzC - tan(uAng) * (p.x - uFrame.x * 0.5)) * cos(uAng);
  float cov = clamp(below + 0.5, 0.0, 1.0);
  float nearS = clamp(below / uSpan, 0.0, 1.0);
  // the lights' reflection columns survive a vertical smear: soft gold pillars under each light
  float colm = exp(-0.5 * pow((p.x - uLx.x) / (uLx.z * (0.6 + 0.9 * nearS)), 2.0)) + exp(-0.5 * pow((p.x - uLx.y) / (uLx.z * (0.6 + 0.9 * nearS)), 2.0));
  // the hatch's brightness varies along each line (sheen, crests): under a vertical smear that survives as soft
  // vertical gold streaks, not a flat plane
  float st = 0.45 + 1.1 * vn(vec2(p.x / 19.0, below / 240.0 + 3.0)) * (0.5 + vn(vec2(p.x / 67.0 + 7.0, below / 520.0)));
  o = vec4((uCol * st * mix(0.35, 1.0, sqrt(nearS)) + uColC * colm * uLx.w * (0.5 + 0.5 * nearS)) * uK * cov, 0.0);
}`;
const DEG = Math.PI / 180;
// the build's percussion (master timeline, section 8): hits and the bar-39 tipper roll
function buildHits(ctx) {
  const ev = ctx.events('build_hits');
  if (ev.length) return ev.map(e => [e.t, e.vel == null ? 0.3 : e.vel]);
  const h = [[108.0, 0.30], [108.33, 0.20], [111.0, 0.40], [111.33, 0.28], [113.0, 0.30]];
  for (let t = 114.0, i = 0; t < 116.96; t += 0.083, i++) h.push([t, 0.15 + 0.55 * (t - 114.0) / 2.95]);
  return h;
}

const scene = {
  id: 's09_ocean_later', t0: 108.0, t1: 117.0, internalScale: 1, look: 'night_sea',
  async init(ctx) {
    this.L = shoresLayout(ctx);
    this.fx = createShoreFx(ctx);
    this.shield = createShield(ctx, 's09');
    this.hits = buildHits(ctx);
    const L = this.L;
    // world directions of the arc's control points and the lights, fixed by the level camera of scene 4's framing
    const cam0 = { h: 14, x: 0, z: 0, yaw: 0, pitch: ctx.horizonPitch(L.hz, ctx.H, 0.6), roll: 0, fovY: 0.6 };
    const S = ctx.sea;
    this.dirs = { east: S.ray(cam0, L.east[0], L.hz - 0.5), west: S.ray(cam0, L.west[0], L.hz - 0.5), ctrl: S.ray(cam0, L.ctrl[0], L.ctrl[1]) };
    this.arc0 = this.fx.arc(L.east, L.ctrl, L.west);
    this.lineCols = { near: '#E3B341', far: '#6E4A12' };
    this.toneP = ctx.G.program('s09.tone', ctx.glsl.frag(TONE_FS));
    const a = toScene(ctx, '#4C3A1E'), b = toScene(ctx, '#07161D');
    this.toneCol = toScene(ctx, '#B8862B');
    this.toneC = a.map((v, i) => Math.max(0, v - b[i]));
  },
  cam(ctx, t) {
    const { tl } = ctx, L = this.L;
    const e = t - 107.4;                              // already moving under the ink bleed
    const dir = 35 * DEG;                             // the track: forward and to the right
    // the bank breathes between about 1.8 and 4 degrees and the height bobs gently, so it reads as flight, not a
    // tilted still
    const bank = -4 * DEG * tl.seg(t, 107.4, 110.0, tl.E.inOutSine) * (0.55 + 0.45 * Math.sin(2 * Math.PI * 0.11 * (t - 108)));
    const h = 14 + 0.6 * Math.sin(2 * Math.PI * 0.17 * (t - 108));
    const up = 50 * DEG * tl.seg(t, 116.4, 117.0, tl.E.inQuad);
    return { h, x: 9 * Math.sin(dir) * e, z: 9 * Math.cos(dir) * e, yaw: 0, roll: bank, pitch: ctx.horizonPitch(L.hz, ctx.H, 0.6) - up, fovY: 0.6 };
  },
  pulse(t) {
    let p = 0;
    for (const [th, v] of this.hits) { if (t >= th && t - th < 1.0) p += v * Math.exp(-(t - th) / 0.14); }
    return Math.min(p, 1.2);
  },
  build(ctx, t) { return ctx.tl.seg(t, 114.0, 116.4, ctx.tl.E.inOutSine); },
  narrative(ctx, t) {
    const L = this.L;
    const e = { lineId: 'L14', tau: t - 108.0, x: ctx.W / 2, y: L.textY, style: { base: 'narrative', size: L.textSize }, exit: { at: 5.6, kind: 'mist' } };
    if (ctx.portrait) e.breaks = [6];
    return e.tau > -0.01 && e.tau < 7.0 ? [e] : [];
  },
  render(ctx, tau, p, target) {
    const t = T0 + tau;
    const cam = this.cam(ctx, t), prev = this.cam(ctx, t - 1 / 30);
    const S = ctx.sea;
    const b = this.build(ctx, t), pu = this.pulse(t);
    const lights = [];
    for (const k of ['west', 'east']) {
      const pp = S.project(cam, this.dirs[k]);
      if (pp && pp[0] > -200 && pp[0] < ctx.W + 200) lights.push([pp[0], (1.35 + 0.5 * pu) * (k === 'west' ? 1.1 : 1.0), 1, 24]);
    }
    const shield = this.shield.build(this.narrative(ctx, t));
    S.engraved(target, {
      tau: t - 100.0, cam, camPrev: prev, motionAA: 0.6, look: 'night_sea',
      amp: 1 + 0.4 * b, spacing: 0.35 - 0.07 * b, width: 1 + 0.18 * pu,
      lineNear: this.lineCols.near, lineFar: this.lineCols.far, lineDim: '#7A5216',
      lights, stars: 0, shield, shieldK: 0.82,
    });
    S.stars(target, cam, { tau: t - 100.0, I: 0.55 + 0.7 * ctx.tl.seg(t, 116.3, 116.9), camPrev: prev, shutter: 0.15 });
    // the smeared hatch's mean tone (only while the camera pitches)
    const hz0 = S.horizonY(cam, 0), hz1 = S.horizonY(cam, ctx.W);
    const sweep = Math.abs(S.horizonY(prev, ctx.W / 2) - S.horizonY(cam, ctx.W / 2)) * 0.6;
    const k = 1 - Math.exp(-sweep / 14);
    if (k > 0.01 && (hz0 + hz1) / 2 < ctx.H + 50) {
      const lx = lights.map(l => l[0]);
      // at under half strength: the sea stays dark, its gold showing as streaks (never a flat khaki plane)
      ctx.G.draw(this.toneP, { uHzC: (hz0 + hz1) / 2, uAng: Math.atan2(hz1 - hz0, ctx.W), uK: k * 0.45, uSpan: Math.max(200, ctx.H - (hz0 + hz1) / 2), uCol: this.toneC,
        uColC: this.toneCol, uLx: [lx[0] == null ? -1e4 : lx[0], lx[1] == null ? -1e4 : lx[1], 26, 0.55 + 0.3 * pu] }, target, { blend: 'add' });
    }
    // arc and lights in the scene target, so the ink-bleed from scene 8 reveals them with the sea
    this.drawFx(ctx, tau, target);
  },
  drawFx(ctx, tau, target) {
    const t = T0 + tau, S = ctx.sea, A = this.arc0;
    const cam = this.cam(ctx, t), prev = this.cam(ctx, t - 0.6 / 30);
    const P = (c, k) => S.project(c, this.dirs[k]);
    const a = P(cam, 'east'), b = P(cam, 'ctrl'), c = P(cam, 'west');
    if (!a || !b || !c) return;
    const pu = this.pulse(t);
    const u = { uA: a, uB: b, uC: c, uLen: A.len, uLut: A.lut, uTau: t - T0, uArcOn: 1, uProg: 1, uTip: [0, 0, 0] };
    // re-measure the arc length on screen (the bank and the pitch change it slightly)
    const arc = this.fx.arc(a, b, c);
    u.uLen = arc.len; u.uLut = arc.lut;
    u.uBand = [0, 115, 0, 0.3];
    u.uPark = [0.70 * arc.len, arc.len + 200, 1.0 + 0.10 * pu, 0.55];
    u.uArcK = [0.95, 1.4, 1.1, 0.22];
    const sc = ctx.U;
    const I = 1.35 + 0.6 * pu;
    u.uLt = new Float32Array([c[0], c[1], I * 1.1, 70 * sc, a[0], a[1], I, 70 * sc]);
    u.uLtS = [150 * sc, 0.55, 2.2, 0.0];
    // smear over the shutter while the camera pitches up
    const b2 = P(prev, 'ctrl');
    if (b2) { const sm = [b2[0] - b[0], b2[1] - b[1]]; if (Math.hypot(sm[0], sm[1]) > 0.5) { u.uSmear = sm; u.uSmearN = 2; } }
    // the horizon: an engraver's faint rule through both lights, following the bank
    const ang = Math.atan2(a[1] - c[1], a[0] - c[0]);
    u.uRoll = -ang;                                   // the streaks are rotated into the horizon's frame
    const yc = c[1] + (a[1] - c[1]) * (ctx.W / 2 - c[0]) / (a[0] - c[0]);
    u.uRule = [yc, 0.06, ang, 0];
    this.fx.draw(target, u, { viewport: [0, 0, ctx.W, ctx.H] });
  },
  captions(ctx, tau) { return this.narrative(ctx, T0 + tau); },
  // chromatic aberration kept low so the starfield and the hatch stay clean
  post() { return { ca: 0.0012, ghosts: 0 }; },
};
export default scene;
