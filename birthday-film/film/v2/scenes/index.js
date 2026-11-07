/*
  scenes/index.js: the 14 scenes (SPEC sections 2 and 3) and the transitions between them.
  Scene windows [t0, t1) are the master-timeline windows; overlaps are rendered only inside a transition record.
  Transition kinds are documented in core/timeline.js. Where a scene's build sheet defines its own entrance it
  owns the look of the transition (packages may switch a record to kind 'custom' and implement scene.transition()).
*/
import s01 from './s01_forge_orbit.js';
import s02 from './s02_forge_name.js';
import s03 from './s03_credit_horizon.js';
import s04 from './s04_two_shores.js';
import s05 from './s05_dark_end.js';
import s06 from './s06_window.js';
import s07 from './s07_beside_you.js';
import s08 from './s08_honest.js';
import s09 from './s09_ocean_later.js';
import s10 from './s10_i_love_you.js';
import s11 from './s11_come_back.js';
import s12 from './s12_promise.js';
import s13 from './s13_signature.js';
import s14 from './s14_first_light.js';

export const SCENES = [s01, s02, s03, s04, s05, s06, s07, s08, s09, s10, s11, s12, s13, s14];

export const TRANSITIONS = [
  { from: 's01_forge_orbit', to: 's02_forge_name', t0: 12.0, kind: 'cut' },               // the flash begins at exactly 12.000
  { from: 's02_forge_name', to: 's03_credit_horizon', t0: 22.5, kind: 'cut' },            // scene 3 dissolves the name itself
  { from: 's03_credit_horizon', to: 's04_two_shores', t0: 30.0, kind: 'cut' },            // scene 3 crossfades the sea in from 28.8
  { from: 's04_two_shores', to: 's05_dark_end', t0: 53.5, t1: 54.5, kind: 'inkbleed', opts: { scale: 3, oct: 5, edge: 0.03, gold: 1 } },
  { from: 's05_dark_end', to: 's06_window', t0: 63.0, t1: 64.5, kind: 'over' },           // scene 5 at half scale underneath
  { from: 's06_window', to: 's07_beside_you', t0: 73.0, kind: 'cut' },                    // through-glass lands on the first crop
  { from: 's07_beside_you', to: 's08_honest', t0: 90.0, kind: 'cut' },                    // scene 8 recedes the photo itself
  { from: 's08_honest', to: 's09_ocean_later', t0: 107.4, t1: 108.6, kind: 'inkbleed', opts: { scale: 3, oct: 5, edge: 0.03, gold: 1 } },
  { from: 's09_ocean_later', to: 's10_i_love_you', t0: 117.0, kind: 'cut' },              // hard cut, cue 'stop'
  { from: 's10_i_love_you', to: 's11_come_back', t0: 131.5, t1: 132.5, kind: 'custom', ease: p => p },   // scene 11: luma-keyed ink bleed of the sea only, one continuous sky
  { from: 's11_come_back', to: 's12_promise', t0: 137.8, t1: 138.6, kind: 'custom' },              // scene 12: the sea dissolves into ink from the edges in
  { from: 's12_promise', to: 's13_signature', t0: 144.4, t1: 145.4, kind: 'custom' },              // scene 13: the knot crumbles to dust
  { from: 's13_signature', to: 's14_first_light', t0: 155.0, t1: 156.0, kind: 'custom' },         // scene 14: gilded ink front from the edges in
];
