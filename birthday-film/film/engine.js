/* Deterministic film engine: everything on screen is a pure function of time t.
   The page loads a SCRIPT (window.SCRIPT) describing layers; window.seek(t) lays out the frame.
   Bokeh and light are drawn on one 2D canvas; film grain is added by ffmpeg in the final pass. */
(function () {
  'use strict';
  const S = window.SCRIPT;
  const W = S.width || 1920, H = S.height || 1080;
  const U = Math.min(W, H) / 1080;
  const PORTRAIT = H > W;
  window.FILM = { duration: S.duration, width: W, height: H };

  const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
  const lerp = (a, b, p) => a + (b - a) * p;
  const E = {
    linear: p => p,
    inOut: p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2,
    out: p => 1 - Math.pow(1 - p, 3),
    in: p => p * p * p,
    inQuad: p => p * p,
    outExpo: p => p >= 1 ? 1 : 1 - Math.pow(2, -10 * p),
    outQuint: p => 1 - Math.pow(1 - p, 5),
    inOutSine: p => -(Math.cos(Math.PI * p) - 1) / 2,
    smooth: p => p * p * (3 - 2 * p),
  };
  const seg = (t, a, b) => clamp01((t - a) / Math.max(1e-6, b - a));
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  const rnd = mulberry32(S.seed || 20231203);
  function env(t, start, inDur, hold, outDur, ein = E.out, eout = E.inOutSine) {
    if (t < start) return 0;
    const a = seg(t, start, start + inDur);
    if (a < 1) return ein(a);
    const o = seg(t, start + inDur + hold, start + inDur + hold + outDur);
    return 1 - eout(o);
  }
  window.FILM_UTILS = { E, seg, env, clamp01, lerp, W, H, U, PORTRAIT };

  // ---------- DOM scaffold (z-order: bg, photos, fx canvas, text, vignette, fade)
  const root = document.getElementById('film');
  root.style.width = W + 'px'; root.style.height = H + 'px';
  const mk = (cls, parent = root, tag = 'div') => { const d = document.createElement(tag); d.className = cls; parent.appendChild(d); return d; };
  const bg = mk('bg');
  const photoLayer = mk('photos');
  const fxCanvas = mk('fxc', root, 'canvas'); fxCanvas.width = W; fxCanvas.height = H;
  const fx = fxCanvas.getContext('2d');
  const textLayer = mk('text');
  const vignette = mk('vignette');
  const fade = mk('fade');

  // ---------- bokeh (largest discs dimmest, like real defocused highlights)
  const BOKEH = [];
  (function makeBokeh() {
    const n = S.bokehCount == null ? 40 : S.bokehCount;
    for (let i = 0; i < n; i++) {
      const depth = rnd();
      const size = (6 + 110 * Math.pow(rnd(), 1.8)) * U * (0.5 + depth);
      const kind = rnd();
      let r = 255, g, b;
      if (kind < 0.72) { g = 196 + Math.floor(rnd() * 40); b = 120 + Math.floor(rnd() * 60); }
      else if (kind < 0.92) { g = 236; b = 215; }
      else { r = 150; g = 190; b = 255; }
      const base = Math.min(0.35, Math.max(0.05, 0.30 * Math.pow(18 * U / size, 0.6))) * (kind >= 0.92 ? 0.45 : 1);
      BOKEH.push({ x: rnd(), y: rnd(), size, depth, base, speed: (0.003 + rnd() * 0.010) * (0.4 + depth), phase: rnd() * Math.PI * 2, tw: 0.25 + rnd() * 0.7, drift: (rnd() - .5) * 0.03, r, g, b });
    }
  })();
  function drawFx(t) {
    fx.clearRect(0, 0, W, H);
    fx.globalCompositeOperation = 'lighter';
    const leakA = (S.leak ? S.leak(t) : 0.5) * (0.75 + 0.25 * Math.sin(t * 0.23));
    if (leakA > 0.001) {
      const lx = W * (0.72 + 0.12 * Math.sin(t * 0.05)), ly = H * (0.3 + 0.12 * Math.cos(t * 0.04));
      const g = fx.createRadialGradient(lx, ly, 0, lx, ly, W * 0.55);
      g.addColorStop(0, `rgba(255,150,90,${(0.22 * leakA).toFixed(3)})`); g.addColorStop(0.45, `rgba(255,110,80,${(0.07 * leakA).toFixed(3)})`); g.addColorStop(1, 'rgba(255,110,80,0)');
      fx.fillStyle = g; fx.fillRect(0, 0, W, H);
      const lx2 = W * (0.15 + 0.1 * Math.cos(t * 0.037)), ly2 = H * (0.85 + 0.08 * Math.sin(t * 0.051));
      const g2 = fx.createRadialGradient(lx2, ly2, 0, lx2, ly2, W * 0.4);
      g2.addColorStop(0, `rgba(200,90,110,${(0.14 * leakA).toFixed(3)})`); g2.addColorStop(1, 'rgba(200,90,110,0)');
      fx.fillStyle = g2; fx.fillRect(0, 0, W, H);
    }
    const bokehA = S.bokehAlpha ? S.bokehAlpha(t) : 1;
    if (bokehA > 0.001) {
      for (const b of BOKEH) {
        const y = (((b.y - t * b.speed) % 1) + 1) % 1;
        const x = (((b.x + t * b.drift * 0.1 + 0.02 * Math.sin(t * 0.3 + b.phase)) % 1) + 1) % 1;
        const tw = 0.55 + 0.45 * Math.sin(t * b.tw + b.phase);
        const a = b.base * tw * bokehA;
        const cx = x * W, cy = y * H * 1.2 - H * 0.1, r = b.size;
        const g = fx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const col = `${b.r},${b.g},${b.b}`;
        if (r > 60 * U) { g.addColorStop(0, `rgba(${col},${(a * 0.75).toFixed(3)})`); g.addColorStop(0.80, `rgba(${col},${a.toFixed(3)})`); g.addColorStop(0.92, `rgba(${col},${(a * 0.5).toFixed(3)})`); g.addColorStop(1, `rgba(${col},0)`); }
        else { g.addColorStop(0, `rgba(${col},${a.toFixed(3)})`); g.addColorStop(0.6, `rgba(${col},${(a * 0.85).toFixed(3)})`); g.addColorStop(1, `rgba(${col},0)`); }
        fx.fillStyle = g; fx.beginPath(); fx.arc(cx, cy, r, 0, Math.PI * 2); fx.fill();
      }
    }
    fx.globalCompositeOperation = 'source-over';
    if (S.drawExtra) S.drawExtra(fx, t, { W, H, U, E, seg, env, clamp01, lerp });
  }

  // ---------- text
  const SIZES = { script: 150, serif: 60, italic: 60, caps: 30, display: 92, small: 40 };
  const TEXT = S.lines.map((L) => {
    const el = mk('line ' + (L.style || 'serif') + (L.wrap ? ' wrap' : ''), textLayer);
    el.style.display = 'none';
    const size = (L.size || 1) * U;
    el.style.fontSize = Math.round(SIZES[L.style || 'serif'] * size) + 'px';
    el.style.left = ((L.x == null ? 0.5 : L.x) * 100) + '%';
    el.style.top = ((L.y == null ? 0.5 : L.y) * 100) + '%';
    const anchor = L.anchor || 'center';
    el.dataset.anchor = anchor;
    if (L.width) el.style.width = (L.width * 100) + '%';
    el.style.textAlign = L.align || (anchor === 'left' ? 'left' : anchor === 'right' ? 'right' : 'center');
    if (L.color) el.style.color = L.color;
    if (L.opacity != null) el.style.setProperty('--maxo', L.opacity);
    if (L.lineHeight) el.style.lineHeight = L.lineHeight;
    if (L.shadow) el.style.textShadow = `0 2px ${12 * U}px rgba(0,0,0,0.7), 0 0 ${40 * U}px rgba(0,0,0,0.5)`;
    const parts = [], html = [];
    const unit = L.stagger || 'word';
    const text = L.text;
    if (unit === 'char') {
      for (const ch of text) html.push(ch === '\n' ? '<br>' : `<span class="u">${ch === ' ' ? '&nbsp;' : ch}</span>`);
    } else if (unit === 'word') {
      text.split('\n').forEach((lineTxt, li) => {
        if (li) html.push('<br>');
        lineTxt.split(' ').forEach((w, wi) => { if (wi) html.push(' '); html.push(`<span class="u">${w}</span>`); });
      });
    } else html.push(text.replace(/\n/g, '<br>'));
    el.innerHTML = html.join('');
    el.querySelectorAll('.u').forEach(u => parts.push(u));
    const inDur = L.in == null ? 1.4 : L.in, outDur = L.out == null ? 0.9 : L.out;
    return { L, el, parts, inDur, outDur, start: L.t, end: L.t + inDur + L.hold + outDur, lastState: '', maxo: L.opacity == null ? 1 : L.opacity };
  });
  const anchorTx = { center: 'translate(-50%, -50%)', left: 'translate(0, -50%)', right: 'translate(-100%, -50%)' };

  // ---------- photo shots (all motion through transforms)
  const IMG = {};
  const SHOTS = (S.shots || []).map(sh => {
    const wrap = mk('shot' + (sh.frame ? ' framed' : ''), photoLayer);
    wrap.style.display = 'none';
    const inner = mk('shot-inner', wrap);
    const img = document.createElement('img'); img.src = sh.src; inner.appendChild(img);
    IMG[sh.src] = img;
    const grade = mk('grade', inner);
    const cool = mk('cool', inner);
    const sweep = mk('sweep', inner);
    const scrim = mk('scrim', inner);
    return { sh, wrap, inner, img, grade, cool, sweep, scrim, base: null };
  });
  function interpKeys(keys, t) {
    if (t <= keys[0].t) return keys[0];
    if (t >= keys[keys.length - 1].t) return keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      const a = keys[i], b = keys[i + 1];
      if (t >= a.t && t <= b.t) {
        const p = (b.ease ? E[b.ease] : E.inOutSine)(seg(t, a.t, b.t));
        const o = {};
        for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) {
          const va = a[key], vb = b[key];
          o[key] = (typeof va === 'number' && typeof vb === 'number') ? lerp(va, vb, p) : (vb == null ? va : vb);
        }
        return o;
      }
    }
    return keys[keys.length - 1];
  }
  for (const s of SHOTS) {          // carry forward values set on earlier keyframes
    const acc = {};
    for (const k of s.sh.keys) { for (const key of Object.keys(k)) if (key !== 'ease') acc[key] = k[key]; for (const key of Object.keys(acc)) if (k[key] == null) k[key] = acc[key]; }
  }
  function layoutShotBase(s) {
    const k0 = s.sh.keys[0];
    const iw = s.img.naturalWidth || 1448, ih = s.img.naturalHeight || 1086;
    const w0 = k0.w || (PORTRAIT ? 0.92 : 0.62);
    const boxW = w0 * W, boxH = boxW * ih / iw;
    const cx0 = (k0.x == null ? 0.5 : k0.x) * W, cy0 = (k0.y == null ? 0.5 : k0.y) * H;
    s.base = { w0, boxW, boxH, cx0, cy0 };
    s.wrap.style.left = (cx0 - boxW / 2).toFixed(1) + 'px'; s.wrap.style.top = (cy0 - boxH / 2).toFixed(1) + 'px';
    s.wrap.style.width = boxW.toFixed(1) + 'px'; s.wrap.style.height = boxH.toFixed(1) + 'px';
  }

  // ---------- main seek
  window.seek = function (t) {
    const g1x = 50 + 8 * Math.sin(t * 0.07), g1y = 58 + 6 * Math.cos(t * 0.05);
    const g2x = 30 + 10 * Math.sin(t * 0.045 + 2), g2y = 30 + 8 * Math.cos(t * 0.06 + 1);
    const warmth = S.bgWarmth ? S.bgWarmth(t) : 1;
    bg.style.background = `radial-gradient(ellipse 70% 60% at ${g1x.toFixed(2)}% ${g1y.toFixed(2)}%, rgba(110,46,52,${(0.55 * warmth).toFixed(3)}) 0%, rgba(110,46,52,0) 70%),` +
      `radial-gradient(ellipse 60% 55% at ${g2x.toFixed(2)}% ${g2y.toFixed(2)}%, rgba(140,88,40,${(0.35 * warmth).toFixed(3)}) 0%, rgba(140,88,40,0) 70%),` +
      `linear-gradient(180deg, #16090c 0%, #0b0507 100%)`;

    for (const s of SHOTS) {
      const sh = s.sh;
      if (t < sh.start || t > sh.end) { s.wrap.style.display = 'none'; continue; }
      if (!s.base) layoutShotBase(s);
      s.wrap.style.display = 'block';
      const k = interpKeys(sh.keys, t);
      const B = s.base;
      const w = k.w || B.w0;
      const cx = (k.x == null ? 0.5 : k.x) * W, cy = (k.y == null ? 0.5 : k.y) * H;
      const breathe = sh.breathe == null ? 0.012 : sh.breathe;
      const sc = (k.scale == null ? 1 : k.scale) * (1 + breathe * (0.5 + 0.5 * Math.sin((t - sh.start) * 0.13)));
      const inD = sh.in == null ? 2 : sh.in, outD = sh.out == null ? 2 : sh.out;
      const op = (k.opacity == null ? 1 : k.opacity) * env(t, sh.start, inD, (sh.end - sh.start) - inD - outD, outD, E.out, E.inOutSine);
      s.wrap.style.opacity = op.toFixed(3);
      s.wrap.style.transform = `translate(${(cx - B.cx0).toFixed(2)}px, ${(cy - B.cy0).toFixed(2)}px) scale(${(w / B.w0).toFixed(4)})`;
      s.inner.style.transform = `scale(${sc.toFixed(4)}) translate(${((k.px || 0) * B.boxW).toFixed(2)}px, ${((k.py || 0) * B.boxH).toFixed(2)}px) rotate(${(k.rot || 0).toFixed(3)}deg)`;
      const blur = k.blur || 0, bright = k.bright == null ? 1 : k.bright, sat = k.sat == null ? 1 : k.sat, sep = k.sepia || 0, con = k.contrast == null ? 1 : k.contrast;
      s.img.style.filter = (blur > 0.05 || bright !== 1 || sat !== 1 || sep > 0 || con !== 1) ? `blur(${(blur * U).toFixed(2)}px) brightness(${bright.toFixed(3)}) saturate(${sat.toFixed(3)}) sepia(${sep.toFixed(3)}) contrast(${con.toFixed(3)})` : 'none';
      s.grade.style.opacity = (k.grade == null ? 0.3 : k.grade).toFixed(3);
      s.cool.style.opacity = (k.cool == null ? 0.6 : k.cool).toFixed(3);
      s.scrim.style.opacity = (k.scrim == null ? 0 : k.scrim).toFixed(3);
      const sw = k.sweep == null ? null : k.sweep - Math.floor(k.sweep);   // integer steps restart the sweep
      if (sw != null && sw > 0.002 && sw < 0.998) {
        s.sweep.style.display = 'block';
        s.sweep.style.transform = `translateX(${((sw * 2 - 1) * 130).toFixed(1)}%) skewX(-18deg)`;
        s.sweep.style.opacity = (Math.sin(sw * Math.PI) * 0.55).toFixed(3);
      } else s.sweep.style.display = 'none';
      const feather = k.feather == null ? 0 : k.feather;
      if (sh.frame || feather <= 0.001) { s.wrap.style.webkitMaskImage = s.wrap.style.maskImage = 'none'; }
      else {
        const inner = 100 - 72 * feather;
        s.wrap.style.webkitMaskImage = s.wrap.style.maskImage = `radial-gradient(ellipse 72% 72% at 50% 50%, rgba(0,0,0,1) ${inner.toFixed(1)}%, rgba(0,0,0,0) 100%)`;
      }
      if (k.shadow != null) s.wrap.style.setProperty('--shadow', k.shadow.toFixed(3));
    }

    for (const T of TEXT) {
      if (t < T.start - 0.05 || t > T.end + 0.05) { T.el.style.display = 'none'; continue; }
      T.el.style.display = 'block';
      const L = T.L;
      const whole = env(t, T.start, T.inDur, L.hold, T.outDur, E.out, E.inQuad) * T.maxo;
      const n = T.parts.length;
      const perWord = L.staggerEach == null ? (L.stagger === 'char' ? 0.11 : 0.08) : L.staggerEach;
      const stagger = L.stagger === 'none' ? 0 : Math.min(0.9, perWord * Math.max(0, n - 1));
      const rise = (L.rise == null ? 20 : L.rise) * U;
      const outp = 1 - E.inQuad(seg(t, T.start + T.inDur + L.hold, T.end));
      const settled = t >= T.start + T.inDur * 1.4 + stagger + 0.2 && t <= T.start + T.inDur + L.hold;
      const outDrift = (1 - outp) * -8 * U;
      if (n && stagger > 0) {
        T.el.style.opacity = T.maxo;
        if (settled) {
          if (T.lastState !== 'settled') { for (const p of T.parts) { p.style.opacity = 1; p.style.transform = 'none'; p.style.filter = 'none'; } T.lastState = 'settled'; }
        } else {
          T.lastState = 'anim';
          for (let i = 0; i < n; i++) {
            const d = (n > 1 ? i / (n - 1) : 0) * stagger;
            const ao = E.out(seg(t, T.start + d, T.start + d + T.inDur));            // opacity
            const ap = E.outQuint(seg(t, T.start + d, T.start + d + T.inDur * 1.4));  // position settles later
            const ab = E.out(seg(t, T.start + d, T.start + d + T.inDur * 0.8));      // blur clears sooner
            const p = T.parts[i];
            p.style.opacity = Math.min(ao, outp).toFixed(3);
            p.style.transform = (ap < 1 || outp < 1) ? `translateY(${((1 - ap) * rise + outDrift).toFixed(2)}px)` : 'none';
            p.style.filter = (L.blurIn !== false && ab < 1) ? `blur(${((1 - ab) * 6 * U).toFixed(2)}px)` : (outp < 1 ? `blur(${((1 - outp) * 3 * U).toFixed(2)}px)` : 'none');
          }
        }
        T.el.style.transform = anchorTx[L.anchor || 'center'];
      } else {
        T.el.style.opacity = whole.toFixed(3);
        const a = E.outQuint(seg(t, T.start, T.start + T.inDur * 1.4));
        T.el.style.transform = `${anchorTx[L.anchor || 'center']} translateY(${((1 - a) * rise + outDrift).toFixed(2)}px)`;
      }
      if (L.reveal === 'wipe') {
        const a = E.inOutSine(seg(t, T.start, T.start + T.inDur));
        T.el.style.clipPath = a < 1 ? `inset(-20% ${((1 - a) * 104 - 2).toFixed(2)}% -20% -2%)` : 'none';
      }
      if (L.track) {
        const a = E.outExpo(seg(t, T.start, T.start + 2.8));
        const drift = Math.max(0, t - T.start - 2.8) * 0.003 + (1 - outp) * 0.03;
        T.el.style.letterSpacing = (lerp(L.track[0], L.track[1], a) + drift).toFixed(4) + 'em';
      }
      if (L.glow) {
        const g = 0.6 + 0.4 * Math.sin(t * 0.8);
        T.el.style.textShadow = `0 0 ${(18 * U * g).toFixed(1)}px rgba(255,214,170,${(0.45 * whole * g).toFixed(3)}), 0 0 ${(60 * U).toFixed(1)}px rgba(255,180,130,${(0.2 * whole).toFixed(3)})`;
      }
    }

    drawFx(t);
    vignette.style.opacity = S.vignette ? clamp01(S.vignette(t)).toFixed(3) : 1;
    fade.style.opacity = S.fade ? clamp01(S.fade(t)).toFixed(3) : 0;
  };

  const imgPromises = Object.values(IMG).map(img => (img.decode ? img.decode() : Promise.resolve()).catch(() => new Promise(r => { img.onload = r; img.onerror = r; })));
  window.filmReady = Promise.all([document.fonts.ready, ...imgPromises]).then(() => { window.seek(0); return true; });

  if (!/render=1/.test(location.search)) {
    const t0 = performance.now();
    const loop = () => { const t = ((performance.now() - t0) / 1000) % S.duration; window.seek(t); requestAnimationFrame(loop); };
    window.filmReady.then(loop);
  }
})();
