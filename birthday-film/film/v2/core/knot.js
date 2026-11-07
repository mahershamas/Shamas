/*
  core/knot.js: knotwork (SPEC 3 scenes 6, 10, 12, 13; cookbook items 8A braid band and 8B closed knot).

  Everything here is a pure function of its inputs (no clocks, no randomness): progress values come from the scenes.
  Gold is shaded with the gold-leaf material of core/gold.js (its palette ramp GOLD_RAMPS[look] and the same lighting
  model as goldS: soft overhead studio environment, GGX key + fill, leaf crackle and beaten mottling), with an analytic
  ribbon normal instead of a blurred-mask normal: a rounded bevel on both edges, an incised centre groove, a dark umber
  keyline (#2A1A06) round every ribbon and every cut end, true over/under gaps, contact shadow on the under strand
  and a soft drop shadow onto the ground. Noise is evaluated in object space so rotating or scaling knotwork does not
  make the leaf swim. Output is premultiplied HDR (blend 'premul'): the keyline and shadows occlude what is behind.

  ---- Pure geometry (no GL; importable from node for the unit tests)
  roseCurve({cx, cy, R, lobes, turns, inner = 0.6, amp = 0.4, rotation = 0, swirl = 0}) -> {P, thMax, center, R}
        r(theta) = R (inner + amp cos(lobes theta / turns)), theta in [0, 2 PI turns). One closed strand when
        gcd(lobes, turns) = 1. swirl twists the plane by an angle that grows toward the centre (a diffeomorphism, so
        the crossing structure is unchanged): the spiral look of the corner roundels.
  closedKnot(P, thMax, {samples = 3000, startNear: [x,y], startTheta, flip = false, center}) -> Knot
        Knot = {pts Float32Array [x,y,...], ang Float32Array (tangent angle), s Float32Array (arc length), L, n,
                crossings: [{a, b, sa, sb, x, y, angle (deg), overIsA, overIsB}], _passes, P, thMax, center}
        Resampled by arc length; s = 0 at P(startTheta) (or at the point nearest startNear). Over/under is assigned
        by walking the strand and alternating at every crossing passage (flip mirrors the weave).
  verifyKnot(knot, {ribbon, gapFactor = 2.2}) -> {ok, parity, alternation, components, closed, retrace, crossings,
        minAngle, minCrossDist, minPassGap, cutLength}
        parity: every crossing has exactly one over and one under pass; alternation: over/under alternate along the
        whole loop (including across the seam at s = 0); closed: P(thMax) == P(0); retrace: the smallest m >= 1 with
        P(theta + thMax/m) == P(theta) (m > 1 means the parameter range traces one curve m times, i.e. not one clean
        strand); components: 1 for a single closed strand traced once, otherwise m (0 if open).
        minPassGap is the shortest arc between consecutive passages; it must exceed cutLength = gapFactor * ribbon.
  promiseKnot({cx = 960, cy = 470, R = 170, rotation, samples}) -> Knot     scene 12: lobes 4, turns 3, inner 0.68, amp 0.32
  seatKnot({cx = 0, cy = 0, size = 64, rotation, startNear, samples}) -> Knot   scene 7/13: r = R(0.6 + 0.4 cos(2 theta/3)),
        theta in [0, 6 PI), R = size / 2 (about 64 px across)
  roundelKnot({R = 27}) -> Knot                                  the corner-roundel spiral knot (lobes 3, turns 2, swirled)
  braidOver(n, i, j, s, omega) -> index of the strand that passes over at the (i, j) crossing nearest band position s
        n = 3: plait rule, the strand moving in from the edge passes over (strand (i + 1) mod 3 over i)
        n = 2: rope twist, the strand rising (d increasing) passes over (alternates crossing by crossing)
  braidStrandY(n, k, s, amp, omega) -> centreline offset of strand k (used by the shader and the tests)
  buildKnotData(knot, {reach, step = 2, pad = 4}) -> {w, h, x0, y0, data Float32Array (2w x h x RGBA), stats}
        The 8B data texture, two layers side by side (layer 0 at x, layer 1 at x + w). Per texel and layer: the nearest
        point of one passage of the strand (x, y in texture px), its tangent angle and its arc length. Where two passages
        cross, layer 0 is the over passage and layer 1 the under one (angle + 16 flags it as cut by layer 0). The shader
        evaluates the exact distance from the fragment to each passage's local tangent line, so edges are analytic,
        nothing is interpolated across passages, and the under strand's gap is cut only where the over strand has
        already been drawn (the weave builds itself as the pen passes). stats: {pairs, crossingTexels, triple, nearTouch}.

  ---- GL: const K = createKnot(G, gold)
  Common drawing options (all optional): key [x,y] frame px (default above-left), keyZ (default 260), keyI (default 4),
    fill [x,y], fillI (0), look 'winter_gold' | 'night_sea' | 'photo' (gold ramp and keyline/tincture inversion; default
    winter_gold), opacity, tint [r,g,b], detail (leaf texture 0..1), shadow (drop-shadow strength, default 0.5),
    tips (pen tips while 0 < progress < 1, default true), tipI (default 3), wet (glow of fresh leaf behind the pen, default 0.6),
    sweep {x, width, I, slant} (a struck-metal band, frame px), xform {center:[x,y], scale, rotation} (scene 6 through-glass).
  K.band.rect(target, {rect:[x,y,w,h] centreline, width = 54, strands = 3, amp = 14, omega = 2 PI/72, halfWidth = 7,
                       gap = 2.5, progress = 1, start: 'bottom' (reveal from the bottom centre both ways; the tips meet at
                       the top centre), fillets = true, tincture: null | '#hex', tinctureAlpha = 1,
                       roundels = true, roundelSize = 88, roundelSpan = 300 (px of tip travel while a roundel draws),
                       roundelProgress: [bl, tl, tr, br] (overrides), roundelTinctures: {field, rule}, ...common})
        -> {tips: [[x,y],[x,y]], roundels: [p...]}
  K.band.rectPoint(o, u) -> [x, y]          centreline point at signed loop distance u from the start (u > 0 one way,
                                            u < 0 the other; |u| <= perimeter / 2): the pen tips are at u = +-progress P/2
  K.band.rectPerimeter(o) -> P
  K.band.annulus(target, {center:[x,y], r0, r1, strands = 2, halfWidth, amp, omega (derived from the band width so the
                       weave closes round the circle with a whole number of periods), gap, progress = 1,
                       startAngle = -PI/2 (top; reveal runs both ways), rotation = 0 (rad, turns the weave with it),
                       fillets = true, tincture: '#hex' | null, tinctureAlpha = 1, ...common}) -> {tips}
  K.roundel(target, {center:[x,y], size = 88, progress = 1, rotation = 0, entry (angle the drawing starts from),
                     field = '#2F7D6B' (verdigris), rule = '#C2452D' (red lead), ...common})
  K.texture(knot, {ribbon = 14, gapFactor = 2.2, thread = false, reach}) -> KnotTex {tex, w, h, x0, y0, L, knot, ribbon, clear,
                     center, stats, reach}
        clear = gapFactor * ribbon / 2: the under strand is interrupted over gapFactor ribbon widths at each crossing.
        thread: true for a knot drawn with style 'thread' (smaller reach). Built on the CPU once (promise knot ~0.1 s).
  knotReach(ribbon, gapFactor, thread) -> the reach K.texture uses
  K.draw(target, kt, {progress = 1, center (frame px of the knot centre; default where it was generated), rotation = 0,
                      scale = 1, rect (stub compatibility: maps the texture's own box [x0, y0, w, h] onto [x,y,w,h]), flare = 0 (0..1 progress of the
                      closing specular flare sweeping the whole knot), flareI = 3, groove = ribbon >= 9, outline '#2A1A06',
                      style 'gold' | 'thread', threadColor '#FFE7A3', glowColor '#D4A64A', threadI = 1.6, glow = 1,
                      ...common}) -> {tip: [x,y] | null}
        style 'thread' draws a thin glowing thread (additive, no keyline) with the same over/under gaps: the seat knot.
  K.tipAt(kt | knot, progress, {center, rotation, scale}) -> [x, y] frame px of the pen tip (arc length progress L)
  K.penTip(target, {x, y, I = 3, size = 1})           hot gold pen nib: white-hot core, warm halo, faint 4-point star
  K.ring(target, {center, r, width = 10, I = 1, color}) a soft additive ring of light (the closing pulse)
  Cost (software WebGL, landscape): rect band with roundels ~50 ms, one rosette band ~15 ms, promise knot ~13 ms,
  texture build ~0.15 s at init. Shaders are compiled per variant (#if), because the software rasteriser pays for
  every instruction of a shader whatever its branches.
  Transitions: inside a transition window main.js adds overlays from a scratch target, which drops premultiplied
  alpha, so the keyline and drop shadows only darken what is behind when the knotwork is drawn straight into C.
*/
import { frag, HEADER_VS } from './glsl.js';
import { GOLD_GLSL, GOLD_RAMPS } from './gold.js';
import { displayToScene, DEFAULTS, LOOKS } from './post.js';

const TAU = Math.PI * 2;

// ------------------------------------------------------------------------------------------------ pure geometry
export function roseCurve({ cx = 0, cy = 0, R = 170, lobes = 4, turns = 3, inner = 0.6, amp = 0.4, rotation = 0, swirl = 0 } = {}) {
  const k = lobes / turns;
  const P = th => {
    const r = R * (inner + amp * Math.cos(k * th));
    const u = 1 - r / R;
    const a = th + rotation + swirl * u * u;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  return { P, thMax: TAU * turns, center: [cx, cy], R, lobes, turns };
}

function cycDist(a, b, L) { let d = Math.abs(a - b) % L; return d > L / 2 ? L - d : d; }

export function closedKnot(P0, thMax, { samples = 3000, startNear = null, startTheta = 0, flip = false, center = null } = {}) {
  let th0 = startTheta;
  if (startNear) {
    let best = Infinity;
    for (let i = 0; i < 8000; i++) {
      const th = thMax * i / 8000, p = P0(th), d = Math.hypot(p[0] - startNear[0], p[1] - startNear[1]);
      if (d < best) { best = d; th0 = th; }
    }
  }
  const P = th => P0(th + th0);
  const N0 = samples * 8, raw = [];
  for (let i = 0; i <= N0; i++) raw.push(P(thMax * i / N0));
  const acc = new Float64Array(N0 + 1);
  for (let i = 1; i <= N0; i++) acc[i] = acc[i - 1] + Math.hypot(raw[i][0] - raw[i - 1][0], raw[i][1] - raw[i - 1][1]);
  const L = acc[N0];
  const n = samples;
  const pts = new Float32Array(n * 2), s = new Float32Array(n), ang = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const target = L * i / n;
    while (j < N0 - 1 && acc[j + 1] < target) j++;
    const f = (target - acc[j]) / Math.max(1e-12, acc[j + 1] - acc[j]);
    pts[i * 2] = raw[j][0] + (raw[j + 1][0] - raw[j][0]) * f;
    pts[i * 2 + 1] = raw[j][1] + (raw[j + 1][1] - raw[j][1]) * f;
    s[i] = target;
  }
  for (let i = 0; i < n; i++) {
    const a = (i + n - 1) % n, b = (i + 1) % n;
    ang[i] = Math.atan2(pts[b * 2 + 1] - pts[a * 2 + 1], pts[b * 2] - pts[a * 2]);
  }
  // self-crossings, segment i = pts[i] -> pts[i+1 mod n]; a uniform grid keeps it near-linear
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (let i = 0; i < n; i++) { mnx = Math.min(mnx, pts[2 * i]); mxx = Math.max(mxx, pts[2 * i]); mny = Math.min(mny, pts[2 * i + 1]); mxy = Math.max(mxy, pts[2 * i + 1]); }
  const cs = Math.max(4 * L / n, 1e-6), gw = Math.max(1, Math.ceil((mxx - mnx) / cs) + 1), gh = Math.max(1, Math.ceil((mxy - mny) / cs) + 1);
  const grid = new Map();
  const cellsOf = i => {
    const ax = pts[2 * i], ay = pts[2 * i + 1], b = (i + 1) % n, bx = pts[2 * b], by = pts[2 * b + 1];
    const x0 = Math.floor((Math.min(ax, bx) - mnx) / cs), x1 = Math.floor((Math.max(ax, bx) - mnx) / cs);
    const y0 = Math.floor((Math.min(ay, by) - mny) / cs), y1 = Math.floor((Math.max(ay, by) - mny) / cs);
    const out = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push(y * gw + x);
    return out;
  };
  for (let i = 0; i < n; i++) for (const c of cellsOf(i)) { if (!grid.has(c)) grid.set(c, []); grid.get(c).push(i); }
  void gh;
  const cr = [], seen = new Set();
  for (let a = 0; a < n; a++) {
    const ax = pts[2 * a], ay = pts[2 * a + 1], a1 = (a + 1) % n, bx = pts[2 * a1], by = pts[2 * a1 + 1];
    for (const c of cellsOf(a)) for (const b of grid.get(c)) {
      if (b <= a + 1) continue;
      if (a === 0 && b === n - 1) continue;
      const key = a * n + b;
      if (seen.has(key)) continue;
      seen.add(key);
      const b1 = (b + 1) % n, cx = pts[2 * b], cy = pts[2 * b + 1], dx = pts[2 * b1], dy = pts[2 * b1 + 1];
      const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (Math.abs(den) < 1e-12) continue;
      const u = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
      const v = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
      if (u >= 0 && u < 1 && v >= 0 && v < 1) {
        const t1 = Math.atan2(by - ay, bx - ax), t2 = Math.atan2(dy - cy, dx - cx);
        let da = Math.abs(t1 - t2) % Math.PI; if (da > Math.PI / 2) da = Math.PI - da;
        cr.push({ a, b, sa: s[a] + u * (L / n), sb: s[b] + v * (L / n), x: ax + u * (bx - ax), y: ay + u * (by - ay), angle: da * 180 / Math.PI });
      }
    }
  }
  cr.sort((p, q) => p.sa - q.sa);
  // walk the strand: passages sorted by arc length alternate over / under
  const pass = [];
  cr.forEach((c, k) => { pass.push({ s: c.sa, k, isA: true }); pass.push({ s: c.sb, k, isA: false }); });
  pass.sort((p, q) => p.s - q.s);
  pass.forEach((p, i) => { const over = (i % 2 === 0) !== flip; if (p.isA) cr[p.k].overIsA = over; else cr[p.k].overIsB = over; });
  let ctr = center;
  if (!ctr) ctr = [(mnx + mxx) / 2, (mny + mxy) / 2];
  return { pts, ang, s, L, n, crossings: cr, _passes: pass, P, thMax, center: ctr, bbox: [mnx, mny, mxx, mxy] };
}

export function verifyKnot(k, { ribbon = 0, gapFactor = 2.2 } = {}) {
  const parity = k.crossings.every(c => typeof c.overIsA === 'boolean' && typeof c.overIsB === 'boolean' && c.overIsA !== c.overIsB);
  let alternation = k._passes.length > 0 && k._passes.length % 2 === 0;
  for (let i = 0; i < k._passes.length; i++) {
    const p = k._passes[i], q = k._passes[(i + 1) % k._passes.length];
    const op = p.isA ? k.crossings[p.k].overIsA : k.crossings[p.k].overIsB;
    const oq = q.isA ? k.crossings[q.k].overIsA : k.crossings[q.k].overIsB;
    if (op === oq) alternation = false;
  }
  // closure and minimal period (single strand traced exactly once)
  const size = Math.max(1, k.bbox[2] - k.bbox[0], k.bbox[3] - k.bbox[1]);
  const eps = 1e-6 * size;
  const P = k.P, T = k.thMax;
  let closed = true, retrace = 1;
  if (P) {
    const a = P(0), b = P(T);
    closed = Math.hypot(a[0] - b[0], a[1] - b[1]) < eps * 10;
    for (let m = 2; m <= 48 && retrace === 1; m++) {
      let mx = 0;
      for (let i = 0; i < 97 && mx < eps * 100; i++) {
        const th = T * (i + 0.37) / 97, p = P(th), q = P(th + T / m);
        mx = Math.max(mx, Math.hypot(p[0] - q[0], p[1] - q[1]));
      }
      if (mx < eps * 100) retrace = m;
    }
  }
  const components = closed ? retrace : 0;
  let minAngle = 90, minCrossDist = Infinity, minPassGap = Infinity;
  for (const c of k.crossings) minAngle = Math.min(minAngle, c.angle == null ? 90 : c.angle);
  for (let i = 0; i < k.crossings.length; i++) for (let j = i + 1; j < k.crossings.length; j++)
    minCrossDist = Math.min(minCrossDist, Math.hypot(k.crossings[i].x - k.crossings[j].x, k.crossings[i].y - k.crossings[j].y));
  for (let i = 0; i < k._passes.length; i++) {
    const p = k._passes[i], q = k._passes[(i + 1) % k._passes.length];
    minPassGap = Math.min(minPassGap, ((q.s - p.s) % k.L + k.L) % k.L);
  }
  const cutLength = gapFactor * ribbon;
  const ok = parity && alternation && closed && components === 1 && k.crossings.length > 0 && (!ribbon || minPassGap > cutLength);
  return { ok, parity, alternation, components, closed, retrace, crossings: k.crossings.length, minAngle, minCrossDist, minPassGap, cutLength };
}

export function promiseKnot({ cx = 960, cy = 470, R = 170, rotation = 0, samples = 3000 } = {}) {
  // inner 0.68 / amp 0.32 (spec: 0.6 / 0.4): the inner minima then bend with a curvature radius (~60 px) well above
  // the ribbon width, so the ribbon's inner edge never folds into a kink
  const c = roseCurve({ cx, cy, R, lobes: 4, turns: 3, inner: 0.68, amp: 0.32, rotation });
  return closedKnot(c.P, c.thMax, { samples, center: [cx, cy] });
}
export function seatKnot({ cx = 0, cy = 0, size = 64, rotation = 0, startNear = null, samples = 900 } = {}) {
  const c = roseCurve({ cx, cy, R: size / 2, lobes: 2, turns: 3, inner: 0.6, amp: 0.4, rotation });
  return closedKnot(c.P, c.thMax, { samples, startNear, center: [cx, cy] });
}
export function roundelKnot({ R = 27, samples = 1400 } = {}) {
  const c = roseCurve({ cx: 0, cy: 0, R, lobes: 3, turns: 2, inner: 0.66, amp: 0.34, rotation: -Math.PI / 2, swirl: 1.3 });
  return closedKnot(c.P, c.thMax, { samples, center: [0, 0] });
}

// braid band (8A): strand k centreline offset and the over/under rule (mirrored exactly in the band shader)
export function braidPhase(n, k) { return n === 2 ? Math.PI * k : TAU * k / n; }
export function braidStrandY(n, k, s, amp, omega) { return amp * Math.sin(omega * s + braidPhase(n, k)); }
export function braidOver(n, i, j, s, omega) {
  if (n === 3) return ((i + 1) % 3 === j) ? j : i;          // (i+1) mod 3 passes over i
  if (n === 2) { const m = Math.round(omega * s / Math.PI); return (((m % 2) + 2) % 2 === 0) ? 0 : 1; }
  return Math.max(i, j);
}

// 8B data texture (CPU, once per knot)
export function buildKnotData(k, { reach = 24, step = 2, pad = 4 } = {}) {
  const n = k.n, L = k.L;
  const m = Math.max(1, Math.round(step / (L / n)));
  const V = [];
  for (let i = 0; i < n; i += m) V.push(i);
  const nv = V.length;
  const [bx0, by0, bx1, by1] = k.bbox;
  const x0 = Math.floor(bx0 - reach - pad), y0 = Math.floor(by0 - reach - pad);
  const w = Math.ceil(bx1 + reach + pad) - x0, h = Math.ceil(by1 + reach + pad) - y0;
  const N = w * h;
  // per texel: first run (fr), current run (cr), two committed slots (s0, s1). fields d, s, x, y, a
  const mk = () => ({ d: new Float32Array(N).fill(Infinity), s: new Float32Array(N), x: new Float32Array(N), y: new Float32Array(N), a: new Float32Array(N) });
  const FR = mk(), CR = mk(), S0 = mk(), S1 = mk();
  const frStart = new Int32Array(N).fill(-1), frEnd = new Int32Array(N).fill(-9), crEnd = new Int32Array(N).fill(-9);
  const hasCR = new Uint8Array(N);
  let triple = 0;
  const put = (D, i, d, s, x, y, a) => { D.d[i] = d; D.s[i] = s; D.x[i] = x; D.y[i] = y; D.a[i] = a; };
  const cpy = (D, i, Sx) => put(D, i, Sx.d[i], Sx.s[i], Sx.x[i], Sx.y[i], Sx.a[i]);
  const commit = (i, Sx) => {
    if (S0.d[i] === Infinity) { cpy(S0, i, Sx); return; }
    if (S1.d[i] === Infinity) { cpy(S1, i, Sx); return; }
    const far = S0.d[i] > S1.d[i] ? S0 : S1;
    if (Sx.d[i] < far.d[i]) { if (far.d[i] < reach * 0.75) triple++; cpy(far, i, Sx); }
    else if (Sx.d[i] < reach * 0.75) triple++;
  };
  const lerpAng = (a, b, t) => { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return a + d * t; };
  for (let j = 0; j < nv; j++) {
    const ia = V[j], ib = V[(j + 1) % nv];
    const ax = k.pts[2 * ia] - x0, ay = k.pts[2 * ia + 1] - y0, bx = k.pts[2 * ib] - x0, by = k.pts[2 * ib + 1] - y0;
    const sa = k.s[ia], sb = j + 1 < nv ? k.s[ib] : L;
    const aa = k.ang[ia], ab = k.ang[ib];
    const ex = bx - ax, ey = by - ay, el2 = Math.max(1e-12, ex * ex + ey * ey);
    const px0 = Math.max(0, Math.floor(Math.min(ax, bx) - reach)), px1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + reach));
    const py0 = Math.max(0, Math.floor(Math.min(ay, by) - reach)), py1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + reach));
    for (let py = py0; py <= py1; py++) for (let px = px0; px <= px1; px++) {
      const qx = px + 0.5, qy = py + 0.5;
      let t = ((qx - ax) * ex + (qy - ay) * ey) / el2; t = t < 0 ? 0 : t > 1 ? 1 : t;
      const cx = ax + t * ex, cy = ay + t * ey, d = Math.hypot(qx - cx, qy - cy);
      if (d > reach) continue;
      const i = py * w + px, s = sa + (sb - sa) * t, a = lerpAng(aa, ab, t);
      if (frStart[i] < 0) { frStart[i] = j; frEnd[i] = j; put(FR, i, d, s, cx, cy, a); continue; }
      if (!hasCR[i]) {
        if (frEnd[i] === j || frEnd[i] === j - 1) { frEnd[i] = j; if (d < FR.d[i]) put(FR, i, d, s, cx, cy, a); continue; }
        hasCR[i] = 1; crEnd[i] = j; put(CR, i, d, s, cx, cy, a); continue;
      }
      if (crEnd[i] === j || crEnd[i] === j - 1) { crEnd[i] = j; if (d < CR.d[i]) put(CR, i, d, s, cx, cy, a); continue; }
      commit(i, CR); crEnd[i] = j; put(CR, i, d, s, cx, cy, a);
    }
  }
  const win = 4 * reach;
  const data = new Float32Array(2 * w * h * 4);
  let pairs = 0, crossingTexels = 0, nearTouch = 0;
  for (let i = 0; i < N; i++) {
    if (frStart[i] < 0) { data[(Math.floor(i / w) * 2 * w + (i % w)) * 4 + 3] = -1; data[(Math.floor(i / w) * 2 * w + w + (i % w)) * 4 + 3] = -1; continue; }
    if (hasCR[i]) {
      if (crEnd[i] === nv - 1 && frStart[i] === 0) { if (CR.d[i] < FR.d[i]) cpy(FR, i, CR); }
      else commit(i, CR);
    }
    commit(i, FR);
    const row = Math.floor(i / w), col = i % w;
    const o0 = (row * 2 * w + col) * 4, o1 = (row * 2 * w + w + col) * 4;
    let A = S0, B = S1, flag = 0;
    if (S1.d[i] !== Infinity) {
      pairs++;
      const s0 = S0.s[i], s1 = S1.s[i];
      // the crossing these two passages make here: arc lengths must match, nearest in space wins
      let found = null, bestD = Infinity;
      const tx = col + 0.5 + x0, ty = row + 0.5 + y0;
      for (const c of k.crossings) {
        const dsp = Math.hypot(c.x - tx, c.y - ty);
        if (dsp > 3 * reach || dsp >= bestD) continue;
        if (cycDist(s0, c.sa, L) < win && cycDist(s1, c.sb, L) < win) { found = c.overIsA ? 0 : 1; bestD = dsp; }
        else if (cycDist(s0, c.sb, L) < win && cycDist(s1, c.sa, L) < win) { found = c.overIsB ? 0 : 1; bestD = dsp; }
      }
      if (found !== null) { flag = 1; crossingTexels++; if (found === 1) { A = S1; B = S0; } }
      else { if (S1.d[i] < S0.d[i]) { A = S1; B = S0; } if (S0.d[i] + S1.d[i] < reach * 0.9) nearTouch++; }
    }
    data[o0] = A.x[i]; data[o0 + 1] = A.y[i]; data[o0 + 2] = A.a[i]; data[o0 + 3] = A.s[i];
    if (B.d[i] !== Infinity) { data[o1] = B.x[i]; data[o1 + 1] = B.y[i]; data[o1 + 2] = B.a[i] + (flag ? 16 : 0); data[o1 + 3] = B.s[i]; }
    else data[o1 + 3] = -1;
  }
  return { w, h, x0, y0, data, stats: { pairs, crossingTexels, triple, nearTouch } };
}

// texture reach (px) for a ribbon: the cut, the keyline, the contact and drop shadows (gold) or the glow (thread)
export function knotReach(ribbon = 14, gapFactor = 2.2, thread = false) {
  const hw = ribbon / 2, clear = gapFactor * ribbon / 2;
  return thread ? Math.ceil(Math.max(clear + 8, hw + 10, 12)) : Math.ceil(Math.max(clear + Math.min(7, 1.6 * hw) + 2, hw + 8, 10));
}

// ------------------------------------------------------------------------------------------------ GLSL
// the gold-leaf ramp of core/gold.js with the look's stops as a uniform (falls back to the baked winter-gold ramp)
const RAMP_GLSL = (() => {
  const re = /const vec3 GOLD_R(\d) = vec3\([^)]*\);/g;
  if (re.test(GOLD_GLSL)) return 'uniform vec3 uRamp[7];\n' + GOLD_GLSL.replace(/const vec3 GOLD_R(\d) = vec3\([^)]*\);/g, '#define GOLD_R$1 uRamp[$1]');
  return GOLD_GLSL;
})();

const COMMON_GLSL = RAMP_GLSL + `
uniform vec3 uKey, uFill; uniform float uKeyI, uFillI, uDetail, uOpacity, uShadow, uWet;
uniform vec3 uKeyCol, uTint; uniform vec4 uSweep; uniform float uSweepY; uniform float uCushion, uSpecK;
// the lighting model of gold.js goldS(), with an analytic ribbon normal N (frame coords, y down) and object-space noise
uniform sampler2D uLeaf;   // periodic leaf texture (576 px tile): r crackle edge, g mottling, b broad reflections, a grain
float knotGoldS(vec3 N, vec2 fpx, vec2 opx, float thick, float nvar){
  float detail = uDetail;
  vec4 lf = texture(uLeaf, opx / 576.0);
  float edge = lf.r;
  float crack = (1.0 - smoothstep(0.0, 0.06, edge)) * thick * detail;
  float mott = lf.g;
  float grain = lf.a * thick * detail;
  float rough = 0.22 + 0.20 * crack;
  rough = min(sqrt(rough * rough + nvar), 0.9);          // specular anti-aliasing: the lobe widens with the normal's spread over the pixel
  // burnished-leaf environment of gold.js (studio sky, deep floor, dark reflected horizon band), slightly softened
  // for the ribbons' rounder cushion so the knotwork keeps its polished, even read
  float env = mix(0.54 + 0.50 * (-N.y) - 0.06 * N.x, goldEnv(N), 0.6);
  float broad = lf.b;
  env = max(env, 0.10) * (0.72 + 0.56 * broad) * (0.94 + 0.12 * mott);
  vec3 V = vec3(0.0, 0.0, 1.0);
  vec3 L = normalize(vec3(uKey.xy - fpx, uKey.z));
  float sharp = 0.12 * (0.35 + 0.65 * detail) * uSpecK;
  float spec = ggx(N, V, L, rough, vec3(1.0)).x * uKeyI * sharp + ggx(N, V, L, 0.75, vec3(1.0)).x * uKeyI * 0.10;
#if FILL
  { vec3 L2 = normalize(vec3(uFill.xy - fpx, uFill.z)); spec += ggx(N, V, L2, rough, vec3(1.0)).x * uFillI * sharp + ggx(N, V, L2, 0.75, vec3(1.0)).x * uFillI * 0.10; }
#endif
  float s = env * 0.86 + spec;
  s = s < 1.0 ? s : 1.0 + 0.35 * (1.0 - exp(-(s - 1.0) / 0.35));
  if (uSweep.z > 0.0){
    float b = exp(-pow((fpx.x - uSweep.x + (fpx.y - uSweepY) * uSweep.w) / max(uSweep.y, 1.0), 2.0));
    s += uSweep.z * b * (0.35 + 0.65 * smoothstep(0.75, 1.0, N.z)) * (1.0 - 0.5 * crack);
  }
  s *= (1.0 - 0.18 * crack) * (0.96 + 0.08 * grain);
  return s;
}
// ribbon shading. sdf (object px, < 0 inside) with its frame-space gradient g (unit, outward); d = signed offset from
// the strand centreline with frame-space normal nF; pw = object px per fragment; hw = half width; kl = keyline width
// returns premultiplied colour (alpha = coverage)
vec4 ribbon(float sdf, vec2 g, float d, vec2 nF, float hw, float kl, float pw, float grooveOn, float ao, float extraS, vec2 fpx, vec2 opx){
  float cov = clamp(0.5 - sdf / pw, 0.0, 1.0);
  if (cov <= 0.0) return vec4(0.0);
  float w = max(-sdf - kl, 0.0);                       // inward distance from the keyline
  // cushion profile: the leaf is laid over a rounded gesso ribbon, steep at the edges, flat on the crown
  float hwi = max(hw - kl, 0.5);
  float x = 1.0 - clamp(w / hwi, 0.0, 1.0);
  float slope = uCushion * (1.25 * pow(x, 1.25) + 1.4 * pow(x, 6.0));
  float dsl = uCushion * (1.5625 * pow(x, 0.25) + 8.4 * pow(x, 5.0)) / hwi;   // d slope / d w
  float nvar = pow(dsl * pw / (1.0 + slope * slope), 2.0) * 2.0;
  vec2 gh = -slope * g;                                // height gradient (height rises inward)
  // incised centre groove: a V cut along the centreline
  float gw = max(0.11 * hw, 0.55);
  float gm = 0.0, hl = 0.0;
#if GROOVE
  if (grooveOn > 0.5){
    float ad = abs(d);
    gm = clamp((gw - ad) / pw + 0.5, 0.0, 1.0) * smoothstep(kl + 0.5, kl + 2.5, -sdf);
    float side = sign(d) * sign(nF.y + 1e-4);          // > 0 where the groove wall faces up (lower wall)
    hl = clamp(min(ad - gw, gw + 1.1 - ad) / pw + 0.5, 0.0, 1.0) * step(0.0, side) * smoothstep(kl + 0.5, kl + 2.5, -sdf);
    float tg = clamp(1.0 - ad / (gw * 2.2), 0.0, 1.0);
    gh += 0.9 * tg * sign(d) * nF;
  }
#endif
  vec3 N = normalize(vec3(-gh, 1.0));
  float thick = smoothstep(1.5, 4.0, -sdf - kl);
  float s = knotGoldS(N, fpx, opx, thick, nvar + (grooveOn > 0.5 ? 0.02 : 0.0)) + extraS + 0.16 * hl;
  s *= ao * (1.0 - 0.55 * gm);
  vec3 c = goldRamp(s) * uTint;
  float gk = clamp(0.5 + (-sdf - kl) / pw, 0.0, 1.0);   // gold vs keyline
  c = mix(uKeyCol, c, gk);
  return vec4(c * cov, cov);
}
vec4 over(vec4 top, vec4 bot){ return top + bot * (1.0 - top.a); }
float smaxk(float a, float b, float k, out float h){ h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return mix(a, b, h) + k * h * (1.0 - h); }
`;

const VS_QUADS = HEADER_VS + `
uniform vec4 uQuads[5];
out vec2 vPx;
void main(){
  vec4 r = uQuads[gl_InstanceID];
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 px = r.xy + c * r.zw; vPx = px;
  gl_Position = clipOfPx(px);
}`;
const VS_RING = HEADER_VS + `
uniform vec4 uRingVS;   // cx, cy (frame px, after xform), rIn, rOut (frame px)
uniform float uSegs;
out vec2 vPx;
void main(){
  int seg = gl_VertexID >> 1; int outer = gl_VertexID & 1;
  float a = float(seg) / uSegs * 6.28318530718;
  float r = outer == 1 ? uRingVS.w / cos(3.14159265 / uSegs) : uRingVS.z;
  vec2 px = uRingVS.xy + r * vec2(cos(a), sin(a)); vPx = px;
  gl_Position = clipOfPx(px);
}`;

// ---- braid band (rectangle with corner roundels, or annulus). Compiled per variant: SwiftShader pays for every
// instruction of a shader whatever the branches, so unused paths are removed with #if, not skipped with if.
const BAND_BODY = `
uniform vec4 uBand;                    // rect centreline x, y, w, h
uniform vec4 uRing;                    // cx, cy, rMid, startAngle
uniform float uRot, uP;                // annulus weave rotation; loop perimeter (rect) or circumference (ring)
uniform float uHalfW, uAmp, uOmega, uHw, uGap, uKl, uReveal, uFilletW, uClipR, uGroove;
uniform vec4 uXf;                      // xform centre x, y, scale, rotation
uniform vec3 uTinct; uniform float uTinctA;
in vec2 vPx;
out vec4 o;

// closest point on a strand y = A sin(omega u + phase) to the band point (s, d): two Newton steps on the squared distance.
// S, C = sin, cos(omega s + phase); the offset u - s stays small, so sin/cos at u come from S, C rotated by a short
// Taylor series (trigonometry is expensive on the software rasteriser: one sin/cos pair per fragment for all strands)
void strandDist(float S, float C, float s, float d, out float sd, out vec2 nb){
  float du = 0.0, y = 0.0, dy = 0.0;
  for (int it = 0; it < 3; it++){
    float x = uOmega * du, x2 = x * x;
    float sx = x * (1.0 - x2 / 6.0 * (1.0 - x2 / 20.0)), cx = 1.0 - x2 * 0.5 * (1.0 - x2 / 12.0);
    float sa = S * cx + C * sx, ca = C * cx - S * sx;
    y = uAmp * sa; dy = uAmp * uOmega * ca;
    if (it == 2) break;
    float ddy = -uOmega * uOmega * y;
    float g = du + (y - d) * dy;
    float hh = 1.0 + dy * dy + (y - d) * ddy;
    du = clamp(du - clamp(g / max(hh, 0.2), -6.0, 6.0), -9.0, 9.0);
  }
  nb = normalize(vec2(-dy, 1.0));
  sd = dot(vec2(-du, d - y), nb);
}

void main(){
  vec2 fpx = vPx;
  mat2 RX = rot2(uXf.w);
  vec2 p = uXf.xy + rot2(-uXf.w) * (fpx - uXf.xy) / uXf.z;         // band space (frame px before the xform)
  float pw = max((fwidth(p.x) + fwidth(p.y)) * 0.75, 0.35);
  // band frame: along t, outward n, along coordinate s (pattern), reveal distance rd and its gradient
  vec2 t, n; float s, d, rd; vec2 grd; float clip = -1e5; vec2 gclip = vec2(0.0);
  vec2 opx;
#if RING
  {
    vec2 q = p - uRing.xy; float r = length(q);
    float ph = atan(q.y, q.x);
    n = q / max(r, 1e-4); t = vec2(-n.y, n.x);
    s = (ph - uRot) * uRing.z;                                 // weave coordinate (a whole number of periods)
    d = r - uRing.z;
    float al = mod(ph - (uRing.w + uRot) + PI, 6.28318530718) - PI;
    rd = abs(al) * uRing.z;
    grd = sign(al + 1e-6) * t;
    opx = vec2(s, d) + vec2(uRing.z * 0.37, 11.0);
  }
#else
  {
    vec2 c0 = uBand.xy, c1 = uBand.xy + uBand.zw;
    vec2 ctr = 0.5 * (c0 + c1);
    // nearest side (bottom, left, top, right), each walked in the direction of increasing loop distance
    float bx = clamp(p.x, c0.x, c1.x), by = clamp(p.y, c0.y, c1.y);
    float db = length(p - vec2(bx, c1.y)), dl = length(p - vec2(c0.x, by)), dt = length(p - vec2(bx, c0.y)), dr = length(p - vec2(c1.x, by));
    float m = min(min(db, dl), min(dt, dr));
#if MITRE
    // mitred corners: the side is chosen by the diagonal through the nearest corner (also outside the corner, where
    // the nearest-side rule ties), and each side is clipped on that diagonal so its strands, fillets and keyline end
    // in a clean picture-frame seam
    vec2 cc = vec2(p.x < ctr.x ? c0.x : c1.x, p.y < ctr.y ? c0.y : c1.y);
    vec2 sg = vec2(p.x < ctr.x ? -1.0 : 1.0, p.y < ctr.y ? -1.0 : 1.0);
    float ma = (p.x - cc.x) * sg.x, mb = (p.y - cc.y) * sg.y;   // > 0 outside the centreline rect, per axis
    bool horiz = mb > ma;
    m = horiz ? (p.y < ctr.y ? dt : db) : (p.x < ctr.x ? dl : dr);
    if (horiz){ db = p.y < ctr.y ? 1e9 : m; dt = p.y < ctr.y ? m : 1e9; dl = 1e9; dr = 1e9; }
    else { dl = p.x < ctr.x ? m : 1e9; dr = p.x < ctr.x ? 1e9 : m; db = 1e9; dt = 1e9; }
    clip = (horiz ? (ma - mb) : (mb - ma)) * 0.70710678 + 0.6;
    gclip = (horiz ? vec2(sg.x, -sg.y) : vec2(-sg.x, sg.y)) * 0.70710678;
#endif
    float W = uBand.z, H = uBand.w;
    float u;
    if (m == db){ t = vec2(-1.0, 0.0); n = vec2(0.0, 1.0); s = -(p.x - ctr.x); d = p.y - c1.y; u = s; }
    else if (m == dl){ t = vec2(0.0, -1.0); n = vec2(-1.0, 0.0); s = -(p.y - ctr.y); d = c0.x - p.x; u = 0.5 * W + (c1.y - p.y); }
    else if (m == dt){ t = vec2(1.0, 0.0); n = vec2(0.0, -1.0); s = p.x - ctr.x; d = c0.y - p.y; u = 0.5 * W + H + (p.x - c0.x); }
    else { t = vec2(0.0, 1.0); n = vec2(1.0, 0.0); s = p.y - ctr.y; d = p.x - c1.x; u = 1.5 * W + H + (p.y - c0.y); }
    float au = abs(u);
    rd = min(au, uP - au);
    grd = (au < uP - au ? sign(u + 1e-6) : -sign(u + 1e-6)) * t;
    opx = p;
#if CLIP
    // strands and fillets end under the corner roundels
    vec2 qc = p - vec2(p.x < ctr.x ? c0.x : c1.x, p.y < ctr.y ? c0.y : c1.y);
    float lc = length(qc);
    clip = uClipR - lc; gclip = -qc / max(lc, 1e-4);
#endif
  }
#endif
  // the pen front is a rounded cap centred on the tip (the fillets and keylines end behind it, never as square ticks)
  // and is feathered over 10 px; both flatten out as the two fronts meet so the closed band has no seam
  float meet = clamp((uP * 0.5 - uReveal) / (2.0 * (uHalfW + 2.0)), 0.0, 1.0);
  float capR = uHalfW + 2.0;
  float back = (capR - sqrt(max(capR * capR - d * d, 0.0))) * meet;
  float o_ = rd - (uReveal - back);                             // > 0 beyond the pen
  float frontFade = 1.0 - smoothstep(-10.0 * meet - 1e-3, 0.0, o_) * step(1e-3, meet);
  float wetS = uWet * exp(-max(uReveal - rd, 0.0) / 40.0) * step(uReveal, uP * 0.4999) * step(o_, 0.0);
  vec2 lo = normalize(fpx - uKey.xy) * 2.6;                    // drop-shadow offset, away from the key light
  vec2 nFr = RX * n, gR = RX * grd, gC = RX * gclip;
  vec4 col = vec4(0.0);
#if TINCT
  {
    // tincture ground between the fillets: matte pigment with a little grain
    float gEdge = uHalfW - (FILLET == 1 ? 2.0 * uFilletW + 0.6 : 0.0);
    float sdG = max(max(abs(d) - gEdge, o_ > 0.0 ? o_ : -1e5), clip);
    float cg = clamp(0.5 - sdG / pw, 0.0, 1.0) * uTinctA;
    vec4 lf = texture(uLeaf, opx / 576.0 * 1.7 + 0.31);
    float pig = 0.84 + 0.30 * lf.g + 0.10 * (lf.b - 0.5) - 0.05 * lf.a;
    col = vec4(uTinct * pig * cg, cg);
  }
#endif
  // the visible ribbon: nearest of the strands (cut under their over strand) and the fillets
  float best = 1e5, bD = 0.0, bHw = uHw, bKl = uKl, bAo = 1.0, bGr = uGroove; vec2 bG = vec2(0.0, 1.0), bN = nFr;
  float sh = 0.0;
#if NSTR > 0
  float sdK[NSTR]; vec2 gK[NSTR]; float dK[NSTR]; vec2 nK[NSTR]; float dcK[NSTR]; vec2 gdcK[NSTR];
  float S0 = sin(uOmega * s), C0 = cos(uOmega * s);
  for (int k = 0; k < NSTR; k++){
    float ph = NSTR == 2 ? PI * float(k) : 6.28318530718 * float(k) / float(NSTR);
    float cp = k == 0 ? 1.0 : NSTR == 2 ? -1.0 : -0.5, sp = k == 0 || NSTR == 2 ? 0.0 : (k == 1 ? 0.86602540378 : -0.86602540378);
    float sd; vec2 nb;
    strandDist(S0 * cp + C0 * sp, C0 * cp - S0 * sp, s, d, sd, nb);
    vec2 nF = RX * (nb.x * t + nb.y * n);                     // strand normal in frame space
    float dcen; vec2 gcen;
    if (o_ > 0.0){ dcen = length(vec2(o_, sd)); gcen = (o_ * gR + sd * nF) / max(dcen, 1e-4); }
    else { dcen = abs(sd); gcen = sign(sd + 1e-6) * nF; }
    dcK[k] = dcen; gdcK[k] = gcen;
    float sdf = dcen - uHw; vec2 g = gcen;
    if (clip > sdf){ sdf = clip; g = gC; }
    sdK[k] = sdf; gK[k] = g; dK[k] = sd; nK[k] = nF;
  }
  for (int k = 0; k < NSTR; k++){
#if NSTR == 3
    int j = k == 2 ? 0 : k + 1;                                // (k+1) mod 3 passes over k: the plait
#elif NSTR == 2
    float m = floor(uOmega * s / PI + 0.5);                    // the rising strand passes over: the twist
    int ov = mod(m, 2.0) < 0.5 ? 0 : 1;
    int j = k == ov ? -1 : ov;
#else
    int j = -1;
#endif
    float ao = 1.0;
    if (j >= 0){
      float dj = j == 0 ? dcK[0] : j == 1 ? dcK[min(1, NSTR - 1)] : dcK[NSTR - 1];
      vec2 gj = j == 0 ? gdcK[0] : j == 1 ? gdcK[min(1, NSTR - 1)] : gdcK[NSTR - 1];
      float hh;
      float ns = smaxk(sdK[k], (uHw + uGap) - dj, 1.2, hh);
      gK[k] = normalize(mix(gK[k], -gj, hh));
      sdK[k] = ns;
      ao = 1.0 - 0.42 * (1.0 - smoothstep(uHw + uGap, uHw + uGap + min(7.0, 1.6 * uHw), dj));
    }
    float so = sdK[k] - dot(gK[k], lo);
    sh = max(sh, 1.0 - smoothstep(-1.0, 3.5, so));
    if (sdK[k] < best){ best = sdK[k]; bG = gK[k]; bD = dK[k]; bN = nK[k]; bAo = ao; }
  }
#endif
#if FILLET
  {
    float off = uHalfW - uFilletW;
    float dd = abs(d - off) < abs(d + off) ? d - off : d + off;
    float dcen; vec2 gcen;
    if (o_ > 0.0){ dcen = length(vec2(o_, dd)); gcen = (o_ * gR + dd * nFr) / max(dcen, 1e-4); }
    else { dcen = abs(dd); gcen = sign(dd + 1e-6) * nFr; }
    float sdF = dcen - uFilletW; vec2 gF = gcen;
    if (clip > sdF){ sdF = clip; gF = gC; }
    sh = max(sh, 0.7 * (1.0 - smoothstep(-0.5, 2.0, sdF - dot(gF, lo))));
    if (sdF < best){ best = sdF; bG = gF; bD = dd; bN = nFr; bAo = 1.0; bHw = uFilletW; bKl = min(uKl, uFilletW * 0.45); bGr = 0.0; }
  }
#endif
  // drop shadows of the strands and fillets on the ground and on whatever is behind the band
  col.rgb *= 1.0 - 0.6 * sh;
  col.a += sh * uShadow * (1.0 - col.a);
  // the ribbons never overlap (under strands are cut clear of the over strand): one gold evaluation per fragment
  vec4 r = ribbon(best, bG, bD, bN, bHw, bKl, pw, bGr, bAo, wetS, fpx, opx);
  o = over(r, col) * uOpacity * frontFade;
}`;
const fsBand = defs => frag(defs + COMMON_GLSL + BAND_BODY);

// ---- roundel base: tincture field, red-lead rule, gold ring (the knot inside is drawn with FS_KNOT)
const ROUNDEL_BODY = `
uniform vec4 uR;          // cx, cy, size (diameter), progress
uniform float uEntry, uKl;
uniform vec3 uField, uRule;
uniform vec4 uXf;
in vec2 vPx;
out vec4 o;
void main(){
  vec2 fpx = vPx;
  vec2 p = uXf.xy + rot2(-uXf.w) * (fpx - uXf.xy) / uXf.z;
  float pw = max((fwidth(p.x) + fwidth(p.y)) * 0.75, 0.35);
  float S = uR.z / 88.0;
  vec2 q = p - uR.xy; float r = length(q);
  vec2 n = q / max(r, 1e-4);
  float pr = uR.w;
  // ring draws both ways from the entry angle over the first 60% of the roundel's progress
  float al = mod(atan(q.y, q.x) - uEntry + PI, 6.28318530718) - PI;
  float rr = 39.0 * S, hw = 4.0 * S;
  float ringRev = clamp(pr / 0.6, 0.0, 1.0) * PI;
  float o_ = (abs(al) - ringRev) * rr;
  vec2 tdir = vec2(-n.y, n.x) * sign(al + 1e-6);
  float dd = r - rr;
  float dcen; vec2 gcen;
  if (o_ > 0.0 && ringRev < PI * 0.999){ dcen = length(vec2(o_, dd)); gcen = (o_ * tdir + dd * n) / max(dcen, 1e-4); }
  else { dcen = abs(dd); gcen = sign(dd + 1e-6) * n; }
  gcen = rot2(uXf.w) * gcen;
  float sdRing = dcen - hw;
  // field (verdigris) and the red-lead rule just inside the ring
  // the tincture field and rule come in with the roundel's own knot (never as a flat disc before the knotwork)
  float fa = pow(clamp((pr - 0.22) / 0.78, 0.0, 1.0), 1.5);
  float rf = rr - hw - 1.0 * S;
  float cf = clamp(0.5 - (r - rf) / pw, 0.0, 1.0) * fa;
  vec2 opx = q / S + 40.0;
  float pig = 0.84 + 0.30 * fbm(opx * 0.12 + 7.0, 3) - 0.05 * vn(opx * 1.1);
  // pigment pools darker toward the rim and is lit a little from the key
  float rim = smoothstep(rf * 0.55, rf, r);
  vec2 kd = normalize(uKey.xy - fpx);
  float lit = 0.92 + 0.12 * dot(-n, kd) * smoothstep(0.0, rf, r);
  vec3 fc = uField * pig * (1.0 - 0.28 * rim) * lit;
  float ruleW = 1.15 * S;
  float sdRule = abs(r - (rf - ruleW - 0.4 * S)) - ruleW;
  float cr = clamp(0.5 - sdRule / pw, 0.0, 1.0) * fa;
  vec4 col = vec4(fc * cf, cf);
  col = over(vec4(uRule * pig * cr, cr), col);
  // ring shadow on the field and the band
  vec2 lo = normalize(fpx - uKey.xy) * 2.6;
  float so = sdRing - dot(gcen, lo);
  float sh = (1.0 - smoothstep(-1.0, 3.5, so)) * step(0.001, pr);
  col.rgb *= 1.0 - 0.55 * sh;
  col.a += sh * uShadow * (1.0 - col.a);
  float wetS = uWet * (1.0 - smoothstep(0.6, 1.0, pr)) * exp(-max(ringRev * rr - abs(al) * rr, 0.0) / 30.0);
  vec4 ring = ribbon(sdRing, gcen, dd, rot2(uXf.w) * n, hw, uKl, pw, 1.0, 1.0, wetS, fpx, opx);
  col = over(ring, col);
  o = col * uOpacity;
}`;
const fsRoundel = defs => frag(defs + COMMON_GLSL + ROUNDEL_BODY);

// ---- closed knot from the 8B data texture
const KNOT_BODY = `
uniform sampler2D uData; uniform vec2 uDW;      // one layer's width, height (texels)
uniform vec4 uXf;                               // frame centre x, y, scale, rotation
uniform vec2 uOrigin;                           // the knot centre in texture px
uniform float uL, uHw, uClear, uKl, uLen, uFlare, uFlareI, uGroove, uStyle, uThreadI, uGlow, uReach;
uniform vec4 uFlareAx;                          // centre x, y (texture px), half extent, unused
uniform vec3 uThreadC, uGlowC;
in vec2 vPx;
out vec4 o;
// one passage: distance from q to the revealed centreline near this texel's nearest point
bool passage(vec4 T, vec2 q, out float dc, out vec2 gdc, out float d, out vec2 nT, out float a, out float behind, out int flag){
  flag = 0; dc = 1e5; gdc = vec2(0.0); d = 0.0; nT = vec2(0.0, 1.0); a = 0.0; behind = 1e5;
  if (T.w < 0.0) return false;
  float ang = T.z;
  if (ang > 8.0){ flag = 1; ang -= 16.0; }
  vec2 t = vec2(cos(ang), sin(ang)); nT = vec2(-t.y, t.x);
  vec2 v = q - T.xy;
  float al = dot(v, t); d = dot(v, nT);
  a = mod(T.w + al, uL);
  float oo = 0.0, sg = 0.0;
  if (a > uLen){ float f = a - uLen, b = uL - a; if (f < b){ oo = f; sg = 1.0; } else { oo = b; sg = -1.0; } }
  behind = uLen - a;
  if (oo > 0.0){ dc = length(vec2(oo, d)); gdc = (oo * sg * t + d * nT) / max(dc, 1e-4); }
  else { dc = abs(d); gdc = sign(d + 1e-6) * nT; }
  return true;
}
void main(){
  vec2 fpx = vPx;
  mat2 R = rot2(uXf.w);
  vec2 q = uOrigin + rot2(-uXf.w) * (fpx - uXf.xy) / uXf.z;
  if (q.x < 0.0 || q.y < 0.0 || q.x >= uDW.x || q.y >= uDW.y){ o = vec4(0.0); return; }
  ivec2 ip = ivec2(floor(q));
  vec4 TA = texelFetch(uData, ip, 0), TB = texelFetch(uData, ip + ivec2(int(uDW.x), 0), 0);
  float pw = max((fwidth(q.x) + fwidth(q.y)) * 0.75, 0.3);
  float dcA, dA, aA, bA, dcB, dB, aB, bB; vec2 gA, nA, gB, nB; int fA, fB;
  bool hA = passage(TA, q, dcA, gA, dA, nA, aA, bA, fA);
  bool hB = passage(TB, q, dcB, gB, dB, nB, aB, bB, fB);
  if (!hA){ o = vec4(0.0); return; }
  float cut = 1e5; vec2 gcut = vec2(0.0);
  if (hB && fB == 1){ cut = uClear - dcA; gcut = -gA; }
#if THREAD
  {
    // thread: a thin glowing line, additive; the under passage fades out inside the gap
    // the glow is windowed to zero well inside the texture's reach, so the data texture's edge never shows
    float lA = clamp(0.5 - (dcA - uHw) / pw, 0.0, 1.0);
    float wA = 1.0 - smoothstep(uReach * 0.45, uReach * 0.9, dcA);
    vec3 c = uThreadC * lA + uGlowC * uGlow * (0.45 * exp(-dcA / 1.6) + 0.12 * exp(-dcA / 4.0)) * wA;
    if (hB){
      float gate = fB == 1 ? smoothstep(uClear - 0.8, uClear + 0.8, dcA) : 1.0;
      float lB = clamp(0.5 - (dcB - uHw) / pw, 0.0, 1.0);
      float wB = 1.0 - smoothstep(uReach * 0.45, uReach * 0.9, dcB);
      c += (uThreadC * lB + uGlowC * uGlow * (0.45 * exp(-dcB / 1.6) + 0.12 * exp(-dcB / 4.0)) * wB) * gate;
    }
    o = vec4(c * uThreadI * uOpacity, 0.0);
  }
#else
  // flare: a broad diagonal band of light sweeping the whole knot once (0 -> 1)
  float fl = 0.0;
  if (uFlareI > 0.0 && uFlare > 0.0 && uFlare < 1.0){
    vec2 rel = q - uFlareAx.xy;
    float x = dot(rel, normalize(vec2(1.0, 0.55))) / uFlareAx.z;
    float pos = mix(-1.25, 1.25, uFlare);
    fl = uFlareI * exp(-pow((x - pos) / 0.16, 2.0)) * sin(PI * uFlare);
  }
  vec2 opx = q;
  float wet = uWet * step(uLen, uL * 0.9999);
  // under passage (cut by the drawn over passage), then the over passage on top
  vec4 col = vec4(0.0);
  float shA = 0.0, shB = 0.0;
  vec2 lo = normalize(fpx - uKey.xy) * 2.4 / uXf.z;
  vec2 loT = rot2(-uXf.w) * lo;
  float sdfA = dcA - uHw;
  float sdfB = 1e5, hh = 0.0; vec2 g = gB; float ao = 1.0;
  if (hB){
    sdfB = dcB - uHw;
    if (fB == 1){ sdfB = smaxk(sdfB, cut, 1.0, hh); g = normalize(mix(gB, gcut, hh)); }
    ao = fB == 1 ? 1.0 - 0.42 * (1.0 - smoothstep(uClear, uClear + min(7.0, 1.6 * uHw), dcA)) : 1.0;
    shB = 1.0 - smoothstep(-1.0, 3.5, sdfB - dot(g, loT));
  }
  shA = 1.0 - smoothstep(-1.0, 3.5, sdfA - dot(gA, loT));
  float sh = max(shA, shB);
  // drop shadow on whatever is behind
  col.a = sh * uShadow;
  // the passages never overlap (the under one is cut clear of the over one): shade only the nearer one
  bool tA = sdfA <= sdfB;
  float bS = tA ? sdfA : sdfB, bD = tA ? dA : dB, bAo = tA ? 1.0 : ao, bb = tA ? bA : bB;
  vec2 bG = tA ? gA : g, bN = tA ? nA : nB;
  float e = wet * exp(-max(bb, 0.0) / 50.0) * step(0.0, bb) + fl;
  vec4 r = ribbon(bS, R * bG, bD, R * bN, uHw, uKl, pw, uGroove, bAo, e, fpx, opx);
  o = over(r, col) * uOpacity;
#endif
}`;
const fsKnot = defs => frag(defs + COMMON_GLSL + KNOT_BODY);

// ---- the periodic leaf texture (rendered once): the noises of gold.js goldS at the same scales, made tileable
const FS_LEAF = frag(`
out vec4 o;
float hp(vec2 c, float P){ c = mod(c, P); return h12(c + 0.5); }
vec2 hp2(vec2 c, float P){ c = mod(c, P); return h22(c + 0.5); }
float vnp(vec2 p, float P){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hp(i, P), hp(i + vec2(1, 0), P), u.x), mix(hp(i + vec2(0, 1), P), hp(i + vec2(1, 1), P), u.x), u.y);
}
float fbmp(vec2 p, float P){ float a = 0.5, s = 0.0, w = 0.0; for (int i = 0; i < 3; i++){ s += a * vnp(p, P); w += a; p *= 2.0; P *= 2.0; a *= 0.5; } return s / w; }
float vorp(vec2 p, float P){
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++){
    vec2 g = vec2(x, y); vec2 q = hp2(i + g, P);
    float d = length(g + q - f);
    if (d < d1){ d2 = d1; d1 = d; } else if (d < d2){ d2 = d; }
  }
  return d2 - d1;
}
void main(){
  vec2 px = gl_FragCoord.xy;                 // 0..576
  float T = 576.0;
  o = vec4(vorp(px / 18.0, 32.0), fbmp(px * 10.0 / T + 0.0, 10.0), fbmp(px * 4.0 / T, 4.0), vnp(px * 259.0 / T, 259.0));
}`);

// ---- pen tip and ring sprites (additive)
const VS_SPRITE = HEADER_VS + `
uniform vec4 uS;   // x, y, half size
out vec2 vPx;
void main(){
  vec2 c = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1)) * 2.0 - 1.0;
  vec2 px = uS.xy + c * uS.z; vPx = px;
  gl_Position = clipOfPx(px);
}`;
const FS_TIP = frag(`
uniform vec4 uS; uniform float uI, uSz; uniform vec3 uHot, uWarm;
in vec2 vPx;
out vec4 o;
void main(){
  vec2 d = (vPx - uS.xy) / uSz;
  float r = length(d);
  // a small, warm, soft point: no cross spikes (the stars are the only cross-shaped lights)
  float core = exp(-r * r / (2.0 * 2.2 * 2.2));
  float halo = exp(-r / 4.5) * 0.45 + exp(-r / 14.0) * 0.07;
  float win = 1.0 - smoothstep(0.45, 1.0, length(vPx - uS.xy) / uS.z);   // falls to 0 inside the quad
  o = vec4((mix(uWarm, uHot, 0.55) * core * 1.3 + uWarm * halo) * uI * win, 0.0);
}`);
const FS_RINGL = frag(`
uniform vec4 uS; uniform float uR, uW, uI; uniform vec3 uC;
in vec2 vPx;
out vec4 o;
void main(){
  float r = length(vPx - uS.xy);
  float x = (r - uR) / max(uW, 0.5);
  float v = exp(-x * x) + 0.25 * exp(-abs(x) * 0.6) * step(r, uR);
  v *= 1.0 - smoothstep(uS.z * 0.8, uS.z, r);
  o = vec4(uC * v * uI, 0.0);
}`);

// ------------------------------------------------------------------------------------------------ GL module
function lookParams(look) {
  const p = JSON.parse(JSON.stringify(DEFAULTS));
  const L = LOOKS[look] || {};
  (function m(d, s) { for (const k in s) { const v = s[k]; if (v && typeof v === 'object' && !Array.isArray(v) && d[k] && typeof d[k] === 'object') m(d[k], v); else d[k] = Array.isArray(v) ? v.slice() : v; } })(p, L);
  return p;
}
const _colCache = new Map();
function sceneCol(hex, look) {
  const key = hex + '|' + look;
  if (!_colCache.has(key)) _colCache.set(key, displayToScene(hex, lookParams(look)));
  return _colCache.get(key);
}

export function createKnot(G, gold) {
  const gl = G.gl, U = G.U;
  const P = {
    tip: G.program('knot.tip', FS_TIP, VS_SPRITE),
    ringL: G.program('knot.ringlight', FS_RINGL, VS_SPRITE),
  };
  // compile-time variants (see BAND_BODY): {name: value} -> '#define NAME value' lines
  const variants = new Map();
  function variantProg(kind, D) {
    const key = kind + JSON.stringify(D);
    if (!variants.has(key)) {
      const defs = Object.keys(D).map(k => `#define ${k} ${D[k]}`).join('\n') + '\n';
      const src = kind === 'band' || kind === 'ring' ? fsBand(defs) : kind === 'roundel' ? fsRoundel(defs) : fsKnot(defs);
      variants.set(key, G.program('knot.' + kind + key, src, kind === 'ring' ? VS_RING : VS_QUADS));
    }
    return variants.get(key);
  }
  const leaf = G.target('knot.leaf', 576, 576, { format: 'rgba16f', wrap: 'repeat', filter: 'linear' });
  G.draw(G.program('knot.leafgen', FS_LEAF), {}, leaf);
  const K = { band: {} };
  const rampOf = look => GOLD_RAMPS[look || 'winter_gold'] || GOLD_RAMPS.winter_gold;
  const hot = () => GOLD_RAMPS.winter_gold[6];
  const warm = () => GOLD_RAMPS.winter_gold[3];

  function common(o, rectForKey, hw = 7) {
    const look = o.look || 'winter_gold';
    const r = rectForKey;
    const key = o.key || [r[0] + r[2] * 0.2, r[1] - r[3] * 0.6];
    const fill = o.fill || [r[0] + r[2] * 0.5, r[1] + r[3]];
    const sw = o.sweep ? [o.sweep.x, o.sweep.width || 80, o.sweep.I == null ? 1 : o.sweep.I, o.sweep.slant == null ? 0.3 : o.sweep.slant] : [0, 1, 0, 0];
    return {
      uRamp: rampOf(look), uKey: [key[0], key[1], o.keyZ || 260 * U], uKeyI: o.keyI == null ? 4 : o.keyI,
      uFill: [fill[0], fill[1], o.fillZ || 260 * U], uFillI: o.fillI || 0, uDetail: o.detail == null ? Math.max(0.1, Math.min(0.75, (hw - 2.5) / 5)) : o.detail,
      uOpacity: o.opacity == null ? 1 : o.opacity, uShadow: o.shadow == null ? 0.5 : o.shadow, uWet: o.wet == null ? 0.9 : o.wet,
      uKeyCol: sceneCol(o.outline || '#2A1A06', look), uTint: o.tint || [1, 1, 1], uSweep: sw,
      uCushion: o.cushion == null ? 1 : o.cushion, uSpecK: o.specular == null ? 1.6 : o.specular, uLeaf: leaf,
      uSweepY: o.sweep && o.sweep.y != null ? o.sweep.y : r[1] + r[3] * 0.5,
    };
  }
  function xf(o) {
    const x = o.xform || {};
    const c = x.center || [G.W / 2, G.H / 2];
    return { arr: [c[0], c[1], x.scale || 1, x.rotation || 0], c, sc: x.scale || 1, rot: x.rotation || 0 };
  }
  function xfPt(X, p) {
    const dx = p[0] - X.c[0], dy = p[1] - X.c[1], c = Math.cos(X.rot), s = Math.sin(X.rot);
    return [X.c[0] + X.sc * (c * dx - s * dy), X.c[1] + X.sc * (s * dx + c * dy)];
  }
  function xfRect(X, r) {   // AABB of a transformed rect
    const pts = [[r[0], r[1]], [r[0] + r[2], r[1]], [r[0], r[1] + r[3]], [r[0] + r[2], r[1] + r[3]]].map(p => xfPt(X, p));
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    return [x0, y0, Math.max(...xs) - x0, Math.max(...ys) - y0];
  }

  K.penTip = function (target, { x, y, I = 5, size = 1 } = {}) {
    const sz = size * U;
    // intensity saturates (2.6 max): a nib is a soft working light, never a flare that triggers the anamorphic streak
    const Ie = 2.6 * (1 - Math.exp(-Math.max(0, I) / 2.6));
    G.draw(P.tip, { uS: [x, y, 48 * sz, 0], uI: Ie, uSz: sz, uHot: hot(), uWarm: warm() }, target, { blend: 'add', mode: gl.TRIANGLE_STRIP, count: 4 });
  };
  K.ring = function (target, { center, r, width = 10, I = 1, color = null } = {}) {
    const ext = r + width * 6 + 8;
    G.draw(P.ringL, { uS: [center[0], center[1], ext, 0], uR: r, uW: width, uI: I, uC: color ? sceneCol(color, 'winter_gold') : warm() }, target, { blend: 'add', mode: gl.TRIANGLE_STRIP, count: 4 });
  };

  // ---- rectangle band
  const rectGeom = o => {
    const r = o.rect, W = r[2], H = r[3];
    return { r, W, H, P: 2 * (W + H) };
  };
  K.band.rectPerimeter = o => rectGeom(o).P;
  K.band.rectPoint = function (o, u) {
    const { r, W, H, P: Pm } = rectGeom(o);
    const cx = r[0] + W / 2, x0 = r[0], x1 = r[0] + W, y0 = r[1], y1 = r[1] + H;
    // positive u: left along the bottom, up the left side, right along the top (the negative way mirrors it)
    const sgn = u < 0 ? -1 : 1; let a = Math.min(Math.abs(u), Pm / 2);
    let px, py;
    if (a <= W / 2) { px = cx - a; py = y1; }
    else if (a <= W / 2 + H) { px = x0; py = y1 - (a - W / 2); }
    else { px = x0 + (a - W / 2 - H); py = y0; }
    if (sgn < 0) px = 2 * cx - px;
    const p = [px, py];
    return o.xform ? xfPt(xf(o), p) : p;
  };
  K.band.rect = function (target, o) {
    const { r, W, H, P: Pm } = rectGeom(o);
    const width = o.width || 54, hw = o.halfWidth || 7, strands = o.strands == null ? 3 : o.strands;
    const amp = o.amp == null ? 14 : o.amp, omega = o.omega || TAU / 72, gap = o.gap == null ? 2.5 : o.gap;
    const prog = o.progress == null ? 1 : Math.max(0, Math.min(1, o.progress));
    const reveal = prog * Pm / 2;
    const rs = o.roundelSize || 88, roundels = o.roundels !== false;
    const X = xf(o);
    const half = width / 2 + 4;
    const sides = [[r[0] - half, r[1] + H - half, W + 2 * half, 2 * half], [r[0] - half, r[1] - half, 2 * half, H + 2 * half],
      [r[0] - half, r[1] - half, W + 2 * half, 2 * half], [r[0] + W - half, r[1] - half, 2 * half, H + 2 * half]];
    const quads = [];
    // split long sides into the revealed parts only (cheap when the band is still drawing)
    for (const q of sides) quads.push(...xfRect(X, q));
    const kl = o.keyline == null ? 1.25 : o.keyline;
    const tinct = o.tincture ? sceneCol(o.tincture, o.look || 'winter_gold') : [0, 0, 0];
    if (prog > 0) {
      const pr = variantProg('band', { RING: 0, NSTR: strands, TINCT: o.tincture ? 1 : 0, FILLET: o.fillets === false ? 0 : 1, CLIP: roundels ? 1 : 0,
        MITRE: !roundels && o.mitre !== false ? 1 : 0, FILL: o.fillI ? 1 : 0, GROOVE: o.groove === false ? 0 : 1 });
      G.draw(pr, Object.assign(common(o, r, hw), {
        uQuads: quads, uBand: r, uRing: [0, 0, 0, 0], uRot: 0, uP: Pm,
        uHalfW: width / 2, uAmp: amp, uOmega: omega, uHw: hw, uGap: gap, uKl: kl, uReveal: reveal,
        uFilletW: o.filletWidth || 1.15, uClipR: roundels ? rs / 2 - 1 : 0, uGroove: o.groove === false ? 0 : 1,
        uXf: X.arr, uTinct: tinct, uTinctA: o.tincture ? (o.tinctureAlpha == null ? 1 : o.tinctureAlpha) : 0,
      }), target, { blend: 'premul', mode: gl.TRIANGLE_STRIP, count: 4, instances: 4 });
    }
    // corner roundels draw as a tip passes: loop distance of each corner from the start
    const cornerU = [W / 2, W / 2 + H, W / 2 + H, W / 2];   // bl, tl, tr, br (each reached by one of the two tips)
    // the band's own pen tips: a roundel's knot shows no second glint while a band tip is within 60 px (one per tip)
    const bandTips = prog > 0 && prog < 1 && o.tips !== false ? [K.band.rectPoint(o, reveal), K.band.rectPoint(o, -reveal)] : [];
    const corners = [[r[0], r[1] + H], [r[0], r[1]], [r[0] + W, r[1]], [r[0] + W, r[1] + H]];
    const span = o.roundelSpan || 300;
    const rps = [];
    if (roundels) {
      for (let i = 0; i < 4; i++) {
        const rp = o.roundelProgress ? o.roundelProgress[i] : Math.max(0, Math.min(1, (reveal - (cornerU[i] - rs * 0.5)) / span));
        rps.push(rp);
        if (rp <= 0) continue;
        // the tip arrives from the side it travelled along: bl/br from the bottom side, tl/tr from the vertical sides
        const entry = [0, Math.PI / 2, Math.PI / 2, Math.PI][i];
        K.roundel(target, Object.assign({}, o, { center: corners[i], size: rs, progress: rp, rotation: [Math.PI * 1.5, 0, Math.PI * 0.5, Math.PI][i], entry, tipAvoid: bandTips,
          field: (o.roundelTinctures && o.roundelTinctures.field) || '#2F7D6B', rule: (o.roundelTinctures && o.roundelTinctures.rule) || '#C2452D' }));
      }
    }
    const tips = [K.band.rectPoint(o, reveal), K.band.rectPoint(o, -reveal)];
    if (o.tips !== false && prog > 0 && prog < 1) for (const t of tips) K.penTip(target, { x: t[0], y: t[1], I: o.tipI == null ? 5 : o.tipI, size: X.sc });
    return { tips, roundels: rps, perimeter: Pm };
  };

  // ---- annulus band
  K.band.annulus = function (target, o) {
    const [cx, cy] = o.center, r0 = o.r0, r1 = o.r1, rm = 0.5 * (r0 + r1), Wd = r1 - r0;
    const strands = o.strands == null ? 2 : o.strands;
    const fw = o.filletWidth || 0.95, fil = o.fillets !== false;
    const hw = o.halfWidth || Math.max(2.5, Math.min(7, 0.13 * Wd));
    const amp = o.amp == null ? Math.max(1, Wd / 2 - (fil ? 2 * fw + 1.4 : 1) - hw) : o.amp;
    const lam = (o.omega ? TAU / o.omega : TAU * amp / (strands === 3 ? 1.25 : 1.0));
    const nPer = Math.max(3, Math.round(TAU * rm / lam));
    const omega = nPer / rm;   // whole number of periods round the circle (an even number of crossings for 2 strands)
    const gap = o.gap == null ? Math.max(1.2, 0.3 * hw + 0.5) : o.gap;
    const prog = o.progress == null ? 1 : Math.max(0, Math.min(1, o.progress));
    const reveal = prog * Math.PI * rm;
    const start = o.startAngle == null ? -Math.PI / 2 : o.startAngle, rot = o.rotation || 0;
    const X = xf(o);
    const C = xfPt(X, [cx, cy]);
    const segs = Math.max(64, Math.min(720, Math.round(TAU * r1 * X.sc / 6)));
    const kl = o.keyline == null ? Math.min(1.1, 0.26 * hw) : o.keyline;
    const tinct = o.tincture ? sceneCol(o.tincture, o.look || 'winter_gold') : [0, 0, 0];
    if (prog > 0) {
      const groove = o.groove == null ? (hw >= 4 ? 1 : 0) : (o.groove ? 1 : 0);
      const pr = variantProg('ring', { RING: 1, NSTR: strands, TINCT: o.tincture ? 1 : 0, FILLET: fil ? 1 : 0, CLIP: 0, MITRE: 0, FILL: o.fillI ? 1 : 0, GROOVE: groove });
      G.draw(pr, Object.assign(common(o, [cx - r1, cy - r1, 2 * r1, 2 * r1], hw), {
        uRingVS: [C[0], C[1], Math.max(0, (r0 - 6) * X.sc), (r1 + 6) * X.sc], uSegs: segs,
        uBand: [0, 0, 0, 0], uRing: [cx, cy, rm, start], uRot: rot, uP: TAU * rm,
        uHalfW: Wd / 2, uAmp: amp, uOmega: omega, uHw: hw, uGap: gap, uKl: kl, uReveal: reveal,
        uFilletW: fw, uClipR: 0, uGroove: groove,
        uXf: X.arr, uTinct: tinct, uTinctA: o.tincture ? (o.tinctureAlpha == null ? 1 : o.tinctureAlpha) : 0,
      }), target, { blend: 'premul', mode: gl.TRIANGLE_STRIP, count: 2 * (segs + 1) });
    }
    const a1 = start + rot + reveal / rm, a2 = start + rot - reveal / rm;
    const tips = [xfPt(X, [cx + rm * Math.cos(a1), cy + rm * Math.sin(a1)]), xfPt(X, [cx + rm * Math.cos(a2), cy + rm * Math.sin(a2)])];
    if (o.tips !== false && prog > 0 && prog < 1) for (const t of tips) K.penTip(target, { x: t[0], y: t[1], I: o.tipI == null ? 4 : o.tipI, size: 0.8 * X.sc });
    return { tips, periods: nPer, amp, halfWidth: hw };
  };

  // ---- closed knot texture and drawing
  K.texture = function (knot, { ribbon = 14, gapFactor = 2.2, reach = null, thread = false } = {}) {
    const hw = ribbon / 2, clear = gapFactor * ribbon / 2;
    const rc = reach || knotReach(ribbon, gapFactor, thread);
    const D = buildKnotData(knot, { reach: rc });
    const tex = G.dataTexture(2 * D.w, D.h, D.data, { format: 'rgba32f', filter: 'nearest' });
    return { tex, w: D.w, h: D.h, x0: D.x0, y0: D.y0, L: knot.L, knot, ribbon, clear, center: knot.center, stats: D.stats, reach: rc };
  };
  K.tipAt = function (kt, progress, o = {}) {
    const k = kt.knot || kt;
    const s = ((progress % 1) + 1) % 1 * k.L;
    const i = Math.min(k.n - 1, Math.floor(s / k.L * k.n)), j = (i + 1) % k.n, f = s / k.L * k.n - i;
    const p = [k.pts[2 * i] + (k.pts[2 * j] - k.pts[2 * i]) * f, k.pts[2 * i + 1] + (k.pts[2 * j + 1] - k.pts[2 * i + 1]) * f];
    const ctr = o.center || k.center, sc = o.scale || 1, rot = o.rotation || 0;
    const dx = p[0] - k.center[0], dy = p[1] - k.center[1], c = Math.cos(rot), sn = Math.sin(rot);
    return [ctr[0] + sc * (c * dx - sn * dy), ctr[1] + sc * (sn * dx + c * dy)];
  };
  K.draw = function (target, kt, o = {}) {
    let ctr = o.center || kt.center, sc = o.scale || 1;
    const rot = o.rotation || 0;
    if (o.rect) { sc = o.rect[2] / kt.w; ctr = [o.rect[0] + o.rect[2] / 2 + (kt.center[0] - (kt.x0 + kt.w / 2)) * sc, o.rect[1] + o.rect[3] / 2 + (kt.center[1] - (kt.y0 + kt.h / 2)) * sc]; }
    const prog = o.progress == null ? 1 : Math.max(0, Math.min(1, o.progress));
    if (prog <= 0) return { tip: null };
    const X = { c: ctr, sc, rot };
    // texture box in frame px: knot coords (x0..x0+w) placed so that kt.center lands on ctr
    const box = [ctr[0] + (kt.x0 - kt.center[0]) * 1, ctr[1] + (kt.y0 - kt.center[1]) * 1, kt.w, kt.h];
    const quad = xfRect(X, box);
    const thread = o.style === 'thread';
    const hw = thread ? (o.width || kt.ribbon) / 2 : kt.ribbon / 2;
    const look = o.look || 'winter_gold';
    const bb = kt.knot.bbox;
    const keyRect = [ctr[0] - (bb[2] - bb[0]) / 2 * sc, ctr[1] - (bb[3] - bb[1]) / 2 * sc, (bb[2] - bb[0]) * sc, (bb[3] - bb[1]) * sc];
    const kgroove = o.groove == null ? (kt.ribbon >= 9 ? 1 : 0) : (o.groove ? 1 : 0);
    const pr = variantProg('knot', { THREAD: thread ? 1 : 0, FILL: o.fillI ? 1 : 0, GROOVE: kgroove });
    G.draw(pr, Object.assign(common(o, keyRect, hw * sc), {
      uQuads: quad, uData: kt.tex, uDW: [kt.w, kt.h], uXf: [ctr[0], ctr[1], sc, rot], uOrigin: [kt.center[0] - kt.x0, kt.center[1] - kt.y0],
      uL: kt.L, uHw: hw, uClear: o.clear || kt.clear, uKl: o.keyline == null ? Math.min(1.3, 0.2 * hw) : o.keyline, uLen: prog >= 1 ? kt.L * 1.0001 : prog * kt.L,
      uFlare: o.flare || 0, uFlareI: o.flareI == null ? 3 : o.flareI,
      uFlareAx: [kt.center[0] - kt.x0, kt.center[1] - kt.y0, Math.max(bb[2] - bb[0], bb[3] - bb[1]) * 0.5, 0],
      uGroove: kgroove,
      uThreadC: sceneCol(o.threadColor || '#FFE7A3', look), uGlowC: sceneCol(o.glowColor || '#D4A64A', look),
      uThreadI: o.threadI == null ? 1.6 : o.threadI, uGlow: o.glow == null ? 1 : o.glow, uReach: kt.reach,
    }), target, { blend: thread ? 'add' : 'premul', mode: gl.TRIANGLE_STRIP, count: 4, instances: 1 });
    let tip = null;
    if (prog < 1) {
      tip = K.tipAt(kt, prog, { center: ctr, scale: sc, rotation: rot });
      const near = (o.tipAvoid || []).some(q => Math.hypot(q[0] - tip[0], q[1] - tip[1]) < (o.tipAvoidR || 60) * U);
      if (o.tips !== false && !near) K.penTip(target, { x: tip[0], y: tip[1], I: o.tipI == null ? (thread ? 2 : 5) : o.tipI, size: thread ? 0.5 * sc : sc });
    }
    return { tip };
  };

  // ---- corner roundel
  let roundelKT = null;
  K.roundel = function (target, o) {
    const size = o.size || 88, S = size / 88;
    const pr = o.progress == null ? 1 : Math.max(0, Math.min(1, o.progress));
    if (pr <= 0) return;
    const X = xf(o);
    const c = o.center;
    const look = o.look || 'winter_gold';
    const rect = [c[0] - size / 2 - 6, c[1] - size / 2 - 6, size + 12, size + 12];
    G.draw(variantProg('roundel', { FILL: o.fillI ? 1 : 0, GROOVE: 1 }), Object.assign(common(o, rect, 4 * S), {
      uQuads: xfRect(X, rect), uR: [c[0], c[1], size, pr], uEntry: (o.entry || 0) + 0, uKl: 0.95 * S,
      uField: sceneCol(o.field || '#2F7D6B', look), uRule: sceneCol(o.rule || '#C2452D', look), uXf: X.arr,
    }), target, { blend: 'premul', mode: gl.TRIANGLE_STRIP, count: 4, instances: 1 });
    if (!roundelKT) roundelKT = K.texture(roundelKnot({ R: 27 }), { ribbon: 4.6, gapFactor: 1.9 });
    const kp = Math.max(0, Math.min(1, (pr - 0.22) / 0.78));
    if (kp > 0) {
      const ctr = xfPt(X, c);
      K.draw(target, roundelKT, Object.assign({}, o, {
        center: ctr, scale: S * X.sc, rotation: (o.rotation || 0) + X.rot, progress: kp, tips: o.tips, tipI: (o.tipI == null ? 3 : o.tipI) * 0.6,
        groove: false, keyline: 0.85, flare: 0, xform: null, rect: null, sweep: o.sweep, wet: o.wet, tipAvoid: o.tipAvoid,
      }));
    }
  };
  K.roundelTexture = () => roundelKT;
  void gold;
  return K;
}
