// Scene 4: two-shores (30.0-54.0). PLACEHOLDER until its package delivers the real scene (see SPEC section 3).
// Line ids and times only; the text is read from window.LINES at runtime.
import { placeholder } from './_placeholder.js';

export default placeholder({
  id: 's04_two_shores', t0: 30.0, t1: 54.0, internalScale: 1, look: 'night_sea',
  top: '#0a1020', bottom: '#04070c', band: '#18202c',
  lines: [
    { id: "L3", t: 30.0, y: 880, exit: 34.4, kind: "mist", py: 1500 },
    { id: "L4", t: 36.0, y: 880, exit: 40.4, kind: "mist", py: 1500 },
    { id: "L5", t: 42.0, y: 880, exit: 46.4, kind: "mist", py: 1500 },
    { id: "L6a", t: 48.0, x: 1690, y: 352, style: {"base": "caps", "size": 22, "tracking": 0.34}, exit: 53.2, px: 870, py: 742 },
    { id: "L6b", t: 52.0, x: 230, y: 352, style: {"base": "caps", "size": 22, "tracking": 0.34}, exit: 53.2, px: 230, py: 742 },
  ],
  post: () => ({ ghosts: 0.03 }),
});
