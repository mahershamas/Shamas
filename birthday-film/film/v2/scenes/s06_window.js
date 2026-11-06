// Scene 6: window (63.0-73.0). PLACEHOLDER until its package delivers the real scene (see SPEC section 3).
// Line ids and times only; the text is read from window.LINES at runtime.
import { placeholder } from './_placeholder.js';

export default placeholder({
  id: 's06_window', t0: 63.0, t1: 73.0, internalScale: 1, look: 'photo',
  top: '#0e1522', bottom: '#07080c', band: '#2a2014',
  lines: [
    { id: "L8a", t: 66.0, x: 760, y: 1010, exit: 71.2, style: {"base": "narrative", "size": 46}, px: 540, py: 1330 },
    { id: "L8b", t: 69.0, x: 1130, y: 1010, exit: 71.2, style: {"base": "narrative", "size": 46}, px: 540, py: 1390 },
    { id: "L9", t: 72.0, y: 930, style: "narrativePhoto", exit: 76.0, kind: "forget", dur: 1.4, py: 1580 },
  ],
  alphaIn: 1.5,
});
