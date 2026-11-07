/*
  Scene 7: beside-you (73.0-90.0), package P7.
  The photograph full-bleed with a slow push-in (landscape: crop keyframes of the build sheet; portrait: the face-fit
  layout, photo 1690 px wide, the face box centred on x = 540, top and bottom dissolving into warm mist).
    73.5-75.0 forgetting: depth of field 0 -> 14 px on the room (the faces only about 5 px, so they soften and never
              smear), warm bokeh discs bloom from the photo's own highlights and drift up, an amber haze lifts the
              blacks 3 %, the split tone nearly off; held to 77.0, then a sprung rack focus back to sharp.
    78.0-83.0 feeling: a warm rim light on both heads at once, its direction sweeping 15 degrees.
    84.0      line L11a: white balance +250 K over 0.6 s, held to 86.0, eased back over 2.0 s; halation 0.045 -> 0.065.
    84.0-88.4 the gold thread runs along the seat (hidden behind the people), pausing between them (86.0-86.6), and a
              star glint lands on the pendant at 87.0 (cue 'pearl'); harp sparkles brighten the tip.
  Legibility: under each caption row the photo is softened and darkened about 50 % (feathered band), plus the
  landscape bottom scrim (58 %).
  Lines L9 (shared with scene 6 from 72.0: the same entry, so the cut at 73.0 is invisible), L10, L11a + L11b.
  Every photo landmark is read from window.PHOTO_META through core/photo.js; nothing private is written here.

  Exported for scenes 6 and 8 (same package):
    cam7(ctx, t) -> Cam            the scene camera at absolute time t (asserts the face box)
    fullRect(cam) -> [x, y, w, h]  frame rect of the whole image under a camera
    l9Entry(ctx, t)                the caption entry of line L9 (scene 6 shows it from 72.0 on the same clock)
    scrimAlpha(ctx)                the bottom caption scrim (landscape only)
*/
import { lerpCrop } from '../core/photo.js';
import { drawCaptionBands, captionBoxes } from './s04_two_shores.js';

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
// portrait: 56 px (about 22 px x-height on an upright phone), the baseline a little lower so the ascenders stay clear
// of the photo's dissolving bottom edge at the end of the push
export function captionY(ctx) { return ctx.portrait ? 1588 : 930; }
export function photoStyle(ctx) { return { base: 'narrativePhoto', size: ctx.portrait ? 56 : 50 }; }
// a soft shadow only; legibility comes from the feathered band darkened under each line (drawCaptionBands)
export const CAPTION_SHADOW = { dy: 1, alpha: 0.35, blur: 4 };
export function l9Entry(ctx, t) {
  return { lineId: 'L9', tau: t - 72.0, x: ctx.W / 2, y: captionY(ctx), style: photoStyle(ctx), shadow: CAPTION_SHADOW,
    exit: { at: 4.0, kind: 'forget', dur: 1.4 } };
}

// bottom scrim for the captions: black 0 % at y 800 -> 58 % at y 1080 (premultiplied over the photo)
const SCRIM_FS = `
uniform vec2 uY; uniform float uA;
out vec4 o;
void main(){
  float y = framePx().y;
  float k = clamp((y - uY.x) / (uY.y - uY.x), 0.0, 1.0);
  k = k * k * (3.0 - 2.0 * k) * 0.55 + k * 0.45;            // a soft shoulder at the top of the gradient
  o = vec4(0.0, 0.0, 0.0, uA * 0.58 * k);
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
// portrait: the bokeh discs (drawn into a scratch target) are added only over the picture, fading out towards its
// dissolving top and bottom edges (uY: image top, image bottom, inset, fade length; frame px), never over the mist
const BOKEHMASK_FS = `
uniform sampler2D uSrc; uniform vec4 uY;
out vec4 o;
void main(){
  float y = framePx().y;
  float m = smoothstep(uY.x + uY.z, uY.x + uY.z + uY.w, y) * (1.0 - smoothstep(uY.y - uY.z - uY.w, uY.y - uY.z, y));
  o = vec4(texture(uSrc, screenUV()).rgb * m, 0.0);
}`;
// the faces keep a lighter blur than the room: the lightly blurred photo is laid over the heavily blurred one inside
// the two face ellipses (frame px), feathered over uF px
const FACEMIX_FS = `
uniform sampler2D uSrc; uniform vec4 uA, uB; uniform float uF;
out vec4 o;
float inE(vec4 e, vec2 p){
  vec2 q = (p - e.xy) / e.zw;
  float d = (length(q) - 1.0) * min(e.z, e.w);              // about frame px outside the ellipse
  return 1.0 - smoothstep(-uF, 0.0, d);
}
void main(){
  vec2 p = framePx();
  float m = max(inE(uA, p), inE(uB, p));
  o = vec4(texture(uSrc, screenUV()).rgb, 1.0) * m;
}`;
// legibility over the photograph: under each caption row the picture is softened (a 2-D Gaussian of about 3.5 px sigma, so
// a crisp edge such as the collar piping cannot cut through the word shapes) with the same feathered stadium as the
// darkening band, then darkened by drawCaptionBands
const SOFT_FS = `
uniform sampler2D uSrc; uniform vec4 uBox, uF; uniform vec2 uTexel;
out vec4 o;
void main(){
  vec2 sx = vec2(1.0 / uF.w, 1.0);
  vec2 p = framePx() * sx;
  vec2 c = 0.5 * (uBox.xy + uBox.zw) * sx, h = 0.5 * (uBox.zw - uBox.xy) * sx;
  float r = min(h.x, h.y);
  vec2 q = abs(p - c) - h + r;
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  float dd = max(d, 0.0) / uF.x;
  float a = exp(-2.2 * dd * dd) * uF.y;
  if (a < 0.003){ o = vec4(0.0); return; }
  vec2 uv = screenUV();
  vec3 acc = vec3(0.0); float ws = 0.0;
  for (int j = -3; j <= 3; j++) for (int i = -3; i <= 3; i++){
    vec2 k = vec2(float(i), float(j));
    float w = exp(-dot(k, k) / 4.5);
    acc += texture(uSrc, uv + k * 2.4 * uTexel).rgb * w; ws += w;
  }
  o = vec4(acc / ws, 1.0) * a;
}`;
export function createSoften(ctx) {
  const { G, glsl } = ctx;
  const P = { soft: G.program('s07.soft', glsl.frag(SOFT_FS)), copy: G.program('s07.copy', glsl.frag(COPY_FS)) };
  const ANISO = 2.6, F = 60 * ctx.U;
  return function soften(target, entries) {
    const boxes = [];
    for (const e of entries) for (const r of captionBoxes(ctx, e, 24 * ctx.U, 8 * ctx.U)) boxes.push(r);
    if (!boxes.length) return;
    const s = target.scale == null ? 1 : target.scale;
    const vps = boxes.map(({ box: b }) => {
      const x0 = Math.max(0, Math.floor((b[0] - 1.6 * F * ANISO) * s)), x1 = Math.min(target.w, Math.ceil((b[2] + 1.6 * F * ANISO) * s));
      const y0 = Math.max(0, Math.floor((ctx.H - (b[3] + 1.6 * F)) * s)), y1 = Math.min(target.h, Math.ceil((ctx.H - (b[1] - 1.6 * F)) * s));
      return [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
    });
    const C = G.acquire(target.w, target.h, { format: 'hdr', scale: s });
    for (const v of vps) G.draw(P.copy, { uSrc: target }, C, { viewport: [Math.max(0, v[0] - 8), Math.max(0, v[1] - 8), v[2] + 16, v[3] + 16] });
    boxes.forEach((r, i) => G.draw(P.soft, { uSrc: C, uBox: r.box, uF: [F, r.op, 0, ANISO], uTexel: [1 / target.w, 1 / target.h] }, target, { blend: 'premul', viewport: vps[i] }));
    G.release(C);
  };
}
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
  P.faceMix = G.program('s07.facemix', glsl.frag(FACEMIX_FS));
  // src: a full-resolution target; result written opaque into dst (sigma in frame px). rect (optional, frame px
  // [x0, y0, x1, y1]): only that region of dst is needed (each pass is restricted to it plus the kernel's reach)
  function blur(src, dst, sigma, rect) {
    const W = ctx.W, H = ctx.H;
    const n = s => Math.max(1, Math.min(32, Math.ceil(3 * s / 2)));
    const vpAt = (sc, tw, th, m) => {
      if (!rect) return null;
      const x0 = Math.max(0, Math.floor((rect[0] - m) * sc)), x1 = Math.min(tw, Math.ceil((rect[2] + m) * sc));
      const y0 = Math.max(0, Math.floor((H - rect[3] - m) * sc)), y1 = Math.min(th, Math.ceil((H - rect[1] + m) * sc));
      return [x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)];
    };
    const reach = 3 * sigma + 4;
    if (sigma < 0.5) {
      const T = G.acquire(W, H, { format: 'hdr' });
      G.draw(P.blur, { uSrc: src, uDir: [1 / W, 0], uSigma: sigma, uN: n(sigma) }, T, { viewport: vpAt(1, W, H, reach) });
      G.draw(P.blur, { uSrc: T, uDir: [0, 1 / H], uSigma: sigma, uN: n(sigma) }, dst, { viewport: vpAt(1, W, H, 0) });
      G.release(T);
      return;
    }
    const w = Math.ceil(W / 2), h = Math.ceil(H / 2);
    const A = G.acquire(w, h, { format: 'hdr', scale: 0.5 }), B = G.acquire(w, h, { format: 'hdr', scale: 0.5 });
    G.draw(P.blur, { uSrc: src, uDir: [1 / W, 0], uSigma: sigma, uN: n(sigma) }, A, { viewport: vpAt(0.5, w, h, reach + 4) });   // horizontal, full-res taps, 2x down
    G.draw(P.blur, { uSrc: A, uDir: [0, 1 / h], uSigma: sigma / 2, uN: n(sigma / 2) }, B, { viewport: vpAt(0.5, w, h, 4) });   // vertical at half res
    G.draw(P.copy, { uSrc: B }, dst, { viewport: vpAt(1, W, H, 0) });
    G.release(A); G.release(B);
  }
  // the forgetting's depth of field with the faces protected: the room at `sigma`, the faces (ellipses `faces`, frame
  // px) at `faceSigma`, the two blended over a `feather` px edge. Only the faces' bounding box gets the second pass.
  function blurFaces(src, dst, sigma, faceSigma, faces, feather) {
    blur(src, dst, sigma);
    const s = dst.scale == null ? 1 : dst.scale;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const e of faces) { x0 = Math.min(x0, e[0] - e[2]); x1 = Math.max(x1, e[0] + e[2]); y0 = Math.min(y0, e[1] - e[3]); y1 = Math.max(y1, e[1] + e[3]); }
    const vx0 = Math.max(0, Math.floor(x0 * s)), vx1 = Math.min(dst.w, Math.ceil(x1 * s));
    const vy0 = Math.max(0, Math.floor((ctx.H - y1) * s)), vy1 = Math.min(dst.h, Math.ceil((ctx.H - y0) * s));
    if (vx1 <= vx0 || vy1 <= vy0) return;
    const F = G.acquire(ctx.W, ctx.H, { format: 'hdr' });
    blur(src, F, faceSigma, [x0, y0, x1, y1]);
    G.draw(P.faceMix, { uSrc: F, uA: faces[0], uB: faces[1] || [0, 0, 1, 1], uF: feather }, dst, { blend: 'premul', viewport: [vx0, vy0, vx1 - vx0, vy1 - vy0] });
    G.release(F);
  }
  blur.faces = blurFaces;
  return blur;
}

const scene = {
  id: 's07_beside_you', t0: 73.0, t1: 90.0, internalScale: 1, look: 'photo',
  async init(ctx) {
    const { G, glsl } = ctx;
    this.P = { scrim: G.program('s07.scrim', glsl.frag(SCRIM_FS)), bokehMask: G.program('s07.bokehmask', glsl.frag(BOKEHMASK_FS)) };
    this.mist = createMist(ctx);
    this.blur = createBlur(ctx);
    this.soften = createSoften(ctx);
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
    const warmK = tl.env(t, [[84, 0], [84.6, 1, E.inOutSine], [86, 1], [88, 0, E.inOutSine]]);
    return { blur, dof: 14 * blur, haze: 0.03 * blur, feel, ang: -2.55 + (15 * Math.PI / 180) * tl.seg(t, 78, 83, E.inOutSine), warmK, wb: 250 * warmK };
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
      light: s.feel > 0 ? { I: 0.32 * s.feel, angle: s.ang, wash: 1.0, rim: 1.0 } : null,
      grade: { wb: s.wb, haze: s.haze },
      edgeFade: ctx.portrait ? { top: 80, bottom: 80 } : null,
    });
    if (soft) {
      // the room goes to 14 px, the faces only to about 5 px (they soften, never smear)
      const sig = s.dof * 0.5;
      this.blur.faces(R, target, sig, Math.min(2.5, 0.36 * sig), this.faceZones(ctx, cam), 60 * ctx.U);
      G.release(R);
    }
    if (s.blur > 0.002) {
      const bo = { I: s.blur, grow: s.blur, t: t - 73.5 };
      if (ctx.portrait) {
        const B = G.acquire(target.w, target.h, { format: 'hdr', scale: target.scale == null ? 1 : target.scale });
        G.clear(B, [0, 0, 0, 0]);
        PH.bokeh(B, cam, bo);
        const fr = fullRect(cam);
        G.draw(this.P.bokehMask, { uSrc: B, uY: [fr[1], fr[1] + fr[3], 30 * ctx.U, 120 * ctx.U] }, target, { blend: 'add' });
        G.release(B);
      } else PH.bokeh(target, cam, bo);
    }
    if (!ctx.portrait) G.draw(this.P.scrim, { uY: [800, 1080], uA: 1 }, target, { blend: 'premul', viewport: [0, 0, target.w, Math.ceil(280 * (target.scale || 1))] });
    // the thread (the two-loop knot glyph is retired; the thread and its travelling glint remain). Portrait: the seat is
    // mostly hidden behind the people, so the visible ends are wider and brighter.
    if (t >= 84.0) {
      const tip = this.threadTip(ctx, t);
      let sp = 0;
      for (const te of this.sparkle) if (t >= te && t - te < 0.6) sp += Math.exp(-(t - te) / 0.12);
      const pk = ctx.portrait ? 1.5 : 1;
      PH.thread(target, cam, { tip, steady: 0.7, I: pk * (1 + 0.35 * Math.min(sp, 1.5)), width: ctx.portrait ? 3.2 : 2,
        fresh: t < 88.4 ? 0.9 : 0.9 * (1 - tl.seg(t, 88.4, 89.2)) });
    }
    PH.glint(target, cam, { at: 'pendant', life: tl.seg(t, this.pearlT - 0.07, this.pearlT + 0.13), size: ctx.portrait ? 36 : 24, I: 6 });
    // legibility: under each caption row the photo is softened and a feathered band darkens it by about 50 %
    const caps = this.captions(ctx, tau);
    this.soften(target, caps);
    drawCaptionBands(ctx, target, caps, 0.5);
  },
  // the two face zones (frame px ellipses, a little tighter than the skin-protection ellipses)
  faceZones(ctx, cam) { return ctx.faceEllipses(cam).map(e => [e[0], e[1], e[2] * 0.85, e[3] * 0.85]); },
  captions(ctx, tau) {
    const t = T0 + tau, out = [];
    const y = captionY(ctx), st = photoStyle(ctx), sh = CAPTION_SHADOW;
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
    // halation only lightly lifted for line L11a (no cream halos round the heads); while the photo is blurred the split
    // tone is nearly off, so the softened eyes and glasses stay warm-neutral rather than going blue-grey
    const split = 0.5 - 0.3 * s.blur;
    return Object.assign(ctx.photoR.postParams(cam7(ctx, t)), { halation: 0.045 + 0.02 * s.warmK, grade: { splitAmt: split } });
  },
};
export default scene;
