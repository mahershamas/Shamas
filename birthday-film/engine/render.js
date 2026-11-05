#!/usr/bin/env node
/*
 Deterministic frame-by-frame renderer: HTML film -> MP4 (lossless RGB capture, one BT.709 conversion, overlay grain).

 The film page must expose window.FILM {duration,width,height}, window.filmReady (Promise) and window.seek(t).

 Usage:
   node render.js --html ../film/index.html --out ../private/out/film.mp4 --audio ../private/out/music.wav
        [--fps 30] [--workers 3] [--start 0] [--end 10] [--crf 19] [--preset slow] [--grain 0.16] [--variant portrait]
   node render.js --html ... --stills 0,10.5,42 --outdir ../private/out/stills [--variant portrait]
*/
const { chromium } = require('playwright');
const { spawn, fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function parseArgs() {
  const a = {}; const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) { const k = argv[i].slice(2); const v = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true'; a[k] = v; }
  }
  return a;
}
const args = parseArgs();
const fps = parseFloat(args.fps || '30');
const workers = parseInt(args.workers || String(Math.max(1, Math.min(3, os.cpus().length - 1))), 10);
const crf = args.crf || '19';
const preset = args.preset || 'slow';
const grain = args.grain == null ? 0.16 : parseFloat(args.grain);
const variantQ = args.variant ? `&variant=${args.variant}` : '';

async function openFilm(html, width, height) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: width || 1920, height: height || 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('page error:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto('file://' + path.resolve(html) + `?render=1&fps=${fps}${variantQ}`, { waitUntil: 'load' });
  await page.evaluate(() => window.filmReady);
  const film = await page.evaluate(() => window.FILM);
  if (!width && (film.width !== 1920 || film.height !== 1080)) {
    await page.setViewportSize({ width: film.width, height: film.height });
  }
  const cdp = await page.context().newCDPSession(page);
  return { browser, page, film, cdp };
}
async function capturePng(cdp) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, optimizeForSpeed: true });
  return Buffer.from(data, 'base64');
}

async function runWorker({ html, start, end, fps, segPath, width, height, idx }) {
  const { browser, page, cdp } = await openFilm(html, width, height);
  const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', 'pipe:0',
    '-c:v', 'libx264rgb', '-qp', '0', '-preset', 'ultrafast', '-g', '30', segPath], { stdio: ['pipe', 'inherit', 'inherit'] });
  const frames = end - start; const t0 = Date.now();
  for (let f = start; f < end; f++) {
    await page.evaluate(t => window.seek(t), f / fps);
    const buf = await capturePng(cdp);
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    const done = f - start + 1;
    if (done % 150 === 0 || done === frames) {
      const el = (Date.now() - t0) / 1000;
      console.log(`[w${idx}] ${done}/${frames} frames  ${(el / done * 1000).toFixed(0)} ms/frame  eta ${((frames - done) * el / done).toFixed(0)}s`);
    }
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg seg exit ' + c))));
  await browser.close();
}

async function main() {
  if (args.worker) { await runWorker(JSON.parse(args.worker)); return; }
  const html = path.resolve(args.html);
  const { browser, page, film, cdp } = await openFilm(html);
  if (args.stills) {
    const outdir = path.resolve(args.outdir || 'stills'); fs.mkdirSync(outdir, { recursive: true });
    for (const ts of args.stills.split(',')) {
      const t = parseFloat(ts);
      await page.evaluate(t => window.seek(t), t);
      fs.writeFileSync(path.join(outdir, `still_${t.toFixed(2).replace('.', '_')}.png`), await capturePng(cdp));
    }
    await browser.close(); console.log('stills written to', outdir); return;
  }
  await browser.close();
  const out = path.resolve(args.out); fs.mkdirSync(path.dirname(out), { recursive: true });
  const width = film.width || 1920, height = film.height || 1080;
  const tStart = parseFloat(args.start || '0'), tEnd = parseFloat(args.end || String(film.duration));
  const f0 = Math.round(tStart * fps), f1 = Math.round(tEnd * fps), total = f1 - f0;
  console.log(`film ${width}x${height} ${film.duration}s; rendering frames ${f0}..${f1} (${total}) at ${fps} fps with ${workers} workers`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'film-'));
  const segs = [], procs = []; const per = Math.ceil(total / workers);
  for (let i = 0; i < workers; i++) {
    const s = f0 + i * per, e = Math.min(f1, s + per); if (s >= e) break;
    const segPath = path.join(tmp, `seg${String(i).padStart(2, '0')}.mkv`); segs.push(segPath);
    const cfg = { html, start: s, end: e, fps, segPath, width, height, idx: i };
    procs.push(new Promise((res, rej) => { const p = fork(__filename, ['--worker', JSON.stringify(cfg), ...(args.variant ? ['--variant', args.variant] : []), '--fps', String(fps)], { stdio: 'inherit' }); p.on('exit', c => c === 0 ? res() : rej(new Error('worker ' + i + ' exit ' + c))); }));
  }
  const t0 = Date.now(); await Promise.all(procs);
  console.log(`frames done in ${((Date.now() - t0) / 1000).toFixed(0)}s; final encode`);
  const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, segs.map(s => `file '${s}'`).join('\n'));
  const dur = tEnd - tStart;
  const ffArgs = ['-y', '-hide_banner', '-loglevel', 'warning', '-stats', '-f', 'concat', '-safe', '0', '-i', list];
  if (args.audio) ffArgs.push('-ss', String(tStart), '-i', path.resolve(args.audio));
  const gw = Math.round(width * 2 / 3), gh = Math.round(height * 2 / 3);
  let fc = `[0:v]scale=in_range=pc:out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv444p[v]`;
  if (grain > 0) {
    ffArgs.push('-f', 'lavfi', '-i', `color=c=0x808080:s=${gw}x${gh}:r=${fps}`);
    const gi = args.audio ? 2 : 1;
    fc += `;[${gi}:v]format=yuv444p,lutyuv=y=128:u=128:v=128,noise=c0s=40:c0f=t,scale=${width}:${height}:flags=bilinear[g];[v][g]blend=all_mode=overlay:all_opacity=${grain},format=yuv420p[out]`;
  } else fc += `;[v]format=yuv420p[out]`;
  ffArgs.push('-filter_complex', fc, '-map', '[out]');
  if (args.audio) ffArgs.push('-map', '1:a');
  ffArgs.push('-c:v', 'libx264', '-preset', preset, '-crf', crf, '-profile:v', 'high', '-level', '4.1', '-tune', 'film',
    '-maxrate', '12M', '-bufsize', '24M', '-x264-params', 'keyint=60:min-keyint=30:aq-mode=3:aq-strength=1.1:psy-rd=1.0,0.15',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-r', String(fps), '-movflags', '+faststart');
  if (args.audio) ffArgs.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2');
  ffArgs.push('-t', String(dur), out);
  await new Promise((res, rej) => { const p = spawn('ffmpeg', ffArgs, { stdio: 'inherit' }); p.on('close', c => c === 0 ? res() : rej(new Error('final ffmpeg exit ' + c))); });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('wrote', out);
}
main().catch(e => { console.error(e); process.exit(1); });
