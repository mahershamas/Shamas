// Scene 8: honest (90.0-108.0). PLACEHOLDER until its package delivers the real scene (see SPEC section 3).
// Line ids and times only; the text is read from window.LINES at runtime.
import { placeholder } from './_placeholder.js';

export default placeholder({
  id: 's08_honest', t0: 90.0, t1: 108.0, internalScale: 1, look: 'winter_gold',
  top: '#0b0a0c', bottom: '#07080c', band: '#161210',
  lines: [
    { id: "L12", t: 93.0, y: 560, style: "roman", exit: 97.6, py: 900 },
    { id: "L13a", t: 99.0, y: 500, style: "roman", exit: 106.6, dur: 1.0, py: 900 },
    { id: "L13b", t: 102.0, y: 610, style: "script", exit: 106.6, dur: 1.0, py: 1010 },
  ],
  
});
