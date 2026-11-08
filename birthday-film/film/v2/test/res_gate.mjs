#!/usr/bin/env node
/*
  Output-scale (?res=N) gates for film/v2 (4K plan, gates A3 and B1).

  node film/v2/test/res_gate.mjs shaders --base <abs index.html> --new <abs index.html> --times a,b,... [--variant portrait]
    R=1 shader-source identity. Each page is opened at ?render=1 (res 1) with WebGL(2)RenderingContext.shaderSource
    hooked, every time is seeked (programs created lazily are included), and the source strings are compared as a
    multiset of md5. Every glsl.atRes(r1Text, hiText) edit must leave the R=1 text byte-identical, so the multisets must
    be equal (no compiler FMA or reassociation risk remains). Prints the counts; for each source present on one side only
    it prints its first 3 lines and the first differing line against the most similar source of the other side.
    Exit 1 when the multisets differ.

  node film/v2/test/res_gate.mjs smoke --html <abs index.html> --res N --times a,b,... [--variant portrait] [--nocapture]
    Asserts FILM.res === N and FILM.width/height === FILM.frameWidth/frameHeight x N (and the canvas backing store), then
    after every seek gl.getError() === 0 (FILM_DEBUG.ctx.gl), no page error or console error, and FILM_DEBUG.errors
    empty. Prints the ms per seek (JS issue time: window.seek ends with gl.finish, which only flushes in Chromium) and,
    unless --nocapture, the ms of a CDP capture of that frame (discarded; it waits for the GPU, so seek + capture is the
    real cost per frame) and the active scenes. Exit 1 on any failure.

  Chromium is launched like engine/render.js (--allow-file-access-from-files, deviceScaleFactor 1) and the viewport is
  resized to FILM.width x FILM.height (the physical capture size) after filmReady. Prints no page text.
*/
import { createRequire } from 'module';
import crypto from 'crypto';
import path from 'path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const argv = process.argv.slice(2);
const mode = argv[0];
const opt = k => { const i = argv.indexOf('--' + k); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : null; };
const variant = opt('variant') || 'landscape';
const portrait = variant === 'portrait';
const times = (opt('times') || '3.0').split(',').map(Number);
if (times.some(t => !Number.isFinite(t))) { console.error('bad --times'); process.exit(2); }
const md5 = s => crypto.createHash('md5').update(s).digest('hex');

async function open(html, res, { hookShaders = false } = {}) {
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const vp = portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
  const page = await browser.newPage({ viewport: vp, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/ERR_FILE_NOT_FOUND/.test(m.text())) errors.push('console: ' + m.text()); });
  if (hookShaders) {
    await page.addInitScript(() => {
      window.__SH = [];
      for (const C of [window.WebGL2RenderingContext, window.WebGLRenderingContext]) {
        if (!C) continue;
        const o = C.prototype.shaderSource;
        C.prototype.shaderSource = function (s, src) { window.__SH.push(String(src)); return o.call(this, s, src); };
      }
    });
  }
  const q = `?render=1${portrait ? '&variant=portrait' : ''}${res !== 1 ? '&res=' + res : ''}`;
  await page.goto('file://' + path.resolve(html) + q, { waitUntil: 'load' });
  await page.evaluate(() => window.filmReady);
  const film = await page.evaluate(() => window.FILM);
  if (film.width !== vp.width || film.height !== vp.height) await page.setViewportSize({ width: film.width, height: film.height });
  const cdp = await page.context().newCDPSession(page);
  return { browser, page, film, errors, cdp };
}

function mostSimilar(src, pool) {
  const a = src.split('\n'); const as = new Set(a);
  let best = null, bestScore = -1;
  for (const b of pool) {
    const bl = b.split('\n'); let score = 0;
    for (const l of bl) if (as.has(l)) score++;
    score -= Math.abs(bl.length - a.length) * 0.01;
    if (score > bestScore) { bestScore = score; best = b; }
  }
  return best;
}
function firstDiff(a, b) {
  const al = a.split('\n'), bl = b.split('\n');
  for (let i = 0; i < Math.max(al.length, bl.length); i++) if (al[i] !== bl[i]) return { line: i + 1, a: al[i], b: bl[i], prev: al[i - 1] };
  return null;
}
const head3 = s => s.split('\n').slice(0, 3).map(l => '      | ' + l).join('\n');

async function shaders() {
  const base = opt('base'), neu = opt('new');
  if (!base || !neu) { console.error('shaders needs --base and --new'); process.exit(2); }
  const side = {};
  for (const [name, html] of [['base', base], ['new', neu]]) {
    const f = await open(html, 1, { hookShaders: true });
    for (const t of times) await f.page.evaluate(t => window.seek(t), t);
    const srcs = await f.page.evaluate(() => window.__SH);
    const film = f.film; const errors = f.errors.slice();
    await f.browser.close();
    const counts = new Map(), bySum = new Map();
    for (const s of srcs) { const h = md5(s); counts.set(h, (counts.get(h) || 0) + 1); bySum.set(h, s); }
    side[name] = { srcs, counts, bySum, film, errors };
    console.log(`${name.padEnd(4)} ${html}  FILM ${film.width}x${film.height} res ${film.res ?? '(none)'}  ${srcs.length} shaderSource calls, ${counts.size} distinct sources${errors.length ? '  ERRORS: ' + errors.length : ''}`);
    for (const e of errors) console.log('     ', e);
  }
  const A = side.base, B = side.new;
  const onlyA = [], onlyB = [];
  for (const [h, n] of A.counts) { const m = B.counts.get(h) || 0; for (let i = m; i < n; i++) onlyA.push(h); }
  for (const [h, n] of B.counts) { const m = A.counts.get(h) || 0; for (let i = m; i < n; i++) onlyB.push(h); }
  const report = (label, list, own, other) => {
    const otherPool = [...new Set(list === onlyA ? onlyB : onlyA)].map(h => other.bySum.get(h));
    const pool = otherPool.length ? otherPool : [...other.bySum.values()];
    for (const h of new Set(list)) {
      const s = own.bySum.get(h); const n = list.filter(x => x === h).length;
      console.log(`  only in ${label} (x${n}) md5 ${h}, ${s.length} chars, first lines:\n${head3(s)}`);
      const sim = mostSimilar(s, pool);
      if (sim) { const d = firstDiff(s, sim); if (d) console.log(`    first difference vs the most similar source of the other side (md5 ${md5(sim)}), line ${d.line}${d.prev != null ? ' (after ' + JSON.stringify(d.prev) + ')' : ''}:\n      ${label}: ${JSON.stringify(d.a)}\n      other: ${JSON.stringify(d.b)}`); }
    }
  };
  report('base', onlyA, A, B);
  report('new', onlyB, B, A);
  const ok = !onlyA.length && !onlyB.length && !A.errors.length && !B.errors.length;
  console.log(ok
    ? `PASS: identical shader-source multisets (${A.srcs.length} sources, ${A.counts.size} distinct; ${variant}, ${times.length} times)`
    : `FAIL: ${onlyA.length} base-only and ${onlyB.length} new-only sources${A.errors.length + B.errors.length ? ', page errors' : ''}`);
  process.exit(ok ? 0 : 1);
}

async function smoke() {
  const html = opt('html'); const res = Number(opt('res') || '1');
  if (!html) { console.error('smoke needs --html'); process.exit(2); }
  if (res !== 1 && res !== 2) { console.error('--res must be 1 or 2'); process.exit(2); }
  const fails = [];
  const t0 = Date.now();
  const f = await open(html, res);
  const bootMs = Date.now() - t0;
  const film = f.film;
  console.log(`FILM ${JSON.stringify(film)}  (boot ${bootMs} ms, ${variant})`);
  if (film.res !== res) fails.push(`FILM.res ${film.res} !== ${res}`);
  if (film.width !== film.frameWidth * res || film.height !== film.frameHeight * res) fails.push(`FILM ${film.width}x${film.height} is not ${film.frameWidth}x${film.frameHeight} x ${res}`);
  const expect = portrait ? [1080, 1920] : [1920, 1080];
  if (film.frameWidth !== expect[0] || film.frameHeight !== expect[1]) fails.push(`frame size ${film.frameWidth}x${film.frameHeight}, expected ${expect.join('x')}`);
  const dbg = await f.page.evaluate(() => ({ res: window.FILM_DEBUG.res, cw: document.getElementById('gl').width, ch: document.getElementById('gl').height, err0: window.FILM_DEBUG.ctx.gl.getError(), errors: window.FILM_DEBUG.errors.slice() }));
  if (dbg.cw !== film.width || dbg.ch !== film.height) fails.push(`canvas backing store ${dbg.cw}x${dbg.ch} !== FILM ${film.width}x${film.height}`);
  if (dbg.err0 !== 0) fails.push(`gl error 0x${dbg.err0.toString(16)} after boot`);
  if (dbg.errors.length) fails.push(`FILM_DEBUG.errors after boot: ${dbg.errors.length}`);
  if (f.errors.length) fails.push(`page/console errors after boot: ${f.errors.join(' | ')}`);
  let nErr = f.errors.length;
  const capture = !argv.includes('--nocapture');
  let sumFrame = 0;
  for (const t of times) {
    const s0 = Date.now();
    await f.page.evaluate(t => window.seek(t), t);
    const ms = Date.now() - s0;
    let cap = '';
    if (capture) {
      const c0 = Date.now();
      const { data } = await f.cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, optimizeForSpeed: true });
      const cms = Date.now() - c0; sumFrame += ms + cms;
      const png = Buffer.from(data, 'base64');
      const pw = png.readUInt32BE(16), ph = png.readUInt32BE(20);
      if (pw !== film.width || ph !== film.height) fails.push(`t=${t}: capture ${pw}x${ph} !== FILM ${film.width}x${film.height}`);
      cap = `  capture ${String(cms).padStart(5)} ms ${pw}x${ph}`;
    }
    const r = await f.page.evaluate(t => {
      const D = window.FILM_DEBUG; const e = D.ctx.gl.getError(); const A = D.activeAt(t);
      return { e, n: D.errors.length, ids: A.layers.map(L => L.id).join('+'), tr: A.transition ? String(A.transition.kind ?? 'transition') : '' };
    }, t);
    const ids = r.ids + (r.tr ? ` [${r.tr}]` : '');
    const bad = [];
    if (r.e !== 0) bad.push(`gl error 0x${r.e.toString(16)}`);
    if (r.n) bad.push(`FILM_DEBUG.errors ${r.n}`);
    if (f.errors.length > nErr) { bad.push(`page/console errors: ${f.errors.slice(nErr).join(' | ')}`); nErr = f.errors.length; }
    console.log(`t=${t.toFixed(2).padStart(7)}  seek ${String(ms).padStart(5)} ms${cap}  ${ids}${bad.length ? '  FAIL: ' + bad.join('; ') : ''}`);
    for (const b of bad) fails.push(`t=${t}: ${b}`);
  }
  await f.browser.close();
  if (capture) console.log(`mean seek + capture: ${(sumFrame / times.length / 1000).toFixed(2)} s per frame`);
  console.log(fails.length ? `FAIL (${fails.length}):\n  ` + fails.join('\n  ') : `PASS: res ${res} ${variant} ${film.width}x${film.height}, ${times.length} seeks, gl.getError() 0, no errors`);
  process.exit(fails.length ? 1 : 0);
}

if (mode === 'shaders') await shaders();
else if (mode === 'smoke') await smoke();
else { console.error('usage: res_gate.mjs shaders --base <html> --new <html> --times ... [--variant portrait]\n       res_gate.mjs smoke --html <html> --res N --times ... [--variant portrait]'); process.exit(2); }
