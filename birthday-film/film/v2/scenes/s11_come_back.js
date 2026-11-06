// Scene 11: come-back (131.5-138.6). PLACEHOLDER until its package delivers the real scene (see SPEC section 3).
// Line ids and times only; the text is read from window.LINES at runtime.
import { placeholder } from './_placeholder.js';

export default placeholder({
  id: 's11_come_back', t0: 131.5, t1: 138.6, internalScale: 1, look: 'night_sea',
  top: '#0a1020', bottom: '#04060a', band: '#201a10',
  lines: [
    { id: "L17", t: 132.0, y: 900, style: {"base": "narrative", "size": 54}, exit: 137.0, kind: "mist", py: 1500 },
  ],
  post: () => ({ ghosts: 0.03 }),
});
