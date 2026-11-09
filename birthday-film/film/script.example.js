// Example SCRIPT for film/engine.js. Copy to ../private/script.js and edit.
// Everything is a pure function of time (seconds). Positions are fractions of the frame.
window.SCRIPT = {
  width: 1920, height: 1080, duration: 20, seed: 7,
  leak: t => 0.6,                 // light-leak strength over time (0..1)
  bokehAlpha: t => 1,             // bokeh visibility over time (0..1)
  fade: t => (t < 1 ? 1 - t : (t > 19 ? t - 19 : 0)),   // black overlay (1 = black)
  shots: [
    { src: '../private/photo_2x.jpg', start: 8, end: 20, in: 2.5, out: 1.5, breathe: 0.012,
      keys: [ { t: 8, scale: 1.08, blur: 10, bright: 0.6, grade: 0.5, feather: 0.9 },
              { t: 11, scale: 1.0, blur: 0, bright: 1, grade: 0.35, feather: 0.45, ease: 'out' },
              { t: 13, sweep: 0 }, { t: 15, sweep: 1 },
              { t: 20, scale: 1.05, px: -0.02, py: -0.01 } ] },
  ],
  lines: [
    { t: 1.5, hold: 3, text: 'A SMALL FILM FOR', style: 'caps', y: 0.42, track: [0.6, 0.32] },
    { t: 2.2, hold: 3, text: 'Someone', style: 'script', y: 0.55, size: 1.3, glow: true, stagger: 'char' },
    { t: 9.5, hold: 7, text: 'an ordinary afternoon,\nwhich is the best kind', style: 'italic', y: 0.86, shadow: true },
  ],
};
