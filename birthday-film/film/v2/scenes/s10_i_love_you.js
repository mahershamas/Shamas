// Scene 10: i-love-you (117.0-132.5). PLACEHOLDER until its package delivers the real scene (see SPEC section 3).
// Line ids and times only; the text is read from window.LINES at runtime.
import { placeholder } from './_placeholder.js';

export default placeholder({
  id: 's10_i_love_you', t0: 117.0, t1: 132.5, internalScale: 1, look: 'night_sea',
  top: '#050810', bottom: '#020306', band: '#0c1a1a',
  lines: [
    { id: "L15", t: 118.0, y: 460, style: "display", exit: 124.6, py: 850 },
    { id: "L16", t: 126.0, y: 450, style: {"base": "narrative", "size": 54}, exit: 130.4, kind: "mist", py: 840 },
  ],
  
});
