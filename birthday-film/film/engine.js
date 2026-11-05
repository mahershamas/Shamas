/* Deterministic film engine: everything on screen is a pure function of time t.
   The page loads a SCRIPT (window.SCRIPT) describing layers; window.seek(t) lays out the frame.
   Expensive effects (bokeh, light leaks) are drawn on one 2D canvas; film grain is added by ffmpeg. */
(function () {
  'use strict';
  const S = window.SCRIPT;
  const W = S.width || 1920, H = S.height || 1080;
  const U = Math.min(W, H) / 1080;          // scale unit: 1 at 1080p-height landscape
  const PORTRAIT = H > W;
  window.FILM = { duration: S.duration, width: W, height: H };

  // ---------- utils
  const clamp01 = x => x < 0 ? 0 : x > 1 ? 1 : x;
  const lerp = (a, b, p) => a + (b - a) * p;
  const E = {
    linear: p => p,
    inOut: p => p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2,
    out: p => 1 - Math.pow(1 - p, 3),
    in: p => p * p * p,
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
  window.FILM_UTILS = { E, seg, env, clamp01, lerp };

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

  // ---------- bokeh + light leak particles (drawn on canvas, additive)
  const BOKEH = [];
  (function makeBokeh() {
    const n = S.bokehCount == null ? 42 : S.bokehCount;
    for (let i = 0; i < n; i++) {
      const depth = rnd();
      const size = (14 + Math.pow(rnd(), 1.6) * 110) * U * (0.5 + depth);
      const warm = rnd() < 0.72;
      BOKEH.push({ x: rnd(), y: rnd(), size, depth, speed: (0.003 + rnd() * 0.010) * (0.4 + depth), phase: rnd() * Math.PI * 2, tw: 0.25 + rnd() * 0.7, drift: (rnd() - .5) * 0.03,
        r: 255, g: warm ? 196 + Math.floor(rnd() * 40) : 150 + Math.floor(rnd() * 40), b: warm ? 120 + Math.floor(rnd() * 60) : 160 + Math.floor(rnd() * 50) });
    }
  })();
  function drawFx(t) {
    fx.clearRect(0, 0, W, H);
    fx.globalCompositeOperation = 'lighter';
    // light leak: a big soft warm ellipse drifting slowly
    const leakA = (S.leak ? S.leak(t) : 0.5) * (0.75 + 0.25 * Math.sin(t * 0.23));
    if (leakA > 0.001) {
      const lx = W * (0.72 + 0.12 * Math.sin(t * 0.05)), ly = H * (0.3 + 0.12 * Math.cos(t * 0.04));
      const g = fx.createRadialGradient(lx, ly, 0, lx, ly, W * 0.55);
      g.addColorStop(0, `rgba(255,150,90,${0.22 * leakA})`); g.addColorStop(0.45, `rgba(255,110,80,${0.07 * leakA})`); g.addColorStop(1, 'rgba(255,110,80,0)');
      fx.fillStyle = g; fx.fillRect(0, 0, W, H);
      const lx2 = W * (0.15 + 0.1 * Math.cos(t * 0.037)), ly2 = H * (0.85 + 0.08 * Math.sin(t * 0.051));
      const g2 = fx.createRadialGradient(lx2, ly2, 0, lx2, ly2, W * 0.4);
      g2.addColorStop(0, `rgba(200,90,110,${0.14 * leakA})`); g2.addColorStop(1, 'rgba(200,90,110,0)');
      fx.fillStyle = g2; fx.fillRect(0, 0, W, H);
    }
    const bokehA = S.bokehAlpha ? S.bokehAlpha(t) : 1;
    if (bokehA > 0.001) {
      for (const b of BOKEH) {
        const y = (((b.y - t * b.speed) % 1) + 1) % 1;
        const x = (((b.x + t * b.drift * 0.1 + 0.02 * Math.sin(t * 0.3 + b.phase)) % 1) + 1) % 1;
        const tw = 0.55 + 0.45 * Math.sin(t * b.tw + b.phase);
        const a = (0.08 + 0.26 * b.depth) * tw * bokehA;
        const cx = x * W, cy = y * H * 1.2 - H * 0.1, r = b.size;
        const g = fx.createRadialGradient(cx, cy, 0, cx, cy, r);
        const soft = 0.35 + 0.45 * (1 - b.depth);         // far = softer
        g.addColorStop(0, `rgba(${b.r},${b.g},${b.b},${a})`);
        g.addColorStop(1 - soft, `rgba(${b.r},${b.g},${b.b},${a * 0.85})`);
        g.addColorStop(1, `rgba(${b.r},${b.g},${b.b},0)`);
        fx.fillStyle = g; fx.beginPath(); fx.arc(cx, cy, r, 0, Math.PI * 2); fx.fill();
      }
    }
    fx.globalCompositeOperation = 'source-over';
    if (S.drawExtra) S.drawExtra(fx, t, { W, H, U, E, seg, env });
  }

  // ---------- text elements
  const SIZES = { script: 150, serif: 58, italic: 58, caps: 30, display: 92, small: 40 };
  const TEXT = S.lines.map((L) => {
    const el = mk('line ' + (L.style || 'serif') + (L.wrap ? ' wrap' : ''), textLayer);
    el.style.display = 'none';
    const size = (L.size || 1) * U;
    el.style.fontSize = Math.round(SIZES[L.style || 'serif'] * size) + 'px';
    el.style.left = ((L.x == null ? 0.5 : L.x) * 100) + '%';
    el.style.top = ((L.y == null ? 0.5 : L.y) * 100) + '%';
    if (L.width) el.style.width = (L.width * 100) + '%';
    if (L.align) el.style.textAlign = L.align;
    if (L.color) el.style.color = L.color;
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
    const inDur = L.in == null ? 1.6 : L.in, outDur = L.out == null ? 1.2 : L.out;
    return { L, el, parts, inDur, outDur, start: L.t, end: L.t + inDur + L.hold + outDur, lastState: '' };
  });

  // ---------- photo shots
  const IMG = {};
  const SHOTS = (S.shots || []).map(sh => {
    const wrap = mk('shot' + (sh.frame ? ' framed' : ''), photoLayer);
    wrap.style.display = 'none';
    const inner = mk('shot-inner', wrap);
    const img = document.createElement('img'); img.src = sh.src; inner.appendChild(img);
    IMG[sh.src] = img;
    const grade = mk('grade', inner);
    const sweep = mk('sweep', inner);
    const scrim = mk('scrim', inner);
    return { sh, wrap, inner, img, grade, sweep, scrim };
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
  // carry forward values that are only set on earlier keyframes
  for (const s of SHOTS) {
    const acc = {};
    for (const k of s.sh.keys) { for (const key of Object.keys(k)) if (key !== 'ease') acc[key] = k[key]; for (const key of Object.keys(acc)) if (k[key] == null) k[key] = acc[key]; }
  }

  // ---------- main seek
  window.seek = function (t) {
    // background: slow drifting warm gradients
    const g1x = 50 + 8 * Math.sin(t * 0.07), g1y = 58 + 6 * Math.cos(t * 0.05);
    const g2x = 30 + 10 * Math.sin(t * 0.045 + 2), g2y = 30 + 8 * Math.cos(t * 0.06 + 1);
    const warmth = S.bgWarmth ? S.bgWarmth(t) : 1;
    bg.style.background = `radial-gradient(ellipse 70% 60% at ${g1x.toFixed(2)}% ${g1y.toFixed(2)}%, rgba(110,46,52,${(0.55 * warmth).toFixed(3)}) 0%, rgba(110,46,52,0) 70%),` +
      `radial-gradient(ellipse 60% 55% at ${g2x.toFixed(2)}% ${g2y.toFixed(2)}%, rgba(140,88,40,${(0.35 * warmth).toFixed(3)}) 0%, rgba(140,88,40,0) 70%),` +
      `linear-gradient(180deg, #16090c 0%, #0b0507 100%)`;

    // photos
    for (const s of SHOTS) {
      const sh = s.sh;
      if (t < sh.start || t > sh.end) { s.wrap.style.display = 'none'; continue; }
      s.wrap.style.display = 'block';
      const k = interpKeys(sh.keys, t);
      const iw = s.img.naturalWidth || 1448, ih = s.img.naturalHeight || 1086;
      const boxW = (k.w || (PORTRAIT ? 0.92 : 0.62)) * W, boxH = boxW * ih / iw;
      const cx = (k.x == null ? 0.5 : k.x) * W, cy = (k.y == null ? 0.5 : k.y) * H;
      const breathe = sh.breathe == null ? 0.012 : sh.breathe;
      const sc = (k.scale == null ? 1 : k.scale) * (1 + breathe * (0.5 + 0.5 * Math.sin((t - sh.start) * 0.13)));
      const inD = sh.in == null ? 2 : sh.in, outD = sh.out == null ? 2 : sh.out;
      const op = (k.opacity == null ? 1 : k.opacity) * env(t, sh.start, inD, (sh.end - sh.start) - inD - outD, outD);
      s.wrap.style.left = (cx - boxW / 2).toFixed(1) + 'px'; s.wrap.style.top = (cy - boxH / 2).toFixed(1) + 'px';
      s.wrap.style.width = boxW.toFixed(1) + 'px'; s.wrap.style.height = boxH.toFixed(1) + 'px';
      s.wrap.style.opacity = op.toFixed(3);
      s.inner.style.transform = `scale(${sc.toFixed(4)}) translate(${((k.px || 0) * boxW).toFixed(1)}px, ${((k.py || 0) * boxH).toFixed(1)}px) rotate(${(k.rot || 0).toFixed(2)}deg)`;
      const blur = k.blur || 0, bright = k.bright == null ? 1 : k.bright, sat = k.sat == null ? 1 : k.sat, sep = k.sepia || 0, con = k.contrast == null ? 1 : k.contrast;
      s.img.style.filter = (blur > 0.05 || bright !== 1 || sat !== 1 || sep > 0 || con !== 1) ? `blur(${(blur * U).toFixed(2)}px) brightness(${bright.toFixed(3)}) saturate(${sat.toFixed(3)}) sepia(${sep.toFixed(3)}) contrast(${con.toFixed(3)})` : 'none';
      s.grade.style.opacity = (k.grade == null ? 0.35 : k.grade).toFixed(3);
      s.scrim.style.opacity = (k.scrim == null ? 0 : k.scrim).toFixed(3);
      if (k.sweep != null && k.sweep > 0 && k.sweep < 1) {
        s.sweep.style.display = 'block';
        s.sweep.style.transform = `translateX(${((k.sweep * 2 - 1) * 110).toFixed(1)}%) skewX(-18deg)`;
        s.sweep.style.opacity = (Math.sin(k.sweep * Math.PI) * 0.6).toFixed(3);
      } else s.sweep.style.display = 'none';
      // soft oval mask: feather 0 = none (hard edges), 1 = very soft oval
      const feather = k.feather == null ? 0 : k.feather;
      if (sh.frame || feather <= 0.001) { s.wrap.style.webkitMaskImage = s.wrap.style.maskImage = 'none'; }
      else {
        const inner = 100 - 72 * feather;
        s.wrap.style.webkitMaskImage = s.wrap.style.maskImage = `radial-gradient(ellipse 72% 72% at 50% 50%, rgba(0,0,0,1) ${inner.toFixed(1)}%, rgba(0,0,0,0) 100%)`;
      }
      if (k.shadow != null) s.wrap.style.setProperty('--shadow', k.shadow.toFixed(3));
    }

    // text
    for (const T of TEXT) {
      if (t < T.start - 0.05 || t > T.end + 0.05) { T.el.style.display = 'none'; continue; }
      T.el.style.display = 'block';
      const L = T.L;
      const whole = env(t, T.start, T.inDur, L.hold, T.outDur);
      const stagger = L.stagger === 'none' ? 0 : (L.staggerDur == null ? Math.min(0.9, T.inDur * 0.55) : L.staggerDur);
      const n = T.parts.length;
      const rise = (L.rise == null ? 14 : L.rise) * U;
      const settled = t >= T.start + T.inDur + 0.3 && t <= T.start + T.inDur + L.hold;
      if (n && stagger > 0) {
        T.el.style.opacity = 1;
        if (settled) {
          if (T.lastState !== 'settled') { for (const p of T.parts) { p.style.opacity = 1; p.style.transform = 'none'; p.style.filter = 'none'; } T.lastState = 'settled'; }
        } else {
          T.lastState = 'anim';
          const outp = 1 - E.inOutSine(seg(t, T.start + T.inDur + L.hold, T.end));
          for (let i = 0; i < n; i++) {
            const d = (n > 1 ? i / (n - 1) : 0) * stagger;
            const a = E.out(seg(t, T.start + d, T.start + d + Math.max(0.3, T.inDur - stagger)));
            const o = Math.min(a, outp);
            const p = T.parts[i];
            p.style.opacity = o.toFixed(3);
            p.style.transform = a < 1 ? `translateY(${((1 - a) * rise).toFixed(2)}px)` : 'none';
            p.style.filter = (L.blurIn !== false && a < 1) ? `blur(${((1 - a) * 6 * U).toFixed(2)}px)` : 'none';
          }
        }
      } else {
        T.el.style.opacity = whole.toFixed(3);
        const a = E.out(seg(t, T.start, T.start + T.inDur));
        T.el.style.transform = `translate(-50%, -50%) translateY(${((1 - a) * rise).toFixed(2)}px)`;
      }
      if (L.reveal === 'wipe') {           // handwriting-like reveal, left to right
        const a = E.inOutSine(seg(t, T.start, T.start + T.inDur));
        T.el.style.clipPath = a < 1 ? `inset(-20% ${((1 - a) * 104 - 2).toFixed(2)}% -20% -2%)` : 'none';
      }
      if (L.track) {
        const a = E.out(seg(t, T.start, T.start + T.inDur + 1.5));
        T.el.style.letterSpacing = lerp(L.track[0], L.track[1], a).toFixed(3) + 'em';
      }
      if (L.glow) {
        const g = 0.6 + 0.4 * Math.sin(t * 0.8);
        T.el.style.textShadow = `0 0 ${(18 * U * g).toFixed(1)}px rgba(255,214,170,${(0.55 * whole * g).toFixed(3)}), 0 0 ${(60 * U).toFixed(1)}px rgba(255,180,130,${(0.25 * whole).toFixed(3)})`;
      }
    }

    drawFx(t);
    vignette.style.opacity = S.vignette ? clamp01(S.vignette(t)).toFixed(3) : 1;
    fade.style.opacity = S.fade ? clamp01(S.fade(t)).toFixed(3) : 0;
  };

  // ---------- readiness
  const imgPromises = Object.values(IMG).map(img => img.complete && img.naturalWidth ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; }));
  window.filmReady = Promise.all([document.fonts.ready, ...imgPromises]).then(() => { window.seek(0); return true; });

  // live preview when opened in a browser (not during render)
  if (!/render=1/.test(location.search)) {
    const t0 = performance.now();
    const loop = () => { const t = ((performance.now() - t0) / 1000) % S.duration; window.seek(t); requestAnimationFrame(loop); };
    window.filmReady.then(loop);
  }
})();
