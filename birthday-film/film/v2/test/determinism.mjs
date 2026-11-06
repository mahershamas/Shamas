#!/usr/bin/env node
/*
  Determinism: renders the same frames in two separate browser launches (the second in a different order) and
  compares the md5 of the captured PNGs. Every frame must be a pure function of t.
  Usage: node film/v2/test/determinism.mjs [--times 6.0,53.9,170.0] [--variant portrait]
*/
import crypto from 'crypto';
import { openFilm } from './_film.mjs';

const argv = process.argv.slice(2);
const opt = k => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : null; };
const times = (opt('times') || '6.0,53.9,170.0').split(',').map(Number);
const variant = opt('variant') || 'landscape';

async function run(order) {
  const f = await openFilm({ variant });
  const out = {};
  for (const t of order) { await f.seek(t); out[t] = crypto.createHash('md5').update(await f.capture()).digest('hex'); }
  if (f.errors.length) console.log('page errors:', f.errors);
  await f.close();
  return out;
}
const a = await run(times);
const b = await run(times.slice().reverse());
let ok = true;
for (const t of times) {
  const same = a[t] === b[t];
  ok = ok && same;
  console.log(`t=${t.toFixed(3).padStart(8)}  ${a[t]}  ${b[t]}  ${same ? 'same' : 'DIFFERENT'}`);
}
console.log(ok ? `PASS: ${times.length} frames identical across two launches (${variant})` : 'FAIL: frames differ');
process.exit(ok ? 0 : 1);
