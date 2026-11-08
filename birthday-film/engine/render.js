#!/usr/bin/env node
/*
 Deterministic frame-by-frame renderer: HTML film -> MP4 (lossless RGB capture, one BT.709 conversion, overlay grain).

 The film page must expose window.FILM {duration,width,height}, window.filmReady (Promise) and window.seek(t).
 FILM.width/height are the PHYSICAL capture size: the viewport is sized to exactly that at deviceScaleFactor 1 (a smaller
 viewport would crop silently). Pages with an output scale (film/v2 ?res=N) also report FILM.res and the logical layout
 size FILM.frameWidth/frameHeight (width = frameWidth x res); render.js checks both against --res after loading.

 Usage:
   node render.js --html ../film/index.html --out ../private/out/film.mp4 --audio ../private/out/music.wav
        [--fps 30] [--workers 3] [--start 0] [--end 10] [--crf 19] [--preset slow] [--grain 0.16] [--variant portrait]
        [--tune film] [--maxrate 12M] [--bufsize 24M] [--abitrate 256k] [--master [path]] [--encode v2]
        [--segdir DIR [--chunks N] [--keep]]   resumable: finished chunks are skipped when the command is rerun
        [--res 2] [--segcodec hq10 [--segcrf 6]] [--grainres 0.333] [--level 5.1]   4K: output scale, 10-bit intermediate, grain size, H.264 level
        [--frames-only]   with --segdir and --keep: render the chunks and write list.txt, skip the final encode
   node render.js --html ... --stills 0,10.5,42 --outdir ../private/out/stills [--variant portrait] [--res 2]

 --encode v2 sets the version-2 delivery settings (SPEC 4.4): --workers 2 --crf 14 --preset slow --tune grain
   --maxrate 24M --bufsize 48M --abitrate 320k --grain 0.14 (any option given explicitly still wins).
 --res 2 renders the page at 2x the pixels per axis with the same layout (3840x2160, portrait 2160x3840): the page gets
   &res=2 and the workers inherit it. It defaults to --level 5.1 (2160x3840 = 32,400 macroblocks per frame, 972,000 per
   second at 30 fps: inside 5.1, invalid at 4.1), --maxrate 100M --bufsize 200M (a 24M VBV starves 4K grain),
   --workers 2 (memory: 2-4 GB per Chromium) and --grainres 1/3 (the HD grain size in frame px). These are applied before
   the --encode v2 preset, so they win over it; options given explicitly still win over both. Use --segcodec hq10 for
   4K chunks (lossless 4K chunks need about 35 GB for the film). --res 1 (the default) changes nothing.
 Workers are forked with --variant, --res, --segcodec and --segcrf forwarded; a resumable chunk's .done key records res,
   segcodec and segcrf only when they differ from the defaults, so HD keys are unchanged and 4K never reuses HD chunks.
 --master additionally writes a 10-bit HEVC master (x265, CRF 16, yuv420p10le, BT.709 tags) from the same lossless
   frames, to the given path or to <out>_master_hevc.mp4.
 Chromium is launched with --allow-file-access-from-files so that ES-module pages (film/v2) load from file://.
 window.seek(t) may return a Promise (version 2): page.evaluate awaits it before the capture.
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
// --res N: output scale (the page renders N times the frame pixels per axis, same layout); 1 = the HD frame
const resN = args.res == null ? 1 : Number(args.res);
if (resN !== 1 && resN !== 2) { console.error('--res must be 1 or 2'); process.exit(2); }
// 4K defaults (explicit options still win; set before the v2 preset so it cannot override them): H.264 level 5.1
// (2160x3840 = 32,400 macroblocks per frame), a VBV sized for 4K, two workers (memory)
if (resN > 1) for (const [k, v] of Object.entries({ level: '5.1', maxrate: '100M', bufsize: '200M', workers: '2' })) if (args[k] == null) args[k] = v;
const ENCODE_V2 = { workers: '2', crf: '14', preset: 'slow', tune: 'grain', maxrate: '24M', bufsize: '48M', abitrate: '320k', grain: '0.14' };
if (args.encode === 'v2') for (const k in ENCODE_V2) if (args[k] == null) args[k] = ENCODE_V2[k];
const fps = parseFloat(args.fps || '30');
const workers = parseInt(args.workers || String(Math.max(1, Math.min(3, os.cpus().length - 1))), 10);
const crf = args.crf || '19';
const preset = args.preset || 'slow';
const tune = args.tune || 'film';
const maxrate = args.maxrate || '12M';
const bufsize = args.bufsize || '24M';
const abitrate = args.abitrate || '256k';
const grain = args.grain == null ? 0.16 : parseFloat(args.grain);
// --grainres: grain noise resolution as a fraction of the output size (default 2/3 / res: the HD grain size in frame
// px at every output scale; 2/3/1 === 2/3 exactly)
const grainRes = args.grainres == null ? 2 / 3 / resN : parseFloat(args.grainres);
const resQ = resN !== 1 ? `&res=${resN}` : '';
const variantQ = (args.variant ? `&variant=${args.variant}` : '') + resQ;
// --segcodec lossless (default: libx264rgb qp 0) | hq10 (10-bit 4:4:4 x264 at --segcrf, default 6: visually lossless,
// far smaller, for 4K renders on a tight disk)
const segcodec = args.segcodec || 'lossless';
const segcrf = args.segcrf || '6';
const level = args.level || '4.1';

async function openFilm(html, width, height) {
  const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] });
  const page = await browser.newPage({ viewport: { width: width || 1920, height: height || 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', e => console.error('page error:', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('console:', m.text()); });
  await page.goto('file://' + path.resolve(html) + `?render=1&fps=${fps}${variantQ}`, { waitUntil: 'load' });
  await page.evaluate(() => window.filmReady);
  const film = await page.evaluate(() => window.FILM);
  if ((film.res || 1) !== resN) throw new Error(`page reports res ${film.res}, expected ${resN}`);
  if (film.frameWidth && (film.width !== film.frameWidth * (film.res || 1) || film.height !== film.frameHeight * (film.res || 1))) throw new Error('FILM size mismatch');
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
  const enc = segcodec === 'hq10'
    ? ['-vf', 'scale=out_color_matrix=bt709:out_range=pc:flags=accurate_rnd+full_chroma_int,format=yuv444p10le',
       '-c:v', 'libx264', '-profile:v', 'high444', '-crf', segcrf, '-preset', 'fast', '-g', '30',
       // bounded memory at 4K: default threads and lookahead cost about 5.5 GB per worker
       '-threads', '3', '-bf', '0', '-x264-params', 'rc-lookahead=10',  // no B-frames: every frame at the same quality
       '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'pc']
    : ['-c:v', 'libx264rgb', '-qp', '0', '-preset', 'ultrafast', '-g', '30'];
  const ff = spawn('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error',
    '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', 'pipe:0', ...enc, segPath], { stdio: ['pipe', 'inherit', 'inherit'] });
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
  console.log(`film ${width}x${height}${resN !== 1 ? ` (res ${resN})` : ''} ${film.duration}s; rendering frames ${f0}..${f1} (${total}) at ${fps} fps with ${workers} workers`);
  // --segdir DIR [--chunks N]: resumable rendering. Frames are split into N chunks rendered by a pool of `workers`;
  // each finished chunk leaves DIR/segNN.mkv plus a .done marker and is skipped when the same command is rerun.
  const resumable = !!args.segdir;
  const tmp = resumable ? path.resolve(args.segdir) : fs.mkdtempSync(path.join(os.tmpdir(), 'film-'));
  if (resumable) fs.mkdirSync(tmp, { recursive: true });
  const nChunks = resumable ? Math.max(workers, parseInt(args.chunks || String(workers * 4), 10)) : workers;
  const segs = [], jobs = []; const per = Math.ceil(total / nChunks);
  for (let i = 0; i < nChunks; i++) {
    const s = f0 + i * per, e = Math.min(f1, s + per); if (s >= e) break;
    const segPath = path.join(tmp, `seg${String(i).padStart(3, '0')}.mkv`); segs.push(segPath);
    const done = segPath + '.done';
    // the chunk key: fields beyond the HD ones only when non-default, so existing HD .done markers stay valid
    const keyO = { s, e, fps, width, height, variant: args.variant || '' };
    if (resN !== 1) keyO.res = resN;
    if (segcodec !== 'lossless') { keyO.segcodec = segcodec; keyO.segcrf = segcrf; }
    const key = JSON.stringify(keyO);
    if (resumable && fs.existsSync(done) && fs.readFileSync(done, 'utf8') === key && fs.existsSync(segPath)) { console.log(`chunk ${i} (${s}-${e}) already done, skipped`); continue; }
    jobs.push({ i, cfg: { html, start: s, end: e, fps, segPath, width, height, idx: i }, done, key });
  }
  // workers parse their own flags: forward everything that changes the page URL or the chunk encoding
  const fwd = []; for (const k of ['variant', 'res', 'segcodec', 'segcrf']) if (args[k] != null) fwd.push('--' + k, String(args[k]));
  const runJob = j => new Promise((res, rej) => {
    const p = fork(__filename, ['--worker', JSON.stringify(j.cfg), ...fwd, '--fps', String(fps)], { stdio: 'inherit' });
    p.on('exit', c => { if (c === 0) { if (resumable) fs.writeFileSync(j.done, j.key); res(); } else rej(new Error('worker ' + j.i + ' exit ' + c)); });
  });
  const queue = jobs.slice();
  const procs = Array.from({ length: Math.min(workers, queue.length) }, async () => { while (queue.length) await runJob(queue.shift()); });
  const t0 = Date.now(); await Promise.all(procs);
  console.log(`frames done in ${((Date.now() - t0) / 1000).toFixed(0)}s; final encode`);
  const list = path.join(tmp, 'list.txt'); fs.writeFileSync(list, segs.map(s => `file '${s}'`).join('\n'));
  // --frames-only: stop after the chunks (with --segdir/--keep) and leave the final encode to a separate step
  if (args['frames-only'] === 'true') { console.log('frames only: chunks and list.txt left in', tmp); return; }
  const dur = tEnd - tStart;
  const gw = Math.round(width * grainRes), gh = Math.round(height * grainRes);
  // hq10 segments are 10-bit 4:4:4 full-range BT.709 YUV; lossless segments are full-range RGB
  const inConv = segcodec === 'hq10' ? 'in_range=pc:in_color_matrix=bt709:' : 'in_range=pc:';
  function encode(outPath, hevc) {
    const ffArgs = ['-y', '-hide_banner', '-loglevel', 'warning', '-stats', '-f', 'concat', '-safe', '0', '-i', list];
    if (args.audio) ffArgs.push('-ss', String(tStart), '-i', path.resolve(args.audio));
    const pix = hevc ? 'yuv420p10le' : 'yuv420p';
    let fc = `[0:v]scale=${inConv}out_range=tv:out_color_matrix=bt709:flags=accurate_rnd+full_chroma_int,format=yuv444p[v]`;
    if (grain > 0) {
      ffArgs.push('-f', 'lavfi', '-i', `color=c=0x808080:s=${gw}x${gh}:r=${fps}`);
      const gi = args.audio ? 2 : 1;
      fc += `;[${gi}:v]format=yuv444p,lutyuv=y=128:u=128:v=128,noise=c0s=40:c0f=t,scale=${width}:${height}:flags=${grainRes < 0.5 ? 'bicubic' : 'bilinear'}[g];[v][g]blend=all_mode=overlay:all_opacity=${grain},format=${pix}[out]`;
    } else fc += `;[v]format=${pix}[out]`;
    ffArgs.push('-filter_complex', fc, '-map', '[out]');
    if (args.audio) ffArgs.push('-map', '1:a');
    if (hevc) {
      ffArgs.push('-c:v', 'libx265', '-preset', preset, '-crf', '16', '-profile:v', 'main10', '-tag:v', 'hvc1',
        '-x265-params', 'keyint=60:min-keyint=30:aq-mode=3:colorprim=bt709:transfer=bt709:colormatrix=bt709:range=limited:log-level=error');
    } else {
      ffArgs.push('-c:v', 'libx264', '-preset', preset, '-crf', crf, '-profile:v', 'high', '-level', level, '-tune', tune,
        '-maxrate', maxrate, '-bufsize', bufsize, '-x264-params', 'keyint=60:min-keyint=30:aq-mode=3:aq-strength=1.1:psy-rd=1.0,0.15');
    }
    ffArgs.push('-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-r', String(fps), '-movflags', '+faststart');
    if (args.audio) ffArgs.push('-c:a', 'aac', '-b:a', abitrate, '-ar', '48000', '-ac', '2');
    ffArgs.push('-t', String(dur), outPath);
    return new Promise((res, rej) => { const p = spawn('ffmpeg', ffArgs, { stdio: 'inherit' }); p.on('close', c => c === 0 ? res() : rej(new Error('final ffmpeg exit ' + c))); });
  }
  await encode(out, false);
  console.log('wrote', out);
  if (args.master) {
    const mpath = args.master === 'true' ? out.replace(/\.[a-z0-9]+$/i, '') + '_master_hevc.mp4' : path.resolve(args.master);
    console.log('writing 10-bit HEVC master');
    await encode(mpath, true);
    console.log('wrote', mpath);
  }
  if (!resumable || args.keep !== 'true') fs.rmSync(tmp, { recursive: true, force: true });
}
main().catch(e => { console.error(e); process.exit(1); });
