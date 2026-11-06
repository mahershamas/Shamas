/*
  film/v2/main.js: boot and the frame graph (SPEC 6.1, 6.3).

  Contract: window.FILM = {duration, width, height}; window.filmReady (Promise, resolves once fonts, photo, cues and every
  scene's init are done); async window.seek(t) draws the frame for time t and resolves after the GPU has finished it.
  URL: ?variant=portrait (1080x1920, default landscape 1920x1080), ?render=1 (no live loop), ?profile=1 (stage timings),
       ?showtext=1 (debug: placeholder scenes draw the real lines; stills must stay under private/),
       ?t=<seconds> (live preview start time).
  The page must be opened with file access to sibling files (render.js launches Chromium with
  --allow-file-access-from-files) or served over http (python3 -m http.server from the repository root).

  seek(t), per SPEC 6.3:
    1 timeline.active(t): one scene, or two inside a transition window (outgoing at internalScale 0.5)
    2 each scene's render(ctx, tau, p, target) -> its own HDR target (scale = internalScale); full-res single scenes
      render straight into the frame target C
    3 transition shader -> C (crossfade | over | inkbleed | custom)
    4 overlay(ctx, tau, p, target) and the scene's 'hdr' caption entries (gold leaf) -> C, additive; during a transition
      each scene's overlay goes through a scratch target and is added with its transition weight
    5 post.run: bloom ... AgX + grade (3D LUT) + TPDF dither -> canvas; 6 captions (display space) onto the canvas
  The ctx object handed to scenes is documented in makeCtx() below.
*/
import { createGL, hex, hexLin } from './core/gl.js';
import * as glsl from './core/glsl.js';
import * as TL from './core/timeline.js';
import { createPost, displayToScene, sceneToDisplay } from './core/post.js';
import { createText, loadFonts, styleOf } from './core/text.js';
import { createGold } from './core/gold.js';
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
window.FILM = { duration: TL.DURATION, width: W, height: H };
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
const SRC_TRANS = glsl.frag(`
uniform sampler2D uA, uB; uniform int uKind; uniform float uW, uEdge, uGold, uNScale, uLumaKey; uniform int uOct;
out vec4 o;
void main(){
  vec2 uv = screenUV();
  vec4 a = texture(uA, uv), b = texture(uB, uv);
  vec3 c;
  if (uKind == 0) c = mix(a.rgb, b.rgb, uW);
  else if (uKind == 1) c = b.rgb + a.rgb * (1.0 - clamp(b.a, 0.0, 1.0));
  else {
    vec2 px = framePx() / uFrame.y;
    float n = (fbm(px * uNScale, uOct) - 0.5) * 2.2 + 0.5;
    n -= uLumaKey * clamp(luma(b.rgb), 0.0, 1.0);
    float thr = mix(-0.3 - uEdge - uLumaKey, 1.3 + uEdge, uW);
    float fw = max(fwidth(n), 1e-4);
    float m = 1.0 - smoothstep(thr - fw, thr + fw, n);
    c = mix(a.rgb, b.rgb, m);
    if (uGold > 0.0 && uEdge > 0.0){
      // a thin gilded rim on the dissolving edge: uEdge in noise units, at least about 1.5 px wide
      float wdt = max(uEdge * 0.2, fw * 1.5);
      float e = (1.0 - smoothstep(wdt - fw, wdt + fw, abs(n - thr))) * step(0.001, uW) * step(uW, 0.999);
      c = mix(c, vec3(1.0, 0.71, 0.29) * 0.8, e * uGold);
    }
  }
  o = vec4(c, 1.0);
}`);

async function boot() {
  const canvas = document.getElementById('gl');
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  const G = createGL(canvas, { width: W, height: H });
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
  const P = { copy: G.program('main.copy', SRC_COPY), trans: G.program('main.trans', SRC_TRANS) };

  const ctx = makeCtx({ G, text, gold, particles, knot, post, sea, photo, photoR });
  const timeline = new TL.Timeline(SCENES, TRANSITIONS);
  for (const s of SCENES) if (s.init) await s.init(ctx);
  DEBUG.scenes = SCENES.map(s => ({ id: s.id, t0: s.t0, t1: s.t1, internalScale: s.internalScale, look: s.look }));
  DEBUG.transitions = TRANSITIONS.map(t => ({ from: t.from, to: t.to, t0: t.t0, t1: t.t1, kind: t.kind }));
  DEBUG.hdr = G.hdr.name;

  const now = () => performance.now();   // profiling only (?profile=1); never affects pixels
  const px1 = new Float32Array(4), px8 = new Uint8Array(4);
  // a 1-pixel readback is a true GPU sync in Chromium (gl.finish only flushes the command buffer)
  function sync(target) { G.bindTarget(target); if (target) G.gl.readPixels(0, 0, 1, 1, G.gl.RGBA, G.gl.FLOAT, px1); else G.gl.readPixels(0, 0, 1, 1, G.gl.RGBA, G.gl.UNSIGNED_BYTE, px8); }

  function sceneTarget(name, scale) {
    return G.target('frame.' + name, W * scale, H * scale, { scale });
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
    const C = G.target('frame.C', W, H);
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
        G.draw(P.trans, { uA: RA, uB: RB, uKind: kind, uW: tr.w, uEdge: o.edge == null ? 0.03 : o.edge, uGold: o.gold || 0,
          uNScale: o.scale || 3, uOct: o.oct || 5, uLumaKey: o.lumaKey || 0 }, C);
      }
    }
    // 4 overlay (additive HDR) and gold-leaf caption entries
    const single = !A.transition;
    A.layers.forEach((L, i) => {
      const hdrEntries = caps[i].filter(isHDR);
      if (!L.scene.overlay && !hdrEntries.length) return;
      ctx.layer = L;
      const target = single ? C : G.target('frame.O', W, H);
      if (!single) G.clear(target, [0, 0, 0, 0]);
      if (L.scene.overlay) L.scene.overlay(ctx, L.tau, L.p, target);
      for (const e of hdrEntries) gold.drawText(target, text, e);
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
    post.run(C, pp, frame);                       // bloom ... grade, dither -> canvas
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
    gl: mods.G.gl, W, H, U: mods.G.U, portrait: PORTRAIT, layout: PORTRAIT ? 'portrait' : 'landscape',
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
