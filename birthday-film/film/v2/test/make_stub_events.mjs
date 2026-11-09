#!/usr/bin/env node
/*
  Writes film/v2/cues_events.json with STUB event lists computed from the formulas of SPEC 5.2, so that the visual
  modules can read events before the music module (engine/v2/music/score.py) writes the real file.
  The real file replaces this one; the format is identical ({"stub": true} marks this one).

    orbit_plucks    t_k = 12 - 8*0.8^k (k = 0..20), pan +0.6 for even k, -0.6 for odd k, ladder note index floor(0.6k)
    gold_dust       seeded Poisson harp harmonics 12.0-22.5, rate 8/s decaying exponentially to 0.5/s at 20.0, pan +-0.7
    strike          6 harmonics D6 at 18.00 + 0.05n
    rubric_ticks    8 harmonics alternating A6/D7 at 19.000 + 0.125n
    chimes          48..52 (A5 E5 D5 C5 A4), pan +0.3 -> -0.3
    portrait_glints 71.0, 71.2, 71.4, 71.6
    thread_sparkle  every 0.6 s from 84.0 to 88.2
    pearl           87.0
    homecoming      harp ripple at 147.0 + 0.25n (n = 0..5)
    pickup          155.4, 155.6, 155.8
    jig_down        6/8 bars J1..J16 at 156 + 1.2(j-1); lilt [0.212, 0.188, 0.200]; tipper D U D D U D, down strokes on
                    quavers 1, 3, 4, 6 with accents [1.0, 0.55, 0.85, 0.55] x level (A 0.35, B 0.55); every 4th bar
                    quavers 5-6 are a triplet roll (the q6 down stroke is replaced by the roll's last stroke)
    quill_env       [t, amp] at 30 fps over 102.0-104.0 (stub bell curve; the visual nib table drives the real one)
  Usage: node film/v2/test/make_stub_events.mjs [--out film/v2/cues_events.json]
*/
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? path.resolve(process.argv[outArg + 1]) : path.join(here, '..', 'cues_events.json');

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const r3 = x => Math.round(x * 1000) / 1000;

const LADDER = [74, 77, 79, 81, 84, 86, 89, 91, 93, 96, 98, 101, 103];
const orbit_plucks = [];
for (let k = 0; k <= 20; k++) orbit_plucks.push({ t: r3(12 - 8 * Math.pow(0.8, k)), k, pan: k % 2 === 0 ? 0.6 : -0.6, midi: LADDER[Math.floor(0.6 * k)], vel: r3(0.12 + 0.025 * k) });

const rnd = mulberry32(1203);
const gold_dust = [];
const DUST = [86, 89, 91, 93, 96];
const rate = t => t >= 20 ? 0.5 : 8 * Math.pow(0.5 / 8, (t - 12) / 8);
for (let t = 12.0; ;) {
  // thinning with the maximum rate 8/s
  t += -Math.log(1 - rnd()) / 8;
  if (t >= 22.5) break;
  if (rnd() < rate(t) / 8) gold_dust.push({ t: r3(t), pan: r3((rnd() * 2 - 1) * 0.7), midi: DUST[Math.floor(rnd() * DUST.length)], vel: r3(0.15 + 0.15 * rnd()) });
}

const strike = Array.from({ length: 6 }, (_, n) => ({ t: r3(18.0 + 0.05 * n), midi: 86, vel: 0.18 }));
const rubric_ticks = Array.from({ length: 8 }, (_, n) => ({ t: r3(19.0 + 0.125 * n), midi: n % 2 === 0 ? 93 : 98, vel: 0.10 }));
const chimes = [81, 76, 74, 72, 69].map((m, i) => ({ t: 48 + i, k: i + 1, midi: m, pan: r3(0.3 - 0.15 * i), vel: 0.42 }));
const portrait_glints = [71.0, 71.2, 71.4, 71.6].map((t, i) => ({ t, k: i + 1 }));
const thread_sparkle = [];
for (let i = 0; ; i++) { const t = r3(84.0 + 0.6 * i); if (t > 88.2 + 1e-9) break; thread_sparkle.push({ t, vel: 0.10 }); }
const pearl = [{ t: 87.0, midi: 93, vel: 0.20 }];
const homecoming = [66, 69, 73, 76, 78, 81].map((m, n) => ({ t: r3(147.0 + 0.25 * n), midi: m, vel: 0.15 }));
const pickup = [{ t: 155.4, vel: 0.40 }, { t: 155.6, vel: 0.45 }, { t: 155.8, vel: 0.50 }];

const LILT = [0, 0.212, 0.400, 0.600, 0.812, 1.000];   // quaver onsets within a 1.2 s bar
const jig_down = [];
for (let j = 1; j <= 16; j++) {
  const bar = 156 + 1.2 * (j - 1), level = j <= 8 ? 0.35 : 0.55;
  const downs = [[0, 1.0], [2, 0.55], [3, 0.85], [5, 0.55]];
  for (const [q, acc] of downs) {
    if (j % 4 === 0 && q === 5) continue;                  // replaced by the triplet roll
    jig_down.push({ t: r3(bar + LILT[q]), bar: j, q: q + 1, vel: r3(acc * level) });
  }
  if (j % 4 === 0) {                                       // triplet roll over quavers 5-6: the last stroke is a down
    jig_down.push({ t: r3(bar + LILT[4] + 2 * (1.2 - LILT[4]) / 3), bar: j, q: 6, vel: r3(0.55 * level), roll: true });
  }
}

const quill_env = [];
for (let f = 0; f <= 60; f++) { const t = 102 + f / 30; const x = (t - 102) / 2; quill_env.push([r3(t), r3(Math.sin(Math.PI * x) * (0.6 + 0.4 * Math.sin(x * 37)))]); }

const json = { stub: true, generator: 'film/v2/test/make_stub_events.mjs', orbit_plucks, gold_dust, strike, rubric_ticks, chimes,
  portrait_glints, thread_sparkle, pearl, homecoming, pickup, jig_down, quill_env };
fs.writeFileSync(out, JSON.stringify(json, null, 1) + '\n');
console.log(`wrote ${out}: ${orbit_plucks.length} plucks, ${gold_dust.length} gold dust, ${jig_down.length} jig down-strokes, ${thread_sparkle.length} thread sparkles`);
