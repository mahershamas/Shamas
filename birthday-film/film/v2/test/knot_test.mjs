#!/usr/bin/env node
/*
  Knot unit tests (package P2; SPEC 7.2 "parity, alternation and single-component tests pass for the promise knot
  (lobes 4, n 3) and the seat knot"). Pure geometry: runs in node, no browser.
    node film/v2/test/knot_test.mjs
  Checks
    promise knot (landscape R 170 and portrait R 190), seat knot, corner-roundel knot:
      parity (every crossing one over + one under), alternation along the whole loop (across the seam too),
      one component (closed, traced exactly once), crossing angles, room for the under-crossing gaps
    negative controls: a gcd(lobes, turns) = 2 rose is reported as 2 components, an open curve as 0,
      a tampered over/under assignment fails alternation
    8B data texture: at every crossing the over passage is in layer 0 and the under passage is flagged in layer 1,
      no texel sees three passages, no texel sees two non-crossing passages close enough to touch
    8A braid band: with the shader's rule, every strand alternates over/under along the band (3-strand plait), and
      the 2-strand annulus twist alternates all the way round the circle (whole number of periods)
*/
import {
  closedKnot, verifyKnot, roseCurve, promiseKnot, seatKnot, roundelKnot, buildKnotData, knotReach,
  braidOver, braidStrandY,
} from '../core/knot.js';

let fails = 0;
const check = (name, cond, info = '') => { console.log(`${cond ? 'ok  ' : 'FAIL'}  ${name}${info ? '  ' + info : ''}`); if (!cond) fails++; };
const fmt = v => JSON.stringify(v, (k, x) => typeof x === 'number' ? +x.toFixed(2) : x);

// ---- closed knots
const cases = [
  { name: 'promise knot (landscape)', k: promiseKnot({ cx: 960, cy: 470, R: 170 }), ribbon: 14, gap: 2.2, crossings: 8 },
  { name: 'promise knot (portrait)', k: promiseKnot({ cx: 540, cy: 860, R: 190 }), ribbon: 14, gap: 2.2, crossings: 8 },
  { name: 'seat knot', k: seatKnot({ cx: 0, cy: 0, size: 64 }), ribbon: 2, gap: 2.6, crossings: 4, thread: true },
  { name: 'corner roundel knot', k: roundelKnot({ R: 27 }), ribbon: 4.6, gap: 1.9, crossings: 3 },
];
for (const c of cases) {
  const v = verifyKnot(c.k, { ribbon: c.ribbon, gapFactor: c.gap });
  check(`${c.name}: parity`, v.parity);
  check(`${c.name}: alternation`, v.alternation);
  check(`${c.name}: one component`, v.components === 1 && v.closed && v.retrace === 1, `components ${v.components}`);
  check(`${c.name}: ${c.crossings} crossings`, v.crossings === c.crossings, `found ${v.crossings}`);
  check(`${c.name}: crossing angles >= 30 deg`, v.minAngle >= 30, `min ${v.minAngle.toFixed(1)}`);
  check(`${c.name}: passages farther apart than the cut`, v.minPassGap > v.cutLength, `min gap ${v.minPassGap.toFixed(1)} px > cut ${v.cutLength.toFixed(1)} px`);
  check(`${c.name}: ok`, v.ok, fmt(v));
}

// ---- negative controls
{
  const c = roseCurve({ R: 100, lobes: 4, turns: 2 });          // gcd 2: the parameter range traces one curve twice
  const v = verifyKnot(closedKnot(c.P, c.thMax, { samples: 1500 }));
  check('control: gcd(4,2) rose is not one component', !v.ok && v.components === 2, `components ${v.components}`);
  const o = roseCurve({ R: 100, lobes: 4, turns: 3 });
  const vo = verifyKnot(closedKnot(o.P, o.thMax * 0.83, { samples: 1500 }));
  check('control: an open curve has no closed component', !vo.ok && vo.components === 0, `components ${vo.components}`);
  const k = promiseKnot({});
  k.crossings[0].overIsA = !k.crossings[0].overIsA; k.crossings[0].overIsB = !k.crossings[0].overIsB;
  check('control: a flipped crossing breaks alternation', !verifyKnot(k).alternation);
}

// ---- 8B data texture
for (const c of cases) {
  const k = c.k;
  const reach = knotReach(c.ribbon, c.gap, !!c.thread);
  const D = buildKnotData(k, { reach });
  const at = (x, y, layer) => { const i = ((y - D.y0) * 2 * D.w + layer * D.w + (x - D.x0)) * 4; return [D.data[i], D.data[i + 1], D.data[i + 2], D.data[i + 3]]; };
  const cyc = (a, b) => { const d = Math.abs(a - b) % k.L; return Math.min(d, k.L - d); };
  let good = 0;
  for (const cr of k.crossings) {
    const x = Math.floor(cr.x), y = Math.floor(cr.y);
    const A = at(x, y, 0), B = at(x, y, 1);
    const sOver = cr.overIsA ? cr.sa : cr.sb, sUnder = cr.overIsA ? cr.sb : cr.sa;
    if (B[3] >= 0 && B[2] > 8 && cyc(A[3], sOver) < 3 * reach && cyc(B[3], sUnder) < 3 * reach) good++;
  }
  check(`${c.name}: data texture puts the over passage on top at every crossing`, good === k.crossings.length, `${good}/${k.crossings.length}`);
  check(`${c.name}: data texture has no triple passages`, D.stats.triple === 0, `triple ${D.stats.triple}`);
  check(`${c.name}: data texture has no touching non-crossing passages`, D.stats.nearTouch === 0, `nearTouch ${D.stats.nearTouch}`);
}

// ---- 8A braid band: crossings found numerically, over/under from the shader's rule
function braidCheck(n, amp, omega, s0, s1, wrap) {
  const ds = 0.05, cr = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    let prev = braidStrandY(n, i, s0, amp, omega) - braidStrandY(n, j, s0, amp, omega);
    const steps = Math.round((s1 - s0) / ds);
    for (let q = 1; q <= steps; q++) {
      const s = s0 + (s1 - s0) * q / steps;
      const d = braidStrandY(n, i, s, amp, omega) - braidStrandY(n, j, s, amp, omega);
      if (prev === 0 || (prev < 0) !== (d < 0)) {
        const sc = s - ds * d / (d - prev);
        if (!wrap || sc < s1 - 1e-6) cr.push({ i, j, s: sc, over: braidOver(n, i, j, sc, omega) });
      }
      prev = d;
    }
  }
  let parity = cr.every(c => (c.over === c.i || c.over === c.j) && braidOver(n, c.j, c.i, c.s, omega) === c.over);
  let alternation = true, perStrand = [];
  for (let k = 0; k < n; k++) {
    const seq = cr.filter(c => c.i === k || c.j === k).sort((a, b) => a.s - b.s).map(c => c.over === k);
    perStrand.push(seq.length);
    for (let q = 1; q < seq.length; q++) if (seq[q] === seq[q - 1]) alternation = false;
    if (wrap && seq.length && seq[0] === seq[seq.length - 1]) alternation = false;
    if (wrap && seq.length % 2) alternation = false;
  }
  return { parity, alternation, crossings: cr.length, perStrand };
}
{
  const r = braidCheck(3, 14, 2 * Math.PI / 72, -560, 560, false);
  check('braid band (3 strands, A 14, period 72): parity', r.parity);
  check('braid band (3 strands): every strand alternates over/under', r.alternation, `${r.crossings} crossings, per strand ${r.perStrand}`);
  for (const [r0, r1] of [[280, 306], [322, 348], [364, 390]]) {
    const rm = (r0 + r1) / 2, Wd = r1 - r0, hw = Math.max(2.5, Math.min(7, 0.13 * Wd)), amp = Wd / 2 - (2 * 0.95 + 1.4) - hw;
    const nPer = Math.max(3, Math.round(2 * Math.PI * rm / (2 * Math.PI * amp))), omega = nPer / rm;
    const off = 0.0137;   // start off a crossing so the seam crossing is counted exactly once
    const q = braidCheck(2, amp, omega, -Math.PI * rm + off, Math.PI * rm + off, true);
    check(`rosette band r ${r0}-${r1} (2 strands, ${nPer} periods): parity and alternation round the circle`, q.parity && q.alternation, `${q.crossings} crossings`);
  }
}

console.log(fails ? `FAIL: ${fails} check(s) failed` : 'PASS: all knot checks');
process.exit(fails ? 1 : 0);
