#!/usr/bin/env node
/*
 Deterministic frame-by-frame renderer: HTML film -> MP4.

 The film page must expose:
   window.FILM = { duration: <seconds>, width, height }
   window.filmReady  : Promise that resolves when fonts/images are loaded
   window.seek(t)    : synchronously lays out the frame for time t (seconds)

 Usage:
   node render.js --html ../film/index.html --out ../private/out/film.mp4 \
        --audio ../private/out/music.wav [--fps 30] [--workers 3] [--quality 95]
        [--start 0] [--end 10] [--crf 17] [--preset slow] [--scale 1]
*/
const { chromium } = require('playwright');
const { spawn, fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

function parseArgs() {
  const a = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const v = (i + 1 < argv.length && !argv[i + 1].startsWith('--')) ? argv[++i] : 'true';
      a[k] = v;
    }
  }
  return a;
}
const args = parseArgs();
const fps = parseFloat(args.fps || '30');
const workers = parseInt(args.workers || String(Math.max(1, Math.min(3, os.cpus().length - 1))), 10);
const quality = parseInt(args.quality || '95', 10);
const crf = args.crf || '17';
const preset = args.preset || 'slow';
const scale = parseFloat(args.scale || '1');

async function runWorker({ html, start, end, fps, segPath, width, height, quality, idx, total }) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error(`[w${idx}] page error:`, e.message));
  page.on('console', m => { if (m.type() === 'error') console.error(`[w${idx}] console:`, m.text()); });
  await page.goto('file://' + path.resolve(html) + `?render=1&fps=${fps}`, { waitUntil: 'load' });
  await page.evaluate(() => window.filmReady);
  const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', 'pipe:0',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '10', '-pix_fmt', 'yuv444p', '-g', '30',
    segPath], { stdio: ['pipe', 'inherit', 'inherit'] });
  const frames = end - start;
  const t0 = Date.now();
  for (let f = start; f < end; f++) {
    const t = f / fps;
    await page.evaluate(t => window.seek(t), t);
    const buf = await page.screenshot({ type: 'jpeg', quality, animations: 'disabled', caret: 'hide', scale: 'css' });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    const done = f - start + 1;
    if (done % 100 === 0 || done === frames) {
      const el = (Date.now() - t0) / 1000;
      console.log(`[w${idx}] ${done}/${frames} frames  ${(el / done * 1000).toFixed(0)} ms/frame  eta ${((frames - done) * el / done).toFixed(0)}s`);
    }
  }
  ff.stdin.end();
  await new Promise((res, rej) => ff.on('close', c => c === 0 ? res() : rej(new Error('ffmpeg seg exit ' + c))));
  await browser.close();
}

async function main() {
  if (args.worker) {
    const cfg = JSON.parse(args.worker);
    await runWorker(cfg);
    return;
  }
  const html = path.resolve(args.html);
  const out = path.resolve(args.out);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  // read duration/size from the page
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('file://' + html + '?render=1', { waitUntil: 'load' });
  await page.evaluate(() => window.filmReady);
  const film = await page.evaluate(() => window.FILM);
  await browser.close();
  const width = Math.round((film.width || 1920) * scale), height = Math.round((film.height || 1080) * scale);
  const tStart = parseFloat(args.start || '0');
  const tEnd = parseFloat(args.end || String(film.duration));
  const f0 = Math.round(tStart * fps), f1 = Math.round(tEnd * fps);
  const total = f1 - f0;
  console.log(`film ${width}x${height} ${film.duration}s; rendering frames ${f0}..${f1} (${total}) at ${fps} fps with ${workers} workers`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'film-'));
  const segs = [];
  const per = Math.ceil(total / workers);
  const procs = [];
  for (let i = 0; i < workers; i++) {
    const s = f0 + i * per, e = Math.min(f1, s + per);
    if (s >= e) break;
    const segPath = path.join(tmp, `seg${String(i).padStart(2, '0')}.mp4`);
    segs.push(segPath);
    const cfg = { html, start: s, end: e, fps, segPath, width, height, quality, idx: i, total };
    procs.push(new Promise((res, rej) => {
      const p = fork(__filename, ['--worker', JSON.stringify(cfg)], { stdio: 'inherit' });
      p.on('exit', c => c === 0 ? res() : rej(new Error('worker ' + i + ' exit ' + c)));
    }));
  }
  const t0 = Date.now();
  await Promise.all(procs);
  console.log(`frames done in ${((Date.now() - t0) / 1000).toFixed(0)}s; concatenating + final encode`);
  const list = path.join(tmp, 'list.txt');
  fs.writeFileSync(list, segs.map(s => `file '${s}'`).join('\n'));
  const ffArgs = ['-y', '-hide_banner', '-loglevel', 'warning', '-stats', '-f', 'concat', '-safe', '0', '-i', list];
  if (args.audio) ffArgs.push('-ss', String(tStart), '-i', path.resolve(args.audio));
  // film grain is added here (cheap and temporally correct) instead of in the browser
  const grain = parseFloat(args.grain || '0');
  if (grain > 0) ffArgs.push('-vf', `noise=c0s=${grain}:c0f=t+u:c1s=${(grain * 0.35).toFixed(1)}:c1f=t+u:c2s=${(grain * 0.35).toFixed(1)}:c2f=t+u`);
  ffArgs.push('-c:v', 'libx264', '-preset', preset, '-crf', crf, '-profile:v', 'high', '-level', '4.1', '-tune', 'film',
    '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-x264-params', 'keyint=120:min-keyint=30:aq-mode=3:aq-strength=1.1:deblock=-1,-1:psy-rd=1.0,0.15',
    '-r', String(fps), '-movflags', '+faststart');
  if (args.audio) ffArgs.push('-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-af', 'aresample=48000', '-shortest');
  ffArgs.push('-t', String(tEnd - tStart), out);
  await new Promise((res, rej) => {
    const p = spawn('ffmpeg', ffArgs, { stdio: 'inherit' });
    p.on('close', c => c === 0 ? res() : rej(new Error('final ffmpeg exit ' + c)));
  });
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('wrote', out);
}
main().catch(e => { console.error(e); process.exit(1); });
