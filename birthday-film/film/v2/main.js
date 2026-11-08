/*
  film/v2/main.js: boot and the frame graph (SPEC 6.1, 6.3).

  Contract: window.FILM = {duration, width, height, res, frameWidth, frameHeight}: width/height are the capture size in
  physical px (frame size x res; the viewport must be exactly that at deviceScaleFactor 1), frameWidth/frameHeight the
  layout size in frame px; window.filmReady (Promise, resolves once fonts, photo, cues and every
  scene's init are done); async window.seek(t) draws the frame for time t and resolves after the GPU has finished it.
  URL: ?variant=portrait (1080x1920, default landscape 1920x1080), ?render=1 (no live loop), ?profile=1 (stage timings),
       ?res=2 (output scale: 2x the pixels per axis, same layout and look; 1 or 2, anything else is refused at boot),
       ?showtext=1 (debug: placeholder scenes draw the real lines; stills must stay under private/),
       ?t=<seconds> (live preview start time).
  The page must be opened with file access to sibling files (render.js launches Chromium with
  --allow-file-access-from-files) or served over http (python3 -m http.server from the repository root).

  seek(t), per SPEC 6.3:
    1 timeline.active(t): one scene, or two inside a transition window (both at their own internalScale; the
      outgoing one is no longer halved: half-resolution line art aliased into moire)
    2 each scene's render(ctx, tau, p, target) -> its own HDR target (scale = internalScale); full-res single scenes
      render straight into the frame target C
    3 transition shader -> C (crossfade | over | inkbleed | custom). 'inkbleed' is the gold-dust dissolve: a fine
      domain-warped fbm field (optionally mixed with a radial term) is evaluated at quarter resolution together with
      a feather that is at least opts.feather frame px wide across the front (from the field's own gradient), then
      the full-resolution pass luma-keys it with the incoming scene (its highlights arrive first), adds a fine grain
      inside the feather, and lays a whisper of sparse HDR glints along the front, coloured through the gold ramp.
      There is no outline: nothing is drawn on the front itself but those few glints.
    4 overlay(ctx, tau, p, target) -> C, additive; the scene's 'hdr' caption entries (gold leaf) go through the text
      target frame.T and are composited over (premultiplied); frame.T's alpha also tells post which pixels are
      exempt from chromatic aberration. During a transition each scene's overlay and text go through a scratch target
      and are added with its transition weight.
    5 post.run: bloom ... AgX + grade (3D LUT) + TPDF dither -> canvas; 6 captions (display space) onto the canvas
      The chromatic aberration a scene asks for is capped at CA_MAX (CA_FLASH for the second after the merger cue).
  The ctx object handed to scenes is documented in makeCtx() below.
*/
import { createGL, hex, hexLin } from './core/gl.js';
import * as glsl from './core/glsl.js';
import * as TL from './core/timeline.js';
import { createPost, displayToScene, sceneToDisplay } from './core/post.js';
import { createText, loadFonts, styleOf } from './core/text.js';
import { createGold, GOLD_RAMPS } from './core/gold.js';
import { createParticles, glyphPoints, shuffle } from './core/particles.js';
import { createKnot, closedKnot, verifyKnot } from './core/knot.js';
import { loadPhoto, photoCamera, faceEllipses, createPhotoRenderer, photoAssertLog } from './core/photo.js';
import { createSea, horizonPitch } from './core/sea.js';
import { SCENES, TRANSITIONS } from './scenes/index.js';

const Q = new URLSearchParams(location.search);
const PORTRAIT = Q.get('variant') === 'portrait';
const RENDER = Q.get('render') === '1';
const PROFILE = Q.get('profile') === '1';
const W = PORTRAIT ? 1080 : 1920, H = PORTRAIT ? 1920 : 1080;
// output scale (glsl.RES, parsed at module load). Named RES: drawFrame declares a local const R.
const RES = glsl.RES;
window.FILM = { duration: TL.DURATION, width: W * RES, height: H * RES, res: RES, frameWidth: W, frameHeight: H };
let readyOk, readyFail;
window.filmReady = new Promise((a, b) => { readyOk = a; readyFail = b; });
const DEBUG = window.FILM_DEBUG = { timings: null, photoAssertLog, errors: [] };

function loadJSON(url, optional) {
  return new Promise((res, rej) => {
    const r = new XMLHttpRequest();
    r.open('GET', url);
    r.onload = () => { if (r.status && r.status >= 400) return optional ? res(null) : rej(new Error(url + ' ' + r.status)); try { res(JSON.parse(r.responseText)); } catch (e) { optional ? res(null) : rej(e); } };
    r.onerror = () => optional ? res(null) : rej(new Error('cannot load ' + url));
    r.send();
  });
}

const SRC_COPY = glsl.frag(`uniform sampler2D uA; uniform float uK; out vec4 o; void main(){ o = texture(uA, screenUV()) * uK; }`);
// the director's ceiling on chromatic aberration (post.js DEFAULTS.ca is 0.0015)
const CA_MAX = 0.003, CA_FLASH = 0.004;

// gold-dust dissolve, stage 1 (quarter resolution): x = the dissolve field (lower = the incoming scene arrives
// earlier), y = half-width of the feather in field units (at least uFeather/2 frame px across the front)
const SRC_DMASK = glsl.frag(`
uniform float uNScale, uWarp, uRadial, uFeather, uSeed, uCalm; uniform int uOct; uniform vec2 uCtr, uAsp;
out vec4 o;
float calmK = 1.0;   // 0 inside the calm core (no texture there: a smooth soft iris), 1 outside
float field(vec2 px){
  float s = min(uFrame.x, uFrame.y);
  vec2 p = px / s * uNScale + uSeed;
  // a light domain warp (value noise, not fbm) so the front curls like fibres rather than tracing islands
  p += uWarp * (vec2(vn(p * 0.45 + 3.7), vn(p * 0.45 + 11.3)) - 0.5);
  float n = (fbm(p, uOct) - 0.5) * 1.5 + 0.5;
  calmK = 1.0;
  if (uRadial != 0.0){
    // distance from the centre point (uAsp stretches it: x 0.4 = a wide ellipse along a horizon), 1 at the farthest corner
    vec2 c0 = (vec2(0.0) - uCtr) * uAsp, c1 = (vec2(uFrame.x, 0.0) - uCtr) * uAsp, c2 = (uFrame - uCtr) * uAsp, c3 = (vec2(0.0, uFrame.y) - uCtr) * uAsp;
    float rmax = sqrt(max(max(dot(c0, c0), dot(c1, c1)), max(dot(c2, c2), dot(c3, c3))));
    float rr = length((px - uCtr) * uAsp) / rmax;
    // uRadial > 0: the frame edges first and the centre point last; < 0: outward from the centre point
    // uCalm: within that radius of the centre point the noise fades out (faces in a photograph dissolve evenly)
    calmK = uCalm > 0.0 ? smoothstep(uCalm * 0.5, uCalm * 1.6, rr) : 1.0;
    n = mix(0.5, n, calmK);
    n = uRadial > 0.0 ? mix(n, 1.0 - rr, uRadial) : mix(n, rr, -uRadial);
  }
  return n;
}
void main(){
  vec2 px = framePx();
  float h = 3.0;   // frame px
  float nx = field(px + vec2(h, 0.0)), ny = field(px + vec2(0.0, h));
  float n = field(px);
  float g = length(vec2(nx - n, ny - n)) / h;      // field units per frame px
  // the floor keeps the feather soft where the field is flat (its extrema), which would otherwise cut a hard edge
  o = vec4(n, max(g * uFeather * 0.5, 0.06), calmK, 1.0);
}`);

const SRC_TRANS = glsl.frag(`
uniform sampler2D uA, uB, uM; uniform int uKind; uniform float uW, uGold, uLumaKey, uGrain, uTime;
uniform vec3 uRamp[7];
out vec4 o;
vec3 rampAt(float s){
  s = clamp(s, 0.0, 1.0) * 6.0; int i = int(min(floor(s), 5.0)); float f = s - float(i);
  vec3 a = uRamp[0], b = uRamp[1];
  for (int k = 1; k < 6; k++) if (k == i){ a = uRamp[k]; b = uRamp[k + 1]; }
  return mix(a, b, f);
}
void main(){
  vec2 uv = screenUV();
  vec4 a = texture(uA, uv), b = texture(uB, uv);
  vec3 c;
  if (uKind == 0) c = mix(a.rgb, b.rgb, uW);
  else if (uKind == 1) c = b.rgb + a.rgb * (1.0 - clamp(b.a, 0.0, 1.0));
  else {
    vec2 px = framePx();
    vec3 mf = texture(uM, uv).xyz;
    float F = mf.y, calm = mf.z;
    // luma key: the incoming scene's highlights come through first
    float key = 1.0 - exp(-1.6 * max(luma(b.rgb), 0.0));
    float x = mf.x - uLumaKey * key;
    float lo = -uLumaKey - 0.15, hi = 1.15;     // the field spans about [0.05, 0.95]; the end ramps below tidy the rest
    float thr = mix(lo, hi, uW);
    float m = 1.0 - smoothstep(thr - F, thr + F, x);
    // fine grain inside the feather (2-3 px dust), never outside it
    float gr = vn(px / 2.6 + 41.0) - 0.5;
    m = clamp(m + gr * uGrain * calm * 4.0 * m * (1.0 - m), 0.0, 1.0);
    // clean ends whatever the field's range
    m = max(m * smoothstep(0.0, 0.08, uW), smoothstep(0.92, 1.0, uW));
    // mix in a compressed domain (Reinhard): in linear HDR a few percent of a sun already saturates after the
    // tonemap, which would print the feather as a hard edge on every highlight
    vec3 ca = max(a.rgb, 0.0), cb = max(b.rgb, 0.0);
    vec3 y = mix(ca / (1.0 + ca), cb / (1.0 + cb), m);
    c = y / max(1.0 - y, 1e-4);
    if (uGold > 0.0){
      // a whisper of glints along the front: one candidate in ~16 cells of 7 px, a soft 1 px dot that twinkles
      float band = exp(-2.0 * pow((x - thr) / F, 2.0)) * step(0.02, uW) * step(uW, 0.98);
      vec2 cell = floor(px / 7.0);
      vec2 hh = h22(cell + 913.0);
      if (band > 0.02 && hh.x > 0.985){
        vec2 at = cell * 7.0 + 1.5 + 4.0 * vec2(h12(cell + 57.0), h12(cell + 171.0));
        float d2 = dot(px - at, px - at);
        float dotk = exp(-d2 / 1.4);
        float tw = 0.5 + 0.5 * sin(uTime * 7.0 + hh.y * 40.0);
        float k = band * dotk * tw * uGold * calm;
        c += rampAt(0.5 + 0.5 * tw * dotk) * k * 1.6;
      }
    }
  }
  o = vec4(c, 1.0);
}`);

async function boot() {
  if (glsl.RES_REQUESTED !== RES) throw new Error('unsupported ?res=' + glsl.RES_REQUESTED + ' (1 or 2)');
  const canvas = document.getElementById('gl');
  canvas.style.width = (W * RES) + 'px'; canvas.style.height = (H * RES) + 'px';
  const G = createGL(canvas, { width: W, height: H, res: RES });
  const [cues, ev] = await Promise.all([loadJSON('cues.json'), loadJSON('cues_events.json', true)]);
  TL.setCues(cues); TL.setEvents(ev);
  if (!window.LINES) throw new Error('LINES missing (private/v2/lines.js not loaded)');
  await loadFonts(Object.values(window.LINES), G.U);
  const text = createText(G);
  const gold = createGold(G);
  const particles = createParticles(G);
  const knot = createKnot(G, gold);
  const post = createPost(G);
  const sea = createSea(G);
  const photo = await loadPhoto(G);
  const photoR = createPhotoRenderer(G, photo);
  const P = { copy: G.program('main.copy', SRC_COPY), trans: G.program('main.trans', SRC_TRANS), dmask: G.program('main.dmask', SRC_DMASK) };
  const rampOf = look => new Float32Array([].concat(...(GOLD_RAMPS[look] || GOLD_RAMPS.winter_gold)));
  const flashT = TL.cue('merger');

  const ctx = makeCtx({ G, text, gold, particles, knot, post, sea, photo, photoR });
  const timeline = new TL.Timeline(SCENES, TRANSITIONS);
  for (const s of SCENES) if (s.init) await s.init(ctx);
  DEBUG.scenes = SCENES.map(s => ({ id: s.id, t0: s.t0, t1: s.t1, internalScale: s.internalScale, look: s.look }));
  DEBUG.transitions = TRANSITIONS.map(t => ({ from: t.from, to: t.to, t0: t.t0, t1: t.t1, kind: t.kind }));
  DEBUG.hdr = G.hdr.name;
  DEBUG.res = RES;

  const now = () => performance.now();   // profiling only (?profile=1); never affects pixels
  const px1 = new Float32Array(4), px8 = new Uint8Array(4);
  // a 1-pixel readback is a true GPU sync in Chromium (gl.finish only flushes the command buffer)
  function sync(target) { G.bindTarget(target); if (target) G.gl.readPixels(0, 0, 1, 1, G.gl.RGBA, G.gl.FLOAT, px1); else G.gl.readPixels(0, 0, 1, 1, G.gl.RGBA, G.gl.UNSIGNED_BYTE, px8); }

  // a scene's HDR target: internalScale (logical, layer.scale) x the output scale RES texels per frame px
  function sceneTarget(name, scale) {
    return G.target('frame.' + name, W * scale * RES, H * scale * RES, { scale: scale * RES });
  }
  function entriesOf(L) {
    const s = L.scene;
    if (!s.captions) return [];
    ctx.layer = L;
    const list = s.captions(ctx, L.tau, L.p) || [];
    return list.map(e => Object.assign({ _scene: s.id }, e));
  }
  function isHDR(e) { return (e.layer || styleOf(e.style || 'narrative').layer) === 'hdr'; }

  function drawFrame(t) {
    t = Math.min(Math.max(t, 0), TL.DURATION - 1e-6);
    const frame = Math.round(t * TL.FPS);
    ctx.t = t; ctx.frame = frame;
    const A = timeline.active(t);
    if (PROFILE) sync(null);
    const T0 = PROFILE ? now() : 0;
    const C = G.target('frame.C', W * RES, H * RES, { scale: RES });
    const caps = A.layers.map(L => entriesOf(L));
    // 2-3 render and transition
    if (!A.transition) {
      const L = A.layers[0];
      ctx.layer = L;
      if (L.scale === 1) { G.clear(C, [0, 0, 0, 1]); L.scene.render(ctx, L.tau, L.p, C); }
      else {
        const R = sceneTarget('A', L.scale); G.clear(R, [0, 0, 0, 1]);
        L.scene.render(ctx, L.tau, L.p, R);
        G.draw(P.copy, { uA: R, uK: 1 }, C);
      }
    } else {
      const [La, Lb] = A.layers;
      const RA = sceneTarget('A', La.scale), RB = sceneTarget('B', Lb.scale);
      ctx.layer = La; G.clear(RA, [0, 0, 0, 1]); La.scene.render(ctx, La.tau, La.p, RA);
      ctx.layer = Lb; G.clear(RB, [0, 0, 0, A.transition.kind === 'over' ? 0 : 1]); Lb.scene.render(ctx, Lb.tau, Lb.p, RB);
      const tr = A.transition;
      if (tr.kind === 'custom') {
        if (!Lb.scene.transition) throw new Error(Lb.scene.id + ' declares a custom transition but has no transition()');
        ctx.layer = Lb; Lb.scene.transition(ctx, tr.w, RA, RB, C);
      } else {
        const kind = tr.kind === 'crossfade' ? 0 : tr.kind === 'over' ? 1 : 2;
        const o = tr.opts || {};
        let M = null;
        if (kind === 2) {
          // gold-dust dissolve: the field and its feather at quarter resolution (static in time: only the threshold moves)
          // Logical at every RES: a smooth field sampled by uv, so the dissolve front is identical at every output
          // scale; the grain and glints are evaluated at full resolution in SRC_TRANS.
          M = G.target('frame.dmask', W / 4, H / 4, { scale: 0.25 });
          // portrait may override the centre and the radial aspect (an aspect tuned for 16:9 turns the iris into a tide in 9:16)
          const ctr = (PORTRAIT && o.centerPortrait) || o.center || [0.5, 0.5];
          const asp = (PORTRAIT && o.aspectPortrait) || o.aspect || [1, 1];
          G.draw(P.dmask, { uNScale: o.scale || 14, uOct: o.oct || 3, uWarp: o.warp == null ? 0.9 : o.warp, uRadial: o.radial || 0,
            uFeather: o.feather || 48, uSeed: o.seed || 0, uCalm: o.calm || 0, uCtr: [ctr[0] * W, ctr[1] * H], uAsp: asp }, M);
        }
        G.draw(P.trans, { uA: RA, uB: RB, uM: M || RA, uKind: kind, uW: tr.w, uGold: o.gold || 0, uLumaKey: o.lumaKey || 0,
          uGrain: o.grain == null ? 0.35 : o.grain, uTime: t, uRamp: rampOf(o.goldLook || Lb.scene.look) }, C);
      }
    }
    // 4 overlay (additive HDR) and gold-leaf caption entries (through frame.T, whose alpha exempts them from CA)
    const single = !A.transition;
    let TM = null;
    A.layers.forEach((L, i) => {
      const hdrEntries = caps[i].filter(isHDR);
      if (!L.scene.overlay && !hdrEntries.length) return;
      ctx.layer = L;
      const target = single ? C : G.target('frame.O', W * RES, H * RES, { scale: RES });
      if (!single) G.clear(target, [0, 0, 0, 0]);
      if (L.scene.overlay) L.scene.overlay(ctx, L.tau, L.p, target);
      if (hdrEntries.length) {
        const T = single ? G.target('frame.T', W * RES, H * RES, { scale: RES }) : G.target('frame.TL', W * RES, H * RES, { scale: RES });
        G.clear(T, [0, 0, 0, 0]);
        for (const e of hdrEntries) gold.drawText(T, text, e);
        G.draw(P.copy, { uA: T, uK: 1 }, target, { blend: 'premul' });
        if (single) TM = T;
        else {
          if (!TM) { TM = G.target('frame.T', W * RES, H * RES, { scale: RES }); G.clear(TM, [0, 0, 0, 0]); }
          G.draw(P.copy, { uA: T, uK: L.weight }, TM, { blend: 'add' });
        }
      }
      if (!single) G.draw(P.copy, { uA: target, uK: L.weight }, C, { blend: 'add' });
    });
    if (PROFILE) sync(C);
    const T1 = PROFILE ? now() : 0;
    // 5 post
    const params = A.layers.map(L => {
      ctx.layer = L;
      const look = L.scene.lookAt ? L.scene.lookAt(ctx, L.tau, L.p) : L.scene.look;
      return post.params(look, L.scene.post ? L.scene.post(ctx, L.tau, L.p) || {} : {});
    });
    const pp = single ? params[0] : post.lerp(params[0], params[1], A.transition.w);
    pp.ca = Math.min(pp.ca, t >= flashT && t < flashT + 1.0 ? CA_FLASH : CA_MAX);
    post.run(C, pp, frame, { noCA: TM });         // bloom ... grade, dither -> canvas
    // 6 captions (display space, on the canvas)
    caps.forEach(list => { for (const e of list) if (!isHDR(e)) text.drawCaption(null, e); });
    if (PROFILE) { sync(null); const T2 = now(); DEBUG.timings = { t, content: T1 - T0, post: T2 - T1, scenes: A.layers.map(L => L.scene.id) }; }
    return A;
  }

  window.seek = async function (t) {
    drawFrame(t);
    G.gl.finish();
    return true;
  };
  DEBUG.captionsAt = function (t) {
    const A = timeline.active(t);
    const out = [];
    A.layers.forEach(L => {
      for (const e of entriesOf(L)) {
        if (!e.lineId) continue;
        const lay = text.layout(e);
        out.push({ scene: L.scene.id, lineId: e.lineId, part: e.part || null, shown: lay.anim.shown, opacity: lay.anim.opacity * (1 - lay.anim.exitP), fullyIn: lay.anim.fullyIn, layer: isHDR(e) ? 'hdr' : 'caption' });
      }
    });
    return out;
  };
  DEBUG.activeAt = t => { const A = timeline.active(t); return { layers: A.layers.map(L => ({ id: L.scene.id, tau: L.tau, scale: L.scale, weight: L.weight, role: L.role })), transition: A.transition }; };
  DEBUG.ctx = ctx;
  await window.seek(Q.has('t') ? parseFloat(Q.get('t')) : 0);
  return { G };
}

/*
  ctx (shared by every scene; per-call fields are set by the frame graph before each call):
    G, gl, W, H, U (min(W,H)/1080), portrait (bool), layout ('landscape' | 'portrait')
    R            output scale (layout stays in frame px; texels per frame px of a full-resolution target = target.scale)
    glsl         core/glsl.js module (HEADER, frag, ...)        tl     core/timeline.js module (E, seg, env, spring, ...)
    text, gold, particles, knot, post, sea                     the core module instances (see their headers)
    photo        {tex, w, h, meta}     photoR  plain photo renderer     photoCamera(crop, opts), faceEllipses(cam)
    cue(name)    seconds from cues.json            events(name)  list from cues_events.json ([] if not generated)
    rng(name)    mulberry32 seeded from the name (call once in init, keep the generator)
    hex, hexLin, displayToScene(hexOrRgb, params?), sceneToDisplay(rgb, params?)
    glyphPoints, shuffle, closedKnot, verifyKnot, horizonPitch
    per call:    t (absolute seconds), frame (index at 30 fps), layer {scene, tau, p, scale, weight, role}
*/
function makeCtx(mods) {
  return Object.assign({
    gl: mods.G.gl, W, H, U: mods.G.U, R: RES, portrait: PORTRAIT, layout: PORTRAIT ? 'portrait' : 'landscape',
    glsl, tl: TL, cue: TL.cue, events: TL.events, rng: name => TL.mulberry32(TL.seedOf(name)),
    hex, hexLin, displayToScene, sceneToDisplay, glyphPoints, shuffle, closedKnot, verifyKnot, horizonPitch,
    photoCamera: (crop, o = {}) => photoCamera(crop, Object.assign({ frame: [W, H], layout: PORTRAIT ? 'portrait' : 'landscape' }, o)),
    faceEllipses, t: 0, frame: 0, layer: null,
    showText: Q.get('showtext') === '1',   // debug: placeholders draw the real lines instead of word blocks
  }, mods);
}

boot().then(({ G }) => {
  readyOk(true);
  if (!RENDER) {
    // live preview (wall clock is fine here: this loop is never used for rendering)
    const start = Q.has('t') ? parseFloat(Q.get('t')) : 0;
    const t0 = performance.now();
    const loop = async () => { const t = (start + (performance.now() - t0) / 1000) % TL.DURATION; await window.seek(t); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    void G;
  }
}).catch(e => { console.error('boot failed:', e && e.stack || e); DEBUG.errors.push(String(e && e.message || e)); readyFail(e); });
