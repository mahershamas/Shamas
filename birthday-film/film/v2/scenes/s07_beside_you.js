/*
  Scene 7: beside-you (73.0-90.0), package P7.
  The photograph full-bleed with a slow push-in (landscape: crop keyframes of the build sheet; portrait: the face-fit
  layout, photo 1690 px wide, the face box centred on x = 540, top and bottom dissolving into warm mist).
    73.5-75.0 forgetting: depth of field 0 -> 14 px, warm bokeh discs bloom from the photo's own highlights and drift
              up, an amber haze lifts the blacks 3 %; held to 77.0, then a sprung rack focus back to sharp.
    78.0-83.0 feeling: a warm rim light on both heads at once, its direction sweeping 15 degrees.
    84.0      "Easy.": white balance +250 K over 0.6 s, held to 86.0, eased back over 2.0 s; halation 0.06 -> 0.09.
    84.0-88.4 the gold thread runs along the seat (hidden behind the people), ties a two-loop knot between them
              (86.0-86.6) and a star glint lands on the pendant at 87.0 (cue 'pearl'); harp sparkles brighten the tip.
  Lines L9 (shared with scene 6 from 72.0: the same entry, so the cut at 73.0 is invisible), L10, L11a + L11b.
  Every photo landmark is read from window.PHOTO_META through core/photo.js; nothing private is written here.

  Exported for scenes 6 and 8 (same package):
    cam7(ctx, t) -> Cam            the scene camera at absolute time t (asserts the face box)
    fullRect(cam) -> [x, y, w, h]  frame rect of the whole image under a camera
    l9Entry(ctx, t)                the caption entry of line L9 (scene 6 shows it from 72.0 on the same clock)
    scrimAlpha(ctx)                the bottom caption scrim (landscape only)
*/
import { lerpCrop } from '../core/photo.js';

const T0 = 73.0;
const CROP_A = [0, 136, 1448, 950], CROP_B = [170, 140, 1230, 736];   // generic 16:9 crops of the whole image (source px)

function portraitCrop(ctx, push) {
  const m = window.PHOTO_META, PW = m.size[0], PH = m.size[1], fb = m.faceBoxUV;
  const cx = (fb.x0 + fb.x1) / 2 * PW;                     // face-box centre x -> frame x 540
  const s = (1690 / PW) * push, fx = 540, fy = 226 + 1267 / 2;
  const cy = PH / 2;                                        // the image centred vertically on y 859.5 (spans 226-1493)
  return [cx - fx / s, cy - fy / s, cx + (ctx.W - fx) / s, cy + (ctx.H - fy) / s];
}
export function cam7(ctx, t) {
  const tl = ctx.tl;
  const k = tl.seg(t, 73.0, 90.0, tl.E.inOutSine);
  if (ctx.portrait) return ctx.photoCamera(portraitCrop(ctx, 1 + 0.05 * k), { tag: 's07' });
  return ctx.photoCamera(lerpCrop(CROP_A, CROP_B, k), { tag: 's07' });
}
export function fullRect(cam) {
  const m = window.PHOTO_META;
  const a = cam.toFrame([0, 0]), b = cam.toFrame([m.size[0], m.size[1]]);
  return [a[0], a[1], b[0] - a[0], b[1] - a[1]];
}
export function captionY(ctx) { return ctx.portrait ? 1580 : 930; }
export function photoStyle(ctx) { return { base: 'narrativePhoto', size: ctx.portrait ? 45 : 50 }; }
export function l9Entry(ctx, t) {
  return { lineId: 'L9', tau: t - 72.0, x: ctx.W / 2, y: captionY(ctx), style: photoStyle(ctx), shadow: { dy: 0.5, alpha: 0.3, blur: 1 },
    exit: { at: 4.0, kind: 'forget', dur: 1.4 } };
}

// bottom scrim for the captions: black 0 % at y 760 -> 45 % at y 1080 (premultiplied over the photo)
const SCRIM_FS = `
uniform vec2 uY; uniform float uA;
out vec4 o;
void main(){
  float y = framePx().y;
  float k = clamp((y - uY.x) / (uY.y - uY.x), 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k) * 0.55 + k * 0.45;            // a soft shoulder at the top of the gradient
  o = vec4(0.0, 0.0, 0.0, uA * 0.45 * k);
}`;
// warm mist behind the portrait layout (top and bottom of the frame), with a slow breathing fbm
const MIST_FS = `
uniform vec3 uA, uB, uC; uniform float uT, uAl;
out vec4 o;
void main(){
  vec2 p = framePx();
  float y = p.y / uFrame.y;
  float n = fbm(p / 420.0 + vec2(uT * 0.02, -uT * 0.035), 4);
  float m = fbm(p / 160.0 + vec2(-uT * 0.05, uT * 0.02) + 7.0, 3);
  vec3 c = mix(uB, uA, smoothstep(0.0, 0.5, abs(y - 0.45) * 1.4));
  c *= 0.78 + 0.34 * n + 0.10 * (m - 0.5);
  float r = length((p - vec2(0.5, 0.45) * uFrame) / uFrame.y);
  c += uC * exp(-r * r * 3.0) * 0.25;
  o = vec4(c * uAl, uAl);
}`;

// separable Gaussian (linear-sampled pairs): the depth of field of the forgetting. The photo module's 5-tap mip DoF
// shows a checker pattern on fine high-contrast edges (glasses, collar) at 14 px, so the scene renders the photo sharp
// into a scratch target and blurs it here (half resolution once sigma >= 0.5 frame px).
const BLUR_FS = `
uniform sampler2D uSrc; uniform vec2 uDir; uniform float uSigma; uniform int uN;
out vec4 o;
void main(){
  vec2 uv = screenUV();
  vec3 acc = texture(uSrc, uv).rgb; float ws = 1.0;
  float k = -0.5 / max(uSigma * uSigma, 1e-4);
  for (int i = 1; i <= 32; i++){
    if (i > uN) break;
    float x0 = float(2 * i - 1), x1 = float(2 * i);
    float w0 = exp(x0 * x0 * k), w1 = exp(x1 * x1 * k), w = w0 + w1;
    float off = (x0 * w0 + x1 * w1) / w;
    acc += (texture(uSrc, uv + uDir * off).rgb + texture(uSrc, uv - uDir * off).rgb) * w;
    ws += 2.0 * w;
  }
  o = vec4(acc / ws, 1.0);
}`;
const COPY_FS = `uniform sampler2D uSrc; out vec4 o; void main(){ o = vec4(texture(uSrc, screenUV()).rgb, 1.0); }`;
// the portrait layout's warm mist (scenes 6 and 8 fade it in and out around the cuts)
export function createMist(ctx) {
  const prog = ctx.G.program('s07.mist', ctx.glsl.frag(MIST_FS));
  const pp = ctx.post.params('photo');
  const S = h => ctx.displayToScene(h, pp);
  const col = { a: S('#120C08'), b: S('#1A120C'), c: S('#3A2414') };
  return (target, t, alpha = 1) => { if (alpha > 0) ctx.G.draw(prog, { uA: col.a, uB: col.b, uC: col.c, uT: t - 73, uAl: alpha }, target, { blend: alpha < 1 ? 'premul' : null }); };
}
export function createBlur(ctx) {
  const { G, glsl } = ctx;
  const P = { blur: G.program('s07.blur', glsl.frag(BLUR_FS)), copy: G.program('s07.copy', glsl.frag(COPY_FS)) };
  // src: a full-resolution target; result written opaque into dst (sigma in frame px)
  return function blur(src, dst, sigma) {
    const W = ctx.W, H = ctx.H;
    const n = s => Math.max(1, Math.min(32, Math.ceil(3 * s / 2)));
    if (sigma < 0.5) {
      const T = G.acquire(W, H, { format: 'hdr' });
      G.draw(P.blur, { uSrc: src, uDir: [1 / W, 0], uSigma: sigma, uN: n(sigma) }, T);
      G.draw(P.blur, { uSrc: T, uDir: [0, 1 / H], uSigma: sigma, uN: n(sigma) }, dst);
      G.release(T);
      return;
    }
    const w = Math.ceil(W / 2), h = Math.ceil(H / 2);
    const A = G.acquire(w, h, { format: 'hdr', scale: 0.5 }), B = G.acquire(w, h, { format: 'hdr', scale: 0.5 });
    G.draw(P.blur, { uSrc: src, uDir: [1 / W, 0], uSigma: sigma, uN: n(sigma) }, A);          // horizontal, full-res taps, 2x down
    G.draw(P.blur, { uSrc: A, uDir: [0, 1 / h], uSigma: sigma / 2, uN: n(sigma / 2) }, B);  // vertical at half res
    G.draw(P.copy, { uSrc: B }, dst);
    G.release(A); G.release(B);
  };
}

const scene = {
  id: 's07_beside_you', t0: 73.0, t1: 90.0, internalScale: 1, look: 'photo',
  async init(ctx) {
    const { G, glsl } = ctx;
    this.P = { scrim: G.program('s07.scrim', glsl.frag(SCRIM_FS)) };
    this.mist = createMist(ctx);
    this.blur = createBlur(ctx);
    this.camRef = cam7(ctx, 73.0);
    this.sparkle = ctx.events('thread_sparkle').map(e => e.t);
    if (!this.sparkle.length) for (let t = 84.0; t < 88.25; t += 0.6) this.sparkle.push(t);
    const pe = ctx.events('pearl');
    this.pearlT = pe.length ? pe[0].t : ctx.cue('pearl');
  },
  // the thread's drawing tip (source x) at time t
  threadTip(ctx, t) {
    const { tl } = ctx, PH = ctx.photoR, W = window.PHOTO_META.size[0];
    const kx = PH.knotPoint()[0], px = window.PHOTO_META.pendant[0];
    return tl.env(t, [[84.0, 0], [86.0, kx, tl.E.inOutSine], [86.6, kx], [this.pearlT, px, tl.E.inSine], [88.4, W, tl.E.outSine]]);
  },
  state(ctx, t) {
    const { tl } = ctx, E = tl.E;
    const rack = Math.max(0, 1 - tl.spring(t, 77.0, { zeta: 0.8, freq: 1.6 }));
    const blur = tl.seg(t, 73.5, 75.0, E.inOutSine) * (t < 77 ? 1 : rack);
    const feel = tl.env(t, [[78, 0], [79.2, 1, E.inOutSine], [82.4, 1], [83.6, 0, E.inOutSine]]);
    const easy = tl.env(t, [[84, 0], [84.6, 1, E.inOutSine], [86, 1], [88, 0, E.inOutSine]]);
    return { blur, dof: 14 * blur, haze: 0.03 * blur, feel, ang: -2.55 + (15 * Math.PI / 180) * tl.seg(t, 78, 83, E.inOutSine), easy, wb: 250 * easy };
  },
  render(ctx, tau, p, target) {
    const { G, tl } = ctx, PH = ctx.photoR;
    const t = T0 + tau;
    const cam = cam7(ctx, t);
    const s = this.state(ctx, t);
    const soft = s.dof > 0.05;
    const R = soft ? G.acquire(ctx.W, ctx.H, { format: 'hdr' }) : target;
    if (ctx.portrait) this.mist(R, t, 1);
    PH.draw(R, cam, {
      parallax: PH.parallax(cam, this.camRef),
      light: s.feel > 0 ? { I: 0.22 * s.feel, angle: s.ang, wash: 0.8, rim: 1.0 } : null,
      grade: { wb: s.wb, haze: s.haze },
      edgeFade: ctx.portrait ? { top: 80, bottom: 80 } : null,
    });
    if (soft) { this.blur(R, target, s.dof * 0.5); G.release(R); }
    if (s.blur > 0.002) PH.bokeh(target, cam, { I: s.blur, grow: s.blur, t: t - 73.5 });
    if (!ctx.portrait) G.draw(this.P.scrim, { uY: [760, 1080], uA: 1 }, target, { blend: 'premul', viewport: [0, 0, target.w, Math.ceil(320 * (target.scale || 1))] });
    // the thread
    if (t >= 84.0) {
      const tip = this.threadTip(ctx, t);
      let sp = 0;
      for (const te of this.sparkle) if (t >= te && t - te < 0.6) sp += Math.exp(-(t - te) / 0.12);
      const knot = tl.seg(t, 86.0, 86.6, tl.E.inOutSine);
      PH.thread(target, cam, { tip, knot: knot > 0 ? knot : null, steady: 0.7, I: 1 + 0.35 * Math.min(sp, 1.5),
        fresh: t < 88.4 ? 0.9 : 0.9 * (1 - tl.seg(t, 88.4, 89.2)) });
    }
    PH.glint(target, cam, { at: 'pendant', life: tl.seg(t, this.pearlT - 0.07, this.pearlT + 0.13), size: 24, I: 6 });
  },
  captions(ctx, tau) {
    const t = T0 + tau, out = [];
    const y = captionY(ctx), st = photoStyle(ctx), sh = { dy: 0.5, alpha: 0.3, blur: 1 };
    if (t < 77.6) out.push(l9Entry(ctx, t));
    if (t >= 78.0 && t < 83.6) out.push({ lineId: 'L10', tau: t - 78.0, x: ctx.W / 2, y, style: st, shadow: sh, enter: 'crisp', exit: { at: 4.6, kind: 'default', dur: 0.8 } });
    if (t >= 84.0 && t < 89.8) {
      const pair = ctx.text.flow([
        { lineId: 'L11a', tau: t - 84.0, x: ctx.W / 2, y, style: st, shadow: sh, gain: 1.15, glow: 0.16, enter: { base: 'opacity', dur: 1.0 }, exit: { at: 4.8, kind: 'default', dur: 0.8 } },
        { lineId: 'L11b', tau: t - 85.5, x: ctx.W / 2, y, style: st, shadow: sh, exit: { at: 3.3, kind: 'default', dur: 0.8 } },
      ], { x: ctx.W / 2 });
      out.push(pair[0]);
      if (t >= 85.5) out.push(pair[1]);
    }
    return out;
  },
  post(ctx, tau) {
    const t = T0 + tau;
    const s = this.state(ctx, t);
    return Object.assign(ctx.photoR.postParams(cam7(ctx, t)), { halation: 0.06 + 0.03 * s.easy });
  },
};
export default scene;
