/*
  core/text.js: line rasteriser and line shader (SPEC 4.1, 6.5). The text itself is never stored in code: scenes refer
  to lines by id (window.LINES[id]) at runtime.

  How a line is drawn
    Each line is shaped once by Canvas2D (kerning, ligatures, letterSpacing). It is then split into clusters: one per
    glyph, except where the font joins neighbouring glyphs (a ligature or a contextual form, found by a pixel test at
    init), which stay together. Each cluster is rasterised on its own, at its exact kerned pen position, into one layer
    of an R8 2D-array texture with mipmaps and generous padding. A caption is then one instanced draw: one quad per
    cluster, each with its own position, opacity, blur and colour (all evaluated in JS per frame). Glyphs that overlap
    (italic overhangs, script joins) are composited, so blur and tracking animations have no seams at glyph
    boundaries, and the fragment cost is a few texture taps (no per-fragment glyph search).
    A static line is snapped to whole pixels and samples texel centres, so it is identical to the Canvas2D raster.

  Output scale R (G.R, ?res=2)
    Layout never changes with R: metrics, the ligature test, the whole-line raster (ink extent, nib table, the lazy
    whole-line texture), c.alpha / c.box (points, outlines, the quads), snapping and the layer sizes all come from the
    1x raster in frame px. At R > 1 each cluster is rasterised a second time at R x (font size, tracking and position
    x R, same pen fraction) into an R x layer for the GPU, so captions, masks and gold are native at the output size.
    That raster is registered on the 1x one in x per cluster (a gradient-weighted shift measure, residual <= ~0.06
    frame px; unregistered, Skia's 1/4-device-px glyph positioning and size-dependent hinting put their edges up to
    ~0.2-0.3 frame px apart, which read as a 0.2 px layout shift of a caption stem at 120.2).
    The shader gets uTexel = 1 / physical layer size and uPxToTex = R (blur, shadow and glow offsets follow), and the
    fixed-mip taps move up one level per doubling. drawMask() masks have R texels per frame px (target scale R) over
    the same frame px rect.

  API (stage-A API kept; additions marked +)
    STYLES, styleOf(s), fontString(style, U), await loadFonts(texts, U)
    const T = createText(G)
      T.resolve(entry) -> {text, style}
      T.line(text, style) -> Line       cached. {w, h, ox, oy, adv, asc, desc, n, glyph (Float32Array 4*64: pen x0, x1,
                                        word, isSpace), trackPx, xh, size, clusters [{i0, i1, pen, word, layer, lox}],
                                        arr (R8 array texture), layerW, layerH, loy, canvas (whole-line raster),
                                        tex (lazy RGBA8 mipmapped texture of the whole line), inkL, inkR (line px)}
      T.layout(entry) -> lay            {text, style, line, anim, x0, y, rows, rect, inst (per-cluster draw data)}
      T.anim(entry, style, line)        {en, ex, exitP, trackExtra, opacity, shown, fullyIn}
      T.drawCaption(target, entry)      display-space draw (premultiplied over) with soft glow (and optional shadow)
      T.drawMask(entry) -> {rt, rect, lay, lineOpacity}
                                        animated coverage into a pooled RGBA8 mipmapped target (bottom-up rows:
                                        maskFlipY). a = shape coverage, r = coverage x the x-dependent factors (gild,
                                        reveal) for core/gold.js; lineOpacity = the line-level opacity left out of the mask
      T.releaseMask(m)
    + T.measure(entry) -> {adv, size, asc, desc, inkL, inkR, rows}   (frame px; inkL/inkR relative to the text origin)
    + T.words(entry | lineId) -> [{i0, i1, core: [j0, j1]}]          glyph ranges of the words (core = without punctuation)
    + T.wordRange(entry | lineId, k) -> [i0, i1]                     word k (negative counts from the end), punctuation
                                                                       trimmed: e.g. part: T.wordRange('L4', -1)
    + T.flow(entries, {x, gap = 0.25 (em of the first line), align = 'center'}) -> entries
                                        lays several entries out as one centred line (each gets align 'left' and its x):
                                        pre-positioned lines that are completed later never reflow
    + T.points(entry, {count, seed, step = 1, threshold = 0.5}) -> {pts, xn, count, x0, x1, y0, y1}
                                        particle homes on the glyphs (frame px, Float32Array [x, y, ...], seeded shuffle);
                                        xn = normalised x across the ink (0 at the left edge, 1 at the right)
    + T.glyphOutline(entry, glyphIndex, {offset = 6, count = 56}) -> Float32Array [x, y, ...]
                                        points evenly spaced around the OUTSIDE of one glyph, `offset` px off its outline,
                                        clockwise from the top (e.g. the rubrication dots around a capital)
    + T.nibProfile(entry) -> {dur, x0, x1, front(tau) -> frame x, samples: [[tau, amp 0..1], ...]}
                                        the nib front and its scratch envelope (speed while on the paper, 0 in the air)
    + T.linear(hex) -> linear rgb

  Caption entry (returned by scene.captions(ctx, tau, p)):
    { lineId: 'L3' | text: 'label (never private text)',
      tau,                       seconds since this line's own start (entrance clock; negative = not yet shown)
      x, y,                      anchor in frame px: y is the baseline (of the first row; valign 'last' = of the last
                                 row); x per align ('center' default | 'left' | 'right')
      style: 'narrative' | {...},  enter: 'default'|'crisp'|'opacity'|'caps'|'nib'|'none'|{base, dur, stagger, rise,
                                 blur, trackEm, trackDur, ...}
      exit: {at: tau, kind: 'default'|'mist'|'opacity'|'forget', dur?},
      opacity (multiplier), color ('#hex' override), gain (colour multiplier), glow (amount), glowColor ('#hex'),
      shadow: {dx = 0, dy = 0.5, alpha = 0.3, blur = 1}  (px, display-space drop shadow; e.g. over the photograph)
      part: [i0, i1]             draw only glyphs i0..i1-1 (positions unchanged)
      tints: [{part: [i0, i1], color: '#hex', at: tau, dur = 0.6}]   recolour some glyphs from tau `at`
      clampX: [min, max]         keep each row's advance box inside these frame x limits (e.g. the 96 px safe margin)
      breaks: [wordIndex, ...]   start a new row before these words (pre-authored breaks); or wrap: px (greedy)
      leading (1.25), valign: 'first' | 'last'
      snap (default true): round the origin to whole pixels
      layer: 'caption' (display space after the grade) | 'hdr' (gold leaf through core/gold.js in the overlay pass),
      gold: {...}                options for gold.draw when layer is 'hdr' (key, keyI, fill, fillI, bump, tint, look...)
      sweeps: [{at, dur = 1, from, to, width, I}]   specular strikes (hdr): a key-light band crossing the line from
                                 frame x `from` to `to` (default: the ink edges) in entry time
      glints: [{at, glyph | x, y, size, I, dur}]    star glints on the gold (hdr)
      reveal: {t0, span, dur, lo = 0, hi = 1, x0, x1}   per-pixel left-to-right formation: k = clamp((tau - t0 -
                                 span*xn)/dur), eased out-cubic, coverage x smoothstep(lo, hi, k), xn across [x0, x1]
                                 (default the ink extent); the title name uses the particle arrival law here
      gild: {at, dur = 1.2, feather = 70, sweep = 7}   gold leaf laid left to right over the written ink: the caption
                                 entry draws the ink side (1 - g), the hdr entry the gold side (g). T.nibEntries() makes
                                 the pair.
      greek: true (placeholder word blocks) }

  Animation (SPEC 4.1)
    default  per word: opacity 0 -> 1 over 0.6 s, rise 8 -> 0 px, blur 6 -> 0 px, 90 ms stagger, easeOutCubic
    crisp    per word: opacity plus a 6 px rise, no blur
    opacity  the whole line, 1.0 s (dur overrides: {base: 'opacity', dur: 0.9})
    caps     per glyph: 0.5 s at 15 ms stagger, tracking eases from 0.50em to the style tracking over 1.6 s (outCubic)
    nib      script handwriting: a slanted reveal front crosses the line in `dur` (default 2.0 s) with an 18 px feather;
             its speed follows the ink (loops 0.6x, connectors 1.6x, gaps faster), normalised to end at dur.
             Iron-gall ink blooms behind the front (the mask dilates up to 1.6 px where fbm exceeds a threshold that
             falls over 1.2 s) and shows a brief wet sheen.
    exits    default 0.8 s opacity -> 0, tracking +0.04em; mist 1.2 s, blur 0 -> 6 px, rise -6 px, +0.04em;
             opacity 0.8 s; forget 1.4 s, blur 0 -> 4 px, tracking +0.06em, opacity follows the blur
    + T.nibEntries(entry) -> [inkEntry (caption), goldEntry (hdr)]   for a nib line with a gild: return both from
             scene.captions(); the pair crossfades ink -> gold leaf left to right with a sweep landing at the end.
*/
import { frag, HEADER_VS, atRes } from './glsl.js';
import { hex, srgbToLin } from './gl.js';
import { mulberry32 } from './timeline.js';

export const STYLES = {
  narrative: { family: 'Cormorant Garamond', style: 'italic', weight: 400, size: 52, tracking: 0, color: '#F4EBDD', enter: 'default', exit: 'default', glow: 0.10 },
  narrativePhoto: { base: 'narrative', size: 50, color: '#F8F0E3' },
  roman: { family: 'Cormorant Garamond', style: 'normal', weight: 400, size: 50, tracking: 0.01, color: '#EDE3D2', enter: 'opacity', exit: 'opacity', glow: 0.06 },
  // small caps lines: the lining-figure cut (old-style figures would drop below the caps baseline), never smaller than
  // minSize (frame px at U = 1: landscape, portrait), and the space either side of a middle dot tightened to dotSpace
  caps: { family: 'Cormorant Garamond LF', style: 'normal', weight: 500, size: 30, tracking: 0.28, color: '#E3C27A', opacity: 0.95, enter: 'caps', exit: 'default', glow: 0.16, uppercase: true, minSize: [30, 34], dotSpace: 0.6 },
  display: { family: 'Cormorant Garamond', style: 'normal', weight: 300, size: 104, tracking: 0.02, color: '#F4EBDD', enter: 'opacity', exit: 'opacity', glow: 0.08, layer: 'hdr' },
  displayItalic: { family: 'Cormorant Garamond', style: 'italic', weight: 300, size: 300, tracking: 0, color: '#F4EBDD', enter: 'opacity', exit: 'opacity', glow: 0.08, layer: 'hdr' },
  // iron-gall ink lifted to about 3.2:1 on the ink ground, with a faint warm under-glow along the strokes (inkGlow)
  script: { family: 'Pinyon Script', style: 'normal', weight: 400, size: 72, tracking: 0, color: '#8C5C30', enter: 'nib', exit: 'opacity', glow: 0.0, inkGlow: 0.10, inkGlowColor: '#E39A4C' },
  label: { family: 'Cormorant Garamond LF', style: 'normal', weight: 500, size: 18, tracking: 0.22, color: '#8C8272', opacity: 0.9, enter: 'none', exit: 'opacity', glow: 0.0, uppercase: true, dotSpace: 0.6 },
};
export function styleOf(s) {
  const base = typeof s === 'string' ? STYLES[s] : s && s.base ? styleOf(s.base) : STYLES.narrative;
  if (!base) throw new Error('unknown text style ' + s);
  const own = typeof s === 'string' ? {} : s || {};
  const b = base.base ? styleOf(base.base) : {};
  return Object.assign({}, b, base, own, { base: undefined });
}
export function fontString(st, U = 1) { return `${st.style} ${st.weight} ${(st.size * U).toFixed(2)}px "${st.family}"`; }

// Lining-figure cuts of Cormorant Garamond (the stock cut with its digits remapped to the lnum glyphs: Canvas2D cannot
// switch OpenType features). Registered once under their own family name.
const LF_FACES = [
  { file: '../fonts/cormorant-lf-roman.woff2', style: 'normal' },
  { file: '../fonts/cormorant-lf-italic.woff2', style: 'italic' },
];
let lfDone = null;
function registerLiningFaces() {
  if (lfDone) return lfDone;
  lfDone = Promise.all(LF_FACES.map(async f => {
    const face = new FontFace('Cormorant Garamond LF', `url(${new URL(f.file, import.meta.url).href}) format('woff2')`, { style: f.style, weight: '300 700' });
    await face.load();
    document.fonts.add(face);
  }));
  return lfDone;
}

export async function loadFonts(texts, U = 1) {
  await registerLiningFaces();
  const sample = Array.from(new Set((texts.join('') + 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 ·’,.').split(''))).join('');
  const seen = new Set();
  const variants = Object.keys(STYLES).map(k => styleOf(k));
  variants.push(styleOf({ base: 'caps', weight: 400 }), styleOf({ base: 'caps', weight: 600 }));
  // every face the build sheets use, at a nominal size (font loading is per face, not per size)
  variants.push(styleOf({ base: 'narrative', weight: 300 }), styleOf({ base: 'roman', weight: 300 }), styleOf({ base: 'roman', weight: 500 }));
  for (const st of variants) {
    const fs = fontString(st, U);
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
  nib: { mode: 3, dur: 2.0, stagger: 0, rise: 0, blur: 0, feather: 18, slant: 0.36, bloom: 1.6, bloomDur: 1.2 },
  none: { mode: 2, dur: 1e-4, stagger: 0, rise: 0, blur: 0 },
};
const EXIT = {
  default: { dur: 0.8, rise: 0, blur: 0, trackEm: 0.04 },
  mist: { dur: 1.2, rise: -6, blur: 6, trackEm: 0.04 },
  opacity: { dur: 0.8, rise: 0, blur: 0, trackEm: 0 },
  forget: { dur: 1.4, rise: 0, blur: 4, trackEm: 0.06, fadeLag: 0.3 },
};
const eOutCubic = x => 1 - Math.pow(1 - x, 3);
const eInOutSine = x => -(Math.cos(Math.PI * x) - 1) / 2;
const c01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
const sstep = (a, b, x) => { const t = c01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const MAXC = 64;
const NIBN = 96;          // nib time-table bins

// ---------------------------------------------------------------- shaders
const VS = HEADER_VS + `
uniform vec4 uI0[${MAXC}];   // x, y (frame px of the layer's top-left), opacity, blur px
uniform vec4 uI1[${MAXC}];   // r, g, b (display colour, or mask: unused), layer
uniform vec4 uI2[${MAXC}];   // quad within the layer: u0, v0, u1, v1 (tight around the cluster's ink plus padding)
uniform vec2 uLayerPx;       // layer size in frame px
uniform vec4 uView;          // frame px rect that maps onto the whole target
out vec2 vPx; out vec2 vT;
flat out vec4 vA; flat out vec4 vB;
void main(){
  int i = gl_InstanceID;
  vec4 a = uI0[i];
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec4 q4 = uI2[i];
  vec2 t = mix(q4.xy, q4.zw, c);
  vec2 px = a.xy + t * uLayerPx;
  vPx = px; vT = t; vA = a; vB = uI1[i];
  vec2 q = (px - uView.xy) / uView.zw;
  gl_Position = a.z <= 0.0 ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(q.x * 2.0 - 1.0, 1.0 - q.y * 2.0, 0.0, 1.0);
}`;

export const TEXT_FX_GLSL = `
// x-dependent line factors shared by the caption shader and the gold pass (core/gold.js)
uniform int uGildOn; uniform vec4 uGild;      // front x, feather, side (+1 gold, -1 ink), slant
uniform float uGildY;
uniform int uRevOn; uniform vec4 uRev0;       // x0, x1, t0, span
uniform vec4 uRev1;                           // dur, lo, hi, tau
float gildF(vec2 px){
  if (uGildOn == 0) return 1.0;
  float xs = px.x + (uGildY - px.y) * uGild.w;
  float g = 1.0 - smoothstep(uGild.x - uGild.y, uGild.x, xs);
  return uGild.z > 0.0 ? g : 1.0 - g;
}
float revealF(vec2 px){
  if (uRevOn == 0) return 1.0;
  float xn = clamp((px.x - uRev0.x) / max(uRev0.y - uRev0.x, 1.0), 0.0, 1.0);
  float k = clamp((uRev1.w - (uRev0.z + uRev0.w * xn)) / max(uRev1.x, 1e-4), 0.0, 1.0);
  k = 1.0 - pow(1.0 - k, 3.0);
  return smoothstep(uRev1.y, uRev1.z, k);
}
float lineFX(vec2 px){ return gildF(px) * revealF(px); }
`;

const FS = frag(`
precision highp sampler2DArray;
uniform sampler2DArray uArr; uniform vec2 uTexel;     // 1 / layer size in texels
uniform float uPxToTex;                                 // texels per frame px
uniform float uGlow; uniform vec3 uGlowCol; uniform vec4 uShadow;   // dx, dy, alpha, blur (px)
uniform int uMaskOut, uGreek; uniform float uXH, uBase;
uniform int uNibOn; uniform vec4 uNib;                // front x, feather, slant, baseline y
uniform vec4 uNibX;                                   // table x0, x1, bloom px, tau
uniform vec4 uNibT[${NIBN / 4 + 1}];                  // passage time of the front at ${NIBN + 1} x samples
uniform float uNibBloomDur;
uniform vec4 uInkGlow;                                // nib ink under-glow: rgb (display), amount
uniform float uLumaGamma;
${TEXT_FX_GLSL}
in vec2 vPx; in vec2 vT;
flat in vec4 vA; flat in vec4 vB;
out vec4 o;
float nibT(float x){
  float f = clamp((x - uNibX.x) / max(uNibX.y - uNibX.x, 1.0), 0.0, 1.0) * ${NIBN}.0;
  int i = int(min(floor(f), ${NIBN - 1}.0));
  float a = uNibT[i / 4][i % 4], b = uNibT[(i + 1) / 4][(i + 1) % 4];
  return mix(a, b, f - float(i));
}
float tap(vec2 uv, float lod){ return textureLod(uArr, vec3(uv, vB.w), lod).r; }
void main(){
  vec2 uv = vT;
  float blur = vA.w * uPxToTex;
  float a;
  if (uGreek == 1){
    float ink = smoothstep(0.02, 0.08, tap(uv, ${atRes('3.0', '4.0')}));
    float yb = (vPx.y - uBase);
    a = ink * (1.0 - smoothstep(-1.0, 1.0, abs(yb + uXH * 0.5) - uXH * 0.5)) * 0.55;
  } else if (blur > 0.35){
    float lod = log2(blur) + 0.3;
    float r = blur * 0.7;
    float an = h11(vB.w * 7.13 + 1.0) * 6.283;
    vec2 d1 = vec2(cos(an), sin(an)) * r * uTexel, d2 = vec2(-d1.y, d1.x);
    a = (tap(uv, lod) * 2.0 + tap(uv + d1, lod) + tap(uv - d1, lod) + tap(uv + d2, lod) + tap(uv - d2, lod)) / 6.0;
  } else a = texture(uArr, vec3(uv, vB.w)).r;
  float fx = 1.0, wet = 0.0, age = 1e3;
  if (uNibOn == 1){
    float xs = vPx.x + (uNib.w - vPx.y) * uNib.z;
    fx = 1.0 - smoothstep(uNib.x - uNib.y, uNib.x, xs);
    if (fx <= 0.0){ o = vec4(0.0); return; }
    age = uNibX.w - nibT(xs);
    // iron-gall bloom: behind the front the ink creeps into the fibres. The dilation (0 -> bloom px) is applied where a
    // smooth fbm exceeds a threshold that falls over the bloom duration; it thresholds a blurred copy of the glyph at
    // a lower level, so the grown edge stays smooth and anti-aliased.
    float thr = mix(0.98, 0.42, clamp(age / uNibBloomDur, 0.0, 1.0));
    float n = fbm(vPx * 0.12 + 3.7, 3);
    float d = uNibX.z * smoothstep(thr, thr + 0.12, n);
    if (d > 0.02){
      float b = tap(uv, ${atRes('0.8', '1.8')});
      float lv = 0.5 - 0.15 * d;
      float fw = fwidth(b) * 0.8 + 0.01;
      a = max(a, smoothstep(lv - fw, lv + fw, b) * 0.95);
    }
    wet = exp(-max(age, 0.0) / 0.35) * fx;
  }
  if (uMaskOut == 1){
    float r = a * lineFX(vPx);
    o = vec4(r, 0.0, 0.0, a) * fx * vA.z;
    return;
  }
  fx *= lineFX(vPx);
  float op = vA.z * fx;
  if (op <= 0.0){ o = vec4(0.0); return; }
  if (uLumaGamma != 1.0) a = pow(a, uLumaGamma);
  vec3 col = vB.rgb;
  if (uNibOn == 1){
    // ink: slight density variation, darker pooling at the stroke edges, a wet sheen just behind the nib
    float dens = 0.86 + 0.24 * fbm(vPx * 0.045 + 11.0, 3);
    float edge = 1.0 - smoothstep(0.25, 0.9, a);
    col = col * dens * (1.0 - 0.18 * edge);
    col = mix(col, col * 1.6 + vec3(0.035, 0.025, 0.012), wet * 0.84);
  }
  float ig = 0.0;
  if (uNibOn == 1 && uInkGlow.w > 0.0){
    // a ~1.2 px warm halo hugging the strokes (mip 1 of the glyph, outside the ink only)
    ig = clamp(tap(uv, ${atRes('1.0', '2.0')}) * 1.35 - a, 0.0, 1.0) * uInkGlow.w;
  }
  float g = 0.0;
  if (uGlow > 0.0){
    // soft glow from the high mips of the glyph's own layer (three taps: no blockiness from a lone mip-4 fetch)
    vec2 r = 4.0 * uPxToTex * uTexel;
    g = (textureLod(uArr, vec3(uv, vB.w), ${atRes('4.0', '5.0')}).r * 1.2 + tap(uv + vec2(r.x, r.y), ${atRes('3.0', '4.0')}) + tap(uv - vec2(r.x, r.y), ${atRes('3.0', '4.0')})) / 3.2 * uGlow;
  }
  float sh = 0.0;
  if (uShadow.z > 0.0){
    vec2 suv = uv - uShadow.xy * uPxToTex * uTexel;
    sh = textureLod(uArr, vec3(suv, vB.w), log2(max(uShadow.w * uPxToTex, 1.0))).r * uShadow.z;
  }
  vec3 rgb = col * a + uGlowCol * g + uInkGlow.rgb * ig;
  float al = a + max(sh, ig) * (1.0 - a);
  o = vec4(rgb, al) * op;
}`);

// ---------------------------------------------------------------- helpers
function isSpace(ch) { return /\s/.test(ch); }
function isLetterish(ch) { return /[\p{L}\p{N}]/u.test(ch); }

export function createText(G) {
  const { gl } = G;
  const U = G.U;
  // output scale (G.R): the glyph layers are rasterised at PR texels per frame px; all layout stays on the 1x raster.
  // Not named R: T.line and T.layout declare their own R.
  const PR = G.R || 1;
  const prog = G.program('text.line2', FS, VS);
  const cache = new Map();
  const T = {};

  T.resolve = function (entry) {
    let text;
    if (entry.lineId) {
      const L = window.LINES || {};
      text = L[entry.lineId];
      if (typeof text !== 'string') throw new Error('unknown line id ' + entry.lineId);
    } else text = entry.text || '';
    let style = styleOf(entry.style || 'narrative');
    if (style.uppercase) text = text.toUpperCase();
    if (style.minSize) {
      const ms = style.minSize[G.H > G.W ? 1 : 0];
      if (style.size < ms) style = Object.assign({}, style, { size: ms });
    }
    return { text, style };
  };

  // ---------------------------------------------------------------- rasterising
  function ctx2d(w, h, fs, trackPx) {
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, w); cv.height = Math.max(1, h);
    const x = cv.getContext('2d', { willReadFrequently: true });
    x.font = fs; x.letterSpacing = trackPx.toFixed(3) + 'px'; x.textBaseline = 'alphabetic'; x.textAlign = 'left';
    x.fillStyle = '#fff';
    return { cv, x };
  }
  // x shift (frame px) of a px x raster bufH against the 1x raster buf (w x h): one Lucas-Kanade step on both, box-
  // averaged to the 1x grid and smoothed [1 2 1] in x and y. Edges weigh, ink mass does not: a hairline that the two
  // sizes anti-alias to different weights moves both of its edges apart, which cancels (an ink centroid would follow
  // the heavier side). NaN without ink.
  function rasterShiftX(buf, w, h, bufH, px) {
    const n = w * h, A = new Float32Array(n), B = new Float32Array(n), T = new Float32Array(n), wh = w * px;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let b = 0;
      for (let j = 0; j < px; j++) for (let i = 0; i < px; i++) b += bufH[(y * px + j) * wh + x * px + i];
      A[y * w + x] = buf[y * w + x]; B[y * w + x] = b / (px * px);
    }
    const smooth = M => {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = y * w + x; T[k] = (2 * M[k] + (x > 0 ? M[k - 1] : 0) + (x < w - 1 ? M[k + 1] : 0)) / 4; }
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const k = y * w + x; M[k] = (2 * T[k] + (y > 0 ? T[k - w] : 0) + (y < h - 1 ? T[k + w] : 0)) / 4; }
    };
    smooth(A); smooth(B);
    let num = 0, den = 0;
    for (let y = 0; y < h; y++) for (let x = 1; x < w - 1; x++) {
      const k = y * w + x, g = (A[k + 1] - A[k - 1]) / 2;
      num += g * (B[k] - A[k]); den += g * g;
    }
    return den > 0 ? -num / den : NaN;
  }
  let probe = null;
  function measurer(fs, trackPx) {
    if (!probe) probe = ctx2d(4, 4, fs, trackPx);
    const x = probe.x;
    x.font = fs; x.letterSpacing = trackPx.toFixed(3) + 'px';
    return s => x.measureText(s);
  }
  // true when drawing a and b separately (b at its kerned pen position) differs from the shaped pair: a ligature or a
  // contextual form joins them, so they must stay one cluster
  function joined(a, b, fs, trackPx, M, pad) {
    const mab = M(a + b), mb = M(b);
    const asc = Math.ceil(mab.actualBoundingBoxAscent), desc = Math.ceil(mab.actualBoundingBoxDescent);
    const left = Math.ceil(Math.max(mab.actualBoundingBoxLeft, 0)), w = Math.ceil(mab.actualBoundingBoxRight) + left + 2 * pad;
    const h = asc + desc + 2 * pad;
    const P = ctx2d(w, h, fs, trackPx);
    P.x.fillText(a + b, pad + left, pad + asc);
    const A = P.x.getImageData(0, 0, w, h).data;
    P.x.clearRect(0, 0, w, h);
    P.x.fillText(a, pad + left, pad + asc);
    P.x.fillText(b, pad + left + (mab.width - mb.width), pad + asc);
    const B = P.x.getImageData(0, 0, w, h).data;
    let n = 0;
    for (let i = 3; i < A.length; i += 4) if (Math.abs(A[i] - B[i]) > 110) n++;
    return n > 3;
  }

  T.line = function (text, st) {
    const fs = fontString(st, U);
    const key = fs + '|' + st.tracking + '|' + text;
    let L = cache.get(key);
    if (L) return L;
    const chars = Array.from(text);
    if (chars.length > MAXC) throw new Error('line longer than 64 glyphs');
    const trackPx = st.tracking * st.size * U;
    const M = measurer(fs, trackPx);
    const m = M(text);
    const isScript = /script/i.test(st.family);
    const pad = Math.ceil((isScript ? 40 : 28) * U);
    // whole-line raster (points, nib analysis, the lazy whole-line texture)
    const left = Math.ceil(m.actualBoundingBoxLeft), right = Math.ceil(m.actualBoundingBoxRight);
    const asc = Math.ceil(m.actualBoundingBoxAscent), desc = Math.ceil(m.actualBoundingBoxDescent);
    const W = left + right + 2 * pad, H = asc + desc + 2 * pad;
    const whole = ctx2d(W, H, fs, trackPx);
    const ox = pad + left, oy = pad + asc;
    whole.x.fillText(text, ox, oy);
    // glyph pen positions (kerned): pen_i = width(text[0..i]) - width(text[i])
    const glyph = new Float32Array(MAXC * 4);
    const pen = new Float32Array(chars.length + 1);
    let word = 0;
    const wordOf = new Int32Array(chars.length);
    for (let i = 0; i < chars.length; i++) {
      const pre = M(chars.slice(0, i + 1).join('')).width;
      const own = M(chars[i]).width;
      pen[i] = pre - own;
      const sp = isSpace(chars[i]);
      glyph.set([pen[i], pre - trackPx, word, sp ? 1 : 0], i * 4);
      wordOf[i] = word;
      if (sp) word++;
    }
    // tightened spaces either side of a middle dot (caps lines): every glyph after such a space moves left
    const shift = new Float32Array(chars.length + 1);
    if (st.dotSpace != null && st.dotSpace < 1) {
      const sw = M(' ').width * (1 - st.dotSpace);
      let acc = 0;
      for (let i = 0; i < chars.length; i++) {
        shift[i] = acc;
        if (isSpace(chars[i]) && (chars[i - 1] === '\u00B7' || chars[i + 1] === '\u00B7')) acc += sw;
      }
      shift[chars.length] = acc;
      for (let i = 0; i < chars.length; i++) { pen[i] -= shift[i]; glyph[i * 4] -= shift[i]; glyph[i * 4 + 1] -= isSpace(chars[i]) ? shift[i + 1] : shift[i]; }
    }
    pen[chars.length] = m.width - shift[chars.length];
    // clusters: glyphs, merged where the font joins them
    const clusters = [];
    for (let i = 0; i < chars.length; i++) {
      if (isSpace(chars[i])) continue;
      const prev = clusters[clusters.length - 1];
      if (prev && prev.i1 === i && isLetterish(chars[i]) && isLetterish(chars[i - 1]) &&
          joined(chars[i - 1], chars[i], fs, trackPx, M, 4)) { prev.i1 = i + 1; continue; }
      clusters.push({ i0: i, i1: i + 1, word: wordOf[i] });
    }
    if (clusters.length > MAXC) throw new Error('too many clusters');
    let maxW = 1, maxAsc = 1, maxDesc = 1;
    for (const c of clusters) {
      const s = chars.slice(c.i0, c.i1).join('');
      c.str = s;
      c.pen = M(chars.slice(0, c.i1).join('')).width - M(s).width - shift[c.i0];
      const cm = M(s);
      c.left = Math.ceil(Math.max(cm.actualBoundingBoxLeft, 0)) + 1;
      c.right = Math.ceil(Math.max(cm.actualBoundingBoxRight, 0)) + 1;
      maxW = Math.max(maxW, c.left + c.right);
      maxAsc = Math.max(maxAsc, Math.ceil(cm.actualBoundingBoxAscent));
      maxDesc = Math.max(maxDesc, Math.ceil(cm.actualBoundingBoxDescent));
    }
    const r16 = v => Math.ceil(v / 16) * 16;
    const layerW = r16(maxW + 2 * pad + 1), layerH = r16(maxAsc + maxDesc + 2 * pad);
    const loy = pad + maxAsc;
    // texels of the GPU layers: PR per frame px (the logical size is rounded to 16 first, so the uv and mip grids stay
    // aligned with frame px at every output scale)
    const texW = layerW * PR, texH = layerH * PR;
    // rasterise each cluster into its own layer
    const nl = Math.max(1, clusters.length);
    const levels = Math.floor(Math.log2(Math.max(texW, texH))) + 1;
    const arrTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, arrTex);
    gl.texStorage3D(gl.TEXTURE_2D_ARRAY, levels, gl.R8, texW, texH, nl);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const R = ctx2d(layerW, layerH, fs, trackPx);
    const buf = new Uint8Array(layerW * layerH);
    // PR > 1: a second raster of each cluster at PR x (font size, tracking and position scaled; same pen fraction) for
    // the GPU layer only. The 1x raster above still gives c.alpha and c.box (points, outlines, the layout quads).
    const RH = PR > 1 ? ctx2d(texW, texH, fontString(st, U * PR), trackPx * PR) : null;
    const bufH = RH ? new Uint8Array(texW * texH) : null;
    clusters.forEach((c, li) => {
      c.layer = li;
      c.lox = pad + c.left;
      const f = c.pen - Math.floor(c.pen);
      R.x.clearRect(0, 0, layerW, layerH);
      R.x.fillText(c.str, c.lox + f, loy);
      const d = R.x.getImageData(0, 0, layerW, layerH).data;
      for (let k = 0; k < buf.length; k++) buf[k] = d[k * 4 + 3];
      c.alpha = buf.slice();
      // ink box inside the layer (texels)
      let bx0 = layerW, by0 = layerH, bx1 = 0, by1 = 0;
      for (let y = 0; y < layerH; y++) for (let x = 0; x < layerW; x++) if (buf[y * layerW + x] > 0) { if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
      c.box = bx0 <= bx1 ? [bx0, by0, bx1 + 1, by1 + 1] : [0, 0, 1, 1];
      if (RH) {
        // register the PR x raster on the 1x raster. Skia quantises a glyph's x to 1/4 device px (1/4 frame px at 1x,
        // 1/4 physical px at PR x) and hints and anti-aliases the two sizes a little differently, so at the same pen
        // position the two rasters' edges sit up to ~0.3 frame px apart in x. The HD frame shows the 1x raster (and all
        // layout comes from it), so the PR x raster is moved by its measured x shift (rasterShiftX) and drawn again,
        // keeping the closest of up to six tries (residual <= ~0.06 frame px). y is left alone: both rasters put the
        // baseline on a whole device px, and a 1-physical-px step would be half a frame px.
        let x2 = (c.lox + f) * PR, best = null, step = 1;
        for (let it = 0; it < 6; it++) {
          RH.x.clearRect(0, 0, texW, texH);
          RH.x.fillText(c.str, x2, loy * PR);
          const dh = RH.x.getImageData(0, 0, texW, texH).data;
          for (let k = 0; k < bufH.length; k++) bufH[k] = dh[k * 4 + 3];
          const dx = rasterShiftX(buf, layerW, layerH, bufH, PR);   // NaN for a cluster without ink
          // past the best try (Skia moves the glyph in whole 1/4-device-px steps): smaller steps from here
          if (best && Math.sign(dx) !== Math.sign(best.dx)) step *= 0.5;
          if (!best || Math.abs(dx) < Math.abs(best.dx)) best = { dx, buf: bufH.slice() };
          if (!(Math.abs(dx) > 1 / 32)) break;
          x2 -= dx * step * PR;
        }
        gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, li, texW, texH, 1, gl.RED, gl.UNSIGNED_BYTE, best.buf);
      } else gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, li, layerW, layerH, 1, gl.RED, gl.UNSIGNED_BYTE, buf);
    });
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.generateMipmap(gl.TEXTURE_2D_ARRAY);
    if (shift[chars.length] > 0) {
      whole.x.clearRect(0, 0, W, H);
      for (const c of clusters) whole.x.fillText(c.str, ox + c.pen, oy);
    }
    // ink extent (line px relative to the text origin)
    const wd = whole.x.getImageData(0, 0, W, H).data;
    let inkL = W, inkR = 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (wd[(y * W + x) * 4 + 3] > 8) { if (x < inkL) inkL = x; if (x > inkR) inkR = x; }
    const xh = M('x').actualBoundingBoxAscent;
    L = {
      w: W, h: H, ox, oy, adv: m.width - shift[chars.length] - trackPx, asc, desc, n: chars.length, glyph, trackPx, xh, size: st.size * U,
      chars, pen, clusters, arr: { tex: arrTex }, layerW, layerH, texW, texH, loy, pad, canvas: whole.cv, imgData: wd,
      inkL: inkL - ox, inkR: inkR + 1 - ox, words: word + 1, isScript, _tex: null,
    };
    Object.defineProperty(L, 'tex', { get() { if (!L._tex) L._tex = G.texture(whole.cv, { mips: true }); return L._tex; } });
    cache.set(key, L);
    return L;
  };

  // ---------------------------------------------------------------- animation
  function enterOf(entry, st) {
    let en = entry.enter || st.enter || 'default';
    if (typeof en === 'string') { const b = ENTER[en]; if (!b) throw new Error('unknown enter ' + en); return b; }
    const o = Object.assign({}, ENTER[en.base || en.mode || 'default']);
    for (const k in en) if (en[k] != null && k !== 'base') o[k] = en[k];
    return o;
  }
  T.anim = function (entry, st, L) {
    const en = enterOf(entry, st);
    let ex = null;
    if (entry.exit) {
      const base = EXIT[entry.exit.kind || st.exit || 'default'];
      if (!base) throw new Error('unknown exit ' + entry.exit.kind);
      ex = Object.assign({}, base);
      for (const k in entry.exit) if (entry.exit[k] != null) ex[k] = entry.exit[k];
    }
    const tau = entry.tau;
    const exitP = ex ? eInOutSine(c01((tau - ex.at) / ex.dur)) : 0;
    const exitFade = ex && ex.fadeLag ? sstep(ex.fadeLag, 1, c01((tau - ex.at) / ex.dur)) : exitP;
    let trackExtra = 0;
    if (en.trackEm != null) trackExtra += (en.trackEm - st.tracking) * L.size * (1 - eOutCubic(c01(tau / en.trackDur)));
    if (ex) trackExtra += ex.trackEm * L.size * exitP;
    const opacity = (entry.opacity == null ? 1 : entry.opacity) * (st.opacity == null ? 1 : st.opacity);
    const last = Math.max(0, (en.mode === 0 ? L.glyph[(L.n - 1) * 4 + 2] : en.mode === 1 ? L.n - 1 : 0));
    const shown = tau >= 0 && exitFade < 1 && opacity > 0;
    const fullyIn = tau >= last * en.stagger + en.dur;
    return { en, ex, exitP, exitFade, trackExtra, opacity, shown, fullyIn };
  };

  // rows: arrays of glyph index ranges
  function rowsOf(entry, L) {
    const n = L.n, G4 = L.glyph;
    let starts = [];
    if (entry.breaks && entry.breaks.length) {
      for (const w of entry.breaks) { for (let i = 0; i < n; i++) if (G4[i * 4 + 2] === w && (i === 0 || G4[(i - 1) * 4 + 3] === 1)) { starts.push(i); break; } }
    } else if (entry.wrap) {
      const lim = entry.wrap * U;
      let rowStart = 0;
      for (let i = 1; i < n; i++) {
        if (!(G4[(i - 1) * 4 + 3] === 1 && G4[i * 4 + 3] !== 1)) continue;     // i starts a word
        let j = i; while (j < n && G4[j * 4 + 3] !== 1) j++;                 // end of that word
        if (G4[(j - 1) * 4 + 1] - G4[rowStart * 4] > lim) { starts.push(i); rowStart = i; }
      }
    }
    starts = [0, ...starts.filter(s => s > 0)];
    const rows = [];
    for (let r = 0; r < starts.length; r++) {
      const a = starts[r], b0 = r + 1 < starts.length ? starts[r + 1] : n;
      let b = b0; while (b > a && G4[(b - 1) * 4 + 3] === 1) b--;
      rows.push({ i0: a, i1: b, x0: G4[a * 4], adv: G4[(b - 1) * 4 + 1] - G4[a * 4] });
    }
    return rows;
  }

  function rowIndexOf(rows, i) { for (let r = rows.length - 1; r >= 0; r--) if (i >= rows[r].i0) return r; return 0; }

  T.layout = function (entry) {
    const { text, style } = T.resolve(entry);
    const L = T.line(text, style);
    const A = T.anim(entry, style, L);
    const align = entry.align || 'center';
    const cf = align === 'left' ? 0 : align === 'right' ? 1 : 0.5;
    const rows = rowsOf(entry, L);
    const lead = (entry.leading || 1.25) * L.size;
    const yFirst = entry.valign === 'last' ? entry.y - lead * (rows.length - 1) : entry.y;
    const snap = entry.snap !== false;
    for (let r = 0; r < rows.length; r++) {
      const R = rows[r];
      let x0 = entry.x - R.adv * cf - R.x0;
      if (entry.clampX) {
        const l = x0 + R.x0, rr = l + R.adv;
        if (l < entry.clampX[0]) x0 += entry.clampX[0] - l; else if (rr > entry.clampX[1]) x0 -= rr - entry.clampX[1];
      }
      let y = yFirst + r * lead;
      if (snap) { x0 = Math.round(x0); y = Math.round(y); }
      R.ox = x0; R.y = y;
      R.centerShift = ((R.i1 - 1 - R.i0) * A.trackExtra) * cf + R.i0 * A.trackExtra;
    }
    const x0 = rows[0].ox, y = rows[0].y;
    // per-cluster draw data
    const en = A.en, tau = entry.tau;
    const part = entry.part || [0, MAXC];
    const baseCol = hex(entry.color || style.color).map(v => v * (entry.gain || 1));
    const tints = (entry.tints || []).map(t => ({ a: t.part[0], b: t.part[1], c: hex(t.color), k: eInOutSine(c01((tau - (t.at || 0)) / (t.dur || 0.6))) }));
    const inst = [];
    let minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9;
    const lpx = L.layerW, lpy = L.layerH;
    const glowOn = (entry.glow == null ? style.glow : entry.glow) > 0;
    const sh = entry.shadow ? Math.abs(entry.shadow.dx || 0) + Math.abs(entry.shadow.dy == null ? 0.5 : entry.shadow.dy) + 2 * (entry.shadow.blur == null ? 1 : entry.shadow.blur) : 0;
    const isHdr = (entry.layer || style.layer) === 'hdr';
    const padBase = Math.min(L.pad, 2 + (glowOn ? 13 * U : 0) + sh + (en.mode === 3 ? 3 : 0) + (isHdr ? 0.06 * L.size + 4 : 0));
    for (const c of L.clusters) {
      const r = rowIndexOf(rows, c.i0), R = rows[r];
      let e;
      if (en.mode === 0) e = eOutCubic(c01((tau - c.word * en.stagger) / en.dur));
      else if (en.mode === 1) e = eOutCubic(c01((tau - c.i0 * en.stagger) / en.dur));
      else if (en.mode === 3) e = tau >= 0 ? 1 : 0;
      else e = en.mode === 2 && en.curve === 'linear' ? c01(tau / en.dur) : eOutCubic(c01(tau / en.dur));
      let op = e * (1 - A.exitFade) * A.opacity;
      if (c.i0 < part[0] || c.i0 >= part[1]) op = 0;
      const rise = (1 - e) * en.rise * U + A.exitP * (A.ex ? A.ex.rise : 0) * U;
      const blur = (1 - e) * en.blur * U + A.exitP * (A.ex ? A.ex.blur : 0) * U;
      const dx = c.i0 * A.trackExtra - R.centerShift;
      const lx = R.ox + Math.floor(c.pen) - c.lox + dx;
      const ly = R.y - L.loy + rise;
      let col = baseCol;
      for (const t of tints) if (c.i0 >= t.a && c.i0 < t.b && t.k > 0) col = col.map((v, i) => v + (t.c[i] * (entry.gain || 1) - v) * t.k);
      // tight quad: the ink box grown by what the effects reach (glow, blur, shadow, ink bloom, gold bevel)
      const pd = Math.ceil(padBase + blur * 1.6);
      const q = [Math.max(0, c.box[0] - pd), Math.max(0, c.box[1] - pd), Math.min(lpx, c.box[2] + pd), Math.min(lpy, c.box[3] + pd)];
      inst.push({ c, x: lx, y: ly, op, blur, col, row: r, q: [q[0] / lpx, q[1] / lpy, q[2] / lpx, q[3] / lpy] });
      if (op > 0) { minX = Math.min(minX, lx + q[0]); maxX = Math.max(maxX, lx + q[2]); minY = Math.min(minY, ly + q[1]); maxY = Math.max(maxY, ly + q[3]); }
    }
    if (minX > maxX) { minX = x0; maxX = x0 + 1; minY = y; maxY = y + 1; }
    const rect = [minX, minY, maxX - minX, maxY - minY];
    return { text, style, line: L, anim: A, x0, y, rows, centerShift: rows[0].centerShift, rect, inst, entry };
  };

  // ---------------------------------------------------------------- nib (script handwriting)
  const nibCache = new Map();
  function nibTable(L, en) {
    let tb = nibCache.get(L);
    if (tb && tb.slant === en.slant && tb.feather === en.feather) return tb;
    const W = L.w, H = L.h, d = L.imgData, sl = en.slant;
    // slanted columns: canvas x = xs - (oy - y) * slant (y down); the table spans the slanted ink extent
    const xsL = L.inkL + L.ox - sl * (L.desc + 4) - 2, xsR = L.inkR + L.ox + sl * (L.asc + 4) + en.feather * U;
    const nb = NIBN, bw = (xsR - xsL) / nb;
    const runs = new Float32Array(nb), ink = new Float32Array(nb);
    for (let b = 0; b < nb; b++) {
      let maxRuns = 0, sum = 0, cols = 0;
      for (let xs = xsL + b * bw; xs < xsL + (b + 1) * bw; xs += 1) {
        let inside = false, rcount = 0, s = 0;
        // count strokes inside the x-height band only: loops cross it twice, connectors once and thinly
        for (let y = Math.max(0, Math.floor(L.oy - L.xh * 1.05)); y < Math.min(H, Math.ceil(L.oy + 1)); y++) {
          const x = Math.round(xs - (L.oy - y) * sl);
          const a = x >= 0 && x < W ? d[(y * W + x) * 4 + 3] : 0;
          if (a > 127 && !inside) { rcount++; inside = true; } else if (a <= 127) inside = false;
          s += a / 255;
        }
        maxRuns = Math.max(maxRuns, rcount); sum += s; cols++;
      }
      runs[b] = maxRuns; ink[b] = cols ? sum / cols : 0;
    }
    const nz = Array.from(ink).filter(v => v > 0.5).sort((a, b) => a - b);
    const med = nz.length ? nz[Math.floor(nz.length / 2)] : 1;
    const speed = new Float32Array(nb);
    for (let b = 0; b < nb; b++) {
      let s;
      if (ink[b] < 0.15) s = 2.4;                           // pen in the air between strokes
      else if (runs[b] >= 2) s = 0.6;                       // loops
      else if (ink[b] < 0.6 * med) s = 1.6;                 // thin connectors
      else s = 1.0;
      speed[b] = s;
    }
    const sm = new Float32Array(nb);
    for (let b = 0; b < nb; b++) { let s = 0, w = 0; for (let k = -2; k <= 2; k++) { const j = Math.min(nb - 1, Math.max(0, b + k)); const ww = 3 - Math.abs(k); s += speed[j] * ww; w += ww; } sm[b] = s / w; }
    const cum = new Float32Array(nb + 1);
    for (let b = 0; b < nb; b++) cum[b + 1] = cum[b] + bw / sm[b];
    const total = cum[nb];
    tb = { slant: sl, feather: en.feather, xsL, xsR, cum: Array.from(cum, v => v / total), speed: Array.from(sm), bw, onInk: Array.from(ink, v => v >= 0.15) };
    nibCache.set(L, tb);
    return tb;
  }
  // front position (line px, slanted coordinate) at entry time tau
  function nibFront(tb, tau, dur) {
    const u = c01(tau / dur);
    const c = tb.cum; let i = 0;
    while (i < NIBN - 1 && c[i + 1] < u) i++;
    const f = (u - c[i]) / Math.max(1e-9, c[i + 1] - c[i]);
    return tb.xsL + (i + c01(f)) * (tb.xsR - tb.xsL) / NIBN;
  }

  T.nibProfile = function (entry) {
    const lay = T.layout(entry);
    const en = lay.anim.en;
    const tb = nibTable(lay.line, en);
    const L = lay.line, off = lay.rows[0].ox - L.ox;
    const samples = [];
    for (let k = 0; k <= 60; k++) {
      const tau = en.dur * k / 60;
      const xs = nibFront(tb, tau, en.dur);
      const b = Math.min(NIBN - 1, Math.max(0, Math.floor((xs - tb.xsL) / tb.bw)));
      samples.push([tau, tb.onInk[b] ? tb.speed[b] / 1.6 : 0]);   // nib on the paper: amplitude follows its speed
    }
    return { dur: en.dur, x0: tb.xsL + off, x1: tb.xsR + off, front: tau => nibFront(tb, tau, en.dur) + off, samples };
  };

  // ---------------------------------------------------------------- uniforms and draws
  const I0 = new Float32Array(MAXC * 4), I1 = new Float32Array(MAXC * 4), I2 = new Float32Array(MAXC * 4);
  const NIBT = new Float32Array((NIBN / 4 + 1) * 4);
  function inkExtent(lay) {
    const L = lay.line, R = lay.rows;
    let a = 1e9, b = -1e9;
    for (const r of R) { a = Math.min(a, r.ox + L.glyph[r.i0 * 4]); b = Math.max(b, r.ox + L.glyph[(r.i1 - 1) * 4 + 1]); }
    // the ink can overhang the advance box (italics, swashes)
    return [Math.min(a, R[0].ox + L.inkL), Math.max(b, R[R.length - 1].ox + L.inkR)];
  }
  T.inkExtent = inkExtent;

  function fxUniforms(lay, u) {
    const entry = lay.entry, L = lay.line, tau = entry.tau;
    const [ix0, ix1] = inkExtent(lay);
    u.uGildOn = 0; u.uRevOn = 0;
    if (entry.reveal) {
      const r = entry.reveal;
      u.uRevOn = 1;
      u.uRev0 = [r.x0 == null ? ix0 : r.x0, r.x1 == null ? ix1 : r.x1, r.t0 || 0, r.span || 0];
      u.uRev1 = [r.dur || 0.8, r.lo || 0, r.hi == null ? 1 : r.hi, tau];
    }
    if (entry.gild) {
      const gd = gildState(lay);
      u.uGildOn = 1;
      u.uGild = [gd.front, gd.feather, (entry.layer || lay.style.layer) === 'hdr' ? 1 : -1, gd.slant];
      u.uGildY = lay.rows[0].y;
    }
    void L;
    return u;
  }
  function gildState(lay) {
    const entry = lay.entry, g = entry.gild, tau = entry.tau;
    const feather = (g.feather == null ? 70 : g.feather) * U;
    const slant = g.slant == null ? 0.36 : g.slant;
    const [ix0, ix1] = inkExtent(lay);
    const a = ix0 - slant * lay.line.size * 0.4, b = ix1 + feather + slant * lay.line.size;
    const p = eInOutSine(c01((tau - g.at) / (g.dur || 1.2)));
    return { front: a + (b - a) * p, feather, slant, p, x0: a, x1: b, ix0, ix1 };
  }
  T.gildState = lay => lay.entry.gild ? gildState(lay) : null;

  function baseUniforms(lay, maskOut, view) {
    const { line: L, style, entry, inst } = lay;
    const n = inst.length;
    I0.fill(0); I1.fill(0);
    for (let k = 0; k < n; k++) {
      const s = inst[k];
      let op = s.op;
      if (maskOut && lay.lineOp > 0) op = op / lay.lineOp;
      I0.set([s.x, s.y, op, s.blur], k * 4);
      I1.set([s.col[0], s.col[1], s.col[2], s.c.layer], k * 4);
      I2.set(s.q, k * 4);
    }
    const glowAmt = maskOut ? 0 : (entry.glow == null ? style.glow : entry.glow) || 0;
    const glowCol = hex(entry.glowColor || entry.color || style.color).map(v => v * (entry.gain || 1));
    const sh = entry.shadow ? [entry.shadow.dx || 0, entry.shadow.dy == null ? 0.5 : entry.shadow.dy, entry.shadow.alpha == null ? 0.3 : entry.shadow.alpha, entry.shadow.blur == null ? 1 : entry.shadow.blur] : [0, 0, 0, 1];
    const u = {
      uI0: I0, uI1: I1, uI2: I2, uLayerPx: [L.layerW, L.layerH], uView: view, uArr: L.arr, uTexel: [1 / L.texW, 1 / L.texH], uPxToTex: PR,
      uGlow: glowAmt, uGlowCol: glowCol, uShadow: maskOut ? [0, 0, 0, 1] : sh, uMaskOut: maskOut ? 1 : 0, uGreek: entry.greek ? 1 : 0,
      uXH: L.xh, uBase: lay.rows[0].y, uNibOn: 0, uLumaGamma: style.gamma || 1, uInkGlow: [0, 0, 0, 0],
    };
    const en = lay.anim.en;
    if (en.mode === 3 && !entry.greek) {
      const tb = nibTable(L, en);
      const off = lay.rows[0].ox - L.ox;
      const front = nibFront(tb, entry.tau, en.dur) + off;
      NIBT.fill(0);
      for (let k = 0; k <= NIBN; k++) NIBT[k] = tb.cum[k] * en.dur;
      u.uNibOn = 1;
      u.uNib = [front, en.feather * U, en.slant, lay.rows[0].y];
      u.uNibX = [tb.xsL + off, tb.xsR + off, en.bloom * U, entry.tau];
      u.uNibT = NIBT; u.uNibBloomDur = en.bloomDur;
      const igA = maskOut ? 0 : (entry.inkGlow == null ? style.inkGlow : entry.inkGlow) || 0;
      if (igA > 0) u.uInkGlow = [...hex(entry.inkGlowColor || style.inkGlowColor || '#E39A4C'), igA];
    }
    fxUniforms(lay, u);
    return u;
  }

  T.drawCaption = function (target, entry) {
    const lay = T.layout(entry);
    if (!lay.anim.shown) return lay;
    const u = baseUniforms(lay, false, [0, 0, G.W, G.H]);
    G.draw(prog, u, target, { blend: 'premul', mode: gl.TRIANGLE_STRIP, count: 4, instances: lay.inst.length });
    return lay;
  };

  T.drawMask = function (entry) {
    const lay = T.layout(entry);
    // line-level opacity is handed to the gold pass so the mask keeps full coverage for the bevel normals
    const en = lay.anim.en;
    lay.lineOp = (en.mode === 2 ? Math.max(...lay.inst.map(s => s.op), 0) : lay.anim.opacity * (1 - lay.anim.exitFade));
    const r = lay.rect.map(Math.round);
    r[2] = Math.max(1, r[2]); r[3] = Math.max(1, r[3]);
    // PR texels per frame px (core/gold.js samples its bevel mips one level up per doubling); r stays the frame px rect
    const rt = G.acquire(r[2] * PR, r[3] * PR, { format: 'rgba8', mips: true, scale: PR });
    G.clear(rt, [0, 0, 0, 0]);
    if (lay.anim.shown && lay.lineOp > 0) {
      const u = baseUniforms(lay, true, r);
      G.draw(prog, u, rt, { blend: 'premul', mode: gl.TRIANGLE_STRIP, count: 4, instances: lay.inst.length });
    }
    G.mipmaps(rt);
    return { rt, rect: r, lay, lineOpacity: lay.anim.shown ? lay.lineOp : 0 };
  };
  T.releaseMask = m => G.release(m.rt);
  T.linear = h => hex(h).map(srgbToLin);

  // ---------------------------------------------------------------- layout helpers
  T.measure = function (entry) {
    const e = Object.assign({ tau: 1e3, x: 0, y: 0 }, entry);
    const { text, style } = T.resolve(e);
    const L = T.line(text, style);
    const rows = rowsOf(e, L);
    return { adv: L.adv, size: L.size, asc: L.asc, desc: L.desc, inkL: L.inkL, inkR: L.inkR, rows: rows.length, rowAdv: rows.map(r => r.adv) };
  };
  T.words = function (e) {
    if (typeof e === 'string') e = { lineId: e };
    const { text, style } = T.resolve(e);
    const L = T.line(text, style);
    const out = [];
    let i = 0;
    while (i < L.n) {
      while (i < L.n && isSpace(L.chars[i])) i++;
      if (i >= L.n) break;
      let j = i; while (j < L.n && !isSpace(L.chars[j])) j++;
      let a = i, b = j;
      while (a < b && !isLetterish(L.chars[a])) a++;
      while (b > a && !isLetterish(L.chars[b - 1])) b--;
      out.push({ i0: i, i1: j, core: [a, b] });
      i = j;
    }
    return out;
  };
  T.wordRange = function (e, k) {
    const w = T.words(e);
    const r = w[k < 0 ? w.length + k : k];
    if (!r) throw new Error('no word ' + k);
    return r.core.slice();
  };
  T.flow = function (entries, o = {}) {
    const ms = entries.map(e => T.measure(e));
    const em = ms[0].size;
    const gap = (o.gap == null ? 0.25 : o.gap) * em;
    const total = ms.reduce((s, m) => s + m.adv, 0) + gap * (entries.length - 1);
    const align = o.align || 'center';
    let x = (o.x == null ? entries[0].x : o.x) - (align === 'center' ? total / 2 : align === 'right' ? total : 0);
    return entries.map((e, i) => { const r = Object.assign({}, e, { x, align: 'left' }); x += ms[i].adv + gap; return r; });
  };
  T.nibEntries = function (entry) {
    const ink = Object.assign({}, entry, { layer: 'caption' });
    const goldE = Object.assign({}, entry, { layer: 'hdr' });
    if (!entry.gild || entry.tau < entry.gild.at) goldE.opacity = 0;
    return [ink, goldE];
  };

  // ---------------------------------------------------------------- particle points and outlines
  T.points = function (entry, o = {}) {
    const e = Object.assign({}, entry, { tau: 1e3, exit: null, part: null, reveal: null, gild: null });
    const lay = T.layout(e);
    const L = lay.line;
    const thr = (o.threshold == null ? 0.5 : o.threshold) * 255, step = o.step || 1;
    const part = entry.part || [0, MAXC];
    const raw = [];
    for (const s of lay.inst) {
      const c = s.c;
      if (c.i0 < part[0] || c.i0 >= part[1]) continue;
      const a = c.alpha;
      for (let y = 0; y < L.layerH; y += step) for (let x = 0; x < L.layerW; x += step) {
        if (a[y * L.layerW + x] > thr) raw.push(s.x + x + 0.5, s.y + y + 0.5);
      }
    }
    const n = raw.length / 2;
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
    for (let i = 0; i < n; i++) { x0 = Math.min(x0, raw[i * 2]); x1 = Math.max(x1, raw[i * 2]); y0 = Math.min(y0, raw[i * 2 + 1]); y1 = Math.max(y1, raw[i * 2 + 1]); }
    const rnd = mulberry32((o.seed == null ? 1 : o.seed) >>> 0);
    const idx = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    const m = o.count > 0 ? o.count : n;
    const pts = new Float32Array(m * 2), xn = new Float32Array(m);
    for (let i = 0; i < m && n > 0; i++) {
      const k = idx[i % n];
      pts[i * 2] = raw[k * 2]; pts[i * 2 + 1] = raw[k * 2 + 1];
      xn[i] = (raw[k * 2] - x0) / Math.max(1, x1 - x0);
    }
    return { pts, xn, count: m, x0, x1, y0, y1, available: n };
  };

  T.glyphOutline = function (entry, gi, o = {}) {
    const e = Object.assign({}, entry, { tau: 1e3, exit: null, part: null, reveal: null, gild: null });
    const lay = T.layout(e);
    const L = lay.line;
    const s = lay.inst.find(q => gi >= q.c.i0 && gi < q.c.i1);
    if (!s) throw new Error('glyph ' + gi + ' has no ink');
    const W = L.layerW, H = L.layerH, a = s.c.alpha;
    const off = (o.offset == null ? 6 : o.offset) * U, count = o.count || 56;
    // outside region: flood fill of empty pixels from the layer border
    const out = new Uint8Array(W * H), st = [];
    const push = (x, y) => { const k = y * W + x; if (!out[k] && a[k] < 128) { out[k] = 1; st.push(k); } };
    for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
    for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }
    while (st.length) { const k = st.pop(), x = k % W, y = (k / W) | 0; if (x > 0) push(x - 1, y); if (x < W - 1) push(x + 1, y); if (y > 0) push(x, y - 1); if (y < H - 1) push(x, y + 1); }
    // distance from the ink (edge pixels), brute force over the boundary set
    const edge = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { const k = y * W + x; if (a[k] >= 128 && (out[k - 1] || out[k + 1] || out[k - W] || out[k + W])) edge.push(x, y); }
    let cx = 0, cy = 0, cn = 0;
    for (let i = 0; i < edge.length; i += 2) { cx += edge[i]; cy += edge[i + 1]; cn++; }
    cx /= cn; cy /= cn;
    // march rays from the centroid outward; the contour point is where the distance to the ink first reaches `off`
    // beyond the last ink crossing (works for the round capitals this is used for)
    const N = 720, ring = [];
    for (let k = 0; k < N; k++) {
      const an = -Math.PI / 2 + 2 * Math.PI * k / N;
      const dx = Math.cos(an), dy = Math.sin(an);
      let lastInk = -1;
      for (let r = 0; r < Math.max(W, H); r += 0.5) {
        const x = Math.round(cx + dx * r), y = Math.round(cy + dy * r);
        if (x < 0 || y < 0 || x >= W || y >= H) break;
        if (a[y * W + x] >= 128) lastInk = r;
      }
      if (lastInk < 0) continue;
      // refine: nearest-ink distance from points along the ray beyond lastInk
      let best = lastInk + off;
      for (let r = lastInk; r < lastInk + off * 3; r += 0.25) {
        const px = cx + dx * r, py = cy + dy * r;
        let dmin = 1e9;
        for (let i = 0; i < edge.length; i += 2) { const ex = edge[i] - px, ey = edge[i + 1] - py; const d = ex * ex + ey * ey; if (d < dmin) dmin = d; }
        if (Math.sqrt(dmin) >= off) { best = r; break; }
      }
      ring.push([cx + dx * best, cy + dy * best]);
    }
    // resample by arc length
    const seg = [0];
    for (let i = 1; i <= ring.length; i++) { const p = ring[i - 1], q = ring[i % ring.length]; seg.push(seg[i - 1] + Math.hypot(q[0] - p[0], q[1] - p[1])); }
    const len = seg[seg.length - 1];
    const res = new Float32Array(count * 2);
    let j = 0;
    for (let k = 0; k < count; k++) {
      const sl = len * k / count;
      while (j < ring.length - 1 && seg[j + 1] < sl) j++;
      const p = ring[j], q = ring[(j + 1) % ring.length], f = (sl - seg[j]) / Math.max(1e-9, seg[j + 1] - seg[j]);
      res[k * 2] = s.x + p[0] + (q[0] - p[0]) * f; res[k * 2 + 1] = s.y + p[1] + (q[1] - p[1]) * f;
    }
    return res;
  };
  return T;
}
