/*
  core/text.js: Canvas2D line rasteriser into mipmapped textures, with per-glyph metadata, and the line shader
  (default entrance, default / mist / opacity / forget exits, caps tracking ease, partial lines, greeked placeholders).
  The text itself is never stored in code: scenes refer to lines by id (window.LINES[id]) at runtime.

  API
    STYLES                         named styles {family, style, weight, size (px at 1080p), tracking (em), color, opacity,
                                   enter, exit, glow, layer}; extend with {base:'narrative', ...overrides}
    fontString(style, U)           CSS font shorthand at frame scale U
    await loadFonts(texts, U)      document.fonts.load(...) for every style variant with all the given text; asserts check()
    const T = createText(G)
      T.resolve(entry) -> {text, style}           entry.lineId -> window.LINES (entry.text only for non-private labels)
      T.line(text, style) -> Line                  cached raster; Line = {tex, w, h, ox, oy (texture px of the text origin
                                                   at the baseline), adv (advance width without trailing tracking),
                                                   asc, desc, n, glyph: Float32Array(4*64) [x0, x1, wordIndex, isSpace]}
      T.layout(entry) -> {line, style, x0, y, rect}  where the line sits (frame px; x0 = text origin; rect = quad)
      T.drawCaption(target, entry)                 display-space draw (premultiplied over), with soft glow from mip 4
      T.drawMask(entry) -> {rt, rect}              renders the animated coverage into a pooled RGBA8 mipmapped target
                                                   (rect = frame px covered; rt is bottom-up: pass maskFlipY:true to gold)
                                                   call T.releaseMask(m) after use
      T.anim(entry) -> {opacity...}                the evaluated animation numbers (for tests and debugging)

  Caption entry (returned by scene.captions(ctx, tau, p)):
    { lineId: 'L3' | text: 'label (never private text)',
      tau,                       seconds since this line's own start (entrance clock; may be negative = not yet shown)
      x, y,                      anchor in frame px: y is the baseline; x per align ('center' default | 'left' | 'right')
      style: 'narrative' | {...},  enter: 'default'|'crisp'|'opacity'|'caps'|'none'|{mode,dur,stagger,rise,blur,trackEm,trackDur}
      exit: {at: tau, kind: 'default'|'mist'|'opacity'|'forget', dur?},
      opacity (multiplier), color ('#hex' override), glow, part: [i0, i1] (draw only glyphs i0..i1-1; positions unchanged),
      layer: 'caption' (default, display space after grade) | 'hdr' (gold leaf via core/gold.js in the overlay pass),
      gold: {...} options for gold.draw when layer is 'hdr', greek: true (draw word blocks instead of glyphs) }

  Animation (SPEC 4.1): default entrance per word, 0.6 s, 90 ms stagger, rise 8 px, blur 6 px, easeOutCubic.
  Default exit 0.8 s opacity -> 0, tracking +0.04em. Mist exit 1.2 s, blur 0 -> 6 px, rise -6 px, +0.04em.
  Caps: per glyph 0.5 s at 15 ms stagger, tracking eases from 0.50em to the style tracking over 1.6 s.
*/
import { frag, HEADER_VS } from './glsl.js';
import { hex, srgbToLin } from './gl.js';

export const STYLES = {
  narrative: { family: 'Cormorant Garamond', style: 'italic', weight: 400, size: 52, tracking: 0, color: '#F4EBDD', enter: 'default', exit: 'default', glow: 0.10 },
  narrativePhoto: { base: 'narrative', size: 50, color: '#F8F0E3' },
  roman: { family: 'Cormorant Garamond', style: 'normal', weight: 400, size: 50, tracking: 0.01, color: '#EDE3D2', enter: 'opacity', exit: 'opacity', glow: 0.06 },
  caps: { family: 'Cormorant Garamond', style: 'normal', weight: 500, size: 22, tracking: 0.34, color: '#D4A64A', opacity: 0.85, enter: 'caps', exit: 'default', glow: 0.12, uppercase: true },
  display: { family: 'Cormorant Garamond', style: 'normal', weight: 300, size: 104, tracking: 0.02, color: '#F4EBDD', enter: 'opacity', exit: 'opacity', glow: 0.08, layer: 'hdr' },
  displayItalic: { family: 'Cormorant Garamond', style: 'italic', weight: 300, size: 300, tracking: 0, color: '#F4EBDD', enter: 'opacity', exit: 'opacity', glow: 0.08, layer: 'hdr' },
  script: { family: 'Pinyon Script', style: 'normal', weight: 400, size: 72, tracking: 0, color: '#5A3A1E', enter: 'opacity', exit: 'opacity', glow: 0.0 },
  label: { family: 'Cormorant Garamond', style: 'normal', weight: 500, size: 18, tracking: 0.22, color: '#8C8272', opacity: 0.9, enter: 'none', exit: 'opacity', glow: 0.0, uppercase: true },
};
export function styleOf(s) {
  const base = typeof s === 'string' ? STYLES[s] : s && s.base ? styleOf(s.base) : STYLES.narrative;
  if (!base) throw new Error('unknown text style ' + s);
  const own = typeof s === 'string' ? {} : s || {};
  const b = base.base ? styleOf(base.base) : {};
  return Object.assign({}, b, base, own, { base: undefined });
}
export function fontString(st, U = 1) { return `${st.style} ${st.weight} ${(st.size * U).toFixed(2)}px "${st.family}"`; }

export async function loadFonts(texts, U = 1) {
  const sample = Array.from(new Set((texts.join('') + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ·’,.').split(''))).join('');
  const seen = new Set();
  for (const k in STYLES) {
    const fs = fontString(styleOf(k), U);
    if (seen.has(fs)) continue; seen.add(fs);
    await document.fonts.load(fs, sample);
    if (!document.fonts.check(fs, sample)) throw new Error('font not available: ' + fs);
  }
  return seen.size;
}

const ENTER = {
  default: { mode: 0, dur: 0.6, stagger: 0.09, rise: 8, blur: 6 },
  crisp: { mode: 0, dur: 0.6, stagger: 0.09, rise: 6, blur: 0 },
  opacity: { mode: 2, dur: 1.0, stagger: 0, rise: 0, blur: 0 },
  caps: { mode: 1, dur: 0.5, stagger: 0.015, rise: 0, blur: 0, trackEm: 0.50, trackDur: 1.6 },
  none: { mode: 2, dur: 1e-4, stagger: 0, rise: 0, blur: 0 },
};
const EXIT = {
  default: { dur: 0.8, rise: 0, blur: 0, trackEm: 0.04 },
  mist: { dur: 1.2, rise: -6, blur: 6, trackEm: 0.04 },
  opacity: { dur: 0.8, rise: 0, blur: 0, trackEm: 0 },
  forget: { dur: 1.4, rise: 0, blur: 4, trackEm: 0.06 },
};
const eOutCubic = x => 1 - Math.pow(1 - x, 3);
const eInOutSine = x => -(Math.cos(Math.PI * x) - 1) / 2;
const c01 = x => x < 0 ? 0 : x > 1 ? 1 : x;

const VS = HEADER_VS + `
uniform vec4 uRect;   // frame px x, y, w, h of the quad
uniform vec4 uView;   // frame px rect that maps onto the whole target
out vec2 vPx;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 px = uRect.xy + c * uRect.zw; vPx = px;
  vec2 q = (px - uView.xy) / uView.zw;
  gl_Position = vec4(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0);
}`;

const FS = frag(`
uniform sampler2D uTex; uniform vec2 uTexSize; uniform vec2 uOrigin; uniform vec2 uTexOrigin;
uniform vec4 uGlyph[64]; uniform int uN;
uniform float uTau, uDur, uStagger; uniform int uMode;
uniform float uRiseIn, uBlurIn, uExitP, uRiseOut, uBlurOut, uTrackPx, uCenterShift, uOpacity, uGlow, uXH;
uniform vec3 uColor; uniform vec2 uPart; uniform int uGreek, uMaskOut;
in vec2 vPx;
out vec4 o;
float eoc(float x){ x = clamp(x, 0.0, 1.0); return 1.0 - pow(1.0 - x, 3.0); }
void main(){
  vec2 l = vPx - uOrigin;
  int g = 0;
  for (int i = 0; i < 64; i++){ if (i >= uN) break; if (l.x >= uGlyph[i].x + float(i) * uTrackPx - uCenterShift) g = i; }
  vec4 G = uGlyph[g];
  float k = uMode == 0 ? G.z : (uMode == 1 ? float(g) : 0.0);
  float e = eoc((uTau - k * uStagger) / uDur);
  float op = e * (1.0 - uExitP) * uOpacity;
  if (float(g) < uPart.x || float(g) >= uPart.y) op = 0.0;
  if (op <= 0.0){ o = vec4(0.0); return; }
  float rise = (1.0 - e) * uRiseIn + uExitP * uRiseOut;
  float blur = (1.0 - e) * uBlurIn + uExitP * uBlurOut;
  vec2 t = vec2(l.x - (float(g) * uTrackPx - uCenterShift), l.y - rise);
  vec2 uv = (uTexOrigin + t) / uTexSize;
  float a;
  if (uGreek == 1){
    float inside = step(0.5, 1.0 - G.w) * step(G.x, t.x) * step(t.x, G.y);
    a = inside * (1.0 - smoothstep(-1.0, 1.0, abs(t.y + uXH * 0.5) - uXH * 0.5)) * 0.55;
  } else if (blur > 0.35){
    float lod = log2(blur) + 0.5;
    float r = blur * 0.6;
    float an = h11(float(g)) * 6.283;
    vec2 d1 = vec2(cos(an), sin(an)) * r / uTexSize, d2 = vec2(-d1.y, d1.x);
    a = (textureLod(uTex, uv, lod).a * 2.0 + textureLod(uTex, uv + d1, lod).a + textureLod(uTex, uv - d1, lod).a
       + textureLod(uTex, uv + d2, lod).a + textureLod(uTex, uv - d2, lod).a) / 6.0;
  } else a = texture(uTex, uv).a;
  float glow = uGlow > 0.0 ? textureLod(uTex, uv, 4.0).a * uGlow : 0.0;
  if (uMaskOut == 1){ o = vec4(a * op); return; }
  o = vec4(uColor * (a + glow) * op, a * op);
}`);

export function createText(G) {
  const { gl } = G;
  const U = G.U;
  const prog = G.program('text.line', FS, VS);
  const cache = new Map();
  const T = {};

  T.resolve = function (entry) {
    let text;
    if (entry.lineId) {
      const L = window.LINES || {};
      text = L[entry.lineId];
      if (typeof text !== 'string') throw new Error('unknown line id ' + entry.lineId);
    } else text = entry.text || '';
    const style = styleOf(entry.style || 'narrative');
    if (style.uppercase) text = text.toUpperCase();
    return { text, style };
  };

  T.line = function (text, st) {
    const fs = fontString(st, U);
    const key = fs + '|' + st.tracking + '|' + text;
    let L = cache.get(key);
    if (L) return L;
    const chars = Array.from(text);
    if (chars.length > 64) throw new Error('line longer than 64 glyphs');
    const cv = document.createElement('canvas');
    let x = cv.getContext('2d');
    const trackPx = st.tracking * st.size * U;
    const setup = c => { c.font = fs; c.letterSpacing = trackPx.toFixed(3) + 'px'; c.textBaseline = 'alphabetic'; c.textAlign = 'left'; };
    setup(x);
    const m = x.measureText(text);
    const pad = Math.ceil(40 * U);
    const left = Math.ceil(m.actualBoundingBoxLeft), right = Math.ceil(m.actualBoundingBoxRight);
    const asc = Math.ceil(m.actualBoundingBoxAscent), desc = Math.ceil(m.actualBoundingBoxDescent);
    cv.width = left + right + 2 * pad; cv.height = asc + desc + 2 * pad;
    x = cv.getContext('2d'); setup(x);
    x.clearRect(0, 0, cv.width, cv.height);
    x.fillStyle = '#fff';
    const ox = pad + left, oy = pad + asc;
    x.fillText(text, ox, oy);
    const glyph = new Float32Array(64 * 4);
    let word = 0, pref = 0;
    for (let i = 0; i < chars.length; i++) {
      const next = x.measureText(chars.slice(0, i + 1).join('')).width;
      const sp = /\s/.test(chars[i]);
      glyph.set([pref, next, word, sp ? 1 : 0], i * 4);
      if (sp) word++;
      pref = next;
    }
    const xh = x.measureText('x').actualBoundingBoxAscent;
    const tex = G.texture(cv, { mips: true });
    L = { tex, w: cv.width, h: cv.height, ox, oy, adv: m.width - trackPx, asc, desc, n: chars.length, glyph, trackPx, xh, size: st.size * U };
    cache.set(key, L);
    return L;
  };

  T.anim = function (entry, st, L) {
    let en = entry.enter || st.enter || 'default';
    if (typeof en === 'string') en = ENTER[en];
    else { const o = Object.assign({}, ENTER[en.base || 'default']); for (const k in en) if (en[k] != null) o[k] = en[k]; en = o; }
    if (!en) throw new Error('unknown enter ' + entry.enter);
    let ex = null;
    if (entry.exit) {
      const base = EXIT[entry.exit.kind || st.exit || 'default'];
      if (!base) throw new Error('unknown exit ' + entry.exit.kind);
      ex = Object.assign({}, base);
      for (const k in entry.exit) if (entry.exit[k] != null) ex[k] = entry.exit[k];
    }
    const tau = entry.tau;
    const exitP = ex ? eInOutSine(c01((tau - ex.at) / ex.dur)) : 0;
    let trackExtra = 0;
    if (en.trackEm != null) trackExtra += (en.trackEm - st.tracking) * L.size * (1 - eOutCubic(c01(tau / en.trackDur)));
    if (ex) trackExtra += ex.trackEm * L.size * exitP;
    const opacity = (entry.opacity == null ? 1 : entry.opacity) * (st.opacity == null ? 1 : st.opacity);
    const last = Math.max(0, (en.mode === 0 ? L.glyph[(L.n - 1) * 4 + 2] : en.mode === 1 ? L.n - 1 : 0));
    const shown = tau >= 0 && exitP < 1 && opacity > 0;
    const fullyIn = tau >= last * en.stagger + en.dur;
    return { en, ex, exitP, trackExtra, opacity, shown, fullyIn };
  };

  T.layout = function (entry) {
    const { text, style } = T.resolve(entry);
    const L = T.line(text, style);
    const A = T.anim(entry, style, L);
    const align = entry.align || 'center';
    const x0 = align === 'left' ? entry.x : align === 'right' ? entry.x - L.adv : entry.x - L.adv / 2;
    const cf = align === 'left' ? 0 : align === 'right' ? 1 : 0.5;
    const centerShift = (L.n - 1) * A.trackExtra * cf;
    const spread = Math.abs(A.trackExtra) * L.n + 20 * U;
    const rect = [x0 - L.ox - spread, entry.y - L.oy - 16 * U, L.w + 2 * spread, L.h + 32 * U];
    return { text, style, line: L, anim: A, x0, y: entry.y, centerShift, rect };
  };

  function uniforms(lay, entry, maskOut) {
    const { line: L, anim: A, style } = lay;
    const col = hex(entry.color || style.color);
    const part = entry.part || [0, 64];
    return {
      uRect: lay.rect, uTex: L.tex, uTexSize: [L.w, L.h], uOrigin: [lay.x0, lay.y], uTexOrigin: [L.ox, L.oy],
      uGlyph: L.glyph, uN: L.n, uTau: entry.tau, uDur: A.en.dur, uStagger: A.en.stagger, uMode: A.en.mode,
      uRiseIn: A.en.rise * U, uBlurIn: A.en.blur * U, uExitP: A.exitP, uRiseOut: (A.ex ? A.ex.rise : 0) * U, uBlurOut: (A.ex ? A.ex.blur : 0) * U,
      uTrackPx: A.trackExtra, uCenterShift: lay.centerShift, uOpacity: A.opacity, uGlow: maskOut ? 0 : (entry.glow == null ? style.glow : entry.glow),
      uColor: col, uPart: part, uGreek: entry.greek ? 1 : 0, uMaskOut: maskOut ? 1 : 0, uXH: L.xh,
    };
  }

  T.drawCaption = function (target, entry) {
    const lay = T.layout(entry);
    if (!lay.anim.shown) return lay;
    const u = uniforms(lay, entry, false);
    u.uView = [0, 0, G.W, G.H];
    G.draw(prog, u, target, { blend: 'premul', mode: gl.TRIANGLE_STRIP, count: 4 });
    return lay;
  };

  T.drawMask = function (entry) {
    const lay = T.layout(entry);
    const r = lay.rect.map(Math.round);
    const rt = G.acquire(r[2], r[3], { format: 'rgba8', mips: true });
    G.clear(rt, [0, 0, 0, 0]);
    if (lay.anim.shown) {
      const u = uniforms(lay, entry, true);
      u.uRect = r; u.uView = r;
      G.draw(prog, u, rt, { blend: null, mode: gl.TRIANGLE_STRIP, count: 4 });
    }
    G.mipmaps(rt);
    return { rt, rect: r, lay };
  };
  T.releaseMask = m => G.release(m.rt);
  T.linear = h => hex(h).map(srgbToLin);
  return T;
}
