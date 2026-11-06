#!/usr/bin/env node
/*
  Lines check: every approved line (window.LINES keys L1a ... L20b) appears in the scenes' caption output, in order,
  whole (split entries via `part` must cover the full line). It also checks the typography rules on the private file
  (U+2019 apostrophes, U+00B7 middle dots) and reports how many caption lines are visible at once.
  It prints ids, times and verdicts only: never the strings themselves.
  Usage: node film/v2/test/lines_check.mjs [--variant portrait] [--step 0.0333]
*/
import { openFilm } from './_film.mjs';

const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
const variant = opt('variant') || 'landscape';
const step = parseFloat(opt('step') || String(1 / 30));

const f = await openFilm({ variant });
const res = await f.page.evaluate(step => {
  const L = window.LINES, ids = Object.keys(L).filter(k => /^L\d+[ab]?$/.test(k));
  const first = {}, cover = {}, scenes = {};
  let maxNarr = 0, maxAt = 0;
  for (let i = 0; ; i++) {
    const t = i * step; if (t >= window.FILM.duration) break;
    const caps = window.FILM_DEBUG.captionsAt(t);
    let vis = 0;
    for (const c of caps) {
      if (!c.shown || c.opacity < 0.02) continue;
      vis++;
      if (first[c.lineId] == null) first[c.lineId] = t;
      const n = Array.from(L[c.lineId] || '').length;
      const cv = cover[c.lineId] || (cover[c.lineId] = new Array(n).fill(false));
      const [a, b] = c.part || [0, n];
      for (let k = a; k < Math.min(b, n); k++) cv[k] = true;
      (scenes[c.lineId] = scenes[c.lineId] || new Set()).add(c.scene);
    }
    if (vis > maxNarr) { maxNarr = vis; maxAt = t; }
  }
  const typo = {
    straightApostrophes: ids.filter(k => /'/.test(L[k])),
    curlyOk: ids.filter(k => /’/.test(L[k])).length,
    middleDotOk: ids.filter(k => /·/.test(L[k])).length,
  };
  return { ids, first, cover: Object.fromEntries(Object.entries(cover).map(([k, v]) => [k, v.every(Boolean)])), scenes: Object.fromEntries(Object.entries(scenes).map(([k, v]) => [k, [...v]])), maxNarr, maxAt, typo };
}, step);
await f.close();

let ok = true, prev = -1, prevId = null;
for (const id of res.ids) {
  const t = res.first[id];
  let v = 'ok';
  if (t == null) { v = 'MISSING'; ok = false; }
  else if (!res.cover[id]) { v = 'INCOMPLETE (parts do not cover the line)'; ok = false; }
  else if (t + 1e-6 < prev) { v = `OUT OF ORDER (before ${prevId})`; ok = false; }
  if (t != null) { prev = Math.max(prev, t); prevId = id; }
  console.log(`${id.padEnd(5)} first visible ${t == null ? '   -   ' : t.toFixed(2).padStart(7)} s  ${(res.scenes[id] || []).join(',').padEnd(36)} ${v}`);
}
if (res.typo.straightApostrophes.length) { ok = false; console.log('straight apostrophes in:', res.typo.straightApostrophes.join(', ')); }
console.log(`lines with U+2019: ${res.typo.curlyOk}, with U+00B7: ${res.typo.middleDotOk}; max caption entries visible at once: ${res.maxNarr} (t=${res.maxAt.toFixed(2)})`);
console.log(ok ? `PASS: ${res.ids.length} lines, in order, complete (${variant})` : 'FAIL');
process.exit(ok ? 0 : 1);
