#!/usr/bin/env node
/*
 Per-scene frame-time profile of the version-2 film (SPEC 7.3 gate 1).
 For every scene: N frames spread over its window, R runs, timed end to end (seek + PNG capture over CDP, as render.js
 does). The page runs with ?profile=1, which adds gl.finish() between stages so that it can report
   content = scene render + transition + overlay (GPU time included),  post = post chain + captions + dither.
 Budgets (content): 450 ms ordinary, 1,100 ms for the hero scenes (forge-name, window).

 Usage: node engine/profile.js [--html film/v2/index.html] [--variant portrait] [--frames 10] [--runs 3]
                               [--scenes s01_forge_orbit,s02_forge_name] [--json out.json]
*/
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d; };
const html = path.resolve(opt('html', path.join(__dirname, '..', 'film', 'v2', 'index.html')));
const variant = opt('variant', 'landscape');
const nFrames = parseInt(opt('frames', '10'), 10);
const nRuns = parseInt(opt('runs', '3'), 10);
const only = opt('scenes', null);
const HERO = new Set(['s02_forge_name', 's06_window']);
const BUDGET = id => HERO.has(id) ? 1100 : 450;

const median = a => { const s = a.slice().sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

(async () => {
  const portrait = variant === 'portrait';
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('page error:', e.message));
  await page.goto('file://' + html + `?render=1&profile=1${portrait ? '&variant=portrait' : ''}`, { waitUntil: 'load' });
  await page.evaluate(() => window.filmReady);
  const cdp = await page.context().newCDPSession(page);
  const scenes = (await page.evaluate(() => window.FILM_DEBUG.scenes)).filter(s => !only || only.split(',').includes(s.id));
  const hdr = await page.evaluate(() => window.FILM_DEBUG.hdr);
  console.log(`profile ${variant}, ${nFrames} frames x ${nRuns} runs per scene, HDR format ${hdr}`);
  const rows = [];
  for (const s of scenes) {
    const times = Array.from({ length: nFrames }, (_, i) => s.t0 + (s.t1 - s.t0) * (i + 0.5) / nFrames);
    const content = [], post = [], cap = [], total = [];
    await page.evaluate(t => window.seek(t), times[0]);          // warm up (lazy textures, first-use compiles)
    for (let r = 0; r < nRuns; r++) {
      for (const t of times) {
        const a = Date.now();
        await page.evaluate(t => window.seek(t), t);
        const b = Date.now();
        await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, optimizeForSpeed: true });
        const c = Date.now();
        const tm = await page.evaluate(() => window.FILM_DEBUG.timings);
        content.push(tm.content); post.push(tm.post); cap.push(c - b); total.push(c - a);
      }
    }
    const row = { id: s.id, content: median(content), contentMax: Math.max(...content), post: median(post), capture: median(cap), total: median(total), budget: BUDGET(s.id) };
    row.ok = row.content <= row.budget;
    rows.push(row);
    console.log(`  ${s.id} done`);
  }
  await browser.close();
  const pad = (x, n) => String(x).padStart(n);
  console.log('\nscene                  content ms (med / max)   post ms   capture ms   frame ms   budget   status');
  for (const r of rows) {
    console.log(`${r.id.padEnd(22)} ${pad(r.content.toFixed(0), 8)} / ${pad(r.contentMax.toFixed(0), 5)}      ${pad(r.post.toFixed(0), 6)}   ${pad(r.capture.toFixed(0), 9)}   ${pad(r.total.toFixed(0), 8)}   ${pad(r.budget, 6)}   ${r.ok ? 'ok' : 'OVER'}`);
  }
  const tot = rows.reduce((a, r) => a + r.total, 0) / Math.max(1, rows.length);
  console.log(`\nmean frame time ${tot.toFixed(0)} ms -> about ${(tot * 5490 / 1000 / 60).toFixed(0)} min per layout on one worker`);
  if (opt('json', null)) fs.writeFileSync(path.resolve(opt('json')), JSON.stringify(rows, null, 1));
  process.exit(rows.every(r => r.ok) ? 0 : 2);
})().catch(e => { console.error(e); process.exit(1); });
